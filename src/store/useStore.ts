import { useSyncExternalStore } from 'react';
import type {
  AppSettings,
  AppState,
  CategoryId,
  GroceryItem,
  MealLog,
  HouseholdProfile,
  MealPlan,
  MealPlanDay,
  MealPlanDayPlan,
  MealPlanEntry,
  MealSlot,
  MealType,
  Recipe,
  StockItem,
  ThemeMode,
  UserConsents,
} from '../types';
import { seedState } from './seed';
import { STARTER_RECIPES } from '../data/recipes';
import { INDIAN_RECIPES } from '../data/indianRecipes';

/** Built-in catalog = starter recipes + curated Indian recipes. */
const BUILT_IN_RECIPES = [...STARTER_RECIPES, ...INDIAN_RECIPES] as any;
import { uid } from '../utils/uid';
import { findCandidatesForIngredient, planRecipeDeduction } from '../utils/recipeMatch';
import { formatBaseValue, subtractBase, toBaseUnit, unitDimension } from '../utils/units';

const STORAGE_KEY = 'homehub.v1';

const loadFromStorage = (): AppState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed.grocery || !parsed.stock || !parsed.settings) return null;
    // Forward-compatible: fill in missing settings keys.
    parsed.settings = {
      ...parsed.settings,
      expiringSoonDays: parsed.settings.expiringSoonDays ?? 3,
      hasSeenWelcome: parsed.settings.hasSeenWelcome ?? false,
      userName: parsed.settings.userName ?? '',
      dietaryPreference: parsed.settings.dietaryPreference ?? 'no-preference',
      allergies: parsed.settings.allergies ?? [],
      theme: parsed.settings.theme ?? 'system',
      showChainHq: parsed.settings.showChainHq ?? false,
      microphoneEnabled: parsed.settings.microphoneEnabled ?? false,
    };
    // Note: `hasSeenConsents` is intentionally NOT defaulted — if it's missing
    // from localStorage we know the user existed before this feature shipped,
    // so we want to show the consent modal on their next launch.
    if (parsed.settings.hasSeenConsents === true) {
      parsed.settings.consents = parsed.settings.consents ?? {
        haptics: true,
        notifications: false,
        location: false,
        personalization: true,
      };
    }
    // Forward-compatible: mealLogs may not exist on older snapshots.
    parsed.mealLogs = parsed.mealLogs ?? [];
    // Forward-compatible: recipes may not exist on older snapshots. Always seed
    // built-in recipes so the Log a meal modal has content to pick from.
    parsed.recipes = parsed.recipes?.length ? parsed.recipes : BUILT_IN_RECIPES;
    // Forward-compatible: older stock items had no location — default to fridge.
    parsed.stock = (parsed.stock ?? []).map((it) => ({
      ...it,
      location: it.location ?? 'fridge',
    }));
    return parsed;
  } catch {
    return null;
  }
};

const saveToStorage = (state: AppState) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors silently
  }
};

export type ToastKind = 'success' | 'info' | 'warning';
export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  /** Optional undo action. A toast with one lingers longer so it's tappable. */
  undo?: () => void;
}

