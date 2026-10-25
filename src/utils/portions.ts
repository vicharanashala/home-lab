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
import { convertBase, toBaseUnit } from './units';
import type {
  HouseholdProfile,
  MealPlanDay,
  MealPlan,
  MealPlanDayPlan,
  MealPlanEntry,
  MealSlot,
  PortionId,
  PortionLevel,
  Recipe,
  ShoppingNeed,
  StockItem,
} from '../types';

/**
 * The three slots of a day.
 *
 * Always iterate the plan through this list rather than `Object.values(day)`
 * — a day now carries settings (mode, guests, note) alongside its meals,
 * and those are not meals.
 */
export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

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

/**
 * Where a number of servings lands on the portion ladder: the NEAREST size.
 *
 * The ladder is the five sizes the app offers — 2, 4, 6, 9, 12 — and a need
 * that is not exactly one of them belongs to the nearest.
 *
 * WHY A TIE GOES TO THE LARGER SIZE
 * The ladder publishes what each size feeds: Small is "1–2 people", Medium is
 * "3–4 people", Large is "5–6", Family is "7–9", Big is "10+". A need of
 * exactly three is three people, so it belongs to Medium. The smaller size
 * would be cooking two portions for three people — and the shopping list,
 * which is built from the servings on each dish, would buy two portions'
 * worth of food for three adults.
 *
 * The same reason decides the general case: too much food can be kept for
 * the next day, too little cannot be made up. So a tie rounds UP, the way
 * `Math.round` does.
 */
