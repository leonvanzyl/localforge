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

LocalForge uses the local model's tool-calling support to drive a coding agent.
That capability varies a lot between models — and not every locally-runnable
model handles it correctly. Three classes:

- **Tool-call broken (do not use):** any model whose Ollama chat template
  doesn't emit structured `tool_calls`, or that ships without tool support
  at all (e.g. `gemma3:*`, `gemma2:*`, `phi3:mini`). LocalForge will detect
  this on the first failed attempt and pause the feature with a guidance
  message — no infinite retry loops — but you'll need to switch models to
  make progress.
- **Tool-call works, incremental edits unreliable:** smaller code models
  on Ollama like `qwen2.5-coder:7b`, `llama3.1:8b`, `llama3.2:latest`. They
  can run a one-shot scaffold (`npx create-next-app .`) but tend to read
  files and "claim done" without writing follow-up changes. LocalForge's
  workspace-fingerprint guard catches this and demotes the feature
  honestly rather than reporting fake progress, but the larger backlog
  will not finish on these models alone.
- **Tool-call works, multi-step works:** larger code-specialised models or
  frontier-tier models. Locally, this means 30B+ code models and they
  typically need real GPU horsepower. `gpt-oss:20b` does the structured
  tool-call format correctly but still struggles with incremental edits;
  it works best for one-shot scaffold steps.

For a practical first run on consumer hardware, we recommend keeping the
backlog small and atomic (one bash command or one file write per feature)
and pulling a code-specialised model that fits in your VRAM at Q4. The
example backlog shipped under `docs/example-app-features.json` follows
this pattern.

If a model emits JSON-shaped tool calls in plain assistant text instead of
structured `tool_calls`, the harness will surface a clear "agent claimed
success without invoking any tools" error — that's the signal to switch.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
