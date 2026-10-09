#!/usr/bin/env node
// Second-pass expansion: pull the LEAD image from each vegetable's
// Wikipedia article (much more reliable than keyword search) plus a
// few Wikimedia Commons top-results. Output goes into banglaveg-refs.json
// alongside any existing v2 data so no progress is lost.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../src/data/banglaveg-refs.json");
const PER_CLASS_TARGET = 4;
const UA = "HomeHub-BanglaVeg/1.0 (household-app; contact: best-hom)";

// Mapping: BanglaVeg canonical → Wikipedia article title (English)
const WIKI_TITLE = {
  "Bhindi": "Okra",
  "Brinjal": "Eggplant",
  "Karela": "Momordica_charantia",
  "Lauki": "Bottle_gourd",
  "Tomato": "Tomato",
  "Potato": "Potato",
  "Onion": "Onion",
  "Garlic": "Garlic",
  "Ginger": "Ginger",
  "Coriander": "Coriander",
  "Chili": "Chili_pepper",
  "Capsicum": "Bell_pepper",
  "Cucumber": "Cucumber",
  "Carrot": "Carrot",
  "Beetroot": "Beetroot",
  "Radish": "Radish",
  "Radish Leaves": "Radish",
  "Spinach": "Spinach",
  "Cabbage": "Cabbage",
  "Cauliflower": "Cauliflower",
  "Broccoli": "Broccoli",
  "Pumpkin": "Pumpkin",
  "Zucchini": "Zucchini",
  "Ash Gourd": "Winter_melon",
  "Taro": "Taro",
  "Elephant Foot Yam": "Amorphophallus_paeoniifolius",
  "Pointed Gourd": "Trichosanthes_dioica",
  "Snake Gourd": "Trichosanthes_cucumiformis",
  "Ridge Gourd": "Luffa_acutangula",
  "Yardlong Bean": "Yardlong_bean",
  "Flat Bean": "Lablab_purpureus",
  "Coconut": "Coconut",
  "Lime": "Lime_(fruit)",
  "Green Papaya": "Papaya",
  "Red Amaranth": "Amaranthus",
  "Malabar Spinach": "Basella_alba",
  "Gooseberry": "Phyllanthus_emblica",
  "Plantain": "Plantain",
  "Shaluk": "Trapa_natans",
  "Jicama": "Pachyrhizus_erosus",
  "Kohlrabi": "Kohlrabi",
  "Chives Onion": "Allium_tuberosum",
  "Bean": "Bean",
  "Papaya": "Papaya",
};

const CLASSES = Object.keys(WIKI_TITLE);

const WIKI_PAGEINFO = "https://en.wikipedia.org/w/api.php";
const WIKI_IMAGEINFO = "https://en.wikipedia.org/w/api.php";

async function getArticleLeadImage(title) {
  // Get the lead image filename from the article's pageimages.
  const url = new URL(WIKI_PAGEINFO);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "pageimages");
  url.searchParams.set("piprop", "original|name");
  url.searchParams.set("titles", title);
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const j = await r.json();
  const pages = j?.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  const name = page?.pageimage;
  if (!name) return null;
  return name.replace(/ /g, "_");
}

async function getCommonsThumb(fileTitle, width = 384) {
  // Convert a File:Title into a thumbnail URL via Wikimedia Commons API.
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|extmetadata");
  url.searchParams.set("iiurlwidth", String(width));
  url.searchParams.set("titles", "File:" + fileTitle);
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const j = await r.json();
  const pages = j?.query?.pages;
  if (!pages) return null;
  const info = Object.values(pages)[0]?.imageinfo?.[0];
  if (!info?.thumburl && !info?.url) return null;
  return {
    url: info.thumburl ?? info.url,
    licence: info.extmetadata?.LicenseShortName?.value ?? "Unknown",
    artist: info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, "") ?? "Wikipedia contributor",
    title: fileTitle,
  };
}

async function searchCommons(query, limit = 6) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srnamespace", "6");
  url.searchParams.set("srlimit", String(limit));
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j?.query?.search ?? []).map((s) => s.title.replace(/^File:/, ""));
}

async function fetchBase64(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get("content-type") || "image/jpeg";
  return { dataUrl: `data:${ct};base64,${buf.toString("base64")}` };
}

