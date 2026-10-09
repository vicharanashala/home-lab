/**
 * One-time script: parse Cleaned_Indian_Food_Dataset.csv into a JSON
 * the app can import directly. Run from project root:
 *
 *   node scripts/parse-csv-recipes.mjs
 *
 * Output: src/data/csvRecipes.json (loads at build time, zero runtime cost).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV = path.resolve(__dirname, '../src/data/Cleaned_Indian_Food_Dataset.csv');
const OUT = path.resolve(__dirname, '../src/data/csvRecipes.json');

const csvText = fs.readFileSync(CSV, 'utf8');

// Minimal CSV parser — handles double-quoted fields with commas inside.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch === '\r') { /* skip */ }
      else cell += ch;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const rows = parseCsv(csvText);
const header = rows[0];
const idx = (name) => header.indexOf(name);
const recipes = [];

// Map cuisine → mealType. Default to lunch.
function mealTypeFor(cuisine) {
  const c = (cuisine || '').toLowerCase();
  if (c.includes('snack') || c.includes('street food')) return 'snack';
  if (c.includes('dessert') || c.includes('sweet')) return 'sweet';
  if (c.includes('breakfast')) return 'breakfast';
  if (c.includes('dinner')) return 'dinner';
  return 'lunch';
}

// Common units in the data, mapped to canonical short forms.
const UNIT_MAP = {
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  cup: 'cup',
  cups: 'cup',
  pinch: 'pinch',
  grams: 'g',
  gram: 'g',
  kg: 'kg',
  millilitres: 'ml',
  milliliter: 'ml',
  litre: 'l',
  liters: 'l',
  pieces: 'pcs',
  piece: 'pcs',
};

// Parse "<qty> <unit> <name>" or "<name> only".
// Examples:
//   "1 tablespoon Red Chilli powder"      → { quantity: 1, unit: 'tbsp', name: 'Red Chilli powder' }
//   "Salt - to taste"                       → { quantity: 1, unit: 'pinch', name: 'Salt' }
//   "3 tomatoes"                            → { quantity: 3, unit: 'pcs', name: 'tomatoes' }
//   "Sunflower Oil - as required"           → { quantity: 1, unit: 'ml', name: 'Sunflower Oil' }
function parseIngredient(text) {
  const original = text.trim();
  if (!original) return null;

  // Strip trailing notes like " - thinly sliced", " - deseeded", " - to taste", " - as required"
  const cleaned = original.replace(/\s*-\s*(to\s+taste|as\s+required|as\s+per\s+taste|thinly\s+sliced|deseeded|finely\s+chopped|chopped|minced|optional|adjusted)\s*$/i, '').trim();

  // Try to match: "<number or fraction> <optional unit> <name>"
  // Examples: "1 onion", "1/2 cup sugar", "1 1/2 cups rice"
  const fractionMap = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.333, '⅔': 0.667 };
  const tokens = cleaned.split(/\s+/);

  let quantity = 1;
  let unit = 'pcs';
  let nameStart = 0;

  // Find first numeric token (with optional fraction).
  if (tokens.length >= 1) {
    const firstTok = tokens[0].replace(',', '');
    if (/^\d+\/\d+$/.test(firstTok)) {
      const [n, d] = firstTok.split('/').map(Number);
      quantity = n / d;
      nameStart = 1;
    } else if (fractionMap[firstTok] !== undefined) {
      quantity = fractionMap[firstTok];
      nameStart = 1;
    } else if (/^\d+(\.\d+)?$/.test(firstTok)) {
      quantity = Number(firstTok);
      nameStart = 1;
      // Handle "1-1/2" or "1 1/2" (compound number).
      if (tokens.length >= 2 && /^\d+\/\d+$/.test(tokens[1])) {
        const [n, d] = tokens[1].split('/').map(Number);
        quantity += n / d;
        nameStart = 2;
      }
    }
  }

  // Find optional unit token after quantity.
  if (nameStart < tokens.length) {
    const maybeUnit = tokens[nameStart].toLowerCase().replace(/[.,;]$/, '');
    if (UNIT_MAP[maybeUnit]) {
      unit = UNIT_MAP[maybeUnit];
      nameStart += 1;
    }
  }

  // The rest is the name.
  let name = tokens.slice(nameStart).join(' ').trim();
  if (!name) name = cleaned;

  // Clean up the name: strip parenthetical aliases for compactness, keep main name.
  name = name.replace(/\s*\([^)]*\)/g, '').trim();
  // Title case for nicer display.
  name = name.charAt(0).toUpperCase() + name.slice(1);

  return { name, quantity, unit };
}

const seen = new Set();
let skippedDup = 0;
let skippedBad = 0;

for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  const name = (row[idx('TranslatedRecipeName')] || '').replace(/\s+Recipe$/i, '').replace(/\s+\(Recipe\)$/i, '').trim();
  const cuisine = row[idx('Cuisine')] || '';
  const cleanedIngredients = (row[idx('Cleaned-Ingredients')] || '').trim();
  const translatedIngredients = (row[idx('TranslatedIngredients')] || '').trim();
  const totalTime = Number(row[idx('TotalTimeInMins')]) || 30;
  const imageUrl = (row[idx('image-url')] || '').trim();

  if (!name || !cleanedIngredients) { skippedBad++; continue; }
  if (seen.has(name.toLowerCase())) { skippedDup++; continue; }
  seen.add(name.toLowerCase());

  // Prefer TranslatedIngredients for quantities, fall back to Cleaned-Ingredients for names.
  const ingredientText = translatedIngredients || cleanedIngredients;
  const parsed = ingredientText
    .split(/,(?![^()]*\))/) // split on top-level commas only
    .map((s) => parseIngredient(s))
    .filter((ing) => ing && ing.name && ing.name.length >= 2);

  if (parsed.length === 0) { skippedBad++; continue; }

  // Dedupe ingredients by normalized name+unit, summing quantities.
  const dedupe = new Map();
  for (const ing of parsed) {
    const key = (ing.name + '|' + ing.unit).toLowerCase();
    const prev = dedupe.get(key);
    if (prev) prev.quantity += ing.quantity;
    else dedupe.set(key, { ...ing });
  }
  const deduped = Array.from(dedupe.values());

  // Build a stable id from the name.
  const id = 'csv-' + name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);

  recipes.push({
    id,
    name: name.length > 80 ? name.slice(0, 77) + '…' : name,
    emoji: '🍽️',
    mealType: mealTypeFor(cuisine),
    baseServings: 2,
    ingredients: deduped.slice(0, 20), // cap at 20 ingredients per recipe
    cuisine: cuisine || 'Indian',
    imageUrl,
    totalTime,
    source: 'csv',
  });
}

console.log(`Parsed: ${recipes.length} unique recipes`);
console.log(`Skipped: ${skippedDup} dup, ${skippedBad} bad/empty`);

fs.writeFileSync(OUT, JSON.stringify(recipes));
console.log(`Wrote: ${OUT}`);
console.log(`Size: ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);