import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Send, ArrowUp, SquarePen, Globe, ExternalLink, Clock, ShoppingCart, Mic, MicOff, Volume2, VolumeX, MonitorPlay } from 'lucide-react';
import { useStore } from '../store/useStore';
import { STARTER_RECIPES } from '../data/recipes';
import { INDIAN_RECIPES } from '../data/indianRecipes';
import {
  type CsvRecipe,
  type ScoredCsvRecipe,
  searchCsvRecipes,
} from '../utils/csvRecipeSearch';
import { parseGroceryList } from '../utils/groceryListParser';
import { bridgeHeaders } from '../utils/bridgeToken';
import { blockedReason } from '../utils/micPermission';
import { applyAgentActions } from '../utils/agentActions';
import { DishIcon } from '../components/icons/DishIcons';
import { ThemeToggle } from '../components/ThemeToggle';
import { PhotoAttachButton, AttachedImageChip, usePhotoAttach } from '../components/PhotoAttach';
import { useScreenWatcher } from '../hooks/useScreenWatch';
import { useVoice } from '../hooks/useVoice';

type Msg = {
  from: 'me' | 'bot';
  text: string;
  ts: number;
  groceryRequest?: boolean;
  /** Thumbnail of a photo the user attached to this message. */
  imageUrl?: string;
};
type ProgressMsg = { id: string; text: string; ts: number };
type RecipeMsg = { query: string; recipe: string; ts: number };
type CsvHit = { query: string; matches: ScoredCsvRecipe[]; ts: number };
type RecipeOption = { id: string; title: string; url: string | null; snippet: string };
type OptionsHit = {
  query: string;
  options: RecipeOption[];
  ts: number;
};

// Detect when the user is asking for an actual recipe — when this fires,
// we route the request to the web-search bridge endpoint instead of /chat.
function looksLikeRecipeRequest(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(recipe|how to (make|cook|prepare)|how do i (make|cook|prepare)|give me (a|an) (dish|food|meal)|step[- ]by[- ]step)\b/.test(t);
}

