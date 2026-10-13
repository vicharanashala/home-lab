import { useMemo, useState } from 'react';
import { useScrollFade } from '../hooks/useScrollFade';
import { useStore } from '../store/useStore';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { AddGroceryModal } from '../components/AddGroceryModal';
import { GroceryRow } from '../components/GroceryRow';
import {
  Plus,
  Filter,
  ShoppingCart,
  Trash2,
  Check,
  ListChecks,
  Sparkles,
  CalendarDays,
  ShoppingBasket,
} from 'lucide-react';
import clsx from 'clsx';
import { CATEGORY_LIST, getCategory } from '../utils/categories';
import type { CategoryId } from '../types';
import { EmptyState } from '../components/EmptyState';
import { ConfirmModal } from '../components/ConfirmModal';
import { useAutoGrocery } from '../hooks/useAutoGrocery';
import { CategoryIcon } from '../components/icons/AppIcons';

type Filter = 'all' | 'pending' | 'purchased';

export function GroceryPage() {
  const { grocery, clearPurchasedGrocery, toast } = useStore();
  const [filter, setFilter] = useState<Filter>('pending');
  const [category, setCategory] = useState<CategoryId | 'all'>('all');
  const [openAdd, setOpenAdd] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const navigate = useNavigate();
  const {
    toBuy, generate, hasPlan, plannedDays, dayLabels, totalDays, ready,
  } = useAutoGrocery();

  const filtered = useMemo(() => {
    let list = grocery;
    if (filter === 'pending') list = list.filter((g) => !g.purchased);
    if (filter === 'purchased') list = list.filter((g) => g.purchased);
    if (category !== 'all') list = list.filter((g) => g.category === category);
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
  }, [grocery, filter, category]);

  const grouped = useMemo(() => {
    const map = new Map<CategoryId, typeof filtered>();
    for (const item of filtered) {
      const arr = map.get(item.category) ?? [];
      arr.push(item);
      map.set(item.category, arr);
    }
    // stable category order
    return CATEGORY_LIST.filter((c) => map.has(c.id)).map((c) => ({
      category: c,
      items: map.get(c.id)!,
    }));
  }, [filtered]);

  const pendingCount = grocery.filter((g) => !g.purchased).length;
  const purchasedCount = grocery.filter((g) => g.purchased).length;

  const handleClearPurchased = () => {
    if (purchasedCount === 0) return;
    setConfirmClear(true);
  };

  const doClearPurchased = () => {
    const n = clearPurchasedGrocery();
    toast(`Cleared ${n} purchased item${n === 1 ? '' : 's'}`, 'info');
  };

  const catFadeRef = useScrollFade<HTMLDivElement>();

  return (
    <>
      <TopBar title="Grocery List" subtitle={`${pendingCount} to buy · ${purchasedCount} done`} />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-4 space-y-4">
        {/* Filter chips */}
        <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
          {(['pending', 'purchased', 'all'] as Filter[]).map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={clsx(
                  'shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                  active
                    ? 'bg-sage-700 text-white shadow-soft'
                    : 'bg-white text-sage-700 border border-sage-200 hover:bg-sage-50',
                )}
              >
                {f === 'pending' ? 'To buy' : f === 'purchased' ? 'Purchased' : 'All'}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {purchasedCount > 0 && filter !== 'pending' && (
              <button
                onClick={handleClearPurchased}
                className="text-xs font-semibold text-tomato-700 bg-tomato-50 hover:bg-tomato-100 rounded-full px-3 py-2 inline-flex items-center gap-1.5"
              >
                <Trash2 size={14} />
                Clear purchased
              </button>
            )}
          </div>
        </div>

        {/* Category filter */}
        <div className="card p-3">
          <div className="flex items-center gap-2 mb-2 px-1">
            <Filter size={14} className="text-sage-500" />
            <span className="text-xs font-semibold text-sage-600 uppercase tracking-wider">
              Category
            </span>
          </div>
          <div ref={catFadeRef} className="scroll-fade-x flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <button
              onClick={() => setCategory('all')}
              className={clsx(
                'shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                category === 'all'
                  ? 'bg-sage-700 text-white'
                  : 'bg-sage-50 text-sage-700 hover:bg-sage-100',
              )}
            >
              <ListChecks size={12} />
              All
            </button>
            {CATEGORY_LIST.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={clsx(
                  'shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  category === c.id
                    ? `${c.color} ring-1 ${c.ring}`
                    : 'bg-sage-50 text-sage-700 hover:bg-sage-100',
                )}
              >
                <CategoryIcon id={c.id} size={14} />
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Summary card */}
        <div className="grid grid-cols-2 gap-3">
          <div
            className="relative overflow-hidden rounded-2xl p-4 ring-1 ring-emerald-200/60 dark:ring-emerald-800/40 shadow-sm"
            style={{
              background:
                'linear-gradient(135deg, rgba(220, 252, 231, 0.9) 0%, rgba(167, 243, 208, 0.7) 100%)',
              backdropFilter: 'blur(20px) saturate(160%)',
            }}
          >
            <div
              className="absolute -right-6 -bottom-6 w-24 h-24 rounded-full opacity-50"
              style={{
                background:
                  'radial-gradient(circle, rgba(16, 185, 129, 0.5) 0%, transparent 70%)',
                filter: 'blur(20px)',
              }}
            />
            <div className="relative flex items-center gap-2 text-emerald-700 dark:text-emerald-300 mb-1">
              <ShoppingCart size={14} />
              <span className="text-xs font-semibold uppercase tracking-wider">To buy</span>
            </div>
            <div className="relative font-display text-3xl font-extrabold text-emerald-900 dark:text-emerald-50 tabular-nums">
              {pendingCount}
            </div>
          </div>
          <div
            className="relative overflow-hidden rounded-2xl p-4 ring-1 ring-sky-200/60 dark:ring-sky-800/40 shadow-sm"
            style={{
              background:
                'linear-gradient(135deg, rgba(224, 242, 254, 0.9) 0%, rgba(186, 230, 253, 0.7) 100%)',
              backdropFilter: 'blur(20px) saturate(160%)',
            }}
          >
            <div
              className="absolute -right-6 -bottom-6 w-24 h-24 rounded-full opacity-50"
              style={{
                background:
                  'radial-gradient(circle, rgba(59, 130, 246, 0.5) 0%, transparent 70%)',
                filter: 'blur(20px)',
              }}
            />
            <div className="relative flex items-center gap-2 text-sky-700 dark:text-sky-300 mb-1">
              <Check size={14} />
              <span className="text-xs font-semibold uppercase tracking-wider">Done</span>
            </div>
            <div className="relative font-display text-3xl font-extrabold text-sky-900 dark:text-sky-50 tabular-nums">
              {purchasedCount}
            </div>
          </div>
        </div>

        {/* Autogenerate from the weekly meal plan */}
        <div className="card p-4 border-sage-300 dark:border-sage-800">
          <div className="flex items-start gap-3">
            <span className="shrink-0 w-10 h-10 rounded-xl bg-sage-100 dark:bg-sage-900/40 grid place-items-center">
              <Sparkles size={18} className="text-sage-700 dark:text-sage-300" />
            </span>
            <div className="flex-1 min-w-0">
              <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50 leading-tight">
                Autogenerate grocery list
              </h3>
              <p className="text-xs text-sage-600 dark:text-ink-300 mt-0.5">
                {!hasPlan
                  ? 'Plan your meals for the week first, then this fills your list with everything the recipes need.'
                  : ready
                  ? `${plannedDays} of ${totalDays} days planned · ${toBuy.length} item${
                      toBuy.length === 1 ? '' : 's'
                    } you're missing.`
                  : `${plannedDays} of ${totalDays} days planned · your fridge already covers everything.`}
              </p>
              {hasPlan && dayLabels.length > 0 && (
                <p className="text-[11px] text-sage-500 dark:text-ink-400 mt-1.5">
                  Reading only: <span className="font-semibold">{dayLabels.join(', ')}</span>
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              const r = generate();
              if (r.added === 0) {
                toast(
                  r.alreadyOnList > 0
                    ? 'Those items are already on your list'
                    : 'Nothing to add — your fridge already covers the plan',
                  'info',
                );
              } else {
                toast(`Added ${r.added} item${r.added === 1 ? '' : 's'} from your meal plan`, 'success');
              }
            }}
            disabled={!hasPlan}
            className={clsx(
              'mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl font-bold py-2.5 text-sm transition',
              hasPlan
                ? 'bg-sage-700 hover:bg-sage-800 text-white active:scale-[.99]'
                : 'bg-sage-100 dark:bg-ink-700 text-sage-400 dark:text-ink-500 cursor-not-allowed',
            )}
          >
            {hasPlan ? <Sparkles size={15} /> : <CalendarDays size={15} />}
            {hasPlan ? 'Autogenerate grocery list' : 'Plan your meals first'}
          </button>
          {pendingCount > 0 && (
            <button
              onClick={() => navigate('/shopping')}
              className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white dark:bg-ink-800 border border-sage-300 dark:border-ink-600 text-sage-800 dark:text-cream-50 font-bold py-2.5 text-sm hover:bg-sage-50 dark:hover:bg-ink-700 active:scale-[.99] transition"
            >
              <ShoppingBasket size={16} />
              Start shopping ({pendingCount})
            </button>
          )}
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title={
              filter === 'pending'
                ? 'Nothing to buy right now'
                : filter === 'purchased'
                ? 'No purchased items yet'
                : 'Your grocery list is empty'
            }
            hint={
              filter === 'pending'
                ? 'Add items you need and tick them off as you shop.'
                : 'Items you mark as purchased will show up here.'
            }
            action={
              <button onClick={() => setOpenAdd(true)} className="btn-primary">
                <Plus size={18} /> Add grocery item
              </button>
            }
          />
        ) : (
          <div className="space-y-5">
            {grouped.map((g) => (
              <section key={g.category.id} className="card p-2 px-4">
                <div className="flex items-center gap-2 py-2">
                  <span
                    className={clsx(
                      'inline-flex items-center justify-center w-8 h-8 rounded-lg',
                      g.category.color,
                    )}
                  >
                    <CategoryIcon id={g.category.id} size={18} />
                  </span>
                  <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">
                    {g.category.label}
                  </h3>
                  <span className="text-xs text-sage-500 font-semibold">
                    {g.items.length}
                  </span>
                </div>
                <ul className="divide-y divide-sage-100">
                  {g.items.map((it) => (
                    <li key={it.id}>
                      <GroceryRow item={it} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {/* Clears the floating add button on phones. */}
        <div className="h-24 sm:h-4" />
      </div>

      {/* Floating Add button (mobile) */}
      <button
        onClick={() => setOpenAdd(true)}
        className="sm:hidden fixed bottom-[calc(var(--hh-nav-space)+0.75rem)] right-4 z-30 w-14 h-14 rounded-full bg-sage-700 text-white shadow-pop grid place-items-center active:scale-95"
        aria-label="Add grocery item"
      >
        <Plus size={26} strokeWidth={2.5} />
      </button>

      <AddGroceryModal open={openAdd} onClose={() => setOpenAdd(false)} />

      <ConfirmModal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={doClearPurchased}
        title="Clear purchased items?"
        message={`This will permanently remove ${purchasedCount} purchased item${purchasedCount === 1 ? '' : 's'} from your grocery list.`}
        confirmLabel={`Clear ${purchasedCount}`}
      />
    </>
  );
}
