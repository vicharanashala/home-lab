# HomeHub multi-provider stores search — setup, attribution, and run guide

The store-locator was refactored from a single OSM/Photon fetcher into a
modular, multi-provider search that combines OpenStreetMap, Geoapify, and
Foursquare with the existing curated chain-HQ list. The browser bundle
**never** holds a third-party API key — keys live server-side.

---

## TL;DR

```bash
# Run frontend only (no keys, uses direct OSM + curated)
npm run dev

# Run backend proxy (in a second terminal — needed for Geoapify + Foursquare)
cd server
cp .env.example .env       # then fill in keys you have
npm install
npm start

# When backend is reachable, point the frontend at it:
echo 'VITE_API_BASE_URL=http://localhost:8787' > .env
npm run dev
```

---

## Architecture

```
┌─────────────────┐       ┌──────────────────────────────────┐       ┌─────────────┐
│   Browser SPA   │──fetch──▶  Backend proxy (Express, 8787)  │──────▶│ Overpass    │ (public)
│ (Vite-built)    │       │  - holds GEOAPIFY_API_KEY       │       │ Photon     │ (public)
│                 │       │  - holds FOURSQUARE_API_KEY     │       │ Geoapify   │ (key)
└─────────────────┘       │  - dedupes across providers     │       │ Foursquare │ (key)
        ▲                 │  - returns merged JSON           │       └─────────────┘
        │                 └──────────────────────────────────┘
        │
   Static bundle can ALSO run
   without backend — it falls
   back to OSM + curated only.
```

### Browser-side (always-shipped)
- `src/utils/providers/osm.ts` — Overpass + Photon. Public, called directly.
- `src/utils/providers/curated.ts` — Built-in chain HQ list. No network.
- `src/utils/providers/dedup.ts` — Shared dedup algorithm.
- `src/utils/providers/index.ts` — Browser orchestrator.
- `src/utils/nearbyStores.ts` — Public API. Uses backend if configured, else direct OSM.

### Server-side (opt-in)
- `server/index.mjs` — Express, endpoints below.
- `server/providers/osm.mjs`, `curated.mjs`, `geoapify.mjs`, `foursquare.mjs`
- `server/dedup.mjs` — Same algorithm as browser side, plain JS mirror.

---

## Files added / changed

```
homehub/
├── src/utils/
│   ├── nearbyStores.ts              ← rewritten to use orchestrator + backend proxy
│   └── providers/                   ← NEW
│       ├── types.ts                 ← Provider, RawStore, SearchParams interfaces
│       ├── osm.ts                   ← Overpass + Photon (browser-callable)
│       ├── curated.ts               ← Built-in chain HQ list
│       ├── dedup.ts                 ← Shared dedup algorithm
│       └── index.ts                 ← Browser orchestrator
├── src/pages/Stores.tsx             ← surface attribution + new fields (address, phone, rating)
├── server/                          ← NEW
│   ├── index.mjs                    ← Express app
│   ├── dedup.mjs                    ← Plain-JS mirror of browser dedup
│   ├── package.json                 ← express + cors + dotenv
│   ├── .env.example                ← provider keys + CORS config
│   └── providers/                   ← Server-side provider modules
│       ├── osm.mjs
│       ├── curated.mjs
│       ├── geoapify.mjs
│       └── foursquare.mjs
├── .env.example                     ← VITE_API_BASE_URL
├── .gitignore                       ← ignores .env files + node_modules
└── package.json                     ← added "server" / "server:start" scripts
```

---

## Environment variables

### Server (`server/.env`)
| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `8787` | no | HTTP port |
| `ALLOWED_ORIGIN` | `http://localhost:5173` | yes for browser | CORS allowlist. For prod, set to your deployed frontend origin |
| `RATE_LIMIT_PER_MINUTE` | `60` | no | Per-IP request cap |
| `GEOAPIFY_API_KEY` | — | no | Get from https://myprojects.geoapify.com/ |
| `FOURSQUARE_API_KEY` | — | no | Get from https://foursquare.com/developers/ |

### Frontend (`.env` at repo root)
| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | _(empty)_ | If set, frontend routes `/api/stores/nearby` calls through this URL. Empty = direct OSM only. |

---

## API endpoints (added)

### `GET /healthz`
Liveness check. Returns `{"ok":true}`.

### `GET /api/providers`
Lists which providers are configured. **Never** returns keys. Useful for the frontend to display "Powered by Geoapify" / "Powered by Foursquare" labels only when those providers actually contributed.

```bash
curl -s http://localhost:8787/api/providers | jq
```
```json
{
  "providers": [
    {"name":"osm",      "configured":true,  "attribution":{"label":"© OpenStreetMap contributors","url":"https://www.openstreetmap.org/copyright"}},
    {"name":"curated",  "configured":true,  "attribution":{"label":"Curated chain HQ references","url":""}},
    {"name":"geoapify", "configured":true,  "attribution":{"label":"Powered by Geoapify","url":"https://www.geoapify.com/"}, "termsNote":"..."},
    {"name":"foursquare","configured":false, "attribution":{...}, "error":"FOURSQUARE_API_KEY not set"}
  ]
}
```

