/**
 * Which of the store viewer's frames have finished loading.
 *
 * WHY THIS IS SEPARATE FROM THE COMPONENT: the rule is easy to get subtly
 * wrong, it is the kind of thing that is worth testing, and testing it needs
 * no browser.
 *
 * WHY THE STATE IS PER TAB AND NOT ONE FLAG: a frame that is not on screen is
 * hidden rather than taken down, so it keeps the page it was showing. That is
 * the whole point of a tab.
 *
 * BUT IT BREAKS A SINGLE FLAG. Switching back to a tab whose frame has
 * ALREADY loaded fires NO load event — the frame was never taken down, so
 * the browser never loads it again — while one flag reset on every tab
 * change would be set true all over again. The flag would stay true for
 * ever, and the spinner would sit over a store that had finished loading.
 * The store would look broken, on the one screen the owner is reading.
 */

/** The tab ids whose frame has finished loading. */
export interface FrameState {
  readonly loaded: readonly string[];
}

/** The state before anything has loaded. */
export const NO_FRAMES_LOADED: FrameState = { loaded: [] };

/**
 * Record that a tab's frame has finished loading.
 *
 * WHY A BACKGROUND FRAME COUNTS: the frame is hidden, not removed, so it
 * loads whether or not it is the one on screen. A tab that finished loading
 * in the background HAS finished loading, and coming back to it must not
 * show a spinner over a page that is already there.
 *
 * WHY THE ID IS NOT FORGOTTEN WHEN A TAB IS CLOSED: a closed tab's frame is
 * gone with it, but the id is never reused — every tab's id carries the
 * counter that made it — so a stale entry costs nothing and cannot mark a
 * new frame as loaded.
 */
export function markFrameLoaded(state: FrameState, tabId: string): FrameState {
  if (state.loaded.includes(tabId)) return state;
  return { loaded: [...state.loaded, tabId] };
}

/**
 * Should the spinner be shown over the frame that is on screen?
 *
 * The spinner belongs to the ACTIVE tab alone: a tab that has never loaded
 * is still loading, and a tab that has loaded once is done, whatever has
 * happened to the other tabs since.
 */
export function isSpinnerShown(state: FrameState, activeId: string): boolean {
  if (!activeId) return false;
  return !state.loaded.includes(activeId);
}
