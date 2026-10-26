/**
 * Watching a tab, and telling House Bot what is on it.
 *
 * WHAT THIS IS FOR
 * The Digital stores page opens the real store — amazon.in, jiomart.com —
 * in a new tab. House Bot should be able to talk about what is on that
 * tab, the way it can already talk about a photo you attach to a message.
 *
 * The two live in DIFFERENT TABS, and that is the whole difficulty. The
 * browser's screen share is given to the page that asks for it, and that
 * page keeps the video. House Bot, in another tab, cannot reach into it.
 *
 * So the tab that holds the share captures a frame every couple of seconds
 * and hands it to the others over a BroadcastChannel — which is the one
 * channel the browser gives to tabs of the same site, and is exactly what
 * this is for.
 *
 * WHY A CHANNEL AND NOT A SERVER: the frames never leave the device, and
 * they never sit in a log. A frame of someone's screen is the most private
 * thing this app could hold, and it is held for as long as the share lasts
 * and not a moment longer.
 */

/** The channel the tabs of this app talk to each other on. */
export const SCREEN_WATCH_CHANNEL = 'homehub.screen-watch';

/** A frame of the shared screen. */
export interface WatchFrame {
  /** Base64 WITHOUT the data: prefix, so it can go straight into an image. */
  data: string;
  mediaType: 'image/jpeg';
  /** When it was taken. */
  at: number;
  /** How wide it is, in pixels. */
  width: number;
  height: number;
}

/** What goes over the channel. */
export type WatchMessage =
  | { kind: 'frame'; frame: WatchFrame }
  | { kind: 'status'; watching: boolean; label: string | null }
  | { kind: 'hello' };

/**
 * How wide a captured frame is.
 *
 * WHY NOT THE FULL SIZE: a shared tab is 1200-2000 pixels wide, and a
 * screenshot of that is far more than the model needs to say what is on the
 * screen. 900 pixels wide is plenty to read a product name and a price, and
 * it is a fraction of the bytes to send.
 */
export const WATCH_FRAME_WIDTH = 900;

/**
 * How often a frame is taken.
 *
 * Two seconds is often enough to notice that something changed and rarely
 * enough that the tab is not working for itself.
 */
export const WATCH_FRAME_INTERVAL_MS = 2000;

/**
 * The quality a captured frame is saved at.
 *
 * Lower than a photograph would use: this is a screen, which is mostly flat
 * colour, and it goes over a channel and into a request body.
 */
export const WATCH_FRAME_QUALITY = 0.55;

/**
 * Turn a canvas's data URL into the shape the app sends images in.
 *
 * WHY THE PREFIX IS STRIPPED: the image payload House Bot already sends
 * carries base64 on its own, with the media type beside it. A data: prefix
 * on top of that is a third of the bytes for nothing.
 */
export function frameFromDataUrl(
  dataUrl: string,
  width: number,
  height: number,
): WatchFrame | null {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  return {
    data: dataUrl.slice(comma + 1),
    mediaType: 'image/jpeg',
    at: Date.now(),
    width,
    height,
  };
}

/**
 * Take a frame from a video and return it as base64, without the prefix.
 */
export function grabFrame(
  video: HTMLVideoElement,
  width = WATCH_FRAME_WIDTH,
  quality = WATCH_FRAME_QUALITY,
): WatchFrame | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const scale = Math.min(1, width / vw);
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);

  return frameFromDataUrl(canvas.toDataURL('image/jpeg', quality), w, h);
}

/**
 * The store's page is a different site, so the share has to be asked for
 * against the BROWSER's picker, and the person picks the tab.
 *
 * WHY THE PICKER IS THE ONLY WAY IN: the browser decides what can be
 * shared. A page cannot ask for "the Amazon Fresh tab" by name — it asks
 * for a screen and the person chooses. That is the browser's privacy
 * promise, and this app does not get to pick around it.
 *
 * So the flow is: open the store in a tab, then ask. The person picks the
 * tab they just opened, and the app never learns whether they picked that
 * one or another.
 */
export const SHARE_PICKER_HINT =
  'Choose “Just this tab” and pick the store you just opened.';
