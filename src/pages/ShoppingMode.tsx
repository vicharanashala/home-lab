import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ShoppingCart, Check, Trash2, CircleCheck } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store/useStore';
import { CategoryIcon } from '../components/icons/AppIcons';
import { getCategory, CATEGORY_LIST } from '../utils/categories';
import type { CategoryId } from '../types';

/**
 * Shopping mode — a deliberately different screen for a different job.
 *
 * The grocery page is for browsing and organising. This is for standing in an
 * aisle with one hand on a trolley: large tick targets, quantities always
 * visible, and bought items settling to the bottom so what you still have to
 * find stays on screen.
 */
export function ShoppingModePage() {
  const { grocery, toggleGroceryPurchased, clearPurchasedGrocery, toast } = useStore();
  const navigate = useNavigate();
  const [hideDone, setHideDone] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);

  const { pending, done } = useMemo(() => {
    const p = grocery.filter((g) => !g.purchased);
    const d = grocery.filter((g) => g.purchased);
    // Group the pending items by aisle order rather than by date added.
    const order = new Map<CategoryId, number>();
    CATEGORY_LIST.forEach((c, i) => order.set(c.id, i));
    p.sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99));
    return { pending: p, done: d };
  }, [grocery]);

  const progress = grocery.length === 0 ? 0 : Math.round((done.length / grocery.length) * 100);

  if (grocery.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center">
        <span className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-sage-100 dark:bg-sage-900/30 text-sage-600 dark:text-sage-300 mb-4">
          <ShoppingCart size={34} />
        </span>
        <h1 className="font-display text-xl font-bold text-sage-900 dark:text-cream-50">
          Nothing to shop for
        </h1>
        <p className="text-sm text-sage-600 dark:text-ink-300 mt-1.5 max-w-xs mx-auto">
          Add items to your grocery list, or autogenerate one from your meal plan.
        </p>
        <button
          onClick={() => navigate('/grocery')}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sage-700 hover:bg-sage-800 text-white font-bold px-5 py-3"
        >
          Back to grocery list
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 pb-16 pt-3">
      <button
        onClick={() => navigate('/grocery')}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-sage-600 dark:text-ink-300 mb-3"
      >
        <ChevronLeft size={16} /> Back
      </button>

      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="font-display text-2xl font-extrabold text-sage-900 dark:text-cream-50">
          Shopping
        </h1>
        <span className="text-sm font-bold text-sage-700 dark:text-sage-300 tabular-nums">
          {done.length}/{grocery.length}
        </span>
      </div>

      <div className="h-2 rounded-full bg-sage-100 dark:bg-ink-700 overflow-hidden mb-4">
        <div
          className={clsx(
            'h-full transition-all duration-300',
            progress === 100 ? 'bg-sage-500' : 'bg-butter-500',
          )}
          style={{ width: `${progress}%` }}
        />
      </div>

      {pending.length === 0 && (
        <div className="card text-center py-10 px-5 mb-4">
          <span className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-sage-100 dark:bg-sage-900/30 text-sage-600 dark:text-sage-300 mb-3">
            <CircleCheck size={28} />
          </span>
          <h2 className="font-display text-lg font-bold text-sage-900 dark:text-cream-50">
            All done!
          </h2>
          <p className="text-sm text-sage-600 dark:text-ink-300 mt-1">
            Everything on the list is in your trolley.
          </p>
          <button
            onClick={() => setConfirmClear(true)}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-tomato-700 dark:text-tomato-300 hover:underline"
          >
            <Trash2 size={14} /> Clear purchased items
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <ul className="space-y-2 mb-4">
          {pending.map((item) => {
            const cat = getCategory(item.category);
            return (
              <li key={item.id}>
                <button
                  onClick={() => toggleGroceryPurchased(item.id)}
                  className="w-full flex items-center gap-3 rounded-2xl bg-white dark:bg-ink-800 border border-sage-200 dark:border-ink-700 px-4 py-4 text-left active:scale-[.99] transition"
                >
                  <span
                    className={clsx(
                      'shrink-0 w-10 h-10 rounded-xl grid place-items-center',
                      cat.color,
                    )}
                  >
                    <CategoryIcon id={item.category} size={20} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold text-sage-900 dark:text-cream-50 text-[15px] truncate">
                      {item.name}
                    </span>
                    <span className="block text-xs text-sage-500 dark:text-ink-400 mt-0.5">
                      {item.quantity}
                    </span>
                  </span>
                  <span className="shrink-0 w-7 h-7 rounded-full border-2 border-sage-300 dark:border-ink-600" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {done.length > 0 && (
        <div>
          <button
            onClick={() => setHideDone((v) => !v)}
            className="text-xs font-bold text-sage-500 dark:text-ink-400 flex items-center gap-1.5 mb-2"
          >
            <Check size={13} /> In the trolley ({done.length})
          </button>
          {!hideDone && (
            <ul className="space-y-1.5 mb-4">
              {done.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => toggleGroceryPurchased(item.id)}
                    className="w-full flex items-center gap-3 rounded-xl bg-sage-50 dark:bg-sage-900/20 border border-sage-200 dark:border-sage-800 px-3 py-2.5 text-left active:scale-[.99] transition"
                  >
                    <span className="shrink-0 w-8 h-8 rounded-lg bg-white dark:bg-ink-800 grid place-items-center opacity-60">
                      <CategoryIcon id={item.category} size={16} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-sage-600 dark:text-ink-300 line-through truncate">
                        {item.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-sage-500 dark:text-ink-400">
                      {item.quantity}
                    </span>
                    <Check size={15} className="shrink-0 text-sage-600 dark:text-sage-400" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pending.length > 0 && (
            <button
              onClick={() => setConfirmClear(true)}
              className="text-xs font-semibold text-sage-500 dark:text-ink-400 hover:text-tomato-600 flex items-center gap-1.5 px-1"
            >
              <Trash2 size={13} /> Clear purchased
            </button>
          )}
        </div>
      )}

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            aria-label="Cancel"
            onClick={() => setConfirmClear(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <div className="relative w-full max-w-sm rounded-3xl bg-white dark:bg-ink-800 p-5 shadow-pop">
            <h2 className="font-display text-lg font-bold text-sage-900 dark:text-cream-50">
              Clear the trolley?
            </h2>
            <p className="text-sm text-sage-600 dark:text-ink-300 mt-1.5">
              This removes the {done.length} item{done.length === 1 ? '' : 's'} you already ticked
              off.
            </p>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setConfirmClear(false)}
                className="flex-1 rounded-xl bg-sage-100 dark:bg-ink-700 text-sage-800 dark:text-cream-50 font-bold py-3"
              >
                Keep
              </button>
              <button
                onClick={() => {
                  const n = clearPurchasedGrocery();
                  setConfirmClear(false);
                  toast(`Cleared ${n} item${n === 1 ? '' : 's'}`, 'info');
                }}
                className="flex-1 rounded-xl bg-tomato-600 text-white font-bold py-3"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}