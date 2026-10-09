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
import cors from 'cors';
import multer from 'multer';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

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
// Set CORS + PNA headers BEFORE everything else, including the cors()
// middleware so OPTIONS preflights also carry the Private-Network opt-in.
// This is required for HTTPS pages (somi7pnt694ia.space.minimax.io) to
// reach http://localhost:8789 in modern Chromium.
//
// IMPORTANT: when Private Network Access is requested, Chrome REJECTS the
// `Access-Control-Allow-Origin: *` wildcard — it must echo the exact Origin
// header value. Otherwise the response is treated as if Allow-Origin were
// null and the request is blocked.
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization,x-homehub-token');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }
  next();
});
app.use(cors({ origin: true, credentials: false })); // mirror Origin (not '*') under PNA
app.use(express.json({ limit: '4mb' }));

// ─── security headers ─────────────────────────────────────────────────
// Hand-rolled rather than helmet: no new dependency to install on a machine
// that may not be able to run npm, and the policy only has to cover what this
// app actually serves.
//
// The policy is deliberately permissive where the app needs it: inline styles
// (React inline style props, the aurora background) and blob:/data: images
// (photo previews, canvas-downscaled attachments) are both required.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self' blob: data: https://tfhub.dev https://storage.googleapis.com",
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
if (process.env.BRIDGE_TOKEN) {
  const tokenOk = (req, res, next) => {
    const supplied = req.get('x-homehub-token') || (req.query && req.query.token) || '';
    if (supplied === process.env.BRIDGE_TOKEN) return next();
    res.status(401).json({ error: 'unauthorized' });
  };
  app.use('/uploads', tokenOk, express.static(UPLOADS_DIR, { maxAge: '7d' }));
} else {
  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));
}

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
  /^\/(analyze|overwatch|plantnet|minimax|housebot)\b/,
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

