/**
 * The House Bot window has to be big enough to talk to, and small enough to
 * fit on the screen.
 *
 * THE BUG THIS GUARDS
 *
 * The planner carries three promises in its own constants:
 *
 *     MIN_BOT_WIDTH   the narrowest a House Bot window is allowed to be
 *     MIN_BOT_HEIGHT  the narrowest a House Bot window is allowed to be tall
 *     KEEP_VISIBLE    how much of the app's window must stay showing
 *
 * and the arithmetic did not keep two of them.
 *
 * The width came out BELOW the minimum. The planner capped the bot window's
 * width by the app's window width (so the bot window could never cover the
 * window being shared) — but that cap was applied to the window placed
 * BESIDE the app's window, where nothing can be covered at all:
 *
 *     app window 400 wide, screen 2240 wide
 *     bot window beside it  ->  320 wide
 *
 * The file says the narrowest allowed is 420, and says why: "the chat needs a
 * place to type, and a window too narrow to type in is a window the person
 * cannot use". A 320-wide chat window is exactly that.
 *
 * The height came out TALLER than the screen. The minimum height was applied
 * as a floor, so a short screen got a window that hung off the bottom of it:
 *
 *     screen 400 tall  ->  bot window 420 tall at top 0
 *
 * A window that hangs off the screen is a window the person cannot use, and
 * the screen is a harder limit than the preferred height.
 *
 * THE OTHER BUG THIS GUARDS
 *
 * The third promise — KEEP_VISIBLE, how much of the app's window must stay
 * showing — was broken the other way round, and only on a NARROW app window.
 *
 * The width the bot window may take was capped by the app's width less the
 * strip that has to stay showing, but with a floor of 200 underneath it:
 *
 *     app window 150 wide, screen 320 wide
 *     bot window  ->  200 wide, sitting on top of the app window
 *
 * The floor overrode the cap, because the app's width (150) less the strip
 * (80) is 70, and 200 is more than 70. So the bot window was 130 pixels wider
 * than the app's window could spare, and it sat right on top of the app:
 *
 *     bot window 108..308, app window 110..260  ->  NOTHING of the app showing
 *
 * A shared window with nothing showing is a hidden window, and the browser
 * refuses a capture of a hidden window — the share stops. The file says so at
 * the top: "a window completely covered by another one is hidden, and a
 * hidden page is refused a capture".
 *
 * WHAT IS TESTED HERE
 *
 *   - the REAL planner, over the geometries that bring both out;
 *   - that the bot window is never narrower than the chat minimum, unless
 *     the screen or the app's own window says it cannot be;
 *   - that it never falls off the screen, in either direction;
 *   - that the app's window keeps KEEP_VISIBLE of itself showing whenever
 *     the two windows overlap;
 *   - that a window placed beside the app's window overlaps it not at all,
 *     and is not made narrow to avoid an overlap that cannot happen.
 *
 * Run with:  node scripts/test-house-bot-window-size.mjs
 */
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

register('./lib/ts-resolve.mjs', import.meta.url);

const {
  planHouseBotWindow,
  MIN_BOT_WIDTH,
  MIN_BOT_HEIGHT,
  PREFERRED_BOT_HEIGHT,
  WINDOW_GAP,
  KEEP_VISIBLE,
} = await import(pathToFileURL(path.join(REPO, 'src/utils/houseBotWindow.ts')).href);

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

/** How much of the app's window width the bot window covers. */
function coveredWidthOfApp(plan, g) {
  const appLeft = g.screenX;
  const appRight = g.screenX + g.outerWidth;
  const botLeft = plan.left;
  const botRight = plan.left + plan.width;
  if (botRight <= appLeft || botLeft >= appRight) return 0;
  return Math.min(botRight, appRight) - Math.max(botLeft, appLeft);
}

/**
 * The widest bot window the machine allows, for the place the planner puts
 * the bot window when it has to sit over the app's window.
 *
 * WHY IT IS WORKED OUT HERE AND NOT COPIED FROM THE PLANNER: a test that
 * re-implements the rule it is checking proves nothing. This one starts at
 * the other end — the bot window's right edge sits WINDOW_GAP from the
 * screen's right edge, so a window W wide has its left edge at
 * availWidth - W - WINDOW_GAP — and asks how much of the app's window that
 * left edge leaves covered.
 */
function widestTheMachineAllows(g) {
  const appRight = g.screenX + g.outerWidth;
  // What the app's window can spare: everything but the strip that has to
  // keep showing. An app window narrower than the strip may not be covered
  // at all.
  const spare = Math.max(0, g.outerWidth - KEEP_VISIBLE);
  // The bot window's left edge has to stay to the right of the app's left
  // edge, or the app is hidden, and to the right of the app's right edge
  // less the strip, or more of the app is covered than it can spare.
  const leftmostEdge = Math.max(g.screenX, appRight - spare);
  return g.availWidth - WINDOW_GAP - leftmostEdge;
}

