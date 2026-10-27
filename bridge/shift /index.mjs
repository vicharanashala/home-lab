/**
 * Vision Overwatch backend — the single brain behind HomeHub automation.
 *
 *   POST /api/analyze          save uploaded image, return record id
 *   PATCH /api/results/:id    update record with browser-side classification
 *   GET  /api/results         list all history
 *   DELETE /api/results       clear all
 *   DELETE /api/results/:id   delete one
 *
 *   POST /api/overwatch       talk to the overwatch agent — single brain
 *   POST /api/overwatch/image send an image + question to the overwatch agent
 *   GET  /api/overwatch/status overwatch agent health check
 *   GET  /api/overwatch/chat  persistent chat history
 *   POST /api/overwatch/chat  send a chat message
 *
 * Overwatch agent runs in the local openclaw runtime. We bridge via the
 * `openclaw agent --agent overwatch --json` CLI which returns the agent's
 * reply as JSON. The agent uses the SOUL.md / AGENTS.md in
 * ~/.openclaw/workspaces/overwatch/ as its system prompt.
 */

import express from 'express';
import multer from 'multer';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import dns from 'node:dns';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { resolveOpenclaw } from './openclaw-cli.mjs';

const PORT = Number(process.env.PORT ?? 8789);
const DATA_DIR = path.join(os.homedir(), '.minimax', 'vision-overwatch');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');
const QUOTA_FILE = path.join(DATA_DIR, 'plantnet-quota.json');
const OVERWATCH_AGENT = process.env.OVERWATCH_AGENT || 'overwatch';

// ─── tiny .env loader (no dotenv dep) ────────────────────────────────
// Reads the .env file next to this script if present. Sets process.env
// for any KEY=VALUE lines (without quotes, no shell escape rules).
//
// Must use fileURLToPath, NOT `new URL(...).pathname` — this script lives
// in a directory whose name ends in a space ("shift "), which the URL
// parser percent-encodes to %20. The raw pathname therefore points at a
// non-existent path and the .env silently fails to load.
const ENV_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
try {
  const envTxt = await fs.readFile(ENV_FILE, 'utf8');
  for (const rawLine of envTxt.split('\n')) {
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch {
  // .env is optional — fall through
}

const PLANTNET_API_KEY = process.env.PLANTNET_API_KEY || '';
const PLANTNET_PROJECT = process.env.PLANTNET_PROJECT || 'all';
const PLANTNET_DAILY_LIMIT = Number(process.env.PLANTNET_DAILY_LIMIT || 500);

// MiniMax vision fallback (last-resort tier when PlantNet + dataset both miss).
const MINIMAX_API_URL = process.env.MINIMAX_API_URL || '';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M3';
const MINIMAX_ACCESS_TOKEN = process.env.MINIMAX_ACCESS_TOKEN || '';
const MINIMAX_MAX_TOKENS = Number(process.env.MINIMAX_MAX_TOKENS || 200);
const MINIMAX_TIMEOUT_MS = Number(process.env.MINIMAX_TIMEOUT_MS || 25000);

// ─── shared-secret gate helpers ───────────────────────────────────────
// The bridge holds a MiniMax key and PlantNet quota with no per-user
// accounts, so when it is reachable from the internet anyone who finds
// the URL could spend those credits. BRIDGE_TOKEN puts a shared secret in
// front of every /api route.
//
// Set BRIDGE_TOKEN in the .env to enforce. Leave it unset and the gate is
// a no-op, which is what local-only use wants.
//
// Honest limitation: the browser has to present this token, so it ships
// inside the JS bundle and anyone who opens devtools can read it. That
// stops drive-by and scanner traffic, not a determined attacker. Real
// authentication needs Cloudflare Access in front of the tunnel.
//
// It DOES stop a drive-by page, though, as long as CORS does not hand that
// page a readable response — hence the explicit origin allowlist below.
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';

/**
 * Constant-time comparison of a supplied secret against BRIDGE_TOKEN.
 *
 * Plain `===` short-circuits on the first differing byte, which leaks
 * comparison progress through response timing. timingSafeEqual does not,
 * but it THROWS when the two buffers have different lengths, so the length
 * check has to come first (the length of a secret is not itself secret).
 */
function tokenMatches(supplied) {
  if (!supplied || !BRIDGE_TOKEN) return false;
  const a = Buffer.from(String(supplied), 'utf8');
  const b = Buffer.from(BRIDGE_TOKEN, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── CORS origin allowlist ───────────────────────────────────────────
// The old middleware echoed the caller's Origin back as
// Access-Control-Allow-Origin for EVERY response, which meant any web page
// on the internet could read this API's responses cross-origin. Combined
// with the shared secret being present in the publicly served JS bundle, a
// hostile page could fetch the shell, pull the token out of it and drive
// every /api route as the user.
//
// So: an explicit allowlist. The app's own origins only.
const ALLOWED_ORIGINS = new Set([
  // The permanent Tailscale Serve address (the real app).
  'https://narayana.tailac25b4.ts.net',
  'http://narayana.tailac25b4.ts.net',
  // The bridge serving its own SPA/API on loopback.
  'http://localhost:8789',
  'http://127.0.0.1:8789',
  'http://[::1]:8789',
  // Vite dev / preview servers, which proxy /api to the bridge.
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);

// The bridge's own Tailscale IP. Tailscale hands the machine a 100.64.0.0/10
// address, and it changes when the tailnet changes, so it is discovered from
// the live interfaces rather than hardcoded.
for (const addrs of Object.values(os.networkInterfaces())) {
  for (const a of addrs || []) {
    if (a?.family !== 'IPv4' || a.internal) continue;
    const ip = a.address;
    // 100.64.0.0/10 is the CGNAT block Tailscale allocates from.
    if (/^100\.(6[4-9]|[7-9]\d|1\d\d|2[01]\d)\./.test(ip)) {
      ALLOWED_ORIGINS.add(`http://${ip}:${PORT}`);
    }
  }
}

// Extra origins (comma-separated) for anyone running the app on another
// hostname. Empty by default.
for (const extra of String(process.env.ALLOWED_ORIGINS || '').split(',')) {
  const o = extra.trim();
  if (o) ALLOWED_ORIGINS.add(o);
}

// Production prompt for the bulk multi-item scan. Lives as a module-level
// constant so the verify pass can reference it via a lookup, and so it's
// easy to tweak without scrolling through the route handler.
const PRODUCE_PROMPT =
    'You are looking at a real photograph of groceries. CRITICAL: Before listing ANY items, you MUST describe the photo in plain prose first. ' +
    'Going straight to JSON causes you to hallucinate common vegetables. Prose description forces you to actually look.\n\n' +
    'STEP 1 — DESCRIBE EACH REGION IN PROSE (mandatory, do not skip):\n' +
    'Walk through the photo region by region. For EACH region, write 1-2 sentences describing:\n' +
    '  - What SHAPES you see (round, oval, flat, elongated, lobed, floret, head, bulb)\n' +
    '  - What COLORS (red, green, white, yellow, brown, orange, purple)\n' +
    '  - What TEXTURES (smooth, ribbed, leafy, papery, glossy, waxy)\n' +
    '  - What CONTAINER (loose, clear bag, opaque bag, tray, bunch-tied)\n' +
    'Skip regions that are blurry or hidden.\n\n' +
    'STEP 2 — LABEL ONLY items you clearly identified.\n' +
    'For each item, the label MUST match the visible features.\n\n' +
    'HARD RULES:\n' +
    '1. NEVER invent items. If you only see vague color or blur → OMIT.\n' +
    '2. NEVER label cauliflower, broccoli, cabbage, capsicum, brinjal, lemon, lime, guava, ' +
       'bitter-gourd, bottle-gourd, ridge-gourd, or pointed-gourd unless you see ' +
       'their DISTINCTIVE features clearly:\n' +
       '- cauliflower: tight white-cream HEAD with curved leaf wrap\n' +
       '- broccoli: distinct TREE-LIKE FLORETS on thick stalk\n' +
       '- cabbage: LAYERED overlapping leaves, no stem cavity\n' +
       '- capsicum: HOLLOW bell-shape with thick GREEN STEM + shiny skin + lobed bottom\n' +
       '- brinjal: PURPLE elongated oval with green calyx\n' +
       '- lemon/lime: small oval YELLOW/GREEN citrus with stem\n' +
       '- guava: round/oval green-yellow smooth fruit\n' +
       '- bottle-gourd (lauki): LONG pale-green cylindrical gourd\n' +
       '- bitter-gourd (karela): long green WARTY/BUMPY gourd\n' +
       'If you only see a green elongated item with no specific feature, ' +
       'label it cucumber, green-chili, or leafy-greens — NOT any of the above.\n' +
    '3. DO NOT assume common Indian items are present. The photo shows what it shows.\n' +
    '4. For items in plastic bags: only label if you can identify SHAPE/COLOR through ' +
       'the bag. A blurry red blob is NOT necessarily tomato.\n' +
    '5. Confidence must reflect what you actually see:\n' +
       '- 0.85-0.99: clearly identifiable (e.g., banana bunch, mushroom in tray)\n' +
       '- 0.70-0.85: probable but partially obscured\n' +
       '- 0.55-0.70: best guess\n' +
       '- <0.55: OMIT\n' +
    '6. Quantity:\n' +
       '- LOOSE items: count each visible piece (3 carrots = qty=3)\n' +
       '- CLEAR BAGS: count visible pieces through the bag\n' +
       '- OPAQUE BAGS: qty=1, unit="kg"\n' +
       '- LEAFY BUNCH: qty=1, unit="bunch"\n' +
       '- SMALL ROUND (peas): unit="g"\n\n' +
    'COMMON CONFUSIONS (do NOT make these):\n' +
    '  - long dark green cylindrical = CUCUMBER (NOT capsicum or bottle-gourd)\n' +
    '  - long thin green pod in bag = GREEN CHILI (NOT capsicum or beans)\n' +
    '  - small round green spheres = PEAS (NOT spinach)\n' +
    '  - short fat ribbed green pod = OKRA (NOT cucumber)\n' +
    '  - red round fruit with green calyx = TOMATO (NOT capsicum)\n' +
    '  - round purple papery skin = ONION (NOT brinjal)\n' +
    '  - round brown/tan skin = POTATO (NOT onion)\n' +
    '  - yellow-green large curved finger bunch = PLANTAIN\n' +
    '  - feathery lobed leaves = CORIANDER\n' +
    '  - oval serrated leaves = MINT\n' +
    '  - tiny glossy lance leaves on woody stem = CURRY LEAVES\n\n' +
    'OUTPUT: a JSON array, no markdown fences:\n' +
    '[{"label":"<lowercase>","confidence":<0..1>,"quantity":<int>,"unit":"pcs|kg|g|bunch|pack",' +
    '"category":"vegetable|fruit|leafy|root|spice|staple|other",' +
    '"notes":"<short sentence, <=80 chars>"}]\n\n' +
    'Return ONLY the JSON.';

await fs.mkdir(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const app = express();
// CORS + PNA headers BEFORE everything else, so OPTIONS preflights carry the
// Private-Network opt-in.
//
// The old version echoed the caller's Origin back for EVERY request, which
// made the API readable from any web page on the internet. With the shared
// secret present in the publicly served bundle, a hostile page could fetch
// the shell, extract the token and call every /api route as the user.
//
// Now an explicit allowlist (ALLOWED_ORIGINS above). An unknown origin gets
// NO Access-Control-Allow-Origin header, so the browser refuses to hand the
// response to the caller's JavaScript. A same-origin request carries no
// Origin header at all and simply passes through untouched.
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Same-origin (or a non-browser client): nothing to allow.
  if (!origin) {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Max-Age', '86400');
      return res.status(204).end();
    }
    return next();
  }

  if (!ALLOWED_ORIGINS.has(origin)) {
    // Unknown origin: no CORS allow header. The request still runs (the
    // response is simply unreadable by the other page), but a preflight is
    // refused outright so the browser stops before the real request.
    if (req.method === 'OPTIONS') return res.status(403).end();
    return next();
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  // Only meaningful for an allowlisted origin.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization,x-homehub-token');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }
  next();
});
app.use(express.json({ limit: '4mb' }));

// ─── security headers ─────────────────────────────────────────────────
// Hand-rolled rather than helmet: no new dependency to install on a machine
// that may not be able to run npm, and the policy only has to cover what this
// app actually serves.
//
// The policy is deliberately permissive where the app needs it: inline styles
// (React inline style props, the aurora background) and blob:/data: images
// (photo previews, canvas-downscaled attachments) are both required.
//
// INLINE SCRIPT HASHES
// The SPA shell contains an inline <script type="importmap"> that maps the
// bare specifier "onnxruntime-web/webgpu" onto the vendored ONNX Runtime
// build. Chrome enforces script-src on import maps, so with a strict policy
// that inline script was refused and the mapping never applied — which broke
// the on-device Whisper engine with "Failed to resolve module specifier".
//
// The fix is a hash rather than 'unsafe-inline': the hash is computed from
// the built index.html, so it stays correct when the import map changes and
// still refuses every OTHER inline script.
let inlineScriptHashes = [];
let inlineHashMtime = 0;

/** SHA-256 (base64) of every inline <script> body in the given HTML. */
function computeInlineScriptHashes(html) {
  const out = [];
  // Only scripts WITHOUT a src attribute: an external script is already
  // covered by 'self' and must not contribute a hash.
  const re = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push(`'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  }
  return out;
}

/**
 * Re-read the hashes when index.html changes.
 *
 * Re-read on a change rather than once at boot, because a rebuild replaces
 * index.html while the bridge keeps running; a hash captured at boot would
 * then no longer match and the import map would be refused again.
 */
function refreshInlineScriptHashes() {
  try {
    const file = path.join(WEB_DIST_DIR, 'index.html');
    if (!existsSync(file)) return;
    const st = statSync(file);
    if (st.mtimeMs === inlineHashMtime) return;
    inlineHashMtime = st.mtimeMs;
    inlineScriptHashes = computeInlineScriptHashes(readFileSync(file, 'utf8'));
  } catch {
    // No build, or it is unreadable — the shell is served without a hash and
    // the inline import map simply stays blocked.
  }
}

app.use((req, res, next) => {
  refreshInlineScriptHashes();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // microphone=(self) is REQUIRED, and the empty allowlist that used to be
  // here ("microphone=()") silently killed every microphone in the app.
  //
  // An empty allowlist does not merely withhold permission — it DISABLES the
  // feature for the document. The browser then refuses getUserMedia with
  // NotAllowedError and refuses SpeechRecognition with 'not-allowed', and no
  // amount of clicking the padlock or resetting site permissions changes
  // anything, because the block is in OUR response header rather than in the
  // browser's settings. The app blamed the padlock for this for weeks.
  //
  // (self) is the correct value: the microphone is available to HomeHub's own
  // pages and to nothing else.
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(self)');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // 'wasm-unsafe-eval' is required by the on-device Whisper engine: ONNX
      // Runtime is a WebAssembly module, and Chrome gates WASM compilation on
      // script-src. Without this directive the browser refused to compile it
      // with "violates the following Content Security policy directive",
      // which stopped the speech-to-text microphone dead at the first model
      // load. It permits WASM only — eval() stays disallowed.
      //
      // The trailing hashes whitelist the inline import map (see above) and
      // nothing else.
      ["script-src 'self' 'wasm-unsafe-eval'", ...inlineScriptHashes].join(' '),
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      // HuggingFace is required by the on-device Whisper engine: it is where
      // the speech-to-text model is downloaded from on first use. Without it
      // the "Speak your plan" microphone could never load a model and the
      // download failed with a bare CSP error. The cdn-lfs hosts are where
      // those model files are actually served from.
      "connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co https://tfhub.dev https://storage.googleapis.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
});

// Uploads sit outside /api, so the shared-secret gate below doesn't reach
// them. Filenames are UUIDs, but they hold photos — cover them too whenever a
// token is configured, and leave them open for local-only use.
//
// The token is read from the HEADER only. It used to be accepted from
// `?token=` as well, which meant a secret in a query string — and the request
// log then wrote it to disk in cleartext, and it leaked into browser history
// and into the Referer of any outbound navigation.
if (BRIDGE_TOKEN) {
  const tokenOk = (req, res, next) => {
    if (tokenMatches(req.get('x-homehub-token'))) return next();
    res.status(401).json({ error: 'unauthorized' });
  };
  app.use('/uploads', tokenOk, uploadsStatic());
} else {
  app.use('/uploads', uploadsStatic());
}

// Extensions an upload is allowed to be served AS. Images only — an uploaded
// .html/.svg would otherwise be served as active content on the app's own
// origin, where it would inherit the app's localStorage and its
// authenticated API access (the CSP allows script-src 'self').
const SAFE_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function uploadsStatic() {
  return express.static(UPLOADS_DIR, {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      // No script, no plugins, no framing — for every upload, images too.
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const ext = path.extname(filePath).toLowerCase();
      if (!SAFE_IMAGE_EXT.has(ext)) {
        // Not a known-safe image: serve it as an opaque download so it can
        // never be interpreted as a document by the browser.
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment');
      }
    },
  });
}

// ─── request log ───────────────────────────────────────────────────────
// Method, path, status and duration only — never the body, since bodies here
// carry photos and the user's kitchen data.
//
// req.path, NOT req.originalUrl: the original URL carries the query string,
// and a client that puts the shared secret in `?token=` would have it
// written verbatim into /tmp/hh_bridge.log — a world-readable file.
//
// WHY IT IS REGISTERED HERE, ABOVE EVERY ROUTE: Express runs middleware in
// the order it was registered, and a route that answers a request without
// calling next() ends the chain — so a route registered ABOVE this logger is
// never logged at all.
//
// The store viewer was registered above it, and the whole route family
// vanished from the operator's log: a store that refused us, a store that
// could not be reached, a store that loaded and then misbehaved — none of it
// left a line, because the route answered before the logger was reached.
// Two branches logged by hand, which is how the gap stayed invisible for so
// long: the request log looked whole, because everything else was in it.
//
// Two of the store viewer's failures DO log by hand (see the route below),
// and they stay: they say what the store answered, which the request log
// cannot. This line says that the request happened at all.
//
// WHY IT IS NOT ABOVE THE CORS MIDDLEWARE: a preflight is answered and
// ended by that middleware, so a logger above it would record every
// preflight — the store viewer's own preflights included — as a request that
// never reached a route. Below it, a preflight is not logged, as before.
//
// WHY THE UPLOADS ARE STILL NOT IN IT: the uploads mount sits above this
// too, and an image served from disk is not worth a line each.
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    const flag = res.statusCode >= 500 ? ' !!' : res.statusCode >= 400 ? ' !' : '';
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms${flag}`);
  });
  next();
});

// ─── rate limiting ─────────────────────────────────────────────────────
// The bridge fronts paid APIs (MiniMax, PlantNet) with no per-user accounts.
// The shared token stops anonymous use, but nothing stops a single caller
// from looping and burning credits, so expensive endpoints get their own,
// tighter bucket.
//
// Deliberately generous: one person tapping through the app never comes close
// to these numbers. They exist to stop runaway loops and background scrapers.
const RATE_BUCKETS = {
  // Everything that costs money upstream.
  ai: { windowMs: 60_000, max: 30 },
  // Cheap local work.
  normal: { windowMs: 60_000, max: 120 },
};

// NOTE: these are MOUNT-RELATIVE. This middleware is mounted at '/api', so
// `req.path` inside it is '/overwatch/status', not '/api/overwatch/status'.
// Matching on the full path silently classified EVERY route as 'normal',
// leaving the paid endpoints on the loose limit.
const AI_PATHS = [
  // `voice` synthesises locally and is CPU-bound, so it belongs with the
  // expensive bucket rather than the cheap one.
  /^\/(analyze|overwatch|plantnet|minimax|housebot|voice)\b/,
];

const rateState = new Map(); // ip -> { windowStart, count }
setInterval(() => {
  const now = Date.now();
  for (const [ip, s] of rateState) {
    if (now - s.windowStart > 5 * 60_000) rateState.delete(ip);
  }
}, 5 * 60_000).unref?.();

function rateLimit(kind, key) {
  const { windowMs, max } = RATE_BUCKETS[kind];
  const now = Date.now();
  let s = rateState.get(key);
  if (!s || now - s.windowStart >= windowMs) {
    s = { windowStart: now, count: 0 };
    rateState.set(key, s);
  }
  s.count += 1;
  if (s.count > max) {
    const retry = Math.ceil((s.windowStart + windowMs - now) / 1000);
    return { limited: true, retry };
  }
  return { limited: false };
}

app.use('/api', (req, res, next) => {
  // Skip preflight; it costs nothing and would eat into the caller's budget.
  if (req.method === 'OPTIONS') return next();
  const kind = AI_PATHS.some((re) => re.test(req.path)) ? 'ai' : 'normal';
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  // Bucket by kind AND ip. Keying on ip alone let ordinary cheap traffic
  // exhaust the tight budget reserved for paid endpoints.
  const key = `${kind}:${ip}`;
  const { limited, retry } = rateLimit(kind, key);
  if (limited) {
    res.setHeader('Retry-After', String(retry));
    return res.status(429).json({
      error: 'rate_limited',
      message: `Too many requests. Try again in ${retry}s.`,
    });
  }
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, RATE_BUCKETS[kind].max - (rateState.get(key)?.count || 0))));
  next();
});

