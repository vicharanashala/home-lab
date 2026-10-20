import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Keyboard, Mic, MicOff, ShieldAlert, Check } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store/useStore';
import { blockedReason, micPermissionState, policyAllowsMicrophone, requestMicrophone, watchMicPermission } from '../utils/micPermission';
import type { MicPermission } from '../utils/micPermission';

/**
 * Microphone switch for House Bot.
 *
 * Two separate things are in play and the card keeps them distinct:
 *
 *  - THIS toggle (settings.microphoneEnabled). Ours. Flipping it is instant,
 *    always works, and is what House Bot actually obeys.
 *  - The browser's own grant. Theirs. Once denied it is remembered for the
 *    whole origin and cannot be cleared from code — only from the padlock
 *    menu — so the card has to say so plainly rather than looking broken.
 *
 * Turning the toggle on therefore *asks* for the browser grant. If the browser
 * refuses, the switch snaps back off instead of pretending it worked.
 */
export function MicrophoneCard() {
  const { settings, updateSettings, toast } = useStore();
  // `=== true`, not truthiness: this and useVoice must resolve an absent key
  // the same way, or the card says "off" while House Bot is live.
  const on = settings.microphoneEnabled === true;
  const [perm, setPerm] = useState<MicPermission>('unknown');
  const [busy, setBusy] = useState(false);

  const enabled = on;

  const refresh = useCallback(async () => {
    setPerm(await micPermissionState());
  }, []);

  useEffect(() => {
    void refresh();
    // The user can flip the padlock without reloading; follow it live so the
    // card never shows a stale "blocked".
    return watchMicPermission(setPerm);
  }, [refresh, enabled]);

  const turnOn = async () => {
    setBusy(true);
    try {
      // Shared with House Bot's mic button, so the two can never disagree
      // about what "on" means or how a blocked microphone is explained.
      const res = await requestMicrophone();
      setPerm(res.state);
      if (!res.ok) {
        // Never leave the switch looking on when the browser said no.
        updateSettings({ microphoneEnabled: false });
        toast(res.reason ?? 'Microphone blocked', 'warning');
        return;
      }
      updateSettings({ microphoneEnabled: true });
      toast('Microphone on — House Bot can listen now', 'success');
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const turnOff = () => {
    updateSettings({ microphoneEnabled: false });
    toast('Microphone off', 'info');
  };

  // Deliberately NOT `on && ...`: when the browser has blocked the mic the
  // switch is off, so gating on `on` meant the card fell back to the generic
  // "your browser will ask permission" copy at exactly the moment the user
  // needed the padlock steps. A block has to be explained whether or not the
  // switch happens to be on.
  //
  // The Permissions API is not enough on its own: when the SERVER's
  // Permissions-Policy header disables the microphone, the browser still
  // reports the permission as "granted" and the card would show "Microphone
  // on" for a mic that cannot possibly work.
  const blocked = perm === 'denied' || policyAllowsMicrophone() === false;
  /** On AND actually usable. The pill, the knob and aria-checked must all
   *  agree, or the switch contradicts itself on screen. */
  const effective = on && !blocked;

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-9 h-9 rounded-xl bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300 grid place-items-center">
          <Mic size={18} />
        </span>
        <div>
          <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">Microphone</h3>
          <p className="text-xs text-sage-500 dark:text-ink-300">
            Let House Bot listen when you talk to it.
          </p>
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={on && !blocked}
        aria-label="Microphone"
        disabled={busy}
        onClick={() => (on ? turnOff() : void turnOn())}
        className={clsx(
          'w-full flex items-center gap-3 rounded-2xl p-3 text-left border transition-all active:scale-[.98] disabled:opacity-60',
          effective
            ? 'bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800'
            : blocked
              ? 'bg-tomato-50/60 dark:bg-tomato-900/20 border-tomato-200 dark:border-tomato-800'
              : 'bg-white dark:bg-ink-800 border-sage-200 dark:border-ink-700',
        )}
      >
        <span
          className={clsx(
            'w-9 h-9 rounded-xl grid place-items-center shrink-0',
            effective
              ? 'bg-sage-600 text-white'
              : blocked
                ? 'bg-tomato-100 dark:bg-tomato-900/40 text-tomato-700 dark:text-tomato-300'
                : 'bg-sage-100 dark:bg-ink-700 text-sage-600 dark:text-ink-200',
          )}
        >
          {blocked ? <ShieldAlert size={16} /> : effective ? <Mic size={16} /> : <MicOff size={16} />}
        </span>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-sage-900 dark:text-cream-50">
            {busy ? 'Waiting for permission…' : effective ? 'Microphone on' : 'Microphone off'}
          </div>
          <div
            className={clsx(
              'text-[11px] mt-0.5 leading-snug',
              blocked ? 'text-tomato-600 dark:text-tomato-300' : 'text-sage-500 dark:text-ink-300',
            )}
          >
            {blocked
              ? blockedReason()
              : on
                ? 'House Bot will listen while you talk. Audio is never stored by HomeHub.'
                : blocked
                  ? 'Your browser is blocking the microphone, so switching this on cannot work yet.'
                  : 'Switch on to talk to House Bot. Your browser will ask permission.'}
          </div>
        </div>

        <span
          aria-hidden="true"
          className={clsx(
            'shrink-0 w-9 h-5 rounded-full p-0.5 transition-colors',
            effective ? 'bg-sage-600' : blocked ? 'bg-tomato-500' : 'bg-sage-200 dark:bg-ink-700',
          )}
        >
          {/* Position tracks the EFFECTIVE state, not the stored one. Keying
              the knob off `on` alone put it on the right while the pill was
              red, so a blocked mic looked switched on. */}
          <span
            className={clsx(
              'block w-4 h-4 rounded-full bg-white shadow-soft transition-transform',
              effective ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </span>
      </button>

      {effective && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-sage-600 dark:text-sage-300">
          <Check size={12} />
          Ready — the browser will let HomeHub listen.
        </p>
      )}

      {blocked && policyAllowsMicrophone() !== false && (
        <div className="mt-3 space-y-2">
          {/* Two ways forward, because "the browser said no" is a dead end
              for anyone who does not want to dig through browser settings.
              The first is a different ADDRESS: Chrome stores a microphone
              decision per address, so another one may still ask. The second
              needs no browser permission at all — the keyboard's own dictation
              writes straight into the text box.

              Both hints are about BROWSER settings, so they are hidden when
              the block came from the server's own Permissions-Policy header:
              a different address would be blocked exactly the same way, and
              sending the user there to repeat a failing step is pointless. */}
          <a
            href="http://localhost:8789"
            className="flex items-center gap-2 rounded-xl border border-sage-200 dark:border-sage-800 bg-white dark:bg-ink-800 px-3 py-2 text-[11px] text-sage-700 dark:text-ink-200 hover:bg-sage-50 dark:hover:bg-sage-900/30"
          >
            <ExternalLink size={13} className="shrink-0" />
            <span>
              <span className="font-semibold">Try the local address</span> —{' '}
              http://localhost:8789 is a different address, so Chrome may ask again.
            </span>
          </a>
          <p className="flex items-start gap-2 text-[11px] leading-snug text-sage-600 dark:text-ink-300">
            <Keyboard size={13} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold">Or dictate with your keyboard</span> — in
              Meal Plan, tap &ldquo;Type or dictate the day instead&rdquo;, click the box and
              press the keyboard&rsquo;s mic (🌐 Fn twice on Mac, 🎤 on your phone). It needs
              no browser permission at all.
            </span>
          </p>
        </div>
      )}
    </section>
  );
}