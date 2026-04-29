# LocalForge Bug Tracker

Local-only tracker for fork-side fixes and enhancements that we plan to
upstream to `leonvanzyl/localforge` once verified. Not part of the user-
facing app.

Status legend: `OPEN` · `FIXED — pending verification` · `VERIFIED` · `UPSTREAMED`

Sections: BUG-* (defects), CHORE-* (project hygiene), ENH-* (proposed
enhancements — not yet implemented).

---

## BUG-001 — Tool-incompatible model causes infinite retry/demote loop

**Status:** VERIFIED (2026-04-29 live run on DreamForgeIdeas)
**Reported:** 2026-04-29
**Severity:** High (renders the harness unusable when paired with non-tool-capable models)

**Verification evidence:**

- With `gemma3:4b` configured, clicking run queue produced exactly three log
  lines for feature #4 ("Scaffold Next.js app"): one failure, one guidance
  message naming compatible models, one demotion-to-backlog message with the
  new "paused until next restart" suffix. No retry, no second pick.
- Switching the model to `llama3.2:latest` and clicking run queue
  successfully cleared the in-process blocklist and re-picked feature #4.
  The full 10-feature backlog ran end-to-end in 19m 02s.

### Symptom

When the configured model does not support tool calls (e.g. `gemma3:4b` on
Ollama), the orchestrator launches a Pi agent session that fails in ~500ms
with `400 ... does not support tools`, demotes the feature, then immediately
re-picks it. The loop continues indefinitely, spamming the agent log and
making the kanban unusable.

### Root cause

1. `scripts/agent-runner.mjs:isTransientError()` did not classify
   "does not support tools" (or other unrecoverable errors like model-not-found
   / unauthorized) as permanent, so the runner returned a generic failure.
2. `lib/agent/orchestrator.ts:finalizeSession()` always called
   `demoteFeatureToBacklog()` regardless of error class.
3. `findNextReadyFeatureForProject()` then picked the same feature again on
   the next auto-continue tick.

### Fix

- `scripts/agent-runner.mjs`
  - Added `isPermanentError()` matching `does not support tools`,
    `model not found`, `invalid api key`, `unauthorized`, `401`, `403`, etc.
  - On permanent errors: skip remaining retries, return `permanent: true` on
    the result, emit a guidance log naming compatible Ollama models
    (`llama3.2`, `qwen2.5-coder`, `mistral-nemo`).
  - The `done` event sent to the orchestrator now includes `permanent`.
- `lib/agent/orchestrator.ts`
  - Extended `RunnerDoneLine` with optional `permanent` flag.
  - Added `permanentlyBlocked: Set<number>` to per-process orchestrator state.
  - `finalizeSession()` adds the failed feature id to the blocklist when
    `permanent` is set, and the failure log explains the user must fix the
    model in settings then click Start.
  - All three `findNextReadyFeatureForProject()` call sites pass
    `excludeIds: getState().permanentlyBlocked`.
  - `startAllAgents()` clears the blocklist (explicit user Start = retry).
- `lib/features.ts`
  - `findNextReadyFeatureForProject()` accepts
    `{ excludeIds?: ReadonlySet<number> }` and filters the backlog.

### Files touched

- `scripts/agent-runner.mjs`
- `lib/agent/orchestrator.ts`
- `lib/features.ts`

### Manual test plan

1. Configure project to use a non-tool-capable model (e.g. `gemma3:4b` on
   Ollama at `http://127.0.0.1:11434`).
2. Click Start All.
3. **Expect:** one failure log entry, then a guidance message naming
   compatible models, then no further retry attempts on that feature.
   Other features remain pickable.
4. Switch model to `llama3.2` (or any tool-capable model) and click Start All.
5. **Expect:** the previously-blocked feature is eligible again and the agent
   runs normally.
6. Restart dev server with the bad model still configured — confirm the
   blocklist resets cleanly (in-memory only).

---

## BUG-002 — Typing lag in feature detail dialog during agent runs

