/**
 * The open tabs of the store viewer, as plain data.
 *
 * WHY THIS IS SEPARATE FROM THE COMPONENT: the rules here — what happens
 * when a store is opened twice, what happens to the tab that was showing
 * when another one is closed — are the kind of thing that is easy to get
 * subtly wrong and easy to test, and testing them needs no browser.
 *
 * WHY A TAB IS NEVER THROWN AWAY BY SWITCHING: shopping is comparing. You
 * have Jio Mart open for the vegetables and you want to check the price of
 * the same paneer on Amazon Fresh before you put it in the basket. Coming
 * back to a tab has to show where you left off, not reload the store from
 * the beginning.
 */

/** One open store. */
export interface ViewerTab {
  /** Unique for this tab, so the same store can be open twice. */
  id: string;
  /** Which store this tab is showing. */
  storeId: string;
  /** The store's name, shown on the tab. */
  label: string;
  /** The emoji shown in place of a favicon. */
  emoji: string;
}

/** What the tab strip is showing after an action. */
export interface TabState {
  tabs: ViewerTab[];
  activeId: string;
  /** The counter that gives each new tab its own id. */
  seq: number;
}

/**
 * Open a store.
 *
 * A store that is already open is brought to the front rather than opened
 * twice — unless `alwaysNew` says otherwise, which is what the "+" button
 * wants: two tabs on the same store, side by side, for comparing two
 * searches.
 */
export function openTab(
  state: TabState,
  store: { id: string; name: string; emoji: string },
  { alwaysNew = false }: { alwaysNew?: boolean } = {},
): TabState {
  if (!alwaysNew) {
    const existing = state.tabs.find((t) => t.storeId === store.id);
    if (existing) return { ...state, activeId: existing.id };
  }
  const tab: ViewerTab = {
    id: `${store.id}-${state.seq}`,
    storeId: store.id,
    label: store.name,
    emoji: store.emoji,
  };
  return {
    tabs: [...state.tabs, tab],
    activeId: tab.id,
    seq: state.seq + 1,
  };
}

/**
 * Bring the tab strip in line with the address bar.
 *
 * WHY THIS EXISTS: the address bar says which STORE is showing and the tab
 * strip says which TAB is showing, and a store can be open twice — the "+"
 * button exists for exactly that, so the owner can hold two searches on the
 * same store side by side. The address can only name one of them, so when
 * the route caught up with the tab the owner had just picked, the
 * reconciliation brought the FIRST tab of that store forward and threw the
 * choice away:
 *
 *   the owner taps the second Amazon tab  ->  the viewer shows the first
 *
 * Nothing looked broken — the tab was still in the strip, the address was
 * still right, and the store still loaded. The second tab was simply
 * unreachable once the route had been to another store and back.
 *
 * SO THE TAB ON SCREEN WINS: if the tab that is showing is already showing
 * the store the route names, the strip is already in line and nothing is
 * touched. Only when the route names a store the strip is NOT showing is the
 * strip moved — which is the case where the owner arrived at a store by
 * following a link, and that store's tab is opened or brought forward.
 */
export function syncRouteToTab(
  state: TabState,
  store: { id: string; name: string; emoji: string },
): TabState {
  const showing = state.tabs.find((t) => t.id === state.activeId);
  if (showing && showing.storeId === store.id) return state;
  return openTab(state, store);
}

/**
 * Close a tab.
 *
 * The tab to its LEFT takes over, which is what a browser does. The last tab
 * cannot be closed: there would be nothing to show, and the viewer is a
 * page of its own.
 */
export function closeTab(state: TabState, id: string): TabState {
  if (state.tabs.length <= 1) return state;
  const closedAt = state.tabs.findIndex((t) => t.id === id);
  if (closedAt === -1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  const activeId =
    state.activeId === id
      ? tabs[Math.max(0, closedAt - 1)]?.id ?? tabs[0]?.id ?? ''
      : state.activeId;
  return { ...state, tabs, activeId };
}
