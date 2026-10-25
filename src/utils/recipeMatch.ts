import type { Recipe, StockItem, RecipeIngredient } from '../types';
import {
  convertBase,
  convertScoop,
  formatInUnit,
  subtractBase,
  toBaseUnit,
  type UnitDimension,
} from './units';

export interface DeductionResult {
  ingredient: RecipeIngredient;
  stockItem: StockItem;
  /**
   * Amount taken from the stock, in the STOCK ITEM'S OWN base unit.
   *
   * WHY THE STOCK'S AND NOT THE RECIPE'S: this number is subtracted from the
   * stock row and the result is written back onto it, and a row is held in
   * the unit the user measured it in. A deduction in another dimension
   * cannot be subtracted from it — 100 grams is not 100 millilitres, and
   * subtracting one from the other gives a number that is not a quantity of
   * anything.
   */
  deductedBase: number;
  /** What is left of the stock row, in the same base unit as `deductedBase`. */
  remainingBase: number;
  /** Human-readable summary of what was deducted, in the row's own unit. */
  deductedLabel: string;
  /**
   * All stock items that could plausibly match this ingredient, ranked by score.
   * When length > 1, the UI should let the user pick which one to deduct from.
   */
  candidates: StockItem[];
}

export interface SkippedIngredient {
  ingredient: RecipeIngredient;
  reason: 'not-in-stock' | 'unit-mismatch';
  /**
   * Stock items that name-matched but were rejected (e.g. unit mismatch).
   * Surfaced to the UI so the user can see what was found.
   */
  candidates: StockItem[];
}

/**
 * Normalize a name for fuzzy comparison: lowercase, trim, strip punctuation,
 * collapse whitespace. Common alternative names are also mapped.
 */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Small alias table for very common cross-name matches.
const NAME_ALIASES: Record<string, string> = {
  palak: 'spinach',
};

function alias(s: string): string {
  return NAME_ALIASES[s] ?? s;
}

/** Is `a` a plural form of `b` or vice versa? Handles English +s / +es. */
function isPluralPair(a: string, b: string): boolean {
  if (a === b) return true;
  // apples ↔ apple, tomatoes ↔ tomato
  if (a + 's' === b || b + 's' === a) return true;
  if (a + 'es' === b || b + 'es' === a) return true;
  return false;
}

interface Candidate {
  item: StockItem;
  /** Higher = better match. */
  score: number;
}

/**
 * Score a single stock candidate against an ingredient.
 * Returns null if it doesn't match.
 *
 * Matching rules (deliberately strict so we don't wrongly deduct from
 * unrelated items like "Aloo gobi" when the recipe just needs "Aloo"):
 *   • exact (normalized + aliased) match         → 1000
 *   • simple plural pair ("tomato" ↔ "tomatoes") → 500
 * Substring matching is intentionally NOT used — it caused false positives.
 */
function scoreCandidate(needle: string, hay: string): number | null {
  if (needle === hay) return 1000;
  if (isPluralPair(needle, hay)) return 500;
  return null;
}

/**
 * Find ALL stock items that could match this ingredient, sorted best first.
 * Use this when you want to let the user pick the right one.
 */