// ─── request log ───────────────────────────────────────────────────────
// Method, path, status and duration only — never the body, since bodies here
// carry photos and the user's kitchen data.
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    const flag = res.statusCode >= 500 ? ' !!' : res.statusCode >= 400 ? ' !' : '';
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms${flag}`);
  });
  next();
});

// ─── shared-secret gate ───────────────────────────────────────────────
// The bridge holds a MiniMax key and PlantNet quota with no per-user
// accounts, so when it is reachable from the internet anyone who finds
// the URL could spend those credits. BRIDGE_TOKEN puts a shared secret in
// front of every /api route.
//
// Set BRIDGE_TOKEN in the .env to enforce. Leave it unset and the gate is
// a no-op, which is what local-only use wants.
//
// Honest limitation: the browser has to present this token, so it ships
// inside the JS bundle and anyone who opens devtools can read it. This
// stops drive-by and scanner traffic, not a determined attacker. Real
// authentication needs Cloudflare Access in front of the tunnel.
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
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
    const supplied =
      req.get('x-homehub-token') ||
      (req.query && req.query.token) ||
      '';
    if (supplied === BRIDGE_TOKEN) return next();
    res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid x-homehub-token.',
    });
  });
}

// ─── persistence helpers ──────────────────────────────────────────────

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch { return fallback; }
}
async function writeJson(p, data) {
  await fs.writeFile(p, JSON.stringify(data, null, 2));
}
const readResults = () => readJson(RESULTS_FILE, []);
const writeResults = (rows) => writeJson(RESULTS_FILE, rows);
const readChat = () => readJson(CHAT_FILE, []);
const writeChat = (rows) => writeJson(CHAT_FILE, rows);

// ─── results API ──────────────────────────────────────────────────────

app.post('/api/analyze', upload.single('image'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'no_image' });

  const id = crypto.randomUUID();
  const ext = path.extname(file.originalname) || '.jpg';
  const storedName = `${id}${ext}`;
  const storedPath = path.join(UPLOADS_DIR, storedName);
  await fs.writeFile(storedPath, file.buffer);

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
  const rows = await readResults();
  rows.unshift(result);
  await writeResults(rows);
  res.json({ result });
});

app.patch('/api/results/:id', async (req, res) => {
  const id = req.params.id;
  const rows = await readResults();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  rows[idx] = { ...rows[idx], ...req.body, id };
  await writeResults(rows);
  res.json({ result: rows[idx] });
});

app.get('/api/results', async (_req, res) => res.json(await readResults()));

app.delete('/api/results', async (_req, res) => {
  await writeResults([]);
  const files = await fs.readdir(UPLOADS_DIR).catch(() => []);
  await Promise.all(files.map((f) => fs.unlink(path.join(UPLOADS_DIR, f)).catch(() => {})));
  res.json({ ok: true });
});

app.delete('/api/results/:id', async (req, res) => {
  const rows = await readResults();
  const row = rows.find((r) => r.id === req.params.id);
  if (row) {
    const fname = path.basename(row.imageUrl);
    await fs.unlink(path.join(UPLOADS_DIR, fname)).catch(() => {});
  }
  await writeResults(rows.filter((r) => r.id !== req.params.id));
  res.json({ ok: true });
});

// ─── overwatch agent bridge ───────────────────────────────────────────

/** Run the local openclaw CLI to talk to the overwatch agent. Returns
 *  parsed JSON from the agent, plus timing. */
function callOverwatch(args) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let proc;
    try {
      proc = spawn('openclaw', args, { env: { ...process.env } });
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
        parsed: ok ? parsed : null,
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
    reachable: status.code !== -1,
    code: status.code,
    ms: status.ms,
    providerError: (status.parsed && status.parsed.error && status.parsed.error.message) || null,
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

  if (!status.parsed) {
    return res.status(502).json({
      error: 'overwatch_unavailable',
      message: (status.parsed && status.parsed.error && status.parsed.error.message) || status.stderr,
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
app.post('/api/overwatch/image', upload.single('image'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'no_image' });
  const question = (req.body && req.body.question) || 'Identify this grocery item, suggest storage.';

  const id = crypto.randomUUID();
  const ext = path.extname(file.originalname) || '.jpg';
  const storedName = `${id}${ext}`;
  const storedPath = path.join(UPLOADS_DIR, storedName);
  await fs.writeFile(storedPath, file.buffer);

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

  const text = extractAgentText(status.parsed);
  const { prediction, rawReply, parsedOk } = parseAgentReply(text);
  res.json({
    ok: status.code === 0,
    ms: status.ms,
    imageUrl: `/uploads/${storedName}`,
    prediction,
    rawReply,
    parsedOk,
  });
});

/** Persistent chat history between the user and overwatch. */
app.get('/api/overwatch/chat', async (_req, res) => res.json(await readChat()));

app.post('/api/overwatch/chat', async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'invalid_message' });

  const history = await readChat();
  history.push({ role: 'user', at: Date.now(), text: message });

  const status = await callOverwatch([
    'agent',
    '--agent', OVERWATCH_AGENT,
    '-m', message,
    '--json',
  ]);

  const replyText = extractAgentText(status.parsed) || status.stderr || '(no reply)';
  history.push({ role: 'assistant', at: Date.now(), text: replyText });
  await writeChat(history);

  res.json({
    ok: status.code === 0,
    reply: replyText,
    parsed: status.parsed,
    history,
  });
});

// ─── PlantNet proxy ───────────────────────────────────────────────────
// Forwards a photo to https://my-api.plantnet.org and normalises the
// response into a simple Prediction[] shape HomeHub can render.
//
// Why a proxy and not a browser-direct call?
//   - The API key stays on your Mac (server/.env). Never bundled.
//   - Daily-quota tracking has a real home.
//   - No CORS dance.

/** Read + write the in-memory daily quota counter (resets at UTC midnight). */
async function quotaTick() {
  const today = new Date().toISOString().slice(0, 10);
  let q = await readJson(QUOTA_FILE, { date: today, count: 0 });
  if (q.date !== today) q = { date: today, count: 0 };
  q.count += 1;
  await writeJson(QUOTA_FILE, q);
  return { usedToday: q.count, quota: PLANTNET_DAILY_LIMIT };
}
async function quotaRead() {
  const today = new Date().toISOString().slice(0, 10);
  const q = await readJson(QUOTA_FILE, { date: today, count: 0 });
  if (q.date !== today) return { usedToday: 0, quota: PLANTNET_DAILY_LIMIT };
  return { usedToday: q.count, quota: PLANTNET_DAILY_LIMIT };
}

app.get('/api/plantnet/status', async (_req, res) => {
  const quota = await quotaRead();
  res.json({
    configured: Boolean(PLANTNET_API_KEY),
    project: PLANTNET_PROJECT,
    usedToday: quota.usedToday,
    quota: quota.quota,
    remaining: Math.max(0, quota.quota - quota.usedToday),
  });
});

app.post('/api/plantnet/identify', upload.single('image'), async (req, res) => {
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

  const id = crypto.randomUUID();
  const ext = path.extname(file.originalname) || '.jpg';
  const storedName = `${id}${ext}`;
  const storedPath = path.join(UPLOADS_DIR, storedName);
  await fs.writeFile(storedPath, file.buffer);

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
      `Content-Disposition: form-data; name="images"; filename="scan${ext}"${CRLF}` +
      `Content-Type: ${file.mimetype || 'image/jpeg'}${CRLF}${CRLF}`,
  );
  const head = Buffer.from(parts.join(''), 'utf8');
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf8');
  const body = Buffer.concat([head, file.buffer, tail]);

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
});

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
app.post('/api/minimax/scan-bulk', upload.single('image'), async (req, res) => {
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
  let quadrants = [];
  try {
    const img = sharp(file.buffer);
    const md = await img.metadata();
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
      const buf = await sharp(file.buffer)
        .extract({ left: c.left, top: c.top, width: c.width, height: c.height })
        .resize({ width: 1024, withoutEnlargement: false })
        .jpeg({ quality: 90 })
        .toBuffer();
      quadrants.push({ name: c.name, b64: buf.toString('base64') });
    }
  } catch (e) {
    console.error('[scan-bulk] quadrant crop failed:', e?.message);
  }

  // Build a body helper that sends the same prompt + image data to MiniMax.
  const callModel = async (imageB64, opts = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || MINIMAX_TIMEOUT_MS);
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
          max_tokens: opts.maxTokens || 1500,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: opts.prompt || prompt },
              { type: 'image', source: { type: 'base64', media_type: mime, data: imageB64 } },
            ],
          }],
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      return upstream; // Return the Response so caller can stream text/json
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  };

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
  let quadrantItems = [];
  if (typeof quadrants !== 'undefined' && quadrants.length > 0) {
    const quadrantPromises = quadrants.map(async (q) => {
      try {
        const qRes = await callModel(q.b64, { maxTokens: 800, timeoutMs: 20_000 });
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
        console.error('[scan-bulk] quadrant pass failed:', e?.message);
        return [];
      }
    });
    const allQuadrantResults = await Promise.all(quadrantPromises);
    quadrantItems = allQuadrantResults.flat();
  }

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
});

// ─── MiniMax vision fallback ──────────────────────────────────────────
// Anthropic-format /messages endpoint with image + text prompt.
// Used as a last-resort when PlantNet (quota / down) and the in-browser
// dataset tier both miss. Token never leaves the Mac.
app.post('/api/minimax/identify', upload.single('image'), async (req, res) => {
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
  let quadrantItems = [];
  if (typeof quadrants !== 'undefined' && quadrants.length > 0) {
    const quadrantPromises = quadrants.map(async (q) => {
      try {
        const qRes = await callModel(q.b64, { maxTokens: 800, timeoutMs: 20_000 });
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
        console.error('[scan-bulk] quadrant pass failed:', e?.message);
        return [];
      }
    });
    const allQuadrantResults = await Promise.all(quadrantPromises);
    quadrantItems = allQuadrantResults.flat();
  }

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

  res.json({
    ok: true,
    ms,
    count: cleanedArr.length,
    items: cleanedArr,
    raw: { text, usage: parsed?.usage },
  });
});

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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
    ? v.replace(/[ -]/g, '').trim().slice(0, max)
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

/**
 * @param {Array<{role:string,content:any}>} messages
 * @param {{mediaType?:string,data?:string}|null|undefined} image
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
  lastUser.content = [
    { type: 'text', text: text || 'What do you see in this photo?' },
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
  const ctx = context || {};
  const stock = Array.isArray(ctx.stock) ? ctx.stock : [];
  const grocery = Array.isArray(ctx.grocery) ? ctx.grocery : [];
  const recentMeals = Array.isArray(ctx.recentMeals) ? ctx.recentMeals : [];
  const settings = ctx.settings || {};
  const recipes = Array.isArray(ctx.recipes) ? ctx.recipes : [];

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
    `USER: ${settings.userName || 'Friend'}`,
    `DIET: ${settings.dietaryPreference && settings.dietaryPreference !== 'no-preference' ? settings.dietaryPreference : 'none'}`,
    settings.allergies && settings.allergies.length ? `ALLERGIES: ${settings.allergies.join(', ')}` : null,
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


  // When a photo is attached, tell House Bot it can see and how to behave.
  const attachedImage =
    image && typeof image.data === 'string' && image.data.length > 0 && image.data.length <= MAX_IMAGE_BYTES;
  const visionHint = attachedImage
    ? `\n\n--- A PHOTO IS ATTACHED ---\nThe user sent an image. Look at it and answer about what you actually see. Describe the food, estimate quantities and portions, judge doneness/ripeness/freshness, and suggest what they could cook with it. Be concrete and visual. If the image is unclear or you can't identify something, say so plainly rather than guessing.\n`
    : '';
  const sysMsg = `${HOUSEBOT_SYSTEM_PROMPT}\n\n--- LIVE CONTEXT (${today}) ---\n${contextBlock}${visionHint}`;

  // Cap history to last 10 turns to fit small-model context windows.
  const hist = Array.isArray(history) ? history.slice(-10) : [];
  const messages = [
    { role: 'system', content: sysMsg },
    ...hist.map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content || '') })),
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
    const stock = Array.isArray(ctx.stock) ? ctx.stock : [];
    const grocery = Array.isArray(ctx.grocery) ? ctx.grocery : [];
    const recentMeals = Array.isArray(ctx.recentMeals) ? ctx.recentMeals : [];
    const settings = ctx.settings || {};
    const recipes = Array.isArray(ctx.recipes) ? ctx.recipes : [];

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
    `USER: ${settings.userName || 'Friend'}`,
    `DIET: ${settings.dietaryPreference && settings.dietaryPreference !== 'no-preference' ? settings.dietaryPreference : 'none'}`,
    settings.allergies && settings.allergies.length ? `ALLERGIES: ${settings.allergies.join(', ')}` : null,
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


  // When a photo is attached, tell House Bot it can see and how to behave.
  const attachedImage =
    image && typeof image.data === 'string' && image.data.length > 0 && image.data.length <= MAX_IMAGE_BYTES;
  const visionHint = attachedImage
    ? `\n\n--- A PHOTO IS ATTACHED ---\nThe user sent an image. Look at it and answer about what you actually see. Describe the food, estimate quantities and portions, judge doneness/ripeness/freshness, and suggest what they could cook with it. Be concrete and visual. If the image is unclear or you can't identify something, say so plainly rather than guessing.\n`
    : '';
  const sysMsg = `${HOUSEBOT_SYSTEM_PROMPT}\n\n--- LIVE CONTEXT (${today}) ---\n${contextBlock}${visionHint}`;

  const hist = Array.isArray(history) ? history.slice(-10) : [];
  const messages = [
    { role: 'system', content: sysMsg },
    ...hist.map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content || '') })),
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
        const host = new URL(u).hostname.toLowerCase();
        if (SKIP_HOSTS.some((s) => host === s || host.endsWith('.' + s))) continue;
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
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    });
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
  } catch {
    return null;
  }
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

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── health ────────────────────────────────────────────────────────────

app.get('/healthz', (_req, res) => res.json({
  ok: true,
  dataDir: DATA_DIR,
  agent: OVERWATCH_AGENT,
  plantnet: {
    configured: Boolean(PLANTNET_API_KEY),
    project: PLANTNET_PROJECT,
  },
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
  if (!res.headersSent) {
    res.status(500).json({
      error: 'internal_error',
      detail: String(err?.message || err).slice(0, 200),
    });
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[overwatch] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[overwatch] uncaughtException:', err);
  // Don't exit — log and keep serving. Only exit on truly fatal issues.
});