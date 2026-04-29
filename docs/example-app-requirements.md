# DreamForgeIdeas — Example App Requirements

This document describes the example application LocalForge will build for
the `DreamForgeIdeas` workspace. It exists so contributors and reviewers
can see what "good output" looks like for a small local model running
through the harness, and so the harness's own dependency graph stays in
sync with a written spec.

The companion file [`example-app-features.json`](./example-app-features.json)
contains the same work broken into 10 atomic features ready to POST into
the LocalForge backlog API, plus the dependency wiring.

---

## Overview

A basic single-user Next.js app for tracking SaaS app ideas. Runs locally
on port 3000, persists to a local SQLite file, no auth.

**Local path:** `H:\DreamForgeIdeas`

---

## Why split this into 10 features?

LocalForge is designed around small, atomic features that a small local
model (4B–13B params on consumer hardware) can plausibly complete in one
agent session. A single "Build SaaS App" card asking the agent to scaffold
Next.js + Tailwind + SQLite + Drizzle + sidebar + table + modal + CRUD +
sort/search in one shot is unrealistic — the model burns tokens, drifts,
and never converges.

Each feature below is sized for one session: one well-defined deliverable,
clear verification, and a tight dependency on whatever came before it.

---

## Tech stack

- **Framework:** Next.js 15 (App Router) + TypeScript
- **Styling:** Tailwind CSS
- **DB:** SQLite (file-based, in the project root)
- **ORM:** Drizzle ORM + drizzle-kit
- **UI primitives:** plain HTML elements styled with Tailwind (no shadcn,
  to keep dependencies minimal for the example)

---

## Data model — `ideas` table

| Column            | Type           | Notes                                    |
|-------------------|----------------|------------------------------------------|
| `id`              | integer PK     | autoincrement                            |
| `name`            | text NOT NULL  | display name                             |
| `description`     | text NULL      | rendered as resizable textarea           |
| `status`          | text NOT NULL  | enum-as-text: `idea` / `building` / `launched`, default `idea` |
| `githubUrl`       | text NULL      | clickable link in table                  |
| `localRepoPath`   | text NULL      | filesystem path                          |
| `productionUrl`   | text NULL      | clickable link in table                  |
| `marketSector`    | text NULL      | freeform string                          |
| `progressPercent` | integer NOT NULL | 0–100, default 0                       |
| `createdAt`       | text NOT NULL  | ISO timestamp, default `CURRENT_TIMESTAMP` |
| `updatedAt`       | text NOT NULL  | ISO timestamp, refreshed on update       |

---

## UI layout

```
┌──────────────────────────────────────────────────────┐
│  Sidebar (~240px)        │   Main content            │
│                          │                           │
│  [+ Add New Idea]        │   ┌─────────────────────┐ │
│  [View All Ideas]        │   │ search input        │ │
│                          │   ├─────────────────────┤ │
│                          │   │ ideas table         │ │
│                          │   │ name | status | ... │ │
│                          │   └─────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

Soft beige / neutral palette (`bg-stone-50`, `bg-stone-100`, `text-stone-800`).
Clean typography, no decorative gradients.

---

## The 10 atomic features

Dependency arrows show what must be `completed` before a feature is
eligible for pickup.

```
1. Scaffold Next.js
        │
        ▼
2. Add SQLite + Drizzle
        │
        ▼
3. Define ideas schema
        │
        ▼
4. List/create ideas API ──────┐
        │                      │
        ▼                      │
5. Update/delete ideas API     │
                               │
6. Layout shell with sidebar ──┤
                               │
                               ▼
                       7. Ideas table UI
                               │
                               ▼
                       8. Add idea modal
                               │
                               ▼
                       9. Inline edit + delete
                               │
                               ▼
                      10. Sortable columns + search
```

### 1. Scaffold Next.js app
Initialize a Next.js 15 App Router project at `H:\DreamForgeIdeas` with
TypeScript and Tailwind. Confirm `npm run dev` starts on port 3000.

**Acceptance:**
- `package.json` lists `next`, `react`, `react-dom`, `tailwindcss`
- `app/page.tsx` and `app/layout.tsx` exist
- `npm run dev` listens on `http://localhost:3000`

