/**
 * A small taste model that actually LEARNS the user's preferences.
 *
 * The earlier "accuracy" number was a fixed blend of hand-picked weights. This
 * replaces the taste half of it with a real trained model:
 *
 *   - Features: the same 384-dim MiniLM recipe embeddings Discover already
 *     ships, plus two kitchen signals (how much of the dish you already have,
 *     and whether the dish suits the meal it's planned into).
 *   - Label: whether the user said they ENJOYED the meal. Cooking a dish says
 *     nothing about liking it, so without that verdict there is nothing to
 *     learn from — hence `liked` on MealLog.
 *   - Model: PCA-reduced, L2-regularised logistic regression, trained here in
 *     the browser with gradient descent.
 *
 * Why this shape and not something fancier: one household produces tens of
 * ratings, not thousands. The dominant failure mode at that sample size isn't
 * underfitting, it's a model that memorises every rating and then confidently
 * predicts nonsense about every dish it has never seen. PCA projection is what
 * prevents that — the model can only speak about a handful of directions, so
 * it has to generalise or it can't score at all.
 */

import type { MealLog } from '../types';

export interface TasteModelSample {
  /** Feature vector. All samples must share a length. */
  x: number[];
  /** 1 = enjoyed, 0 = didn't. */
  y: number;
}

export interface TrainedTasteModel {
  /** Weight per reduced feature, plus a bias at the end. */
  w: number[];
  /** Number of reduced features (w.length - 1). */
  dim: number;
  /** Feature-space mean, needed to reproduce the PCA projection. */
  mean: number[];
  /** Principal directions, each of length = original feature count. */
  components: number[][];
  /** Base rate of "liked" in the training data — predictions shrink to this. */
  prior: number;
  /** How many ratings it was trained on. */
  samples: number;
  /** Fraction of training ratings predicted correctly (in-sample). */
  trainAccuracy: number;
  /**
   * How much to trust this model's opinion, 0..1. Deliberately conservative:
   * with a handful of ratings the model is barely better than the prior, and
   * callers blend rather than replace.
   */
  confidence: number;
}

/** Below this, the model isn't worth training at all. */
export const MIN_SAMPLES = 6;

const L2 = 0.02;
const LEARNING_RATE = 0.5;
const EPOCHS = 800;

/**
 * How many principal components to keep — at most a third of the sample
 * count. This cap is the single most important number in the file.
 */
const MAX_COMPONENTS = 12;
function componentCount(n: number): number {
  return Math.max(1, Math.min(MAX_COMPONENTS, Math.floor(n / 3)));
}

/** Dot product, tolerating length mismatch by using the shorter vector. */
function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Mean-centre, then keep the top principal directions via power iteration. */
function projectPCA(samples: TasteModelSample[], k: number): {
  mean: number[];
  components: number[][];
  reduced: number[][];
} {
  const dim = samples[0].x.length;
  const mean = new Array(dim).fill(0);
  for (const s of samples) for (let i = 0; i < dim; i++) mean[i] += s.x[i] / samples.length;

  if (k >= dim) {
    return { mean, components: [], reduced: samples.map((s) => [...s.x]) };
  }

  let residual = samples.map((s) => s.x.map((v, i) => v - mean[i]));
  const components: number[][] = [];

  for (let c = 0; c < k; c++) {
    // Power iteration from a deterministic seed, so the same ratings always
    // produce the same model.
    let v = new Array(dim).fill(0).map((_, i) => Math.sin(i + c + 1));
    let norm = Math.sqrt(dot(v, v));
    if (norm < 1e-12) break;
    v = v.map((x) => x / norm);

    for (let iter = 0; iter < 40; iter++) {
      const next = new Array(dim).fill(0);
      for (const r of residual) {
        const p = dot(v, r);
        for (let i = 0; i < dim; i++) next[i] += p * r[i];
      }
      const n2 = Math.sqrt(dot(next, next));
      if (n2 < 1e-9) break;
      v = next.map((x) => x / n2);
    }
    if (Math.sqrt(dot(v, v)) < 1e-9) break;
    components.push(v);

    // Deflate so the next component finds a genuinely different direction.
    residual = residual.map((r) => {
      const p = dot(v, r);
      return r.map((x, i) => x - p * v[i]);
    });
  }

  const reduced = samples.map((s) => components.map((c) => dot(c, s.x)));
  return { mean, components, reduced };
}

/** Apply a trained model's PCA transform to one raw feature vector. */
function reduce(model: TrainedTasteModel, x: number[]): number[] {
  if (model.components.length === 0) return [...x];
  return model.components.map((c) => dot(c, x));
}