const GEOMETRIES = [
  {
    name: 'a narrow app window on a wide screen',
    g: { screenX: 0, screenY: 0, outerWidth: 400, outerHeight: 800, availWidth: 2240, availHeight: 1140 },
  },
  {
    name: 'a small app window beside a lot of room',
    g: { screenX: 0, screenY: 0, outerWidth: 480, outerHeight: 800, availWidth: 2240, availHeight: 1140 },
  },
  {
    name: 'a narrow screen with no room beside',
    g: { screenX: 0, screenY: 0, outerWidth: 780, outerHeight: 700, availWidth: 800, availHeight: 700 },
  },
  {
    name: 'a maximized window',
    g: { screenX: 0, screenY: 0, outerWidth: 2240, outerHeight: 1140, availWidth: 2240, availHeight: 1140 },
  },
  {
    name: 'a laptop screen',
    g: { screenX: 0, screenY: 25, outerWidth: 1440, outerHeight: 875, availWidth: 1440, availHeight: 875 },
  },
  {
    name: 'a short screen',
    g: { screenX: 0, screenY: 0, outerWidth: 900, outerHeight: 400, availWidth: 1440, availHeight: 400 },
  },
  {
    name: 'a very narrow app window on a small screen',
    g: { screenX: 110, screenY: 0, outerWidth: 150, outerHeight: 800, availWidth: 320, availHeight: 1000 },
  },
  {
    name: 'a narrow app window pushed to the right of a small screen',
    g: { screenX: 150, screenY: 0, outerWidth: 200, outerHeight: 700, availWidth: 400, availHeight: 900 },
  },
  {
    name: 'a narrow app window on a small screen',
    g: { screenX: 220, screenY: 0, outerWidth: 250, outerHeight: 700, availWidth: 480, availHeight: 900 },
  },
];

console.log('\nthe House Bot window is wide enough to chat in');
for (const { name, g } of GEOMETRIES) {
  const plan = planHouseBotWindow(g);
  // The screen may be too small for the minimum, but then the screen wins.
  const screenAllows = g.availWidth >= MIN_BOT_WIDTH + 24;
  // So may the app's own window: a bot window that has to sit over it can
  // only be as wide as what the app's width leaves spare, and an app window
  // too narrow to spare that is a limit of the machine, not of the chat.
  // Beside the app's window there is nothing to cover, so the app's width
  // limits nothing there.
  const appAllows = plan.beside || widestTheMachineAllows(g) >= MIN_BOT_WIDTH;
  ok(
    !screenAllows || !appAllows || plan.width >= MIN_BOT_WIDTH,
    `the bot window is at least ${MIN_BOT_WIDTH} wide on ${name}`,
    `${plan.width} wide`,
  );
}

console.log('\nthe House Bot window fits on the screen');
for (const { name, g } of GEOMETRIES) {
  const plan = planHouseBotWindow(g);
  ok(
    plan.left >= 0 &&
      plan.top >= 0 &&
      plan.left + plan.width <= g.availWidth + 1 &&
      plan.top + plan.height <= g.availHeight + 1,
    `the bot window is on the screen on ${name}`,
    `${plan.left},${plan.top} ${plan.width}x${plan.height} on ${g.availWidth}x${g.availHeight}`,
  );
}

console.log('\nthe House Bot window is no taller than the screen allows');
{
  // A screen shorter than the minimum height: the screen wins, because a
  // window that hangs off the bottom cannot be used at all.
  const g = { screenX: 0, screenY: 0, outerWidth: 900, outerHeight: 400, availWidth: 1440, availHeight: 400 };
  const plan = planHouseBotWindow(g);
  ok(
    plan.height <= g.availHeight,
    'a short screen gets a short window',
    `${plan.height} tall on a ${g.availHeight} tall screen`,
  );
  ok(
    plan.height === Math.min(PREFERRED_BOT_HEIGHT, g.availHeight - WINDOW_GAP),
    'and it uses all the room the screen allows',
    `${plan.height} of ${g.availHeight - WINDOW_GAP}`,
  );

  // A screen with room to spare: the window is not held below the minimum.
  const tall = { screenX: 0, screenY: 0, outerWidth: 900, outerHeight: 800, availWidth: 1440, availHeight: 900 };
  const tallPlan = planHouseBotWindow(tall);
  ok(
    tallPlan.height >= MIN_BOT_HEIGHT,
    'a screen with room gets a window at least the minimum tall',
    `${tallPlan.height} tall`,
  );
}

console.log('\nthe app\'s window keeps a strip of itself showing');
for (const { name, g } of GEOMETRIES) {
  const plan = planHouseBotWindow(g);
  const covered = coveredWidthOfApp(plan, g);
  ok(
    covered === 0 || g.outerWidth - covered >= KEEP_VISIBLE,
    `the shared window keeps ${KEEP_VISIBLE} of its width on ${name}`,
    covered === 0
      ? 'the bot window does not touch it'
      : `${g.outerWidth - covered} of ${g.outerWidth} showing`,
  );
}

console.log('\na window placed beside does not touch the app\'s window');
for (const { name, g } of GEOMETRIES) {
  const plan = planHouseBotWindow(g);
  if (!plan.beside) continue;
  ok(
    coveredWidthOfApp(plan, g) === 0,
    `the bot window does not overlap the app window on ${name}`,
    `bot at ${plan.left}, app at ${g.screenX}..${g.screenX + g.outerWidth}`,
  );
}

console.log('\na narrow app window does not make the chat window narrow');
{
  // The cap that keeps the bot window from covering the app's window is only
  // needed where the two overlap. Beside, it took room away for nothing.
  const g = { screenX: 0, screenY: 0, outerWidth: 400, outerHeight: 800, availWidth: 2240, availHeight: 1140 };
  const plan = planHouseBotWindow(g);
  ok(plan.beside, 'the bot window is placed beside the app window');
  ok(
    plan.width >= MIN_BOT_WIDTH,
    'and it is not narrowed by an overlap that cannot happen',
    `${plan.width} wide`,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
