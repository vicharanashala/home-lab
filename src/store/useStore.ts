import { useSyncExternalStore } from 'react';
import type {
  AppSettings,
  AppState,
  CategoryId,
  DayModeId,
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
import { findCandidatesForIngredient, planRecipeDeduction, resolveToCommonDimension } from '../utils/recipeMatch';
import { formatBaseValue, subtractBase, toBaseUnit, unitDimension } from '../utils/units';
import { MEAL_SLOTS, rescaledServings, suggestedServingsForDay } from '../utils/portions';
import { DEFAULT_CONSENTS } from '../utils/consent';
import { saveAppState, STORAGE_KEY, IMPORT_NOT_SAVED_MESSAGE } from '../utils/appStorage';

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
      parsed.settings.consents = {
        ...DEFAULT_CONSENTS,
        ...(parsed.settings.consents ?? {}),
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

/**
 * Write the app's state to the browser's storage, and say whether it landed.
 *
 * WHY THE ACCESS IS INSIDE THE TRY: a browser with storage blocked throws
 * when the app READS `window.localStorage`, not only when it writes to it,
 * so reading it can fail the same way writing it can.
 *
 * WHY IT REPORTS: the old code caught the error and said nothing, so a change
 * the browser refused was a change the app showed and then forgot. See
 * `appStorage`.
 */
const saveToStorage = (state: AppState): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    return saveAppState(state, window.localStorage);
  } catch {
    return false;
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

/** What an import actually brought in, so the UI can report it honestly. */
export interface ImportSummary {
  grocery: number;
  stock: number;
  mealLogs: number;
  recipes: number;
}

/** Bumped when the backup format changes, so an old file is rejected loudly. */
export const BACKUP_VERSION = 1;

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
  /**
   * Wipes grocery + stock and resets onboarding. Atomic — survives StrictMode.
   *
   * WHY IT REPORTS WHETHER THE CLEARING WAS STORED: the screen follows this
   * with a reload, and a reload brings back whatever was in storage. A
   * clearing the browser refused would be announced as "App data cleared" and
   * then undone by the reload itself, with nothing said in between.
   *
   * WHY A REFUSED CLEARING IS UNDONE RATHER THAN LEFT ON SCREEN: the
   * household is still in the browser, so an empty app over it is a lie the
   * next write turns permanent. When the browser refuses, the household is
   * put back and the caller is told the clearing did not happen.
   *
   * @returns whether the clearing was written to storage
   */
  clearAllData: () => boolean;
  /**
   * Replaces the user's data from an exported backup file.
   *
   * This is the only way data crosses between two browser origins. Storage is
   * per-origin, so the same app reached at a Tailscale hostname and at
   * localhost holds two completely separate copies — with no way for one to
   * read the other. An export/import pair is what makes that survivable, and
   * it is also the only backup of a household's data that exists at all.
   */
  importAppData: (raw: string) => { ok: true; counts: ImportSummary } | { ok: false; error: string };
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
    /** The meal slot the user picked. Defaults to the recipe's own type. */
    mealType?: MealType;
    /**
     * Resolved recipes, for entries that are not in the store's own list
     * (the CSV catalogue). When given, these are used for the ingredients.
     */
    recipes?: Recipe[];
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
  /**
   * How one day of the week is eaten — a vrat, a day without onion, and so
   * on. 'normal' means the household's usual diet applies.
   */
  setDayMode: (day: MealPlanDay, mode: DayModeId) => void;
  /**
   * Extra people at the table on one day. Every portion already planned for
   * that day scales with it, so the shopping list stays right.
   */
  setDayGuests: (day: MealPlanDay, guests: number) => void;
  /** A name for the day, e.g. "Diwali". */
  setDayNote: (day: MealPlanDay, note: string) => void;
  /** Record the household's composition (adults + kids by age). */
  completeHouseholdSurvey: (household: HouseholdProfile) => void;
  /**
   * Whether the app could not write its last change to storage.
   *
   * WHY IT IS ON THE INTERFACE AND NOT ONLY IN THE STORE: a change the
   * browser refused is a change the app is showing and will forget, and the
   * user is the one who has to know that. See `appStorage`.
   */
  storageFailed: boolean;
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
  /**
   * Whether the app could not write its last change to storage.
   *
   * WHY IT IS PART OF THE STATE AND NOT A MODULE FLAG: the user has to be
   * told, and the telling is a piece of the interface — the banner is drawn
   * from this, so what the user reads and what the app knows are the same
   * thing by construction.
   */
  storageFailed: boolean;
}

let state: InternalState | null = null;
const listeners = new Set<() => void>();

function ensureState(): InternalState {
  if (state) return state;
  const initial: InternalState = {
    app: loadFromStorage() ?? seedState(),
    toasts: [],
    storageFailed: false,
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
    const saved = saveToStorage(next.app);
    // WHY THE FAILED WRITE IS CARRIED IN THE STATE: a change the browser
    // refused to store is a change the app is showing and will forget, and
    // the user is the one who has to know that. The flag is what the banner
    // is drawn from, so it clears the moment a write works again.
    //
    // WHY IT IS NOT SET ON EVERY CHANGE: the flag only changes when the
    // answer does, so a change that is saved and a change that is not do not
    // churn the state — and a state change here would itself be a change.
    const nowFailed = !saved;
    if (nowFailed !== cur.storageFailed) {
      setState((s) => ({ ...s, storageFailed: nowFailed }));
    }
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
  setState((s) => {
    const settings = { ...s.app.settings, ...patch };
    // A household change moves the dishes already on the plan, so the
    // shopping list keeps up with the people who are actually eating.
    // See `rescalePlanForHousehold` in the meal plan section.
    const rescaled =
      patch.household === undefined
        ? null
        : rescalePlanForHousehold(
            currentMealPlan(),
            s.app.settings.household,
            patch.household,
          );
    const app = { ...s.app, settings };
    // The plan is only replaced when a dish actually moved — otherwise the
    // stored plan keeps its identity and nothing downstream re-renders.
    if (rescaled) app.mealPlan = rescaled;
    return { ...s, app };
  });
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

/**
 * Whether the app could not write its last change.
 *
 * WHY IT IS READ LIVE AND NOT FROM THE SNAPSHOT: the banner has to say what
 * is true NOW. A snapshot is what the last render saw, and a failure that
 * happened after that render would not be in it — so the screen would keep
 * saying everything is fine while nothing is being saved.
 *
 * WHY THE MEAL PLAN IS READ THE SAME WAY: see `currentMealPlan`.
 */
const currentStorageFailed = (): boolean => getState().storageFailed;

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
  setState((s) => {
    const plan = currentMealPlan();
    const cur = plan[day];
    // Clearing a day's meals must not silently un-do a vrat or a guest list —
    // the day is still a vrat day, there just aren't any dishes on it yet.
    const next: MealPlanDayPlan = {
      ...emptyDayPlan(),
      ...(cur ? { mode: cur.mode, guests: cur.guests, note: cur.note } : {}),
    };
    return { ...s, app: { ...s.app, mealPlan: { ...plan, [day]: next } } };
  });
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
    // The target day keeps its own way of eating and guest count — copying
    // Monday's dinners onto a vrat day must not quietly turn it into an
    // ordinary day. Any dish that breaks the mode is flagged in the UI.
    const target = plan[to];
    // The dishes are sized for the TARGET day, not for the day they came
    // from.
    //
    // WHY NOT THE SOURCE DAY'S PORTION: the copy keeps the target day's own
    // guest count, so the two halves of the target day disagreed — the day
    // saying "six people over, cook for six" while the dish it now held said
    // four. The shopping list is built from the servings on each dish, so it
    // bought for four. Two adults and three children with two guests over on
    // Saturday: the day eats 6 servings, Monday's dinner is written for 4,
    // and the copy wrote 4 onto Saturday.
    //
    // This is the rule every other way of putting a dish on a day already
    // uses — the portion the day wants, the number the meal-plan header
    // prints and the guest scaling applies — so the copy is now the same
    // number as the picker, the suggestion sheet and the spoken plan. The
    // user can still open a copied dish and choose another size.
    const dayServings = suggestedServingsForDay(target, s.app.settings.household);
    for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
      const e = src[slot];
      if (e) cloned[slot] = { ...e, servings: dayServings, createdAt: Date.now() };
    }
    cloned.mode = target?.mode;
    cloned.guests = target?.guests;
    cloned.note = target?.note;
    return { ...s, app: { ...s.app, mealPlan: { ...plan, [to]: cloned } } };
  });
};

