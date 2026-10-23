import { bridgeHeaders } from './bridgeToken';

/**
 * Photo-based food/vegetable recognition pipeline (HomeHub).
 *
 *   1. MobileNet (in-browser, ImageNet 1K)         — covers ~11 ImageNet veg
 *   2. Vegetable Image Dataset index (in-browser, 21k Misrak) — covers Indian/South Asian veg
 *   3. User-trained kNN (in-browser)                — catches items the user has saved
 *   4. PlantNet API (network)                       — fallback for items the above miss
 *
 * The historical BanglaVegNet visual fingerprint tier has been REMOVED per
 * user request — it was producing wrong guesses (tomato → garlic). BanglaVeg.ts
 * remains as a vocabulary normaliser so any result still maps to the
 * user's Hindi name (e.g. "Solanum lycopersicum" → "Tamatar").
 */

import {
  loadTrainingExamples,
  findSimilarTrainingExamples,
} from './foodTrainer';
import { mapToBanglaVeg } from './banglaveg';

export interface Prediction {
  label: string;
  confidence: number;
  categoryHint?: 'vegetable' | 'fruit' | 'leafy' | 'root' | 'spice' | 'other';
  source: 'overwatch' | 'plantnet' | 'mobilenet' | 'dataset' | 'user-trained' | 'manual';
  notes?: string;
  alternatives?: Array<{ label: string; confidence: number }>;
  storage?: 'fridge' | 'pantry' | 'freezer' | 'counter';
}

export interface ClassificationResult {
  predictions: Prediction[];
  /** Visual fingerprint of the input image (used by trainer UI + dataset). */
  fingerprint?: number[];
  /** Which path served the prediction. */
  path: 'overwatch' | 'in-browser';
}

/** Size of the grayscale component of the fingerprint. */
const GRAY_SIZE = 32;
const HIST_BINS = 16;

/**
 * Size the photo is decoded to before the fingerprint is drawn.
 *
 * The fingerprint is a 32×32 grayscale draw, so decoding a 12 MP phone
 * photo at full resolution buys nothing and costs tens of megabytes of
 * decoded RGBA. 64×64 is comfortably more than the draw needs.
 */
const FINGERPRINT_DECODE_SIZE = 64;

/** The set of MobileNet-known vegetable/fruit canonicals that we *trust*
 *  implicitly when MobileNet returns them — even with modest confidence. */
const KNOWN_LOCAL_VEG_CANONICAL = new Set<string>([
  'Broccoli', 'Cauliflower', 'Cucumber', 'Capsicum', 'Mushroom',
  'Lemon', 'Orange', 'Banana', 'Corn', 'Pumpkin', 'Zucchini',
]);

/** Read VITE_OVERWATCH_URL (preferred) or fall back to VITE_API_BASE_URL. */
export function readOverwatchUrl(): string | null {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const v = env?.VITE_OVERWATCH_URL || env?.VITE_API_BASE_URL;
    if (v && v.length > 0) return v.replace(/\/$/, '');
    // Nothing configured at build time, so talk to our own origin. This holds
    // in every mode: production is served by the bridge itself, and `vite
    // dev`/`preview` proxy /api through to it (see vite.config). Resolved at
    // runtime, so a quick tunnel getting a new hostname needs no rebuild.
    if (typeof window !== 'undefined' && window.location.origin) {
      return window.location.origin;
    }
    return null;
  } catch {
    return null;
  }
}

/** Normalise localhost → 127.0.0.1 for Private Network Access compatibility
 *  in Chromium 124+ (they were treated separately). */
function normaliseLocal(url: string): string {
  return url.replace('localhost', '127.0.0.1');
}

/** Run recognition. Goes through overwatch agent if backend is configured. */
export async function classifyFoodImage(image: Blob): Promise<Prediction[]> {
  const r = await classifyFoodImageDetailed(image);
  return r.predictions;
}

