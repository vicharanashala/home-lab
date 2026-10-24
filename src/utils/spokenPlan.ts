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
 * True when the text ENDS with a refusal word that is attached to whatever
 * comes next.
 *
 * "no lunch dal" refuses the lunch — the refusal sits in front of the MEAL
 * WORD, which is the one place the dish-only rule could not see it.
 *
 * WHY ONLY WHITESPACE BETWEEN: "fish, no, lunch rice" puts a comma between
 * the refusal and the meal word, so the refusal belongs to the meal before
 * it and the lunch is a dish of its own.
 */
function refusesBefore(text: string): boolean {
  const m = text.toLowerCase().match(/([a-z]+)\s*$/);
  return !!m && REFUSAL_WORDS.includes(m[1]);
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
  type Mark = { at: number; slot: PlanSlot; len: number };
  const marks: Mark[] = [];
  for (const { re, slot } of SLOT_WORDS) {
    // Match EVERY occurrence of the word, not just the first. "lunch rice,
    // dinner dal, lunch salad" used to stop at the first "lunch", so the text
    // after the second one was merged into the dinner dish.
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = global.exec(src)) !== null) {
      marks.push({ at: m.index, slot, len: m[0].length });
      if (m.index === global.lastIndex) global.lastIndex += 1;
    }
  }
  if (!marks.length) return {};

  // Overlapping rules can flag the same word twice; keep the earliest at each
  // spot.
  marks.sort((a, b) => a.at - b.at);
  const unique: Mark[] = [];
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