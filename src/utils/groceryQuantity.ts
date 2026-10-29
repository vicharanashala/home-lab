import type { ShoppingNeed, StockItem } from '../types';
import { formatQuantity } from './date';
import { isWritableUnit } from './units';

/**
 * How much of something to put on the shopping list, written by ONE rule.
 *
 * WHY THE SHOPPING LIST NEEDS A RULE OF ITS OWN: the shopping list is one
 * list, and six writers put lines on it — the Stock row, the Alerts screen
 * (once per item and once for all of them), the Meal Plan, the automatic
 * grocery list, the House Bot's bullet parser and the House Bot's own action.
 * Every line on that list has to be written the same way, or the list reads
 * as though it were two lists.
 *
 * It was not. The rules that produced the lines were:
 *
 *     the Alerts screen and the Stock row   formatQuantity(threshold, unit)
 *     the Meal Plan and the automatic list  `${needed}${unit}`
 *     the House Bot's bullet parser         `${qty} ${unit}`
 *     the House Bot's own action            whatever the model wrote
 *
 * — the second one splicing the number into the unit with nothing between
 * them, which is the spelling `formatQuantity` exists to prevent. So the
 * same shopping list could carry:
 *
 *     from the Alerts screen    "2 kg"
 *     from the Meal Plan       "2kg"
 *
 * for the same two kilos of the same thing. And a quantity of one with a
 * plural unit ran together as well, which is the other half of the rule:
 *
 *     from the Alerts screen    "1 pc"
 *     from the Meal Plan       "1pcs"
 *
 * and the two House Bot writers spelled it a third and a fourth way:
 *
 *     from the House Bot's parser   "1 pcs"
 *     from the House Bot's action   "1 pcs"
 *
 * WHY IT IS NOT THE SCREENS' OWN JOB: `formatQuantity` is the rule that
 * writes a quantity, and these two functions decide WHICH quantity a screen
 * means — the restock level of an item, or the shortfall a plan needs. That
 * decision is the same on every screen, so it is made once, here.
 *
 * WHY IT LIVES HERE AND NOT IN `date.ts`: `formatQuantity` is about how a
 * quantity is SPELLED and it belongs with the other wording rules. These are
 * about what the shopping list should SAY, and they are about the kitchen,
 * not about a date.
 */

/**
 * Spell a quantity the way the app spells every quantity.
 *
 * WHY IT TAKES FREE TEXT: the shopping list's writers do not all hold a
 * quantity the same way. The Stock row and the Alerts screen have a NUMBER
 * and a UNIT; the House Bot's bullet parser has a number and a unit it has
 * just lifted off the front of a line; and the House Bot's own action puts
 * the quantity in as ONE string — "2 packets" — because the bridge tells the
 * model it may write free text. Three shapes, one list.
 *
 * So this rule takes the string and writes it the app's way, and all of them
 * agree: "1 pc" beside "1 pc", not "1 pc" beside "1 pcs".
 *
 * WHY FREE TEXT IS LEFT ALONE: free text is free text. The model may write
 * "a pinch of salt" or "2 big packets", and those are not quantities the app
 * has a rule for — they are left exactly as they were written. Only a
 * quantity that is already a number and a unit is one.
 *
 * WHY A QUANTITY WRITTEN WITHOUT A SPACE IS ALSO ONE: the number and the
 * unit can be written together, and that spelling is the one the app's own
 * writers used to produce:
 *
 *     the Meal Plan       "2kg"
 *     the Alerts screen   "2 kg"
 *
 * The writers were fixed to spell it the app's way, but the HOUSEHOLD types
 * into the Add to shopping list form and the HOUSE BOT writes the model's
 * free text — and both can write "2kg". The rule only recognised a quantity
 * with a space in it, so the tight spelling reached the shopping list and
 * the list carried the same quantity two ways again:
 *
 *     the Stock row                   "2 kg"
 *     the Add to shopping list form   "2kg"
 *
 * WHY THE TIGHT SHAPE IS GATED ON THE APP KNOWING THE UNIT: "2kg" is a
 * number and a unit, but "3x" is a number and a letter, and "10k" is a number
 * and a letter. A space cannot tell them apart — the rule can only do it by
 * asking whether the word is a unit the app knows, and the app's own unit
 * table is the one place that answers. A word the table does not carry is
 * free text, and free text is left exactly as it was written.
 *
 * AND "KNOWING THE UNIT" MEANS WRITING IT, NOT CONVERTING IT: the app writes
 * "2 bottles" and "2 slices" and "2 packets" on the shopping list, and it
 * converts none of them. The gate asks whether the word is a unit the app
 * WRITES — `isWritableUnit` — so the kitchen's own units are re-spelled the
 * same way as the ones the app can measure in. See `WRITABLE_UNITS`.
 *
 * WHY A FRACTION IS LEFT ALONE: `formatQuantity` writes a NUMBER, and "1/2"
 * is not one. The household wrote "1/2 cup of sugar", and turning that into
 * "0.5 cup" would put a number the household never said on their shopping
 * list.
 *
 * @param text the quantity as it was written
 * @returns the quantity, spelled the app's way
 */
