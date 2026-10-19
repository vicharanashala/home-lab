import type { CategoryId } from '../types';
import { suggestCategory } from './categorySuggest';

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
 * Try to pull a quantity+unit prefix out of a line so we can capture
 * "1 cup of tomatoes" -> { name: "tomatoes", quantity: "1 cup" }.
 *
 * Matches the lead "1 cup", "2 tbsp", "500 g", "1/2 kg", "3 cloves",
 * "1 medium", "1 pinch", "1 dozen", etc. Returns "" if nothing
 * recognizable shows up first.
 */
function extractQuantity(line: string): { quantity: string; rest: string } {
  // Common quantity + unit patterns at start of line.
  const patterns: RegExp[] = [
    // "1/2 cup", "1.5 kg", "2 tbsp" with unit
    /^(\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*(cup|tbsp|tsp|tablespoon|teaspoon|kg|g|gram|grams|ml|l|liter|litre|pcs|piece|pieces|packets?|dozen|clove|cloves|pinch|dash|bunch|handful)s?\b\s+(?:of\s+)?(.+)$/i,
    // "1 cup of", "2 tablespoons of"
    /^(\d+(?:\.\d+)?)\s+(cup|tbsp|tsp|tablespoon|teaspoon|kg|g|gram|grams|ml|l|liter|litre|pcs|piece|pieces|packets?|dozen|clove|cloves|pinch|dash|bunch|handful)s?\s+(?:of\s+)?(.+)$/i,
    // "500 g", "1.5 kg" with unit
    /^(\d+(?:\.\d+)?)\s*(kg|g|ml|l|gram|grams|liter|litre)s?\b\s*(?:of\s+)?(.+)$/i,
    // "1 medium", "2 large", "1 small" (size adjectives)
    /^(\d+)\s+(medium|large|small|big|whole)\s+(.+)$/i,
    // "3 cloves", "2 pieces", "1 bunch"
    /^(\d+)\s+(clove|cloves|piece|pieces|pcs|packets?|pack|dozen|bunch|bunches|handful)s?\s+(?:of\s+)?(.+)$/i,
  ];

  for (const re of patterns) {
    const m = line.match(re);
    if (m) {
      const qty = m[1];
      const unitWord = m[2] || '';
      const rest = (m[3] || '').trim();
      // If the rest looks like another ingredient (not a verb), accept it.
      if (rest.length >= 2 && /^[a-z]/.test(rest)) {
        const q = unitWord ? `${qty} ${unitWord.toLowerCase()}` : `${qty}`;
        return { quantity: q, rest };
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