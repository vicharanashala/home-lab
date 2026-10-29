import type { ShoppingNeed, StockItem } from '../types';
import { formatQuantity } from './date';

/**
 * How much of something to put on the shopping list, written by ONE rule.
 *
 * WHY THE SHOPPING LIST NEEDS A RULE OF ITS OWN: the shopping list is one
 * list, and four screens write into it — the Stock row, the Alerts screen
 * (once per item and once for all of them), the Meal Plan and the automatic
 * grocery list. Every line on that list has to be written the same way, or
 * the list reads as though it were two lists.
 *
 * It was not. The two rules that produced the lines were:
 *
 *     the Alerts screen and the Stock row   formatQuantity(threshold, unit)
 *     the Meal Plan and the automatic list  `${needed}${unit}`
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
