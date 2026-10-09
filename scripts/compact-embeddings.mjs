/**
 * One-time: compact the embeddings JSON from 8-decimal precision to 3-decimal.
 * 384 dims × 5 chars (vs 20) per number cuts the file ~4x.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '../src/data/recipeEmbeddings.json');

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const compact = {};
for (const [k, v] of Object.entries(data)) {
  compact[k] = v.map((x) => Math.round(x * 1000) / 1000);
}
fs.writeFileSync(FILE, JSON.stringify(compact));
console.log(`Compacted. Size: ${(fs.statSync(FILE).size / 1024 / 1024).toFixed(2)} MB · ${Object.keys(compact).length} recipes`);