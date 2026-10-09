import { useEffect, useState, useCallback } from 'react';
import {
  X, MapPin, Phone, Globe, Clock, Star, ExternalLink, Loader2,
} from 'lucide-react';
import type { NearbyStore } from '../utils/nearbyStores';
import { formatDistance, getTypeMeta } from '../utils/nearbyStores';
import { StoreTypeIcon } from './icons/AppIcons';
import { fetchStorePhotos, type PhotoResult } from '../utils/placePhotos';

interface Props {
  store: NearbyStore | null;
  onClose: () => void;
}

/**
 * Modal that opens when the user taps a store card. Shows full address,
 * phone, website, opening hours, rating, plus a photo gallery. Photos come
 * from OSM `image` tag, then Wikidata → Wikimedia, with an OSM static-map
 * preview as the always-shown final image.
 */
export function StoreDetailModal({ store, onClose }: Props) {
  const [photos, setPhotos] = useState<PhotoResult[] | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [photoErr, setPhotoErr] = useState<string | null>(null);

  const loadPhotos = useCallback(async () => {
    if (!store) return;
    setPhotos(null);
    setPhotoErr(null);
    setPhotoIndex(0);
    try {
      const list = await fetchStorePhotos({
        osmImageUrl: store.osmImageUrl,
        wikidataId: store.wikidataId,
        lat: store.lat,
        lon: store.lon,
      });
      setPhotos(list);
    } catch (err) {
      setPhotoErr((err as Error).message);
      setPhotos([]);
    }
  }, [store]);

  useEffect(() => {
    if (store) {
      void loadPhotos();
    }
  }, [store, loadPhotos]);

  // Close on Escape.
  useEffect(() => {
    if (!store) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, onClose]);

  if (!store) return null;

  const meta = getTypeMeta(store.type);
  const storeType = store.type;
  const currentPhoto = photos?.[photoIndex];

  // Build a structured address from the available fields.
  const addressParts: string[] = [];
  if (store.housenumber && store.street) addressParts.push(`${store.housenumber}, ${store.street}`);
  else if (store.street) addressParts.push(store.street);
  else if (store.address) addressParts.push(store.address);
  if (store.suburb && store.suburb !== store.city) addressParts.push(store.suburb);
  if (store.city) addressParts.push(store.city);
  if (store.postcode) addressParts.push(store.postcode);
  const fullAddress = addressParts.length ? addressParts.join(', ') : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-ink-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${store.name} details`}
    >
      <div
        className="bg-cream-50 dark:bg-ink-800 w-full max-w-lg max-h-[92vh] rounded-t-3xl sm:rounded-3xl shadow-soft overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero photo / map */}
        <div className="relative h-56 sm:h-64 bg-sage-50 dark:bg-ink-900 shrink-0">
          {currentPhoto ? (
            // eslint-disable-next-line jsx-a11y/img-redundant-alt
            <img
              src={currentPhoto.url}
              alt={`${store.name} photo`}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={() => {
                // Skip to next photo on error.
                if (photos && photoIndex < photos.length - 1) {
                  setPhotoIndex(photoIndex + 1);
                }
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 size={32} className="animate-spin text-sage-400" />
            </div>
          )}

          {/* Source + credit on photo */}
          {currentPhoto?.credit && (
            <div className="absolute bottom-2 right-2 text-[10px] bg-black/60 text-white px-2 py-1 rounded-full">
              {currentPhoto.credit}
            </div>
          )}
          {currentPhoto?.source && currentPhoto.source !== 'staticmap' && (
            <div className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wider bg-butter-100 dark:bg-butter-900/80 text-butter-900 dark:text-butter-100 px-2 py-1 rounded-full">
              {currentPhoto.source === 'osm-image' ? 'OSM photo' : 'Wikimedia'}
            </div>
          )}

          {/* Thumbnail strip */}
          {photos && photos.length > 1 && (
            <div className="absolute bottom-2 left-2 flex gap-1">
              {photos.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPhotoIndex(i)}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${
                    i === photoIndex ? 'bg-white scale-110' : 'bg-white/50 hover:bg-white/80'
                  }`}
                  aria-label={`Show photo ${i + 1}`}
                />
              ))}
            </div>
          )}

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/60 text-white grid place-items-center hover:bg-black/80"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 pb-28 sm:pb-5">
          {/* Title + chips */}
          <div>
            <div className="flex items-start gap-2">
              <span
                className={`inline-flex items-center justify-center w-11 h-11 rounded-xl text-xl shrink-0 ${meta.tint}`}
              >
                <StoreTypeIcon type={storeType} size={20} />
              </span>
              <div className="flex-1 min-w-0">
                <h2 className="font-display font-bold text-lg text-sage-900 dark:text-cream-50 leading-tight">
                  {store.name}
                </h2>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ${meta.tint}`}>
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-sage-500 dark:text-ink-300">
                    {formatDistance(store.distanceM)} away
                  </span>
                  {store.sources.length > 1 && (
                    <span className="text-[10px] font-bold uppercase tracking-wider rounded-full bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-200 px-2 py-0.5">
                      {store.sources.length} sources
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Rating */}
          {typeof store.rating === 'number' && (
            <div className="flex items-center gap-2 text-sm">
              <Star size={16} className="text-butter-600 fill-butter-500" />
              <span className="font-bold text-sage-900 dark:text-cream-50">
                {store.rating.toFixed(1)}
              </span>
              <span className="text-xs text-sage-500 dark:text-ink-300">
                ({store.sources.includes('foursquare') ? 'Foursquare' : 'Geoapify'} rating)
              </span>
            </div>
          )}

          {/* Address */}
          {fullAddress && (
            <div className="flex items-start gap-2.5 text-sm">
              <MapPin size={16} className="text-sage-600 dark:text-sage-300 shrink-0 mt-0.5" />
              <a
                href={`https://www.openstreetmap.org/?mlat=${store.lat}&mlon=${store.lon}#map=18/${store.lat}/${store.lon}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sage-700 dark:text-cream-100 hover:text-sage-900 dark:hover:text-cream-50 underline-offset-2 hover:underline leading-relaxed flex items-center gap-1"
              >
                <span>{fullAddress}</span>
                <ExternalLink size={11} className="opacity-60" />
              </a>
            </div>
          )}

          {/* Phone */}
          {store.phone && (
            <div className="flex items-start gap-2.5 text-sm">
              <Phone size={16} className="text-sage-600 dark:text-sage-300 shrink-0 mt-0.5" />
              <a
                href={`tel:${store.phone}`}
                className="text-sage-700 dark:text-cream-100 hover:text-sage-900 dark:hover:text-cream-50 font-medium tabular-nums"
              >
                {store.phone}
              </a>
            </div>
          )}

          {/* Website */}
          {store.website && (
            <div className="flex items-start gap-2.5 text-sm">
              <Globe size={16} className="text-sage-600 dark:text-sage-300 shrink-0 mt-0.5" />
              <a
                href={store.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sage-700 dark:text-cream-100 hover:text-sage-900 dark:hover:text-cream-50 truncate underline-offset-2 hover:underline flex items-center gap-1"
              >
                <span className="truncate">{store.website.replace(/^https?:\/\//, '')}</span>
                <ExternalLink size={11} className="opacity-60 shrink-0" />
              </a>
            </div>
          )}

          {/* Opening hours */}
          {store.openingHours && (
            <div className="flex items-start gap-2.5 text-sm">
              <Clock size={16} className="text-sage-600 dark:text-sage-300 shrink-0 mt-0.5" />
              <div className="text-sage-700 dark:text-cream-100 leading-relaxed">
                <div className="text-[11px] text-sage-500 dark:text-ink-300 mb-0.5">
                  Opening hours
                </div>
                <div className="font-mono text-[13px] whitespace-pre-wrap">
                  {store.openingHours}
                </div>
              </div>
            </div>
          )}

          {/* Categories (from OSM shop=* or provider tags) */}
          {store.categories && store.categories.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sage-500 dark:text-ink-300 mb-1.5">
                Tags
              </div>
              <div className="flex flex-wrap gap-1.5">
                {store.categories.slice(0, 8).map((c) => (
                  <span
                    key={c}
                    className="text-[11px] font-medium rounded-full bg-sage-50 dark:bg-ink-700 text-sage-700 dark:text-cream-50 px-2.5 py-1"
                  >
                    {c.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Sources */}
          <div className="pt-3 border-t border-sage-100 dark:border-ink-700">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-sage-500 dark:text-ink-300 mb-1.5">
              Data sources
            </div>
            <div className="flex flex-wrap gap-1.5">
              {store.sources.map((s) => (
                <span
                  key={s}
                  className="text-[10px] font-bold uppercase tracking-wider rounded-full bg-cream-100 dark:bg-ink-700 text-sage-700 dark:text-cream-100 px-2 py-0.5"
                >
                  {s}
                </span>
              ))}
              {store.providerPlaceId && (
                <span className="text-[10px] font-mono text-sage-500 dark:text-ink-300 px-1">
                  {store.providerPlaceId}
                </span>
              )}
            </div>
          </div>

          {photoErr && (
            <div className="text-[11px] text-tomato-700 dark:text-tomato-300">
              Couldn't load photos: {photoErr}
            </div>
          )}

          {!store.phone && !store.website && !store.openingHours && !store.address && !store.housenumber && (
            <div className="text-[11px] text-sage-500 dark:text-ink-300 italic">
              Limited info from OpenStreetMap for this place. Help improve coverage by
              editing OSM directly.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}