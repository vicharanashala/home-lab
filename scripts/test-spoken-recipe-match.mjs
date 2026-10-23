/**
 * Tests for the spoken-recipe matcher.
 *
 * A wrong dish is worse than a missing one: it poisons the taste model and
 * the taste-match score forever. So every case here is either a real way
 * Whisper mangles an Indian dish name, or a real way a person says one.
 *
 * Run with:  node scripts/test-spoken-recipe-match.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { INDIAN_RECIPES } from '../src/data/indianRecipes.ts';
import {
  matchDish,
  resolveSpokenPlan,
  dishCore,
  normalizeDish,
  editDistance,
  CONFIDENT_SCORE,
} from '../src/utils/spokenRecipeMatch.ts';

const here = dirname(fileURLToPath(import.meta.url));
const csvRecipes = JSON.parse(
  readFileSync(join(here, '..', 'src', 'data', 'csvRecipes.json'), 'utf8'),
);

/**
 * The app matches against the built-ins AND the CSV catalogue together —
 * that is how MealPlan builds its `catalogue`. The built-ins matter a lot:
 * they carry the clean, canonical names people actually say ("Idli",
 * "Samosa", "Chole bhature", "Paneer tikka"), while the CSV names are
 * long and auto-generated.
 */
const catalogue = [...INDIAN_RECIPES, ...csvRecipes];
/** The app's curated recipes, which win ties against the scraped ones. */
const preferredIds = new Set(INDIAN_RECIPES.map((r) => r.id));
console.log(`catalogue: ${INDIAN_RECIPES.length} built-in + ${csvRecipes.length} csv\n`);

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

/** The matched name must contain the word we are looking for. */
function matches(heard, expectWord, { confident = true } = {}) {
  const r = matchDish(heard, catalogue, preferredIds);
  if (!r.best) {
    ok(false, `"${heard}"`, 'no match at all');
    return null;
  }
  const name = r.best.name.toLowerCase();
  const hit = name.includes(expectWord.toLowerCase());
  const sure = !confident || r.best.score >= CONFIDENT_SCORE;
  ok(hit && sure, `"${heard}" -> "${r.best.name}"`,
    `score ${r.best.score.toFixed(2)} tier ${r.best.tier}${hit ? '' : ' (wrong dish)'}${sure ? '' : ' (not confident)'}`);
  return r;
}

/** Nothing should match — better an empty slot than a wrong dish. */
function noMatch(heard) {
  const r = matchDish(heard, catalogue, preferredIds);
  ok(!r.best, `"${heard}"`, r.best ? `matched "${r.best.name}" (${r.best.score.toFixed(2)})` : 'no match, as expected');
  return r;
}

console.log('\nthe catalogue name is reduced to what a person would say');
ok(dishCore('Achari Aloo Sabzi Recipe - Potatoes In Spicy Pickle Masala') === 'Achari Aloo Sabzi',
  'cuts at " Recipe - "', dishCore('Achari Aloo Sabzi Recipe - Potatoes In Spicy Pickle Masala'));
ok(dishCore('Ajwain Besan Ka Paratha Recipe (Masala Paratha)') === 'Ajwain Besan Ka Paratha',
  'cuts a trailing bracket', dishCore('Ajwain Besan Ka Paratha Recipe (Masala Paratha)'));
ok(dishCore('Allam Pachadi | Ginger Chutney') === 'Allam Pachadi',
  'cuts at a pipe', dishCore('Allam Pachadi | Ginger Chutney'));
ok(dishCore('Delicious Dal Makhani') === 'Dal Makhani',
  'drops a noise adjective', dishCore('Delicious Dal Makhani'));
ok(dishCore('Paneer Tikka Pulao') === 'Paneer Tikka Pulao',
  'leaves a real name alone', dishCore('Paneer Tikka Pulao'));

console.log('\nnormalising and distance');
ok(normalizeDish('Masala  Dosa!!') === 'masala dosa', 'lower-cases and strips punctuation',
  normalizeDish('Masala  Dosa!!'));
