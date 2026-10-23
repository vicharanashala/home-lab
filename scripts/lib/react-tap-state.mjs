/**
 * A stand-in for React that keeps state between renders.
 *
 * WHY THIS EXISTS
 * The spoken-plan sheet decides two things from the same event: what the slot
 * now says, and what that slot is known to be. Both live in `useState`, and
 * the second one decides which recipe the shopping list buys. So a test has
 * to drive the real handlers and then look at the state they produced.
 *
 * `react-dom/server` renders once and throws the tree away, and there is no
 * DOM in a node test, so a chip cannot be "clicked" the usual way. This shim
 * keeps the state in this module instead of in React, which means the
 * component can be rendered again after an event and will see what the last
 * event wrote — the same thing the browser does.
 *
 * Only the hooks the components under test actually use are implemented.
 * Every one of them keeps its slot by call order, so a component that calls
 * its hooks in the same order every render sees the same state every render.
 *
 * `useEffect` deliberately does nothing: the Whisper hook loads a speech
 * model in an effect, and a test must not try to download one.
 */
import React from 'react';

/** State slots, one per `useState` call, in call order. */
const state = [];
/** Ref slots, one per `useRef` call, in call order. */
const refs = [];
/** How many hooks the current render has claimed. */
let cursor = 0;

/**
 * Start a render.
 *
 * The slots are NOT cleared: state has to survive from one render to the
 * next, which is the whole point of this shim. Only the claim counter resets,
 * so each render reads the slots in the same order it wrote them.
 */
export function beginRender() {
  cursor = 0;
}

/** Forget everything, so a test can start from a clean component. */
export function resetState() {
  state.length = 0;
  refs.length = 0;
  cursor = 0;
}

export function useState(initial) {
  const i = cursor++;
  if (state.length <= i) {
    state[i] = { value: typeof initial === 'function' ? initial() : initial };
  }
  const slot = state[i];
  // The updater form is resolved against the value as it is NOW, exactly as
  // React does it — so a handler that reads the previous state sees the
  // previous state, not the value from when the handler was created.
  return [
    slot.value,
    (next) => {
      slot.value = typeof next === 'function' ? next(slot.value) : next;
    },
  ];
}

export function useRef(initial) {
  const i = cursor++;
  if (refs.length <= i) refs[i] = { current: initial };
  return refs[i];
}

export function useCallback(fn) {
  return fn;
}

export function useMemo(fn) {
  return fn();
}

/** Nothing runs: an effect would pull in the microphone or the network. */
export function useEffect() {}

export function useLayoutEffect() {}

export function useSyncExternalStore(_subscribe, getSnapshot) {
  return getSnapshot();
}

export const createElement = React.createElement;
export const Fragment = React.Fragment;
