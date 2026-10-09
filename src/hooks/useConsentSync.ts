import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { setHapticsAllowed } from '../utils/haptics';

/**
 * Keeps module-scoped utilities (like haptics) in sync with the user's
 * permission settings. Mount once near the app root.
 */
export function useConsentSync() {
  const { settings } = useStore();
  const haptics = settings.consents?.haptics ?? true;
  useEffect(() => {
    setHapticsAllowed(haptics);
  }, [haptics]);
}