/** Marks the one-run household survey as done so it stops nagging. */
const completeHouseholdSurvey: UseStore['completeHouseholdSurvey'] = (household) => {
  setState((s) => {
    // The dishes already on the plan move with the household, so the
    // shopping list keeps up with the people who are actually eating.
    const rescaled = rescalePlanForHousehold(
      currentMealPlan(),
      s.app.settings.household,
      household,
    );
    const app = {
      ...s.app,
      settings: { ...s.app.settings, household: { ...household, completed: true } },
    };
    if (rescaled) app.mealPlan = rescaled;
    return { ...s, app };
  });
};

const clearMealPlan = () => {
  setState((s) => ({ ...s, app: { ...s.app, mealPlan: emptyMealPlan() } }));
};

/* ── per-day settings: mode, guests, note ───────────────────────────────── */

const setDayMode: UseStore['setDayMode'] = (day, mode) => {
  setState((s) => {
    const plan = currentMealPlan();
    return {
      ...s,
      app: {
        ...s.app,
        mealPlan: { ...plan, [day]: { ...emptyDayPlan(), ...plan[day], mode } },
      },
    };
  });
};

const setDayGuests: UseStore['setDayGuests'] = (day, guests) => {
  const next = Math.max(0, Math.min(20, Math.round(guests || 0)));
  setState((s) => {
    const plan = currentMealPlan();
    const cur = plan[day];
    const oldGuests = Math.max(0, cur?.guests ?? 0);
    if (oldGuests === next) return s;

    // Move the portions already planned for that day up with the day itself.
    // Without this, adding two guests would leave the shopping list short by
    // exactly those two people's worth of food.
    //
    // The dish keeps its PLACE on the portion ladder and the day carries it up
    // the same number of steps. It used to be scaled by the RATIO between the
    // day's old size and its new one, which works only while the dish IS the
    // day's size — the common case, and the only one the tests covered. A
    // dish deliberately planned at a different size drifted further with every
    // step: a 9-serving dinner became 14, then 21, then 27 servings, and the
    // shopping list bought five times the food the day needs.
    const household = s.app.settings.household;
    const before = suggestedServingsForDay(cur, household);
    const after = suggestedServingsForDay({ ...emptyDayPlan(), ...cur, guests: next }, household);

    const day2: MealPlanDayPlan = { ...emptyDayPlan(), ...cur, guests: next };
    for (const slot of MEAL_SLOTS) {
      const entry = day2[slot];
      if (entry) {
        day2[slot] = { ...entry, servings: rescaledServings(entry.servings, before, after) };
      }
    }
    return { ...s, app: { ...s.app, mealPlan: { ...plan, [day]: day2 } } };
  });
};

