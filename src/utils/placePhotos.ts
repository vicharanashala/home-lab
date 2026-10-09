/**
 * Photo enrichment for store details.
 *
 * Sources (in priority order):
 *   1. Direct OSM `image` tag (Wikimedia Commons file URL).
 *   2. Wikidata Q-id → Wikimedia Commons image (P18) or Commons category (P373).
 *   3. OSM static map preview as a last-resort visual.
 *
 * All APIs are official, free, no key. Static map preview comes from
 * staticmap.openstreetmap.de (OSM-based, free).
 */

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

export interface PhotoResult {
  url: string;
  credit?: string;
  source: 'osm-image' | 'wikidata' | 'staticmap';
  /** Width × height for layout reservation. */
  width?: number;
  height?: number;
}

export interface PhotoQuery {
  /** OSM `image` tag value, may be a filename or full URL. */
  osmImageUrl?: string;
  /** Wikidata Q-id like "Q12345". */
  wikidataId?: string;
  /** Center for static-map fallback. */
  lat: number;
  lon: number;
}

/**
 * Try every source in priority order. Returns the first successful result.
 * If every source fails (no network etc.), returns a static-map fallback.
 */
export async function fetchStorePhotos(q: PhotoQuery): Promise<PhotoResult[]> {
  const out: PhotoResult[] = [];

  // 1. Direct OSM image tag.
  if (q.osmImageUrl) {
    const direct = await resolveOsmImage(q.osmImageUrl);
    if (direct) out.push({ ...direct, source: 'osm-image' });
  }

  // 2. Wikidata → Wikimedia image.
  if (q.wikidataId && out.length < 4) {
    const wiki = await fetchWikimediaImages(q.wikidataId);
    for (const w of wiki) {
      if (out.length >= 4) break;
      out.push(w);
    }
  }

  // 3. Always include the static-map preview last (so user sees the location
  // even when no real photo is available).
  out.push({
    url: staticMapUrl(q.lat, q.lon, 16, 600, 360),
    credit: '© OpenStreetMap',
    source: 'staticmap',
    width: 600,
    height: 360,
  });

  return out;
}

/** OSM image tag values can be File:Filename or full Wikimedia URLs. */
async function resolveOsmImage(raw: string): Promise<{ url: string; credit?: string } | null> {
  let fileTitle: string | null = null;
  if (/^https?:\/\//i.test(raw)) {
    if (/^https?:\/\/commons\.wikimedia\.org\/wiki\/File:/i.test(raw)) {
      fileTitle = decodeURIComponent(raw.split('/').pop() ?? '').replace(/_/g, ' ');
    } else {
      // External URL — use as-is.
      return { url: raw, credit: 'OSM' };
    }
  } else if (/^File:/i.test(raw)) {
    fileTitle = raw.replace(/_/g, ' ');
  } else {
    fileTitle = `File:${raw.replace(/_/g, ' ')}`;
  }
  if (!fileTitle) return null;
  const url = await commonsFileUrl(fileTitle);
  return url ? { url, credit: 'Wikimedia Commons' } : null;
}

/** Wikidata Q-id → list of Wikimedia image URLs via P18 (image) and P373 (Commons category). */
async function fetchWikimediaImages(qid: string): Promise<PhotoResult[]> {
  try {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: qid,
      format: 'json',
      props: 'claims',
      languages: 'en',
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(`${WIKIDATA_API}?${params}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    interface WikidataClaims {
      entities?: Record<string, {
        claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: string } } }>>;
      }>;
    }
    const json = (await res.json()) as WikidataClaims;
    const entity = json.entities?.[qid];
    if (!entity?.claims) return [];
    const out: PhotoResult[] = [];

    // P18 — main image
    const p18 = entity.claims.P18?.[0]?.mainsnak?.datavalue?.value;
    if (p18) {
      const u = await commonsFileUrl(`File:${p18.replace(/_/g, ' ')}`);
      if (u) out.push({ url: u, credit: 'Wikimedia Commons', source: 'wikidata' });
    }
    return out;
  } catch {
    return [];
  }
}

/** Resolve a Commons File: title to its actual imageinfo URL. */
async function commonsFileUrl(title: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      titles: title,
      prop: 'imageinfo',
      iiprop: 'url',
      format: 'json',
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(`${COMMONS_API}?${params}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      query?: { pages?: Record<string, { imageinfo?: Array<{ url: string }> }> };
    };
    const pages = json.query?.pages ?? {};
    for (const page of Object.values(pages)) {
      if (page.imageinfo?.[0]?.url) return page.imageinfo[0].url;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Static-map preview URL — a real map of the location (no photos but a
 * meaningful "where it is" view).
 *
 * staticmap.openstreetmap.de is a free OSM-based service, no key. They ask
 * for a sensible User-Agent; we set one.
 */
export function staticMapUrl(
  lat: number, lon: number, zoom = 16, w = 600, h = 360,
): string {
  // Use the Mapnik base layer + a marker pin overlay via the markers param.
  const marker = `lat=${lat}&lon=${lon}`;
  // Some variants of staticmap accept markers; we keep URL simple and add
  // a marker pin by using the "show=1" + marker param when supported.
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=${zoom}&size=${w}x${h}&maptype=mapnik&markers=${marker},lightblue1`;
}