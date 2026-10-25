/**
 * Tests for the check that asks the RUNNING app what it is running.
 *
 * THE BUG THIS EXISTS FOR
 * On 2026-10-24 the bridge serving the owner's link was running code from
 * 14:34 while the code on disk was from 19:18. The overwatch CLI fix was
 * committed at 19:21, every test passed, and the live app still answered
 * every overwatch call with "[spawn error] spawn openclaw ENOENT" — the very
 * error the commit had fixed.
 *
 * WHY IT WAS INVISIBLE: every check in this repo looks at the COMMIT. The
 * quality gate exports the staged index and asks whether the commit
 * type-checks, passes its tests and holds no secrets. The test suite asks
 * whether a rule does what it says. Nothing asked the running app anything,
 * so a green repository and a stale live app looked exactly the same.
 *
 * WHAT IS TESTED HERE
 * The rules themselves — the bridge's state, the supervisor's state, the
 * link, and the verdict that turns them into one word — and the check script
 * end to end against a fake bridge on a spare port, so that "the live app is
 * on the current code" and "the live app is on old code" are different
 * answers that this test can show both ways.
 *
 * Run with:  node scripts/test-live-state.mjs
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, 'lib', 'live-state.sh');
const checker = join(here, 'check-live.sh');
const watchdog = join(here, '..', 'watchdog.sh');

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

function check(name, cond, detail = '') {
  ok(cond, name, detail);
}

/**
 * Run a snippet with the rule library sourced.
 *
 * The rule is bash, so it runs through bash — the same way the check script
 * runs it.
 */