async function addOne(clsName, urlsList, titles, licences, artists, queries, imageRef) {
  if (urlsList.length >= PER_CLASS_TARGET) return;
  if (imageRef == null) return;
  const base64 = await fetchBase64(imageRef.url);
  if (!base64) return;
  // Skip SVG / huge payloads — cap at 80 KB base64 each to keep bundle lean.
  if (base64.dataUrl.length > 90_000) return;
  urlsList.push(base64.dataUrl);
  titles.push(imageRef.title);
  licences.push(imageRef.licence);
  artists.push(imageRef.artist);
  queries.push("wikipedia-lead");
}

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function processClass(clsName, existing) {
  // Merge with existing v2 data.
  const dataUrls = [];
  if (existing?.ok && Array.isArray(existing.dataUrls)) dataUrls.push(...existing.dataUrls);
  else if (existing?.ok && existing.dataUrl) dataUrls.push(existing.dataUrl);
  const titles = (existing?.titles ?? []).slice();
  const licences = (existing?.licences ?? []).slice();
  const artists = (existing?.artists ?? []).slice();
  const queries = (existing?.searchQueries ?? []).slice();
  const seen = new Set(titles);

  if (dataUrls.length >= PER_CLASS_TARGET) {
    return { canonical: clsName, ok: true, dataUrls, titles, licences, artists, searchQueries: queries };
  }

  // 1. Wikipedia article lead image.
  const title = WIKI_TITLE[clsName];
  if (title) {
    const leadFile = await getArticleLeadImage(title);
    if (leadFile && !seen.has(leadFile)) {
      const ref = await getCommonsThumb(leadFile);
      if (ref && !seen.has(ref.title)) {
        await addOne(clsName, dataUrls, titles, licences, artists, queries, ref);
        seen.add(ref.title);
      }
    }
  }
  await sleep(80);

  // 2. Fill remaining slots with commons searches using the article title
  //    and the canonical name.
  for (const term of [title, clsName].filter(Boolean)) {
    if (dataUrls.length >= PER_CLASS_TARGET) break;
    const files = await searchCommons(term, 6);
    for (const f of files) {
      if (dataUrls.length >= PER_CLASS_TARGET) break;
      if (seen.has(f)) continue;
      const ref = await getCommonsThumb(f);
      if (!ref || seen.has(ref.title)) continue;
      await addOne(clsName, dataUrls, titles, licences, artists, queries, ref);
      seen.add(ref.title);
    }
    await sleep(120);
  }

  return {
    canonical: clsName,
    ok: dataUrls.length > 0,
    dataUrls,
    titles,
    licences,
    artists,
    searchQueries: queries,
  };
}

async function main() {
  console.log(`Expanding BanglaVegNet reference index (lead-image strategy) — ${PER_CLASS_TARGET} per class`);
  let existing = null;
  try {
    existing = JSON.parse(await fs.readFile(OUT, "utf8"));
  } catch {}
  const byName = Object.fromEntries((existing?.classes ?? []).map((c) => [c.canonical, c]));

  const results = [];
  for (let i = 0; i < CLASSES.length; i++) {
    const c = CLASSES[i];
    const r = await processClass(c, byName[c]);
    results.push(r);
    process.stdout.write(`  ${i + 1}/${CLASSES.length} ${c.padEnd(20)} ${r.dataUrls.length}/${PER_CLASS_TARGET}\n`);
    await sleep(80);
  }

  const totalImages = results.reduce((n, r) => n + r.dataUrls.length, 0);
  const totalBytes = results.reduce((n, r) => n + r.dataUrls.reduce((m, u) => m + (u?.length ?? 0), 0), 0);
  const bundle = {
    version: 3,
    builtAt: new Date().toISOString(),
    perClassLimit: PER_CLASS_TARGET,
    classes: results,
    attribution: [
      'Class vocabulary: "BanglaVegNet" — Mendeley Data, DOI: 10.17632/rtx9ngb68j, CC BY 4.0.',
      "Reference images: Wikipedia article lead images + Wikimedia Commons thumbnails (CC BY-SA / public domain). See per-class `licences` + `artists` fields.",
      "Modifications: resized to ≤384 px thumbnail, embedded as base64 for offline comparison only; no modifications to image content.",
    ],
  };
  await fs.writeFile(OUT, JSON.stringify(bundle));
  console.log(`\nWrote ${OUT}`);
  console.log(`  classes with ≥1 image: ${results.filter((r) => r.dataUrls.length > 0).length}/${CLASSES.length}`);
  console.log(`  total images: ${totalImages}`);
  console.log(`  total size: ${(totalBytes / 1024).toFixed(1)} KB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
