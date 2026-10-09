/**
 * Food trainer — active learning for the photo recognition.
 *
 * Each photo is reduced to a 1072-dim visual fingerprint (32×32 grayscale
 * + 48-bin RGB histogram) by foodClassifier.ts. We save (fingerprint,
 * label) pairs the user supplies. At classification time we cosine-search
 * the user's training examples and prefer any that are highly similar
 * to the new image — the model effectively learns what a tomato looks
 * like in the user's own kitchen.
 *
 * Storage: localStorage. Bounded count to avoid blowing the quota.
 */

export interface TrainingExample {
  id: string;
  /** User-confirmed label, e.g. "Tomato". */
  label: string;
  /** Visual fingerprint (1072 dims). */
  embedding: number[];
  /** Source of this example. */
  source: 'manual' | 'corrected-prediction';
  /** When the example was saved. */
  createdAt: number;
}

const STORAGE_KEY = 'homehub.foodTraining.v1';
/** Hard cap on stored examples — each fingerprint is ~7 KB JSON. */
const MAX_EXAMPLES = 300;

function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadTrainingExamples(): TrainingExample[] {
  const s = safeStorage();
  if (!s) return [];
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrainingExample[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveTrainingExample(
  embedding: number[],
  label: string,
  source: TrainingExample['source'] = 'manual',
): TrainingExample | null {
  const s = safeStorage();
  if (!s) return null;
  const examples = loadTrainingExamples();
  // Trim to cap (drop oldest first).
  const trimmed = examples.slice(-(MAX_EXAMPLES - 1));
  const ex: TrainingExample = {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: label.trim(),
    embedding,
    source,
    createdAt: Date.now(),
  };
  trimmed.push(ex);
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    return ex;
  } catch {
    // Quota exceeded — drop the oldest half and try again.
    const halved = trimmed.slice(-Math.floor(MAX_EXAMPLES / 2));
    halved.push(ex);
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(halved));
      return ex;
    } catch {
      return null;
    }
  }
}

/** Remove all training data. */
export function clearTrainingExamples(): void {
  const s = safeStorage();
  if (!s) return;
  s.removeItem(STORAGE_KEY);
}

/** Count training examples per label. */
export function countByLabel(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ex of loadTrainingExamples()) {
    out[ex.label] = (out[ex.label] ?? 0) + 1;
  }
  return out;
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export interface MatchResult {
  label: string;
  similarity: number;
  /** How many training examples we have for this label. */
  count: number;
}

/**
 * Search all training examples. Returns the best match per label,
 * sorted by similarity desc. Only includes matches above `threshold`.
 */
export function findSimilarTrainingExamples(
  embedding: number[],
  threshold = 0.78,
): MatchResult[] {
  const examples = loadTrainingExamples();
  const perLabel = new Map<string, { similarity: number; count: number }>();
  for (const ex of examples) {
    const sim = cosineSimilarity(embedding, ex.embedding);
    const cur = perLabel.get(ex.label);
    if (!cur) {
      perLabel.set(ex.label, { similarity: sim, count: 1 });
    } else {
      // Existing label: always bump count, only update similarity if this
      // example is a better match. (Previously the count was reset to 0
      // every time we set a new best similarity, so it always ended up at 1
      // instead of the real number of training examples for that label.)
      cur.count += 1;
      if (sim > cur.similarity) cur.similarity = sim;
    }
  }
  const out: MatchResult[] = [];
  for (const [label, v] of perLabel.entries()) {
    if (v.similarity >= threshold) {
      out.push({ label, similarity: v.similarity, count: v.count });
    }
  }
  out.sort((a, b) => b.similarity - a.similarity);
  return out;
}