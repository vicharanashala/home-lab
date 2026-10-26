import { useMemo } from 'react';
import { Check, CircleCheck, Search, ShoppingCart } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store/useStore';

/**
 * The shopping list, as a panel that two screens can show.
 *
 * WHY IT IS ITS OWN COMPONENT: the Digital stores page says "Tap a store to
 * open it inside HomeHub, with your list beside you" — and the store viewer
 * is the screen that sentence is about. The viewer had no list in it, so the
 * promise was false on the one screen it was made for: the owner tapped a
 * store and the list they were reading vanished.
 *
 * WHY ONE COMPONENT AND NOT A COPY OF THE MARKUP: the two screens have to
 * show the SAME list. A copy could drift — an item ticked off in one place
 * and not the other — and the panel's own text says the list is the same one
 * the Grocery page uses, so the code behind it has to be the same one too.
 */
export function ShoppingListPanel() {
  const { grocery, toggleGroceryPurchased } = useStore();

  const toBuy = useMemo(() => grocery.filter((g) => !g.purchased), [grocery]);
  const bought = useMemo(() => grocery.filter((g) => g.purchased), [grocery]);

  return (
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
  );
}