// ─── shared-secret gate ───────────────────────────────────────────────
// BRIDGE_TOKEN and tokenMatches() are declared near the top of the file,
// because the /uploads mount above needs them too.
//
// Paths under /api that skip the gate. Values are MOUNT-RELATIVE, because
// this middleware is mounted at '/api' — Express sets req.path to the part
// after the mount, so '/api/anything' is seen here as '/anything'.
// (/healthz is a root-level route outside this mount, so it never needs an
// entry here.)
const TOKEN_OPEN_PATHS = new Set(['/health']);

if (BRIDGE_TOKEN) {
  app.use('/api', (req, res, next) => {
    if (TOKEN_OPEN_PATHS.has(req.path)) return next();
    if (req.method === 'OPTIONS') return next(); // preflight carries no body
    // Header ONLY. The `?token=` fallback is gone: a secret in a query
    // string ends up in the request log on disk, in browser history and in
    // the Referer of any outbound navigation.
    if (tokenMatches(req.get('x-homehub-token'))) return next();
    res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid x-homehub-token.',
    });
  });
}

// ─── persistence helpers ──────────────────────────────────────────────
// Three defects lived here:
//
//   1. writeJson truncated the target in place, so a crash (or a second
//      writer) could leave a half-written file on disk.
//   2. Every mutation was an unsynchronised read → mutate → write, so two
//      overlapping requests interleaved between the read and the write and
//      one update was lost (this also under-counted the PlantNet quota).
//   3. readJson swallowed the JSON parse error and returned the fallback.
//      A corrupt file therefore read as an EMPTY history, and the next
//      write persisted that empty array — deleting the entire scan history
//      with no error anywhere.
//
// So: atomic write (temp file + rename), a per-file promise-chain mutex
// around every read-modify-write, and a reader that tells "file absent"
// apart from "file corrupt" so a corrupt file is never silently replaced.

/** Error thrown when a state file exists but does not parse as JSON. */
function corruptStateError(file) {
  const err = new Error(`corrupt state file: ${file}`);
  err.code = 'EHHUB_CORRUPT_STATE';
  err.file = file;
  return err;
}

/**
 * Read a JSON state file.
 *
 * Returns `fallback` when the file does not exist (a fresh install).
 * THROWS when the file exists but is corrupt — that is a different thing
 * entirely, and silently substituting the fallback would destroy the data
 * on the next write.
 */
async function readJson(p, fallback) {
  let raw;
  try {
    raw = await fs.readFile(p, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw corruptStateError(p);
  }
}

/**
 * Write a JSON state file atomically: serialise to a temp file in the same
 * directory, then rename it over the target. A rename within one directory
 * is atomic, so a reader never sees a partially written file and a crash
 * can never leave a truncated target behind.
 */
async function writeJson(p, data) {
  const tmp = `${p}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, p);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Per-file promise chains, so read-modify-write on one file is serialised. */
const jsonLocks = new Map();

/** Run `fn` with exclusive access to state file `p`. */
function withJsonLock(p, fn) {
  const prev = jsonLocks.get(p) || Promise.resolve();
  // Run whether or not the previous job settled — a failed write must not
  // wedge the queue — but keep the chain itself free of rejections.
  const run = prev.then(fn, fn);
  jsonLocks.set(p, run.then(() => {}, () => {}));
  return run;
}

/**
 * Serialised read-modify-write of a state file.
 *
 * `mutate(current)` receives the current value and returns the next one
 * (return `undefined` to leave the file alone). The whole read → mutate →
 * write sequence runs under the per-file lock, so no update can be lost.
 */
async function updateJson(p, fallback, mutate) {
  return withJsonLock(p, async () => {
    const current = await readJson(p, fallback);
    const next = await mutate(current);
    if (next !== undefined) await writeJson(p, next);
    return next;
  });
}

/**
 * Read a state file for a GET route. A corrupt file is a real problem and
 * is reported as one, rather than being answered with an empty list that
 * looks like "you have no history".
 */
async function readState(p, fallback) {
  try {
    return await readJson(p, fallback);
  } catch (err) {
    if (err && err.code === 'EHHUB_CORRUPT_STATE') {
      console.error(`[state] ${err.message} — refusing to serve it as empty`);
      const e = new Error('state file is corrupt');
      e.code = 'EHHUB_CORRUPT_STATE';
      throw e;
    }
    throw err;
  }
}

// ─── results API ──────────────────────────────────────────────────────

/**
 * Wrap an async route handler so a rejection reaches Express's error
 * handler. Express 4 does not await route handlers, so an async throw
 * would otherwise become an unhandled rejection and leave the request
 * hanging with no response.
 */
function asyncRoute(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Store an uploaded image on disk.
 *
 * The client's filename extension is NEVER trusted. It used to be copied
 * verbatim, so an upload named `evil.html` was stored as `<uuid>.html` and
 * then served by express.static on the SAME origin as the SPA, as
 * text/html. The CSP allows script-src 'self', so such a page could load a
 * second same-origin upload and run script — with the app's origin, its
 * localStorage and its authenticated API access.
 *
 * So the bytes are re-encoded through sharp and stored as a fixed `.jpg`.
 * If sharp cannot decode the upload at all, the raw bytes are stored as
 * `.bin`, which the static mount serves as an opaque download.
 */
async function storeUpload(file) {
  const id = crypto.randomUUID();
  let storedName = `${id}.jpg`;
  let buf;
  let mime = 'image/jpeg';
  try {
    buf = await sharp(file.buffer, { failOn: 'none' })
      .rotate() // honour the EXIF orientation phone cameras write
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    buf = file.buffer;
    storedName = `${id}.bin`;
    mime = file.mimetype || 'application/octet-stream';
  }
  await fs.writeFile(path.join(UPLOADS_DIR, storedName), buf);
  return { id, storedName, buffer: buf, mime };
}

app.post('/api/analyze', upload.single('image'), asyncRoute(async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'no_image' });

  const { id, storedName } = await storeUpload(file);

  const result = {
    id,
    imageUrl: `/uploads/${storedName}`,
    uploadedAt: Date.now(),
    filename: file.originalname,
    sizeBytes: file.size,
    prediction: null,
    agentBridge: null,
    parsedOk: false,
  };
  // Read → mutate → write, all under the per-file lock, so two concurrent
  // uploads cannot lose each other's row.
  await updateJson(RESULTS_FILE, [], (rows) => {
    rows.unshift(result);
    return rows;
  });
  res.json({ result });
}));

app.patch('/api/results/:id', asyncRoute(async (req, res) => {
  const id = req.params.id;
  let updated = null;
  await updateJson(RESULTS_FILE, [], (rows) => {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return undefined; // nothing to write
    rows[idx] = { ...rows[idx], ...req.body, id };
    updated = rows[idx];
    return rows;
  });
  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json({ result: updated });
}));

app.get('/api/results', asyncRoute(async (_req, res) => {
  res.json(await readState(RESULTS_FILE, []));
}));

app.delete('/api/results', asyncRoute(async (_req, res) => {
  await updateJson(RESULTS_FILE, [], () => []);
  const files = await fs.readdir(UPLOADS_DIR).catch(() => []);
  await Promise.all(files.map((f) => fs.unlink(path.join(UPLOADS_DIR, f)).catch(() => {})));
  res.json({ ok: true });
}));

app.delete('/api/results/:id', asyncRoute(async (req, res) => {
  let removed = null;
  await updateJson(RESULTS_FILE, [], (rows) => {
    removed = rows.find((r) => r.id === req.params.id) || null;
    return rows.filter((r) => r.id !== req.params.id);
  });
  if (removed) {
    const fname = path.basename(removed.imageUrl);
    await fs.unlink(path.join(UPLOADS_DIR, fname)).catch(() => {});
  }
  res.json({ ok: true });
}));

// ─── overwatch agent bridge ───────────────────────────────────────────

/** Run the local openclaw CLI to talk to the overwatch agent. Returns
 *  parsed JSON from the agent, plus timing. */
async function callOverwatch(args) {
  // The CLI is found where it was installed rather than left to the PATH:
  // the bridge inherits the PATH the supervisor gives it, and that PATH does
  // not have ~/.openclaw/bin on it. See openclaw-cli.mjs for what that cost.
  const bin = await resolveOpenclaw();
  return new Promise((resolve) => {
    const t0 = Date.now();
    let proc;
    try {
      proc = spawn(bin, args, { env: { ...process.env } });
    } catch (err) {
      resolve({
        ok: false, stdout: '', stderr: `[spawn error] ${err.message}`,
        ms: 0, code: -1, parsed: null,
      });
      return;
    }
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => stdout += d.toString());
    proc.stderr.on('data', (d) => stderr += d.toString());
    proc.on('close', (code) => {
      const ms = Date.now() - t0;
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch { /* not json */ }
      const ok = code === 0 && parsed && parsed.ok !== false;
      resolve({
        ok, stdout, stderr, ms, code,
        // WHY THE PARSED ANSWER IS KEPT WHEN THE CALL FAILED: the CLI says
        // what went wrong in JSON on its stdout — "Unknown agent id", a
        // provider that refused, an answer it could not build — and this used
        // to throw that away whenever the exit code was not zero.
        //
        // So the bridge threw away the one sentence that named the problem and
        // reported the failure as a wall of stderr instead. The stderr is the
        // CLI's own noise ("[openclaw] The CLI command failed.", a debug hint,
        // a help line) and it does not say what is actually wrong in a form a
        // person can act on. The JSON says it exactly, in one line.
        //
        // WHY `ok` IS STILL THE ANSWER TO "DID IT WORK": `parsed` is kept so
        // the error can be read, not so a failure can be mistaken for a
        // reply. Every route that acts on the agent's answer asks `ok` first.
        parsed,
      });
    });
    proc.on('error', (err) => {
      resolve({
        ok: false, stdout, stderr: stderr + `\n[spawn error] ${err.message}`,
        ms: Date.now() - t0, code: -1, parsed: null,
      });
    });
  });
}

/**
 * What the CLI said went wrong, in the CLI's own words.
 *
 * WHY THE CLI'S WORDS AND NOT THE BRIDGE'S: the openclaw CLI answers a
 * failure in JSON — {"ok": false, "error": {"type": "cli_error", "message":
 * "Unknown agent id \"overwatch\". Use \"openclaw agents list\" to see
 * configured agents."}} — and that one line is the whole diagnosis. The
 * stderr beside it is the CLI's own noise, and it is what the bridge used to
 * show instead.
 *
 * WHY IT IS A FUNCTION AND NOT AN INLINE `&&` CHAIN: the chain was already
 * written, at the place that needed it, and it could never fire — the parsed
 * answer was discarded on every failure, so the chain always fell through to
 * the stderr. A rule that cannot run is a rule that needs a home and a test.
 *
 * @param {object} status what callOverwatch resolved with
 * @returns {string|null} the CLI's message, or null when it did not give one
 */
function agentErrorMessage(status) {
  const message = status?.parsed?.error?.message;
  return typeof message === 'string' && message.trim() ? message : null;
}

/** Best-effort sniff of PNG/JPEG width×height from a raw buffer.
 *  Returns {w, h} on success, null if the format is unknown. */
function sniffImageDimensions(buf) {
  try {
    if (!buf || buf.length < 24) return null;
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      // JPEG: scan for SOFn marker
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xFF) return null;
        const m = buf[i + 1];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
          return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    } else if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      // PNG: width/height live in IHDR at offset 16-23
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
  } catch { /* ignore */ }
  return null;
}

function extractAgentText(json) {
  if (!json) return '';
  return (
    json.result?.reply ??
    json.result?.text ??
    json.result?.output ??
    json.result?.message ??
    json.reply ??
    json.text ??
    json.output ??
    ''
  );
}

function parseAgentReply(text) {
  if (!text) return { prediction: null, rawReply: '', parsedOk: false };
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fence ? fence[1] : (text.trim().startsWith('{') ? text : '');
  if (!jsonStr) return { prediction: null, rawReply: text, parsedOk: false };
  try {
    const obj = JSON.parse(jsonStr);
    const pred = obj.prediction || obj;
    return {
      prediction: {
        label: pred.label || pred.answer || obj.answer || '',
        category: pred.category || 'other',
        confidence: typeof pred.confidence === 'number' ? pred.confidence : 0,
        alternatives: Array.isArray(pred.alternatives) ? pred.alternatives : [],
        storage: pred.storage || 'fridge',
        notes: pred.explanation || pred.notes || '',
        data: pred.data || {},
        kind: pred.kind || 'other',
        source: 'overwatch',
      },
      rawReply: text,
      parsedOk: true,
    };
  } catch {
    return { prediction: null, rawReply: text, parsedOk: false };
  }
}

app.get('/api/overwatch/status', async (_req, res) => {
  const status = await callOverwatch([
    'agent',
    '--agent', OVERWATCH_AGENT,
    '-m', '__healthcheck__',
    '--json',
  ]);
  res.json({
    // WHAT "reachable" MEANS HERE: the CLI is there. It is not a claim that
    // the agent answered — `code` says that. A CLI that is installed and
    // runs can still be asked about an agent that is not configured, and
    // that is a different thing from a CLI that is not installed at all.
    reachable: status.code !== -1,
    code: status.code,
    ms: status.ms,
    // WHY THIS IS NOT ALWAYS NULL: the CLI names what went wrong in its JSON
    // answer, and this used to throw that answer away on every failure — so
    // this field was null exactly when it was needed.
    providerError: agentErrorMessage(status),
    stderrTail: status.stderr.slice(-200),
  });
});

/** Plain text ask — main endpoint for HomeHub automation. */
app.post('/api/overwatch', async (req, res) => {
  const { request, context } = req.body || {};
  if (!request || typeof request !== 'string') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const payload = [
    'REQUEST: ' + request,
    'CONTEXT: ' + JSON.stringify(context || {}),
  ].join('\n');

  const status = await callOverwatch([
    'agent',
    '--agent', OVERWATCH_AGENT,
    '-m', payload,
    '--json',
  ]);

  if (!status.ok) {
    return res.status(502).json({
      error: 'overwatch_unavailable',
      // THE CLI'S OWN MESSAGE FIRST: it says what went wrong in one line
      // ("Unknown agent id \"overwatch\""), and the stderr behind it is the
      // CLI's own noise. The stderr is still there for the failures the CLI
      // did not describe in JSON — a crash, a spawn error.
      message: agentErrorMessage(status) || status.stderr,
      code: status.code,
      ms: status.ms,
    });
  }
  const text = extractAgentText(status.parsed);
  const { prediction, rawReply, parsedOk } = parseAgentReply(text);
  res.json({
    ok: true,
    ms: status.ms,
    prediction,
    rawReply,
    parsedOk,
    raw: status.parsed,
  });
});

/** Image + question — uploads image to disk, then asks agent. */
app.post('/api/overwatch/image', upload.single('image'), asyncRoute(async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'no_image' });
  const question = (req.body && req.body.question) || 'Identify this grocery item, suggest storage.';

  // Re-encoded to a fixed .jpg — the client's extension is never trusted.
  const { storedName } = await storeUpload(file);
  const storedPath = path.join(UPLOADS_DIR, storedName);

  const payload = [
    'IMAGE_AT: ' + storedPath,
    'QUESTION: ' + question,
  ].join('\n');

  const status = await callOverwatch([
    'agent',
    '--agent', OVERWATCH_AGENT,
    '-m', payload,
    '--json',
  ]);

  // THE CLI'S OWN MESSAGE FOR A FAILED CALL: the agent's answer is empty when
  // there was none, and without this the route could only say "nothing came
  // back" — which is not what happened.
  const text = extractAgentText(status.parsed) || agentErrorMessage(status) || '';
  const { prediction, rawReply, parsedOk } = parseAgentReply(text);
  res.json({
    // WHY `status.ok` AND NOT `status.code === 0`: the CLI can leave a failed
    // call with an exit code of zero and say so in its own answer — it
    // answers `{"ok": false, "error": {...}}` — so the exit code alone is not
    // an answer to "did it work". `status.ok` is: it asks the code AND the
    // CLI's own verdict. The main route above already asks it, and this one
    // used to disagree with it, which let a failed call be reported as a
    // success with the failure's own words in `rawReply`.
    ok: status.ok,
    ms: status.ms,
    imageUrl: `/uploads/${storedName}`,
    prediction,
    rawReply,
    parsedOk,
  });
}));

/** Persistent chat history between the user and overwatch. */
app.get('/api/overwatch/chat', asyncRoute(async (_req, res) => {
  res.json(await readState(CHAT_FILE, []));
}));

// The chat log is capped in two ways: the message length is bounded (the
// sibling /api/housebot/chat caps at 4000) and the stored history is
// trimmed to the last OVERWATCH_CHAT_MAX entries. Without that the file
// and the response grew without bound.
const OVERWATCH_CHAT_MAX = 200;
const OVERWATCH_MESSAGE_MAX = 4000;

app.post('/api/overwatch/chat', asyncRoute(async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'invalid_message' });
  }
  if (message.length > OVERWATCH_MESSAGE_MAX) {
    return res.status(400).json({ error: 'message_too_long' });
  }

  const status = await callOverwatch([
    'agent',
    '--agent', OVERWATCH_AGENT,
    '-m', message,
    '--json',
  ]);

  // THE CLI'S OWN MESSAGE BEFORE THE STDERR: a failed call used to be filed
  // in the chat history as the CLI's stderr blob — six lines of noise about
  // a command that failed — and the one line that said what was actually
  // wrong was thrown away on the way.
  const replyText = extractAgentText(status.parsed) || agentErrorMessage(status) || status.stderr || '(no reply)';

  // Serialised read-modify-write, and the array is trimmed before it is
  // written so the file cannot grow without bound.
  const history = await updateJson(CHAT_FILE, [], (rows) => {
    rows.push({ role: 'user', at: Date.now(), text: message });
    rows.push({ role: 'assistant', at: Date.now(), text: replyText });
    return rows.slice(-OVERWATCH_CHAT_MAX);
  });

  res.json({
    // WHY `status.ok` AND NOT `status.code === 0`: the CLI can leave a failed
    // call with an exit code of zero and say so in its own answer — it
    // answers `{"ok": false, "error": {...}}` — so the exit code alone is not
    // an answer to "did it work". `status.ok` is: it asks the code AND the
    // CLI's own verdict.
    //
    // WHY IT MATTERS HERE MORE THAN ANYWHERE ELSE: this reply is filed in the
    // chat history as what the agent said. A call that failed used to be
    // filed with `ok: true` beside it, so the history and the flag agreed
    // with each other and both were wrong.
    ok: status.ok,
    reply: replyText,
    parsed: status.parsed,
    history,
  });
}));

// ─── PlantNet proxy ───────────────────────────────────────────────────
// Forwards a photo to https://my-api.plantnet.org and normalises the
// response into a simple Prediction[] shape HomeHub can render.
//
// Why a proxy and not a browser-direct call?
//   - The API key stays on your Mac (server/.env). Never bundled.
//   - Daily-quota tracking has a real home.
//   - No CORS dance.

/** Read + write the in-memory daily quota counter (resets at UTC midnight).
 *  The increment runs under the per-file lock, so two concurrent requests
 *  cannot both read the same count and one increment be lost — which
 *  under-counted the daily quota and let extra calls through to PlantNet. */
async function quotaTick() {
  const today = new Date().toISOString().slice(0, 10);
  const q = await updateJson(QUOTA_FILE, { date: today, count: 0 }, (cur) => {
    const next = cur && cur.date === today ? cur : { date: today, count: 0 };
    next.count = (Number(next.count) || 0) + 1;
    return next;
  });
  return { usedToday: q.count, quota: PLANTNET_DAILY_LIMIT };
}
/** Read the counter. A corrupt quota file fails CLOSED (the quota reads as
 *  exhausted) rather than open (the counter silently resets to zero). */
async function quotaRead() {
  const today = new Date().toISOString().slice(0, 10);
  let q;
  try {
    q = await readJson(QUOTA_FILE, { date: today, count: 0 });
  } catch (err) {
    if (err && err.code === 'EHHUB_CORRUPT_STATE') {
      console.error('[plantnet] quota file is corrupt — treating the quota as used up');
      return { usedToday: PLANTNET_DAILY_LIMIT, quota: PLANTNET_DAILY_LIMIT };
    }
    throw err;
  }
  if (!q || q.date !== today) return { usedToday: 0, quota: PLANTNET_DAILY_LIMIT };
  return { usedToday: Number(q.count) || 0, quota: PLANTNET_DAILY_LIMIT };
}

app.get('/api/plantnet/status', asyncRoute(async (_req, res) => {
  const quota = await quotaRead();
  res.json({
    configured: Boolean(PLANTNET_API_KEY),
    project: PLANTNET_PROJECT,
    usedToday: quota.usedToday,
    quota: quota.quota,
    remaining: Math.max(0, quota.quota - quota.usedToday),
  });
}));

app.post('/api/plantnet/identify', upload.single('image'), asyncRoute(async (req, res) => {
  if (!PLANTNET_API_KEY) {
    return res.status(503).json({
      ok: false,
      error: 'plantnet_not_configured',
      message:
        'PLANTNET_API_KEY missing in vision-web/server/.env — get one from https://my.plantnet.org/account/settings',
    });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'no_image' });

  const quotaBefore = await quotaRead();
  if (quotaBefore.usedToday >= PLANTNET_DAILY_LIMIT) {
    return res.status(429).json({
      ok: false,
      error: 'plantnet_quota_exceeded',
      message: `Daily quota of ${PLANTNET_DAILY_LIMIT} exceeded. Resets at UTC midnight.`,
      usedToday: quotaBefore.usedToday,
      quota: quotaBefore.quota,
    });
  }

  const organ = (req.body && req.body.organ) || 'auto';
  const lang = (req.body && req.body.lang) || 'en';
  const nbResults = (req.body && req.body.nbResults) || '5';

  // Re-encoded to a fixed .jpg — the client's extension is never trusted.
  const { storedName, buffer: uploadBuffer, mime: uploadMime } = await storeUpload(file);

  // Build the upstream multipart request manually so we can stream it
  // straight from the in-memory buffer without re-serialising through
  // multer's disk path.
  const boundary = '----PlantNetBoundary' + crypto.randomBytes(8).toString('hex');
  const CRLF = '\r\n';
  const parts = [];
  parts.push(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="organs"${CRLF}${CRLF}` +
      `${organ}${CRLF}`,
  );
  // Some PlantNet endpoint variants expect multiple `images` fields.
  parts.push(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="images"; filename="scan.jpg"${CRLF}` +
      `Content-Type: ${uploadMime}${CRLF}${CRLF}`,
  );
  const head = Buffer.from(parts.join(''), 'utf8');
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf8');
  const body = Buffer.concat([head, uploadBuffer, tail]);

  const url = `https://my-api.plantnet.org/v2/identify/${encodeURIComponent(PLANTNET_PROJECT)}?` +
    `api-key=${encodeURIComponent(PLANTNET_API_KEY)}&` +
    `lang=${encodeURIComponent(lang)}&nb-results=${encodeURIComponent(nbResults)}`;

  const t0 = Date.now();
  let upstream;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: 'plantnet_unreachable',
      message: err?.message ?? String(err),
      usedToday: quotaBefore.usedToday,
    });
  }

  const ms = Date.now() - t0;
  const rawText = await upstream.text();
  let parsed;
  try { parsed = JSON.parse(rawText); } catch { parsed = { raw: rawText }; }

  if (!upstream.ok) {
    return res.status(upstream.status).json({
      ok: false,
      error: 'plantnet_error',
      status: upstream.status,
      message: parsed?.message ?? parsed?.error ?? rawText.slice(0, 200),
      usedToday: quotaBefore.usedToday,
    });
  }

  // Count this request against the quota only when PlantNet actually
  // accepted it — 4xx responses don't burn quota.
  const quota = await quotaTick();

  // Normalise PlantNet's response shape into something HomeHub can render.
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  const predictions = results.slice(0, 5).map((r) => {
    const sp = r?.species ?? {};
    return {
      scientificName: sp.scientificNameWithoutAuthor ?? sp.scientificName ?? '',
      scientificNameWithAuthor: sp.scientificName ?? '',
      commonNames: Array.isArray(sp.commonNames) ? sp.commonNames : [],
      family: sp.family?.scientificName ?? '',
      genus: sp.genus?.scientificName ?? '',
      score: typeof r?.score === 'number' ? r.score : 0,
      gbif: sp.gbif?.id ? String(sp.gbif.id) : undefined,
    };
  });

  res.json({
    ok: true,
    ms,
    imageUrl: `/uploads/${storedName}`,
    predictions,
    usedToday: quota.usedToday,
    quota: quota.quota,
  });
}));

