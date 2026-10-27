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

/**
 * What goes over the channel.
 *
 * WHY A FRAME NAMES ITS STORE: the name of a store and the picture of it
 * are two facts, and if they travel apart they can be told apart. A frame
 * says which store it is a picture of, so the watcher can never hold one
 * shop's page under another shop's name.
 */
export type WatchMessage =
  | { kind: 'frame'; frame: WatchFrame; label: string | null }
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
 * How long a watch may go without a frame before it is treated as over.
 *
 * WHY THERE IS A DEADLINE AT ALL: the two tabs cannot tell each other that
 * one of them has gone away. The tab holding the share announces when the
 * share stops, but a tab that is CLOSED never announces anything — the
 * browser simply throws the message away with the tab. So the only evidence
 * that survives a closed tab is the frames themselves, and a watch that has
 * stopped receiving frames has stopped, whatever the last message said.
 *
 * WHY IT IS FOUR FRAMES AND NOT ONE: the sharer posts a frame every
 * WATCH_FRAME_INTERVAL_MS, and a browser in the background can be slow to
 * run its timers. One missed frame is a hiccup; four in a row is a share
 * that has ended.
 */
export const WATCH_STALE_MS = WATCH_FRAME_INTERVAL_MS * 4;

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

/**
 * What the watching tab knows.
 *
 * WHY IT LIVES HERE AND NOT IN THE HOOK: the rules for when a watch has
 * ended are rules about the protocol, not about React, and a rule that
 * cannot be tested without a browser is a rule that will not be.
 */
export interface WatchState {
  /** Is a share running somewhere in this app. */
  watching: boolean;
  /** Which store it is. */
  label: string | null;
  /** The most recent frame. */
  frame: WatchFrame | null;
  /** When the watcher last heard from the sharer, in milliseconds. */
  lastSeenAt: number | null;
}

/**
 * Fold a message from the other tabs into what the watcher knows.
 *
 * WHY A STATUS MESSAGE THAT SAYS "STILL SHARING" DOES NOT RESET THE CLOCK:
 * the frames are the evidence that the share is alive. If a status message
 * could refresh the clock on its own, a sharer that had gone quiet could
 * keep a watch alive by talking — and the silence is exactly the thing the
 * clock is there to notice.
 */
export function applyWatchMessage(
  state: WatchState,
  msg: WatchMessage,
  now: number,
): WatchState {
  if (msg.kind === 'frame') {
    // WHICH STORE THE PICTURE BELONGS TO
    //
    // WHY THE PICTURE SAYS WHICH STORE IT IS: a frame is a picture of ONE
    // store, and the name shown beside it has to be that store's name. The
    // name and the picture arrive as two separate messages — a status names
    // the store, a frame carries the picture — and two tabs of this app can
    // share at the same time: the stores page opened twice, one tab sharing
    // Amazon Fresh and the other Big Bazaar. Their pictures cross on the
    // channel, and the name the watcher is holding can be one store's while
    // the picture in its hand is another's.
    //
    // WHY A PICTURE OF ANOTHER STORE IS DROPPED RATHER THAN SWAPPED IN: the
    // watcher is watching one store. Putting another shop's page under this
    // shop's name is the answer to the wrong question — "how much is this?"
    // answered with a different shop's price — and a picture with no name
    // beside it is better than a wrongly named one. The next picture from
    // the store being watched replaces it a second later.
    //
    // WHY A WATCHER THAT IS WATCHING NOTHING ADOPTS THE PICTURE'S STORE: it
    // has no store to be wrong about, and the picture is the only evidence
    // there is.
    //
    // WHY A PICTURE THAT SAYS NOTHING IS TAKEN AS IT WAS: a tab that was
    // open before this was updated posts a frame without a store on it, and
    // it is still a real frame. A picture that does not name a store cannot
    // be wrong about one.
    const frameLabel = typeof msg.label === 'string' ? msg.label : null;
    const sameStore =
      frameLabel === null || state.label === null || frameLabel === state.label;
    return {
      ...state,
      watching: true,
      label: state.label === null ? frameLabel : state.label,
      frame: sameStore ? msg.frame : state.frame,
      lastSeenAt: now,
    };
  }
  if (msg.kind === 'status') {
    // WHY A FRAME IS DROPPED WHEN THE STORE CHANGES: a frame belongs to the
    // store it was taken from. When the share moves to another store, the
    // frame still held is a picture of the OLD one, and keeping it under the
    // NEW name would let House Bot answer a question about the new store
    // with a picture of the old one — the person's "how much is this?"
    // answered with another shop's price, which is worse than saying nothing.
    //
    // WHY THE GAP IS REAL AND NOT THEORETICAL: the first frame of the new
    // store arrives on the next tick of the frame timer, up to two seconds
    // later, and a freshly-opened video may not have a picture yet at all.
    //
    // WHY THE LABEL IS WHAT IS COMPARED: the sharer names the store in every
    // status, and the frame arrives after the status that names the store it
    // was taken from — so the label the watcher holds is the store the held
    // frame came from.
    const sameStore = msg.label === state.label;
    return {
      watching: msg.watching,
      label: msg.label,
      // A share that has stopped leaves no frame to send.
      frame: msg.watching && sameStore ? state.frame : null,
      lastSeenAt: msg.watching ? (state.watching ? state.lastSeenAt : now) : null,
    };
  }
  return state;
}

