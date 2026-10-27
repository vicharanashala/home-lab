/**
 * Tests that a shared screen and an attached photo are told apart.
 *
 * THE BUG THIS EXISTS FOR
 *
 * House Bot can be shown two different pictures:
 *
 *   - a photo the person took of their kitchen, and
 *   - a frame of the store tab they are shopping in, captured by the screen
 *     share and sent over from the Digital stores page.
 *
 * They went into the bridge through the SAME field, with nothing to tell them
 * apart, so the bridge gave both of them the same instruction:
 *
 *   --- A PHOTO IS ATTACHED ---
 *   The user sent an image. ... Describe the food, estimate quantities and
 *   portions, judge doneness/ripeness/freshness, and suggest what they could
 *   cook with it.
 *
 * So a screenshot of an Amazon Fresh product page — a name, a price, a
 * quantity — was handed to the model as a photograph of food to be assessed
 * for ripeness. The whole point of the screen share is that the person can
 * ask "what is this?" and "how much is it?" about the page in front of them,
 * and the instruction on the screen told the model to answer a different
 * question entirely.
 *
 * The instruction is not a stray sentence: it is the bridge deciding what the
 * picture IS. One picture was read as food and the other was read as a
 * screen, and the bridge had no way to know which was which.
 *
 * WHAT THE TEST DOES
 *
 * It runs a real copy of the bridge against a fake model that captures the
 * request, and asks what the bridge told the model:
 *
 *   - a picture marked as a screen is NOT told to be described as food;
 *   - a picture marked as a photo still is (the old behaviour, unchanged);
 *   - a picture with no mark at all — an older bundle already in a browser's
 *     cache — still gets the old behaviour rather than a new one;
 *   - the picture itself still reaches the model, marked or not.
 *
 * And it checks the client's side without a browser: the photo wins over the
 * screen, and the screen is marked as a screen.
 *
 * Run with:  node scripts/test-housebot-screen-image.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const bridgeDir = join(repo, 'bridge', 'shift ');

let passed = 0;
let failed = 0;

function ok(cond, label, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A port nothing is listening on. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// ── the fake model ───────────────────────────────────────────────────────
//
// It answers in the Anthropic SSE shape the bridge reads, and it keeps every
// request body so the test can ask what the bridge actually sent.
const captured = [];
const model = createHttpServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try {
      captured.push(JSON.parse(body));
    } catch {
      captured.push({ parseError: body.slice(0, 200) });
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"stub"}}\n\n');
    res.write('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n');
    res.end();
  });
});

const modelPort = await freePort();
await new Promise((r) => model.listen(modelPort, '127.0.0.1', r));

/**
 * Where the bridge's own dependencies are installed.
 *
 * WHY THIS IS NOT JUST THE BRIDGE'S OWN FOLDER: the quality gate exports the
 * staged index to a temporary directory, and an export holds tracked files
 * only — the bridge's node_modules is not among them, so a copy of the
 * bridge started there cannot import express and the check silently stops
 * being a check.
 *
 * WHY FOLLOWING THE REPOSITORY'S node_modules WORKS: the gate symlinks the
 * repository's node_modules into the export. Following that symlink leads
 * back to the real checkout, and the bridge's dependencies are installed
 * there. In the real repository the same rule lands on the same place.
 */
function bridgeDependencies() {
  const candidates = [join(bridgeDir, 'node_modules')];
  try {
    candidates.push(
      join(dirname(realpathSync(join(repo, 'node_modules'))), 'bridge', 'shift ', 'node_modules'),
    );
  } catch {
    /* no repository node_modules beside this copy */
  }
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'express'))) return candidate;
  }
  return null;
}

// ── a copy of the bridge, on a spare port ────────────────────────────────
//
// A COPY, not the real one: the test must not talk to the bridge serving the
// owner's link, and must not write to the real data directory. HOME points
// at a temporary directory so everything the bridge keeps lands there.
const work = mkdtempSync(join(tmpdir(), 'hh-screen-image-'));
const home = join(work, 'home');
mkdirSync(home, { recursive: true });
copyFileSync(join(bridgeDir, 'index.mjs'), join(work, 'index.mjs'));
copyFileSync(join(bridgeDir, 'openclaw-cli.mjs'), join(work, 'openclaw-cli.mjs'));
const deps = bridgeDependencies();
if (deps) symlinkSync(deps, join(work, 'node_modules'));