// ─── MiniMax vision helpers (shared by /scan-bulk and /identify) ──────
//
// These used to live INSIDE the /api/minimax/scan-bulk handler. The
// /api/minimax/identify handler had its own copy of the "4-QUADRANT
// ZOOM-IN PASS" block, but it referenced `quadrants` and `callModel` —
// both of which were declared in the SIBLING handler and therefore did not
// exist in identify's scope. The `typeof quadrants !== 'undefined'` guard
// turned that broken reference into silently skipped code instead of a
// crash, so the zoom-in pass in identify NEVER ran while its comment
// claimed it did.
//
// Hoisted to module scope so both routes use the same implementation.

/**
 * Crop an image into 4 overlapping quadrants (2x2 grid, 10% overlap).
 * Each crop is sent to the model separately so it can "zoom in" on one
 * region and pick up small items the full image misses.
 */
async function cropQuadrants(buffer) {
  const quadrants = [];
  try {
    const md = await sharp(buffer).metadata();
    const W = md.width || 1000;
    const H = md.height || 1000;
    // 2x2 grid with 10% overlap so items spanning quadrants still get caught.
    const halfW = Math.floor(W / 2);
    const halfH = Math.floor(H / 2);
    const overlap = Math.floor(Math.min(W, H) * 0.1);
    const crops = [
      { name: 'TL', left: 0,                top: 0,                width: halfW + overlap, height: halfH + overlap },
      { name: 'TR', left: halfW - overlap,   top: 0,                width: halfW + overlap, height: halfH + overlap },
      { name: 'BL', left: 0,                top: halfH - overlap,  width: halfW + overlap, height: halfH + overlap },
      { name: 'BR', left: halfW - overlap,   top: halfH - overlap,  width: halfW + overlap, height: halfH + overlap },
    ];
    for (const c of crops) {
      const buf = await sharp(buffer)
        .extract({ left: c.left, top: c.top, width: c.width, height: c.height })
        .resize({ width: 1024, withoutEnlargement: false })
        .jpeg({ quality: 90 })
        .toBuffer();
      quadrants.push({ name: c.name, b64: buf.toString('base64') });
    }
  } catch (e) {
    console.error('[quadrants] crop failed:', e?.message);
  }
  return quadrants;
}

/**
 * Ask the MiniMax vision endpoint about an image and return the raw
 * Response, so the caller can read the body itself.
 */
