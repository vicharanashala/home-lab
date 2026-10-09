import { useState } from 'react';
import {
  MapPin,
  RefreshCcw,
  AlertTriangle,
  Navigation,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { StoreTypeIcon } from './icons/AppIcons';
import {
  findNearbyStores,
  formatDistance,
  getTypeMeta,
  type NearbyStore,
} from '../utils/nearbyStores';

type Status = 'idle' | 'requesting' | 'loading' | 'ready' | 'denied' | 'unavailable' | 'error';

export function NearbyStoresCard() {
  const { settings } = useStore();
  const locationEnabled = settings.consents?.location ?? false;
  const [status, setStatus] = useState<Status>('idle');
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      return;
    }
    setStatus('requesting');
    setError(null);
    try {
      const pos = await new Promise<GeolocationPosition | null>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve(p),
          () => resolve(null),
          { timeout: 12_000, maximumAge: 5 * 60_000 },
        );
      });
      if (!pos) {
        setStatus('denied');
        return;
      }
      setStatus('loading');
      // findNearbyStores never throws — it falls back to a curated HQ list.
      const list = await findNearbyStores(pos.coords.latitude, pos.coords.longitude, 5, 6);
      setStores(list);
      setStatus('ready');
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  };

  if (!locationEnabled) {
    return (
      <section id="nearby-stores" className="card p-5 scroll-mt-24">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-8 h-8 rounded-xl bg-sage-100 text-sage-700 grid place-items-center">
            <MapPin size={16} />
          </span>
          <h3 className="font-display font-bold text-lg text-sage-900 dark:text-cream-50">
            Stores near you
          </h3>
        </div>
        <p className="text-xs text-sage-500 dark:text-ink-300 mb-3">
          Enable location to see supermarkets, kirana stores and malls nearby.
        </p>
        <a
          href="/settings"
          className="btn-primary w-full !py-3"
        >
          <Navigation size={16} />
          Enable in Settings
        </a>
      </section>
    );
  }

  return (
    <section id="nearby-stores" className="card p-5 scroll-mt-24">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-sage-100 text-sage-700 grid place-items-center">
            <MapPin size={16} />
          </span>
          <div>
            <h3 className="font-display font-bold text-lg text-sage-900 dark:text-cream-50">
              Stores near you
            </h3>
            <p className="text-[11px] text-sage-500 dark:text-ink-300 -mt-0.5">
              Within 5 km · sourced from OpenStreetMap
            </p>
          </div>
        </div>
        {status === 'ready' && (
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh nearby stores"
            className="btn-icon bg-sage-50 dark:bg-ink-700 text-sage-700 dark:text-cream-100"
          >
            <RefreshCcw size={14} />
          </button>
        )}
      </div>

      {(status === 'idle' || status === 'requesting') && (
        <a
          href="/stores"
          className="btn-primary w-full !py-3"
        >
          <Navigation size={16} />
          See near stores by you
        </a>
      )}

      {status === 'loading' && (
        <ul className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <li
              key={i}
              className="h-14 rounded-xl bg-sage-50 dark:bg-ink-800 animate-pulse"
            />
          ))}
        </ul>
      )}

      {status === 'denied' && (
        <div className="rounded-2xl border border-butter-200/70 dark:border-butter-800/60 bg-butter-50 dark:bg-butter-900/20 p-3 text-[12px] text-butter-800 dark:text-butter-200 leading-relaxed">
          <strong className="flex items-center gap-1 text-butter-900 dark:text-butter-100">
            <AlertTriangle size={12} />
            Location permission denied
          </strong>
          <p className="mt-1">
            Allow location for HomeHub in your browser settings, then tap refresh.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 text-xs font-semibold underline"
          >
            Try again
          </button>
        </div>
      )}

      {status === 'unavailable' && (
        <p className="text-xs text-sage-500 dark:text-ink-300">
          Your browser doesn&apos;t support location services.
        </p>
      )}

      {status === 'error' && (
        <div className="rounded-2xl border border-tomato-200/60 bg-tomato-50 dark:bg-tomato-900/20 p-3 text-[12px] text-tomato-700 dark:text-tomato-300">
          <strong>Couldn&apos;t fetch stores:</strong> {error}
          <button
            type="button"
            onClick={() => void load()}
            className="block mt-2 text-xs font-semibold underline"
          >
            Try again
          </button>
        </div>
      )}

      {status === 'ready' && (
        <>
          {stores.length === 0 ? (
            <p className="text-sm text-sage-600 dark:text-ink-200">
              No shops mapped within 5 km. Try a wider radius or check back later.
            </p>
          ) : (
            <ul className="space-y-2">
              {stores.map((s) => {
                const meta = getTypeMeta(s.type);
                const storeType = s.type;
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 py-1.5"
                  >
                    <span
                      className={`inline-flex items-center justify-center w-9 h-9 rounded-xl text-base shrink-0 ${meta.tint}`}
                    >
                      <StoreTypeIcon type={storeType} size={18} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-sage-900 dark:text-cream-50 truncate">
                        {s.name}
                      </div>
                      <div className="text-[11px] text-sage-500 dark:text-ink-300">
                        {meta.label} · {formatDistance(s.distanceM)}
                      </div>
                    </div>
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=17/${s.lat}/${s.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${s.name} on map`}
                      className="btn-icon text-sage-500 hover:text-sage-700 hover:bg-sage-50"
                    >
                      <MapPin size={14} />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}