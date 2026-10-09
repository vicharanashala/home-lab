/**
 * Portion sizing and shopping-list maths for the weekly meal plan.
 *
 * Two ideas drive everything here:
 *
 *  1. A household is measured in **adult equivalents**. An adult counts 1, a
 *     teen ~0.9, a child ~0.6, a toddler ~0.4. That is why the survey asks
 *     for kids by age — "3 kids" would badly overshoot the shopping list.
 *
 *  2. A recipe's quantities scale linearly from its `baseServings`. Cooking
 *     it for 6 when it is written for 2 means 3x the ingredients.
 *
 * Everything is pure and dependency-light so it can be unit tested without a
 * DOM, which matters because the shopping total is the one number a user
 * checks against a real bill.
 */

import { findCandidatesForIngredient } from './recipeMatch';
import { unitDimension } from './units';
import type {
  HouseholdProfile,
  MealPlanDay,
  MealPlan,
  MealPlanEntry,
  PortionId,
  PortionLevel,
  Recipe,
  ShoppingNeed,
  StockItem,
} from '../types';

/** How much of an adult's portion each age group actually eats. */
const APPETITE = {
  adult: 1,
  teen: 0.9,
  child: 0.6,
  toddler: 0.4,
} as const;

/** The five portion buttons shown per recipe. */
export const PORTION_LEVELS: PortionLevel[] = [
  { id: 'small', label: 'Small', servings: 2, blurb: '1–2 people' },
  { id: 'medium', label: 'Medium', servings: 4, blurb: '3–4 people' },
  { id: 'large', label: 'Large', servings: 6, blurb: '5–6 people' },
  { id: 'family', label: 'Family', servings: 9, blurb: '7–9 people' },
  { id: 'big', label: 'Big', servings: 12, blurb: '10+ people' },
];

export const DEFAULT_HOUSEHOLD: HouseholdProfile = {
  adults: 2,
  toddlers: 0,
  children: 0,
  teens: 0,
  completed: false,
};

/** People counted as adult equivalents, e.g. 2 adults + 1 toddler = 2.4. */
export function adultEquivalents(h?: HouseholdProfile): number {
  if (!h) return DEFAULT_HOUSEHOLD.adults;
  return (
    (h.adults || 0) * APPETITE.adult +
    (h.teens || 0) * APPETITE.teen +
    (h.children || 0) * APPETITE.child +
    (h.toddlers || 0) * APPETITE.toddler
  );
}

/** Total heads in the house — used for labels like "family of 5". */
export function headCount(h?: HouseholdProfile): number {
  if (!h) return DEFAULT_HOUSEHOLD.adults;
  return (h.adults || 0) + (h.teens || 0) + (h.children || 0) + (h.toddlers || 0);
}

/** The portion button closest to what this household needs. */
export function suggestedPortionId(h?: HouseholdProfile): PortionId {
  const need = adultEquivalents(h);
  let best = PORTION_LEVELS[0];
  let bestGap = Infinity;
  for (const p of PORTION_LEVELS) {
    const gap = Math.abs(p.servings - need);
    if (gap < bestGap) {
      bestGap = gap;
      best = p;
    }
  }
  return best.id;
}

export function suggestedServings(h?: HouseholdProfile): number {
  const id = suggestedPortionId(h);
  return PORTION_LEVELS.find((p) => p.id === id)?.servings ?? 4;
}

/** How many times bigger than the recipe's written size we need to cook. */
export function scaleFor(recipe: Recipe, servings: number): number {
  const base = recipe.baseServings > 0 ? recipe.baseServings : 1;
  return servings / base;
}

interface Accum {
  name: string;
  quantity: number;
  unit: string;
  category: ShoppingNeed['category'];
}

const keyOf = (name: string, unit: string) =>
  `${name.trim().toLowerCase().replace(/\s+/g, ' ')}::${unit.trim().toLowerCase() || 'pcs'}`;

/**
 * Work out everything the week needs, and how much of it the kitchen already
 * has. Only entries with a `recipeId` contribute — a hand-typed dish has no
 * known ingredient list, so guessing at one would put the wrong things on the
 * shopping list.
 */
