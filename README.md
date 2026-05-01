# LocalForge

> Build apps on autopilot with local AI models. No cloud, no API keys, no per-token billing.

## Quick Start

### 1. Prerequisites

- **Node.js 20+** — [download here](https://nodejs.org/)
- **LM Studio** — [download here](https://lmstudio.ai/)

### 2. Set up LM Studio

1. Open LM Studio and download a model (e.g. `google/gemma-4-31b`)
2. Load the model and start the local API server (default: `http://127.0.0.1:1234`)

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

**Playwright verification** (off by default) runs after each feature; **Playwright headed browser**
shows a real Chromium window during that check and passes `playwright-cli open --headed` to the
coding agent so you can watch browser automation locally. When the `CI` environment variable is set,
verification stays headless regardless of the headed toggle. Headed mode uses a short Playwright
`slowMo` so actions are easier to follow.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
