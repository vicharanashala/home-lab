import { useEffect, useRef, useState } from 'react';

/**
 * Tween a numeric value toward a target with an ease-out curve.
 * Returns the current animated value; useful for stat counters.
 */
export function useAnimatedNumber(target: number, durationMs = 600): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = value;
    startRef.current = null;
    let raf = 0;
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const elapsed = t - startRef.current;
      const t01 = Math.min(1, elapsed / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t01, 3);
      const current = fromRef.current + (target - fromRef.current) * eased;
      setValue(current);
      if (t01 < 1) raf = requestAnimationFrame(tick);
      else setValue(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // We intentionally only react to changes in `target`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return Math.round(value);
}