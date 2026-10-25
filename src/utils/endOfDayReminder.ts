/**
 * End-of-day meal-log reminder.
 *
 * Schedule a browser notification that fires at the user's chosen hour
 * (default 21:00 local). Used as a nudge to log meals before bed.
 *
 * Implementation notes:
 *  - Uses `setTimeout` (works while the tab is open). For background delivery
 *    the user would need Push API + a server, which we don't have here.
 *  - Re-scheduled every time the app mounts so it survives long sessions.
 *  - Survives across reloads via `localStorage` (timestamp of next fire).
 *  - Click handler stored on `window` so the notification can open the
 *    End of Day modal on tap.
 */

const STORAGE_KEY_HOUR = 'homehub.endOfDayReminder.hour';     // 'HH' (0-23)
const STORAGE_KEY_ENABLED = 'homehub.endOfDayReminder.enabled'; // 'true' | 'false'
const STORAGE_KEY_FIRED = 'homehub.endOfDayReminder.lastFired'; // ISO date 'YYYY-MM-DD'

export const DEFAULT_REMINDER_HOUR = 21; // 9 PM
const MS_PER_HOUR = 60 * 60 * 1000;

type ReminderTimer = ReturnType<typeof setTimeout> | null;
let currentTimer: ReminderTimer = null;

/**
 * The browser's storage, or null when there is none to use.
 *
 * WHY THIS IS NOT `window.localStorage` DIRECTLY: a browser that refuses
 * storage throws a SecurityError when the app READS `window.localStorage`,
 * not only when it writes to it — Safari with cookies blocked, a private
 * window. Reading the bare `localStorage` global throws for the same reason,
 * so even `typeof localStorage === 'undefined'` throws there: that check
 * cannot tell "there is no storage" from "the browser refuses to answer".
 *
 * WHY IT MATTERS HERE AND NOT ONLY HERE: this module runs on the app's
 * startup path — `scheduleEndOfDayReminder` is called when the app mounts —
 * and on the Settings page, which reads the reminder during render. A throw
 * in either is a crash, not a missing reminder, and there is no error
 * boundary above the one that wraps the pages, so the user would get a
 * blank screen instead of the app telling them their browser keeps nothing.
 *
 * WHY IT IS THE PATTERN `foodTrainer` ALREADY USES: that module stores its
 * training examples the same way, and it is the house answer for a storage
 * that may refuse.
 */
function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Returns true if the user has the notification API available + permission granted. */
export function notificationsAvailable(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getReminderEnabled(): boolean {
  const s = safeStorage();
  if (!s) return false;
  try {
    return s.getItem(STORAGE_KEY_ENABLED) === 'true';
  } catch {
    return false;
  }
}

export function setReminderEnabled(enabled: boolean): void {
  const s = safeStorage();
  if (s) {
    try {
      if (enabled) s.setItem(STORAGE_KEY_ENABLED, 'true');
      else s.removeItem(STORAGE_KEY_ENABLED);
    } catch {
      // The browser refused the write. The reminder is a preference rather
      // than the user's data, and this module has nowhere of its own to
      // report it — the app reports a refused storage write where the state
      // is saved, in `appStorage`.
    }
  }
  scheduleEndOfDayReminder(); // re-schedule (or clear) right away
}

export function getReminderHour(): number {
  const s = safeStorage();
  if (!s) return DEFAULT_REMINDER_HOUR;
  let raw: string | null;
  try {
    raw = s.getItem(STORAGE_KEY_HOUR);
  } catch {
    return DEFAULT_REMINDER_HOUR;
  }
  // `Number(null)` is 0, not NaN — so an unset hour used to read as midnight
  // and the "9 PM by default" reminder fired at 00:00 for anyone who had not
  // touched the slider. Nothing stored means "use the default".
  if (raw === null || raw === '') return DEFAULT_REMINDER_HOUR;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 23) return DEFAULT_REMINDER_HOUR;
  return n;
}

export function setReminderHour(hour: number): void {
  const s = safeStorage();
  if (s) {
    const safe = Math.max(0, Math.min(23, Math.floor(hour)));
    try {
      s.setItem(STORAGE_KEY_HOUR, String(safe));
    } catch {
      // The browser refused the write — see `setReminderEnabled`.
    }
  }
  scheduleEndOfDayReminder();
}

/** Compute the next Date that matches the configured hour (today if not yet passed, else tomorrow). */
export function nextReminderTime(hour: number = getReminderHour()): Date {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    // Today's slot already passed — schedule for tomorrow.
    target.setDate(target.getDate() + 1);
  }
  return target;
}

/** The LOCAL calendar date, 'YYYY-MM-DD'. Not the UTC one — between midnight
 *  and 05:30 in IST the UTC date is still yesterday, and a "fired today"
 *  marker written in UTC suppressed the next morning's reminder. */
function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Did we already fire today? (prevents duplicate if the tab reloads mid-day) */
function hasFiredToday(): boolean {
  const s = safeStorage();
  if (!s) return false;
  let last: string | null;
  try {
    last = s.getItem(STORAGE_KEY_FIRED);
  } catch {
    return false;
  }
  if (!last) return false;
  return last === localDateKey();
}

function markFiredToday(): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY_FIRED, localDateKey());
  } catch {
    // The browser refused the write — see `setReminderEnabled`.
  }
}

/** The function the notification calls when the user taps it. */
let onTapCallback: (() => void) | null = null;

/** Set a callback to fire when the user taps the notification. */
export function setReminderTapHandler(cb: (() => void) | null): void {
  onTapCallback = cb;
}

/** Fire a one-off notification (also useful for the "send test" button in Settings). */
export async function fireReminderNotification(): Promise<'sent' | 'denied' | 'unavailable'> {
  if (!notificationsAvailable()) return 'unavailable';
  if (Notification.permission !== 'granted') return 'denied';
  try {
    const notif = new Notification('🌙 Time to log today\u0027s meals', {
      body: 'Tap to record breakfast, lunch, and dinner — auto-deducts from your fridge.',
      tag: 'homehub-eod',
      icon: '/icon.svg',
      badge: '/icon.svg',
      requireInteraction: true,
    });
    notif.onclick = () => {
      try {
        window.focus();
        onTapCallback?.();
      } catch {}
      notif.close();
    };
    return 'sent';
  } catch {
    return 'denied';
  }
}

/** (Re)schedule the end-of-day notification. Idempotent — safe to call multiple times. */
export function scheduleEndOfDayReminder(): void {
  // Always clear any existing timer first.
  if (currentTimer) {
    clearTimeout(currentTimer);
    currentTimer = null;
  }
  if (typeof window === 'undefined') return;
  if (!getReminderEnabled()) return;
  if (!notificationsAvailable()) return;
  if (Notification.permission !== 'granted') return;
  if (hasFiredToday()) return; // already fired today — wait until tomorrow

  const next = nextReminderTime();
  const delay = next.getTime() - Date.now();
  if (delay <= 0) return;

  currentTimer = setTimeout(() => {
    currentTimer = null;
    void fireReminderNotification();
    markFiredToday();
    // Re-schedule for tomorrow immediately so we don't lose the daily rhythm.
    scheduleEndOfDayReminder();
  }, delay);

  // For debugging in dev tools:
  console.debug(`[endOfDayReminder] next fire at ${next.toISOString()} (in ${Math.round(delay / MS_PER_HOUR)}h)`);
}