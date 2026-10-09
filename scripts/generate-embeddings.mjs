/**
 * ML embedding generation script.
 *
 * Uses a real transformer model (Xenova/all-MiniLM-L6-v2 — 22MB, ONNX)
 * to embed every recipe in catalog.json into a 384-dim vector. The model
 * understands semantic meaning: "palak" is closer to "spinach" than to
 * "chocolate". Output: src/data/recipeEmbeddings.json (~9MB).
 *
 * Run from project root:
 *   node scripts/generate-embeddings.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.resolve(__dirname, '../src/data/csvRecipes.json');
const OUT = path.resolve(__dirname, '../src/data/recipeEmbeddings.json');

const recipes = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
console.log(`Loaded ${recipes.length} recipes`);

// Lazy-load the model so users without node-fetch see a clear error.
let pipeline;
try {
  ({ pipeline } = await import('@huggingface/transformers'));
} catch (err) {
  console.error('Failed to load @huggingface/transformers. Run `npm install` first.');
  process.exit(1);
}

console.log('Loading model Xenova/all-MiniLM-L6-v2 (22MB ONNX, first run downloads it)…');
const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
console.log('Model loaded.');

// Build a rich text representation per recipe so the embeddings capture
// cuisine, dish style, and ingredient flavor.
function recipeText(r) {
  const ing = (r.ingredients || []).map((i) => i.name).filter(Boolean).join(', ');
  const cuisine = r.cuisine || '';
  const time = r.totalTime ? `${r.totalTime}min ` : '';
  return `${r.name}. ${cuisine}. ${time}Ingredients: ${ing}`.slice(0, 512);
}

const BATCH = 32;
const out = {};
let processed = 0;
const t0 = Date.now();

for (let i = 0; i < recipes.length; i += BATCH) {
  const batch = recipes.slice(i, i + BATCH);
  const texts = batch.map(recipeText);
  const result = await extractor(texts, { pooling: 'mean', normalize: true });
  // result.data is Float32Array; split into per-recipe 384-dim vectors.
  const dim = 384;
  for (let j = 0; j < batch.length; j++) {
    out[batch[j].id] = Array.from(result.data.slice(j * dim, (j + 1) * dim));
    processed++;
  }
  if (processed % 100 === 0 || processed === recipes.length) {
    const pct = ((processed / recipes.length) * 100).toFixed(1);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const rate = (processed / elapsed).toFixed(1);
    process.stdout.write(`\r  ${processed}/${recipes.length} (${pct}%) · ${elapsed}s · ${rate} rec/s   `);
  }
}

console.log('\n');
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${Object.keys(out).length} embeddings to ${OUT}`);
console.log(`Size: ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);
console.log(`Model: Xenova/all-MiniLM-L6-v2 (q8 quantized, ~22MB ONNX, real transformer)`);