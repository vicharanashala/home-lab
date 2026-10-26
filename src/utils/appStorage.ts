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
 * What the user is told when an imported backup could not be stored.
 *
 * WHY IT IS NOT THE BANNER'S MESSAGE: the banner says a change is not being
 * saved. This says the IMPORT did not happen, which is a different fact — the
 * screen would otherwise have said "Restored 12 grocery items" and the user
 * would believe the household's data was replaced when nothing was stored.
 *
 * WHY IT SAYS THE DATA IS STILL THERE: the store undoes an import the browser
 * refused, so the household is on the screen the user is looking at. "Not
 * saved" on its own would leave them guessing whether the import half
 * worked, and a message about the file coming back would describe a loss that
 * did not happen — the household's data never left.
 */
export const IMPORT_NOT_SAVED_MESSAGE =
  'Your browser refused to store the imported data, so nothing was imported — your current data is still here.';

/**
 * What the user is told when the app could not store the clearing of the data.
 *
 * WHY IT IS NOT THE BANNER'S MESSAGE: the banner says a change is not being
 * saved. This says the CLEARING did not happen, which is a different fact —
 * the screen would otherwise have said "App data cleared" and the user would
 * believe their household was emptied when the browser still holds it.
 *
 * WHY IT SAYS THE DATA IS STILL THERE: the store undoes a clearing the browser
 * refused, so the household is on the screen the user is looking at. "Not
 * saved" on its own would leave them guessing whether the reset half-worked,
 * and a message about the data coming back would describe a loss that did not
 * happen — the data never left.
 */
export const CLEAR_NOT_SAVED_MESSAGE =
  'Your browser refused to store this, so nothing was cleared — your data is still here.';

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
 * The bit of the Storage interface a read needs.
 */
export interface StorageReader {
  getItem(key: string): string | null;
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

/**
 * Listen for another tab of the app writing the household's state.
 *
 * WHY THE APP NEEDS A LISTENER AT ALL
 *
 * The app's state is one localStorage key. Every tab keeps its own copy of
 * it in memory, and writes the WHOLE copy back whenever the person changes
 * something. So a tab that has not heard what another tab wrote writes a
 * copy that was already out of date.
 *
 * Two tabs of this app are open at the same time by design: the Digital
 * stores page holds the screen share and shows the shopping list beside it,
 * and House Bot is opened in a tab of its own — the only way to ask the bot
 * about the screen without ending the share. So:
 *
 *   House Bot offers "milk" and the person adds it
 *   the stores page is not told, and still holds the list from before
 *   the person ticks "bread" off in the stores page
 *   the stores page writes its own list back
 *   the milk is gone
 *
 * The milk was not deleted by anything the person did. It was deleted by a
 * tab writing a list that was out of date before the person touched it — and
 * it was never on the screen the person was looking at when it vanished.
 *
 * WHY THE BROWSER'S OWN EVENT
 *
 * `storage` is fired in every tab of the origin EXCEPT the one that made
 * the change, which is exactly the set of tabs that need to hear about it.
 * The browser will not deliver it to the writer, so the tabs cannot end up
 * answering each other for ever.
 *
 * WHY THE KEY IS CHECKED
 *
 * The browser fires this event for every key that changes in the origin —
 * the snapshot backups, the food trainer's examples, the end-of-day
 * reminder's flags. Only the app's own key holds the household.
 *
 * WHY THE VALUE IS READ AND NOT TAKEN FROM THE EVENT
 *
 * Another tab may have written again by the time the event is delivered,
 * and the value on the storage is the one that is true now.
 *
 * @param storage   where the state is kept; null means there is nowhere to look
 * @param onChanged called with the raw state another tab wrote
 * @returns how to stop listening
 */
export function watchForOtherTabs(
  storage: StorageReader | null,
  onChanged: (raw: string) => void,
): () => void {
  if (typeof window === 'undefined' || !storage) return () => {};
  // WHY THE LISTENER IS ASKED FOR SAFELY: a browser with storage blocked
  // throws when the app READS `window.localStorage`, and an environment
  // without events at all has no `addEventListener` to ask. Neither is a
  // reason for the app to fail to start — there is simply nowhere to watch.
  if (typeof window.addEventListener !== 'function') return () => {};
  const onStorage = (event: { key: string | null }) => {
    if (event.key !== STORAGE_KEY) return;
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return;
    onChanged(raw);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
