import type { Recipe, RecipeIngredient } from '../types';
import { findCandidatesForIngredient } from './recipeMatch';

/**
 * Ingredient substitutions.
 *
 * Built from the recipe corpus itself rather than a hand-written table: if
 * "curd" is missing, look for dishes that pair a known curd substitute with
 * the same other ingredients. That keeps the advice grounded in how these
 * recipes actually cook, and it needs no maintenance as the catalogue grows.
 */

export interface Substitute {
  /** The replacement to use. */
  name: string;
  /** How often it appears in place of the missing item across the corpus. */
  frequency: number;
  /** A dish showing the substitution in action. */
  exampleDish?: string;
  /** Why it works, in one line. */
  reason: string;
}

/** Practical swaps we're confident about, used to explain the suggestion. */
const REASONS: Array<[RegExp, string]> = [
  [/curd|yogurt|dahi/i, 'adds the same tang and thickens sauces'],
  [/buttermilk|chaas/i, 'sour liquid — lemon juice or vinegar works in a pinch'],
  [/milk|doodh/i, 'any unsweetened dairy or a thickener holds the liquid'],
  [/ghee|butter/i, 'the fat and richness carry through'],
  [/oil/i, 'neutral oil or ghee in equal measure'],
  [/lemon|lime|amchad/i, 'the acid does the balancing'],
  [/lime|lemon/i, 'the acid does the balancing'],
  [/yogurt|curd/i, 'use fresh and off the heat, or it splits'],
  [/cream|malai/i, 'a spoon of curd or cream cheese mimics the richness'],
  [/tomato|ketchup/i, 'adds the same acidity and colour'],
  [/onion|shallot/i, 'the base sweetness of the dish is the same'],
  [/garlic|lehsun/i, 'swap a smaller amount of garlic with a little chilli'],
  [/ginger|adrak/i, 'works like garlic — a pinch, not a spoonful'],
  [/spinach|palak/i, 'any leafy green, or pumpkin for the sweetness'],
  [/potato|aloo/i, 'a waxy root holds the same body'],
  [/paneer/i, 'firm tofu or cubed chhena take the same sear'],
  [/besan|chickpea flour|gram flour/i, 'adds body and binds'],
  [/rice|chawal/i, 'any long-grain rice keeps the texture'],
  [/dal|lentil|daal/i, 'any split pulse simmered down works'],
];

function reasonFor(name: string): string {
  for (const [re, why] of REASONS) if (re.test(name)) return why;
  return 'close enough in taste and function for this dish';
}

/**
 * Inverted index: ingredient -> how often it co-occurs with each other
 * ingredient across the corpus.
 *
 * This exists for speed. Scanning all ~5,900 recipes on every lookup is
 * O(recipes x ingredients) *per suggestion*, and Discover renders a dozen
 * cards at once — with a nearly empty fridge almost every ingredient is
 * "missing", so the old on-the-fly scan took over twenty seconds to draw
 * the page. The index is built once and cached against the recipe array.
 */
type CoIndex = Map<string, Map<string, number>>;

interface CorpusIndex {
  /** ingredient -> how often it appears alongside each other ingredient. */
  partners: CoIndex;
  /** ingredient -> how many dishes in the corpus use it at all. */
  totals: Map<string, number>;
  /** ingredient -> first dish that used it, for a concrete example. */
  example: Map<string, Recipe>;
}

let indexCache: { src: Recipe[]; index: CorpusIndex } | null = null;

/** Build the co-occurrence index once, then reuse it. */
function corpusIndex(recipes: Recipe[]): CorpusIndex {
  if (indexCache && indexCache.src === recipes) return indexCache.index;

  const partners: CoIndex = new Map();
  const totals = new Map<string, number>();
  const example = new Map<string, Recipe>();

  for (const r of recipes) {
    const names = (r?.ingredients || [])
      .map((i) => i.name?.trim().toLowerCase())
      .filter((n): n is string => !!n);
    for (const n of new Set(names)) {
      if (!example.has(n)) example.set(n, r);
      totals.set(n, (totals.get(n) || 0) + 1);
    }
    const uniq = [...new Set(names)];
    for (const a of uniq) {
      let row = partners.get(a);
      if (!row) {
        row = new Map();
        partners.set(a, row);
      }
      for (const b of uniq) {
        if (a === b) continue;
        row.set(b, (row.get(b) || 0) + 1);
      }
    }
  }

  const index: CorpusIndex = { partners, totals, example };
  indexCache = { src: recipes, index };
  return index;
}

