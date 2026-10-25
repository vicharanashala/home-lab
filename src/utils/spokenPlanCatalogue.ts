/**
 * Whether the spoken plan may be parsed yet.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT A LINE IN THE PAGE: the page is a React
 * component and cannot be run from a script, so anything it decides on its own
 * cannot be tested — and this is a decision, not markup.
 *
 * WHY THE PARSER HAS TO WAIT FOR THE CATALOGUE
 * The parser asks the catalogue a question about NAMES:
 *
 *   "no onion no garlic lobia masala" — is this a dish's own name?
 *
 * "no" and "without" are refusal words, and they are also parts of 40 recipe
 * names, so the words alone cannot say which is which — only the catalogue
 * can. The answer decides whether the user's dish is filed, or thrown away as
 * a refusal the user never made.
 *
 * The catalogue that answers is 5,894 recipes in a 5.4 MB download, and it
 * arrives late. Every one of those 40 names lives in it and none lives in the
 * 127 built-ins the app has until it does, so until it arrives the catalogue
 * cannot say "that is a dish" — and "I do not know" was being read as "that
 * is not a dish", which IS a refusal:
 *
 *   said "no onion no garlic lobia masala for dinner"
 *     while the catalogue was still loading
 *       plan     -> nothing. The dish the user asked for was lost.
 *       refusals -> "onion no garlic lobia masala", "garlic lobia masala"
 *                   two refusals the user never made, and the app said so.
 *
 * The shopping list buys the plan, so that meal was bought for nothing.
 *
 * So the spoken plan waits for the catalogue, and says why while it waits.
 */

/** How far the recipe catalogue has got. */
export type CatalogueState =
  /** On its way — a 5.4 MB download. */
  | 'loading'
  /** Here — the catalogue is whole, and can answer any question about it. */
  | 'ready'
  /** It did not arrive, and will not arrive during this visit. */
  | 'failed';

/** What the page does about the catalogue's state. */
export interface CatalogueGate {
  /**
   * Whether the spoken plan may be parsed yet.
   *
   * False only while the catalogue is on its way: the answer it would give is
   * "I do not know", and "I do not know" is read as a refusal — which loses
   * the dish the user asked for.
   */
  mayParse: boolean;
  /** What to tell the user, or null when there is nothing to say. */
  note: string | null;
}

/**
 * What the page does about the catalogue's state.
 *
 * WHY A FAILED CATALOGUE STILL ALLOWS THE PARSE: the failure is not the
 * parser's fault, and the sheet is still worth having — the user can say what
 * they want even when the matcher cannot recognise most of it. The note says
 * what is wrong, so a refusal the user did not make can be read as the
 * missing catalogue rather than as the app's opinion.
 *
 * WHY A LOADING CATALOGUE DOES NOT: guessing costs the meal and waiting
 * costs a moment.
 *
 * @param state how far the catalogue has got
 */
export function catalogueGate(state: CatalogueState): CatalogueGate {
  if (state === 'ready') {
    return { mayParse: true, note: null };
  }
  if (state === 'loading') {
    return {
      mayParse: false,
      note: 'Loading the recipe catalogue…',
    };
  }
  return {
    mayParse: true,
    note: 'The recipe catalogue did not load, so some dish names may be read as refusals.',
  };
}