export function findCandidatesForIngredient(
  ingredient: RecipeIngredient,
  stock: StockItem[],
): StockItem[] {
  const needle = alias(normalize(ingredient.name));
  if (!needle) return [];

  const out: Candidate[] = [];
  for (const it of stock) {
    const hay = alias(normalize(it.name));
    if (!hay) continue;
    const base = scoreCandidate(needle, hay);
    if (base === null) continue;
    // Same-priority tiebreaker: prefer length-closest.
    const score = base - Math.abs(hay.length - needle.length);
    out.push({ item: it, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.map((c) => c.item);
}

/**
 * Find the best-matching stock item for an ingredient by name.
 * Returns the top-ranked candidate, or null if nothing matches.
 */
export function findMatchingStockItem(
  ingredient: RecipeIngredient,
  stock: StockItem[],
): StockItem | null {
  const all = findCandidatesForIngredient(ingredient, stock);
  return all[0] ?? null;
}

export interface RecipeDeductionPlan {
  recipe: Recipe;
  peopleCooked: number;
  /** Multiplier applied to each ingredient quantity. */
  multiplier: number;
  deductions: DeductionResult[];
  skipped: SkippedIngredient[];
}

/**
 * Put an ingredient amount and a stock amount into ONE shared dimension so
 * the two can be compared honestly.
 *
 * The conversion has to be symmetric: if the recipe measures in spoons
 * ("2 tbsp oil") we convert the ingredient, but if the STOCK is what we hold
 * in spoons, we must convert the stock instead. One-way conversion made
 * "2 cups of flour" deduct 1 cup and leave 1 — but "1 cup stock, 1 cup
 * recipe" left 240, because the ml value was written back onto a
 * scoop-denominated item untouched.
 *
 * Returns null when the two cannot be compared at all: an unknown unit, or
 * two genuinely different dimensions ("200 g" against "2 pcs") where no
 * density can bridge them. Callers must treat null as "skip this
 * ingredient" — comparing across dimensions is how a 200 g bag of flour got
 * deleted by a recipe that asked for one cup.
 */
export function resolveToCommonDimension(
  ingQuantity: number,
  ingUnit: string,
  ingName: string,
  stkQuantity: number,
  stkUnit: string,
): { ingValue: number; stkValue: number; dimension: UnitDimension } | null {
  const ingRaw = toBaseUnit(ingQuantity, ingUnit);
  const stkRaw = toBaseUnit(stkQuantity, stkUnit);
  if (!ingRaw || !stkRaw) return null;
  if (ingRaw.dimension === 'unknown' || stkRaw.dimension === 'unknown') return null;

  let ingDim: UnitDimension = ingRaw.dimension;
  let ingValue = ingRaw.value;
  let stkDim: UnitDimension = stkRaw.dimension;
  let stkValue = stkRaw.value;

  if (ingDim === 'scoop' && stkDim !== 'scoop') {
    const converted = convertScoop(ingValue, ingName, stkDim);
    if (converted === null) return null;
    ingValue = converted;
    ingDim = stkDim;
  } else if (stkDim === 'scoop' && ingDim !== 'scoop') {
    const converted = convertScoop(stkValue, ingName, ingDim);
    if (converted === null) return null;
    stkValue = converted;
    stkDim = ingDim;
  } else if (ingDim !== stkDim) {
    // "200 g" does not cover "2 pcs" — not a quantity question at all.
    return null;
  }

  // A non-finite amount means malformed data, not a real deduction. Skip it
  // rather than letting NaN propagate: subtractBase would return NaN, and the
  // row would then fail `quantity > 0` and be deleted from the kitchen.
  if (!Number.isFinite(ingValue) || !Number.isFinite(stkValue)) return null;

  return { ingValue, stkValue, dimension: ingDim };
}

/**
 * Compute what would happen if this recipe were cooked for `peopleCooked` people.
 * Pure — does not modify state. Useful for live preview in the UI.
 *
 * Each deduction carries its `candidates` list so the UI can offer a picker
 * when multiple stock items match the same ingredient (ambiguous).
 */
export function planRecipeDeduction(
  recipe: Recipe,
  peopleCooked: number,
  stock: StockItem[],
): RecipeDeductionPlan {
  const multiplier = recipe.baseServings > 0 ? peopleCooked / recipe.baseServings : 0;
  const deductions: DeductionResult[] = [];
  const skipped: SkippedIngredient[] = [];

  for (const ing of recipe.ingredients) {
    const candidates = findCandidatesForIngredient(ing, stock);
    const match = candidates[0] ?? null;
    if (!match) {
      skipped.push({ ingredient: ing, reason: 'not-in-stock', candidates: [] });
      continue;
    }

    // Resolve both sides to a COMMON dimension. When the recipe measures in
    // spoons ("2 tbsp oil") and the stock is held in grams, the ingredient is
    // converted with its density so the two can actually be compared — this is
    // what used to fail for 55% of the catalogue.
    const common = resolveToCommonDimension(
      ing.quantity * multiplier,
      ing.unit,
      ing.name,
      match.quantity,
      match.unit,
    );
    if (!common) {
      skipped.push({ ingredient: ing, reason: 'unit-mismatch', candidates });
      continue;
    }

    // Put the deduction in the STOCK ROW'S base unit, because that is the unit
    // it is subtracted from and written back in.
    //
    // WHY THE COMMON DIMENSION IS NOT ENOUGH: "common" means the dimension the
    // two sides can be compared in, and that is the RECIPE's dimension unless
    // the recipe is the one in spoons. A shelf measured in spoons against a
    // recipe in grams therefore resolves to grams — and a deduction in grams
    // subtracted from a stock row held in millilitres is the wrong number
    // entirely. The density is what turns one into the other.
    const stockBase = toBaseUnit(match.quantity, match.unit);
    if (!stockBase) {
      skipped.push({ ingredient: ing, reason: 'unit-mismatch', candidates });
      continue;
    }
    const ingInStockUnits = convertBase(
      common.ingValue,
      common.dimension,
      stockBase.dimension,
      ing.name,
    );
    if (ingInStockUnits === null) {
      skipped.push({ ingredient: ing, reason: 'unit-mismatch', candidates });
      continue;
    }

    const deductedBase = Math.min(ingInStockUnits, stockBase.value);
    const remainingBase = subtractBase(stockBase.value, ingInStockUnits);
    deductions.push({
      ingredient: ing,
      stockItem: match,
      deductedBase,
      remainingBase,
      deductedLabel: formatInUnit(deductedBase, match.unit),
      candidates,
    });
  }

  return { recipe, peopleCooked, multiplier, deductions, skipped };
}