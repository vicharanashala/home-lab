/**
 * EndOfDayMeals — quick flow for logging all three daily meals.
 *
 * UX:
 *   1. Three big buttons (Breakfast / Lunch / Dinner) showing today's status
 *   2. Tap one → "How much did the kids eat?" (A lot / Medium / Less) buttons
 *   3. Then a recipe picker (filtered by meal type)
 *   4. Confirm → auto-deducts ingredients from fridge/pantry
 *
 * Designed for end-of-day catch-up. The full LogMealModal still exists
 * for in-the-moment logging with custom notes.
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import {
  Coffee,
  Sun,
  Moon,
  X,
  Check,
  Sparkles,
  AlertCircle,
  ChefHat,
  Plus,
  Search,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { DishIcon } from './icons/DishIcons';
import clsx from 'clsx';
import type { MealType, Recipe } from '../types';
import { planRecipeDeduction } from '../utils/recipeMatch';

type EatenAmount = 'a-lot' | 'medium' | 'less';

/** Multiplier for how much of the recipe was consumed. */
const EATEN_MULTIPLIER: Record<EatenAmount, number> = {
  'a-lot': 1.0,   // Full recipe consumed
  'medium': 0.6,  // ~60% consumed
  'less': 0.3,    // ~30% consumed (a few bites each)
};

const EATEN_LABEL: Record<EatenAmount, string> = {
  'a-lot': 'A lot',
  'medium': 'Medium',
  'less': 'Less',
};

const EATEN_EMOJI: Record<EatenAmount, string> = {
  'a-lot': '😋',
  'medium': '🙂',
  'less': '🙁',
};

const MEAL_META: {
  id: MealType;
  label: string;
  emoji: string;
  Icon: typeof Coffee;
  tint: string;
  ring: string;
  range: string;
}[] = [
  { id: 'breakfast', label: 'Breakfast', emoji: '🌅', Icon: Coffee, tint: 'bg-butter-100 text-butter-800', ring: 'ring-butter-300', range: '5–11 am' },
  { id: 'lunch',     label: 'Lunch',     emoji: '☀️',  Icon: Sun,   tint: 'bg-sage-100 text-sage-800',   ring: 'ring-sage-300',   range: '11 am–4 pm' },
  { id: 'dinner',    label: 'Dinner',    emoji: '🌙', Icon: Moon,  tint: 'bg-tomato-100 text-tomato-800', ring: 'ring-tomato-300', range: '4–10 pm' },
];

type Step = 'pick-meal' | 'pick-amount' | 'review';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function EndOfDayMeals({ open, onClose }: Props) {
  const { mealLogs, recipes, stock, logMealFromRecipes, toast } = useStore();

  const [step, setStep] = useState<Step>('pick-meal');
  const [mealType, setMealType] = useState<MealType>('breakfast');
  const [amount, setAmount] = useState<EatenAmount | null>(null);
  const [recipeIds, setRecipeIds] = useState<string[]>([]);
  const [recipeSearch, setRecipeSearch] = useState('');

  // Combined consumption: kids + adults, capped at 1.0 (can't eat more than the recipe made).
  const combinedMultiplier = useMemo(() => {
    if (!amount) return null;
  return EATEN_MULTIPLIER[amount];
}, [amount]);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setStep('pick-meal');
      setAmount(null);
      setRecipeIds([]);
      setRecipeSearch('');
    }
  }, [open]);

  // Today's logs for each meal type
  const todaysLogs = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const grouped: Record<MealType, number> = { breakfast: 0, lunch: 0, dinner: 0, snack: 0, sweet: 0 };
    for (const log of mealLogs) {
      if (log.createdAt >= todayMs) grouped[log.mealType]++;
    }
    return grouped;
  }, [mealLogs]);

  // Lazy-load the big CSV recipe catalog (~5,900 Indian recipes) only when
  // the modal is opened — keeps main bundle light.
  const [csvRecipes, setCsvRecipes] = useState<Recipe[] | null>(null);
  useEffect(() => {
    if (!open || csvRecipes !== null) return;
    let cancelled = false;
    void import('../data/csvRecipes.json').then((mod) => {
      if (!cancelled) setCsvRecipes((mod.default || (mod as any)) as unknown as Recipe[]);
    }).catch((err) => {
      console.warn('[EndOfDayMeals] failed to load csv catalog:', err);
    });
    return () => { cancelled = true; };
  }, [open, csvRecipes]);

  // All recipes merged: localStorage + starter + Indian curated + CSV catalog.
  const allRecipes = useMemo(() => {
    return csvRecipes ? [...recipes, ...csvRecipes] : recipes;
  }, [recipes, csvRecipes]);

  const selectedRecipes = useMemo(
    () => allRecipes.filter((r) => recipeIds.includes(r.id)),
    [allRecipes, recipeIds],
  );

  // All recipes (including CSV catalog once loaded), with search filter applied.
