/**
 * Regression test: a preparation note is not the ingredient.
 *
 * AND: the quantity the catalogue writes comes off the front of the name.
 *
 * THE SECOND BUG
 *
 * The catalogue writes a mixed number with a hyphen, not with a decimal
 * point:
 *
 *     "1-1/2 cups All Purpose Flour"   "2-1/4 cups Water"
 *     "1-1 / 2 cups rice - cooked"      "1-3/4 teaspoon Salt"
 *
 * 933 of its 10,925 distinct ingredient strings are written that way, and the
 * House Bot is fed those strings verbatim in its RECIPES context block — so it
 * writes its grocery list in the same shape.
 *
 * The parser's number knew "1/2" and "1.5" and nothing else, so the leading
 * quantity was not a quantity at all: no pattern matched it, the bare-number
 * rule could not match it either, and the line fell through to be a NAME.
 * Then the rule that strips a trailing quantity took the dash INSIDE the
 * number for a separator and ate the rest of the line with it:
 *
 *     "1-1/2 cups All Purpose Flour"   ->   "1"
 *
 * One character is under the two-character minimum, so the ingredient was
 * thrown away. 1,390 of the catalogue's 70,093 ingredient strings were lost
 * that way — not written with a wrong quantity, not written at all.
 *
 * THE BUG
 *
 * A rule was added to the grocery-list parser to keep a bullet that names a
 * DISH off the shopping list:
 *
 *     "Kadhai paneer — needs paneer, tomato, onion"
 *
 * It was written as "a line with a spaced dash in it is not an item". That is
 * not the same rule, and the catalogue's own ingredient strings are written
 * that way:
 *
 *     "Onion - sliced"               "Fresh coconut - grated"
 *     "Sunflower Oil - for cooking"  "Green Chillies - slit"
 *
 * 16,420 of the catalogue's 70,093 ingredient strings have a spaced dash in
 * them, and the House Bot is fed those strings verbatim in its RECIPES
 * context block — so it writes its grocery list in the same shape. Every one
 * of those bullets was thrown away, and the onion went with the note.
 *
 * WHAT IT LOOKS LIKE TO THE USER
 *
 * The bot answers "Make me a grocery list for dal tadka" with a list of
 * eight ingredients. The panel under the reply says "3 items ready to add",
 * and only three of them are ingredients. The rest never reach the list.
 *
 * The name that DID survive was worse than useless: "Onion - sliced" is not
 * "Onion", and stock matching is exact, so an item called "Onion - sliced"
 * never matched the kitchen's "Onion" either.
 *
 * THE RULE
 *
 * A note after a dash is a PREPARATION NOTE. It comes off the name and the
 * ingredient stays: "Onion - sliced" is "Onion".
 *
 * A note that names OTHER things to buy — it lists them, or it says the line
 * needs them — means the line is a dish, and a dish is not an item. That
 * case still drops the line.
 *
 * And a dash that is part of a NUMBER is not a separator at all: "1-1/2 cups
 * All Purpose Flour" is a quantity and a name, not a name with a quantity
 * stripped off it.
 *
 * THE PROOF
 *
 * The test drives the REAL parser, and then drives the REAL stock matcher
 * with the name it produced — because a name is only worth anything if the
 * kitchen's "Onion" can find it.
 *
 * It also drives the parser with the REAL catalogue, all 70,093 ingredient
 * strings, so the rule is measured against the house's own writing rather
 * than against examples picked to suit it.
 *
 * Run with:  node scripts/test-grocery-list-parser.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

// The app's modules import each other without a file extension, so node's
// resolver needs the hook before they are loaded.
register('./lib/ts-resolve.mjs', import.meta.url);

const { parseGroceryList } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/groceryListParser.ts')).href
);
const { findCandidatesForIngredient } = await import(
  pathToFileURL(path.join(REPO, 'src/utils/recipeMatch.ts')).href
);

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

const itemsOf = (text) => parseGroceryList(text);
const namesOf = (text) => itemsOf(text).map((i) => i.name);

console.log('\nthe preparation note comes off, the ingredient stays');
{
  const names = namesOf(
    ['- Onion - sliced', '- Fresh coconut - grated', '- Sunflower Oil - for cooking'].join('\n'),
  );
  ok(names.includes('Onion'), 'Onion - sliced is still an onion', names.join(' | '));
  ok(names.includes('Fresh coconut'), 'Fresh coconut - grated is still coconut', names.join(' | '));
  ok(
    names.includes('Sunflower Oil'),
    'Sunflower Oil - for cooking is still oil',
    names.join(' | '),
  );
  ok(!names.some((n) => n.includes('-')), 'no name carries its note', names.join(' | '));
  ok(names.length === 3, 'and all three are there', names.join(' | '));
}

console.log('\na dish is still not an item');
{
  const names = namesOf(
    [
      '- Kadhai paneer — needs paneer, tomato, onion',
      '- Palak paneer - needs spinach, green chilli',
      '- Rice',
    ].join('\n'),
  );
  ok(
    !names.some((n) => /paneer/i.test(n)),
    'a dish with a list of ingredients is not an item',
    names.join(' | '),
  );
  ok(names.includes('Rice'), 'the plain ingredient beside it is kept', names.join(' | '));
}

console.log('\na comma in a preparation note is not a dish');
{
  // THE BUG: the rule that kept a dish off the list read "the note has a
  // comma" as "the note lists ingredients". The House Bot writes the
  // quantity and the preparation detail in one comma-separated note —
  // "Sugar — ½ tsp, optional" — and the sugar was thrown away with the
  // note. These three lines are what the running app actually wrote when
  // it was asked for a grocery list; they were captured from the live
  // reply, not written here to suit the rule.
  const names = namesOf(
    [
      '- Sugar — ½ tsp, optional',
      '- Fresh coconut — ½ cup, grated',
      '- Lemon — optional, for serving',
    ].join('\n'),
  );
  ok(names.includes('Sugar'), 'the sugar survives its "optional"', names.join(' | '));
  ok(names.includes('Fresh coconut'), 'the coconut survives its "grated"', names.join(' | '));
  ok(names.includes('Lemon'), 'the lemon survives its "for serving"', names.join(' | '));
  ok(names.length === 3, 'and all three are there', names.join(' | '));
}

console.log('\na note that lists ingredients is still a dish');
{
  // The fix must not let dishes back onto the list: a note whose parts
  // name two or more things you can buy is a dish listing what it is made
  // of, whether or not the note opens with "needs".
  const names = namesOf(
    [
      '- Paneer tikka - paneer, tomato, onion',
      '- Dal - lentils, ghee, tomato',
    ].join('\n'),
  );
  ok(
    names.length === 0,
    'a dish that enumerates its ingredients is not an item',
    names.join(' | '),
  );
}

console.log('\nthe three dashes are treated the same');
{
  // Each dash is checked on its own. Checked together they would hide each
  // other: the parser drops a name it has already seen, so one dash
  // surviving is enough to make the list look right.
  for (const dash of ['-', '–', '—']) {
    const names = namesOf(`- Salt ${dash} a pinch`);
    ok(
      names.length === 1 && names[0] === 'Salt',
      `"${dash}" is a separator like the others`,
      names.join(' | '),
    );
  }
}

console.log('\nthe name the parser produces is one the kitchen can match');
{
  const names = namesOf('- Onion - sliced');
  const candidates = findCandidatesForIngredient(
    { name: names[0] ?? 'Onion - sliced', quantity: 1, unit: 'pcs', category: 'vegetables' },
    [{ id: 's1', name: 'Onion', quantity: 500, unit: 'g', category: 'vegetables' }],
  );
  ok(
    candidates.length === 1 && candidates[0].id === 's1',
    'a parsed onion finds the kitchen’s onion',
    `parsed as "${names[0]}"`,
  );
}

console.log('\nthe rules that were already here still hold');
{
  ok(namesOf('1. **Onion** — 1 pc').includes('Onion'), 'a bold name with a trailing quantity');
  ok(namesOf('- Semi-dried tomatoes').includes('Semi-dried tomatoes'), 'a hyphen inside a name survives');
  ok(namesOf('- Onions').includes('Onions'), 'a plain name survives');
  ok(namesOf('- Ingredients:').length === 0, 'a heading is not an item');

  const items = itemsOf('- 2 Onions - sliced');
  ok(items.length === 1 && items[0].name === 'Onions', 'the quantity is lifted off the front');
  ok(items[0]?.quantity === '2', 'and the quantity is kept', items[0]?.quantity);
}

console.log('\nthe quantity the catalogue writes comes off the front of the name');
{
  // THE CATALOGUE WRITES A MIXED NUMBER WITH A HYPHEN.
  //
  //     "1-1/2 cups All Purpose Flour"   "2-1/4 cups Water"
  //     "1-1 / 2 cups rice - cooked"      "1-3/4 teaspoon Salt"
  //
  // 933 of the catalogue's 10,925 distinct ingredient strings are written this
  // way, and the House Bot is fed those strings verbatim in its RECIPES block,
  // so it writes its grocery list in the same shape.
  //
  // The parser's number knew "1/2" and "1.5" and nothing else, so the leading
  // quantity was not a quantity at all — no pattern matched it, and the
  // bare-number rule could not match it either. The line fell through to be a
  // NAME, and then the rule that strips a trailing quantity took the dash
  // INSIDE the number for a separator and ate the rest of the line with it:
  //
  //     "1-1/2 cups All Purpose Flour"   ->   "1"   ->   the ingredient
  //                                                            thrown away
  //
  // 1,390 of the catalogue's 70,093 ingredient strings were lost that way.
  // They were not written with a wrong quantity. They were not written at all.
  const cases = [
    {
      bullet: '- 1-1/2 cups All Purpose Flour',
      name: 'All Purpose Flour',
      quantity: '1-1/2 cups',
    },
    {
      bullet: '- 1-1/4 cups Lukewarm Water',
      name: 'Lukewarm Water',
      quantity: '1-1/4 cups',
    },
    {
      bullet: '- 1-1 / 2 cup brown rice',
      name: 'brown rice',
      quantity: '1-1 / 2 cup',
    },
    {
      bullet: '- 2-3 Curry leaves',
      name: 'Curry leaves',
      quantity: '2-3',
    },
  ];

  for (const c of cases) {
    const item = itemsOf(c.bullet)[0];
    ok(item !== undefined, `"${c.bullet}" is an item at all`, JSON.stringify(item));
    ok(
      item?.name === c.name,
      `the quantity comes off the name of "${c.bullet}"`,
      `the name is ${JSON.stringify(item?.name)}`,
    );
    ok(
      item?.quantity === c.quantity,
      `and it reads back as "${c.quantity}"`,
      `the parser wrote ${JSON.stringify(item?.quantity)}`,
    );
  }

  // A dash inside a number is not a separator, and a preparation note after
  // the quantity still comes off the name.
  const noted = itemsOf('- 1-1/2 cups Green peas - steamed and mashed')[0];
  ok(
    noted?.name === 'Green peas' && noted?.quantity === '1-1/2 cups',
    'a note after a mixed quantity still comes off the name',
    JSON.stringify(noted),
  );

  // A name the kitchen can match is the whole point of taking the quantity
  // off it — stock matching is exact.
  const matched = findCandidatesForIngredient(
    { name: noted?.name ?? '', quantity: 1.5, unit: 'cups', category: 'vegetables' },
    [{ id: 's1', name: 'Green peas', quantity: 500, unit: 'g', category: 'vegetables' }],
  );
  ok(
    noted !== undefined && matched.length === 1 && matched[0].id === 's1',
    'and the name it made is still findable on the shelf',
    `the name was ${JSON.stringify(noted?.name)}`,
  );
}

console.log('\nthe mark in front of the quantity is not part of it');
{
  // THE CATALOGUE WRITES A MARK IN FRONT OF THE NUMBER.
  //
  //     "- 3 Saffron strands"        a bullet of the catalogue's own
  //     "+ 1 Onion"                  a stray plus
  //     "/ 4 tsp cinnamon powder"    a stray slash
  //     "-3 Green Chillies - sliced" a bullet with no space after it
  //
  // 60 of the catalogue's 10,925 distinct ingredient strings are written with
  // one, and the House Bot writes those strings under a bullet of its own, so
  // the mark is still there when the parser sees the line:
  //
  //     "- - 6 Artichokes - roughly chopped"
  //
  // The mark is not part of the quantity. It has to come off BEFORE the
  // number is read, or the number never reads as a number, every pattern
  // fails, and the whole line stays a NAME:
  //
  //     "- 6 Artichokes"   ->   an item called "- 6 Artichokes", quantity "1"
  //
  // and the name is not the kitchen's "Artichokes". Stock matching is exact,
  // so the row the household shops from and the row on the shelf are two
  // different things, and the shopping list says "6" for an artichoke row the
  // kitchen already has.
  const cases = [
    { bullet: '- - 3 Saffron strands', name: 'Saffron strands', quantity: '3' },
    { bullet: '- - 6 Artichokes - roughly chopped', name: 'Artichokes', quantity: '6' },
    { bullet: '- - 1/2 turmeric powder', name: 'turmeric powder', quantity: '1/2' },
    { bullet: '- + 1 Onion', name: 'Onion', quantity: '1' },
    { bullet: '- / 4 tsp cinnamon powder', name: 'cinnamon powder', quantity: '4 tsp' },
    { bullet: '- - 1-1 1/2 cups Water', name: 'Water', quantity: '1-1 1/2 cups' },
    { bullet: '- - 1//4 cups Sugar', name: 'Sugar', quantity: '1//4 cups' },
  ];

  for (const c of cases) {
    const item = itemsOf(c.bullet)[0];
    ok(item !== undefined, `"${c.bullet}" is an item at all`, JSON.stringify(item));
    ok(
      item?.name === c.name,
      `the quantity comes off the name of "${c.bullet}"`,
      `the name is ${JSON.stringify(item?.name)}`,
    );
    ok(
      item?.quantity === c.quantity,
      `and it reads back as "${c.quantity}"`,
      `the parser wrote ${JSON.stringify(item?.quantity)}`,
    );
  }

  // The mark has to be a MARK. A dash in the middle of a line is a
  // preparation note, and a dash inside a name is part of the name.
  const kept = itemsOf('- Semi-dried tomatoes - chopped')[0];
  ok(
    kept?.name === 'Semi-dried tomatoes',
    'a dash inside a name is still part of the name',
    JSON.stringify(kept),
  );
}

console.log('\nevery ingredient in the real catalogue survives');
{
  const data = JSON.parse(fs.readFileSync(path.join(REPO, 'src/data/csvRecipes.json'), 'utf8'));
  const recipes = Array.isArray(data) ? data : (data.recipes || []);

  // A catalogue name that already begins with a bullet IS the bullet.
  const asLine = (raw) => (/^\s*[-*•·]\s+/.test(raw) ? raw : `- ${raw}`);

  // One rule this test does NOT cover, because it is older than the
  // preparation-note rule and is not caused by it:
  //
  //   - a bullet of more than eight words is read as a sentence and skipped.
  //
  // It is reported on its own. It is not what this test is about.
  //
  // THE OTHER EXCLUSION THAT WAS HERE IS GONE: "a dash with no space before
  // it is read as a separator even when it is part of the name, so
  // '1-1/2 cups rice' is read as the name '1'". That was a real rule, and it
  // threw 1,390 of the catalogue's ingredient strings away. The dash inside a
  // number is not a separator now, and the mixed number the catalogue writes
  // is a quantity.
  const READS_AS_A_SENTENCE = (n) => n.trim().split(/\s+/).length > 8;

  const lost = [];
  const stuck = [];
  let total = 0;
  let sentence = 0;

  for (const recipe of recipes) {
    for (const ing of recipe.ingredients || []) {
      const raw = typeof ing === 'string' ? ing : ing.name || '';
      if (!raw.trim()) continue;
      total += 1;
      // The House Bot writes the catalogue's strings back as bullets.
      const items = itemsOf(asLine(raw));
      if (items.length > 0) {
        // Surviving is not enough: a name that still carries the number at
        // the front of it is not the kitchen's ingredient. The quantity has to
        // come off the name, or the shopping row and the shelf row are two
        // different things — and the shopping row says "1" for an ingredient
        // the kitchen asked for by a count.
        if (/^\s*\d/.test(items[0].name)) {
          if (stuck.length < 5) stuck.push(raw);
        }
        continue;
      }
      if (READS_AS_A_SENTENCE(raw)) {
        sentence += 1;
        continue;
      }
      lost.push(raw);
    }
  }

  ok(total > 70000, 'the catalogue is the real one', `${total} ingredient strings`);
  ok(
    lost.length === 0,
    'no catalogue ingredient is dropped',
    lost.length
      ? `${lost.length} lost, e.g. ${lost.slice(0, 3).map((s) => JSON.stringify(s)).join(', ')}`
      : `all kept (${sentence} long lines are read as sentences and skipped)`,
  );
  ok(
    stuck.length === 0,
    'no catalogue ingredient keeps its quantity in the name',
    stuck.length
      ? `${stuck.length} stuck, e.g. ${stuck.map((s) => JSON.stringify(s)).join(', ')}`
      : 'the quantity comes off every one of them',
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
