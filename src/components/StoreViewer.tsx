import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Globe, Loader2, ShieldAlert } from 'lucide-react';
import clsx from 'clsx';
import { TopBar } from './TopBar';
import { DIGITAL_STORES } from '../utils/digitalStores';

/**
 * The store's own site, inside HomeHub.
 *
 * WHY THE SITE IS SERVED BY OUR SERVER AND NOT POINTED AT DIRECTLY: every
 * one of these stores refuses to be framed. Amazon and BigBasket send
 * "X-Frame-Options: SAMEORIGIN" and Jio Mart's edge leaves a frame empty,
 * so an iframe aimed straight at them shows a blank rectangle.
 *
 * The bridge fetches the page and serves it from the app's own origin, where
 * the app is allowed to frame it. What appears here is the real store.
 *
 * WHY ONE STORE MAY STILL REFUSE: BigBasket's edge refuses any request that
 * does not come from a real browser, and it can tell. When that happens the
 * server says so in the frame itself, with a button to open the store
 * properly, rather than showing a blank page.
 */
export function StoreViewer() {
  const { storeId } = useParams<{ storeId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  const store = useMemo(
    () => DIGITAL_STORES.find((s) => s.id === storeId) ?? null,
    [storeId],
  );

  useEffect(() => {
    setLoading(true);
  }, [storeId]);

  if (!store) {
    return (
      <>
        <TopBar title="Digital stores" />
        <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-8 text-center">
          <p className="text-sm text-sage-600 dark:text-ink-300">
            That store is not on the list.
          </p>
          <button
            type="button"
            onClick={() => navigate('/digital-stores')}
            className="btn-secondary mt-4 !py-2 text-xs"
          >
            <ArrowLeft size={13} />
            Back to Digital stores
          </button>
        </div>
      </>
    );
  }

  // The viewer path is what the server rewrites every link into, so a link
  // the user clicks inside the frame stays inside the frame.
  const host = new URL(store.url).host;
  const path = new URL(store.url).pathname;
  const viewerSrc = `/store-viewer/${host}${path}`;

  return (
    <>
      <TopBar
        title={store.name}
        subtitle={store.note}
        rightSlot={
          <a
            href={store.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-xl border border-sage-200 dark:border-ink-700 bg-white dark:bg-ink-800 px-2.5 py-1.5 text-[11px] font-semibold text-sage-700 dark:text-cream-100 hover:bg-sage-50 dark:hover:bg-ink-700"
          >
            <ExternalLink size={12} />
            Open the store
          </a>
        }
      />

      <div className="px-4 sm:px-6 pb-28 sm:pb-8">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => navigate('/digital-stores')}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sage-600 dark:text-ink-300 hover:text-sage-800 dark:hover:text-cream-50"
            >
              <ArrowLeft size={13} />
              All digital stores
            </button>
            <span className="inline-flex items-center gap-1 text-[10px] text-sage-400 dark:text-ink-500">
              <ShieldAlert size={11} />
              Runs on this Mac, so the page may ask you to sign in again
            </span>
          </div>

          <div className="relative rounded-2xl overflow-hidden border border-sage-200 dark:border-ink-700 bg-white dark:bg-ink-800 shadow-soft">
            {loading && (
              <div className="absolute inset-0 z-10 grid place-items-center bg-white/80 dark:bg-ink-800/80 backdrop-blur-sm">
                <Loader2 size={28} className="animate-spin text-sage-400" />
              </div>
            )}
            <iframe
              key={store.id}
              src={viewerSrc}
              title={`${store.name} inside HomeHub`}
              onLoad={() => setLoading(false)}
              className={clsx(
                'w-full border-0 bg-white dark:bg-ink-900',
                'h-[calc(100dvh-13rem)] min-h-[420px]',
              )}
            />
          </div>

          <p className="mt-2 text-[11px] text-sage-500 dark:text-ink-400 leading-relaxed flex items-start gap-1.5">
            <Globe size={12} className="shrink-0 mt-0.5" />
            {store.name} is being shown inside HomeHub. It is being loaded by
            your own machine rather than opened directly in a tab, so the
            store does not know it is being viewed and may ask you to sign in
            again. Use “Open the store” for anything that needs your account.
          </p>
        </div>
      </div>
    </>
  );
}
