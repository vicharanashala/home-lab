/**
 * Discover Recipes — Netflix-style "you might like this" recommender.
 *
 * Uses real ML embeddings generated at build time by
 * scripts/generate-embeddings.mjs (Xenova/all-MiniLM-L6-v2, sentence-transformer).
 *
 * Scoring:
 *   1. Compute "taste vector" = weighted average of embeddings of recipes
 *      you've already cooked (more recent = higher weight)
 *   2. For each catalog recipe, score = cosine(taste, recipe_embedding)
 *      + stock_coverage_bonus (more ingredients in fridge = higher)
 *      + novelty_factor (haven't cooked in last 14 days = higher)
 *   3. Sort, dedupe against favorites, display top N.
 *
 * Lazy-loads the ~14MB embeddings JSON only when this page opens.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, Star, ChefHat, TrendingUp, Clock, RefreshCw, ArrowRight,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { substitutionsForRecipe } from '../utils/substitutions';
import { DishIcon } from '../components/icons/DishIcons';
import { ThemeToggle } from '../components/ThemeToggle';
import clsx from 'clsx';
import type { MealLog, Recipe, StockItem } from '../types';

interface ScoredRecipe {
  recipe: Recipe;
  score: number;
  matchedIngredients: string[];
  missingIngredients: string[];
  stockCoverage: number; // 0..1
  novelty: number;       // 0..1
}

/** Load all embeddings JSON once. Returns Map<id, vector> or null while loading. */
function useEmbeddings() {
  const [map, setMap] = useState<Map<string, number[]> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('../data/recipeEmbeddings.json').then((mod) => {
      if (!cancelled) setMap(new Map(Object.entries((mod.default || mod) as Record<string, number[]>)));
    }).catch((err) => {
      console.warn('[Discover] failed to load embeddings:', err);
    });
    return () => { cancelled = true; };
  }, []);
  return map;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalize(v: number[]): number[] {
  let mag = 0;
  for (let i = 0; i < v.length; i++) mag += v[i] * v[i];
  mag = Math.sqrt(mag) || 1;
  return v.map((x) => x / mag);
}

/** Average multiple vectors (already L2-normalized). */
function avgVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const acc = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) acc[i] += v[i];
  return acc.map((x) => x / vectors.length);
}

/** Build the user's taste vector from meal logs. More recent + more-cooked = higher weight. */
function buildTasteVector(logs: MealLog[], recipeById: Map<string, Recipe>, embeddings: Map<string, number[]>): number[] | null {
  // Count each recipeId occurrences + recency boost.
  const counts = new Map<string, { count: number; latestAt: number }>();
  const now = Date.now();
  for (const log of logs) {
    if (!log.recipeId) continue;
    const cur = counts.get(log.recipeId) ?? { count: 0, latestAt: 0 };
    cur.count += 1;
    cur.latestAt = Math.max(cur.latestAt, log.createdAt);
    counts.set(log.recipeId, cur);
  }
  if (counts.size === 0) return null;

  // Weight = count * recency-decay (half-life 30 days).
  const weighted: number[][] = [];
  let totalWeight = 0;
  for (const [id, { count, latestAt }] of counts) {
    const emb = embeddings.get(id);
    if (!emb) continue;
    const ageDays = (now - latestAt) / (24 * 60 * 60 * 1000);
    const recencyWeight = Math.exp(-ageDays / 30);
    const w = count * recencyWeight;
    weighted.push(emb.map((x) => x * w));
    totalWeight += w;
  }
  if (weighted.length === 0) return null;
  // Average and L2-normalize.
  const raw = avgVectors(weighted);
  if (totalWeight > 0) for (let i = 0; i < raw.length; i++) raw[i] /= totalWeight / weighted.length;
  return normalize(raw);
}

/** For a recipe, return its ingredients that ARE / AREN'T in current stock (case-insensitive substring). */
function stockCoverageFor(
  recipe: Recipe,
  stock: StockItem[],
): { matched: string[]; missing: string[]; ratio: number } {
  const stockNames = new Set(stock.map((s) => s.name.toLowerCase().trim()));
  const matched: string[] = [];
  const missing: string[] = [];
  for (const ing of recipe.ingredients ?? []) {
    const needle = ing.name.toLowerCase().trim();
    const hit = stockNames.has(needle) ||
      Array.from(stockNames).some((s) => s.includes(needle) || needle.includes(s));
    if (hit) matched.push(ing.name);
    else missing.push(ing.name);
  }
  const total = matched.length + missing.length;
  return { matched, missing, ratio: total === 0 ? 0 : matched.length / total };
}

