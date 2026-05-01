# LocalForge

> Build apps on autopilot with local AI models. No cloud, no API keys, no per-token billing.

## Quick Start

### 1. Prerequisites

- **Node.js 20+** — [download here](https://nodejs.org/)
- **A local model server**, either:
  - **LM Studio** — [download here](https://lmstudio.ai/) (default port `1234`)
  - **Ollama** — [download here](https://ollama.com/) (default port `11434`)

### 2. Set up your local model server

**LM Studio:**

1. Open LM Studio and download a model
2. Load the model and start the local API server (default: `http://127.0.0.1:1234`)

**Ollama:**

1. `ollama pull <model>` — see [Model selection](#model-selection) below for tested choices
2. Ollama runs as a service on `http://127.0.0.1:11434` automatically

### 3. Install and run LocalForge

```bash
git clone https://github.com/leonvanzyl/localforge.git
cd localforge
npm install
npm run db:migrate
npm run dev
```

Open **http://localhost:7777** in your browser.

### 4. Build something

1. Create a new project from the sidebar
2. Describe your app — the AI bootstrapper generates features automatically
3. Click **Start** and watch agents build it feature by feature

---

## What is LocalForge?

LocalForge lets you describe an app in plain language and watch AI coding agents
build it on your own hardware. Point it at a model running in LM Studio, click
Start, and the orchestrator breaks your idea into features, tracks them on a
kanban board, and deploys agents to implement and test them one at a time.

## How the orchestrator works

1. You create a project, either manually or by chatting with the AI bootstrapper.
2. Features land in the **Backlog** column of the kanban, ordered by priority
   and respecting dependencies.
3. Click **Start** — LocalForge spawns an agent session pointed at the configured
   local model, passes the highest-priority ready feature, and moves the card to
   **In Progress**.
4. The agent writes code, runs Playwright tests, and captures screenshots. Live
   output streams into the activity panel via SSE.
5. On success the card moves to **Completed**. On failure the feature returns to
   the backlog with demoted priority so other features can go first.
6. When all features pass, confetti.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server on port 7777 |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run lint` | Run ESLint over the repo |
| `npm test` | Run Playwright tests |

## Tech stack

- **Frontend:** Next.js 16 (App Router) + React 19, Tailwind CSS + shadcn/ui, dnd-kit, Sonner
- **Backend:** Next.js API routes (Node.js), SQLite + Drizzle ORM, Server-Sent Events
- **Agents:** Pi coding-agent SDK, configured for LM Studio/Ollama via OpenAI-compatible endpoints
- **Testing:** Playwright

## Project layout

```
app/                 Next.js App Router routes + API handlers
  api/               REST API endpoints
components/          React components
  ui/                shadcn/ui primitives
lib/
  db/                Drizzle schema + SQLite connection
  agent/             Pi agent integration + orchestrator
data/                SQLite database file (git-ignored)
projects/            User-created project folders (git-ignored)
drizzle/             Generated migrations
tests/               Playwright specs
```

## Configuration

Per-project model config is stored in `.pi/models.json` inside each project folder.
Override per project via project settings, or globally via **Settings** in the sidebar.

## Model selection

LocalForge uses the local model's tool-calling support to drive a coding
agent. That capability varies a lot between models — and not every
locally-runnable model handles it correctly. Two failure modes to know:

- **Tool-call broken (do not use):** any model whose Ollama chat template
  doesn't emit structured `tool_calls`, or that ships without tool support
  at all (e.g. `gemma3:*`, `gemma2:*`, `phi3:mini`, `deepseek-r1:*` —
  reasoning models that emit JSON-shaped tool calls inline as text).
  LocalForge detects this on the first failed attempt and pauses the
  feature with a guidance message — no infinite retry loops — but you'll
  need to switch models to make progress.
- **Tool-call structured but assistant-y:** smaller models on Ollama like
  `qwen2.5-coder:7b`, `llama3.1:8b`, `llama3.2:latest`. The Ollama shim
  routes their tool calls correctly but the model itself tends to read
  files and "claim done" without writing follow-up changes. LocalForge's
  workspace-fingerprint guard catches this and demotes the feature
  honestly rather than reporting fake progress, but a larger backlog will
  not finish on these models alone.

### What works on consumer hardware

`gpt-oss:20b` on Ollama is the smallest model we have a high-confidence
end-to-end story for. Verified live 2026-04-30 against an 8-feature
"author landing page" backlog (Next.js + Tailwind + SQLite scaffold +
API + UI; see [`docs/author-landing-app-requirements.md`](docs/author-landing-app-requirements.md)),
running CPU-spilled on an 8 GB GPU at ~3-10 tok/s:

- ✅ **Scaffold step** (`npx create-next-app .`) — clean.
- ✅ **DB setup** (write `lib/db.ts`, `drizzle.config.ts`, run
  `npm install`) — succeeds on retry. First pass tends to be Read-only,
  fingerprint guard demotes, second pass writes.
- ✅ **Schema migration** (write `lib/schema.ts`, run `drizzle-kit
  generate/migrate`) — same pattern as DB setup.
- ✅ **Edit existing files** (extending `app/page.tsx` with a new
  section, including running `npm run build` and self-correcting on the
  output) — succeeds on retry.
- ❌ **Pure from-scratch code** with no CLI to lean on (e.g. writing
  `app/api/<route>/route.ts` from spec, writing a fresh React component)
  — confabulates twice in a row, gets blocklisted by ENH-001.
- ❌ **Binary files** (placeholder PNG / JPEG) — Write tool is
  text-oriented; the model can't reliably produce a valid binary.
- ❌ **Long verbatim text inserts** (e.g. embedding a 750-char prose
  excerpt into JSX) — the model stalls on accurately reproducing the
  literal content.

The harness honestly flags every failure as confabulation and demotes;
it never fakes a completion. For features the model can't do, the
intended workflow is **human handoff**: open the file, write the bit
the model can't, mark the feature completed via the API, click Run
queue to resume the rest. The Author Landing test ran 4 features by
agent + 4 by handoff in under an hour, and the resulting `npm run
build` produced a clean Next.js app.

If you have the VRAM, `qwen2.5-coder:32b` and `gpt-oss:20b` running
fully on GPU close most of the gaps above; the failure modes above are
specifically about CPU-spilled inference on 8 GB cards.

### Practical advice

- For a first run, keep the backlog small and atomic: one bash command
  or one file write per feature. The example backlog shipped under
  `docs/example-app-features.json` follows this pattern.
- If a model emits JSON-shaped tool calls in plain assistant text
  instead of structured `tool_calls`, the harness will surface a clear
  "agent claimed success without invoking any tools" error — that's the
  signal to switch models, not to retry.
- If a feature confabulates twice in a row and gets blocklisted, the
  fastest way forward is to open the file in your editor, write the
  spec by hand, then PATCH the feature's status to `completed` via
  `/api/features/<id>` and click Run queue. The harness picks up where
  it left off.

> Note: prior versions of this guide claimed `gpt-oss:20b` only worked
> for "one-shot scaffold steps" and that incremental edits were
> unreliable. That conclusion was contaminated by **BUG-006** — Pi's
> default resource loader was walking up from the project's working
> directory and ingesting the harness's own `CLAUDE.md`, which told the
> coding agent it was a read-only assistant that couldn't run bash or
> modify source code. With BUG-006 fixed the model's actual capability
> ceiling is much higher than we originally documented.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.

## Support

If this project helps you, you can support DreamForge Academy here: [Buy Me a Coffee](https://buymeacoffee.com/dreamforgeacademy).