export async function classifyFoodImageDetailed(
  image: Blob,
): Promise<ClassificationResult> {
  // Always compute the fingerprint first — needed for the trainer UI + dataset index
  let fingerprint: number[] | null = null;
  try {
    // Decoded small, and released immediately. A bitmap that is never
    // closed stays allocated for the life of the tab — one full-resolution
    // photo per recognition, which is ~48 MB of RGBA for a 12 MP camera.
    const bitmap = await createImageBitmap(image, {
      resizeWidth: FINGERPRINT_DECODE_SIZE,
      resizeHeight: FINGERPRINT_DECODE_SIZE,
      resizeQuality: 'high',
    });
    try {
      fingerprint = computeFingerprint(bitmap);
    } finally {
      bitmap.close();
    }
  } catch {
    // ignore
  }

  // Run ALL three tiers in parallel — PlantNet is the authoritative
  // recognition backend for fresh produce, so if it returns anything
  // (regardless of MobileNet's "bell pepper" mistake), PlantNet wins.
  //
  // MobileNet + dataset still run in parallel — used as instant offline
  // fallback if PlantNet fails / is unavailable.
  const mnPromise: Promise<Prediction[]> = (async () => {
    try {
      const { classifyWithMobileNet, warmLocalClassifier } = await import('./localClassifier');
      warmLocalClassifier();
      return await classifyWithMobileNet(image);
    } catch {
      return [];
    }
  })();

  const datasetPromise: Promise<Prediction[]> = fingerprint
    ? (async () => {
        try {
          const { findBestDatasetMatch } = await import('./datasetIndex');
          const matches = await findBestDatasetMatch(fingerprint, 4, 0.5);
          return matches.map((m) => ({
            label: m.cls.canonical,
            confidence: m.confidence,
            categoryHint: m.cls.category,
            storage: m.cls.storage,
            source: 'dataset' as const,
            notes: `21k vegetable dataset · ${m.refCount} reference images`,
          }));
        } catch {
          return [];
        }
      })()
    : Promise.resolve([]);

  const pnPromise: Promise<Prediction[]> = (async () => {
    const pnBase = readOverwatchUrl();
    if (!pnBase) return [];
    try {
      const result = await classifyViaPlantNet(pnBase, image);
      return result.predictions;
    } catch {
      return [];
    }
  })();

  // MiniMax vision — last-resort LLM fallback when PlantNet (quota/down)
  // AND the in-browser dataset tier both miss. Run in parallel so it
  // doesn't add latency to the happy path; we only consult it when the
  // tiers above returned nothing useful.
  const mxPromise: Promise<Prediction[]> = (async () => {
    const mxBase = readOverwatchUrl();
    if (!mxBase) return [];
    try {
      const result = await classifyViaMiniMax(mxBase, image);
      if (!result.ok || !result.label) return [];
      return [{
        label: result.label,
        confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
        categoryHint: mapCategory(result.category),
        storage: 'fridge' as Prediction['storage'],
        source: 'overwatch' as const,
        notes: result.notes ?? `MiniMax vision · ${result.ms ?? 0}ms`,
      }];
    } catch {
      return [];
    }
  })();

  const [local, datasetPreds, plantnetPreds, minimaxPreds] = await Promise.all([
    mnPromise,
    datasetPromise,
    pnPromise,
    mxPromise,
  ]);

  // PlantNet is the actual expert for fresh produce. If it returned any
  // predictions, use them — even if MobileNet said "bell pepper" or
  // "cucumber". PlantNet knows species-level taxonomy; MobileNet knows
  // ImageNet 2012.
  if (plantnetPreds.length > 0) {
    return {
      predictions: plantnetPreds,
      fingerprint: fingerprint ?? undefined,
      path: 'overwatch',
    };
  }

  // Fall back to dataset tier when PlantNet failed (network / quota).
  if (datasetPreds.length > 0) {
    return {
      predictions: datasetPreds,
      fingerprint: fingerprint ?? undefined,
      path: 'in-browser',
    };
  }

  // MiniMax LLM fallback — handles anything PlantNet + dataset both miss
  // (rare, but the safety net the user explicitly asked for).
  if (minimaxPreds.length > 0) {
    return {
      predictions: minimaxPreds,
      fingerprint: fingerprint ?? undefined,
      path: 'overwatch',
    };
  }

  // Last resort: MobileNet.
  if (local.length > 0) {
    return {
      predictions: local,
      fingerprint: fingerprint ?? undefined,
      // MobileNet runs IN THE BROWSER, so this is not the network path.
      path: 'in-browser',
    };
  }

  // 2. User-trained kNN — items the user has saved before.
  const predictions: Prediction[] = [];
  if (fingerprint) {
    const matches = findSimilarTrainingExamples(fingerprint, 0.55);
    for (const m of matches.slice(0, 5)) {
      const countBoost = Math.min(0.15, (m.count - 1) * 0.04);
      const mapped = mapToBanglaVeg(m.label);
      predictions.push({
        label: mapped ? mapped.canonical : m.label,
        confidence: Math.min(0.99, m.similarity + countBoost),
        source: 'user-trained',
        categoryHint: mapped ? mapped.category : categoryHintForLabel(m.label),
      });
    }
  }

  predictions.sort((a, b) => b.confidence - a.confidence);
  return {
    predictions: predictions.slice(0, 6),
    fingerprint: fingerprint ?? undefined,
    path: 'in-browser',
  };
}