function sh(script, env = {}) {
  return execFileSync('bash', ['-c', `source "${lib}"; ${script}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim();
}

/** Ask the rule what state the supervisor is in. */
function supervisorState(script, publishedFile) {
  try {
    return sh(`live_supervisor_state "${script}" "${publishedFile}"`);
  } catch (err) {
    return `error: ${err.message}`;
  }
}

/** Ask the rule what state the bridge is in. */
function bridgeState(port, dir) {
  try {
    return sh(`live_bridge_state ${port} "${dir}"`);
  } catch (err) {
    return `error: ${err.message}`;
  }
}

/**
 * Ask the rule what state the BUNDLE the owner is served is in.
 *
 * @param root the checkout the bundle belongs to
 */
function bundleState(root) {
  try {
    return sh(`live_bundle_state "${root}"`);
  } catch (err) {
    return `error: ${err.message}`;
  }
}

/**
 * The checksum of the code the supervisor runs, the way the rule computes it.
 *
 * WHY IT IS NOT A PLAIN CHECKSUM OF ONE FILE: the rule watches the script
 * AND the rule libraries it loads, and the check compares the published
 * number with the number for the whole set. A plain checksum of the script
 * alone would never match what the supervisor publishes.
 *
 * @param path the supervisor script on disk
 */
function checksumOf(path) {
  return sh(`supervisor_watched_sum "${path}"`);
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The fake bridge: serves the version baked into its source. */
function bridgeSource(port, version) {
  return `import http from 'node:http';
const PORT = ${port};
const VERSION = ${JSON.stringify(version)};
http.createServer((_req, res) => { res.end(VERSION); }).listen(PORT, '127.0.0.1');
`;
}

/* -------------------------------------------------------------------------- */

console.log('\nthe supervisor: is the copy that is running the copy on disk?');
const work = mkdtempSync(join(tmpdir(), 'hh-live-'));
const supervisorScript = join(work, 'watchdog.sh');
const publishedFile = join(work, 'published.checksum');
writeFileSync(supervisorScript, '#!/bin/bash\necho supervisor\n');

// The published state carries the checksum AND the pid of the supervisor that
// wrote it, because a checksum alone cannot say whether the supervisor that
// wrote it is still the one running.
writeFileSync(publishedFile, `${checksumOf(supervisorScript)} ${process.pid}\n`);
check(
  'a supervisor running the copy on disk is current',
  supervisorState(supervisorScript, publishedFile) === 'current',
  `state=${supervisorState(supervisorScript, publishedFile)}`,
);

writeFileSync(publishedFile, '999999999\n');
check(
  'a supervisor running a different copy is stale',
  supervisorState(supervisorScript, publishedFile) === 'stale',
  `state=${supervisorState(supervisorScript, publishedFile)}`,
);

rmSync(publishedFile, { force: true });
check(
  'a supervisor that never published a checksum is unpublished',
  supervisorState(supervisorScript, publishedFile) === 'unpublished',
  `state=${supervisorState(supervisorScript, publishedFile)}`,
);

writeFileSync(publishedFile, 'not-a-checksum\n');
check(
  'a checksum that cannot be read is unknown, never current',
  supervisorState(supervisorScript, publishedFile) === 'unknown',
  `state=${supervisorState(supervisorScript, publishedFile)}`,
);

writeFileSync(publishedFile, `${checksumOf(supervisorScript)}\n`);
check(
  'a state with no publisher in it is unknown, never current',
  supervisorState(supervisorScript, publishedFile) === 'unknown',
  `state=${supervisorState(supervisorScript, publishedFile)}`,
);

check(
  'a script that cannot be read is unknown, never current',
  supervisorState(join(work, 'missing.sh'), publishedFile) === 'unknown',
  `state=${supervisorState(join(work, 'missing.sh'), publishedFile)}`,
);

// The publisher is gone. The state still says the copy on disk — but the
// supervisor that wrote it has died, and the one running now may be an older
// copy that cannot notice an edit to watchdog.sh at all.
const deadPublisher = spawnSync('bash', ['-c', 'exit 0']);
writeFileSync(publishedFile, `${checksumOf(supervisorScript)} ${deadPublisher.pid}\n`);
check(
  'a state whose publisher is gone is orphaned, never current',
  supervisorState(supervisorScript, publishedFile) === 'orphaned',
  `state=${supervisorState(supervisorScript, publishedFile)}`,
);

console.log('\nthe bridge: is it up, and is it on the code on disk?');
const bridgeDir = join(work, 'bridge');
mkdirSync(bridgeDir, { recursive: true });
const port = await freePort();
const deadPort = await freePort();
let started = null;

try {
  writeFileSync(join(bridgeDir, 'index.mjs'), bridgeSource(port, 'v1'));
  started = spawn(process.execPath, ['index.mjs'], { cwd: bridgeDir, stdio: 'ignore' });

  // Wait for the fake bridge to answer before asking anything about it.
  let up = false;
  for (let i = 0; i < 30; i += 1) {
    await sleep(200);
    try {
      const out = execFileSync('bash', ['-c', `curl -s --max-time 2 http://127.0.0.1:${port}/ || true`], {
        encoding: 'utf8',
      });
      if (out.trim()) {
        up = true;
        break;
      }
    } catch {
      /* not up yet */
    }
  }
  check('the fake bridge answers', up);

  check(
    'a bridge running the code on disk is current',
    bridgeState(port, bridgeDir) === 'current',
    `state=${bridgeState(port, bridgeDir)}`,
  );

  check(
    'a bridge that is not running is down, never current',
    bridgeState(deadPort, bridgeDir) === 'down',
    `state=${bridgeState(deadPort, bridgeDir)}`,
  );

  // The bridge is up and answering, but the code on disk cannot be read.
  //
  // WHY IT MATTERS: "the code on disk is not newer than the bridge" needs
  // two numbers to say — the time of the code on disk and the time the
  // bridge started. With one of them missing there is nothing to compare,
  // and the answer has to be "unknown". Answering "current" instead is a
  // false all-clear: the app could be running code from hours ago and the
  // report would still say healthy.
  check(
    'a bridge whose code on disk cannot be read is unknown, never current',
    bridgeState(port, join(work, 'missing-bridge-dir')) === 'unknown',
    `state=${bridgeState(port, join(work, 'missing-bridge-dir'))}`,
  );

  console.log('\nthe bundle: is the app the owner is served built from the code on disk?');
  //
  // WHY THE BUNDLE IS ASKED ABOUT AT ALL
  //
  // The bridge is the app's API. The BUNDLE is the app the owner actually
  // looks at — the pages, the scripts, the whole interface — and it is
  // served from dist/ as static files. Nothing rebuilds it: the supervisor
  // restarts the bridge when bridge/*.mjs changes, and starts tailscale and
  // the voice daemon, but it never runs a build. So the bundle stays exactly
  // as it was left until an agent runs `npm run build`.
  //
  // That is the 2026-10-24 incident again, on the other half of the app. The
  // bridge ran code from 14:34 while the code on disk was from 19:18, and
  // every check stayed green. The same is true of the bundle, and nothing
  // asked it: a committed change to src/ that never reached a build left the
  // owner's link serving the old interface, and `npm run check:live` said
  // "healthy" — a false all-clear about half the app.
  const bundleRoot = join(work, 'bundle');
  mkdirSync(join(bundleRoot, 'src'), { recursive: true });
  mkdirSync(join(bundleRoot, 'public'), { recursive: true });
  mkdirSync(join(bundleRoot, 'dist'), { recursive: true });
  const bundleSource = join(bundleRoot, 'src', 'App.tsx');
  const bundlePublic = join(bundleRoot, 'public', 'icon.svg');
  const bundleHtml = join(bundleRoot, 'index.html');
  const bundleConfig = join(bundleRoot, 'vite.config.ts');
  const bundlePackage = join(bundleRoot, 'package.json');
  const bundleEnv = join(bundleRoot, '.env.production');
  const bundleBuild = join(bundleRoot, 'dist', 'index.html');
  writeFileSync(bundleSource, 'export const App = 1;\n');
  writeFileSync(bundlePublic, '<svg/>\n');
  writeFileSync(bundleHtml, '<div id="root"></div>\n');
  writeFileSync(bundleConfig, 'export default {};\n');
  writeFileSync(bundlePackage, '{ "dependencies": {} }\n');
  writeFileSync(bundleEnv, 'VITE_BRIDGE_TOKEN=not-a-real-token\n');
  writeFileSync(bundleBuild, '<div id="root"></div>\n');

  // The times are set by hand rather than waited for, so the test says which
  // side is newer instead of hoping the clock agrees.
  //
  // THREE TIMES, NOT TWO: the rule asks "is the source NEWER than the
  // build", and two times cannot say both "older" and "newer" — a tie is
  // "not newer", so a change made at the same second as the build would read
  // as current. So the build sits in the middle: the source can be put on
  // either side of it.
  const OLD = new Date('2026-01-01T00:00:00Z');
  const MID = new Date('2026-06-01T00:00:00Z');
  const NEW = new Date('2026-12-01T00:00:00Z');
  for (const f of [
    bundleSource,
    bundlePublic,
    bundleHtml,
    bundleConfig,
    bundlePackage,
    bundleEnv,
  ]) {
    utimesSync(f, OLD, OLD);
  }
  utimesSync(bundleBuild, MID, MID);

  check(
    'a bundle built after the source is current',
    bundleState(bundleRoot) === 'current',
    `state=${bundleState(bundleRoot)}`,
  );

  // A change to src/ that never reached a build. The owner's link keeps
  // serving the old interface, and nothing else in the repo can see it.
  utimesSync(bundleSource, NEW, NEW);
  check(
    'a bundle older than the source is stale',
    bundleState(bundleRoot) === 'stale',
    `state=${bundleState(bundleRoot)}`,
  );

  // The same for a file that is not TypeScript: the icon, the manifest and
  // the stylesheet all go into the bundle too.
  utimesSync(bundleSource, OLD, OLD);
  utimesSync(bundlePublic, NEW, NEW);
  check(
    'a bundle older than the public files is stale',
    bundleState(bundleRoot) === 'stale',
    `state=${bundleState(bundleRoot)}`,
  );
  utimesSync(bundlePublic, OLD, OLD);

  // And for the build configuration: a changed tailwind config rebuilds
  // different CSS, so it is an input to the bundle like any other.
  utimesSync(bundleConfig, NEW, NEW);
  check(
    'a bundle older than the build config is stale',
    bundleState(bundleRoot) === 'stale',
    `state=${bundleState(bundleRoot)}`,
  );
  utimesSync(bundleConfig, OLD, OLD);

  // And for the dependencies: a dependency version IS in the JavaScript, so
  // `npm install` that bumps a library produces a different bundle from the
  // same source. Nothing under src/ changed, so a rule that watched only the
  // source said "current" while the owner was served the old bundle.
  utimesSync(bundlePackage, NEW, NEW);
  check(
    'a bundle older than the dependencies is stale',
    bundleState(bundleRoot) === 'stale',
    `state=${bundleState(bundleRoot)}`,
  );
  utimesSync(bundlePackage, OLD, OLD);

  // And for the env file: vite INLINES the VITE_* values into the bundle, so
  // a rotated token is a bundle that has to be rebuilt. A bundle that was not
  // rebuilt leaves every API call from the owner's phone answering 401 while
  // the check says healthy — broken for the owner and green for the check.
  utimesSync(bundleEnv, NEW, NEW);
  check(
    'a bundle older than the env file is stale',
    bundleState(bundleRoot) === 'stale',
    `state=${bundleState(bundleRoot)}`,
  );
  utimesSync(bundleEnv, OLD, OLD);

  // No build at all. The link serves nothing, which is not "current".
  rmSync(bundleBuild, { force: true });
  check(
    'a bundle that was never built is missing, never current',
    bundleState(bundleRoot) === 'missing',
    `state=${bundleState(bundleRoot)}`,
  );

  // A checkout with no source in it. The comparison cannot be made, so the
  // answer is "unknown" — never "current".
  const emptyRoot = join(work, 'empty-bundle');
  mkdirSync(join(emptyRoot, 'dist'), { recursive: true });
  writeFileSync(join(emptyRoot, 'dist', 'index.html'), '<div id="root"></div>\n');
  check(
    'a bundle whose source cannot be read is unknown, never current',
    bundleState(emptyRoot) === 'unknown',
    `state=${bundleState(emptyRoot)}`,
  );

  console.log('\nthe verdict: nothing unknown is ever healthy');
  // WHY EVERY CALL STATES ALL FOUR: the verdict is a classifier that fails
  // closed, so a dimension left out is a dimension that reads as "not
  // healthy". A helper that filled in the fourth for the caller would let a
  // new case pass without the bundle ever being asked about.
  const verdict = (b, s, l, u) => sh(`live_verdict ${b} ${s} ${l} ${u}`);
  check('everything current is healthy', verdict('current', 'current', 'reachable', 'current') === 'healthy');
  check(
    'a stale bridge is not healthy',
    verdict('stale', 'current', 'reachable', 'current').startsWith('unhealthy'),
  );
  check(
    'a down bridge is not healthy',
    verdict('down', 'current', 'reachable', 'current').startsWith('unhealthy'),
  );
  check(
    'a bridge whose state cannot be read is not healthy',
    verdict('unknown', 'current', 'reachable', 'current').startsWith('unhealthy'),
  );
  check(
    'a supervisor that cannot notice changes is not healthy',
    verdict('current', 'unpublished', 'reachable', 'current').startsWith('unhealthy'),
  );
  check(
    'a supervisor whose publisher is gone is not healthy',
    verdict('current', 'orphaned', 'reachable', 'current').startsWith('unhealthy'),
  );
  check(
    'an unreadable state is not healthy',
    verdict('current', 'unknown', 'reachable', 'current').startsWith('unhealthy'),
  );
  check(
    'an unreachable link is not healthy',
    verdict('current', 'current', 'unreachable', 'current').startsWith('unhealthy'),
  );

  // WHY THE VERDICT HAS TO NAME BOTH WHEN BOTH ARE WRONG: the bridge is
  // restarted onto the code on disk by the SUPERVISOR, so a stale bridge and a
  // supervisor that cannot notice changes are one problem, not two — and the
  // verdict named only the bridge.
  //
  // The owner read "the bridge is stale" and waited for the supervisor to put
  // it back, because that is what the supervisor does. The supervisor running
  // at the time could not do it: it was older than the rule that lets it
  // notice an edit to watchdog.sh. The report said the same one line as it
  // would have said about a healthy supervisor, so the one thing that made
  // the app unrecoverable was the thing the report left out.
  check(
    'a stale bridge with a broken supervisor names both',
    verdict('stale', 'unpublished', 'reachable', 'current').includes('bridge is stale') &&
      verdict('stale', 'unpublished', 'reachable', 'current').includes('supervisor is unpublished'),
    verdict('stale', 'unpublished', 'reachable', 'current'),
  );
  check(
    'a down bridge with a broken supervisor names both',
    verdict('down', 'orphaned', 'reachable', 'current').includes('bridge is down') &&
      verdict('down', 'orphaned', 'reachable', 'current').includes('supervisor is orphaned'),
    verdict('down', 'orphaned', 'reachable', 'current'),
  );
  check(
    'a stale bridge with a healthy supervisor says only about the bridge',
    verdict('stale', 'current', 'reachable', 'current').includes('bridge is stale') &&
      !verdict('stale', 'current', 'reachable', 'current').includes('supervisor'),
    verdict('stale', 'current', 'reachable', 'current'),
  );

  // WHY THE BUNDLE IS IN THE VERDICT AND NOT ONLY IN THE REPORT: the report
  // is read by a person who has to know what to do about it. A verdict that
  // says "healthy" while the owner's link is serving an interface that is
  // hours behind the repository is the false all-clear this whole check
  // exists to end — the owner reads "healthy" and stops looking.
  check(
    'a stale bundle is not healthy',
    verdict('current', 'current', 'reachable', 'stale').startsWith('unhealthy'),
    verdict('current', 'current', 'reachable', 'stale'),
  );
  check(
    'a bundle that was never built is not healthy',
    verdict('current', 'current', 'reachable', 'missing').startsWith('unhealthy'),
    verdict('current', 'current', 'reachable', 'missing'),
  );
  check(
    'a bundle whose state cannot be read is not healthy',
    verdict('current', 'current', 'reachable', 'unknown').startsWith('unhealthy'),
    verdict('current', 'current', 'reachable', 'unknown'),
  );
  check(
    'a stale bundle is named in the verdict',
    verdict('current', 'current', 'reachable', 'stale').includes('bundle is stale'),
    verdict('current', 'current', 'reachable', 'stale'),
  );
  check(
    'a stale bundle with a stale bridge names both',
    verdict('stale', 'current', 'reachable', 'stale').includes('bridge is stale') &&
      verdict('stale', 'current', 'reachable', 'stale').includes('bundle is stale'),
    verdict('stale', 'current', 'reachable', 'stale'),
  );
  check(
    'a stale bundle with a healthy bridge says only about the bundle',
    verdict('current', 'current', 'reachable', 'stale').includes('bundle is stale') &&
      !verdict('current', 'current', 'reachable', 'stale').includes('bridge'),
    verdict('current', 'current', 'reachable', 'stale'),
  );

  console.log('\nthe check script, end to end, against the fake bridge');
  const fakeSupervisor = join(work, 'live-watchdog.sh');
  writeFileSync(fakeSupervisor, '#!/bin/bash\necho supervisor\n');
  const fakePublished = join(work, 'live-published.checksum');
  writeFileSync(fakePublished, `${checksumOf(fakeSupervisor)} ${process.pid}\n`);

  // Two bundles: one built after its source, and one whose source was changed
  // after the build. The check has to tell them apart, because that is the
  // whole difference between the owner's link running today's code and
  // running yesterday's.
  const makeBundle = (name, builtAfter) => {
    const root = join(work, name);
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'public'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    const source = join(root, 'src', 'App.tsx');
    const build = join(root, 'dist', 'index.html');
    writeFileSync(source, 'export const App = 1;\n');
    writeFileSync(join(root, 'public', 'icon.svg'), '<svg/>\n');
    writeFileSync(join(root, 'index.html'), '<div id="root"></div>\n');
    writeFileSync(join(root, 'vite.config.ts'), 'export default {};\n');
    writeFileSync(build, '<div id="root"></div>\n');
    // EVERY input gets the same time, not only the TypeScript file: the
    // stylesheet, the icon, the page and the build config all go into the
    // bundle, and a fixture that left them at "now" would be measuring the
    // clock instead of the rule.
    //
    // AND THE BUILD GOES ON THE OTHER SIDE OF THE INPUTS: a bundle built
    // BEFORE the source is stale, and one built AFTER it is current. The
    // two times have to differ, or "newer" is a tie and the rule is right
    // to say nothing.
    const inputTime = builtAfter ? OLD : NEW;
    const buildTime = builtAfter ? NEW : OLD;
    for (const f of [source, join(root, 'public', 'icon.svg'), join(root, 'index.html'), join(root, 'vite.config.ts')]) {
      utimesSync(f, inputTime, inputTime);
    }
    utimesSync(build, buildTime, buildTime);
    return root;
  };
  const freshBundleRoot = makeBundle('bundle-fresh', true);
  const staleBundleRoot = makeBundle('bundle-stale', false);

  /**
   * The verdict line of a check run — the last thing the report says.
   *
   * WHY NOT A SUBSTRING: "healthy" is inside "unhealthy", so a test that
   * asks whether the output CONTAINS "healthy" passes for an app that said
   * the opposite. The line has to be read whole.
   */
  const verdictLine = (out) =>
    out
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop();

  const runCheck = (extra = {}) => {
    try {
      const out = execFileSync('bash', [checker], {
        encoding: 'utf8',
        env: {
          ...process.env,
          HH_BRIDGE_PORT: String(port),
          HH_BRIDGE_DIR: bridgeDir,
          HH_SUPERVISOR_SCRIPT: fakeSupervisor,
          HH_SUPERVISOR_STATE: fakePublished,
          HH_PUBLIC_URL: `http://127.0.0.1:${port}`,
          // WHY THE BUNDLE IS POINTED AT A FIXTURE AND NOT LEFT AT THE REAL
          // REPOSITORY: the check would otherwise read the developer's own
          // checkout, and its answer would depend on whether somebody happened
          // to be editing a source file at that moment. The test has to say
          // what the app is doing, not what the working tree is doing.
          HH_BUNDLE_ROOT: freshBundleRoot,
          ...extra,
        },
      });
      return { code: 0, out };
    } catch (err) {
      return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  const current = runCheck();
  check(
    'a live app on the current code passes the check',
    current.code === 0 && verdictLine(current.out) === 'healthy',
    `exit=${current.code} verdict=${verdictLine(current.out)}`,
  );

  // The check that finds the supervisor out of date has to say HOW to put it
  // back, not only that it is out of date.
  //
  // WHY IT MATTERS: the check is read on a phone, by whoever is holding the
  // phone, and "the app cannot keep itself current until one of them is
  // restarted" without the command is a note to self. The supervisor cannot
  // restart itself — a bash script is read into memory when it starts, so the
  // copy on disk never reaches a supervisor that is already running — so the
  // command is the whole recovery, and the only part of it that cannot be
  // worked out from the message.
  console.log('\nand the check says how to put the supervisor back');
  const unpublished = runCheck({
    HH_SUPERVISOR_STATE: join(work, 'never-published.checksum'),
  });
  check(
    'a supervisor that never published is reported as unpublished',
    unpublished.out.includes('supervisor is unpublished'),
    `exit=${unpublished.code}`,
  );
  check(
    'and the report names the command that puts it back',
    unpublished.out.includes('launchctl kickstart -k gui/$(id -u)/com.homehub.supervisor'),
    'the command has to name the launchd agent that runs the supervisor',
  );

  // The bundle the owner is served. Nothing rebuilds it on its own — the
  // supervisor restarts the bridge, starts tailscale and the voice daemon,
  // and never runs a build — so a change to src/ that never reached a build
  // leaves the owner's link on the old interface while every other check
  // stays green.
  console.log('\nand the check reports a bundle that is behind the source');
  const staleBundle = runCheck({ HH_BUNDLE_ROOT: staleBundleRoot });
  check(
    'a bundle older than the source is reported as stale',
    staleBundle.out.includes('bundle is stale'),
    `exit=${staleBundle.code}`,
  );
  check(
    'and the check does not call that app healthy',
    staleBundle.code !== 0 && verdictLine(staleBundle.out) !== 'healthy',
    `exit=${staleBundle.code} verdict=${verdictLine(staleBundle.out)}`,
  );
  check(
    'and the report names the command that rebuilds it',
    staleBundle.out.includes('npm run build'),
    'the command has to be there — the bundle is not rebuilt by anything',
  );

  // The file time has one-second resolution, so the new code is written in a
  // later second than the bridge started — otherwise "newer" would be a tie
  // and the rule would (correctly) say no.
  await sleep(1200);
  writeFileSync(join(bridgeDir, 'index.mjs'), bridgeSource(port, 'v2'));

  check(
    'and the rule sees that the code on disk has moved on',
    bridgeState(port, bridgeDir) === 'stale',
    `state=${bridgeState(port, bridgeDir)}`,
  );

  const stale = runCheck();
  check(
    'the same check fails once the code on disk moves on',
    stale.code === 1 && stale.out.includes('the bridge is running OLDER code'),
    `exit=${stale.code}`,
  );
} finally {
  if (started && !started.killed) started.kill('SIGKILL');
  rmSync(work, { recursive: true, force: true });
}

console.log('\nthe supervisor publishes the checksum of the code that is running');
const watchdogSource = execFileSync('bash', ['-c', `cat "${watchdog}"`], { encoding: 'utf8' });
check(
  'watchdog.sh writes its checksum down',
  /SUPERVISOR_STATE/.test(watchdogSource) && /supervisor_watched_sum/.test(watchdogSource),
  'the checksum has to cover the rule libraries the supervisor loads, not the script alone',
);
check(
  'the check script reads the file the supervisor writes',
  execFileSync('bash', ['-c', `cat "${checker}"`], { encoding: 'utf8' }).includes('hh_supervisor.checksum'),
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
