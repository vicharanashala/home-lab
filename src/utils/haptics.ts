/**
 * Haptic feedback via the device's vibration motor. Falls back gracefully
 * on platforms that don't support it (notably iPhone Safari tabs).
 *
 * Use sparingly — a 10ms tap is felt as a subtle "thump". Anything over
 * 20ms feels like an alert and gets annoying.
 */

let hapticsAllowed = true;
export function setHapticsAllowed(allowed: boolean): void {
  hapticsAllowed = allowed;
}

/**
 * Probe whether the device can actually vibrate. On iPhone Safari this
 * returns `false` for normal tabs (only installed PWAs have access to
 * the Taptic Engine), `true` on Android Chrome and most desktop browsers.
 */
export function canVibrate(): boolean {
  if (typeof window === 'undefined') return false;
  const v = (window.navigator as Navigator & {
    vibrate?: (p: number | number[]) => boolean;
  }).vibrate;
  return typeof v === 'function';
}

/**
 * Fire a vibration. Returns `true` if the browser actually fired it.
 * Returns `false` if the user opted out OR the platform doesn't support it.
 */
export function vibrate(pattern: number | number[] = 10): boolean {
  if (!hapticsAllowed) return false;
  if (!canVibrate()) return false;
  const v = (window.navigator as Navigator & {
    vibrate?: (p: number | number[]) => boolean;
  }).vibrate;
  if (typeof v !== 'function') return false;
  try {
    return v(pattern);
  } catch {
    return false;
  }
}

/**
 * Drop-in replacement for the old `haptic()` helper. Returns whether the
 * device actually vibrated so callers can show a useful fallback message.
 */
export function haptic(pattern: number | number[] = 10): boolean {
  return vibrate(pattern);
}

/**
 * Stronger success pattern — multiple pulses with a gap. More noticeable
 * on iPhone than a single 10ms blip which can be too short to perceive.
 */
export const hapticSuccess = () => vibrate([30, 50, 30]);
/** Standard "warning" haptic — three quick pulses. */
export const hapticWarning = () => vibrate([30, 40, 30, 40, 30]);
/** Standard "destructive" haptic — long thump. */
export const hapticDanger = () => vibrate(60);
/** Standard "select" haptic — feather-light. */
export const hapticSelect = () => vibrate(20);