// ─── Visual fingerprint (shared by trainer, dataset index, user-trained kNN) ─

function computeFingerprint(bitmap: ImageBitmap): number[] {
  const W = GRAY_SIZE;
  const H = GRAY_SIZE;
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(W, H);
  } else {
    canvas = document.createElement("canvas");
    (canvas as HTMLCanvasElement).width = W;
    (canvas as HTMLCanvasElement).height = H;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error('No 2D canvas context');
  ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;

  const gray = new Array(W * H);
  for (let i = 0, p = 0; p < data.length; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    gray[i] = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  }

  const hist = new Array(HIST_BINS * 3).fill(0);
  const binSize = 256 / HIST_BINS;
  for (let p = 0; p < data.length; p += 4) {
    hist[Math.min(HIST_BINS - 1, Math.floor(data[p] / binSize))] += 1;
    hist[HIST_BINS + Math.min(HIST_BINS - 1, Math.floor(data[p + 1] / binSize))] += 1;
    hist[HIST_BINS * 2 + Math.min(HIST_BINS - 1, Math.floor(data[p + 2] / binSize))] += 1;
  }
  const totalPixels = W * H;
  for (let i = 0; i < hist.length; i++) hist[i] /= totalPixels;

  return [...gray, ...hist];
}

// ─── MobileNet (offline tier 1) ──────────────────────────────────────────────

interface OverwatchReply {
  ok: boolean;
  prediction: OverwatchPrediction | null;
  rawReply?: string;
  parsedOk?: boolean;
  error?: string;
}
interface OverwatchPrediction {
  label: string;
  category?: string;
  confidence: number;
  alternatives?: Array<{ label: string; confidence: number }>;
  storage?: string;
  notes?: string;
}

function mapCategory(c?: string): Prediction['categoryHint'] {
  if (!c) return undefined;
  const valid = ['vegetable', 'fruit', 'leafy', 'root', 'spice', 'other'];
  return (valid.includes(c) ? c : 'other') as Prediction['categoryHint'];
}

// ─── PlantNet proxy ─────────────────────────────────────────────────────────

interface PlantNetPrediction {
  scientificName: string;
  scientificNameWithoutAuthor?: string;
  scientificNameWithAuthor: string;
  commonNames: string[];
  family?: string;
  genus?: string;
  score: number;
  gbif?: string;
}

interface PlantNetReply {
  ok: boolean;
  ms?: number;
  predictions?: PlantNetPrediction[];
  error?: string;
  message?: string;
}

function pickPlantNetLabel(p: PlantNetPrediction): string {
  for (const c of p.commonNames ?? []) {
    const bv = mapToBanglaVeg(c);
    if (bv) return bv.canonical;
  }
  const bvSci = mapToBanglaVeg(p.scientificName);
  if (bvSci) return bvSci.canonical;
  return p.commonNames?.[0] ?? p.scientificNameWithoutAuthor ?? p.scientificName ?? '';
}

function pickPlantNetStorage(p: PlantNetPrediction): Prediction['storage'] {
  for (const c of p.commonNames ?? []) {
    const bv = mapToBanglaVeg(c);
    if (bv) return bv.storage;
  }
  return 'fridge';
}

function pickPlantNetCategory(p: PlantNetPrediction): Prediction['categoryHint'] {
  for (const c of p.commonNames ?? []) {
    const bv = mapToBanglaVeg(c);
    if (bv) return bv.category;
  }
  const fam = (p.family ?? '').toLowerCase();
  if (fam.includes('apiaceae')) return 'root';
  if (fam.includes('solanaceae')) return 'vegetable';
  if (fam.includes('cucurbitaceae')) return 'vegetable';
  if (fam.includes('brassicaceae')) return 'leafy';
  if (fam.includes('fabaceae')) return 'vegetable';
  if (fam.includes('zingiberaceae')) return 'spice';
  if (fam.includes('poaceae')) return 'other';
  return 'vegetable';
}

