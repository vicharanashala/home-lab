/// <reference types="vite/client" />
/**
 * Shared-secret header for bridge API calls.
 *
 * When the bridge is exposed through a public tunnel it sits in front of a
 * paid MiniMax key, so it expects an `x-homehub-token` matching BRIDGE_TOKEN.
 * The value is baked into the bundle by Vite at build time and read from
 * `VITE_BRIDGE_TOKEN`. Leave that unset for local-only use — the bridge also
 * leaves BRIDGE_TOKEN unset in that case, and the gate stays closed.
 */

type ViteEnv = { VITE_BRIDGE_TOKEN?: string };

function readToken(): string {
  try {
    // This MUST be the literal `import.meta.env.VITE_BRIDGE_TOKEN` form with
    // no optional chaining. Vite substitutes that exact pattern at build time
    // and nothing else: a cast, or `import.meta.env?.KEY`, both type-check and
    // read naturally but are never replaced, so the token silently vanished
    // from the bundle and every bridge call came back 401 — which is how
    // photo recognition and the food classifier failed with no visible cause.
    return import.meta.env.VITE_BRIDGE_TOKEN || '';
  } catch {
    return '';
  }
}

/** Merge the token into a fetch `headers` object. No-op when unset. */
export function bridgeHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  const token = readToken();
  return token ? { ...(extra || {}), 'x-homehub-token': token } : { ...(extra || {}) };
}

/** The bridge base URL, or null when unconfigured. */
export function bridgeBase(): string | null {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const v = env?.VITE_OVERWATCH_URL || env?.VITE_API_BASE_URL;
    return v && v.length > 0 ? v.replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}