async function callMiniMaxVision(imageB64, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || MINIMAX_TIMEOUT_MS);
  try {
    return await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'Authorization': `Bearer ${MINIMAX_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        max_tokens: opts.maxTokens || 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: opts.prompt || PRODUCE_PROMPT },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: opts.mime || 'image/jpeg',
                data: imageB64,
              },
            },
          ],
        }],
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the model over each cropped quadrant in parallel and return the
 * flattened list of items it found. A failing quadrant never fails the
 * request — it just contributes nothing.
 */
async function runQuadrantPass(quadrants, opts = {}) {
  if (!Array.isArray(quadrants) || quadrants.length === 0) return [];
  const tag = opts.tag || 'quadrants';
  const results = await Promise.all(quadrants.map(async (q) => {
    try {
      const qRes = await callMiniMaxVision(q.b64, {
        prompt: opts.prompt,
        mime: opts.mime || 'image/jpeg', // the crops are always JPEG
        maxTokens: 800,
        timeoutMs: 20_000,
      });
      if (!qRes.ok) return [];
      const qJson = await qRes.json();
      const qText = Array.isArray(qJson?.content)
        ? qJson.content.find((c) => c?.type === 'text')?.text ?? ''
        : '';
      if (!qText) return [];
      // Robust JSON extraction: try fenced block first, then find first [..] array.
      let qJsonStr = null;
      const qFence = qText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (qFence) qJsonStr = qFence[1];
      if (!qJsonStr) {
        const arrMatch = qText.match(/\[[\s\S]*?\]/);
        if (arrMatch) qJsonStr = arrMatch[0];
      }
      if (!qJsonStr) qJsonStr = qText.trim();
      const qItems = JSON.parse(qJsonStr);
      return Array.isArray(qItems) ? qItems : (qItems ? [qItems] : []);
    } catch (e) {
      console.error(`[${tag}] quadrant pass failed:`, e?.message);
      return [];
    }
  }));
  return results.flat();
}

// ─── MiniMax BULK vision (multi-item grocery haul recognition) ──────
// Same Anthropic-format endpoint as /api/minimax/identify, but the prompt
// asks for a JSON array of EVERY distinct item in the photo with a quantity
// estimate. Used by HomeHub's "Snap multiple items" mode so a housewife can
// photograph the whole weekly haul and stock everything at once.
//
// Pipeline:
//   Pass 1: full image (overall composition + context)
//   Pass 2: 4 quadrants in parallel (zoomed-in for small items + accurate counts)
//   Pass 3: focus pass on items <0.85 confidence (label/count re-verify)
//   Pass 4: counting-only pass (exact piece count)
app.post('/api/minimax/scan-bulk', upload.single('image'), asyncRoute(async (req, res) => {
  if (!MINIMAX_ACCESS_TOKEN || !MINIMAX_API_URL) {
    return res.status(503).json({
      ok: false,
      error: 'minimax_not_configured',
      message: 'MINIMAX_ACCESS_TOKEN / MINIMAX_API_URL missing in vision-web/server/.env',
    });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'no_image' });

  // Same small-image guard as identify (see helper below).
  const dims = sniffImageDimensions(file.buffer);
  if (dims && (dims.w < 64 || dims.h < 64)) {
    return res.status(400).json({
      ok: false,
      error: 'image_too_small',
      message: `Image is only ${dims.w}×${dims.h} px. Use a photo at least 200×200 px so the model can see the items.`,
      width: dims.w, height: dims.h,
    });
  }

  // Upscale the BASE image 2x to make small items (peas, chilies, herbs)
  // more visible to the model. Quadrants already run at 1024 wide so they
  // don't need upscaling. Skip if image is already huge (>2000px).
  const b64Original = file.buffer.toString('base64');
  let b64 = b64Original;
  let mime = file.mimetype || 'image/jpeg';
  try {
    const meta = await sharp(file.buffer).metadata();
    if (meta.width && meta.height && (meta.width < 1600 || meta.height < 1600)) {
      const upscaleFactor = 2;
      const upscaled = await sharp(file.buffer)
        .resize({ width: Math.round((meta.width || 800) * upscaleFactor), height: Math.round((meta.height || 800) * upscaleFactor), withoutEnlargement: false })
        .jpeg({ quality: 90 })
        .toBuffer();
      b64 = upscaled.toString('base64');
      // The upscaled bytes ARE JPEG now, so the media type sent to the model
      // must say JPEG — it used to keep the original file's mime type, which
      // labelled JPEG bytes as PNG (or vice versa).
      mime = 'image/jpeg';
      console.log(`[scan-bulk] upscaled ${meta.width}x${meta.height} -> ${Math.round((meta.width || 800) * upscaleFactor)}x${Math.round((meta.height || 800) * upscaleFactor)}`);
    }
  } catch (e) {
    console.error('[scan-bulk] upscale failed:', e?.message);
  }

  // Bulk handler — runs the (long) PRODUCE_PROMPT below.
  const prompt = PRODUCE_PROMPT;

  // Crop the image into 4 overlapping quadrants with sharp. Each crop is
  // sent to the model separately so it can "zoom in" on each region.
  const tCrop0 = Date.now();
  const quadrants = await cropQuadrants(file.buffer);

  // Build a body helper that sends the same prompt + image data to MiniMax.
  const callModel = (imageB64, opts = {}) =>
    callMiniMaxVision(imageB64, {
      prompt: opts.prompt || prompt,
      mime: opts.mime || mime,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
    });

  const t0 = Date.now();
  let upstream;
  try {
    upstream = await callModel(b64);

  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: 'minimax_unreachable',
      message: err?.message ?? String(err),
    });
  }

  const ms = Date.now() - t0;
  const rawText = await upstream.text();
  let parsed;
  try { parsed = JSON.parse(rawText); }
  catch { parsed = { raw: rawText }; }

  if (!upstream.ok) {
    return res.status(upstream.status).json({
      ok: false,
      error: 'minimax_error',
      status: upstream.status,
      message: parsed?.error?.message ?? parsed?.message ?? rawText.slice(0, 200),
    });
  }

  const text = Array.isArray(parsed?.content)
    ? parsed.content.find((c) => c?.type === 'text')?.text ?? ''
    : '';
  if (!text) return res.json({ ok: false, error: 'minimax_empty', ms });

  // ─── 4-QUADRANT ZOOM-IN PASS ───────────────────────────────────────────
  // Run the model again on each of the 4 cropped quadrants in parallel.
  // Each quadrant is a zoomed-in view, so the model can detect small items
  // (Mint, Onion) and accurately count pieces that are too close to
  // distinguish in the full image. Merge results with the full-image
  // pass — for each label, keep the highest confidence.
  const quadrantItems = await runQuadrantPass(quadrants, { prompt, tag: 'scan-bulk' });
  console.log(`[scan-bulk] quadrant pass: ${quadrantItems.length} item(s) from ${quadrants.length} crop(s)`);

  // Parse the JSON array. Try multiple strategies in order:
  //   1) ```json ... ``` fenced block
  //   2) First top-level [...] array in the text (handles prose+JSON)
  //   3) First top-level {...} object in the text
  //   4) The whole trimmed text as JSON
  // If all fail, return minimax_parse with the raw text for debugging.
  function tryParseItems(s) {
    if (!s) return null;
    // 1) fenced block
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      const v = JSON.parse(fence[1]);
      return Array.isArray(v) ? v : (v ? [v] : null);
    }
    // 2) first [...] array (handles "Here are items: [...]")
    const arr = s.match(/\[[\s\S]*?\]/);
    if (arr) {
      try {
        const v = JSON.parse(arr[0]);
        if (Array.isArray(v)) return v;
        if (v) return [v];
      } catch {}
    }
    // 3) first {...} object
    const obj = s.match(/\{[\s\S]*?\}/);
    if (obj) {
      try {
        const v = JSON.parse(obj[0]);
        if (v) return [v];
      } catch {}
    }
    // 4) whole text
    const v = JSON.parse(s.trim());
    return Array.isArray(v) ? v : (v ? [v] : null);
  }

  let items = tryParseItems(text);
  if (items === null) {
    return res.json({ ok: false, error: 'minimax_parse', ms, raw: text.slice(0, 400) });
  }
  if (!Array.isArray(items)) items = [items];

  // Merge full-image items with quadrant zoom-in items. The quadrants give
  // us a closer look at small items that the full image missed. We just
  // concatenate here — the cleaning pipeline (dedupe, NEAR_DUPES) below
  // will keep the highest-confidence version of each label.
  if (quadrantItems.length > 0) {
    items = items.concat(quadrantItems);
  }

  const validUnits = ['pcs', 'kg', 'g', 'bunch', 'pack', 'dozen', 'l'];
  const validCats = ['vegetable', 'fruit', 'leafy', 'root', 'spice', 'staple', 'other'];

  // Labels we explicitly reject — these are descriptors, not real items.
  const FORBIDDEN_LABELS = new Set([
    'red', 'green', 'yellow', 'orange', 'purple', 'white', 'brown', 'black',
    'long', 'short', 'small', 'big', 'large', 'tiny', 'fresh', 'ripe', 'raw',
    'vegetable', 'fruit', 'item', 'produce', 'food', 'thing', 'stuff', 'piece',
    'unknown', 'mixed', 'various', 'assorted', 'organic', 'natural',
    // Categories are NOT labels — never accept these as label
    'leafy', 'leafy-green', 'leafy-greens', 'green-leafy', 'greens', 'greeny',
    // Generic descriptors that slip through
    'vegetable-greens', 'indian-vegetables', 'indian-greens',
  ]);

  const cleaned = items
    .filter((it) => it && typeof it === 'object' && it.label)
    .map((it) => ({ ...it, label: String(it.label).toLowerCase().trim() }))
    .filter((it) => it.label.length >= 3 && !FORBIDDEN_LABELS.has(it.label))
    .map((it) => {
      // Take first word and fix irregular plurals only. Trust the model's
      // plural form for regular -s plurals (peas, onions, carrots) — even
      // when quantity=1 the model may say "peas" because the photo shows
      // multiple. Don't strip trailing 's' automatically.
      let lbl = it.label.split(/\s+/)[0];
      const singularFix = {
        'tomatoes': 'tomato', 'potatoes': 'potato', 'leaves': 'leaf',
        'berries': 'berry', 'cherries': 'cherry',
      };
      lbl = singularFix[lbl] ?? lbl;
      return { ...it, label: lbl };
    })
    .filter((it) => it.label.length >= 3 && !FORBIDDEN_LABELS.has(it.label))
    .map((it) => ({
      label: it.label,
      confidence: typeof it.confidence === 'number'
        ? Math.min(0.99, Math.max(0, it.confidence))
        : 0.7,
      quantity: typeof it.quantity === 'number' && it.quantity > 0
        ? Math.round(it.quantity)
        : 1,
      unit: validUnits.includes(it.unit) ? it.unit : 'pcs',
      category: validCats.includes(it.category) ? it.category : 'other',
      notes: String(it.notes ?? `MiniMax bulk scan · ${MINIMAX_MODEL}`).slice(0, 80),
    }))
    // (2-pass voting disabled — hallucinations also repeat, so consensus
    //  boost makes them stickier and consensus penalty drops real items.
    //  Single-pass + dedupe + rescue + tiebreaker is more reliable.)
    .filter((it) => it.confidence >= 0.60)
    .reduce((acc, it) => {
      const key = it.label;
      const existing = acc.get(key);
      if (!existing || existing.confidence < it.confidence) acc.set(key, it);
      return acc;
    }, new Map());

  // ─── NEAR-DUPLICATE DEDUPE ────────────────────────────────────────────
  // Some pairs are visually confusable and the model sometimes emits both
  // for the same item. Keep only the higher-confidence one, preferring the
  // more-specific label.
  const NEAR_DUPES = [
    { prefer: 'capsicum', drop: 'cabbage' },
    { prefer: 'plantain', drop: 'banana' },
    { prefer: 'coriander', drop: 'mint' },
    { prefer: 'coriander', drop: 'curry-leaves' },
    { prefer: 'coriander', drop: 'spinach' },
    { prefer: 'mint', drop: 'spinach' },
    { prefer: 'okra', drop: 'beans' },
    { prefer: 'okra', drop: 'green-bean' },
    { prefer: 'peas', drop: 'spinach' },
    { prefer: 'capsicum', drop: 'tomato' },
    { prefer: 'potato', drop: 'onion' },
    { prefer: 'onion', drop: 'brinjal' },
    { prefer: 'onion', drop: 'cabbage' },
    { prefer: 'cabbage', drop: 'brinjal' },
  ];
  for (const { prefer, drop } of NEAR_DUPES) {
    if (cleaned.has(prefer) && cleaned.has(drop)) {
      const p = cleaned.get(prefer);
      const d = cleaned.get(drop);
      // Keep the preferred label; if the dropped one is much higher, swap.
      if (p.confidence + 0.05 < d.confidence) {
        cleaned.delete(drop);
        cleaned.set(prefer, { ...d, label: prefer });
      } else {
        cleaned.delete(drop);
      }
    }
  }
  let cleanedArr = Array.from(cleaned.values())
    .map((it) => {
      const bv = mapToBanglaVegLocal(it.label);
      if (bv) it.label = bv.canonical;
      return it;
    });

  // POST-PROCESSING: anti-hallucination enforcement for watchlist items.
  // The model tends to confidently hallucinate these. If it returns one of
  // them below 0.70 confidence, drop it (model wasn't certain enough to keep).
  // Threshold lowered from 0.85 → 0.70 so borderline real items (cauliflower
  // at 0.75 in Indian grocery photos) survive to the rescue/tiebreaker pass.
  const WATCHLIST_LOW_CONF = new Set([
    'capsicum', 'cauliflower', 'broccoli', 'cabbage', 'bottle-gourd',
    'bitter-gourd', 'brinjal', 'eggplant', 'lemon', 'lime', 'guava',
    'ridge-gourd', 'pointed-gourd', 'drumstick', 'ash-gourd', 'pumpkin',
    'snake-gourd', 'ivy-gourd', 'carrot',
  ]);
  cleanedArr = cleanedArr.filter((it) => {
    if (WATCHLIST_LOW_CONF.has(it.label) && it.confidence < 0.70) {
      return false;
    }
    return true;
  });

  // LEMON/LIME disambiguation: green citrus = lime, yellow citrus = lemon.
  // The model often calls green citrus "lemon" — correct it.
  cleanedArr = cleanedArr.map((it) => {
    if (it.label === 'lemon' && it.notes && /green/i.test(it.notes)) {
      return { ...it, label: 'lime' };
    }
    return it;
  });

  // Near-duplicate dedupe: lemon+lime → keep higher-confidence one.
  for (const { prefer, drop } of [
    { prefer: 'lime', drop: 'lemon' },
    // Cauliflower and broccoli are often confused. If cauliflower is in the
    // photo, the model tends to also label broccoli. Drop the broccoli.
    { prefer: 'cauliflower', drop: 'broccoli' },
    // Cauliflower and cabbage can both be "round layered thing".
    { prefer: 'cauliflower', drop: 'cabbage' },
    // Capsicum vs the dark green items in bags — capsicum is rare,
    // cucumber/chili are common in plastic bags.
    { prefer: 'cucumber', drop: 'capsicum' },
    { prefer: 'green-chili', drop: 'capsicum' },
    // Tomato being mislabeled as capsicum (round red fruit with calyx ≠ hollow bell)
    { prefer: 'tomato', drop: 'capsicum' },
  ]) {
    if (cleaned.has(prefer) && cleaned.has(drop)) {
      cleaned.delete(drop);
    }
  }

  // Brute-force drop of items that the model confidently hallucinates when
  // the photo has many items in plastic bags (i.e., over-detection scenario).
  // These items appear at high confidence even when NOT in the photo. Drop
  // them if there are 4+ other items detected (signals model is being
  // aggressive). User can re-enable via FoodTrainer if their kitchen has
  // these items regularly.
  const COMMONLY_HALLUCINATED = new Set([
    'capsicum', 'broccoli', 'lemon', 'lime', 'guava',
    'bottle-gourd', 'bitter-gourd', 'brinjal', 'cabbage',
  ]);

  // HARD RULE: Indian groceries have cauliflower ~5× more often than broccoli.
  // When the model returns "broccoli" but NOT "cauliflower" in a multi-item
  // photo, it's almost certainly seeing a cauliflower. Rename it BEFORE any
  // other pipeline so the rescue/tiebreaker passes don't see broccoli at all.
  if (cleaned.size >= 4 && cleaned.has('broccoli') && !cleaned.has('cauliflower')) {
    const b = cleaned.get('broccoli');
    cleaned.delete('broccoli');
    cleaned.set('cauliflower', { ...b, label: 'cauliflower' });
    console.log('[scan-bulk] hard rule: broccoli → cauliflower');
  }

  // ─── RESCUE PASS ────────────────────────────────────────────────────
  // For items about to be brute-force dropped, ask the model ONE MORE TIME
  // with very specific shape-based options. The rescue pass can ONLY RENAME
  // or DROP — it cannot confirm hallucinations, because the same model bias
  // would rubber-stamp them. If the model thinks the original is present,
  // we still apply brute-force drop UNLESS the original confidence is very
  // high (≥ 0.92) AND the item is unambiguous in the confusion group.
  if (cleaned.size >= 4) {
    const rescueTargets = [];
    for (const lbl of COMMONLY_HALLUCINATED) {
      if (cleaned.has(lbl)) {
        const it = cleaned.get(lbl);
        let isHighest = true;
        for (const [other, otherItem] of cleaned) {
          if (other !== lbl && otherItem.confidence > it.confidence) {
            isHighest = false; break;
          }
        }
        if (!isHighest) rescueTargets.push({ label: lbl, ...it });
      }
    }
    if (rescueTargets.length > 0) {
      try {
        const rescuePrompt =
          'Output ONLY a JSON array, NO prose, NO fences.\n\n' +
          'For EACH candidate below, look at the photo. The model has a bias ' +
          'toward calling items by certain names. Look HARD for the SPECIFIC ' +
          'distinguishing features described below. Most of the time the ' +
          'candidate is WRONG — be skeptical.\n\n' +
          'For each candidate, respond with:\n' +
          '  - "verdict": "rename" if you see a CLEARLY DIFFERENT but similar-shaped item\n' +
          '  - "verdict": "drop" if neither the candidate NOR any similar item is visible\n' +
          '  - "verdict": "keep" ONLY if the EXACT candidate is unmistakably visible\n\n' +
          'When verdict="rename", give the actual item in "correct_label". Use ' +
          'the SHAPE GROUPS below. The candidate is usually the WRONG member of ' +
          'its group — try to find the RIGHT one.\n\n' +
          'SHAPE GROUPS (use to find the right item):\n' +
          '  - dense WHITE/CREAM head with curved green leaves = CAULIFLOWER\n' +
          '  - green TREE-LIKE florets on thick stalk = BROCCOLI\n' +
          '  - layered round green leaves, no stem cavity = CABBAGE\n' +
          '  - hollow bell with thick green stem = CAPSICUM\n' +
          '  - small oval yellow-green citrus = LEMON or LIME\n' +
          '  - round/oval smooth green-yellow fruit with sepal marks = GUAVA\n' +
          '  - long pale-green cylindrical smooth gourd = BOTTLE-GOURD\n' +
          '  - long green with warty bumps = BITTER-GOURD\n' +
          '  - purple elongated oval with green calyx = BRINJAL\n' +
          '  - long dark green cylindrical = CUCUMBER (long thin green pod = GREEN-CHILI)\n\n' +
          'Candidates:\n' +
          rescueTargets.map((it, i) => `  ${i + 1}. ${it.label} (orig conf ${it.confidence.toFixed(2)})`).join('\n') +
          '\n\nRespond ONLY with: [{"label":"<orig>","verdict":"rename|drop|keep","correct_label":"<alt or empty>"}]';
        const rBody = {
          model: MINIMAX_MODEL,
          max_tokens: 800,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: rescuePrompt },
              { type: 'image', source: { type: 'base64', media_type: file.mimetype || 'image/jpeg', data: b64 } },
            ],
          }],
        };
        const rCtrl = new AbortController();
        const rTimer = setTimeout(() => rCtrl.abort(), 25_000);
        const rRes = await fetch(MINIMAX_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'Authorization': `Bearer ${MINIMAX_ACCESS_TOKEN}`,
          },
          body: JSON.stringify(rBody),
          signal: rCtrl.signal,
        });
        clearTimeout(rTimer);
        const rJson = await rRes.json();
        const rText = Array.isArray(rJson?.content)
          ? rJson.content.find((c) => c?.type === 'text')?.text ?? ''
          : '';
        if (rText) {
          const fenceR = rText.match(/```(?:json)?\s*([\s\S]*?)```/);
          const arrR = rText.match(/\[[\s\S]*?\]/);
          const rItems = JSON.parse(fenceR ? fenceR[1] : (arrR ? arrR[0] : rText.trim()));
          if (Array.isArray(rItems)) {
            const rescueMap = new Map(
              rItems.map((v) => [String(v.label || '').toLowerCase().trim().split(/\s+/)[0].replace(/s$/, ''), v])
            );
            for (const tgt of rescueTargets) {
              const key = tgt.label.toLowerCase().split(/\s+/)[0].replace(/s$/, '');
              const r = rescueMap.get(key);
              if (!r) {
                // No opinion — drop (safer than keeping a hallucination).
                cleaned.delete(tgt.label);
                continue;
              }
              if (r.verdict === 'rename') {
                const correct = String(r.correct_label || '').toLowerCase().trim().split(/\s+/)[0].replace(/s$/, '');
                if (correct && correct !== tgt.label && correct.length >= 3 && !FORBIDDEN_LABELS.has(correct)) {
                  // Rename to the correct similar item.
                  cleaned.delete(tgt.label);
                  if (!cleaned.has(correct)) {
                    cleaned.set(correct, {
                      label: correct,
                      confidence: Math.min(0.85, tgt.confidence - 0.05),
                      quantity: tgt.quantity,
                      unit: tgt.unit,
                      notes: String(`renamed from ${tgt.label} [rescued]`).slice(0, 80),
                    });
                  }
                } else {
                  // Asked to rename but didn't give a valid label — drop.
                  cleaned.delete(tgt.label);
                }
              } else if (r.verdict === 'keep') {
                // Model insists it's present. Allow it ONLY if original conf
                // was very high — otherwise the same bias is rubber-stamping.
                if (tgt.confidence >= 0.92) {
                  const orig = cleaned.get(tgt.label);
                  if (orig) {
                    orig.confidence = Math.min(0.95, orig.confidence + 0.02);
                    orig.notes = String((orig.notes || '') + ' [rescued]').slice(0, 80);
                  }
                } else {
                  cleaned.delete(tgt.label);
                }
              } else {
                // verdict='drop' or anything else — drop.
                cleaned.delete(tgt.label);
              }
            }
          }
        }
      } catch (err) {
        console.error('[minimax/scan-bulk] rescue pass failed:', err?.message);
        // Fall back to brute-force drop on error.
        for (const lbl of COMMONLY_HALLUCINATED) {
          if (cleaned.has(lbl)) {
            const item = cleaned.get(lbl);
            let isHighest = true;
            for (const [other, otherItem] of cleaned) {
              if (other !== lbl && otherItem.confidence > item.confidence) {
                isHighest = false; break;
              }
            }
            if (!isHighest) cleaned.delete(lbl);
          }
        }
      }
    }

    // ─── TIEBREAKER PASS ──────────────────────────────────────────────
    // For hallucination-prone items the rescue pass KEPT, but with conf
    // < 0.9, the rescue may have rubber-stamped a misperception (e.g. the
    // model saw a cauliflower and called it broccoli, then the rescue pass
    // said "broccoli is present"). Force a binary choice between the
    // original label and its closest confusion-group alternative.
    const CONFUSION_PAIRS = {
      'broccoli': 'cauliflower',
      'cauliflower': 'broccoli',
      'cabbage': 'cauliflower',
      'lemon': 'lime',
      'lime': 'lemon',
      'guava': 'lime',
      'cucumber': 'green-chili',
      'capsicum': 'cucumber',
      'brinjal': 'tomato',
      'bottle-gourd': 'cucumber',
      'bitter-gourd': 'cucumber',
    };
    const tiebreakerTargets = [];
    for (const lbl of Object.keys(CONFUSION_PAIRS)) {
      if (cleaned.has(lbl)) {
        const it = cleaned.get(lbl);
        if (it.confidence < 0.95) {
          const alt = CONFUSION_PAIRS[lbl];
          // Only probe if the alternative isn't already in the result.
          if (!cleaned.has(alt)) tiebreakerTargets.push({ label: lbl, alt, conf: it.confidence });
        }
      }
    }
    if (tiebreakerTargets.length > 0) {
      try {
        const tbPrompt =
          'Output ONLY a JSON array, NO prose, NO fences.\n\n' +
          'For EACH pair below, look at the photo and pick ONE winner. ' +
          'You MUST pick one of the two options unless NEITHER is visible. ' +
          'NEVER pick both. NEVER default to the first option.\n\n' +
          'Pairs (A vs B):\n' +
          tiebreakerTargets.map((t, i) =>
            `  ${i + 1}. (A) ${t.label}  vs  (B) ${t.alt}`
          ).join('\n') +
          '\n\nRespond ONLY with: [{"pair":<index>,"winner":"A"|"B"|"NONE","winner_label":"<the actual item or empty>"}]';
        const tbBody = {
          model: MINIMAX_MODEL,
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: tbPrompt },
              { type: 'image', source: { type: 'base64', media_type: file.mimetype || 'image/jpeg', data: b64 } },
            ],
          }],
        };
        const tbCtrl = new AbortController();
        const tbTimer = setTimeout(() => tbCtrl.abort(), 20_000);
        const tbRes = await fetch(MINIMAX_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'Authorization': `Bearer ${MINIMAX_ACCESS_TOKEN}`,
          },
          body: JSON.stringify(tbBody),
          signal: tbCtrl.signal,
        });
        clearTimeout(tbTimer);
        const tbJson = await tbRes.json();
        const tbText = Array.isArray(tbJson?.content)
          ? tbJson.content.find((c) => c?.type === 'text')?.text ?? ''
          : '';
        if (tbText) {
          const fenceTB = tbText.match(/```(?:json)?\s*([\s\S]*?)```/);
          const arrTB = tbText.match(/\[[\s\S]*?\]/);
          const tbItems = JSON.parse(fenceTB ? fenceTB[1] : (arrTB ? arrTB[0] : tbText.trim()));
          if (Array.isArray(tbItems)) {
            tbItems.forEach((v, idx) => {
              const t = tiebreakerTargets[idx];
              if (!t) return;
              if (v.winner === 'NONE') {
                // Neither is in the photo — drop the original.
                cleaned.delete(t.label);
              } else if (v.winner === 'B') {
                // The alternative is the truth — rename.
                cleaned.delete(t.label);
                if (!cleaned.has(t.alt)) {
                  cleaned.set(t.alt, {
                    label: t.alt,
                    confidence: Math.min(0.90, t.conf + 0.05),
                    quantity: cleaned.get(t.label)?.quantity ?? 1,
                    unit: cleaned.get(t.label)?.unit ?? 'pcs',
                    notes: String(`renamed from ${t.label} [tiebreaker]`).slice(0, 80),
                  });
                }
              }
              // winner === 'A' → keep original, no action
            });
          }
        }
      } catch (err) {
        console.error('[minimax/scan-bulk] tiebreaker pass failed:', err?.message);
      }
    }
  }

  // Final defensive filter — apply FORBIDDEN_LABELS again AFTER all merging
  // (quadrants + audit pass can introduce labels the original filter missed).
  cleanedArr = cleanedArr.filter((it) => !FORBIDDEN_LABELS.has(it.label));

  cleanedArr.sort((a, b) => b.confidence - a.confidence);

  // ─── VERIFICATION PASS ────────────────────────────────────────────────
  // Re-ask the model to verify each detected item. Best-effort — failures
  // here don't fail the whole request.
  // ALWAYS run a focused verification pass — option-1 single-item style.
  // The model hallucinates common Indian items at high confidence, so we
  // ask it to look at the photo AGAIN and DROP any items it can't clearly see.
  // This pass is more conservative than the initial scan — better to lose
  // a borderline one than to keep a hallucination.
  const NEEDS_VERIFY = cleanedArr.length > 0 && cleanedArr.length <= 15;
  if (NEEDS_VERIFY) {
    try {
      const verifyPrompt =
        'Output ONLY a JSON array. NO prose. NO description. NO markdown.\n\n' +
        'Format strictly: [{"label":"<label>","present":true|false,"confidence":<0..1>,' +
        '"correct_label":"<label or empty>"}]\n\n' +
        'For EACH item below, decide "Is this item ACTUALLY in the photo?" and output one ' +
        'object. present=true ONLY if you can clearly identify the item. present=false ' +
        'if the item is not visible, the label is wrong, or you only see vague color ' +
        'blobs. Do NOT trust the original label — many are hallucinations. When in ' +
        'doubt, present=false. correct_label is the actual item if the original is wrong, ' +
        'or empty string if you do not know.\n\n' +
        'Items to audit:\n' +
        cleanedArr.map((it, i) =>
          `  ${i + 1}. ${it.label} (qty=${it.quantity} ${it.unit})`
        ).join('\n');
      const verifyBody = {
        model: MINIMAX_MODEL,
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: verifyPrompt },
            { type: 'image', source: { type: 'base64', media_type: file.mimetype || 'image/jpeg', data: b64 } },
          ],
        }],
      };
      const vCtrl = new AbortController();
      const vTimer = setTimeout(() => vCtrl.abort(), 30_000);
      const vRes = await fetch(MINIMAX_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'Authorization': `Bearer ${MINIMAX_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(verifyBody),
        signal: vCtrl.signal,
      });
      clearTimeout(vTimer);
      const vJson = await vRes.json();
      const vText = Array.isArray(vJson?.content)
        ? vJson.content.find((c) => c?.type === 'text')?.text ?? ''
        : '';
      if (vText) {
        const fenceMatch = vText.match(/```(?:json)?\s*([\s\S]*?)```/);
        const vItems = JSON.parse(fenceMatch ? fenceMatch[1] : vText.trim());
        if (Array.isArray(vItems)) {
          const verifyMap = new Map(
            vItems.map((v) => [String(v.label || '').toLowerCase().trim().split(/\s+/)[0].replace(/s$/, ''), v])
          );
          cleanedArr = cleanedArr.map((it) => {
            const key = it.label.toLowerCase().split(/\s+/)[0].replace(/s$/, '');
            const v = verifyMap.get(key);
            if (!v) {
              // Verify pass didn't mention this item — trust the original.
              return it;
            }
            // Verify uses new format: {label, present, confidence, correct_label}
            if (v.present === false && Number(v.confidence) >= 0.85) {
              // Audit is highly confident this item is NOT in the photo — DROP it.
              return null;
            }
            // Item kept. Use correct_label if model corrected it.
            const finalLabel = (v.correct_label && v.correct_label !== v.label && v.correct_label.length > 0)
              ? String(v.correct_label).toLowerCase().trim().split(/\s+/)[0].replace(/s$/, '') || it.label
              : it.label;
            return {
              ...it,
              label: finalLabel,
              confidence: Math.min(0.99, Math.max(it.confidence, Number(v.confidence) || it.confidence + 0.05)),
              notes: String((v.notes || it.notes) + ' [audited]').slice(0, 80),
            };
          }).filter((it) => it !== null);
          cleanedArr = cleanedArr.map((it) => {
            const bv = mapToBanglaVegLocal(it.label);
            if (bv) it.label = bv.canonical;
            return it;
          });
        }
      }
    } catch (err) {
      console.error('[minimax/scan-bulk] verify pass failed:', err?.message);
    }
  }

  // ─── COUNTING PASS — focused only on getting PCS right ───────────────
  // Send the same image again with a prompt that ONLY asks the model to
  // verify / correct the QUANTITY and UNIT for each item. Doesn't relabel
  // — pure counting focus. Best-effort.
  if (cleanedArr.length > 0 && cleanedArr.length <= 15) {
    try {
      const countPrompt =
        'You are a PRECISION COUNTER for grocery photos. For EACH item below, look at ' +
        'the SAME photo ONE MORE TIME and give the EXACT piece count.\\n\\n' +
        'COUNTING RULES (apply strictly):\\n' +
        'A. Loose individual items (no bag, no pile): COUNT each piece you can see. ' +
           'If 3 carrots visible, quantity=3.\\n' +
        'B. Items in CLEAR/TRANSLUCENT bag: count visible pieces through the bag. ' +
           'If ~5 tomatoes visible, quantity=5, unit="pcs".\\n' +
        'C. Items in OPAQUE bag: quantity=1, unit="kg", notes="opaque, count unknown".\\n' +
        'D. Pile with multiple layers: count top layer, multiply by 2-3 based on depth.\\n' +
        'E. Bunch of leafy greens: quantity=1, unit="bunch".\\n' +
        'F. Small round items (peas, beans): unit="g" with estimate (50-500g).\\n' +
        'G. NEVER default to "1 kg" unless truly opaque.\\n' +
        'H. NEVER round to large guess. 4 items = 4, not 10.\\n' +
        'I. Be precise — the count feeds a shopping list.\\n\\n' +
        'Do NOT change labels — only fix quantity/unit/notes.\\n\\n' +
        'Items to count:\\n' +
        cleanedArr.map((it, i) =>
          `  ${i + 1}. label="${it.label}" qty=${it.quantity} ${it.unit} conf=${it.confidence}`
        ).join('\\n') +
        '\\n\\nRespond with ONLY a JSON array of the SAME shape, with corrected ' +
        'quantity/unit/notes for each item. NO prose, NO fences.';
      const countBody = {
        model: MINIMAX_MODEL,
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: countPrompt },
            { type: 'image', source: { type: 'base64', media_type: file.mimetype || 'image/jpeg', data: b64 } },
          ],
        }],
      };
      const cCtrl = new AbortController();
      const cTimer = setTimeout(() => cCtrl.abort(), 25_000);
      const cRes = await fetch(MINIMAX_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'Authorization': `Bearer ${MINIMAX_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(countBody),
        signal: cCtrl.signal,
      });
      clearTimeout(cTimer);
      const cJson = await cRes.json();
      const cText = Array.isArray(cJson?.content)
        ? cJson.content.find((c) => c?.type === 'text')?.text ?? ''
        : '';
      if (cText) {
        const fenceMatch = cText.match(/```(?:json)?\s*([\s\S]*?)```/);
        const cItems = JSON.parse(fenceMatch ? fenceMatch[1] : cText.trim());
        if (Array.isArray(cItems)) {
          const countMap = new Map(
            cItems.map((v) => [String(v.label || '').toLowerCase().trim().split(/\s+/)[0].replace(/s$/, ''), v])
          );
          cleanedArr = cleanedArr.map((it) => {
            const key = it.label.toLowerCase().split(/\s+/)[0].replace(/s$/, '');
            const c = countMap.get(key);
            if (c) {
              const newQty = Number(c.quantity);
              const newUnit = validUnits.includes(c.unit) ? c.unit : it.unit;
              return {
                ...it,
                quantity: Number.isFinite(newQty) && newQty > 0 ? Math.round(newQty) : it.quantity,
                unit: newUnit,
                notes: String(c.notes || it.notes).slice(0, 80),
              };
            }
            return it;
          });
        }
      }
    } catch (err) {
      console.error('[minimax/scan-bulk] counting pass failed:', err?.message);
    }
  }

  // FINAL defensive filter — verify/counting/tiebreaker passes can rename
  // items to forbidden labels (e.g. "green", "leafy-greens"). Strip them
  // here so they never reach the user.
  cleanedArr = cleanedArr.filter((it) => !FORBIDDEN_LABELS.has(it.label));

  // FINAL dedupe — verify pass can rename an item to a label that another
  // item already has (e.g. cauliflower → broccoli while broccoli is also in
  // the result, creating two broccoli entries). Collapse by label here,
  // keeping the highest-confidence one.
  const finalDedup = new Map();
  for (const it of cleanedArr) {
    const key = it.label.toLowerCase().split(/\s+/)[0];
    const existing = finalDedup.get(key);
    if (!existing || existing.confidence < it.confidence) finalDedup.set(key, it);
  }
  cleanedArr = Array.from(finalDedup.values());

  // FINAL hard rule: if BOTH broccoli and cauliflower are in the result
  // (the verify pass sometimes reintroduces broccoli via correct_label
  // after our earlier dedupe), drop the broccoli. Indian grocery photos
  // have cauliflower ~5× more often than broccoli.
  if (cleanedArr.length >= 4) {
    const labels = cleanedArr.map((it) => it.label.toLowerCase().split(/\s+/)[0]);
    if (labels.includes('cauliflower') && labels.includes('broccoli')) {
      cleanedArr = cleanedArr.filter((it) => it.label.toLowerCase().split(/\s+/)[0] !== 'broccoli');
    }
  }

  res.json({
    ok: true,
    ms,
    count: cleanedArr.length,
    items: cleanedArr,
    raw: { text, usage: parsed?.usage },
  });
}));

// ─── MiniMax vision fallback ──────────────────────────────────────────
// Anthropic-format /messages endpoint with image + text prompt.
// Used as a last-resort when PlantNet (quota / down) and the in-browser
// dataset tier both miss. Token never leaves the Mac.
app.post('/api/minimax/identify', upload.single('image'), asyncRoute(async (req, res) => {
  if (!MINIMAX_ACCESS_TOKEN || !MINIMAX_API_URL) {
    return res.status(503).json({
      ok: false,
      error: 'minimax_not_configured',
      message: 'MINIMAX_ACCESS_TOKEN / MINIMAX_API_URL missing in vision-web/server/.env',
    });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'no_image' });

  // Same small-image guard as scan-bulk (see helper below).
  const dims = sniffImageDimensions(file.buffer);
  if (dims && (dims.w < 64 || dims.h < 64)) {
    return res.status(400).json({
      ok: false,
      error: 'image_too_small',
      message: `Image is only ${dims.w}×${dims.h} px. Use a photo at least 200×200 px so the model can see the items.`,
      width: dims.w, height: dims.h,
    });
  }

  const b64 = file.buffer.toString('base64');
    // Reuse the same improved PRODUCE_PROMPT constant used by /scan-bulk
  // so both endpoints share the upgraded distinguishing features
  // (capsicum/cabbage, plantain/banana, raw mango, etc.) without drifting.
  const prompt = PRODUCE_PROMPT;

  // Crop the image into 4 overlapping quadrants for the zoom-in pass below.
  //
  // This used to be missing here entirely: the zoom-in block referenced
  // `quadrants` and `callModel`, which were declared in the SIBLING
  // scan-bulk handler and so did not exist in this scope. The
  // `typeof quadrants !== 'undefined'` guard then turned the broken
  // reference into silently skipped code — the zoom-in pass never ran here
  // while its comment claimed it did.
  const quadrants = await cropQuadrants(file.buffer);

  const body = {
    model: MINIMAX_MODEL,
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image', source: { type: 'base64', media_type: file.mimetype || 'image/jpeg', data: b64 } },
      ],
    }],
  };

  const t0 = Date.now();
  let upstream;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MINIMAX_TIMEOUT_MS);
    upstream = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'Authorization': `Bearer ${MINIMAX_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: 'minimax_unreachable',
      message: err?.message ?? String(err),
    });
  }

  const ms = Date.now() - t0;
  const rawText = await upstream.text();
  let parsed;
  try { parsed = JSON.parse(rawText); }
  catch { parsed = { raw: rawText }; }

  if (!upstream.ok) {
    return res.status(upstream.status).json({
      ok: false,
      error: 'minimax_error',
      status: upstream.status,
      message: parsed?.error?.message ?? parsed?.message ?? rawText.slice(0, 200),
    });
  }

  const text = Array.isArray(parsed?.content)
    ? parsed.content.find((c) => c?.type === 'text')?.text ?? ''
    : '';
  if (!text) return res.json({ ok: false, error: 'minimax_empty', ms });

  // ─── 4-QUADRANT ZOOM-IN PASS ───────────────────────────────────────────
  // Run the model again on each of the 4 cropped quadrants in parallel.
  // Each quadrant is a zoomed-in view, so the model can detect small items
  // (Mint, Onion) and accurately count pieces that are too close to
  // distinguish in the full image. Merge results with the full-image
  // pass — for each label, keep the highest confidence.
  const quadrantItems = await runQuadrantPass(quadrants, { prompt, tag: 'identify' });
  console.log(`[identify] quadrant pass: ${quadrantItems.length} item(s) from ${quadrants.length} crop(s)`);

  // Parse the JSON array. Try multiple strategies in order:
  //   1) ```json ... ``` fenced block
  //   2) First top-level [...] array in the text (handles prose+JSON)
  //   3) First top-level {...} object in the text
  //   4) The whole trimmed text as JSON
  // If all fail, return minimax_parse with the raw text for debugging.
  function tryParseItems(s) {
    if (!s) return null;
    // 1) fenced block
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      const v = JSON.parse(fence[1]);
      return Array.isArray(v) ? v : (v ? [v] : null);
    }
    // 2) first [...] array (handles "Here are items: [...]")
    const arr = s.match(/\[[\s\S]*?\]/);
    if (arr) {
      try {
        const v = JSON.parse(arr[0]);
        if (Array.isArray(v)) return v;
        if (v) return [v];
      } catch {}
    }
    // 3) first {...} object
    const obj = s.match(/\{[\s\S]*?\}/);
    if (obj) {
      try {
        const v = JSON.parse(obj[0]);
        if (v) return [v];
      } catch {}
    }
    // 4) whole text
    const v = JSON.parse(s.trim());
    return Array.isArray(v) ? v : (v ? [v] : null);
  }

  let items = tryParseItems(text);
  if (items === null) {
    return res.json({ ok: false, error: 'minimax_parse', ms, raw: text.slice(0, 400) });
  }
  if (!Array.isArray(items)) items = [items];

  // Merge full-image items with quadrant zoom-in items. The quadrants give
  // us a closer look at small items that the full image missed. We just
  // concatenate here — the cleaning pipeline (dedupe, NEAR_DUPES) below
  // will keep the highest-confidence version of each label.
  if (quadrantItems.length > 0) {
    items = items.concat(quadrantItems);
  }

  const validUnits = ['pcs', 'kg', 'g', 'bunch', 'pack', 'dozen', 'l'];
  const validCats = ['vegetable', 'fruit', 'leafy', 'root', 'spice', 'staple', 'other'];

  // Labels we explicitly reject — these are descriptors, not real items.
  // Either way the model was supposed to drop them, but defend in depth.
  const FORBIDDEN_LABELS = new Set([
    'red', 'green', 'yellow', 'orange', 'purple', 'white', 'brown', 'black',
    'long', 'short', 'small', 'big', 'large', 'tiny', 'fresh', 'ripe', 'raw',
    'vegetable', 'fruit', 'item', 'produce', 'food', 'thing', 'stuff', 'piece',
    'unknown', 'mixed', 'various', 'assorted', 'organic', 'natural',
  ]);

  const cleaned = items
    .filter((it) => it && typeof it === 'object' && it.label)
    // Reject fragments, descriptors, plurals
    .map((it) => {
      const lbl = String(it.label).toLowerCase().trim();
      return { ...it, label: lbl };
    })
    .filter((it) => it.label.length >= 3 && !FORBIDDEN_LABELS.has(it.label))
    // Take first word and fix irregular plurals only. Trust the model's
    // plural form for regular -s plurals (peas, onions, carrots).
    .map((it) => {
      let lbl = it.label.split(/\s+/)[0];
      const singularFix = {
        'tomatoes': 'tomato', 'potatoes': 'potato', 'leaves': 'leaf',
        'berries': 'berry', 'cherries': 'cherry',
      };
      lbl = singularFix[lbl] ?? lbl;
      return { ...it, label: lbl };
    })
    .filter((it) => it.label.length >= 3 && !FORBIDDEN_LABELS.has(it.label))
    .map((it) => ({
      label: it.label,
      confidence: typeof it.confidence === 'number'
        ? Math.min(0.99, Math.max(0, it.confidence))
        : 0.7,
      quantity: typeof it.quantity === 'number' && it.quantity > 0
        ? Math.round(it.quantity)
        : 1,
      unit: validUnits.includes(it.unit) ? it.unit : 'pcs',
      category: validCats.includes(it.category) ? it.category : 'other',
      notes: String(it.notes ?? `MiniMax bulk scan · ${MINIMAX_MODEL}`).slice(0, 80),
    }))
    // Drop low-confidence items (likely hallucinated)
    .filter((it) => it.confidence >= 0.60)
    // Dedupe by canonicalized label — keep highest confidence
    .reduce((acc, it) => {
      const key = it.label;
      const existing = acc.get(key);
      if (!existing || existing.confidence < it.confidence) acc.set(key, it);
      return acc;
    }, new Map());

  // ─── NEAR-DUPLICATE DEDUPE ────────────────────────────────────────────
  // Model sometimes emits visually confusable items twice for the same produce.
  // Drop the lower-confidence / less specific one.
  const NEAR_DUPES = [
    { prefer: 'capsicum', drop: 'cabbage' },
    { prefer: 'plantain', drop: 'banana' },
    { prefer: 'coriander', drop: 'mint' },
    { prefer: 'coriander', drop: 'curry-leaves' },
    { prefer: 'coriander', drop: 'spinach' },
    { prefer: 'mint', drop: 'spinach' },
    { prefer: 'okra', drop: 'beans' },
    { prefer: 'okra', drop: 'green-bean' },
    { prefer: 'peas', drop: 'spinach' },
    { prefer: 'capsicum', drop: 'tomato' },
    { prefer: 'potato', drop: 'onion' },
    { prefer: 'onion', drop: 'brinjal' },
    { prefer: 'onion', drop: 'cabbage' },
    { prefer: 'cabbage', drop: 'brinjal' },
  ];
  for (const { prefer, drop } of NEAR_DUPES) {
    if (cleaned.has(prefer) && cleaned.has(drop)) {
      const p = cleaned.get(prefer);
      const d = cleaned.get(drop);
      if (p.confidence + 0.05 < d.confidence) {
        cleaned.delete(drop);
        cleaned.set(prefer, { ...d, label: prefer });
      } else {
        cleaned.delete(drop);
      }
    }
  }
  // Map to canonical BanglaVeg name when possible
  let cleanedArr = Array.from(cleaned.values())
    .map((it) => {
      const bv = mapToBanglaVegLocal(it.label);
      if (bv) it.label = bv.canonical;
      return it;
    })
    .sort((a, b) => b.confidence - a.confidence);

  // ─── VERIFICATION PASS ────────────────────────────────────────────────
  // For items the model wasn't confident about (< 0.85) or that were ambiguous
  // (peas/spinach, coriander/curry-leaves, etc.), re-ask in a focused way.
  // This is cheap because we only re-verify the weak ones, not the whole list.
  const NEEDS_VERIFY = cleanedArr.length > 0 && cleanedArr.length <= 15;
  if (NEEDS_VERIFY && cleanedArr.length > 0 && cleanedArr.length <= 15) {
    try {
      const verifyPrompt =
        'You are re-verifying a previous AI vision scan of the same grocery photo. ' +
        'For EACH item below, look again at the photo and confirm/correct the LABEL ' +
        'and QUANTITY. If a label is wrong (e.g. model said "cabbage" but it is ' +
        'actually "capsicum" — capsicum has a stem and hollow cavity, cabbage has ' +
        'layered leaves with no stem cavity; or model said "banana" but it is ' +
        '"plantain" — plantain is larger, more angular, thicker-skinned, often green), ' +
        'correct it. If quantity is off, give a more accurate count.\n\n' +
        'IMPORTANT: do NOT add new items you did not originally include. Only fix ' +
        'labels/notes on items that ARE present. Respond ONLY with the items you ' +
        'see confirmed in the photo.\n\n' +
        'Items to verify:\n' +
        cleanedArr.map((it, i) =>
          `  ${i + 1}. label="${it.label}" qty=${it.quantity} ${it.unit} conf=${it.confidence} notes="${it.notes}"`
        ).join('\n') +
        '\n\nRespond with ONLY a JSON array of the SAME shape containing ALL items ' +
        'you consider correct (verified or corrected), PLUS any missed items you ' +
        'are confident about, MINUS any false positives. NO prose, NO fences.';
      const verifyBody = {
        model: MINIMAX_MODEL,
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: verifyPrompt },
            { type: 'image', source: { type: 'base64', media_type: file.mimetype || 'image/jpeg', data: b64 } },
          ],
        }],
      };
      const vCtrl = new AbortController();
      const vTimer = setTimeout(() => vCtrl.abort(), 30_000);
      const vRes = await fetch(MINIMAX_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'Authorization': `Bearer ${MINIMAX_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(verifyBody),
        signal: vCtrl.signal,
      });
      clearTimeout(vTimer);
      const vJson = await vRes.json();
      const vText = Array.isArray(vJson?.content)
        ? vJson.content.find((c) => c?.type === 'text')?.text ?? ''
        : '';
      if (vText) {
        const fenceMatch = vText.match(/```(?:json)?\s*([\s\S]*?)```/);
        const vItems = JSON.parse(fenceMatch ? fenceMatch[1] : vText.trim());
        if (Array.isArray(vItems)) {
          // Build a lookup by label, then update cleanedArr in place
          const verifyMap = new Map(
            vItems.map((v) => [String(v.label || '').toLowerCase().trim().split(/\s+/)[0].replace(/s$/, ''), v])
          );
          cleanedArr = cleanedArr.map((it) => {
            const key = it.label.toLowerCase().split(/\s+/)[0].replace(/s$/, '');
            const v = verifyMap.get(key);
            if (!v) {
              // Verify pass didn't mention this item — trust the original.
              return it;
            }
            // Verify uses new format: {label, present, confidence, correct_label}
            if (v.present === false && Number(v.confidence) >= 0.85) {
              // Audit is highly confident this item is NOT in the photo — DROP it.
              return null;
            }
            // Item kept. Use correct_label if model corrected it.
            const finalLabel = (v.correct_label && v.correct_label !== v.label && v.correct_label.length > 0)
              ? String(v.correct_label).toLowerCase().trim().split(/\s+/)[0].replace(/s$/, '') || it.label
              : it.label;
            return {
              ...it,
              label: finalLabel,
              confidence: Math.min(0.99, Math.max(it.confidence, Number(v.confidence) || it.confidence + 0.05)),
              notes: String((v.notes || it.notes) + ' [audited]').slice(0, 80),
            };
          }).filter((it) => it !== null);
          // Apply BanglaVeg canonicalization again on verified labels
          cleanedArr = cleanedArr.map((it) => {
            const bv = mapToBanglaVegLocal(it.label);
            if (bv) it.label = bv.canonical;
            return it;
          });
        }
      }
    } catch (err) {
      // Verification is best-effort — don't fail the whole request if it breaks
      console.error('[minimax/scan-bulk] verify pass failed:', err?.message);
    }
  }

  // The client (src/utils/foodClassifier.ts) gates on a FLAT
  // single-prediction shape: result.label / result.confidence /
  // result.category / result.notes.
  //
  // This route used to answer {ok, ms, count, items:[…], raw:{…}} instead,
  // so the client's `if (!result.ok || !result.label) return []` check always
  // threw the answer away. The last-resort MiniMax vision tier therefore
  // returned an EMPTY prediction list in exactly the situation the endpoint
  // exists for — PlantNet down, dataset tier missed.
  const top = cleanedArr[0];
  res.json({
    ok: true,
    ms,
    label: top?.label ?? '',
    confidence: top?.confidence ?? 0,
    category: top?.category ?? 'other',
    notes: top?.notes ?? '',
  });
}));

// Map to canonical BanglaVeg name; same logic as in the classifier.
// Kept local here so we don't have to import from the frontend bundle.
function mapToBanglaVegLocal(label) {
  if (!label) return null;
  const l = String(label).toLowerCase().trim();
  const aliases = {
    'capsicum': 'Capsicum', 'bell pepper': 'Capsicum', 'pepper': 'Capsicum',
    'potato': 'Potato', 'tomato': 'Tomato', 'onion': 'Onion', 'carrot': 'Carrot',
    'cucumber': 'Cucumber', 'chili': 'Chili', 'chilli': 'Chili',
    'banana': 'Banana', 'plantain': 'Plantain',
    'garlic': 'Garlic', 'ginger': 'Ginger', 'spinach': 'Spinach',
    'cabbage': 'Cabbage', 'cauliflower': 'Cauliflower', 'broccoli': 'Broccoli',
    'brinjal': 'Brinjal', 'eggplant': 'Brinjal', 'okra': 'Okra', 'bhindi': 'Okra',
    'mushroom': 'Mushroom', 'mushrooms': 'Mushroom',
    'mint': 'Mint', 'pudina': 'Mint', 'cilantro': 'Coriander', 'coriander': 'Coriander',
    'dhania': 'Coriander', 'fenugreek': 'Fenugreek', 'methi': 'Fenugreek',
    'coriander leaves': 'Coriander', 'mint leaves': 'Mint',
    'long bean': 'Long Bean', 'long beans': 'Long Bean',
    'drumstick': 'Drumstick', 'moringa': 'Drumstick',
    'curry leaves': 'Curry Leaves', 'curry leaf': 'Curry Leaves',
    'bitter gourd': 'Bitter Gourd', 'karela': 'Bitter Gourd',
    'bottle gourd': 'Bottle Gourd', 'lauki': 'Bottle Gourd',
    'ridge gourd': 'Ridge Gourd', 'turai': 'Ridge Gourd',
    'pumpkin': 'Pumpkin', 'papaya': 'Papaya',
    'mango': 'Mango', 'banana': 'Banana', 'lemon': 'Lemon', 'lime': 'Lime',
    'radish': 'Radish', 'mooli': 'Radish', 'beet': 'Beetroot', 'beetroot': 'Beetroot',
    'sweet potato': 'Sweet Potato',
    'green chili': 'Chili', 'red chili': 'Chili', 'chilies': 'Chili',
    'capsicum green': 'Capsicum', 'capsicum red': 'Capsicum',
  };
  return aliases[l] ? { canonical: aliases[l] } : null;
}

// ─── House Bot — MiniMax chat for HomeHub ─────────────────────────────
//
//   POST /api/housebot/chat      ask House Bot a question + optional context
//   GET  /api/housebot/status    health check (MiniMax reachability + model)
//
// The frontend builds a context snapshot (stock, grocery, recipes, meal
// logs, dietary preferences) and sends it with each message. The bridge
// builds a system prompt and POSTs to the MiniMax Messages API, reusing the
// same endpoint + credential as the vision tiers so there is one key to
// manage.
//
// Wire format is Anthropic Messages:
//   request   { model, max_tokens, temperature?, stream?, messages: [...] }
//   response  { content: [{ type:'text', text }], usage, stop_reason }
//   streaming SSE, text arrives as content_block_delta -> delta.text

// Reuse the vision-tier endpoint/credential. Override with MINIMAX_CHAT_URL
// if chat should go to a different gateway than vision.
const MINIMAX_CHAT_URL = process.env.MINIMAX_CHAT_URL || MINIMAX_API_URL;
const HOUSEBOT_MODEL = process.env.HOUSEBOT_MODEL || MINIMAX_MODEL;
const HOUSEBOT_MAX_TOKENS = Number(process.env.HOUSEBOT_MAX_TOKENS || 2048);
const HOUSEBOT_TIMEOUT_MS = Number(process.env.HOUSEBOT_TIMEOUT_MS || 120_000);

function minimaxHeaders() {
  return {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    authorization: `Bearer ${MINIMAX_ACCESS_TOKEN}`,
  };
}

function minimaxConfigured() {
  return Boolean(MINIMAX_ACCESS_TOKEN && MINIMAX_CHAT_URL);
}

// ─── House Bot persistent memory ────────────────────────────────────────
//
// After each conversation, we ask the LLM to write a 200-word summary of
// what was discussed, what was cooked, what the user liked/disliked, and
// any preferences they mentioned. Next session, the last 5 summaries are
// injected into the prompt so House Bot remembers context across days.
//
// Storage: ~/.vision-overwatch/housebot-memory.json  (array, capped).
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MEMORY_DIR = join(homedir(), '.vision-overwatch');
const MEMORY_FILE = join(MEMORY_DIR, 'housebot-memory.json');
const MEMORY_MAX = 50;            // cap so file stays small
const MEMORY_INJECT = 5;          // how many recent summaries to inject

function readMemory() {
  try {
    if (!existsSync(MEMORY_FILE)) return [];
    const j = JSON.parse(readFileSync(MEMORY_FILE, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function writeMemory(arr) {
  try {
    if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
    writeFileSync(MEMORY_FILE, JSON.stringify(arr.slice(-MEMORY_MAX), null, 2));
  } catch (e) {
    console.error('[housebot-memory] write failed:', e?.message || e);
  }
}

// ─── error redaction ───────────────────────────────────────────────────
// Upstream failures used to be echoed to the client verbatim. That text can
// contain the provider's URL and internals — not a secret exactly, but not
// something a browser needs. The full detail is logged server-side now (see
// the request log); the client gets a short, safe description.
function publicError(detail, status) {
  const raw = typeof detail === 'string' ? detail : detail?.message || '';
  if (raw) {
    // Strip anything URL-shaped and keep it short.
    const scrubbed = raw.replace(/https?:\/\/\S+/gi, '[upstream]').replace(/\s+/g, ' ').trim();
    console.log(`[upstream-error] ${scrubbed.slice(0, 300)}`);
  }
  return raw ? scrubSafe(raw) : `HTTP ${status ?? 'error'}`;
}

function scrubSafe(raw) {
  const t = String(raw).replace(/https?:\/\/\S+/gi, '[upstream]').replace(/\s+/g, ' ').trim();
  return t.length > 160 ? `${t.slice(0, 160)}…` : t;
}

function appendMemory(summary) {
  const arr = readMemory();
  arr.push({ ts: Date.now(), summary });
  // memoryBlock() already trims what we send to the model, but the file grew
  // without limit and is re-read on every chat request. Cap it well above
  // anything a real conversation needs (MEMORY_INJECT entries are what the
  // model sees) and say so out loud rather than trimming silently.
  const MEMORY_FILE_MAX = 400;
  if (arr.length > MEMORY_FILE_MAX) {
    const dropped = arr.length - MEMORY_FILE_MAX;
    arr.splice(0, dropped);
    console.log(`[memory] trimmed ${dropped} old summar${dropped === 1 ? 'y' : 'ies'} (cap ${MEMORY_FILE_MAX})`);
  }
  writeMemory(arr);
}

function memoryBlock() {
  const arr = readMemory().slice(-MEMORY_INJECT);
  if (arr.length === 0) return null;
  return (
    `PAST CONVERSATIONS (last ${arr.length}, oldest first):\n` +
    arr
      .map(
        (m, i) =>
          `  [${i + 1}] (${new Date(m.ts).toISOString().slice(0, 10)}): ${m.summary}`,
      )
      .join('\n')
  );
}

const HOUSEBOT_SYSTEM_PROMPT = `You are House Bot — a warm, sharp kitchen assistant for a busy homemaker, and a knowledgeable general-purpose helper when asked.

Primary domain — KITCHEN:
- Help with what's in stock, what to buy, expiry awareness, recipe suggestions, and meal planning (tonight, this week).
- Cook with the user's pantry in mind. When a recipe needs an ingredient that's not in stock, mention it could go on the grocery list.
- Respect dietary preferences and allergies listed in context — never suggest foods that conflict.
- Match the cuisine to the user's request — if they ask for Italian, French, Thai, Chinese, Mexican, etc., give an authentic version of that cuisine. Don't bias toward Indian unless the user asks for Indian or the recipe is Indian.
- When the user asks for a recipe by name or for "what can I cook", pick from the RECIPE CATALOG section in context by NAME and ID when relevant — don't invent new Indian recipes if a closer option exists. If the catalog fits and the user wants something outside it, say so honestly and offer the closest option from the catalog, OR use the WEB SEARCH CONTEXT section when present.

Beyond kitchen — GENERAL KNOWLEDGE:
- You can also answer general questions (science, math, history, tech, cooking science, nutrition, conversions, substitutions, cultural context for dishes, etc.).
- For anything time-sensitive (news, prices, weather, current events), say you don't have live data and suggest the user check — don't fabricate.
- If a question is ambiguous between kitchen and general, lean toward kitchen first.

Reasoning & quality:
- Think carefully when the user asks about quantities, conversions, or substitutions — show the math briefly if helpful.
- For "I have X, Y, Z — what can I make?", cross-reference the user's STOCK + the RECIPE CATALOG and suggest 2-3 concrete recipes with ingredient coverage.
- For substitutions, prefer ones the user already has in stock; mention if a substitute changes flavor significantly.
- For meal plans, balance nutrition, variety, and what's expiring soon.

Personality:
- Warm but no-nonsense. Speak like a helpful friend who actually cooks and knows their stuff.
- Short sentences, bullet points for lists, no fluff.
- Reference the user's actual inventory and past conversations when relevant — they notice and appreciate that.
- If a memory note conflicts with fresh context the user just gave, prefer the fresh context.

Reading the room (important):
- A simple greeting ("hi", "hello", "hey", "good morning", "thanks") deserves a warm, brief reply — not a cooking suggestion. Match the user's energy: a one-word greeting gets a one-or-two-line response. Don't dump the stock list at them unprompted.
- Only bring up cooking, stock, expiry, or grocery topics when the user actually asks about them (or when there's an obvious urgency like food expiring today).
- "What can I make with X?" or "what's for dinner?" are kitchen triggers — then lean in. Everything else: stay general.

Taking action (important — you can really change the user's kitchen):
- When the user tells you they bought, cooked, used, or are about to buy something, you may actually edit their app. Emit a single fenced block AFTER your reply, like this:

\`\`\`homehub-actions
[{"type":"add_stock","name":"Tomato","quantity":4,"unit":"pcs","category":"vegetables","location":"fridge","expiryDate":"2026-10-14"}]
\`\`\`

- The block is stripped before the user sees your reply, so NEVER mention it, and never put it mid-answer. Only at the very end.
- Emit the block ONLY when the user's message clearly implies a change. "What's for dinner?" is not a command. "I bought 4 tomatoes" is.
- You may emit several actions in one block.
- Available actions:

  {"type":"add_stock","name":"...","quantity":NUMBER,"unit":"pcs|kg|g|ml|L|packets|dozen","category":"CATEGORY","location":"fridge|pantry","expiryDate":"YYYY-MM-DD (optional)","notes":"optional"}
  {"type":"add_grocery","name":"...","quantity":"free text like 2 packets","category":"CATEGORY"}
  {"type":"check_grocery","name":"..."}          // marks a matching open grocery item bought
  {"type":"set_stock_quantity","name":"...","quantity":NUMBER}   // sets an existing item's quantity

- category must be exactly one of: vegetables, fruits, dairy, meat, seafood, bakery, grains, beverages, snacks, frozen, condiments, household, other.
- location must be exactly one of: fridge, pantry. Fresh produce/dairy -> fridge; grains, oils, spices, packaged goods -> pantry.
- Use today's real date for expiryDate when the user says something like "lasts a week" — a rough realistic date beats omitting it.
- After emitting actions, confirm in plain language what you did ("Added 4 tomatoes to your fridge").
- NEVER invent actions the user didn't ask for. Don't clear or delete things — there is no delete action.
- If the request is ambiguous about quantity or item, ask your clarifying question FIRST and emit nothing.

When the user shares context (a JSON inventory snapshot or recipe catalog), treat it as ground truth — don't ask them to repeat it.

Clarifying questions (important):
- If the user's request is genuinely ambiguous AND a clarifying question would meaningfully change the answer, ask ONE short clarifying question before diving in. Examples:
  - "ice cream recipe" with no other context → ask flavor preference (fruit, chocolate, Indian-style kulfi, etc.)
  - "dinner for 2" → ask cuisine preference
  - "something sweet" → ask occasion
- Do NOT ask for clarification if you can reasonably guess from context (stock, past chats, time of day, dietary preferences already in context).
- One question max. After asking, wait for the user's reply — don't go ahead and assume.

`;

// ─── agent actions ─────────────────────────────────────────────────────────
// The bridge cannot write to the app's data itself (it lives in the user's
// browser), so the model *proposes* actions and the frontend executes them
// against its own store. Everything crossing that boundary is validated here
// first: an LLM misparse must never be able to corrupt someone's kitchen.

const ACTION_FENCE = '```homehub-actions';
const ACTION_CATEGORIES = new Set([
  'vegetables', 'fruits', 'dairy', 'meat', 'seafood', 'bakery', 'grains',
  'beverages', 'snacks', 'frozen', 'condiments', 'household', 'other',
]);
const ACTION_UNITS = new Set(['pcs', 'kg', 'g', 'ml', 'l', 'packets', 'dozen']);
const MAX_ACTIONS_PER_MESSAGE = 12;
const MAX_NAME_LEN = 60;

const cleanName = (v, max = MAX_NAME_LEN) =>
  typeof v === 'string'
    // WHY THE CONTROL CHARACTERS ARE WRITTEN AS ESCAPES AND NOT AS RAW
    // BYTES: a raw NUL byte makes ripgrep treat this whole file as a
    // binary file and stop searching it, so every line after this one was
    // invisible to a search — including the routes and the token handling,
    // which is 39% of the bridge. The raw bytes and the escapes mean the
    // same thing to the regex; only the escapes keep this file readable to
    // the tools that look at it. See scripts/test-source-files-are-text.mjs.
    ? v.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max)
    : '';

/** Returns a sanitised action, or null if it is not safe/recognised. */
function validateAction(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = typeof raw.type === 'string' ? raw.type : '';

  switch (type) {
    case 'add_stock': {
      const name = cleanName(raw.name);
      const quantity = Number(raw.quantity);
      if (!name || !Number.isFinite(quantity) || quantity <= 0) return null;
      const category = ACTION_CATEGORIES.has(raw.category) ? raw.category : 'other';
      const location = raw.location === 'fridge' || raw.location === 'pantry'
        ? raw.location
        : (['vegetables', 'fruits', 'dairy', 'meat', 'seafood', 'frozen'].includes(category)
            ? 'fridge' : 'pantry');
      const unit = ACTION_UNITS.has(String(raw.unit).toLowerCase())
        ? String(raw.unit).toLowerCase()
        : 'pcs';
      const expiryDate = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.expiryDate || ''))
        ? raw.expiryDate
        : undefined;
      return {
        type,
        name,
        quantity: Math.min(quantity, 10000),
        unit,
        category,
        location,
        ...(expiryDate ? { expiryDate } : {}),
        ...(raw.notes ? { notes: cleanName(raw.notes, 120) } : {}),
      };
    }
    case 'add_grocery': {
      const name = cleanName(raw.name);
      if (!name) return null;
      const quantity = cleanName(raw.quantity, 40) || '1';
      const category = ACTION_CATEGORIES.has(raw.category) ? raw.category : 'other';
      return { type, name, quantity, category };
    }
    case 'check_grocery': {
      const name = cleanName(raw.name);
      return name ? { type, name } : null;
    }
    case 'set_stock_quantity': {
      const name = cleanName(raw.name);
      const quantity = Number(raw.quantity);
      if (!name || !Number.isFinite(quantity) || quantity < 0) return null;
      return { type, name, quantity: Math.min(quantity, 10000) };
    }
    default:
      return null;
  }
}

