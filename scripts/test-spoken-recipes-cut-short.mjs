/**
 * The recogniser cut a word short — the matcher has to find the dish again.
 *
 * WHY THIS EXISTS
 * Whisper does not only mis-spell a word, it sometimes stops early: "chutney"
 * comes back as "chutni", "bhaji" as "bha", "chat" as "ch". The matcher has a
 * rule for that — a heard word that is the BEGINNING of a catalogue word is
 * that word, cut short — and the rule is worth a test of its own, because
 * nothing else in the repository measures it.
 *
 * WHY NOTHING ELSE MEASURES IT
 * The sweep (scripts/sweep-spoken-recipes.mjs) writes out the spellings a
 * recogniser makes and the dish name with its last word DROPPED. It never
 * writes out a word cut short in the middle, so the rule could stop working
 * without any of the committed numbers moving. It did: the consonant rule
 * that commit 45ac575 narrowed was shared with the cut-short rule, and the
 * narrowing took the cut-short matching with it.
 *
 *   every dish in the catalogue, its last word cut short by one to three
 *   letters — the dish that was meant comes back:
 *
 *       before the narrowing   82.0%
 *       after it               57.0%     a quarter of the dishes lost
 *
 * WHY A FLOOR AND NOT AN EXACT NUMBER
 * The slice is the same every time, so the number does not wobble — but the
 * catalogue grows, and a rule that gets stricter over time should show up as
 * a failure rather than as a smaller number nobody reads. The floor is below
 * what the rule achieves, with room to spare.
 *
 * WHY A CEILING ON THE WRONG DISHES TOO
 * A wrong dish is worse than a missing one — it poisons the taste model and
 * the taste-match score forever. So the same measurement counts the dishes
 * that came back confident and WRONG, and holds that count down as well.
 *
 * Run with:  node scripts/test-spoken-recipes-cut-short.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

register('./lib/ts-resolve.mjs', import.meta.url);

const { INDIAN_RECIPES } = await import('../src/data/indianRecipes.ts');
const { matchDish, dishCore, normalizeDish, CONFIDENT_SCORE } = await import(
  '../src/utils/spokenRecipeMatch.ts'
);

const here = dirname(fileURLToPath(import.meta.url));
const csvRecipes = JSON.parse(
  readFileSync(join(here, '..', 'src', 'data', 'csvRecipes.json'), 'utf8'),
);
const catalogue = [...INDIAN_RECIPES, ...csvRecipes];
const preferredIds = new Set(INDIAN_RECIPES.map((r) => r.id));

/** How many of the catalogue to look at. The same slice every time. */
const SAMPLE = 400;
/** The floors. */
const FOUND_FLOOR = 0.74;
const WRONG_CEILING = 0.02;

const wordsOf = (s) => new Set(normalizeDish(s).split(' ').filter(Boolean));

/** The slice: every Nth recipe, so the range of names is the same each run. */
const stride = Math.max(1, Math.floor(catalogue.length / SAMPLE));
const sample = catalogue.filter((_, i) => i % stride === 0).slice(0, SAMPLE);

let total = 0;
let found = 0;
let wrong = 0;
const misses = [];
const wrongOnes = [];

for (const recipe of sample) {
  const core = dishCore(recipe.name);
  const words = normalizeDish(core).split(' ').filter(Boolean);
  if (!words.length) continue;
  const last = words[words.length - 1];
  if (last.length < 4) continue;

  for (let cut = 1; cut <= 3; cut++) {
    const spoken = [...words.slice(0, -1), last.slice(0, last.length - cut)].join(' ');
    if (!spoken) continue;
    total += 1;

    const best = matchDish(spoken, catalogue, preferredIds).best;
    if (!best) {
      misses.push(`${spoken} -> NO MATCH`);
      continue;
    }

    // The dish that was meant, or the dish with a word of it missing — the
    // recogniser may have dropped a word as well as cut one short.
    const coreWords = wordsOf(core);
    const gotWords = wordsOf(best.name);
    const isTheDish = normalizeDish(best.name) === normalizeDish(core);
    const isTheDishMissingAWord =
      gotWords.size > 0 && [...gotWords].every((w) => coreWords.has(w));
    if (isTheDish || isTheDishMissingAWord) {
      found += 1;
    } else {
      misses.push(`${spoken} -> ${best.name}`);
    }

    // A dish that is neither the one that was spoken nor one of its words
    // short, written in with confidence, is the wrong dish — and the meal
    // plan takes it.
    if (best.score >= CONFIDENT_SCORE && !isTheDish && !isTheDishMissingAWord) {
      wrong += 1;
      if (wrongOnes.length < 10) wrongOnes.push(`${spoken} -> ${best.name} ${best.score.toFixed(2)}`);
    }
  }
}

const foundRate = total ? found / total : 0;
const wrongRate = total ? wrong / total : 0;

console.log(`\nsample: ${sample.length} of ${catalogue.length} recipes, ${total} cut-short spellings`);
console.log(`  found   ${found} (${(foundRate * 100).toFixed(1)}%)  the dish that was meant`);
console.log(`  wrong   ${wrong} (${(wrongRate * 100).toFixed(1)}%)  a different dish, written in with confidence`);

let passed = 0;
let failed = 0;
function ok(cond, label, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('\nthe floors');
ok(
  foundRate >= FOUND_FLOOR,
  `the dish comes back for at least ${(FOUND_FLOOR * 100).toFixed(0)}% of the ways a word is cut short`,
  `${(foundRate * 100).toFixed(1)}%`,
);
ok(
  wrongRate <= WRONG_CEILING,
  `a different dish is written in with confidence for at most ${(WRONG_CEILING * 100).toFixed(0)}%`,
  `${(wrongRate * 100).toFixed(1)}%`,
);

if (misses.length) {
  console.log('\nthe ones that were not found:');
  misses.slice(0, 15).forEach((m) => console.log('  ' + m));
  if (misses.length > 15) console.log(`  ... and ${misses.length - 15} more`);
}
if (wrongOnes.length) {
  console.log('\nthe wrong dishes:');
  wrongOnes.forEach((w) => console.log('  ' + w));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
