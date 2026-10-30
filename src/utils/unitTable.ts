/**
 * The app's unit table — the words it knows, and what each one is worth.
 *
 * WHY IT IS ITS OWN FILE AND NOT INSIDE `units.ts`: two rules sit above this
 * one, and both of them need it. `units.ts` converts a quantity from one unit
 * to another, and the rule that SPELLS a quantity — `formatQuantity` in
 * date.ts — has to know whether a word is a unit at all before it will write
 * one. If the table lived inside `units.ts`, then date.ts would have to import
 * it from there, and `units.ts` imports the spelling rule back from date.ts:
 * a circle, and a circle is a thing two people editing this repo at once will
 * break. So the vocabulary is the floor and the two rules sit on top of it.
 *
 * WHY IT IMPORTS NOTHING: nothing above this file has to be read before this
 * file is ready, which is what keeps the circle away.
 */

/** Every mass word the app can convert, and how many grams it is worth. */
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

/** Every volume word the app can convert, and how many millilitres it is worth. */
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

/** Every count word the app can convert, and how many pieces it is worth. */
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
  // WHY "tb" IS HERE: the app's own rule writes a quantity of one "tbs" as
  // "1 tb" — it takes the singular of the unit, and the singular of "tbs" is
  // "tb" (see `singularUnit` in date.ts). So "tb" is a word the app writes on
  // the shopping list and the House Bot's parser reads back, and a household
  // can type it into the free-text stock unit field. Without it in this
  // table it converted to nothing: a stock row held in "tb" matched no
  // recipe and `toDisplayUnit` divided it by 1 instead of 15.
  tb: 15,
  tablespoon: 15,
  tablespoons: 15,
  cup: 240,
  cups: 240,
  pinch: 0.3,
  pinches: 0.3,
  dash: 0.6,
  dashes: 0.6,
};

/**
 * Every unit word the app can CONVERT.
 *
 * WHY IT IS THE TABLE'S KEYS AND NOT THE WORDS THE SHOP USES: this table is
 * what the app can CONVERT, and the stock unit field is free text — a
 * household can write any unit into it, and the app's own rule writes that
 * unit onto the shopping list as it was typed. The units the app can convert
 * are the ones the app can be asked about, so they are the ones the parser
 * has to read back.
 *
 * WHY IT IS EXPORTED: the House Bot's bullet parser has to tell a UNIT from
 * the start of an ingredient's NAME, and it does that with a list of unit
 * words. That list has to hold every word this app can write a quantity in,
 * or the parser puts the unit in the name:
 *
 *     the app writes      "- 6 ounces of butter"
 *     the parser read      an item called "ounces of butter", quantity "6"
 *
 * The parser keeps its OWN list — `UNIT_WORDS` in
 * src/utils/groceryListParser.ts — and THIS table is what keeps that list
 * honest: the round-trip test reads the units out of here and asks the real
 * parser to read each one back, so a unit added to this table turns the test
 * red until the parser can read it.
 *
 * WHY THE PARSER DOES NOT READ THIS TABLE DIRECTLY: the parser needs the
 * SHAPE of a unit word, not the word — "bottles?" and "pinch(?:es)?" are
 * patterns, not words — and it needs the words the kitchen counts in that
 * this table does not carry at all. Bottles, slices, packs, packets, cloves,
 * bunches and handfuls are in `WRITABLE_UNITS` below, because the app writes
 * them and cannot convert them. Reading this table in the parser would drop
 * every one of them and put the unit back in the name — the exact failure
 * the parser's own list exists to prevent.
 *
 * @returns every unit word the app can convert, in both singular and plural
 *          as the app knows them
 */
export const KNOWN_UNITS: string[] = [
  ...Object.keys(MASS),
  ...Object.keys(VOL),
  ...Object.keys(COUNT),
  ...Object.keys(SCOOP),
];

/**
 * The unit words the app can WRITE, whether or not it can CONVERT them.
 *
 * WHY THIS IS BIGGER THAN THE TABLES ABOVE: the tables answer "can the app
 * convert this unit?" — and the answer is no for the words the kitchen counts
 * in but the app does not measure in. A bottle, a packet, a pack, a clove, a
 * slice, a bunch, a handful. The app still WRITES those words, because the
 * stock unit field is free text and the add form offers them:
 *
 *     the add form's units    "pcs", "packets", "kg", "g", "L", "ml",
 *                             "dozen", "bunch", "bottles"
 *     the catalogue's units   "cup", "g", "kg", "l", "pcs", "pinch",
 *                             "tbsp", "tsp", "slices"
 *
 * So this list answers a DIFFERENT question from `unitDimension`:
 *
 *     unitDimension   can the app CONVERT this word?
 *     isWritableUnit  is this a unit word the app WRITES?
 *
 * WHY IT MATTERS THAT THEY ARE DIFFERENT QUESTIONS: the rule that spells a
 * quantity has to tell a quantity from a number and a letter — "2kg" is a
 * quantity, "3x" and "10k" are not — and it can only do that by asking
 * whether the word is a unit the app knows. Asking the CONVERT question
 * there left the kitchen's own units unrecognised, and the same quantity
 * reached the shopping list two ways:
 *
 *     the Stock row                   "2 bottles"
 *     the Add to shopping list form   "2bottles"
 *
 * WHY "kgs" IS HERE AND NOT IN THE MASS TABLE: the mass table converts, and
 * "kgs" is not something the app converts — but the House Bot's bullet
 * parser reads it, and the stock unit field is free text, so the app can be
 * asked to write "2 kgs".
 *
 * @returns every unit word the app writes, in both forms as the app knows them
 */
const KITCHEN_COUNT_UNITS = [
  'kgs',
  'pack', 'packs',
  'packet', 'packets',
  'dozen', 'dozens',
  'clove', 'cloves',
  'bottle', 'bottles',
  'slice', 'slices',
  'bunch', 'bunches',
  'handful', 'handfuls',
];

export const WRITABLE_UNITS: string[] = [
  ...new Set([...KNOWN_UNITS, ...KITCHEN_COUNT_UNITS]),
];

/** The same list, lower-cased, for the lookup below. */
const WRITABLE_UNIT_SET = new Set(WRITABLE_UNITS.map((u) => u.toLowerCase()));

/**
 * Is this word a unit the app writes a quantity in?
 *
 * WHY THE ANSWER IS NOT `unitDimension`: that asks whether the app can
 * CONVERT the unit, and the kitchen's own units — bottles, packets, cloves,
 * slices, bunches — cannot be converted. The app writes them all the same.
 * See `WRITABLE_UNITS`.
 *
 * WHY THE HOUSEHOLD'S OWN WORD IS NOT A UNIT: the stock unit field is free
 * text, so the word can be anything the household types — "tomatoes",
 * "leaves", "berries". Those are not units, they are the household's nouns,
 * and the rule that writes a quantity has to be able to tell the two apart:
 * it may take the singular of a unit ("bottles" -> "bottle"), because a unit
 * has one, and it must NOT take the singular of a household's noun
 * ("tomatoes" -> "tomatoe"), because English does not make one that way and
 * the word it invented went onto the shopping list.
 *
 * @param unit the word, as it was written
 * @returns true when the app writes quantities in this unit
 */
export function isWritableUnit(unit: string): boolean {
  return WRITABLE_UNIT_SET.has(unit.trim().toLowerCase());
}

export { MASS, VOL, COUNT, SCOOP };
