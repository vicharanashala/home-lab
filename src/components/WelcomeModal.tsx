import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Home,
  Salad,
  Drumstick,
  Leaf,
  Utensils,
  Plus,
  X,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { DietIcon } from './icons/AppIcons';
import clsx from 'clsx';
import type { DietaryPreference } from '../types';

const DIET_OPTIONS: {
  id: DietaryPreference;
  label: string;
  emoji: string;
  blurb: string;
  icon: typeof Salad;
  tint: string;
  ring: string;
}[] = [
  {
    id: 'vegetarian',
    label: 'Vegetarian',
    emoji: '🥗',
    blurb: 'No meat or fish',
    icon: Salad,
    tint: 'bg-sage-100 text-sage-800',
    ring: 'ring-sage-300',
  },
  {
    id: 'non-vegetarian',
    label: 'Non-vegetarian',
    emoji: '🍖',
    blurb: 'Eats meat & fish',
    icon: Drumstick,
    tint: 'bg-tomato-100 text-tomato-700',
    ring: 'ring-tomato-300',
  },
  {
    id: 'vegan',
    label: 'Vegan',
    emoji: '🌿',
    blurb: 'No animal products',
    icon: Leaf,
    tint: 'bg-emerald-100 text-emerald-800',
    ring: 'ring-emerald-300',
  },
  {
    id: 'no-preference',
    label: 'No preference',
    emoji: '🍽️',
    blurb: 'Anything goes',
    icon: Utensils,
    tint: 'bg-butter-100 text-butter-800',
    ring: 'ring-butter-300',
  },
];

const COMMON_ALLERGIES = [
  'Gluten',
  'Dairy',
  'Eggs',
  'Peanuts',
  'Tree nuts',
  'Soy',
  'Shellfish',
  'Sesame',
  'Fish',
];

type Step = 1 | 2 | 3;

/**
 * Blocking 3-step onboarding modal: name → diet → allergies.
 * Saves only at the end so a user can step back without committing partial state.
 */
