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

export const formatQuantity = (qty: number, unit?: string): string => {
  if (!unit) return `${qty}`;
  if (qty === 1) return `${qty} ${unit.replace(/s$/, '')}`;
  return `${qty} ${unit}`;
};
