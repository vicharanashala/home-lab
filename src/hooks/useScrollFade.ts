import { useCallback, useEffect, useRef } from 'react';

/**
 * Marks a horizontally-scrolling row so CSS can fade the edge that still has
 * content beyond it.
 *
 * Why this exists: the chip rows on Stock, Grocery and Meal Plan scroll
 * sideways with their scrollbar hidden, so without a cue the overflow is
 * invisible. The old CSS just always applied a right-hand fade — which dimmed
 * the final chip even when everything fit, and was switched OFF entirely above
 * 640px, which is precisely where Stock's category row overflows worst
 * (1334px of chips in a 702px box). Six filters were unreachable with no hint.
 *
 * This sets `data-fade` to "left", "right", "both" or removes it, so the fade
 * appears only where there is genuinely more to see.
 */
export function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 2) {
        el.removeAttribute('data-fade');
        return;
      }
      const atStart = el.scrollLeft <= 2;
      const atEnd = el.scrollLeft >= max - 2;
      el.setAttribute('data-fade', atStart ? 'right' : atEnd ? 'left' : 'both');
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Content changes (filters change, items added) alter the scroll length.
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    el.addEventListener('scroll', update, { passive: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  return ref;
}

/** Spread onto an element that already has `.scroll-fade-x`. */
export function useScrollFadeRef<T extends HTMLElement>(): { ref: (el: T | null) => void } {
  const inner = useScrollFade<T>();
  const setRef = useCallback((el: T | null) => { inner.current = el; }, [inner]);
  return { ref: setRef };
}