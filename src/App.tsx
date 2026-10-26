import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import { BottomNav, SideNav } from './components/BottomNav';
import { Toaster } from './components/Toaster';
import { StorageWarning } from './components/StorageWarning';
import { WelcomeModal } from './components/WelcomeModal';
import { HouseholdSurveyModal } from './components/HouseholdSurveyModal';
import { useStore } from './store/useStore';
import { installAutoBackup, snapshotRefusalReporter } from './utils/backup';
import { ConsentModal } from './components/ConsentModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Dashboard } from './pages/Dashboard';
import { GroceryPage } from './pages/Grocery';
import { StockPage } from './pages/Stock';
import { AlertsPage } from './pages/Alerts';
import { HouseBotPage } from './pages/HouseBot';
import { MicDiagnostics } from './pages/MicDiagnostics';
import { useTheme } from './hooks/useTheme';
import { useConsentSync } from './hooks/useConsentSync';
import {
  scheduleEndOfDayReminder,
  setReminderTapHandler,
} from './utils/endOfDayReminder';

// Lazy-load heavier / less-frequently-used routes so the entry bundle stays small.
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const StoresPage = lazy(() => import('./pages/Stores').then((m) => ({ default: m.StoresPage })));
const DigitalStoresPage = lazy(() => import('./pages/DigitalStores').then((m) => ({ default: m.DigitalStoresPage })));
const DiscoverPage = lazy(() => import('./pages/Discover').then((m) => ({ default: m.DiscoverPage })));
const MealPlanPage = lazy(() => import('./pages/MealPlan').then((m) => ({ default: m.default })));
const ShoppingModePage = lazy(() =>
  import('./pages/ShoppingMode').then((m) => ({ default: m.ShoppingModePage })),
);

function PageLoader() {
  return (
    <div className="min-h-[40vh] grid place-items-center">
      <div className="flex flex-col items-center gap-3 text-sage-600 dark:text-sage-300">
        <div className="w-8 h-8 rounded-full border-2 border-sage-300 border-t-sage-600 animate-spin" />
        <span className="text-xs font-semibold uppercase tracking-wider">Loading…</span>
      </div>
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

/**
 * Shows the household survey once, until it has been answered. Gated purely on
 * `household.completed` rather than the welcome flag, so existing users who
 * finished onboarding before this feature existed still get asked — they just
 * won't be asked twice.
 */
function HouseholdSurveyGate() {
  const household = useStore().settings.household;
  if (household?.completed) return null;
  return <HouseholdSurveyModal />;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useStore();
  // Subscribe to theme + apply it on mount.
  useTheme();
  // Sync module-scoped permission flags with settings.
  useConsentSync();

  // Keep a rolling local backup so a cleared browser never costs the lot.
  //
  // WHY THE REPORTER: the automatic snapshot is the path that actually runs —
  // the button in the backup panel is the rare one — so it is the one that
  // must say so when the browser refuses the write. The words are the panel's,
  // so the app says one thing about one event.
  useEffect(() => installAutoBackup(snapshotRefusalReporter(toast)), [toast]);

  // Register the service worker so notifications can use tap-to-open + future push.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[App] service worker registration failed:', err);
      });
      // When the SW asks us to open the End-of-Day modal, navigate + emit an event.
      const onMessage = (event: MessageEvent) => {
        if (event.data?.type === 'open-end-of-day') {
          navigate('/');
          // Defer one frame so the dashboard mounts before the modal opens.
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('homehub:open-end-of-day'));
          }, 50);
        }
      };
      navigator.serviceWorker.addEventListener('message', onMessage);
      return () => navigator.serviceWorker.removeEventListener('message', onMessage);
    }
  }, [navigate]);

  // Schedule the end-of-day reminder every time the app opens, and wire
  // the notification tap handler to launch the End-of-Day modal.
  useEffect(() => {
    setReminderTapHandler(() => {
      navigate('/');
      setTimeout(() => window.dispatchEvent(new CustomEvent('homehub:open-end-of-day')), 50);
    });
    scheduleEndOfDayReminder();
    // Re-schedule every 5 minutes to handle hour-boundary crossings while the tab stays open.
    const t = window.setInterval(scheduleEndOfDayReminder, 5 * 60 * 1000);
    return () => window.clearInterval(t);
  }, [navigate]);

  return (
    <div className="min-h-[100dvh] flex bg-cream-50 dark:bg-ink-900 transition-colors duration-300 relative overflow-hidden">
      {/* Global animated aurora background — purely decorative, behind every page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      >
        <div
          className="absolute -top-32 -left-24 w-[460px] h-[460px] rounded-full opacity-60 dark:opacity-50"
          style={{
            background:
              'radial-gradient(circle, rgba(134, 239, 172, 0.55) 0%, transparent 70%)',
            filter: 'blur(80px)',
            animation: 'appaurora1 28s ease-in-out infinite',
          }}
        />
        <div
          className="absolute -bottom-32 -right-24 w-[420px] h-[420px] rounded-full opacity-55 dark:opacity-45"
          style={{
            background:
              'radial-gradient(circle, rgba(147, 197, 253, 0.5) 0%, transparent 70%)',
            filter: 'blur(80px)',
            animation: 'appaurora2 32s ease-in-out infinite',
          }}
        />
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[380px] h-[380px] rounded-full opacity-30 dark:opacity-25"
          style={{
            background:
              'radial-gradient(circle, rgba(253, 230, 138, 0.45) 0%, transparent 70%)',
            filter: 'blur(90px)',
            animation: 'appaurora3 36s ease-in-out infinite',
          }}
        />
        <style>{`
          @keyframes appaurora1 { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-60px, 40px) scale(1.15); } }
          @keyframes appaurora2 { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(50px, -50px) scale(1.2); } }
          @keyframes appaurora3 { 0%, 100% { transform: translate(-50%, 0) scale(1); } 50% { transform: translate(-30%, -30px) scale(1.1); } }
        `}</style>
      </div>
      <SideNav />
      <div className="flex-1 min-w-0 flex flex-col relative z-10">
        <StorageWarning />
        <main className="flex-1" style={{ paddingBottom: 'var(--hh-nav-space)' }}>
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/grocery" element={<GroceryPage />} />
                <Route path="/stock" element={<StockPage />} />
                <Route path="/alerts" element={<AlertsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/stores" element={<StoresPage />} />
                <Route path="/digital-stores" element={<DigitalStoresPage />} />
                <Route path="/discover" element={<DiscoverPage />} />
                <Route path="/meal-plan" element={<MealPlanPage />} />
                <Route path="/shopping" element={<ShoppingModePage />} />
                <Route path="/house-bot" element={<HouseBotPage />} />
                <Route path="/mic-check" element={<MicDiagnostics />} />
                <Route path="*" element={<Dashboard />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
        <BottomNav />
      </div>
      <Toaster />
      <ConsentModal />
      <WelcomeModal />
      <HouseholdSurveyGate />
      <ScrollToTop />
    </div>
  );
}
