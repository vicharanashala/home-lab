/**
 * Where House Bot's window goes, and how it is opened.
 *
 * WHY HOUSE BOT GETS A WINDOW OF ITS OWN
 * --------------------------------------
 * The share is of a WINDOW, and a window shows ONE tab at a time. So the
 * picture House Bot receives is whatever tab is in front of that window.
 *
 * With House Bot in a tab of the same window, the person has to click the
 * House Bot tab to ask it something — and the moment they do, the window
 * shows House Bot, so the bot is handed a picture of ITSELF and asked what
 * is on the screen. The feature cannot work: the person asks about the
 * store and the bot looks at the chat window.
 *
 * A window of its own fixes that. The app's window keeps the store in front
 * for as long as the person is shopping, and the person talks to House Bot
 * in the other window without changing a thing in the app's window.
 *
 * WHY THE POSITION MATTERS AS MUCH AS THE SIZE
 * --------------------------------------------
 * The app's window is the one being shared, and the browser stops a share
 * from a window it cannot see — a window completely covered by another one
 * is hidden, and a hidden page is refused a capture. So the House Bot
 * window is put BESIDE the app's window where there is room, and where
 * there is not, it is made small enough that it cannot cover the app's
 * window completely.
 *
 * WHY IT IS COMPUTED AND NOT HARD-CODED: the app does not know how big the
 * person's screen is, where their window is, or whether they have it
 * maximized. Guessing wrong means covering the window that is being
 * shared, and the share stops.
 */

import { popUpAllowedNow } from './screenWatch';

/** The gap between the two windows, in CSS pixels. */
export const WINDOW_GAP = 12;

/**
 * The narrowest a House Bot window is allowed to be.
 *
 * WHY IT IS NOT TOO NARROW: the chat needs a place to type, and a window
 * too narrow to type in is a window the person cannot use.
 *
 * WHY IT IS A FLOOR AND NOT A PREFERENCE: a window narrower than this is
 * not a chat window, it is a column of text. The only things allowed to
 * beat it are the screen being too small to give it, and the app's own
 * window being too narrow to leave room beside it — and both of those are
 * limits of the machine, not of the chat.
 */
export const MIN_BOT_WIDTH = 420;

/** How wide a House Bot window would like to be. */
export const PREFERRED_BOT_WIDTH = 720;

/**
 * The narrowest a House Bot window is allowed to be tall.
 *
 * WHY IT IS NOT TOO SHORT: the chat and the picture of the shared window
 * both need a place to be.
 *
 * WHY THE SCREEN CAN STILL BEAT IT: a window that hangs off the bottom of
 * the screen cannot be used at all, so a screen too short to hold this
 * gets a shorter window rather than one that runs off it.
 */
export const MIN_BOT_HEIGHT = 420;

/** How tall a House Bot window would like to be. */
export const PREFERRED_BOT_HEIGHT = 820;

/**
 * How much of the app's window must stay visible.
 *
 * WHY IT MATTERS: the app's window is the one being shared. If the House
 * Bot window covered all of it, the app's page would be hidden, the browser
 * would refuse the capture, and the share would stop.
 */
export const KEEP_VISIBLE = 80;

/** What the app knows about the screen it is on. */
export interface WindowGeometry {
  /** Where the app's window starts, on the screen. */
  screenX: number;
  screenY: number;
  /** How big the app's window is. */
  outerWidth: number;
  outerHeight: number;
  /** How much of the screen there is to use. */
  availWidth: number;
  availHeight: number;
}

/** Where the House Bot window goes. */
export interface HouseBotWindowPlan {
  /** The window features string for `window.open`. */
  features: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /**
   * Whether the window sits beside the app's window rather than over it.
   *
   * WHY IT IS WORTH KNOWING: when it is over the app's window, the person
   * may have to move it, and the app's copy says something different.
   */
  beside: boolean;
}

/**
 * Work out where the House Bot window goes.
 *
 * WHY IT IS A PURE FUNCTION AND NOT CODE THAT READS THE SCREEN: a rule that
 * can only be tested in a browser is a rule that will not be tested, and
 * this one is about geometry — where a window lands on somebody's screen.
 */
