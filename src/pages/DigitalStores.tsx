import { useMemo, useState } from 'react';
import { Globe, ChevronRight, MonitorPlay, Square, Loader2, Bot } from 'lucide-react';
import { TopBar } from '../components/TopBar';
import { ShoppingListPanel } from '../components/ShoppingListPanel';
import { useStore } from '../store/useStore';
import { useScreenSharer } from '../hooks/useScreenWatch';
import { DIGITAL_STORES, DIGITAL_STORE_KIND_LABEL } from '../utils/digitalStores';
import { SHARE_PICKER_HINT } from '../utils/screenWatch';

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
 * asks the browser whether HomeHub may see that tab.
 *
 * WHY ASK AT ALL: because House Bot can then talk about what is on the
 * screen. "What is this?" and "how much is it?" are the questions a person
 * asks while looking at a product, and a bot that cannot see the screen
 * cannot answer them.
 *
 * THE PERSON PICKS THE TAB, NOT THE APP. The browser decides what can be
 * shared, and this app does not get to pick around that: the browser's own
 * picker opens, and the person chooses "Just this tab" and the store they
 * just opened. If they say no, the store still opens and nothing else
 * happens.
 *
 * HOUSE BOT NEEDS A TAB OF ITS OWN
 * The share belongs to this page, so this page is the share. House Bot has to
 * be somewhere else for the share to still be running when it is asked
 * about — and the app's only way into House Bot is the nav, which replaces
 * this page and takes the share with it. So the page offers a way into House
 * Bot that leaves this page alive.
 */
export function DigitalStoresPage() {
  const { grocery } = useStore();
  const share = useScreenSharer();
  const [opening, setOpening] = useState<string | null>(null);

  const toBuyCount = useMemo(
    () => grocery.filter((g) => !g.purchased).length,
    [grocery],
  );

  /**
   * Open the store, and offer to share it.
   *
   * The tab is opened FIRST, because the browser's picker lists the tabs
   * that can be shared and the person has to be able to pick the store they
   * just opened. The share is asked for in the same click, because the
   * browser only allows a screen share to be asked for in response to
   * something the person did.
   */
  const openAndWatch = (id: string, name: string, url: string) => {
    setOpening(id);
    void share.start(name, () => {
      window.open(url, '_blank', 'noopener,noreferrer');
    }).finally(() => setOpening(null));
  };

  /**
   * Open House Bot in a tab of its own.
   *
   * WHY A NEW TAB AND NOT THE NAV: the browser's share belongs to this page,
   * and this page IS the share. The only way into House Bot in the app is the
   * nav, and the nav replaces the page — which ends the share, because the
   * share goes with the page that asked for it. House Bot in a tab of its own
   * leaves this page alive, and the share alive with it.
   *
   * WHY IT IS OFFERED HERE AND NOW: without it, the instruction to "open
   * House Bot" sends the person to the one route that ends the share, and
   * the app would be telling them to do the thing that breaks it.
   */
  const openHouseBot = () => {
    window.open('/house-bot', '_blank');
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
                  {SHARE_PICKER_HINT} HomeHub will then be able to answer
                  questions about what is on that tab.
                </span>
              </p>
            )}

            {share.state.watching && (
              <div className="rounded-xl border border-sage-300 dark:border-sage-800 bg-sage-50 dark:bg-sage-900/30 px-3 py-2.5 flex items-start gap-2">
                <MonitorPlay size={13} className="shrink-0 mt-0.5 text-sage-600 dark:text-sage-300" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-sage-800 dark:text-cream-100">
                    Sharing the {share.state.label} tab
                  </p>
                  <p className="text-[11px] text-sage-600 dark:text-ink-300 mt-0.5 leading-relaxed">
                    {share.state.sentFrame
                      ? 'House Bot can see it. Open House Bot in a tab of its own and ask about what is on the screen. The share keeps going until you stop it.'
                      : 'Waiting for the screen to come through. House Bot will be able to see it once the first picture arrives.'}
                  </p>
                  <button
                    type="button"
                    onClick={openHouseBot}
                    className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-sage-300 dark:border-sage-800 bg-white dark:bg-ink-800 px-2 py-1 text-[11px] font-semibold text-sage-700 dark:text-cream-100 hover:bg-sage-50 dark:hover:bg-ink-700"
                  >
                    <Bot size={12} />
                    Open House Bot in a new tab
                  </button>
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

            {share.state.error && (
              <p className="text-[11px] text-tomato-600 dark:text-tomato-300">
                {share.state.error} The store still opened.
              </p>
            )}

            <p className="text-[11px] text-sage-500 dark:text-ink-400 leading-relaxed flex items-start gap-1.5">
              <Globe size={12} className="shrink-0 mt-0.5" />
              Pressing a store opens that store’s own site and asks whether
              HomeHub may share the tab, so House Bot can talk about what is on
              it. Nothing is shared until you say yes, and the browser’s
              “Stop sharing” always works.
            </p>
          </section>

          {/* ── the list to shop from ─────────────────────────────── */}
          <ShoppingListPanel />
        </div>
      </div>
    </>
  );
}
