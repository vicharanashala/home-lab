// Geoapify Places provider — server side. Reads API key from env.

const URL = 'https://api.geoapify.com/v2/places';
const CATEGORIES = [
  'commercial.supermarket',
  'commercial.convenience',
  'commercial.marketplace',
  'commercial.shopping_mall',
  'commercial.wholesale',
];

export function isGeoapifyConfigured(env) {
  return Boolean(env?.GEOAPIFY_API_KEY);
}

export async function searchGeoapify(lat, lon, radiusM, limit, env) {
  const t0 = performance.now();
  const apiKey = env?.GEOAPIFY_API_KEY;
  if (!apiKey) {
    return {
      source: 'geoapify', ok: false, stores: [], configured: false,
      error: 'GEOAPIFY_API_KEY not set', ms: performance.now() - t0,
    };
  }
  try {
    const u = new URL(URL);
    u.searchParams.set('categories', CATEGORIES.join(','));
    u.searchParams.set('filter', `circle:${radiusM},${lon},${lat}`);
    u.searchParams.set('bias', `proximity:${lon},${lat}`);
    u.searchParams.set('limit', String(Math.min(limit, 50)));
    u.searchParams.set('apiKey', apiKey);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        source: 'geoapify', ok: false, stores: [], configured: true,
        error: `HTTP ${res.status}`, ms: performance.now() - t0,
      };
    }
    const json = await res.json();
    const out = [];
    for (const f of json.features ?? []) {
      const name = (f.properties.name ?? '').trim();
      if (!name) continue;
      const [lon_, lat_] = f.geometry.coordinates;
      out.push({
        source: 'geoapify',
        providerPlaceId: f.properties.place_id
          ?? `geoapify:${f.properties.datasource?.raw?.osm_id ?? Math.random()}`,
        name,
        lat: lat_, lon: lon_,
        address: f.properties.formatted ?? f.properties.address_line1,
        city: f.properties.city ?? f.properties.town ?? f.properties.village ?? f.properties.suburb,
        phone: f.properties.contact?.phone,
        website: f.properties.contact?.website,
        openingHours: f.properties.opening_hours,
        rating: f.properties.rating,
        categories: f.properties.categories,
        type: 'chain',
      });
    }
    return {
      source: 'geoapify', ok: true, stores: out, configured: true,
      ms: performance.now() - t0,
    };
  } catch (err) {
    return {
      source: 'geoapify', ok: false, stores: [], configured: true,
      error: err.message, ms: performance.now() - t0,
    };
  }
}

export const geoapifyAttribution = { label: 'Powered by Geoapify', url: 'https://www.geoapify.com/' };
export const geoapifyTermsNote = 'Free tier: 3,000 credits/day. 1 Place API call ≈ 1 credit. Attribution required.';