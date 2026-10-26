import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Globe, Loader2, ShieldAlert, X } from 'lucide-react';
import clsx from 'clsx';
import { TopBar } from './TopBar';
import { ShoppingListPanel } from './ShoppingListPanel';
import { StoreTabs } from './StoreTabs';
import { openTab, closeTab, syncRouteToTab } from '../utils/storeTabs';
import type { TabState } from '../utils/storeTabs';
import {
  markFrameLoaded,
  isSpinnerShown,
  NO_FRAMES_LOADED,
} from '../utils/storeViewerFrames';
import type { FrameState } from '../utils/storeViewerFrames';
import { DIGITAL_STORES } from '../utils/digitalStores';

/**
 * The store's own site, inside HomeHub, in tabs.
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
 *
 * WHY TABS: shopping is comparing. Two stores open side by side beats
 * remembering what the first one said.
 */
export function StoreViewer() {
  const { storeId } = useParams<{ storeId: string }>();
  const navigate = useNavigate();

  const store = useMemo(
    () => DIGITAL_STORES.find((s) => s.id === storeId) ?? null,
    [storeId],
  );

  /**
   * The open tabs.
   *
   * A tab is created when the user asks for it and is never thrown away
   * until they close it, so each store keeps the page it was showing and
   * the place they had reached in it. That is the whole point of a tab.
   */
  // The FIRST tab is created during the render, not in an effect.
  //
  // WHY IT MATTERS: an effect runs after the first paint, so the frame would
  // not be in the first frame of the page — there would be a blank moment
  // before the store appeared, and a server render of this screen would have
  // no store in it at all.
  const [tabState, setTabState] = useState<TabState>(() => {
    const s = DIGITAL_STORES.find((x) => x.id === storeId);
    return s
      ? openTab({ tabs: [], activeId: '', seq: 0 }, s)
      : { tabs: [], activeId: '', seq: 0 };
  });
  // WHICH FRAMES HAVE FINISHED LOADING, PER TAB.
  //
  // WHY PER TAB AND NOT ONE FLAG: a frame that is not on screen is hidden
  // rather than taken down, so it keeps the page it was showing. Switching
  // back to a tab whose frame has ALREADY loaded therefore fires NO load
  // event — the frame was never taken down, so the browser never loads it
  // again — while a single flag reset on every tab change would be set true
  // all over again and stay true for ever. The spinner then sat over a store
  // that had finished loading, and the store looked broken.
  //
  // The rule itself lives in `storeViewerFrames` so it can be tested without
  // a browser: see scripts/test-store-viewer-loading.mjs.
  const [frames, setFrames] = useState<FrameState>(NO_FRAMES_LOADED);
  const [adding, setAdding] = useState(false);
  const { tabs, activeId } = tabState;

  // When the route names a different store, its tab comes forward. Done
  // during the render for the same reason as above: adjusting state while
  // rendering is how a component responds to a changed prop without
  // showing a stale one first.
  //
  // WHY syncRouteToTab AND NOT openTab: the route names a STORE and the
  // strip holds TABS, and a store can be open twice — the "+" button opens
  // the same store again so the owner can compare two searches on it. The
  // address can only name one of the two, so opening the store here would
  // bring the FIRST of them forward and throw away the tab the owner had
  // just picked: they tapped the second Amazon tab and the viewer showed
  // the first. syncRouteToTab leaves the tab on screen alone when it is
  // already showing the store the route names.
  const [routeStoreId, setRouteStoreId] = useState(storeId);
  if (storeId !== routeStoreId) {
    setRouteStoreId(storeId);
    if (store) setTabState((prev) => syncRouteToTab(prev, store));
  }

  /** Open a store in a tab, or bring its existing tab to the front. */
  const openStore = useCallback(
    (id: string, opts?: { alwaysNew?: boolean }) => {
      const s = DIGITAL_STORES.find((x) => x.id === id);
      if (!s) return;
      setTabState((prev) => openTab(prev, s, opts));
    },
    [],
  );

  const close = useCallback((id: string) => {
    setTabState((prev) => closeTab(prev, id));
  }, []);

  const selectTab = useCallback((id: string) => {
    setTabState((prev) => ({ ...prev, activeId: id }));
    setAdding(false);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  // The title of the app's own header follows the tab, so the back button and
  // the tab strip never disagree about which store is on screen.
  useEffect(() => {
    if (!activeTab) return;
    const s = DIGITAL_STORES.find((x) => x.id === activeTab.storeId);
    if (!s) return;
    if (window.location.pathname !== `/digital-stores/${s.id}`) {
      navigate(`/digital-stores/${s.id}`, { replace: true });
    }
  }, [activeTab, navigate]);

  if (!store && !activeTab) {
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

  const activeStore = activeTab
    ? DIGITAL_STORES.find((s) => s.id === activeTab.storeId)
    : store;

  return (
    <>
      <TopBar
        title={activeStore?.name ?? 'Digital stores'}
        subtitle={activeStore?.note}
        rightSlot={
          activeStore && (
            <a
              href={activeStore.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-xl border border-sage-200 dark:border-ink-700 bg-white dark:bg-ink-800 px-2.5 py-1.5 text-[11px] font-semibold text-sage-700 dark:text-cream-100 hover:bg-sage-50 dark:hover:bg-ink-700"
            >
              <ExternalLink size={12} />
              {/* On a phone the title needs that room more than the label
                  does — the button becomes the icon alone. */}
              <span className="hidden sm:inline">Open the store</span>
            </a>
          )
        }
      />

      <div className="px-4 sm:px-6 pb-2 sm:pb-8">
        <div className="mx-auto max-w-5xl">
          {/* The store and the list, side by side.
              WHY THE LIST IS HERE AND NOT ONLY ON THE STORES PAGE: the stores
              page promises "Tap a store to open it inside HomeHub, with your
              list beside you", and this is the screen that sentence is about.
              The list used to live only on the stores page, so opening a store
              took the list away — the promise was false on the one screen it
              was made for. The list a shopper wants while a store is open is
              the one already in the app, so it is shown here, and it is the
              same list: one component, one store. */}
          <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
            <div>
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

              <StoreTabs
                tabs={tabs}
                activeId={activeId}
                onSelect={selectTab}
                onClose={close}
                onAdd={() => setAdding((v) => !v)}
              />

              {adding && (
                <div className="mb-2 flex flex-wrap gap-1.5 rounded-xl border border-sage-200 dark:border-ink-700 bg-white dark:bg-ink-800 p-2">
                  {DIGITAL_STORES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        openStore(s.id, { alwaysNew: true });
                        setAdding(false);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-sage-200 dark:border-ink-700 px-2 py-1 text-[11px] font-semibold text-sage-700 dark:text-cream-100 hover:bg-sage-50 dark:hover:bg-ink-700"
                    >
                      <span aria-hidden="true">{s.emoji}</span>
                      {s.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAdding(false)}
                    aria-label="Close"
                    className="ml-auto grid place-items-center w-6 h-6 rounded-md text-sage-500 hover:bg-sage-100 dark:hover:bg-ink-700"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* Every tab keeps its own frame, and a frame that is not on
                  screen is hidden rather than removed: taking a tab down
                  would throw its page away, and coming back to it would make
                  the store load all over again. */}
              <div className="relative rounded-2xl overflow-hidden border border-sage-200 dark:border-ink-700 bg-white dark:bg-ink-800 shadow-soft">
                {isSpinnerShown(frames, activeId) && (
                  <div className="absolute inset-0 z-10 grid place-items-center bg-white/80 dark:bg-ink-800/80 backdrop-blur-sm">
                    <Loader2 size={28} className="animate-spin text-sage-400" />
                  </div>
                )}
                {tabs.map((tab) => {
                  const s = DIGITAL_STORES.find((x) => x.id === tab.storeId);
                  if (!s) return null;
                  const host = new URL(s.url).host;
                  const path = new URL(s.url).pathname;
                  const visible = tab.id === activeId;
                  return (
                    <iframe
                      key={tab.id}
                      src={`/store-viewer/${host}${path}`}
                      title={`${s.name} inside HomeHub`}
                      loading={visible ? 'eager' : 'lazy'}
                      onLoad={() => {
                        // A frame that is not on screen counts as loaded too:
                        // it is hidden, not taken down, so it loads whether or
                        // not it is the one being looked at — and coming back
                        // to it must not show a spinner over a page that is
                        // already there.
                        setFrames((prev) => markFrameLoaded(prev, tab.id));
                      }}
                      className={clsx(
                        'w-full border-0 bg-white dark:bg-ink-900',
                        // The height budget for a phone: the top bar, the
                        // back link, the tab strip and the note under the
                        // frame all have to fit, AND the floating bottom nav
                        // has to stay clear of the note. The desktop has no
                        // bottom nav, so the frame can be taller there.
                        'h-[calc(100dvh-17.5rem)] min-h-[340px]',
                        'sm:h-[calc(100dvh-12rem)]',
                        !visible && 'hidden',
                      )}
                      data-tab-id={tab.id}
                    />
                  );
                })}
              </div>

              <p className="mt-2 text-[11px] text-sage-500 dark:text-ink-400 leading-relaxed flex items-start gap-1.5">
                <Globe size={12} className="shrink-0 mt-0.5" />
                {/* WHY TWO VERSIONS: on a phone the note has to be ONE line,
                    because the floating bottom nav sits over anything that
                    reaches past it. The long version is for the desktop. */}
                <span className="sm:hidden">
                  Loaded by your Mac, so it may ask you to sign in again.
                </span>
                <span className="hidden sm:inline">
                  {activeStore?.name} is being shown inside HomeHub. It is being
                  loaded by your own machine rather than opened directly in a
                  tab, so the store does not know it is being viewed and may ask
                  you to sign in again. Use “Open the store” for anything that
                  needs your account.
                </span>
              </p>
            </div>

            <ShoppingListPanel />
          </div>
        </div>
      </div>
    </>
  );
}