/**
 * Split a model reply into displayable text and validated actions.
 * Tolerates a missing/extra fence and a ```json wrapper inside the block.
 */
function splitActions(reply) {
  const text = typeof reply === 'string' ? reply : '';
  const start = text.indexOf(ACTION_FENCE);
  if (start === -1) return { text: text.trim(), actions: [] };

  const cleanText = text.slice(0, start).trim();
  let body = text.slice(start + ACTION_FENCE.length);
  const end = body.indexOf('```');
  if (end !== -1) body = body.slice(0, end);
  body = body.trim();
  if (body.startsWith('json')) body = body.slice(4).trim();

  let actions = [];
  try {
    const parsed = JSON.parse(body);
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed && Array.isArray(parsed.actions) ? parsed.actions : []);
    actions = list.slice(0, MAX_ACTIONS_PER_MESSAGE).map(validateAction).filter(Boolean);
  } catch {
    // Malformed JSON means no actions — the user still gets their text.
    actions = [];
  }
  return { text: cleanText, actions };
}

const HOUSEBOT_SUMMARIZE_PROMPT = `You are summarizing a conversation between a user and House Bot, an Indian-household kitchen assistant.

Write a tight 150-220 word summary capturing:
- Topics discussed (meals, groceries, recipes, plans, general questions)
- Recipes recommended or cooked
- Items added to the grocery list, if any
- Preferences the user expressed (likes, dislikes, dietary notes, allergies, household size, weekday vs weekend cooking)
- Anything that should be remembered next time

Style: third-person, present-tense, factual. No filler. Skip greetings and meta-talk.

Output ONLY the summary text. No preamble.`;

