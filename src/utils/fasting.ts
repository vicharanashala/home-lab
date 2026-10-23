/**
 * Fasting and feast rules.
 *
 * An Indian household keeps days that are not normal days: a vrat for
 * Navratri or Ekadashi, a no-meat day, a birthday with six extra people at
 * the table. The app's global dietary preference cannot express any of that —
 * it is a single value applied to every day of every week.
 *
 * This module turns "what kind of day is it?" into "which dishes can be
 * cooked?".
 *
 * ── Why the rules match on NAMES, not categories ──────────────────────────
 *
 * The catalogue holds 5,894 CSV recipes whose ingredients carry only a name,
 * a quantity and a unit — no `category` field at all. A category-based diet
 * filter therefore treats every one of those ingredients as `other`, which is
 * compatible with every diet, which means "Chicken Biryani" quietly passes a
 * vegetarian day. Names are all we have for most of the catalogue, and names
 * are what a person recognises anyway: "has onion" says far more than
 * "category mismatch".
 *
 * The keyword lists below were built by counting the actual ingredient names
 * in `src/data/csvRecipes.json` (10,925 distinct names), not from memory.
 *
 * ── Matching is deliberately word-bounded ──────────────────────────────────
 *
 * `\begg\b` matches "Whole Eggs" but not "Eggless Mayonnaise"; `\bmeat\b`
 * matches "meatballs" but not "meatless". Words like "eggplant" and
 * "spring onion" are handled explicitly rather than by accident.
 */

import type { DayMode, MealPlanDay, Occasion, Recipe } from '../types';

/* -------------------------------------------------------------------------- */
/*  Modes                                                                       */
/* -------------------------------------------------------------------------- */

export interface ModeInfo {
  id: DayMode;
  /** Full label, used in the picker. */
  label: string;
  /** Short label, used on the day chip where space is tight. */
  short: string;
  emoji: string;
  /** One line explaining exactly what this mode rules out. */
  blurb: string;
  /** Tailwind classes for the chip on the day row. */
  chip: string;
  /** Tailwind classes for the chip when it is the active selection. */
  chipActive: string;
}

export const DAY_MODE_LIST: ModeInfo[] = [
  {
    id: 'normal',
    label: 'Normal day',
    short: 'Normal',
    emoji: '🍽️',
    blurb: "No extra rules — just your household's usual diet.",
    chip: 'bg-sage-100 text-sage-700 dark:bg-ink-700 dark:text-sage-200',
    chipActive: 'bg-sage-700 text-white dark:bg-sage-600',
  },
  {
    id: 'vegetarian',
    label: 'Vegetarian day',
    short: 'Veg',
    emoji: '🥗',
    blurb: 'No meat, fish or egg.',
    chip: 'bg-sage-100 text-sage-700 dark:bg-ink-700 dark:text-sage-200',
    chipActive: 'bg-sage-700 text-white dark:bg-sage-600',
  },
  {
    id: 'vrat',
    label: 'Vrat — no onion, garlic or dal',
    short: 'Vrat',
    emoji: '🪔',
    blurb: 'A fasting day: no onion, no garlic, no dal or beans, no meat.',
    chip: 'bg-butter-100 text-butter-800 dark:bg-butter-900/50 dark:text-butter-200',
    chipActive: 'bg-butter-600 text-white dark:bg-butter-600',
  },
  {
    id: 'fast',
    label: 'Full fast — upvas',
    short: 'Upvas',
    emoji: '✨',
    blurb: 'Everything a vrat rules out, plus no rice or wheat and no dairy.',
    chip: 'bg-tomato-100 text-tomato-700 dark:bg-tomato-900/40 dark:text-tomato-200',
    chipActive: 'bg-tomato-600 text-white dark:bg-tomato-600',
  },
];

const MODE_BY_ID = new Map(DAY_MODE_LIST.map((m) => [m.id, m]));

/** Metadata for a mode. Unknown ids fall back to `normal` rather than throwing. */
export function modeInfo(mode?: DayMode | null): ModeInfo {
  if (!mode) return MODE_BY_ID.get('normal')!;
  return MODE_BY_ID.get(mode) ?? MODE_BY_ID.get('normal')!;
}

/* -------------------------------------------------------------------------- */
/*  Ingredient rules                                                            */
/* -------------------------------------------------------------------------- */

interface Rule {
  /** Stable key, also used as the blocker label. */
  key: string;
  /** What we tell the user this dish contains. */
  label: string;
  pattern: RegExp;
}

