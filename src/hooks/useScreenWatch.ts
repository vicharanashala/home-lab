import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SCREEN_WATCH_CHANNEL,
  WATCH_FRAME_INTERVAL_MS,
  grabFrame,
  type WatchFrame,
  type WatchMessage,
} from '../utils/screenWatch';

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
  });

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const labelRef = useRef<string | null>(null);

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
    setState({ watching: false, label: null, error: null, asking: false });
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
      setState({ watching: false, label, error: null, asking: true });
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
          });
          return false;
        }

        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 5 },
          audio: false,
        });
        streamRef.current = stream;
        labelRef.current = label;

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
          if (msg?.kind === 'hello') {
            post({
              kind: 'status',
              watching: true,
              label: labelRef.current,
            });
            const frame = grabFrame(video);
            if (frame) post({ kind: 'frame', frame });
          }
        };

        timerRef.current = window.setInterval(() => {
          const v = videoRef.current;
          if (!v) return;
          const frame = grabFrame(v);
          if (frame) post({ kind: 'frame', frame });
        }, WATCH_FRAME_INTERVAL_MS);

        setState({ watching: true, label, error: null, asking: false });
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
        setState({ watching: false, label, error: message, asking: false });
        return false;
      }
    },
    [post, stop],
  );

  // The share is stopped when this page goes away, so the browser's own
  // "stop sharing" indicator does not keep promising something that is gone.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        /* already stopped */
      }
      streamRef.current = null;
    };
  }, []);

  return { state, start, stop };
}

/** What the watching side knows. */
export interface WatchState {
  /** Is a share running somewhere in this app. */
  watching: boolean;
  /** Which store it is. */
  label: string | null;
  /** The most recent frame. */
  frame: WatchFrame | null;
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
  });
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(SCREEN_WATCH_CHANNEL);
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const msg = event.data as WatchMessage;
      if (!msg) return;
      if (msg.kind === 'frame') {
        setState((s) => ({ ...s, watching: true, frame: msg.frame }));
      } else if (msg.kind === 'status') {
        setState((s) => ({
          ...s,
          watching: msg.watching,
          label: msg.label,
          // A share that has stopped leaves no frame to send.
          frame: msg.watching ? s.frame : null,
        }));
      }
    };

    // Ask whether anyone is sharing, so the indicator is right from the
    // first moment rather than after the next frame.
    channel.postMessage({ kind: 'hello' });

    return () => {
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
