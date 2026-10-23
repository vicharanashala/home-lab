import type { HouseholdProfile, MealPlanDayPlan, MealPlanEntry, MealSlot } from '../types';
import type { SpokenPlan } from './spokenPlan';
import type { DishResolution } from './spokenRecipeMatch';
import { CONFIDENT_SCORE } from './spokenRecipeMatch';
import { MEAL_SLOTS, suggestedServingsForDay } from './portions';

/**
 * Turning a spoken day into entries for the meal plan.
 *
 * WHY THIS IS ITS OWN MODULE: the meal plan page is over a thousand lines,
 * and "how much should this dish be" is the kind of number that has to be
 * ONE number for every path that writes a dish — the picker, the
 * suggestion sheet, the week filler and the spoken plan. When one of them
 * quietly used its own number, the same household got two different answers
 * on the same day, and the shopping list bought the wrong amount.
 *
 * Pulling the rule out here also lets it be tested on its own: the page
 * itself cannot be run from a script.
 */

export interface SpokenPlanEntry {
  slot: MealSlot;
  entry: MealPlanEntry;
}

/**
 * The entries to write for a spoken plan.
 *
 * A meal the user did not mention is left out entirely — nothing is
 * overwritten and nothing is invented.
 *
 * @param day        the day being planned, for the portion size and for
 *                   the servings the slot already holds
 * @param household  who eats here, for the portion size
 */
export function spokenPlanEntries(
  plan: SpokenPlan,
  resolutions: Record<string, DishResolution>,
  day: MealPlanDayPlan | undefined,
  household: HouseholdProfile | undefined,
  now: number = Date.now(),
): SpokenPlanEntry[] {
  const out: SpokenPlanEntry[] = [];

  for (const slot of MEAL_SLOTS) {
    const name = (plan[slot] || '').trim();
    if (!name) continue;              // never mentioned: leave it alone

    const existing = day?.[slot];
    const res = resolutions[slot];
    // A dish that was matched to a real recipe carries its id and emoji, so
    // the plan links to the recipe and the grocery list can work out what to
    // buy. Without this a spoken dish was stored as a bare string and linked
    // to nothing.
    const recipe =
      res?.best && res.best.score >= CONFIDENT_SCORE ? res.best.recipe : null;

    out.push({
      slot,
      entry: {
        name,
        slot,
        ...(recipe ? { recipeId: recipe.id, emoji: recipe.emoji } : {}),
        // Keep the portion size this day already used rather than resetting
        // it. A slot that has nothing in it yet gets the size the day wants —
        // the household, plus any guests. This is the same number the
        // picker and the suggestion sheet use; it used to be a hardcoded 2,
        // so a spoken plan cooked and bought half of what the screen said.
        servings: existing?.servings ?? suggestedServingsForDay(day, household),
        createdAt: now,
      },
    });
  }

  return out;
}
