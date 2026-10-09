import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import {
  Coffee,
  Sun,
  Moon,
  Sparkles,
  ChefHat,
  X,
  Minus,
  Plus,
  BookOpen,
  AlertCircle,
  Check,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import clsx from 'clsx';
import type { MealType } from '../types';
import { planRecipeDeduction } from '../utils/recipeMatch';
import { formatBaseValue, unitDimension } from '../utils/units';
import { AutocompleteInput, type Suggestion } from './AutocompleteInput';
import { DishIcon } from './icons/DishIcons';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional: lock the modal to a specific meal type. Otherwise auto-picks from current time. */
  initialMealType?: MealType;
}

type Mode = 'recipe' | 'quick';

const MEAL_TABS: {
  id: MealType;
  label: string;
  emoji: string;
  Icon: typeof Coffee;
  tint: string;
  ring: string;
  range: string;
}[] = [
  {
    id: 'breakfast',
    label: 'Breakfast',
    emoji: '🌅',
    Icon: Coffee,
    tint: 'bg-butter-100 text-butter-800',
    ring: 'ring-butter-300',
    range: '5–11 am',
  },
  {
    id: 'lunch',
    label: 'Lunch',
    emoji: '☀️',
    Icon: Sun,
    tint: 'bg-sage-100 text-sage-800',
    ring: 'ring-sage-300',
    range: '11 am–4 pm',
  },
  {
    id: 'dinner',
    label: 'Dinner',
    emoji: '🌙',
    Icon: Moon,
    tint: 'bg-tomato-100 text-tomato-800',
    ring: 'ring-tomato-300',
    range: '4–10 pm',
  },
];

/** Pick a default meal type from the current hour. Falls back to dinner outside typical ranges. */
const guessMealType = (): MealType => {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  return 'dinner';
};

const QUICK_PICKS: Record<MealType, string[]> = {
  breakfast: ['Maggi', 'Poha', 'Upma', 'Paratha', 'Idli', 'Toast & eggs', 'Oats'],
  lunch: ['Rice + dal', 'Roti sabzi', 'Biryani', 'Pulao', 'Khichdi', 'Curd rice', 'Lemon rice'],
  dinner: ['Palak paneer + roti', 'Paneer tikka', 'Dal makhani', 'Pasta', 'Soup & bread', 'Dosa', 'Khichdi'],
  snack: ['Samosa', 'Pakora', 'Vada pav', 'Sandwich', 'Maggi', 'Pav bhaji', 'Bhel puri'],
  sweet: ['Gulab jamun', 'Ladoo', 'Halwa', 'Kheer', 'Jalebi', 'Rasgulla', 'Barfi'],
};

