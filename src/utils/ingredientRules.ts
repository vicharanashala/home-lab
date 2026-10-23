import type { CategoryId } from '../types';

/**
 * Ingredient rules — the shared vocabulary behind the household diet and the
 * per-day modes (vrat, no-onion-garlic, …).
 *
 * The catalogue is not uniformly tagged. The built-in recipes carry a
 * `category` on every ingredient, but the 5,894 CSV recipes carry none at
 * all — so a category-only check filters nothing in the catalogue where
 * almost all the recipes live. Every rule here therefore matches on the
 * ingredient NAME, and the category is used as an extra signal where it
 * happens to exist.
 *
 * Names are matched on word boundaries with an optional plural, so "dalia" is
 * not "dal", "eggplant" is not "egg" and "moongphali" is not "moong". A
 * handful of distinctive words are matched as substrings so "kingfish" is
 * still fish.
 */

/** The food groups the app can rule in or out. */
export type IngredientRuleId =
  | 'meat'
  | 'seafood'
  | 'egg'
  | 'onion-garlic'
  | 'legume'
  | 'root-veg'
  | 'grain';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Word-boundary match with an optional plural, so "onion" finds "onions" and
 * "potato" finds "potatoes" — but "dalia" is not "dal" and "eggless" is not
 * "egg".
 */
const wordRe = (word: string): RegExp =>
  new RegExp(`(^|[^a-z0-9])${escapeRe(word)}(?:e?s)?([^a-z0-9]|$)`, 'i');

/** Substring match, for words that only ever appear inside a longer name. */
const subRe = (word: string): RegExp => new RegExp(escapeRe(word), 'i');

/**
 * Ingredients that are never ruled out, whatever the mode. Some of these are
 * deliberate corrections: "eggless mayo" has no eggs, "rice vinegar" is
 * vinegar, and ragi/kuttu/sabudana are exactly the flours a fast is built on.
 */
const ALWAYS_ALLOWED = [
  'eggless',
  'vinegar',
  'ragi',
  'kuttu',
  'buckwheat',
  'sabudana',
  'sago',
  'corn',
  'maize',
  'amaranth',
];

const MEAT_WORDS = [
  'chicken', 'mutton', 'lamb', 'beef', 'pork', 'veal', 'goat', 'duck',
  'bacon', 'ham', 'sausage', 'salami', 'bologna', 'meat', 'mince', 'keema',
  'kheema', 'hot dog',
];
const MEAT_SUB = ['chicken', 'mutton', 'keema', 'kheema', 'sausage', 'bacon', 'salami'];

const SEAFOOD_WORDS = [
  'prawn', 'shrimp', 'crab', 'lobster', 'squid', 'octopus', 'mussel', 'oyster',
  'scallop', 'clam', 'rohu', 'pomfret', 'surmai', 'sarkadai', 'hilsa', 'rawa',
  'tuna', 'salmon', 'sardine', 'anchovy', 'cod', 'mackerel', 'tilapia',
  'catfish', 'karimeen', 'shark', 'eel', 'seer fish', 'kingfish', 'cuttlefish',
];
const SEAFOOD_SUB = [
  'fish', 'prawn', 'shrimp', 'crab', 'lobster', 'squid', 'hilsa', 'pomfret',
  'surmai', 'sarkadai', 'rohu', 'karimeen', 'mackerel', 'tilapia',
];

const EGG_WORDS = ['egg', 'omelette', 'omelet'];

const ONION_GARLIC_WORDS = [
  'onion', 'shallot', 'leek', 'chive', 'scallion', 'kanda', 'lasun',
];
const ONION_GARLIC_SUB = ['onion', 'garlic'];

const LEGUME_WORDS = [
  'dal', 'bean', 'chickpea', 'urad', 'moong', 'masoor', 'rajma', 'cowpea',
  'kulthi', 'gram', 'pea', 'tofu', 'soya', 'soy', 'sprout', 'pulse', 'besan',
  'lentil',
];
const LEGUME_SUB = [
  'chana', 'besan', 'tofu', 'soya', 'soy', 'sprout', 'lentil', 'urad',
  'masoor', 'rajma', 'kulthi', 'cowpea', 'chickpea',
];

const ROOT_VEG_WORDS = [
  'potato', 'sweet potato', 'carrot', 'radish', 'beet', 'beetroot', 'turnip',
  'colocasia', 'arbi', 'taro', 'yam', 'arrowroot', 'plantain', 'cassava',
  'elephant foot', 'kataloo',
];
const ROOT_VEG_SUB = ['aloo'];

