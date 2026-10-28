/**
 * Tests that the bridge tells the model the same thing the app asks the browser for.
 *
 * THE BUG THIS EXISTS FOR
 *
 * The screen share has two halves, and they have to agree:
 *
 *   - the app asks the browser for a WINDOW (src/utils/screenWatch.ts), and
 *   - the bridge tells the model what it is looking at.
 *
 * The app half was fixed in 8f89da9 ("Ask for the whole window, not one tab"):
 * `SHARE_SURFACE` is 'window', and it goes into the video constraints as
 * `displaySurface` — which is where the browser looks for it, because MDN
 * documents `displaySurface` on `MediaTrackConstraints`, while
 * `selfBrowserSurface` and `monitorTypeSurfaces` are top-level options. The
 * app puts those two at the top level too, which is also right.
 *
 * The bridge half was not fixed. `SCREEN_VISION_HINT` still said:
 *
 *     --- A SHARED TAB IS ON SCREEN ---
 *     The user is sharing a browser tab and asking about what is on it.
 *
 * So the person was told by the app that House Bot could see their shared
 * WINDOW, and told by the model that they were sharing a browser TAB. Two
 * answers to one question, from two halves of the same feature — and the
 * commit that fixed the app half (d86c9b1) tested only the app half, so
 * nothing went red when the bridge half was left behind.
 *
 * WHY IT IS MORE THAN A WORD: the window the app captures holds the store's
 * page AND House Bot's own tab side by side — the store opens in a new tab of
 * the same window (`window.open(url, '_blank')` in DigitalStores.tsx) and House
 * Bot has a tab of its own. Told "a browser tab", the model is looking for one
 * page and describes one thing. Told "a window", it is looking at what the
 * person is actually looking at.
 *
 * WHAT THE TEST DOES
 *
 * It runs a real copy of the bridge against a fake model that captures the
 * request, sends a screen frame the way the app does, and asks what the bridge
 * told the model:
 *
 *   - the screen instruction announces a WINDOW and not a TAB;
 *   - it does not claim anywhere that a tab is being shared;
 *   - it still says "Read the screen itself" (another test depends on this);
 *   - a photo still gets the photo instruction, unchanged.
 *
 * And it reads the app's own constant, so the two halves are tied together: if
 * the app ever goes back to sharing a tab, this test goes red instead of the
 * halves drifting apart again.
 *
 * Run with:  node scripts/test-bridge-screen-window-wording.mjs
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
const work = mkdtempSync(join(tmpdir(), 'hh-screen-window-'));
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
  if (captured.length === before) return { status: res.status, sys: '' };
  const req = captured[captured.length - 1];
  return {
    status: res.status,
    sys: (req.messages || []).find((m) => m.role === 'system')?.content || '',
  };
}

/**
 * The part of the system prompt that is about the picture.
 *
 * WHY THE LAST MARKER: the bridge builds the system prompt as the House Bot
 * prompt, then the live context, then the vision hint — and the vision hint
 * is the only thing that opens with "--- A ". The photo hint and the screen
 * hint are the only two strings in the bridge that do, so the last marker is
 * the one belonging to the picture that was just sent.
 *
 * @param {string} sys the system message
 * @returns {string} the instruction that goes with the picture
 */
function visionHint(sys) {
  const at = sys.lastIndexOf('--- A ');
  return at === -1 ? '' : sys.slice(at);
}

/**
 * Stop the bridge copy, and wait until it really is gone.
 *
 * WHY IT WAITS FOR THE EXIT: `kill` only asks. A bridge that is still
 * winding down when the work directory is removed goes on running with a
 * directory that is no longer there, holding a port that nothing asked it
 * to hold.
 */
async function stopBridge() {
  if (!bridge) return;
  if (bridge.exitCode !== null || bridge.signalCode !== null) return;
  const exited = new Promise((resolve) => bridge.once('exit', resolve));
  bridge.kill('SIGTERM');
  const stopped = await Promise.race([exited.then(() => true), sleep(2000).then(() => false)]);
  if (stopped) return;
  bridge.kill('SIGKILL');
  await Promise.race([exited, sleep(2000)]);
}