export function buildShoppingList(
  plan: MealPlan | undefined,
  recipes: Recipe[],
  stock: StockItem[],
): ShoppingNeed[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const acc = new Map<string, Accum>();

  for (const day of Object.values(plan || {})) {
    if (!day) continue;
    for (const entry of Object.values(day)) {
      if (!entry || !entry.recipeId) continue;
      const recipe = byId.get(entry.recipeId);
      if (!recipe || !Array.isArray(recipe.ingredients)) continue;
      const scale = scaleFor(recipe, entry.servings || recipe.baseServings);
      for (const ing of recipe.ingredients) {
        if (!ing?.name) continue;
        const unit = ing.unit || 'pcs';
        const key = keyOf(ing.name, unit);
        const prev = acc.get(key);
        if (prev) {
          prev.quantity += (Number(ing.quantity) || 0) * scale;
        } else {
          acc.set(key, {
            name: ing.name,
            quantity: (Number(ing.quantity) || 0) * scale,
            unit,
            category: ing.category || 'other',
          });
        }
      }
    }
  }

  const needs: ShoppingNeed[] = [];
  for (const a of acc.values()) {
    if (a.quantity <= 0) continue;

    // Does the fridge already cover this ingredient?
    const probe = {
      name: a.name,
      quantity: a.quantity,
      unit: a.unit,
      category: a.category,
    };
    const candidates = findCandidatesForIngredient(probe, stock);
    const stockItem = candidates[0];
    let have = 0;
    if (stockItem) {
      // Only compare when the units are the same dimension — 200g does not
      // meaningfully cover a recipe asking for 2 "pcs".
      const sameDim =
        unitDimension(stockItem.unit) === unitDimension(a.unit) ||
        unitDimension(stockItem.unit) === 'unknown' ||
        unitDimension(a.unit) === 'unknown';
      have = sameDim ? stockItem.quantity : 0;
    }
    const covered = have >= a.quantity;

    needs.push({
      name: a.name,
      category: a.category,
      needed: round2(a.quantity),
      unit: a.unit,
      inStock: Boolean(stockItem),
      ...(stockItem ? { stockItemId: stockItem.id, have } : {}),
      covered,
    });
  }

  // Things you must buy first, then covered ones, then alphabetical.
  needs.sort((a, b) => {
    if (a.covered !== b.covered) return a.covered ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return needs;
}

/** Only the lines you actually need to buy. */
export function missingItems(needs: ShoppingNeed[]): ShoppingNeed[] {
  return needs.filter((n) => !n.covered);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A web search for one item, so the user can check a live price. */
export function searchLinkFor(name: string, store?: string): string {
  const q = encodeURIComponent(store ? `${name} ${store}` : name);
  return store
    ? `https://www.google.com/maps/search/${q}`
    : `https://www.amazon.in/s?k=${encodeURIComponent(name)}`;
}

/** Count of planned slots, for the "how far along am I" line. */
export function countPlanned(plan: MealPlan | undefined): number {
  if (!plan) return 0;
  let n = 0;
  for (const day of Object.values(plan)) {
    if (!day) continue;
    for (const slot of Object.values(day)) if (slot) n++;
  }
  return n;
}

/**
 * How many days of the week have at least one meal planned. Easier to read at
 * a glance than a raw slot count like "4 of 21" — people think in days.
 */
export function countPlannedDays(plan: MealPlan | undefined): number {
  if (!plan) return 0;
  let n = 0;
  for (const day of Object.values(plan)) {
    if (!day) continue;
    if (Object.values(day).some(Boolean)) n++;
  }
  return n;
}

export const TOTAL_DAYS = 7;

/** Short day names for compact "which days did you use?" labels. */
export const DAY_SHORT: Record<MealPlanDay, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu',
  fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

/** The days that actually contribute to the shopping list, in week order. */
export function plannedDayLabels(plan: MealPlan | undefined): string[] {
  if (!plan) return [];
  const out: string[] = [];
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as MealPlanDay[]) {
    const day = plan[d];
    if (day && Object.values(day).some(Boolean)) out.push(DAY_SHORT[d]);
  }
  return out;
}

export const TOTAL_SLOTS = 21;

/** Planned dishes whose ingredients the shopping list cannot work out —
 *  either hand-typed, or pointing at a recipe id that is no longer known. */
export function unplannedNames(plan: MealPlan | undefined, recipes: Recipe[]): string[] {
  const known = new Set(recipes.map((r) => r.id));
  const out = new Set<string>();
  for (const day of Object.values(plan || {})) {
    if (!day) continue;
    for (const entry of Object.values(day)) {
      if (!entry) continue;
      if (!entry.recipeId || !known.has(entry.recipeId)) out.add(entry.name);
    }
  }
  return [...out];
}

/** Narrow helper for the UI: does this entry point at a real recipe? */
export function entryRecipe(entry: MealPlanEntry, recipes: Recipe[]): Recipe | null {
  if (!entry?.recipeId) return null;
  return recipes.find((r) => r.id === entry.recipeId) || null;
}