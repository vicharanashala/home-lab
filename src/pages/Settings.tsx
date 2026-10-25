import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  User,
  Salad,
  Plus,
  X,
  AlertTriangle,
  Calendar,
  Trash2,
  Save,
  Sun,
  Moon,
  Monitor,
  Palette,
  Shield,
  Vibrate,
  Bell,
  MapPin,
  Sparkles,
  Mic,
  Camera,
  Users,
  Minus,
  Archive,
  Download,
  Stethoscope,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import clsx from 'clsx';
import type { DietaryPreference, ThemeMode, UserConsents } from '../types';
import { TopBar } from '../components/TopBar';
import { DietIcon } from '../components/icons/AppIcons';
import { ConfirmModal } from '../components/ConfirmModal';
import { BackupPanel } from '../components/BackupPanel';
import { CONSENT_LABELS, DEFAULT_CONSENTS, requestGeolocation, requestNotificationPermission, sendTestNotification } from '../utils/consent';
import {
  getReminderEnabled,
  getReminderHour,
  nextReminderTime,
  setReminderEnabled,
  setReminderHour,
  scheduleEndOfDayReminder,
  fireReminderNotification,
  notificationsAvailable,
  REMINDER_NOT_SAVED_MESSAGE,
  REMINDER_NOT_TURNED_OFF_MESSAGE,
  REMINDER_HOUR_NOT_SAVED_MESSAGE,
} from '../utils/endOfDayReminder';
import { canVibrate, hapticSuccess } from '../utils/haptics';
import { FoodTrainerModal } from '../components/FoodTrainerModal';
import { MicrophoneCard } from '../components/MicrophoneCard';
import { DataTransferCard } from '../components/DataTransferCard';
import { VoicePickerCard } from '../components/VoicePickerCard';
import { countByLabel } from '../utils/foodTrainer';
import { headCount, suggestedPortionId, PORTION_LEVELS } from '../utils/portions';

const DIET_OPTIONS: {
  id: DietaryPreference;
  label: string;
  emoji: string;
  blurb: string;
  ring: string;
  tint: string;
}[] = [
  { id: 'vegetarian', label: 'Vegetarian', emoji: '🥗', blurb: 'No meat or fish', tint: 'bg-sage-100 text-sage-800', ring: 'ring-sage-300' },
  { id: 'non-vegetarian', label: 'Non-vegetarian', emoji: '🍖', blurb: 'Eats meat & fish', tint: 'bg-tomato-100 text-tomato-700', ring: 'ring-tomato-300' },
  { id: 'vegan', label: 'Vegan', emoji: '🌿', blurb: 'No animal products', tint: 'bg-emerald-100 text-emerald-800', ring: 'ring-emerald-300' },
  { id: 'no-preference', label: 'No preference', emoji: '🍽️', blurb: 'Anything goes', tint: 'bg-butter-100 text-butter-800', ring: 'ring-butter-300' },
];

const COMMON_ALLERGIES = [
  'Gluten', 'Dairy', 'Eggs', 'Peanuts', 'Tree nuts', 'Soy', 'Shellfish', 'Sesame', 'Fish',
];