**Status:** VERIFIED (2026-04-29 second live run on DreamForgeIdeas with
`qwen2.5-coder:32b`)
**Reported:** 2026-04-29
**Severity:** Medium (UX — feels like the input is autosaving on every keystroke)

**Verification evidence:**

- During an active `qwen2.5-coder:32b` agent run with continuous SSE log
  events streaming to the kanban (the most realistic stress condition),
  opened a non-active backlog feature and typed a long sentence into the
  Acceptance criteria textarea. Typing felt instant — no per-keystroke
  delay, no character drops.

### Symptom

Typing in the description / acceptance-criteria fields of the feature detail
dialog feels laggy, especially while an agent session is actively emitting
SSE log events.

### Root cause

The dialog does NOT autosave (despite the perception). The lag had two
contributors that compounded during agent runs:

1. The kanban parent (`forge-kanban.tsx`) holds `state.features` and replaces
   that array on every SSE log event. The dialog is rendered as
   `<FeatureDetailDialog allFeatures={state.features} ... />`, so every
   incoming log event triggered a full dialog re-render.
2. On each render, the title computed
   `[...allFeatures].sort((a,b)=>a.id-b.id).findIndex(...)` — an O(n log n)
   operation per keystroke with no memoisation.

### Fix

- `components/kanban/feature-detail-dialog.tsx`
  - Replaced the inline sort+findIndex with two `useMemo`s keyed on a stable
    id-list string (`idsKey`), so the computation only re-runs when features
    are actually added/removed/reordered.
  - Wrapped the dialog in `React.memo` with a custom comparator. The
    comparator ignores callback identity (parents typically pass inline
    arrows) and content-shallow-compares `allFeatures` against just the
    fields the dialog consumes (`id`, `title`, `status`). Updates to
    unrelated feature fields (priority, updatedAt, etc.) no longer bust
    the memo.

### Files touched

- `components/kanban/feature-detail-dialog.tsx`

### Manual test plan

1. Start an agent session that successfully runs (use a tool-capable model so
   it generates frequent SSE events for several minutes).
2. While the agent is actively running, open a feature detail dialog (the
   one currently being worked on or any other).
3. Type a long sentence into the acceptance-criteria field.
4. **Expect:** smooth, lag-free typing. Each character should appear with
   no perceptible delay.
5. Click Save and confirm the field persists correctly.
6. Repeat for the description field.

---

## BUG-003 — Bonus accessibility fix: dependency picker missing accessible name

**Status:** VERIFIED (2026-04-29 DevTools console check)
**Reported:** 2026-04-29 (caught by stricter Next 16 / eslint-plugin-jsx-a11y)
**Severity:** Low (a11y)

**Verification evidence:**

- In the running app, opened a backlog feature dialog, opened DevTools
  Console, and ran:
  `document.querySelector('[data-testid="feature-detail-dep-picker"]').getAttribute('aria-label')`
- Result: `'Add a prerequisite feature'` (the expected string).

### Symptom

The dependency picker `<select>` in the feature detail dialog had no
accessible name. Screen readers would announce just "combo box" with no
indication of its purpose.

### Fix

Added `aria-label="Add a prerequisite feature"` to the select.

### Files touched

- `components/kanban/feature-detail-dialog.tsx`

### Manual test plan

1. Open any feature in the detail dialog with at least one other feature
   present in the project.
2. Tab to the dependency picker.
3. **Expect:** screen reader (or browser DevTools accessibility panel)
   announces "Add a prerequisite feature, combo box".

---

## CHORE-001 — `npm run lint` was broken (Next 16 removed `next lint`)

**Status:** VERIFIED (2026-04-29 — `npm run lint` now executes ESLint and
reports the pre-existing debt; `npx tsc --noEmit` is clean)
**Reported:** 2026-04-29
**Severity:** Medium (project quality gate was bypassable)

### Symptom

`npm run lint` printed
`Invalid project directory provided, no such directory: H:\localforge\lint`
instead of running ESLint. `next lint` was removed in Next 16 but the npm
script and config were never migrated.

### Fix

- Added `eslint.config.mjs` (ESLint v9 flat config) that re-exports
  `eslint-config-next` (already a dependency).