const GRAIN_WORDS = [
  'rice', 'wheat', 'atta', 'maida', 'flour', 'suji', 'semolina', 'rava',
  'bread', 'pasta', 'bajra', 'jowar', 'millet', 'oat', 'oatmeal', 'barley',
  'quinoa', 'couscous', 'noodle', 'dalia', 'roti', 'chapati', 'paratha',
  'puri', 'bhatura', 'samosa',
];
const GRAIN_SUB = ['flour', 'maida', 'atta', 'rava', 'suji'];

interface RuleTable {
  words: string[];
  subs: string[];
}

const RULES: Record<IngredientRuleId, RuleTable> = {
  meat: { words: MEAT_WORDS, subs: MEAT_SUB },
  seafood: { words: SEAFOOD_WORDS, subs: SEAFOOD_SUB },
  egg: { words: EGG_WORDS, subs: [] },
  'onion-garlic': { words: ONION_GARLIC_WORDS, subs: ONION_GARLIC_SUB },
  legume: { words: LEGUME_WORDS, subs: LEGUME_SUB },
  'root-veg': { words: ROOT_VEG_WORDS, subs: ROOT_VEG_SUB },
  grain: { words: GRAIN_WORDS, subs: GRAIN_SUB },
};

// Pre-compiled once — these run over every ingredient of every candidate
// recipe, and the catalogue has ~70k ingredients in it.
const COMPILED: Record<IngredientRuleId, { words: RegExp[]; subs: RegExp[] }> =
  (() => {
    const out = {} as Record<IngredientRuleId, { words: RegExp[]; subs: RegExp[] }>;
    for (const key of Object.keys(RULES) as IngredientRuleId[]) {
      out[key] = {
        words: RULES[key].words.map(wordRe),
        subs: RULES[key].subs.map(subRe),
      };
    }
    return out;
  })();

const ALLOWED_RE = ALWAYS_ALLOWED.map((w) => new RegExp(`(^|[^a-z0-9])${escapeRe(w)}([^a-z0-9]|$)`, 'i'));

/** True when this ingredient is never ruled out, whatever the mode. */
export function isAlwaysAllowed(name: string): boolean {
  const n = (name || '').toLowerCase();
  if (!n) return true;
  return ALLOWED_RE.some((re) => re.test(n));
}

/** True when the ingredient name falls under this rule. */
export function nameMatchesRule(name: string, rule: IngredientRuleId): boolean {
  const n = (name || '').toLowerCase();
  if (!n) return false;
  if (isAlwaysAllowed(n)) return false;
  const table = COMPILED[rule];
  return table.words.some((re) => re.test(n)) || table.subs.some((re) => re.test(n));
}

export interface RuleIngredient {
  name: string;
  category?: CategoryId;
}

/**
 * True when the ingredient falls under this rule, using the category as an
 * extra signal where one exists.
 */
export function ingredientMatchesRule(
  ing: RuleIngredient | null | undefined,
  rule: IngredientRuleId,
): boolean {
  if (!ing || !ing.name) return false;
  const name = ing.name.toLowerCase();
  if (isAlwaysAllowed(name)) return false;
  // The category is authoritative when present — the built-in recipes use it.
  if (rule === 'meat' && ing.category === 'meat') return true;
  if (rule === 'seafood' && ing.category === 'seafood') return true;
  if (rule === 'egg' && ing.category === 'meat' && nameMatchesRule(name, 'egg')) return true;
  return nameMatchesRule(name, rule);
}

/**
 * The ingredient's category, inferred from its name when the catalogue did
 * not supply one.
 *
 * Only the categories that actually exclude something are inferred (meat,
 * seafood). Everything else stays 'other' — which is compatible with every
 * diet — so this never removes a dish the user could legitimately eat. It
 * exists purely so the household's diet filter works on the 5,894 CSV
 * recipes, which carry no category at all.
 */
export function resolveCategory(ing: RuleIngredient | null | undefined): CategoryId {
  if (!ing) return 'other';
  if (ing.category) return ing.category;
  const name = (ing.name || '').toLowerCase();
  if (!name) return 'other';
  if (nameMatchesRule(name, 'seafood')) return 'seafood';
  if (nameMatchesRule(name, 'meat') || nameMatchesRule(name, 'egg')) return 'meat';
  return 'other';
}
