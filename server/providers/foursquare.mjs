// Foursquare Places provider — server side. Reads API key from env.

const URL = 'https://places-api.foursquare.com/places/search';

export function isFoursquareConfigured(env) {
  return Boolean(env?.FOURSQUARE_API_KEY);
}

export async function searchFoursquare(lat, lon, radiusM, limit, env) {
  const t0 = performance.now();
  const apiKey = env?.FOURSQUARE_API_KEY;
  if (!apiKey) {
    return {
      source: 'foursquare', ok: false, stores: [], configured: false,
      error: 'FOURSQUARE_API_KEY not set', ms: performance.now() - t0,
    };
  }
  try {
    const u = new URL(URL);
    u.searchParams.set('ll', `${lat},${lon}`);
    u.searchParams.set('radius', String(radiusM));
    u.searchParams.set('categories', '17069,17047,13034,19014,17144');
    u.searchParams.set('limit', String(Math.min(limit, 50)));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        source: 'foursquare', ok: false, stores: [], configured: true,
        error: `HTTP ${res.status}`, ms: performance.now() - t0,
      };
    }
    const json = await res.json();
    const out = [];
    for (const f of json.results ?? []) {
      const name = (f.name ?? '').trim();
      const lat_ = f.geocodes?.main?.latitude;
      const lon_ = f.geocodes?.main?.longitude;
      if (!name || lat_ == null || lon_ == null) continue;
      out.push({
        source: 'foursquare',
        providerPlaceId: f.fsq_place_id ?? `fsq:${Math.random()}`,
        name,
        lat: lat_, lon: lon_,
        address: f.location?.formatted_address ?? f.location?.address,
        city: f.location?.locality,
        phone: f.tel,
        website: f.website,
        openingHours: f.hours?.display,
        rating: f.rating,
        categories: f.categories?.map((c) => c.name),
        type: 'chain',
      });
    }
    return {
      source: 'foursquare', ok: true, stores: out, configured: true,
      ms: performance.now() - t0,
    };
  } catch (err) {
    return {
      source: 'foursquare', ok: false, stores: [], configured: true,
      error: err.message, ms: performance.now() - t0,
    };
  }
}

export const foursquareAttribution = { label: 'Powered by Foursquare', url: 'https://foursquare.com/' };
export const foursquareTermsNote = 'Free tier: 50,000 calls/month. Attribution required. Place data must NOT be stored or redistributed.';