export function planHouseBotWindow(g: WindowGeometry): HouseBotWindowPlan {
  const appRight = g.screenX + g.outerWidth;

  // THE BOT WINDOW MUST NEVER COVER THE APP'S WINDOW COMPLETELY.
  //
  // WHY IT IS ONLY USED WHERE THE TWO WINDOWS OVERLAP: this cap is what
  // keeps KEEP_VISIBLE of the app's width showing. A bot window placed
  // BESIDE the app's window cannot cover any of it, so applying the cap
  // there took width away from the chat for nothing — and the width it
  // took was enough to put the chat below its own minimum.
  //
  // WHY IT IS MEASURED FROM WHERE THE BOT WINDOW WILL LAND: the bot window
  // sits against the right edge of the screen, so its left edge lands at
  // availWidth - width - WINDOW_GAP. Capping the width by the app's width
  // alone said how wide the bot window could be without saying where it
  // would sit, and on a narrow app window the two disagreed: the cap said
  // 70 was safe, the floor said 200, and a 200 wide bot window over a 150
  // wide app window hid the app completely — the one thing this file says
  // must not happen, because a hidden window is refused a capture.
  //
  // WHY THERE ARE TWO TERMS AND NOT ONE: the bot window's left edge has to
  // stay to the right of the app's left edge (or the app is hidden), and it
  // has to stay to the right of the app's right edge less the strip that
  // must keep showing (or more of the app is covered than it can spare).
  const spare = Math.max(0, g.outerWidth - KEEP_VISIBLE);
  const widestSafe = Math.floor(
    Math.max(
      0,
      Math.min(
        g.availWidth - WINDOW_GAP - g.screenX,
        g.availWidth - WINDOW_GAP - appRight + spare,
      ),
    ),
  );

  const roomRight = g.availWidth - appRight - WINDOW_GAP;
  const roomLeft = g.screenX - WINDOW_GAP;

  let left: number;
  let width: number;
  let beside: boolean;

  if (roomRight >= MIN_BOT_WIDTH) {
    // Beside it, on the right — where there is the most room on most screens.
    // The room is the only limit here: the two windows do not touch, so
    // there is nothing for the app's width to protect.
    width = Math.min(PREFERRED_BOT_WIDTH, roomRight);
    left = appRight + WINDOW_GAP;
    beside = true;
  } else if (roomLeft >= MIN_BOT_WIDTH) {
    // Beside it, on the left.
    width = Math.min(PREFERRED_BOT_WIDTH, roomLeft);
    left = g.screenX - WINDOW_GAP - width;
    beside = true;
  } else {
    // NO ROOM BESIDE: the app's window fills the screen. The bot window goes
    // in the corner, and it is made small enough that the app's window still
    // shows around it — the share must not stop.
    const screenWidth = Math.max(0, g.availWidth - WINDOW_GAP * 2);
    width = Math.min(
      PREFERRED_BOT_WIDTH,
      Math.floor(g.availWidth * 0.45),
      widestSafe,
      screenWidth,
    );
    // THE CHAT NEEDS A ROOM TO TYPE IN, so the window is not left narrower
    // than the minimum — unless the screen or the app's own width says it
    // cannot be that wide, and those two are limits of the machine rather
    // than of the chat.
    width = Math.max(width, Math.min(MIN_BOT_WIDTH, screenWidth, widestSafe));
    // THE OTHER END OF THE SCREEN IS SOMETIMES THE BETTER PLACE: a bot
    // window that fits to the LEFT of the app's window does not cover any
    // of it at all, so the whole app keeps showing rather than the strip.
    // It is worth taking whenever it is the WIDER of the two, because a
    // chat squeezed into a sliver is a chat nobody can use.
    const clearOfApp = Math.floor(Math.min(screenWidth, g.screenX - WINDOW_GAP));
    if (clearOfApp > width) {
      width = clearOfApp;
      left = 0;
    } else {
      left = Math.max(0, g.availWidth - width - WINDOW_GAP);
    }
    beside = false;
  }

  // THE SCREEN IS A HARDER LIMIT THAN THE PREFERRED HEIGHT: a window that
  // hangs off the bottom of the screen is a window the person cannot use,
  // so a short screen gets a short window rather than one that runs off it.
  const screenHeight = Math.max(0, g.availHeight - WINDOW_GAP);
  const height = Math.min(
    screenHeight,
    Math.max(MIN_BOT_HEIGHT, Math.min(PREFERRED_BOT_HEIGHT, screenHeight)),
  );
  // THE TOPS LINE UP, so the two windows read as a pair, and the bot window
  // is kept on the screen.
  const top = Math.max(0, Math.min(g.screenY, g.availHeight - height - WINDOW_GAP));

  const w = Math.round(width);
  const h = Math.round(height);
  const l = Math.round(left);
  const t = Math.round(top);

  return {
    features: `noopener,width=${w},height=${h},left=${l},top=${t}`,
    left: l,
    top: t,
    width: w,
    height: h,
    beside,
  };
}

/**
 * Read the geometry of the app's own window and the screen it is on.
 */
export function readWindowGeometry(): WindowGeometry {
  if (typeof window === 'undefined') {
    return { screenX: 0, screenY: 0, outerWidth: 1024, outerHeight: 768, availWidth: 1440, availHeight: 900 };
  }
  const scr = window.screen;
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    screenX: num(window.screenX, 0),
    screenY: num(window.screenY, 0),
    outerWidth: num(window.outerWidth, 1024),
    outerHeight: num(window.outerHeight, 768),
    availWidth: num(scr?.availWidth, 1440),
    availHeight: num(scr?.availHeight, 900),
  };
}

/**
 * Open House Bot in a window of its own, beside the app's window.
 *
 * WHY IT IS A WINDOW AND NOT A TAB: a tab of the app's own window would
 * change what the shared window shows, and the bot would be handed a
 * picture of the chat instead of the store. See the note at the top.
 *
 * WHY THE GESTURE IS ASKED ABOUT FIRST: `window.open` CONSUMES the
 * transient activation, so a page that asked afterwards would always be told
 * "blocked" — including on the runs where the window opened perfectly well.
 * The question is therefore asked before the window is opened, and the
 * person is told when the browser refused.
 *
 * @returns whether the browser was asked to open it
 */
export function openHouseBotWindow(path: string): boolean {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return false;
  // A window that is opened without a live gesture is a pop-up, and a
  // pop-up is blocked. There is no point asking.
  if (!popUpAllowedNow()) return false;
  const plan = planHouseBotWindow(readWindowGeometry());
  try {
    window.open(path, '_blank', plan.features);
  } catch {
    // The browser refused. There is nothing else the app can do about it.
    return false;
  }
  return true;
}
