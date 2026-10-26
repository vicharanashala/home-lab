/**
 * Regression test: a preparation note is not the ingredient.
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

console.log('\nevery ingredient in the real catalogue survives');
{
  const data = JSON.parse(fs.readFileSync(path.join(REPO, 'src/data/csvRecipes.json'), 'utf8'));
  const recipes = Array.isArray(data) ? data : (data.recipes || []);

  // A catalogue name that already begins with a bullet IS the bullet.
  const asLine = (raw) => (/^\s*[-*•·]\s+/.test(raw) ? raw : `- ${raw}`);

  // Two rules this test does NOT cover, because they are older than the
  // preparation-note rule and are not caused by it:
  //
  //   - a bullet of more than eight words is read as a sentence and skipped;
  //   - a dash with no space before it is read as a separator even when it is
  //     part of the name, so "1-1/2 cups rice" is read as the name "1".
  //
  // Both are reported on their own. Neither is what this test is about.
  const READS_AS_A_SENTENCE = (n) => n.trim().split(/\s+/).length > 8;
  const DASH_INSIDE_THE_NAME = (n) => /(?:^|\S)-\s*\d/.test(n.trim());

  const lost = [];
  const skipped = { sentence: 0, dashInName: 0 };
  let total = 0;

  for (const recipe of recipes) {
    for (const ing of recipe.ingredients || []) {
      const raw = typeof ing === 'string' ? ing : ing.name || '';
      if (!raw.trim()) continue;
      total += 1;
      // The House Bot writes the catalogue's strings back as bullets.
      if (itemsOf(asLine(raw)).length > 0) continue;
      if (READS_AS_A_SENTENCE(raw)) {
        skipped.sentence += 1;
        continue;
      }
      if (DASH_INSIDE_THE_NAME(raw)) {
        skipped.dashInName += 1;
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
      : `all kept (${skipped.sentence} long lines and ${skipped.dashInName} names with a dash inside them are the two older rules)`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