/**
 * Move the dishes already on the plan when the HOUSEHOLD changes.
 *
 * WHY THIS HAS TO HAPPEN
 * A day's portion is worked out from the household — how many people live
 * there and how much each of them eats — so a household that grows makes
 * every day want a bigger portion. The dishes already on the plan kept the
 * size they were given, so the meal-plan card said "cooking for 4 today
 * (4pax)" while the dish beside it said 2pax, and the shopping list — which
 * is built from the servings on each dish — bought for two people.
 *
 * The guest count was already handled this way; see `setDayGuests`. A change
 * to the household itself is the same situation with a different cause.
 *
 * Each dish keeps its PLACE on the portion ladder and moves by the same
 * number of steps as the day, so a dish deliberately planned at a different
 * size from the day stays that way.
 *
 * Returns null when no day changed size: nothing needs to move, and the
 * stored plan is left exactly as it is.
 */
const rescalePlanForHousehold = (
  plan: MealPlan,
  from: HouseholdProfile | undefined,
  to: HouseholdProfile | undefined,
): MealPlan | null => {
  let out: MealPlan | null = null;
  for (const day of MEAL_PLAN_DAYS) {
    const dayPlan = plan[day];
    if (!dayPlan) continue;
    const before = suggestedServingsForDay(dayPlan, from);
    const after = suggestedServingsForDay(dayPlan, to);
    // The day's own size did not move, so neither do its dishes — and a dish
    // the user gave a size that is not on the ladder keeps it.
    if (before === after) continue;
    const moved: MealPlanDayPlan = { ...dayPlan };
    for (const slot of MEAL_SLOTS) {
      const entry = moved[slot];
      if (entry) {
        moved[slot] = { ...entry, servings: rescaledServings(entry.servings, before, after) };
      }
    }
    if (!out) out = { ...plan };
    out[day] = moved;
  }
  return out;
};

