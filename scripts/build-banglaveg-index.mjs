#!/usr/bin/env node
// Build the BanglaVegNet reference-signature bundle.
// - One representative Wikimedia Commons image per class (public domain or
//   CC BY-SA, allowed for redistribution with attribution).
// - Embed as base64 data URL inside a JSON file.
// - The browser computes the 1072-dim fingerprint for each on first load.
//
// CC BY 4.0 attribution chain:
//   1. BanglaVegNet class list (Mendeley DOI:10.17632/rtx9ngb68j, CC BY 4.0)
//      → used for vocabulary normalisation, not images.
//   2. Wikimedia Commons photos (each carries its own licence) → used as
//      reference templates for the BanglaVeg classes. Each entry below logs
//      the image's own licence + author so we can attribute in the UI.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../src/data/banglaveg-refs.json");

// 42-class BanglaVeg list, duplicated from src/utils/banglaveg.ts so this
// script can run standalone (no transpilation step).
const CLASSES = [
  { canonical: "Bhindi",          searchTerms: ["Okra pod", "Okra", "Lady finger vegetable"] },
  { canonical: "Brinjal",         searchTerms: ["Eggplant", "Brinjal", "Aubergine"] },
  { canonical: "Karela",          searchTerms: ["Bitter melon", "Bitter gourd"] },
  { canonical: "Lauki",           searchTerms: ["Bottle gourd", "Calabash"] },
  { canonical: "Tomato",          searchTerms: ["Tomato fruit", "Tomato", "Tomatoes"] },
  { canonical: "Potato",          searchTerms: ["Potato tuber", "Potatoes", "Potato"] },
  { canonical: "Onion",           searchTerms: ["Onion bulb", "Onions", "Onion vegetable"] },
  { canonical: "Garlic",          searchTerms: ["Garlic bulb", "Garlic", "Garlic cloves"] },
  { canonical: "Ginger",          searchTerms: ["Ginger root", "Ginger", "Ginger rhizome"] },
  { canonical: "Coriander",       searchTerms: ["Coriander leaves", "Coriander", "Cilantro"] },
  { canonical: "Chili",           searchTerms: ["Green chili", "Chili pepper", "Chilli"] },
  { canonical: "Capsicum",        searchTerms: ["Bell pepper", "Capsicum", "Sweet pepper"] },
  { canonical: "Cucumber",        searchTerms: ["Cucumber", "Cucumbers", "Cucumber fruit"] },
  { canonical: "Carrot",          searchTerms: ["Carrot", "Carrots", "Carrot root"] },
  { canonical: "Beetroot",        searchTerms: ["Beetroot", "Beet", "Beta vulgaris"] },
  { canonical: "Radish",          searchTerms: ["Radish", "Daikon", "Raphanus sativus"] },
  { canonical: "Radish Leaves",   searchTerms: ["Radish leaves", "Daikon greens"] },
  { canonical: "Spinach",         searchTerms: ["Spinach", "Spinacia oleracea"] },
  { canonical: "Cabbage",         searchTerms: ["Cabbage", "White cabbage"] },
  { canonical: "Cauliflower",     searchTerms: ["Cauliflower", "Cauliflowers"] },
  { canonical: "Broccoli",        searchTerms: ["Broccoli", "Broccolini"] },
  { canonical: "Pumpkin",         searchTerms: ["Pumpkin", "Pumpkins", "Cucurbita"] },
  { canonical: "Zucchini",        searchTerms: ["Zucchini", "Courgette", "Cucurbita pepo"] },
  { canonical: "Ash Gourd",       searchTerms: ["Ash gourd", "Winter melon", "Benincasa hispida"] },
  { canonical: "Taro",            searchTerms: ["Taro root", "Taro", "Colocasia esculenta"] },
  { canonical: "Elephant Foot Yam", searchTerms: ["Elephant foot yam", "Amorphophallus", "Suran"] },
  { canonical: "Pointed Gourd",   searchTerms: ["Pointed gourd", "Trichosanthes dioica", "Parwal"] },
  { canonical: "Snake Gourd",     searchTerms: ["Snake gourd", "Trichosanthes cucumiformis"] },
  { canonical: "Ridge Gourd",     searchTerms: ["Ridge gourd", "Luffa", "Angled luffa"] },
  { canonical: "Yardlong Bean",   searchTerms: ["Yardlong bean", "Vigna unguiculata sesquipedalis"] },
  { canonical: "Flat Bean",       searchTerms: ["Flat bean", "Lablab purpureus", "Hyacinth bean"] },
  { canonical: "Coconut",         searchTerms: ["Coconut", "Cocos nucifera", "Coconuts"] },
  { canonical: "Lime",            searchTerms: ["Lime", "Limes", "Key lime", "Citrus aurantiifolia"] },
  { canonical: "Green Papaya",    searchTerms: ["Green papaya", "Raw papaya", "Carica papaya"] },
  { canonical: "Red Amaranth",    searchTerms: ["Red amaranth", "Amaranth leaves", "Amaranthus"] },
  { canonical: "Malabar Spinach", searchTerms: ["Malabar spinach", "Basella alba"] },
  { canonical: "Gooseberry",      searchTerms: ["Indian gooseberry", "Amla", "Phyllanthus emblica"] },
  { canonical: "Plantain",        searchTerms: ["Plantain", "Cooking banana", "Musa"] },
  { canonical: "Shaluk",          searchTerms: ["Water chestnut", "Trapa natans"] },
  { canonical: "Jicama",          searchTerms: ["Jicama", "Pachyrhizus erosus", "Yam bean"] },
  { canonical: "Kohlrabi",        searchTerms: ["Kohlrabi", "Brassica oleracea gongylodes"] },
  { canonical: "Chives Onion",    searchTerms: ["Chinese chives", "Allium tuberosum", "Garlic chives"] },
];

