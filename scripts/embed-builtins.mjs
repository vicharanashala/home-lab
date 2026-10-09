/**
 * Embeds the BUILT-IN recipes and merges them into recipeEmbeddings.json.
 *
 * Why this exists: the original generate-embeddings.mjs only walked
 * csvRecipes.json, so every one of the 5,894 vectors is a `csv-*` id. The 169
 * built-in recipes (STARTER_RECIPES + INDIAN_RECIPES) had NO vector at all.
 * They are exactly the recipes a new user logs from the "From recipe" tab, so
 * every such meal contributed nothing to the taste profile — the taste vector
 * stayed null and the recommender silently fell back to "what's in stock".
 *
 * This adds the missing vectors WITHOUT re-running the 5,894 that already
 * exist, so Discover's existing rankings stay byte-for-byte identical.
 *
 *   node scripts/embed-builtins.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EMB_PATH = path.resolve(ROOT, 'src/data/recipeEmbeddings.json');

// The built-ins are TypeScript, so transpile to a temp module and import it.
// esbuild preserves the source basename when given an outdir.
const tmp = path.join(ROOT, 'node_modules', '.hh-embed-tmp');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
await build({
  entryPoints: [path.join(ROOT, 'src/data/recipes.ts'), path.join(ROOT, 'src/data/indianRecipes.ts')],
  outdir: tmp, format: 'esm', logLevel: 'error',
  // Node treats .js as CommonJS unless the project is type:module, so force
  // the .mjs extension for these generated modules.
  outExtension: { '.js': '.mjs' },
});

const a = await import(`file://${path.join(tmp, 'recipes.mjs')}`);
const b = await import(`file://${path.join(tmp, 'indianRecipes.mjs')}`);
const built = [...(a.STARTER_RECIPES || []), ...(b.INDIAN_RECIPES || [])];
console.log(`Built-in recipes: ${built.length}`);

const existing = JSON.parse(fs.readFileSync(EMB_PATH, 'utf8'));
console.log(`Existing embeddings: ${Object.keys(existing).length}`);

const missing = built.filter((r) => r && r.id && !existing[r.id]);
console.log(`Missing: ${missing.length}`);
if (missing.length === 0) {
  console.log('Nothing to do — all built-ins already embedded.');
  process.exit(0);
}

let pipeline;
try {
  ({ pipeline } = await import('@huggingface/transformers'));
} catch (err) {
  console.error('Failed to load @huggingface/transformers. Run `npm install` first.');
  process.exit(1);
}

console.log('Loading Xenova/all-MiniLM-L6-v2 (downloads ~22MB on first run)…');
const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
console.log('Model loaded.');

/** Must mirror recipeText() in generate-embeddings.mjs so vectors are comparable. */
function recipeText(r) {
  const ing = (r.ingredients || []).map((i) => i.name).filter(Boolean).join(', ');
  return `${r.name}. ${r.cuisine || ''}. ${r.totalTime ? `${r.totalTime}min ` : ''}Ingredients: ${ing}`.slice(0, 512);
}

const DIM = 384;
const BATCH = 16;
for (let i = 0; i < missing.length; i += BATCH) {
  const batch = missing.slice(i, i + BATCH);
  const result = await extractor(batch.map(recipeText), { pooling: 'mean', normalize: true });
  for (let j = 0; j < batch.length; j++) {
    existing[batch[j].id] = Array.from(result.data.slice(j * DIM, (j + 1) * DIM));
  }
  process.stdout.write(`\r  ${Math.min(i + BATCH, missing.length)}/${missing.length}   `);
}

fs.writeFileSync(EMB_PATH, JSON.stringify(existing));
const total = Object.keys(existing).length;
console.log(`\nMerged. Total embeddings: ${total}`);
console.log(`Size: ${(fs.statSync(EMB_PATH).size / 1024 / 1024).toFixed(2)} MB`);
console.log(`Coverage check: ${built.filter((r) => existing[r.id]).length}/${built.length} built-ins embedded`);