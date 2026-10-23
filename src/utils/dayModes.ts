import type { DayModeId, MealPlanDayPlan, Recipe } from '../types';
import { ingredientMatchesRule, type IngredientRuleId } from './ingredientRules';

/**
 * Per-day ways of eating.
 *
 * The household setting (`settings.dietaryPreference`) applies to every day.
 * These apply to one day of the week — a vrat, a day without onion, a day
 * with guests over. They are deliberately separate from the household diet
 * so a fasting day doesn't force the whole family to change.
 */

export interface DayMode {
  id: DayModeId;
  label: string;
  emoji: string;
  /** One line on what this mode is for. */
  blurb: string;
  /** Exactly what it rules out — shown so the user can see the rules. */
  excludes: string;
}

export const DAY_MODES: DayMode[] = [
  {
    id: 'normal',
    label: 'Normal day',
    emoji: '🍽️',
    blurb: 'Your household diet, as usual.',
    excludes: 'Nothing extra',
  },
  {
    id: 'vegetarian',
    label: 'Vegetarian day',
    emoji: '🥗',
    blurb: 'No meat, fish or eggs for this day.',
    excludes: 'Meat · fish · eggs',
  },
  {
    id: 'no-onion-garlic',
    label: 'No onion, no garlic',
    emoji: '🧅',
    blurb: 'Vegetarian, and no onion or garlic either.',
    excludes: 'Meat · fish · eggs · onion · garlic',
  },
  {
    id: 'vrat',
    label: 'Vrat (fasting)',
    emoji: '🪔',
    blurb: 'No onion, garlic, dal, root vegetables or meat. Rice, milk and fruit are fine.',
    excludes: 'Meat · fish · eggs · onion · garlic · dal · root vegetables',
  },
  {
    id: 'vrat-strict',
    label: 'Upvas (strict fast)',
    emoji: '🙏',
    blurb: 'Vrat, and no rice or wheat either. Sabudana, kuttu and ragi are fine.',
    excludes: '…and rice, wheat, millet',
  },
];

export const DAY_MODE_BY_ID: Record<DayModeId, DayMode> = DAY_MODES.reduce(
  (acc, m) => {
    acc[m.id] = m;
    return acc;
  },
  {} as Record<DayModeId, DayMode>,
);

/** Which ingredient rules each mode enforces. */
const MODE_RULES: Record<DayModeId, IngredientRuleId[]> = {
  normal: [],
  vegetarian: ['meat', 'seafood', 'egg'],
  'no-onion-garlic': ['meat', 'seafood', 'egg', 'onion-garlic'],
  vrat: ['meat', 'seafood', 'egg', 'onion-garlic', 'legume', 'root-veg'],
  'vrat-strict': [
    'meat', 'seafood', 'egg', 'onion-garlic', 'legume', 'root-veg', 'grain',
  ],
};

/** The mode for a given id, falling back to 'normal'. */
export function dayMode(id?: DayModeId | null): DayMode {
  if (!id) return DAY_MODE_BY_ID.normal;
  return DAY_MODE_BY_ID[id] ?? DAY_MODE_BY_ID.normal;
}

/** The rules a mode enforces. 'normal' enforces nothing extra. */
export function modeRules(id?: DayModeId | null): IngredientRuleId[] {
  if (!id) return [];
  return MODE_RULES[id] ?? [];
}

/**
 * The ingredients in this recipe that break the mode.
 *
 * Returns the offending ingredient names so the UI can say *why* a dish is
 * not allowed, rather than just hiding it.
 */
export function recipeViolations(
  recipe: Recipe | null | undefined,
  id?: DayModeId | null,
): string[] {
  const rules = modeRules(id);
  if (!recipe || rules.length === 0) return [];
  const out: string[] = [];
  for (const ing of recipe.ingredients || []) {
    if (!ing?.name) continue;
    if (rules.some((rule) => ingredientMatchesRule(ing, rule))) out.push(ing.name);
  }
  return Array.from(new Set(out));
}

/** True when the recipe can be cooked on a day with this mode. */
export function recipeAllowed(recipe: Recipe | null | undefined, id?: DayModeId | null): boolean {
  return recipeViolations(recipe, id).length === 0;
}

/** The mode set on a day of the plan, if any. */
export function dayModeOf(plan: MealPlanDayPlan | undefined): DayModeId | undefined {
  return plan?.mode;
}

/**
 * A short, human phrase for why a dish is off-limits — "has onion", "has
 * chicken". Falls back to the first ingredient's own name so the badge still
 * says something useful.
 */
export function violationPhrase(violations: string[]): string {
  if (violations.length === 0) return '';
  const first = violations[0].toLowerCase();
  if (violations.length === 1) return `has ${first}`;
  return `has ${first} +${violations.length - 1}`;
}
