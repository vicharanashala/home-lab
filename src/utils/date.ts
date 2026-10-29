import { differenceInCalendarDays, format, formatDistanceToNow, isValid, parseISO } from 'date-fns';
import type { StockItem } from '../types';

export const toISODate = (d: Date): string => format(d, 'yyyy-MM-dd');

export const parseDate = (iso?: string): Date | null => {
  if (!iso) return null;
  const d = parseISO(iso);
  return isValid(d) ? d : null;
};

export const daysUntil = (iso?: string): number | null => {
  const d = parseDate(iso);
  if (!d) return null;
  return differenceInCalendarDays(d, new Date());
};

export const formatExpiry = (iso?: string): string => {
  const d = parseDate(iso);
  if (!d) return 'No expiry set';
  return format(d, 'MMM d, yyyy');
};

export const formatExpiryShort = (iso?: string): string => {
  const d = parseDate(iso);
  if (!d) return '—';
  return format(d, 'MMM d');
};

export const formatRelative = (iso?: string): string => {
  const d = parseDate(iso);
  if (!d) return '';
  return formatDistanceToNow(d, { addSuffix: true });
};

export const todayISO = (): string => toISODate(new Date());

export const expiryBucket = (iso?: string, soonDays = 3): 'expired' | 'soon' | 'ok' | 'none' => {
  const days = daysUntil(iso);
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  if (days <= soonDays) return 'soon';
  return 'ok';
};

/**
 * The items about to go off, and how many there are.
 *
 * WHY ONE FUNCTION AND NOT A COUNT IN EACH SCREEN: the Dashboard says "4
 * items need attention", the Alerts screen says "Within 3 days (4)", and the
 * Meal Plan's rescue strip says "You have 4 things expiring in the next 3
 * days". Three screens answering one question must give one answer, so the
 * rule lives here and they all call it.
 *
 * WHY IT IS HERE AND NOT IN A COMPONENT: a count is a fact about the
 * household, not about a screen, and the screens are not all mounted at
 * once — the count has to be answerable from the stock and the window
 * alone. This is also the count the bridge sends to the model.
 *
 * THE RULE: an item is about to go off when its date has NOT passed and it
 * is inside the window. An item whose date has already passed is expired,
 * not expiring — the Alerts screen gives those their own group, and a
 * household must not be told it has four things to use up when two of them
 * went off last week.
 *
 * @param items the household's stock
 * @param soonDays the household's expiry window, in days
 * @returns the items that are about to go off, soonest first
 */
export const itemsExpiringSoon = (items: StockItem[], soonDays = 3): StockItem[] =>
  items
    .filter((it) => expiryBucket(it.expiryDate, soonDays) === 'soon')
    .sort((a, b) => (daysUntil(a.expiryDate) ?? 999) - (daysUntil(b.expiryDate) ?? 999));

/**
 * A count of days, with the word that goes with it.
 *
 * WHY ONE HELPER AND NOT A TERNARY IN EACH SCREEN: the household can
 * narrow the expiry window to a single day — the sliders on the Alerts
 * screen and on the Settings screen both start at 1 — and "the next 1
 * days" is not a sentence anyone wrote on purpose. The Meal Plan got that
 * right and the other places did not, so a household that had chosen the
 * narrowest window the app offers was shown "1 days" on the Alerts
 * screen, on the Dashboard and in Settings, while the Meal Plan said
 * "1 day". Four screens, one number, two answers.
 *
 * WHY IT LIVES HERE AND NOT IN A SCREEN: the window is a fact about the
 * household, and the screens are not all mounted at once — the phrase has
 * to be answerable from the number alone.
 *
 * WHY IT IS ABOUT DAYS AND NOT ABOUT THE WINDOW: the same rule has to
 * hold for any number of days the app writes, not only for the expiry
 * window, so the helper is named for what it writes rather than for the
 * setting that happens to use it most.
 *
 * @param days the number of days
 * @returns the number and its word — "1 day", "3 days"
 */
export const formatDays = (days: number): string =>
  `${days} ${days === 1 ? 'day' : 'days'}`;

/**
 * Make a unit singular without mangling it.
 *
 * The old one-liner (`unit.replace(/s$/, '')`) turned "glass" into "glas",
 * "dashes" into "dashe" and "pinches" into "pinche" — units people actually
 * type for a kitchen app. English plurals are not just "+s".
 *
 * WHY IT IS NOT EXPORTED: a caller that wants to write a quantity writes it
 * with `formatQuantity`, which is the rule that decides whether there IS a
 * unit, whether it is singular, and how it is spaced. A caller that spliced
 * the unit into a phrase of its own — the way the stock row's toasts used to —
 * could get any of those three wrong, and did: a missing unit left a hole
 * where the unit should have been ("Added 1  of Milk"). This is the spelling
 * rule; `formatQuantity` is the rule that writes a quantity.
 */
function singularUnit(unit: string): string {
  const u = unit.trim();
  if (!u) return unit;
  // -es plurals whose stem ends in a sibilant: dashes -> dash, pinches -> pinch.
  if (/(sh|ch|s|x|z)es$/i.test(u)) return u.slice(0, -2);
  // A plain -s: grams -> gram, bottles -> bottle, pcs -> pc. Words ending in
  // "ss" (glass) keep their ending.
  if (/[^s]s$/i.test(u) && !/(ss|sh|ch|x|z)s$/i.test(u)) return u.slice(0, -1);
  return u;
}

/**
 * How much of something, written out.
 *
 * WHY THE UNIT IS TRIMMED HERE AND NOWHERE ELSE: the unit field is free text
 * and nothing checks it — the add form only insists on a name — so a
 * household can save an item with no unit at all, or with a unit of nothing
 * but spaces. A unit that is not there must not leave a hole where it would
 * have been: the row's quantity read "2   " and its toast "Added 1    of
 * Milk", with the gap standing where the unit should be. And a unit typed
 * with a stray space around it (" Glass ") must read as "Glass", not as the
 * two-word "2  Glass ".
 *
 * WHY A BLANK UNIT IS NO UNIT: "2" is a whole quantity on its own. There is
 * nothing for the unit to be, so it is not written at all.
 *
 * WHY THE SINGULAR IS STILL SPELLED OUT: one of them reads "1 glass", never
 * "1 glasses". See `singularUnit`.
 *
 * @param qty how many
 * @param unit the unit, if there is one
 * @returns the quantity and its unit — "2 glass", "2 kg", "1", "2"
 */
export const formatQuantity = (qty: number, unit?: string): string => {
  const u = unit?.trim();
  if (!u) return `${qty}`;
  if (qty === 1) return `${qty} ${singularUnit(u)}`;
  return `${qty} ${u}`;
};
