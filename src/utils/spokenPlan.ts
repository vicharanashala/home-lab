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

/** A dish the user explicitly did NOT want. "no dal for dinner" is not dal. */
const NEGATION_RE = /^\s*(?:no|not|without|skip|avoid)\b\s*/i;

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
 * Parse spoken text into slots.
 *
 * Returns only the meals that were actually named — a partial dict is a
 * legitimate result and the caller fills just those slots.
 */
export function parseSpokenPlan(text: string): SpokenPlan {
  const src = (text || '').trim();
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
  if (leadPre) nextLeftDish = tidy(leadPre[1]);

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
      dish = afterPre ? tidy(afterHead) : tidy(segAfter);
      tookRight = true;
      if (!isMeaningful(dish) && !hasPrev) {
        // The first meal word, and nothing behind it either: the dish was
        // spoken before the meal word with no connector to say so.
        dish = tidy(segBefore);
        tookRight = false;
      }
    }

    // Hand the next meal word the part of this stretch of text that is its
    // own: the tail when this meal took the head, and the whole of it when
    // this meal took its dish from the other side entirely.
    nextLeftDish = tookRight ? tidy(afterTail) : tidy(afterFront);

    // "no dal for dinner" is a refusal, not a dish. Leave the slot alone
    // rather than writing a dish the user said they did not want.
    if (NEGATION_RE.test(dish)) continue;

    if (isMeaningful(dish) && !out[mark.slot]) {
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