/**
 * Words that are allowed even though they contain a blocked word. Each one is
 * a real exception that shows up in the catalogue, not a guess:
 *
 *  - "spring onion" is the green leaf, not the bulb, and most households
 *    keep it during a vrat.
 *  - "coconut milk" and "coconut cream" are the standard fasting alternative
 *    to dairy.
 *  - "eggless mayonnaise" and "meatless" are the point of the word.
 */
const ALWAYS_ALLOWED =
  /\b(spring onion|scallion|green onion|coconut milk|coconut cream|coconut water|eggless|meatless|soy milk|almond milk|oat milk|plant milk)\b/i;

const MEAT: Rule = {
  key: 'meat',
  label: 'meat or fish',
  // Indian fish names are included on purpose — the catalogue is full of
  // "Rohu", "Pomfret fish" and "Surmai".
  pattern:
    /\b(chicken|mutton|lamb|beef|pork|ham|bacon|sausage|fish|prawns?|shrimps?|crabs?|lobster|seafood|pomfret|rohu|surmai|snapper|tilapia|sardines?|mackerel|salmon|tuna|cod|kheema|mince)\b/i,
};

const EGG: Rule = {
  key: 'egg',
  label: 'egg',
  // `\b` on both sides: "Eggless Mayonnaise" and "Eggplant" are not eggs.
  pattern: /\beggs?\b/i,
};

const ONION: Rule = {
  key: 'onion',
  label: 'onion or garlic',
  pattern: /\b(onions?|garlic|shallots?)\b/i,
};

const DAL: Rule = {
  key: 'dal',
  label: 'dal or beans',
  // "Dalia" (broken wheat) and "gram flour" (besan) are deliberately NOT
  // caught — both are commonly eaten during a fast.
  pattern: /\b(dal|daal|rajma|chickpeas?|chana|urad|moong|masoor|lentils?|kulthi|cowpeas?|beans?)\b/i,
};

const GRAIN: Rule = {
  key: 'grain',
  label: 'rice or wheat',
  pattern:
    /\b(rice|wheat|flour|atta|maida|rava|sooji|semolina|bread|rotis?|chapatis?|parathas?|phulkas?|puris?|poha|vermicelli|pasta|noodles?|oats|barley|ragi|bajra|jowar|bhakri)\b/i,
};

const DAIRY: Rule = {
  key: 'dairy',
  label: 'dairy',
  pattern:
    /\b(milk|curd|yogur?ht|paneer|butter|ghee|cream|cheese|lassi|khoa|khoya|rabri|chaas|buttermilk|mascarpone)\b/i,
};

/** Which rules each mode enforces. Each mode adds to the one before it. */
const MODE_RULES: Record<DayMode, Rule[]> = {
  normal: [],
  vegetarian: [MEAT, EGG],
  vrat: [MEAT, EGG, ONION, DAL],
  fast: [MEAT, EGG, ONION, DAL, GRAIN, DAIRY],
};

/** Every mode's rules, for the "does this dish fit any fast day?" checks. */
export const STRICTEST_RULES: Rule[] = MODE_RULES.fast;

/* -------------------------------------------------------------------------- */
/*  Screening                                                                   */
/* -------------------------------------------------------------------------- */

export interface ScreenResult {
  /** True when the dish can be cooked on a day with this mode. */
  ok: boolean;
  /** Human-readable reasons it cannot — "onion or garlic", "dal or beans". */
  blockers: string[];
}

/**
 * Which rules does this one name break?
 *
 * Returns the rules that fired. An empty list means the name is fine.
 */
export function rulesBrokenBy(
  name: string,
  rules: Rule[],
): Rule[] {
  if (!name) return [];
  if (ALWAYS_ALLOWED.test(name)) return [];
  const out: Rule[] = [];
  for (const rule of rules) {
    if (rule.pattern.test(name)) out.push(rule);
  }
  return out;
}

/**
 * Can this dish be cooked on a day with this mode?
 *
 * The recipe's own name is checked as well as its ingredients, because the
 * catalogue's ingredient lists are sometimes incomplete — "Dal Makhani" has
 * to be caught by its name when the list only says "toor dal, tomato".
 */
export function screenRecipe(
  recipe: Pick<Recipe, 'name' | 'ingredients'> | null | undefined,
  mode: DayMode | undefined,
): ScreenResult {
  const rules = mode ? MODE_RULES[mode] : [];
  if (!rules.length) return { ok: true, blockers: [] };
  if (!recipe) return { ok: true, blockers: [] };

  const broken = new Map<string, string>();

  const note = (hit: Rule[]) => {
    for (const r of hit) broken.set(r.key, r.label);
  };

  note(rulesBrokenBy(recipe.name || '', rules));

  for (const ing of recipe.ingredients || []) {
    note(rulesBrokenBy(ing?.name || '', rules));
  }

  const blockers = [...broken.values()];
  return { ok: blockers.length === 0, blockers };
}