export interface UseStore extends AppState {
  // Grocery
  addGrocery: (input: {
    name: string;
    quantity: string;
    category: CategoryId;
  }) => GroceryItem;
  toggleGroceryPurchased: (id: string) => void;
  removeGrocery: (id: string) => void;
  clearPurchasedGrocery: () => number;
  updateGrocery: (id: string, patch: Partial<Omit<GroceryItem, 'id' | 'createdAt'>>) => void;
  // Stock
  addStock: (input: Omit<StockItem, 'id' | 'createdAt' | 'updatedAt'>) => StockItem;
  updateStock: (id: string, patch: Partial<Omit<StockItem, 'id' | 'createdAt'>>) => void;
  incrementStock: (id: string, delta: number) => void;
  removeStock: (id: string) => void;
  // Settings
  updateSettings: (patch: Partial<AppSettings>) => void;
  /** Wipes grocery + stock and resets onboarding. Atomic — survives StrictMode. */
  clearAllData: () => void;
  // Meal logs
  addMealLog: (input: {
    mealType: MealType;
    description: string;
    notes?: string;
    /** Attaching a recipe and a liked/not-liked verdict is what lets the
     *  taste model learn; both stay optional. */
    recipeId?: string;
    servings?: number;
    liked?: boolean;
  }) => MealLog;
  removeMealLog: (id: string) => void;
  /**
   * Logs a meal from a recipe and atomically deducts matching stock items
   * based on `peopleCooked`. Emits a single toast summarizing used + skipped.
   *
   * `pickedStockByIngredient` lets the caller override the matched stock item
   * for a given ingredient name (used when the match is ambiguous and the user
   * picked one from a dropdown). Key is the ingredient name (e.g. "Potato").
   */
  logMealFromRecipe: (input: {
    recipeId: string;
    peopleCooked: number;
    notes?: string;
    pickedStockByIngredient?: Record<string, string>;
    /** "Did you enjoy it?" — the label the taste model trains on. */
    liked?: boolean;
  }) => {
    log: MealLog;
    usedCount: number;
    skippedCount: number;
  };
  /**
   * Log a meal composed of MULTIPLE recipes (e.g. lunch = rice + dal + sabzi).
   * Combines the storage in storage, then deducts each combined ingredient.
   * For each ingredient we sum across recipes (if two recipes both use onion,
   * we deduct the sum).
   */
  logMealFromRecipes: (input: {
    recipeIds: string[];
    peopleCooked: number;
    notes?: string;
    pickedStockByIngredient?: Record<string, string>;
  }) => {
    log: MealLog;
    usedCount: number;
    skippedCount: number;
  };
  // Recipes
  addCustomRecipe: (input: Omit<Recipe, 'id' | 'builtIn'>) => Recipe;
  removeRecipe: (id: string) => void;
  // Weekly meal plan
  mealPlan: MealPlan;
  /** Set (or with null, clear) one meal slot of one day. */
  setMealPlanSlot: (day: MealPlanDay, slot: MealSlot, entry: MealPlanEntry | null) => void;
  /** Clear all three slots for one day. */
  clearMealPlanDay: (day: MealPlanDay) => void;
  /**
   * Copy one day's meals onto another. Entries are cloned rather than shared
   * so editing the copy can't quietly mutate the original day.
   */
  copyMealPlanDay: (from: MealPlanDay, to: MealPlanDay) => void;
  /** Clear the whole week. */
  clearMealPlan: () => void;
  /** Record the household's composition (adults + kids by age). */
  completeHouseholdSurvey: (household: HouseholdProfile) => void;
  // Toasts
  toasts: Toast[];
  toast: (message: string, kind?: ToastKind, undo?: () => void) => void;
  dismissToast: (id: string) => void;
  // Consents — called by the ConsentModal and the Settings permissions card.
  setConsents: (patch: Partial<UserConsents>) => void;
  markConsentsSeen: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Singleton store state                                                       */
/* -------------------------------------------------------------------------- */

interface InternalState {
  app: AppState;
  toasts: Toast[];
}

let state: InternalState | null = null;
const listeners = new Set<() => void>();

function ensureState(): InternalState {
  if (state) return state;
  const initial: InternalState = {
    app: loadFromStorage() ?? seedState(),
    toasts: [],
  };
  state = initial;
  return initial;
}

function getState(): InternalState {
  return ensureState();
}

function setState(updater: (cur: InternalState) => InternalState): void {
  const cur = getState();
  const next = updater(cur);
  if (next === cur) return;
  state = next;
  // Persist app state to localStorage. Skip the very first hydration write so
  // we don't overwrite storage with the value we just read from it.
  if (cur.app !== next.app) {
    saveToStorage(next.app);
  }
  listeners.forEach((l) => l());
}

/* -------------------------------------------------------------------------- */
/*  Toast timers (module-scoped; survives component remounts)                  */
/* -------------------------------------------------------------------------- */

const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

function pushToast(message: string, kind: ToastKind = 'success', undo?: () => void) {
  const id = uid('toast');
  setState((s) => ({ ...s, toasts: [...s.toasts, { id, message, kind, undo }] }));
  // Undoable toasts stay long enough to actually reach and tap.
  const handle = setTimeout(
    () => {
      toastTimers.delete(id);
      setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
    },
    undo ? 6000 : 2800,
  );
  toastTimers.set(id, handle);
}

function dismissToast(id: string) {
  const handle = toastTimers.get(id);
  if (handle) {
    clearTimeout(handle);
    toastTimers.delete(id);
  }
  setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
}

/* -------------------------------------------------------------------------- */
/*  Action creators — stable identities across remounts                        */
/* -------------------------------------------------------------------------- */

const addGrocery: UseStore['addGrocery'] = (input) => {
  const item: GroceryItem = {
    id: uid('gro'),
    name: input.name.trim(),
    quantity: input.quantity.trim() || '1',
    category: input.category,
    purchased: false,
    createdAt: Date.now(),
  };
  setState((s) => ({ ...s, app: { ...s.app, grocery: [item, ...s.app.grocery] } }));
  return item;
};

const toggleGroceryPurchased = (id: string) => {
  setState((s) => ({
    ...s,
    app: {
      ...s.app,
      grocery: s.app.grocery.map((g) =>
        g.id === id
          ? {
              ...g,
              purchased: !g.purchased,
              purchasedAt: !g.purchased ? Date.now() : undefined,
            }
          : g,
      ),
    },
  }));
};

const removeGrocery = (id: string) => {
  const removed = getState().app.grocery.find((g) => g.id === id);
  if (!removed) return;
  setState((s) => ({
    ...s,
    app: { ...s.app, grocery: s.app.grocery.filter((g) => g.id !== id) },
  }));
  pushToast(`Removed ${removed.name}`, 'info', () => {
    setState((s) =>
      s.app.grocery.some((g) => g.id === id)
        ? s
        : { ...s, app: { ...s.app, grocery: [removed, ...s.app.grocery] } },
    );
  });
};

const clearPurchasedGrocery = (): number => {
  const before = getState().app.grocery.length;
  setState((s) => ({
    ...s,
    app: { ...s.app, grocery: s.app.grocery.filter((g) => !g.purchased) },
  }));
  const after = getState().app.grocery.length;
  return before - after;
};

const updateGrocery: UseStore['updateGrocery'] = (id, patch) => {
  setState((s) => ({
    ...s,
    app: {
      ...s.app,
      grocery: s.app.grocery.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    },
  }));
};

const addStock: UseStore['addStock'] = (input) => {
  const item: StockItem = {
    ...input,
    location: input.location ?? 'fridge',
    id: uid('stk'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  setState((s) => ({ ...s, app: { ...s.app, stock: [item, ...s.app.stock] } }));
  return item;
};

const updateStock: UseStore['updateStock'] = (id, patch) => {
  setState((s) => ({
    ...s,
    app: {
      ...s.app,
      stock: s.app.stock.map((it) =>
        it.id === id ? { ...it, ...patch, updatedAt: Date.now() } : it,
      ),
    },
  }));
};

const incrementStock = (id: string, delta: number) => {
  setState((s) => ({
    ...s,
    app: {
      ...s.app,
      stock: s.app.stock.map((it) =>
        it.id === id
          ? {
              ...it,
              quantity: Math.max(0, it.quantity + delta),
              updatedAt: Date.now(),
            }
          : it,
      ),
    },
  }));
};

const removeStock = (id: string) => {
  // Keep the removed row so the delete can be undone — on a phone, a mis-tap
  // otherwise loses an item with no way back.
  const removed = getState().app.stock.find((it) => it.id === id);
  if (!removed) return;
  setState((s) => ({
    ...s,
    app: { ...s.app, stock: s.app.stock.filter((it) => it.id !== id) },
  }));
  pushToast(`Removed ${removed.name}`, 'info', () => {
    setState((s) =>
      s.app.stock.some((it) => it.id === id)
        ? s
        : { ...s, app: { ...s.app, stock: [removed, ...s.app.stock] } },
    );
  });
};

const updateSettings: UseStore['updateSettings'] = (patch) => {
  setState((s) => ({
    ...s,
    app: { ...s.app, settings: { ...s.app.settings, ...patch } },
  }));
};

const addMealLog: UseStore['addMealLog'] = (input) => {
  const entry: MealLog = {
    id: uid('meal'),
    mealType: input.mealType,
    description: input.description.trim(),
    createdAt: Date.now(),
    notes: input.notes?.trim() || undefined,
    recipeId: input.recipeId,
    servings: input.servings,
    liked: input.liked,
  };
  setState((s) => ({ ...s, app: { ...s.app, mealLogs: [entry, ...s.app.mealLogs] } }));
  return entry;
};

const removeMealLog: UseStore['removeMealLog'] = (id) => {
  setState((s) => ({
    ...s,
    app: { ...s.app, mealLogs: s.app.mealLogs.filter((m) => m.id !== id) },
  }));
};

const addCustomRecipe: UseStore['addCustomRecipe'] = (input) => {
  const recipe: Recipe = { ...input, id: uid('rcp') };
  setState((s) => ({ ...s, app: { ...s.app, recipes: [...s.app.recipes, recipe] } }));
  return recipe;
};

const removeRecipe: UseStore['removeRecipe'] = (id) => {
  setState((s) => ({
    ...s,
    app: { ...s.app, recipes: s.app.recipes.filter((r) => r.id !== id) },
  }));
};

/* -------------------------------------------------------------------------- */
/*  Weekly meal plan                                                            */
/* -------------------------------------------------------------------------- */

export const MEAL_PLAN_DAYS: MealPlanDay[] = [
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
];

export const MEAL_PLAN_DAY_LABELS: Record<MealPlanDay, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

const emptyDayPlan = (): MealPlanDayPlan => ({
  breakfast: null, lunch: null, dinner: null,
});

const emptyMealPlan = (): MealPlan => ({
  mon: emptyDayPlan(), tue: emptyDayPlan(), wed: emptyDayPlan(), thu: emptyDayPlan(),
  fri: emptyDayPlan(), sat: emptyDayPlan(), sun: emptyDayPlan(),
});

/** The stored plan, backfilled for saves written before this feature existed.
 *
 * Memoised on the underlying object. `useStore()` is called on every render,
 * and returning a fresh object each time would change `mealPlan`'s identity
 * constantly — which makes any `useEffect(..., [mealPlan])` re-run forever
 * (and any consumer comparing it by reference think the plan changed). */
let mealPlanCache: { src: MealPlan | undefined; value: MealPlan } | null = null;

const currentMealPlan = (): MealPlan => {
  const src = getState().app.mealPlan;
  if (mealPlanCache && mealPlanCache.src === src) return mealPlanCache.value;
  // Backfill every day AND every slot: saves from the earlier single-dish
  // version stored `null` for whole days, and a half-filled day would make
  // the UI crash on `plan[day].breakfast`.
  const value = emptyMealPlan();
  for (const d of MEAL_PLAN_DAYS) {
    const saved = (src || {})[d];
    value[d] = saved ? { ...emptyDayPlan(), ...saved } : emptyDayPlan();
  }
  mealPlanCache = { src, value };
  return value;
};

const setMealPlanSlot: UseStore['setMealPlanSlot'] = (day, slot, entry) => {
  setState((s) => ({
    ...s,
    app: {
      ...s.app,
      mealPlan: {
        ...currentMealPlan(),
        [day]: { ...emptyDayPlan(), ...currentMealPlan()[day], [slot]: entry },
      },
    },
  }));
};

const clearMealPlanDay: UseStore['clearMealPlanDay'] = (day) => {
  setState((s) => ({
    ...s,
    app: { ...s.app, mealPlan: { ...currentMealPlan(), [day]: emptyDayPlan() } },
  }));
};

const copyMealPlanDay: UseStore['copyMealPlanDay'] = (from, to) => {
  if (from === to) return;
  setState((s) => {
    const plan = currentMealPlan();
    const src = plan[from];
    if (!src) return s;
    // Clone each entry so the two days never share an object. createdAt is
    // refreshed because this is a new plan for a different day.
    const cloned = { ...emptyDayPlan() } as typeof emptyDayPlan extends () => infer R ? R : never;
    for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
      const e = src[slot];
      if (e) cloned[slot] = { ...e, createdAt: Date.now() };
    }
    return { ...s, app: { ...s.app, mealPlan: { ...plan, [to]: cloned } } };
  });
};

/** Marks the one-run household survey as done so it stops nagging. */
const completeHouseholdSurvey: UseStore['completeHouseholdSurvey'] = (household) => {
  setState((s) => ({
    ...s,
    app: {
      ...s.app,
      settings: { ...s.app.settings, household: { ...household, completed: true } },
    },
  }));
};

const clearMealPlan = () => {
  setState((s) => ({ ...s, app: { ...s.app, mealPlan: emptyMealPlan() } }));
};

/** Sum deduction base-amounts per stock item.
 *
 * Recipes really do list the same normalised ingredient twice (410 of the
 * 5,894 CSV recipes do — "salt x2", "all purpose flour x2"), and logMeal can
 * combine several recipes that share an item. Both call sites below used
 * `.find()`, which returns only the FIRST match, so every later deduction
 * against that item was silently discarded and stock stayed too high.
 * Summing first, then deriving the remainder from the item's own quantity,
 * also keeps a single base-units conversion per item. */
function sumDeductionsByStockId(
  deductions: Array<{
    deductedBase: number;
    stockItem?: { id: string };
    stockItemId?: string;
  }>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const d of deductions) {
    const id = d.stockItem?.id ?? d.stockItemId;
    if (!id) continue;
    totals.set(id, (totals.get(id) || 0) + d.deductedBase);
  }
  return totals;
}

/** Convert a base-unit remainder back into the stock item's own display unit. */
function baseToDisplay(remainingBase: number, unit: string): number {
  const dim = unitDimension(unit);
  const u = unit.trim().toLowerCase();
  const factor =
    dim === 'mass'
      ? u.startsWith('k') ? 1000 : 1
      : dim === 'vol'
      ? u === 'l' || u === 'liter' || u === 'litre' ? 1000 : 1
      : dim === 'count'
      ? u === 'dozen' ? 12 : 1
      : 1;
  return Math.max(0, remainingBase / factor);
}

const logMealFromRecipe: UseStore['logMealFromRecipe'] = (input) => {
  const cur = getState().app;
  const recipe = cur.recipes.find((r) => r.id === input.recipeId);
  if (!recipe) {
    pushToast('Recipe no longer exists', 'warning');
    return { log: null as unknown as MealLog, usedCount: 0, skippedCount: 0 };
  }
  const plan = planRecipeDeduction(recipe, input.peopleCooked, cur.stock);

  // Apply user-picked stock overrides (ingredient name → stock item id).
  // For each deduction, if the user picked a specific one in the picker,
  // use that stock item instead of the auto-matched one and re-resolve base units.
  const picks = input.pickedStockByIngredient ?? {};
  const finalDeductions = plan.deductions.map((d) => {
    const pickedId = picks[d.ingredient.name];
    if (!pickedId || pickedId === d.stockItem.id) return d;
    const picked = cur.stock.find((s) => s.id === pickedId);
    if (!picked) return d;
    const ingBase = toBaseUnit(d.ingredient.quantity * plan.multiplier, d.ingredient.unit);
    const stkBase = toBaseUnit(picked.quantity, picked.unit);
    if (!ingBase || !stkBase) return d;
    const ingDim = unitDimension(d.ingredient.unit);
    const deductedBase = Math.min(ingBase.value, stkBase.value);
    return {
      ...d,
      stockItem: picked,
      deductedBase,
      remainingBase: subtractBase(stkBase.value, ingBase.value),
      deductedLabel: formatBaseValue(deductedBase, ingDim),
    };
  });

  // Apply deductions atomically: every deduction in one setState call.
  // Summed per stock item so a repeated ingredient deducts in full.
  const deductedByItemId = sumDeductionsByStockId(finalDeductions);
  const deductedIds = new Set(deductedByItemId.keys());
  const newStock = cur.stock.map((it) => {
    const deductedBase = deductedByItemId.get(it.id);
    if (deductedBase === undefined) return it;
    const stkBase = toBaseUnit(it.quantity, it.unit);
    if (!stkBase) return it;
    return {
      ...it,
      quantity: baseToDisplay(stkBase.value - deductedBase, it.unit),
      updatedAt: Date.now(),
    };
  });

  // Remove items that hit 0 from the stock list.
  const finalStock = newStock.filter((it) => {
    if (!deductedIds.has(it.id)) return true;
    return it.quantity > 0;
  });

  const mealLog: MealLog = {
    id: uid('meal'),
    mealType: recipe.mealType,
    description: recipe.name,
    createdAt: Date.now(),
    notes: input.notes?.trim() || undefined,
    recipeId: recipe.id,
    servings: input.peopleCooked,
    liked: input.liked,
  };

  setState((s) => ({
    ...s,
    app: {
      ...s.app,
      stock: finalStock,
      mealLogs: [mealLog, ...s.app.mealLogs],
    },
  }));

  // Single, friendly summary toast.
  const used = finalDeductions.length;
  const skipped = plan.skipped.length;
  if (used === 0 && skipped > 0) {
    pushToast(
      `Logged ${recipe.name}, but no ingredients matched your fridge — add them next time.`,
      'info',
    );
  } else if (skipped === 0) {
    pushToast(`Logged ${recipe.name} · used ${used} ingredient${used === 1 ? '' : 's'} from your fridge`, 'success');
  } else {
    pushToast(
      `Logged ${recipe.name} · used ${used}, skipped ${skipped} (not in fridge)`,
      'warning',
    );
  }

  return { log: mealLog, usedCount: used, skippedCount: skipped };
};

/**
 * Log a meal composed of MULTIPLE recipes (e.g. lunch = rice + dal + sabzi).
 * Combines the ingredient lists across recipes (summing duplicate ingredients
 * by name+unit) and applies one atomic deduction.
 */
const logMealFromRecipes: UseStore['logMealFromRecipes'] = (input) => {
  const cur = getState().app;
  const recipes = input.recipeIds
    .map((id) => cur.recipes.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  if (recipes.length === 0) {
    pushToast('No recipes selected', 'warning');
    return { log: null as unknown as MealLog, usedCount: 0, skippedCount: 0 };
  }

  // Build a combined ingredient map: sum quantities for the same name+unit.
  // Fall back to name-only when unit is missing.
  const ingredientMap = new Map<string, { name: string; quantity: number; unit: string; category: string }>();
  for (const recipe of recipes) {
    const scale = recipe.baseServings > 0 ? input.peopleCooked / recipe.baseServings : 0;
    for (const ing of recipe.ingredients) {
      const key = `${ing.name.toLowerCase().trim()}|${(ing.unit ?? '').toLowerCase().trim()}`;
      const existing = ingredientMap.get(key);
      const scaledQty = (ing.quantity ?? 0) * scale;
      if (existing) {
        existing.quantity += scaledQty;
      } else {
        ingredientMap.set(key, {
          name: ing.name,
          quantity: scaledQty,
          unit: ing.unit,
          category: ing.category,
        });
      }
    }
  }

  // Run deduction for each combined ingredient against the current stock.
  const picks = input.pickedStockByIngredient ?? {};
  const combinedDeductions: Array<{
    name: string;
    quantity: number;
    unit: string;
    deductedBase: number;
    remainingBase: number;
    deductedLabel: string;
    stockItemId: string;
  }> = [];
  const skippedNames: string[] = [];

  for (const ing of ingredientMap.values()) {
    // Find best stock match for this ingredient (uses the same matcher as planRecipeDeduction).
    const candidates = findCandidatesForIngredient(ing as any, cur.stock);
    const match = candidates[0];
    if (!match) {
      skippedNames.push(ing.name);
      continue;
    }
    const pickedId = picks[ing.name] ?? match.id;
    const picked = pickedId === match.id ? match : cur.stock.find((s) => s.id === pickedId);
    if (!picked) {
      skippedNames.push(ing.name);
      continue;
    }
    const ingBase = toBaseUnit(ing.quantity, ing.unit);
    const stkBase = toBaseUnit(picked.quantity, picked.unit);
    if (!ingBase || !stkBase) {
      skippedNames.push(`${ing.name} (unit mismatch)`);
      continue;
    }
    const dim = unitDimension(ing.unit);
    const deductedBase = Math.min(ingBase.value, stkBase.value);
    combinedDeductions.push({
      name: ing.name,
      quantity: ing.quantity,
      unit: ing.unit,
      deductedBase,
      remainingBase: subtractBase(stkBase.value, ingBase.value),
      deductedLabel: formatBaseValue(deductedBase, dim),
      stockItemId: picked.id,
    });
  }

  // Apply to stock atomically. Summed per stock item: several recipes logged
  // together can legitimately draw on the same item.
  const combinedByItemId = sumDeductionsByStockId(combinedDeductions);
  const newStock = cur.stock.map((it) => {
    const deductedBase = combinedByItemId.get(it.id);
    if (deductedBase === undefined) return it;
    const stkBase = toBaseUnit(it.quantity, it.unit);
    if (!stkBase) return it;
    return {
      ...it,
      quantity: baseToDisplay(stkBase.value - deductedBase, it.unit),
      updatedAt: Date.now(),
    };
  });

  const deductedIds = new Set(combinedByItemId.keys());
  const finalStock = newStock.filter((it) => !deductedIds.has(it.id) || it.quantity > 0);

  const description = recipes.map((r) => r.name).join(' + ');
  const mealLog: MealLog = {
    id: uid('meal'),
    // Use the first recipe's mealType as the default category.
    mealType: recipes[0].mealType,
    description,
    createdAt: Date.now(),
    notes: input.notes?.trim() || undefined,
    servings: input.peopleCooked,
  };

  setState((s) => ({
    ...s,
    app: {
      ...s.app,
      stock: finalStock,
      mealLogs: [mealLog, ...s.app.mealLogs],
    },
  }));

  const used = combinedDeductions.length;
  const skipped = skippedNames.length;
  if (used === 0 && skipped > 0) {
    pushToast(`Logged ${description}, but no ingredients matched your fridge`, 'info');
  } else if (skipped === 0) {
    pushToast(`Logged ${description} · ${used} ingredient${used === 1 ? '' : 's'} deducted`, 'success');
  } else {
    pushToast(`Logged ${description} · ${used} used, ${skipped} not in fridge`, 'warning');
  }

  return { log: mealLog, usedCount: used, skippedCount: skipped };
};

const clearAllData = () => {
  setState((s) => ({
    ...s,
    app: {
      grocery: [],
      stock: [],
      mealLogs: [],
      recipes: BUILT_IN_RECIPES,
      mealPlan: emptyMealPlan(),
      settings: {
        ...s.app.settings,
        hasSeenWelcome: false,
        userName: '',
        dietaryPreference: 'no-preference',
        allergies: [],
        expiringSoonDays: 3,
        theme: 'system',
        showChainHq: false,
        microphoneEnabled: false,
      },
    },
  }));
};

const toast: UseStore['toast'] = (message, kind, undo) => pushToast(message, kind, undo);

const setConsents: UseStore['setConsents'] = (patch) => {
  setState((s) => ({
    ...s,
    app: {
      ...s.app,
      settings: {
        ...s.app.settings,
        consents: {
          haptics: s.app.settings.consents?.haptics ?? true,
          notifications: s.app.settings.consents?.notifications ?? false,
          location: s.app.settings.consents?.location ?? false,
          personalization: s.app.settings.consents?.personalization ?? true,
          ...patch,
        },
      },
    },
  }));
};

const markConsentsSeen: UseStore['markConsentsSeen'] = () => {
  setState((s) => ({
    ...s,
    app: {
      ...s.app,
      settings: { ...s.app.settings, hasSeenConsents: true },
    },
  }));
};

/* -------------------------------------------------------------------------- */
/*  Hook — single subscription, stable action references                        */
/* -------------------------------------------------------------------------- */

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): InternalState {
  return getState();
}

// SSR fallback — module-stable frozen reference to avoid re-render loops.
const SERVER_SNAPSHOT: InternalState = Object.freeze({
  app: seedState(),
  toasts: [] as Toast[],
}) as InternalState;

function getServerSnapshot(): InternalState {
  return SERVER_SNAPSHOT;
}

export function useStore(): UseStore {
  // Ensure lazy initialization of the singleton.
  ensureState();
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    ...snap.app,
    addGrocery,
    toggleGroceryPurchased,
    removeGrocery,
    clearPurchasedGrocery,
    updateGrocery,
    addStock,
    updateStock,
    incrementStock,
    removeStock,
    updateSettings,
    clearAllData,
    addMealLog,
    removeMealLog,
    logMealFromRecipe,
    logMealFromRecipes,
    addCustomRecipe,
    removeRecipe,
    mealPlan: currentMealPlan(),
    setMealPlanSlot,
    clearMealPlanDay,
    copyMealPlanDay,
    clearMealPlan,
    completeHouseholdSurvey,
    toasts: snap.toasts,
    toast,
    dismissToast,
    setConsents,
    markConsentsSeen,
  };
}