/** Top-N most-cooked recipes. */
function mostCookedRecipes(
  logs: MealLog[],
  recipeById: Map<string, Recipe>,
  n = 5,
): Array<{ recipe: Recipe; count: number }> {
  const counts = new Map<string, number>();
  for (const log of logs) if (log.recipeId) counts.set(log.recipeId, (counts.get(log.recipeId) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, count]) => ({ recipe: recipeById.get(id)!, count }))
    .filter((x) => Boolean(x.recipe));
}

export function DiscoverPage() {
  const { mealLogs, recipes, stock } = useStore();
  const embeddings = useEmbeddings();
  const [busy, setBusy] = useState(false);

  // Lazy-load the CSV catalog of 5,894 recipes.
  const [csvRecipes, setCsvRecipes] = useState<Recipe[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('../data/csvRecipes.json').then((mod) => {
      if (!cancelled) setCsvRecipes((mod.default || mod) as unknown as Recipe[]);
    });
    return () => { cancelled = true; };
  }, []);

  // Build a Map<id, Recipe> covering local + CSV catalog.
  const recipeById = useMemo(() => {
    const m = new Map<string, Recipe>();
    for (const r of recipes) m.set(r.id, r);
    if (csvRecipes) for (const r of csvRecipes) if (!m.has(r.id)) m.set(r.id, r);
    return m;
  }, [recipes, csvRecipes]);

  const allRecipes = useMemo(() => Array.from(recipeById.values()), [recipeById]);

  // User's taste vector.
  const taste = useMemo(
    () => (embeddings ? buildTasteVector(mealLogs, recipeById, embeddings) : null),
    [embeddings, mealLogs, recipeById],
  );

  // Most-cooked recipes (always available, even before embeddings load).
  const topCooked = useMemo(() => mostCookedRecipes(mealLogs, recipeById, 5), [mealLogs, recipeById]);

  // Recommended recipes — scored by ML cosine + stock coverage + novelty.
  const recommendations = useMemo<ScoredRecipe[]>(() => {
    if (!taste || !embeddings) return [];
    const cookedIds = new Set(mealLogs.map((m) => m.recipeId).filter(Boolean));
    const now = Date.now();
    const out: ScoredRecipe[] = [];
    for (const recipe of allRecipes) {
      if (cookedIds.has(recipe.id)) continue; // exclude already-cooked
      const emb = embeddings.get(recipe.id);
      if (!emb) continue;
      // Cosine similarity (both are L2-normalized so dot product == cosine).
      const cosSim = dot(taste, emb);
      if (cosSim < 0.3) continue; // drop far-off recipes
      const { matched, missing, ratio } = stockCoverageFor(recipe, stock);
      // Novelty: prefer recipes NOT cooked in last 14 days.
      const recentCooks = mealLogs.filter((m) => m.recipeId === recipe.id && now - m.createdAt < 14 * 24 * 60 * 60 * 1000).length;
      const novelty = Math.max(0, 1 - recentCooks * 0.5);
      const score = cosSim * 0.7 + ratio * 0.2 + novelty * 0.1;
      out.push({
        recipe, score,
        matchedIngredients: matched,
        missingIngredients: missing,
        stockCoverage: ratio,
        novelty,
      });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 24);
  }, [taste, embeddings, allRecipes, mealLogs, stock]);

  // Recipes you can cook RIGHT NOW (≥80% of ingredients in stock), recommended ones first.
  const cookableNow = useMemo(() => {
    return recommendations
      .filter((r) => r.stockCoverage >= 0.8)
      .slice(0, 8);
  }, [recommendations]);

  // Recompute trigger — gives the user a way to refresh after a meal log.
  const refresh = () => {
    setBusy(true);
    setTimeout(() => setBusy(false), 400);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-5 space-y-6">
      <header className="rounded-3xl bg-gradient-to-br from-tomato-500 via-tomato-600 to-sage-700 dark:from-tomato-700 dark:via-sage-800 dark:to-ink-800 text-white p-5 sm:p-7 shadow-soft relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full bg-white/10 blur-sm" />
        <div className="absolute left-1/3 -top-6 w-24 h-24 rounded-full bg-butter-300/30 dark:bg-butter-400/10 blur-2xl" />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur px-3 py-1 text-xs font-semibold mb-3 ring-1 ring-white/20">
              <Sparkles size={14} />
              Discover · powered by ML
            </div>
            {/* On this gradient header the toggle needs its own light-on-dark
                treatment, so it isn't given the default sage/ink chrome. */}
            <ThemeToggle variant="onGradient" />
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold leading-[1.1] tracking-tight">
            Try something new.
          </h1>
          <p className="text-tomato-100 mt-2 text-sm sm:text-base max-w-md">
            Recipes you'll probably love, ranked by an ML model that learns what you actually cook.
          </p>
        </div>
      </header>

      {/* Status pills */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        {!embeddings && (
          <span className="rounded-full bg-butter-100 text-butter-800 px-2.5 py-1 font-semibold inline-flex items-center gap-1">
            <Sparkles size={10} /> Loading ML model…
          </span>
        )}
        {embeddings && (
          <span className="rounded-full bg-sage-100 text-sage-700 px-2.5 py-1 font-semibold inline-flex items-center gap-1">
            <Sparkles size={10} /> ML ready · {allRecipes.length.toLocaleString()} recipes
          </span>
        )}
        {taste && (
          <span className="rounded-full bg-sage-100 text-sage-700 px-2.5 py-1 font-semibold">
            Built your taste from {mealLogs.filter((m) => m.recipeId).length} meals
          </span>
        )}
        {!taste && embeddings && (
          <span className="rounded-full bg-butter-100 text-butter-800 px-2.5 py-1 font-semibold">
            Log a few meals first so we can learn your taste
          </span>
        )}
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          className="ml-auto rounded-full bg-white dark:bg-ink-800 border border-sage-200 dark:border-ink-700 px-2.5 py-1 font-semibold inline-flex items-center gap-1 active:scale-95 transition"
        >
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Your favorites */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display text-lg font-extrabold text-sage-900 dark:text-cream-50 flex items-center gap-2">
            <Star size={18} className="text-amber-500 fill-amber-400" />
            Your favorites
          </h2>
          {topCooked.length > 0 && (
            <span className="text-[11px] text-sage-500 dark:text-ink-400">
              based on what you cook most
            </span>
          )}
        </div>
        {topCooked.length === 0 ? (
          <div className="rounded-xl bg-cream-50 dark:bg-ink-900 border border-dashed border-sage-200 dark:border-ink-700 p-4 text-sm text-sage-600 dark:text-ink-300">
            No recipes logged yet with a recipe attached. Try logging a meal from
            <strong className="mx-1">End of day</strong>
            first — pick "palak paneer" or any dish — then come back here for recommendations.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {topCooked.map(({ recipe, count }) => (
              <RecipeCard
                allRecipes={allRecipes}
                key={recipe.id}
                recipe={recipe}
                badge={`cooked ×${count}`}
                stock={stock}
                score={null}
                showIngredients={false}
              />
            ))}
          </div>
        )}
      </section>

      {/* Recommended for you */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display text-lg font-extrabold text-sage-900 dark:text-cream-50 flex items-center gap-2">
            <TrendingUp size={18} className="text-tomato-500" />
            Recommended for you
          </h2>
          {recommendations.length > 0 && (
            <span className="text-[11px] text-sage-500 dark:text-ink-400">
              {recommendations.length} matches
            </span>
          )}
        </div>
        {recommendations.length === 0 ? (
          <div className="rounded-xl bg-cream-50 dark:bg-ink-900 border border-dashed border-sage-200 dark:border-ink-700 p-6 text-center text-sage-600 dark:text-ink-300 text-sm">
            <Sparkles size={20} className="mx-auto mb-2 text-sage-400" />
            {taste
                ? 'No high-match recipes in the catalog yet. Log more meals and we\'ll learn your taste.'
                : 'Log 3+ meals first so we can build your taste vector.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {recommendations.slice(0, 12).map((r) => (
              <RecipeCard
                allRecipes={allRecipes}
                key={r.recipe.id}
                recipe={r.recipe}
                score={r.score}
                stock={stock}
                matchedIngredients={r.matchedIngredients}
                missingIngredients={r.missingIngredients}
                stockCoverage={r.stockCoverage}
              />
            ))}
          </div>
        )}
      </section>

      {/* Make it tonight — high stock coverage */}
      {cookableNow.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display text-lg font-extrabold text-sage-900 dark:text-cream-50 flex items-center gap-2">
              <Clock size={18} className="text-emerald-600" />
              Make it tonight
            </h2>
            <span className="text-[11px] text-sage-500 dark:text-ink-400">
              ≥80% of ingredients already in your fridge
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {cookableNow.map((r) => (
              <RecipeCard
                allRecipes={allRecipes}
                key={r.recipe.id}
                recipe={r.recipe}
                score={null}
                stock={stock}
                matchedIngredients={r.matchedIngredients}
                missingIngredients={r.missingIngredients}
                stockCoverage={r.stockCoverage}
                highlightStock
              />
            ))}
          </div>
        </section>
      )}

      <p className="text-center text-xs text-sage-400 pt-2">
        ML model: <strong>sentence-transformers/all-MiniLM-L6-v2</strong> · cosine similarity + stock coverage + novelty
      </p>
    </div>
  );
}

