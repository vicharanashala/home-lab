import type { CategoryId } from '../types';
import { suggestCategory } from './categorySuggest';
import { spellQuantity } from './groceryQuantity';

// A small keyword map that mirrors categorySuggest but is plural-aware so
// "tomatoes" / "potatoes" / "lentils" don't fall back to 'other'.
const PLURAL_KEYWORDS: { category: CategoryId; words: string[] }[] = [
  { category: 'vegetables', words: [
    'tomato', 'potato', 'onion', 'carrot', 'spinach', 'broccoli', 'cucumber',
    'lettuce', 'cabbage', 'cauliflower', 'capsicum', 'pepper', 'pumpkin',
    'zucchini', 'eggplant', 'brinjal', 'okra', 'bhindi', 'beetroot', 'radish',
    'mooli', 'turnip', 'leek', 'celery', 'coriander', 'mint', 'kale',
    'arugula', 'methi', 'drumstick', 'mushroom', 'ginger', 'garlic',
    'green bean', 'peas', 'corn', 'snow pea', 'asparagus', 'artichoke',
  ]},
  { category: 'fruits', words: [
    'apple', 'banana', 'mango', 'orange', 'grape', 'berry', 'strawberry',
    'blueberry', 'raspberry', 'watermelon', 'pineapple', 'pear', 'peach',
    'plum', 'cherry', 'kiwi', 'papaya', 'guava', 'pomegranate', 'lemon',
    'lime', 'coconut', 'fig', 'date', 'apricot', 'avocado',
  ]},
  { category: 'dairy', words: [
    'milk', 'butter', 'cheese', 'yogurt', 'yoghurt', 'curd', 'ghee',
    'cream', 'lassi', 'kefir', 'khoya',
  ]},
  { category: 'meat', words: [
    'chicken', 'mutton', 'beef', 'pork', 'lamb', 'turkey', 'duck',
    'bacon', 'sausage', 'ham',
  ]},
  { category: 'seafood', words: [
    'fish', 'salmon', 'tuna', 'cod', 'sardine', 'mackerel', 'shrimp',
    'prawn', 'crab', 'lobster', 'squid', 'octopus',
  ]},
  { category: 'bakery', words: [
    'bread', 'roti', 'naan', 'bun', 'cake', 'pastry', 'croissant',
    'bagel', 'muffin', 'pita', 'paratha', 'chapati', 'kulcha',
  ]},
  { category: 'grains', words: [
    'rice', 'wheat', 'flour', 'maida', 'atta', 'dal', 'lentil', 'bean',
  ]},
];

