import { useMemo } from 'react';
import {
  Globe,
  Check,
  ShoppingCart,
  ExternalLink,
  Search,
  CircleCheck,
} from 'lucide-react';
import clsx from 'clsx';
import { TopBar } from '../components/TopBar';
import { useStore } from '../store/useStore';
import { DIGITAL_STORES, DIGITAL_STORE_KIND_LABEL } from '../utils/digitalStores';

/**
 * The online stores you can order from, with the shopping list beside them.
 *
 * The Stores page finds the shops you can walk into; this is the other half,
 * the ones that come to the door. The list is here rather than a map because
 * there is nothing to find — these are places to choose, and the choice is a
 * habit, not a location.
 *
 * The shopping list is on the same page because that is what the list is
 * FOR: you open the shop on one screen and tick things off on the other, and
 * a list that lives somewhere else is a list that does not get used.
 */
export function DigitalStoresPage() {
  const { grocery, toggleGroceryPurchased } = useStore();

  const toBuy = useMemo(() => grocery.filter((g) => !g.purchased), [grocery]);
  const bought = useMemo(() => grocery.filter((g) => g.purchased), [grocery]);

  return (
    <>
      <TopBar
        title="Digital stores"
        subtitle={`${DIGITAL_STORES.length} online stores · your list has ${toBuy.length} to buy`}
      />
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-4 pb-28 sm:pb-10">
        <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
          {/* ── the stores ─────────────────────────────────────────── */}
          <section className="space-y-3">
            <ul className="space-y-2">
              {DIGITAL_STORES.map((s) => (
                <li key={s.id}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="card p-4 flex items-center gap-3 active:scale-[0.99] transition-transform hover:shadow-soft"
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
                      <Globe size={13} />
                      <ExternalLink size={11} />
                    </span>
                  </a>
                </li>
              ))}
            </ul>

            <p className="text-[11px] text-sage-500 dark:text-ink-400 leading-relaxed">
              Every store opens in a new tab. Delivery times, minimum orders and
              membership passes change often, so each store’s own site is the
              place to read the current details.
            </p>
          </section>

          {/* ── the list to shop from ─────────────────────────────── */}
          <aside className="lg:sticky lg:top-20 space-y-3">
            <section className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <ShoppingCart size={15} className="text-sage-600 dark:text-sage-300" />
                <h2 className="font-display font-bold text-sm text-sage-900 dark:text-cream-50">
                  Shopping list
                </h2>
                {toBuy.length > 0 && (
                  <span className="ml-auto text-[11px] font-bold text-sage-600 dark:text-ink-300">
                    {toBuy.length} to buy
                  </span>
                )}
              </div>

              {grocery.length === 0 ? (
                <p className="text-xs text-sage-500 dark:text-ink-400 leading-relaxed">
                  Your list is empty. Add something on the Grocery page and it
                  will appear here, ready to tick off as you shop.
                </p>
              ) : (
                <ul className="space-y-1">
                  {[...toBuy, ...bought].map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => toggleGroceryPurchased(g.id)}
                        className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-sage-50 dark:hover:bg-ink-700 transition-colors"
                      >
                        <span
                          className={clsx(
                            'w-4 h-4 rounded border grid place-items-center shrink-0',
                            g.purchased
                              ? 'bg-sage-600 border-sage-600 text-white'
                              : 'border-sage-300 dark:border-ink-600',
                          )}
                          aria-hidden="true"
                        >
                          {g.purchased && <Check size={11} strokeWidth={3} />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span
                            className={clsx(
                              'block text-xs truncate',
                              g.purchased
                                ? 'text-sage-400 dark:text-ink-500 line-through'
                                : 'text-sage-900 dark:text-cream-50',
                            )}
                          >
                            {g.name}
                          </span>
                          {g.quantity && (
                            <span className="block text-[10px] text-sage-500 dark:text-ink-400 truncate">
                              {g.quantity}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {bought.length > 0 && (
              <p className="text-[11px] text-sage-500 dark:text-ink-400 flex items-center gap-1.5">
                <CircleCheck size={13} className="text-sage-600 dark:text-sage-300" />
                {bought.length} already ticked off
              </p>
            )}

            <p className="text-[11px] text-sage-500 dark:text-ink-400 flex items-start gap-1.5 leading-relaxed">
              <Search size={13} className="shrink-0 mt-0.5" />
              Tick an item off here once it is in your basket. The list is the
              same one the Grocery page uses, so nothing has to be written
              twice.
            </p>
          </aside>
        </div>
      </div>
    </>
  );
}
