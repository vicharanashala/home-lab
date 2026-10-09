/** Tiny non-crypto unique id — fine for client-side ids in localStorage. */
export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
