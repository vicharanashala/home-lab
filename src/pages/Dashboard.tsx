import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingCart,
  Refrigerator,
  Bell,
  AlertTriangle,
  ChevronRight,
  Sparkles,
  CalendarClock,
  ChefHat,
  Trash2,
  Coffee,
  Sun,
  Moon,
  Check,
  Plus,
  CalendarDays,
  Snowflake,
  CircleCheck,
  ShoppingBasket,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { DietIcon } from '../components/icons/AppIcons';
import { PlateIcon } from '../components/icons/DishIcons';
import { TopBar } from '../components/TopBar';
import { AddGroceryModal } from '../components/AddGroceryModal';
import { AddStockModal } from '../components/AddStockModal';
import { LogMealModal } from '../components/LogMealModal';
import { EndOfDayMeals } from '../components/EndOfDayMeals';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber';
import { format } from 'date-fns';
import { dietEmoji, dietLabel } from '../utils/categories';
import { daysUntil, expiryBucket } from '../utils/date';
import { GroceryRow } from '../components/GroceryRow';
import { StockRow } from '../components/StockRow';
import { NearbyStoresCard } from '../components/NearbyStoresCard';
import clsx from 'clsx';
import type { MealLog, MealType } from '../types';

export function Dashboard() {
  const { grocery, stock, settings, mealLogs, removeMealLog, toast } = useStore();
  const [openGrocery, setOpenGrocery] = useState(false);
  const [openStock, setOpenStock] = useState(false);
  const [openMeal, setOpenMeal] = useState(false);
  const [openEndOfDay, setOpenEndOfDay] = useState(false);

  // Open End-of-Day modal when launched from a notification click.
  useEffect(() => {
    const open = () => setOpenEndOfDay(true);
    window.addEventListener('homehub:open-end-of-day', open);
    return () => window.removeEventListener('homehub:open-end-of-day', open);
  }, []);

  // Let other pages deep-link straight into the meal logger. The taste-match
  // card uses this: it tells the user it needs logged meals, so it should also
  // offer the button that fixes it rather than being a dead end.
  useEffect(() => {
    const open = () => setOpenMeal(true);
    window.addEventListener('homehub:open-log-meal', open);
    return () => window.removeEventListener('homehub:open-log-meal', open);
  }, []);

  const today = format(new Date(), 'EEEE, MMM d');
  const displayName = settings.userName?.trim();
  const title = displayName ? `${timeOfDayGreeting(displayName)} 👋` : `${timeOfDayGreeting()} 👋`;

  const openGroceryItems = useMemo(
    () => grocery.filter((g) => !g.purchased).slice(0, 5),
    [grocery],
  );
  const openGroceryCount = useMemo(
    () => grocery.filter((g) => !g.purchased).length,
    [grocery],
  );

  const lowStockItems = useMemo(
    () =>
      stock
        .filter((it) => it.quantity <= it.lowStockThreshold)
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 4),
    [stock],
  );

  const expiringItems = useMemo(() => {
    return stock
      .filter((it) => {
        const bucket = expiryBucket(it.expiryDate, settings.expiringSoonDays);
        return bucket === 'expired' || bucket === 'soon';
      })
      .sort((a, b) => {
        const ad = daysUntil(a.expiryDate) ?? 999;
        const bd = daysUntil(b.expiryDate) ?? 999;
        return ad - bd;
      })
      .slice(0, 4);
  }, [stock, settings.expiringSoonDays]);

  const todaysLogs = useMemo(
    () => mealLogs.filter((m) => isSameDay(m.createdAt, new Date())),
    [mealLogs],
  );

  return (
    <>
      {/* The hero card directly below already greets by name, so the bar
          names the screen instead. Saying it twice within one screenful
          wasted the top of a phone screen. */}
      <TopBar title="Home" subtitle={today} />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-4 sm:pt-5 space-y-4 sm:space-y-6">
        {/* Welcome hero */}
        <section
          className="rounded-3xl text-white p-4 sm:p-7 shadow-soft relative overflow-hidden border border-white/10"
          style={{
            background:
              'linear-gradient(135deg, #16a34a 0%, #059669 25%, #0d9488 60%, #1e3a8a 100%)',
            backgroundSize: '200% 200%',
            animation: 'dashgrad 18s ease-in-out infinite',
          }}
        >
          <style>{`@keyframes dashgrad { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }`}</style>
          <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full bg-white/15 blur-md" />
          <div className="absolute -right-4 bottom-0 w-32 h-32 rounded-full bg-white/8" />
          <div className="absolute left-1/3 -top-6 w-24 h-24 rounded-full bg-butter-300/40 dark:bg-butter-400/15 blur-2xl" />
          <div className="shimmer-overlay absolute inset-0 rounded-3xl" />
          {/* Soft inner highlight */}
          <div className="absolute inset-0 rounded-3xl pointer-events-none" style={{ boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.25)' }} />
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 backdrop-blur-md px-3 py-1 text-xs font-semibold mb-3 ring-1 ring-white/30 shadow-sm">
              <Sparkles size={14} />
              HomeHub
            </div>
            <h2
              className="font-display text-2xl sm:text-4xl font-extrabold leading-[1.15] sm:leading-[1.1] tracking-tight"
              style={{ textShadow: '0 1px 0 rgba(0, 0, 0, 0.15)' }}
            >
              {timeOfDayGreeting(settings.userName)}.
            </h2>
            <p className="text-white/85 mt-1.5 sm:mt-2 text-[13px] sm:text-base max-w-md">
              Plan your shopping, track what's at home, and never miss an expiry.
            </p>

            {(settings.dietaryPreference !== 'no-preference' || settings.allergies.length > 0) && (
              <div className="mt-4 flex flex-wrap gap-2">
                {settings.dietaryPreference !== 'no-preference' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 backdrop-blur-md px-3 py-1 text-xs font-semibold ring-1 ring-white/25">
                    <DietIcon diet={settings.dietaryPreference} size={14} />
                    {dietLabel(settings.dietaryPreference)}
                  </span>
                )}
                {settings.allergies.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 backdrop-blur-md px-3 py-1 text-xs font-semibold ring-1 ring-white/25">
                    <AlertTriangle size={12} />
                    {settings.allergies.length === 1
                      ? `Avoid: ${settings.allergies[0]}`
                      : `Avoiding ${settings.allergies.length} allergens`}
                  </span>
                )}
              </div>
            )}

            <div className="mt-4 sm:mt-5 grid grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-3">
              <button
                onClick={() => setOpenGrocery(true)}
                className="lift flex flex-col items-center gap-1.5 bg-white/95 dark:bg-white/10 text-sage-800 dark:text-cream-50 rounded-2xl px-3 py-3 font-semibold shadow-soft hover:bg-white dark:hover:bg-white/15 active:scale-[.98] transition"
                aria-label="Add grocery"
              >
                <span className="w-10 h-10 rounded-xl bg-sage-100 dark:bg-sage-900/40 grid place-items-center">
                  <ShoppingCart size={20} className="text-sage-700 dark:text-sage-300" />
                </span>
                <span className="text-xs">Grocery</span>
              </button>
              <button
                onClick={() => setOpenStock(true)}
                className="lift flex flex-col items-center gap-1.5 bg-white/95 dark:bg-white/10 text-sage-800 dark:text-cream-50 rounded-2xl px-3 py-3 font-semibold shadow-soft hover:bg-white dark:hover:bg-white/15 active:scale-[.98] transition"
                aria-label="Add stock"
              >
                <span className="w-10 h-10 rounded-xl bg-butter-100 dark:bg-butter-900/40 grid place-items-center">
                  <Refrigerator size={20} className="text-butter-700 dark:text-butter-300" />
                </span>
                <span className="text-xs">Stock</span>
              </button>
              <button
                onClick={() => setOpenMeal(true)}
                className="lift flex flex-col items-center gap-1.5 bg-white/95 dark:bg-white/10 text-sage-800 dark:text-cream-50 rounded-2xl px-3 py-3 font-semibold shadow-soft hover:bg-white dark:hover:bg-white/15 active:scale-[.98] transition"
                aria-label="Log a meal"
              >
                <span className="w-10 h-10 rounded-xl bg-tomato-100 dark:bg-tomato-900/40 grid place-items-center">
                  <ChefHat size={20} className="text-tomato-700 dark:text-tomato-300" />
                </span>
                <span className="text-xs">Quick log</span>
              </button>
              <button
                onClick={() => setOpenEndOfDay(true)}
                className="lift flex flex-col items-center gap-1.5 bg-tomato-600 hover:bg-tomato-700 text-white rounded-2xl px-3 py-3 font-semibold shadow-soft active:scale-[.98] transition border-2 border-tomato-700"
                aria-label="End of day — log all meals"
              >
                <PlateIcon size={22} />
                <span className="text-xs font-bold">End of day</span>
              </button>
              <Link
                to="/meal-plan"
                className="lift col-span-2 sm:col-span-1 flex items-center justify-center gap-2.5 bg-white/95 dark:bg-white/10 text-sage-800 dark:text-cream-50 rounded-2xl px-3 py-3 font-semibold shadow-soft hover:bg-white dark:hover:bg-white/15 active:scale-[.98] transition"
                aria-label="Make your meal plan"
              >
                <span className="w-10 h-10 rounded-xl bg-sage-100 dark:bg-sage-900/40 grid place-items-center">
                  <CalendarDays size={20} className="text-sage-700 dark:text-sage-300" />
                </span>
                <span className="text-xs">Meal plan</span>
              </Link>
            </div>
          </div>
        </section>

        {/* Today's meals progress card */}
        <TodaysMealsCard
          todaysLogs={todaysLogs}
          onOpen={() => setOpenEndOfDay(true)}
        />

        {/* Discover — ML-powered recipe recommendations */}
        <Link
          to="/discover"
          className="lift block relative overflow-hidden rounded-3xl bg-gradient-to-br from-butter-100 via-cream-50 to-sage-50 dark:from-ink-700 dark:via-ink-800 dark:to-sage-900/40 border border-butter-200/60 dark:border-ink-700 shadow-soft p-5"
        >
          <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-butter-200/40 dark:bg-sage-700/20 blur-2xl" />
          <div className="relative flex items-start gap-3">
            <span className="shrink-0 w-12 h-12 rounded-2xl bg-white dark:bg-ink-700 grid place-items-center shadow-soft">
              <Sparkles size={22} className="text-butter-600 dark:text-butter-300" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-display font-bold text-lg text-sage-900 dark:text-cream-50">
                  Try something new
                </h3>
                <span className="text-[10px] font-bold tracking-wider uppercase rounded-full bg-sage-700 text-white px-2 py-0.5">
                  ML
                </span>
              </div>
              <p className="text-sm text-sage-700 dark:text-sage-200 leading-snug">
                Personalized picks from 6,000+ recipes — based on what you've cooked and what's already in your kitchen.
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-sage-700 dark:text-sage-300">
                Open Discover
                <ChevronRight size={16} />
              </span>
            </div>
          </div>
        </Link>

        {/* Stat tiles */}
        <section className="grid grid-cols-3 gap-3">
          <StatTile
            to="/grocery"
            label="To buy"
            value={openGroceryCount}
            accent="bg-sage-50 text-sage-800"
            icon={<ShoppingCart size={18} className="text-sage-700" />}
          />
          <StatTile
            to="/stock"
            label="In stock"
            value={stock.length}
            accent="bg-butter-50 text-butter-800"
            icon={<Refrigerator size={18} className="text-butter-700" />}
          />
          <StatTile
            to="/alerts"
            label="Alerts"
            value={lowStockItems.length + expiringItems.length}
            accent={
              lowStockItems.length + expiringItems.length > 0
                ? 'bg-tomato-50 text-tomato-700'
                : 'bg-sage-50 text-sage-700'
            }
            icon={<Bell size={18} className="text-tomato-600" />}
          />
        </section>

        {/* Today's grocery list */}
        <section className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-display font-bold text-lg text-sage-900 dark:text-cream-50">Today's grocery list</h3>
              <p className="text-xs text-sage-500 dark:text-ink-300">
                {openGroceryCount === 0
                  ? 'Nothing to buy right now — nice!'
                  : `${openGroceryCount} item${openGroceryCount === 1 ? '' : 's'} remaining`}
              </p>
            </div>
            <Link
              to="/grocery"
              className="text-sm font-semibold text-sage-700 hover:text-sage-900 dark:text-sage-300 dark:hover:text-cream-50 inline-flex items-center gap-1"
            >
              See all
              <ChevronRight size={16} />
            </Link>
          </div>

          {openGroceryItems.length === 0 ? (
            <EmptyMini
              icon={ShoppingCart}
              title="Your grocery list is empty"
              hint="Tap Add to start your shopping list."
            />
          ) : (
            <ul className="divide-y divide-sage-100">
              {openGroceryItems.map((item) => (
                <li key={item.id}>
                  <GroceryRow item={item} />
                </li>
              ))}
            </ul>
          )}

          {openGroceryCount > openGroceryItems.length && (
            <Link
              to="/grocery"
              className="block mt-3 text-center text-sm font-semibold text-sage-700 hover:text-sage-900 dark:text-sage-300 dark:hover:text-cream-50"
            >
              + {openGroceryCount - openGroceryItems.length} more on the list
            </Link>
          )}
        </section>

        {/* Today's meals */}
        <MealsToday
          mealLogs={mealLogs}
          onLogNew={() => setOpenMeal(true)}
          onRemove={(id) => {
            removeMealLog(id);
            toast('Meal removed', 'info');
          }}
        />

        {/* Low stock */}
        <section className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-tomato-50 text-tomato-600 grid place-items-center">
                <AlertTriangle size={16} />
              </span>
              <div>
                <h3 className="font-display font-bold text-lg text-sage-900 dark:text-cream-50">Low on stock</h3>
                <p className="text-xs text-sage-500 dark:text-ink-300">
                  {lowStockItems.length === 0
                    ? 'All items are well stocked'
                    : `${lowStockItems.length} item${lowStockItems.length === 1 ? '' : 's'} running low`}
                </p>
              </div>
            </div>
            <Link
              to="/alerts"
              className="text-sm font-semibold text-sage-700 hover:text-sage-900 dark:text-sage-300 dark:hover:text-cream-50 inline-flex items-center gap-1"
            >
              See all
              <ChevronRight size={16} />
            </Link>
          </div>

          {lowStockItems.length === 0 ? (
            <EmptyMini
              icon={stock.length === 0 ? ShoppingBasket : CircleCheck}
              title={stock.length === 0 ? 'Your kitchen is empty' : 'Nothing running low'}
              hint={
                stock.length === 0
                  ? 'Add what you have at home to track stock here.'
                  : 'All items are well stocked right now.'
              }
            />
          ) : (
            <ul className="divide-y divide-sage-100">
              {lowStockItems.map((it) => (
                <li key={it.id}>
                  <StockRow item={it} compact showActions={false} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Expiring soon */}
        <section className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-butter-100 text-butter-700 grid place-items-center">
                <CalendarClock size={16} />
              </span>
              <div>
                <h3 className="font-display font-bold text-lg text-sage-900 dark:text-cream-50">Expiring soon</h3>
                <p className="text-xs text-sage-500 dark:text-ink-300">
                  {expiringItems.length === 0
                    ? `No items expiring in the next ${settings.expiringSoonDays} days`
                    : `${expiringItems.length} item${expiringItems.length === 1 ? '' : 's'} need attention`}
                </p>
              </div>
            </div>
            <Link
              to="/alerts"
              className="text-sm font-semibold text-sage-700 hover:text-sage-900 dark:text-sage-300 dark:hover:text-cream-50 inline-flex items-center gap-1"
            >
              See all
              <ChevronRight size={16} />
            </Link>
          </div>

          {expiringItems.length === 0 ? (
            <EmptyMini
              icon={Snowflake}
              title={stock.length === 0 ? 'No expiry alerts yet' : 'Nothing expiring soon'}
              hint={
                stock.length === 0
                  ? 'Once you add items with expiry dates, alerts show up here.'
                  : 'Set expiry dates on stock items to get alerts.'
              }
            />
          ) : (
            <ul className="divide-y divide-sage-100">
              {expiringItems.map((it) => (
                <li key={it.id}>
                  <StockRow item={it} compact showActions={false} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Nearby stores (only shows if location consent granted) */}
        <NearbyStoresCard />

        <p className="text-center text-xs text-sage-400 pt-2">
          Built with care for everyday homes · v1.0
        </p>
      </div>

      <AddGroceryModal open={openGrocery} onClose={() => setOpenGrocery(false)} />
      <AddStockModal open={openStock} onClose={() => setOpenStock(false)} />
      <LogMealModal open={openMeal} onClose={() => setOpenMeal(false)} />
      <EndOfDayMeals open={openEndOfDay} onClose={() => setOpenEndOfDay(false)} />
    </>
  );
}

const MEAL_META: Record<MealType, { emoji: string; tint: string; label: string; Icon: typeof Coffee; ring: string }> = {
  breakfast: { emoji: '🌅', tint: 'bg-butter-100 text-butter-800', label: 'Breakfast', Icon: Coffee, ring: 'ring-butter-300' },
  lunch:     { emoji: '☀️', tint: 'bg-sage-100 text-sage-800',   label: 'Lunch',     Icon: Sun,   ring: 'ring-sage-300' },
  dinner:    { emoji: '🌙', tint: 'bg-tomato-100 text-tomato-800', label: 'Dinner',   Icon: Moon,  ring: 'ring-tomato-300' },
  snack:     { emoji: '🍿', tint: 'bg-butter-50 text-butter-700',  label: 'Snack',   Icon: ChefHat, ring: 'ring-butter-200' },
  sweet:     { emoji: '🍰', tint: 'bg-tomato-50 text-tomato-700', label: 'Sweet', Icon: Sparkles, ring: 'ring-tomato-200' },
};

/**
 * Friendly greeting based on the current hour.
 *
 * Single source of truth: the top bar and the hero card both call this. They
 * previously had their own copies with different cut-offs, so the same screen
 * could greet you as "Good morning" in the bar and "Good afternoon" in the
 * hero at the same time.
 */
function timeOfDayGreeting(name?: string): string {
  const h = new Date().getHours();
  const stem =
    h < 5  ? 'Burning the midnight oil' :
    h < 11 ? 'Good morning' :
    h < 16 ? 'Good afternoon' :
    h < 19 ? 'Good evening' :
             'Good night';
  return name && name.trim() ? `${stem}, ${name.trim().split(/\s+/)[0]}` : stem;
}

/** Today's meals progress card — shows 0/3, 1/3, 2/3, or 3/3 meals logged. */
function TodaysMealsCard({ todaysLogs, onOpen }: { todaysLogs: MealLog[]; onOpen: () => void }) {
  const counts = useMemo(() => {
    const c: Record<MealType, number> = { breakfast: 0, lunch: 0, dinner: 0, snack: 0, sweet: 0 };
    for (const m of todaysLogs) c[m.mealType]++;
    return c;
  }, [todaysLogs]);
  const total = counts.breakfast + counts.lunch + counts.dinner + counts.snack + counts.sweet;
  const allDone = total >= 3;
  return (
    <section
      className={clsx(
        'rounded-2xl border-2 p-4 transition-colors',
        allDone
          ? 'bg-gradient-to-br from-emerald-50 to-sage-50 dark:from-emerald-900/20 dark:to-ink-800 border-emerald-200 dark:border-emerald-700'
          : 'bg-white dark:bg-ink-800 border-sage-200 dark:border-ink-700',
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300">
            <CalendarClock size={12} />
            Today's meals
          </div>
          <div className="font-display text-lg font-extrabold text-sage-900 dark:text-cream-50 mt-0.5">
            {total} of 3 logged
            {allDone && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">· all done 🎉</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpen}
          disabled={allDone}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all active:scale-95',
            allDone
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 cursor-default'
              : 'bg-tomato-600 hover:bg-tomato-700 text-white',
          )}
        >
          {allDone ? <Check size={14} /> : <Plus size={14} />}
          {allDone ? 'Done' : total === 0 ? 'Start' : 'Log next'}
        </button>
      </div>
      {/* Three meal pills — visual progress */}
      <div className="grid grid-cols-3 gap-2">
        {(['breakfast', 'lunch', 'dinner'] as MealType[]).map((id) => {
          const meta = MEAL_META[id];
          const done = counts[id] > 0;
          return (
            <div
              key={id}
              className={clsx(
                'flex flex-col items-center gap-1 rounded-xl p-2.5 transition-all',
                done
                  ? `${meta.tint} ring-1 ${meta.ring}`
                  : 'bg-cream-50 dark:bg-ink-900/40 ring-1 ring-sage-100 dark:ring-ink-700',
              )}
            >
              <div className="flex items-center gap-1.5">
                <meta.Icon size={18} />
                {done && <Check size={12} className="text-sage-700 dark:text-sage-300" />}
              </div>
              <div className="text-[11px] font-bold text-sage-900 dark:text-cream-50">{meta.label}</div>
              <div className="text-[10px] text-sage-600 dark:text-ink-300 tabular-nums">
                {done ? `×${counts[id]}` : '—'}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function isSameDay(ts: number, ref: Date): boolean {
  const d = new Date(ts);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function MealsToday({
  mealLogs,
  onLogNew,
  onRemove,
}: {
  mealLogs: MealLog[];
  onLogNew: () => void;
  onRemove: (id: string) => void;
}) {
  const today = new Date();
  const todaysLogs = mealLogs.filter((m) => isSameDay(m.createdAt, today));
  const recent = mealLogs.slice(0, 5);

  // Subtitle summary
  const summary = (() => {
    if (todaysLogs.length === 0) return 'Nothing logged yet today';
    const byType: Record<string, number> = {};
    for (const m of todaysLogs) byType[m.mealType] = (byType[m.mealType] ?? 0) + 1;
    const parts = ['breakfast', 'lunch', 'dinner']
      .filter((k) => byType[k])
      .map((k) => `${byType[k]} ${k}`);
    return parts.join(' · ');
  })();

  // If there's nothing at all (today or recent), just show the action card.
  if (mealLogs.length === 0) {
    return (
      <section className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-8 h-8 rounded-xl bg-tomato-100 text-tomato-700 grid place-items-center">
            <ChefHat size={16} />
          </span>
          <div className="flex-1">
            <h3 className="font-display font-bold text-lg text-sage-900 dark:text-cream-50">Today's meals</h3>
            <p className="text-xs text-sage-500 dark:text-ink-300">Track what you cook — handy for history</p>
          </div>
        </div>
        <EmptyMini
          icon={ChefHat}
          title="No meals logged yet"
          hint="Tap Log a meal above to record what you cooked."
        />
      </section>
    );
  }

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-tomato-100 text-tomato-700 grid place-items-center">
            <ChefHat size={16} />
          </span>
          <div>
            <h3 className="font-display font-bold text-lg text-sage-900 dark:text-cream-50">Today's meals</h3>
            <p className="text-xs text-sage-500 dark:text-ink-300">{summary}</p>
          </div>
        </div>
        <button
          onClick={onLogNew}
          className="text-sm font-semibold text-sage-700 hover:text-sage-900 dark:text-sage-300 dark:hover:text-cream-50 inline-flex items-center gap-1"
        >
          + Log meal
          <ChevronRight size={16} />
        </button>
      </div>

      {todaysLogs.length > 0 && (
        <ul className="divide-y divide-sage-100">
          {todaysLogs.map((m) => {
            const meta = MEAL_META[m.mealType];
            return (
              <li key={m.id} className="py-2.5 flex items-start gap-3">
                <span
                  className={clsx(
                    'inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm shrink-0',
                    meta.tint,
                  )}
                >
                  <meta.Icon size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sage-900 dark:text-cream-50 truncate">{m.description}</span>
                    <span className="text-[10px] uppercase tracking-wider text-sage-500 dark:text-ink-300 font-semibold">
                      {meta.label}
                    </span>
                  </div>
                  {m.notes && (
                    <div className="text-xs text-sage-500 dark:text-ink-300 mt-0.5 line-clamp-2">{m.notes}</div>
                  )}
                  <div className="text-[11px] text-sage-400 dark:text-ink-500 mt-0.5">
                    {format(new Date(m.createdAt), 'h:mm a')}
                  </div>
                </div>
                <button
                  onClick={() => onRemove(m.id)}
                  aria-label={`Remove meal ${m.description}`}
                  className="btn-icon text-sage-300 hover:text-tomato-600 hover:bg-tomato-50 shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {todaysLogs.length === 0 && recent.length > 0 && (
        <div className="text-xs text-sage-500 mb-2">
          Nothing logged today. Recent meals:
        </div>
      )}
      {todaysLogs.length === 0 && recent.length > 0 && (
        <ul className="divide-y divide-sage-100">
          {recent.slice(0, 3).map((m) => {
            const meta = MEAL_META[m.mealType];
            return (
              <li key={m.id} className="py-2 flex items-start gap-3">
                <span
                  className={clsx(
                    'inline-flex items-center justify-center w-7 h-7 rounded-md text-xs shrink-0',
                    meta.tint,
                  )}
                >
                  <meta.Icon size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sage-800 dark:text-cream-100 truncate text-sm">
                    {m.description}
                  </div>
                  <div className="text-[11px] text-sage-500 dark:text-ink-300">
                    {meta.label} · {format(new Date(m.createdAt), 'MMM d, h:mm a')}
                  </div>
                </div>
                <button
                  onClick={() => onRemove(m.id)}
                  aria-label={`Remove meal ${m.description}`}
                  className="btn-icon text-sage-300 hover:text-tomato-600 hover:bg-tomato-50 shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StatTile({
  to,
  label,
  value,
  accent,
  icon,
}: {
  to: string;
  label: string;
  value: number;
  accent: string;
  icon: React.ReactNode;
}) {
  const animated = useAnimatedNumber(value);
  return (
    <Link
      to={to}
      className="lift block rounded-2xl px-3 py-3.5 border border-sage-100 dark:border-ink-700 bg-white dark:bg-ink-800 hover:shadow-card transition-all duration-200 active:scale-[.98]"
    >
      <div className={`w-8 h-8 rounded-lg grid place-items-center mb-2 ${accent}`}>{icon}</div>
      <div className="font-display text-2xl font-extrabold text-sage-900 dark:text-cream-50 leading-none tabular-nums">
        {animated}
      </div>
      <div className="text-[11px] text-sage-500 dark:text-ink-400 mt-1 font-semibold uppercase tracking-wide">
        {label}
      </div>
    </Link>
  );
}

function EmptyMini({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  hint: string;
}) {
  return (
    <div className="text-center py-6 px-2">
      <Icon size={34} className="mx-auto mb-2 text-sage-400 dark:text-ink-500" />
      <p className="font-semibold text-sage-800 dark:text-cream-100">{title}</p>
      <p className="text-sm text-sage-500 dark:text-ink-300 mt-0.5">{hint}</p>
    </div>
  );
}
