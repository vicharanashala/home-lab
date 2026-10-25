import type { MealType } from '../types';
// The extension is written out on purpose.
//
// WHY: this module is imported by test scripts that do NOT register the
// resolver hook, because until now it reached for nothing at runtime — its
// only other import was a type. An extensionless path here is a path node's
// ESM resolver cannot add, so those tests would die on
// ERR_MODULE_NOT_FOUND the moment the parser reached for a sibling. The
// explicit extension resolves in node, in the bundler and in tsc
// (allowImportingTsExtensions), and it keeps the parser's one runtime
// dependency from breaking the nine test scripts that were written to import
// it directly.
import { dishCore } from './spokenRecipeMatch.ts';

/**
 * Turn a spoken sentence into meal-plan slots.
 *
 * Someone dictating a day does not say "set the breakfast field". They say
 * "breakfast oats with milk, lunch vegetable rice, dinner chicken curry" —
 * sometimes with "for", sometimes with "and", sometimes in the other order,
 * and sometimes skipping a meal entirely.
 *
 * So this reads the way people actually speak: find the words that name a
 * meal, and treat everything after each one as that meal's dish until the
 * next meal word appears. A meal never mentioned is left alone rather than
 * guessed at, because an empty slot is honest and a wrong dish is not.
 */

export type PlanSlot = 'breakfast' | 'lunch' | 'dinner';

export interface SpokenPlan {
  breakfast?: string;
  lunch?: string;
  dinner?: string;
}

/** Words that open a slot, and what they mean. Order matters: longer first
 *  so "brunch" is never mistaken for "b..." and "supper" never for "sup". */
const SLOT_WORDS: { re: RegExp; slot: PlanSlot }[] = [
  { re: /\b(breakfast)\b/i, slot: 'breakfast' },
  { re: /\b(brunch)\b/i, slot: 'breakfast' },
  { re: /\b(nasta|nashta|break fast)\b/i, slot: 'breakfast' },
  { re: /\b(mid[\s-]?day\s?meal)\b/i, slot: 'lunch' },
  { re: /\b(lunch)\b/i, slot: 'lunch' },
  { re: /\b(lazyo|let me eat)\b/i, slot: 'lunch' },
  { re: /\b(dinner)\b/i, slot: 'dinner' },
  { re: /\b(supper)\b/i, slot: 'dinner' },
  { re: /\b(raat\s*ka\s*khana|raat kana)\b/i, slot: 'dinner' },
];

/**
 * Phrases that carry no dish information and should never end up as a dish.
 *
 * "as" belongs here because it is a CONNECTOR — "dal as dinner" — and every
 * other connector already is: "for", "to be", "will be" and "will have" are
 * all in this list. It was the one that was missing, and the dish kept it.
 *
 * "dal as dinner" filed the dinner as "dal as", and "dal as" matches NO
 * recipe in the catalogue — not a weak match, none at all — so the plan held
 * a dish nobody could shop for and the shopping list bought nothing for it.
 * The connector has to be noise, exactly like its four brothers.
 */
const NOISE = new Set([
  'and', 'then', 'also', 'with', 'plus', 'for', 'as', 'the', 'a', 'an', 'is', 'are',
  'was', 'were', 'be', 'been', 'am', 'i', 'we', 'will', 'would', 'have', 'has',
  'had', 'having', 'to', 'eat', 'today', 'tomorrow', 'my', 'plan', 'meal',
  'meals', 'cook', 'cooking', 'please', 'ok', 'okay', 'so', 'just', 'some',
  'of', 'it', 'in', 'on', 'at', 'get', 'got', 'like', 'about',
  // The things people say before they start dictating. They sit in front of
  // the connector — "yeah, for lunch rice" — and the parser read them as
  // the dish the connector belonged to, so lunch became "yeah" and the rice
  // the user actually said was thrown away. "okay" and "so" were already
  // here, which is why this went unnoticed: the set had the words people
  // SHOULD use but not the ones they DO use.
  //
  // "no" is NOT here, and neither are "nah" and "nope": they are how a dish
  // is refused ("no dal for dinner"), and dropping them would throw the
  // refusal away and keep the dal.
  'yeah', 'yep', 'huh', 'right', 'hmm', 'mm', 'hello', 'hi',
  'hey', 'bye', 'yes', 'um', 'uh', 'ah', 'oh',
]);

/**
 * Connectors that put the dish BEFORE the meal word: "dal makhani FOR
 * dinner", "dal as dinner".
 *
 * Without this, "dal makhani for dinner and rice for lunch" filed the rice
 * under dinner and lost the lunch entirely — the text after a meal word was
 * always taken as that meal's dish, so the second meal's dish swallowed the
 * first meal's slot.
 *
 * The capture group holds whatever came BEFORE the connector, and that
 * matters. A connector only moves the dish to the front when there is a
 * dish in front of it: a "for" with nothing before it is not a connector at
 * all, it is how people talk. "For breakfast masala dosa, for lunch butter
 * chicken" is the most natural way to dictate a day, and reading the
 * leading "for" as "the dish comes before the meal word" filed masala dosa
 * under LUNCH, butter chicken under DINNER, and left breakfast empty.
 */
const PRE_CONNECTOR_RE = /^(.*?)\b(?:for|as|to be|will be|will have)\s*$/i;

/**
 * The words that refuse a dish.
 *
 * "no" is deliberately NOT in the noise set above: it is how a dish is
 * refused, and dropping it would keep the dal the user said they did not
 * want.
 *
 * They are held in one list so that every rule that recognises a refusal
 * uses the SAME words — the rules below look for a refusal in three
 * different places, and a list that each of them spelled out separately
 * would drift.
 *
 * "do not" is in the list because "not" on its own is not enough. "I do not
 * want dal for dinner" IS a refusal, but the word in front of the "not" —
 * the "do" — is what the split leaves behind, and a leftover is a dish. The
 * plan held the word "do" as the dinner: neither a dish nor a refusal, while
 * the dal the user refused was the only thing they had mentioned.
 *
 * "nope" and "nah" are here because they are the SAME refusal as "no" — they
 * are what people say instead of it. They were in the set of words that carry
 * no dish information, so the parser dropped them and kept the dish the user
 * had refused: "nope dal for dinner" filed the dinner as "dal", the dal the
 * user had said they did not want, and the shopping list bought it.
 *
 * WHY THEY ARE NOT MERELY ADDED HERE BUT TAKEN OUT OF THE NOISE SET: a word
 * that refuses a dish has to refuse it whichever word it is, or the same
 * intent is parsed two ways depending on what the user happened to say. One
 * list for all of them is what keeps the three rules below from drifting.
 *
 * WHY "REMOVE" AND "CANCEL" ARE HERE: they are how people ask for a dish to
 * be taken off the plan, and they were not refusals, so the words for taking
 * a dish away were written INTO the plan as the dish. "remove dal for
 * dinner" filed the dinner as "remove dal" — a name that matches no recipe
 * in the catalogue, so the shopping list bought nothing for it — and the
 * sheet said "Added 1 meal by voice" about a meal the user had asked to have
 * removed. The user asked for a dish to go away and the app planned it.
 *
 * WHY "DROP" IS NOT HERE, THOUGH IT SOUNDS JUST AS MUCH LIKE A REFUSAL: the
 * catalogue has "Chinese Egg Drop Soup", "Goan Egg Drop Curry" and "Snow
 * Drop Cookies" in it, and a refusal word that a recipe's own name contains
 * takes the dish away from the plan the moment the dish is said. A word on
 * this list can never be part of a dish, so it may only be added after the
 * catalogue has been checked for it.
 */
const REFUSAL_WORDS = [
  'no', 'not', 'without', 'skip', 'avoid', 'do not', 'nope', 'nah',
  'remove', 'cancel',
];

/**
 * "don't" is "do not" with the apostrophe left out.
 *
 * WHY IT IS EXPANDED BEFORE THE TEXT IS PARSED: the parser strips the
 * apostrophe out of every dish it builds, so a refusal written as "don't"
 * reached the refusal rules as "don t" — two words, and neither of them is
 * a refusal. The user said they did not want the dal and the plan wrote
 * "don t want dal" into the dinner slot: the sheet said it had heard
 * something, the plan held it, and the shopping list bought nothing for it.
 *
 * WHY IT BECOMES "do not" AND NOT "dont": the word in front of the "not"
 * decides whether the leftover is a dish. "I do not want dal" has a "do" in
 * front of the "not", and that "do" has to be part of the refusal or it is
 * filed as the dish.
 */