- Updated the `lint` npm script to `eslint .`.
- Added an ignore list for `.next`, `node_modules`, `drizzle`,
  `playwright-report`, `test-results`, `projects`, and `*.log`.

### Pre-existing lint debt surfaced (NOT introduced by our changes)

Re-running lint exposed pre-existing errors and warnings on files we did
not modify (and on lines we did not touch):

- `react-hooks/set-state-in-effect` errors in
  `components/kanban/kanban-board.tsx`,
  `components/theme/theme-provider.tsx`,
  `components/forge/forge-kanban.tsx` (the AddFeatureDialog area), and the
  pre-existing `useEffect` at `feature-detail-dialog.tsx:176`.
- `react/no-unescaped-entities` errors at `feature-detail-dialog.tsx:732`.
- `@next/next/no-img-element` warnings at
  `feature-detail-dialog.tsx:853, 953, 1152`.
- Several `Unused eslint-disable directive` warnings in
  `lib/agent/orchestrator.ts`, `lib/agent/lm-studio.ts`,
  `lib/agent/providers/ollama.ts`, `lib/db/index.ts`, `lib/projects.ts`.

These should be cleaned up in a separate follow-up PR — not bundled with
the bug fixes above to keep the contribution scope tight.

### Files touched

- `eslint.config.mjs` (new)
- `package.json` (lint script)

### Manual test plan

1. Run `npm run lint` — expect ESLint to execute and report the pre-existing
   debt list above (3 errors, ~17 warnings).
2. Run `npx tsc --noEmit` — expect clean (no errors).

---

## BUG-004 — "Run queue" silently no-ops from non-kanban routes

**Status:** OPEN (observed during 2026-04-29 verification, not yet
investigated or fixed; out of scope for the current PR)
**Reported:** 2026-04-29
**Severity:** Medium (data loss in user trust — the user thinks they
launched a run, nothing happens, no error feedback)

### Symptom

Clicking the "Run queue" button while the user is on a sub-route or modal
overlay (e.g. settings panel just closed) sometimes results in:

- The button click registers visually (no error toast)
- No `START_REQUEST` entry appears in `agent-runner-debug.log`
- No POST hits the orchestrator endpoint in the dev-server access log
- The agent panel stays idle indefinitely
- Refreshing the page and clicking the button again works correctly

### Hypotheses (not yet confirmed)

1. The button's onClick uses a relative URL or a stale `projectId` derived
   from page state that's undefined on certain routes.
2. A modal overlay (settings) intercepts the click event even when it
   appears closed.
3. Hot module reload during a settings save resets the orchestrator's
   in-memory state mid-click.

### Triage suggestion

Check the request actually fires by opening DevTools Network tab, click
Run queue, and confirm a POST appears. If no request fires, the bug is
client-side. If the request fires and returns a non-200, it's
server-side. Currently no instrumentation distinguishes these.

---

## ENH-001 — Treat `tool_calls === 0` as failure, not success

**Status:** PROPOSED (not yet implemented)
**Reported:** 2026-04-29
**Severity:** Medium (the harness can mark fake completions as "done", which
silently corrupts a project's progress and gives no signal to the user that
the model is confabulating instead of working)

### Symptom

On the 2026-04-29 verification run, `llama3.2:3b` produced 10/10 green
"completed" toasts in 19m 02s for the DreamForgeIdeas backlog, with the
celebration screen and "Project Complete" UI. Inspecting the project
working directory `H:\localforge\projects\dreamforgeideas-2` afterwards
showed it was **empty except for the `.pi/` config folder** — the agent had
made zero file writes. The model produced final assistant messages claiming
completion ("I have scaffolded the Next.js app...") without ever invoking
`Bash`, `Edit`, or `Write` tools.

### Root cause

`scripts/agent-runner.mjs:runCodingAgentOnce()` returns `ok: true` whenever
the Pi SDK reports a successful session subtype, regardless of whether
`toolCalls > 0`. There is no floor on the amount of actual work an agent
must do to claim a feature is complete.

For features whose acceptance criteria require filesystem mutations
(scaffolding, file creation, dependency installation), zero tool calls is
trivially incompatible with success.

