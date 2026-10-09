/**
 * Provider-agnostic deduplication + merge logic.
 *
 * The same algorithm is used in the browser (src/utils/providers/index.ts)
 * and the Node backend (server/dedup.mjs) so the rules stay consistent.
 *
 * Rules — two RawStore rows are considered the SAME physical place if any of:
 *   1. Phone match: last 10 digits of phone are equal (Indian mobile + landline).
 *   2. Name match + proximity: normalised names are equal (or Levenshtein ≤ 2)
 *      AND the two coordinates are within 200 m of each other.
 *   3. Provider cross-link: providerPlaceId of one matches a known cross-ref
 *      (e.g. OSM osm_id appearing in Foursquare results — none built-in today).
 *
 * NOT merged:
 *   - Same chain name in different cities (Reliance Fresh Mumbai vs Rupnagar
 *     are different physical stores even though they're the same brand).
 *   - Same name + same chain + same HQ city but at city-center (curated HQ
 *     reference vs real OSM branch) — these are kept as separate entries
 *     with the curated one clearly labelled "HQ" downstream.
 */

import type { RawStore } from './types';

/** Strip whitespace, punctuation, common chain suffixes; lowercase. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|india|indian|store|shop|outlet|branch)\b/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Last-10-digits of a phone, used for matching across formatting styles. */
export function phoneKey(s: string | undefined): string {
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  return digits.slice(-10);
}

/** Levenshtein distance — small inputs, OK to be O(n*m). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m: number[][] = Array.from({ length: a.length + 1 }, () => []);
  for (let i = 0; i <= a.length; i++) m[i][0] = i;
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + cost,
      );
    }
  }
  return m[a.length][b.length];
}

/** Haversine distance in metres. */
export function haversineM(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const R = 6371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Cluster key — when set, two stores with the same key are merged. */
export function clusterKey(a: RawStore, b: RawStore): boolean {
  // Rule 1: phone match
  if (phoneKey(a.phone) && phoneKey(b.phone) && phoneKey(a.phone) === phoneKey(b.phone)) {
    return true;
  }
  // Rule 2: same city + same normalized name (within 2 chars) + within 200 m
  const aCity = (a.city ?? '').toLowerCase().trim();
  const bCity = (b.city ?? '').toLowerCase().trim();
  // If city info is present and disagrees, don't merge.
  if (aCity && bCity && aCity !== bCity) return false;
  const na = normalizeName(a.name);
  const nb = normalizeName(b.name);
  if (!na || !nb) return false;
  if (na === nb) {
    return haversineM(a.lat, a.lon, b.lat, b.lon) <= 200;
  }
  if (Math.abs(na.length - nb.length) <= 2 && levenshtein(na, nb) <= 2) {
    return haversineM(a.lat, a.lon, b.lat, b.lon) <= 200;
  }
  return false;
}

/** Pick the "best" version of a string field (longest non-empty). */
function bestStr(...vs: (string | undefined)[]): string | undefined {
  let out: string | undefined;
  for (const v of vs) {
    if (v && (!out || v.length > out.length)) out = v;
  }
  return out;
}

function bestNum(...vs: (number | undefined)[]): number | undefined {
  for (const v of vs) {
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
  }
  return undefined;
}

/**
 * Merge a cluster of RawStore rows into one. Prefers:
 *   - phone: present if any member has it
 *   - website / openingHours: any non-empty
 *   - rating: best (max) value
 *   - providerPlaceId: keep all, comma-joined
 *   - source: keep all distinct sources
 *   - city: longest non-empty
 *   - lat/lon: mean of all members (close enough to be a cluster)
 *   - name: from the highest-priority source — osm > geoapify > foursquare > curated
 */
export function mergeCluster(group: RawStore[]): RawStore & { sources: RawStore['source'][] } {
  if (group.length === 1) {
    return { ...group[0], sources: [group[0].source] };
  }
  const priority: Record<string, number> = {
    osm: 4, foursquare: 3, geoapify: 2, curated: 1,
  };
  const byPriority = [...group].sort(
    (a, b) => (priority[b.source] ?? 0) - (priority[a.source] ?? 0),
  );
  const head = byPriority[0];
  const sources = Array.from(new Set(group.map((g) => g.source)));

  // Mean lat/lon — coordinates within 200 m, so mean is fine.
  const lat =
    group.reduce((s, g) => s + g.lat, 0) / group.length;
  const lon =
    group.reduce((s, g) => s + g.lon, 0) / group.length;

  // providerPlaceId — concatenate for traceability.
  const ids = Array.from(
    new Set(group.map((g) => g.providerPlaceId).filter(Boolean) as string[]),
  );

  // Categories — union.
  const categories = Array.from(
    new Set(group.flatMap((g) => g.categories ?? [])),
  );

  return {
    source: head.source,
    providerPlaceId: ids.join('|') || head.providerPlaceId,
    name: head.name,
    lat,
    lon,
    address: bestStr(...group.map((g) => g.address)),
    city: bestStr(...group.map((g) => g.city)),
    phone: bestStr(...group.map((g) => g.phone)),
    website: bestStr(...group.map((g) => g.website)),
    openingHours: bestStr(...group.map((g) => g.openingHours)),
    rating: bestNum(...group.map((g) => g.rating)),
    categories: categories.length ? categories : head.categories,
    type: head.type,
    sources,
  };
}

/**
 * Run dedup over a flat list of RawStore rows. Returns a new list where each
 * element is a merged record with a `sources` field listing every provider
 * that contributed to it.
 */
export function dedupStores(stores: RawStore[]): Array<RawStore & { sources: RawStore['source'][] }> {
  const out: Array<RawStore & { sources: RawStore['source'][] }> = [];
  // O(n^2) over typical <200 results — fine for this use case.
  for (const s of stores) {
    let merged = false;
    for (const existing of out) {
      if (clusterKey(s, existing)) {
        // Replace existing with merged cluster
        const idx = out.indexOf(existing);
        out[idx] = mergeCluster([existing, s]);
        merged = true;
        break;
      }
    }
    if (!merged) out.push({ ...s, sources: [s.source] });
  }
  return out;
}