export interface TrainOptions {
  /** Defaults to the observed positive rate. */
  positiveRate?: number;
}

/**
 * Fit the model. Returns null when there isn't enough data, when every rating
 * is the same (nothing to separate), or on malformed input.
 */
export function trainTasteModel(
  samples: TasteModelSample[],
  opts: TrainOptions = {},
): TrainedTasteModel | null {
  if (samples.length < MIN_SAMPLES) return null;

  const ys = samples.map((s) => s.y);
  const positives = ys.reduce((a, y) => a + y, 0);
  // All liked or all disliked: the model can't tell those apart, and pretending
  // otherwise is exactly the confident-nonsense case we're avoiding.
  if (positives === 0 || positives === ys.length) return null;

  const dim = samples[0].x.length;
  if (!Number.isFinite(dim) || dim === 0) return null;
  for (const s of samples) {
    if (s.x.length !== dim) return null;
    if (!Number.isFinite(s.x[0])) return null;
  }

  const n = samples.length;
  const prior = opts.positiveRate ?? positives / n;
  const bias = Math.log(prior / (1 - prior));

  const { mean, components, reduced } = projectPCA(samples, componentCount(n));
  const rdim = reduced[0].length;

  const w = new Array(rdim + 1).fill(0);
  w[rdim] = bias;

  const grad = new Array(rdim + 1).fill(0);
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    grad.fill(0);
    for (let i = 0; i < reduced.length; i++) {
      const r = reduced[i];
      let z = w[rdim];
      for (let j = 0; j < rdim; j++) z += w[j] * r[j];
      const err = sigmoid(z) - ys[i];
      for (let j = 0; j < rdim; j++) grad[j] += err * r[j];
      grad[rdim] += err;
    }
    for (let i = 0; i < rdim; i++) {
      // L2 on the weights only — never on the bias, or the base rate gets
      // dragged toward zero and every prediction becomes a coin flip.
      w[i] -= LEARNING_RATE * (grad[i] / n + L2 * w[i]);
    }
    w[rdim] -= LEARNING_RATE * (grad[rdim] / n);
  }

  const model: TrainedTasteModel = {
    w,
    dim: rdim,
    mean,
    components,
    prior,
    samples: n,
    trainAccuracy: 0,
    confidence: Math.min(0.9, (n - MIN_SAMPLES + 1) / (n + 8)),
  };

  let correct = 0;
  for (let i = 0; i < samples.length; i++) {
    // Score against the RAW features — predict() re-applies the model's own
    // PCA transform, so feeding it reduced features would double-project.
    const p = predict(model, samples[i].x);
    if ((p >= 0.5 ? 1 : 0) === ys[i]) correct++;
  }
  model.trainAccuracy = correct / n;

  return model;
}

/**
 * P(liked) for one raw feature vector, 0..1 — SHRUNK toward the base rate.
 *
 * The raw logistic output is deliberately NOT returned. With a dozen ratings
 * the fit saturates at 0 and 1 while being no better than a coin flip, which
 * would hand the caller false certainty. Shrinking by the model's own
 * confidence means "no signal" reliably produces "an answer near the base
 * rate" instead of a confident 0 or 100.
 */
export function predict(model: TrainedTasteModel, x: number[]): number {
  const r = reduce(model, x);
  const n = Math.min(model.dim, r.length);
  let z = model.w[model.dim];
  for (let i = 0; i < n; i++) z += model.w[i] * r[i];
  const raw = Math.min(1, Math.max(0, sigmoid(z)));
  return Math.min(1, Math.max(0, model.prior + model.confidence * (raw - model.prior)));
}

/**
 * Build a training set from the user's rated meals.
 *
 * Only logs that BOTH carry a recipe we have an embedding for AND an explicit
 * liked/not-liked verdict are used. Free-text and unrated meals teach the model
 * nothing about preference, so they are excluded rather than guessed at.
 */
export function samplesFromLogs(
  logs: MealLog[],
  embeddings: Map<string, number[]> | null,
  /** Extra per-dish features appended after the embedding. */
  extras?: (recipeId: string) => number[] | null,
): TasteModelSample[] {
  if (!embeddings) return [];
  const out: TasteModelSample[] = [];
  for (const log of logs) {
    if (typeof log.liked !== 'boolean') continue;
    if (!log.recipeId) continue;
    const emb = embeddings.get(log.recipeId);
    if (!emb || !emb.length) continue;
    const extra = extras?.(log.recipeId) ?? [];
    out.push({ x: [...emb, ...extra], y: log.liked ? 1 : 0 });
  }
  return out;
}