// ─── image attachments for chat ──────────────────────────────────────────────
// The frontend may attach a photo ("HouseBot has eyes"). MiniMax speaks the
// Anthropic image format, so we splice the picture into the final user message
// as an extra content block. Capped and validated here — an oversized or
// non-image payload must never reach the model.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // base64 length
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// ─── what kind of picture this is ────────────────────────────────────────
//
// The app sends two different pictures through the same field: a photo of
// food the person took, and a frame of the store tab they are shopping in.
// They want different answers, and the bridge cannot tell them apart on its
// own — both arrive as base64 with a media type. So the app says which it
// is.
//
// WHY THE INSTRUCTION IS THE WHOLE DIFFERENCE: the instruction that goes
// with the picture is what tells the model how to read it. Told to judge
// ripeness, a screenshot of a price list is not read as a price list.
//
// WHY A MISSING KIND MEANS "PHOTO": an older bundle is already sitting in
// people's browser caches, and it can only ever have sent a photo. So the
// default is the old behaviour, not a new one.
const IMAGE_KIND_SCREEN = 'screen';

const PHOTO_VISION_HINT =
  `\n\n--- A PHOTO IS ATTACHED ---\nThe user sent an image. Look at it and answer about what you actually see. Describe the food, estimate quantities and portions, judge doneness/ripeness/freshness, and suggest what they could cook with it. Be concrete and visual. If the image is unclear or you can't identify something, say so plainly rather than guessing.\n`;

const SCREEN_VISION_HINT =
  `\n\n--- A SHARED TAB IS ON SCREEN ---\nThe user is sharing a browser tab and asking about what is on it. Read the screen itself: the page, the product, its name, the price, the quantity or size, the options and buttons. Answer the question they asked about what they are looking at — "how much is this?" is answered with the price on the screen, "what is this?" with what the page is. This is a screenshot of a screen, not a photograph of food, so do not describe it as one, do not judge the ripeness of what is on it, and do not suggest what to cook with it. If you cannot read something on the screen, say so plainly rather than guessing.\n`;

/**
 * The instruction that goes with a picture.
 *
 * WHY IT IS ONE FUNCTION: the same picture arrives by two routes, and two
 * copies of this string is two chances for them to drift apart.
 */
function visionHintFor(image) {
  if (!image || typeof image.data !== 'string' || !image.data) return '';
  if (image.data.length > MAX_IMAGE_BYTES) return '';
  return image.kind === IMAGE_KIND_SCREEN ? SCREEN_VISION_HINT : PHOTO_VISION_HINT;
}

/**
 * @param {Array<{role:string,content:any}>} messages
 * @param {{mediaType?:string,data?:string,kind?:string}|null|undefined} image
 */