const bridgePort = await freePort();
const bridge = deps
  ? spawn(process.execPath, ['index.mjs'], {
      cwd: work,
      env: {
        ...process.env,
        HOME: home,
        PORT: String(bridgePort),
        BRIDGE_TOKEN: '',
        MINIMAX_CHAT_URL: `http://127.0.0.1:${modelPort}/v1/messages`,
        MINIMAX_API_URL: `http://127.0.0.1:${modelPort}/v1/messages`,
        MINIMAX_ACCESS_TOKEN: 'stub-token',
        // The bridge looks up recipes on the web for some questions. The test
        // asks about a picture, and must not wait on a search engine for it.
        BRAVE_API_KEY: '',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  : null;
let bridgeErr = '';
bridge?.stderr.on('data', (d) => { bridgeErr += d.toString(); });

let bridgeUp = false;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${bridgePort}/healthz`);
    if (r.ok) { bridgeUp = true; break; }
  } catch { /* not up yet */ }
  await sleep(100);
}

/**
 * Send a picture to House Bot the way the app does, and get back the system
 * prompt the bridge built for it.
 */
async function promptFor(image, message = 'the price please') {
  const before = captured.length;
  const res = await fetch(`http://127.0.0.1:${bridgePort}/api/housebot/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, history: [], context: {}, image }),
  });
  await res.text();
  if (captured.length === before) return { status: res.status, sys: '', user: null, model: null };
  const req = captured[captured.length - 1];
  return {
    status: res.status,
    sys: (req.messages || []).find((m) => m.role === 'system')?.content || '',
    user: (req.messages || []).find((m) => m.role === 'user')?.content,
    model: req,
  };
}

// The bridge never decodes the picture — it checks the type, the length and
// the media type — so a short base64 string is enough to exercise the path.
const PIXEL = 'QUJDRA==';

/**
 * Stop the bridge copy, and wait until it really is gone.
 *
 * WHY IT WAITS FOR THE EXIT: `kill` only asks. A bridge that is still
 * winding down when the work directory is removed goes on running with a
 * directory that is no longer there, holding a port that nothing asked it
 * to hold.
 *
 * WHY SIGKILL IS THE BACKSTOP: a child that ignores SIGTERM would live for
 * ever, and a leaked bridge is a server with no owner — one that answers on
 * a port of its own, on an address the tailnet can reach, with the shared
 * secret switched off.
 */
async function stopBridge() {
  if (!bridge) return;
  // Already gone: a child that exited has a code, and one killed by a signal
  // has a signal.
  if (bridge.exitCode !== null || bridge.signalCode !== null) return;
  const exited = new Promise((resolve) => bridge.once('exit', resolve));
  bridge.kill('SIGTERM');
  const stopped = await Promise.race([exited.then(() => true), sleep(2000).then(() => false)]);
  if (stopped) return;
  bridge.kill('SIGKILL');
  await Promise.race([exited, sleep(2000)]);
}