export const spellQuantity = (text: string): string => {
  const trimmed = text.trim();
  // WHY THE UNIT HAS TO BE ONE WORD: the rule decides whether the unit reads
  // as singular, and it decides that by the LAST WORD of what it is handed —
  // "pcs" -> "pc", "groceries" -> "grocerie". A unit IS one word, so the unit
  // here has to be one word as well.
  //
  // The House Bot writes its quantity as free text, so the model may write a
  // quantity that carries a phrase. A phrase is not a unit, and taking its
  // last word as the unit cut the household's own words off the end:
  //
  //     "1 bag of groceries"   ->   "1 bag of grocerie"
  //     "1 packet of spices"   ->   "1 packet of spice"
  //
  // The shopping list prints the quantity exactly as it was written, so the
  // household read the mangled word on the one screen they shop from — and
  // the count of one is what made it happen, because a count above one is
  // never made singular and so never reached this part of the rule.
  const spaced = /^(\d+(?:\.\d+)?)\s+(\S+)$/.exec(trimmed);
  if (spaced) return formatQuantity(Number(spaced[1]), spaced[2]);

  // The tight shape — "2kg" — is a quantity too, and it is spelled the same
  // way. The word after the number has to be a unit the app WRITES, or this
  // would rewrite "3x" into "3 x" and "10k" into "10 k".
  //
  // WHY IT IS "WRITES" AND NOT "CONVERTS": the question is whether the word
  // is a unit word, not whether the app can convert between dimensions. The
  // kitchen counts in bottles, packets, packs, cloves, slices, bunches and
  // handfuls, and the app writes every one of them — the stock unit field is
  // free text and the add form offers half of them — but it converts NONE of
  // them. Asking the convert question left the kitchen's own units out, and
  // the same quantity reached the shopping list two ways:
  //
  //     the Stock row                   "2 bottles"
  //     the Add to shopping list form   "2bottles"
  //
  // which is the defect this rule exists to end, still alive for every unit
  // the app writes but cannot measure in.
  const tight = /^(\d+(?:\.\d+)?)([A-Za-z]+)$/.exec(trimmed);
  if (tight && isWritableUnit(tight[2])) {
    return formatQuantity(Number(tight[1]), tight[2]);
  }

  return trimmed;
};

/**
 * The line for a stock item the household is running low on.
 *
 * THE AMOUNT: the low-stock threshold — the level the household asked to be
 * told about — and never less than one, because a line saying "0 kg" is not
 * something a person can shop for.
 *
 * WHY THE THRESHOLD AND NOT WHAT IS ON HAND: the threshold is the level the
 * kitchen is refilled TO, so it is the amount that goes on the list.
 *
 * WHY THE THRESHOLD IS NOT ROUNDED UP: the threshold is the household's own
 * number, and the app writes the household's numbers as they were given. A
 * household that set "low at 2.5 kg" was told 2.5, and rounding it to 3 kg
 * would put a quantity on the list that the household never asked for — and
 * would put a DIFFERENT one on the list depending on which screen it was
 * added from, which is the failure this rule exists to end.
 *
 * WHY THE THRESHOLD MAY BE ZERO: zero is the default for an item added by
 * the agent, and the household must still get a line they can shop for. A
 * threshold of zero means one.
 *
 * @param item the stock item the line is for
 * @returns the line — "2 kg", "1 pc", "2.5 kg", "1"
 */
export const groceryQuantityForStock = (
  item: Pick<StockItem, 'lowStockThreshold' | 'unit'>,
): string => {
  // WHY THE `|| 1` AND NOT JUST `Math.max`: `Math.max(1, NaN)` is NaN, and
  // a threshold that is not a number would put "NaN kg" on the shopping list.
  const threshold = item.lowStockThreshold || 1;
  return formatQuantity(Math.max(1, threshold), item.unit);
};

/**
 * The line for an ingredient the meal plan needs and the fridge does not
 * cover.
 *
 * WHY IT IS THE WEEK'S NEED, NOT THE SHORTFALL: the shopping list builder
 * sums the plan's ingredients and compares THAT with the shelf, and
 * `needed` is the sum — `src/types.ts` says so outright ("Total needed
 * across the week, already scaled by portion size"). `have` is the part the
 * fridge covers, and the app shows the two side by side: "need 2 kg · have
 * 1.5 kg". So the line carries the week's need, which is not the same
 * number as the difference.
 *
 * WHY THAT IS WORTH SAYING PLAINLY: an earlier version of this comment
 * claimed `needed` held the shortfall — the difference — and it does not. A
 * reader who believed that would expect "0.5 kg" on the list for an
 * ingredient the fridge half covers, and would hunt for a bug in the rule
 * below when it wrote "2 kg". The rule writes what it is given; how much a
 * line should carry is the plan's decision, not this one's.
 *
 * WHY IT IS WRITTEN BY THE APP'S OWN RULE: this is the line that used to be
 * built as `${needed}${unit}`, so the list said "2kg" and "1pcs" where the
 * rest of the app said "2 kg" and "1 pc". The number and the unit are
 * separated by a space, and a quantity of one is written singular — both by
 * `formatQuantity`, not by a template here.
 *
 * @param need the ingredient the line is for
 * @returns the line — "2 kg", "1 pc", "0.5 kg", "1"
 */
export const groceryQuantityForNeed = (
  need: Pick<ShoppingNeed, 'needed' | 'unit'>,
): string => formatQuantity(need.needed, need.unit);