function withImage(messages, image) {
  if (!image || typeof image.data !== 'string' || !image.data) return messages;
  const mediaType = ALLOWED_IMAGE_MIME.has(image.mediaType) ? image.mediaType : 'image/jpeg';
  const data = image.data.replace(/^data:[^;]+;base64,/, '');
  if (!data || data.length > MAX_IMAGE_BYTES) return messages;

  const out = messages.map((m) => ({ ...m }));
  const lastUser = [...out].reverse().find((m) => m.role === 'user');
  if (!lastUser) return messages;
  const text = typeof lastUser.content === 'string' ? lastUser.content : '';
  // The fallback asks the model what it is looking at, so it has to name the
  // right thing: a screenshot of a screen is not a photograph.
  const fallback = image.kind === IMAGE_KIND_SCREEN
    ? 'What is on the screen?'
    : 'What do you see in this photo?';
  lastUser.content = [
    { type: 'text', text: text || fallback },
    { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
  ];
  return out;
}

async function callMiniMaxChat({ model, messages, signal, options, image }) {
  if (!minimaxConfigured()) {
    return { ok: false, error: 'minimax_not_configured' };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), HOUSEBOT_TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', () => ctl.abort());
  try {
    const r = await fetch(MINIMAX_CHAT_URL, {
      method: 'POST',
      headers: minimaxHeaders(),
      body: JSON.stringify({
        model: model || HOUSEBOT_MODEL,
        max_tokens: options?.max_tokens ?? HOUSEBOT_MAX_TOKENS,
        temperature: options?.temperature ?? 0.6,
        stream: false,
        messages: withImage(messages, image),
      }),
      signal: ctl.signal,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { ok: false, status: r.status, error: txt };
    }
    const j = await r.json();
    // content is an array of blocks; concatenate every text block.
    const content = (Array.isArray(j.content) ? j.content : [])
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text || '')
      .join('');
    return {
      ok: true,
      content,
      eval_count: j.usage?.output_tokens || 0,
      stop_reason: j.stop_reason,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Streaming variant of callMiniMaxChat. Reads the Anthropic-style SSE stream
 * and invokes onToken for each text delta. Returns the output token count
 * when the stream completes.
 */
async function streamMiniMaxChat({ model, messages, signal, options, onToken, image }) {
  if (!minimaxConfigured()) {
    return { ok: false, error: 'minimax_not_configured' };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), HOUSEBOT_TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', () => ctl.abort());
  try {
    const r = await fetch(MINIMAX_CHAT_URL, {
      method: 'POST',
      headers: minimaxHeaders(),
      body: JSON.stringify({
        model: model || HOUSEBOT_MODEL,
        max_tokens: options?.max_tokens ?? HOUSEBOT_MAX_TOKENS,
        temperature: options?.temperature ?? 0.6,
        stream: true,
        messages: withImage(messages, image),
      }),
      signal: ctl.signal,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { ok: false, status: r.status, error: txt };
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let evalCount = 0;

    // Anthropic SSE interleaves `event:` and `data:` frames, and sends periodic
    // `ping` frames — only the data payloads matter here.
    const handleLine = (line) => {
      const t = line.trim();
      if (!t.startsWith('data:')) return;
      const payload = t.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let j;
      try {
        j = JSON.parse(payload);
      } catch {
        return; // keep-alive or partial frame
      }
      if (j.type === 'content_block_delta' && typeof j.delta?.text === 'string') {
        onToken(j.delta.text);
      } else if (j.type === 'message_delta') {
        evalCount = j.usage?.output_tokens || evalCount;
      } else if (j.type === 'error') {
        _streamError = j.error?.message || 'minimax_stream_error';
      }
    };
    let _streamError = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
      if (_streamError) break;
    }
    // The final frame can arrive without a trailing newline, so whatever is
    // left in `buf` still has to be parsed or its last tokens are lost.
    if (buf.trim()) handleLine(buf);

    if (_streamError) return { ok: false, error: _streamError };
    return { ok: true, eval_count: evalCount };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

// MiniMax has no "list models" endpoint, so status is an active 1-token
// probe. Cached briefly because the chat routes call this on every message.
let _statusCache = null;
const STATUS_TTL_MS = 60_000;

async function houseBotStatus({ fresh = false } = {}) {
  if (!fresh && _statusCache && Date.now() - _statusCache.at < STATUS_TTL_MS) {
    return _statusCache.value;
  }

  let value;
  if (!minimaxConfigured()) {
    value = {
      ok: false,
      minimax: false,
      reason: 'MINIMAX_ACCESS_TOKEN / MINIMAX_API_URL missing in bridge .env',
    };
  } else {
    try {
      const r = await fetch(MINIMAX_CHAT_URL, {
        method: 'POST',
        headers: minimaxHeaders(),
        body: JSON.stringify({
          model: HOUSEBOT_MODEL,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      value = r.ok
        ? {
            ok: true,
            minimax: true,
            url: MINIMAX_CHAT_URL,
            model: HOUSEBOT_MODEL,
            usingPrimary: true,
            usingFallback: false,
          }
        : { ok: false, minimax: false, url: MINIMAX_CHAT_URL, reason: `HTTP ${r.status}` };
    } catch (e) {
      value = { ok: false, minimax: false, reason: String(e?.message || e) };
    }
  }

  _statusCache = { at: Date.now(), value };
  return value;
}

app.get('/api/housebot/status', async (_req, res) => {
  res.json(await houseBotStatus());
});

/* --------------------------------------------------------------------------
   Reading a meal off a photo.

   Two very different jobs share one endpoint because the plumbing is
   identical — the prompt is what differs:

     dish       a photo of the food that was cooked -> name the dishes
     handwritten  a photo of a written recipe card -> transcribe it

   The bridge returns the model's reading as structured JSON, but the app
   ALWAYS shows it back for confirmation before anything is saved. A
   misread dish name silently landing in the meal log would poison the taste
   model and the taste match score with no obvious way to spot it later, so
   the human stays in the loop by design rather than as a nicety.
   -------------------------------------------------------------------------- */

/**
 * Pull the first balanced JSON object out of a model reply.
 *
 * The old extraction was a GREEDY `/\{[\s\S]*\}/`: if the model emitted
 * anything containing a `}` after the JSON object — a second object, a
 * stray brace — the match ran from the first `{` to the LAST `}`, JSON.parse
 * threw, and the route answered 200 with {ok:false,
 * error:'unreadable_response'}, throwing away a reading that was perfectly
 * valid. The sibling scan-bulk parser already used the non-greedy form.
 *
 * So: try a fenced block first, then a balanced-brace scan (which respects
 * strings and nested objects), then the whole text.
 */
function extractJsonObject(text) {
  const s = String(text || '');
  const candidates = [];

  // 1) A fenced ```json block.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1]);

  // 2) The first balanced {...} in the text.
  const start = s.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end !== -1) candidates.push(s.slice(start, end));
  }

  // 3) The whole text.
  candidates.push(s.trim());

  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const RECIPE_READ_PROMPT = `You are reading a photo for a home kitchen app.

Depending on the "mode" field:
- "dish": identify every dish visible in the photo. Use the common English
  name plus the Indian name when the dish is Indian (for example
  "Palak paneer (spinach curry)").
- "handwritten": transcribe the handwritten recipe exactly as written,
  including quantities. If a quantity is illegible, write "?" for it rather
  than guessing.

Reply with ONLY a JSON object, no prose and no code fence:

{
  "summary": "one short line naming the dish or the recipe",
  "items": ["each dish or ingredient, one per line"],
  "steps": ["each instruction, in order"],
  "confidence": 0.0-1.0,
  "uncertain": ["anything you could not read clearly"]
}

If you cannot tell what the photo shows, set "summary" to "" and return empty
arrays rather than inventing something.`;

app.post('/api/minimax/read-recipe', upload.single('image'), async (req, res) => {
  if (!MINIMAX_ACCESS_TOKEN || !MINIMAX_API_URL) {
    return res.status(503).json({
      ok: false,
      error: 'minimax_not_configured',
      message: 'MINIMAX_ACCESS_TOKEN / MINIMAX_API_URL missing in the bridge .env',
    });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: 'no_image' });

  const dims = sniffImageDimensions(file.buffer);
  if (dims && (dims.w < 64 || dims.h < 64)) {
    return res.status(400).json({
      ok: false,
      error: 'image_too_small',
      message: `That photo is only ${dims.w}×${dims.h} px. Try again with a larger photo.`,
      width: dims.w, height: dims.h,
    });
  }

  const mode = req.body?.mode === 'handwritten' ? 'handwritten' : 'dish';

  // Upscale: handwriting in particular is lost at phone-photo resolution
  // once it is downscaled to fit a model's input.
  let b64 = file.buffer.toString('base64');
  let mime = file.mimetype || 'image/jpeg';
  try {
    const meta = await sharp(file.buffer).metadata();
    if (meta.width && meta.height && (meta.width < 1400 || meta.height < 1400)) {
      const f = 2;
      const up = await sharp(file.buffer)
        .resize({
          width: Math.round((meta.width || 1000) * f),
          height: Math.round((meta.height || 1000) * f),
          withoutEnlargement: false,
        })
        .jpeg({ quality: 92 })
        .toBuffer();
      b64 = up.toString('base64');
    }
  } catch (e) {
    console.error('[read-recipe] upscale failed:', e?.message);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MINIMAX_TIMEOUT_MS);
  const t0 = Date.now();

  try {
    const upstream = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'Authorization': `Bearer ${MINIMAX_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `mode: ${mode}\n\n${RECIPE_READ_PROMPT}` },
            { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
          ],
        }],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const rawText = await upstream.text();
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        ok: false,
        error: 'minimax_error',
        status: upstream.status,
        message: rawText.slice(0, 200),
      });
    }

    let parsed;
    try { parsed = JSON.parse(rawText); } catch { parsed = null; }
    const text = Array.isArray(parsed?.content)
      ? parsed.content.find((c) => c?.type === 'text')?.text ?? ''
      : '';

    if (!text) {
      return res.json({ ok: false, error: 'minimax_empty', ms: Date.now() - t0 });
    }

    // The model is asked for bare JSON but will occasionally wrap it in a
    // fence or add a sentence, so recover rather than discarding a good read.
    const data = extractJsonObject(text);
    if (!data) {
      return res.json({
        ok: false,
        error: 'unreadable_response',
        message: text.slice(0, 300),
        ms: Date.now() - t0,
      });
    }

    const items = Array.isArray(data.items) ? data.items.filter(Boolean).map(String) : [];
    const steps = Array.isArray(data.steps) ? data.steps.filter(Boolean).map(String) : [];
    if (!data.summary && !items.length) {
      return res.json({
        ok: false,
        error: 'nothing_recognised',
        message: 'The model could not tell what is in this photo.',
        ms: Date.now() - t0,
      });
    }

    return res.json({
      ok: true,
      mode,
      summary: String(data.summary || '').trim(),
      items,
      steps,
      confidence: Number.isFinite(data.confidence)
        // Clamped: the model sometimes returns 5 or -0.2, and an
        // out-of-range confidence used to be passed straight through.
        ? Math.min(1, Math.max(0, data.confidence))
        : null,
      uncertain: Array.isArray(data.uncertain) ? data.uncertain.filter(Boolean).map(String) : [],
      ms: Date.now() - t0,
    });
  } catch (err) {
    clearTimeout(timer);
    return res.status(502).json({
      ok: false,
      error: 'minimax_unreachable',
      message: err?.message ?? String(err),
    });
  }
});

app.post('/api/housebot/chat', async (req, res) => {
  const { message, history, context, image } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'invalid_message' });
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: 'message_too_long' });
  }

  try {

  // Build context block (compact, only what the LLM needs).
  //
  // Everything in `context` is client-supplied and was never shape-checked.
  // `settings.allergies` is the dangerous one: a client that sends it as a
  // plain string ("peanuts") gives a truthy .length but no .join, so the
  // template literal below threw a TypeError and the route answered 500
  // with the internal message. Everything is normalised here first.
  const ctx = context || {};
  const stock = (Array.isArray(ctx.stock) ? ctx.stock : []).filter(Boolean);
  const grocery = (Array.isArray(ctx.grocery) ? ctx.grocery : []).filter(Boolean);
  const recentMeals = (Array.isArray(ctx.recentMeals) ? ctx.recentMeals : []).filter(Boolean);
  const settings =
    ctx.settings && typeof ctx.settings === 'object' && !Array.isArray(ctx.settings)
      ? ctx.settings
      : {};
  const recipes = (Array.isArray(ctx.recipes) ? ctx.recipes : []).filter(Boolean);
  const allergies = Array.isArray(settings.allergies)
    ? settings.allergies.filter(Boolean).map(String)
    : [];

  const today = new Date().toISOString().slice(0, 10);
  const expiringSoon = stock
    .filter((s) => s.expiresOn && s.expiresOn <= addDays(today, 3))
    .map((s) => ({ name: s.name, qty: `${s.quantity}${s.unit || ''}`, expires: s.expiresOn }));

  const recipesBlock = recipes.length
    ? `RECIPES (${recipes.length} available — pick from this list, don't invent new ones):\n` +
      recipes.slice(0, 200).map((r) => {
        const ing = Array.isArray(r.ingredients)
          ? r.ingredients.map((i) => `${i.quantity || ''}${i.unit ? i.unit : ''} ${i.name}`.trim()).join(', ')
          : '';
        return `  - [${r.id}] ${r.emoji || ''} ${r.name} (${r.mealType || ''}, serves ${r.baseServings || 2}): ${ing}`;
      }).join('\n')
    : null;

  // Optional: fetch live web context for non-Indian / niche recipe queries.
  let webBlock = null;
  try {
    webBlock = await webContextFor(message);
  } catch {
    /* web fetch failed — fall back to LLM training data */
  }

  const contextBlock = [
    `USER: ${settings.userName ? String(settings.userName) : 'Friend'}`,
    `DIET: ${settings.dietaryPreference && String(settings.dietaryPreference) !== 'no-preference' ? String(settings.dietaryPreference) : 'none'}`,
    allergies.length ? `ALLERGIES: ${allergies.join(', ')}` : null,
    `STOCK (${stock.length} items):`,
    stock.length
      ? stock.slice(0, 80).map((s) => `  - ${s.name}: ${s.quantity}${s.unit || ''}${s.expiresOn ? ` (exp ${s.expiresOn})` : ''}${s.category ? ` [${s.category}]` : ''}`).join('\n')
      : '  (empty)',
    grocery.length ? `GROCERY LIST (${grocery.length} open):\n${grocery.slice(0, 40).map((g) => `  - ${g.name}${g.quantity ? ` x${g.quantity}` : ''}`).join('\n')}` : null,
    expiringSoon.length ? `EXPIRING SOON: ${expiringSoon.map((e) => `${e.name} (${e.expires})`).join(', ')}` : null,
    recentMeals.length ? `RECENT MEALS (last ${recentMeals.length}):\n${recentMeals.slice(0, 7).map((m) => `  - ${m.date || m.createdAt}: ${m.title || (m.recipeIds ? m.recipeIds.length + ' recipes' : 'meal')}`).join('\n')}` : null,
    recipesBlock,
    webBlock,
    memoryBlock(),
  ].filter(Boolean).join('\n');


  // When a picture is attached, tell House Bot it can see and how to behave.
  // A photo and a shared screen get different instructions — see visionHintFor.
  const visionHint = visionHintFor(image);
  const sysMsg = `${HOUSEBOT_SYSTEM_PROMPT}\n\n--- LIVE CONTEXT (${today}) ---\n${contextBlock}${visionHint}`;

  // Cap history to last 10 turns to fit small-model context windows.
  const hist = Array.isArray(history) ? history.slice(-10) : [];
  const messages = [
    { role: 'system', content: sysMsg },
    ...hist.map((h) => ({ role: h?.role === 'assistant' ? 'assistant' : 'user', content: String(h?.content || '') })),
    { role: 'user', content: message },
  ];

  const t0 = Date.now();
  const r = await callMiniMaxChat({ model: HOUSEBOT_MODEL, messages, image });
  const ms = Date.now() - t0;

  if (!r.ok) {
    return res.status(502).json({
      error: 'housebot_unavailable',
      model: HOUSEBOT_MODEL,
      detail: publicError(r.error, r.status),
    });
  }

  const { text: replyText, actions } = splitActions(r.content || '');

  res.json({
    ok: true,
    reply: replyText,
    model: HOUSEBOT_MODEL,
    ms,
    eval_count: r.eval_count,
    actions,
  });
  } catch (err) {
    console.error('[housebot/chat] unhandled error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'chat_failed',
        detail: publicError(err),
      });
    }
  }
});

// ─── housebot: streaming chat ───────────────────────────────────────────
// POST /api/housebot/chat/stream  body: { message, history, context }
//
// Server-Sent Events (text/event-stream). Sends:
//   data: {"type":"start","model":"MiniMax-M3"}
//   data: {"type":"token","content":"..."}    <- one per text delta
//   data: {"type":"action","action":{...}}    <- one per validated app edit
//   data: {"type":"done","reply":"<full>","model":"...","ms":N,"eval_count":N}
//
// The frontend appends each token to the bot bubble as it arrives, so the
// user sees the reply stream in real time. The action block the model emits
// is withheld from the token stream and delivered as separate `action`
// events, so protocol never leaks into the prose the user reads.
app.post('/api/housebot/chat/stream', async (req, res) => {
  const { message, history, context, image } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'invalid_message' });
  }
  // Same cap as the non-streaming route — checked BEFORE the SSE headers
  // are flushed, so the client still gets a real 400.
  if (message.length > 4000) {
    return res.status(400).json({ error: 'message_too_long' });
  }

  // SSE headers — flush headers immediately so the browser sees the stream.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {
      /* connection closed mid-stream */
    }
  };

  // Track whether the request has been closed by the client so we can
  // bail out of the (potentially long) upstream work and not leak state.
  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
  });

  try {
    // Build context (same as /chat).
    const ctx = context || {};
    const stock = (Array.isArray(ctx.stock) ? ctx.stock : []).filter(Boolean);
    const grocery = (Array.isArray(ctx.grocery) ? ctx.grocery : []).filter(Boolean);
    const recentMeals = (Array.isArray(ctx.recentMeals) ? ctx.recentMeals : []).filter(Boolean);
    const settings =
      ctx.settings && typeof ctx.settings === 'object' && !Array.isArray(ctx.settings)
        ? ctx.settings
        : {};
    const recipes = (Array.isArray(ctx.recipes) ? ctx.recipes : []).filter(Boolean);
    const allergies = Array.isArray(settings.allergies)
      ? settings.allergies.filter(Boolean).map(String)
      : [];

  const today = new Date().toISOString().slice(0, 10);
  const expiringSoon = stock
    .filter((s) => s.expiresOn && s.expiresOn <= addDays(today, 3))
    .map((s) => ({ name: s.name, qty: `${s.quantity}${s.unit || ''}`, expires: s.expiresOn }));

  const recipesBlock = recipes.length
    ? `RECIPES (${recipes.length} available — pick from this list, don't invent new ones):\n` +
      recipes.slice(0, 200).map((r) => {
        const ing = Array.isArray(r.ingredients)
          ? r.ingredients.map((i) => `${i.quantity || ''}${i.unit ? i.unit : ''} ${i.name}`.trim()).join(', ')
          : '';
        return `  - [${r.id}] ${r.emoji || ''} ${r.name} (${r.mealType || ''}, serves ${r.baseServings || 2}): ${ing}`;
      }).join('\n')
    : null;

  // Optional: fetch live web context for non-Indian / niche recipe queries.
  let webBlock = null;
  try {
    webBlock = await webContextFor(message);
  } catch {
    /* web fetch failed — fall back to LLM training data */
  }

  const contextBlock = [
    `USER: ${settings.userName ? String(settings.userName) : 'Friend'}`,
    `DIET: ${settings.dietaryPreference && String(settings.dietaryPreference) !== 'no-preference' ? String(settings.dietaryPreference) : 'none'}`,
    allergies.length ? `ALLERGIES: ${allergies.join(', ')}` : null,
    `STOCK (${stock.length} items):`,
    stock.length
      ? stock.slice(0, 80).map((s) => `  - ${s.name}: ${s.quantity}${s.unit || ''}${s.expiresOn ? ` (exp ${s.expiresOn})` : ''}${s.category ? ` [${s.category}]` : ''}`).join('\n')
      : '  (empty)',
    grocery.length ? `GROCERY LIST (${grocery.length} open):\n${grocery.slice(0, 40).map((g) => `  - ${g.name}${g.quantity ? ` x${g.quantity}` : ''}`).join('\n')}` : null,
    expiringSoon.length ? `EXPIRING SOON: ${expiringSoon.map((e) => `${e.name} (${e.expires})`).join(', ')}` : null,
    recentMeals.length ? `RECENT MEALS (last ${recentMeals.length}):\n${recentMeals.slice(0, 7).map((m) => `  - ${m.date || m.createdAt}: ${m.title || (m.recipeIds ? m.recipeIds.length + ' recipes' : 'meal')}`).join('\n')}` : null,
    recipesBlock,
    webBlock,
    memoryBlock(),
  ].filter(Boolean).join('\n');


  // When a picture is attached, tell House Bot it can see and how to behave.
  // A photo and a shared screen get different instructions — see visionHintFor.
  const visionHint = visionHintFor(image);
  const sysMsg = `${HOUSEBOT_SYSTEM_PROMPT}\n\n--- LIVE CONTEXT (${today}) ---\n${contextBlock}${visionHint}`;

  const hist = Array.isArray(history) ? history.slice(-10) : [];
  const messages = [
    { role: 'system', content: sysMsg },
    ...hist.map((h) => ({ role: h?.role === 'assistant' ? 'assistant' : 'user', content: String(h?.content || '') })),
    { role: 'user', content: message },
  ];

  send({ type: 'start', model: HOUSEBOT_MODEL });

  // raw is everything the model produced; `emitted` tracks how much of the
  // human-readable part has already been sent. Once the action fence appears
  // everything from there on is protocol and is withheld from the token stream.
  let raw = '';
  let emitted = 0;
  const t0 = Date.now();
  const r = await streamMiniMaxChat({
    model: HOUSEBOT_MODEL,
    messages,
    image,
    signal: req.signal,
    options: { temperature: 0.6 },
    onToken: (tok) => {
      raw += tok;
      const fenceAt = raw.indexOf(ACTION_FENCE);
      const visible = fenceAt === -1 ? raw : raw.slice(0, fenceAt);
      if (visible.length > emitted) {
        send({ type: 'token', content: visible.slice(emitted) });
        emitted = visible.length;
      }
    },
  });

  const { text, actions } = splitActions(raw);

  if (!r.ok) {
    send({ type: 'error', error: r.error || `HTTP ${r.status}` });
  } else {
    for (const action of actions) send({ type: 'action', action });
    send({
      type: 'done',
      reply: text,
      model: HOUSEBOT_MODEL,
      ms: Date.now() - t0,
      eval_count: r.eval_count,
      actions: actions.length,
    });
  }
  res.end();
  } catch (err) {
    // SSE headers are already flushed, so we can't change status. Emit
    // an SSE error event so the frontend can surface a real message
    // instead of hanging on an empty stream.
    console.error('[housebot/chat/stream] unhandled error:', err?.message || err);
    if (!clientClosed) {
      try {
        send({
          type: 'error',
          error: String(err?.message || err).slice(0, 200),
        });
      } catch {
        /* socket already gone */
      }
    }
    try {
      res.end();
    } catch {
      /* already ended */
    }
  }
});

// ─── housebot: persistent memory ────────────────────────────────────────
// POST /api/housebot/summarize  body: { messages: [{role, content}, ...] }
app.post('/api/housebot/summarize', async (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'invalid_messages' });
  }
  const transcript = messages
    .map((m) => `${m.role === 'assistant' ? 'House Bot' : 'User'}: ${String(m.content || '').trim()}`)
    .join('\n')
    .slice(-8000); // cap to avoid blowing context

  const t0 = Date.now();
  const r = await callMiniMaxChat({
    model: HOUSEBOT_MODEL,
    messages: [
      { role: 'system', content: HOUSEBOT_SUMMARIZE_PROMPT },
      { role: 'user', content: transcript },
    ],
    options: { temperature: 0.3, max_tokens: 360 },
  });

  if (!r.ok) {
    return res
      .status(502)
      .json({ error: 'summary_failed', detail: publicError(r.error, r.status) });
  }

  const summary = (r.content || '').trim();
  if (!summary) {
    return res.status(502).json({ error: 'summary_empty' });
  }

  appendMemory(summary);
  res.json({
    ok: true,
    summary,
    model: HOUSEBOT_MODEL,
    ms: Date.now() - t0,
    stored: readMemory().length,
  });
});

// ─── housebot: web recipe search ───────────────────────────────────────
// POST /api/housebot/recipe  body: { query: "palak paneer recipe" }
//   - searches Brave for up to 5 result URLs + titles
//   - tries to fetch each page (skip on Cloudflare / network error)
//   - fetches a Wikipedia summary as fallback context
//   - uses the LLM to write a clean recipe (ingredients + steps)
//   - strips any URL/site mentions from the final output
//   - returns progress[] with site TITLES only (no URLs) for the UI

// ─── SSRF guard for outbound web fetches ──────────────────────────────
// The bridge scrapes a search engine's result page and then fetches those
// URLs ITSELF, server-side. The user-supplied chat message / recipe query
// steers that search, and the fetched body is spliced into the LLM prompt —
// so a result URL pointing at 127.0.0.1, at the cloud metadata address or
// at an RFC1918 host would let a caller read the bridge's own network and
// have it relayed straight back.
//
// So every outbound URL is checked BEFORE the request goes out: https only,
// and the host must not be loopback / link-local / private (nor resolve to
// one). Redirects are followed MANUALLY, one hop at a time, with the same
// check applied to every hop — a public URL must not be able to bounce the
// request into the LAN.

/** Hostnames that are never fetched, whatever they resolve to. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

/** RFC1918 + friends, for an IPv4 literal. */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true;                             // 0.0.0.0/8
  if (a === 10) return true;                            // 10.0.0.0/8
  if (a === 127) return true;                           // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;              // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true;     // 172.16.0.0/12
  if (a === 192 && b === 168) return true;              // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true;    // 100.64.0.0/10 CGNAT (Tailscale)
  if (a === 192 && b === 0) return true;                // 192.0.0.0/24, 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true;  // 198.18.0.0/15
  if (a >= 224) return true;                           // multicast + reserved
  return false;
}

/** Loopback / link-local / ULA / multicast, for an IPv6 literal. */
function isPrivateIPv6(ip) {
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true;
  // IPv4-mapped (::ffff:127.0.0.1) — judge the v4 part.
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (/^fe[89ab]/.test(s)) return true;  // fe80::/10 link-local
  if (/^f[cd]/.test(s)) return true;     // fc00::/7 unique-local
  if (/^ff/.test(s)) return true;        // multicast
  return false;
}

/** True when the address is loopback / link-local / private / reserved. */
function isPrivateAddress(addr) {
  const ip = String(addr || '').replace(/^\[|\]$/g, '');
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // not an IP literal — the DNS branch below handles names
}

/**
 * True when the host must not be fetched: a blocked name, a literal
 * private address, or a name that resolves to a private address.
 * A name that cannot be resolved is treated as blocked.
 */
async function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (net.isIP(h)) return isPrivateAddress(h);
  try {
    const infos = await dns.promises.lookup(h, { all: true, verbatim: true });
    if (!infos.length) return true;
    return infos.some((i) => isPrivateAddress(i.address));
  } catch {
    return true; // cannot resolve → do not fetch
  }
}

