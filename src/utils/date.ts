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
 * Make a unit singular without mangling it.
 *
 * The old one-liner (`unit.replace(/s$/, '')`) turned "glass" into "glas",
 * "dashes" into "dashe" and "pinches" into "pinche" — units people actually
 * type for a kitchen app. English plurals are not just "+s".
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

export const formatQuantity = (qty: number, unit?: string): string => {
  if (!unit) return `${qty}`;
  if (qty === 1) return `${qty} ${singularUnit(unit)}`;
  return `${qty} ${unit}`;
};