function nearestPortionIndex(servings: number): number {
  if (!(servings > 0)) return 0;
  let best = 0;
  let bestGap = Infinity;
  for (let i = 0; i < PORTION_LEVELS.length; i++) {
    const gap = Math.abs(PORTION_LEVELS[i].servings - servings);
    // `<=` and not `<`: on a tie the LATER size wins, and the ladder is in
    // ascending order, so the later size is the bigger one.
    if (gap <= bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

/**
 * The smallest size on the ladder that COVERS a need.
 *
 * This is the other half of the ladder rule. `nearestPortionIndex` answers
 * "which size is closest"; this answers "which size is big enough" — and for
 * a household where every guest and every member of the family eats a whole
 * serving, "big enough" is the only answer that is right. Six servings is
 * the closest size to seven people, but six servings is the size whose own
 * label says it feeds "5–6 people", and the shopping list, built from the
 * servings on each dish, would buy six people's worth of food for seven
 * adults.
 */
function coveringPortionIndex(servings: number): number {
  for (let i = 0; i < PORTION_LEVELS.length; i++) {
    if (PORTION_LEVELS[i].servings >= servings) return i;
  }
  return PORTION_LEVELS.length - 1;
}

/**
 * How many people at the table eat less than a whole serving.
 *
 * A child counts 0.6 of an adult and a toddler 0.4, so a household with
 * children needs noticeably less food than its head count suggests — that is
 * the whole point of measuring in adult equivalents, and the reason the
 * survey asks for kids by age. A teen counts 0.9, which is close enough to
 * a whole serving that the household is treated as one.
 */
function smallEaterCount(h?: HouseholdProfile): number {
  return (h?.children || 0) + (h?.toddlers || 0);
}

/**
 * The ladder index a household's need lands on.
 *
 * WHY TWO RULES AND NOT ONE
 * The ladder's own blurbs promise what each size feeds, and a size that
 * cannot feed the people at the table is the one thing the shopping list
 * cannot recover from: it buys the servings on each dish, so too small a
 * size means too little food bought.
 *
 * So a household where EVERYONE eats a whole serving gets the smallest size
 * that COVERS it — seven adults get nine servings, not six.
 *
 * A household with children is different. Its need is measured in ADULT
 * EQUIVALENTS, and it lands on the NEAREST size, because rounding that
 * fraction up to a whole serving would be expensive: one child would push a
 * family of two adults and one child from two portions to four, and the
 * shopping list would buy twice what that family eats. The size that does
 * not feed everyone is the child's own share — which is the point.
 *
 * WHY THERE IS STILL A FLOOR UNDER THE NEAREST SIZE
 * "The child's share is what the app may come up short on" is a promise about
 * the CHILD, and the nearest-size rule was breaking it: rounding the
 * adult-equivalent need to the nearest size could land BELOW the number of
 * people who eat a whole serving. Two adults and a toddler with five guests
 * over are seven whole-serving eaters and 7.4 adult equivalents — and the
 * nearest size to 7.4 is six, so the plan fed seven people six portions and
 * the shopping list bought six people's worth of food for seven.
 *
 * So the nearest size is a floor, not the answer on its own: the size must
 * also cover the adults, the teens and the guests. The floor is the
 * SMALLEST size that covers them, so nothing is bought beyond what the table
 * needs — it is never larger than the size that covers the full
 * adult-equivalent need.
 *
 * @param need        the appetite of the household and its guests, in adult
 *                    equivalents
 * @param heads       how many people are at the table
 * @param smallEaters how many of those people eat less than a whole serving
 */
function portionIndexForNeed(
  need: number,
  heads: number,
  smallEaters: number,
): number {
  if (smallEaters > 0) {
    // Everyone who eats a whole serving gets one. The children are the only
    // ones the app is allowed to come up short on.
    const wholeEaters = Math.max(0, heads - smallEaters);
    return Math.max(nearestPortionIndex(need), coveringPortionIndex(wholeEaters));
  }
  return coveringPortionIndex(Math.max(need, heads));
}

/**
 * The portion button this household needs.
 *
 * The same size `suggestedServings` returns, under its id — kept as its own
 * lookup so a screen can show the button and the serving count without
 * re-deriving the rule in two places.
 */
export function suggestedPortionId(h?: HouseholdProfile): PortionId {
  const index = portionIndexForNeed(
    adultEquivalents(h),
    headCount(h),
    smallEaterCount(h),
  );
  return PORTION_LEVELS[index].id;
}

/** How many servings this household's usual portion is. */
export function suggestedServings(h?: HouseholdProfile): number {
  const index = portionIndexForNeed(
    adultEquivalents(h),
    headCount(h),
    smallEaterCount(h),
  );
  return PORTION_LEVELS[index].servings;
}

/** Heads at the table on a given day: the household, plus any guests. */
export function dayHeadCount(
  day: MealPlanDayPlan | undefined,
  h?: HouseholdProfile,
): number {
  return headCount(h) + Math.max(0, day?.guests ?? 0);
}

/**
 * The portion to cook on a given day: the household's usual size, bumped
 * up when guests are coming. Never smaller than the household's usual size —
 * extra guests should never shrink the portions.
 *
 * WHY THE GUESTS ARE ADDED TO THE ADULT EQUIVALENTS AND NOT TO THE HEAD COUNT
 * The household is measured in adult equivalents — a child eats 0.6 of an
 * adult — and the guests are extra people at the table, so they belong in
 * that same measure. Adding them to the raw head count instead quietly
 * re-measured the household's CHILDREN as full adults: one guest over grew a
 * family of two adults and three children from a medium portion (4) to a
 * large one (6), which is 50% more food than that family eats, and the
 * shopping list — which is built from the servings on each dish — bought it.
 *
 * `dayHeadCount` is still the right answer to "how many people are at the
 * table", and the meal-plan header says that. It was the wrong answer to
 * "how much food does this day need".
 */
export function suggestedServingsForDay(
  day: MealPlanDayPlan | undefined,
  h?: HouseholdProfile,
): number {
  const base = suggestedServings(h);
  const guests = Math.max(0, day?.guests ?? 0);
  if (guests === 0) return base;
  const index = portionIndexForNeed(
    adultEquivalents(h) + guests,
    dayHeadCount(day, h),
    smallEaterCount(h),
  );
  return Math.max(base, PORTION_LEVELS[index].servings);
}

/**
 * The size a dish should move to when the day it sits on grows.
 *
 * WHY THIS IS NOT A RATIO
 * The dish's size and the day's size are two different numbers, and only the
 * DAY moves when the guest count changes. Scaling the dish by the ratio
 * between the day's old size and its new one keeps the two in step only
 * while the dish happens to BE the day's size — the common case, and the
 * only case the tests covered. The moment a dish was deliberately planned at
 * a different size (a "Family" dinner on a "Medium" day), every guest step
 * multiplied it by the day's growth factor again and the dish ran away: a
 * 9-serving dinner became 14, then 21, then 27 servings — sizes the app
 * does not even offer, and a shopping list five times too big.
 *
 * So the dish keeps its PLACE on the ladder and the day carries it up the
 * same number of steps. A dinner deliberately made bigger than the day stays
 * bigger; a smaller one stays smaller; and the result is always one of the
 * five sizes the app can show and buy.
 *
 * @param dishServings how big the dish is now
 * @param dayBefore    the day's size before the change
 * @param dayAfter     the day's size after the change
 */
export function rescaledServings(
  dishServings: number,
  dayBefore: number,
  dayAfter: number,
): number {
  const steps = nearestPortionIndex(dayAfter) - nearestPortionIndex(dayBefore);
  const moved = nearestPortionIndex(dishServings) + steps;
  const clamped = Math.max(0, Math.min(PORTION_LEVELS.length - 1, moved));
  return PORTION_LEVELS[clamped].servings;
}

/** How many times bigger than the recipe's written size we need to cook. */
export function scaleFor(recipe: Recipe, servings: number): number {
  const base = recipe.baseServings > 0 ? recipe.baseServings : 1;
  return servings / base;
}

interface Accum {
  name: string;
  category: ShoppingNeed['category'];
  /**
   * Every need for this ingredient, in the order the plan asked for them.
   *
   * WHY THE PIECES ARE KEPT RATHER THAN ADDED UP AS THEY ARRIVE: the catalogue
   * measures the same ingredient in more than one unit — salt in teaspoons and
   * tablespoons, milk in millilitres and litres, ginger in pieces and grams.
   * Adding them as they arrive would add a count to a mass, which is not a
   * number of anything. They are added up later, once it is known whether they
   * can be.
   */
  pieces: Array<{ quantity: number; unit: string }>;
}

/**
 * The same ingredient, written the same way.
 *
 * WHY THE NAME AND NOT THE NAME AND THE UNIT: the shelf is one shelf. Two
 * recipes asking for "Salt" in teaspoons and tablespoons are asking for the
 * same jar, and the list has to compare that jar with the week ONCE.
 */
const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The same unit, written the same way.
 *
 * WHY THE UNIT IS NORMALISED: "G" and "g" are the same unit, and so are "TSP"
 * and "tsp". Two needs in the same unit are simply added together, and that
 * has to work for a unit the app does not know at all — the catalogue has
 * "slices", and two recipes each asking for two slices of bread is four
 * slices of bread.
 */
const unitKey = (unit: string) => unit.trim().toLowerCase() || 'pcs';

/**
 * How much of a need the kitchen already covers, expressed in the NEED's own
 * unit.
 *
 * Comparing the two raw numbers is how "1 kg of rice" ended up being
 * compared against a recipe asking for "500 g": 1 < 500, so the shopping
 * list told the user to buy rice they already had — and, worse, printed
 * "have 1g", because the stock's number was shown with the need's unit
 * beside it. 500 g of rice against a 1 kg need was even worse: 500 >= 1, so
 * the item was marked covered and left off the shopping list entirely.
 *
 * Both sides are converted to a common base unit first, and the result is
 * converted back into the need's unit so the number shown to the user is
 * always the one that makes sense next to the unit shown.
 *
 * WHY A VOLUME AND A MASS MEET: they are the same substance measured two
 * ways, and the density is the honest bridge. A need in millilitres against a
 * kilo on the shelf counted as nothing there, so the list told the user to
 * buy the milk they were standing next to.
 */
function coveredAmount(
  need: number,
  needUnit: string,
  ingredientName: string,
  stockItem: StockItem | undefined,
): number {
  if (!stockItem || !(need > 0)) return 0;

  const needBase = toBaseUnit(need, needUnit);
  const stockBase = toBaseUnit(stockItem.quantity, stockItem.unit);
  if (!needBase || !stockBase) return 0;
  // An unknown unit cannot be reasoned about, so treat it as "not covered".
  if (needBase.dimension === 'unknown' || stockBase.dimension === 'unknown') return 0;

  // Both sides expressed in ONE base unit.
  let needInCommon = needBase.value;
  const stockInCommon = stockBase.value;

  // WHY THE NEED IS BROUGHT INTO THE STOCK'S DIMENSION: the two sides have to
  // be comparable, and the answer is reported in the need's own unit — so the
  // conversion has to pass through one shared dimension.
  //
  // WHY A VOLUME AND A MASS ARE BRIDGED: they are the same substance measured
  // two ways, and the density is the honest bridge between them. A shelf
  // measured in millilitres against a recipe written in grams counted as
  // NOTHING there, so the shopping list told the user to buy the milk they
  // were standing next to — while the same milk measured in spoons was
  // counted correctly.
  //
  // WHY A COUNT IS NOT BRIDGED: a count is not a mass at all.
  if (needBase.dimension !== stockBase.dimension) {
    const converted = convertBase(
      needInCommon,
      needBase.dimension,
      stockBase.dimension,
      ingredientName,
    );
    if (converted === null) return 0;
    needInCommon = converted;
  }

  if (!Number.isFinite(needInCommon) || !Number.isFinite(stockInCommon)) return 0;

  // How many base units make up one unit of the need, so the stock amount
  // can be expressed back in the need's unit.
  const perNeedUnit = needInCommon / need;
  if (!Number.isFinite(perNeedUnit) || perNeedUnit === 0) return 0;

  return stockInCommon / perNeedUnit;
}

/**
 * Bring a need into the unit a line is written in.
 *
 * WHY THE CONVERSION IS NOT A SIMPLE DIVISION: the two units may be in the
 * same dimension (teaspoons and tablespoons, millilitres and litres, grams and
 * kilograms) or in different ones (a mass and a volume, bridged by the
 * ingredient's density). A count is in neither, and cannot be bridged at all.
 *
 * @returns the need in the target unit, or null when the two cannot be
 *          compared.
 */
function convertNeedToUnit(
  quantity: number,
  unit: string,
  targetUnit: string,
  ingredientName: string,
): number | null {
  const from = toBaseUnit(quantity, unit);
  const target = toBaseUnit(1, targetUnit);
  if (!from || !target) return null;
  if (!Number.isFinite(target.value) || target.value === 0) return null;

  // Same dimension: the two units' own factors do the work.
  if (from.dimension === target.dimension) return from.value / target.value;

  // Different dimensions: only a volume and a mass can be bridged, and the
  // ingredient's density is the honest bridge.
  const converted = convertBase(from.value, from.dimension, target.dimension, ingredientName);
  if (converted === null) return null;
  return converted / target.value;
}

/**
 * The lines one ingredient gets on the shopping list.
 *
 * WHY THE NEEDS ARE ADDED UP RATHER THAN LISTED SIDE BY SIDE: the shelf is one
 * shelf. The catalogue measures the same ingredient in more than one unit —
 * salt in teaspoons and tablespoons, milk in millilitres and litres, ginger in
 * pieces and grams — and each line used to be checked against the WHOLE shelf
 * on its own. Two lines for one jar therefore each got their own "the kitchen
 * has this" verdict, and the list said the household had everything while the
 * two lines together wanted more than the jar held.
 *
 * WHY THE FIRST NEED'S UNIT WINS: it is deterministic, and when every recipe
 * asks in the same unit — which is the usual case — nothing changes at all.
 *
 * WHY SOME GROUPS STAY SPLIT: a count is not a mass, so "2 pcs Ginger" and
 * "50 g Ginger" cannot be added up. Those keep their own lines, and keeping
 * them apart is safe: only one of them can match a shelf row, because a
 * shelf row is in one dimension too.
 *
 * `pieces` is never empty — a group is created together with its first need.
 */
function linesFor(
  name: string,
  pieces: Array<{ quantity: number; unit: string }>,
): Array<{ quantity: number; unit: string }> {
  const target = pieces[0];
  let total = 0;
  for (const piece of pieces) {
    // The same unit twice is addition, and it has to work for a unit the app
    // does not know — two recipes asking for two slices of bread is four
    // slices, whatever the app calls a slice.
    if (unitKey(piece.unit) === unitKey(target.unit)) {
      total += piece.quantity;
      continue;
    }
    const converted = convertNeedToUnit(piece.quantity, piece.unit, target.unit, name);
    // One need that cannot be brought into the group's unit means the group
    // cannot be added up at all, so every need keeps its own line.
    if (converted === null) return pieces.map((p) => ({ quantity: p.quantity, unit: p.unit }));
    total += converted;
  }
  return [{ quantity: total, unit: target.unit }];
}

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
    for (const slot of MEAL_SLOTS) {
      const entry = day[slot];
      if (!entry || !entry.recipeId) continue;
      const recipe = byId.get(entry.recipeId);
      if (!recipe || !Array.isArray(recipe.ingredients)) continue;
      const scale = scaleFor(recipe, entry.servings || recipe.baseServings);
      for (const ing of recipe.ingredients) {
        if (!ing?.name) continue;
        const unit = ing.unit || 'pcs';
        const quantity = (Number(ing.quantity) || 0) * scale;
        const key = nameKey(ing.name);
        const prev = acc.get(key);
        if (prev) {
          prev.pieces.push({ quantity, unit });
        } else {
          acc.set(key, {
            name: ing.name,
            category: ing.category || 'other',
            pieces: [{ quantity, unit }],
          });
        }
      }
    }
  }

  const needs: ShoppingNeed[] = [];
  for (const a of acc.values()) {
    // ONE SHELF, ONE VERDICT: the lines for an ingredient are added up before
    // the shelf is compared with them, so two units of the same thing cannot
    // each claim the whole jar.
    for (const line of linesFor(a.name, a.pieces)) {
      if (line.quantity <= 0) continue;

      // Does the fridge already cover this ingredient?
      const probe = {
        name: a.name,
        quantity: line.quantity,
        unit: line.unit,
        category: a.category,
      };
      const candidates = findCandidatesForIngredient(probe, stock);
      const stockItem = candidates[0];
      const have = coveredAmount(line.quantity, line.unit, a.name, stockItem);
      const covered = have >= line.quantity - 1e-9;

      needs.push({
        name: a.name,
        category: a.category,
        needed: round2(line.quantity),
        unit: line.unit,
        inStock: Boolean(stockItem),
        ...(stockItem ? { stockItemId: stockItem.id, have } : {}),
        covered,
      });
    }
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
    for (const slot of MEAL_SLOTS) if (day[slot]) n++;
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
    if (MEAL_SLOTS.some((slot) => !!day[slot])) n++;
  }
  return n;
}

export const TOTAL_DAYS = 7;

/** Short day names for compact "which days did the user use?" labels. */
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
    if (day && MEAL_SLOTS.some((slot) => !!day[slot])) out.push(DAY_SHORT[d]);
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
    for (const slot of MEAL_SLOTS) {
      const entry = day[slot];
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