// The bridge never decodes the picture — it checks the type, the length and
// the media type — so a short base64 string is enough to exercise the path.
const PIXEL = 'QUJDRA==';

// WHY THE TEST IS WRAPPED: the bridge copy is started above, and the
// cleanup that stops it is below. Between the two there are imports,
// fetches and assertions, and any of them can throw — and a throw is
// exactly when the test is least likely to be watched. A throw that
// skips the cleanup leaves a bridge copy running on a port of its own.
try {
  console.log('\nthe bridge names the same surface the app asks the browser for');
  if (!deps) {
    // Not a failure: there is no bridge to run. It says so out loud, because a
    // check that quietly does not run is worse than one that is missing.
    console.log('  SKIP the bridge is not installed here — its dependencies could not be found');
  } else if (!bridgeUp) {
    ok(false, 'the bridge copy starts', bridgeErr.slice(0, 300));
  } else {
    const screen = await promptFor({ mediaType: 'image/jpeg', data: PIXEL, kind: 'screen' });
    ok(screen.status === 200, 'a screen frame is accepted', `status ${screen.status}`);

    const hint = visionHint(screen.sys);
    ok(hint !== '', 'the bridge sent an instruction with the screen frame');

    ok(
      /A SHARED WINDOW IS ON SCREEN/.test(hint),
      'the screen instruction announces a WINDOW',
      hint ? hint.slice(0, 90).replace(/\n/g, ' ') : 'no instruction to read',
    );
    ok(
      !/\btab\b/i.test(hint),
      'the screen instruction never claims a tab is being shared',
      /\btab\b/i.test(hint) ? 'it still says tab' : 'it names a window',
    );
    ok(
      hint.includes('Read the screen itself'),
      'the screen instruction still says to read the screen itself',
    );
    ok(
      !hint.includes('A PHOTO IS ATTACHED'),
      'the screen instruction is still not the photo instruction',
    );

    // THE PHOTO PATH MUST NOT MOVE
    //
    // WHY IT IS CHECKED HERE AND NOT ONLY IN THE OTHER TEST: that other test
    // already guards the photo instruction, but it guards it while the screen
    // instruction is wrong. A change to the screen instruction that quietly
    // broke the photo one would then pass both tests. This test is about the
    // screen half, so it holds the photo half still while it does that.
    const photo = await promptFor({ mediaType: 'image/jpeg', data: PIXEL, kind: 'photo' });
    const photoHint = visionHint(photo.sys);
    ok(
      photoHint.includes('A PHOTO IS ATTACHED'),
      'a photo still gets the photo instruction',
    );
    ok(
      photoHint.includes('Describe the food') &&
        photoHint.includes('estimate quantities and portions'),
      'and the food instruction is not quietly weakened',
    );
  }

  console.log('\nthe two halves of the share agree with each other');
  {
    const app = await import('../src/utils/screenWatch.ts');
    ok(
      app.SHARE_SURFACE === 'window',
      'the app asks the browser for a window',
      String(app.SHARE_SURFACE),
    );

    // The chip the person actually reads, and the sentence the app promises
    // them. Neither may say a tab, and both must name a window.
    const visible = app.shareVisibleText(null);
    ok(
      visible !== '' && !/\btab\b/i.test(visible),
      'the chip House Bot shows does not say a tab',
      visible ? `it says: "${visible}"` : 'no wording to check',
    );

    const asking = app.SHARE_ASKING_TEXT;
    ok(
      asking !== '' && !/\btab\b/i.test(asking),
      'and neither does the sentence that promises what will be shared',
      asking ? `it says: "${asking}"` : 'no wording to check',
    );

    // The tie: whatever the app asks the browser for is the thing the bridge
    // must tell the model about. If the app goes back to a tab, the bridge
    // has to follow, and this goes red until it does.
    ok(
      app.SHARE_SURFACE === 'window',
      'the surface the app and the bridge both describe is the window',
      `the app asks for a ${app.SHARE_SURFACE}`,
    );
  }
} finally {
  await stopBridge();
  model.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