async function classifyViaPlantNet(
  base: string,
  image: Blob,
): Promise<{ predictions: Prediction[] }> {
  const form = new FormData();
  form.append('image', image, 'capture.jpg');
  form.append('organ', 'fruit');
  form.append('lang', 'en');
  form.append('nbResults', '5');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  let res: Response;
  try {
    res = await fetch(`${normaliseLocal(base)}/api/plantnet/identify`, {
      method: 'POST',
      headers: bridgeHeaders(),
      body: form,
      signal: ctrl.signal,
    });
  } catch {
    clearTimeout(timer);
    return { predictions: [] };
  }
  clearTimeout(timer);
  if (!res.ok) return { predictions: [] };
  let json: PlantNetReply;
  try {
    json = (await res.json()) as PlantNetReply;
  } catch {
    return { predictions: [] };
  }
  if (!json.ok || !Array.isArray(json.predictions)) return { predictions: [] };
  const rawPreds = json.predictions.slice(0, 5);
  if (rawPreds.length === 0) return { predictions: [] };

  const usable = rawPreds.filter((p) => p.score > 0.005);
  if (usable.length === 0) return { predictions: [] };

  const primary = usable[0];
  const alternatives = usable.slice(1, 4).map((p) => ({
    label: pickPlantNetLabel(p),
    confidence: p.score,
  }));

  const lowConfidence = primary.score < 0.2;

  return {
    predictions: [{
      label: pickPlantNetLabel(primary),
      confidence: primary.score,
      categoryHint: pickPlantNetCategory(primary),
      storage: pickPlantNetStorage(primary),
      notes: lowConfidence
        ? `PlantNet low confidence · ${primary.scientificNameWithAuthor}${primary.family ? ` · ${primary.family}` : ''}`
        : `PlantNet · ${primary.scientificNameWithAuthor}${primary.family ? ` · ${primary.family}` : ''}`,
      alternatives,
      source: 'plantnet',
    }],
  };
}

// ─── MiniMax vision (LLM fallback tier) ─────────────────────────────────

interface MiniMaxReply {
  ok: boolean;
  ms?: number;
  label?: string;
  confidence?: number;
  category?: string;
  notes?: string;
  error?: string;
  message?: string;
}

async function classifyViaMiniMax(
  base: string,
  image: Blob,
): Promise<MiniMaxReply> {
  const form = new FormData();
  form.append('image', image, 'capture.jpg');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  let res: Response;
  try {
    res = await fetch(`${normaliseLocal(base)}/api/minimax/identify`, {
      method: 'POST',
      headers: bridgeHeaders(),
      body: form,
      signal: ctrl.signal,
    });
  } catch {
    clearTimeout(timer);
    return { ok: false, error: 'unreachable' };
  }
  clearTimeout(timer);
  let json: MiniMaxReply;
  try {
    json = (await res.json()) as MiniMaxReply;
  } catch {
    return { ok: false, error: 'bad_json' };
  }
  if (!res.ok || !json.ok) {
    return { ok: false, error: json.error ?? 'http_error', message: json.message };
  }
  return json;
}

/** Public helper for trainer modal — just delegates to the same fingerprint code. */
export async function extractImageEmbedding(blob: Blob): Promise<number[] | null> {
  try {
    // Decoded small and closed straight afterwards, for the same reason as
    // the recognition path: a full-resolution bitmap left open is tens of
    // megabytes leaked per photo.
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: FINGERPRINT_DECODE_SIZE,
      resizeHeight: FINGERPRINT_DECODE_SIZE,
      resizeQuality: 'high',
    });
    try {
      return computeFingerprint(bitmap);
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

export function categoryHintForLabel(label: string): Prediction['categoryHint'] {
  const l = label.toLowerCase();
  if (/lemon|orange|apple|banana|strawberry|pineapple|pomegranate|fig|jackfruit|custard|kiwi|mango|peach|pear|plum|cherry|grape|avocado|papaya|guava|lychee|watermelon/.test(l)) {
    return 'fruit';
  }
  if (/broccoli|cauliflower|cabbage|lettuce|spinach|kale|coriander|mint|fenugreek|methi/.test(l)) return 'leafy';
  if (/carrot|potato|sweet potato|ginger|garlic|onion|beet|radish|turmeric|yam|turnip/.test(l)) return 'root';
  if (/chili|pepper|cumin|cinnamon|coriander|cardamom|clove|fennel|mustard|poppy|fenugreek/.test(l)) return 'spice';
  if (/cucumber|tomato|eggplant|brinjal|okra|bhindi|bitter gourd|bottle gourd|ridge gourd|snake gourd|drumstick|raw banana|parwal|pointed gourd|tinda|pumpkin|squash|zucchini|ladies finger/.test(l)) {
    return 'vegetable';
  }
  return 'other';
}
