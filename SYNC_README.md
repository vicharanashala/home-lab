# HomeHub — full project bundle

Generated: 2026-10-07

## What's in here

```
homehub-bundle/
├── (frontend source root)        # package.json, src/, public/, etc.
│   ├── package.json              # frontend deps
│   ├── src/                      # pages/, components/, store/, utils/
│   ├── public/                   # static assets
│   └── ...
├── bridge/
│   ├── index.mjs                 # the Express/Ollama bridge (~3000 lines)
│   └── .env                      # env vars (DATA_DIR, OLLAMA_URL, etc.)
├── tunnel/
│   └── tunnel-watchdog.sh        # keeps the cloudflared tunnel alive
├── plists/
│   ├── com.homehub.tunnel-watchdog.plist
│   ├── com.homehub.tunnel.plist
│   └── com.homehub.bridge.plist   # launchd jobs
└── indian-recipes.json           # 5,894-recipe local DB (Tier 1 recipe source)
```

## What you need on the new machine

1. **macOS** with `launchd` (any modern Mac)
2. **Node.js 20+** — install via `brew install node`
3. **Ollama** — `brew install ollama` (or download from ollama.com)
4. **cloudflared** — `brew install cloudflared`
5. **Models** (8 GB total):
   - `ollama pull llama3.1:8b`
   - `ollama pull qwen2.5:3b`
   - `ollama pull qwen2.5:1.5b`

## Setup (10-15 minutes)

### 1. Frontend
```bash
mkdir -p ~/.minimax-agent/projects/homehub
mv (this path / projects/homehub/homehub)        # extract to this location
   # (preserves node_modules, etc.)
cd ~/.minimax-agent/projects/homehub/homehub
npm install                                       # if you didn't keep node_modules
# Update tunnel URL in .env.production after step 3
npm run build                                     # → dist/
```

### 2. Bridge
```bash
# Place the bridge where you want it, e.g. ~/projects/bridge/
mkdir -p ~/projects/bridge/data
mv bridge/index.mjs ~/projects/bridge/
mv bridge/.env ~/projects/bridge/

# Install dependencies (already in package.json, but for clarity):
cd ~/projects/bridge
npm install express @huggingface/inference@latest
# (or copy the package.json + node_modules from the original Mac)
```

### 3. Tunnel + launchd jobs
```bash
# Run login once to authenticate cloudflared with your Cloudflare account
cloudflared tunnel login

# Load the launchd jobs (adjust paths inside the plists first!)
launchctl load ~/Library/LaunchAgents/com.homehub.bridge.plist
launchctl load ~/Library/LaunchAgents/com.homehub.tunnel.plist
launchctl load ~/Library/LaunchAgents/com.homehub.tunnel-watchdog.plist
```

### 4. Update `.env.production` with the new tunnel URL

After the tunnel comes up, `cat /tmp/overwatch-tunnel.url` will show it. Edit:
```
VITE_OVERWATCH_URL=https://YOUR-NEW-URL.trycloudflare.com
VITE_API_BASE_URL=https://YOUR-NEW-URL.trycloudflare.com
```
Then rebuild + redeploy the frontend:
```bash
cd ~/.minimax-agent/projects/homehub/homehub
npm run build
```

## Key features in this bundle

- **3-tier recipe source** (Indian CSV + TheMealDB + LLM)
- **Streaming chat** with first-token-in-1s
- **Persistent memory** across sessions
- **Web search** for general knowledge
- **Clickable recipe options** with 3-4 variants before committing
- **Animated glassmorphic UI** with aurora background

## What doesn't transfer

- Ollama models (re-pull, ~30 min)
- Cloudflare tunnel URL (rotates per Mac)
- Memory store (empty by default)
- `~/.env.production` (regenerate with new tunnel URL)

## If you get stuck

The bridge file `index.mjs` has ~3000 lines but it's heavily commented. Top sections to read first:
- `HOUSEBOT_SYSTEM_PROMPT` — main system prompt
- `app.post('/api/housebot/chat/stream', ...)` — streaming chat
- `app.post('/api/housebot/recipe/options', ...)` — 3-tier recipe search
- `app.post('/api/housebot/summarize', ...)` — persistent memory

Good luck with the new setup. The user is happy with the result — enjoy!