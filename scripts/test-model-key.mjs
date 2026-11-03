/**
 * Tests that the model-key rule says the right thing — and never says the
 * key.
 *
 * WHY THIS IS TESTED
 *
 * The rule decides what the supervisor tells the owner about a mute app. It
 * runs on a machine with a paid provider key in an env file, so two things
 * have to be true at once: it must name the failure accurately, and it must
 * not leak the credential while doing it.
 *
 *   - "ok"       the provider accepted the key
 *   - "broken"   the provider rejected it
 *   - "unknown"  no key, no URL, or the provider did not answer
 *
 * "unknown" is deliberately distinct from "broken": a network hiccup is not a
 * rejected key, and telling the owner to go and replace a working key
 * because the wifi blinked would be worse than saying nothing.
 *
 * Run with:  node scripts/test-model-key.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

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

/** A provider that answers with whatever the test tells it to. */
function fakeProvider(status, body) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** The rule, asked about a given env file. */
function stateFor(envFile) {
  const script = `
    . "${repo}/scripts/lib/model-key.sh"
    model_key_state "${envFile}"
  `;
  const r = spawn('bash', ['-c', script], { encoding: 'utf8' });
  let out = '';
  r.stdout.on('data', (d) => { out += d; });
  return new Promise((resolve) => {
    r.on('close', () => resolve(out.trim()));
  });
}

const dir = mkdtempSync(join(tmpdir(), 'hh-model-key-'));
const TOKEN = 'test-secret-token-value-do-not-print';

try {
  console.log('\nthe provider rejects the key');
  {
    const server = await fakeProvider(
      401,
      JSON.stringify({ code: 401, message: 'auth failed' }),
    );
    const port = server.address().port;
    const envFile = join(dir, 'rejected.env');
    writeFileSync(
      envFile,
      `MINIMAX_API_URL=http://127.0.0.1:${port}/v1/messages\nMINIMAX_ACCESS_TOKEN=${TOKEN}\n`,
    );
    const state = await stateFor(envFile);
    ok(state === 'broken', 'a rejected key reads as broken', state);
    ok(!state.includes(TOKEN), 'and the key is not in the answer');
    server.close();
  }

  console.log('\nthe provider accepts the key');
  {
    const server = await fakeProvider(
      200,
      JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }),
    );
    const port = server.address().port;
    const envFile = join(dir, 'accepted.env');
    writeFileSync(
      envFile,
      `MINIMAX_API_URL=http://127.0.0.1:${port}/v1/messages\nMINIMAX_ACCESS_TOKEN=${TOKEN}\n`,
    );
    const state = await stateFor(envFile);
    ok(state === 'ok', 'an accepted key reads as ok', state);
    ok(!state.includes(TOKEN), 'and the key is not in the answer');
    server.close();
  }

  console.log('\nthe older "login fail" shape is recognised too');
  {
    const server = await fakeProvider(
      200,
      JSON.stringify({
        base_resp: { status_code: 1004, status_msg: 'login fail: carry the API secret key' },
      }),
    );
    const port = server.address().port;
    const envFile = join(dir, 'loginfail.env');
    writeFileSync(
      envFile,
      `MINIMAX_API_URL=http://127.0.0.1:${port}/v1/text/chatcompletion_v2\nMINIMAX_ACCESS_TOKEN=${TOKEN}\n`,
    );
    const state = await stateFor(envFile);
    ok(state === 'broken', 'a login fail reads as broken', state);
    server.close();
  }

  console.log('\nwhat it cannot tell, it says so');
  {
    const missing = join(dir, 'does-not-exist.env');
    ok((await stateFor(missing)) === 'unknown', 'a missing env file is unknown');

    const noToken = join(dir, 'no-token.env');
    writeFileSync(noToken, 'MINIMAX_API_URL=http://127.0.0.1:1/v1/messages\n');
    ok((await stateFor(noToken)) === 'unknown', 'no key at all is unknown');

    const noUrl = join(dir, 'no-url.env');
    writeFileSync(noUrl, `MINIMAX_ACCESS_TOKEN=${TOKEN}\n`);
    ok((await stateFor(noUrl)) === 'unknown', 'no URL is unknown');

    // A provider that is not there at all: a network failure is not a
    // rejected key, and saying "replace your key" for a wifi blink would be
    // the wrong instruction.
    const deadUrl = join(dir, 'dead-url.env');
    writeFileSync(
      deadUrl,
      'MINIMAX_API_URL=http://127.0.0.1:1/v1/messages\nMINIMAX_ACCESS_TOKEN=x\n',
    );
    ok((await stateFor(deadUrl)) === 'unknown', 'an unreachable provider is unknown');
  }

  console.log('\nthe key never appears in any answer');
  {
    const server = await fakeProvider(
      401,
      JSON.stringify({ code: 401, message: 'auth failed', echo: TOKEN }),
    );
    const port = server.address().port;
    const envFile = join(dir, 'leaky.env');
    writeFileSync(
      envFile,
      `MINIMAX_API_URL=http://127.0.0.1:${port}/v1/messages\nMINIMAX_ACCESS_TOKEN=${TOKEN}\n`,
    );
    const state = await stateFor(envFile);
    ok(!state.includes(TOKEN), 'not even when the provider echoes it back', state);
    server.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
