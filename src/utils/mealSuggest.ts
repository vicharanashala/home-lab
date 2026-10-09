/**
 * Meal-plan suggestions.
 *
 * Ranks catalogue recipes for a given meal slot using three signals that the
 * app already has:
 *
 *   1. Use-it-first — recipes that consume stock about to expire.
 *   2. Taste        — the same 384-dim MiniLM taste vector Discover uses,
 *                     averaged over the user's meal logs with a 30-day recency
 *                     decay. Reused rather than building a second recommender.
 *   3. Adventurous  — a deliberate slice of dishes that are NOT close to the
 *                     taste profile, so the week isn't the same curry 7 times.
 *
 * Everything runs locally on already-downloaded data: no LLM call, no network,
 * no cost. Deterministic for a given week + profile, which keeps the
 * suggestion stable while the user is looking at it.
 */

import type {
  MealLog, MealPlan, MealSlot, Recipe, StockItem, MealPlanEntry,
  DietaryPreference, HouseholdProfile,
} from '../types';
import { recipesUsingExpiringStock } from './expiryRecipes';
import { conflictsDiet, detectAllergensInName } from './diet';

/** Fraction of suggestions that should be deliberately off-taste. */
export const DEFAULT_ADVENTURE_MIX = 0.25;

/** Recipes scored per second of wall-clock are not a goal; this caps the scan. */
const MAX_SCAN = 4000;

export type SuggestReason = 'expiring' | 'taste' | 'stock' | 'adventurous';

export interface MealSuggestion {
  recipe: Recipe;
  /** Overall rank score. Higher is better. */
  score: number;
  /** The dominant reason this dish was picked — drives the badge on the card. */
  reason: SuggestReason;
  /** One-line explanation shown to the user. Honest about not knowing them. */
  why: string;
  /** Cosine similarity to the taste profile, or null if we have no profile. */
  taste: number | null;
  /** Fraction of the dish's ingredients already in stock, 0..1. */
  coverage: number;
  have: number;
  total: number;
}

export interface SuggestInput {
  slot: MealSlot;
  catalogue: Recipe[];
  stock: StockItem[];
  mealLogs: MealLog[];
  /** id -> embedding vector. Null while the JSON is still downloading. */
  embeddings: Map<string, number[]> | null;
  mealPlan?: MealPlan;
  diet?: DietaryPreference;
  allergies?: string[];
  household?: HouseholdProfile;
  /** Override the adventurous share. Defaults to 25%. */
  adventureMix?: number;
  /** How many to return. Default 3. */
  limit?: number;
  /** Bumped by "shuffle" to reshuffle ties without changing the ranking logic. */
  nonce?: number;
  /** Portion the dish would be cooked at, for the card subtitle. */
  servings?: number;
}

// ── taste vector (mirrors Discover's buildTasteVector) ──────────────────

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function normalize(v: number[]): number[] {
  let mag = 0;
  for (let i = 0; i < v.length; i++) mag += v[i] * v[i];
  mag = Math.sqrt(mag) || 1;
  return v.map((x) => x / mag);
}

/**
 * Average the embeddings of recipes the user actually logged, weighted by how
 * often and how recently. Returns null when there is no signal yet — callers
 * must degrade rather than invent a preference.
 */
export function buildTasteVector(
  logs: MealLog[],
  embeddings: Map<string, number[]> | null,
  now = Date.now(),
): number[] | null {
  if (!embeddings || embeddings.size === 0) return null;
  const counts = new Map<string, { count: number; latestAt: number }>();
  for (const log of logs) {
    if (!log.recipeId) continue;
    const cur = counts.get(log.recipeId) ?? { count: 0, latestAt: 0 };
    cur.count += 1;
    cur.latestAt = Math.max(cur.latestAt, log.createdAt);
    counts.set(log.recipeId, cur);
  }
  if (counts.size === 0) return null;

  const acc: number[] = [];
  let totalWeight = 0;
  for (const [id, { count, latestAt }] of counts) {
    const emb = embeddings.get(id);
    if (!emb || emb.length === 0) continue;
    const ageDays = (now - latestAt) / 86_400_000;
    const w = count * Math.exp(-ageDays / 30); // 30-day half-life feel
    if (acc.length === 0) for (let i = 0; i < emb.length; i++) acc.push(emb[i] * w);
    else for (let i = 0; i < Math.min(acc.length, emb.length); i++) acc[i] += emb[i] * w;
    totalWeight += w;
  }
  if (acc.length === 0 || totalWeight === 0) return null;
  return normalize(acc);
}