// Detect when the user is asking for a grocery / shopping list — when this
// fires, we tag the bot's reply so the UI can show a "View grocery list"
// button that opens /grocery. Conservative: matches explicit list language,
// won't fire on stock / fridge / recipe questions.
function looksLikeGroceryRequest(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(grocery\s+list|shopping\s+list|grocer(y|ies)|add\s+(it\s+)?to\s+(my\s+)?(grocery|shopping)\s+list|what\s+(should|do)\s+i\s+(buy|pick\s+up|get|need)|what'?s?\s+(missing|out|low)\b|things?\s+i\s+need\s+to\s+buy|make\s+(me\s+)?(a\s+)?list|build\s+(me\s+)?(a\s+)?list|give\s+me\s+(a\s+)?(grocery|shopping)\s+list|create\s+(a\s+)?(grocery|shopping)\s+list|i\s+need\s+(a\s+)?(grocery|shopping)\s+list|list\s+of\s+(ingredients|things|items)\s+(i\s+)?(need|to\s+buy)|what\s+do\s+i\s+need\s+to\s+buy|restock|replenish|top.?up|stock\s*up|out\s+of)\b/.test(t);
}

// Detect grocery / shopping list content in the bot's reply. Used as a
// fallback when the user message doesn't match the regex above but the
// bot still produced a list (e.g. "what should I cook tonight?" → bot
// gives ingredients). Three or more bullet-style lines triggers this.
function looksLikeGroceryReply(text: string): boolean {
  const lines = text.split(/\n+/);
  let bullets = 0;
  for (const line of lines) {
    const t = line.trim();
    if (/^([-*•]|\d+\.)\s+/.test(t)) bullets += 1;
  }
  return bullets >= 3;
}

// Where the bridge lives.
// An empty VITE_API_BASE_URL means "unset" — `??` would NOT catch that, since
// '' is neither null nor undefined, so this has to be an explicit length test.
// When unset we use our own origin, which works in every mode: production is
// served by the bridge itself, and `vite dev`/`preview` proxy /api through to
// it. Runtime resolution means a quick tunnel handing out a new hostname
// needs no rebuild.
const configuredApiBase: string = (import.meta as any).env?.VITE_API_BASE_URL || '';
const API_BASE: string =
  configuredApiBase ||
  (typeof window !== 'undefined' ? window.location.origin : '');

// Pretty-print the recipe returned by the bridge into a structured card.
function RecipeCard({ recipe, query }: { recipe: string; query: string }) {
  // Parse: Title / Serves / Time / Ingredients / Steps sections.
  const lines = recipe.split(/\n+/);
  const title = lines.find((l) => /^Title:/i.test(l))?.replace(/^Title:\s*/i, '').trim() || query;
  const serves = lines.find((l) => /^Serves:/i.test(l))?.replace(/^Serves:\s*/i, '').trim() || '';
  const time = lines.find((l) => /^Time:/i.test(l))?.replace(/^Time:\s*/i, '').trim() || '';

  const findBlock = (header: RegExp) => {
    const start = lines.findIndex((l) => header.test(l));
    if (start === -1) return [];
    const collected: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      if (/^(Title|Serves|Time|Ingredients|Steps):/i.test(l)) break;
      collected.push(l);
    }
    return collected;
  };

  const ingredientsRaw = findBlock(/^Ingredients:/i);
  const stepsRaw = findBlock(/^Steps:/i);

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 30% 30%, #86efac 0%, #166534 60%, #052e16 100%)',
          display: 'grid',
 placeItems: 'center',
          flexShrink: 0,
        }}
      >
        <Bot size={15} color="white" />
      </div>
      <div
        style={{
          maxWidth: '78%',
          padding: '14px 16px',
          borderRadius: 18,
          background: 'rgba(30, 41, 59, 0.75)',
          color: '#f8fafc',
          fontSize: 14,
          lineHeight: 1.55,
          border: '1px solid rgba(148, 163, 184, 0.18)',
          width: '100%',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{title}</div>
        {(serves || time) && (
          <div
            style={{
              display: 'flex',
              gap: 12,
              fontSize: 12,
              color: '#94a3b8',
              marginBottom: 10,
            }}
          >
            {serves && (
              <span>
                <strong style={{ color: '#cbd5e1' }}>Serves:</strong> {serves}
              </span>
            )}
            {time && (
              <span>
                <strong style={{ color: '#cbd5e1' }}>Time:</strong> {time}
              </span>
            )}
          </div>
        )}
        {ingredientsRaw.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                color: '#86efac',
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              Ingredients
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {ingredientsRaw.map((line, idx) => {
                // Lines may be "- item" or "1. item" — strip prefix.
                const cleaned = line.replace(/^(-|\d+\.)\s*/, '').trim();
                return (
                  <li key={`ing-${idx}`} style={{ marginBottom: 2 }}>
                    {cleaned}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {stepsRaw.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                color: '#86efac',
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              Steps
            </div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {stepsRaw.map((line, idx) => {
                const cleaned = line.replace(/^(\d+\.|-)\s*/, '').trim();
                return (
                  <li key={idx} style={{ marginBottom: 4 }}>
                    {cleaned}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Card that renders one or more CSV-catalog matches. Used when the user
 * asks for an Indian dish by name or ingredients and we have a strong hit
 * in the 5,894-recipe catalog. CSV matches don't carry instructions, so
 * we show name + time + ingredients + image + source link. The user can
 * tap "Web instructions" if they want step-by-step from the LLM.
 */
function IndianRecipeCard({
  matches,
  query,
  onWebFallback,
}: {
  matches: ScoredCsvRecipe[];
  query: string;
  onWebFallback?: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          width: '100%',
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at 30% 30%, #fde68a 0%, #b45309 60%, #451a03 100%)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          <Bot size={15} color="white" />
        </div>
        <div
          style={{
            fontSize: 12,
            color: '#fbbf24',
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
          }}
        >
          From your Indian recipe catalog · {matches.length} match
          {matches.length === 1 ? '' : 'es'}
        </div>
      </div>
      {matches.map((m, idx) => {
        const r = m.recipe;
        const ings = r.ingredients.slice(0, 10);
        const more = r.ingredients.length - ings.length;
        return (
          <div
            key={`csv-${r.id}-${idx}`}
            style={{
              maxWidth: '78%',
              padding: '14px 16px',
              borderRadius: 18,
              background: 'rgba(30, 41, 59, 0.75)',
              color: '#f8fafc',
              fontSize: 14,
              lineHeight: 1.55,
              border: '1px solid rgba(251, 191, 36, 0.25)',
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {r.imageUrl && (
                <img
                  src={r.imageUrl}
                  alt={r.name}
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 10,
                    objectFit: 'cover',
                    flexShrink: 0,
                    background: 'rgba(0,0,0,0.2)',
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                  {r.name}
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    fontSize: 12,
                    color: '#94a3b8',
                    marginBottom: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <span>
                    <strong style={{ color: '#cbd5e1' }}>Serves:</strong>{' '}
                    {r.baseServings}
                  </span>
                  {r.totalTime && (
                    <span>
                      <Clock
                        size={11}
                        style={{ verticalAlign: 'middle', marginRight: 3 }}
                      />
                      <strong style={{ color: '#cbd5e1' }}>Time:</strong>{' '}
                      {r.totalTime} min
                    </span>
                  )}
                  {r.cuisine && (
                    <span>
                      <strong style={{ color: '#cbd5e1' }}>Cuisine:</strong>{' '}
                      {r.cuisine}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {ings.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: 0.6,
                    color: '#fbbf24',
                    fontWeight: 700,
                    marginBottom: 4,
                  }}
                >
                  Ingredients ({r.ingredients.length})
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    fontSize: 13,
                    color: '#e2e8f0',
                  }}
                >
                  {ings.map((ing, i) => (
                    <li key={`ing-${idx}-${i}`} style={{ marginBottom: 2 }}>
                      {ing.name}
                      {ing.quantity > 0 && ing.unit !== 'pcs'
                        ? ` — ${ing.quantity} ${ing.unit}`
                        : ''}
                    </li>
                  ))}
                  {more > 0 && (
                    <li
                      style={{
                        marginBottom: 2,
                        color: '#94a3b8',
                        fontStyle: 'italic',
                      }}
                    >
                      …and {more} more
                    </li>
                  )}
                </ul>
              </div>
            )}
            <div
              style={{
                marginTop: 10,
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              {r.imageUrl && /^https?:\/\//.test(r.imageUrl) && (
                <a
                  href={r.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    gap: 4,
                    alignItems: 'center',
                    fontSize: 12,
                    color: '#86efac',
                    textDecoration: 'none',
                    border: '1px solid rgba(134, 239, 172, 0.3)',
                    padding: '4px 10px',
                    borderRadius: 999,
                  }}
                >
                  <ExternalLink size={11} /> Source
                </a>
              )}
              {onWebFallback && (
                <button
                  type="button"
                  onClick={onWebFallback}
                  style={{
                    fontSize: 12,
                    color: '#fbbf24',
                    background: 'transparent',
                    border: '1px solid rgba(251, 191, 36, 0.3)',
                    padding: '4px 10px',
                    borderRadius: 999,
                    cursor: 'pointer',
                  }}
                >
                  Get web instructions →
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  const hh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hh}:${m.toString().padStart(2, '0')} ${ampm}`;
}

/**
 * Render a bot reply as light markdown.
 *
 * The model writes `**bold**` and appends the id of the recipe it is
 * pointing at in backticks — `**Palak paneer** (`recipe-palak-paneer`)`.
 * The bubble rendered the text verbatim, so the user read the asterisks and
 * the internal id as if they were part of the answer. The id is machine
 * plumbing for the client; it is dropped here, the bold is rendered, and
 * any other inline code stays as a small chip.
 */
function renderRichText(text: string): React.ReactNode[] {
  const cleaned = text.replace(/\s*\(`[a-z0-9][a-z0-9_-]*`\)/gi, '');
  const parts = cleaned.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} style={{ color: '#f8fafc', fontWeight: 700 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.88em',
            background: 'rgba(148,163,184,0.16)',
            padding: '1px 6px',
            borderRadius: 6,
            color: '#cbd5e1',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function HouseBotPage() {
  // Pull live data so House Bot grounds answers in the user's actual state.
  // `store` itself is kept because the agent actions need the whole API, not
  // just the handful of fields this page renders.
  const store = useStore();
  const { stock, grocery, settings, mealLogs, addGrocery, toast } = store;
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Msg[]>([
    {
      from: 'bot',
      text:
        "Hi there! I'm House Bot. I can see your fridge, grocery list, and recipe catalog. Ask me what to cook tonight, what's expiring soon, or what to put on the shopping list. Tip: ask for a \"recipe\" or \"how to make X\" — I'll search your 5,894-recipe Indian catalog first, then fall back to the web if nothing matches.",
      ts: Date.now(),
    },
  ]);
  const [progressMsgs, setProgressMsgs] = useState<ProgressMsg[]>([]);
  const [recipeMsgs, setRecipeMsgs] = useState<RecipeMsg[]>([]);
  const [csvHits, setCsvHits] = useState<CsvHit[]>([]);
  const [optionsHits, setOptionsHits] = useState<OptionsHit[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [webMode, setWebMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attach = usePhotoAttach();
  // The tab being shared, if any. It lives in another tab — the Digital
  // stores page asked the browser for it — and arrives here as frames.
  const screen = useScreenWatcher();
  const voice = useVoice();
  // Whether replies are read aloud. Off by default: people don't always want
  // a kitchen that talks back.
  const [speakReplies, setSpeakReplies] = useState(false);

  // Speak the newest bot reply once it has finished streaming. Keyed off the
  // message timestamp rather than the stream handler so it works for every
  // path that can produce a reply (streaming, the recipe generator, web
  // fallback) instead of only one of them.
  const lastSpokenTsRef = useRef<number>(0);
  // Armed only after the user has opted in, so enabling doesn't recite history.
  const armedRef = useRef(false);
  useEffect(() => {
    if (!speakReplies) return;
    const last = [...messages].reverse().find((m) => m.from === 'bot' && m.text.trim());
    if (!last) return;
    if (last.ts <= lastSpokenTsRef.current) return;
    // Flipping the toggle on would otherwise immediately read out the whole
    // welcome message, which is a paragraph long and not what anyone wants
    // when they are enabling speech for the FIRST reply.
    if (!armedRef.current) {
      lastSpokenTsRef.current = last.ts; // mark seen, don't speak it
      armedRef.current = true;
      return;
    }
    lastSpokenTsRef.current = last.ts;
    voice.speak(last.text);
    // voice.speak is stable (useCallback with no deps); including it would be
    // harmless but makes this effect look like it re-runs on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, speakReplies]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Aborts the in-flight streaming fetch if the component unmounts (user
  // navigates away mid-stream). Without this, setState calls would fire
  // on an unmounted component and leak the request.
  const streamAbortRef = useRef<AbortController | null>(null);

  // Lazy-load the 5,894-recipe Indian catalog. Same pattern Discover uses.
  const [csvRecipes, setCsvRecipes] = useState<CsvRecipe[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('../data/csvRecipes.json').then((mod) => {
      if (!cancelled)
        setCsvRecipes((mod.default || mod) as unknown as CsvRecipe[]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-resize the textarea as the user types (ChatGPT-like).
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, [input]);

  // Auto-scroll to bottom whenever the message list changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading, progressMsgs, recipeMsgs, csvHits, optionsHits]);

  // Auto-focus the textarea on mount (no need to click to begin typing).
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Abort any in-flight stream fetch when the component unmounts so we
  // don't keep updating state on an unmounted component.
  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
    };
  }, []);

  async function handleSend(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    // Snapshot the attachment before clearing it, so the request body and the
    // bubble both still have it after the chip is reset.
    const sentImage = attach.image;

    // WHAT THE PERSON IS LOOKING AT.
    //
    // If a tab is being shared — the store they opened from the Digital
    // stores page — the frame of it goes out with the message, so the model
    // can answer "what is this?" and "how much is it?" about the screen in
    // front of them.
    //
    // WHY THE ATTACHED PHOTO WINS: a photo the person deliberately attached
    // is what they meant to show. The screen is what happened to be in front
    // of them.
    const watched = sentImage ? null : screen.frame;
    const sentImagePayload = sentImage
      ? { mediaType: sentImage.mediaType, data: sentImage.data }
      : watched
        ? { mediaType: watched.mediaType, data: watched.data }
        : null;
    const userMsg: Msg = {
      from: 'me',
      text,
      ts: Date.now(),
      ...(sentImage ? { imageUrl: sentImage.url } : {}),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    attach.clear();
    setLoading(true);

    // Any option panel still on screen belongs to the PREVIOUS turn. Left
    // in place it stacks up underneath the newest messages and reads as if
    // it were this turn's answer — which is exactly what the chat looked
    // like after a few prompts: one set of recipe buttons, then another
    // set, then another, all trailing the latest reply.
    setOptionsHits([]);
    setRecipeMsgs([]);
    setCsvHits([]);
    setProgressMsgs([]);

    // Reset textarea height after sending.
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.style.height = 'auto';
        ta.focus();
      }
    });

    // Decide which bridge endpoint to use. Web-search is opted in by
    // either toggling the Globe button or asking for a recipe.
    const useWeb = webMode || looksLikeRecipeRequest(text);
    if (useWeb) {
      setWebMode(false); // single-shot; turn off after one search
      // Reset prior progress before the new search starts.
      setProgressMsgs([]);

      // Always go to the LLM-generated options endpoint so they can pick
      // a variant. The Indian catalog fast-path was skipping this and
      // dumping full recipes on the user — the user wanted buttons first.
      // (We still keep `setCsvHits` available so the user can browse
      // the catalog from Discover if they want.)
      void csvRecipes; // suppress unused warning

      // No strong Indian-catalog hit — fetch web-search candidates and
      // show them as clickable options. The user picks one and we send it
      // back through the recipe flow, which routes to the full
      // /api/housebot/recipe generator.
      try {
        const optsRes = await fetch(
          `${API_BASE}/api/housebot/recipe/options`,
          {
            method: 'POST',
            headers: bridgeHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ query: text }),
          },
        );
        if (optsRes.ok) {
          const optsData = (await optsRes.json()) as {
            ok?: boolean;
            options?: RecipeOption[];
          };
          if (Array.isArray(optsData.options) && optsData.options.length > 0) {
            setOptionsHits((prev) => [
              ...prev,
              { query: text, options: optsData.options!, ts: Date.now() },
            ]);
            // Drop a placeholder bot bubble so the options have something
            // to render under. The actual recipe is generated when the
            // user clicks one.
            setMessages((prev) => [
              ...prev,
              {
                from: 'bot',
                text: `Here are some ${text} options — pick the one you want a full recipe for.`,
                ts: Date.now() + 2,
              },
            ]);
            setLoading(false);
            textareaRef.current?.focus();
            return;
          }
        }
      } catch (optsErr) {
        /* no options — fall through to the streaming chat path */
      }

      // No options came back (the search backend may be rate-limited) — go
      // straight to the streaming chat endpoint below, so the LLM writes the
      // answer directly. This avoids the slow /recipe endpoint's second
      // search.
      //
      // We deliberately do NOT re-enter handleSend here. This closure still
      // sees the pre-send `webMode`, so a recursive call would take the web
      // branch again, fail the same way and loop forever (one POST to the
      // bridge per iteration, plus a duplicate user bubble). Falling through
      // keeps the failure path finite.
    }

    // Build the history + compact context for the bridge.
    const history = messages
      .concat(userMsg)
      .map((m) => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text }));

    const allRecipes = [...STARTER_RECIPES, ...INDIAN_RECIPES];
    const sampleSize = Math.min(40, allRecipes.length);
    const stride = Math.max(1, Math.floor(allRecipes.length / sampleSize));
    const recipeCatalog: Array<{
      id: string;
      name: string;
      emoji: string;
      mealType: string;
      ingredients: string[];
    }> = [];
    for (let i = 0; i < allRecipes.length && recipeCatalog.length < sampleSize; i += stride) {
      const r = allRecipes[i];
      recipeCatalog.push({
        id: r.id,
        name: r.name,
        emoji: r.emoji,
        mealType: r.mealType,
        ingredients: r.ingredients.map((i) => i.name),
      });
    }

    const context = {
      stock,
      grocery,
      recentMeals: mealLogs,
      settings: {
        userName: settings.userName,
        dietaryPreference: settings.dietaryPreference,
        allergies: settings.allergies,
      },
      recipes: recipeCatalog,
    };

    try {
      // Streaming chat. We add an empty bot message and append tokens to it
      // as they arrive so the user sees the reply build up in real time.
      const botTs = Date.now() + 1;
      setMessages((prev) => [...prev, { from: 'bot', text: '', ts: botTs }]);

      // Wire an AbortController so unmounting mid-stream cancels the
      // fetch instead of leaking state writes on an unmounted component.
      const ctl = new AbortController();
      streamAbortRef.current = ctl;

      const res = await fetch(`${API_BASE}/api/housebot/chat/stream`, {
        method: 'POST',
        headers: bridgeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
        message: text,
        history,
        context,
        ...(sentImagePayload ? { image: sentImagePayload } : {}),
      }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finalReply = '';
      // Actions are collected during the stream and applied once the reply is
      // complete, so a half-streamed message can't leave the app half-edited.
      const queuedActions: unknown[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          let payload: {
            type?: string;
            content?: string;
            reply?: string;
            error?: string;
            action?: unknown;
          };
          try {
            payload = JSON.parse(json);
          } catch {
            continue;
          }
          if (payload.type === 'token' && typeof payload.content === 'string') {
            finalReply += payload.content;
            setMessages((prev) =>
              prev.map((m) =>
                m.ts === botTs ? { ...m, text: m.text + payload.content } : m,
              ),
            );
          } else if (payload.type === 'action') {
            // The bridge already validated these; the client re-checks in
            // applyAgentActions before anything touches the store.
            queuedActions.push(payload.action);
          } else if (payload.type === 'error') {
            throw new Error(payload.error || 'stream error');
          }
        }
      }
      // Finalize: tag with groceryRequest flag based on accumulated text.
      const reply = finalReply || 'Sorry, I had trouble responding just now.';
      setMessages((prev) =>
        prev.map((m) =>
          m.ts === botTs
            ? {
                ...m,
                text: reply,
                groceryRequest:
                  looksLikeGroceryRequest(text) ||
                  // A reply that merely HAS bullets is not a shopping list.
                  // Four dinner ideas is four bullets, and offering to put
                  // them on the grocery list is nonsense — so the reply only
                  // counts when it actually parses into items.
                  (looksLikeGroceryReply(reply) && parseGroceryList(reply).length > 0),
              }
            : m,
        ),
      );

      // Apply whatever the bot decided to do, now that its reply is complete.
      if (queuedActions.length > 0) {
        const outcome = applyAgentActions(queuedActions, store);
        if (outcome.applied > 0) {
          toast(
            outcome.summary.length > 90
              ? `House Bot updated ${outcome.applied} item${outcome.applied === 1 ? '' : 's'}`
              : `House Bot · ${outcome.summary}`,
            'success',
          );
        }
        if (outcome.skipped > 0 && outcome.applied === 0) {
          toast('House Bot couldn’t apply that change', 'warning');
        }
      }
    } catch (err) {
      // If the fetch was aborted (e.g. component unmounted), don't show
      // an error message and don't change messages.
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const msg =
        err instanceof Error
          ? `⚠️ Network error: ${err.message}`
          : '⚠️ Network error — please try again.';
      // Replace the streaming placeholder if it exists, else append.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.from === 'bot' && last.text === '' && last.ts > Date.now() - 60_000) {
          return [
            ...prev.slice(0, -1),
            { ...last, text: msg, groceryRequest: looksLikeGroceryRequest(text) },
          ];
        }
        return [
          ...prev,
          {
            from: 'bot',
            text: msg,
            ts: Date.now(),
            groceryRequest: looksLikeGroceryRequest(text),
          },
        ];
      });
    } finally {
      streamAbortRef.current = null;
      setLoading(false);
    }
  }

  // Full-recipe generator (no streaming yet — the /recipe endpoint
  // returns progress + final recipe in one response). Used when the
  // user clicks an option from the web-search options pills, since
  // going through handleSend would close over a stale `input` state
  // (React batches state updates, so rAF callbacks see the previous
  // render's input).
  async function fetchFullRecipe(query: string) {
    const text = query.trim();
    if (!text || loading) return;

    // Record the user's pick so the message bubble + bot reply match.
    setMessages((prev) => [
      ...prev,
      { from: 'me', text, ts: Date.now() },
    ]);
    setProgressMsgs([]);
    setOptionsHits([]); // hide the options now that one was picked
    setInput('');
    setLoading(true);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.style.height = 'auto';
        ta.focus();
      }
    });

    try {
      const res = await fetch(`${API_BASE}/api/housebot/recipe`, {
        method: 'POST',
        headers: bridgeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query: text }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        ok?: boolean;
        progress?: string[];
        recipe?: string;
        error?: string;
      };
      const progress = Array.isArray(data.progress) ? data.progress : [];
      const stamped = progress.map((p, i) => ({
        id: `p-${Date.now()}-${i}`,
        text: p,
        ts: Date.now() + i,
      }));
      setProgressMsgs(stamped);
      const recipe =
        data.recipe ||
        (data.error ? `⚠️ ${data.error}` : 'Sorry, I had trouble writing that recipe.');
      setRecipeMsgs((prev) => [
        ...prev,
        { query: text, recipe, ts: Date.now() + progress.length + 1 },
      ]);
    } catch (err) {
      const msg =
        err instanceof Error
          ? `⚠️ Network error: ${err.message}`
          : '⚠️ Network error — please try again.';
      setRecipeMsgs((prev) => [
        ...prev,
        { query: text, recipe: msg, ts: Date.now() },
      ]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function startNewConversation() {
    if (loading) return;
    // Snapshot the prior conversation (if it had any real exchanges) and
    // ask the bridge to write it to long-term memory so next session
    // remembers what we discussed. Fire-and-forget — the UI doesn't
    // block; the new chat starts immediately.
    const priorMessages = messages.filter(
      (m) => m.text && m.text.length > 0,
    );
    if (priorMessages.length >= 2) {
      const transcript = priorMessages.map((m) => ({
        role: m.from === 'me' ? 'user' : 'assistant',
        content: m.text,
      }));
      void fetch(`${API_BASE}/api/housebot/summarize`, {
        method: 'POST',
        headers: bridgeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ messages: transcript }),
      }).catch(() => {
        /* silent — memory is best-effort */
      });
    }
    setMessages([
      {
        from: 'bot',
        text:
          "New chat. I'm House Bot — ask me what's for dinner, what's expiring, or what to add to your grocery list.",
        ts: Date.now(),
      },
    ]);
    // Also wipe any leftover web-search artefacts so the new chat starts clean.
    setProgressMsgs([]);
    setRecipeMsgs([]);
    setCsvHits([]);
    setOptionsHits([]);
    setInput('');
    setWebMode(false);
    textareaRef.current?.focus();
  }

  return (
    <div
      style={{
        // Lock the page height so only the messages region scrolls —
        // header + composer stay fixed in place.
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(1200px 800px at 20% 0%, rgba(34, 197, 94, 0.18), transparent 60%),\n          radial-gradient(900px 700px at 90% 100%, rgba(96, 165, 250, 0.15), transparent 55%),\n          linear-gradient(180deg, #0a1224 0%, #0b1426 50%, #0a0f1f 100%)',
        color: '#e2e8f0',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* Animated keyframes (kept inline since the page is self-contained).
          These are referenced by inline styles below. */}
      <style>{`
        @keyframes hb-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-4px); opacity: 1; } }
        @keyframes hb-fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes hb-aurora { 0% { transform: translate(0, 0) rotate(0deg); } 50% { transform: translate(-40px, 30px) rotate(180deg); } 100% { transform: translate(0, 0) rotate(360deg); } }
        @keyframes hb-pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(134, 239, 172, 0.45); } 70% { box-shadow: 0 0 0 12px rgba(134, 239, 172, 0); } 100% { box-shadow: 0 0 0 0 rgba(134, 239, 172, 0); } }
        @keyframes hb-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes hb-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes hb-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.8); } }
        @keyframes hb-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        @keyframes hb-gradient-shift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        .hb-msg { animation: hb-fade-up 0.32s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .hb-aurora-1 { position: absolute; top: -120px; left: -80px; width: 380px; height: 380px; border-radius: 50%; filter: blur(80px); opacity: 0.5; pointer-events: none; background: radial-gradient(circle, rgba(74, 222, 128, 0.6) 0%, transparent 70%); animation: hb-aurora 18s ease-in-out infinite; }
        .hb-aurora-2 { position: absolute; bottom: -100px; right: -60px; width: 320px; height: 320px; border-radius: 50%; filter: blur(80px); opacity: 0.45; pointer-events: none; background: radial-gradient(circle, rgba(96, 165, 250, 0.55) 0%, transparent 70%); animation: hb-aurora 22s ease-in-out infinite reverse; }
        .hb-scroll { scrollbar-width: thin; scrollbar-color: rgba(148, 163, 184, 0.35) transparent; }
        .hb-scroll::-webkit-scrollbar { width: 6px; }
        .hb-scroll::-webkit-scrollbar-track { background: transparent; }
        .hb-scroll::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.35); border-radius: 999px; }
        .hb-scroll::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.55); }
        .hb-gradient-text {
          background: linear-gradient(135deg, #86efac 0%, #fde68a 50%, #93c5fd 100%);
          background-size: 200% 200%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: hb-gradient-shift 8s ease-in-out infinite;
        }
        .hb-send-ready {
          background: linear-gradient(135deg, #22c55e 0%, #16a34a 50%, #14b8a6 100%);
          background-size: 200% 200%;
          animation: hb-gradient-shift 3s ease-in-out infinite;
        }
      `}</style>

      {/* Decorative aurora blobs — purely cosmetic, behind everything. */}
      <div className="hb-aurora-1" aria-hidden="true" />
      <div className="hb-aurora-2" aria-hidden="true" />

      {/* Slim top bar — like ChatGPT's header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
          background: 'rgba(15, 23, 42, 0.55)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          flexShrink: 0,
          zIndex: 5,
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={() => window.location.assign('/')}
          aria-label="Back to home"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 999,
            border: '1px solid rgba(148, 163, 184, 0.22)',
            background: 'rgba(255, 255, 255, 0.03)',
            color: '#cbd5e1',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            transition: 'all 160ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.4)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
            e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.22)';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>←</span> Home
        </button>

        <ThemeToggle variant="onGradient" />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              background:
                'radial-gradient(circle at 30% 30%, #bbf7d0 0%, #22c55e 40%, #166534 80%, #052e16 100%)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              boxShadow:
                '0 0 24px rgba(74, 222, 128, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
              animation: 'hb-pulse-ring 2.4s ease-out infinite',
            }}
          >
            <Bot size={16} color="white" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span className="hb-gradient-text" style={{ fontSize: 16, fontWeight: 700, letterSpacing: 0.2 }}>
              House Bot
            </span>
            <span style={{ fontSize: 10, color: '#86efac', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>
              ● online
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={startNewConversation}
          aria-label="New chat"
          title="New chat"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 999,
            border: '1px solid rgba(148, 163, 184, 0.22)',
            background: 'rgba(255, 255, 255, 0.03)',
            color: '#cbd5e1',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            transition: 'all 160ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.4)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
            e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.22)';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <SquarePen size={13} /> New
        </button>
      </div>

      {/* Messages — the only region that scrolls. Bottom-padded so the
          composer never covers the last message. */}
      <div
        ref={scrollRef}
        className="hb-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '28px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 720,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {messages.map((m, i) => {
            const mine = m.from === 'me';
            const showTime =
              i === 0 ||
              messages[i - 1].ts !== m.ts ||
              m.ts - messages[i - 1].ts > 5 * 60_000;
            return (
              <div
                key={i}
                className="hb-msg"
                style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
              >
                {showTime && (
                  <div
                    style={{
                      alignSelf: 'center',
                      fontSize: 10,
                      color: 'rgba(148, 163, 184, 0.85)',
                      background: 'rgba(15, 23, 42, 0.5)',
                      padding: '3px 10px',
                      borderRadius: 999,
                      letterSpacing: 0.5,
                      textTransform: 'uppercase',
                      fontWeight: 600,
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(148, 163, 184, 0.12)',
                    }}
                  >
                    {formatTime(m.ts)}
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    flexDirection: mine ? 'row-reverse' : 'row',
                  }}
                >
                  {!mine && (
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        background:
                          'radial-gradient(circle at 30% 30%, #bbf7d0 0%, #22c55e 45%, #166534 85%, #052e16 100%)',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                        marginTop: 2,
                        boxShadow:
                          '0 0 18px rgba(74, 222, 128, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
                      }}
                    >
                      <Bot size={16} color="white" />
                    </div>
                  )}
                  <div
                    style={{
                      maxWidth: '78%',
                      padding: mine ? (m.imageUrl ? '8px 8px 11px' : '11px 16px') : '13px 18px',
                      borderRadius: mine ? '20px 20px 6px 20px' : '20px 20px 20px 6px',
                      background: mine
                          ? 'linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%)'
                          : 'rgba(255, 255, 255, 0.06)',
                      backdropFilter: 'blur(20px) saturate(160%)',
                      WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                      color: '#f8fafc',
                      fontSize: 15,
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      border: mine
                          ? '1px solid rgba(147, 197, 253, 0.4)'
                          : '1px solid rgba(148, 163, 184, 0.18)',
                      boxShadow: mine
                          ? '0 8px 24px rgba(37, 99, 235, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.18)'
                          : '0 8px 24px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    {m.imageUrl && (
                      <img
                        src={m.imageUrl}
                        alt="Photo you sent"
                        style={{
                          display: 'block',
                          width: '100%',
                          maxWidth: 320,
                          borderRadius: 14,
                          marginBottom: m.text ? 8 : 0,
                        }}
                      />
                    )}
                    {!mine ? renderRichText(m.text) : m.text}
                  </div>
                </div>
                {!mine && m.groceryRequest && (() => {
                  const items = parseGroceryList(m.text);
                  return (
                    <div
                      style={{
                        alignSelf: 'flex-start',
                        marginLeft: 42, // line up under the bubble (avatar width + gap)
                        marginTop: -4,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        alignItems: 'flex-start',
                      }}
                    >
                      {items.length > 0 && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#86efac',
                            letterSpacing: 0.5,
                            textTransform: 'uppercase',
                            fontWeight: 700,
                          }}
                        >
                          {items.length} item{items.length === 1 ? '' : 's'} ready to add
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (items.length > 0) {
                            for (const it of items) {
                              addGrocery({
                                name: it.name,
                                quantity: it.quantity,
                                category: it.category,
                              });
                            }
                            toast(
                              `Added ${items.length} item${
                                items.length === 1 ? '' : 's'
                              } to grocery list`,
                              'success',
                            );
                          }
                          navigate('/grocery');
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#f8fafc',
                          background: 'rgba(134, 239, 172, 0.12)',
                          border: '1px solid rgba(134, 239, 172, 0.4)',
                          padding: '7px 14px',
                          borderRadius: 999,
                          cursor: 'pointer',
                        }}
                      >
                        <ShoppingCart size={13} />
                        {items.length > 0
                          ? `Add ${items.length} to grocery list →`
                          : 'View grocery list →'}
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          })}

          {/* Web-search progress bubbles (like ChatGPT's "Searching…"). */}
          {progressMsgs.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background:
                    'radial-gradient(circle at 30% 30%, #60a5fa 0%, #1e3a8a 60%, #0c1e4a 100%)',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                }}
              >
                <Globe size={15} color="white" />
              </div>
              <div
                style={{
                  maxWidth: '78%',
                  padding: '10px 14px',
                  borderRadius: 18,
                  background: 'rgba(30, 58, 138, 0.35)',
                  color: '#dbeafe',
                  fontSize: 14,
                  lineHeight: 1.5,
                  border: '1px solid rgba(96, 165, 250, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#60a5fa',
                    boxShadow: '0 0 0 4px rgba(96, 165, 250, 0.25)',
                    flexShrink: 0,
                  }}
                />
                {p.text}
              </div>
            </div>
          ))}

          {/* Suggestion chips — only show on first visit (no user message yet). */}
          {messages.length === 1 && !loading && (
            <div
              className="hb-msg"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                marginTop: 4,
                marginLeft: 46,
              }}
            >
              {[
                "What's expiring soon?",
                'Make me a grocery list for butter chicken',
                'Recipe for paneer tikka',
                "What's for dinner with what's in my fridge?",
                'What is the capital of France?',
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setInput(q);
                    // Pass the chip text explicitly: `handleSend` reads the
                    // `input` from the closure it was created in, and that
                    // closure still holds the value from BEFORE setInput(q)
                    // — the chips are shown on a fresh page where the box is
                    // empty, so the send would abort and the tap would do
                    // nothing at all.
                    requestAnimationFrame(() => handleSend(q));
                  }}
                  style={{
                    fontSize: 13,
                    color: '#e2e8f0',
                    background: 'rgba(255, 255, 255, 0.05)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    border: '1px solid rgba(148, 163, 184, 0.22)',
                    padding: '9px 14px',
                    borderRadius: 999,
                    cursor: 'pointer',
                    transition: 'all 160ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(134, 239, 172, 0.12)';
                    e.currentTarget.style.borderColor = 'rgba(134, 239, 172, 0.5)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.22)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Final recipe card — structured layout for ingredients + steps. */}
          {recipeMsgs.map((r) => (
            <RecipeCard key={`r-${r.ts}`} recipe={r.recipe} query={r.query} />
          ))}

          {/* CSV catalog hits — instant matches from the 5,894-recipe Indian catalog. */}
          {csvHits.map((h) => (
            <IndianRecipeCard
              key={`csv-${h.ts}`}
              matches={h.matches}
              query={h.query}
              onWebFallback={() => {
                // Re-issue the query to /api/housebot/recipe so the LLM
                // writes step-by-step instructions for the matched dish.
                setWebMode(true);
                setInput(h.query);
                // Defer so the state updates settle before handleSend fires.
                requestAnimationFrame(() => handleSend());
              }}
            />
          ))}

          {/* Web-search recipe options — clickable pills. */}
          {optionsHits.map((h) => (
            <div
              key={`opts-${h.ts}`}
              className="hb-msg"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                marginLeft: 46,
                marginTop: -8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: '#86efac',
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}
              >
                {h.options.length} recipe option{h.options.length === 1 ? '' : 's'} — pick one
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                {h.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      // Bypass the chat pipeline — go straight to the
                      // recipe generator with the picked title. Using
                      // handleSend here would close over a still-stale
                      // `input` value (React state updates are async),
                      // so we call the recipe flow directly.
                      fetchFullRecipe(o.title);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#f8fafc',
                      background: 'rgba(255, 255, 255, 0.05)',
                      backdropFilter: 'blur(20px) saturate(160%)',
                      WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                      border: '1px solid rgba(148, 163, 184, 0.25)',
                      padding: '8px 14px',
                      borderRadius: 14,
                      cursor: 'pointer',
                      maxWidth: '100%',
                      textAlign: 'left',
                      transition: 'all 160ms ease',
                      boxShadow: '0 4px 14px rgba(0, 0, 0, 0.2)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        'rgba(134, 239, 172, 0.12)';
                      e.currentTarget.style.borderColor =
                        'rgba(134, 239, 172, 0.5)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background =
                        'rgba(255, 255, 255, 0.05)';
                      e.currentTarget.style.borderColor =
                        'rgba(148, 163, 184, 0.25)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                    title={o.snippet || undefined}
                  >
                    <span style={{ fontSize: 13 }}>{o.title}</span>
                    {o.snippet && (
                      <span
                        style={{
                          fontSize: 11,
                          color: 'rgba(226, 232, 240, 0.75)',
                          fontWeight: 400,
                        }}
                      >
                        · {o.snippet.slice(0, 60)}
                        {o.snippet.length > 60 ? '…' : ''}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {loading && (
            <div className="hb-msg" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  background:
                    'radial-gradient(circle at 30% 30%, #bbf7d0 0%, #22c55e 45%, #166534 85%, #052e16 100%)',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                  boxShadow:
                    '0 0 18px rgba(74, 222, 128, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
                }}
              >
                <Bot size={16} color="white" />
              </div>
              <div
                aria-label="House Bot is thinking"
                style={{
                  padding: '14px 18px',
                  borderRadius: '20px 20px 20px 6px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  backdropFilter: 'blur(20px) saturate(160%)',
                  WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                }}
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background:
                        'linear-gradient(180deg, #86efac 0%, #22c55e 100%)',
                      display: 'inline-block',
                      animation: `hb-bounce 1.2s ${i * 0.15}s ease-in-out infinite`,
                      boxShadow: '0 0 8px rgba(134, 239, 172, 0.6)',
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Composer — fixed at the bottom, doesn't move when messages scroll. */}
      <div
        style={{
          flexShrink: 0,
          padding: '14px 16px 22px',
          background:
            'linear-gradient(180deg, rgba(15, 23, 42, 0) 0%, rgba(10, 14, 30, 0.85) 40%, rgba(10, 14, 30, 0.95) 100%)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderTop: '1px solid rgba(148, 163, 184, 0.1)',
          position: 'relative',
          zIndex: 2,
        }}
      >
        {/* Voice status strip: only visible when something is actually
            happening, so it never adds permanent chrome to the composer. */}
        {(voice.listening || voice.interim || voice.error) && (
          <div
            style={{
              width: '100%',
              maxWidth: 720,
              margin: '0 auto 6px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: voice.error ? '#fca5a5' : '#cbd5e1',
            }}
          >
            {voice.listening && (
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#ef4444',
                  animation: 'hb-pulse 1.1s ease-in-out infinite',
                }}
              />
            )}
            <span
              style={{
                flex: 1,
                minWidth: 0,
                // An error must wrap. Clipping it with an ellipsis cut off
                // exactly the part the user needs — the "allow the mic" steps
                // — leaving a truncated sentence they could not act on.
                ...(voice.error
                  ? { whiteSpace: 'normal', overflow: 'visible' }
                  : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
              }}
            >
              {voice.error || (voice.interim ? `\u201c${voice.interim}\u201d` : 'Listening\u2026 tap the mic to stop')}
            </span>
            <button
              type="button"
              onClick={voice.cancel}
              aria-label="Cancel voice"
              style={{
                background: 'transparent',
                border: '1px solid rgba(148,163,184,0.3)',
                color: '#cbd5e1',
                borderRadius: 999,
                padding: '3px 10px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Read replies aloud toggle. Free (browser TTS), so it costs
            nothing to leave available. */}
        <div
          style={{
            width: '100%',
            maxWidth: 720,
            margin: '0 auto 6px',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={() => {
              const next = !speakReplies;
              setSpeakReplies(next);
              if (!next) voice.stopSpeaking();
              if (next && !voice.canSpeak) {
                toast('This browser cannot read replies aloud', 'warning');
              }
            }}
            aria-pressed={speakReplies}
            aria-label={speakReplies ? 'Stop reading replies aloud' : 'Read replies aloud'}
            title={speakReplies ? 'Stop reading replies aloud' : 'Read replies aloud'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid rgba(148,163,184,0.28)',
              background: speakReplies ? 'rgba(34,197,94,0.16)' : 'transparent',
              color: speakReplies ? '#86efac' : '#94a3b8',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {speakReplies ? <Volume2 size={13} /> : <VolumeX size={13} />}
            {speakReplies ? 'Reading aloud' : 'Read aloud'}
            {speakReplies && (
              <span
                className="ml-1 rounded-full px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wide"
                style={{
                  background: voice.engine === 'neural' ? 'rgba(34,197,94,0.2)' : 'rgba(248,113,113,0.2)',
                  color: voice.engine === 'neural' ? '#86efac' : '#fca5a5',
                }}
                title={
                  voice.engine === 'neural'
                    ? 'Using the local Kokoro neural voice'
                    : 'Fell back to the browser voice — the local voice engine is not reachable'
                }
              >
                {voice.engine === 'neural' ? 'Neural' : voice.engine === 'browser' ? 'Fallback' : '—'}
              </span>
            )}
          </button>
        </div>

        <div
          style={{
            width: '100%',
            maxWidth: 720,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 10,
            padding: '8px 10px 8px 16px',
            borderRadius: 28,
            background: 'rgba(255, 255, 255, 0.05)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow:
              '0 18px 50px rgba(0, 0, 0, 0.45),\n              inset 0 1px 0 rgba(255, 255, 255, 0.08),\n              0 0 0 0 rgba(134, 239, 172, 0)',
            transition: 'box-shadow 240ms ease, border-color 240ms ease',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'rgba(134, 239, 172, 0.45)';
            e.currentTarget.style.boxShadow =
              '0 18px 50px rgba(0, 0, 0, 0.5),\n              inset 0 1px 0 rgba(255, 255, 255, 0.1),\n              0 0 0 4px rgba(134, 239, 172, 0.18)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.22)';
            e.currentTarget.style.boxShadow =
              '0 18px 50px rgba(0, 0, 0, 0.45),\n              inset 0 1px 0 rgba(255, 255, 255, 0.08),\n              0 0 0 0 rgba(134, 239, 172, 0)';
          }}
        >
          {attach.image && (
            <AttachedImageChip image={attach.image} onClear={attach.clear} />
          )}
          {/* WHAT THE BOT CAN SEE.
              The person has to know, or they will ask the bot about something
              it cannot see and conclude it is not listening. */}
          {!attach.image && screen.watching && (
            <span className="mb-1.5 inline-flex items-center gap-1.5 rounded-lg bg-sage-50 dark:bg-sage-900/30 px-2 py-1 text-[10px] font-semibold text-sage-700 dark:text-sage-200">
              <MonitorPlay size={11} />
              I can see your {screen.label ?? 'shared'} tab
            </span>
          )}
          <div className="flex items-end gap-2 flex-1 min-w-0">
            <PhotoAttachButton attach={attach} disabled={loading} />
            <textarea
              ref={textareaRef}
              value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              loading
                ? 'House Bot is thinking…'
                : webMode
                ? 'Search the web for a recipe…'
                : 'Ask anything — kitchen, groceries, or the world…'
            }
            disabled={loading}
            aria-label="Message House Bot"
            rows={1}
            style={{
              flex: 1,
              // A flex item won't shrink below its intrinsic width without
              // this — without it the textarea keeps its default ~20-column
              // width and overflows the composer.
              minWidth: 0,
              minHeight: 26,
              maxHeight: 180,
              padding: '6px 4px',
              border: 'none',
              outline: 'none',
              resize: 'none',
              background: 'transparent',
              color: '#f8fafc',
              fontSize: 15,
              lineHeight: 1.45,
              fontFamily: 'inherit',
              overflowY: 'auto',
            }}
          />
        </div>
          <button
            type="button"
            onClick={() => setWebMode((v) => !v)}
            disabled={loading}
            aria-label={webMode ? 'Disable web-search for next message' : 'Enable web-search for next message'}
            aria-pressed={webMode}
            title={webMode ? 'Web-search is ON (click to turn off)' : 'Click to turn on web-search for the next message'}
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              border: webMode
                ? '1px solid rgba(96, 165, 250, 0.55)'
                : '1px solid rgba(148, 163, 184, 0.3)',
              background: webMode
                ? 'linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%)'
                : 'rgba(255, 255, 255, 0.04)',
              color: webMode ? '#ffffff' : '#cbd5e1',
              display: 'grid',
              placeItems: 'center',
              cursor: loading ? 'not-allowed' : 'pointer',
              flexShrink: 0,
              boxShadow: webMode ? '0 0 14px rgba(96, 165, 250, 0.45)' : 'none',
              transition: 'all 160ms ease',
            }}
            onMouseEnter={(e) => {
              if (loading) return;
              e.currentTarget.style.transform = 'scale(1.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <Globe size={16} />
          </button>
          {/* Microphone. Tapping it asks the browser for the microphone if
              HomeHub has not been given it yet, so the one-time browser
              prompt appears exactly when the user reaches for the mic
              instead of behind a settings screen they never open. */}
          <button
            type="button"
            onClick={() => {
              if (voice.listening) {
                voice.stopListening();
                return;
              }
              const onHeard = (text: string) => {
                // Put it in the box rather than sending it. Kitchen actions
                // are destructive enough ("delete the spinach") that the
                // user should always see what was heard before it happens.
                setInput((prev) => (prev ? `${prev.trim()} ${text}` : text));
                requestAnimationFrame(() => textareaRef.current?.focus());
              };
              voice.cancel();
              // Our switch being off is not a dead end: turn it on right here
              // instead of telling the user to go and find Settings. Only a
              // genuinely unsupported browser is a dead button.
              if (voice.micState === 'off') {
                void voice.enableMicrophone(onHeard);
              } else if (voice.micState === 'unsupported') {
                toast('This browser can’t listen — try Chrome or Safari', 'warning');
              } else if (voice.micState === 'blocked') {
                // The server's own policy disabled the microphone. No browser
                // setting can undo it, so say so instead of failing silently.
                toast(blockedReason(), 'warning');
              } else {
                voice.startListening(onHeard);
              }
            }}
            aria-label={
              voice.listening
                ? 'Stop listening'
                : voice.micState === 'off'
                  ? 'Turn on the microphone'
                  : voice.micState === 'unsupported'
                    ? 'Voice input is not supported by this browser'
                    : voice.micState === 'blocked'
                      ? 'The microphone is disabled by this site'
                      : 'Speak your message'
            }
            title={
              voice.listening
                ? 'Stop listening'
                : voice.micState === 'off'
                  ? 'Microphone is switched off — tap to turn it on'
                  : voice.micState === 'unsupported'
                    ? 'Voice input needs Chrome or Safari'
                    : voice.micState === 'blocked'
                      ? 'The microphone is disabled by this site'
                      : 'Speak your message'
            }
            aria-pressed={voice.listening}
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              border: 'none',
              background: voice.listening
                ? 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)'
                : 'rgba(255, 255, 255, 0.04)',
              color: voice.listening ? '#ffffff' : '#cbd5e1',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              flexShrink: 0,
              boxShadow: voice.listening
                ? '0 0 18px rgba(239, 68, 68, 0.6), 0 4px 14px rgba(0, 0, 0, 0.3)'
                : 'none',
              transition: 'all 160ms ease',
            }}
            onMouseEnter={(e) => {
              if (loading) return;
              e.currentTarget.style.transform = 'scale(1.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            {voice.listening ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!input.trim() || loading}
            aria-label="Send message"
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              border: 'none',
              background:
                input.trim() && !loading
                  ? undefined
                  : 'rgba(51, 65, 85, 0.6)',
              color: 'white',
              display: 'grid',
              placeItems: 'center',
              cursor: !input.trim() || loading ? 'not-allowed' : 'pointer',
              flexShrink: 0,
              boxShadow:
                input.trim() && !loading
                  ? '0 0 22px rgba(34, 197, 94, 0.55), 0 4px 14px rgba(0, 0, 0, 0.3)'
                  : 'none',
              transition: 'transform 160ms ease, box-shadow 240ms ease',
            }}
            {...(input.trim() && !loading ? { className: 'hb-send-ready' } : {})}
            onMouseEnter={(e) => {
              if (!input.trim() || loading) return;
              e.currentTarget.style.transform = 'scale(1.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        </div>
        <div
          style={{
            width: '100%',
            maxWidth: 720,
            margin: '6px auto 0',
            textAlign: 'center',
            fontSize: 11,
            color: '#94a3b8',
            opacity: 0.7,
          }}
        >
          Press Enter to send · Shift+Enter for newline
        </div>
      </div>
    </div>
  );
}