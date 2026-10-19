import type { UserConsents } from '../types';

export const DEFAULT_CONSENTS: UserConsents = {
  haptics: true,
  notifications: false,
  location: false,
  personalization: true,
  microphone: false,
};

/**
 * Ask the browser for the microphone, the same way notifications and location
 * are asked. Returns whether it was actually granted, NOT merely whether the
 * prompt was shown — the caller must know the difference, because a browser
 * that stays silent has decided the answer already and no amount of re-asking
 * will change it.
 */
export async function requestMicrophonePermission(): Promise<
  'granted' | 'denied' | 'unavailable'
> {
  if (typeof navigator === 'undefined') return 'unavailable';
  if (!navigator.mediaDevices?.getUserMedia) return 'unavailable';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Release it immediately. Holding the track would leave a recording
    // indicator lit and would fight House Bot for the device later.
    stream.getTracks().forEach((t) => t.stop());
    return 'granted';
  } catch {
    return 'denied';
  }
}

/**
 * Request permission to send browser push notifications. Resolves with the
 * resulting permission state, or `'unavailable'` if the browser doesn't
 * support the Notifications API at all.
 */
export async function requestNotificationPermission(): Promise<
  NotificationPermission | 'unavailable'
> {
  if (typeof window === 'undefined') return 'unavailable';
  if (!('Notification' in window)) return 'unavailable';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export type TestNotificationResult =
  | 'sent'
  | 'denied'
  | 'unavailable'
  | 'default';

/**
 * Send a one-off test notification so the user can confirm the permission
 * works. Returns a status string so the caller can show a friendly toast.
 */
export async function sendTestNotification(): Promise<TestNotificationResult> {
  if (typeof window === 'undefined') return 'unavailable';
  if (!('Notification' in window)) return 'unavailable';
  const perm = await requestNotificationPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'default';
  try {
    new Notification('HomeHub test', {
      body: 'Notifications are working — you\'ll get expiry and low-stock alerts here.',
      tag: 'homehub-test',
      silent: false,
    });
    return 'sent';
  } catch {
    return 'denied';
  }
}

/**
 * Request geolocation. Resolves with the position on success, or null on
 * denial / error / unavailability. Safe to call — catches all exceptions.
 */
export function requestGeolocation(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

/**
 * Human-readable feature descriptions for the consent modal.
 * Keep these short — they live inside toggle rows.
 */
export const CONSENT_LABELS: Record<keyof UserConsents, { title: string; blurb: string }> = {
  haptics: {
    title: 'Haptic feedback',
    blurb: 'A gentle vibration when you tap important buttons.',
  },
  notifications: {
    title: 'Notifications',
    blurb: 'Get reminded before food expires or items run low. (Coming soon)',
  },
  location: {
    title: 'Location',
    blurb: 'Find nearby stores and delivery options later. (Coming soon)',
  },
  microphone: {
    title: 'Microphone',
    blurb: 'Let House Bot listen when you speak. Your voice is never recorded to disk.',
  },
  personalization: {
    title: 'Personalized suggestions',
    blurb: 'Smarter autocomplete based on what you usually cook and buy.',
  },
};