const CONTRACTED_REFUSAL_RE = /\bdon['’]?t\b/gi;

/** A dish the user explicitly did NOT want. "no dal for dinner" is not dal. */
const NEGATION_RE = new RegExp(`^\\s*(?:${REFUSAL_WORDS.join('|')})\\b\\s*`, 'i');

/**
 * A refusal anywhere in a stretch of speech, not only at the front of a
 * dish. The capture holds everything BEFORE the refusal.
 */
const REFUSAL_ANYWHERE_RE = new RegExp(`^(.*?)\\b(?:${REFUSAL_WORDS.join('|')})\\b`, 'i');

/**
 * Tells the parser whether a phrase names a dish the app knows.
 *
 * WHY IT IS PASSED IN AND NOT FOUND HERE: this module is a parser and knows
 * nothing about the catalogue, and the catalogue is 5,894 recipes wide. The
 * question "is this phrase a dish?" is a question about the catalogue, and the
 * app already has ONE rule that answers it — `matchDish`, the rule the recipe
 * picker, the suggestion sheet and the shopping list all use. So the caller
 * hands the parser that rule's answer and the parser never has to know what
 * the catalogue holds.
 *
 * WHY IT IS NEEDED AT ALL: "no" and "without" are refusal words, and they are
 * ALSO parts of 85 recipe names — "No Onion No Garlic Lobia Masala", "Red
 * Lentil Curry Without Coconut", "No-Bake Tangy Lemon Pie". The words alone
 * cannot say which is which. Only the catalogue can.
 */
export type KnownDishTest = (phrase: string) => boolean;

/**
 * True when the phrase names a dish the app knows.
 *
 * WHY ONLY A PHRASE THAT HOLDS A REFUSAL WORD IS ASKED ABOUT: a phrase with
 * no refusal word in it is never cut and never raises a refusal, so asking
 * the catalogue about it would cost a match and change nothing.
 *
 * WHY THE PHRASE IS FOLDED THROUGH `dishCore` FIRST: a recipe's own name
 * carries a tail the app itself writes on — "No Onion No Garlic Lobia Masala
 * Recipe In Electric Pressure Cooker" IS the dish "no onion no garlic lobia
 * masala" — and the rule the whole app compares names with already takes that
 * tail off. A spoken phrase that carries the tail has to be folded the same
 * way, or the two sides of the same question get different answers.
 *
 * WHY THE WORD AT THE FRONT IS ASKED ABOUT A SECOND TIME: a phrase can be a
 * dish AND begin with a refusal word, and then the word may be a refusal OF
 * that dish rather than part of its name. "no no onion no garlic lobia
 * masala" is the user refusing the dish "no onion no garlic lobia masala" —
 * the phrase without the front word is that dish, and the phrase with it is
 * not. So the word at the front is part of the name only when the rest of the
 * phrase is NOT a dish on its own.
 *
 * @param phrase    the phrase to ask about
 * @param knownDish the catalogue's answer, when the caller has one
 */
function namesKnownDish(phrase: string, knownDish?: KnownDishTest): boolean {
  if (!knownDish) return false;
  if (!REFUSAL_ANYWHERE_RE.test(phrase)) return false;
  const core = dishCore(phrase).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!core) return false;
  if (!knownDish(core)) return false;
  // The word at the front of the phrase may be a refusal OF a dish whose own
  // name begins with a refusal word — "no no onion no garlic lobia masala".
  const withoutFront = core
    .replace(new RegExp(`^(?:${REFUSAL_WORDS.join('|')})\\b\\s*`, 'i'), '')
    .trim();
  if (withoutFront && withoutFront !== core && knownDish(withoutFront)) return false;
  return true;
}

/**
 * The part of a stretch of speech that comes BEFORE a refusal, or null when
 * there is no refusal in it.
 *
 * "rice, no dal" is "rice" — the dal was refused, not eaten. Without this
 * the refusal was swallowed as part of the dish and the plan held
 * "rice no dal", a name that matches no recipe in the catalogue and so
 * buys nothing from the shopping list.
 */
function dishBeforeRefusal(text: string): string | null {
  const m = text.match(REFUSAL_ANYWHERE_RE);
  return m ? m[1] : null;
}

/**
 * The part of a stretch of speech that comes AFTER a refusal clause which
 * OPENS the stretch, or null when there is no such clause.
 *
 * "no dal, biryani" is "biryani" — the dal was refused and the biryani was
 * asked for, and they are two clauses. The rule that takes the text BEFORE a
 * refusal cannot answer this one, because there is nothing in front of the
 * refusal to take.
 *
 * WHY ONLY WHEN THE REFUSAL OPENS THE STRETCH: "rice, no dal" is "rice" — the
 * dish comes first there, and `dishBeforeRefusal` already answers it. Reaching
 * past the refusal as well would throw the rice away.
 *
 * WHY THE CLAUSE ENDS AT A COMMA: a comma is the only sign in this parser
 * that two things were said where one meal word stands — see the note on the
 * comma in the meal loop below. A refusal clause with no comma after it runs
 * to the end of the stretch, and then the stretch holds no dish at all.
 *
 * WHY EVERY LEADING REFUSAL IS STEPPED OVER, AND NOT ONLY THE FIRST: a
 * stretch may hold more than one refusal clause — "no dal, no rice, biryani"
 * refuses two dishes and asks for a third. Stepping over the first clause
 * alone left the text beginning with the SECOND refusal word ("no rice,
 * biryani"), and the rule that keeps a refused dish out of the plan then
 * threw the BIRYANI out with it. The biryani the user said out loud vanished
 * without a trace: the plan held no biryani, the shopping list bought no
 * biryani, and nothing anywhere said the biryani had been lost.
 *
 * @param text the stretch of speech
 */
function dishAfterLeadingRefusal(text: string): string | null {
  // The clause being read. Each step over a refusal makes it SHORTER, so the
  // walk cannot run for ever.
  let clause = text;
  for (;;) {
    const m = clause.match(REFUSAL_ANYWHERE_RE);
    if (!m) return null;
    // Something usable comes before the refusal, so the dish is in front of it
    // and the other rule answers.
    if (tidy(m[1])) return null;
    const tail = clause.slice(m[0].length);
    const comma = tail.indexOf(',');
    if (comma < 0) return null;
    const after = tail.slice(comma + 1);
    if (!tidy(after)) return null;
    // Does the clause just taken open with ANOTHER refusal? "no dal, no
    // rice, biryani" — two refusals, and then the dish the user asked for.
    const opens = after.match(REFUSAL_ANYWHERE_RE);
    if (!opens) return after;
    clause = after;
  }
}

/**
 * The words that can sit between a refusal and the meal word it refuses.
 *
 * "don't want lunch dal" IS a refusal of the lunch, but "want" is in the
 * way. The rule that looked for a refusal at the very end of the text in
 * front of the meal word saw "want", decided there was no refusal, and
 * wrote the lunch with the dish the user had REFUSED — and the shopping
 * list, which buys what the plan holds, bought it.
 *
 * WHY THEY ARE NOT IN THE NOISE SET: there they would be stripped out of
 * every dish ("lunch want rice" would become "rice"), which is a different
 * rule and a wider change than this needs. Here they are only stepped over
 * while looking for the refusal they hide.
 */
const REFUSAL_FILLERS = new Set([
  'want', 'wants', 'wanna', 'need', 'needs', 'really',
  // WHY "MORE" IS HERE AND NOT IN THE NOISE SET: it is a quantifier, and a
  // quantifier is the one word that can sit between a refusal and the dish
  // it refuses without carrying a dish of its own — "no more dal for dinner"
  // is the dal the user does not want, and nothing else.
  //
  // WHY IT MATTERS: "more" was not on this list, so the dish the refusal
  // named was "more dal" and not "dal". A refusal names the dish it refuses,
  // and this one named a dish nothing on the plan holds — so it removed
  // nothing, and the dal the user had refused stayed in the plan, where the
  // shopping list buys it. The refusal was understood perfectly and the dish
  // was not: the app said "there is no more dal to remove from the dinner"
  // about a dal the user had named twice.
  //
  // WHY NOT IN THE NOISE SET: there these words are stripped out of every
  // dish, which is a different rule and a wider change than this needs.
  'more',
]);

/**
 * The words that point back at the dish just named.
 *
 * "for breakfast dal, no it" refuses the dal — "it" IS the dal. A bare "no"
 * names nothing, and a refusal that names nothing removes nothing:
 * "lunch dal, no" is the lunch dal, and the test that says so is right.
 *
 * WHY "IT" IS NOT IN THE NOISE SET FOR THIS: it is there for the dishes —
 * "cook it" is not a dish called "it" — but here it is the pointer.
 */
const REFUSAL_PRONOUNS = new Set(['it', 'this', 'that']);

/**
 * The dish a stretch of text names.
 *
 * WHY THE CONNECTOR COMES OFF: what follows a refusal is often the
 * connector that joins it to the meal it refuses — "no dal for lunch" leaves
 * "dal for" behind, and "for" is not part of the dish.
 *
 * WHY THE FILLERS COME OFF: what follows a refusal is often a word that
 * carries no dish of its own — "not really lunch dal" leaves "really"
 * behind. The word that follows the filler is the dish.
 */
