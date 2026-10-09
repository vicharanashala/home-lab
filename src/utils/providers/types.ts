/**
 * Shared types for the multi-provider location search.
 *
 * Designed to be portable — the same interfaces are used by the browser
 * provider modules (src/utils/providers/*.ts) and the Node backend
 * (server/providers/*.mjs). Both runtimes share dedup logic in
 * `src/utils/dedup.ts` and `server/dedup.mjs`.
 */

export type ProviderName = 'osm' | 'geoapify' | 'foursquare' | 'curated';

/** Display label for a place category (supermarket, kirana, mall, wholesale, chain). */
export type PlaceType = 'supermarket' | 'kirana' | 'mall' | 'wholesale' | 'chain';

/**
 * A normalised store shape produced by every provider before dedup runs.
 * Providers fill in whatever fields their API returns. Empty strings and
 * `undefined` are treated as missing.
 */
export interface RawStore {
  /** Which provider this record came from. */
  source: ProviderName;
  /** Stable ID from the provider (OSM osm_id, Foursquare fsq_id, etc.). */
  providerPlaceId?: string;
  name: string;
  lat: number;
  lon: number;
  /** Free-form address line, e.g. "Sector 17, Chandigarh". */
  address?: string;
  /** City / town / suburb. Used for context + dedup. */
  city?: string;
  /** Phone in any common format. Dedup normalises to digits-only. */
  phone?: string;
  website?: string;
  /** Opening hours text — providers return different formats, kept raw. */
  openingHours?: string;
  /** Star rating where the provider offers one. */
  rating?: number;
  /** Provider's own category tags (OSM shop=*, Foursquare categories[]). */
  categories?: string[];
  /** Inferred place type — the orchestrator computes this when missing. */
  type?: PlaceType;
  // ──── Optional enrichment fields ────
  /** Direct image URL from OSM `image` tag, if present. */
  osmImageUrl?: string;
  /** Wikidata Q-id (e.g. "Q12345") used to fetch photos via Wikimedia. */
  wikidataId?: string;
  /** OSM house number (addr:housenumber) for richer address display. */
  housenumber?: string;
  /** OSM street (addr:street). */
  street?: string;
  /** OSM postcode (addr:postcode). */
  postcode?: string;
  /** OSM suburb (addr:suburb). */
  suburb?: string;
}

/** Result envelope from a single provider call. */
export interface ProviderResult {
  source: ProviderName;
  ok: boolean;
  stores: RawStore[];
  /** Human-readable error if the call failed. */
  error?: string;
  /** True if the provider is properly configured for this environment. */
  configured: boolean;
  /** ms latency, for diagnostics. */
  ms: number;
}

/** Search parameters shared by every provider. */
export interface SearchParams {
  lat: number;
  lon: number;
  /** Radius in metres. */
  radiusM: number;
  /** Hard cap on results. Providers may return fewer. */
  limit: number;
  /** Optional AbortSignal for timeouts / cancel. */
  signal?: AbortSignal;
}

/** A provider module — every provider implements this. */
export interface Provider {
  name: ProviderName;
  /** Whether this provider has the credentials it needs in the current env. */
  isConfigured: (env?: Record<string, string | undefined>) => boolean;
  /** Perform a search and return a normalised ProviderResult. */
  search: (params: SearchParams, env?: Record<string, string | undefined>) => Promise<ProviderResult>;
  /** Attribution label + URL, must be shown to the user. */
  attribution: { label: string; url: string };
  /** Free-text note about licensing, caching policy, or usage caps. */
  termsNote?: string;
}