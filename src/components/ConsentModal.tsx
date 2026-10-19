import { useState } from 'react';
import {
  Vibrate,
  Bell,
  MapPin,
  Sparkles,
  Shield,
  Mic,
  X,
} from 'lucide-react';
import { Modal } from './Modal';
import { useStore } from '../store/useStore';
import type { UserConsents } from '../types';
import {
  CONSENT_LABELS,
  DEFAULT_CONSENTS,
  requestGeolocation,
  requestMicrophonePermission,
  requestNotificationPermission,
} from '../utils/consent';
import clsx from 'clsx';

interface ConsentRow {
  key: keyof UserConsents;
  Icon: typeof Vibrate;
  comingSoon?: boolean;
}

const ROWS: ConsentRow[] = [
  { key: 'haptics', Icon: Vibrate },
  { key: 'microphone', Icon: Mic },
  { key: 'notifications', Icon: Bell, comingSoon: true },
  { key: 'location', Icon: MapPin, comingSoon: true },
  { key: 'personalization', Icon: Sparkles },
];

/**
 * First-launch consent dialog. Asks the user which optional features they
 * want to enable. Saved via the store so we never ask again unless the user
 * re-opens it from Settings.
 */
export function ConsentModal() {
  const { settings, setConsents, markConsentsSeen, updateSettings } = useStore();
  const [choices, setChoices] = useState<UserConsents>(() => ({
    ...DEFAULT_CONSENTS,
    ...settings.consents,
  }));
  const [open, setOpen] = useState(!settings.hasSeenConsents);

  if (settings.hasSeenConsents) return null;

  const close = () => setOpen(false);

  /**
   * Turn a consent into reality, and only if it actually worked.
   *
   * A browser that has already decided says nothing and simply fails, so a
   * request that returns "denied" must NOT leave the switch reading "on" —
   * House Bot would then sit waiting for a microphone it will never be given.
   */
  const applyConsent = async (key: 'microphone', chosen: boolean) => {
    if (!chosen) {
      updateSettings({ microphoneEnabled: false });
      return;
    }
    const granted = await requestMicrophonePermission();
    updateSettings({ microphoneEnabled: granted === 'granted' });
    if (granted !== 'granted') {
      // Clear the stored consent too, not just the live switch. Leaving the
      // consent on while the microphone is off would show the permission as
      // granted in Settings long after the browser said no.
      setChoices((c) => ({ ...c, microphone: false }));
      setConsents({ microphone: false });
    }
  };

  const handleAcceptAll = async () => {
    const all: UserConsents = {
      haptics: true,
      notifications: true,
      location: true,
      personalization: true,
      microphone: true,
    };
    setConsents(all);
    // Trigger browser permission prompts for the ones that need them.
    if (all.notifications) await requestNotificationPermission();
    if (all.location) await requestGeolocation();
    await applyConsent('microphone', true);
    markConsentsSeen();
    close();
  };

  const handleAcceptSelected = async () => {
    setConsents(choices);
    if (choices.notifications) await requestNotificationPermission();
    if (choices.location) await requestGeolocation();
    await applyConsent('microphone', !!choices.microphone);
    markConsentsSeen();
    close();
  };

  const handleDeclineAll = () => {
    setConsents({
      haptics: false,
      notifications: false,
      location: false,
      personalization: false,
      microphone: false,
    });
    markConsentsSeen();
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="A few permissions"
      footer={
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleAcceptAll}
            className="btn-primary w-full"
          >
            <Shield size={18} />
            Accept all
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleAcceptSelected}
              className="btn-secondary text-sm !py-2.5"
            >
              Accept selected
            </button>
            <button
              type="button"
              onClick={handleDeclineAll}
              className="btn-ghost text-sm"
            >
              Decline all
            </button>
          </div>
          <p className="text-[11px] text-sage-500 dark:text-ink-300 text-center pt-1">
            You can change any of these in <strong>Settings → Permissions</strong> anytime.
          </p>
        </div>
      }
    >
      <div className="pt-1 pb-1 space-y-4">
        <p className="text-sm text-sage-700 dark:text-ink-200 leading-relaxed">
          HomeHub is private to your device, but a few features need your OK
          before they kick in. Toggle each one to your preference.
        </p>

        <ul className="space-y-2">
          {ROWS.map((row) => {
            const { title, blurb } = CONSENT_LABELS[row.key];
            const checked = choices[row.key];
            return (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() =>
                    setChoices((c) => ({ ...c, [row.key]: !c[row.key] }))
                  }
                  className={clsx(
                    'w-full flex items-start gap-3 rounded-2xl p-3.5 text-left border-2 transition-all active:scale-[.98]',
                    checked
                      ? 'bg-sage-50 dark:bg-sage-900/30 border-sage-300 dark:border-sage-700'
                      : 'bg-white dark:bg-ink-800 border-sage-200 dark:border-ink-700 hover:border-sage-300 dark:hover:border-ink-600',
                  )}
                >
                  <span
                    className={clsx(
                      'w-10 h-10 rounded-xl grid place-items-center shrink-0',
                      checked
                        ? 'bg-sage-600 text-white'
                        : 'bg-sage-100 dark:bg-ink-700 text-sage-600 dark:text-ink-200',
                    )}
                  >
                    <row.Icon size={18} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-sm text-sage-900 dark:text-cream-50">
                        {title}
                      </span>
                      {row.comingSoon && (
                        <span className="chip bg-butter-100 dark:bg-butter-900/30 text-butter-800 dark:text-butter-200 text-[10px]">
                          Coming soon
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-sage-600 dark:text-ink-200 mt-0.5 leading-snug">
                      {blurb}
                    </p>
                  </div>
                  {/* Toggle visual */}
                  <span
                    aria-hidden="true"
                    className={clsx(
                      'shrink-0 w-10 h-6 rounded-full p-0.5 transition-colors mt-1',
                      checked ? 'bg-sage-600' : 'bg-sage-200 dark:bg-ink-700',
                    )}
                  >
                    <span
                      className={clsx(
                        'block w-5 h-5 rounded-full bg-white shadow-soft transition-transform',
                        checked ? 'translate-x-4' : 'translate-x-0',
                      )}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="rounded-2xl border border-sage-200/60 dark:border-ink-700 bg-sage-50/50 dark:bg-ink-800/50 p-3 text-[12px] text-sage-700 dark:text-ink-200 leading-relaxed">
          <strong className="text-sage-900 dark:text-cream-50">We don't collect your data.</strong>{' '}
          HomeHub stores everything on your device. The above toggles only
          enable optional device features — nothing is sent to us.
        </div>
      </div>
    </Modal>
  );
}