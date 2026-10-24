/**
 * The overwatch CLI has to be found where it was installed.
 *
 * WHY THIS EXISTS
 * The bridge spawns the openclaw CLI by name and lets the PATH find it. But
 * the bridge is started by the supervisor, and launchd hands an agent a
 * minimal PATH — the supervisor extends it with node's own directory so the
 * bridge can start at all, and leaves ~/.openclaw/bin off it.
 *
 * So on a machine where openclaw WAS installed and working, every overwatch
 * call failed with ENOENT: the agent was never reached and the feature was
 * dead. The bridge reported that honestly rather than pretending otherwise,
 * but "the agent is unreachable" is not the same as "the agent answered".
 *
 * The PATH the bridge really inherits is read out of watchdog.sh rather than
 * written down here, so this test keeps checking the real thing if the
 * supervisor's PATH is ever changed.
 *
 * Run with:  node scripts/test-overwatch-cli.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveOpenclaw, openclawInstallDir, OPENCLAW_BIN } from '../bridge/shift /openclaw-cli.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

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

/** The PATH the supervisor hands the bridge. */
function supervisorPath() {
  const watchdog = readFileSync(join(root, 'watchdog.sh'), 'utf8');
  const m = watchdog.match(/^export PATH="([^"]+)"/m);
  if (!m) throw new Error('watchdog.sh does not export a PATH');
  return m[1];
}

/** Run a command and report how it ended. */
function run(cmd, args, env) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { env });
    let error = null;
    proc.on('error', (e) => { error = e; });
    proc.on('close', (code) => resolve({ code, error }));
  });
}

console.log('\nthe CLI in the install directory is used, whatever the PATH says');
{
  // The install directory is on nobody's PATH in the launch environment, so
  // the bare name would never have found it.
  const cmd = await resolveOpenclaw({
    homedir: '/home/somebody',
    exists: async (file) => file === '/home/somebody/.openclaw/bin/openclaw',
  });
  ok(
    cmd === '/home/somebody/.openclaw/bin/openclaw',
    'the installed CLI is named by its absolute path',
    cmd,
  );
}

console.log('\na CLI that is not in the install directory is left to the PATH');
{
  const cmd = await resolveOpenclaw({
    homedir: '/home/somebody',
    exists: async () => false,
  });
  ok(cmd === OPENCLAW_BIN, 'the bare name is used, so the PATH still finds it', cmd);
}

console.log('\nthe install directory is the one the bridge already knows');
{
  const dir = openclawInstallDir('/home/somebody');
  ok(
    dir === '/home/somebody/.openclaw/bin',
    'the CLI sits beside the overwatch agent\'s own workspace',
    dir,
  );
}

console.log('\nwith the PATH the supervisor really gives the bridge');
{
  const path = supervisorPath();
  console.log(`       (supervisor PATH: ${path})`);

  // The bare name, which is what the bridge used to spawn.
  const bare = await run(OPENCLAW_BIN, ['--version'], { PATH: path });
  const bareFails = bare.error?.code === 'ENOENT';

  // The command the bridge now runs.
  const cmd = await resolveOpenclaw();
  const resolved = await run(cmd, ['--version'], { PATH: path });

  if (bareFails) {
    console.log(`       (the bare name cannot be found on that PATH: ${bare.error.code})`);
    ok(
      resolved.error?.code !== 'ENOENT',
      'the CLI the bridge resolves CAN be started on that PATH',
      cmd,
    );
  } else {
    console.log('       (the bare name is already on that PATH — nothing to fix)');
    ok(resolved.error?.code !== 'ENOENT', 'the CLI starts on that PATH', cmd);
  }
}

console.log('\nthe bridge runs the CLI it resolved, not a bare name');
{
  // The bridge cannot be imported — it starts a server the moment it is
  // loaded — so it cannot be run from here. What CAN be checked is that it
  // does not go back to spawning the CLI by a name the PATH may not have,
  // which is the mistake this whole thing is about.
  const bridge = readFileSync(join(root, 'bridge', 'shift ', 'index.mjs'), 'utf8');
  ok(
    !/spawn\(\s*['"`]openclaw['"`]/.test(bridge),
    'the bridge never spawns the CLI by a bare name',
  );
  ok(
    /resolveOpenclaw/.test(bridge),
    'the bridge resolves the CLI before spawning it',
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
