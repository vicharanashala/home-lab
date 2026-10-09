#!/usr/bin/env node
// Expand the BanglaVegNet reference-signature bundle to ~5 images per class
// (was 1) by mining Wikimedia Commons. Outputs the same JSON shape the
// HomeHub index loader already consumes — no code changes needed downstream
// if we replace the file in place.
//
// CC BY-SA / public-domain attribution is recorded per-image.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../src/data/banglaveg-refs.json");
const PER_CLASS_LIMIT = 5;

const CLASSES = [
  { canonical: "Bhindi",          searchTerms: ["Okra pods", "Okra plant", "Lady finger vegetable"] },
  { canonical: "Brinjal",         searchTerms: ["Eggplant", "Brinjal plant", "Aubergine"] },
  { canonical: "Karela",          searchTerms: ["Bitter melon", "Bitter gourd plant"] },
  { canonical: "Lauki",           searchTerms: ["Bottle gourd", "Calabash plant", "Lauki vegetable"] },
  { canonical: "Tomato",          searchTerms: ["Tomato fruit", "Tomato Solanum lycopersicum", "Tomatoes"] },
  { canonical: "Potato",          searchTerms: ["Potato tuber", "Potatoes"] },
  { canonical: "Onion",           searchTerms: ["Onion bulb", "Onions vegetable"] },
  { canonical: "Garlic",          searchTerms: ["Garlic bulb"] },
  { canonical: "Ginger",          searchTerms: ["Ginger root", "Ginger rhizome"] },
  { canonical: "Coriander",       searchTerms: ["Coriander leaves", "Coriander plant"] },
  { canonical: "Chili",           searchTerms: ["Green chili", "Chili pepper"] },
  { canonical: "Capsicum",        searchTerms: ["Bell pepper", "Capsicum"] },
  { canonical: "Cucumber",        searchTerms: ["Cucumber vegetable"] },
  { canonical: "Carrot",          searchTerms: ["Carrot root"] },
  { canonical: "Beetroot",        searchTerms: ["Beetroot Beta vulgaris"] },
  { canonical: "Radish",          searchTerms: ["Radish vegetable"] },
  { canonical: "Radish Leaves",   searchTerms: ["Radish leaves"] },
  { canonical: "Spinach",         searchTerms: ["Spinach leaves"] },
  { canonical: "Cabbage",         searchTerms: ["Cabbage"] },
  { canonical: "Cauliflower",     searchTerms: ["Cauliflower"] },
  { canonical: "Broccoli",        searchTerms: ["Broccoli"] },
  { canonical: "Pumpkin",         searchTerms: ["Pumpkin Cucurbita"] },
  { canonical: "Zucchini",        searchTerms: ["Zucchini", "Courgette"] },
  { canonical: "Ash Gourd",       searchTerms: ["Ash gourd", "Winter melon"] },
  { canonical: "Taro",            searchTerms: ["Taro root"] },
  { canonical: "Elephant Foot Yam", searchTerms: ["Elephant foot yam", "Jimikand"] },
  { canonical: "Pointed Gourd",   searchTerms: ["Pointed gourd", "Trichosanthes"] },
  { canonical: "Snake Gourd",     searchTerms: ["Snake gourd vegetable"] },
  { canonical: "Ridge Gourd",     searchTerms: ["Ridge gourd", "Luffa"] },
  { canonical: "Yardlong Bean",   searchTerms: ["Yardlong bean"] },
  { canonical: "Flat Bean",       searchTerms: ["Flat bean", "Lablab"] },
  { canonical: "Coconut",         searchTerms: ["Coconut Cocos nucifera"] },
  { canonical: "Lime",            searchTerms: ["Lime fruit", "Key lime"] },
  { canonical: "Green Papaya",    searchTerms: ["Green papaya"] },
  { canonical: "Red Amaranth",    searchTerms: ["Red amaranth leaves"] },
  { canonical: "Malabar Spinach", searchTerms: ["Malabar spinach"] },
  { canonical: "Gooseberry",      searchTerms: ["Amla", "Indian gooseberry"] },
  { canonical: "Plantain",        searchTerms: ["Plantain raw banana"] },
  { canonical: "Shaluk",          searchTerms: ["Water chestnut Trapa"] },
  { canonical: "Jicama",          searchTerms: ["Jicama", "Yam bean"] },
  { canonical: "Kohlrabi",        searchTerms: ["Kohlrabi"] },
  { canonical: "Chives Onion",    searchTerms: ["Chinese chives"] },
  // Items unique to the Misrak 21k-vegetable dataset (not in BanglaVeg vocab yet).
  { canonical: "Bean",            searchTerms: ["Green bean", "French bean vegetable"] },
  { canonical: "Papaya",          searchTerms: ["Papaya Carica fruit"] },
];

