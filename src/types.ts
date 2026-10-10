export type CategoryId =
  | 'vegetables'
  | 'fruits'
  | 'dairy'
  | 'meat'
  | 'seafood'
  | 'bakery'
  | 'grains'
  | 'beverages'
  | 'snacks'
  | 'frozen'
  | 'condiments'
  | 'household'
  | 'other';

export type DietaryPreference =
  | 'vegetarian'
  | 'non-vegetarian'
  | 'vegan'
  | 'no-preference';

export interface Category {
  id: CategoryId;
  label: string;
  emoji: string;
  color: string; // tailwind classes for bg/text
  ring: string;
  /** Which dietary preferences this category is compatible with. */
  compatibleDiets: DietaryPreference[];
}

export interface GroceryItem {
  id: string;
  name: string;
  quantity: string; // free text "2 packets", "1 kg", "1 dozen"
  category: CategoryId;
  purchased: boolean;
  createdAt: number;
  purchasedAt?: number;
  /** optional link to a stock item that this was sourced from (for traceability) */
  fromStockId?: string;
}

export type StockLocation = 'fridge' | 'pantry';

export interface StockItem {
  id: string;
  name: string;
  quantity: number;
  unit: string; // e.g. "packets", "kg", "pcs", "L", "dozen"
  category: CategoryId;
  /** Where the item is stored. Defaults to 'fridge' for older items. */
  location?: StockLocation;
  expiryDate?: string; // ISO yyyy-mm-dd
  notes?: string;
  lowStockThreshold: number; // when quantity <= threshold → low
  createdAt: number;
  updatedAt: number;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export interface UserConsents {
  /** Subtle vibration on add/remove/delete actions. */
  haptics: boolean;
  /** Push-style browser notifications (expiry alerts, low-stock). */
  notifications: boolean;
  /** Geolocation for nearby stores / delivery suggestions. */
  location: boolean;
  /** Smart suggestions based on what the user typically cooks/buys. */
  personalization: boolean;
}

export interface AppSettings {
  expiringSoonDays: number; // days threshold for "expiring soon"
  hasSeenWelcome: boolean;
  /** User's first name captured at first launch — used for friendly greetings. */
  userName: string;
  /** Whole-household dietary preference. */
  dietaryPreference: DietaryPreference;
  /** Free-form list of allergens to avoid. */
  allergies: string[];
  /** UI theme preference. */
  theme: ThemeMode;
  /** Whether the consent/permissions modal has been shown. */
  hasSeenConsents?: boolean;
  /** Per-permission opt-in flags. Defaults applied at first show. */
  consents?: UserConsents;
  /** Show the curated chain-HQ list on the Stores page. Opt-in — off by
   * default because the HQ data is approximate. */
  showChainHq?: boolean;
  /** Who eats at home. Drives the default portion size for planned recipes.
   *  Optional so saves written before this existed still load. */
  household?: HouseholdProfile;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'sweet';

export interface MealLog {
  id: string;
  mealType: MealType;
  /** Free-text: "Palak paneer with 2 rotis", "Maggi", etc. */
  description: string;
  createdAt: number;
  notes?: string;
  /** When logged from a recipe, the recipe id that was used. */
  recipeId?: string;
  /** How many servings this meal was sized for. */
  servings?: number;
  /**
   * Did the user actually enjoy it? This is the ONLY honest training signal
   * the taste model has — cooking a dish says nothing about liking it (you
   * cook leftovers, you cook for guests). Undefined means "not rated".
   */
  liked?: boolean;
}

export interface RecipeIngredient {
  /** Display name, matched case-insensitively against stock names. */
  name: string;
  /** Quantity per recipe (sized for `baseServings`). */
  quantity: number;
  /** Free-text unit: "g", "kg", "ml", "L", "pcs", "dozen". */
  unit: string;
  category: CategoryId;
}

export interface Recipe {
  id: string;
  name: string;
  emoji: string;
  /** Default meal type this recipe belongs to (used for meal-type tab pre-select). */
  mealType: MealType;
  /** How many people this recipe is sized for by default. */
  baseServings: number;
  ingredients: RecipeIngredient[];
  /** True for built-in recipes (cannot be edited/deleted from the UI). */
  builtIn?: boolean;
}

/** Monday-first day keys for the weekly meal plan. */
export type MealPlanDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** The three meals the planner asks about each day. */
export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

/**
 * Who eats at home. Portions are sized from this: each person contributes an
 * "adult equivalent", so a toddler counts for far less than an adult and the
 * survey answers directly affect how much the shopping list buys.
 */
export interface HouseholdProfile {
  adults: number;
  /** 1–3 years. Eats roughly 0.4 of an adult portion. */
  toddlers: number;
  /** 4–11 years. Roughly 0.6 of an adult portion. */
  children: number;
  /** 12–17 years. Roughly 0.9 of an adult portion. */
  teens: number;
  /** Set once the survey has been completed, so it only nags on first run. */
  completed?: boolean;
}

/** The five portion sizes offered per recipe. */
export type PortionId = 'small' | 'medium' | 'large' | 'family' | 'big';

export interface PortionLevel {
  id: PortionId;
  label: string;
  /** Servings this size cooks. Multiplied against the recipe's baseServings. */
  servings: number;
  blurb: string;
}

/** One planned dish in one meal slot. The user may pick it from the recipe
 *  catalogue or just type a dish by hand, so `recipeId` is optional and
 *  `name` is authoritative. */
export interface MealPlanEntry {
  /** Free-text dish name — always present, even for a hand-typed dish. */
  name: string;
  /** Set when the dish was picked from the recipe catalogue. Only then can
   *  the shopping list work out the ingredients. */
  recipeId?: string;
  slot: MealSlot;
  emoji?: string;
  /** How many people this is cooked for. */
  servings: number;
  createdAt: number;
}

/** One day's three slots. A null slot means "not planned yet". */
export type MealPlanDayPlan = Record<MealSlot, MealPlanEntry | null>;

/** A full week. */
export type MealPlan = Record<MealPlanDay, MealPlanDayPlan>;

/** One line on the generated shopping list. */
export interface ShoppingNeed {
  /** Display name, e.g. "Tomato". */
  name: string;
  category: CategoryId;
  /** Total needed across the week, already scaled by portion size. */
  needed: number;
  unit: string;
  /** Best-matching stock item, if the kitchen already has this. */
  inStock: boolean;
  stockItemId?: string;
  /** How much of it is in the fridge right now, in `unit`. */
  have?: number;
  /** True when the fridge covers the week's need, so nothing to buy. */
  covered: boolean;
}

export interface AppState {
  grocery: GroceryItem[];
  stock: StockItem[];
  mealLogs: MealLog[];
  recipes: Recipe[];
  settings: AppSettings;
  /** Weekly meal plan. Optional so saves written before this feature existed
   *  still load cleanly. */
  mealPlan?: MealPlan;
}