/**
 * Universal pantry staples. These appear in nearly every Indian recipe, so
 * raw co-occurrence ranks them top for *every* missing ingredient — which
 * makes "Spinach -> salt" the most useless suggestion ever generated. Swapping
 * one for another changes nothing, so they are never offered.
 */
const PANTRY_STAPLE = /^(salt|salt$|sea ?salt|black ?salt|water|oil|cooking oil|vegetable oil|olive oil|ghee|butter|dal|water|turmeric powder|turmeric|chilli powder|chili powder|red chilli powder|garam masala|cumin powder|jeera|coriander powder|asafoetida|hing|red chilli|green chilli|baking powder|bicarbonate of soda|sugar|oil$)/i;

/** Above this share of the missing item's dishes, a candidate is background noise. */
const UNIVERSAL_RATIO = 0.55;

/**
 * Curated substitutions for Indian home cooking.
 *
 * A previous version ranked purely by co-occurrence in the recipe corpus.
 * That was fast once indexed, but wrong: co-occurrence tells you what shows
 * up *together*, not what can stand in *for*. It confidently offered
 * "Spinach -> salt" and "Paneer -> cloves garlic", because salt and garlic
 * appear in nearly every curry. Swapping them changes nothing.
 *
 * So the candidates come from actual cooking knowledge, and the corpus is
 * used only as evidence — "seen in 42 dishes" — and to attach a real example
 * dish. If there's no sensible swap, we say nothing rather than invent one.
 */
const SUBSTITUTIONS: Array<[RegExp, string[], string]> = [
  [/^(curd|dahi|yogurt|plain yogurt|hung curd)$/i,
    ['Hung curd', 'Greek yogurt', 'Buttermilk with a squeeze of lemon', 'Smetana'], 'same tang and thickness'],
  [/^(milk|toned milk|full cream milk)$/i,
    ['Buttermilk', 'Coconut milk', 'Water (in a dal or curry, not a dessert)'], 'supplies the liquid'],
  [/^(ghee|clarified butter)$/i,
    ['Butter', 'Oil', 'Coconut oil'], 'carries the richness'],
  [/^(butter)$/i, ['Ghee', 'Oil', 'Margarine'], 'same fat, similar behaviour'],
  [/^(oil|cooking oil|vegetable oil|sunflower oil|groundnut oil|mustard oil)$/i,
    ['Ghee', 'Butter', 'Any neutral oil'], 'a neutral fat does the same job'],
  [/^(onion|onions)$/i,
    ['Shallot', 'Spring onion (green part)', 'Leek'], 'the same base sweetness'],
  [/^(garlic|garlic cloves)$/i,
    ['Garlic powder', 'A pinch of asafoetida (hing)'], 'same pungency in less volume'],
  [/^(ginger|ginger juice)$/i,
    ['Garlic (a little)', 'Galangal'], 'same warmth, used sparingly'],
  [/^(tomato|tomatoes|canned tomatoes)$/i,
    ['Tomato puree', 'Tamarind water', 'Pomegranate molasses'], 'same acidity'],
  [/^(lemon|lemon juice|lime|lime juice)$/i,
    ['Vinegar', 'Tamarind', 'Amchad (pickled mango)', 'Sumac'], 'the acid does the balancing'],
  [/^(spinach|palak)$/i,
    ['Mustard greens (sarson ka saag)', 'Amaranath (chaulai)', 'Water spinach (paan)', 'Pumpkin, for sweetness'], 'any leafy green works, with a texture difference'],
  [/^(potato|potatoes)$/i,
    ['Sweet potato', 'Yam (elephant foot)', 'Cassava'], 'a starchy root holds the same body'],
  [/^(paneer)$/i,
    ['Firm tofu, pressed and cubed', 'Chhena', 'Crumbled halloumi'], 'sears and holds shape the same'],
  [/^(dal|toor dal|masoor dal|moong dal|rajma|chana dal|lentils)$/i,
    ['Moong dal', 'Toor dal', 'Masoor dal', 'Chana dal'], 'any split pulse, simmered long enough'],
  [/^(basmati rice|rice|jeera rice)$/i,
    ['Any long-grain rice', 'Sona masoori'], 'same grain, slightly less aroma'],
  [/^(capsicum|bell pepper|shimla mirch)$/i,
    ['Green chilli, for heat without the water', 'Zucchini', 'Green bell pepper'], 'same crunch, milder'],
  [/^(cauliflower)$/i, ['Broccoli', 'Cabbage'], 'similar texture when roasted or in curry'],
  [/^(cabbage)$/i, ['Bok choy', 'Cabbage leaf', 'Brussels sprouts'], 'same family, milder'],
  [/^(green beans|beans|cluster beans)$/i,
    ['French beans', 'Cluster beans (same)', 'Snow peas'], 'same texture, cuts differently'],
  [/^(mushroom|mushrooms|button mushrooms)$/i,
    ['Tofu, browned', 'Extra-firm paneer'], 'absorbs seasoning the same way'],
  [/^(bread|sliced bread)$/i, ['Pita', 'Tortilla', 'Any crusty loaf'], 'use for the same soak or toast'],
  [/^(mint|pudina)$/i, ['Basil', 'Coriander leaves', 'Celery (in a chutney)'], 'the same cool green note'],
  [/^(coriander leaves|cilantro|hara dhania)$/i,
    ['Parsley', 'Celery leaves', 'Thai basil'], 'the same fresh finish'],
  [/^(green chilli|green chilies|green chillies)$/i,
    ['Serrano or jalapeno', 'Black pepper, for plain heat'], 'adjust for the heat you want'],
  [/^(baking soda|bicarbonate of soda)$/i,
    ['Baking powder (use a third as much)'], 'the same lift, different strength'],
  [/^(cocoa|cocoa powder)$/i, ['Dark chocolate, melted', 'Instant coffee, in a pinch'], 'the same bitterness'],
  [/^(thick coconut milk|coconut milk)$/i,
    ['Coconut cream', 'Cashew cream, blended'], 'same body and richness'],
  [/^(sugar)$/i, ['Jaggery', 'Honey (baking only)'], 'sweetness with a different profile'],
];