### Proposed fix

In `scripts/agent-runner.mjs`, treat `result.toolCalls === 0` as a failure
unless the feature explicitly opts in to tool-less completion (extremely
rare — maybe a research/notes-only feature). Concretely:

1. After `runCodingAgent()` returns, if `result.ok && result.toolCalls === 0`:
   - Log an error explaining the model produced no tool calls
   - Override `result.ok = false`, set
     `result.errorMessage = "Agent claimed success without invoking any tools — likely confabulating."`
   - Do **not** mark this as `permanent` (the next session may behave
     differently — it's a quality issue, not a config issue)
2. Make the floor configurable via `LOCALFORGE_MIN_TOOL_CALLS` env var
   (default 1) for users who genuinely have no-op features.

### Files that would change

- `scripts/agent-runner.mjs`
- `lib/agent/orchestrator.ts` (only if we want to surface a distinct
  "no-op claimed" status in the UI — optional)

### Manual test plan

1. Configure project to use `llama3.2:3b` (or any small model that tends
   to confabulate).
2. Add a feature whose work clearly requires file writes (e.g. "Create
   hello.txt").
3. Click run queue.
4. **Expect:** if the model claims success without invoking tools, the
   feature is marked failed (not completed), and the log shows the new
   "claimed success without invoking any tools" message.
5. Verify a normal run with `qwen2.5-coder:7b` is unaffected (real tool
   calls → still completes normally).

---

## ENH-002 — Add "copy logs to clipboard" button to feature detail dialog

**Status:** PROPOSED (not yet implemented)
**Reported:** 2026-04-29
**Severity:** Low (DX — currently users must manually select and copy log
text to share or file an issue)

### Symptom

The feature detail dialog renders agent logs as styled rows. To share them
(file an issue, paste in Slack, send to a teammate, attach to a bug
report), the user has to click-drag-select across multiple log lines and
fight the surrounding modal's scroll/focus behaviour. There's no one-click
way to grab all logs for a feature.

### Proposed fix

Add a small clipboard-icon button in the agent-log section header of
`components/kanban/feature-detail-dialog.tsx`. On click:

1. Concatenate all log entries for the current feature into plain text:
   one entry per line, format `HH:MM:SS  [type]  message` (with screenshot
   paths inlined when present).
2. Call `navigator.clipboard.writeText(...)`.
3. Show a transient "Copied" confirmation (Sonner toast, ~2s).
4. If `navigator.clipboard` is unavailable (rare — non-secure context),
   fall back to selecting the log text via `Range` + `Selection` so the
   user can hit Ctrl+C.

### Files that would change

- `components/kanban/feature-detail-dialog.tsx`

### Manual test plan

1. Open a feature with several log entries.
2. Click the new "Copy logs" button.
3. **Expect:** transient confirmation toast.
4. Paste into a text editor — expect one log entry per line in
   chronological order with timestamps and message-type tags.
5. Test in an insecure context (e.g. open via raw IP) — expect the
   fallback selection path to work.

---

## ENH-003 — Warn before launching with a low-capability model

**Status:** PROPOSED (not yet implemented)
**Reported:** 2026-04-29
**Severity:** Medium (UX — small models routinely produce green
"completed" toasts for projects where nothing was actually built; the
user wastes a 20-minute run before discovering the project directory is
empty)

### Symptom

The settings panel currently validates that the selected Ollama/LM Studio
model exists and that its weights fit in VRAM ("Fits comfortably,
gemma3:4b (4B) needs ~2.4 GB at Q4 — your VRAM is 8.0 GB"). But there is
no signal about whether the model is **capable** of doing real coding work
through the harness:

- `gemma3:4b` was happy to be selected — it took us a live run to discover
  it has no tool-call support at all (now caught by BUG-001's permanent-
  error path, but the user still wastes one Start cycle).
- `llama3.2:3b` was happy to be selected — it cleared all guards, ran for
  19 minutes, claimed 10/10 features complete, and produced **zero file
  writes**. The user only finds out after opening the project directory.

There is no upfront friction proportional to the cost of the mistake.

### Proposed fix

In the settings panel's model picker, attach a capability badge per model
based on a maintained list. Three tiers:

- ✅ **Tool-capable, code-suitable** — green badge, no warning. Examples
  on Ollama: `qwen2.5-coder:7b`+, `llama3.1:8b`+, `mistral-nemo:12b`+,
  `deepseek-coder-v2:16b`+, `codestral`.
- ⚠️ **Tool-capable but small / risky** — yellow badge with hover text:
  "Small model (≤4B) — may invoke tools but typically produces partial
  or hallucinated work on multi-step features. Consider a 7B+ code model
  for real builds." Examples: `llama3.2:3b`, `qwen2.5:3b`,
  `phi3.5:3.8b`.
- ❌ **No tool support** — red badge with hover text: "This model does
  not support tool calls. The agent cannot use Bash, Edit, or Write.
  Pick a tool-capable model." Examples: `gemma3:*`, `gemma2:*`,
  `phi3:mini`.

Clicking Start with a ⚠️ or ❌ model shows a confirmation dialog instead
of launching directly.

The capability list lives in a versioned constant (e.g.
`lib/agent/model-capabilities.ts`) so contributors can update it as new
models ship. A Marketplace-style remote update is out of scope for the
first iteration.

### Files that would change

- `lib/agent/model-capabilities.ts` (new — the capability list)
- `lib/agent/providers/ollama.ts` (annotate the model listing with
  capability info)
- `components/settings/*.tsx` (render the badge + tooltip in the model
  picker; show the confirmation dialog before run queue)

### Manual test plan

1. With `gemma3:4b` selected, settings panel shows ❌ badge and the
   "no tool support" hover text.
2. With `llama3.2:3b` selected, settings panel shows ⚠️ badge and the
   "small model — may produce partial work" hover text.
3. Clicking run queue with either ⚠️ or ❌ shows a confirmation dialog
   that lists better alternatives and requires explicit "Start anyway".
4. With `qwen2.5-coder:7b` selected, no badge or warning appears.
5. Adding a new entry to `model-capabilities.ts` is reflected in the UI
   on next reload.

### Relationship to ENH-001

ENH-003 is preventive (block the bad config upfront); ENH-001 is
detective (catch the bad outcome at session-end). Both should ship — they
defend at different layers.

---

## ENH-004 — Bulk-select and delete on the kanban

**Status:** PROPOSED (not yet implemented)
**Reported:** 2026-04-29
**Severity:** Low (DX — currently a 10-feature reset requires 30 clicks)

### Symptom

When iterating on backlog content (especially while testing the harness
itself, but also for normal users who want to redo an AI-generated
backlog), the only way to remove multiple feature cards is to open each
card individually, click "Delete feature", and confirm — three clicks per
card. Resetting a 10-card backlog takes ~30 clicks and minutes of
repetitive work.

### Proposed fix

Add a bulk-select mode to the kanban:

1. A "Select" toggle in the kanban header switches each card into a state
   with a checkbox in the corner.
2. Selecting one or more cards reveals a sticky action bar with
   "Delete N selected" and "Cancel" buttons.
3. Confirming triggers a bulk DELETE — either via a new
   `DELETE /api/projects/[id]/features` endpoint accepting an `ids[]`
   array, or by issuing parallel single-feature DELETEs from the client.
4. Optional: also offer "Skip N selected" (move to end of queue) and
   "Set status..." actions.

### Files that would change

- `components/forge/forge-kanban.tsx` (selection state + action bar)
- `components/kanban/feature-card.tsx` (checkbox in select mode)
- `app/api/projects/[id]/features/route.ts` (optional bulk DELETE)

### Manual test plan

1. Click "Select" in the kanban header.
2. Click 3 cards across different columns — confirm checkboxes appear and
   stay checked.
3. Click "Delete 3 selected" → confirmation dialog → confirm.
4. All 3 cards disappear; sticky action bar dismisses.
5. Test edge cases: deleting an in-progress feature (should warn), and
   trying to bulk-select while an agent is running.

---

## ENH-005 — Soften "Won't fit" warning to allow CPU spillover

**Status:** PROPOSED (not yet implemented)
**Reported:** 2026-04-29
**Severity:** Low (UX — discourages valid power-user choices)

### Symptom

The hardware-detection panel currently rejects models that exceed
available VRAM with the wording:

> **Won't fit — switch to a smaller model**
> qwen2.5-coder:32b (32B) needs ≈ 20.5 GB at Q4 — your VRAM is 8.0 GB.
> Suggested model sizes that fit: 0-2B, 2-4B, 4-9B

This is overly prescriptive. Ollama can run an oversized model by
spilling unfit layers to system RAM/CPU. The result is much slower
generation (often 3–10 tokens/sec, vs. 30–80 tok/s when fully on GPU)
but still functional and useful for batch / overnight runs.

Verified during the 2026-04-29 run: with this exact warning displayed,
`qwen2.5-coder:32b` ran successfully on a machine with 8GB VRAM,
producing real working code with reasonable per-feature wall time.

### Proposed fix

Replace the "switch to a smaller model" framing with one that explains
the trade-off:

> **Won't fit fully in VRAM**
> qwen2.5-coder:32b (32B) needs ≈ 20.5 GB at Q4, your VRAM is 8.0 GB.
> Ollama will offload unfit layers to system RAM/CPU, so generation will
> be significantly slower (often 3–10 tokens/sec). For faster runs, use
> a model that fits in VRAM. Suggested fully-fitting sizes: 0-2B, 2-4B, 4-9B.

The "Use best fit" button can stay — it's a reasonable shortcut. The
panel border color could shift from red ("error") to amber ("warning").

### Files that would change

- `components/settings/hardware-panel.tsx` (or wherever the warning copy
  lives)

### Manual test plan

1. Configure a model that exceeds VRAM (e.g. `qwen2.5-coder:32b` on 8GB).
2. Verify the new warning copy renders — yellow/amber, not red, and
   names the trade-off explicitly.
3. Click run queue and confirm the run still proceeds (i.e. the warning
   does not block start).

---

## Verification checklist (before opening PR to leonvanzyl/localforge)

- [x] BUG-001: gemma3:4b stops retrying after one failure with guidance message
- [x] BUG-001: switching to llama3.2 unblocks the feature on next Start
- [x] BUG-002: typing in acceptance criteria is smooth during a live agent run
      (verified 2026-04-29 with `qwen2.5-coder:32b`)
- [x] BUG-003: dependency picker is announced with its purpose (DevTools
      console returned `'Add a prerequisite feature'`)
- [x] CHORE-001: `npm run lint` runs without the "Invalid project directory" error
- [x] `npx tsc --noEmit` is clean
- [ ] No regressions on the kanban DnD, Save flow, Delete flow, dependency edit
      (manual smoke pass before commit)

### PR scoping notes

Files included in the upstream contribution:

- `scripts/agent-runner.mjs` (BUG-001 — permanent-error classification)
- `lib/agent/orchestrator.ts` (BUG-001 — blocklist + plumb permanent flag)
- `lib/features.ts` (BUG-001 — `excludeIds` parameter)
- `components/kanban/feature-detail-dialog.tsx` (BUG-002 + BUG-003)
- `eslint.config.mjs` (CHORE-001 — new file)
- `package.json` (CHORE-001 — `lint` script update)
- `dev/bugtracker.md` (this file — included in PR per user request, so
  reviewers can see verification evidence and the proposed enhancements)

**NOT implemented in this PR — tracked here for future contributions:**

- BUG-004 — Run queue silently no-ops from non-kanban routes (needs
  separate triage)
- ENH-001 — Treat `tool_calls === 0` as failure
- ENH-002 — Copy logs to clipboard
- ENH-003 — Capability-aware model picker (warn for low-capability models)
- ENH-004 — Bulk-select and delete on the kanban
- ENH-005 — Soften "Won't fit" warning to allow CPU spillover

These should be filed as separate issues / PRs upstream so the current
contribution stays narrowly scoped to the verified bug fixes.
