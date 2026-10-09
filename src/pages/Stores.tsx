import { useEffect, useRef, useState } from 'react';
import {
  MapPin,
  RefreshCcw,
  AlertTriangle,
  Navigation,
  Loader2,
  Phone,
  Globe,
  Settings as SettingsIcon,
  ChevronRight,
  Languages,
  Star,
  Search,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store/useStore';
import { StoreTypeIcon } from '../components/icons/AppIcons';
import { TopBar } from '../components/TopBar';
import { StoreDetailModal } from '../components/StoreDetailModal';
import {
  findNearbyStoresWithReport,
  formatDistance,
  getTypeMeta,
  type NearbyStore,
  type FindResult,
} from '../utils/nearbyStores';
import { requestGeolocation } from '../utils/consent';

type Status = 'idle' | 'requesting' | 'loading' | 'ready' | 'denied' | 'unavailable' | 'error';

type SortKey = 'distance' | 'name';
type FilterKey = 'all' | NearbyStore['type'];

const RADII = [1, 2, 5, 10, 25];
const FILTERS: { id: FilterKey; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'chain', label: '🛒 Chains' },
  { id: 'kirana', label: '🏪 Kirana' },
  { id: 'mall', label: '🏬 Malls' },
];

export function StoresPage() {
  const { settings, toast, updateSettings } = useStore();
  const locationEnabled = settings.consents?.location ?? false;
  const showChainHq = settings.showChainHq ?? false;

  const [status, setStatus] = useState<Status>('idle');
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [report, setReport] = useState<FindResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  const [sortKey, setSortKey] = useState<SortKey>('distance');
  const [selectedStore, setSelectedStore] = useState<NearbyStore | null>(null);
  // Monotonic request id — stale fetches (older id) get ignored when they
  // resolve, preventing a slow earlier fetch from overwriting a newer one.
  // We use a ref so the comparison reads the LATEST value (not a stale
  // closure-captured one) — using state here caused every fetch to abandon
  // itself because state updates are async.
  const requestIdRef = useRef(0);

  const runSearch = async (lat: number, lon: number, km: number, includeChainHq?: boolean) => {
    const myId = requestIdRef.current + 1;
    requestIdRef.current = myId;
    setStatus('loading');
    const result = await findNearbyStoresWithReport(lat, lon, km, 20, {
      showChainHq: includeChainHq ?? showChainHq,
    });
    if (myId !== requestIdRef.current) return;
    setStores(result.stores);
    setReport(result);
    setStatus('ready');
  };

  const load = async (overrideRadius?: number) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      return;
    }
    const myId = requestIdRef.current + 1;
    requestIdRef.current = myId;
    setStatus('requesting');
    setError(null);
    try {
      const pos = await requestGeolocation();
      if (myId !== requestIdRef.current) return; // newer fetch started
      if (!pos) {
        setStatus('denied');
        return;
      }
      setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      const r = overrideRadius ?? radiusKm;
      await runSearch(pos.coords.latitude, pos.coords.longitude, r);
    } catch (err) {
      if (myId !== requestIdRef.current) return;
      setError((err as Error).message);
      setStatus('error');
    }
  };

  const handleRadiusChange = (km: number) => {
    setRadiusKm(km);
    if (status === 'ready' && coords) {
      void runSearch(coords.lat, coords.lon, km);
    }
  };

  // Filter + sort.
  const visible = stores
    .filter((s) => filterKey === 'all' || s.type === filterKey)
    .sort((a, b) =>
      sortKey === 'distance'
        ? a.distanceM - b.distanceM
        : a.name.localeCompare(b.name),
    );

  // Show the empty-state CTA when location is OFF, or when user hasn't fetched yet.
  if (!locationEnabled || status === 'idle') {
    return (
      <>
        <TopBar
          title="Stores near you"
          subtitle={
            locationEnabled
              ? 'Tap Find stores to use your location'
              : 'Enable location in Settings to see nearby shops'
          }
        />
        <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-4 pb-28 sm:pb-10 space-y-4">
          <section className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-9 h-9 rounded-xl bg-sage-100 text-sage-700 grid place-items-center">
                <MapPin size={18} />
              </span>
              <div>
                <h2 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">
                  Find shops within walking distance
                </h2>
                <p className="text-xs text-sage-500 dark:text-ink-300">
                  Adjustable radius · filter by type · sourced from OpenStreetMap
                </p>
              </div>
            </div>
            <p className="text-sm text-sage-600 dark:text-ink-200 leading-relaxed mb-4">
              We'll ask your browser for your location, then look up to 20
              nearby shops using the Photon / OpenStreetMap API. Real chain
              locations when available, with a curated list of major Indian
              grocery chains as a fallback.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              disabled={status === 'requesting'}
              className="btn-primary w-full !py-3"
            >
              <Navigation size={16} />
              {status === 'requesting' ? 'Locating…' : 'Find stores near me'}
            </button>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title="Stores near you"
        subtitle={
          coords
            ? `From your location · ${stores.length} found within ${radiusKm} km`
            : 'Tap refresh to fetch nearby shops'
        }
      />
      <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-4 pb-28 sm:pb-10 space-y-4">
        {/* Controls card */}
        <section className="card p-5">
          {/* Radius selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300">
                Search radius
              </label>
              <span className="text-sm font-bold text-sage-900 dark:text-cream-50">
                {radiusKm} km
              </span>
            </div>
            <div className="flex gap-1.5">
              {RADII.map((km) => (
                <button
                  key={km}
                  type="button"
                  onClick={() => handleRadiusChange(km)}
                  className={clsx(
                    'flex-1 rounded-xl px-2 py-2 text-xs font-bold transition-all active:scale-95',
                    radiusKm === km
                      ? 'bg-sage-600 text-white shadow-soft'
                      : 'bg-sage-50 dark:bg-ink-800 text-sage-700 dark:text-cream-50 hover:bg-sage-100 dark:hover:bg-ink-700',
                  )}
                >
                  {km}
                  {km >= 5 ? 'km' : ' km'}
                </button>
              ))}
            </div>
          </div>

          {/* Filter chips */}
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300 mb-2">
              Type
            </div>
            <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilterKey(f.id)}
                  className={clsx(
                    'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                    filterKey === f.id
                      ? 'bg-sage-700 text-white'
                      : 'bg-sage-50 dark:bg-ink-800 text-sage-700 dark:text-cream-50 hover:bg-sage-100 dark:hover:bg-ink-700',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sort */}
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300 mb-2">
              Sort by
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSortKey('distance')}
                className={clsx(
                  'rounded-xl py-2 text-xs font-semibold border-2 transition-colors',
                  sortKey === 'distance'
                    ? 'bg-sage-50 dark:bg-sage-900/40 border-sage-300 dark:border-sage-700 text-sage-900 dark:text-cream-50'
                    : 'bg-white dark:bg-ink-800 border-sage-200 dark:border-ink-700 text-sage-700 dark:text-cream-50',
                )}
              >
                📍 Nearest first
              </button>
              <button
                type="button"
                onClick={() => setSortKey('name')}
                className={clsx(
                  'rounded-xl py-2 text-xs font-semibold border-2 transition-colors',
                  sortKey === 'name'
                    ? 'bg-sage-50 dark:bg-sage-900/40 border-sage-300 dark:border-sage-700 text-sage-900 dark:text-cream-50'
                    : 'bg-white dark:bg-ink-800 border-sage-200 dark:border-ink-700 text-sage-700 dark:text-cream-50',
                )}
              >
                🔤 A → Z
              </button>
            </div>
          </div>

          {/* Chain HQ opt-in toggle. Off by default — the curated list is
              approximate (city-centre coords, not real branches), but it
              surfaces major Indian chains (JioMart, Reliance, Big Bazaar,
              More, Easyday etc.) when OSM coverage is sparse. */}
          <div className="mt-4 pt-4 border-t border-sage-100 dark:border-ink-700">
            <label className="flex items-start gap-2.5 cursor-pointer group">
              <input
                type="checkbox"
                checked={showChainHq}
                onChange={(e) => {
                  const next = e.target.checked;
                  updateSettings({ showChainHq: next });
                  if (status === 'ready' && coords) {
                    void runSearch(coords.lat, coords.lon, radiusKm, next);
                  }
                }}
                className="mt-0.5 w-4 h-4 rounded border-sage-300 text-sage-700 focus:ring-sage-500 focus:ring-2 cursor-pointer"
              />
              <span className="flex-1 min-w-0">
                <span className="block text-[12px] font-semibold text-sage-900 dark:text-cream-50 leading-tight">
                  Include chain HQ references
                </span>
                <span className="block text-[11px] text-sage-500 dark:text-ink-300 mt-0.5 leading-relaxed">
                  Adds major Indian chains (JioMart, Reliance Smart, Big Bazaar,
                  More, Easyday) with city-centre coordinates. Marked as &quot;HQ&quot;.
                </span>
              </span>
            </label>
          </div>

          {/* Refresh + current location */}
          <div className="mt-4 pt-4 border-t border-sage-100 dark:border-ink-700 flex items-center justify-between">
            <div className="text-xs text-sage-500 dark:text-ink-300">
              {coords ? (
                <>
                  📍 {coords.lat.toFixed(3)}, {coords.lon.toFixed(3)}
                </>
              ) : status === 'denied' ? (
                'Location denied — refresh to retry'
              ) : status === 'error' ? (
                'Last fetch failed — refresh to retry'
              ) : (
                'Locating…'
              )}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={status === 'requesting' || status === 'loading'}
              className="btn-icon bg-sage-50 dark:bg-ink-700 text-sage-700 dark:text-cream-100"
              aria-label="Refresh stores"
            >
              <RefreshCcw size={14} />
            </button>
          </div>
        </section>

        {/* Error / denied / unavailable banners */}
        {status === 'denied' && (
          <div className="rounded-2xl border border-butter-200/70 dark:border-butter-800/60 bg-butter-50 dark:bg-butter-900/20 p-4 text-[13px] text-butter-800 dark:text-butter-200 leading-relaxed">
            <strong className="flex items-center gap-1.5 text-butter-900 dark:text-butter-100">
              <AlertTriangle size={14} />
              Location permission denied
            </strong>
            <p className="mt-1.5">
              Allow location for HomeHub in your browser settings, then tap
              refresh above.
            </p>
          </div>
        )}
        {status === 'unavailable' && (
          <div className="rounded-2xl border border-butter-200/70 dark:border-butter-800/60 bg-butter-50 dark:bg-butter-900/20 p-4 text-[13px] text-butter-800 dark:text-butter-200">
            Your browser doesn't support location services.
          </div>
        )}
        {status === 'error' && (
          <div className="rounded-2xl border border-tomato-200/60 bg-tomato-50 dark:bg-tomato-900/20 p-4 text-[13px] text-tomato-700 dark:text-tomato-300">
            <strong>Couldn&apos;t fetch stores:</strong> {error}
          </div>
        )}

        {/* Loading screen — shown while locating the user AND while fetching
            nearby stores from Overpass. Gives clear feedback that work is
            happening, then a result-shaped skeleton so the transition into the
            real list is seamless. */}
        {(status === 'requesting' || status === 'loading') && (
          <div className="space-y-4">
            {/* Status card */}
            <section
              className="card p-5 flex items-center gap-3"
              role="status"
              aria-live="polite"
            >
              <span className="relative inline-flex items-center justify-center w-11 h-11 rounded-xl bg-sage-100 text-sage-700 dark:bg-sage-900/40 dark:text-sage-200 shrink-0">
                <Loader2 size={20} className="animate-spin" />
                <span className="absolute inset-0 rounded-xl animate-ping bg-sage-400/30" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-sm text-sage-900 dark:text-cream-50">
                  {status === 'requesting'
                    ? 'Locating you…'
                    : `Searching stores within ${radiusKm} km…`}
                </div>
                <div className="text-[11px] text-sage-500 dark:text-ink-300 mt-0.5">
                  {status === 'requesting'
                    ? 'Asking your browser for your location'
                    : 'Querying OpenStreetMap + curated chains — usually 2–6 s'}
                </div>
              </div>
            </section>

            {/* Skeleton placeholders shaped like real store cards */}
            <ul className="space-y-2" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <li
                  key={i}
                  className="card p-4 flex items-center gap-3 animate-pulse"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <span className="w-11 h-11 rounded-xl bg-sage-100 dark:bg-ink-700 shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="h-3 rounded-full bg-sage-100 dark:bg-ink-700 w-2/3" />
                    <div className="h-2 rounded-full bg-sage-50 dark:bg-ink-800 w-1/2" />
                  </div>
                  <span className="w-9 h-9 rounded-xl bg-sage-50 dark:bg-ink-800 shrink-0" />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Results */}
        {status === 'ready' && (
          <>
            {visible.length === 0 ? (
              <div className="card p-6 text-center">
                <div className="text-3xl mb-2">🔎</div>
                <p className="text-sm text-sage-700 dark:text-ink-200 font-semibold">
                  No matches with current filters
                </p>
                <p className="text-xs text-sage-500 dark:text-ink-300 mt-1">
                  Try a wider radius or switch the type filter to "All".
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {visible.map((s) => {
                  const meta = getTypeMeta(s.type);
                  const storeType = s.type;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedStore(s)}
                        className="card p-4 flex items-center gap-3 w-full text-left active:scale-[0.99] transition-transform hover:shadow-soft"
                      >
                        <span
                          className={`inline-flex items-center justify-center w-11 h-11 rounded-xl text-xl shrink-0 ${meta.tint}`}
                        >
                          <StoreTypeIcon type={storeType} size={20} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-display font-bold text-sm text-sage-900 dark:text-cream-50 truncate flex items-center gap-1.5">
                            <span className="truncate">{s.name}</span>
                            {s.source === 'curated' && (
                              <span
                                className="shrink-0 text-[9px] font-bold uppercase tracking-wider rounded-full bg-butter-100 dark:bg-butter-900/30 text-butter-800 dark:text-butter-200 px-1.5 py-0.5"
                                title="Reference location from our chain HQ list — actual branch may be elsewhere in the city"
                              >
                                HQ
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-sage-500 dark:text-ink-300 mt-0.5">
                            {s.subtitle ? `${meta.label} · ${s.subtitle} · ` : `${meta.label} · `}
                            {formatDistance(s.distanceM)}
                            {s.rating ? ` · ★ ${s.rating.toFixed(1)}` : ''}
                          </div>
                          {(s.address || s.phone || s.housenumber) && (
                            <div className="text-[10px] text-sage-500 dark:text-ink-400 mt-0.5 flex items-center gap-2 flex-wrap">
                              {s.address && <span className="truncate max-w-[180px]">📍 {s.address}</span>}
                              {s.phone && (
                                <span className="inline-flex items-center gap-1">
                                  <Phone size={10} />
                                  {s.phone}
                                </span>
                              )}
                              {s.website && (
                                <span className="inline-flex items-center gap-1">
                                  <Globe size={10} />
                                  Website
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="text-sage-500 dark:text-ink-300" aria-hidden="true">
                          <ChevronRight size={18} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        <p className="text-center text-[11px] text-sage-400 dark:text-ink-500 pt-2 leading-relaxed">
          {report?.attributions?.length
            ? report.attributions.map((a) =>
                a.url ? (
                  <a
                    key={a.label}
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-sage-700 dark:hover:text-cream-50 underline-offset-2 hover:underline"
                  >
                    {a.label}
                  </a>
                ) : (
                  <span key={a.label}>{a.label}</span>
                ),
              ).reduce<JSX.Element[]>((acc, el, i) => {
                if (i > 0) acc.push(<span key={`s${i}`} className="mx-1.5 opacity-50">·</span>);
                acc.push(el);
                return acc;
              }, [])
            : 'Data from OpenStreetMap'}
        </p>
      </div>

      {/* Detail modal — opens when the user taps a store card */}
      <StoreDetailModal
        store={selectedStore}
        onClose={() => setSelectedStore(null)}
      />
    </>
  );
}