export function WelcomeModal() {
  const { settings, updateSettings } = useStore();

  const isOpen = !settings.hasSeenWelcome || !settings.userName.trim();
  const [step, setStep] = useState<Step>(1);

  // Local draft state — only committed on Finish.
  const [name, setName] = useState(settings.userName ?? '');
  const [diet, setDiet] = useState<DietaryPreference>(settings.dietaryPreference ?? 'no-preference');
  const [allergies, setAllergies] = useState<string[]>(settings.allergies ?? []);
  const [customAllergy, setCustomAllergy] = useState('');

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 250);
    return () => window.clearTimeout(t);
  }, [isOpen, step]);

  if (!isOpen) return null;

  const trimmedName = name.trim();
  const canAdvanceStep1 = trimmedName.length > 0;
  const canFinish = trimmedName.length > 0;

  const addAllergy = (a: string) => {
    const v = a.trim();
    if (!v) return;
    setAllergies((cur) => (cur.some((x) => x.toLowerCase() === v.toLowerCase()) ? cur : [...cur, v]));
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

  const handleNext = () => {
    if (step === 1 && !canAdvanceStep1) return;
    if (step < 3) setStep((s) => (s + 1) as Step);
    else finish();
  };

  const handleBack = () => {
    if (step > 1) setStep((s) => (s - 1) as Step);
  };

  const finish = () => {
    if (!canFinish) return;
    updateSettings({
      userName: trimmedName,
      dietaryPreference: diet,
      allergies,
      hasSeenWelcome: true,
    });
  };

  const skipAllergies = () => {
    // Skip = commit current state with no further changes. Don't clear anything
    // the user may have already toggled.
    finish();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div className="absolute inset-0 bg-sage-900/40 dark:bg-black/70 backdrop-blur-sm animate-fade-in" />

      <div className="relative w-full sm:max-w-md mx-0 sm:mx-4 rounded-t-3xl sm:rounded-3xl bg-cream-50 dark:bg-ink-800 shadow-pop overflow-hidden animate-slide-up max-h-[96vh] flex flex-col">
        {/* Decorative top */}
        <div className="relative h-28 sm:h-36 bg-gradient-to-br from-sage-600 to-sage-700 overflow-hidden shrink-0">
          <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-white/10" />
          <div className="absolute -right-2 bottom-2 w-24 h-24 rounded-full bg-white/5" />
          <div className="absolute left-6 bottom-4 text-white">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold mb-1.5">
              <Home size={12} />
              HomeHub
            </div>
            <h2
              id="welcome-title"
              className="font-display text-2xl sm:text-3xl font-extrabold leading-tight"
            >
              Welcome home
            </h2>
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 pt-3 shrink-0">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={clsx(
                'h-1.5 rounded-full transition-all',
                n === step ? 'w-8 bg-sage-600' : n < step ? 'w-4 bg-sage-400 dark:bg-sage-500' : 'w-2 bg-sage-200 dark:bg-ink-600',
              )}
            />
          ))}
        </div>

        {/* Step body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 pt-4 pb-2">
          {step === 1 && (
            <div className="space-y-4 animate-fade-in">
              <div>
                <p className="text-sage-700 dark:text-ink-200 leading-relaxed">
                  Let's set things up so we can greet you properly. What should we call you?
                </p>
              </div>
              <div>
                <label htmlFor="welcome-name" className="label">
                  Your first name
                </label>
                <input
                  id="welcome-name"
                  ref={inputRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Priya"
                  autoComplete="given-name"
                  className="input text-lg"
                  maxLength={32}
                />
                <p className="mt-1.5 text-xs text-sage-500 dark:text-ink-300">
                  We only use this to personalize greetings — it stays on your device.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-fade-in">
              <div>
                <p className="text-sage-700 dark:text-ink-200 leading-relaxed">
                  How does your household eat? We'll use this to gently flag items that don't fit.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {DIET_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = opt.id === diet;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDiet(opt.id)}
                      className={clsx(
                        'relative flex flex-col items-start gap-2 rounded-2xl p-4 text-left transition-all active:scale-[.98] border-2',
                        active
                          ? `${opt.tint} border-transparent ring-2 ring-offset-1 dark:ring-offset-ink-800 ${opt.ring}`
                          : 'bg-white dark:bg-ink-800 border-sage-100 dark:border-ink-700 hover:border-sage-300 dark:hover:border-ink-600 text-sage-700 dark:text-cream-50',
                      )}
                    >
                      <DietIcon diet={opt.id} size={30} />
                      <span className="font-display font-bold text-base leading-tight">
                        {opt.label}
                      </span>
                      <span className={clsx('text-xs', active ? 'opacity-80' : 'text-sage-500 dark:text-ink-300')}>
                        {opt.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 animate-fade-in">
              <div>
                <p className="text-sage-700 dark:text-ink-200 leading-relaxed">
                  Anything your household is allergic to? Pick the common ones, or add your own.
                </p>
                <p className="text-xs text-sage-500 dark:text-ink-300 mt-1">
                  You can change these anytime in Settings.
                </p>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300 mb-2">
                  Common allergens
                </div>
                <div className="flex flex-wrap gap-2">
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
                            ? 'bg-tomato-100 dark:bg-tomato-900/40 text-tomato-700 dark:text-tomato-300 border-tomato-200 dark:border-tomato-800'
                            : 'bg-white dark:bg-ink-800 text-sage-700 dark:text-cream-50 border-sage-200 dark:border-ink-700 hover:bg-sage-50 dark:hover:bg-ink-700',
                        )}
                      >
                        {active ? <X size={12} /> : <Plus size={12} />}
                        {a}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300 mb-2">
                  Add custom
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (customAllergy.trim()) {
                      addAllergy(customAllergy);
                      setCustomAllergy('');
                    }
                  }}
                  className="flex gap-2"
                >
                  <input
                    value={customAllergy}
                    onChange={(e) => setCustomAllergy(e.target.value)}
                    placeholder="e.g. Mustard"
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
              </div>

              {allergies.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-sage-600 dark:text-ink-300 mb-2">
                    Your list ({allergies.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {allergies.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => removeAllergy(a)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-tomato-100 dark:bg-tomato-900/40 text-tomato-700 dark:text-tomato-300 px-3 py-1.5 text-xs font-semibold hover:bg-tomato-200 dark:hover:bg-tomato-900/60 transition-colors"
                      >
                        {a}
                        <X size={12} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 pb-5 pt-2 border-t border-sage-100 dark:border-ink-700 shrink-0">
          <div className="flex items-center gap-2">
            {step > 1 ? (
              <button
                type="button"
                onClick={handleBack}
                className="btn-secondary flex-1"
              >
                <ArrowLeft size={16} />
                Back
              </button>
            ) : (
              <div className="flex-1" />
            )}

            {step === 3 ? (
              <>
                <button
                  type="button"
                  onClick={skipAllergies}
                  className="btn-ghost text-sage-600 dark:text-ink-300 text-sm"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={finish}
                  disabled={!canFinish}
                  className="btn-primary flex-1 disabled:opacity-50"
                >
                  <Sparkles size={18} />
                  Get started
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                disabled={!canAdvanceStep1}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                Next
                <ArrowRight size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