function curatedFor(name: string): { names: string[]; why: string } | null {
  for (const [re, names, why] of SUBSTITUTIONS) {
    if (re.test(name.trim())) return { names, why };
  }
  return null;
}

/**
 * Find substitutes for a missing ingredient.
 *
 * Candidates come from the curated table above; the corpus supplies a real
 * example dish and a frequency for each, so a suggestion can say it's been
 * used in real dishes rather than being invented.
 */
export function findSubstitutes(
  missing: RecipeIngredient,
  recipes: Recipe[],
  limit = 5,
  /** Candidate names to skip — typically what the kitchen already has. */
  exclude?: Set<string>,
): Substitute[] {
  const missingName = missing.name?.trim();
  if (!missingName) return [];

  const curated = curatedFor(missingName);
  if (!curated) return []; // no trustworthy swap — say nothing

  const idx = corpusIndex(recipes);
  const partners = idx.partners.get(missingName.toLowerCase());

  const out: Substitute[] = [];
  for (const name of curated.names.slice(0, limit)) {
    if (exclude?.has(name.trim().toLowerCase())) continue;
    const key = name.trim().toLowerCase();
    // Prefer a dish that actually contains this substitute.
    const demo =
      idx.example.get(key) ||
      (partners?.has(key) ? idx.example.get(key) : undefined);
    out.push({
      name,
      frequency: partners?.get(key) || 0,
      ...(demo ? { exampleDish: demo.name } : {}),
      reason: curated.why,
    });
  }
  return out;
}

/**
 * All missing ingredients in a recipe, with substitutions for each.
 * Ready to render inside the cooking flow.
 */
export function substitutionsForRecipe(
  recipe: Recipe,
  stock: Parameters<typeof findCandidatesForIngredient>[1],
  recipes: Recipe[],
): Array<{ ingredient: RecipeIngredient; options: Substitute[] }> {
  // Don't propose something that's already sitting in the fridge.
  const have = new Set(stock.map((s) => s.name.trim().toLowerCase()));
  return recipe.ingredients
    .filter((ing) => findCandidatesForIngredient(ing, stock).length === 0)
    .map((ing) => ({ ingredient: ing, options: findSubstitutes(ing, recipes, 4, have) }))
    .filter((x) => x.options.length > 0);
}