export function LogMealModal({ open, onClose, initialMealType }: Props) {
  const { addMealLog, logMealFromRecipe, toast, mealLogs, recipes, stock } = useStore();

  const [mode, setMode] = useState<Mode>('recipe');
  const [mealType, setMealType] = useState<MealType>(initialMealType ?? guessMealType());
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);

  // Recipe-mode state
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [peopleCooked, setPeopleCooked] = useState<number>(2);
  /** User-picked stock item per ingredient (when matching is ambiguous). */
  const [pickedStock, setPickedStock] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setMealType(initialMealType ?? guessMealType());
      setDescription('');
      setNotes('');
      setTouched(false);
      setMode('recipe');
      setRecipeId(null);
      setPeopleCooked(2);
      setPickedStock({});
    }
  }, [open, initialMealType]);

  // Autofocus the description input when modal opens (quick mode only)
  useEffect(() => {
    if (!open || mode !== 'quick') return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 200);
    return () => window.clearTimeout(t);
  }, [open, mode, mealType]);

  const trimmed = description.trim();
  const canSubmitQuick = trimmed.length > 0;
  const recipe = recipeId ? recipes.find((r) => r.id === recipeId) : null;
  const canSubmitRecipe = !!recipe;

  // Live deduction preview for the selected recipe
  const plan = useMemo(() => {
    if (!recipe) return null;
    return planRecipeDeduction(recipe, peopleCooked, stock);
  }, [recipe, peopleCooked, stock]);

  // Quick-pick suggestions already used (so they don't repeat)
  const recentDescriptions = useMemo(
    () => new Set(mealLogs.slice(0, 10).map((m) => m.description.toLowerCase())),
    [mealLogs],
  );

  // Recipes filtered to the currently-selected meal type, with all-types fallback.
  const recipesForMealType = useMemo(() => {
    const list = recipes.filter((r) => r.mealType === mealType);
    return list.length > 0 ? list : recipes;
  }, [recipes, mealType]);

  const handleQuickSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmitQuick) {
      setTouched(true);
      return;
    }
    addMealLog({
      mealType,
      description: trimmed,
      notes: notes.trim() || undefined,
    });
    toast(`Logged ${MEAL_TABS.find((t) => t.id === mealType)?.label}`, 'success');
    onClose();
  };

  const handleRecipeSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!recipe) {
      setTouched(true);
      return;
    }
    logMealFromRecipe({
      recipeId: recipe.id,
      peopleCooked,
      notes: notes.trim() || undefined,
      pickedStockByIngredient: pickedStock,
    });
    onClose();
  };

  const handleSubmit = mode === 'recipe' ? handleRecipeSubmit : handleQuickSubmit;

  const quickPicks = QUICK_PICKS[mealType];

  // Autocomplete suggestion pool (recipe + recent + quick-pick + stock).
  // Deduped by label (case-insensitive).
  const suggestions: Suggestion[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    const push = (s: Suggestion) => {
      const key = `${s.kind}:${s.label.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(s);
      }
    };
    for (const r of recipes) push({ kind: 'recipe', id: r.id, label: r.name, emoji: r.emoji });
    for (const m of mealLogs.slice(0, 20)) {
      if (m.description) push({ kind: 'recent', label: m.description });
    }
    for (const q of QUICK_PICKS[mealType]) push({ kind: 'quick', label: q });
    for (const s of stock) push({ kind: 'stock', label: s.name });
    return out;
  }, [recipes, mealLogs, mealType, stock]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a meal"
      fullBleed
      footer={
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            <X size={16} />
            Cancel
          </button>
          <button
            type="submit"
            form="log-meal-form"
            disabled={mode === 'recipe' ? !canSubmitRecipe : !canSubmitQuick}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            <ChefHat size={18} />
            Log meal
          </button>
        </div>
      }
    >
      <form id="log-meal-form" onSubmit={handleSubmit} className="space-y-4 pt-2">
        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-cream-100 dark:bg-ink-800 p-1">
          <button
            type="button"
            onClick={() => setMode('recipe')}
            className={clsx(
              'rounded-xl px-3 py-2 text-xs font-semibold transition-all inline-flex items-center justify-center gap-1.5',
              mode === 'recipe'
                ? 'bg-white dark:bg-ink-700 shadow-soft text-sage-800 dark:text-cream-50'
                : 'text-sage-600 dark:text-ink-300',
            )}
          >
            <BookOpen size={14} />
            From recipe
          </button>
          <button
            type="button"
            onClick={() => setMode('quick')}
            className={clsx(
              'rounded-xl px-3 py-2 text-xs font-semibold transition-all inline-flex items-center justify-center gap-1.5',
              mode === 'quick'
                ? 'bg-white dark:bg-ink-700 shadow-soft text-sage-800 dark:text-cream-50'
                : 'text-sage-600 dark:text-ink-300',
            )}
          >
            <Sparkles size={14} />
            One-liner
          </button>
        </div>

        {/* Meal-type tabs (only relevant in quick mode, but useful as a hint in recipe mode too) */}
        <div>
          <label className="label">Which meal?</label>
          <div className="grid grid-cols-3 gap-2">
            {MEAL_TABS.map((t) => {
              const active = t.id === mealType;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMealType(t.id)}
                  className={clsx(
                    'flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-xs font-semibold border-2 transition-all active:scale-[.98]',
                    active
                      ? `${t.tint} border-transparent ring-2 ring-offset-1 ${t.ring}`
                      : 'bg-white dark:bg-ink-800 border-sage-100 dark:border-ink-700 hover:border-sage-300 text-sage-700 dark:text-ink-200',
                  )}
                >
                  <span className="text-2xl leading-none">{t.emoji}</span>
                  <span className="font-display font-bold text-sm">{t.label}</span>
                  <span
                    className={clsx(
                      'text-[10px]',
                      active ? 'opacity-80' : 'text-sage-400 dark:text-ink-400',
                    )}
                  >
                    {t.range}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Recipe mode */}
        {mode === 'recipe' && (
          <>
            <div>
              <label className="label">Pick a recipe</label>
              <div className="flex flex-wrap gap-2">
                {recipesForMealType.map((r) => {
                  const active = recipeId === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRecipeId(r.id)}
                      className={clsx(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-all active:scale-95 border',
                        active
                          ? 'bg-sage-600 text-white border-sage-600 shadow-soft'
                          : 'bg-white dark:bg-ink-800 text-sage-700 dark:text-cream-100 border-sage-200 dark:border-ink-700 hover:bg-sage-50 dark:hover:bg-ink-700',
                      )}
                    >
                      <DishIcon recipe={r} size={15} className="text-sage-700 dark:text-sage-300" />
                      {r.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {recipe && (
              <>
                {/* People served */}
                <div>
                  <label className="label">How many people?</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPeopleCooked((n) => Math.max(1, n - 1))}
                      className="w-10 h-10 rounded-xl bg-cream-100 dark:bg-ink-800 text-sage-700 dark:text-cream-100 grid place-items-center active:scale-95 transition-transform"
                      aria-label="One fewer person"
                    >
                      <Minus size={16} />
                    </button>
                    <div className="flex-1 h-10 rounded-xl bg-cream-100 dark:bg-ink-800 grid place-items-center text-lg font-display font-extrabold text-sage-900 dark:text-cream-50 tabular-nums">
                      {peopleCooked}
                      <span className="text-xs font-medium text-sage-500 dark:text-ink-300 ml-1.5">
                        {peopleCooked === 1 ? 'person' : 'people'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPeopleCooked((n) => Math.min(20, n + 1))}
                      className="w-10 h-10 rounded-xl bg-cream-100 dark:bg-ink-800 text-sage-700 dark:text-cream-100 grid place-items-center active:scale-95 transition-transform"
                      aria-label="One more person"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-sage-500 dark:text-ink-300">
                    Recipe is sized for {recipe.baseServings}. We'll scale ingredients{' '}
                    {(peopleCooked / Math.max(1, recipe.baseServings)).toFixed(2)}×.
                  </p>
                </div>

                {/* Deduction preview */}
                {plan && (
                  <div>
                    <label className="label">What we'll use from your fridge</label>
                    <ul className="rounded-xl border border-sage-100 dark:border-ink-700 divide-y divide-sage-100 dark:divide-ink-700 overflow-hidden">
                      {plan.deductions.map((d) => {
                        const dim = unitDimension(d.ingredient.unit);
                        const remainingLabel =
                          dim === 'unknown' ? '—' : formatBaseValue(d.remainingBase, dim);
                        const pickedId = pickedStock[d.ingredient.name] ?? d.stockItem.id;
                        const isPickedDifferent = pickedId !== d.stockItem.id;
                        const isAmbiguous = d.candidates.length > 1;
                        return (
                          <li
                            key={`${d.ingredient.name}-${d.ingredient.unit}`}
                            className="px-3 py-2 text-xs"
                          >
                            <div className="flex items-center gap-3">
                              <Check size={14} className="text-sage-600 dark:text-sage-400 shrink-0" />
                              <span className="font-semibold text-sage-900 dark:text-cream-50 truncate">
                                {d.ingredient.name}
                              </span>
                              <span className="ml-auto text-sage-600 dark:text-ink-200 tabular-nums shrink-0">
                                −{d.deductedLabel}
                              </span>
                              <span className="hidden sm:inline text-sage-400 dark:text-ink-400 tabular-nums shrink-0">
                                → {remainingLabel} left
                              </span>
                            </div>
                            {isAmbiguous && (
                              <div className="mt-1.5 ml-5 flex flex-wrap items-center gap-1.5">
                                <span className="text-[10px] uppercase tracking-wider font-semibold text-sage-500 dark:text-ink-300">
                                  Which?
                                </span>
                                {d.candidates.map((c) => {
                                  const active = c.id === pickedId;
                                  return (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() =>
                                        setPickedStock((cur) => ({
                                          ...cur,
                                          [d.ingredient.name]: c.id,
                                        }))
                                      }
                                      className={clsx(
                                        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-all active:scale-95',
                                        active
                                          ? 'bg-sage-600 text-white border-sage-600'
                                          : 'bg-white dark:bg-ink-800 text-sage-700 dark:text-cream-50 border-sage-200 dark:border-ink-700 hover:bg-sage-50 dark:hover:bg-ink-700',
                                      )}
                                      title={`${c.quantity} ${c.unit} on hand`}
                                    >
                                      {isPickedDifferent && !active ? null : null}
                                      <span>{c.name}</span>
                                      <span className="opacity-70 text-[10px] tabular-nums">
                                        ({c.quantity} {c.unit})
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </li>
                        );
                      })}
                      {plan.skipped.map((s) => (
                        <li
                          key={`s-${s.ingredient.name}`}
                          className="px-3 py-2 text-xs bg-butter-50/50 dark:bg-ink-800"
                        >
                          <div className="flex items-center gap-3">
                            <AlertCircle
                              size={14}
                              className="text-butter-700 dark:text-butter-400 shrink-0"
                            />
                            <span className="font-medium text-sage-700 dark:text-ink-200 truncate">
                              {s.ingredient.name}
                            </span>
                            <span className="ml-auto text-butter-700 dark:text-butter-400 italic shrink-0">
                                {s.reason === 'not-in-stock'
                                  ? 'not in fridge'
                                  : 'unit mismatch'}
                              </span>
                          </div>
                          {s.candidates.length > 0 && (
                            <div className="mt-1.5 ml-5 flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] uppercase tracking-wider font-semibold text-sage-500 dark:text-ink-300">
                                Found:
                              </span>
                              {s.candidates.slice(0, 4).map((c) => (
                                <span
                                  key={c.id}
                                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-butter-100 dark:bg-butter-900/30 text-butter-800 dark:text-butter-200"
                                >
                                  {c.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                      {plan.deductions.length === 0 && plan.skipped.length === 0 && (
                        <li className="px-3 py-3 text-xs text-sage-500 dark:text-ink-300">
                          This recipe has no ingredients listed.
                        </li>
                      )}
                    </ul>
                    {plan.skipped.length > 0 && (
                      <p className="mt-1.5 text-xs text-sage-500 dark:text-ink-300">
                        Skipped items won't be deducted. Add them to your fridge later and re-log.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {touched && !recipe && (
              <p className="text-xs text-tomato-600 dark:text-tomato-300">Pick a recipe to continue.</p>
            )}
          </>
        )}

        {/* Quick (one-liner) mode */}
        {mode === 'quick' && (
          <>
            {/* Description */}
            <div>
              <label htmlFor="meal-description" className="label">
                What did you cook?
              </label>
              <AutocompleteInput
                id="meal-description"
                inputRef={inputRef}
                value={description}
                onChange={setDescription}
                suggestions={suggestions}
                placeholder={
                  mealType === 'breakfast'
                    ? 'e.g. Poha with peanuts'
                    : mealType === 'lunch'
                    ? 'e.g. Dal-rice with papad'
                    : 'e.g. Palak paneer + 2 rotis'
                }
                className="input"
              />
              {touched && !canSubmitQuick && (
                <p className="mt-1 text-xs text-tomato-600 dark:text-tomato-300">Tell us what you cooked.</p>
              )}
            </div>

            {/* Quick picks */}
            {quickPicks.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300 mb-2">
                  Quick picks
                </div>
                <div className="flex flex-wrap gap-2">
                  {quickPicks.map((q) => {
                    const used = recentDescriptions.has(q.toLowerCase());
                    return (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setDescription(q)}
                        className={clsx(
                          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 border',
                          'bg-white dark:bg-ink-800 text-sage-700 dark:text-cream-100 border-sage-200 dark:border-ink-700 hover:bg-sage-50 dark:hover:bg-ink-700',
                          used && 'opacity-60',
                        )}
                      >
                        <Sparkles size={12} />
                        {q}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Notes (shared) */}
        <div>
          <label htmlFor="meal-notes" className="label">
            Notes (optional)
          </label>
          <textarea
            id="meal-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Who ate it, recipe link, anything to remember…"
            className="input min-h-[64px] resize-y"
          />
        </div>
      </form>
    </Modal>
  );
}