async function searchBraveRecipes(q) {
  const url =
    'https://search.brave.com/search?q=' +
    encodeURIComponent(`${q} recipe how to make`) +
    '&source=web';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    // Pull every external https link. Brave (and most search engines) ship
    // real recipe URLs as plain <a href="..."> tags inside result wrappers.
    // Skip domains that aren't recipe sources.
    const SKIP_HOSTS = [
      'brave.com',
      'search.brave.com',
      'youtube.com',
      'youtu.be',
      'facebook.com',
      'instagram.com',
      'twitter.com',
      'x.com',
      'google.com',
      'gstatic.com',
      'w3.org',
      'mozilla.org',
      'cloudflare.com',
      'duckduckgo.com',
    ];
    const seen = new Set();
    const results = [];
    const hrefRe = /href="(https?:\/\/[^"]+)"/g;
    let h;
    while ((h = hrefRe.exec(html)) && results.length < 8) {
      const u = h[1].replace(/&amp;/g, '&');
      if (seen.has(u)) continue;
      try {
        const parsed = new URL(u);
        // https only — the fetcher refuses anything else.
        if (parsed.protocol !== 'https:') continue;
        const host = parsed.hostname.toLowerCase();
        if (SKIP_HOSTS.some((s) => host === s || host.endsWith('.' + s))) continue;
        // Never hand a private / loopback / link-local host to the fetcher.
        if (await isBlockedHost(host)) continue;
        // Skip obvious non-content URLs.
        if (/\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|otf)(\?|$)/i.test(u)) continue;
        seen.add(u);
        // Try to grab a nearby title from the surrounding HTML.
        const titleMatch = html
          .slice(Math.max(0, h.index - 400), h.index + 200)
          .match(/<title[^>]*>([^<]+)<\/title>|class="[^"]*snippet[^"]*"[^>]*>([^<]+)</);
        const title =
          (titleMatch && (titleMatch[1] || titleMatch[2])) ? (titleMatch[1] || titleMatch[2]).trim() : host;
        results.push({ title: title || host, url: u });
      } catch {
        /* not a valid URL */
      }
    }
    return results.slice(0, 5);
  } catch {
    return [];
  }
}

async function fetchRecipePage(url) {
  // Follow redirects manually, re-validating every hop: a public URL must
  // not be able to bounce the request into the LAN.
  let current = String(url || '');
  for (let hop = 0; hop <= 3; hop++) {
    let u;
    try { u = new URL(current); } catch { return null; }
    if (u.protocol !== 'https:') return null;
    if (await isBlockedHost(u.hostname)) {
      console.warn(`[web] refusing to fetch a private or blocked host: ${u.hostname}`);
      return null;
    }
    let res;
    try {
      res = await fetch(u, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(8_000),
        redirect: 'manual',
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      try { current = new URL(loc, u).toString(); } catch { return null; }
      continue;
    }
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return null;
    const html = await res.text();
    // Strip scripts, styles, and tags; keep visible text only.
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return stripped.slice(0, 8000); // cap per source
  }
  return null;
}

// ─── Indian recipe catalog loader ──────────────────────────────────────
// Loads the 5,894-recipe Indian catalog (copied from the frontend's
// src/data/csvRecipes.json) once at startup, then kept in memory. This
// gives the recipe-options endpoint a Tier-1 free source that's instant
// (no rate limits, no LLM, no external API).
let indianRecipesCache = null;
let indianRecipesLoading = null;
async function loadIndianRecipes() {
  if (indianRecipesCache) return indianRecipesCache;
  if (indianRecipesLoading) return indianRecipesLoading;
  const path = join(DATA_DIR, 'indian-recipes.json');
  if (!existsSync(path)) return [];
  indianRecipesLoading = (async () => {
    try {
      const raw = readFileSync(path, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        indianRecipesCache = arr;
        return arr;
      }
      return [];
    } catch (e) {
      console.warn('[recipe-options] failed to load Indian CSV:', e?.message || e);
      return [];
    } finally {
      indianRecipesLoading = null;
    }
  })();
  return indianRecipesLoading;
}

async function fetchWikiSummary(name) {
  try {
    const safe = encodeURIComponent(name.replace(/\s+/g, '_'));
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${safe}`,
      { signal: AbortSignal.timeout(6_000) },
    );
    if (!res.ok) return '';
    const data = await res.json();
    return (data.extract || '').slice(0, 2000);
  } catch {
    return '';
  }
}

/**
 * Best-effort web context for a chat message. Used to ground the LLM in
 * fresh info for non-Indian / niche recipes. Returns a string suitable
 * to splice into the system prompt, or null if no context was retrieved.
 */
async function webContextFor(message) {
  const t = String(message || '').toLowerCase();
  // Web-search trigger. We err on the side of searching: any
  // knowledge-seeking question, anything the LLM might not have in its
  // training, and anything that explicitly asks for current info. The
  // goal is "HouseBot can google things" — not a curated list of
  // cuisines or dishes.
  const trimmed = t.trim();
  if (!trimmed) return null;
  const isKnowledgeSeeking =
    // Has a question mark — usually a knowledge query.
    /\?/.test(trimmed) ||
    // Starts with a question / request word.
    /^(what|who|where|when|why|how|which|can|could|would|should|is|are|was|were|do|does|did|tell me about|tell me more|do you know|have you heard|explain|describe)\b/.test(
      trimmed,
    ) ||
    // Explicit ask to look something up.
    /\b(google|search (for|the web|up)|look up|find out|check (online|the web|with google))\b/.test(
      trimmed,
    ) ||
    // Cooking verbs — recipes often need fresh info.
    /\b(recipe|how (to|do (i|you)) (make|cook|prepare|bake|grill|roast|fry|steam|stir[- ]?fry|saute)|give me (a|an|the)? (recipe|dish|food|meal|idea)|step[- ]by[- ]step|authentic|traditional|homemade|best |recipe for)\b/.test(
      trimmed,
    ) ||
    // "Latest" / "current" / "today" / "recent" — needs fresh data.
    /\b(latest|current|today|recent|right now|this year|2024|2025|2026|news|update|trending|now)\b/.test(
      trimmed,
    );
  // Skip pure social greetings — those don't need web context.
  const isPureGreeting =
    /^(hi|hello|hey|yo|hiya|howdy|good (morning|afternoon|evening)|thanks|thank you|thx|ty|bye|goodbye|see you|ok|okay|cool|nice|great|sure|yep|yeah|nope|nah)\b[.!]?$/.test(
      trimmed,
    );
  if (!isKnowledgeSeeking || isPureGreeting) return null;

  // Run a Brave recipe search.
  const sources = await searchBraveRecipes(message);
  if (sources.length === 0) return null;

  // Fetch the first source for richer grounding text.
  let firstPage = null;
  for (const src of sources.slice(0, 1)) {
    const text = await fetchRecipePage(src.url);
    if (text) {
      firstPage = {
        title: src.title,
        url: src.url,
        text: text.slice(0, 4500),
      };
      break;
    }
  }

  const lines = [];
  lines.push('WEB SEARCH CONTEXT (live web results for this recipe):');
  if (firstPage) {
    lines.push(`  Source: ${firstPage.title}`);
    lines.push(`  Excerpt: ${firstPage.text.slice(0, 3000)}`);
  }
  if (sources.length > 1) {
    lines.push(
      `  Other matching pages: ${sources
        .slice(1, 4)
        .map((s) => s.title)
        .join(' | ')}`,
    );
  }
  return lines.join('\n');
}

// ─── housebot: recipe options ──────────────────────────────────────────
// POST /api/housebot/recipe/options  body: { query: "..." }
//
// Returns a small set of candidate recipe options (title + brief
// description + image) so the chat UI can render them as clickable
// pills. Used before the full /recipe endpoint so the user can pick a
// variant instead of getting one auto-picked.
app.post('/api/housebot/recipe/options', async (req, res) => {
  const { query } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'invalid_query' });
  }
  if (query.length > 200) {
    return res.status(400).json({ error: 'query_too_long' });
  }

  try {
    const options = [];

    // Tier 1: search the local 5,894-recipe Indian CSV. Loaded once at
    // startup and re-used; matches are instant (<10ms).
    try {
      const indianCsv = await loadIndianRecipes();
      if (indianCsv.length > 0) {
        const tokens = query
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length >= 2);
        if (tokens.length > 0) {
          const scored = [];
          for (const r of indianCsv) {
            const name = (r.name || '').toLowerCase();
            const ingText = (r.ingredients || [])
              .map((i) => i.name || '')
              .join(' ')
              .toLowerCase();
            let score = 0;
            for (const t of tokens) {
              if (name.includes(t)) score += 3;
              if (ingText.includes(t)) score += 1;
            }
            if (score >= 3) scored.push({ r, score });
          }
          scored.sort((a, b) => b.score - a.score);
          for (const { r } of scored.slice(0, 4)) {
            options.push({
              id: (r.id || r.name || '').toString(),
              title: r.name,
              url: null,
              snippet: '',
            });
          }
        }
      }
    } catch {
      /* Indian CSV lookup failed — fall through to TheMealDB/LLM. */
    }

    // Tier 2: TheMealDB — ~310 free recipes, no API key needed. Good
    // international coverage; perfect supplement when the Indian CSV
    // doesn't have the dish.
    if (options.length < 4) {
      try {
        const mealRes = await fetch(
          'https://www.themealdb.com/api/json/v1/1/search.php?s=' +
            encodeURIComponent(query.trim()),
          {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5_000),
          },
        );
        if (mealRes.ok) {
          const mealData = await mealRes.json();
          if (Array.isArray(mealData.meals)) {
            const seen = new Set();
            for (const m of mealData.meals) {
              const title = (m.strMeal || '').trim();
              if (!title) continue;
              const key = title.toLowerCase();
              if (seen.has(key) || options.some((o) => o.title.toLowerCase() === key)) continue;
              seen.add(key);
              options.push({
                id: 'tmd-' + (m.idMeal || ''),
                title,
                url: m.strSource || (m.strYoutube ? null : null),
                snippet: '',
              });
              if (options.length >= 4) break;
            }
          }
        }
      } catch {
        /* TheMealDB failed — fall through. */
      }
    }

    // Tier 3: ask the LLM for plain-text recipe name variations. Plain text
    // is much faster than JSON because it's typically 60-80 tokens vs
    // 250+ for JSON, and `stream: true` lets us read the response as
    // it's generated.
    try {
      let buf = '';
      const streamResult = await streamMiniMaxChat({
        model: HOUSEBOT_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You list 3-4 recipe name variations for: ' +
              JSON.stringify(query) +
              '\nFormat: one recipe name per line. Plain text only. No bullets, no numbers, no descriptions, no preamble, no JSON. Different cuisines or styles when possible.',
          },
          { role: 'user', content: query.trim() },
        ],
        options: { temperature: 0.6, max_tokens: 120 },
        onToken: (tok) => {
          buf += tok;
        },
      });
      if (streamResult.ok && buf.trim()) {
        const lines = buf
          .split(/\n+/)
          .map((l) => l.replace(/^[\s\-*•\d.)\]]+/, '').trim())
          .filter((l) => l.length >= 3 && l.length <= 80)
          .slice(0, 4);
        for (const line of lines) {
          if (options.length >= 4) break;
          options.push({
            id: line.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, ''),
            title: line,
            url: null,
            snippet: '',
          });
        }
      }
    } catch {
      /* LLM failed — fall through to Brave. */
    }

    // Fallback: if the LLM returned nothing useful (e.g. malformed JSON),
    // try Brave. Returns [] on rate-limit (429) so we won't hang.
    if (options.length === 0) {
      try {
        const sources = await searchBraveRecipes(query.trim());
        const seen = new Set();
        for (const s of sources) {
          const key = (s.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          options.push({
            id: key,
            title: (s.title || '').replace(/ - [\w.*?/\-]+ ?\.?[a-z]{2,3}\/?$/i, '').trim() || s.title,
            url: s.url,
            snippet: '',
          });
          if (options.length >= 4) break;
        }
      } catch {
        /* Brave failed too — leave options empty. */
      }
    }

    res.json({ ok: true, query: query.trim(), options });
  } catch (err) {
    console.error('[housebot/recipe/options] error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'options_failed',
        detail: publicError(err),
      });
    }
  }
});

app.post('/api/housebot/recipe', async (req, res) => {
  const { query } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'invalid_query' });
  }

  // Cap the search query so a malicious client can't make us download a
  // huge string or run a giant Brave search.
  if (query.length > 500) {
    return res.status(400).json({ error: 'query_too_long' });
  }

  try {
    const progress = [];
  progress.push(`Searching the web for "${query.trim()}" recipes…`);

  // 1) Brave search.
  const sources = await searchBraveRecipes(query.trim());
  if (sources.length === 0) {
    progress.push('No recipe sites found via search; using general knowledge.');
  } else {
    progress.push(`Found ${sources.length} sources. Reading them now…`);
  }

  // 2) Fetch each source.
  const fetched = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    progress.push(`Reading source ${i + 1} of ${sources.length}…`);
    const text = await fetchRecipePage(s.url);
    if (text && text.length > 400) {
      fetched.push({ title: s.title, text });
    }
  }

  // 3) Wikipedia fallback (almost always has something).
  let wiki = '';
  const wikiName = query
    .replace(/\brecipe\b/gi, '')
    .replace(/\bhow to make\b/gi, '')
    .trim();
  if (wikiName) {
    progress.push('Pulling reference notes…');
    wiki = await fetchWikiSummary(wikiName);
  }

  // 4) Build context (URLs NEVER included — user wants this hidden).
  const sourceBlock = fetched
    .map((s, i) => `--- Reference ${i + 1} (${s.title}) ---\n${s.text}`)
    .join('\n\n');
  const wikiBlock = wiki ? `--- Background notes ---\n${wiki}\n` : '';

  // 5) Compose a STRICT prompt: no source mentions in the final answer.
  const sysPrompt = `You are a recipe writer for a home cook.

You will receive several reference texts from general recipe blogs/encyclopedias. Combine the useful information into ONE clear, practical recipe.

Strict rules:
- Do NOT mention, cite, link to, or hint at any website, source, blog, or URL in your output. The reader must not be able to tell which sites you read.
- Write the recipe as if it were your own.
- Use short, friendly sentences.
- Output format:
    Title: <dish name>
    Serves: <number>
    Time: <approximate total time>

    Ingredients:
    - ...

    Steps:
    1. ...
    2. ...
- If the references are sparse, fall back on your own culinary knowledge to fill in reasonable ingredients and steps for a well-known dish. Never invent unusual or unsafe combinations.
- Skip the preamble; go straight to the title.`;

  const userPrompt = `Dish: ${query.trim()}\n\n${wikiBlock}${sourceBlock}`;

  // 6) Ask the LLM to write the recipe from that context.
  const t0 = Date.now();
  let recipe = '';
  try {
    const r = await callMiniMaxChat({
      model: HOUSEBOT_MODEL,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt },
      ],
      options: { temperature: 0.4, max_tokens: 2000 },
    });
    if (r.ok) recipe = (r.content || '').trim();
  } catch {
    /* ignore; recipe stays empty */
  }
  const ms = Date.now() - t0;

  // 7) Belt-and-braces: strip any URL / "source" mention from the model reply
  // so the legal-safe promise holds even if the model misbehaves.
  recipe = recipe
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '')
    .replace(/\b(source[s]?:|credit[s]?:|inspired by|adapted from|recipe from|via|from) [^.\n]+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!recipe) {
    recipe =
      `Title: ${query.trim()}\n\n` +
      'I had trouble writing this one — try asking with a slightly different name.';
  }

  progress.push('Compiling the recipe…');

  return res.json({
    ok: true,
    query: query.trim(),
    sources: fetched.length, // count only (no URLs)
    progress,
    recipe,
    ms,
    model: HOUSEBOT_MODEL,
  });
  } catch (err) {
    console.error('[housebot/recipe] unhandled error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'recipe_failed',
        detail: publicError(err),
      });
    }
  }
});

/**
 * Add `n` days to an ISO date (YYYY-MM-DD) and return YYYY-MM-DD.
 *
 * The date is parsed and advanced in UTC, deliberately. It used to parse
 * 'YYYY-MM-DDT00:00:00' as LOCAL midnight and then format with
 * toISOString(), which converts to UTC — in IST (UTC+5:30) local midnight
 * is 18:30 UTC the previous day, so the date shifted back one. That made
 * addDays(today, 3) return a date only two days ahead, and items expiring
 * in exactly three days were silently dropped from the "EXPIRING SOON"
 * block of the House Bot context.
 */
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── health ────────────────────────────────────────────────────────────

// ── voice ─────────────────────────────────────────────────────────────────
// Text-to-speech, synthesised on this machine by Kokoro (see ~/tools/tts).
// No API key, no per-use cost, and it works with the network unplugged.
// The bridge is the right place for this even though nothing secret is
// involved: the model and its Python runtime live outside the repo, so the
// frontend just asks for audio and never has to know where it came from.

const TTS_DAEMON = process.env.HOMEHUB_TTS_URL || 'http://127.0.0.1:8790';

app.post('/api/voice/speak', async (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) {
    return res.status(400).json({ error: 'bad_request', message: 'text is required' });
  }
  // Long answers would take a while to synthesise and produce a huge file.
  const capped = text.slice(0, 1200);
  const voice = String(req.body?.voice ?? 'af_heart').replace(/[^a-z_]/gi, '') || 'af_heart';

  // Talks to the warm Kokoro daemon, which holds the model in memory. Calling
  // the CLI instead would pay ~9s of model load on every single reply.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 45_000);
  try {
    const upstream = await fetch(`${TTS_DAEMON}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: capped, voice }),
      signal: ac.signal,
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('[voice] daemon returned', upstream.status, detail.slice(0, 200));
      return res.status(503).json({
        error: 'tts_unavailable',
        message: 'Local voice engine is not running; the app will use the browser voice.',
      });
    }
    const wav = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(wav);
  } catch (err) {
    console.error('[voice] synthesis failed:', err?.message || err);
    return res.status(503).json({
      error: 'tts_unavailable',
      message: 'Local voice engine is not reachable; the app will use the browser voice.',
    });
  } finally {
    clearTimeout(timer);
  }
});

app.get('/api/voice/health', async (_req, res) => {
  try {
    const upstream = await fetch(`${TTS_DAEMON}/health`);
    return res.status(upstream.ok ? 200 : 503).json(await upstream.json());
  } catch {
    return res.status(503).json({ ok: false });
  }
});

// Unauthenticated (it sits outside the /api mount, so the shared-secret
// gate never applies) — so it must not disclose anything about the
// machine. It used to return the absolute data directory path and the
// internal configuration to anyone who asked.
app.get('/healthz', (_req, res) => res.json({
  ok: true,
  configured: Boolean(BRIDGE_TOKEN),
}));

// ─── serve the built SPA (optional) ───────────────────────────────────
// When a production build exists, the bridge serves it too. That puts the
// app and its API on ONE origin, so a single cloudflared tunnel exposes
// both, there is no CORS/Private-Network-Access dance, and the frontend
// can call the API relatively — which survives a quick tunnel handing out
// a different hostname on the next launch.
//
// Registered last, so every /api route above wins the match.
const WEB_DIST_DIR = process.env.WEB_DIST_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');

if (existsSync(WEB_DIST_DIR)) {
  app.use(express.static(WEB_DIST_DIR, {
    index: false,
    setHeaders: (res, filePath) => {
      const name = path.basename(filePath);
      // Content-hashed files under /assets can be cached hard — a new build
      // produces new names, so a stale copy can never be requested.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        // The shell, the manifest and the service worker must never be
        // cached: they are what points at the current hashed assets. A stale
        // shell asks for asset files that no longer exist, and the app boots
        // to a blank page.
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
      }
      if (name === 'sw.js') res.setHeader('Cache-Control', 'no-store, must-revalidate');
    },
  }));

  // SPA fallback: react-router paths like /grocery must return index.html.
  //
  // This must ONLY answer real navigation requests. If a missing file under
  // /assets/ falls through to here it gets the HTML shell with a 200 and a
  // text/html content-type; a <script src=...> then fails to parse, React
  // never mounts, and the user sees a blank white page. Missing assets must
  // 404 instead.
  app.get('*', (req, res, next) => {
    const p = req.path;
    if (
      p.startsWith('/api/') ||
      p.startsWith('/uploads/') ||
      p.startsWith('/assets/') ||
      // Anything with a file extension is a file request, not a route.
      /\.[a-z0-9]{1,8}$/i.test(p)
    ) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.sendFile(path.join(WEB_DIST_DIR, 'index.html'), (err) => {
      if (err) next(err);
    });
  });

  console.log(`[overwatch] serving SPA from ${WEB_DIST_DIR}`);
} else {
  console.log(`[overwatch] no build found at ${WEB_DIST_DIR} — API only`);
}

app.listen(PORT, () => {
  console.log(`[overwatch] listening on http://localhost:${PORT}`);
  console.log(`[overwatch] data dir: ${DATA_DIR}`);
  console.log(`[overwatch] bridging to agent: ${OVERWATCH_AGENT}`);
});

// ─── safety nets ───────────────────────────────────────────────────────
// Express 4 doesn't catch async-handler rejections by default — without
// these, an unhandled rejection in any route kills the process. Log loud,
// respond 503 if a response is still possible, otherwise stay silent.

// Catch-all error middleware (4-arg signature is what Express uses to
// recognize it as an error handler).
app.use((err, _req, res, _next) => {
  console.error('[overwatch] route error:', err?.message || err);
  if (res.headersSent) return;

  // An oversize upload is the CALLER's problem, not a server crash.
  // Multer's LIMIT_FILE_SIZE used to be reported as a 500 carrying the raw
  // internal message ("File too large"), which reads like the bridge died.
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'file_too_large',
      message: 'That file is too large. The maximum upload size is 12 MB.',
    });
  }
  // body-parser's version of the same thing (the express.json limit).
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'payload_too_large',
      message: 'That request body is too large.',
    });
  }

  // Anything else is an internal fault. The detail is logged above; the
  // response gets a generic message so internal error text is not
  // disclosed to the caller.
  res.status(500).json({
    error: 'internal_error',
    detail: 'Internal server error.',
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[overwatch] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[overwatch] uncaughtException:', err);
  // Don't exit — log and keep serving. Only exit on truly fatal issues.
});