const recipesForMeal = useMemo(() => {
    if (!recipeSearch.trim()) return allRecipes;
    const q = recipeSearch.toLowerCase().trim();
    return allRecipes.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      (r as any).cuisine?.toLowerCase().includes(q)
    );
}, [allRecipes, recipeSearch]);

  // Live preview: combine all selected recipes' ingredients at the chosen amount.
  const combinedPlan = useMemo(() => {
    if (selectedRecipes.length === 0 || combinedMultiplier === null) return null;
    // Sum ingredient (name+unit) across all selected recipes.
    const map = new Map<string, { name: string; quantity: number; unit: string }>();
    for (const recipe of selectedRecipes) {
      const scale = recipe.baseServings > 0 ? combinedMultiplier : 0;
      for (const ing of recipe.ingredients) {
        const key = `${ing.name.toLowerCase().trim()}|${(ing.unit ?? '').toLowerCase().trim()}`;
        const existing = map.get(key);
        const q = (ing.quantity ?? 0) * scale * (recipe.baseServings > 0 ? 1 / recipe.baseServings * Math.max(1, Math.round(recipe.baseServings)) : 1);
        // Simpler: scale ingredient by combinedMultiplier × (peopleCooked / baseServings).
        const scaledQty = (ing.quantity ?? 0) * (combinedMultiplier * Math.max(1, Math.round(recipe.baseServings)) / recipe.baseServings);
        if (existing) existing.quantity += scaledQty;
        else map.set(key, { name: ing.name, quantity: scaledQty, unit: ing.unit });
      }
    }
    // Run the deduper against stock.
    const deductions: Array<{ name: string; deductedLabel: string; skipped?: boolean; reason?: string }> = [];
    for (const ing of map.values()) {
      // We can't import findCandidatesForIngredient here without changing utils — use planRecipeDeduction
      // by composing a virtual recipe. Simpler: just check if any stock item matches by name prefix.
      const match = stock.find((s) => s.name.toLowerCase().trim() === ing.name.toLowerCase().trim());
      if (match) {
        deductions.push({ name: ing.name, deductedLabel: `${ing.quantity.toFixed(2)} ${ing.unit}`.trim() });
      } else {
        deductions.push({ name: ing.name, deductedLabel: '—', skipped: true, reason: 'not in fridge' });
      }
    }
    return deductions;
  }, [selectedRecipes, combinedMultiplier, stock]);

  const pickMeal = (id: MealType) => {
    setMealType(id);
    setStep('pick-amount');
  };

  const pickAmount = (a: EatenAmount) => {
    setAmount(a);
    setStep('review');
  };

  const confirm = () => {
    if (selectedRecipes.length === 0 || !amount || combinedMultiplier === null) return;
    const peopleCooked = Math.max(
      1,
      Math.round(selectedRecipes.reduce((m, r) => Math.max(m, r.baseServings), 1) * combinedMultiplier),
    );
    logMealFromRecipes({
      recipeIds: selectedRecipes.map((r) => r.id),
      peopleCooked,
      notes: `${selectedRecipes.length} recipe${selectedRecipes.length === 1 ? '' : 's'} · Ate ${EATEN_LABEL[amount]} (${Math.round(combinedMultiplier * 100)}% combined)`,
    });
    toast(`${MEAL_META.find((m) => m.id === mealType)?.label} logged ✓`, 'success');
    setAmount(null);
    setRecipeIds([]);
    setRecipeSearch('');
    setStep('pick-meal');
  };

  const skipMeal = () => {
    setAmount(null);
    setRecipeIds([]);
    setRecipeSearch('');
    setStep('pick-meal');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log today's meals"
      fullBleed
      footer={
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            <X size={16} />
            Close
          </button>
          {step === 'review' ? (
            <button
              type="button"
              onClick={confirm}
              className="btn-primary flex-1"
            >
              <Check size={18} />
              Confirm &amp; deduct
            </button>
          ) : step !== 'pick-meal' ? (
            <button
              type="button"
              onClick={() => {
                if (step === 'pick-amount') {
                  setStep('pick-meal');
                  setRecipeIds([]);
                  setAmount(null);
                } else if (step === 'review') {
                  setStep('pick-amount');
                  setAmount(null);
                }
              }}
              className="btn-secondary flex-1"
            >
              ← Back
            </button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4 pt-2">
        {/* Step 1: pick meal type */}
        {step === 'pick-meal' && (
          <>
            <p className="text-sm text-sage-600 dark:text-ink-300">
              Tap the meal you want to log. We'll ask how much the kids ate, then auto-deduct from your fridge.
            </p>
            <div className="grid grid-cols-1 gap-3">
              {MEAL_META.map((m) => {
                const count = todaysLogs[m.id];
                const isLogged = count > 0;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => pickMeal(m.id)}
                    className={clsx(
                      'flex items-center gap-3 rounded-2xl p-4 border-2 text-left transition-all active:scale-[.98]',
                      isLogged
                        ? 'bg-sage-50 dark:bg-sage-900/30 border-sage-300 dark:border-sage-700'
                        : `${m.tint} border-transparent hover:ring-2 hover:ring-offset-1 ${m.ring}`,
                    )}
                  >
                    <m.Icon size={24} />
                    <div className="flex-1">
                      <div className="font-display font-extrabold text-lg text-sage-900 dark:text-cream-50">
                        {m.label}
                      </div>
                      <div className="text-xs text-sage-500 dark:text-ink-400">{m.range}</div>
                    </div>
                    {isLogged ? (
                      <div className="flex items-center gap-1.5 text-sage-700 dark:text-sage-300 font-semibold text-sm">
                        <Check size={18} />
                        Logged{count > 1 ? ` ×${count}` : ''}
                      </div>
                    ) : (
                      <div className="text-sage-400 dark:text-ink-500 text-xs font-semibold uppercase tracking-wide">
                        Tap to log
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-sage-400 dark:text-ink-500 text-center pt-2">
              Today's progress: {todaysLogs.breakfast + todaysLogs.lunch + todaysLogs.dinner} of 3 meals logged
            </p>
          </>
        )}

        {/* Step 2: pick recipe(s) — big search-first catalog */}
        {step === 'pick-amount' && (
          <>
            <div className="flex items-center gap-2 text-sage-700 dark:text-ink-200 text-sm">
              {(() => { const M = MEAL_META.find((x) => x.id === mealType)?.Icon; return M ? <M size={20} /> : null; })()}
              <span className="font-display font-extrabold text-xl">
                {MEAL_META.find((m) => m.id === mealType)?.label}
              </span>
              <span className="text-sage-400 dark:text-ink-500 text-xs">— what did you make?</span>
            </div>

            {/* BIG search box at top */}
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-sage-400 dark:text-ink-400 pointer-events-none" />
              <input
                type="search"
                autoFocus
                placeholder="Search 130+ Indian recipes — try 'palak', 'biryani', 'paratha'…"
                value={recipeSearch}
                onChange={(e) => setRecipeSearch(e.target.value)}
                className="w-full rounded-xl bg-cream-50 dark:bg-ink-900 border-2 border-sage-200 dark:border-ink-700 pl-10 pr-3 py-3 text-base outline-none focus:border-sage-400 placeholder:text-sage-400 dark:placeholder:text-ink-500"
              />
            </div>

            {/* Selected chips — what's already picked */}
            {selectedRecipes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300">
                  Selected ({selectedRecipes.length}):
                </span>
                {selectedRecipes.map((r) => (
                  <button
                    key={`sel-${r.id}`}
                    type="button"
                    onClick={() => setRecipeIds((prev) => prev.filter((x) => x !== r.id))}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-sage-600 text-white"
                  >
                    <DishIcon recipe={r} size={14} />
                    {r.name}
                    <X size={12} />
                  </button>
                ))}
              </div>
            )}

            {/* Show all recipes (no meal-type filter — search through everything) */}
            <div className="text-[11px] text-sage-500 dark:text-ink-400 flex items-center justify-between">
              <span>
                {recipesForMeal.length} {recipeSearch ? 'matches' : 'recipes'}
                {!csvRecipes && (
                  <span className="ml-1.5 italic text-sage-400 dark:text-ink-500">
                    · loading big catalog…
                  </span>
                )}
              </span>
              {recipeSearch && (
                <button
                  type="button"
                  onClick={() => setRecipeSearch('')}
                  className="text-sage-600 dark:text-sage-300 hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 max-h-72 overflow-y-auto">
              {recipesForMeal.length === 0 ? (
                <div className="w-full text-center py-6 text-xs text-sage-500 dark:text-ink-300">
                  No recipes match "{recipeSearch}". Try a different word.
                </div>
              ) : (
                recipesForMeal.map((r) => {
                  const selected = recipeIds.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRecipeIds((prev) => prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id])}
                      className={clsx(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold border transition-all active:scale-95',
                        selected
                          ? 'bg-sage-600 text-white border-sage-600 shadow-soft'
                          : 'bg-white dark:bg-ink-800 text-sage-700 dark:text-cream-100 border-sage-200 dark:border-ink-700 hover:bg-sage-50 dark:hover:bg-ink-700',
                      )}
                    >
                      <DishIcon recipe={r} size={15} />
                      {r.name}
                      {selected && <Check size={12} />}
                    </button>
                  );
                })
              )}
            </div>

            {/* Bottom: skip + continue */}
            <div className="flex items-center gap-2 pt-2 border-t border-sage-100 dark:border-ink-700">
              <button
                type="button"
                onClick={skipMeal}
                className="text-xs text-sage-500 dark:text-ink-400 hover:underline"
              >
                Skip this meal
              </button>
              <button
                type="button"
                onClick={() => setStep('review')}
                disabled={recipeIds.length === 0}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-sage-600 hover:bg-sage-700 disabled:opacity-40 disabled:hover:bg-sage-600 text-white font-semibold text-sm px-5 py-2 transition-all active:scale-95"
              >
                Next →
                {recipeIds.length > 1 ? ` (${recipeIds.length} combined)` : ''}
              </button>
            </div>
          </>
        )}

        {/* Step 3: review + log button (skip the amount question — user just wants to record the meal) */}
        {step === 'review' && selectedRecipes.length > 0 && (
          <>
            <div className="flex items-center gap-2 text-sage-700 dark:text-ink-200 text-sm flex-wrap">
              {(() => { const M = MEAL_META.find((x) => x.id === mealType)?.Icon; return M ? <M size={20} /> : null; })()}
              <span className="font-display font-extrabold text-lg">
                {MEAL_META.find((m) => m.id === mealType)?.label}
              </span>
              <span className="text-sage-400 dark:text-ink-500">·</span>
              <span className="text-sm font-semibold">
                {selectedRecipes.map((r) => r.name).join(' + ')}
              </span>
            </div>

            {/* Quick amount buttons — a lot / medium / less, applied as deduction multiplier */}
            <p className="text-sm text-sage-600 dark:text-ink-300">How much did everyone eat in total?</p>
            <div className="grid grid-cols-3 gap-2">
              {(['a-lot', 'medium', 'less'] as EatenAmount[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => { setAmount(a); }}
                  className={clsx(
                    'flex flex-col items-center gap-1.5 rounded-2xl border-2 p-4 active:scale-95 transition-all',
                    amount === a
                      ? 'bg-sage-600 text-white border-sage-600 shadow-soft'
                      : 'bg-white dark:bg-ink-800 border-sage-200 dark:border-ink-700 hover:border-sage-400',
                  )}
                >
                  <span className="text-3xl leading-none">{EATEN_EMOJI[a]}</span>
                  <span className={clsx(
                    'font-display font-bold text-sm',
                    amount === a ? 'text-white' : 'text-sage-900 dark:text-cream-50',
                  )}>
                    {EATEN_LABEL[a]}
                  </span>
                  <span className={clsx(
                    'text-[10px] tabular-nums',
                    amount === a ? 'text-white/80' : 'text-sage-500 dark:text-ink-400',
                  )}>
                    {Math.round(EATEN_MULTIPLIER[a] * 100)}% deducted
                  </span>
                </button>
              ))}
            </div>

            {/* Deduction preview once amount chosen */}
            {amount && combinedPlan && combinedPlan.length > 0 && (
              <div className="rounded-xl border border-sage-200 dark:border-ink-700 divide-y divide-sage-100 dark:divide-ink-700 overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sage-500 dark:text-ink-400 bg-cream-50 dark:bg-ink-900">
                  We'll deduct:
                </div>
                {combinedPlan.slice(0, 6).map((it, i) => (
                  <div key={i} className="px-3 py-1.5 text-xs flex items-center gap-2">
                    {it.skipped ? (
                      <>
                        <AlertCircle size={11} className="text-butter-700 dark:text-butter-400 shrink-0" />
                        <span className="text-sage-700 dark:text-ink-200 flex-1 truncate">{it.name}</span>
                        <span className="text-butter-700 dark:text-butter-400 italic text-[10px]">no match</span>
                      </>
                    ) : (
                      <>
                        <Check size={11} className="text-sage-600 dark:text-sage-400 shrink-0" />
                        <span className="font-semibold text-sage-900 dark:text-cream-50 flex-1 truncate">{it.name}</span>
                        <span className="text-sage-600 dark:text-ink-200 tabular-nums">−{it.deductedLabel}</span>
                      </>
                    )}
                  </div>
                ))}
                {combinedPlan.length > 6 && (
                  <div className="px-3 py-1.5 text-[10px] text-sage-500 dark:text-ink-400 text-center">
                    +{combinedPlan.length - 6} more
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
