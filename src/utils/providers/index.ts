/**
 * Multi-provider orchestrator (browser side).
 *
 * The browser ONLY runs providers that don't require a server-side API key:
 *   - OSM (Overpass + Photon) — public
 *   - Curated chain HQ list — built-in
 *
 * Geoapify + Foursquare are NEVER called from the browser. They run on the
 * server side in `server/providers/{geoapify,foursquare}.mjs`, exposed via
 * the `/api/stores/nearby` proxy endpoint. The public API entrypoint
 * `findNearbyStores` in `src/utils/nearbyStores.ts` calls this proxy when
 * `VITE_API_BASE_URL` is configured.
 *
 * Why this split: Geoapify and Foursquare terms forbid exposing their keys.
 * If we shipped the key in the static bundle (even via `import.meta.env`)
 * anyone could extract it. So keys stay on the backend, period.
 */

import { osmProvider } from './osm';
import { curatedProvider } from './curated';
import type { Provider, ProviderName, ProviderResult, RawStore, SearchParams } from './types';
import { dedupStores, haversineM } from './dedup';

export interface OrchestratorReport {
  stores: Array<RawStore & { sources: ProviderName[]; distanceM: number }>;
  providers: ProviderResult[];
  attributions: Array<{ label: string; url: string }>;
  totalMs: number;
}

export interface OrchestratorOptions {
  /** Show curated chain-HQ references as a supplement to OSM. */
  showChainHq?: boolean;
}

export async function searchAllProviders(
  lat: number, lon: number, radiusKm: number, limit = 20,
  options: OrchestratorOptions = {},
): Promise<OrchestratorReport> {
  const t0 = performance.now();
  const params: SearchParams = {
    lat, lon,
    radiusM: Math.max(1000, Math.round(radiusKm * 1000)),
    limit: Math.min(limit, 50),
  };

  // OSM is always on. Curated chain-HQ is opt-in via settings.showChainHq.
  const providers: Provider[] = [osmProvider];
  if (options.showChainHq) providers.push(curatedProvider);

  const settled = await Promise.allSettled(
    providers.map((p) => p.search(params)),
  );
  const providerResults: ProviderResult[] = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    return {
      source: providers[i].name,
      ok: false,
      stores: [],
      configured: true,
      error: (s.reason as Error)?.message ?? String(s.reason),
      ms: 0,
    };
  });

  const radiusFilter = (s: RawStore) =>
    haversineM(lat, lon, s.lat, s.lon) <= params.radiusM;

  const allStores: RawStore[] = [];
  for (const r of providerResults) {
    if (!r.ok) continue;
    for (const s of r.stores) {
      if (radiusFilter(s)) allStores.push(s);
    }
  }

  const merged = dedupStores(allStores);

  const withDistance = merged
    .map((s) => ({ ...s, distanceM: haversineM(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => {
      const aCurated = a.sources.length === 1 && a.sources[0] === 'curated';
      const bCurated = b.sources.length === 1 && b.sources[0] === 'curated';
      if (aCurated !== bCurated) return aCurated ? 1 : -1;
      return a.distanceM - b.distanceM;
    })
    .slice(0, params.limit);

  const attributions = providers
    .filter((p) => providerResults.find((r) => r.source === p.name && r.ok))
    .map((p) => p.attribution);

  return {
    stores: withDistance,
    providers: providerResults,
    attributions,
    totalMs: performance.now() - t0,
  };
}