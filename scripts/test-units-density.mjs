/**
 * The table that turns a SPOON into a GRAM.
 *
 * WHY THIS MATTERS
 * A recipe says "2 tbsp lentils" and the kitchen shelf holds "500 g lentils".
 * Those are the same quantity only if something knows how heavy a spoonful of
 * lentils is — and that something is the density table in `src/utils/units.ts`.
 * Get it wrong and the app deducts the wrong weight from the user's stock:
 * the shelf says 500 g, the recipe quietly takes 27.6 g of it, and the
 * numbers the user sees do not add up.
 *
 * WHY THE TABLE WAS NEVER MEASURED
 * `src/utils/units.ts` is the only place in the app that turns spoons into
 * grams, and it had NO committed test at all. Every other piece of maths in
 * the app has one — the portions, the household size, the guest scaling, the
 * secret scan. So the rule that decides what a spoonful weighs could change,
 * or could already be wrong, with the whole repository still green.
 *
 * WHY THE "til" TOKEN IS THE BUG
 * The table is a list of rules, and the FIRST rule that matches an ingredient
 * wins. The oil rule listed "til", and the nuts rule — which comes later —
 * ALSO listed "til", for sesame seeds. Because the oil rule comes first and
 * matches the bare substring "til", the nuts rule's "til" could never fire:
 * anything containing "til" had already been claimed by the oil rule.
 *
 *     "til"                -> 0.92  oil    (wrong: "til" on its own is sesame)
 *     "chickpea lentils"   -> 0.92  oil    (wrong: lentils are a dal)
 *     "lentil paste"       -> 0.92  oil    (wrong: the table says 0.7)
 *
 * All three are the same defect: the word "lentil" CONTAINS the letters
 * "til", and a rule that matches loose text cannot tell "til" the oil from
 * "til" inside "lentil". A spoonful of lentils was weighed as a spoonful of
 * oil — 8% heavier than the dal the table itself names for it, and 31%
 * heavier than the lentil paste the table names at 0.7.
 *
 * THE FIX
 * The oil rule keeps "oil", so "til oil" and "sesame oil" are still oil. It
 * no longer claims the bare word "til", which is what the author's own later
 * rule says it is: sesame seeds, with the nuts.
 *
 * WHAT IS DELIBERATELY NOT FIXED HERE
 * The table has other rules shadowed by earlier ones — "besan" is in the
 * flour rule and in the lentil-paste rule, "lentil paste" is caught by the
 * dal rule before the rule that names it. Reordering the table changes the
 * weight of hundreds of ingredients at once, and which value is right for
 * each of them is a cooking judgement, not a debugging pass's call. Those
 * are reported, not changed.
 *
 * Run with:  node scripts/test-units-density.mjs
 */
import { register } from 'node:module';

register('./lib/ts-resolve.mjs', import.meta.url);

const units = await import('../src/utils/units.ts');
const { densityFor, convertBase, toBaseUnit, unitDimension } = units;
const { resolveToCommonDimension } = await import('../src/utils/recipeMatch.ts');

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

function eq(got, want, label) {
  ok(got === want, label, got === want ? String(got) : `got ${got}, expected ${want}`);
}

/** Close enough — the density maths multiplies, and 0.85 is not exact in binary. */
function close(got, want, label) {
  ok(Math.abs(got - want) < 1e-9, label, `got ${got}, expected ${want}`);
}

console.log('\nthe density of an ingredient');
console.log('');

// The dead rule. "til" on its own is sesame — the later nuts rule says so,
// and before the fix it could never be reached.
eq(densityFor('til'), 0.55, 'a bare "til" is sesame, not oil');
eq(densityFor('sesame seeds'), 0.55, 'sesame seeds are seeds');

// The word "lentil" CONTAINS "til", and must not be read as oil.
eq(densityFor('chickpea lentils'), 0.85, 'lentils are weighed as a dal');
eq(densityFor('toor dal'), 0.85, 'toor dal is a dal');
ok(
  densityFor('lentil paste') !== 0.92,
  'lentil paste is not weighed as oil',
  String(densityFor('lentil paste')),
);

// "til" is three letters, and three letters turn up inside other words. The
// catalogue's ingredient names carry the cooking instructions, so these are
// real names the app has to weigh.
//
// They are pinned to the DEFAULT, not to "not a seed": the point is that the
// table has no rule for them and says so, rather than one of its rules
// claiming them by accident. If a rule is ever added for one of these, the
// test asks to be updated on purpose — that is the point of writing the
// number down.
eq(densityFor('Chicken breasts - cooked till tender'), 0.9, '"cooked till tender" is not weighed as a seed');
eq(densityFor('Tortillas'), 0.9, '"tortillas" is not weighed as a seed');
eq(densityFor('Onions - sliced and fried until brown'), 0.9, '"fried until brown" is not weighed as a seed');
eq(densityFor('Dates - pitiless dates cut in halves'), 0.9, '"pitiless" is not weighed as a seed');