function pluralAwareCategory(name: string, fallback: CategoryId): CategoryId {
  const lower = name.toLowerCase().trim();
  // Try the name as-is first, then a stripped-plural form (tomato,
  // potato, lentil, etc.).
  const candidates = [lower];
  if (/(oes|ses|ches|shes|xes|zes)$/.test(lower)) candidates.push(lower.slice(0, -2));
  else if (/([^s])s$/.test(lower) && lower.length > 4) candidates.push(lower.slice(0, -1));

  for (const cand of candidates) {
    for (const { category, words } of PLURAL_KEYWORDS) {
      for (const w of words) {
        const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`);
        if (re.test(cand)) return category;
    }
  }
  }
  return fallback;
}

export interface ParsedGroceryItem {
  name: string;
  quantity: string;
  category: CategoryId;
}

/**
 * Strip markdown emphasis and leading bullet markers from a line.
 *  - "  - **Tomatoes**"      -> "Tomatoes"
 *  - "*Tomatoes*"            -> "Tomatoes"
 *  - "1. **Onion** — 1 pc"   -> "Onion — 1 pc"
 */
function cleanBullet(raw: string): string {
  let s = raw.trim();
  // Strip leading bullet / number markers.
  s = s.replace(/^([-*•·]|\d+\.)\s+/, '');
  // Strip bold/italic markdown.
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/_([^_]+)_/g, '$1');
  return s.trim();
}

/**
 * The units the parser recognises, each carrying its own plural.
 *
 * WHY EACH ONE CARRIES ITS OWN PLURAL AND NOT ONE "s?" AFTER THE LIST: the
 * old list put the "s?" outside the group that captures the word, so the
 * group took the SINGULAR and the "s?" ate the rest — "2 cloves" was written
 * "2 clove" and "200 grams" was written "200 gram". The plural is part of
 * the word, so it belongs inside the group.
 *
 * WHY THE PLURAL IS KEPT AT ALL: the app has one rule for writing a
 * quantity — `formatQuantity` — and that rule decides whether the unit reads
 * as singular from the NUMBER and the unit together: "1 pc" but "2 pcs",
 * "1 clove" but "2 cloves". A parser that throws the plural away cannot ask
 * that rule the question, and so writes a word the app never writes.
 *
 * WHY "bunch", "dash" AND "pinch" CARRY AN "es" OF THEIR OWN: English
 * plurals are not always the stem plus an "s" — a bunch is "bunches", a dash
 * is "dashes" and a pinch is "pinches" — so each of those three has to be
 * written as the stem on its own OR the stem plus "es". Writing them as
 * "bunches?" alone would leave the singular form of the word unrecognised.
 *
 * WHY "pc" AND "bottles?" ARE IN THE LIST: the list has to hold every word
 * the app's own rule can WRITE, because the House Bot writes the shopping list
 * back in the app's own spelling. `formatQuantity` writes a quantity of one
 * with a SINGULAR unit, so the two words the rule produces out of the units
 * the kitchen actually uses are:
 *
 *     the unit "pcs"      ->  "1 pc"        the DEFAULT unit for a new item
 *     the unit "bottles"  ->  "1 bottle"    one of the nine the add form offers
 *
 * Neither word was in the list, so the bullet the House Bot wrote back — the
 * very spelling the app had shown it — could not be read:
 *
 *     "- 1 pc of eggs"      ->  an item called "pc of eggs", quantity "1"
 *     "- 1 bottle of milk"  ->  an item called "bottle of milk", quantity "1"
 *
 * The unit ends up in the item's NAME, and stock matching is exact, so the row
 * the household shops from and the row on the shelf are two different things.
 *
 * WHY "slices" IS IN THE LIST: the app has THREE recipe catalogues, and the
 * built-in Indian one measures Bread in slices:
 *
 *     ['Bread', 6, 'slices']   Bread pakora
 *     ['Bread', 4, 'slices']   Shahi tukda
 *
 * The Meal Plan writes that ingredient onto the shopping list with the app's
 * own rule, so the list says "6 slices" — and the House Bot could not read it
 * back:
 *
 *     "- 6 slices of bread"  ->  an item called "slices of bread", quantity "6"
 *
 * The unit is in the NAME again, and the quantity has lost its unit, which is
 * the same failure as "pc" and "bottle" and for the same reason: the list has
 * to hold every word the app can write. The round-trip test reads the units
 * out of all three catalogues and out of the add form, so a unit added to any
 * of them turns that test RED until it is written here — which is the drift
 * this list is prone to and the one the test exists to catch.
 *
 * WHY THE LIST IS GROUPED THE WAY `units.ts` GROUPS ITS TABLES: the app has
 * one table of the units it understands, and it is published as
 * `KNOWN_UNITS` from there. The stock unit field is FREE TEXT — the Edit
 * Stock form is an input with a datalist, not a select — so a household can
 * write any unit onto a stock row, and the app's own rule writes that unit
 * onto the shopping list as it was typed:
 *
 *     the stock row's unit   "ounce"
 *     the shopping list      "6 ounces"
 *
 * The words below are that table's words, with their plurals, and the few
 * words the kitchen counts in that the table does not carry — packs, packets,
 * cloves, bottles, slices, bunches and handfuls.
 */
const UNIT_WORDS =
  'grams?|g|kgs?|kilograms?|oz|ounces?|lbs?|pounds?' +
  '|ml|millilitres?|milliliters?|l|liters?|litres?' +
  '|pcs|pc|pieces?|packs?|packets?|dozens?|cloves?|bottles?|slices?|units?' +
  '|tbsp|tbs?|tsps?|tablespoons?|teaspoons?|cups?' +
  '|pinch(?:es)?|dash(?:es)?|bunch(?:es)?|handfuls?';

/**
 * Write the quantity the way the app writes every quantity.
 *
 * WHY THE APP'S OWN RULE: the shopping list is ONE list, and the Stock row,
 * the Alerts screen, the Meal Plan and the House Bot all write into it.
 * Every line on that list has to be written the same way, or the list reads
 * as though it were two lists. The Stock row writes "1 pc" (see
 * `groceryQuantityForStock`), and this used to write "1 pcs" — the same
 * quantity, one number, two spellings, on one list. "pcs" is the default unit
 * for a new item, so a quantity of one is the commonest quantity in the
 * kitchen and this was the commonest way for the list to contradict itself.
 *
 * WHY THE UNIT IS LOWER-CASED HERE: the unit is a word the kitchen types and
 * the model writes, and the app writes its units in lower case — "kg", "tbsp",
 * "pcs". The rule is told the unit the way the app writes it.
 *
 * @param qty the number as the bullet wrote it
 * @param unit the unit as the bullet wrote it
 * @returns the quantity — "1 pc", "2 pcs", "1/2 cup"
 */
function writeQuantity(qty: string, unit: string): string {
  if (!unit) return qty;
  return spellQuantity(`${qty} ${unit.toLowerCase()}`);
}

/**
 * Try to pull a quantity+unit prefix out of a line so we can capture
 * "1 cup of tomatoes" -> { name: "tomatoes", quantity: "1 cup" }.
 *
 * Matches the lead "1 cup", "2 tbsp", "500 g", "1/2 kg", "3 cloves",
 * "1 medium", "1 pinch", "1 dozen", etc. Returns "" if nothing
 * recognizable shows up first.
 */
function extractQuantity(line: string): { quantity: string; rest: string } {
  // Common quantity + unit patterns at start of line.
  //
  // WHY THE PATTERNS ARE BUILT FROM ONE LIST OF UNITS: the old code wrote the
  // list out five times and the copies had drifted — one knew "cloves" and
  // another knew only "clove", and one knew "grams" and another did not. One
  // list is also the only way to be sure every pattern knows the same units.
  const patterns: RegExp[] = [
    // "1/2 cup", "1.5 kg", "2 tbsp" with unit
    new RegExp(
      `^(\\d+\\s*/\\s*\\d+|\\d+(?:\\.\\d+)?)\\s*(${UNIT_WORDS})\\b\\s+(?:of\\s+)?(.+)$`,
      'i',
    ),
    // "1 cup of", "2 tablespoons of"
    new RegExp(
      `^(\\d+(?:\\.\\d+)?)\\s+(${UNIT_WORDS})\\b\\s+(?:of\\s+)?(.+)$`,
      'i',
    ),
    // "500 g", "1.5 kg" with unit — no space on either side of the unit
    new RegExp(
      `^(\\d+(?:\\.\\d+)?)\\s*(${UNIT_WORDS})\\b\\s*(?:of\\s+)?(.+)$`,
      'i',
    ),
    // "1 medium", "2 large", "1 small" (size adjectives)
    /^(\d+)\s+(medium|large|small|big|whole)\s+(.+)$/i,
    // "3 cloves", "2 pieces", "1 bunch"
    new RegExp(`^(\\d+)\\s+(${UNIT_WORDS})\\b\\s+(?:of\\s+)?(.+)$`, 'i'),
  ];

  for (const re of patterns) {
    const m = line.match(re);
    if (m) {
      const qty = m[1];
      const unitWord = m[2] || '';
      const rest = (m[3] || '').trim();
      // If the rest looks like another ingredient (not a verb), accept it.
      //
      // WHY A CAPITAL LETTER IS ACCEPTED NOW: the kitchen writes its
      // ingredients in capitals — the catalogue's own strings are "Onion -
      // sliced", "Fresh coconut - grated", "Green Chillies - slit" — and so
      // does the House Bot. The old rule asked for a lower-case letter, so it
      // did not fire for them, the bullet fell through to the bare-number
      // rule, and the unit stayed in the item's NAME:
      //
      //     "- 1 kg Rice"    ->    an item called "kg Rice", quantity "1"
      //
      // The shopping list showed "kg Rice · 1" instead of "Rice · 1 kg", and
      // an item called "kg Rice" can never match the kitchen's "Rice" — stock
      // matching is exact.
      if (rest.length >= 2 && /^[a-z]/i.test(rest)) {
        return { quantity: writeQuantity(qty, unitWord), rest };
      }
    }
  }

  // Bare integer prefix like "1 onion" / "2 onions" — there is no unit
  // word, so the name is the SECOND group and there is no third one. This
  // used to sit in the pattern list above, where the code read the unit from
  // group 2 and the name from group 3: group 3 was empty, so the match was
  // thrown away and the line fell through with the count still glued to the
  // name — "2 onions" became an item literally called "2 onions", quantity 1,
  // which then never matched a stock item called "Onion".
  const bare = line.match(/^(\d+)\s+([a-z].{2,})$/i);
  if (bare) {
    const rest = bare[2].trim();
    if (rest.length >= 2) return { quantity: bare[1], rest };
  }

  return { quantity: '', rest: line };
}

/**
 * A preparation note written after a dash: "Onion - sliced".
 *
 * WHY IT IS ITS OWN PATTERN: the dash comes in three shapes — an em dash
 * "—", an en dash "–" and a hyphen "-" — and the catalogue writes all three,
 * so all three have to be recognised here.
 *
 * WHY THE DASH HAS TO BE SURROUNDED BY SPACES: a name that merely contains
 * a hyphen is a name — "Semi-dried tomatoes", "Cashew-nut powder" — and must
 * survive untouched.
 */
const PREPARATION_NOTE = /\s+[—–-]\s+(.*)$/;

/**
 * A note that says the line needs other things describes a DISH.
 *
 * "Kadhai paneer — needs paneer, tomato, onion" is a dish and what it is
 * made of, not an ingredient. "Green peas — with pod" is an ingredient and
 * how to prepare it. The difference is whether the note names OTHER things
 * to buy: a dish lists them, a preparation note does not.
 */
const DESCRIBES_A_DISH =
  /^(?:needs?\b|you will need\b|contains?\b|ingredients?\b|make with\b|made with\b)/i;

/**
 * Does this text name something you can buy?
 *
 * THE HOUSE'S OWN CATEGORY VOCABULARY IS THE ORACLE: the kitchen already
 * knows how to categorise "tomato", "paneer" and "ghee", and it has no idea
 * what to do with "optional", "grated" or "for serving" — so a word the
 * categoriser recognises is a thing to buy, and a word it does not
 * recognise is a preparation detail.
 */
function namesSomethingToBuy(text: string): boolean {
  const cleaned = text.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return false;
  return (
    suggestCategory(cleaned, 'other') !== 'other' ||
    pluralAwareCategory(cleaned, 'other') !== 'other'
  );
}

/**
 * A note that LISTS things you can buy describes a DISH.
 *
 * WHY A COMMA ALONE IS NOT ENOUGH: the House Bot writes "Sugar — ½ tsp,
 * optional" and "Fresh coconut — ½ cup, grated". The comma there separates
 * a quantity from a preparation detail, not one ingredient from another.
 * The rule that read any comma as a dish threw the sugar and the coconut
 * away with the note — the exact failure the preparation-note rule exists
 * to prevent.
 *
 * SO THE PARTS HAVE TO NAME SOMETHING YOU CAN BUY: a preparation detail
 * ("optional", "grated", "for serving") names nothing you can buy, so a
 * note made of those is a preparation note and the ingredient stays. A
 * note that names two or more real ingredients — "paneer, tomato, onion" —
 * is a dish listing what it is made of, and a dish is not an item.
 *
 * WHY TWO AND NOT ONE: one part naming an ingredient is not an
 * enumeration, it is a note that mentions a side ("paneer, chopped"). Two
 * parts that both name something to buy is a list, and a list in a note
 * means the line is a dish.
 */
function noteListsThingsToBuy(tail: string): boolean {
  const parts = tail.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.filter(namesSomethingToBuy).length >= 2;
}

/**
 * Extract a clean display name from a line, stripping trailing
 * quantity/unit annotations like "(about 2 cups)" or "— 1 tbsp" so the
 * grocery item shows up as just "Onion" instead of "Onion — 1 tbsp".
 */
function extractName(line: string): string {
  let s = line;
  // Strip trailing parenthetical hints.
  s = s.replace(/\s*\([^)]*\)\s*$/, '');
  // Strip trailing "— quantity" / "- quantity" / ", quantity".
  s = s.replace(/\s*[—\-:]\s*(?:\d.*|a pinch|a handful|to taste|as needed|as required)\s*$/i, '');
  s = s.replace(/\s*,\s*(?:\d.*|a pinch|a handful|to taste|as needed|as required)\s*$/i, '');

  // A note after a dash is not part of the name.
  //
  // WHY THE NOTE IS STRIPPED AND THE LINE KEPT: the catalogue writes
  // 16,420 of its 70,093 ingredient strings in this shape — "Onion - sliced",
  // "Fresh coconut - grated", "Sunflower Oil - for cooking" — and the House
  // Bot is fed those strings verbatim in its RECIPES context block, so it
  // writes its grocery list in the same shape. A rule that dropped every
  // line with a dash in it threw the onion away with the note: the shopping
  // list came back short, and the name that DID survive ("Onion - sliced")
  // matched no stock item called "Onion", because matching is exact.
  //
  // WHY A DISH IS STILL NOT AN ITEM: a bullet that names a dish and then
  // says what it is made of is not something to buy. So a note that lists
  // other things to buy — it enumerates them, or it says the line needs
  // them — means the line is a dish, and the line is not an item.
  const note = s.match(PREPARATION_NOTE);
  if (note) {
    const tail = note[1].trim();
    if (DESCRIBES_A_DISH.test(tail) || noteListsThingsToBuy(tail)) return '';
    s = s.slice(0, note.index);
  }
  return s.trim();
}

/**
 * Parse an LLM reply into a deduplicated list of grocery items.
 *
 * Recognised patterns (one per line):
 *  - "- Tomatoes"
 *  - "* 2 cups of rice"
 *  - "1. **Onion** — 1 pc"
 *  - "  - **Garlic** (3 cloves)"
 *
 * Lines that look like section headings (end with ":" or "Recipe:" /
 * "Ingredients:") are skipped.
 *
 * Returns at most `limit` items.
 */
export function parseGroceryList(
  text: string,
  limit = 30,
): ParsedGroceryItem[] {
  const seen = new Set<string>();
  const out: ParsedGroceryItem[] = [];
  const lines = text.split(/\n+/);

  for (const raw of lines) {
    if (out.length >= limit) break;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Must start with a bullet/number marker.
    if (!/^([-*•·]|\d+\.)\s+/.test(trimmed)) continue;

    const bullet = cleanBullet(trimmed);
    if (!bullet) continue;
    // Section heading? "Butter Chicken:" / "Ingredients:" — skip.
    if (/[:]\s*$/.test(bullet) || /^(ingredients|steps?|method|directions|notes?)\s*:/i.test(bullet)) continue;
    // Skip if it's a sentence (>= 8 words) — bullets we want are short
    // noun phrases, not paragraphs.
    const wordCount = bullet.split(/\s+/).length;
    if (wordCount > 8) continue;

    const { quantity, rest } = extractQuantity(bullet);
    const cleanedName = extractName(rest || bullet);
    if (!cleanedName) continue;
    // Reject lines that are still mostly a sentence (no real ingredient).
    if (cleanedName.length < 2) continue;

    // Normalise the name for dedup (lowercase, trim punctuation).
    const norm = cleanedName.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(norm)) continue;
    seen.add(norm);

    const baseCategory = suggestCategory(cleanedName, 'other');
    const category = baseCategory === 'other'
      ? pluralAwareCategory(cleanedName, 'other')
      : baseCategory;
    out.push({
      name: cleanedName,
      quantity: quantity || '1',
      category,
    });
  }

  return out;
}