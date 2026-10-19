import { differenceInCalendarDays, format, formatDistanceToNow, isValid, parseISO } from 'date-fns';

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