ok(editDistance('idly', 'idli') === 1, 'a swapped pair is one edit', String(editDistance('idly', 'idli')));
ok(editDistance('samusa', 'samosa') === 1, 'samusa -> samosa is one edit', String(editDistance('samusa', 'samosa')));
ok(editDistance('dosa', 'dosa') === 0, 'identical words are no edits', String(editDistance('dosa', 'dosa')));

console.log('\nsaid exactly as it is written');
matches('masala dosa', 'masala dosa');
matches('butter chicken', 'butter chicken');
matches('dal makhani', 'dal makhani');

console.log('\nsaid the way Whisper hears it');
matches('masala dosaa', 'masala dosa');
matches('masala dose', 'masala dosa');
matches('idly', 'idli');
matches('samusa', 'samosa');

matches('rotti', 'roti');
matches('painter tikka', 'paneer tikka');
matches('chole bhatore', 'chole bhature');
matches('dahi wada', 'dahi vada');
matches('aloo parathaa', 'aloo paratha');

console.log('\none word alone is a suggestion, because several dishes are called it');
{
  // "wada" could be medu vada, dahi vada, vada pav or spinach wada. It
  // must be offered, never applied on its own.
  const r = matchDish('wada', catalogue, preferredIds);
  ok(r.best !== null, '"wada" offers candidates');
  ok(r.best && r.best.score < CONFIDENT_SCORE, '"wada" is not confident enough to apply',
    r.best ? `score ${r.best.score.toFixed(2)} -> ${r.best.name}` : 'no match');
  const names = [r.best?.name, ...r.alternatives.map((a) => a.name)].filter(Boolean);
  ok(names.some((n) => /vada/i.test(n)), 'a vada is among the candidates', names.join(' | '));
}

console.log('\nambiguous on purpose — a suggestion, never a silent correction');
{
  const r = matchDish('dal', catalogue);
  ok(r.best !== null, '"dal" offers candidates');
  ok(r.best && r.best.score < CONFIDENT_SCORE, '"dal" is not confident enough to apply',
    r.best ? `score ${r.best.score.toFixed(2)} -> ${r.best.name}` : 'no match');
}
{
  const r = matchDish('biryani', catalogue);
  ok(r.best !== null, '"biryani" offers candidates');
  ok(r.best && r.best.score < CONFIDENT_SCORE, '"biryani" is not confident enough to apply',
    r.best ? `score ${r.best.score.toFixed(2)} -> ${r.best.name}` : 'no match');
}

console.log('\nnonsense is not matched to something');
noMatch('xyzzy plugh');
noMatch('qqqq');
noMatch('');

console.log('\na whole spoken day');
{
  const { plan, resolutions } = resolveSpokenPlan(
    { breakfast: 'masala dosaa', lunch: 'butter chicken', dinner: 'chole bhatore' },
    catalogue,
    preferredIds,
  );
  ok(plan.breakfast === 'Masala dosa', 'breakfast corrected', plan.breakfast);
  ok(plan.lunch === 'Butter chicken', 'lunch corrected', plan.lunch);
  ok(plan.dinner === 'Chole bhature', 'dinner corrected', plan.dinner);
  ok(resolutions.dinner?.best?.tier === 'near-word', 'dinner needed a near-miss to match',
    resolutions.dinner?.best?.tier);
}

console.log('\nthe meal plan only changes when the match is sure');
{
  const r = matchDish('dal', catalogue);
  ok(r.best && r.best.score < CONFIDENT_SCORE,
    '"dal" alone stays as heard', r.best ? `score ${r.best.score.toFixed(2)}` : 'no match');
  const { plan } = resolveSpokenPlan({ lunch: 'dal' }, catalogue, preferredIds);
  ok(plan.lunch === 'dal', 'the slot keeps the heard words', plan.lunch);
}
{
  const { plan } = resolveSpokenPlan({ lunch: 'paneer tikka' }, catalogue, preferredIds);
  ok(plan.lunch === 'Paneer tikka', 'a certain match is written into the slot', plan.lunch);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