// WHY THE TEST IS WRAPPED: the bridge copy is started above, and the
// cleanup that stops it is below. Between the two there are imports,
// fetches and assertions, and any of them can throw — and a throw is
// exactly when the test is least likely to be watched. A throw that
// skips the cleanup leaves a bridge copy running on a port of its own.
//
// WHY THE ERROR IS NOT CAUGHT: it has to reach the person who ran the
// test. The finally block cleans up and the error carries on out, so a
// broken test is still a broken test — it just no longer leaves a server
// behind.
try {
  console.log('\nthe bridge tells a shared screen apart from a photo');
  if (!deps) {
    // Not a failure: there is no bridge to run. It says so out loud, because a
    // check that quietly does not run is worse than one that is missing.
    console.log('  SKIP the bridge is not installed here — its dependencies could not be found');
  } else if (!bridgeUp) {
    ok(false, 'the bridge copy starts', bridgeErr.slice(0, 300));
  } else {
    const screen = await promptFor({ mediaType: 'image/jpeg', data: PIXEL, kind: 'screen' });
    ok(screen.status === 200, 'a screen frame is accepted', `status ${screen.status}`);
    ok(
      !screen.sys.includes('A PHOTO IS ATTACHED'),
      'a screen frame is not announced as a photo',
      screen.sys.includes('A PHOTO IS ATTACHED') ? 'the photo announcement is still there' : '',
    );
    ok(
      !screen.sys.includes('Describe the food') &&
        !screen.sys.includes('estimate quantities and portions'),
      'a screen frame is not sent to be read as a photograph of food',
      screen.sys.includes('Describe the food') ? 'the food instruction is still there' : '',
    );
    ok(
      screen.sys.includes('Read the screen itself'),
      'a screen frame is told to be read as a screen',
    );
    ok(
      /screen/i.test(screen.sys),
      'a screen frame is announced as a screen',
      screen.sys.slice(-260).replace(/\n/g, ' '),
    );

    const photo = await promptFor({ mediaType: 'image/jpeg', data: PIXEL, kind: 'photo' });
    ok(
      photo.sys.includes('A PHOTO IS ATTACHED'),
      'a photo still gets the old food instruction',
    );
    ok(
      photo.sys.includes('Describe the food') &&
        photo.sys.includes('estimate quantities and portions'),
      'and the food instruction is not quietly weakened',
    );

    const unmarked = await promptFor({ mediaType: 'image/jpeg', data: PIXEL });
    ok(
      unmarked.sys.includes('A PHOTO IS ATTACHED'),
      'a picture with no mark still gets the old behaviour',
      'an older bundle in a browser cache sends no mark',
    );

    // The picture must still reach the model — marked, unmarked, either way.
    const marked = screen.user;
    ok(
      Array.isArray(marked) &&
        marked.some((b) => b.type === 'image' && b.source?.data === PIXEL),
      'the picture itself still reaches the model',
    );
    ok(
      Array.isArray(marked) &&
        marked.some((b) => b.type === 'text' && !/photo/i.test(String(b.text || ''))),
      'and the model is not asked about a photo when the picture is a screen',
      Array.isArray(marked) ? String(marked[0]?.text || '') : 'no user content',
    );

    // A PICTURE SENT AS A DATA URL
    //
    // WHY THIS CASE IS ITS OWN: the bridge strips a `data:` prefix before it
    // measures a picture, because the prefix is metadata about the picture
    // and not part of it. The two places that measure the picture had to
    // strip it the same way.
    //
    // They did not. One measured the raw string and the other measured the
    // payload, so a picture sent with a prefix could reach the model with NO
    // INSTRUCTION AT ALL: the guard for the instruction gave up (the raw
    // string was over the limit) while the guard for the picture let it
    // through (the payload was not). A shared screen with no instruction is
    // the exact defect this file exists for — a price list read as a
    // photograph of food.
    const DATA_URL_PREFIX = 'data:image/jpeg;base64,';
    const atTheLimit = 'A'.repeat(3 * 1024 * 1024);
    const asDataUrl = await promptFor({
      mediaType: 'image/jpeg',
      data: DATA_URL_PREFIX + atTheLimit,
      kind: 'screen',
    });
    ok(
      asDataUrl.sys.includes('Read the screen itself'),
      'a screen frame sent as a data url is still told to be read as a screen',
      asDataUrl.sys.slice(-260).replace(/\n/g, ' '),
    );
    ok(
      !asDataUrl.sys.includes('A PHOTO IS ATTACHED'),
      'and is not announced as a photo',
      asDataUrl.sys.includes('A PHOTO IS ATTACHED') ? 'the photo announcement is there' : '',
    );
    ok(
      Array.isArray(asDataUrl.user) &&
        asDataUrl.user.some((b) => b.type === 'image' && b.source?.data === atTheLimit),
      'and the picture itself still reaches the model',
      Array.isArray(asDataUrl.user) ? 'the user message is not a picture' : 'no user content',
    );
  }

  console.log('\nthe app marks the picture it is sending');
  {
    const mod = await import('../src/utils/screenWatch.ts');
    const frame = { mediaType: 'image/jpeg', data: PIXEL };
    const photo = { mediaType: 'image/jpeg', data: PIXEL };

    // The rule lives in the protocol module, so it can be asked without a
    // browser. If the rule is not there at all, that is a failure to report —
    // not a crash to hide behind.
    if (typeof mod.imagePayloadFor !== 'function') {
      ok(false, 'the app has a rule for marking the picture it sends');
    } else {
      ok(
        mod.imagePayloadFor(null, frame)?.kind === mod.IMAGE_KIND_SCREEN,
        'a shared screen is marked as a screen',
        String(mod.imagePayloadFor(null, frame)?.kind),
      );
      ok(
        mod.imagePayloadFor(photo, null)?.kind === mod.IMAGE_KIND_PHOTO,
        'an attached photo is marked as a photo',
        String(mod.imagePayloadFor(photo, null)?.kind),
      );
      ok(
        mod.imagePayloadFor(photo, frame)?.kind === mod.IMAGE_KIND_PHOTO,
        'the attached photo wins over the screen',
      );
      ok(
        mod.imagePayloadFor(null, null) === null,
        'nothing attached means nothing sent',
      );
      ok(
        mod.imagePayloadFor(null, frame)?.data === PIXEL &&
          mod.imagePayloadFor(photo, null)?.data === PIXEL,
        'the picture itself is carried through',
      );
    }
  }
} finally {
  await stopBridge();
  model.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
