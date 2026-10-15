# Agent instructions

## Commit after every change

**After finishing any change to this app — a feature, a bug fix, a UI tweak,
a config change, anything — commit it immediately. Do not wait to be asked.**

Then tell the user in plain terms: *code has been committed ✅*

### Why

This is a standing preference from the project owner. Commits are cheap and
local (no login required), while pushing to GitHub needs authentication the
agent cannot do on its own. Waiting to be asked to commit means work sits
uncommitted and gets lost or forgotten.

### How

```bash
cd /Users/adhyathmika/homehub
git add -A
git commit -m "<clear description of what changed and why>"
```

- Write a real commit message — what changed and why, not "updates".
- **Never commit secrets.** `.gitignore` covers `.env*`, `tunnel/`, `plists/`,
  `dist/`, `node_modules/`. Before committing, confirm only `.env.example`
  files are tracked among env files.
- If unrelated files are staged by accident, unstage them rather than
  sweeping them into the commit.
- Commits only. Never push unless the user explicitly asks — pushing requires
  `gh auth login`, which the agent cannot perform.

### Verify before committing

The user values correctness over speed and has been burned by claims that
were not checked. For a UI or behavioural change:

1. `npx tsc --noEmit` — must be clean
2. `npm run build` — must succeed
3. Drive the real app in headless Chrome and confirm the change works

A static type-check is not evidence the feature works. State what was
actually verified versus what was assumed.