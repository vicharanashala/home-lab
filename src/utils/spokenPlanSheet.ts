import type { DishMatch, DishResolution } from './spokenRecipeMatch';
import { decideDish, sameDish } from './spokenRecipeMatch';

/**
 * What the confirmation sheet shows under one slot.
 *
 * WHY IT IS ITS OWN MODULE: the sheet is a React component and cannot be run
 * from a script, so anything it decides on its own cannot be tested. The note
 * under a slot and the dishes offered beside it are decisions, not markup —
 * and one of them was wrong.
 *
 * The sheet asked "is the match confident?" while the writer asked "is it
 * confident OR did the user pick it?", so a user who tapped a dish the
 * matcher had been unsure of was told "did you mean" and asked to choose
 * again, while the plan had already written that dish and linked its recipe.
 * The choice had been made and the screen was still asking the question.
 *
 * The writer now asks `decideDish` too, so the note under a slot says what
 * the plan is about to do.
 */

/** What the note under a slot says. */
export interface SheetNote {
  /**
   * 'matched' — the dish is linked to a recipe.
   * 'suggest' — it is not, and the alternatives are offered instead.
   * 'none'    — the slot says nothing: the resolution no longer describes
   *              the dish, so anything said about the old one would be
   *              describing something that is no longer on screen.
   */
  kind: 'matched' | 'suggest' | 'none';
  /** The dish the slot was matched to. Only set when the kind is 'matched'. */
  matchedName: string | null;
  /**
   * The dishes offered as chips.
   *
   * These are the OTHER dishes, so the slot's own dish is not one of them.
   * The comparison is by DISH and not by string, because the slot holds what
   * the user typed while the match holds the catalogue's spelling of it:
   * "paneer tikka" and "Paneer Tikka" are one dish, and offering the chip
   * "Paneer Tikka" back to a slot that already says "paneer tikka" is the
   * sheet saying the same thing twice, in two spellings.
   *
   * And the dish the note calls a MATCH is not an alternative to itself:
   * once the note says "matched Paneer Tikka", the chip "Paneer Tikka"
   * underneath it is the sheet asking the same question two ways. It is only
   * a suggestion while the match is NOT confident — that is what the "did you
   * mean" note is for.
   */
  chips: DishMatch[];
}

/**
 * What the sheet shows under a slot.
 *
 * @param resolution what the sheet worked out for this slot, if any
 * @param current    the text the slot holds right now
 */
export function sheetNoteFor(
  resolution: DishResolution | undefined,
  current: string,
): SheetNote {
  if (!resolution || !resolution.best) {
    return { kind: 'none', matchedName: null, chips: [] };
  }
  const best = resolution.best;
  const decision = decideDish(resolution, current);
  if (!decision.settled) {
    return { kind: 'none', matchedName: null, chips: [] };
  }

  const chips = [best, ...resolution.alternatives].filter(
    (m) =>
      !sameDish(m.name, current) &&
      (!decision.matched || !sameDish(m.name, best.name)),
  );

  return {
    kind: decision.matched ? 'matched' : 'suggest',
    matchedName: decision.matched ? best.name : null,
    chips,
  };
}