function dishOf(text: string): string {
  const withoutConnector = text.match(PRE_CONNECTOR_RE);
  return withoutFillers(tidy(withoutConnector ? withoutConnector[1] : text));
}

/**
 * A dish with the words that carry no dish of their own taken off.
 *
 * WHY IT IS ITS OWN RULE AND NOT PART OF `dishOf`: the dish a refusal NAMES
 * has these words taken off, and the dish the plan HOLDS does not — and the
 * two are compared with each other. One rule for the two sides of that
 * comparison is what lets a refusal match the dish it names at all. See
 * `namesHeldDish`.
 *
 * @param text the dish to strip
 */
function withoutFillers(text: string): string {
  return text.split(' ').filter((w) => w && !REFUSAL_FILLERS.has(w)).join(' ');
}

/**
 * A dish name, reduced to the words two names have to agree on.
 *
 * WHY THE PUNCTUATION GOES ON BOTH SIDES: the dish the DAY holds is a recipe's
 * own name, and a recipe's name carries punctuation — "Eggless Devil's Food
 * Cake", "PF Chang's Style Crispy Chicken Lettuce Wraps", "Roasted Potatoes
 * With Za'atar". The dish the user SAYS comes from a speech recogniser, and a
 * speech recogniser does not put the apostrophe in: "eggless devil s food cake"
 * is what was heard, and "zaatar" is how "za'atar" is said.
 *
 * So the punctuation was taken off the spoken name and left on the recipe
 * name, and the two could never be equal for a single one of those recipes:
 *
 *   day holds "Eggless Devil's Food Cake"   user says "no eggless devil's food cake"
 *                                             -> the meal was NOT emptied
 *
 * The shopping list buys the plan, so the refused dish stayed on the list and
 * the app said there was nothing to remove. The rule folds the case for
 * exactly this reason — see `namesHeldDish` — and the punctuation is the same
 * argument: the rule must not depend on which of the two names happened to
 * carry an apostrophe.
 *
 * WHY THE CASE IS FOLDED HERE AS WELL: the rule is used on names that arrive
 * from two places, and only one of them is a recipe's own spelling.
 *
 * WHY THE WORDS ARE KEPT HERE AND THE LETTERS ARE TAKEN IN `dishLetters`:
 * the fillers come off a name a WORD at a time — "no want rice" names the
 * rice, not the want — so the words have to still be words at that point.
 * The rule is therefore done in two steps: this one folds the case and the
 * punctuation so that the words can be read, and `dishLetters` folds what is
 * left of the separators away.
 *
 * @param text the name
 */
