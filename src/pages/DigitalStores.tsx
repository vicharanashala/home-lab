import { useMemo, useState } from 'react';
import { Globe, ChevronRight, MonitorPlay, Square, Loader2, Bot } from 'lucide-react';
import { TopBar } from '../components/TopBar';
import { ShoppingListPanel } from '../components/ShoppingListPanel';
import { StoreTabNotice } from '../components/StoreTabNotice';
import { useStore } from '../store/useStore';
import { useScreenSharer } from '../hooks/useScreenWatch';
import { DIGITAL_STORES, DIGITAL_STORE_KIND_LABEL } from '../utils/digitalStores';
import {
  SHARE_ASKING_TEXT,
  SHARE_CONSENT_TEXT,
  openStoreTab,
  shareRunningText,
} from '../utils/screenWatch';
import { openHouseBotWindow } from '../utils/houseBotWindow';

/**
 * The online stores you can order from, with the shopping list beside them.
 *
 * The Stores page finds the shops you can walk into; this is the other half,
 * the ones that come to the door. The list is here rather than a map because
 * there is nothing to find — these are places to choose, and the choice is a
 * habit, not a location.
 *
 * THE SHOPPING LIST IS BESIDE THE STORES BECAUSE THAT IS WHAT THE LIST IS
 * FOR: you open the shop on one screen and tick things off on the other, and
 * a list that lives somewhere else is a list that does not get used. It is
 * the same list the Grocery page uses, so ticking an item off here ticks it
 * off there — nothing has to be written twice.
 *
 * PRESSING A STORE OPENS THE REAL SITE AND OFFERS TO SHARE IT
 * The store's own site is a different site, and it is not ours to put inside
 * this app. So pressing a store opens the real thing, in a new tab, and then
 * asks the browser whether HomeHub may see the window that tab opened in.
 *
 * WHY ASK AT ALL: because House Bot can then talk about what is on the
 * screen. "What is this?" and "how much is it?" are the questions a person
 * asks while looking at a product, and a bot that cannot see the screen
 * cannot answer them.
 *
 * THE PERSON PICKS THE WINDOW, NOT THE APP. The browser decides what can
 * be shared, and this app does not get to pick around that: the browser's own
 * picker opens, and the person chooses the window their store just opened in.
 * If they say no, the store still opens and nothing else happens.
 *
 * WHY THE WINDOW AND NOT JUST THE STORE'S TAB: the screen is more than the
 * store's page. It is the store's page AND this app's own tab, side by side,
 * so the question can be asked while the thing being asked about is still in
 * view. Every word this page shows the person says "window" for that reason —
 * a page that said "tab" would be promising less than the browser asks for.
 *
 * HOUSE BOT NEEDS A WINDOW OF ITS OWN
 * The share belongs to this page, so this page is the share. House Bot has to
 * be somewhere else for the share to still be running when it is asked
 * about — and the app's only way into House Bot is the nav, which replaces
 * this page and takes the share with it. So the page offers a way into House
 * Bot that leaves this page alive.
 *
 * WHY A WINDOW AND NOT JUST A TAB: the share is of a WINDOW, and a window
 * shows one tab at a time. If House Bot were a tab of this window, the
 * person would have to click that tab to ask it something — and the window
 * would then be showing House Bot, so the bot would be handed a picture of
 * ITSELF and asked what was on the screen. House Bot gets a window of its
 * own, beside this one, so the store stays in front of the shared window
 * while the person talks to the bot. See src/utils/houseBotWindow.ts.
 */
