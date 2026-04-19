# LocalForge

> Long-running autonomous coding harness powered by **local** LLMs.

LocalForge lets you describe an app in plain language and watch AI coding agents
build it on your own hardware - no cloud, no API keys, no per-token billing.
Point it at a model running in [LM Studio](https://lmstudio.ai/), click Start,
and the orchestrator breaks your idea into features, tracks them on a kanban
board, and deploys agents to implement and test them one at a time.

---

## Status

Scaffolding complete. 86 features defined in the tracker and waiting to be
implemented by the coding agents. See progress on the kanban board once the
app boots.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | **20 or newer** | `node --version` |
| npm | ships with Node | |
| LM Studio | latest | Load `google/gemma-4-31b` and enable the API server on `http://127.0.0.1:1234` |
| Claude Code / Claude Agent SDK | latest | the coding agents use the SDK with `ANTHROPIC_BASE_URL` pointed at LM Studio |
| Playwright browsers | | `npx playwright install` (run once) |

## Getting started

```bash
# 1. Clone / cd into the project
cd localforge

# 2. First-time setup + launch (installs deps, runs migrations, starts dev server)
./init.sh
```

Open <http://localhost:3000> and follow the in-app flow to create your first
project.

### Useful scripts

| Command | What it does |
| --- | --- |
| `./init.sh` | install + migrate + start dev server (default) |
| `./init.sh --background` | start dev server in background, log to `dev-server.log` |
| `./init.sh --build` | build + start production server |
| `npm run dev` | just the Next.js dev server |
| `npm run db:generate` | generate a new Drizzle migration from schema changes |
| `npm run db:migrate` | apply pending migrations |
| `npm test` | run Playwright tests |

## Tech stack

- **Frontend:** Next.js 16 (App Router) + React 19, Tailwind CSS + shadcn/ui, dnd-kit, Sonner
- **Backend:** Next.js API routes (Node.js), SQLite + Drizzle ORM, Server-Sent Events
- **Agents:** Claude Agent SDK, configured via `ANTHROPIC_BASE_URL=http://127.0.0.1:1234`
- **Testing:** Playwright (`npx playwright test`)

## Project layout

```
app/                 Next.js App Router routes + API handlers
  api/               REST API endpoints
  globals.css        Tailwind entry + CSS variables for themes
components/          React components
  ui/                shadcn/ui primitives
lib/
  db/                Drizzle schema + SQLite connection
  agent/             Claude Agent SDK integration + orchestrator
data/                SQLite database file (git-ignored)
projects/            User-created project folders (git-ignored)
screenshots/         Playwright captures (git-ignored)
drizzle/             Generated migrations
tests/               Playwright .spec.ts files
```

## How the orchestrator works

1. You create a project, either manually or by chatting with the AI bootstrapper.
2. Features land in the **Backlog** column of the kanban, ordered by priority
   and respecting dependencies.
3. Click **Start Orchestrator** - LocalForge spawns a Claude Agent SDK session
   pointed at LM Studio, passes the highest-priority ready feature, and
   moves the card to **In Progress**.
4. The agent writes code, runs Playwright tests, and captures screenshots.
   Live output streams into the activity panel via SSE.
5. On success the card moves to **Completed**. On failure the feature returns
   to the backlog with demoted priority so other features can go first.
6. When all features pass, confetti. A summary modal shows what was built.

## Configuration

Per-project settings are stored in `.claude/settings.json` inside each project
folder, e.g.:

```json
{
  "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:1234" },
  "model": "google/gemma-4-31b"
}
```

Override per project via the project settings page, or globally via
**Settings** in the sidebar.

## License

MIT (or whatever the repo owner chooses - placeholder).
