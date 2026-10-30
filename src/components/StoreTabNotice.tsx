import { STORE_TAB_BLOCKED_TEXT, STORE_TAB_OPENED_TEXT } from '../utils/screenWatch';

/**
 * What the stores screen says about the share that just failed, and about the
 * store's tab.
 *
 * WHY IT IS ITS OWN COMPONENT: the sentence about the store tab used to be
 * written into the page next to the error, and it said the same thing every
 * time — "The store still opened." — whether the browser had opened the tab
 * or taken it away. It is a claim about something the app did not check, and
 * the browser's popup blocker checks it for the app: a pop-up is only allowed
 * while the page still holds the person's gesture, and the store's tab is
 * opened a moment after the capture is asked for, so the gesture is still
 * alive — but the question has to be asked before the tab is opened, because
 * `window.open` consumes the gesture. See `popUpAllowedNow`.
 *
 * WHY THE LINK IS A REAL LINK AND NOT A BUTTON: a link the person CLICKS is a
 * navigation the browser always allows — a pop-up blocker has nothing to
 * block in it — so the store is one click away even when the automatic tab
 * was refused. A button would have to open the tab itself, and would be
 * blocked the same way.
 */
export interface StoreTabNoticeProps {
  /** What went wrong with the share, if anything did. */
  error: string | null;
  /** The store whose tab the browser blocked, if it blocked one. */
  blockedStore: { name: string; url: string } | null;
}

export function StoreTabNotice({ error, blockedStore }: StoreTabNoticeProps) {
  if (!error && !blockedStore) return null;
  return (
    <>
      {error && (
        <p className="text-[11px] text-tomato-600 dark:text-tomato-300">
          {error}
          {blockedStore ? '' : ` ${STORE_TAB_OPENED_TEXT}`}
        </p>
      )}
      {blockedStore && (
        <p className="text-[11px] text-sage-600 dark:text-ink-300 leading-relaxed">
          {STORE_TAB_BLOCKED_TEXT}{' '}
          <a
            href={blockedStore.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 font-semibold"
          >
            Open {blockedStore.name}
          </a>
        </p>
      )}
    </>
  );
}
