/**
 * BanglaVegNet reference-signature index — built from Wikipedia article
 * lead images + Wikimedia Commons thumbnails. Each class has up to 4
 * reference images; we compute the same 1072-dim visual fingerprint for
 * each that foodClassifier uses, then do per-class aggregation.
 *
 * On the first photo classification (per session):
 *   - Decode each reference image (base64 data URL).
 *   - Run it through `computeFingerprint`.
 *   - Store the fingerprints in a Map keyed by canonical class name.
 *
 * Subsequent calls reuse the cached index (fingerprint compute is the
 * bottleneck; one-time cost is amortised over every photo).
 *
 * Attribution:
 *   - Class vocabulary: BanglaVegNet (Mendeley Data, DOI: 10.17632/rtx9ngb68j, CC BY 4.0).
 *   - Reference images: Wikipedia article lead images + Wikimedia Commons thumbnails
 *     (mostly CC BY-SA / public domain).
 *     See per-class `licences` + `artists` fields in banglaveg-refs.json.
 *   - Modifications: resized to ≤384 px thumbnail, embedded as base64 for offline
 *     comparison only; no changes to image content.
 */

import refs from "../data/banglaveg-refs.json";
import { BANGLABEG_VOCAB, mapToBanglaVeg, type BanglaVegClass } from "./banglaveg";

type RefEntry = {
  canonical: string;
  ok?: boolean;
  /** @deprecated single-image format from v1 — kept for back-compat reads. */
  dataUrl?: string | null;
  /** v2/v3 format — array of base64 data URLs (thumbnails). */
  dataUrls?: string[] | null;
  tooBig?: boolean;
  licences?: string[];
  artists?: string[];
  titles?: string[];
  searchQueries?: string[];
  // v1 fields
  licence?: string;
  artist?: string;
  title?: string;
  searchQuery?: string;
};

const FINGERPRINT_SIZE = 32; // matches GRAY_SIZE in foodClassifier.ts
const HIST_BINS = 16;

function urlsForEntry(entry: RefEntry): string[] {
  if (Array.isArray(entry.dataUrls) && entry.dataUrls.length) return entry.dataUrls;
  if (entry.dataUrl) return [entry.dataUrl];
  return [];
}

/** Compute the same 1072-dim fingerprint as foodClassifier's fallback path. */
async function computeFingerprint(src: string): Promise<number[] | null> {
  try {
    const blob = await (await fetch(src)).blob();
    const bitmap = await createImageBitmap(blob);
    const W = FINGERPRINT_SIZE;
    const H = FINGERPRINT_SIZE;
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(W, H);
    } else {
      canvas = document.createElement("canvas");
      (canvas as HTMLCanvasElement).width = W;
      (canvas as HTMLCanvasElement).height = H;
    }
    const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d");
    if (!ctx) return null;
    (ctx as CanvasRenderingContext2D).drawImage(bitmap as unknown as CanvasImageSource, 0, 0, W, H);
    const data = (ctx as CanvasRenderingContext2D).getImageData(0, 0, W, H).data;
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
  } catch {
    return null;
  }
}

type IndexedRef = {
  fingerprint: number[];
  meta: { licence?: string; artist?: string; title?: string; searchQuery?: string };
};
type IndexedClass = {
  cls: BanglaVegClass;
  refs: IndexedRef[];
};

let cachedIndex: Map<string, IndexedClass> | null = null;
let indexPromise: Promise<Map<string, IndexedClass>> | null = null;

async function loadIndex(): Promise<Map<string, IndexedClass>> {
  if (cachedIndex) return cachedIndex;
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    const idx = new Map<string, IndexedClass>();
    const entries = (refs as { classes: RefEntry[] }).classes ?? [];
    for (const entry of entries) {
      if (!entry?.ok) continue;
      const cls = BANGLABEG_VOCAB.find((c) => c.canonical === entry.canonical);
      if (!cls) continue;
      const urls = urlsForEntry(entry);
      if (!urls.length) continue;

      const refsList: IndexedRef[] = [];
      const titles = entry.titles ?? (entry.title ? [entry.title] : []);
      const licences = entry.licences ?? (entry.licence ? [entry.licence] : []);
      const artists = entry.artists ?? (entry.artist ? [entry.artist] : []);
      const queries = entry.searchQueries ?? (entry.searchQuery ? [entry.searchQuery] : []);

      for (let i = 0; i < urls.length; i++) {
        const fp = await computeFingerprint(urls[i]);
        if (!fp) continue;
        refsList.push({
          fingerprint: fp,
          meta: {
            licence: licences[i],
            artist: artists[i],
            title: titles[i],
            searchQuery: queries[i],
          },
        });
      }
      if (refsList.length > 0) idx.set(cls.canonical, { cls, refs: refsList });
    }
    cachedIndex = idx;
    return idx;
  })();
  return indexPromise;
}

/** Cosine similarity → 0..1. */
function similarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const cos = dot / Math.sqrt(na * nb);
  return Math.max(0, (cos + 1) / 2);
}

/** Aggregate per-class fingerprint similarity: take top-3 best matches and
 *  combine with diminishing weight so multiple mediocre matches beat one
 *  perfect-but-flimsy match. */
function aggregateSimilarity(classRefs: IndexedRef[], target: number[]): number {
  const sims = classRefs
    .map((r) => similarity(target, r.fingerprint))
    .sort((a, b) => b - a)
    .slice(0, 3);
  if (sims.length === 0) return 0;
  // Weighted: best=1.0, 2nd=0.55, 3rd=0.30. Normalise over max possible ≈1.85.
  const w = [1.0, 0.55, 0.3];
  let sum = 0;
  let wsum = 0;
  for (let i = 0; i < sims.length; i++) {
    sum += sims[i] * w[i];
    wsum += w[i];
  }
  return Math.min(0.99, sum / wsum);
}

export type BanglaVegMatch = {
  cls: BanglaVegClass;
  confidence: number;
  meta: { licence?: string; artist?: string; title?: string };
};

/** Find the closest BanglaVeg classes by visual fingerprint. */
export async function findBestBanglaVegMatch(
  fingerprint: number[],
  topN = 5,
  minConfidence = 0.45,
): Promise<BanglaVegMatch[]> {
  if (!fingerprint?.length) return [];
  const idx = await loadIndex();
  if (idx.size === 0) return [];
  const scored: BanglaVegMatch[] = [];
  for (const [, indexed] of idx) {
    const conf = aggregateSimilarity(indexed.refs, fingerprint);
    if (conf >= minConfidence) {
      const best = indexed.refs[0];
      scored.push({
        cls: indexed.cls,
        confidence: conf,
        meta: best?.meta ?? {},
      });
    }
  }
  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, topN);
}

/** Attribution block from the bundle (for the trainer UI). */
export function banglaVegAttribution(): string[] {
  return (refs as { attribution: string[] }).attribution ?? [];
}

/** Stats on how many classes + images are loaded in the index. */
export function banglaVegIndexedCount(): { indexed: number; total: number; images: number } {
  const all = (refs as { classes: RefEntry[] }).classes ?? [];
  let images = 0;
  let indexed = 0;
  for (const c of all) {
    if (!c?.ok) continue;
    const u = urlsForEntry(c);
    if (u.length > 0) {
      indexed += 1;
      images += u.length;
    }
  }
  return { indexed, total: all.length, images };
}

/** Helper: try to map any string label back to a BanglaVeg canonical. */
export { mapToBanglaVeg };
