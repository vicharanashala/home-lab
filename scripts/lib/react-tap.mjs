/**
 * A stand-in for React that records every `useState` setter call.
 *
 * WHY THIS EXISTS
 * The meal-plan page's portion logic lives in a click handler, and there is no
 * DOM in a node test — a component cannot be "clicked" with react-dom/server.
 * This shim makes the click observable instead: the page is bundled against
 * this module instead of React, and every value the page writes into state is
 * recorded, so a test can ask "what portion did the editor start on?" and get
 * an answer from the real handler.
 *
 * Only `useState` is wrapped. Every other hook is React's own, untouched, so
 * the page behaves exactly as it does in the browser.
 *
 * React is CommonJS, so the hooks are re-exported by name rather than with
 * `export *` — the bundler needs to see them statically.
 */
import React from 'react';

export const useCallback = React.useCallback;
export const useEffect = React.useEffect;
export const useLayoutEffect = React.useLayoutEffect;
export const useMemo = React.useMemo;
export const useRef = React.useRef;
export const useSyncExternalStore = React.useSyncExternalStore;
export const createElement = React.createElement;
export const Fragment = React.Fragment;

/** Every value written into state since the last reset. */
export function recordedStateWrites() {
  return globalThis.__hh_state_writes ?? [];
}

/** Forget everything recorded so far. */
export function resetStateWrites() {
  globalThis.__hh_state_writes = [];
}

export function useState(initial) {
  const [value, setValue] = React.useState(initial);
  return [
    value,
    (next) => {
      globalThis.__hh_state_writes.push(next);
      setValue(next);
    },
  ];
}
