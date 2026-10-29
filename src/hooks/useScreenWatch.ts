import { useCallback, useEffect, useRef, useState } from 'react';
// The extension is written out on purpose. Node's ESM resolver will not guess
// '.ts' for a relative path, so a test can only import this file if the
// import says so — and the rule that lives here (a page holds one share, and
// gives the old one back when it takes a new one) is a rule that has to be
// testable without a browser.
import {
  SCREEN_WATCH_CHANNEL,
  SHARE_MONITOR_SURFACES,
  SHARE_SELF_BROWSER_SURFACE,
  SHARE_SURFACE,
  WATCH_FRAME_INTERVAL_MS,
  grabFrame,
  reduceWatch,
  sharerReply,
  type WatchMessage,
  type WatchState,
} from '../utils/screenWatch.ts';

// The watcher's state lives with the protocol it belongs to, but the hook is
// where the rest of the app has always imported it from.
export type { WatchState };

/** What the page holding the share knows about it. */
export interface ShareState {
  /** Is a share running. */
  watching: boolean;
  /** Which store it is, for the person to see. */
  label: string | null;
  /** Why it could not start, if it could not. */
  error: string | null;
  /** Is the browser's picker open right now. */
  asking: boolean;
  /**
   * Has a frame actually reached the other tabs.
   *
   * WHY THIS IS NOT THE SAME AS `watching`: the share being granted only
   * means the person said yes to the browser. Whether the screen is
   * actually arriving is a separate fact, and the page must not tell the
   * person that House Bot can see the store until it is true.
   */
  sentFrame: boolean;
}

/**
 * The side that HOLDS the screen share.
 *
 * The browser's share belongs to the page that asked for it, so this has to
 * live in the page that asked. It captures a frame every couple of seconds
 * and hands it to the other tabs over the channel.
 */