export function SettingsPage() {
  const navigate = useNavigate();
  const {
    settings,
    updateSettings,
    clearAllData,
    toast,
  } = useStore();

  // Draft state — Save commits.
  const [name, setName] = useState(settings.userName);
  const [diet, setDiet] = useState<DietaryPreference>(settings.dietaryPreference);
  const [allergies, setAllergies] = useState<string[]>(settings.allergies);
  const [customAllergy, setCustomAllergy] = useState('');
  const [expiringSoonDays, setExpiringSoonDays] = useState(settings.expiringSoonDays);
  const [household, setHousehold] = useState(settings.household ?? {
    adults: 2, teens: 0, children: 0, toddlers: 0,
  });
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [, force] = useState(0);
  const [trainerOpen, setTrainerOpen] = useState(false);
  const [trainingCounts, setTrainingCounts] = useState<Record<string, number>>({});

  // The portion level the meal planner will default to. Kept as a single
  // lookup so the label and the serving count can't drift apart in the copy.
  const defaultLevel = PORTION_LEVELS.find((p) => p.id === suggestedPortionId(household));

  // End-of-day reminder local state — synced from localStorage so it persists across reloads.
  const [reminderEnabled, setReminderEnabledLocal] = useState(getReminderEnabled());
  const [reminderHour, setReminderHourLocal] = useState(getReminderHour());
  // WHY THIS IS A REF AND NOT A STATE: it remembers whether the user has
  // already been told that the browser refused the hour, and a re-render must
  // not reset it. A range input reports every step of a drag, so a refused
  // write would otherwise warn once per pixel of the drag.
  const hourRefusalWarned = useRef(false);

  const { setConsents } = useStore();
  const consents: UserConsents = {
    ...DEFAULT_CONSENTS,
    ...settings.consents,
  };
  const toggleConsent = async (key: keyof UserConsents) => {
    const next = !consents[key];
    setConsents({ [key]: next } as Partial<UserConsents>);
    if (next) {
      if (key === 'notifications') await requestNotificationPermission();
      if (key === 'location') await requestGeolocation();
    }
  };

  // Visual flash for the test buttons — independent of whether the
  // vibration motor fires, so the user always sees confirmation.
  const hapticFlashRef = useRef<HTMLButtonElement | null>(null);
  const triggerFlash = (btn: HTMLButtonElement | null) => {
    if (!btn) return;
    btn.classList.remove('haptic-flash');
    // Force reflow so the animation restarts on repeat taps.
    void btn.offsetWidth;
    btn.classList.add('haptic-flash');
    window.setTimeout(() => btn.classList.remove('haptic-flash'), 450);
  };

  const CONSENT_ICONS = {
    haptics: Vibrate,
    notifications: Bell,
    location: MapPin,
    microphone: Mic,
    personalization: Sparkles,
  } as const;

  // If external settings change (e.g. another tab), keep draft in sync.
  useEffect(() => {
    setName(settings.userName);
    setDiet(settings.dietaryPreference);
    setAllergies(settings.allergies);
    setExpiringSoonDays(settings.expiringSoonDays);
    if (settings.household) {
      setHousehold({
        adults: settings.household.adults,
        teens: settings.household.teens,
        children: settings.household.children,
        toddlers: settings.household.toddlers,
      });
    }
  }, [settings.userName, settings.dietaryPreference, settings.allergies, settings.expiringSoonDays, settings.household]);

  const dirty =
    name.trim() !== settings.userName ||
    diet !== settings.dietaryPreference ||
    expiringSoonDays !== settings.expiringSoonDays ||
    JSON.stringify([...allergies].sort()) !== JSON.stringify([...settings.allergies].sort()) ||
    JSON.stringify(household) !==
      JSON.stringify({
        adults: settings.household?.adults ?? 2,
        teens: settings.household?.teens ?? 0,
        children: settings.household?.children ?? 0,
        toddlers: settings.household?.toddlers ?? 0,
      });

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('Name cannot be empty', 'warning');
      return;
    }
    updateSettings({
      userName: trimmed,
      dietaryPreference: diet,
      allergies,
      expiringSoonDays,
      household: { ...household, completed: true },
    });
    toast('Settings saved', 'success');
  };

  const addAllergy = (a: string) => {
    const v = a.trim();
    if (!v) return;
    if (allergies.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setAllergies((cur) => [...cur, v]);
  };
  const removeAllergy = (a: string) => {
    setAllergies((cur) => cur.filter((x) => x !== a));
  };
  const toggleCommon = (a: string) => {
    setAllergies((cur) =>
      cur.some((x) => x.toLowerCase() === a.toLowerCase())
        ? cur.filter((x) => x.toLowerCase() !== a.toLowerCase())
        : [...cur, a],
    );
  };

  const resetEverything = () => {
    clearAllData();
    toast('App data cleared — see you on the welcome screen', 'info');
    // Reload so the welcome modal re-renders cleanly with the empty state.
    window.setTimeout(() => window.location.reload(), 500);
  };

  return (
    <>
      <TopBar title="Settings" subtitle="Personalize your HomeHub" />
      <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-4 pb-32 sm:pb-10 space-y-5">
        {/* Profile */}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-9 h-9 rounded-xl bg-sage-100 text-sage-700 grid place-items-center">
              <User size={18} />
            </span>
            <div>
              <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">Your profile</h3>
              <p className="text-xs text-sage-500 dark:text-ink-300">Used for greetings around the app.</p>
            </div>
          </div>
          <div>
            <label htmlFor="settings-name" className="label">Name</label>
            <input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              maxLength={32}
              autoComplete="off"
            />
          </div>
        </section>

        {/* Household — sizes the meal planner's default portions */}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-9 h-9 rounded-xl bg-sage-100 text-sage-700 grid place-items-center">
              <Users size={18} />
            </span>
            <div>
              <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">Household</h3>
              <p className="text-xs text-sage-500 dark:text-ink-300">
                Cooking for {headCount(household)} · the meal planner cooks the{' '}
                {defaultLevel?.label ?? 'default'} portion ({defaultLevel?.servings ?? 0}{' '}
                servings) by default.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 mt-3">
            {([
              ['adults', 'Adults', 'full portion'],
              ['teens', 'Teens', '12–17 yrs'],
              ['children', 'Children', '4–11 yrs'],
              ['toddlers', 'Toddlers', '1–3 yrs'],
            ] as const).map(([key, label, blurb]) => (
              <div
                key={key}
                className="flex items-center gap-2 rounded-xl border border-sage-200 dark:border-ink-700 px-2.5 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-sage-900 dark:text-cream-50">{label}</p>
                  <p className="text-[10px] text-sage-500 dark:text-ink-400">{blurb}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setHousehold((h) => ({ ...h, [key]: Math.max(0, h[key] - 1) }))}
                  aria-label={`Fewer ${label}`}
                  className="w-7 h-7 rounded-lg bg-sage-100 dark:bg-ink-700 grid place-items-center text-sage-700 dark:text-cream-100"
                >
                  <Minus size={13} />
                </button>
                <span className="w-5 text-center text-sm font-bold tabular-nums text-sage-900 dark:text-cream-50">
                  {household[key]}
                </span>
                <button
                  type="button"
                  onClick={() => setHousehold((h) => ({ ...h, [key]: Math.min(20, h[key] + 1) }))}
                  aria-label={`More ${label}`}
                  className="w-7 h-7 rounded-lg bg-sage-100 dark:bg-ink-700 grid place-items-center text-sage-700 dark:text-cream-100"
                >
                  <Plus size={13} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Diet */}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-9 h-9 rounded-xl bg-sage-100 text-sage-700 grid place-items-center">
              <Salad size={18} />
            </span>
            <div>
              <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">Dietary preference</h3>
              <p className="text-xs text-sage-500 dark:text-ink-300">
                We'll gently flag items in your fridge or list that don't fit.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {DIET_OPTIONS.map((opt) => {
              const active = opt.id === diet;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setDiet(opt.id)}
                  className={clsx(
                    'flex flex-col items-start gap-1.5 rounded-2xl p-4 text-left transition-all active:scale-[.98] border-2',
                    active
                      ? `${opt.tint} border-transparent ring-2 ring-offset-1 ${opt.ring}`
                      : 'bg-white dark:bg-ink-800 border-sage-100 dark:border-ink-700 hover:border-sage-300 dark:hover:border-ink-600 text-sage-700 dark:text-cream-50',
                  )}
                >
                  <DietIcon diet={opt.id} size={26} />
                  <span className="font-display font-bold text-sm">{opt.label}</span>
                  <span className={clsx('text-[11px]', active ? 'opacity-80' : 'text-sage-500')}>
                    {opt.blurb}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Allergies */}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-9 h-9 rounded-xl bg-tomato-50 text-tomato-600 grid place-items-center">
              <AlertTriangle size={18} />
            </span>
            <div>
              <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">Allergies</h3>
              <p className="text-xs text-sage-500 dark:text-ink-300">
                Items whose name contains any of these will get a warning chip.
              </p>
            </div>
          </div>

          <div className="text-xs font-semibold uppercase tracking-wider text-sage-600 mb-2">
            Common allergens
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {COMMON_ALLERGIES.map((a) => {
              const active = allergies.some((x) => x.toLowerCase() === a.toLowerCase());
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleCommon(a)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 border',
                    active
                      ? 'bg-tomato-100 text-tomato-700 border-tomato-200'
                      : 'bg-white dark:bg-ink-800 text-sage-700 dark:text-cream-50 border-sage-200 dark:border-ink-700 hover:bg-sage-50 dark:hover:bg-ink-700',
                  )}
                >
                  {active ? <X size={12} /> : <Plus size={12} />}
                  {a}
                </button>
              );
            })}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customAllergy.trim()) {
                addAllergy(customAllergy);
                setCustomAllergy('');
              }
            }}
            className="flex gap-2 mb-4"
          >
            <input
              value={customAllergy}
              onChange={(e) => setCustomAllergy(e.target.value)}
              placeholder="Add custom allergen"
              className="input flex-1"
              maxLength={32}
            />
            <button
              type="submit"
              disabled={!customAllergy.trim()}
              className="btn-secondary !px-4 disabled:opacity-50"
            >
              <Plus size={16} />
            </button>
          </form>

          {allergies.length > 0 ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-sage-600 mb-2">
                Your list ({allergies.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {allergies.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => removeAllergy(a)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-tomato-100 text-tomato-700 px-3 py-1.5 text-xs font-semibold hover:bg-tomato-200 transition-colors"
                  >
                    {a}
                    <X size={12} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-sage-500 dark:text-ink-300">No allergens on your list.</p>
          )}
        </section>

        {/* Appearance — applies immediately, no Save needed */}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-9 h-9 rounded-xl bg-sage-100 text-sage-700 grid place-items-center">
              <Palette size={18} />
            </span>
            <div>
              <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">
                Appearance
              </h3>
              <p className="text-xs text-sage-500 dark:text-ink-400">
                Pick how HomeHub looks. Changes apply instantly.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'light' as const, label: 'Light', Icon: Sun, tint: 'bg-butter-100 text-butter-800', ring: 'ring-butter-300' },
                { id: 'dark' as const, label: 'Dark', Icon: Moon, tint: 'bg-ink-700 text-cream-50', ring: 'ring-ink-500' },
                { id: 'system' as const, label: 'System', Icon: Monitor, tint: 'bg-sage-100 text-sage-800', ring: 'ring-sage-300' },
              ]
            ).map((opt) => {
              const active = settings.theme === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => updateSettings({ theme: opt.id })}
                  className={clsx(
                    'flex flex-col items-center gap-1.5 rounded-2xl p-3 text-sm font-semibold border-2 transition-all active:scale-[.98]',
                    active
                      ? `${opt.tint} border-transparent ring-2 ring-offset-2 ring-offset-cream-50 dark:ring-offset-ink-900 ${opt.ring}`
                      : 'bg-white dark:bg-ink-800 border-sage-100 dark:border-ink-700 hover:border-sage-300 dark:hover:border-ink-600 text-sage-700 dark:text-ink-300',
                  )}
                  aria-pressed={active}
                >
                  <opt.Icon size={20} />
                  <span className="text-xs">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Expiry alert window */}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-9 h-9 rounded-xl bg-butter-100 text-butter-700 grid place-items-center">
              <Calendar size={18} />
            </span>
            <div>
              <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">Expiry alert window</h3>
              <p className="text-xs text-sage-500 dark:text-ink-300">
                Items expiring within this many days will be flagged.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={14}
              value={expiringSoonDays}
              onChange={(e) => setExpiringSoonDays(Number(e.target.value))}
              className="flex-1 accent-sage-600"
            />
            <div className="rounded-xl bg-sage-100 dark:bg-ink-700 text-sage-800 dark:text-cream-50 font-bold px-3 py-1.5 min-w-[64px] text-center">
              {expiringSoonDays} days
            </div>
          </div>
        </section>

        {/* Permissions */}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-9 h-9 rounded-xl bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300 grid place-items-center">
              <Shield size={18} />
            </span>
            <div>
              <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">Permissions</h3>
              <p className="text-xs text-sage-500 dark:text-ink-300">
                Toggle which device features HomeHub can use. Nothing leaves your device.
              </p>
            </div>
          </div>
          <ul className="space-y-2">
            {(Object.keys(CONSENT_ICONS) as Array<keyof UserConsents>)
              // The microphone has its own card right below this list, and
              // that one asks the browser and tells the truth. A second switch
              // here only wrote a flag, so it read OFF while the mic was live
              // and turned ON without ever prompting. One switch, and it is
              // the real one.
              .filter((k) => k !== 'microphone')
              .map((k) => {
              const Icon = CONSENT_ICONS[k];
              const { title, blurb } = CONSENT_LABELS[k];
              const on = consents[k];
              return (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => toggleConsent(k)}
                    className={clsx(
                      'w-full flex items-center gap-3 rounded-2xl p-3 text-left border transition-all active:scale-[.98]',
                      on
                        ? 'bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800'
                        : 'bg-white dark:bg-ink-800 border-sage-200 dark:border-ink-700',
                    )}
                  >
                    <span
                      className={clsx(
                        'w-9 h-9 rounded-xl grid place-items-center shrink-0',
                        on ? 'bg-sage-600 text-white' : 'bg-sage-100 dark:bg-ink-700 text-sage-600 dark:text-ink-200',
                      )}
                    >
                      <Icon size={16} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-sage-900 dark:text-cream-50">{title}</div>
                      <div className="text-[11px] text-sage-500 dark:text-ink-300 mt-0.5 leading-snug">{blurb}</div>
                    </div>
                    <span
                      aria-hidden="true"
                      className={clsx(
                        'shrink-0 w-9 h-5 rounded-full p-0.5 transition-colors',
                        on ? 'bg-sage-600' : 'bg-sage-200 dark:bg-ink-700',
                      )}
                    >
                      <span
                        className={clsx(
                          'block w-4 h-4 rounded-full bg-white shadow-soft transition-transform',
                          on ? 'translate-x-4' : 'translate-x-0',
                        )}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <MicrophoneCard />
          <Link
            to="/mic-check"
            className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-sage-600 hover:text-sage-800 dark:text-ink-300 dark:hover:text-cream-100"
          >
            <Stethoscope size={13} />
            Microphone not working? Run the check
          </Link>
          <VoicePickerCard />

          {/* Try-it-out buttons */}
          <div className="mt-4 pt-4 border-t border-sage-100 dark:border-ink-700">
            <div className="text-xs font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300 mb-2 px-1">
              Try it out
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                ref={hapticFlashRef}
                onClick={(e) => {
                  triggerFlash(e.currentTarget);
                  const ok = hapticSuccess();
                  if (!ok) {
                    toast('Vibrator is locked — see note below', 'warning');
                  } else {
                    toast('Bzzzt — that was the haptic motor', 'success');
                  }
                }}
                disabled={!consents.haptics}
                className="btn-secondary text-sm !py-2.5 disabled:opacity-40"
              >
                <Vibrate size={14} />
                Test haptic
              </button>
              <button
                type="button"
                onClick={async (e) => {
                  triggerFlash(e.currentTarget);
                  const result = await sendTestNotification();
                  if (result === 'sent') {
                    toast('Sent — check your notification bar', 'success');
                  } else if (result === 'denied') {
                    toast('Notifications blocked — enable them in browser settings', 'warning');
                  } else if (result === 'default') {
                    toast('Tap again and allow notifications when prompted', 'info');
                  } else {
                    toast('Notifications not supported in this browser', 'warning');
                  }
                }}
                disabled={!consents.notifications}
                className="btn-secondary text-sm !py-2.5 disabled:opacity-40"
              >
                <Bell size={14} />
                Test notification
              </button>
            </div>
            {consents.location && (
              <button
                type="button"
                onClick={async (e) => {
                  triggerFlash(e.currentTarget);
                  const pos = await requestGeolocation();
                  if (pos) {
                    const { latitude, longitude } = pos.coords;
                    toast(
                      `Got it — ${latitude.toFixed(3)}, ${longitude.toFixed(3)}. Check Home for nearby stores.`,
                      'success',
                    );
                  } else {
                    toast('Location denied or unavailable', 'warning');
                  }
                }}
                className="btn-secondary w-full text-sm !py-2.5 mt-2"
              >
                <MapPin size={14} />
                Test location
              </button>
            )}

            {/* End-of-day meal-log reminder */}
            <div className="mt-4 pt-4 border-t border-sage-100 dark:border-ink-700">
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300">
                  End-of-day reminder
                </div>
                {reminderEnabled && (
                  <span className="text-[10px] text-sage-500 dark:text-ink-400 tabular-nums">
                    Next: {nextReminderTime(reminderHour).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!reminderEnabled) {
                    if (!notificationsAvailable()) {
                      toast('Notifications not supported in this browser', 'warning');
                      return;
                    }
                    if (Notification.permission === 'default') {
                      const perm = await requestNotificationPermission();
                      if (perm !== 'granted') {
                        toast('Notifications blocked — enable them in browser settings', 'warning');
                        return;
                      }
                    } else if (Notification.permission === 'denied') {
                      toast('Notifications blocked — enable them in browser settings', 'warning');
                      return;
                    }
                    // WHY THE SWITCH STAYS WHERE IT IS WHEN THE WRITE IS
                    // REFUSED: the reminder is scheduled from what the storage
                    // says, and the storage never got the value — so the
                    // reminder is NOT on, and a switch showing it on would be
                    // showing a reminder that will not fire.
                    if (!setReminderEnabled(true)) {
                      toast(REMINDER_NOT_SAVED_MESSAGE, 'warning');
                      return;
                    }
                    setReminderEnabledLocal(true);
                    toast(`Daily reminder set for ${reminderHour}:00`, 'success');
                  } else {
                    // The other direction of the same lie: a refused removal
                    // leaves the reminder ON in the storage, so it would still
                    // fire at the hour it was set for.
                    if (!setReminderEnabled(false)) {
                      toast(REMINDER_NOT_TURNED_OFF_MESSAGE, 'warning');
                      return;
                    }
                    setReminderEnabledLocal(false);
                    toast('Reminder turned off', 'info');
                  }
                }}
                className={clsx(
                  'w-full flex items-center gap-3 rounded-2xl p-3 text-left border transition-all active:scale-[.98]',
                  reminderEnabled
                    ? 'bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800'
                    : 'bg-white dark:bg-ink-800 border-sage-200 dark:border-ink-700',
                )}
              >
                <span
                  className={clsx(
                    'w-9 h-9 rounded-xl grid place-items-center shrink-0',
                    reminderEnabled ? 'bg-sage-600 text-white' : 'bg-sage-100 dark:bg-ink-700 text-sage-600 dark:text-ink-200',
                  )}
                >
                  <Bell size={18} />
                </span>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-sage-900 dark:text-cream-50">
                    {reminderEnabled ? 'Daily reminder ON' : 'Daily reminder OFF'}
                  </div>
                  <div className="text-[11px] text-sage-500 dark:text-ink-300">
                    {reminderEnabled
                      ? `We'll notify you at ${reminderHour}:00 to log today's meals.`
                      : 'Tap to enable — get a nudge at your chosen hour.'}
                  </div>
                </div>
                <div className={clsx(
                  'w-10 h-6 rounded-full transition-colors shrink-0',
                  reminderEnabled ? 'bg-sage-600' : 'bg-sage-200 dark:bg-ink-700',
                )}>
                  <div className={clsx(
                    'w-5 h-5 rounded-full bg-white shadow mt-0.5 transition-transform',
                    reminderEnabled ? 'translate-x-[18px]' : 'translate-x-0.5',
                  )} />
                </div>
              </button>

              {reminderEnabled && (
                <>
                  {/* Hour picker */}
                  <div className="mt-3 flex items-center gap-2">
                    <label className="text-[11px] font-semibold text-sage-600 dark:text-ink-300 w-16 shrink-0">
                      Hour
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={23}
                      step={1}
                      value={reminderHour}
                      onChange={(e) => {
                        const h = Number(e.target.value);
                        // WHY THE SLIDER DOES NOT MOVE WHEN THE WRITE IS
                        // REFUSED: the reminder fires at the hour in the
                        // storage, and the storage still holds the old one.
                        // Moving the slider would show a time the reminder
                        // will not use.
                        if (!setReminderHour(h)) {
                          if (!hourRefusalWarned.current) {
                            hourRefusalWarned.current = true;
                            toast(REMINDER_HOUR_NOT_SAVED_MESSAGE, 'warning');
                          }
                          return;
                        }
                        // A write that worked clears the warning, so a later
                        // refusal is told about again.
                        hourRefusalWarned.current = false;
                        setReminderHourLocal(h);
                      }}
                      className="flex-1 accent-sage-600"
                    />
                    <span className="text-sm font-mono text-sage-900 dark:text-cream-50 w-12 text-right shrink-0 tabular-nums">
                      {String(reminderHour).padStart(2, '0')}:00
                    </span>
                  </div>
                  {/* Send-test */}
                  <button
                    type="button"
                    onClick={async () => {
                      const result = await fireReminderNotification();
                      if (result === 'sent') toast('Test sent — check your notification bar', 'success');
                      else if (result === 'denied') toast('Notifications blocked', 'warning');
                      else toast('Notifications not available', 'warning');
                    }}
                    className="mt-2 w-full btn-secondary text-sm !py-2"
                  >
                    <Bell size={14} />
                    Send test notification now
                  </button>
                </>
              )}
            </div>
            {!canVibrate() && (
              <div className="mt-3 rounded-2xl border border-butter-200/70 dark:border-butter-800/60 bg-butter-50 dark:bg-butter-900/20 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-butter-700 dark:text-butter-300 mt-0.5 shrink-0" />
                  <div className="text-[12px] text-butter-800 dark:text-butter-200 leading-relaxed">
                    <strong className="text-butter-900 dark:text-butter-100">
                      Haptic motor is locked in regular browser tabs.
                    </strong>{' '}
                    To feel the vibrator on iPhone,{' '}
                    <strong>Add to Home Screen</strong> and open HomeHub from
                    there — then vibration works.
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Food trainer — active learning for photo recognition */}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-9 h-9 rounded-xl bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-200 grid place-items-center">
              <Camera size={18} />
            </span>
            <div className="flex-1">
              <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">
                Photo recognition
              </h3>
              <p className="text-xs text-sage-500 dark:text-ink-300">
                Teach HomeHub what each vegetable looks like.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-sage-700 dark:text-cream-100">
                {Object.keys(trainingCounts).length === 0 ? (
                  <span className="italic text-sage-500 dark:text-ink-300">
                    Not trained yet — tap "Train" to teach it your veggies.
                  </span>
                ) : (
                  <>
                    <span className="font-semibold">
                      {Object.values(trainingCounts).reduce((a, b) => a + b, 0)}
                    </span>{' '}
                    examples across{' '}
                    <span className="font-semibold">
                      {Object.keys(trainingCounts).length}
                    </span>{' '}
                    label{Object.keys(trainingCounts).length === 1 ? '' : 's'}
                  </>
                )}
              </div>
              {Object.keys(trainingCounts).length > 0 && (
                <div className="text-[11px] text-sage-500 dark:text-ink-300 mt-1 flex flex-wrap gap-1">
                  {Object.entries(trainingCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([n, c]) => (
                      <span
                        key={n}
                        className="rounded-full bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-200 px-2 py-0.5 font-semibold"
                      >
                        {n} · {c}
                      </span>
                    ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setTrainerOpen(true)}
              className="btn-primary !py-2 !px-4 text-sm shrink-0"
            >
              <Sparkles size={14} />
              Train
            </button>
          </div>
        </section>

        {/* Data transfer */}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-9 h-9 rounded-xl bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300 grid place-items-center">
              <Download size={18} />
            </span>
            <div>
              <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">
                Your data
              </h3>
              <p className="text-xs text-sage-500 dark:text-ink-300">
                Take your kitchen with you — to another browser, another device,
                or another address.
              </p>
            </div>
          </div>
          <DataTransferCard />
        </section>

        {/* Backups */}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-9 h-9 rounded-xl bg-sage-100 text-sage-700 grid place-items-center">
              <Archive size={18} />
            </span>
            <div>
              <h3 className="font-display font-bold text-base text-sage-900 dark:text-cream-50">
                Backups
              </h3>
              <p className="text-xs text-sage-500 dark:text-ink-300">
                A snapshot is saved automatically on this device. Nothing is uploaded.
              </p>
            </div>
          </div>
          <BackupPanel />
        </section>

        {/* Danger zone */}
        <section className="card p-5 border-tomato-200/60">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-9 h-9 rounded-xl bg-tomato-100 text-tomato-600 grid place-items-center">
              <Trash2 size={18} />
            </span>
            <div>
              <h3 className="font-display font-bold text-base text-tomato-700">Reset</h3>
              <p className="text-xs text-sage-500 dark:text-ink-300">
                Clear all data and start over with onboarding.
              </p>
            </div>
          </div>
          <button
            onClick={() => setConfirmingReset(true)}
            className="btn-danger !px-4 !py-2.5 text-sm"
          >
            <Trash2 size={14} />
            Clear all data…
          </button>

          <ConfirmModal
            open={confirmingReset}
            onClose={() => setConfirmingReset(false)}
            onConfirm={resetEverything}
            title="Clear everything?"
            message="This will delete your entire grocery list, all kitchen stock, and reset onboarding. This cannot be undone."
            confirmLabel="Yes, clear everything"
          />

          <FoodTrainerModal
            open={trainerOpen}
            onClose={() => {
              setTrainerOpen(false);
              setTrainingCounts(countByLabel());
            }}
          />
        </section>

        <p className="text-center text-xs text-sage-400 pt-2">
          HomeHub · Personalization is private to your device.
        </p>
      </div>

      {/* Sticky save bar */}
      <div
        className={clsx(
          'fixed bottom-0 inset-x-0 z-30 px-4 sm:px-6 pb-[calc(var(--hh-nav-space)+0.5rem)] sm:pb-4 pt-2 transition-transform',
          dirty ? 'translate-y-0' : 'translate-y-full pointer-events-none',
        )}
      >
        <div className="mx-auto max-w-2xl">
          <div className="rounded-2xl bg-sage-800 text-white shadow-pop p-2 flex items-center gap-2">
            <div className="px-3 text-sm font-semibold flex-1">Unsaved changes</div>
            <button
              onClick={() => navigate(-1)}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-sage-100 hover:bg-sage-700"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="rounded-xl bg-white text-sage-800 px-4 py-2 text-sm font-bold hover:bg-cream-100 active:scale-95 inline-flex items-center gap-1.5"
            >
              <Save size={16} />
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
