import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useScrollFade } from '../hooks/useScrollFade';
import {
  CalendarDays, Check, Trash2, X, ShoppingCart, ChefHat, Sparkles,
  Store, Users, ChevronRight, CircleCheck, Timer, Copy,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore, MEAL_PLAN_DAYS, MEAL_PLAN_DAY_LABELS } from '../store/useStore';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { SpeakYourPlan } from '../components/SpeakYourPlan';
import type { Suggestion } from '../components/AutocompleteInput';
import { findCandidatesForIngredient } from '../utils/recipeMatch';
import { suggestCategory } from '../utils/categorySuggest';
import { DishIcon } from '../components/icons/DishIcons';
import { MealTypeIcon } from '../components/icons/AppIcons';
import {
  PORTION_LEVELS, suggestedServings, headCount, buildShoppingList,
  missingItems, countPlanned, countPlannedDays, TOTAL_SLOTS, TOTAL_DAYS,
  searchLinkFor, entryRecipe,
} from '../utils/portions';
import type { MealPlanDay, MealPlanEntry, MealSlot, Recipe, ShoppingNeed } from '../types';
import { recipesUsingExpiringStock, urgencyLabel } from '../utils/expiryRecipes';
import { suggestMeals, buildTasteVector } from '../utils/mealSuggest';
import type { MealSuggestion } from '../utils/mealSuggest';
import { SuggestSheet } from '../components/SuggestSheet';
import { TasteMatchCard } from '../components/TasteMatchCard';
import type { TasteMatch } from '../components/TasteMatchCard';
import { ThemeToggle } from '../components/ThemeToggle';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];
const SLOT_META: Record<MealSlot, { emoji: string; label: string }> = {
  breakfast: { emoji: '🌅', label: 'Breakfast' },
  lunch: { emoji: '🍛', label: 'Lunch' },
  dinner: { emoji: '🌙', label: 'Dinner' },
};

type EditKey = { day: MealPlanDay; slot: MealSlot };

function todayKey(): MealPlanDay {
  return MEAL_PLAN_DAYS[(new Date().getDay() + 6) % 7];
}

function useCsvRecipes() {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('../data/csvRecipes.json')
      .then((mod) => {
        if (!cancelled) setRecipes((mod.default || mod) as unknown as Recipe[]);
      })
      .catch(() => {
        /* catalogue optional — built-ins still work */
      });
    return () => { cancelled = true; };
  }, []);
  return recipes;
}

/** Recipe id -> 384-dim MiniLM vector. Same source Discover ranks with. */
function useRecipeEmbeddings() {
  const [map, setMap] = useState<Map<string, number[]> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('../data/recipeEmbeddings.json')
      .then((mod) => {
        if (!cancelled) {
          setMap(new Map(Object.entries((mod.default || mod) as Record<string, number[]>)));
        }
      })
      .catch(() => {
        /* embeddings are optional — suggestions fall back to stock-only */
      });
    return () => { cancelled = true; };
  }, []);
  return map;
}