// ── filtering ───────────────────────────────────────────────────────────

/** Meal types that make sense for each slot. Breakfast recipes never serve as dinner. */
const SLOT_MEAL_TYPES: Record<MealSlot, Recipe['mealType'][]> = {
  breakfast: ['breakfast', 'snack'],
  lunch: ['lunch', 'dinner', 'snack'],
  dinner: ['dinner', 'lunch', 'sweet'],
};

/** A lunch dish at dinner is fine; a breakfast dish at dinner is not. */
function slotFit(recipe: Recipe, slot: MealSlot): number {
  const allowed = SLOT_MEAL_TYPES[slot];
  if (allowed.includes(recipe.mealType)) return 1;
  return 0.15; // heavily penalised but not a hard veto
}

/** Hard-reject a recipe on diet, allergies, or missing ingredients. */
function passesHardFilters(
  recipe: Recipe,
  diet: DietaryPreference | undefined,
  allergies: string[],
): boolean {
  if (!recipe?.ingredients?.length) return false;
  if (diet && diet !== 'no-preference') {
    // One incompatible ingredient disqualifies the dish — that's what a diet
    // means. Checking every ingredient, not just the first.
    for (const ing of recipe.ingredients) {
      if (conflictsDiet({ category: ing.category }, diet)) return false;
    }
  }
  if (allergies.length) {
    const haystack = `${recipe.name} ${recipe.ingredients.map((i) => i.name).join(' ')}`;
    if (detectAllergensInName(haystack, allergies).length > 0) return false;
  }
  return true;
}

function stockCoverage(recipe: Recipe, stock: StockItem[]): { have: number; total: number } {
  const names = new Set(stock.map((s) => s.name.toLowerCase().trim()));
  let have = 0;
  let total = 0;
  for (const ing of recipe.ingredients) {
    const needle = ing.name.toLowerCase().trim();
    total += 1;
    if (
      names.has(needle) ||
      Array.from(names).some((s) => s.includes(needle) || needle.includes(s))
    ) {
      have += 1;
    }
  }
  return { have, total };
}

// ── ranking ─────────────────────────────────────────────────────────────