// The oil rule must still catch every oil, including the ones with "til" in
// them — the fix removes the bare word, not the oil.
eq(densityFor('til oil'), 0.92, '"til oil" is still oil');
eq(densityFor('sesame oil'), 0.92, '"sesame oil" is still oil');
eq(densityFor('sunflower oil'), 0.92, 'sunflower oil is still oil');
eq(densityFor('ghee'), 0.92, 'ghee is still oil');

console.log('\nthe conversion itself');
console.log('');

// 2 tbsp = 30 ml. Chickpea lentils weigh 0.85 g/ml, so 30 ml is 25.5 g.
// Before the fix this was 30 * 0.92 = 27.6 g — oil.
const tbsp = toBaseUnit(2, 'tbsp');
eq(tbsp?.value, 30, '2 tbsp is 30 ml');
eq(tbsp?.dimension, 'scoop', 'a tablespoon is a scoop');
close(convertBase(30, 'scoop', 'mass', 'chickpea lentils') ?? 0, 25.5, '2 tbsp of lentils is 25.5 g');
close(convertBase(30, 'scoop', 'mass', 'sesame seeds') ?? 0, 16.5, '2 tbsp of sesame is 16.5 g');
close(convertBase(30, 'scoop', 'mass', 'sesame oil') ?? 0, 27.6, '2 tbsp of sesame oil is 27.6 g');

// A volume stays a volume. Nothing is invented.
eq(convertBase(30, 'scoop', 'vol', 'chickpea lentils'), 30, 'a scoop into millilitres is unchanged');
eq(convertBase(30, 'scoop', 'scoop', 'chickpea lentils'), 30, 'a scoop into scoops is unchanged');

// A count cannot absorb a spoonful. The app has to skip the ingredient
// rather than guess, or a "200 g bag of flour" gets deleted by a recipe that
// asked for one cup.
eq(convertBase(30, 'scoop', 'count', 'flour'), null, 'a spoonful cannot become a count');
eq(convertBase(30, 'scoop', 'unknown', 'flour'), null, 'a spoonful cannot become an unknown');

// THE OTHER DIRECTION, AND WHY IT MATTERS
//
// There used to be a second converter here, `convertScoop`, that could only
// go one way: a spoonful into grams. It could not bring grams back into
// millilitres, because it took the amount as millilitres and had no way of
// knowing it was really a mass.
//
// That one-way rule is not a limitation, it is the bug. A shelf measured in
// spoons against a recipe written in grams has to compare, and so does a
// shelf measured in grams against a recipe written in spoons. Converting
// only one side is how "2 cups of flour" deducted 1 cup and left 1.
//
// So the bridge has to work from both sides, which is why there is one
// converter and not two. A converter that only knows one direction is a
// trap for the next person who reaches for it.
close(convertBase(500, 'mass', 'vol', 'milk') ?? 0, 500 / 1.03, '500 g of milk is about 485 ml');
eq(convertBase(500, 'mass', 'count', 'milk'), null, 'a mass cannot become a count');
eq(convertBase(500, 'mass', 'unknown', 'milk'), null, 'a mass cannot become an unknown');

// AND THERE IS ONLY ONE CONVERTER
//
// This assertion is here to keep the second one gone. It is not about the
// numbers — it is about the shape of the module. A one-way converter sitting
// in the units file is a trap: the next person who reaches for "the thing
// that converts spoons" finds it, it compiles, it works in the one direction
// it was written for, and it silently reintroduces the bug it looks like it
// solves.
eq(
  units.convertScoop,
  undefined,
  'units.ts exports no second, one-way converter',
);

console.log('\nthe same answer on both sides of the kitchen');
console.log('');

// The recipe says a spoon, the shelf holds grams: the two have to meet.
const bridged = resolveToCommonDimension(2, 'tbsp', 'chickpea lentils', 500, 'g');
close(bridged?.ingValue ?? 0, 25.5, 'the recipe side is weighed in grams');
close(bridged?.stkValue ?? 0, 500, 'the shelf side is unchanged');
eq(bridged?.dimension, 'mass', 'both sides end up in the same dimension');

// Two spoons and two grams cannot be compared at all.
eq(
  resolveToCommonDimension(2, 'pcs', 'eggs', 500, 'g'),
  null,
  'a count and a weight are not a quantity question',
);

// A malformed amount must not become a NaN that silently deletes a stock row.
eq(
  resolveToCommonDimension(2, 'tbsp', 'chickpea lentils', Number.NaN, 'g'),
  null,
  'a broken shelf amount is skipped, not guessed',
);

console.log('\nthe unit names the app understands');
console.log('');
eq(unitDimension('tbsp'), 'scoop', 'tbsp is a scoop');
eq(unitDimension('kg'), 'mass', 'kg is a mass');
eq(unitDimension('ml'), 'vol', 'ml is a volume');
eq(unitDimension('dozen'), 'count', 'a dozen is a count');
eq(unitDimension('furlong'), 'unknown', 'nonsense is unknown');

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed ? 1 : 0);
