#!/usr/bin/env node
// Build HomeHub's on-device vegetable index from the Misrak 21k dataset
// (mirrored on Hugging Face as cc92yy3344/vegetable). For each of the 15
// classes, pick 30 reference images, download via HF resolve, base64-embed
// as thumbnails.
// CC BY-SA 4.0 attribution preserved.
//
// Output: src/data/dataset-refs.json

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../src/data/dataset-refs.json");
const PER_CLASS = 30;
const HF_BASE = "https://huggingface.co/datasets/cc92yy3344/vegetable/resolve/main";
const UA = "HomeHub-Dataset/1.0 (household-app)";

// BanglaVegNet canonical ↔ 21k dataset class folder
const FOLDER_MAP = {
  "Bean": "Bean",
  "Bitter_Gourd": "Bitter_Gourd",
  "Bottle_Gourd": "Bottle_Gourd",
  "Brinjal": "Brinjal",
  "Broccoli": "Broccoli",
  "Cabbage": "Cabbage",
  "Capsicum": "Capsicum",
  "Carrot": "Carrot",
  "Cauliflower": "Cauliflower",
  "Cucumber": "Cucumber",
  "Papaya": "Papaya",
  "Potato": "Potato",
  "Pumpkin": "Pumpkin",
  "Radish": "Radish",
  "Tomato": "Tomato",
};

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function listFiles() {
  const r = await fetch("https://huggingface.co/api/datasets/cc92yy3344/vegetable", {
    headers: { "User-Agent": UA },
  });
  if (!r.ok) throw new Error(`HF API ${r.status}`);
  return (await r.json()).siblings.map((s) => s.rfilename);
}

async function fetchAsBase64(url, retries = 4) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") || "";
      if (!ct.startsWith("image/")) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      return {
        b64: `data:${ct};base64,${buf.toString("base64")}`,
        size: buf.length,
      };
    } catch (e) {
      if (attempt === retries - 1) return null;
      await sleep(800 * (attempt + 1));
    }
  }
  return null;
}

async function loadPartial() {
  try {
    const raw = JSON.parse(await fs.readFile(OUT, "utf8"));
    if (raw && Array.isArray(raw.classes)) {
      return raw;
    }
  } catch {}
  return null;
}

async function savePartial(bundle) {
  // Atomic write so partial saves don't corrupt on crash.
  const tmp = OUT + ".tmp";
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(bundle));
  await fs.rename(tmp, OUT);
}

async function processClass(canonicalName, folder, limit, existing) {
  const prefix = `Vegetable Images/train/${folder}/`;
  const all = await listFiles();
  const candidates = all
    .filter((f) => f.startsWith(prefix) && /\.jpe?g$/i.test(f))
    .slice(0, limit * 2); // try 2x, filter rejects some

  // Resume: keep existing matches with the same path so we don't re-download.
  const existingByPath = new Map();
  if (existing?.images) {
    for (const im of existing.images) existingByPath.set(im.path, im);
  }
  const result = existing?.images ? existing.images.slice() : [];

  for (const f of candidates) {
    if (result.length >= limit) break;
    if (existingByPath.has(f)) continue; // already have it
    const url = `${HF_BASE}/${f}`;
    const r = await fetchAsBase64(url);
    if (!r) continue;
    if (r.b64.length > 90_000) continue;
    result.push({ path: f, dataUrl: r.b64 });
    await sleep(80);
  }
  return result.slice(0, limit);
}

async function main() {
  console.log(`Building ${Object.keys(FOLDER_MAP).length}-class × ${PER_CLASS}-image reference index from the Misrak 21k vegetable dataset (HF mirror)…`);

  // Load partial progress if any so we can resume across crashes.
  const partial = await loadPartial();
  const existingMap = new Map();
  if (partial?.classes) {
    for (const c of partial.classes) existingMap.set(c.canonical, c);
  }
  let classes = partial?.classes ?? [];
  let savedTotal = classes.reduce((n, c) => n + (c.images?.length ?? 0), 0);

  const folderNames = Object.values(FOLDER_MAP);
  for (let i = 0; i < folderNames.length; i++) {
    const folder = folderNames[i];
    const canonical = Object.keys(FOLDER_MAP).find((k) => FOLDER_MAP[k] === folder);
    const start = Date.now();
    const images = await processClass(canonical, folder, PER_CLASS, existingMap.get(canonical));
    // Replace this class's entry
    const existingIdx = classes.findIndex((c) => c.canonical === canonical);
    const entry = { canonical, folder, images };
    if (existingIdx >= 0) classes[existingIdx] = entry;
    else classes.push(entry);

    process.stdout.write(`  ${i + 1}/${folderNames.length} ${canonical.padEnd(15)} ${images.length}/${PER_CLASS} images (${Math.round((Date.now() - start) / 100) / 10}s)\n`);
    await sleep(200);

    // Save partial after each class so we don't lose progress on crash.
    const bundle = {
      version: 4,
      source: "Misrak Ahmed et al., Vegetable Image Dataset (2021)",
      sourceUrl: "https://huggingface.co/datasets/cc92yy3344/vegetable",
      license: "CC BY-SA 4.0",
      citation: '@inproceedings{ahmed2021dcnn, title={DCNN-based vegetable image classification using transfer learning}, author={Ahmed and Mamun and Asif}, booktitle={2021 5th International Conference on Computer, Communication and Signal Processing (ICCCSP)}, year={2021}, organization={IEEE} }',
      builtAt: new Date().toISOString(),
      perClassLimit: PER_CLASS,
      classes,
    };
    await savePartial(bundle);
  }

  const totalImages = classes.reduce((n, c) => n + (c.images?.length ?? 0), 0);
  const totalBytes = classes.reduce((n, c) => n + (c.images?.reduce((m, i) => m + (i.dataUrl?.length ?? 0), 0) ?? 0), 0);
  console.log(`\nFinal:`);
  console.log(`  total classes: ${classes.length}/${folderNames.length}`);
  console.log(`  total reference images: ${totalImages}`);
  console.log(`  total bundle size: ${(totalBytes / 1024).toFixed(0)} KB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
