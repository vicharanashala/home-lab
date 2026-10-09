# HomeHub

A calm, household-first app for managing groceries, kitchen stock and the
week's meal plan. Built as an installable PWA — it works on a phone, keeps
working offline, and stores everything on your own device.

> **Status:** this repo is the source for HomeHub. See `SETUP.md` to run it
> locally.

## What it does

- **Weekly meal plan** sized to your household (a toddler counts for less than
  an adult), with a grocery list generated from the plan and netted off against
  what the kitchen already has.
- **Use-it-first suggestions** that prioritise food about to expire.
- **Taste-aware suggestions** — 384-dim MiniLM embeddings over the recipe
  catalogue, tuned roughly 75% familiar / 25% adventurous.
- **House Bot**, a local-first assistant that sees your fridge, grocery list
  and recipe catalogue.
- **Photo-based food recognition** and nearby-store lookup.

## Privacy

All household data lives in a single `localStorage` key on your device. There
is no account, no analytics, and nothing is uploaded unless you explicitly use
a cloud-backed feature. Local backups and one-tap restore are built in.

## Running it

```bash
npm install
cp .env.example .env      # fill in only what you need
npm run dev
```

See `SETUP.md` for the full guide, including the optional Node bridge that
serves the app and proxies the AI endpoints.

## Licence

MIT — see `LICENSE`.

## Third-party data & attribution

Some bundled datasets come from external sources under their own terms:

- **BanglaVegNet** — South-Asian vegetable classes, Mendeley Data,
  DOI `10.17632/rtx9ngb68j`, CC BY 4.0. Class names and aliases only; no
  images redistributed.
- **Recipe catalogue** — derived from a public Indian recipe dataset.
- Reference imagery for plant identification is sourced from Wikimedia
  Commons at runtime.

Please review those terms before redistributing this repo commercially.