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

/** Phrases that carry no dish information and should never end up as a dish. */
const NOISE = new Set([
  'and', 'then', 'also', 'with', 'plus', 'for', 'the', 'a', 'an', 'is', 'are',
  'was', 'were', 'be', 'been', 'am', 'i', 'we', 'will', 'would', 'have', 'has',
  'had', 'having', 'to', 'eat', 'today', 'tomorrow', 'my', 'plan', 'meal',
  'meals', 'cook', 'cooking', 'please', 'ok', 'okay', 'so', 'just', 'some',
  'of', 'it', 'in', 'on', 'at', 'get', 'got', 'like', 'about',
]);

function tidy(text: string): string {
  let out = text
    .toLowerCase()
    .replace(/[.,!?;:"'`]/g, ' ')
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
    const m = re.exec(src);
    if (m) marks.push({ at: m.index, slot, len: m[0].length });
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
  for (let i = 0; i < unique.length; i++) {
    const after = unique[i].at + unique[i].len;
    const nextAt = i + 1 < unique.length ? unique[i + 1].at : src.length;
    let dish = tidy(src.slice(after, nextAt));

    // "we will have dal makhani for dinner" puts the meal word LAST. With
    // nothing after it, the dish is what came before, minus the marker.
    if (!isMeaningful(dish) && unique.length === 1) {
      dish = tidy(src.slice(0, unique[i].at));
    }

    if (isMeaningful(dish) && !out[unique[i].slot]) {
      out[unique[i].slot] = dish;
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