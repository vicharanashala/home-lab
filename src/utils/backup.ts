/**
 * Local backup for the household data.
 *
 * Everything lives in one localStorage key, so a cleared browser, a replaced
 * phone or a reinstall loses the lot. This writes a timestamped snapshot into
 * its own key on a schedule, keeps the last few, and offers a one-tap restore.
 *
 * Deliberately local: no network, no account, nothing leaves the device.
 */

import { STORAGE_KEY as STATE_KEY } from './appStorage';
/** Snapshot keys. Must NOT be a prefix of any other key we store. */
const SNAPSHOT_PREFIX = 'homehub.snapshot.';
/** The "last run" marker lives OUTSIDE the snapshot namespace. */
const LAST_RUN_KEY = 'homehub.lastRunAt';
const KEEP = 5;

/** 12 hours — frequent enough to be useful, rare enough to be cheap. */
const INTERVAL_MS = 12 * 60 * 60 * 1000;

/**
 * What a snapshot attempt came to.
 *
 * WHY IT IS NOT JUST A STAMP OR NOTHING: "there was nothing worth saving"
 * and "the browser refused to store it" are opposites for the user. One says
 * "add some stock"; the other says "this browser would not keep the copy, so
 * there is no copy". A single null said both, and the panel turned it into
 * "Nothing to save yet — add some stock first" — a statement about the
 * household's data that was FALSE whenever the browser was the reason: the
 * household had plenty to save, and the app had silently not saved it.
 *
 * WHY 'not-due' IS ITS OWN REASON: a backup that was skipped because the
 * last one was recent is neither an empty household nor a refused write, and
 * a caller that is told "nothing to save" about a household it has just
 * backed up would be wrong too.
 */
export type BackupOutcome =
  | { saved: true; stamp: string }
  | { saved: false; reason: 'nothing-to-save' | 'not-due' | 'storage-refused' };

/**
 * What the user is told when the browser refused to store the snapshot.
 *
 * WHY IT IS NOT THE APP'S OWN STORAGE BANNER: the banner says the app's
 * state is not being saved. The snapshot is a COPY of that state, written
 * under its own key, and it can fail on its own — a quota that fits the
 * household but not a second copy of it. The user asked for a snapshot and
 * did not get one, and that has to be said in the words they will act on.
 *
 * WHY IT SAYS THERE IS NO COPY: a refused snapshot leaves the household
 * exactly as it was — nothing lost — but the extra safety copy they asked
 * for is not there, and a user who believes they have one will not make one.
 */
export const SNAPSHOT_NOT_SAVED_MESSAGE =
  'Snapshot not saved — your browser refused to store it, so there is no extra copy of your data.';

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface BackupInfo {
  available: boolean;
  stamps: string[];
  lastRun?: number;
}

export function listBackups(): BackupInfo {
  const ls = safeLocalStorage();
  if (!ls) return { available: false, stamps: [] };
  const stamps: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    // Only real snapshots. The lastRun marker deliberately uses a different
    // prefix and is also filtered here as a second line of defence — it must
    // never be offered as something to restore.
    if (k && k.startsWith(SNAPSHOT_PREFIX) && k !== LAST_RUN_KEY) {
      stamps.push(k.slice(SNAPSHOT_PREFIX.length));
    }
  }
  stamps.sort().reverse();
  const last = ls.getItem(LAST_RUN_KEY);
  return {
    available: stamps.length > 0,
    stamps,
    lastRun: last ? Number(last) : undefined,
  };
}

/** Free space by dropping the oldest snapshots. Runs before a write so a
 *  full quota can't wedge backups permanently. `retain` is how many snapshots
 *  should SURVIVE — at most that many are left behind. `protect` is a stamp
 *  that must survive regardless of age. Returns how many were removed. */
function prune(ls: Storage, retain = KEEP, protect?: string): number {
  const all = listBackups().stamps.filter((s) => s !== protect);
  // NB: slice(retain), not slice(retain - 1). `retain` is a floor on what
  // remains; slicing at retain-1 quietly dropped the newest keeper and made the
  // list settle at KEEP-1 instead of KEEP.
  const doomed = all.slice(Math.max(0, retain));
  for (const s of doomed) ls.removeItem(SNAPSHOT_PREFIX + s);
  return doomed.length;
}

