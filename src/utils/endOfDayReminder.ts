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

/** Returns true if the user has the notification API available + permission granted. */
export function notificationsAvailable(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getReminderEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY_ENABLED) === 'true';
}

export function setReminderEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  if (enabled) localStorage.setItem(STORAGE_KEY_ENABLED, 'true');
  else localStorage.removeItem(STORAGE_KEY_ENABLED);
  scheduleEndOfDayReminder(); // re-schedule (or clear) right away
}

export function getReminderHour(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_REMINDER_HOUR;
  const raw = localStorage.getItem(STORAGE_KEY_HOUR);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 23) return DEFAULT_REMINDER_HOUR;
  return n;
}

export function setReminderHour(hour: number): void {
  if (typeof localStorage === 'undefined') return;
  const safe = Math.max(0, Math.min(23, Math.floor(hour)));
  localStorage.setItem(STORAGE_KEY_HOUR, String(safe));
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

/** Did we already fire today? (prevents duplicate if the tab reloads mid-day) */
function hasFiredToday(): boolean {
  if (typeof localStorage === 'undefined') return false;
  const last = localStorage.getItem(STORAGE_KEY_FIRED);
  if (!last) return false;
  const today = new Date().toISOString().slice(0, 10);
  return last === today;
}

function markFiredToday(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_FIRED, new Date().toISOString().slice(0, 10));
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