### `GET /api/stores/nearby?lat=<>&lon=<>&radiusKm=<>&limit=<>`
Main search endpoint.

- `lat`, `lon` (required) — user location
- `radiusKm` (default 5, max 50) — search radius
- `limit` (default 8, max 50) — result cap

Response shape:
```json
{
  "stores": [
    {
      "name": "Raj Accessories",
      "lat": 30.9671, "lon": 76.5286,
      "distanceM": 447,
      "city": "Rupnagar",
      "type": "chain",
      "providerPlaceId": "osm:way/12345",
      "sources": ["osm"],
      "categories": ["supermarket"]
    },
    {
      "name": "JioMart",
      "lat": 30.9667, "lon": 76.5333,
      "distanceM": 0,
      "city": "Rupnagar",
      "type": "chain",
      "providerPlaceId": "curated:JioMart/Rupnagar",
      "sources": ["curated"],
      "categories": ["chain_hq"]
    }
  ],
  "providers": [
    {"source":"osm", "ok":true, "stores":1, "configured":true, "ms":2300},
    {"source":"curated","ok":true, "stores":5, "configured":true, "ms":1},
    {"source":"geoapify","ok":true, "stores":3, "configured":true, "ms":820},
    {"source":"foursquare","ok":false,"stores":0,"configured":false,"error":"FOURSQUARE_API_KEY not set","ms":0}
  ],
  "attributions": [
    {"label":"© OpenStreetMap contributors","url":"https://www.openstreetmap.org/copyright"},
    {"label":"Powered by Geoapify","url":"https://www.geoapify.com/"}
  ]
}
```

---

## Deduplication rules

Two records are considered the **same physical place** when ANY of these hold:

1. **Phone match** — last 10 digits of phone are equal (handles Indian
   mobile + landline, ignores country prefixes, spaces, dashes).
2. **Name + proximity** — normalised names are equal OR Levenshtein distance
   ≤ 2 (and same length ± 2), AND the two coordinates are within **200 m**
   of each other.
3. **City disambiguation** — if both records carry `city` and they differ,
   we do NOT merge (Reliance Fresh Mumbai vs Reliance Fresh Rupnagar are
   different physical stores).

Name normalisation strips common suffixes (`pvt`, `ltd`, `store`, `shop`,
`branch`), all punctuation, collapses whitespace, lowercases.

When merging, the algorithm picks the "best" version of each field:
- `name` — from the highest-priority source: **osm > foursquare > geoapify > curated**
- `lat`, `lon` — mean of all members (within 200 m so mean is fine)
- `phone`, `address`, `website`, `openingHours`, `city` — longest non-empty
- `rating` — max value
- `providerPlaceId` — concatenated with `|` for traceability
- `sources` — union of all distinct sources

`O(n²)` over typical <200 records — fine for the search-result scale we
operate at.

---

## How to run locally

### 1. Frontend only (no backend)
```bash
cd homehub
npm install
npm run dev
# open http://localhost:5173
# Stores page will work using OSM + curated only.
```

### 2. Backend + frontend
```bash
# Terminal 1: backend
cd homehub/server
cp .env.example .env
# edit .env, paste your GEOAPIFY_API_KEY and/or FOURSQUARE_API_KEY
npm install
npm start
# → http://localhost:8787

# Terminal 2: frontend pointed at the backend
cd homehub
echo 'VITE_API_BASE_URL=http://localhost:8787' > .env
npm run dev
# → http://localhost:5173
```

### 3. Deploy the backend to production

The backend is a plain Node/Express app — deploys anywhere that runs Node 18+.
Cheapest options:
- **Railway.app / Render.com** — one-click deploy, free tier.
- **Fly.io** — free tier.
- **Cloudflare Workers** — requires wrapping handlers in `fetch(event)` and
  adding the `@shopify/cloudflare-workers` runtime; not a direct port.
- **Vercel functions** — wrap `server/index.mjs` in `api/stores/nearby.js`
  for a Vercel-friendly deploy.

Set `ALLOWED_ORIGIN` to the deployed frontend origin (e.g.
`https://j3fob22z74zqc.space.minimax.io`) and update
`VITE_API_BASE_URL` on the frontend to the backend's public URL.

---

## Example searches (verification)

After starting both backend (`localhost:8787`) and frontend (`localhost:5173`),
or by hitting the backend directly:

### Rupnagar (Tier-3 Punjab town, user's area), 10 km, with backend
```bash
curl -s 'http://localhost:8787/api/stores/nearby?lat=30.9667&lon=76.5333&radiusKm=10&limit=8' | jq '.stores[].name'
```
Expected output includes:
- "Raj Accessories" (OSM)
- "JioMart", "Reliance Smart", "Easyday", "Big Bazaar", "More" (curated chain HQs)

If `GEOAPIFY_API_KEY` is set, additional OSM-missing stores (with addresses,
phones, ratings) appear in the list and marked as `sources: ["geoapify"]`.

### Chandigarh (large city), 25 km
```bash
curl -s 'http://localhost:8787/api/stores/nearby?lat=30.7333&lon=76.7794&radiusKm=25&limit=20' | jq '.stores | length'
```
Expected: 15–25 stores, mix of OSM + curated + (if Geoapify/Foursquare keys
set) third-party.

### Mumbai (large metro), 5 km
```bash
curl -s 'http://localhost:8787/api/stores/nearby?lat=19.076&lon=72.8777&radiusKm=5&limit=20' | jq '[.providers[] | {source, ok, n: (.stores | length)}]'
```
Expected: every provider `ok: true`, osm and curated >0 each; geoapify
and foursquare contribute if configured.

### Dedup verification
The same Reliance Fresh branch in Mumbai should appear ONCE in the result
list, with `sources: ["osm", "foursquare"]` (or similar). You can confirm by
running the same query twice and verifying the count stays stable, and by
inspecting `.stores[].sources` — duplicates must NOT have a single-source
record of the same place.

---

## Provider licensing, attribution, and usage caps

### OpenStreetMap / Overpass / Photon
- **Licence:** OpenStreetMap data is ODbL. Photon is published under the
  same terms.
- **Attribution (mandatory):** "© OpenStreetMap contributors" with a link to
  https://www.openstreetmap.org/copyright.
- **Caching:** Allowed for short periods (per Overpass tile usage policy).
  We do not cache.
- **Permanent storage:** Forbidden outside app context.
- **Cost:** Free.

### Geoapify Places API
- **Licence:** Geoapify Terms. Free tier: 3,000 credits/day.
- **Attribution (mandatory):** "Powered by Geoapify" with link to
  https://www.geoapify.com/.
- **Rate limit:** 5 req/sec typical soft cap; HTTP 429 on burst.
- **Caching:** Allowed for up to 24 h per Geoapify terms.
- **Permanent storage:** Not permitted.
- **Cost:** Free up to 3,000 credits/day; paid plans for more.

### Foursquare Places API
- **Licence:** Foursquare Developer Terms. Free tier: 50,000 calls/month.
- **Attribution (mandatory):** "Powered by Foursquare" with link to
  https://foursquare.com/.
- **Caching:** NOT allowed per Foursquare terms.
- **Permanent storage / redistribution:** Explicitly forbidden. We never
  persist results.
- **Cost:** Free up to 50,000 calls/month; Pro tier for more.

### Curated chain HQ list
- **Licence:** Built-in reference data, not a real-time source.
- **Attribution:** "Curated chain HQ references" (no external link).
- **Accuracy:** City-centre coordinates are approximations. Real branches
  may be elsewhere in the city. The Stores page UI labels these as "HQ".

---

## Where to plug in a new provider (5 min)

1. Create `server/providers/<name>.mjs` exporting:
   ```js
   export function isConfigured(env) { return Boolean(env?.YOUR_KEY); }
   export async function searchYourProvider(lat, lon, radiusM, limit, env) { ... }
   export const yourAttribution = { label: '...', url: '...' };
   export const yourTermsNote = '...';
   ```
2. Add a registry entry in `server/index.mjs`:
   ```js
   {
     name: 'yourname',
     isConfigured: (env) => isYourProviderConfigured(env),
     search: (lat, lon, radiusM, limit, env) => searchYourProvider(lat, lon, radiusM, limit, env),
     attribution: yourAttribution,
     termsNote: yourTermsNote,
   }
   ```
3. Add the key to `server/.env.example`.
4. Done — the orchestrator, dedup, and Stores page pick it up automatically.

---

## Coverage honesty

> Treat the 85% target as a planning heuristic, not a guarantee.

Measured coverage after this refactor (Rupnagar 10 km, no third-party keys):
- OSM: 1 named store (Raj Accessories) + 2 unnamed kirana POIs.
- Curated: 5 chain HQs (JioMart, Reliance Smart, Easyday, Big Bazaar, More).
- **Combined + deduped: 6 entries.** Real chain branches in Rupnagar are
  often not tagged in OSM; the curated list closes the gap by surfacing the
  nearest major-chain HQ.

Adding Geoapify + Foursquare materially improves coverage in metro and
Tier-2 cities (Chandigarh, Delhi, Mumbai, Bangalore, etc.). Tier-3 / Tier-4
towns remain sparse across every provider. The plan target should be
re-evaluated once Geoapify + Foursquare keys are connected and we can
measure against their combined returns.