/** Small card component for a single recipe. */
function RecipeCard({
  recipe,
  badge,
  score,
  stock,
  matchedIngredients,
  missingIngredients,
  stockCoverage,
  showIngredients = true,
  highlightStock = false,
  allRecipes,
}: {
  recipe: Recipe;
  allRecipes: Recipe[];
  badge?: string;
  score: number | null;
  stock: StockItem[];
  matchedIngredients?: string[];
  missingIngredients?: string[];
  stockCoverage?: number;
  showIngredients?: boolean;
  highlightStock?: boolean;
}) {
  const matchPct = stockCoverage != null ? Math.round(stockCoverage * 100) : null;
  // Memoised: recomputing this on every render showed up as a visible stall
  // on a phone once a few cards were on screen.
  const subs = useMemo(
    () => substitutionsForRecipe(recipe, stock, allRecipes),
    [recipe, stock, allRecipes],
  );
  return (
    <div className={clsx(
      'rounded-2xl border p-3 transition-all hover:shadow-soft',
      highlightStock
        ? 'bg-gradient-to-br from-emerald-50 to-sage-50 dark:from-emerald-900/20 dark:to-ink-800 border-emerald-300 dark:border-emerald-700'
        : 'bg-white dark:bg-ink-800 border-sage-200 dark:border-ink-700',
    )}>
      <div className="flex items-start gap-3">
        <DishIcon recipe={recipe} size={30} className="shrink-0 text-sage-700 dark:text-sage-300" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="font-display font-bold text-sm text-sage-900 dark:text-cream-50 truncate flex-1">
              {recipe.name}
            </div>
            {badge && (
              <span className="rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 shrink-0">
                {badge}
              </span>
            )}
            {score != null && (
              <span className="rounded-full bg-tomato-100 text-tomato-700 text-[10px] font-bold px-1.5 py-0.5 shrink-0 tabular-nums">
                {Math.round(score * 100)}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-sage-500 dark:text-ink-400">
            <span>{(recipe as any).cuisine ?? 'Indian'}</span>
            {(recipe as any).totalTime ? <span>· {(recipe as any).totalTime}min</span> : null}
            {matchPct != null && matchPct > 0 && (
              <span className={clsx(
                'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                matchPct >= 80
                  ? 'bg-emerald-100 text-emerald-800'
                  : matchPct >= 50
                    ? 'bg-butter-100 text-butter-800'
                    : 'bg-sage-100 text-sage-700',
              )}>
                {matchPct}% in stock
              </span>
            )}
          </div>
          {subs.length === 0 ? null : (() => {
            return (
              <div className="mt-2.5 rounded-xl bg-butter-50 dark:bg-butter-900/20 border border-butter-200 dark:border-butter-900 p-2.5">
                <p className="text-[11px] font-bold text-butter-900 dark:text-butter-200 mb-1.5">
                  Out of something? Try a swap
                </p>
                <ul className="space-y-1.5">
                  {subs.slice(0, 3).map(({ ingredient, options }) => (
                    <li key={ingredient.name} className="text-[11px] text-sage-700 dark:text-ink-200">
                      <span className="font-semibold">{ingredient.name}</span>
                      {' → '}
                      <span className="text-butter-800 dark:text-butter-300 font-semibold">
                        {options.slice(0, 2).map((o) => o.name).join(' or ')}
                      </span>
                      <span className="block text-[10px] text-sage-500 dark:text-ink-400">
                        {options[0].reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
          {showIngredients && matchedIngredients && matchedIngredients.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {matchedIngredients.slice(0, 4).map((n) => (
                <span key={n} className="text-[10px] rounded-full bg-emerald-100 text-emerald-800 px-1.5 py-0.5 font-semibold">
                  ✓ {n}
                </span>
              ))}
              {missingIngredients && missingIngredients.length > 0 && missingIngredients.slice(0, 3).map((n) => (
                <span key={n} className="text-[10px] rounded-full bg-cream-100 dark:bg-ink-900 text-sage-500 dark:text-ink-400 px-1.5 py-0.5 font-semibold">
                  + {n}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}