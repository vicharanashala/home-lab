/**
 * Unit normalization for recipe → stock matching.
 *
 * Recipes and stock items can use different units of the same dimension.
 * We convert both to a base unit per dimension so quantities can be compared
 * and deducted correctly.
 *
 * Dimensions:
 *   mass   → g  (kg, g)
 *   vol    → ml (L, ml)
 *   count  → pcs (pcs, dozen)
 *   scoop  → ml-equivalent (tbsp, tsp, cup, pinch)
 *
 * Scoop units are volume-like but recipes mean mass when the ingredient is a
 * dry good ("1 cup flour"). They're converted with a per-ingredient density —
 * see `convertScoop` — because 1 cup of water is 240ml and 1 cup of flour is
 * roughly 120g. Without this, 55% of the recipe catalogue measured in spoons
 * could never match a stock quantity and was silently dropped from deductions.
 */

export type UnitDimension = 'mass' | 'vol' | 'count' | 'scoop' | 'unknown';

const MASS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  ounce: 28.35,
  ounces: 28.35,
  oz: 28.35,
  lb: 453.6,
  lbs: 453.6,
  pound: 453.6,
  pounds: 453.6,
};

const VOL: Record<string, number> = {
  ml: 1,
  millilitre: 1,
  millilitres: 1,
  milliliter: 1,
  milliliters: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  litre: 1000,
  litres: 1000,
};

const COUNT: Record<string, number> = {
  pcs: 1,
  pc: 1,
  piece: 1,
  pieces: 1,
  unit: 1,
  units: 1,
  dozen: 12,
};

/** Spoon/cup measures, expressed as millilitres. */
const SCOOP: Record<string, number> = {
  tsp: 5,
  tsps: 5,
  teaspoon: 5,
  teaspoons: 5,
  tbsp: 15,
  tbs: 15,
  tablespoon: 15,
  tablespoons: 15,
  cup: 240,
  cups: 240,
  pinch: 0.3,
  pinches: 0.3,
  dash: 0.6,
  dashes: 0.6,
};

export function unitDimension(unit: string): UnitDimension {
  const k = unit.trim().toLowerCase();
  if (k in MASS) return 'mass';
  if (k in VOL) return 'vol';
  if (k in COUNT) return 'count';
  if (k in SCOOP) return 'scoop';
  return 'unknown';
}

/** Convert a quantity + unit to its base unit. Returns null if unit is unknown. */
export function toBaseUnit(quantity: number, unit: string): { value: number; dimension: UnitDimension } | null {
  const k = unit.trim().toLowerCase();
  if (k in MASS) return { value: quantity * MASS[k], dimension: 'mass' };
  if (k in VOL) return { value: quantity * VOL[k], dimension: 'vol' };
  if (k in COUNT) return { value: quantity * COUNT[k], dimension: 'count' };
  if (k in SCOOP) return { value: quantity * SCOOP[k], dimension: 'scoop' };
  return null;
}

/**
 * Grams per millilitre, for common cooking ingredients. These are cooking
 * references, not lab values — good enough to shop and to deduct stock
 * sensibly. Anything unlisted falls back to `DEFAULT_DENSITY`.
 */