export function useScreenSharer() {
  const [state, setState] = useState<ShareState>({
    watching: false,
    label: null,
    error: null,
    asking: false,
    sentFrame: false,
  });

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const labelRef = useRef<string | null>(null);
  /**
   * Is the share still running.
   *
   * WHY THIS IS NOT `state.watching`: the state is what the page shows, and
   * the page may unmount before React has painted the last change. This is
   * what the protocol answers with, and it has to be right the instant the
   * share ends, not a frame later.
   */
  const sharingRef = useRef(false);
  /**
   * Which start attempt the page is still waiting for.
   *
   * WHY THE ATTEMPT IS NUMBERED: the browser's picker is a question the app
   * cannot rush, and the answer can arrive after the page has moved on.
   * Between asking and being answered, the page can go away, or the person
   * can press Stop, or another store can be asked for. A capture granted
   * after any of those is filming with nothing left to stop it — the
   * browser's own "you are sharing" indicator stays on, and the page that
   * would have let the person stop it is gone.
   *
   * So every attempt carries a number, and the number is what says whether
   * the answer is still wanted.
   */
  const attemptRef = useRef(0);

  const post = useCallback((msg: WatchMessage) => {
    try {
      channelRef.current?.postMessage(msg);
    } catch {
      /* the channel is closed; nothing to do */
    }
  }, []);

  /**
   * Give back everything a share was holding.
   *
   * WHY THIS HAS TO EXIST: the browser's share belongs to this page, and the
   * page can only hold one at a time. If a second share starts without the
   * first being given back, the first capture keeps running — the tab stays
   * filmed and the browser's own "you are sharing" indicator stays on, for a
   * share the page has already forgotten about. The Stop button only knows
   * about the share it was told about, so it cannot stop the other one.
   *
   * WHY IT IS CALLED AFTER THE NEW SHARE IS GRANTED AND NOT BEFORE: the
   * picker can be refused. If the old share were given back before the
   * answer arrived, a refusal would cost the person the share they already
   * had and were happy with.
   */
  const releasePreviousShare = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const old = streamRef.current;
    streamRef.current = null;
    if (old) {
      try {
        old.getTracks().forEach((t) => t.stop());
      } catch {
        /* already stopped */
      }
    }
    const v = videoRef.current;
    if (v) {
      v.srcObject = null;
      videoRef.current = null;
    }
  }, []);

  /**
   * End the share that is running.
   *
   * WHY THE PICKER IS NOT RETIRED HERE: the browser's own "Stop sharing"
   * button ends the capture it belongs to, and says nothing about a picker
   * the person is still answering for another store. That answer is still
   * their answer, so the share they asked for still starts.
   */
  const endCurrentShare = useCallback(() => {
    sharingRef.current = false;
    releasePreviousShare();
    labelRef.current = null;
    setState({
      watching: false,
      label: null,
      error: null,
      asking: false,
      sentFrame: false,
    });
    post({ kind: 'status', watching: false, label: null });
  }, [post, releasePreviousShare]);

  /**
   * The page's Stop button: end the share, and give up on the picker.
   *
   * WHY THE PICKER IS GIVEN UP ON HERE AND NOT IN endCurrentShare: this is
   * the person saying "stop", and a picker they are still looking at is a
   * question the page has already answered.
   */
  const stop = useCallback(() => {
    attemptRef.current += 1;
    endCurrentShare();
  }, [endCurrentShare]);

  /**
   * Ask the browser for a share, and start watching it.
   *
   * WHY THE ASK COMES FIRST, AND THE STORE OPENS AFTER: Chrome only puts
   * the capture picker up for a page that is in front. Opening the store's
   * tab first took the focus away and hid this page, and the request went
   * out to a browser that had no reason to show anything — so nothing
   * happened, and nothing said why.
   *
   * So the request is made while this page is still in front, and the store
   * opens once the browser has answered. Because the capture is of the
   * WINDOW and not of one tab, the window is filmed from the moment it is
   * granted, so the store is already on the screen House Bot is watching.
   *
   * WHY getDisplayMedia IS STILL CALLED IN THE SAME HANDLER: the browser
   * only allows a screen share to be asked for in response to something the
   * person did — a click.
   */
  const start = useCallback(
    async (label: string, openTab: () => void) => {
      // WHICH ATTEMPT THIS IS.
      //
      // WHY IT IS TAKEN FIRST: the picker is asked for here, and the answer
      // comes later — so the number has to be claimed before the question is
      // asked, not after the answer arrives. Every later attempt retires the
      // one before it, and so does the page's Stop button and the page going
      // away.
      const attempt = attemptRef.current + 1;
      attemptRef.current = attempt;
      // WHY THE RUNNING SHARE IS NOT CLEARED HERE: the picker can be refused,
      // and a refusal must not cost the person the share they already had.
      // So while the picker is open the page keeps saying what it is
      // sharing — and keeps its Stop button — and only the "asking" flag
      // changes. The share that IS running is given back further down, once
      // the new one has actually been granted.
      setState((s) =>
        sharingRef.current
          ? { ...s, error: null, asking: true }
          : { watching: false, label, error: null, asking: true, sentFrame: false },
      );
      // The capture the browser granted, if it granted one.
      //
      // WHY IT IS HELD HERE AND NOT ONLY IN THE REF: the share can fail AFTER
      // the browser has granted the capture, and a granted capture keeps
      // filming until something stops its track. The ref only holds a capture
      // once the share has started, so a failure in between would leave a
      // capture running that nothing in the app holds.
      let granted: MediaStream | null = null;

      // THE STORE IS OPENED AT MOST ONCE, and only while the attempt lives.
      //
      // It is opened inside the person's click, which is what keeps Chrome's
      // popup blocker away — a window.open() that is no longer tied to a
      // click is a popup, and a popup is blocked. It was opened after the
      // answer, which is exactly that, and the address bar said "Pop-up
      // blocked" while the page said nothing at all.
      let storeOpened = false;
      const openTheStore = () => {
        if (storeOpened) return;
        storeOpened = true;
        // WHY THE ATTEMPT IS CHECKED HERE: the attempt can die between the
        // question and the answer — the person pressed Stop, or the page went
        // away — and a store opening after the person has gone is worse than
        // a store that did not open: the person is left with a tab they did
        // not ask for, and nothing on screen says it is there.
        if (attemptRef.current !== attempt) return;
        try { openTab(); } catch { /* the popup was blocked */ }
      };

      try {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          setState({
            watching: false,
            label,
            error: 'This browser cannot share a screen.',
            asking: false,
            sentFrame: false,
          });
          // The store is still what was asked for.
          openTheStore();
          return false;
        }

        // THE REQUEST IS MADE FIRST, AND THE STORE IS OPENED IN THE SAME TICK.
        //
        // WHY THE ORDER MATTERS, TWICE OVER.
        //
        // Chrome only puts the capture picker up for a page that is IN
        // FRONT. Asking before the store's tab takes the focus is what makes
        // the picker appear at all.
        //
        // And the store's tab has to be opened inside the person's CLICK,
        // because Chrome's popup blocker refuses a window.open() that is no
        // longer tied to one. Opened a moment later — after the answer — the
        // browser blocked it as a popup and the store never opened at all.
        // The address bar said "Pop-up blocked" and the page said nothing.
        const request = navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: 5,
            // ASK FOR A WINDOW, NOT THE SCREEN.
            //
            // Chrome opens its picker on "Entire screen" unless the page says
            // otherwise, and the whole screen holds the person's bank and
            // their messages, not just the store. Saying "window" opens the
            // picker on the window, where the person picks the one their
            // store is in — the store's page and this app's tab, side by side.
            //
            // WHAT IT DOES NOT DO: it does not take the whole screen AWAY.
            // MDN is plain that this constraint "has no effect on what the
            // user can choose to share" — it is a preference that may reorder
            // the picker, and the screens stay in it either way. The option
            // that takes them out is `monitorTypeSurfaces` below.
            displaySurface: SHARE_SURFACE,
          },
          audio: false,
          // The page asking is allowed to be in the list too, so the person
          // can see what is being offered.
          //
          // WHY IT IS HERE AND NOT INSIDE `video`: the Screen Capture spec
          // puts `selfBrowserSurface` on the options object itself, beside
          // `video` and `audio` — MDN's own example reads it from there. The
          // browser does not look inside the video constraints for it: there
          // it is an unknown constraint, and an unknown constraint is one the
          // browser ignores. It was there, so the hint was silently doing
          // nothing and the app was asking for something it had not asked
          // for.
          //
          // WHY THE CAST: "selfBrowserSurface" is in the spec and in Chrome,
          // but it is newer than the DOM library this project type-checks
          // against, so the compiler has never heard of it.
          ...({ selfBrowserSurface: SHARE_SELF_BROWSER_SURFACE } as Record<string, unknown>),
          // NO WHOLE SCREAMS IN THE PICKER.
          //
          // WHY IT IS NEEDED: `displaySurface` says which kind of surface the
          // app wants, and the whole screen — the person's bank, their
          // messages, everything else they have open — is still one click
          // away in the picker. MDN is plain that the constraint "has no
          // effect on what the user can choose to share". This is the option
          // that takes the screens out of the picker altogether.
          //
          // WHY IT IS HERE AND NOT INSIDE `video`: it is an option of the
          // getDisplayMedia call itself, for the same reason
          // `selfBrowserSurface` is: the browser reads it off the top of the
          // options object, and inside the video constraints it is an unknown
          // constraint, which the browser ignores.
          //
          // WHY IT IS SAFE TO SEND TO A BROWSER THAT HAS NEVER HEARD OF IT:
          // Chrome 119 and later honour it; Safari and older browsers ignore
          // an option they do not know, and are no worse off than before.
          //
          // WHY THE CAST: same as `selfBrowserSurface` above — the option is
          // in the spec and in Chrome, but newer than the DOM library this
          // project type-checks against.
          ...({ monitorTypeSurfaces: SHARE_MONITOR_SURFACES } as Record<string, unknown>),
        });

        // THE STORE IS OPENED A MOMENT LATER — NOT IN THE SAME INSTANT, AND
        // NOT AFTER THE ANSWER.
        //
        // WHY NOT IN THE SAME INSTANT: opening the tab takes the focus and
        // hides this page, and Chrome refuses a share from a page that is no
        // longer in front.
        //
        // WHY NOT AFTER THE ANSWER: by then the person's click is old. Chrome
        // only allows a window.open() that is still tied to a click, and five
        // seconds is how long that lasts. Opened after the answer, Chrome
        // blocked it — the address bar said "Pop-up blocked" and the page
        // said nothing at all.
        //
        // A moment later is the middle of the two: Chrome has taken the
        // request and put the picker up, and the click is still recent
        // enough for the tab to open.
        const openTimer = setTimeout(openTheStore, 350);

        let stream: MediaStream;
        try {
          stream = await request;
        } catch (err) {
          // The picker was refused, or the browser would not give a capture.
          // The store is what the person pressed for, so it opens anyway.
          openTheStore();
          throw err;
        } finally {
          clearTimeout(openTimer);
        }
        granted = stream;

        // THE STORE IS OPENED AFTER THE ASK, AND NOT BEFORE.
        //
        // WHY IT WAS WRONG BEFORE: the tab was opened first, which took the
        // focus and hid this page — and Chrome does not put the capture
        // picker up for a page that is not in front. The request went out,
        // nothing came back, and the app sat waiting for an answer that was
        // never going to arrive. Nothing happened, and nothing said why.
        //
        // WHY IT IS RIGHT NOW: the request is made while this page is still
        // in front, so the picker appears. And because the capture is of the
        // WINDOW and not of one tab, the window is filmed from the moment it
        // is granted — so the store, which opens just afterwards, is already
        // on the screen House Bot is watching.
        openTheStore();

        // THE ANSWER CAME LATE, AND THE PAGE HAS MOVED ON.
        //
        // The browser has granted the capture and will keep filming until
        // something stops its track. But the attempt that asked for it is
        // over: the page went away, or the person pressed Stop, or another
        // store was asked for in the meantime. A capture granted now is
        // filming with nothing left to stop it, so it is given straight back
        // — and no share is started for an answer nobody is waiting for.
        if (attemptRef.current !== attempt) {
          try {
            stream.getTracks().forEach((t) => t.stop());
          } catch {
            /* already stopped */
          }
          return false;
        }

        // The new share is granted, so the old one can be given back now.
        // Not before — see releasePreviousShare: a refused picker must not
        // cost the person the share they already had.
        releasePreviousShare();

        streamRef.current = stream;
        labelRef.current = label;
        sharingRef.current = true;

        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        // WHY PLAY IS NOT WAITED FOR: the video takes a moment to start, and
        // waiting for it here left a window in which the page could go away —
        // or the person could press Stop — while the code after the wait was
        // still going to run. It then carried on as if nothing had happened:
        // it opened a channel on a page that was no longer there, left a frame
        // timer running for ever, and told the other tabs a share was live
        // when the capture had already been given back. The other tabs were
        // told the share was over and then, a moment later, that it was
        // running.
        //
        // WHY IT IS SAFE TO CARRY ON WITHOUT IT: the frame grab already copes
        // with a video that has no picture yet — it finds no width and sends
        // nothing, and the next tick of the frame timer tries again. So there
        // is nothing here to wait for, and nothing that needs to wait for it.
        //
        // WHY THIS MATTERS FOR THE ATTEMPT NUMBER: the attempt is checked
        // after the browser grants the capture, and the code from there to the
        // end is now one unbroken run, so no answer can arrive in the middle
        // of it. The attempt only has to be checked once.
        void video.play().catch(() => {
          /* the frame grab will simply find no picture yet */
        });
        videoRef.current = video;

        // The browser's own "Stop sharing" button ends the track, and this is
        // how the app hears about it.
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener('ended', () => {
            // ONLY THE SHARE THAT IS RUNNING NOW MAY END IT.
            //
            // A track belongs to the share it was captured for. Once a share
            // has been replaced, its track ending says nothing about the
            // share that replaced it — and stopping that one would end a
            // share the person never touched.
            if (streamRef.current !== stream) return;
            endCurrentShare();
          });
        });

        if (!channelRef.current) {
          channelRef.current = new BroadcastChannel(SCREEN_WATCH_CHANNEL);
        }
        channelRef.current.onmessage = (event) => {
          const msg = event.data as WatchMessage;
          if (!msg) return;
          // A sharer that has stopped answers nothing at all. See
          // sharerReply for why that matters.
          const replies = sharerReply(msg, sharingRef.current, labelRef.current);
          if (replies.length === 0) return;
          replies.forEach(post);
          const v = videoRef.current;
          if (!v) return;
          const frame = grabFrame(v);
          if (frame) {
            setState((s) => (s.sentFrame ? s : { ...s, sentFrame: true }));
            // WHY THE PICTURE NAMES ITS STORE: the watcher shows a picture
            // beside the name of a store, and those two have to agree. The
            // name arrives in a status message and the picture in a frame
            // message, and two tabs of this app can share at once — the
            // stores page opened twice — so their pictures cross on the
            // channel. A picture that says which store it is of cannot be
            // shown under another store's name.
            post({ kind: 'frame', frame, label: labelRef.current });
          }
        };

        timerRef.current = window.setInterval(() => {
          const v = videoRef.current;
          if (!v) return;
          const frame = grabFrame(v);
          if (frame) {
            // The same object back when there is nothing to change, so the
            // page is not re-rendered every two seconds for a flag that has
            // already been set.
            setState((s) => (s.sentFrame ? s : { ...s, sentFrame: true }));
            // WHY THE PICTURE NAMES ITS STORE: see the reply path above —
            // the name and the picture are two facts and they have to
            // arrive together, or the watcher can be left holding one
            // shop's page under another shop's name.
            post({ kind: 'frame', frame, label: labelRef.current });
          }
        }, WATCH_FRAME_INTERVAL_MS);

        setState({ watching: true, label, error: null, asking: false, sentFrame: false });
        post({ kind: 'status', watching: true, label });
        return true;
      } catch (err) {
        // The picker was refused, or the browser would not give a capture.
        // The store was opened in the click either way.
        // WHY THE GRANTED CAPTURE IS GIVEN BACK HERE
        //
        // The browser granted the capture and will keep filming until
        // something stops its track. The share did not start, so nothing is
        // holding the capture — and the page is about to say the share
        // failed. A page that says the share failed while the browser keeps
        // filming leaves the person with a capture that nothing in the app
        // can stop: the Stop button is only drawn while the page says it is
        // sharing. This is the orphan the attempt number exists to prevent,
        // reached by a different road.
        //
        // WHY THE RUNNING SHARE IS TOLD APART FROM THIS ONE: the share that
        // was running before the attempt is still the person's, and a failed
        // attempt must not take it away from them — the same rule a refused
        // picker follows. Identity is what tells the two apart: only the
        // capture the page is holding AS the running share is torn down
        // here, and the attempt's own capture is given back on its own.
        const isTheRunningShare = granted !== null && streamRef.current === granted;
        if (isTheRunningShare) {
          // The share that was running before was given back when this
          // capture was registered, so there is nothing left to keep: the
          // page stops saying it is sharing, and the other tabs are told.
          endCurrentShare();
        } else if (granted) {
          try {
            granted.getTracks().forEach((t) => t.stop());
          } catch {
            /* already stopped */
          }
        }
        // WHY A REFUSAL ON AN ABANDONED ATTEMPT IS NOT REPORTED: the page
        // has already said what it is doing — it went away, or the person
        // pressed stop — and this refusal is not news to anyone.
        if (attemptRef.current !== attempt) return false;
        // The person said no, or the browser refused. That is a normal
        // outcome, not a failure to report loudly.
        const name = (err as { name?: string })?.name;
        const message =
          name === 'NotAllowedError'
            ? 'Screen sharing was not allowed.'
            : name === 'NotFoundError'
              ? 'There was no screen to share.'
              : 'The screen could not be shared.';
        // WHY A REFUSAL DOES NOT CLEAR THE RUNNING SHARE: the capture is
        // still filming. The hook only gives a share back when a NEW one has
        // been granted, so a refused picker leaves the old capture alone. If
        // the page said the share was over here it would be telling the truth
        // about the attempt and lying about the capture — and the Stop button,
        // the only way to end a share from inside the app, would go with it.
        setState((s) =>
          sharingRef.current
            ? { ...s, error: message, asking: false }
            : { watching: false, label, error: message, asking: false, sentFrame: false },
        );
        return false;
      }
    },
    [endCurrentShare, post, releasePreviousShare],
  );

  // The share is stopped when this page goes away, so the browser's own
  // "stop sharing" indicator does not keep promising something that is gone.
  useEffect(() => {
    return () => {
      // WHY THE PICKER IS GIVEN UP ON HERE: the page is going away, so it is
      // no longer waiting for an answer. If the person grants the picker
      // after this, the browser hands a capture to a page that is not there
      // — and nothing on the page can stop it.
      attemptRef.current += 1;
      sharingRef.current = false;
      releasePreviousShare();

      // TELL THE OTHER TABS, BEFORE THE CHANNEL IS CLOSED.
      //
      // WHY THIS MATTERS ENOUGH TO SAY OUT LOUD: the person taps House Bot
      // and this page goes away, taking the share with it. Without this
      // message the other tab is never told, and it keeps saying it can see
      // the store — and keeps sending the last frame it was given, a frozen
      // picture of a screen that is no longer being shared.
      //
      // WHY THE CHANNEL IS CLOSED AT ALL: a channel that is left open keeps
      // answering. Another tab asks "is anyone sharing?" and this dead page
      // says yes, and hands over the last frame it still holds. A closed
      // channel cannot answer.
      //
      // WHY THE MESSAGE GOES FIRST: a closed channel cannot post.
      post({ kind: 'status', watching: false, label: null });
      try {
        channelRef.current?.close();
      } catch {
        /* already closed */
      }
      channelRef.current = null;
    };
  }, [post, releasePreviousShare]);

  return { state, start, stop };
}

