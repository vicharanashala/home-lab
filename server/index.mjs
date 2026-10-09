// HomeHub Stores proxy server.
//
// Owns the Geoapify + Foursquare API keys server-side. The browser never
// sees them. The /api/stores/nearby endpoint runs every configured
// provider in parallel, dedupes the results, and returns JSON.
//
// Run locally:
//   cd server && npm install && npm start
//
// Env vars (in server/.env):
//   PORT                       - default 8787
//   ALLOWED_ORIGIN             - default http://localhost:5173 (Vite dev)
//   GEOAPIFY_API_KEY           - optional; if missing, Geoapify provider
//                                returns ok:false, configured:false
//   FOURSQUARE_API_KEY         - optional; same as above
//   RATE_LIMIT_PER_MINUTE      - default 60 per IP per minute
//
// Provider-specific notes are surfaced via the response (attributions +
// terms notes) so the frontend can show them in the UI.

import express from 'express';
import cors from 'cors';
import { config as loadEnv } from 'dotenv';
import { searchOsm, osmAttribution, osmTermsNote } from './providers/osm.mjs';
import { searchCurated, curatedAttribution, curatedTermsNote } from './providers/curated.mjs';
import { searchGeoapify, isGeoapifyConfigured, geoapifyAttribution, geoapifyTermsNote } from './providers/geoapify.mjs';
import { searchFoursquare, isFoursquareConfigured, foursquareAttribution, foursquareTermsNote } from './providers/foursquare.mjs';
import { dedupStores, haversineM } from './dedup.mjs';

loadEnv();

const PORT = Number(process.env.PORT ?? 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173';
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60);

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// In-memory IP rate limiter. For multi-instance deploys, swap for a
// shared store (Redis, Upstash, etc.).
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const windowStart = now - 60_000;
  const arr = (hits.get(ip) ?? []).filter((t) => t > windowStart);
  if (arr.length >= RATE_LIMIT_PER_MINUTE) {
    return res.status(429).json({ error: 'rate_limited', message: `${RATE_LIMIT_PER_MINUTE} requests per minute exceeded` });
  }
  arr.push(now);
  hits.set(ip, arr);
  next();
}
app.use('/api/', rateLimit);

// Provider registry. Each entry exposes search + metadata.
const PROVIDERS = [
  {
    name: 'osm',
    isConfigured: () => true,
    search: (lat, lon, radiusM, limit) => searchOsm(lat, lon, radiusM, limit),
    attribution: osmAttribution,
    termsNote: osmTermsNote,
  },
  {
    // Opt-in: only runs when ?showChainHq=1 is in the query. Off by default
    // since HQ coordinates are city-centre approximations, not real branches.
    name: 'curated',
    isConfigured: () => true,
    search: (lat, lon, radiusM, limit) => searchCurated(lat, lon, radiusM, limit),
    attribution: curatedAttribution,
    termsNote: curatedTermsNote,
  },
  {
    name: 'geoapify',
    isConfigured: (env) => isGeoapifyConfigured(env),
    search: (lat, lon, radiusM, limit, env) => searchGeoapify(lat, lon, radiusM, limit, env),
    attribution: geoapifyAttribution,
    termsNote: geoapifyTermsNote,
  },
  {
    name: 'foursquare',
    isConfigured: (env) => isFoursquareConfigured(env),
    search: (lat, lon, radiusM, limit, env) => searchFoursquare(lat, lon, radiusM, limit, env),
    attribution: foursquareAttribution,
    termsNote: foursquareTermsNote,
  },
];

// GET /api/providers — what providers are configured server-side.
// Safe to expose: doesn't include keys, only the names.
app.get('/api/providers', (_req, res) => {
  res.json({
    providers: PROVIDERS.map((p) => ({
      name: p.name,
      configured: p.isConfigured(process.env),
      attribution: p.attribution,
      termsNote: p.termsNote,
    })),
  });
});

