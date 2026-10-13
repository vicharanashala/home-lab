/**
 * Microphone permission, in one place.
 *
 * Three separate layers decide whether the mic works, and they have to stay
 * distinct or the app blames the wrong one:
 *
 *   1. The browser's speech recognition API. Absent on Firefox, present on
 *      Chrome and Safari.
 *   2. The browser's own grant for this origin. Remembered per site, and a
 *      block can only be cleared from the padlock menu — never from code.
 *   3. Our own switch, settings.microphoneEnabled. Instant, and it is what
 *      House Bot actually obeys.
 *
 * The failure this file exists to prevent: a user who has already fixed (1)
 * and (2) — the OS toggle, the padlock — is still refused, because (3) is
 * off, and the app told them their browser was unsupported. So every caller
 * has to be able to say WHICH layer is stopping them.
 */

export type MicPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * Why the mic is or is not usable, naming the layer responsible.
 *  - 'off'          our switch is off; the browser may be perfectly fine
 *  - 'unsupported'  this browser has no speech recognition at all
 *  - 'ready'        nothing is in the way
 */
export type MicGate = 'ready' | 'off' | 'unsupported';

export function speechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return !!w.SpeechRecognition || !!w.webkitSpeechRecognition;
}

/** Current browser grant. 'unknown' when the browser will not say (Safari). */
export async function micPermissionState(): Promise<MicPermission> {
  if (typeof navigator === 'undefined') return 'unknown';
  try {
    const st = await navigator.permissions?.query?.({ name: 'microphone' } as PermissionDescriptor);
    if (st?.state) return st.state as MicPermission;
  } catch {
    // Safari throws for microphone; treat as "will find out on request".
  }
  return 'unknown';
}

const BLOCKED =
  'Your browser is blocking the microphone. Tap the padlock in the address bar, set Microphone to Allow, then try again.';

export interface MicRequest {
  ok: boolean;
  state: MicPermission;
  /** Plain-language reason, present only when ok is false. */
  reason?: string;
}

/**
 * Subscribe to permission changes (the user flipping the padlock mid-session).
 * Returns an unsubscribe function. Silently does nothing where the browser
 * does not expose permissions for the microphone.
 */
export function watchMicPermission(onChange: (state: MicPermission) => void): () => void {
  if (typeof navigator === 'undefined') return () => {};
  let status: PermissionStatus | null = null;
  try {
    navigator.permissions
      ?.query?.({ name: 'microphone' } as PermissionDescriptor)
      .then((st) => {
        status = st;
        if (st.state) onChange(st.state as MicPermission);
        st.onchange = () => st.state && onChange(st.state as MicPermission);
      })
      .catch(() => { /* Safari throws for microphone */ });
  } catch {
    /* older browsers */
  }
  return () => {
    if (status) status.onchange = null;
  };
}

/**
 * Ask for the microphone and verify the grant actually took.
 *
 * The verification is the point. getUserMedia resolving is not proof the site
 * is permitted, and a switch that reads "on" while the mic is unusable just
 * relocates the confusion from Settings to House Bot.
 */
export async function requestMicrophone(): Promise<MicRequest> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, state: 'denied', reason: 'This device cannot record audio.' };
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const name = (err as { name?: string })?.name || '';
    if (name === 'NotFoundError') {
      return { ok: false, state: 'denied', reason: 'No microphone found on this device.' };
    }
    return { ok: false, state: 'denied', reason: BLOCKED };
  }

  // Release immediately: holding the track would leave a recording indicator
  // lit and would fight House Bot for the device.
  stream.getTracks().forEach((t) => t.stop());

  const state = await micPermissionState();
  if (state === 'denied') return { ok: false, state, reason: BLOCKED };
  return { ok: true, state };
}