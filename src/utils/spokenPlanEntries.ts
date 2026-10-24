import type { HouseholdProfile, MealPlanDayPlan, MealPlanEntry, MealSlot } from '../types';
import type { SpokenPlan, SpokenRefusal } from './spokenPlan';
import { namesHeldDish } from './spokenPlan';
import type { DishResolution } from './spokenRecipeMatch';
import { decideDish } from './spokenRecipeMatch';
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

/**
 * What the sheet is holding: the dishes that were heard, and the dishes the
 * user refused.
 *
 * WHY THE REFUSALS ARE IN THE DRAFT AND NOT WORKED OUT ONCE: the refusals are
 * what the user SAID, and they do not change because a field was edited. The
 * meals they empty do change — a meal the plan fills is not emptied by a
 * refusal beside it — so the meals are worked out from the refusals and the
 * plan as they stand now.
 */
export interface SpokenDraft {
  /** The dishes the utterance filed. */
  plan: SpokenPlan;
  /** The dishes the utterance refused. */
  refusals: SpokenRefusal[];
}

/**
 * The draft after the user typed a dish into a slot.
 *
 * WHY THE REFUSALS ARE LEFT ALONE: a refusal is not the absence of a dish,
 * it is a dish the user does NOT want, and an empty field says nothing about
 * what the meal should be. The user refused the dal by voice, typed a
 * biryani over it and then deleted the biryani; the refusal was standing the
 * whole time, and dropping it on the first keystroke put the dal back on the
 * plan and on the shopping list while the sheet said the meal was removed.
 *
 * @param draft the draft as it stands
 * @param slot  the meal the user typed in
 * @param dish  what they typed; empty means they cleared the field
 */
export function spokenPlanEditSlot(
  draft: SpokenDraft,
  slot: MealSlot,
  dish: string | undefined,
): SpokenDraft {
  return { ...draft, plan: { ...draft.plan, [slot]: dish || undefined } };
}

export interface SpokenPlanEntry {
  slot: MealSlot;
  entry: MealPlanEntry;
}

/**
 * The meals a refusal empties.
 *
 * WHY THIS IS ITS OWN RULE AND NOT PART OF THE ENTRIES: an entry says what a
 * meal is going to HOLD, and a refusal says what it must not hold. They are
 * opposites, and the plan can only carry one of them at a time — so a meal
 * the user refused is not written as an entry with no dish, it is left out of
 * the entries and named here instead.
 *
 * WHY THE DAY IS ASKED AND NOT THE PLAN: the plan is what the utterance
 * described, and a refusal usually arrives with no dish in it ("no dal for
 * dinner") — the plan is empty precisely because the dish was refused. The
 * meal the user is talking about is the one the DAY is holding, and the day is
 * what the shopping list buys.
 *
 * WHY THE DISH HAS TO MATCH: a refusal names a dish, and only the meal
 * holding THAT dish is the one the user refused. "no dal for dinner" must not
 * take the dinner away when the dinner is holding biryani — the user said
 * nothing about biryani, and a dish they did not refuse is a dish the list
 * buys.
 *
 * WHY A MEAL THE UTTERANCE FILLED IS LEFT OUT: the user can refuse a dish
 * and ask for another in the same breath — "no dal for dinner, biryani for
 * dinner" — and the dinner is to hold the biryani. A refusal takes the dish
 * that was there away; it does not take the meal away from what the user
 * asked for in the same sentence. So a meal the plan fills is never emptied
 * by a refusal, and the two sets can never be the same meal.
 *
 * @param refusals what the utterance refused
 * @param plan     the dishes the utterance filed
 * @param day      the day as it stands, for the dishes it is holding
 */
export function spokenPlanClears(
  refusals: SpokenRefusal[],
  plan: SpokenPlan,
  day: MealPlanDayPlan | undefined,
): MealSlot[] {
  if (!day) return [];
  const cleared: MealSlot[] = [];

  for (const refusal of refusals) {
    if (!refusal.dish) continue;
    // A refusal that named a meal is about that meal; one that named only a
    // dish is about wherever that dish is being held.
    const slots = refusal.slot ? [refusal.slot] : MEAL_SLOTS;
    for (const slot of slots) {
      // A meal the utterance filled is the user's own dish now, and a
      // refusal is not allowed to empty it.
      if ((plan[slot] || '').trim()) continue;
      const held = day[slot];
      if (!held) continue;
      if (!namesHeldDish(refusal.dish, held.name)) continue;
      if (!cleared.includes(slot)) cleared.push(slot);
    }
  }

  return cleared;
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
    //
    // WHETHER THE RECIPE IS LINKED IS ONE SHARED QUESTION, not one asked
    // here: `decideDish` is the same answer the sheet shows the user, so the
    // plan can never hold the name of one dish and the recipe of another. A
    // resolution describing a different dish links nothing at all — a plan
    // entry with the wrong recipe on it is worse than one with none.
    const { recipe } = decideDish(res, name);

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