function comparableDish(text: string): string {
  return text
    .toLowerCase()
    // WHY THE AMPERSAND BECOMES "AND": the ampersand is a way of WRITING
    // "and", and the two sides of this question spell it differently — a
    // recipe's own name carries the symbol ("Asian Style Sweet & Spicy Green
    // Beans") while a speech recogniser writes the word ("asian style sweet
    // and spicy green beans"). The rule that takes the punctuation off a
    // name did not take the ampersand off, and the rule that takes the
    // letters of a name does not count a symbol, so the symbol simply
    // vanished from one side of the comparison and not the other:
    //
    //   day holds "Asian Style Sweet & Spicy Green Beans"
    //   user says "no asian style sweet and spicy green beans for dinner"
    //                                             -> the meal was NOT emptied
    //
    // The shopping list buys the plan, so the refused dish stayed on the
    // list and the sheet said there was nothing to remove. 469 of the 5,894
    // scraped names carry an ampersand, and 239 of them could not be refused
    // by the name a person would say them by.
    //
    // WHY IT IS "AND" AND NOT NOTHING: the rest of the app already has ONE
    // rule for "is this the same dish?" — `sameDish`, which folds the
    // ampersand to "and" before it compares. This rule and that one have to
    // give the same answer about the same pair of names, or the sheet and
    // the plan disagree about which dish the user refused. See `sameDish`.
    .replace(/&/g, ' and ')
    .replace(PUNCTUATION_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A dish name, reduced to the letters it is made of.
 *
 * WHY THE SPACES GO AS WELL AS THE PUNCTUATION: the apostrophe in a recipe's
 * own name reaches the app in three shapes, and the rule has to agree with
 * all three of them:
 *
 *   "Eggless Devil's Food Cake"   the recipe's own spelling
 *   "eggless devil s food cake"   the apostrophe heard as a space
 *   "eggless devils food cake"    the apostrophe not heard at all
 *
 * Folding the punctuation to a SPACE matches the first two and misses the
 * third, because "devil s" is not "devils" — and the refusal of that dish did
 * nothing at all: the dish stayed on the plan, the shopping list bought it,
 * and the sheet told the user there was no such dish to remove.
 *
 * And an apostrophe is not always a possessive. "Za'atar" is a spice, and
 * "zaatar" is how it is said, so the apostrophe there has to go too — and
 * folding it to a space left "za atar" beside "zaatar", which never matched
 * either.
 *
 * So the name is reduced to its letters, and the three shapes of one name are
 * one name.
 *
 * WHY THIS CANNOT MAKE TWO DISHES ONE: the letters are compared in order, so
 * a dish that merely CONTAINS the named one is still a different dish —
 * "dal" is not "dal tadka". The whole catalogue was checked for it: of the
 * 5894 scraped names and the curated ones, no two DIFFERENT names fold to the
 * same letters. The only names that do are the same dish written twice, like
 * "Paneer butter masala" and "Paneer Butter Masala".
 *
 * WHY THE LETTERS AND NOT THE ASCII ALPHABET: a recipe name carries accents
 * — "Jalapeño" — and stripping them would make "jalapeño" and "jalapeno" two
 * names where the catalogue has one.
 *
 * @param text the name
 */
function dishLetters(text: string): string {
  return text.replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * True when the refusal names the dish the plan is holding.
 *
 * WHY THE FILLERS COME OFF BOTH SIDES: the dish a refusal names is worked
 * out with the fillers taken off — "no want rice" names the rice, not the
 * want — and the dish the plan holds was worked out WITHOUT taking them off,
 * so "lunch want rice" held "want rice" and the two could never be equal.
 * The refusal named the dish with the very words the plan held, and the dish
 * stayed: "lunch want rice, no rice" kept the rice, the sheet said the lunch
 * had been heard, and the plan held a dish the user had refused.
 *
 * WHY ONLY THE FILLERS: a refusal that names a DIFFERENT dish has to leave
 * the plan alone — "lunch rice, no lunch dal" is the lunch rice — and the
 * fillers are the only words that carry no dish of their own. A dish that
 * merely CONTAINS the named dish is a different question, and it is not
 * answered here.
 *
 * WHY THE CASE IS FOLDED ON BOTH SIDES: the dish a refusal names is
 * lowercased by the parser and the dish the day holds is a recipe's own
 * name, and every recipe in the catalogue begins with a capital. The rule
 * folds the case on both sides so that "no palak paneer for dinner" empties
 * a day holding "Palak paneer" — see the comment inside the function.
 *
 * @param named the dish the refusal names
 * @param held  the dish the plan is holding
 *
 * WHY IT IS EXPORTED: the same question is asked twice, of two different
 * dishes — the dish the plan of this utterance is holding, and the dish the
 * DAY is holding. One rule for both, or the two answers drift apart and a
 * refusal takes a meal the user never mentioned.
 */
export function namesHeldDish(named: string, held: string | undefined): boolean {
  if (!named || !held) return false;
  if (named === held) return true;
  //
  // WHY THE CASE IS FOLDED ON BOTH SIDES: the dish a refusal NAMES is worked
  // out by `tidy`, which lowercases everything — so the refusal says "palak
  // paneer". The dish the DAY holds is the recipe's own name, and every
  // recipe in the catalogue is written with a capital: "Palak paneer". The
  // two sides of this question could therefore never be equal for a single
  // real dish in the app, and the refusal did nothing:
  //
  //   day holds "Palak paneer"   user says "no palak paneer for dinner"
  //                             -> the meal was NOT emptied
  //
  // The shopping list buys the plan, so the refused dish stayed on the list
  // — and the sheet said nothing at all, because the utterance produced
  // neither a plan nor a clear, which reads as "could not tell which meal it
  // was for". 5887 of the 5894 scraped recipe names begin with a capital,
  // and all 42 curated ones do, so this was every real dish in the app.
  //
  // WHY BOTH SIDES AND NOT ONLY THE REFUSAL: the dish the day holds is
  // written by whoever put it there — a recipe name, a typed correction, a
  // dish heard and matched — and the rule must not depend on which of them
  // happened to capitalise it. Folding the case first also lets the fillers
  // come off a name that is written "Want Rice", which `withoutFillers`
  // alone cannot do: its filler set is lowercase.
  //
  // WHY THE PUNCTUATION GOES ON BOTH SIDES TOO: the same argument, one step
  // further. The spoken name has had its punctuation taken off by `tidy`; the
  // recipe's own name has not, and a recipe's name is full of apostrophes and
  // commas. So the two could never be equal for a dish like "Eggless Devil's
  // Food Cake", and a refusal of it did nothing at all — the dish stayed on
  // the plan and the shopping list bought it. `comparableDish` is the one
  // rule both sides go through.
  //
  // WHY THE FOLDING GOES ALL THE WAY DOWN TO THE LETTERS: folding the
  // punctuation to a space is not enough, because the apostrophe reaches the
  // app in more than one shape. The recipe's own name has it — "Devil's" —
  // the recogniser may leave it as a space — "devil s" — or drop it and keep
  // the letter after it — "devils". The rule matched the first two and missed
  // the third, so:
  //
  //   day holds "General Tso's Chicken"   user says "no general tsos chicken"
  //                             -> the meal was NOT emptied
  //
  // and the same held for an apostrophe that is not a possessive at all:
  // "Roasted Potatoes With Za'atar" is not "Roasted Potatoes With Za Atar".
  // `dishLetters` is what makes the three shapes of one name one name.
  //
  // WHY THE FILLERS COME OFF BEFORE THE LETTERS: a filler is a WORD — "want",
  // "more", "really" — and the words have to still be words to take them off.
  //
  // WHY BOTH SIDES GO THROUGH THE APP'S OWN "WHAT A PERSON WOULD SAY" RULE
  // FIRST: a dish name reaches this rule in two shapes, and the rule used to
  // compare them in those shapes. The dish the user SAYS is a spoken fragment
  // — "bhindi masala". The dish the DAY holds is a recipe's own name, and a
  // recipe's own name is written with a gloss on it:
  //
  //   day holds "Bhindi masala (okra)"   user says "no bhindi masala for dinner"
  //                                             -> the meal was NOT emptied
  //
  // The same happened for every name the app itself rewrites when it writes
  // the plan, and for every name the recipe picker and the suggestion sheet
  // write: "Lemon rice (chitranna)", "Upma (rava upma)", "Baingan Bharta
  // Recipe - Brinjal Bharta", "Homemade Tater Tots".
  //
  // It is not a corner case. Of the 5,894 scraped names and the curated ones,
  // 143 are rewritten by the app's own matcher to a DIFFERENT name, and 132 of
  // those could not be refused by the name the user had said. The shopping list
  // buys the plan, so the refused dish stayed on the list and the sheet said
  // there was nothing to remove.
  //
  // `dishCore` is the rule the rest of the app already uses to answer "is
  // this the same dish?", and it is what the matcher matches on: it takes the
  // gloss, the "Recipe -" tail, the leading "Homemade" and the " | " second
  // name off, so the two shapes become the one dish they are. Folding both
  // sides through it makes this rule agree with the matcher, which is the
  // whole point of a shared answer — see `sameDish`.
  //
  // WHY IT DOES NOT MAKE TWO DISHES ONE: `dishCore` only ever strips a
  // gloss, a tail and a leading noise word, so a dish that merely CONTAINS
  // the named one is still a different dish — "dal" is still not "dal tadka",
  // and the refusal of a dal leaves a dal tadka alone.
  return (
    dishLetters(withoutFillers(comparableDish(dishCore(named)))) ===
    dishLetters(withoutFillers(comparableDish(dishCore(held))))
  );
}

/**
 * A meal word found in the text, and where it is.
 *
 * WHY IT IS A TYPE OF ITS OWN: the refusal rules below have to find the meal
 * words again, from outside the parsing loop, because the dish a refusal
 * names can sit on either side of one.
 */
interface MealMark {
  /** Where the meal word starts. */
  at: number;
  /** How long the meal word is. */
  len: number;
  /** The meal it names. */
  slot: PlanSlot;
}

/** A refusal in the text, and where it is. */
interface RefusalAt {
  /** Where the refusal word starts. */
  at: number;
  /** Where the refusal word ends. */
  end: number;
}

/**
 * Every refusal in the text.
 *
 * WHY THE SEARCH IS OVER THE WHOLE TEXT AND NOT OVER ONE MEAL'S SEGMENT:
 * the dish a refusal names can sit on EITHER side of the meal word — "no dal
 * for dinner" puts it in front, "no lunch dal" puts it behind — and the meal
 * that ends up holding it may have been filed by an EARLIER mention of the
 * same meal. The parser's own loop only ever sees the text in front of the
 * meal word it is reading, so it cannot see that; this can, because it has
 * the whole sentence.
 *
 * @param src the whole sentence
 */
function refusalsIn(src: string): RefusalAt[] {
  const found: RefusalAt[] = [];
  const re = new RegExp(`\\b(?:${REFUSAL_WORDS.join('|')})\\b`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    found.push({ at: m.index, end: m.index + m[0].length });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return found;
}

/**
 * The dish a stretch of text names, stopping at a comma.
 *
 * WHY THE COMMA STOPS IT: a comma ends the clause it is in. What follows a
 * comma belongs to the NEXT clause — "dal for dinner, no, rice for lunch"
 * has the rice after the comma, and the rice is the lunch the user wants.
 *
 * @param from where the stretch starts
 * @param to   where it ends
 */
function dishBetween(src: string, from: number, to: number): string {
  const commaAt = src.indexOf(',', from);
  const stop = commaAt >= 0 && commaAt < to ? commaAt : to;
  return dishOf(src.slice(from, stop));
}

/**
 * True when the meal word follows the refusal so closely that the refusal
 * names the dish BEHIND the meal word.
 *
 * "no lunch dal" — the refusal and the meal word are next to each other, and
 * the dal is behind the lunch. "no need lunch dal" is the same thing with a
 * filler in between, so the fillers do not break the link.
 *
 * WHY A COMMA BREAKS THE LINK: "lunch biryani actually no, lunch salad"
 * puts a comma between the refusal and the meal word, and there the refusal
 * takes back the biryani rather than naming the salad.
 */
function refusalLinksToMeal(src: string, from: number, to: number): boolean {
  const between = src.slice(from, to);
  if (between.includes(',')) return false;
  return between
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .every((w) => REFUSAL_FILLERS.has(w.toLowerCase()));
}

/**
 * The stretch of text the refusal stands in.
 *
 * WHY A CLAUSE AND NOT THE WHOLE SENTENCE: a comma ends the clause it is in,
 * and what a refusal says is about the clause it was said in.
 *
 *   "breakfast oats, lunch rice, no oats"     the refusal is in the clause
 *                                             "no oats" — a clause of its own,
 *                                             with no meal word in it
 *   "dal for dinner, rice no dal for lunch"   the refusal is in the clause
 *                                             "rice no dal for lunch", and
 *                                             that clause names the LUNCH
 *
 * WHY THIS DECIDES WHETHER A REFUSAL MAY REACH FOR ANOTHER MEAL: in the first
 * the refusal stands alone and names a dish — the oats — and the oats are the
 * breakfast's. In the second the refusal names a dish AND a meal: it is saying
 * "for lunch it is rice, not dal", and the dal that belongs to the dinner is
 * a dish the user asked for, not one the refusal touches.
 *
 * WHY ONLY THE END OF THE CLAUSE: a clause always STARTS before the refusal,
 * so a meal word that comes after the refusal is already inside it — the
 * start would say nothing the end does not.
 *
 * @param src     the whole sentence
 * @param refusal where the refusal is
 */
function clauseEndOf(src: string, refusal: RefusalAt): number {
  const after = src.indexOf(',', refusal.end);
  return after >= 0 ? after : src.length;
}

/**
 * True when the refusal POINTS BACK at the dish it was said after.
 *
 * "no it" names the dish in front of it: "for breakfast dal, no it" is "the
 * breakfast is NOT dal".
 *
 * WHY THIS IS A RULE OF ITS OWN: the pronoun used to be read only when the
 * refusal came after the LAST meal word in the sentence, so "for breakfast
 * dal, no it" refused the dal and "for breakfast dal, no it, for lunch rice"
 * did not. The same words and the same intent, with only the next thing the
 * user said different — and the dal stayed in the plan, where the shopping
 * list buys it.
 *
 * WHY THE SCAN STOPS AT THE NEXT MEAL WORD: a meal word opens a meal, so a
 * pronoun after it belongs to THAT meal's dish and not to the one the refusal
 * was said after. "breakfast dal, no dal, lunch rice and it" is a refusal of
 * the dal and a lunch of rice; the "it" at the end is the rice's.
 *
 * @param src        the whole sentence
 * @param refusal    where the refusal is
 * @param nextMealAt where the next meal word starts, or the end of the sentence
 */
function pointsBackAt(src: string, refusal: RefusalAt, nextMealAt: number): boolean {
  const words = src
    .slice(refusal.end, nextMealAt)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return words.some((w) => REFUSAL_PRONOUNS.has(w));
}

/**
 * True when the text in front of the meal word refuses that meal.
 *
 * "no lunch dal" refuses the lunch — the refusal sits in front of the MEAL
 * WORD, which is the one place the dish-only rule could not see it.
 *
 * WHY THE COMMA STOPS THE LOOK: "fish, no, lunch rice" puts a comma between
 * the refusal and the meal word, so the refusal belongs to the meal before
 * it and the lunch is a dish of its own.
 *
 * WHY THE FILLERS ARE STEPPED OVER: "don't want lunch dal" is the same
 * refusal as "no lunch dal", but "want" sits between the refusal and the
 * meal word. The old rule looked only at the word immediately before the
 * meal word, so it saw "want" and found no refusal — and the refused dish
 * went into the plan.
 *
 * WHY THE DISH IN FRONT STILL WINS: "no dal lunch rice" is "no dal" — the
 * dal was refused — and "rice" is the lunch. The refusal attaches to the
 * dish in front of it, so the walk stops at the first word that carries
 * meaning and asks whether THAT word is a refusal.
 */
function refusesBefore(text: string): boolean {
  const commaAt = text.lastIndexOf(',');
  const afterComma = commaAt >= 0 ? text.slice(commaAt + 1) : text;

  const words = afterComma
    .toLowerCase()
    .replace(/[.,!?;:"'`]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // Walk back from the meal word, stepping over the words that carry no
  // meaning of their own, and stop at the first one that does.
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (NOISE.has(w) || REFUSAL_FILLERS.has(w)) continue;
    return REFUSAL_WORDS.includes(w);
  }
  return false;
}

/** A time, not a dish: "at 8", "at 8 pm", "8 pm". */
const TIME_RE =
  /\b(?:at|around|by|@)\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\b|\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi;

/**
 * The punctuation that is not part of a dish's name.
 *
 * WHY IT IS A NAMED RULE AND NOT A LITERAL IN TWO PLACES: a dish name is
 * compared with another dish name, and the two come from different places —
 * the spoken one from a speech recogniser, the one on the day from a recipe's
 * own name. If the rule that takes the punctuation off is written twice, once
 * for each side, the two sides can disagree about what a name is, and a dish
 * the user named can fail to match itself. See `comparableDish`.
 */
const PUNCTUATION_RE = /[.,!?;:"'`]/g;

function tidy(text: string): string {
  let out = text
    .toLowerCase()
    // The time is taken out BEFORE the punctuation is.
    //
    // WHY: a time is written with dots — "8 p.m." — and the rule that looks
    // for a time needs those dots to tell "p.m." from a bare "p". The
    // punctuation was stripped first, so the rule never found the time, and
    // what was left of it stayed in the dish:
    //
    //   "dinner at 8 p.m."  ->  the dinner was "p m"
    //
    // A dish called "p m" matches no recipe in the catalogue, so the plan
    // held a dish nobody could shop for and the shopping list bought nothing
    // for that dinner. The user said when, not what.
    //
    // WHY IT IS SAFE TO TAKE THE TIME OUT FIRST: the rule only matches a
    // time, so nothing else is touched by the order — "8.30" is not a time
    // and is left exactly as it was.
    .replace(TIME_RE, ' ')
    .replace(PUNCTUATION_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Drop leading/trailing connector words, repeatedly, so "and for dinner"
  // leaves just "dinner".
  let changed = true;
  while (changed && out) {
    changed = false;
    const first = out.split(' ')[0];
    if (NOISE.has(first)) { out = out.split(' ').slice(1).join(' ').trim(); changed = true; }
    const parts = out.split(' ');
    const last = parts[parts.length - 1];
    if (parts.length > 1 && NOISE.has(last)) { out = parts.slice(0, -1).join(' ').trim(); changed = true; }
  }
  return out;
}

/** True when what remains is a real dish rather than leftover filler. */
function isMeaningful(s: string): boolean {
  if (!s) return false;
  const words = s.split(' ').filter((w) => w && !NOISE.has(w));
  return words.length > 0 && s.length >= 2;
}

/**
 * The dish a stretch of speech carries, with a refusal taken out of it.
 *
 * WHY THE SPLIT IS NOT ALWAYS MADE: when the refusal is the FIRST thing in
 * the stretch then the whole stretch IS the refusal — "no dal" is not a dish
 * with something cut off it. Cutting it to nothing would throw the refusal
 * away, so the text is handed back as it is and the refusal rule below sees
 * it whole and refuses the meal.
 *
 * WHY IT MATTERS THAT THE SPLIT IS MADE AT ALL: a refusal that sat in the
 * MIDDLE of a dish left the refused dish in the plan. "rice, no dal for
 * dinner" filed the dinner as "rice no dal" — the dal the user had refused
 * was still in it, and "rice no dal" matches no recipe in the catalogue, so
 * the shopping list bought nothing for it.
 *
 * The split was already made on one path — the text that follows a meal word
 * — and not on the paths that go through a connector, which is why the same
 * sentence was split correctly with a connector removed ("lunch rice, no
 * dal") and not with one ("rice, no dal for dinner").
 *
 * WHY THE TEXT AFTER THE REFUSAL IS TAKEN WHEN NOTHING IS IN FRONT OF IT: a
 * refusal that OPENS a stretch is a clause of its own, and the clause after
 * it may hold the dish the user asked for. "no dal, biryani for dinner" is
 * the dal refused and the biryani asked for.
 *
 * It was filed as nothing at all. The stretch in front of the dinner was "no
 * dal, biryani", and with the refusal's own clause left in, the dish began
 * with a refusal word — so the rule that keeps a refused dish out of the plan
 * threw the BIRYANI out with it. The user asked for biryani and the app
 * dropped it: the plan held no biryani, the shopping list bought no biryani,
 * and nothing anywhere said the biryani had been lost.
 */
function dishWithoutRefusal(text: string): string {
  const before = dishBeforeRefusal(text);
  if (before === null) return text;
  if (tidy(before)) return before;
  // Nothing usable in front of the refusal, so the refusal opens the stretch.
  const after = dishAfterLeadingRefusal(text);
  return after === null ? text : after;
}

/**
 * A stretch of the sentence, and where it sits in the sentence.
 *
 * WHY THE POSITION IS KEPT AND NOT ONLY THE TEXT: a refusal word is only a
 * refusal if it is not part of a dish's own NAME, and a dish's own name is
 * the phrase a meal took its dish from. So the rules that read the sentence
 * afterwards have to be able to ask "is this word inside that phrase?".
 */
interface Span {
  /** Where the stretch starts. */
  start: number;
  /** Where the stretch ends. */
  end: number;
}

/**
 * A dish a meal word takes from the text beside it.
 */
interface DishTake {
  /** The text the dish was cut from. */
  span: Span;
  /** The dish. */
  dish: string;
  /**
   * True when the text names a dish the app knows — which means the refusal
   * word inside it is part of that dish's own name and not a refusal at all.
   */
  isKnown: boolean;
}

/**
 * The dish a stretch of the sentence carries.
 *
 * WHY A PHRASE THAT NAMES A KNOWN DISH IS NOT CUT: "no" and "without" are
 * refusal words, and they are also parts of 85 recipe names. "Red Lentil
 * Curry Without Coconut" is one dish, and the cut took "without coconut" off
 * it and left "red lentil curry" — a different dish, one that matches no
 * recipe by that name, so the shopping list bought the wrong thing while the
 * sheet said the meal had been heard.
 *
 * WHY IT IS THE CATALOGUE THAT DECIDES: the words cannot. "no dal" is a
 * refusal and "no onion no garlic lobia masala" is a dish, and the two differ
 * in no way that the sentence alone can show. The catalogue knows, so the
 * catalogue is asked.
 *
 * @param src       the whole sentence
 * @param span      where the text the dish is cut from sits
 * @param knownDish the catalogue's answer, when the caller has one
 */
function dishTake(src: string, span: Span, knownDish?: KnownDishTest): DishTake {
  const text = src.slice(span.start, span.end);
  const isKnown = namesKnownDish(text, knownDish);
  return {
    span,
    dish: isKnown ? tidy(text) : tidy(dishWithoutRefusal(text)),
    isKnown,
  };
}

/**
 * A dish the user said they did not want.
 */
export interface SpokenRefusal {
  /**
   * The meal the refusal is about, or null when the refusal named a dish and
   * no meal — "no dal" with no meal word beside it refuses the dal wherever
   * the day is holding it.
   */
  slot: PlanSlot | null;
  /**
   * The dish the refusal named: the words the user refused.
   *
   * EMPTY WHEN THE REFUSAL NAMED A MEAL AND NO DISH — "no breakfast". There
   * is no dish to take away, but the meal itself is what was refused, and
   * the meal is emptied whatever it is holding.
   */
  dish: string;
}

/**
 * What the utterance said: the dishes it files, and the dishes it refuses.
 */
export interface SpokenPlanResult {
  /** The dishes the utterance files, one per meal it named. */
  plan: SpokenPlan;
  /** The dishes the utterance refused. */
  refusals: SpokenRefusal[];
}

/**
 * Parse spoken text into slots.
 *
 * Returns only the meals that were actually named — a partial dict is a
 * legitimate result and the caller fills just those slots.
 *
 * @param text       what was heard or typed
 * @param knownDish the catalogue's answer to "is this a dish?", when the
 *                   caller has one — see `KnownDishTest`
 */
export function parseSpokenPlan(text: string, knownDish?: KnownDishTest): SpokenPlan {
  return parseSpokenPlanResult(text, knownDish).plan;
}

/**
 * Parse spoken text into slots AND the dishes it refused.
 *
 * WHY THE REFUSALS ARE A SEPARATE THING AND NOT PART OF THE PLAN: a refusal
 * is not a dish, so it cannot be a slot — but it is not the absence of one
 * either. "no dal for dinner" leaves the plan empty, and an empty plan reads
 * as "the user did not mention the dinner", which is what the writer took it
 * to mean and why the dal the user had REFUSED stayed in the plan and on the
 * shopping list. The refusal has to be said out loud, or the one thing the
 * user was clearest about is the one thing the plan cannot carry.
 *
 * @param text       what was heard or typed
 * @param knownDish the catalogue's answer to "is this a dish?", when the
 *                   caller has one — see `KnownDishTest`
 */
export function parseSpokenPlanResult(
  text: string,
  knownDish?: KnownDishTest,
): SpokenPlanResult {
  // The contraction is expanded first so that EVERY rule below — the one
  // that reads the text in front of a meal word and the one that reads the
  // dish itself — sees the refusal in the same words.
  //
  // The sentence end is turned into a clause end straight after, because
  // EVERY rule below that reads a clause looks for a comma: the rule that
  // decides whether a refusal belongs to the meal in front of it, the rule
  // that finds the dish a refusal names, and the rule that says a refusal
  // standing alone may reach for another meal.
  //
  // WHY: Whisper punctuates what it hears, and it ends a sentence with a
  // FULL STOP as readily as with a comma. The rules read a comma as the end
  // of a clause, so a full stop was not one — and the difference is silent,
  // and costly in both directions:
  //
  //   "breakfast dal, no it, lunch dal"   -> lunch dal    (the comma ends it)
  //   "breakfast dal. no it. lunch dal."  -> nothing       (the full stop does not)
  //
  // The lunch dal the user had just asked for was DROPPED — a dish the user
  // said out loud, gone with nothing saying so — and in the other shape the
  // dal the user REFUSED stayed in the plan, which is the one thing the
  // shopping list buys.
  //
  // WHY A FULL STOP AND NOT EVERY DOT: "8 p.m." is a time and not a sentence
  // end, and a dot between digits is a decimal. Only a run of sentence marks
  // followed by a space or the end of the text is a sentence end.
  const src = (text || '')
    .trim()
    .replace(CONTRACTED_REFUSAL_RE, 'do not')
    .replace(/[.!?]+(?=\s|$)/g, ',');
  if (!src) return { plan: {}, refusals: [] };

  // Locate every slot marker, keeping the LENGTH OF THE MATCH. Earlier this
  // re-ran a search over the remaining text to work out where the word ended,
  // which found the NEXT meal word instead — "dinner will be fish, breakfast
  // is upma" came out as "ll be fish", because the search matched "breakfast".
  const marks: MealMark[] = [];
  for (const { re, slot } of SLOT_WORDS) {
    // Match EVERY occurrence of the word, not just the first. "lunch rice,
    // dinner dal, lunch salad" used to stop at the first "lunch", so the text
    // after the second one was merged into the dinner dish.
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = global.exec(src)) !== null) {
      marks.push({ at: m.index, len: m[0].length, slot });
      if (m.index === global.lastIndex) global.lastIndex += 1;
    }
  }
  // WHY THE TEXT IS NOT GIVEN UP ON WHEN NO MEAL WAS SPOKEN: a refusal with
  // no meal word beside it is still a refusal — "no dal" refuses the dal
  // wherever the day is holding it, and the day is the only thing that knows
  // where that is. The plan below is empty either way, so nothing about the
  // plan changes; what changes is that the refusal is said out loud instead
  // of being thrown away with the text. The refusal rules at the bottom of
  // this function are the ones that read it.

  // Overlapping rules can flag the same word twice; keep the earliest at each
  // spot.
  marks.sort((a, b) => a.at - b.at);
  const unique: MealMark[] = [];
  for (const m of marks) {
    if (unique.length && m.at - unique[unique.length - 1].at < 3) continue;
    unique.push(m);
  }

  const out: SpokenPlan = {};

  /**
   * The dishes the utterance refused, and the meal each one was about.
   *
   * WHY THEY ARE COLLECTED AND NOT JUST APPLIED: the rule below removes a
   * refused dish from the PLAN — the plan this utterance is describing. The
   * meal the day is actually holding is a different thing, and it is the one
   * the shopping list buys. A refusal that says "no dal" has to be able to
   * reach the dal the day is holding, and that answer belongs to whoever
   * knows what the day holds.
   */
  const refusals: SpokenRefusal[] = [];

  /**
   * The dish the meal word about to be read may take from the text IN FRONT
   * of it.
   *
   * The text between two meal words is shared. The meal on the left may take
   * its dish from the text on its right ("breakfast masala dosa") and the
   * meal on the right may take its dish from the text on its left ("butter
   * chicken for lunch") — and when both do, the two dishes sit in the SAME
   * stretch of text and the parser has to know where one ends and the other
   * begins.
   *
   * That is the whole difficulty. Hand the whole stretch to the left meal
   * and it swallows the right meal's dish — "breakfast masala dosa, butter
   * chicken for lunch" became a breakfast of "masala dosa butter chicken"
   * and a lunch with nothing in it. And because the left meal had taken the
   * right meal's dish, the right meal was then given the NEXT meal's dish
   * instead: "for breakfast masala dosa, butter chicken for lunch, chole for
   * dinner" put "chole" in the LUNCH slot and dropped dinner entirely.
   *
   * So the split is worked out by the meal on the left, one step early, and
   * handed to the meal on the right.
   */
  /**
   * The text the next meal word takes its dish from, and where that text
   * sits in the sentence.
   *
   * WHY THE TEXT AND ITS PLACE ARE BOTH KEPT: a refusal word is only a
   * refusal if it is not part of a dish's own NAME, and a dish's own name is
   * the phrase a meal took its dish from. The rule that reads the sentence
   * afterwards has to ask "is this word inside that phrase?", and that
   * question is about a place in the sentence and not only about a name.
   */
  let nextLeft: DishTake | null = null;

  /**
   * Every meal the text mentioned, with the dish each one would file.
   *
   * WHY THIS IS COLLECTED: the dish a refusal names may have been filed by an
   * EARLIER mention of the same meal — "lunch rice, no lunch rice" files the
   * rice on the first mention and refuses it on the second — and by the time
   * the loop is over, this is the only place that answer is.
   *
   * WHY EACH MENTION KEEPS THE PHRASE IT TOOK ITS DISH FROM: the phrase is
   * what says whether the refusal word in it is a refusal at all — see
   * `DishTake`.
   */
  const mentions: {
    slot: PlanSlot;
    at: number;
    len: number;
    dish: string;
    span: Span;
    isKnown: boolean;
  }[] = [];

  // The text before the FIRST meal word can only be that meal's own: there
  // is no meal before it that could have claimed it. There is no first meal
  // word when the text held none, and then there is no lead text either.
  const leadPre = unique.length ? src.slice(0, unique[0].at).match(PRE_CONNECTOR_RE) : null;
  if (leadPre) {
    nextLeft = dishTake(src, { start: 0, end: leadPre[1].length }, knownDish);
  }

  for (let i = 0; i < unique.length; i++) {
    const mark = unique[i];
    const after = mark.at + mark.len;
    const nextAt = i + 1 < unique.length ? unique[i + 1].at : src.length;
    const prevEnd = i > 0 ? unique[i - 1].at + unique[i - 1].len : 0;

    const segAfter = src.slice(after, nextAt);
    const segBefore = src.slice(prevEnd, mark.at);
    const hasPrev = i > 0;

    // The text AFTER this meal word, up to the next one. When it ends with a
    // connector, the next meal word may take its dish from in front of it,
    // and this stretch of text holds TWO dishes rather than one.
    const afterPre = segAfter.match(PRE_CONNECTOR_RE);
    const afterFront = afterPre ? afterPre[1] : '';

    // The comma is where the two dishes part company.
    //
    // "and" is NOT, and that is deliberate: the catalogue is full of dishes
    // named with it — "Makki and Methi Roti", "Cabbage and Carrot
    // Sambharo", and the everyday "rice and dal". Splitting on "and" would
    // cut those in half and hand the second half to a meal that was never
    // spoken for. A comma is the only sign that two dishes were said where
    // one meal word stands.
    const commaAt = afterFront.lastIndexOf(',');
    const afterHead = commaAt >= 0 ? afterFront.slice(0, commaAt) : afterFront;

    // Which side of the meal word holds the dish? "dinner dal" puts it
    // behind; "dal for dinner" puts it in front. A connector right before the
    // meal word is the tell. The segment on the other side belongs to the
    // NEIGHBOURING meal, so it must not be stolen as a fallback.
    //
    // A connector only moves the dish to the front when there is a dish in
    // front of it. A "for" with nothing in front of it is not a connector at
    // all — it is how people talk. "For breakfast masala dosa, for lunch
    // butter chicken" is the most natural way to dictate a day, and reading
    // the leading "for" as "the dish comes before the meal word" filed masala
    // dosa under LUNCH, butter chicken under DINNER, and left breakfast
    // empty.
    let dish: string;
    // The phrase the dish was cut from, and whether that phrase names a dish
    // the app knows — see `DishTake`.
    let take: DishTake;
    // Which side of THIS meal word the dish was taken from, so the next
    // meal word can tell a repeated dish from a dish that was never claimed.
    let tookRight = false;
    if (nextLeft && isMeaningful(nextLeft.dish)) {
      dish = nextLeft.dish;
      take = nextLeft;
    } else {
      // A refusal inside the stretch of speech SPLITS it: "rice, no dal" is
      // "rice" — the dal was refused, not eaten. And when nothing is left
      // in front of the refusal, the meal itself was refused, so the text
      // before the meal word is NOT tried as a dish.
      const beforeRefusal = afterPre ? null : dishBeforeRefusal(segAfter);
      if (afterPre) {
        // The text behind the connector, up to the comma that parts the two
        // dishes.
        take = dishTake(src, { start: after, end: after + afterHead.length }, knownDish);
        dish = take.dish;
      } else {
        // The text behind the meal word. The dish is the part of it in FRONT
        // of the refusal — "rice, no dal" is "rice".
        //
        // WHY THE WHOLE TEXT IS ASKED ABOUT RATHER THAN THE PART IN FRONT:
        // the refusal word may be part of the dish's own name — "red lentil
        // curry without coconut" — and then the part in front of it is not the
        // dish but half of it.
        const span: Span = { start: after, end: after + segAfter.length };
        const isKnown = namesKnownDish(src.slice(span.start, span.end), knownDish);
        dish = isKnown ? tidy(segAfter) : tidy(beforeRefusal ?? segAfter);
        take = { span, dish, isKnown };
      }
      tookRight = true;
      if (!isMeaningful(dish) && !hasPrev && beforeRefusal === null) {
        // The first meal word, and nothing behind it either: the dish was
        // spoken before the meal word with no connector to say so.
        //
        // WHY THE REFUSAL IS TAKEN OUT OF IT: "no dal, biryani dinner" says
        // the same thing as "no dal, biryani for dinner" — the dal is refused
        // and the biryani is the dinner. With the refusal's own clause still
        // in the dish, the dish began with a refusal word and was thrown out
        // whole, so the biryani was dropped for the same reason.
        const span: Span = { start: prevEnd, end: mark.at };
        const isKnown = namesKnownDish(src.slice(span.start, span.end), knownDish);
        const afterClause = isKnown ? null : dishAfterLeadingRefusal(segBefore);
        dish = tidy(afterClause === null ? segBefore : afterClause);
        take = { span, dish, isKnown };
        tookRight = false;
      }
    }

    // Hand the next meal word the part of this stretch of text that is its
    // own: the tail when this meal took the head, and the whole of it when
    // this meal took its dish from the other side entirely.
    nextLeft = dishTake(
      src,
      tookRight
        ? {
            start: after + (commaAt >= 0 ? commaAt + 1 : afterFront.length),
            end: after + afterFront.length,
          }
        : { start: after, end: after + afterFront.length },
      knownDish,
    );

    // The dish this mention would file, kept even when the mention is
    // refused below: the refusal names the dish, and this is where that
    // dish is written down.
    mentions.push({
      slot: mark.slot,
      at: mark.at,
      len: mark.len,
      dish,
      span: take.span,
      isKnown: take.isKnown,
    });

    // A refusal is a refusal wherever it sits.
    //
    // "no dal for dinner" puts it in front of the dish, "lunch no dal" puts
    // it inside the dish, and "no lunch dal" puts it in front of the MEAL
    // WORD — the one shape the dish-only rule could not see.
    //
    // AND THAT SHAPE WAS NOT HARMLESS. The rule that keeps the LAST mention
    // of a meal then wrote the dish the user had REFUSED over the one they
    // had asked for: "lunch rice, no lunch dal" filed lunch as "dal" and
    // threw the rice away. A dish the user said they did not want is worse
    // than a missing one, because the shopping list buys it.
    //
    // WHY A DISH THE APP KNOWS IS NEVER TREATED AS A REFUSAL: the dish's own
    // name may begin with a refusal word — "No Onion No Garlic Lobia Masala"
    // — and then the word is part of the name and not a refusal at all.
    if ((NEGATION_RE.test(dish) && !take.isKnown) || (refusesBefore(segBefore) && !take.isKnown)) {
      continue;
    }

    // The LAST mention of a meal wins.
    //
    // WHY, AND WHY IT MATTERS: people correct themselves while they speak.
    // "Lunch rice, dinner dal, lunch salad" means SALAD — the second "lunch"
    // is the one the user settled on. The guard that kept the FIRST one
    // dropped the second dish on the floor: "salad" appeared nowhere on the
    // sheet, nowhere in the plan and nowhere in the shopping list, and
    // nothing anywhere said it had been heard. Words the user actually said
    // vanished without a trace, which is the one thing this parser must never
    // do — an empty slot is honest, and a silently discarded dish is not.
    //
    // The dish still has to be a real one: a meal word with nothing after it
    // ("...and breakfast") must not WIPE a dish that was already given.
    if (isMeaningful(dish)) {
      out[mark.slot] = dish;
    }
  }

  // A refusal removes the dish it names.
  //
  // WHY A SEPARATE PASS AND NOT ANOTHER RULE IN THE LOOP: the dish a
  // refusal names can sit on either side of the meal word — "no dal for
  // dinner" puts it in front, "no lunch dal" puts it behind — and the meal
  // that ends up holding it may have been filed by an EARLIER mention of the
  // same meal. The loop above only ever sees the text in front of the meal
  // word it is reading, so it cannot see that.
  //
  // WHY IT MATTERS: a dish the user said they did not want is not a MISSING
  // dish, it is a dish the shopping list BUYS. "dal for dinner, no dal" filed
  // the dinner as "dal" — the very dal the user had just refused — and
  // nothing anywhere said so: the sheet said the dinner had been heard and
  // the list bought it.
  for (const refusal of refusalsIn(src)) {
    // A refusal word that is part of a dish's own NAME is not a refusal.
    //
    // WHY: "no" and "without" are refusal words, and they are also parts of
    // 85 recipe names — "No Onion No Garlic Lobia Masala", "Red Lentil Curry
    // Without Coconut". The word alone cannot say which it is; the catalogue
    // can, and the phrase a meal took its dish from is what says whether the
    // word is inside that name.
    //
    // WHY IT MATTERS: the user asked for the dish. The refusal rule took the
    // word for a refusal, the dish was thrown out of the plan, and the sheet
    // said there was nothing to remove — so the user was told their dish had
    // been refused, and the shopping list bought nothing for that meal.
    const insideADishName = mentions.some(
      (m) => m.isKnown && refusal.at >= m.span.start && refusal.at < m.span.end,
    );
    if (insideADishName) continue;

    // The meal whose word FOLLOWS the refusal.
    //
    // WHY THERE MAY BE NO SUCH MEAL: the text held no meal word at all — "no
    // dal" on its own. That refusal is not thrown away: it names a dish and
    // no meal, so it is about every meal holding that dish, and the day is
    // the only thing that knows where that is.
    const forward = mentions.findIndex((m) => m.at > refusal.at);

    let named = '';

    // The meal a refusal that names NO DISH is about.
    //
    // WHY A REFUSAL CAN NAME A MEAL AND NO DISH: a refusal normally names a
    // dish — "no dal" refuses the dal — and the meal that loses it is the one
    // holding it. But "no breakfast" names a MEAL and no dish at all: the meal
    // word was taken as the meal the utterance was about, the refusal was left
    // naming nothing, and a refusal that names nothing was thrown away.
    //
    // So nothing was emptied, and the sheet said the app could not tell which
    // meal it was for — the opposite of the truth, because the meal WAS told.
    // It was the breakfast. And the sheet told the user to say the very thing
    // they had just said they did not want.
    //
    // The meal is worked out here, where the meal word the refusal is bound
    // to is in hand.
    let mealOnly: PlanSlot | null = null;

    // A refusal that POINTS BACK names the dish in front of it, and it is
    // checked BEFORE the two branches below because they both read the text
    // that FOLLOWS the refusal.
    //
    // WHY IT MATTERS: "for breakfast dal, no it, for lunch rice" refused the
    // dal only when the refusal was the last thing said. With a lunch after
    // it, the refusal was read as a refusal of the lunch, so it named no
    // dish at all, and the dal the user had refused stayed in the plan.
    const pointsBack = pointsBackAt(
      src,
      refusal,
      forward >= 0 ? mentions[forward].at : src.length,
    );

    if (pointsBack) {
      // The dish the pronoun points at: the most recent meal BEFORE the
      // refusal. When the refusal is the last thing said, that is the last
      // meal of all — the same dish the old rule named, so a refusal that
      // worked before still works.
      const before = mentions.filter((m) => m.at < refusal.at).pop();
      named = before ? before.dish : '';
    } else if (forward >= 0) {
      const bound = mentions[forward];
      if (refusalLinksToMeal(src, refusal.end, bound.at)) {
        // The meal word follows the refusal, so the dish the refusal names
        // is the one BEHIND the meal word.
        const after = bound.at + bound.len;
        const nextMark = unique.find((mk) => mk.at > bound.at);
        named = dishBetween(src, after, nextMark ? nextMark.at : src.length);
        // Nothing behind the meal word, so the refusal named the MEAL and no
        // dish — "no breakfast". The meal is what it refuses.
        if (!named) mealOnly = bound.slot;
      } else {
        // The dish the refusal names, up to the meal word it belongs to.
        //
        // WHY A COMMA LEAVES NOTHING NAMED: "dal for dinner, no, rice for
        // lunch" puts the rice behind the comma, and the rice is the lunch
        // the user wants — the "no" takes back the dal, and the dal is not
        // named by anything in this clause. So the clause names no dish, and
        // no dish is removed on the strength of it.
        named = dishBetween(src, refusal.end, bound.at);
      }
    } else {
      // The refusal came after the last meal word, so it names the dish in
      // front of it — "dal for dinner, no dal".
      //
      // WHY IT STOPS AT THE COMMA, LIKE THE OTHER TWO BRANCHES: a comma ends
      // the clause it is in, and a refusal is about the clause it was said in.
      // "no dal, biryani" refuses the dal and asks for the biryani — two
      // clauses. The refusal was naming "dal biryani", the whole rest of the
      // sentence, and that matches no dish on the day: NOTHING was emptied.
      // The dal the user had refused stayed on the plan, and the shopping
      // list buys the plan, so the list bought the very dish the user had
      // refused — while the sheet said the refusal had been heard.
      named = dishBetween(src, refusal.end, src.length);
    }

    // The meal that loses the dish.
    //
    // WHY THE MEAL THAT HOLDS THE DISH AND NOT THE ONE THE REFUSAL IS BOUND
    // TO: a refusal names a DISH, and the dish belongs to the meal that holds
    // it. The refusal is bound to the meal whose word FOLLOWS it, or to the
    // meal it was said after — and that is not always the meal the dish was
    // filed under. "breakfast oats, lunch rice, no oats" binds the refusal to
    // the LUNCH, but the oats are the BREAKFAST's dish: the refusal named
    // oats, the breakfast was holding oats, and the oats stayed in the plan.
    //
    // WHY IT MATTERS: that is the same bug this whole pass exists to kill.
    // The shopping list buys the plan, so a refused dish that stays in the
    // plan is a dish the list buys — and the sheet says the meal was heard.
    //
    // WHY A REFUSAL THAT NAMED A MEAL IS NOT THROWN AWAY HERE: a refusal
    // that names a MEAL and no dish has no dish to take away, but the MEAL is
    // what the user refused. "no breakfast" empties the breakfast, whatever
    // is on it — and the shopping list buys the plan, so a breakfast the user
    // refused and that stayed on the plan is a breakfast the list buys.
    if (!named) {
      if (mealOnly) refusals.push({ slot: mealOnly, dish: '' });
      continue;
    }

    // A refusal that POINTS BACK names ONE dish: the one the pronoun points
    // at, which is the dish in FRONT of the refusal.
    //
    // WHY IT IS NOT THE MEAL AFTER THE REFUSAL: the pronoun points BACK.
    // "breakfast dal, no it, lunch dal" refuses the BREAKFAST's dal. Taking
    // the dish from the meal after the refusal took the dal the user had
    // asked for and left the dal they had refused — the exact opposite of
    // what was said, and the dal the user refused is the one the shopping
    // list buys.
    if (pointsBack) {
      const before = mentions.filter((m) => m.at < refusal.at).pop();
      if (before && namesHeldDish(named, out[before.slot])) delete out[before.slot];
      // The pronoun points at ONE meal's dish, and that is the meal the
      // refusal is about.
      if (before) refusals.push({ slot: before.slot, dish: named });
      continue;
    }

    // WHY ONLY A REFUSAL THAT STANDS ALONE MAY REACH FOR ANOTHER MEAL: the
    // refusal is bound to the meal it was said about, and a refusal that
    // NAMES a meal as well belongs to that meal. "dal for dinner, rice no dal
    // for lunch" says "for lunch it is rice, not dal" — the dal there is the
    // one the user does NOT want FOR LUNCH, and the dal the dinner was given
    // is a dish they did ask for. So a refusal whose own clause names a meal
    // may only take a dish from THAT meal.
    //
    // WHY THE MEAL HAS TO FOLLOW THE REFUSAL: the meal the refusal NAMES is
    // the one whose word comes after it — "no dal FOR LUNCH" names the lunch.
    // A meal spoken BEFORE the refusal is not named by it: in "dal for
    // breakfast, dal for lunch, no dal" the breakfast was mentioned before
    // the refusal and the refusal says nothing about it, so the refusal
    // stands alone and the dal is refused wherever it is.
    const clauseEnd = clauseEndOf(src, refusal);
    // The meal this refusal is bound to, when it named one: a meal word
    // after the refusal, inside the refusal's own clause. It is the same
    // meal as `forward` names — a meal word cannot fit between the refusal
    // and the end of the word the refusal is made of.
    const boundSlot = mentions.find(
      (m) => m.at >= refusal.end && m.at < clauseEnd,
    )?.slot;
    if (boundSlot) {
      if (namesHeldDish(named, out[boundSlot])) delete out[boundSlot];
      // The refusal named a meal, so it is about that meal and no other.
      refusals.push({ slot: boundSlot, dish: named });
      continue;
    }

    // A refusal that stands alone names a DISH and no meal, so the dish is
    // refused wherever the plan is holding it.
    //
    // WHY EVERY MEAL THAT HOLDS IT AND NOT ONLY ONE: "breakfast dal, lunch
    // dal, no dal" — the user refused the dal, and BOTH meals were holding
    // it. Taking it from one of them left the dal in the other, and the
    // shopping list buys the plan, so the list bought the very dal the user
    // had refused while the sheet said the meal had been heard. An empty slot
    // is honest; a dish the user refused is one the list buys.
    for (const m of mentions) {
      if (namesHeldDish(named, out[m.slot])) delete out[m.slot];
    }

    // The refusal stands alone: it named a dish and no meal, so the dish is
    // refused wherever it is being held — in the plan the utterance is
    // describing, and in the day the app is holding.
    refusals.push({ slot: null, dish: named });
  }
  return { plan: out, refusals };
}

/** What the parser found, phrased for a person. */
export function describePlan(plan: SpokenPlan): string {
  const rows: { slot: PlanSlot; label: string }[] = [
    { slot: 'breakfast', label: 'Breakfast' },
    { slot: 'lunch', label: 'Lunch' },
    { slot: 'dinner', label: 'Dinner' },
  ];
  const filled = rows.filter((r) => plan[r.slot]);
  if (!filled.length) return '';
  return filled.map((r) => `${r.label}: ${plan[r.slot]}`).join('\n');
}

/** MealType for the app's slot ids, so the result can be applied directly. */
export const slotToMealType = (slot: PlanSlot): MealType => slot as MealType;