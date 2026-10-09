// Shared dedup + merge logic (server side). Mirrors src/utils/providers/dedup.ts.
// Kept in plain JS so the backend has zero build step.

export function normalizeName(s) {
  return s
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|india|indian|store|shop|outlet|branch)\b/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function phoneKey(s) {
  if (!s) return '';
  const digits = String(s).replace(/\D/g, '');
  return digits.slice(-10);
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = Array.from({ length: a.length + 1 }, () => []);
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

export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function clusterKey(a, b) {
  if (phoneKey(a.phone) && phoneKey(b.phone) && phoneKey(a.phone) === phoneKey(b.phone)) return true;
  const aCity = (a.city ?? '').toLowerCase().trim();
  const bCity = (b.city ?? '').toLowerCase().trim();
  if (aCity && bCity && aCity !== bCity) return false;
  const na = normalizeName(a.name);
  const nb = normalizeName(b.name);
  if (!na || !nb) return false;
  const distOK = haversineM(a.lat, a.lon, b.lat, b.lon) <= 200;
  if (!distOK) return false;
  if (na === nb) return true;
  if (Math.abs(na.length - nb.length) <= 2 && levenshtein(na, nb) <= 2) return true;
  return false;
}

function bestStr(...vs) {
  let out;
  for (const v of vs) if (v && (!out || v.length > out.length)) out = v;
  return out;
}

function bestNum(...vs) {
  for (const v of vs) if (typeof v === 'number' && !Number.isNaN(v)) return v;
  return undefined;
}

export function mergeCluster(group) {
  if (group.length === 1) return { ...group[0], sources: [group[0].source] };
  const priority = { osm: 4, foursquare: 3, geoapify: 2, curated: 1 };
  const sorted = [...group].sort((a, b) => (priority[b.source] ?? 0) - (priority[a.source] ?? 0));
  const head = sorted[0];
  const sources = Array.from(new Set(group.map((g) => g.source)));
  const lat = group.reduce((s, g) => s + g.lat, 0) / group.length;
  const lon = group.reduce((s, g) => s + g.lon, 0) / group.length;
  const ids = Array.from(new Set(group.map((g) => g.providerPlaceId).filter(Boolean)));
  const categories = Array.from(new Set(group.flatMap((g) => g.categories ?? [])));
  return {
    source: head.source,
    providerPlaceId: ids.join('|') || head.providerPlaceId,
    name: head.name,
    lat, lon,
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

export function dedupStores(stores) {
  const out = [];
  for (const s of stores) {
    let merged = false;
    for (const existing of out) {
      if (clusterKey(s, existing)) {
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