const setDayNote: UseStore['setDayNote'] = (day, note) => {
  const clean = (note || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  setState((s) => {
    const plan = currentMealPlan();
    return {
      ...s,
      app: {
        ...s.app,
        mealPlan: { ...plan, [day]: { ...emptyDayPlan(), ...plan[day], note: clean } },
      },
    };
  });
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
  // Derive the factor from the SAME table the rest of the app uses. The old
  // hand-written list only knew g/kg/ml/L/pcs/dozen, so a stock row measured
  // in tbsp, oz or litres was divided by 1 and came back as an absurd number:
  // 10 tbsp minus a 2 tbsp recipe wrote back "120 tbsp".
  const factor = toBaseUnit(1, unit)?.value ?? 1;
  if (!Number.isFinite(factor) || factor === 0) return Math.max(0, remainingBase);
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
    // Resolve both sides the SAME way the preview did, so the number the
    // user was shown is the number that gets applied. The old code took a
    // bare min() across two base values that could be in different
    // dimensions — a "1 cup" ingredient was compared against a gram stock as
    // if 240 ml were 240 g.
    const common = resolveToCommonDimension(
      d.ingredient.quantity * plan.multiplier,
      d.ingredient.unit,
      d.ingredient.name,
      picked.quantity,
      picked.unit,
    );
    if (!common) return d;
    const deductedBase = Math.min(common.ingValue, common.stkValue);
    return {
      ...d,
      stockItem: picked,
      deductedBase,
      remainingBase: subtractBase(common.stkValue, common.ingValue),
      deductedLabel: formatBaseValue(deductedBase, common.dimension),
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
  // Callers may hand us the resolved recipes (the CSV catalogue is not in the
  // store's own list). Fall back to the store's recipes by id.
  const resolved = input.recipes?.length
    ? input.recipes
    : cur.recipes.filter((r) => input.recipeIds.includes(r.id));
  const recipes = input.recipeIds
    .map((id) => resolved.find((r) => r.id === id) ?? cur.recipes.find((r) => r.id === id))
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
    // Same dimension resolution as the single-recipe path. Comparing a
    // gram-denominated stock against a "1 cup" ingredient as if 240 ml were
    // 240 g over-deducted the flour and DELETED the row when the correct
    // deduction would have left some behind.
    const common = resolveToCommonDimension(ing.quantity, ing.unit, ing.name, picked.quantity, picked.unit);
    if (!common) {
      skippedNames.push(`${ing.name} (unit mismatch)`);
      continue;
    }
    const deductedBase = Math.min(common.ingValue, common.stkValue);
    combinedDeductions.push({
      name: ing.name,
      quantity: ing.quantity,
      unit: ing.unit,
      deductedBase,
      remainingBase: subtractBase(common.stkValue, common.ingValue),
      deductedLabel: formatBaseValue(deductedBase, common.dimension),
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
    // The meal the user picked wins. The End-of-day picker shows every
    // recipe regardless of type, so logging "Breakfast" with a snack recipe
    // used to file the log as a snack while the toast said "Breakfast
    // logged" — and the card then still looked unlogged.
    mealType: input.mealType ?? recipes[0].mealType,
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

const clearAllData = (): boolean => {
  // WHY THE HOUSEHOLD IS HELD BACK UNTIL THE BROWSER TAKES IT: clearing is a
  // request to the browser, and until the browser has taken it the household
  // is still there. An empty screen over a browser that still holds the data
  // is the worst of the two — the user is told the reset failed while the
  // screen says it worked, and the next write that DOES get through stores
  // that empty screen and takes the household with it.
  const before = getState().app;
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
  // WHY THE ANSWER IS READ AND NOT ASSUMED: `setState` has just asked the
  // storage and recorded what it said, so reading it here is the same
  // measurement rather than a second guess.
  if (currentStorageFailed()) {
    // The browser refused the clearing, so the clearing did not happen. Put
    // the household back: the screen then agrees with the message the user
    // reads, and the next write that gets through stores the household and
    // not the wipe. Rolling back here is also what keeps the refusal
    // harmless — an empty app left on screen would be written out in full by
    // the very next change the user made.
    setState((s) => ({ ...s, app: before }));
    return false;
  }
  return true;
};

const toast: UseStore['toast'] = (message, kind, undo) => pushToast(message, kind, undo);

/* -------------------------------------------------------------------------- */
/*  Backup: export / import                                                  */
/* -------------------------------------------------------------------------- */

/** Shape written by the Download button. */
export interface BackupFile {
  app: string;
  version: number;
  exportedAt: string;
  data: Pick<AppState, 'grocery' | 'stock' | 'mealLogs' | 'recipes' | 'mealPlan' | 'settings'>;
}

/** The whole backup as a downloadable string. */
export const exportAppData = (): string => {
  const app = getState().app;
  const file: BackupFile = {
    app: 'homehub',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      grocery: app.grocery,
      stock: app.stock,
      mealLogs: app.mealLogs,
      recipes: app.recipes,
      mealPlan: app.mealPlan,
      settings: app.settings,
    },
  };
  return JSON.stringify(file, null, 2);
};

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const importAppData: UseStore['importAppData'] = (raw) => {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That file isn't valid JSON — it may not be a HomeHub backup." };
  }

  const data = parsed?.data;
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'No HomeHub data found in that file.' };
  }
  if (parsed.app !== 'homehub') {
    return { ok: false, error: "That file wasn't exported by HomeHub." };
  }
  if (typeof parsed.version !== 'number') {
    return { ok: false, error: 'That file has no version number — it may not be a HomeHub backup.' };
  }
  if (parsed.version > BACKUP_VERSION) {
    return {
      ok: false,
      error: `That backup is from a newer version of HomeHub (v${parsed.version}). Update the app first.`,
    };
  }
  if (parsed.version < BACKUP_VERSION) {
    return {
      ok: false,
      error: `That backup is from an older version of HomeHub (v${parsed.version}). It can't be restored safely.`,
    };
  }

  // Every section must actually be there. A file that parses, says
  // "homehub" and is version 1 but has no `grocery` key used to import an
  // EMPTY grocery list over the live one — silently, with a success message.
  const missing = (['grocery', 'stock', 'mealLogs', 'settings'] as const).filter(
    (k) => !(k in (data as object)),
  );
  if (missing.length) {
    return {
      ok: false,
      error: `That backup is missing its ${missing.join(' and ')} — it looks incomplete, so nothing was changed.`,
    };
  }

  // Keep the built-in recipe set as a floor: a backup with no recipes would
  // otherwise leave the Log-a-meal picker empty on a fresh install.
  const imported: Recipe[] = arr<Recipe>(data.recipes);
  const recipes = imported.length ? imported : BUILT_IN_RECIPES;

  const grocery = arr<GroceryItem>(data.grocery);
  const stock = arr<StockItem>(data.stock);
  const mealLogs = arr<MealLog>(data.mealLogs);
  const settings = (data.settings && typeof data.settings === 'object'
    ? data.settings
    : {}) as AppSettings;

  // Onboarding and consent state belong to THIS browser, not to the file.
  // Spreading the imported settings over the local ones used to carry
  // another device's `hasSeenConsents`, `consents.microphone` and
  // `microphoneEnabled` with it — so a device that had never been asked for
  // the microphone inherited a granted one and never showed the consent
  // sheet. The Settings card promises "Your onboarding choices and
  // permissions stay as they are on this device" — now it is true.
  const {
    hasSeenWelcome: _ignoredWelcome,
    hasSeenConsents: _ignoredConsents,
    consents: _ignoredConsentChoices,
    microphoneEnabled: _ignoredMic,
    ...portableSettings
  } = settings;

  // WHY THE HOUSEHOLD IS HELD BACK UNTIL THE BROWSER TAKES IT: the import
  // replaces the household with the file's contents, and until the browser
  // has taken it the household is still there. An imported screen over a
  // browser that still holds the old data is the worst of the two — the user
  // is told the import did not happen while the screen says it did, and the
  // next write that DOES get through stores that imported screen in full and
  // takes the household's grocery list and fridge with it, for good. This is
  // the same hole the clearing had, and the clearing was closed a commit ago
  // (a0afabd) — the import was left behind.
  const before = getState().app;

  setState((s) => ({
    ...s,
    app: {
      grocery,
      stock,
      mealLogs,
      recipes,
      mealPlan: (data.mealPlan as AppState['mealPlan']) ?? emptyMealPlan(),
      settings: { ...s.app.settings, ...portableSettings },
    },
  }));

  // WHY THE WRITE IS CHECKED HERE AND NOT LEFT TO THE CALLER: the answer this
  // function returns IS what the screen turns into "Restored 12 grocery, 5 in
  // the fridge" — a success message with the counts in it. A write the
  // browser refused would have made that message a lie: the imported data
  // would be in the app until the tab closed and gone after that, while the
  // screen said the household's data had been restored.
  //
  // WHY IT READS THE FLAG `setState` ALREADY SET: the write has just been
  // made and the answer recorded, so this is the same measurement read once
  // more, not a second attempt that could disagree with the first.
  if (currentStorageFailed()) {
    // The browser refused the write, so the import did not happen. Put the
    // household back: the screen then agrees with the message the user
    // reads, and the next write that gets through stores the household and
    // not the file. Rolling back here is also what keeps the refusal
    // harmless — an imported screen left in place would be written out in
    // full by the very next change the user made.
    setState((s) => ({ ...s, app: before }));
    return {
      ok: false,
      error: IMPORT_NOT_SAVED_MESSAGE,
    };
  }

  return {
    ok: true,
    counts: {
      grocery: grocery.length,
      stock: stock.length,
      mealLogs: mealLogs.length,
      recipes: recipes.length,
    },
  };
};

const setConsents: UseStore['setConsents'] = (patch) => {
  setState((s) => ({
    ...s,
    app: {
      ...s.app,
      settings: {
        ...s.app.settings,
        // Merge over the STORED object, not a hand-written list of defaults.
        // The old literal had four keys and no `microphone`, so toggling any
        // other permission silently deleted a granted microphone — the
        // Permissions list then said OFF while the mic was live.
        consents: {
          ...DEFAULT_CONSENTS,
          ...s.app.settings.consents,
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
  storageFailed: false,
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
    importAppData,
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
    setDayMode,
    setDayGuests,
    setDayNote,
    completeHouseholdSurvey,
    storageFailed: currentStorageFailed(),
    toasts: snap.toasts,
    toast,
    dismissToast,
    setConsents,
    markConsentsSeen,
  };
}