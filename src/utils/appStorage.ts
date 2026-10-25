/**
 * Writing the app's state to the browser's storage.
 *
 * WHY THIS IS ITS OWN MODULE: "did the write happen" is a question a test has
 * to be able to make fail on purpose — a storage that refuses to write IS the
 * case — and a rule that lives inside the store cannot be shown to fail.
 *
 * WHY THE ANSWER MATTERS AT ALL
 * The app's whole job is remembering. The grocery list, the stock and the meal
 * plan all live in one localStorage key, so a change that cannot be written is
 * a change the app shows and then forgets:
 *
 *   the user adds "onions"
 *     the list shows onions
 *     the toast says "Added to grocery list"
 *     the browser refused the write — a blocked storage, or a full quota
 *     a reload brings back the list as it was
 *
 * The user's words, gone, with nothing said about it. A browser that refuses
 * to store anything is a real thing — Safari with storage blocked, a private
 * window, a quota spent — and the app has to be honest when it happens.
 */
import type { AppState } from '../types';

/** The key the app's state is stored under. */
export const STORAGE_KEY = 'homehub.v1';

/**
 * What the user is told when a change could not be saved.
 *
 * WHY IT SAYS WHAT IT MEANS AND NOT ONLY THAT IT FAILED: "not saved" on its
 * own leaves the user guessing whether the change is gone or merely slow.
 * The change is in the app until the tab closes and nowhere after that, and
 * that is what the user needs to know to go and write it down somewhere else.
 */
export const STORAGE_FAILURE_MESSAGE =
  'Not saved — your browser refused to store your changes. They are here until you close the app, and gone after that.';

/**
 * The bit of the Storage interface a write needs.
 *
 * WHY IT IS NOT THE WHOLE Storage INTERFACE: a test has to be able to hand
 * this rule a storage that refuses to write, and the full interface would
 * make it write the other five methods as well.
 */
export interface StorageWriter {
  setItem(key: string, value: string): void;
}

/**
 * Write the app's state, and say whether it was written.
 *
 * WHY IT REPORTS INSTEAD OF SWALLOWING: a write that failed must not look
 * like a write that worked. The code this replaced caught the error and said
 * nothing at all, so the app showed the change, told the user it was saved,
 * and lost it on the next reload.
 *
 * @param state   the state to write
 * @param storage where to write it; null means there is nowhere to write
 * @returns whether the state was written
 */
export function saveAppState(
  state: AppState,
  storage: StorageWriter | null,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