/** Shorthand for the common "does this dish fit this mode?" question. */
export function fitsMode(
  recipe: Pick<Recipe, 'name' | 'ingredients'> | null | undefined,
  mode: DayMode | undefined,
): boolean {
  return screenRecipe(recipe, mode).ok;
}

/**
 * A one-line reason a dish does not fit, for a badge on a planned dish.
 * "has onion or garlic" / "has dal or beans" / "has meat or fish".
 */
export function blockerSummary(recipe: { name: string; ingredients?: unknown[] }, mode?: DayMode): string | null {
  const result = screenRecipe(recipe as never, mode);
  if (result.ok || !result.blockers.length) return null;
  return `has ${result.blockers.join(', ')}`;
}

/* -------------------------------------------------------------------------- */
/*  Days, dates and occasions                                                   */
/* -------------------------------------------------------------------------- */

const DAY_INDEX: Record<MealPlanDay, number> = {
  mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
};

/** Local ISO date (yyyy-mm-dd) — local, not UTC, or the day shifts near midnight. */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The Monday of the week that contains `ref`. */
export function mondayOf(ref: Date): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d;
}

/**
 * The calendar date each weekday falls on, for the week containing `ref`.
 *
 * The meal plan is a repeating week, so occasions — which happen on dates —
 * can only line up with it through the week they belong to.
 */
export function weekDates(ref: Date = new Date()): Record<MealPlanDay, string> {
  const monday = mondayOf(ref);
  const out = {} as Record<MealPlanDay, string>;
  for (const day of Object.keys(DAY_INDEX) as MealPlanDay[]) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + DAY_INDEX[day]);
    out[day] = isoDate(d);
  }
  return out;
}

/** The weekday key for a date. */
export function weekdayOf(dateISO: string): MealPlanDay | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return (Object.keys(DAY_INDEX) as MealPlanDay[])[(d.getDay() + 6) % 7];
}

/** Is this a real calendar date? `2026-02-31` is not. */
export function isValidISODate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return (
    d.getFullYear() === Number(m[1]) &&
    d.getMonth() === Number(m[2]) - 1 &&
    d.getDate() === Number(m[3])
  );
}

/** Every occasion falling on this date. */
export function occasionsOn(
  occasions: Occasion[] | undefined,
  dateISO: string,
): Occasion[] {
  if (!occasions?.length) return [];
  return occasions.filter((o) => o?.date === dateISO);
}

/**
 * The mode a day actually runs on: the occasion's override if there is one,
 * otherwise the weekday's own mode.
 */
export function modeForDay(
  dayModes: Partial<Record<MealPlanDay, DayMode>> | undefined,
  day: MealPlanDay,
  occasion?: Occasion | null,
): DayMode {
  if (occasion?.mode) return occasion.mode;
  return dayModes?.[day] ?? 'normal';
}

/**
 * The mode a *date* runs on — used by the Dashboard, which thinks in dates
 * rather than weekdays.
 */
export function modeForDate(
  dayModes: Partial<Record<MealPlanDay, DayMode>> | undefined,
  occasions: Occasion[] | undefined,
  dateISO: string,
): DayMode {
  const day = weekdayOf(dateISO);
  if (!day) return 'normal';
  const occasion = occasionsOn(occasions, dateISO)[0];
  return modeForDay(dayModes, day, occasion);
}

/** Occasions from today onwards, soonest first. */
export function upcomingOccasions(
  occasions: Occasion[] | undefined,
  fromISO: string = isoDate(new Date()),
): Occasion[] {
  if (!occasions?.length) return [];
  return [...occasions]
    .filter((o) => o?.date && o.date >= fromISO)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** "Sat 8 Nov" — short and unambiguous, without pulling in a date library. */
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function formatOccasionDate(dateISO: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return dateISO;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return dateISO;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  return `${dow} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** How many days away an occasion is. Negative means it already passed. */
export function daysUntilOccasion(dateISO: string, from: Date = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return 0;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

/** "in 3 days" / "today" / "tomorrow" / "last week". */
export function occasionWhen(dateISO: string, from: Date = new Date()): string {
  const days = daysUntilOccasion(dateISO, from);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1) return `in ${days} days`;
  if (days < -1) return `${Math.abs(days)} days ago`;
  return dateISO;
}