const UA = "HomeHub-BanglaVeg/1.0 (household-app; contact: best-hom)";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

async function searchFiles(query, limit = 10) {
  const url = new URL(COMMONS_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srnamespace", "6");
  url.searchParams.set("srlimit", String(limit));
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j?.query?.search ?? []).map((s) => s.title);
}

async function getImageInfo(title) {
  const url = new URL(COMMONS_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|extmetadata");
  url.searchParams.set("iiurlwidth", "256");
  url.searchParams.set("titles", title);
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const j = await r.json();
  const page = Object.values(j?.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info?.url) return null;
  return {
    url: info.thumburl ?? info.url,
    licence: info.extmetadata?.LicenseShortName?.value ?? "Unknown",
    artist: info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, "") ?? "Wikimedia Commons contributor",
    title,
  };
}

async function fetchBase64(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get("content-type") || "image/jpeg";
  return `data:${ct};base64,${buf.toString("base64")}`;
}

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function gatherForClass(cls, existing) {
  // Merge with existing dataUrls so we don't redo work.
  const dataUrls = [];
  if (existing?.ok && Array.isArray(existing.dataUrls)) dataUrls.push(...existing.dataUrls);
  if (existing?.ok && existing.dataUrl && !dataUrls.length) dataUrls.push(existing.dataUrl);
  const seenTitles = new Set((existing?.titles ?? []).filter(Boolean));
  const titles = existing?.titles ?? [];
  const licences = existing?.licences ?? [];
  const artists = existing?.artists ?? [];
  const searchQueries = existing?.searchQueries ?? [];

  for (const term of cls.searchTerms) {
    if (dataUrls.length >= PER_CLASS_LIMIT) break;
    const fileTitles = await searchFiles(term, 6);
    for (const ft of fileTitles) {
      if (dataUrls.length >= PER_CLASS_LIMIT) break;
      if (seenTitles.has(ft)) continue;
      // Skip SVGs / icons / drawings sometimes returned.
      if (/\.(svg)$/i.test(ft)) continue;
      try {
        const info = await getImageInfo(ft);
        if (!info?.url) continue;
        const dataUrl = await fetchBase64(info.url);
        if (!dataUrl) continue;
        if (dataUrl.length > 200_000) continue; // skip oversize thumbs
        dataUrls.push(dataUrl);
        titles.push(info.title);
        licences.push(info.licence);
        artists.push(info.artist);
        searchQueries.push(term);
        seenTitles.add(ft);
      } catch {}
      await sleep(120);
    }
    await sleep(150);
  }

  return {
    canonical: cls.canonical,
    ok: dataUrls.length > 0,
    dataUrls,
    dataUrl: dataUrls[0] ?? null, // backwards-compat with v1 loader
    titles,
    licences,
    artists,
    searchQueries,
  };
}

async function main() {
  console.log(`Expanding BanglaVegNet reference index — up to ${PER_CLASS_LIMIT} images per class for ${CLASSES.length} classes…`);
  let existing = null;
  try {
    existing = JSON.parse(await fs.readFile(OUT, "utf8"));
  } catch {}
  const map = Object.fromEntries((existing?.classes ?? []).map((c) => [c.canonical, c]));

  const results = [];
  for (let i = 0; i < CLASSES.length; i++) {
    const cls = CLASSES[i];
    const r = await gatherForClass(cls, map[cls.canonical]);
    results.push(r);
    process.stdout.write(`  ${i + 1}/${CLASSES.length} ${cls.canonical.padEnd(20)} ${r.dataUrls.length}/${PER_CLASS_LIMIT} images\n`);
    await sleep(100);
  }

  const totalImages = results.reduce((n, r) => n + r.dataUrls.length, 0);
  const totalBytes = results.reduce((n, r) => n + r.dataUrls.reduce((m, u) => m + (u?.length ?? 0), 0), 0);
  const bundle = {
    version: 2,
    builtAt: new Date().toISOString(),
    perClassLimit: PER_CLASS_LIMIT,
    classes: results,
    attribution: [
      'Class vocabulary: "BanglaVegNet" — Mendeley Data, DOI: 10.17632/rtx9ngb68j, CC BY 4.0.',
      "Reference images: Wikimedia Commons contributors — each carries its own licence (mostly CC BY-SA or public domain). See per-class `licences` + `artists` fields.",
      "Modifications: resized to 256 px thumbnail, embedded as base64 for offline comparison only; no modifications to image content.",
    ],
  };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(bundle));
  console.log(`\nWrote ${OUT}`);
  console.log(`  classes resolved: ${results.filter((r) => r.dataUrls.length > 0).length}/${CLASSES.length}`);
  console.log(`  total reference images: ${totalImages}`);
  console.log(`  total size: ${(totalBytes / 1024).toFixed(1)} KB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
