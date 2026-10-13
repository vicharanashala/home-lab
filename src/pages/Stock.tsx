import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { CategoryIcon } from '../components/icons/AppIcons';
import { TopBar } from '../components/TopBar';
import { AddStockModal } from '../components/AddStockModal';
import { EditStockModal } from '../components/EditStockModal';
import { StockRow } from '../components/StockRow';
import {
  Filter,
  ListChecks,
  Plus,
  Refrigerator,
  Archive,
  AlertTriangle,
  Search,
  Package,
  CircleCheck,
  Snowflake,
  ShoppingBasket,
} from 'lucide-react';
import clsx from 'clsx';
import { CATEGORY_LIST } from '../utils/categories';
import { useScrollFade } from '../hooks/useScrollFade';
import type { CategoryId, StockItem, StockLocation } from '../types';
import { EmptyState } from '../components/EmptyState';
import { daysUntil } from '../utils/date';

type StatusFilter = 'all' | 'low' | 'expiring';

export function StockPage() {
  const { stock, settings } = useStore();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [locationFilter, setLocationFilter] = useState<'all' | StockLocation>('all');
  const [category, setCategory] = useState<CategoryId | 'all'>('all');
  const [search, setSearch] = useState('');
  const [openAdd, setOpenAdd] = useState(false);
  const [openAddLocation, setOpenAddLocation] = useState<StockLocation>('fridge');
  const [editing, setEditing] = useState<StockItem | null>(null);

  const expiringSoon = useMemo(() => {
    const soon = settings.expiringSoonDays;
    return stock.filter((it) => {
      // Use the project-wide helper so timezone math matches the rest of the app.
      // `new Date(iso)` parses 'yyyy-MM-dd' as UTC midnight; differenceInCalendarDays
      // converts both sides to local calendar dates so a date in IST doesn't shift
      // half a day earlier the way raw millisecond math would.
      const days = daysUntil(it.expiryDate);
      return days !== null && days <= soon;
    });
  }, [stock, settings.expiringSoonDays]);

  const lowCount = useMemo(
    () => stock.filter((it) => it.quantity <= it.lowStockThreshold).length,
    [stock],
  );

  const fridgeCount = useMemo(
    () => stock.filter((it) => (it.location ?? 'fridge') === 'fridge').length,
    [stock],
  );
  const pantryCount = useMemo(
    () => stock.filter((it) => (it.location ?? 'fridge') === 'pantry').length,
    [stock],
  );

  // Set for O(1) expiringSoon membership check instead of O(n) Array.includes.
  const expiringSoonIds = useMemo(
    () => new Set(expiringSoon.map((it) => it.id)),
    [expiringSoon],
  );

  const filtered = useMemo(() => {
    let list = stock;
    if (locationFilter !== 'all') {
      list = list.filter((it) => (it.location ?? 'fridge') === locationFilter);
    }
    if (statusFilter === 'low') list = list.filter((it) => it.quantity <= it.lowStockThreshold);
    if (statusFilter === 'expiring') list = list.filter((it) => expiringSoonIds.has(it.id));
    if (category !== 'all') list = list.filter((it) => it.category === category);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          (it.notes ?? '').toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [stock, statusFilter, locationFilter, category, search, expiringSoonIds]);

  const catFadeRef = useScrollFade<HTMLDivElement>();

  return (
    <>
      <TopBar
        title="Kitchen Stock"
        subtitle={`${stock.length} item${stock.length === 1 ? '' : 's'} at home`}
      />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sage-400 pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your kitchen & pantry…"
            className="input pl-10"
          />
        </div>

        {/* Where filter */}
        <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {([
            { v: 'all' as const, label: `All (${stock.length})`, Icon: ListChecks, tint: 'sage' },
            { v: 'fridge' as const, label: `Fridge (${fridgeCount})`, Icon: Refrigerator, tint: 'sage' },
            { v: 'pantry' as const, label: `Pantry (${pantryCount})`, Icon: Archive, tint: 'butter' },
          ]).map((f) => {
            const active = locationFilter === f.v;
            return (
              <button
                key={f.v}
                onClick={() => setLocationFilter(f.v)}
                className={clsx(
                  'shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                  active
                    ? f.tint === 'butter'
                      ? 'bg-butter-500 text-white shadow-soft'
                      : 'bg-sage-700 text-white shadow-soft'
                    : 'bg-white dark:bg-ink-800 text-sage-700 dark:text-cream-50 border border-sage-200 dark:border-ink-700 hover:bg-sage-50 dark:hover:bg-ink-700',
                )}
              >
                <f.Icon size={14} />
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {([
            { v: 'all' as const, label: 'All status' },
            { v: 'low' as const, label: `Low (${lowCount})`, danger: true },
            { v: 'expiring' as const, label: `Expiring (${expiringSoon.length})`, warn: true },
          ]).map((f) => {
            const active = statusFilter === f.v;
            return (
              <button
                key={f.v}
                onClick={() => setStatusFilter(f.v)}
                className={clsx(
                  'shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  active
                    ? f.danger
                      ? 'bg-tomato-600 text-white shadow-soft'
                      : f.warn
                      ? 'bg-butter-500 text-white shadow-soft'
                      : 'bg-sage-700 text-white shadow-soft'
                    : 'bg-sage-50 dark:bg-ink-800 text-sage-700 dark:text-cream-50 hover:bg-sage-100 dark:hover:bg-ink-700',
                )}
              >
                {f.label}
              </button>
            );
          })}
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

        {/* List */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={
              locationFilter === 'pantry' ? Package :
              statusFilter === 'low' ? CircleCheck :
              statusFilter === 'expiring' ? Snowflake : ShoppingBasket
            }
            title={
              statusFilter === 'low'
                ? 'Nothing is running low'
                : statusFilter === 'expiring'
                ? 'Nothing expiring soon'
                : locationFilter === 'pantry'
                ? 'Your pantry is empty'
                : locationFilter === 'fridge'
                ? 'Your fridge is empty'
                : search
                ? 'No matches found'
                : 'Your kitchen is empty'
            }
            hint={
              search
                ? 'Try a different search term.'
                : statusFilter === 'all' && locationFilter === 'all'
                ? 'Tap Add to start tracking what you have at home.'
                : 'Adjust filters to see all items.'
            }
            action={
              !search && statusFilter === 'all' && locationFilter === 'all' ? (
                <button onClick={() => setOpenAdd(true)} className="btn-primary">
                  <Plus size={18} /> Add stock item
                </button>
              ) : undefined
            }
          />
        ) : (
          <section className="card p-2 px-4">
            <ul className="divide-y divide-sage-100">
              {filtered.map((it) => (
                <li key={it.id}>
                  <StockRow item={it} onEdit={(it) => setEditing(it)} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="h-4" />
      </div>

      {/* Floating Add buttons — one for fridge, one for pantry (mobile) */}
      <div className="sm:hidden fixed bottom-[calc(var(--hh-nav-space)+0.75rem)] right-4 z-30 flex flex-col gap-2">
        <button
          onClick={() => {
            setOpenAddLocation('pantry');
            setOpenAdd(true);
          }}
          className="w-12 h-12 rounded-full bg-butter-500 text-white shadow-pop grid place-items-center active:scale-95"
          aria-label="Add pantry item"
          title="Add pantry item"
        >
          <Archive size={20} strokeWidth={2.5} />
        </button>
        <button
          onClick={() => {
            setOpenAddLocation('fridge');
            setOpenAdd(true);
          }}
          className="w-14 h-14 rounded-full bg-sage-700 text-white shadow-pop grid place-items-center active:scale-95"
          aria-label="Add fridge item"
          title="Add fridge item"
        >
          <Plus size={26} strokeWidth={2.5} />
        </button>
      </div>

      <AddStockModal
        open={openAdd}
        onClose={() => setOpenAdd(false)}
        defaultLocation={openAddLocation}
      />
      {editing && (
        <EditStockModal
          item={editing}
          open={!!editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
