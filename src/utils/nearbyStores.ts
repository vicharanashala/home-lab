/**
 * Public API for the Stores page.
 *
 * Internally delegates to `searchAllProviders` in `src/utils/providers/`.
 * The Stores page imports from here so the rest of the app is unaffected
 * by the provider refactor.
 *
 * When the backend proxy is configured (`VITE_API_BASE_URL` is set), the
 * server runs all 4 providers and returns a pre-merged JSON. Otherwise the
 * browser falls back to direct Overpass + curated (no keys needed).
 */

import { searchAllProviders, type OrchestratorReport } from './providers';
import type { PlaceType } from './providers/types';

export type NearbyStore = {
  id: string;
  name: string;
  type: PlaceType;
  typeLabel: string;
  subtitle?: string;
  city?: string;
  lat: number;
  lon: number;
  distanceM: number;
  source: 'osm' | 'curated' | 'geoapify' | 'foursquare';
  /** All providers that contributed to this record. */
  sources: Array<'osm' | 'curated' | 'geoapify' | 'foursquare'>;
  /** Optional contact details. */
  address?: string;
  phone?: string;
  website?: string;
  openingHours?: string;
  rating?: number;
  /** Stable provider place ID (for debugging + future deep links). */
  providerPlaceId?: string;
  /** OSM enrichment for the detail modal. */
  osmImageUrl?: string;
  wikidataId?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  suburb?: string;
  categories?: string[];
};

const TYPE_META: Record<PlaceType, { emoji: string; label: string; tint: string }> = {
  chain: { emoji: '🛒', label: 'Chain', tint: 'bg-sage-100 text-sage-700 dark:bg-sage-900/40 dark:text-sage-200' },
  supermarket: { emoji: '🛒', label: 'Supermarket', tint: 'bg-sage-100 text-sage-700 dark:bg-sage-900/40 dark:text-sage-200' },
  kirana: { emoji: '🏪', label: 'Kirana', tint: 'bg-butter-100 text-butter-800 dark:bg-butter-900/30 dark:text-butter-200' },
  mall: { emoji: '🏬', label: 'Mall', tint: 'bg-tomato-100 text-tomato-700 dark:bg-tomato-900/30 dark:text-tomato-300' },
  wholesale: { emoji: '📦', label: 'Wholesale', tint: 'bg-ink-700 text-cream-50' },
};

export const getTypeMeta = (t: PlaceType) => TYPE_META[t];

export function formatDistance(metres: number): string {
  if (metres < 1_000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

export interface FindResult {
  stores: NearbyStore[];
  providers: OrchestratorReport['providers'];
  attributions: OrchestratorReport['attributions'];
  totalMs: number;
}

export async function findNearbyStores(
  lat: number,
  lon: number,
  radiusKm = 5,
  limit = 8,
): Promise<NearbyStore[]> {
  const report = await findNearbyStoresWithReport(lat, lon, radiusKm, limit);
  return report.stores;
}

/** Variant that exposes per-provider diagnostics — used by the Stores page
 *  to render attribution + errors if the user wants to know. */
export async function findNearbyStoresWithReport(
  lat: number,
  lon: number,
  radiusKm = 5,
  limit = 8,
  options: { showChainHq?: boolean } = {},
): Promise<FindResult> {
  // Backend path — only used when the user has set VITE_API_BASE_URL.
  const apiBase = readApiBase();
  if (apiBase) {
    try {
      const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        radiusKm: String(radiusKm),
        limit: String(limit),
      });
      if (options.showChainHq) params.set('showChainHq', '1');
      const url = `${apiBase}/api/stores/nearby?${params}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 18_000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const json = (await res.json()) as FindResult;
        return json;
      }
    } catch {
      // fall through to direct OSM
    }
  }

  // Browser-only path.
  const report = await searchAllProviders(lat, lon, radiusKm, limit, {
    showChainHq: options.showChainHq,
  });
  const stores: NearbyStore[] = report.stores.map((s) => {
    const t = (s.type ?? 'kirana') as PlaceType;
    return {
      id: `${s.source}:${s.providerPlaceId ?? `${s.lat},${s.lon}`}`,
      name: s.name,
      type: t,
      typeLabel: TYPE_META[t].label,
      subtitle: s.city,
      lat: s.lat,
      lon: s.lon,
      distanceM: s.distanceM,
      source: s.sources[0] ?? s.source,
      sources: s.sources,
      address: s.address,
      phone: s.phone,
      website: s.website,
      openingHours: s.openingHours,
      rating: s.rating,
      providerPlaceId: s.providerPlaceId,
      osmImageUrl: s.osmImageUrl,
      wikidataId: s.wikidataId,
      housenumber: s.housenumber,
      street: s.street,
      postcode: s.postcode,
      suburb: s.suburb,
      categories: s.categories,
    };
  });
  return {
    stores,
    providers: report.providers,
    attributions: report.attributions,
    totalMs: report.totalMs,
  };
}

function readApiBase(): string | null {
  try {
    // @ts-expect-error import.meta.env is provided by Vite at build time
    const v = import.meta.env?.VITE_API_BASE_URL as string | undefined;
    return v && v.length > 0 ? v.replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}