/**
 * OpenStreetMap provider — uses Overpass API for POI lookups (richer than
 * Photon's text-search) with Photon as a fast text fallback. Public, no key.
 *
 * Returns all shops tagged as shop=supermarket|convenience|department_store|
 * wholesale|mall within the radius. Curated entries come from a separate
 * provider (curated.ts).
 *
 * Attribution: OpenStreetMap contributors, ODbL licence.
 * Caching policy: per Overpass's published guidance, client-side caching is
 * allowed for up to a few minutes; we don't cache here — every search is live.
 */

import type { Provider, ProviderResult, RawStore, SearchParams } from './types';

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

interface OsmShop {
  id: number;
  osmType: 'node' | 'way' | 'relation';
  lat: number;
  lon: number;
  name: string;
  osmValue?: string;
  city?: string;
  countrycode?: string;
  phone?: string;
  website?: string;
  openingHours?: string;
  image?: string;
  wikidata?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  suburb?: string;
}

interface PhotonFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    city?: string;
    country?: string;
    countrycode?: string;
    street?: string;
    postcode?: string;
    phone?: string;
    'contact:phone'?: string;
    website?: string;
    'contact:website'?: string;
  };
}

const TYPE_FOR_OSM: Record<string, RawStore['type']> = {
  supermarket: 'chain',
  convenience: 'kirana',
  department_store: 'chain',
  wholesale: 'wholesale',
  mall: 'mall',
};
const TYPE_FOR_NAME: Array<{ match: RegExp; type: RawStore['type'] }> = [
  { match: /big bazaar|reliance|jio ?mart|dmart|d-mart|spencer|more|nature|heritage|nilgiris|star bazaar|big bazar|easyday|lifestyle|foodhall/i, type: 'chain' },
  { match: /mall|shopping centre|shoppers|select citywalk|inorbit|phoenix|ambience|forum|elante|tricity/i, type: 'mall' },
  { match: /kirana|general store|grocery|provision|atac|mini ?mart/i, type: 'kirana' },
];

function inferType(name: string, osmValue: string | undefined): RawStore['type'] {
  if (osmValue && TYPE_FOR_OSM[osmValue]) return TYPE_FOR_OSM[osmValue];
  for (const r of TYPE_FOR_NAME) if (r.match.test(name)) return r.type;
  return 'kirana';
}

async function queryOverpass(
  lat: number, lon: number, radiusM: number, signal?: AbortSignal,
): Promise<OsmShop[]> {
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
    if (signal) signal.addEventListener('abort', () => ctrl.abort());
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'text/plain',
          'User-Agent': 'HomeHub/1.0',
        },
        body: q,
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        elements?: Array<{
          id: number;
          type: 'node' | 'way' | 'relation';
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
          tags?: Record<string, string>;
        }>;
      };
      const out: OsmShop[] = [];
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
          id: el.id,
          osmType: el.type,
          lat: lat_, lon: lon_,
          name,
          osmValue: tags.shop,
          city: tags['addr:city'] || tags['addr:suburb'] || tags['addr:town'] || tags['addr:village'],
          countrycode: tags['addr:country'] || 'IN',
          phone: tags.phone || tags['contact:phone'],
          website: tags.website || tags['contact:website'],
          openingHours: tags.opening_hours,
          // Enrichment fields for the detail modal
          image: tags.image,
          wikidata: tags.wikidata,
          housenumber: tags['addr:housenumber'],
          street: tags['addr:street'],
          postcode: tags['addr:postcode'],
          suburb: tags['addr:suburb'],
        });
      }
      return out;
    } catch {
      // try next endpoint
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

async function queryPhoton(
  term: string, lon: number, lat: number, radiusM: number, signal?: AbortSignal,
): Promise<RawStore[]> {
  const url = `${PHOTON_URL}?q=${encodeURIComponent(term)}&lat=${lat}&lon=${lon}&limit=10`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9_000);
  if (signal) signal.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 HomeHub/1.0' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { features: PhotonFeature[] };
    const out: RawStore[] = [];
    const seen = new Set<string>();
    for (const f of json.features ?? []) {
      const name = (f.properties.name ?? '').trim();
      if (!name) continue;
      const cc = f.properties.countrycode;
      if (cc && cc.toLowerCase() !== 'in') continue;
      const [lon_, lat_] = f.geometry.coordinates;
      // approx distance via cosine (good enough for filtering)
      const distM = Math.hypot(
        (lat_ - lat) * 111_000,
        (lon_ - lon) * 111_000 * Math.cos((lat * Math.PI) / 180),
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
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const osmProvider: Provider = {
  name: 'osm',
  isConfigured: () => true, // public, no key
  attribution: {
    label: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
  },
  termsNote: 'ODbL licence — must credit OpenStreetMap; no permanent storage of OSM data outside app context.',
  search: async (p: SearchParams): Promise<ProviderResult> => {
    const t0 = performance.now();
    try {
      const [overpassRaw, photonFlat] = await Promise.all([
        queryOverpass(p.lat, p.lon, p.radiusM, p.signal),
        Promise.all(SEARCH_TERMS.map((t) => queryPhoton(t, p.lon, p.lat, p.radiusM, p.signal))).then((arr) => arr.flat()),
      ]);
      const stores: RawStore[] = [];
      const seen = new Set<string>();
      for (const s of overpassRaw) {
        const key = `${s.osmType}-${s.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        stores.push({
          source: 'osm',
          providerPlaceId: `osm:${s.osmType}/${s.id}`,
          name: s.name,
          lat: s.lat, lon: s.lon,
          city: s.city,
          phone: s.phone,
          website: s.website,
          openingHours: s.openingHours,
          type: inferType(s.name, s.osmValue),
          categories: s.osmValue ? [s.osmValue] : undefined,
          // Enrichment for detail modal
          osmImageUrl: s.image,
          wikidataId: s.wikidata,
          housenumber: s.housenumber,
          street: s.street,
          postcode: s.postcode,
          suburb: s.suburb,
        });
      }
      // Add Photon results, dedup by name
      const nameKeys = new Set(stores.map((s) => s.name.toLowerCase()));
      for (const p2 of photonFlat) {
        const k = p2.name.toLowerCase();
        if (nameKeys.has(k)) continue;
        nameKeys.add(k);
        stores.push(p2);
      }
      // Trim to limit
      const sliced = stores.slice(0, p.limit);
      return {
        source: 'osm', ok: true, stores: sliced, configured: true,
        ms: performance.now() - t0,
      };
    } catch (err) {
      return {
        source: 'osm', ok: false, stores: [], configured: true,
        error: (err as Error).message, ms: performance.now() - t0,
      };
    }
  },
};