/**
 * Whether a watch has gone quiet for long enough to call it over.
 *
 * WHY A WATCH THAT NEVER HEARD ANYTHING IS ALREADY OVER: a watch that says
 * it can see a screen, but has no frame and has heard nothing from the
 * sharer, is the false promise this whole rule exists to end.
 */
export function watchHasEnded(state: WatchState, now: number): boolean {
  if (!state.watching) return false;
  if (state.lastSeenAt === null) return true;
  return now - state.lastSeenAt > WATCH_STALE_MS;
}

/**
 * Fold a message in and end a watch that has gone quiet, in one step.
 *
 * WHY ONE FUNCTION AND NOT TWO: the two things have to happen together. A
 * message that says the share is over clears the frame, and a silence that
 * lasts too long has to clear it too — and a watcher that applied the
 * message first and the deadline second would, for one tick, still be
 * holding a frame it had just been told to forget.
 */
export function reduceWatch(
  state: WatchState,
  msg: WatchMessage | null,
  now: number,
): WatchState {
  const next = msg ? applyWatchMessage(state, msg, now) : state;
  if (!watchHasEnded(next, now)) return next;
  // WHY THE NAME SURVIVES THE ENDING: the name of the store is not part of
  // the promise. The FRAME is the promise, and the frame is what goes. A
  // watch that has gone quiet has not necessarily been abandoned — a browser
  // that throttles a background tab's timers, or a frame that was merely
  // late, both look the same from here. So the name is kept, and a watch
  // that comes back to life knows which store it is watching again instead
  // of saying it can see "a shared tab".
  //
  // WHY IT IS NOT LEAKED TO THE OTHER TABS: nothing here leaves the device,
  // and the name is only ever shown while a frame is on screen beside it.
  return { watching: false, label: next.label, frame: null, lastSeenAt: null };
}

/**
 * What a sharer answers when another tab asks whether anyone is sharing.
 *
 * WHY A SHARER THAT HAS STOPPED SAYS NOTHING: the share can end without the
 * tab going away — the person taps another page, and the page unmounts with
 * the share already over. If that sharer kept answering "yes, someone is
 * sharing", the new page would put a frozen picture on the screen and a
 * false promise in House Bot's message box, for a share that ended minutes
 * ago.
 *
 * WHY THE ANSWER IS A LIST RATHER THAN ONE MESSAGE: the status and the
 * frame are two separate messages, and the frame is only sent when there is
 * one to send.
 */
export function sharerReply(
  msg: WatchMessage,
  active: boolean,
  label: string | null,
): WatchMessage[] {
  if (msg.kind !== 'hello') return [];
  if (!active) return [];
  return [{ kind: 'status', watching: true, label }];
}

/**
 * What kind of picture the app is sending.
 *
 * WHY THE KIND TRAVELS WITH THE PICTURE: the app sends two different
 * pictures to House Bot — a photo of food the person took, and a frame of
 * the store tab they are shopping in. The bridge has to answer them
 * differently, and it cannot tell them apart on its own: both arrive in the
 * same field, as base64 with a media type. So the app says which it is.
 *
 * WHY IT MATTERS: the bridge's instruction for a picture is what tells the
 * model how to read it. A screenshot of a price list read as a photograph of
 * food is not a slightly worse answer — it is the answer to a different
 * question, and the person asked about the screen in front of them.
 *
 * WHY 'screen' AND NOT 'store': the frame is whatever tab was shared, and
 * the name says where the picture came from, not what it shows. Which store
 * it is is named separately, and only for the person's benefit.
 */
export const IMAGE_KIND_PHOTO = 'photo';
export const IMAGE_KIND_SCREEN = 'screen';

/** A picture on its way to House Bot. */
export interface ImagePayload {
  /** The media type of the bytes. */
  mediaType: string;
  /** Base64 WITHOUT the data: prefix. */
  data: string;
  /** Which kind of picture this is. */
  kind: typeof IMAGE_KIND_PHOTO | typeof IMAGE_KIND_SCREEN;
}

/**
 * The picture to send with a message, and what it is.
 *
 * WHY THE PHOTO WINS: a photo the person deliberately attached is what they
 * meant to show. The screen is what happened to be in front of them.
 *
 * WHY THE RULE LIVES HERE AND NOT IN THE PAGE: it is a rule about the
 * protocol between the app and the bridge, and a rule that cannot be tested
 * without a browser is a rule that will not be.
 */
export function imagePayloadFor(
  sentImage: { mediaType: string; data: string } | null | undefined,
  watched: { mediaType: string; data: string } | null | undefined,
): ImagePayload | null {
  if (sentImage) {
    return {
      mediaType: sentImage.mediaType,
      data: sentImage.data,
      kind: IMAGE_KIND_PHOTO,
    };
  }
  if (watched) {
    return {
      mediaType: watched.mediaType,
      data: watched.data,
      kind: IMAGE_KIND_SCREEN,
    };
  }
  return null;
}
