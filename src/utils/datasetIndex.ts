/**
 * Vegetable Image Dataset (Misrak Ahmed et al. 2021) reference index.
 *
 * 15 South-Asian-relevant classes × ~30 reference images each, sourced from
 * the kaggle-mirrored HuggingFace dataset `cc92yy3344/vegetable`.
 * All images are 224×224 JPEG thumbnails, embedded as base64 in the bundle
 * to keep everything offline.
 *
 * On the first photo classification:
 *   - Decode each reference image.
 *   - Compute the same 1072-dim fingerprint that foodClassifier uses for
 *     user-trained kNN.
 *   - Compare against incoming photo fingerprints via cosine similarity.
 *
 * The recognition tier is registered in foodClassifier.ts as
 * source='dataset'. AddStockModal badge: "🌿 21k dataset".
 *
 * Attribution / licence:
 *   - Misrak Ahmed et al., "Vegetable Image Dataset" (2021).
 *   - 21,000 images across 15 classes, CC BY-SA 4.0.
 *   - HF mirror: https://huggingface.co/datasets/cc92yy3344/vegetable
 *   - Modifications: resized to 224×224, subset (≤30 per class),
 *     embedded as base64 data URLs for offline comparison.
 */

import refs from "../data/dataset-refs.json";
import { BANGLABEG_VOCAB, mapToBanglaVeg, type BanglaVegClass } from "./banglaveg";

type DatasetEntry = {
  canonical: string;
  folder: string;
  images: Array<{ path: string; dataUrl: string }>;
};

type DatasetBundle = {
  version: number;
  source: string;
  sourceUrl: string;
  license: string;
  citation: string;
  perClassLimit: number;
  classes: DatasetEntry[];
  attribution?: string[];
};

const FINGERPRINT_SIZE = 32;
const HIST_BINS = 16;

/** Same fingerprint math as foodClassifier — keep in lockstep. */
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
    const gray: number[] = new Array(W * H);
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

type IndexedClass = {
  cls: BanglaVegClass;
  fingerprints: number[][]; // multiple reference fingerprints per class
};

let cachedIndex: Map<string, IndexedClass> | null = null;
let indexPromise: Promise<Map<string, IndexedClass>> | null = null;

/** Counter-stable dataset vegetables; everything else defaults to the fridge. */
const COUNTER_STORED = new Set(['potato', 'onion', 'ginger', 'garlic']);

/**
 * Build a minimal vocabulary class from a dataset class name, so a class with
 * no exact or fuzzy vocabulary match is still indexed under its own name
 * instead of being dropped. Only the fields the UI actually reads are
 * meaningful; the rest are honest placeholders.
 */
function synthClass(label: string): BanglaVegClass | null {
  const name = label.trim();
  if (!name) return null;
  return {
    canonical: name,
    english: [name],
    hindi: [name],
    scientific: '',
    category: 'vegetable',
    storage: COUNTER_STORED.has(name.toLowerCase()) ? 'counter' : 'fridge',
  };
}

async function loadIndex(): Promise<Map<string, IndexedClass>> {
  if (cachedIndex) return cachedIndex;
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    const idx = new Map<string, IndexedClass>();
    const bundle = refs as DatasetBundle;
    for (const entry of bundle.classes ?? []) {
      if (!entry?.images?.length) continue;
      // Dataset class names are underscored folder names ("Bitter_Gourd")
      // while the vocabulary uses South-Asian names ("Karela"), so an exact
      // canonical match silently dropped 4 of 15 classes and wasted their
      // reference images. Normalise, then fall back to the fuzzy mapper,
      // which already understands english/hindi/scientific aliases.
      const label = String(entry.canonical).replace(/_/g, ' ');
      const cls =
        BANGLABEG_VOCAB.find((c) => c.canonical === entry.canonical) ??
        mapToBanglaVeg(label) ??
        // Last resort: synthesise a class under the dataset's own name rather
        // than dropping the class. The fuzzy mapper refuses genuinely generic
        // words ("Bean" is a substring of Jicama's "Yam Bean"), and dropping it
        // here would put us back to 14/15 with the reference images wasted.
        synthClass(label);
      if (!cls) continue;
      const fps: number[][] = [];
      for (const img of entry.images) {
        const fp = await computeFingerprint(img.dataUrl);
        if (fp) fps.push(fp);
      }
      if (fps.length === 0) continue;
      idx.set(entry.canonical, { cls, fingerprints: fps });
    }
    cachedIndex = idx;
    return idx;
  })();
  return indexPromise;
}

/** Cosine similarity → 0..1. */
function sim(a: number[], b: number[]): number {
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

/** Aggregate: top-3 matches within a class, weighted (1.0, 0.55, 0.30). */
function aggregateScore(fps: number[][], target: number[]): number {
  if (!fps.length) return 0;
  const sorted = fps.map((fp) => sim(fp, target)).sort((a, b) => b - a).slice(0, 3);
  if (sorted.length === 0) return 0;
  const w = [1.0, 0.55, 0.3];
  let num = 0;
  let den = 0;
  for (let i = 0; i < sorted.length; i++) {
    num += sorted[i] * w[i];
    den += w[i];
  }
  return Math.min(0.99, num / den);
}

export type DatasetMatch = {
  cls: BanglaVegClass;
  confidence: number;
  /** How many reference images contributed to the match. */
  refCount: number;
};

/** Find the closest vegetable classes by visual fingerprint. */
export async function findBestDatasetMatch(
  fingerprint: number[],
  topN = 5,
  minConfidence = 0.5,
): Promise<DatasetMatch[]> {
  if (!fingerprint?.length) return [];
  const idx = await loadIndex();
  if (idx.size === 0) return [];
  const scored: DatasetMatch[] = [];
  for (const [, indexed] of idx) {
    const conf = aggregateScore(indexed.fingerprints, fingerprint);
    if (conf >= minConfidence) {
      scored.push({ cls: indexed.cls, confidence: conf, refCount: indexed.fingerprints.length });
    }
  }
  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, topN);
}

/** Counts / telemetry for the trainer UI. */
export function datasetStats(): {
  classes: number;
  totalImages: number;
  perClass: Record<string, number>;
  attribution: string[];
} {
  const bundle = refs as DatasetBundle;
  const perClass: Record<string, number> = {};
  let totalImages = 0;
  for (const c of bundle.classes ?? []) {
    const n = c.images?.length ?? 0;
    perClass[c.canonical] = n;
    totalImages += n;
  }
  return {
    classes: bundle.classes?.length ?? 0,
    totalImages,
    perClass,
    attribution: [
      `Source: ${bundle.source}`,
      `Mirror: ${bundle.sourceUrl}`,
      `License: ${bundle.license}`,
      bundle.citation,
      "Up to " + bundle.perClassLimit + " reference images per class × " + (bundle.classes?.length ?? 0) + " classes — embedded for offline comparison only.",
    ],
  };
}

export { mapToBanglaVeg };