// GET /api/stores/nearby — main endpoint. Query params: lat, lon, radiusKm, limit.
app.get('/api/stores/nearby', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const radiusKm = Number(req.query.radiusKm ?? 5);
  const limit = Math.min(Number(req.query.limit ?? 8), 50);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'invalid_lat_lon' });
  }
  if (!Number.isFinite(radiusKm) || radiusKm < 0.1 || radiusKm > 50) {
    return res.status(400).json({ error: 'invalid_radius', message: 'radiusKm must be between 0.1 and 50' });
  }
  const radiusM = Math.max(1000, Math.round(radiusKm * 1000));
  const showChainHq = req.query.showChainHq === '1' || req.query.showChainHq === 'true';

  // OSM is always on. Curated is opt-in. Geoapify + Foursquare depend on keys.
  const enabled = PROVIDERS.filter((p) => {
    if (p.name === 'curated') return showChainHq;
    return p.isConfigured(process.env);
  });
  const settled = await Promise.allSettled(
    enabled.map((p) => p.search(lat, lon, radiusM, limit, process.env)),
  );
  const providerResults = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    const provider = enabled[i];
    return {
      source: provider.name,
      ok: false,
      stores: [],
      configured: true,
      error: s.reason?.message ?? String(s.reason),
      ms: 0,
    };
  });

  const allStores = [];
  for (const r of providerResults) {
    if (!r.ok) continue;
    for (const s of r.stores) {
      const dist = haversineM(lat, lon, s.lat, s.lon);
      if (dist <= radiusM) allStores.push(s);
    }
  }

  const merged = dedupStores(allStores);
  const withDistance = merged
    .map((s) => ({ ...s, distanceM: haversineM(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => {
      const aCurated = a.sources.length === 1 && a.sources[0] === 'curated';
      const bCurated = b.sources.length === 1 && b.sources[0] === 'curated';
      if (aCurated !== bCurated) return aCurated ? 1 : -1;
      return a.distanceM - b.distanceM;
    })
    .slice(0, limit);

  const attributions = PROVIDERS
    .filter((p) => providerResults.find((r) => r.source === p.name && r.ok))
    .map((p) => p.attribution);

  // Cache-Control header tells the browser / CDN it's safe to cache for a
  // few minutes — coordinates rarely change.
  res.set('Cache-Control', 'public, max-age=180');
  res.json({
    stores: withDistance,
    providers: providerResults,
    attributions,
    totalMs: 0,
  });
});

// Vision-based food recognition. Accepts a multipart image and returns
// predictions {label, confidence, categoryHint}. Two backends are
// supported:
//   1. GOOGLE_VISION_API_KEY set → calls Google Cloud Vision REST API
//      (label detection). Free tier: 1000 images/month.
//   2. None configured → returns a stub response telling the client to
//      fall back to its in-browser MobileNet classifier.
//
// Add CLARIFAI_API_KEY or another key and branch below to swap in.
import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

app.post('/api/vision/classify', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'no_image', message: 'image field is required (multipart/form-data)' });
  }
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) {
    return res.json({
      configured: false,
      predictions: [],
      message: 'GOOGLE_VISION_API_KEY not set on server — falling back to in-browser classifier',
    });
  }

  try {
    const b64 = req.file.buffer.toString('base64');
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${key}`;
    const body = {
      requests: [{
        image: { content: b64 },
        features: [
          { type: 'LABEL_DETECTION', maxResults: 10 },
          { type: 'OBJECT_LOCALIZATION', maxResults: 5 },
        ],
      }],
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 18_000);
    const r = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    clearTimeout(timer);
    if (!r.ok) {
      return res.status(502).json({ error: 'vision_api_error', message: `HTTP ${r.status}` });
    }
    const j = await r.json();
    const labels = j.responses?.[0]?.labelAnnotations ?? [];
    const objects = j.responses?.[0]?.localizedObjectAnnotations ?? [];
    const predictions = [];
    for (const l of labels) {
      predictions.push({
        label: l.description,
        confidence: l.score,
        source: 'backend-vision',
      });
    }
    for (const o of objects) {
      predictions.push({
        label: o.name,
        confidence: o.score,
        source: 'backend-vision',
      });
    }
    predictions.sort((a, b) => b.confidence - a.confidence);
    return res.json({ configured: true, predictions: predictions.slice(0, 8) });
  } catch (err) {
    return res.status(500).json({ error: 'classify_failed', message: err.message });
  }
});

// Health check
app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[homehub-stores] listening on http://localhost:${PORT}`);
  console.log(`[homehub-stores] allowed origin: ${ALLOWED_ORIGIN}`);
  console.log(`[homehub-stores] providers configured:`, PROVIDERS.map((p) => `${p.name}=${p.isConfigured(process.env) ? 'yes' : 'no'}`).join(', '));
});