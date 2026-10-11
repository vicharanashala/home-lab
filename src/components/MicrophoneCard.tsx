import { useCallback, useEffect, useState } from 'react';
import { Mic, MicOff, Check, ShieldAlert } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store/useStore';

type MicState = 'granted' | 'denied' | 'prompt' | 'unsupported';

/**
 * Microphone permission, managed properly.
 *
 * Speech recognition is the only part of HomeHub that needs a device
 * permission, and Chrome *remembers* a denial for the whole origin — so
 * after one accidental "Block" the mic simply never works again and the only
 * symptom is a failure inside House Bot. This card makes it fixable: it shows
 * the current state and asks for the mic from Settings, where the user can
 * see what they are agreeing to.
 */
export function MicrophoneCard() {
  const { toast } = useStore();
  const [state, setState] = useState<MicState>('prompt');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (typeof navigator === 'undefined') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }
    try {
      // Not supported in every browser; where it is missing we fall back to
      // simply trying getUserMedia when the user asks.
      const status = await (navigator as any).permissions?.query?.({ name: 'microphone' });
      if (status) {
        setState(status.state as MicState);
        status.onchange = () => setState(status.state as MicState);
      }
    } catch {
      /* Safari throws on permissions.query for microphone — leave as-is */
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const request = useCallback(async () => {
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release it immediately. Holding the mic open here would show a
      // recording indicator for no reason and fight House Bot for the device.
      stream.getTracks().forEach((t) => t.stop());
      // Deliberately NOT re-reading navigator.permissions here. On browsers
      // where permissions.query for microphone is unreliable (Safari) or lags,
      // that would immediately overwrite the successful grant and flip the
      // card back to blocked — which is exactly the confusion this card is
      // meant to remove.
      setState('granted');
      toast('Microphone ready — you can talk to House Bot now', 'success');
    } catch (err) {
      const name = (err as { name?: string })?.name || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setState('denied');
        toast('Microphone was blocked — allow it in the padlock menu, then tap again', 'warning');
      } else if (name === 'NotFoundError') {
        setState('unsupported');
        toast('No microphone found on this device', 'warning');
      } else {
        setState('prompt');
        toast('Could not ask for the microphone just now', 'warning');
      }
    } finally {
      setBusy(false);
    }
  }, [refresh, toast]);

  const LABELS: Record<MicState, { title: string; blurb: string; tone: string }> = {
    granted: {
      title: 'Microphone allowed',
      blurb: 'Tap the mic in House Bot to talk to it.',
      tone: 'text-sage-700 dark:text-sage-300',
    },
    prompt: {
      title: 'Allow microphone',
      blurb: 'Needed to talk to House Bot. Audio is sent to the speech recogniser and never stored by HomeHub.',
      tone: 'text-sage-500 dark:text-ink-300',
    },
    denied: {
      title: 'Microphone is blocked',
      blurb: 'Tap the padlock in the address bar, set Microphone to Allow, then come back and tap this again.',
      tone: 'text-tomato-600 dark:text-tomato-300',
    },
    unsupported: {
      title: 'No microphone available',
      blurb: 'This device or browser cannot record audio.',
      tone: 'text-tomato-600 dark:text-tomato-300',
    },
  };
  const info = LABELS[state];
  const done = state === 'granted';

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-9 h-9 rounded-xl bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300 grid place-items-center">
          <Mic size={18} />
        </span>
        <div>
          <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">Microphone</h3>
          <p className="text-xs text-sage-500 dark:text-ink-300">
            Talk to House Bot by voice.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={request}
        disabled={busy || state === 'unsupported'}
        aria-label={done ? 'Microphone allowed' : 'Allow microphone'}
        className={clsx(
          'w-full flex items-center gap-3 rounded-2xl p-3 text-left border transition-all active:scale-[.98] disabled:opacity-60',
          done
            ? 'bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800'
            : state === 'denied' || state === 'unsupported'
              ? 'bg-tomato-50/60 dark:bg-tomato-900/20 border-tomato-200 dark:border-tomato-800'
              : 'bg-white dark:bg-ink-800 border-sage-200 dark:border-ink-700',
        )}
      >
        <span
          className={clsx(
            'w-9 h-9 rounded-xl grid place-items-center shrink-0',
            done
              ? 'bg-sage-600 text-white'
              : state === 'denied' || state === 'unsupported'
                ? 'bg-tomato-100 dark:bg-tomato-900/40 text-tomato-700 dark:text-tomato-300'
                : 'bg-sage-100 dark:bg-ink-700 text-sage-600 dark:text-ink-200',
          )}
        >
          {state === 'denied' || state === 'unsupported' ? (
            <ShieldAlert size={16} />
          ) : done ? (
            <Check size={16} />
          ) : (
            <MicOff size={16} />
          )}
        </span>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-sage-900 dark:text-cream-50">
            {busy ? 'Asking your browser…' : info.title}
          </div>
          <div className={clsx('text-[11px] mt-0.5 leading-snug', info.tone)}>
            {info.blurb}
          </div>
        </div>

        {state === 'prompt' && !busy && (
          <span className="shrink-0 rounded-lg bg-sage-700 px-2.5 py-1 text-[11px] font-bold text-white">
            Allow
          </span>
        )}
      </button>
    </section>
  );
}