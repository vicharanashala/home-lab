import type { Recipe, StockItem } from '../types';
import { findCandidatesForIngredient } from './recipeMatch';

export interface ExpiringDish {
  recipe: Recipe;
  /** Stock items expiring soon that this recipe actually uses. */
  uses: StockItem[];
  /** How many of the recipe's ingredients the kitchen has. */
  coverage: { have: number; total: number };
  /** Days until the earliest used item expires (0 = today). */
  expiresInDays: number;
  /** Share of the dish's ingredients already on hand, 0..1. */
  match: number;
}

const dayMs = 86_400_000;

function daysUntil(iso: string | undefined, now: number): number {
  if (!iso) return 9999;
  const t = Date.parse(`${iso}T00:00:00`);
  if (Number.isNaN(t)) return 9999;
  return Math.max(0, Math.round((t - now) / dayMs));
}

/**
 * Recipes that rescue food about to go off.
 *
 * The kitchen already knows which items expire soon, and the matcher already
 * knows which stock a recipe needs — this joins the two so the planner can
 * suggest cooking what would otherwise be wasted.
 *
 * Only items expiring within `withinDays` are considered, and only dishes that
 * genuinely use at least one of them are returned, so the suggestions stay
 * relevant instead of degenerating into "all 6,000 recipes".
 */
export function recipesUsingExpiringStock(
  recipes: Recipe[],
  stock: StockItem[],
  withinDays = 3,
  limit = 6,
): ExpiringDish[] {
  const now = Date.now();
  const expiring = stock.filter((s) => {
    const d = daysUntil(s.expiryDate, now);
    return s.expiryDate !== undefined && d <= withinDays && s.quantity > 0;
  });
  if (expiring.length === 0) return [];

  const out: ExpiringDish[] = [];

  for (const recipe of recipes) {
    if (!recipe?.ingredients?.length) continue;

    let have = 0;
    let earliest = 9999;
    const uses: StockItem[] = [];

    for (const ing of recipe.ingredients) {
      const hit = findCandidatesForIngredient(ing, stock)[0];
      if (!hit) continue;
      have += 1;
      if (hit.expiryDate) {
        const d = daysUntil(hit.expiryDate, now);
        if (d <= withinDays) {
          uses.push(hit);
          if (d < earliest) earliest = d;
        }
      }
    }

    // Must actually rescue at least one expiring item, and must be a dish
    // you could realistically cook (some ingredients on hand).
    if (uses.length === 0) continue;
    const coverage = { have, total: recipe.ingredients.length };
    if (have === 0) continue;

    out.push({
      recipe,
      uses,
      coverage,
      expiresInDays: earliest,
      match: have / recipe.ingredients.length,
    });
  }

  // Most urgent first, then best-covered dishes first.
  out.sort((a, b) => {
    if (a.expiresInDays !== b.expiresInDays) return a.expiresInDays - b.expiresInDays;
    return b.match - a.match;
  });

  // The catalogue ships the same dish under several ids, which made the rescue
  // strip show "Palak paneer" two or three times in a row. Keep one entry per
  // dish name — the best-ranked one, since the sort above already ran.
  const seen = new Set<string>();
  const unique = out.filter((d) => {
    const key = d.recipe.name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.slice(0, limit);
}

/** Human phrase for how urgent a rescue is. */
export function urgencyLabel(d: ExpiringDish): string {
  if (d.expiresInDays <= 0) return 'expires today';
  if (d.expiresInDays === 1) return 'expires tomorrow';
  return `expires in ${d.expiresInDays} days`;
}