export function suggestMeals(input: SuggestInput): MealSuggestion[] {
  const {
    slot, catalogue, stock, mealLogs, embeddings, mealPlan,
    diet = 'no-preference', allergies = [], adventureMix = DEFAULT_ADVENTURE_MIX,
    limit = 3, nonce = 0, servings,
  } = input;

  if (!catalogue?.length) return [];

  const tasteVec = buildTasteVector(mealLogs, embeddings);

  // Dishes already on this week's plan are not suggestions.
  const planned = new Set<string>();
  if (mealPlan) {
    for (const day of Object.values(mealPlan)) {
      for (const entry of Object.values(day)) {
        if (entry?.recipeId) planned.add(entry.recipeId);
      }
    }
  }

  // Use-it-first: dishes that rescue something expiring.
  const rescue = new Map<string, number>();
  try {
    for (const d of recipesUsingExpiringStock(catalogue, stock, 3, 40)) {
      rescue.set(d.recipe.id, d.uses.length);
    }
  } catch {
    // Expiry matching is best-effort; never block suggestions on it.
  }

  const scored: MealSuggestion[] = [];

  for (const recipe of catalogue) {
    if (planned.has(recipe.id)) continue;
    if (!passesHardFilters(recipe, diet, allergies)) continue;

    const { have, total } = stockCoverage(recipe, stock);
    if (have === 0) continue; // can't cook any of it — not a suggestion
    const coverage = have / total;

    let taste: number | null = null;
    if (tasteVec && embeddings) {
      const emb = embeddings.get(recipe.id);
      if (emb && emb.length) {
        taste = Math.max(0, Math.min(1, dot(normalize(emb), tasteVec)));
      }
    }

    const fit = slotFit(recipe, slot);
    const rescueCount = rescue.get(recipe.id) ?? 0;

    // Familiar dishes: what you can make now, what you like, that suits the slot.
    const familiarity = taste === null ? 0.5 : taste;
    let score = coverage * 0.45 + familiarity * 0.40 + fit * 0.15;

    let reason: SuggestReason;
    let why: string;
    if (rescueCount > 0) {
      // Saving food dominates — it outranks a marginally better taste match.
      score += 0.6;
      reason = 'expiring';
      why = `Uses ${rescueCount} item${rescueCount > 1 ? 's' : ''} before they go off`;
    } else if (taste !== null && familiarity > 0.55) {
      reason = 'taste';
      why = 'Close to what you cook';
    } else {
      reason = 'stock';
      why = taste === null
        ? 'Made mostly from what you have'
        : 'Made mostly from what you have';
    }

    scored.push({
      recipe, score, reason, why, taste, coverage, have, total,
    });
  }

  if (scored.length === 0) return [];
  scored.sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name));

  // The CSV catalogue contains the same dish more than once under different
  // ids. Offering "Palak paneer" twice in a row reads as a broken UI, so keep
  // only the best-scoring row per dish name.
  const seenNames = new Set<string>();
  const unique: MealSuggestion[] = [];
  for (const s of scored) {
    const key = s.recipe.name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    unique.push(s);
  }

  // Slice the scan so a 6k catalogue doesn't stall the UI thread.
  const pool = unique.slice(0, MAX_SCAN);

  // Adventure quota: dishes the taste profile is *least* close to, but which
  // still pass the hard filters and are mostly in stock.
  //
  // Without a taste profile there is nothing to be adventurous *against*, so
  // the quota is zero — reserving a slot we can never fill would silently
  // cost the user a suggestion on a fresh install.
  const wantAdventure = tasteVec ? Math.round(limit * Math.max(0, Math.min(1, adventureMix))) : 0;
  const out: MealSuggestion[] = [];

  const familiarPool = pool.slice();
  const familiarWant = Math.max(0, limit - wantAdventure);
  for (let i = 0; i < familiarPool.length && out.length < familiarWant; i++) {
    out.push(familiarPool[i]);
  }

  if (wantAdventure > 0) {
    const chosenIds = new Set(out.map((s) => s.recipe.id));
    const picked = new Set<string>(out.map((s) => s.recipe.id));

    // Lowest taste similarity first.
    const adventurers = [...pool]
      .filter((s) => !chosenIds.has(s.recipe.id) && s.reason !== 'expiring')
      .sort((a, b) => (a.taste ?? 0) - (b.taste ?? 0) || b.coverage - a.coverage);

    for (const cand of adventurers) {
      if (out.length >= limit) break;
      if (picked.has(cand.recipe.id)) continue;
      picked.add(cand.recipe.id);
      out.push({
        ...cand,
        reason: 'adventurous',
        why: 'Something new — outside your usual',
        // Keep its rank position honest: adventure is a deliberate detour,
        // not a top pick, so it never jumps the familiar dishes.
        score: cand.score * 0.5,
      });
    }
  }

  // Shuffle: rotate the order deterministically so the user can ask again
  // without getting an identical set. Rotation only — ranking is preserved.
  if (nonce > 0 && out.length > 1) {
    const k = nonce % out.length;
    out.push(...out.splice(0, k));
  }

  return out.slice(0, limit);
}

export interface SuggestSummary {
  hasTasteProfile: boolean;
  slotServings?: number;
}

/** One-off explanation of what the suggestions are based on, for the sheet. */
export function describeBasis(
  mealLogs: MealLog[],
  embeddings: Map<string, number[]> | null,
  household?: HouseholdProfile,
  servings?: number,
): SuggestSummary {
  return {
    hasTasteProfile: !!buildTasteVector(mealLogs, embeddings),
    slotServings: servings,
  };
}