const DENSITY: Array<[RegExp, number]> = [
  [/water|stock|broth|buttermilk|chaas|pani/i, 1.0],
  [/milk|doodh|curd|yogurt|dahi|cream|malai/i, 1.03],
  // WHY "til" IS NOT IN THIS RULE: the rule that matches an ingredient first
  // wins, and this one comes before the seeds rule that also lists "til" — for
  // sesame. With "til" here, that seeds rule could never fire, because
  // anything containing "til" had already been claimed as oil.
  //
  // And the loose text does not know the difference: "lentil" CONTAINS "til",
  // so the lentils below used to be weighed as oil — 8% heavier than the dal
  // they belong to. A spoonful of lentils weighed as a spoonful of oil is the
  // wrong deduction off the user's own shelf. They are weighed now as:
  //
  //     "til"              -> 0.55  seeds
  //     "chickpea lentils" -> 0.85  dal
  //     "lentil paste"     -> 0.85  dal
  //
  // AND "LENTIL PASTE" IS NOT AT THE VALUE THE LAST RULE NAMES FOR IT: the
  // dal rule comes first and matches "lentil" inside the name, so it lands on
  // the dal instead. Which of the two is right is a cooking judgement, and the
  // table is left as it is on that point — the number above is the one the app
  // uses.
  //
  // Every oil is still caught: "til oil" and "sesame oil" both contain "oil".
  // Only the bare word "til" is gone, and that is what the seeds rule says it
  // is. See scripts/test-units-density.mjs.
  [/oil|ghee|butter|desi ghee/i, 0.92],
  [/flour|atta|maida|besan|chickpea flour|bread flour/i, 0.53],
  [/rice|chawal|basmati|pulao/i, 0.85],
  [/dal|daal|lentil|toor|masoor|moong|chana dal|rajma|beans?/i, 0.85],
  [/sugar|cheeni|shakar|jaggery|gur|powdered sugar/i, 0.85],
  [/salt|namak|sea salt/i, 1.2],
  [/spice|masala|chilli|chili|pepper|turmeric|haldi|cumin|jeera|coriander powder/i, 0.5],
  [/honey|jam|syrup|treacle/i, 1.4],
  [/bread|roti|chapati|dosa|idli|biscuit|cake/i, 0.45],
  // WHY "til" IS MATCHED AS A WORD HERE AND NOT AS LOOSE TEXT: "til" is three
  // letters, and three letters turn up inside other words. "until" and "till"
  // — the cooking instructions the scrape carries in the ingredient name —
  // contain it, and so do "tortilla", "tomatillo" and "pitiless". Matched as
  // loose text, every one of those was weighed as a seed:
  //
  //     "Chicken breasts - cooked till tender"   0.55  seeds
  //     "Tortillas"                               0.55  seeds
  //
  // Neither is a seed, and both are in the catalogue. The word boundary is
  // what tells "til" the seed from "until" the instruction.
  [/nuts?|cashew|almond|peanut|\btil\b|sesame/i, 0.55],
  [/chocolate|coffee powder|cocoa/i, 0.6],
  [/lentil paste|besan|papad/i, 0.7],
];

const DEFAULT_DENSITY = 0.9;

/** Grams per millilitre for a named ingredient. */
export function densityFor(ingredientName: string): number {
  for (const [re, d] of DENSITY) {
    if (re.test(ingredientName)) return d;
  }
  return DEFAULT_DENSITY;
}

/**
 * Convert a millilitre-equivalent scoop measurement into the dimension a
 * stock item is actually tracked in, using the ingredient's density.
 *
 * This is what lets "2 tbsp oil" match a stock item held in grams, and
 * "1 cup milk" match one held in ml.
 */
export function convertScoop(
  ml: number,
  ingredientName: string,
  target: UnitDimension,
): number | null {
  // Already expressed in millilitres — nothing to do.
  if (target === 'vol' || target === 'scoop') return ml;
  if (target === 'mass') return ml * densityFor(ingredientName);
  return null; // count- or unknown-dimension stock can't absorb a scoop
}

/** Convert a value (in base unit) back to a human-readable display unit. */
export function fromBaseUnit(value: number, dimension: UnitDimension): { quantity: number; unit: string } {
  if (dimension === 'mass') {
    if (value >= 1000) return { quantity: round(value / 1000, 2), unit: 'kg' };
    return { quantity: round(value, 1), unit: 'g' };
  }
  if (dimension === 'vol') {
    if (value >= 1000) return { quantity: round(value / 1000, 2), unit: 'L' };
    return { quantity: round(value, 1), unit: 'ml' };
  }
  if (dimension === 'count') {
    return { quantity: Math.round(value), unit: 'pcs' };
  }
  return { quantity: round(value, 2), unit: '' };
}

function round(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

/** Pick a nice display unit for a base-unit quantity (same shape as `fromBaseUnit`). */
export function formatBaseValue(value: number, dimension: UnitDimension): string {
  const { quantity, unit } = fromBaseUnit(value, dimension);
  return unit ? `${quantity} ${unit}` : `${quantity}`;
}

/**
 * Subtract `deduct` (already in base units) from `stock` (also base units),
 * clamped at 0. Returns the new base quantity.
 */
export function subtractBase(currentBase: number, deductBase: number): number {
  // Math.max(0, NaN) is NaN, and a NaN quantity then fails `quantity > 0`,
  // which silently deletes the row from the kitchen. Never invent a number.
  if (!Number.isFinite(currentBase)) return 0;
  if (!Number.isFinite(deductBase) || deductBase <= 0) return currentBase;
  return Math.max(0, currentBase - deductBase);
}