### 2. Add SQLite + Drizzle ORM
Install `better-sqlite3`, `drizzle-orm`, `drizzle-kit`. Add `lib/db.ts`
opening `data.sqlite` and a `drizzle.config.ts` pointing at `lib/schema.ts`.

**Acceptance:**
- `lib/db.ts` exports a `db` Drizzle instance
- `drizzle.config.ts` references `./lib/schema.ts` and `./drizzle`
- `npx drizzle-kit generate` runs without error (even if schema is empty)

### 3. Define ideas schema
Write the `ideas` table schema in `lib/schema.ts` with the 9 columns from
the data model above plus `createdAt` / `updatedAt`. Generate and apply the
migration.

**Acceptance:**
- `data.sqlite` exists in the project root
- `sqlite3 data.sqlite ".schema ideas"` shows all 11 columns
- A no-op `drizzle-kit generate` afterwards reports "no changes"

### 4. List/create ideas API
Add `app/api/ideas/route.ts` exporting `GET` (returns `{ ideas: Idea[] }`)
and `POST` (inserts from the JSON body, returns the row).

**Acceptance:**
- `curl http://localhost:3000/api/ideas` → `{ "ideas": [] }` initially
- `curl -X POST -H 'content-type: application/json' -d '{"name":"x"}' http://localhost:3000/api/ideas` → 201 with row including default `status: "idea"` and `progressPercent: 0`
- POST without `name` returns 400

### 5. Update/delete ideas API
Add `app/api/ideas/[id]/route.ts` exporting `PATCH` (partial update) and
`DELETE`.

**Acceptance:**
- PATCH with `{ "progressPercent": 50 }` updates only that field, returns the new row
- PATCH on a nonexistent id returns 404
- DELETE returns `{ "success": true }` and a follow-up GET no longer lists the id
- DELETE on a nonexistent id returns 404

### 6. Layout shell with sidebar
Edit `app/layout.tsx` to render a flex container: left sidebar (~240px,
beige background) with two buttons ("Add New Idea", "View All Ideas") and
a main content area on the right. Buttons have no handlers yet — visual
shell only.

**Acceptance:**
- Sidebar visible on every route, fixed width
- Buttons are styled and focusable but inert
- Page background uses `bg-stone-50` and the sidebar uses a slightly
  darker tone (`bg-stone-100` or similar)

### 7. Ideas table UI
Make `app/page.tsx` a client component that fetches `/api/ideas` on mount
and renders a table with columns: name, status, marketSector,
progressPercent, githubUrl, productionUrl. URLs are clickable, progress
shown as `42%`. Empty state: "No ideas yet."

**Acceptance:**
- With an empty DB, the page shows "No ideas yet"
- After a POST via curl, refreshing the page shows the row
- URL columns render `<a href target="_blank" rel="noreferrer">`

### 8. Add idea modal
Wire the sidebar "Add New Idea" button to open a modal with a form for all
8 user-editable fields. On submit, POST to `/api/ideas` and refresh the
table.

**Acceptance:**
- Clicking the sidebar button opens the modal
- ESC or a close button dismisses the modal
- Submitting the form with a `name` value adds a row to the table without
  a full page reload

### 9. Inline edit + delete
Add an action column with "Edit" and "Delete" buttons per row. Edit reuses
the modal pre-filled with the row's values, calling PATCH on save. Delete
prompts via `window.confirm` and calls DELETE.

**Acceptance:**
- Edit modal is pre-populated with the row's current values
- Save updates the row via PATCH and the table reflects the new values
- Delete prompts for confirmation; cancelling does nothing; confirming
  removes the row

### 10. Sortable columns + search
Make the name, status, marketSector, and progressPercent columns sortable
(click header to toggle asc/desc, indicator arrow on the active column).
Add a search input above the table that filters by name or marketSector
(case-insensitive substring match) before sorting.

**Acceptance:**
- Clicking a sortable header toggles asc → desc → asc
- Active sort column shows ▲ or ▼
- Typing in the search input filters rows in real time
- Search and sort compose correctly (e.g. search "saas" then sort by
  progress)

---

## Out of scope

- Authentication, multi-user, cloud sync, deployment.
- Migrations beyond the initial schema.
- Tests (each feature's acceptance criteria are checked manually or by
  the harness's optional Playwright phase).
- Component libraries beyond Tailwind utilities.