/** Is this string actually a saved app state we can restore? */
function isRestorableState(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const v = JSON.parse(raw);
    // Must be an OBJECT shaped like AppState. A bare number or string parses
    // fine but would silently wipe the app, so require the real shape.
    return !!(
      v && typeof v === 'object' && !Array.isArray(v) &&
      Array.isArray(v.grocery) && Array.isArray(v.stock) && !!v.settings
    );
  } catch {
    return false;
  }
}

/**
 * Write a snapshot, but only if enough time has passed and there is real data
 * worth keeping. Says what came of it.
 */
export function runBackup(force = false, protect?: string): BackupOutcome {
  const ls = safeLocalStorage();
  // WHY A BROWSER WITH NO STORAGE IS A REFUSAL AND NOT AN EMPTY BACKUP: a
  // browser that will not store anything is not a household with nothing to
  // save, and the two need different words.
  if (!ls) return { saved: false, reason: 'storage-refused' };
  try {
    const now = Date.now();
    if (!force) {
      const last = Number(ls.getItem(LAST_RUN_KEY) || 0);
      if (now - last < INTERVAL_MS) return { saved: false, reason: 'not-due' };
    }
    const state = ls.getItem(STATE_KEY);
    if (!isRestorableState(state)) return { saved: false, reason: 'nothing-to-save' };

    const stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
    // Prune BEFORE writing so an almost-full quota still lets the newest
    // snapshot land; pruning only after would leave it permanently failing.
    // Trim to KEEP-1 first because this very write pushes the count up by one.
    prune(ls, KEEP - 1, protect);
    ls.setItem(SNAPSHOT_PREFIX + stamp, state as string);
    ls.setItem(LAST_RUN_KEY, String(now));
    prune(ls, KEEP, protect); // safety net — a no-op in the normal case
    return { saved: true, stamp };
  } catch {
    // Storage full or unavailable — never break the app over a backup. But
    // say WHICH it was: the caller used to be told the same thing as a
    // household with nothing in it, which is false whenever the browser is
    // the reason.
    return { saved: false, reason: 'storage-refused' };
  }
}

export function readBackup(stamp: string): string | null {
  return safeLocalStorage()?.getItem(SNAPSHOT_PREFIX + stamp) ?? null;
}

export interface RestoreResult {
  ok: boolean;
  message: string;
}

/**
 * Restore a snapshot over the live state.
 *
 * The current state is backed up first, so a restore is itself reversible.
 * The snapshot is shape-checked, not merely parsed: a value that parses as
 * JSON but isn't an app state must never overwrite good data.
 */
export function restoreBackup(stamp: string): RestoreResult {
  const ls = safeLocalStorage();
  if (!ls) return { ok: false, message: 'Storage unavailable' };

  const snapshot = readBackup(stamp);
  if (!snapshot) return { ok: false, message: 'That backup could not be read.' };
  if (!isRestorableState(snapshot)) {
    return { ok: false, message: 'That backup does not look like saved app data.' };
  }
  try {
    // Preserve what we're about to overwrite. The snapshot being restored is
    // protected from pruning: it's already read into `snapshot`, but if the
    // pre-restore backup pushed it past KEEP it would vanish from the list and
    // the restore would look like it destroyed the backup it came from.
    runBackup(true, stamp);
    ls.setItem(STATE_KEY, snapshot);
    return { ok: true, message: `Restored from ${stamp}` };
  } catch {
    return { ok: false, message: 'Could not write the restored data — storage may be full.' };
  }
}

export function deleteBackup(stamp: string): void {
  safeLocalStorage()?.removeItem(SNAPSHOT_PREFIX + stamp);
}

/** Install the periodic + on-hide backup. Safe to call more than once. */
export function installAutoBackup(): () => void {
  runBackup();
  const timer = setInterval(() => runBackup(), 30 * 60 * 1000);
  const onHide = () => {
    if (document.visibilityState === 'hidden') runBackup();
  };
  document.addEventListener('visibilitychange', onHide);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onHide);
  };
}