export function DigitalStoresPage() {
  const { grocery } = useStore();
  const share = useScreenSharer();
  const [opening, setOpening] = useState<string | null>(null);
  // The store whose tab the browser refused, so the person can be told and
  // given a way to open it. See `openStoreTab`.
  const [blockedStore, setBlockedStore] = useState<{ name: string; url: string } | null>(null);
  // Whether the browser refused to open House Bot's window. Said out loud,
  // because otherwise the button does nothing at all and the person is left
  // wondering what they did wrong.
  const [botBlocked, setBotBlocked] = useState(false);

  const toBuyCount = useMemo(
    () => grocery.filter((g) => !g.purchased).length,
    [grocery],
  );

  /**
   * Open the store, and offer to share it.
   *
   * THE ORDER IS NOT OURS: `share.start` asks the browser FIRST and opens the
   * store afterwards, and the callback below is the store's opening. The order
   * is the hook's because Chrome only puts the capture picker up for a page
   * that is in FRONT — opening the store's tab first took the focus, hid this
   * page, and the picker never appeared at all. The person saw nothing happen
   * and nothing said why.
   *
   * WHY THE STORE IS STILL IN FRAME WHEN IT OPENS: the capture is of the
   * WINDOW and not of one tab, so the window is filmed from the moment the
   * share is granted — and the store tab opens into that same window a moment
   * later. Opening it before the ask was the version that did nothing at all.
   *
   * WHERE THE RULE LIVES: `useScreenSharer` in src/hooks/useScreenWatch.ts,
   * and the test "the store is opened AFTER the browser is asked, not before".
   *
   * WHY THE TAB IS OPENED BY `openStoreTab` AND NOT BY `window.open` HERE: a
   * pop-up is only allowed while the page still holds the person's gesture,
   * and the gesture is short-lived — about five seconds in Chrome, about one
   * in Safari. The tab is opened a moment after the capture is asked for, so
   * the gesture is still alive and the browser lets the tab through — but
   * `window.open` CONSUMES that gesture, so a page that asked afterwards
   * would always be told "blocked", including on the runs where the tab
   * opened perfectly well. The page cannot tell from the return value
   * either (`noopener` makes `window.open` return null whether the tab
   * opened or not), so the question is asked before the tab is opened, and
   * the person is told when it was refused.
   */
  const openAndWatch = (id: string, name: string, url: string) => {
    setOpening(id);
    setBlockedStore(null);
    void share.start(name, () => {
      if (!openStoreTab(url)) setBlockedStore({ name, url });
    }).finally(() => setOpening(null));
  };

  /**
   * Open House Bot in a window of its own, beside this one.
   *
   * WHY A WINDOW AND NOT THE NAV: the browser's share belongs to this page,
   * and this page IS the share. The only way into House Bot in the app is the
   * nav, and the nav replaces the page — which ends the share, because the
   * share goes with the page that asked for it. House Bot in a window of its
   * own leaves this page alive, and the share alive with it.
   *
   * WHY A WINDOW AND NOT A TAB OF THIS ONE: the share is of a WINDOW, and a
   * window shows one tab at a time. A House Bot tab in this window would mean
   * the person has to click that tab to ask the bot anything — and then this
   * window is showing House Bot, so the bot is handed a picture of ITSELF and
   * asked what is on the screen. The store has to stay in front of this
   * window for the bot to be able to see it.
   *
   * WHY IT IS OFFERED HERE AND NOW: without it, the instruction to "open
   * House Bot" sends the person to the one route that ends the share, and
   * the app would be telling them to do the thing that breaks it.
   */
  const openHouseBot = () => {
    setBotBlocked(!openHouseBotWindow('/house-bot'));
  };

  return (
    <>
      <TopBar
        title="Digital stores"
        subtitle={`${DIGITAL_STORES.length} online stores · your list has ${toBuyCount} to buy`}
      />
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-4 pb-28 sm:pb-10">
        <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
          {/* ── the stores ─────────────────────────────────────────── */}
          <section className="space-y-3">
            <ul className="space-y-2">
              {DIGITAL_STORES.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => openAndWatch(s.id, s.name, s.url)}
                    className="card p-4 flex items-center gap-3 w-full text-left active:scale-[0.99] transition-transform hover:shadow-soft"
                  >
                    <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-sage-100 dark:bg-sage-900/40 text-xl shrink-0">
                      {s.emoji}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-display font-bold text-sm text-sage-900 dark:text-cream-50 truncate">
                        {s.name}
                      </span>
                      <span className="block text-[11px] text-sage-500 dark:text-ink-300 mt-0.5 truncate">
                        {s.note}
                      </span>
                      <span className="block text-[10px] text-sage-400 dark:text-ink-500 mt-1">
                        {DIGITAL_STORE_KIND_LABEL[s.kind]}
                      </span>
                    </span>
                    <span
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-sage-600 dark:text-ink-300 shrink-0"
                      aria-hidden="true"
                    >
                      {opening === s.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <>
                          <MonitorPlay size={13} />
                          <ChevronRight size={14} />
                        </>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* What the share is doing, while it is doing it. */}
            {share.state.asking && (
              <p className="rounded-xl border border-sage-200 dark:border-ink-700 bg-white dark:bg-ink-800 px-3 py-2.5 text-[11px] text-sage-600 dark:text-ink-300 leading-relaxed flex items-start gap-2">
                <Loader2 size={13} className="shrink-0 mt-0.5 animate-spin" />
                <span>
                  {SHARE_ASKING_TEXT}
                </span>
              </p>
            )}

            {share.state.watching && (
              <div className="rounded-xl border border-sage-300 dark:border-sage-800 bg-sage-50 dark:bg-sage-900/30 px-3 py-2.5 flex items-start gap-2">
                <MonitorPlay size={13} className="shrink-0 mt-0.5 text-sage-600 dark:text-sage-300" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-sage-800 dark:text-cream-100">
                    {shareRunningText(share.state.label)}
                  </p>
                  <p className="text-[11px] text-sage-600 dark:text-ink-300 mt-0.5 leading-relaxed">
                    {share.state.sentFrame
                      ? 'House Bot can see it. The share keeps going until you stop it.'
                      : 'Waiting for the screen to come through. House Bot will be able to see it once the first picture arrives.'}
                  </p>
                  {share.state.sentFrame && (
                    <p className="text-[11px] text-sage-600 dark:text-ink-300 mt-1 leading-relaxed">
                      Open House Bot in a window of its own, then click the store’s
                      tab once so House Bot is looking at the store, and ask it what
                      is on the screen.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={openHouseBot}
                    className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-sage-300 dark:border-sage-800 bg-white dark:bg-ink-800 px-2 py-1 text-[11px] font-semibold text-sage-700 dark:text-cream-100 hover:bg-sage-50 dark:hover:bg-ink-700"
                  >
                    <Bot size={12} />
                    Open House Bot in a window of its own
                  </button>
                  {botBlocked && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1 leading-relaxed">
                      Your browser blocked the new window. Press the button again and
                      it will open.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={share.stop}
                  className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-sage-300 dark:border-sage-800 px-2 py-1 text-[11px] font-semibold text-sage-700 dark:text-cream-100 hover:bg-white dark:hover:bg-ink-800"
                >
                  <Square size={10} />
                  Stop
                </button>
              </div>
            )}

            <StoreTabNotice error={share.state.error} blockedStore={blockedStore} />

            <p className="text-[11px] text-sage-500 dark:text-ink-400 leading-relaxed flex items-start gap-1.5">
              <Globe size={12} className="shrink-0 mt-0.5" />
              {SHARE_CONSENT_TEXT}
            </p>
          </section>

          {/* ── the list to shop from ─────────────────────────────── */}
          <ShoppingListPanel />
        </div>
      </div>
    </>
  );
}