export default function MealPlanPage() {
  const {
    recipes: builtIn, stock, grocery, mealPlan, mealLogs, settings,
    setMealPlanSlot, clearMealPlanDay, copyMealPlanDay, clearMealPlan, addGrocery, toast,
  } = useStore();
  const csvRecipes = useCsvRecipes();
  const embeddings = useRecipeEmbeddings();
  const today = todayKey();
  const household = settings.household;

  // Exactly one slot is edited at a time. Keeping a single draft (instead of
  // seven) means there is nothing to synchronise, so typed text can never be
  // overwritten by a re-render.
  const [editing, setEditing] = useState<EditKey | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftServings, setDraftServings] = useState(4);
  const [preview, setPreview] = useState<Recipe | null>(null);
  const [showShopping, setShowShopping] = useState(false);
  // Days the user has explicitly expanded. A day with any meal planned is
  // always open; an empty day stays collapsed to one line so the whole week
  // fits on a phone screen instead of scrolling through 21 empty slots.
  const [expandedDays, setExpandedDays] = useState<Set<MealPlanDay>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ── suggestions ──────────────────────────────────────────────────────
  // Which slot the suggestion sheet is open for, and how many times the user
  // has asked to reshuffle. `null` means the sheet is closed.
  // Which day the Copy day picker is copying FROM.
  const [copyFrom, setCopyFrom] = useState<MealPlanDay | null>(null);
  const [suggestFor, setSuggestFor] = useState<EditKey | null>(null);
  const [suggestNonce, setSuggestNonce] = useState(0);
  const [suggestBusy, setSuggestBusy] = useState(false);
  // Real measurement of the last "Fill my week": the mean similarity of the
  // dishes we actually suggested to the user's taste profile. Null until a
  // week has been filled — we never invent a figure for a week we didn't score.
  const [tasteMatch, setTasteMatch] = useState<TasteMatch | null>(null);

  const catalogue = useMemo(() => {
    const byId = new Map<string, Recipe>();
    for (const r of builtIn) byId.set(r.id, r);
    for (const r of csvRecipes || []) if (!byId.has(r.id)) byId.set(r.id, r);
    return [...byId.values()];
  }, [builtIn, csvRecipes]);

  const suggestions = useMemo<Suggestion[]>(
    () => catalogue.map((r) => ({ kind: 'recipe' as const, id: r.id, label: r.name, emoji: r.emoji })),
    [catalogue],
  );

  const findByName = useCallback(
    (name: string): Recipe | null => {
      const q = name.trim().toLowerCase();
      if (!q) return null;
      return catalogue.find((r) => r.name.toLowerCase() === q) || null;
    },
    [catalogue],
  );

  // ── suggestion plumbing ───────────────────────────────────────────────

  const openSuggest = useCallback((key: EditKey) => {
    setSuggestFor(key);
    setSuggestNonce(0);
    setSuggestBusy(true);
  }, []);

  const closeSuggest = useCallback(() => setSuggestFor(null), []);

  // Ranking ~6k recipes blocks the main thread, so the sheet paints its
  // "Thinking it over…" state first and clears this on the next frame.
  useEffect(() => {
    if (!suggestFor) return;
    const t = setTimeout(() => setSuggestBusy(false), 16);
    return () => clearTimeout(t);
  }, [suggestFor]);

  /** Rank dishes for a slot, then hand one to the normal slot editor. */
  const suggestionsFor = useMemo<MealSuggestion[]>(() => {
    if (!suggestFor || suggestBusy) return [];
    return suggestMeals({
      slot: suggestFor.slot,
      catalogue,
      stock,
      mealLogs,
      embeddings,
      mealPlan,
      diet: settings.dietaryPreference,
      allergies: settings.allergies ?? [],
      household,
      nonce: suggestNonce,
      limit: 3,
    });
  }, [
    suggestFor, suggestBusy, catalogue, stock, mealLogs, embeddings,
    mealPlan, settings.dietaryPreference, settings.allergies, household, suggestNonce,
  ]);

  const hasTasteProfile = useMemo(
    () => !!buildTasteVector(mealLogs, embeddings),
    [mealLogs, embeddings],
  );

  /**
   * A suggestion fills the ordinary inline editor — same path as picking by
   * hand — so the user confirms the dish and can adjust the portion. Nothing
   * is ever written to the plan without that explicit save.
   */
  const applySuggestion = useCallback(
    (s: MealSuggestion) => {
      if (!suggestFor) return;
      const key = suggestFor;
      setSuggestFor(null);
      setEditing(key);
      setDraftText(s.recipe.name);
      setDraftServings(suggestedServings(household));
      setPreview(s.recipe);
    },
    [suggestFor, household],
  );

  /**
   * Fill every empty slot in the week. Goes through the store action for each
   * one, and never touches a slot the user already filled.
   */
  const suggestWholeWeek = useCallback(() => {
    const defaults = suggestedServings(household);
    let filled = 0;
    const taken = new Set<string>();
    // One confidence figure per dish, summed into the single accuracy number.
    // dishConfidence works with or without a taste profile, so this is never
    // empty — the board always has a real number to show.
    const confidences: number[] = [];
    for (const day of MEAL_PLAN_DAYS) {
      for (const slot of SLOTS) {
        if (mealPlan[day]?.[slot]) continue;
        // Ask for a few candidates, then take the first one this week hasn't
        // used. Filtering a single top pick against `taken` instead would
        // starve every slot after the first one and fill only one meal.
        const picks = suggestMeals({
          slot,
          catalogue,
          stock,
          mealLogs,
          embeddings,
          mealPlan,
          diet: settings.dietaryPreference,
          allergies: settings.allergies ?? [],
          household,
          limit: 6,
          nonce: filled,
        }).filter((p) => !taken.has(p.recipe.id));
        const pick = picks[0];
        if (!pick) continue;
        taken.add(pick.recipe.id);
        confidences.push(pick.confidence);
        const entry: MealPlanEntry = {
          name: pick.recipe.name,
          recipeId: pick.recipe.id,
          slot,
          servings: defaults,
          createdAt: Date.now(),
        };
        setMealPlanSlot(day, slot, entry);
        filled += 1;
      }
    }

    // One number for the whole list — always present, never a placeholder.
    setTasteMatch(
      confidences.length > 0
        ? {
            score: confidences.reduce((a, b) => a + b, 0) / confidences.length,
            dishes: confidences.length,
            fromTasteProfile: hasTasteProfile,
          }
        : null,
    );

    toast(
      filled > 0
        ? `Planned ${filled} meal${filled === 1 ? '' : 's'} — tap any dish to change it.`
        : 'Nothing to fill — add a few ingredients to your stock first.',
      filled > 0 ? 'success' : 'info',
    );
  }, [
    catalogue, stock, mealLogs, embeddings, mealPlan, settings.dietaryPreference,
    settings.allergies, household, hasTasteProfile, setMealPlanSlot, toast,
  ]);

  const openEditor = (day: MealPlanDay, slot: MealSlot) => {
    const entry = mealPlan[day]?.[slot];
    setEditing({ day, slot });
    setDraftText(entry?.name || '');
    setDraftServings(entry?.servings || suggestedServings(household));
    setPreview(entry ? entryRecipe(entry, catalogue) : null);
    // Focus after the editor paints.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const closeEditor = () => {
    setEditing(null);
    setDraftText('');
    setPreview(null);
  };

  const commit = () => {
    if (!editing) return;
    const name = draftText.trim();
    if (!name) {
      toast('Type a dish first', 'warning');
      return;
    }
    const recipe = findByName(name);
    const entry: MealPlanEntry = {
      name: recipe ? recipe.name : name,
      ...(recipe ? { recipeId: recipe.id, emoji: recipe.emoji } : {}),
      slot: editing.slot,
      servings: Math.max(1, Math.round(draftServings)),
      createdAt: Date.now(),
    };
    setMealPlanSlot(editing.day, editing.slot, entry);
    toast(`${SLOT_META[editing.slot].label} ${MEAL_PLAN_DAY_LABELS[editing.day]}: ${entry.name}`, 'success');
    closeEditor();
  };

  // Dishes that rescue food about to go off — the missing link between the
  // fridge and the plan.
  const rescues = useMemo(
    () => recipesUsingExpiringStock(catalogue, stock, 3, 6),
    [catalogue, stock],
  );

  const planned = countPlanned(mealPlan);
  const plannedDays = countPlannedDays(mealPlan);
  const needs = useMemo(
    () => buildShoppingList(mealPlan, catalogue, stock),
    [mealPlan, catalogue, stock],
  );
  const toBuy = useMemo(() => missingItems(needs), [needs]);
  const heads = headCount(household);

  const addAllToGrocery = () => {
    // Skip anything already on the list so pressing twice is harmless.
    const existing = new Set(grocery.map((g) => g.name.trim().toLowerCase()));
    let n = 0;
    for (const item of toBuy) {
      const key = item.name.trim().toLowerCase();
      if (existing.has(key)) continue;
      addGrocery({ name: item.name, quantity: `${item.needed}${item.unit}`, category: item.category });
      existing.add(key);
      n++;
    }
    setAdded(new Set(toBuy.map((i) => i.name)));
    toast(n === 0 ? 'Those are already on your list' : `Added ${n} item${n === 1 ? '' : 's'} to your grocery list`, n === 0 ? 'info' : 'success');
  };

  const defaultPortion = useMemo(() => {
    const sv = suggestedServings(household);
    return PORTION_LEVELS.find((p) => p.servings === sv) || null;
  }, [household]);

  const previewCoverage = useMemo(() => {
    if (!preview) return null;
    let have = 0;
    for (const ing of preview.ingredients) {
      if (findCandidatesForIngredient(ing, stock).length > 0) have++;
    }
    return { have, total: preview.ingredients.length };
  }, [preview, stock]);

  const catFadeRef = useScrollFade<HTMLDivElement>();

  return (
    <div className="mx-auto max-w-6xl px-3 sm:px-4 pb-8 pt-3 sm:pt-4 grid grid-cols-1 lg:grid-cols-[minmax(0,42rem)_17rem] lg:gap-8 lg:items-start">
      {/* On a phone the read-out sits above the plan; on a wide screen it
          moves into the empty right-hand column and sticks while you scroll. */}
      <aside className="order-1 lg:order-2 lg:sticky lg:top-4 mb-3 lg:mb-0">
        <TasteMatchCard
          match={tasteMatch}
          hasTasteProfile={hasTasteProfile}
          loading={embeddings === null && mealLogs.some((m) => !!m.recipeId)}
        />
      </aside>

      <div className="order-2 lg:order-1 min-w-0">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-sage-900 dark:text-cream-50">
              This week's plan
            </h1>
            <p className="text-sm text-sage-600 dark:text-ink-300 mt-0.5">
              {planned === 0
                ? 'What do you want to make each day?'
                : `${plannedDays} of ${TOTAL_DAYS} days planned · ${planned} meal${planned === 1 ? '' : 's'}`}
              {heads > 0 && (
                <span className="inline-flex items-center gap-1 ml-2">
                  <Users size={12} /> cooking for {heads}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <ThemeToggle />
            {planned < TOTAL_SLOTS && (
              <button
                onClick={suggestWholeWeek}
                className="inline-flex items-center gap-1 rounded-lg bg-sage-100 dark:bg-sage-900/40 px-2 py-1 text-xs font-bold text-sage-700 dark:text-sage-300 hover:bg-sage-200 dark:hover:bg-sage-900/60"
              >
                <Sparkles size={12} />
                Fill my week
              </button>
            )}
            {planned > 0 && (
              <button
                onClick={() => {
                  clearMealPlan();
                  // The score described the week we just removed — keeping it
                  // would report a match for a plan that no longer exists.
                  setTasteMatch(null);
                  toast('Cleared the whole week', 'info');
                }}
                className="text-xs font-semibold text-sage-500 hover:text-tomato-600 dark:text-ink-400 px-2 py-1"
              >
                Clear week
              </button>
            )}
          </div>
        </div>
        {planned > 0 && (
          <div className="mt-2 h-1.5 rounded-full bg-sage-100 dark:bg-ink-700 overflow-hidden">
            <div
              className="h-full bg-sage-600 transition-all"
              style={{ width: `${Math.round((planned / TOTAL_SLOTS) * 100)}%` }}
            />
          </div>
        )}
      </header>

      {rescues.length > 0 && (
        <section className="mb-4 rounded-2xl border border-butter-300 dark:border-butter-800 bg-butter-50 dark:bg-butter-900/20 p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <Timer size={15} className="text-butter-700 dark:text-butter-300 shrink-0" />
            <h2 className="font-display font-bold text-sm text-butter-900 dark:text-butter-200">
              Use these before they go
            </h2>
          </div>
          <p className="text-[11px] text-butter-800/80 dark:text-butter-300/80 mb-2.5">
            You have {rescues[0].uses.length === 1 ? 'something' : 'things'} expiring in the next 3 days.
          </p>
          <div ref={catFadeRef} className="scroll-fade-x flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {rescues.map((r) => (
              <button
                key={r.recipe.id}
                onClick={() => openEditor('mon', 'dinner')}
                className="shrink-0 w-44 rounded-xl bg-white dark:bg-ink-800 border border-butter-200 dark:border-ink-700 p-2.5 text-left hover:bg-butter-50 dark:hover:bg-ink-700 active:scale-[.98] transition"
              >
                <div className="flex items-center gap-2 mb-1">
                  <DishIcon recipe={r.recipe} size={18} className="shrink-0 text-butter-700 dark:text-butter-300" />
                  <span className="text-xs font-bold text-sage-900 dark:text-cream-50 truncate">
                    {r.recipe.name}
                  </span>
                </div>
                <p className="text-[10px] text-tomato-700 dark:text-tomato-300 font-semibold">
                  {urgencyLabel(r)}
                </p>
                <p className="text-[10px] text-sage-500 dark:text-ink-400 mt-0.5">
                  {r.coverage.have}/{r.coverage.total} ingredients in stock
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      <ol className="space-y-2 sm:space-y-2.5">
        {MEAL_PLAN_DAYS.map((day) => {
          const dayPlan = mealPlan[day];
          const isToday = day === today;
          const dayCount = SLOTS.filter((s) => dayPlan?.[s]).length;
          const dayOpen = dayCount > 0 || expandedDays.has(day);

          return (
            <li
              key={day}
              className={clsx(
                'rounded-2xl border bg-white dark:bg-ink-800 p-2.5 sm:p-3.5 shadow-soft',
                isToday
                  ? 'border-sage-400 dark:border-sage-600 ring-1 ring-sage-300 dark:ring-sage-800'
                  : 'border-sage-200 dark:border-ink-700',
              )}
            >
              <button
                onClick={() =>
                  setExpandedDays((prev) => {
                    const next = new Set(prev);
                    if (next.has(day)) next.delete(day);
                    else next.add(day);
                    return next;
                  })
                }
                aria-expanded={dayOpen}
                className="w-full flex items-center gap-2 mb-2 text-left"
              >
                <span
                  className={clsx(
                    'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full',
                    isToday
                      ? 'bg-sage-700 text-white'
                      : 'bg-sage-100 dark:bg-ink-700 text-sage-700 dark:text-ink-200',
                  )}
                >
                  {MEAL_PLAN_DAY_LABELS[day]}
                </span>
                <span className="text-[10px] text-sage-500 dark:text-ink-400">
                  {dayCount > 0 ? `${dayCount}/3` : 'nothing planned'}
                </span>
                <span className="flex-1" />
                {dayCount === 0 && (
                  <ChevronRight
                    size={14}
                    className={clsx(
                      'text-sage-300 dark:text-ink-600 transition-transform',
                      dayOpen && 'rotate-90',
                    )}
                  />
                )}
              </button>

              {dayCount === 0 && !dayOpen ? null : (
              <ul className="space-y-1 sm:space-y-1.5">
                {SLOTS.map((slot) => {
                  const entry = dayPlan?.[slot];
                  const meta = SLOT_META[slot];
                  const isOpen = editing?.day === day && editing?.slot === slot;

                  if (isOpen) {
                    return (
                      <li key={slot} className="rounded-xl border border-sage-300 dark:border-sage-700 bg-cream-50 dark:bg-ink-900 p-2.5">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-sage-700 dark:text-sage-300">
                            <MealTypeIcon type={editing.slot} size={12} className="inline-block align-[-2px]" />{' '}
                            {meta.label} · {MEAL_PLAN_DAY_LABELS[day]}
                          </span>
                          <span className="flex-1" />
                          <button onClick={closeEditor} aria-label="Cancel" className="text-sage-400 hover:text-sage-700 p-0.5">
                            <X size={14} />
                          </button>
                        </div>

                        <AutocompleteInput
                          id={`plan-${day}-${slot}`}
                          inputRef={inputRef}
                          value={draftText}
                          onChange={setDraftText}
                          onPick={(s) => {
                            if (s.kind === 'recipe' && s.id) {
                              setPreview(catalogue.find((x) => x.id === s.id) || null);
                            }
                          }}
                          suggestions={suggestions}
                          maxSuggestions={10}
                          placeholder="Type a dish — or pick a recipe"
                          className="w-full rounded-xl border border-sage-200 dark:border-ink-700 bg-white dark:bg-ink-800 px-3 py-2.5 text-sm text-sage-900 dark:text-cream-50 placeholder:text-sage-400 dark:text-ink-500 focus:outline-none focus:ring-2 focus:ring-sage-300"
                        />

                        {/* Portion sizes */}
                        <div className="mt-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-sage-500 dark:text-ink-400 mb-1">
                            Portion
                            {defaultPortion && (
                              <span className="normal-case tracking-normal font-semibold text-sage-600 dark:text-sage-400">
                                {' '}
                                · {defaultPortion.label} ({defaultPortion.servings}) suits your household
                              </span>
                            )}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {PORTION_LEVELS.map((p) => {
                              const active = draftServings === p.servings;
                              return (
                                <button
                                  key={p.id}
                                  onClick={() => setDraftServings(p.servings)}
                                  className={clsx(
                                    'px-2.5 py-1.5 rounded-lg text-xs font-semibold transition border',
                                    active
                                      ? 'bg-sage-700 text-white border-sage-700'
                                      : 'bg-white dark:bg-ink-800 text-sage-700 dark:text-ink-200 border-sage-200 dark:border-ink-700',
                                  )}
                                >
                                  {p.label}
                                  <span className="block text-[10px] font-normal opacity-80">{p.blurb}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {preview && previewCoverage && (
                          <div className="mt-2 rounded-lg bg-white dark:bg-ink-800 border border-sage-200 dark:border-ink-700 p-2">
                            <p className="text-xs font-semibold text-sage-900 dark:text-cream-50">
                              <DishIcon recipe={preview} size={16} className="inline-block align-[-3px] text-sage-700 dark:text-sage-300" />
                              {preview.name}
                            </p>
                            <p className="text-[11px] text-sage-500 dark:text-ink-400 mt-0.5">
                              for {draftServings} {draftServings === 1 ? 'person' : 'people'} ·{' '}
                              {previewCoverage.have} of {previewCoverage.total} ingredients in stock
                            </p>
                            <ul className="mt-1.5 space-y-0.5 text-[11px] text-sage-700 dark:text-ink-200">
                              {preview.ingredients.slice(0, 5).map((ing, i) => {
                                const inStock = findCandidatesForIngredient(ing, stock).length > 0;
                                return (
                                  <li key={i} className="flex items-center gap-1.5">
                                    <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', inStock ? 'bg-sage-500' : 'bg-tomato-400')} />
                                    <span className="truncate">{ing.name}</span>
                                    <span className="text-sage-400 dark:text-ink-500 ml-auto shrink-0">
                                      {ing.quantity}{ing.unit}
                                    </span>
                                  </li>
                                );
                              })}
                              {preview.ingredients.length > 5 && (
                                <li className="text-sage-400 dark:text-ink-500 pl-3">
                                  +{preview.ingredients.length - 5} more
                                </li>
                              )}
                            </ul>
                          </div>
                        )}

                        {!preview && draftText.trim() && (
                          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-sage-600 dark:text-ink-300">
                            <Sparkles size={12} className="shrink-0" />
                            No catalogue match — saves as a free-text dish (no ingredients to shop for).
                          </p>
                        )}

                        <button
                          onClick={commit}
                          className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-sage-700 hover:bg-sage-800 text-white text-sm font-bold py-2"
                        >
                          <Check size={15} />
                          Yes, this is what I'm making
                        </button>
                      </li>
                    );
                  }

                  return (
                    <li key={slot}>
                      <div className="flex items-stretch gap-1.5">
                        <button
                          onClick={() => openEditor(day, slot)}
                          className={clsx(
                            'flex-1 flex items-center gap-2 rounded-xl px-2.5 py-2 sm:py-2.5 text-left transition',
                            entry
                              ? 'bg-sage-50 dark:bg-sage-900/25 hover:bg-sage-100 dark:hover:bg-sage-900/40'
                              : 'border border-dashed border-sage-200 dark:border-ink-700 hover:bg-sage-50 dark:hover:bg-ink-700',
                          )}
                        >
                          <MealTypeIcon type={slot} size={16} className="shrink-0 text-sage-600 dark:text-sage-300" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-sage-500 dark:text-ink-400 w-16 shrink-0">
                            {meta.label}
                          </span>
                          <span className={clsx(
                            'flex-1 truncate text-sm',
                            entry ? 'font-semibold text-sage-900 dark:text-cream-50' : 'text-sage-400 dark:text-ink-500',
                          )}>
                            {entry ? entry.name : 'Tap to plan'}
                          </span>
                          {entry && (
                            <span className="shrink-0 text-[10px] text-sage-500 dark:text-ink-400">
                              {entry.servings}pax
                            </span>
                          )}
                          <ChevronRight size={14} className="shrink-0 text-sage-300 dark:text-ink-500" />
                        </button>
                        {/* Sibling, not a child — a button nested in a button is
                            invalid HTML and breaks keyboard/screen readers. */}
                        {!entry && (
                          <button
                            onClick={() => openSuggest({ day, slot })}
                            aria-label={`Suggest a ${meta.label.toLowerCase()} dish`}
                            title="Suggest a dish"
                            className="shrink-0 w-10 rounded-xl border border-sage-200 dark:border-ink-700 grid place-items-center text-sage-500 hover:text-sage-700 hover:bg-sage-50 dark:text-ink-400 dark:hover:text-butter-300 dark:hover:bg-sage-900/30 transition"
                          >
                            <Sparkles size={16} />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              )}
              <div className="mt-1.5 flex items-center gap-3">
                {dayCount > 0 && (
                  <button
                    onClick={() => clearMealPlanDay(day)}
                    aria-label={`Clear ${MEAL_PLAN_DAY_LABELS[day]}`}
                    className="text-[11px] font-semibold text-sage-400 hover:text-tomato-600 dark:text-ink-500 dark:hover:text-tomato-300"
                  >
                    Clear day
                  </button>
                )}
                {/* Repeat a good day rather than re-picking every dish. */}
                <button
                  onClick={() => setCopyFrom(day)}
                  aria-label={`Copy ${MEAL_PLAN_DAY_LABELS[day]} to another day`}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-sage-500 hover:text-sage-700 dark:text-ink-400 dark:hover:text-sage-300"
                >
                  <Copy size={11} />
                  Copy day
                </button>
              </div>

              {/* Say the whole day out loud instead of picking each slot. */}
              {dayOpen && (
                <SpeakYourPlan
                  onApply={(plan) => {
                    let filled = 0;
                    (['breakfast', 'lunch', 'dinner'] as const).forEach((slot) => {
                      const name = plan[slot]?.trim();
                      if (!name) return;               // never mentioned: leave alone
                      const existing = dayPlan?.[slot];
                      setMealPlanSlot(day, slot, {
                        name,
                        slot,
                        // Keep the portion size this day already used rather than
                        // resetting it; default to a small household.
                        servings: existing?.servings ?? 2,
                        createdAt: Date.now(),
                      });
                      filled++;
                    });
                    toast(
                      filled
                        ? `Added ${filled} meal${filled === 1 ? '' : 's'} by voice`
                        : 'Nothing was recognised to add',
                      filled ? 'success' : 'warning',
                    );
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>

      {planned > 0 && (
        <div className="mt-5 space-y-2">
          <button
            onClick={() => { setShowShopping(true); setAdded(new Set()); }}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-sage-700 hover:bg-sage-800 text-white font-bold py-3 shadow-soft"
          >
            <ShoppingCart size={17} />
            Make your grocery list ready
          </button>
          <p className="flex items-start gap-2 text-xs text-sage-500 dark:text-ink-400 leading-relaxed">
            <CalendarDays size={14} className="shrink-0 mt-0.5" />
            A plan, not a log — your stock only changes when you actually log the meal.
          </p>
        </div>
      )}

      {showShopping && (
        <ShoppingListSheet
          needs={needs}
          toBuy={toBuy}
          added={added}
          onAddAll={addAllToGrocery}
          onClose={() => setShowShopping(false)}
        />
      )}

      {copyFrom && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button
            onClick={() => setCopyFrom(null)}
            aria-label="Cancel"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Copy ${MEAL_PLAN_DAY_LABELS[copyFrom]} to`}
            className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-white dark:bg-ink-800 shadow-pop p-5 pb-[calc(var(--hh-nav-space,0rem)+0.5rem)] sm:pb-5"
          >
            <h2 className="font-display text-lg font-bold text-sage-900 dark:text-cream-50">
              Copy {MEAL_PLAN_DAY_LABELS[copyFrom]} to…
            </h2>
            <p className="mt-0.5 text-xs text-sage-500 dark:text-ink-400">
              This replaces whatever is planned for that day.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {MEAL_PLAN_DAYS.filter((d) => d !== copyFrom).map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    copyMealPlanDay(copyFrom, d);
                    toast(`${MEAL_PLAN_DAY_LABELS[copyFrom]} copied to ${MEAL_PLAN_DAY_LABELS[d]}`, 'success');
                    setCopyFrom(null);
                  }}
                  className="rounded-xl border border-sage-200 dark:border-ink-700 px-3 py-2.5 text-sm font-semibold text-sage-800 dark:text-cream-100 hover:bg-sage-50 dark:hover:bg-ink-700 transition"
                >
                  {MEAL_PLAN_DAY_LABELS[d]}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCopyFrom(null)}
              className="mt-3 w-full rounded-xl py-2.5 text-xs font-bold text-sage-600 hover:bg-sage-50 dark:text-ink-300 dark:hover:bg-ink-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {suggestFor && (
        <SuggestSheet
          slot={suggestFor.slot}
          dayLabel={MEAL_PLAN_DAY_LABELS[suggestFor.day]}
          suggestions={suggestionsFor}
          hasTasteProfile={hasTasteProfile}
          servings={suggestedServings(household)}
          busy={suggestBusy}
          onPick={applySuggestion}
          onShuffle={() => setSuggestNonce((n) => n + 1)}
          onClose={closeSuggest}
        />
      )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Shopping list sheet                                                         */
/* -------------------------------------------------------------------------- */

function ShoppingListSheet({
  needs, toBuy, added, onAddAll, onClose,
}: {
  needs: ShoppingNeed[];
  toBuy: ShoppingNeed[];
  added: Set<string>;
  onAddAll: () => void;
  onClose: () => void;
}) {
  const covered = needs.filter((n) => n.covered);
  const [showCovered, setShowCovered] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div className="relative w-full sm:max-w-lg max-h-[85vh] overflow-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-ink-800 shadow-pop p-5 pb-[calc(var(--hh-nav-space,0rem)+0.5rem)] sm:pb-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="font-display text-xl font-bold text-sage-900 dark:text-cream-50">
              Your grocery list
            </h2>
            <p className="text-sm text-sage-600 dark:text-ink-300 mt-0.5">
              {toBuy.length === 0
                ? 'You already have everything for this week.'
                : `${toBuy.length} item${toBuy.length === 1 ? '' : 's'} to buy`}
              {covered.length > 0 && ` · ${covered.length} already in the fridge`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-sage-400 hover:text-sage-700 p-1">
            <X size={18} />
          </button>
        </div>

        {needs.length === 0 && (
          <div className="py-8 text-center">
            <ChefHat size={28} className="mx-auto text-sage-300 dark:text-ink-600" />
            <p className="mt-2 text-sm text-sage-600 dark:text-ink-300">
              Pick dishes from the recipe catalogue and their ingredients will show up here.
            </p>
          </div>
        )}

        {toBuy.length > 0 && (
          <>
            <ul className="space-y-1.5 mb-3">
              {toBuy.map((n) => (
                <li
                  key={n.name + n.unit}
                  className="flex items-center gap-2.5 rounded-xl bg-cream-50 dark:bg-ink-900 px-3 py-2.5"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-sage-900 dark:text-cream-50 text-sm truncate">
                      {n.name}
                    </span>
                    <span className="block text-[11px] text-sage-500 dark:text-ink-400">
                      need {n.needed}{n.unit}
                      {n.inStock && n.have ? ` · have ${n.have}${n.unit}` : ''}
                    </span>
                  </span>
                  <a
                    href={searchLinkFor(n.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-white dark:bg-ink-800 border border-sage-200 dark:border-ink-700 px-2 py-1 text-[10px] font-bold text-sage-700 dark:text-sage-300 hover:bg-sage-50"
                  >
                    <Store size={11} /> Shop
                  </a>
                </li>
              ))}
            </ul>
            <button
              onClick={onAddAll}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-sage-700 hover:bg-sage-800 text-white font-bold py-3"
            >
              <ShoppingCart size={16} />
              Add all to my grocery list
            </button>
            {added.size > 0 && (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-xs font-semibold text-sage-600 dark:text-sage-400">
                <CircleCheck size={13} /> {added.size} added to your grocery list
              </p>
            )}
            <p className="mt-2 text-[11px] text-center text-sage-400 dark:text-ink-500">
              "Shop" opens a search so you can check live prices — prices change, so the app never
              shows a discount it can't verify.
            </p>
          </>
        )}

        {covered.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowCovered((v) => !v)}
              className="text-xs font-bold text-sage-600 dark:text-sage-400 flex items-center gap-1"
            >
              <ChevronRight size={13} className={clsx('transition', showCovered && 'rotate-90')} />
              Already in the fridge ({covered.length})
            </button>
            {showCovered && (
              <ul className="mt-2 space-y-1">
                {covered.map((n) => (
                  <li key={n.name + n.unit} className="flex items-center gap-2 text-sm text-sage-600 dark:text-ink-300 px-1">
                    <CircleCheck size={14} className="text-sage-500 shrink-0" />
                    <span className="truncate">{n.name}</span>
                    <span className="ml-auto text-xs text-sage-400 shrink-0">
                      {n.needed}{n.unit}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}