import type { MealType } from '../types';

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
 */
const REFUSAL_WORDS = ['no', 'not', 'without', 'skip', 'avoid', 'do not', 'nope', 'nah'];

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
  const base = tidy(withoutConnector ? withoutConnector[1] : text);
  return base.split(' ').filter((w) => w && !REFUSAL_FILLERS.has(w)).join(' ');
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

function tidy(text: string): string {
  let out = text
    .toLowerCase()
    .replace(/[.,!?;:"'`]/g, ' ')
    .replace(TIME_RE, ' ')
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
 */
function dishWithoutRefusal(text: string): string {
  const before = dishBeforeRefusal(text);
  if (before === null) return text;
  return tidy(before) ? before : text;
}

/**
 * Parse spoken text into slots.
 *
 * Returns only the meals that were actually named — a partial dict is a
 * legitimate result and the caller fills just those slots.
 */
export function parseSpokenPlan(text: string): SpokenPlan {
  // The contraction is expanded first so that EVERY rule below — the one
  // that reads the text in front of a meal word and the one that reads the
  // dish itself — sees the refusal in the same words.
  const src = (text || '').trim().replace(CONTRACTED_REFUSAL_RE, 'do not');
  if (!src) return {};

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
  if (!marks.length) return {};

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
  let nextLeftDish = '';

  /**
   * Every meal the text mentioned, with the dish each one would file.
   *
   * WHY THIS IS COLLECTED: the dish a refusal names may have been filed by an
   * EARLIER mention of the same meal — "lunch rice, no lunch rice" files the
   * rice on the first mention and refuses it on the second — and by the time
   * the loop is over, this is the only place that answer is.
   */
  const mentions: { slot: PlanSlot; at: number; len: number; dish: string }[] = [];

  // The text before the FIRST meal word can only be that meal's own: there
  // is no meal before it that could have claimed it.
  const leadPre = src.slice(0, unique[0].at).match(PRE_CONNECTOR_RE);
  if (leadPre) nextLeftDish = tidy(dishWithoutRefusal(leadPre[1]));

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
    const afterTail = commaAt >= 0 ? afterFront.slice(commaAt + 1) : '';

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
    // Which side of THIS meal word the dish was taken from, so the next
    // meal word can tell a repeated dish from a dish that was never claimed.
    let tookRight = false;
    if (isMeaningful(nextLeftDish)) {
      dish = nextLeftDish;
    } else {
      // A refusal inside the stretch of speech SPLITS it: "rice, no dal" is
      // "rice" — the dal was refused, not eaten. And when nothing is left
      // in front of the refusal, the meal itself was refused, so the text
      // before the meal word is NOT tried as a dish.
      const beforeRefusal = afterPre ? null : dishBeforeRefusal(segAfter);
      dish = afterPre
        ? tidy(dishWithoutRefusal(afterHead))
        : tidy(beforeRefusal ?? segAfter);
      tookRight = true;
      if (!isMeaningful(dish) && !hasPrev && beforeRefusal === null) {
        // The first meal word, and nothing behind it either: the dish was
        // spoken before the meal word with no connector to say so.
        dish = tidy(segBefore);
        tookRight = false;
      }
    }

    // Hand the next meal word the part of this stretch of text that is its
    // own: the tail when this meal took the head, and the whole of it when
    // this meal took its dish from the other side entirely.
    nextLeftDish = tookRight
      ? tidy(dishWithoutRefusal(afterTail))
      : tidy(dishWithoutRefusal(afterFront));

    // The dish this mention would file, kept even when the mention is
    // refused below: the refusal names the dish, and this is where that
    // dish is written down.
    mentions.push({ slot: mark.slot, at: mark.at, len: mark.len, dish });

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
    if (NEGATION_RE.test(dish) || refusesBefore(segBefore)) continue;

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
    // The meal this refusal belongs to: the one whose word FOLLOWS it, or
    // the one it was said after.
    const forward = mentions.findIndex((m) => m.at > refusal.at);
    const bound = forward >= 0 ? mentions[forward] : mentions[mentions.length - 1];
    if (!bound) continue;

    let named = '';

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
      if (refusalLinksToMeal(src, refusal.end, bound.at)) {
        // The meal word follows the refusal, so the dish the refusal names
        // is the one BEHIND the meal word.
        const after = bound.at + bound.len;
        const nextMark = unique.find((mk) => mk.at > bound.at);
        named = dishBetween(src, after, nextMark ? nextMark.at : src.length);
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
      named = dishOf(src.slice(refusal.end));
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
    if (!named) continue;

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
      if (before && out[before.slot] === named) delete out[before.slot];
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
    const attachedToAMeal = mentions.some(
      (m) => m.at >= refusal.end && m.at < clauseEnd,
    );
    if (attachedToAMeal) {
      if (out[bound.slot] === named) delete out[bound.slot];
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
      if (out[m.slot] === named) delete out[m.slot];
    }
  }
  return out;
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