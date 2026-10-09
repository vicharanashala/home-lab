import type { Recipe } from '../types';

/**
 * CSV-derived recipe shape from src/data/csvRecipes.json.
 * Mirrors the Recipe interface but adds CSV-only fields
 * (cuisine, imageUrl, totalTime, source).
 */
export interface CsvRecipe extends Recipe {
  cuisine?: string;
  imageUrl?: string;
  totalTime?: number;
  source?: string;
}

/**
 * Substring tokens we extract from the user's query.
 * Each token is normalised to a-z0-9 only.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'with', 'for', 'to', 'of', 'in', 'on',
  'i', 'we', 'me', 'my', 'our', 'you', 'your', 'cook', 'make', 'give',
  'recipe', 'recipes', 'how', 'what', 'should', 'can', 'could', 'would',
  'today', 'tonight', 'tomorrow', 'dinner', 'lunch', 'breakfast', 'snack',
  'some', 'something', 'dish', 'food', 'meal', 'step', 'steps', 'by',
  'do', 'is', 'are', 'was', 'were', 'be', 'this', 'that', 'these', 'those',
  'have', 'has', 'had', 'want', 'need', 'please', 'show', 'find', 'suggest',
]);

export interface ScoredCsvRecipe {
  recipe: CsvRecipe;
  score: number;
  /** Token(s) that hit, useful for debugging. */
  hits: string[];
}

/**
 * Score one CSV recipe against the query tokens.
 *
 *  - Exact word match in the recipe name (whole word)        +3 per token
 *  - Substring match anywhere in the name                    +1 per token
 *  - Each query token found in any ingredient name           +1 per token
 *  - Each query token found in any ingredient name as a
 *    whole word                                             +1 extra
 *
 * Multi-word names ("masala karela") get a bonus when all
 * words of the query appear in order in the name.
 */
export function scoreRecipe(
  recipe: CsvRecipe,
  tokens: string[],
): ScoredCsvRecipe | null {
  if (tokens.length === 0) return null;
  const name = recipe.name.toLowerCase();
  const nameWords = new Set(name.split(/[^a-z0-9]+/g).filter(Boolean));
  const ingNames = recipe.ingredients.map((i) => i.name.toLowerCase());
  const ingFlat = ingNames.join(' ');
  const ingWords = new Set(ingFlat.split(/[^a-z0-9]+/g).filter(Boolean));

  let score = 0;
  const hits: string[] = [];
  let nameHits = 0;

  for (const t of tokens) {
    if (nameWords.has(t)) {
      score += 3;
      hits.push(`name:${t}`);
      nameHits += 1;
    } else if (name.includes(t)) {
      score += 1;
      hits.push(`name~${t}`);
      nameHits += 1;
    }
    if (ingWords.has(t)) {
      score += 2; // 1 for ingredient hit + 1 extra for whole-word
      hits.push(`ing:${t}`);
    } else if (ingFlat.includes(t)) {
      score += 1;
      hits.push(`ing~${t}`);
    }
  }

  // Multi-word boost: when the user asked for a 2+ word dish like
  // "butter chicken" and the recipe name contains both words,
  // give it a big bump so it sorts to the top.
  if (tokens.length >= 2 && nameHits >= 2) score += 3;
  if (tokens.length >= 1 && nameHits >= 1) score += 1;

  return score > 0 ? { recipe, score, hits } : null;
}

/**
 * Search the catalog with the user's natural-language text.
 *
 * @param catalog  the full 5,894-recipe list (csvRecipes.json)
 * @param query    the user's free-text query
 * @param limit    max number of matches to return (default 5)
 * @param minScore reject any match below this floor (default 2)
 */
export function searchCsvRecipes(
  catalog: CsvRecipe[],
  query: string,
  limit = 5,
  minScore = 2,
): ScoredCsvRecipe[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const scored: ScoredCsvRecipe[] = [];
  for (const r of catalog) {
    const s = scoreRecipe(r, tokens);
    if (s && s.score >= minScore) scored.push(s);
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}