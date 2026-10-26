import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, ChevronRight } from 'lucide-react';
import { TopBar } from '../components/TopBar';
import { ShoppingListPanel } from '../components/ShoppingListPanel';
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
 * THE SHOPPING LIST IS BESIDE THE STORES BECAUSE THAT IS WHAT THE LIST IS
 * FOR: you open the shop on one screen and tick things off on the other, and
 * a list that lives somewhere else is a list that does not get used. It is
 * the same list the Grocery page uses, so ticking an item off here ticks it
 * off there — nothing has to be written twice.
 *
 * The list stays beside the store when the store is opened too: the viewer
 * shows the same panel, so the promise this page makes is kept on the screen
 * it points at.
 */
export function DigitalStoresPage() {
  const { grocery } = useStore();
  const navigate = useNavigate();

  const toBuyCount = useMemo(
    () => grocery.filter((g) => !g.purchased).length,
    [grocery],
  );

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
                    onClick={() => navigate(`/digital-stores/${s.id}`)}
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
                      <Globe size={13} />
                      <ChevronRight size={14} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <p className="text-[11px] text-sage-500 dark:text-ink-400 leading-relaxed">
              Tap a store to open it inside HomeHub, with your list beside you.
              Delivery times, minimum orders and membership passes change often,
              so each store’s own site is the place to read the current
              details.
            </p>
          </section>

          {/* ── the list to shop from ─────────────────────────────── */}
          <ShoppingListPanel />
        </div>
      </div>
    </>
  );
}
