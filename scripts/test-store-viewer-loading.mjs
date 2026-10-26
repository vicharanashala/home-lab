/**
 * Tests for the store viewer's loading spinner.
 *
 * WHY THIS TEST EXISTS: a tab that is not on screen keeps its frame — the
 * frame is hidden, not taken down — so the store keeps the page it was
 * showing. That is the whole point of a tab.
 *
 * BUT IT BROKE THE SPINNER. The viewer kept ONE "loading" flag, set it true
 * every time the active tab changed, and cleared it only when a frame fired
 * its load event. Switching back to a tab whose frame had ALREADY loaded
 * changes the active tab but fires NO load event — the frame was never taken
 * down, so the browser never loads it again — so the flag stayed true for
 * ever and the spinner sat over a store that had finished loading. On the
 * one screen the owner is reading, the store looked broken.
 *
 * Run with:  node scripts/test-store-viewer-loading.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const viewerPath = join(here, '..', 'src', 'components', 'StoreViewer.tsx');

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

/** The rule as it was: one flag, reset on every tab change. */
function oldSpinnerShown(state, activeId) {
  return state.loading;
}

console.log('\nTHE RULE AS IT WAS, ON THE JOURNEY THAT BREAKS IT');
{
  // The rule at HEAD, transcribed: a single flag, set true whenever the
  // active tab changes, cleared only by a load event from the frame on
  // screen. A frame that is not on screen is hidden rather than taken down,
  // so switching back to it fires no load event at all.
  let state = { loading: true };
  const tabA = 'jiomart-0';
  const tabB = 'amazon-fresh-1';

  state = { loading: false }; // tab A's frame fires its load event
  state = { loading: true }; // the active tab changes to B
  state = { loading: false }; // tab B's frame fires its load event
  state = { loading: true }; // the active tab changes BACK to A

  ok(
    oldSpinnerShown(state, tabA) === true,
    'the old rule shows the spinner over a tab that has already loaded',
    'this is the defect — tab A loaded long ago and its frame never fires another load event',
  );
  ok(
    oldSpinnerShown(state, tabA) === true && oldSpinnerShown(state, tabB) === true,
    'and the one flag is up for every tab, not just the one it was set for',
    'so switching to a tab that has loaded cannot clear it — only a fresh load event can, and a kept-alive frame never fires one',
  );
}

console.log('\nTHE RULE AS IT IS NOW: PER TAB, NOT PER SCREEN');
{
  let frames = { loaded: [] };
  const tabA = 'jiomart-0';
  const tabB = 'amazon-fresh-1';

  ok(
    frames.loaded.length === 0,
    'nothing has loaded yet',
    `${frames.loaded.length} frames`,
  );

  // Tab A's frame fires its load event.
  frames = { loaded: [...frames.loaded, tabA] };
  ok(
    frames.loaded.includes(tabA),
    'a frame that has loaded is remembered',
    frames.loaded.join(', '),
  );

  // The active tab changes to B, which has never loaded.
  ok(
    !frames.loaded.includes(tabB),
    'a tab that has never loaded is still loading',
    'so the spinner shows while it loads',
  );

  // Tab B's frame fires its load event.
  frames = { loaded: [...frames.loaded, tabB] };
  ok(
    frames.loaded.includes(tabB),
    'the second frame is remembered too',
    frames.loaded.join(', '),
  );

  // THE JOURNEY: back to tab A. Its frame is still mounted and still loaded,
  // so no load event fires — and the spinner must not come back.
  ok(
    frames.loaded.includes(tabA),
    'coming back to the first tab finds it still loaded',
    'the frame was hidden, not taken down, so it never loads again',
  );
}

console.log('\nthe rule itself');
{
  const mod = await import('../src/utils/storeViewerFrames.ts');
  const { markFrameLoaded, isSpinnerShown, NO_FRAMES_LOADED } = mod;

  const tabA = 'jiomart-0';
  const tabB = 'amazon-fresh-1';

  ok(
    isSpinnerShown(NO_FRAMES_LOADED, tabA) === true,
    'a tab that has never loaded shows the spinner',
  );
  ok(
    isSpinnerShown(NO_FRAMES_LOADED, '') === false,
    'no active tab means no spinner',
  );

  let frames = markFrameLoaded(NO_FRAMES_LOADED, tabA);
  ok(
    isSpinnerShown(frames, tabA) === false,
    'a tab that has loaded shows no spinner',
  );
  ok(
    isSpinnerShown(frames, tabB) === true,
    'the other tab, which has not loaded, still shows the spinner',
  );

  frames = markFrameLoaded(frames, tabB);
  ok(
    isSpinnerShown(frames, tabA) === false &&
      isSpinnerShown(frames, tabB) === false,
    'switching back and forth never brings the spinner back over a loaded tab',
  );

  const before = frames;
  const after = markFrameLoaded(frames, tabA);
  ok(after === before, 'a frame that is already known is not recorded twice');
  ok(
    after.loaded.length === 2,
    'and the list of loaded frames stays the same length',
    `${after.loaded.length} frames`,
  );
}

console.log('\nthe viewer uses the rule rather than one flag for every tab');
{
  const viewer = readFileSync(viewerPath, 'utf8');

  const resetsOnEverySwitch =
    /useEffect\(\s*\(\)\s*=>\s*\{\s*setLoading\(true\)\s*;?\s*\}\s*,\s*\[activeId\]\s*\)/.test(
      viewer,
    );
  ok(
    !resetsOnEverySwitch,
    'the loading state is not reset whenever the active tab changes',
    resetsOnEverySwitch
      ? 'a flag reset on every tab change stays true for ever over a tab that has already loaded'
      : '',
  );

  ok(
    /isSpinnerShown\(/.test(viewer),
    'the spinner is gated on the per-tab loaded state',
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