/**
 * The side that WATCHES.
 *
 * House Bot uses this: it keeps the latest frame, and sends it along with
 * the person's message so the model can see what they are looking at.
 */
export function useScreenWatcher() {
  const [state, setState] = useState<WatchState>({
    watching: false,
    label: null,
    frame: null,
    lastSeenAt: null,
  });
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(SCREEN_WATCH_CHANNEL);
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const msg = event.data as WatchMessage;
      if (!msg) return;
      setState((s) => reduceWatch(s, msg, Date.now()));
    };

    // Ask whether anyone is sharing, so the indicator is right from the
    // first moment rather than after the next frame.
    channel.postMessage({ kind: 'hello' });

    // THE DEADLINE.
    //
    // A sharer that goes away without a word — a tab that is closed, a
    // browser that is killed — leaves no message for the watcher to hear.
    // So the watcher times the silence itself, and ends a watch that has
    // stopped receiving frames. Without this, House Bot would go on saying
    // it can see the store, and go on sending the last frame it was given,
    // for a share that ended minutes ago.
    const deadline = window.setInterval(() => {
      setState((s) => reduceWatch(s, null, Date.now()));
    }, WATCH_FRAME_INTERVAL_MS);

    return () => {
      window.clearInterval(deadline);
      try {
        channel.close();
      } catch {
        /* already closed */
      }
      channelRef.current = null;
    };
  }, []);

  return state;
}