const UA = "HomeHub-BanglaVeg/1.0 (household-app; contact: best-hom)";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

async function searchFile(query) {
  const url = new URL(COMMONS_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srnamespace", "6"); // File: namespace
  url.searchParams.set("srlimit", "5");
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.query?.search?.[0]?.title ?? null;
}

async function getImageInfo(title) {
  const url = new URL(COMMONS_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|extmetadata");
  url.searchParams.set("iiurlwidth", "256"); // thumb, capped
  url.searchParams.set("titles", title);
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const j = await r.json();
  const pages = j?.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  const info = page?.imageinfo?.[0];
  return {
    url: info?.thumburl ?? info?.url,
    licence: info?.extmetadata?.LicenseShortName?.value ?? "Unknown",
    artist: info?.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, "") ?? "Wikimedia Commons contributor",
    title,
  };
}

async function fetchBase64(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  const contentType = r.headers.get("content-type") || "image/jpeg";
  return `data:${contentType};base64,${buf.toString("base64")}`;
}

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function buildOne(cls, existing) {
  if (existing?.ok && existing.dataUrl) {
    return { ...existing, status: "reused" };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let title = null;
      let usedQuery = null;
      for (const term of cls.searchTerms) {
        title = await searchFile(term);
        if (title) { usedQuery = term; break; }
        await sleep(150);
      }
      if (!title) return { canonical: cls.canonical, ok: false, reason: "no-search-hit", triedTerms: cls.searchTerms };
      const info = await getImageInfo(title);
      if (!info?.url) return { canonical: cls.canonical, ok: false, reason: "no-url" };
      const dataUrl = await fetchBase64(info.url);
      if (!dataUrl) return { canonical: cls.canonical, ok: false, reason: "fetch-failed" };
      return {
        canonical: cls.canonical,
        ok: true,
        dataUrl: dataUrl.length > 250_000 ? null : dataUrl,
        tooBig: dataUrl.length > 250_000,
        licence: info.licence,
        artist: info.artist,
        title: info.title,
        searchQuery: usedQuery,
      };
    } catch (e) {
      if (attempt < 2) { await sleep(800 * (attempt + 1)); continue; }
      return { canonical: cls.canonical, ok: false, reason: String(e?.message ?? e) };
    }
  }
  return { canonical: cls.canonical, ok: false, reason: "unknown" };
}

async function main() {
  console.log(`Building BanglaVegNet reference index for ${CLASSES.length} classes…`);
  // Load existing so we keep already-resolved entries.
  let existingBundle = null;
  try {
    existingBundle = JSON.parse(await fs.readFile(OUT, "utf8"));
  } catch {}
  const existingByCanonical = Object.fromEntries(
    (existingBundle?.classes ?? []).map((c) => [c.canonical, c]),
  );

  const results = [];
  for (let i = 0; i < CLASSES.length; i++) {
    const cls = CLASSES[i];
    const r = await buildOne(cls, existingByCanonical[cls.canonical]);
    results.push(r);
    const tag = r.dataUrl
      ? "✓"
      : r.ok
      ? "size-skip"
      : "✗";
    process.stdout.write(`  ${i + 1}/${CLASSES.length} ${cls.canonical.padEnd(20)} ${tag} ${r.reason ?? ""}\n`);
    await sleep(220); // gentle pacing
  }
  const ok = results.filter((r) => r.ok && r.dataUrl).length;
  const totalBytes = results.reduce((n, r) => n + (r.dataUrl?.length ?? 0), 0);
  const bundle = {
    version: 1,
    builtAt: new Date().toISOString(),
    classes: results,
    attribution: [
      'Class vocabulary: "BanglaVegNet" — Mendeley Data, DOI: 10.17632/rtx9ngb68j, CC BY 4.0.',
      "Reference images: Wikimedia Commons contributors — each carries its own licence (most are CC BY-SA or public domain). See per-class `licence` and `artist` fields.",
      "Modifications: resized to 256 px thumbnail, embedded as base64 for offline comparison only; no modifications to image content.",
    ],
  };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(bundle));
  console.log(`\nWrote ${OUT}`);
  console.log(`  classes resolved: ${ok}/${CLASSES.length}`);
  console.log(`  total size: ${(totalBytes / 1024).toFixed(1)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
