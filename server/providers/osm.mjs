// OSM (Overpass + Photon) provider — server side.

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

const PHOTON_URL = 'https://photon.komoot.io/api';
const SEARCH_TERMS = [
  'Reliance Fresh', 'Big Bazaar', 'D-Mart', 'Jio Mart', 'JioMart',
  "Spencer's", 'More', 'Star Bazaar', 'Heritage', "Nature's Basket",
  'Nilgiris', 'Easyday', 'supermarket', 'kirana', 'grocery',
];

const TYPE_FOR_OSM = {
  supermarket: 'chain',
  convenience: 'kirana',
  department_store: 'chain',
  wholesale: 'wholesale',
  mall: 'mall',
};
const TYPE_FOR_NAME = [
  { match: /big bazaar|reliance|jio ?mart|dmart|d-mart|spencer|more|nature|heritage|nilgiris|star bazaar|big bazar|easyday|lifestyle|foodhall/i, type: 'chain' },
  { match: /mall|shopping centre|shoppers|select citywalk|inorbit|phoenix|ambience|forum|elante|tricity/i, type: 'mall' },
  { match: /kirana|general store|grocery|provision|atac|mini ?mart/i, type: 'kirana' },
];

function inferType(name, osmValue) {
  if (osmValue && TYPE_FOR_OSM[osmValue]) return TYPE_FOR_OSM[osmValue];
  for (const r of TYPE_FOR_NAME) if (r.match.test(name)) return r.type;
  return 'kirana';
}

async function queryOverpass(lat, lon, radiusM) {
  const around = `around:${radiusM},${lat},${lon}`;
  const q = `
[out:json][timeout:18];
(
  node["shop"="supermarket"](${around});
  node["shop"="convenience"](${around});
  node["shop"="department_store"](${around});
  node["shop"="wholesale"](${around});
  node["shop"="mall"](${around});
  way["shop"="supermarket"](${around});
  way["shop"="convenience"](${around});
  way["shop"="department_store"](${around});
  way["shop"="wholesale"](${around});
  way["shop"="mall"](${around});
);
out center tags;
`;
  for (const url of OVERPASS_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 18_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'text/plain', 'User-Agent': 'HomeHub/1.0' },
        body: q,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json = await res.json();
      const out = [];
      for (const el of json.elements ?? []) {
        const tags = el.tags ?? {};
        const name = (tags.name ?? tags['name:en'] ?? '').trim();
        if (!name) continue;
        const cc = (tags['addr:country'] || tags['ISO3166-1'] || '').toLowerCase();
        if (cc && cc !== 'in') continue;
        const lat_ = el.lat ?? el.center?.lat;
        const lon_ = el.lon ?? el.center?.lon;
        if (lat_ == null || lon_ == null) continue;
        out.push({
          id: el.id, osmType: el.type, lat: lat_, lon: lon_, name,
          osmValue: tags.shop,
          city: tags['addr:city'] || tags['addr:suburb'] || tags['addr:town'] || tags['addr:village'],
          phone: tags.phone || tags['contact:phone'],
          website: tags.website || tags['contact:website'],
          openingHours: tags.opening_hours,
        });
      }
      return out;
    } catch {
      clearTimeout(timer);
    }
  }
  return [];
}

async function queryPhoton(term, lon, lat, radiusM) {
  const url = `${PHOTON_URL}?q=${encodeURIComponent(term)}&lat=${lat}&lon=${lon}&limit=10`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'HomeHub/1.0' },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = await res.json();
    const out = [];
    const seen = new Set();
    for (const f of json.features ?? []) {
      const name = (f.properties.name ?? '').trim();
      if (!name) continue;
      const cc = f.properties.countrycode;
      if (cc && cc.toLowerCase() !== 'in') continue;
      const [lon_, lat_] = f.geometry.coordinates;
      const distM = Math.hypot(
        (lat_ - lat) * 111000,
        (lon_ - lon) * 111000 * Math.cos((lat * Math.PI) / 180),
      );
      if (distM > radiusM) continue;
      const id = `${f.properties.osm_type ?? 'n'}-${f.properties.osm_id ?? Math.random()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        source: 'osm',
        providerPlaceId: `osm:${f.properties.osm_type ?? 'n'}/${f.properties.osm_id}`,
        name,
        lat: lat_, lon: lon_,
        city: f.properties.city,
        address: f.properties.street,
        phone: f.properties.phone || f.properties['contact:phone'],
        website: f.properties.website || f.properties['contact:website'],
        type: inferType(name, f.properties.osm_value),
        categories: f.properties.osm_value ? [f.properties.osm_value] : undefined,
      });
    }
    return out;
  } catch {
    clearTimeout(timer);
    return [];
  }
}

export async function searchOsm(lat, lon, radiusM, limit) {
  const t0 = performance.now();
  try {
    const [overpassRaw, photonFlat] = await Promise.all([
      queryOverpass(lat, lon, radiusM),
      Promise.all(SEARCH_TERMS.map((t) => queryPhoton(t, lon, lat, radiusM))).then((a) => a.flat()),
    ]);
    const stores = [];
    const seen = new Set();
    for (const s of overpassRaw) {
      const key = `${s.osmType}-${s.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stores.push({
        source: 'osm',
        providerPlaceId: `osm:${s.osmType}/${s.id}`,
        name: s.name,
        lat: s.lat, lon: s.lon,
        city: s.city, phone: s.phone, website: s.website, openingHours: s.openingHours,
        type: inferType(s.name, s.osmValue),
        categories: s.osmValue ? [s.osmValue] : undefined,
      });
    }
    const nameKeys = new Set(stores.map((s) => s.name.toLowerCase()));
    for (const p of photonFlat) {
      const k = p.name.toLowerCase();
      if (nameKeys.has(k)) continue;
      nameKeys.add(k);
      stores.push(p);
    }
    return {
      source: 'osm', ok: true, stores: stores.slice(0, limit), configured: true,
      ms: performance.now() - t0,
    };
  } catch (err) {
    return {
      source: 'osm', ok: false, stores: [], configured: true,
      error: err.message, ms: performance.now() - t0,
    };
  }
}

export const osmAttribution = { label: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' };
export const osmTermsNote = 'ODbL licence — credit OpenStreetMap; no permanent storage outside app context.';