import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SCREEN_WATCH_CHANNEL,
  WATCH_FRAME_INTERVAL_MS,
  grabFrame,
  reduceWatch,
  sharerReply,
  type WatchMessage,
  type WatchState,
} from '../utils/screenWatch';

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

  const post = useCallback((msg: WatchMessage) => {
    try {
      channelRef.current?.postMessage(msg);
    } catch {
      /* the channel is closed; nothing to do */
    }
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    sharingRef.current = false;
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      /* already stopped */
    }
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      v.srcObject = null;
      videoRef.current = null;
    }
    labelRef.current = null;
    setState({
      watching: false,
      label: null,
      error: null,
      asking: false,
      sentFrame: false,
    });
    post({ kind: 'status', watching: false, label: null });
  }, [post]);

  /**
   * Ask the browser for a share, and start watching it.
   *
   * WHY THE TAB IS OPENED FIRST: the browser's picker lists the tabs that
   * can be shared, and the person has to pick the store's tab. If the store
   * is not open yet, it is not in the list to pick.
   *
   * WHY getDisplayMedia IS STILL CALLED IN THE SAME HANDLER: the browser
   * only allows a screen share to be asked for in response to something the
   * person did — a click. Opening a tab does not spend the click.
   */
  const start = useCallback(
    async (label: string, openTab: () => void) => {
      setState({ watching: false, label, error: null, asking: true, sentFrame: false });
      try {
        // Opened first, and not awaited: the picker has to be able to see
        // the tab it is asking about.
        openTab();

        if (!navigator.mediaDevices?.getDisplayMedia) {
          setState({
            watching: false,
            label,
            error: 'This browser cannot share a screen.',
            asking: false,
            sentFrame: false,
          });
          return false;
        }

        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 5 },
          audio: false,
        });
        streamRef.current = stream;
        labelRef.current = label;
        sharingRef.current = true;

        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        try {
          await video.play();
        } catch {
          /* the frame grab will simply find no picture yet */
        }
        videoRef.current = video;

        // The browser's own "Stop sharing" button ends the track, and this is
        // how the app hears about it.
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener('ended', () => stop());
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
            post({ kind: 'frame', frame });
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
            post({ kind: 'frame', frame });
          }
        }, WATCH_FRAME_INTERVAL_MS);

        setState({ watching: true, label, error: null, asking: false, sentFrame: false });
        post({ kind: 'status', watching: true, label });
        return true;
      } catch (err) {
        // The person said no, or the browser refused. That is a normal
        // outcome, not a failure to report loudly.
        const name = (err as { name?: string })?.name;
        const message =
          name === 'NotAllowedError'
            ? 'Screen sharing was not allowed.'
            : name === 'NotFoundError'
              ? 'There was no screen to share.'
              : 'The screen could not be shared.';
        setState({ watching: false, label, error: message, asking: false, sentFrame: false });
        return false;
      }
    },
    [post, stop],
  );

  // The share is stopped when this page goes away, so the browser's own
  // "stop sharing" indicator does not keep promising something that is gone.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      sharingRef.current = false;
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        /* already stopped */
      }
      streamRef.current = null;
      const v = videoRef.current;
      if (v) {
        v.srcObject = null;
        videoRef.current = null;
      }

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
  }, [post]);

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
