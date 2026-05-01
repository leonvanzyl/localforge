---
name: localforge
description: Create, read, update, and delete features and projects in LocalForge via its REST API. Use this skill whenever the user wants to manage features in LocalForge — create a feature backlog, plan features, update existing features, break down an app into tasks, or populate a kanban board. Also trigger when the user mentions LocalForge, feature planning for local AI coding agents, or writing detailed feature descriptions — even if they don't explicitly say "create features." LocalForge is the app that uses local AI models to build software autonomously.
allowed-tools: Bash(python *), Bash(curl *), Write
---

# Manage Features for LocalForge

## Why this skill exists

LocalForge uses local AI models to implement features one by one. These local models are capable coders, but they struggle when feature descriptions are vague. A feature titled "Add authentication" with no further detail leaves the coding agent guessing about login flows, session handling, password rules, and error states — and it will guess wrong.

This skill exists so that a more capable model (you) can have a thorough conversation with the user, understand exactly what they want, and write features detailed enough that the local coding agent can implement them by following the instructions step by step. Think of yourself as a senior engineer writing tickets for a competent but literal junior developer — every feature should be self-contained and unambiguous.

## Helper script

**All API calls go through the Python helper script** at:

```
.claude/skills/localforge/scripts/lf.py
```

This avoids bash/curl quoting nightmares with long JSON payloads. The pattern is:

1. Write your JSON data to a temp file using the Write tool
2. Call `python .claude/skills/localforge/scripts/lf.py <command> --file <path>`
3. Read the JSON response from stdout

**IMPORTANT — use the Write tool + `--file` pattern for any command that sends JSON.** Do NOT try to pass JSON inline via curl or bash string interpolation. That is the #1 source of agent failures with this API.

### Script reference

```bash
# Server health check
python .claude/skills/localforge/scripts/lf.py health

# --- Projects ---
python .claude/skills/localforge/scripts/lf.py projects                              # List all
python .claude/skills/localforge/scripts/lf.py project-get <id>                      # Get one
python .claude/skills/localforge/scripts/lf.py project-create --file data.json       # Create
python .claude/skills/localforge/scripts/lf.py project-update <id> --file data.json  # Update
python .claude/skills/localforge/scripts/lf.py project-delete <id>                   # Delete

# --- Features ---
python .claude/skills/localforge/scripts/lf.py features <project_id>                         # List all for project
python .claude/skills/localforge/scripts/lf.py feature-get <id>                              # Get one
python .claude/skills/localforge/scripts/lf.py feature-create <project_id> --file data.json  # Create one
python .claude/skills/localforge/scripts/lf.py feature-update <id> --file data.json          # Update one
python .claude/skills/localforge/scripts/lf.py feature-delete <id>                           # Delete one
python .claude/skills/localforge/scripts/lf.py feature-create-bulk <project_id> --file data.json  # Create many

# --- Dependencies ---
python .claude/skills/localforge/scripts/lf.py deps-list <feature_id>                       # List deps
python .claude/skills/localforge/scripts/lf.py deps-set <feature_id> --file data.json       # Bulk-replace deps
python .claude/skills/localforge/scripts/lf.py deps-delete <feature_id> <depends_on_id>     # Remove one dep

# --- Options ---
# --base <url>   Override base URL (default: http://localhost:7777)
# --file <path>  Path to a JSON file with the request body
```

### Example: creating a single feature

Step 1 — Write the JSON file:

```json
{
  "title": "Build user registration form with email and password validation",
  "description": "Create a full-page form at /register with email input, password input, and a Submit button...",
  "acceptanceCriteria": "- Page renders a form with email input, password input, and Submit button\n- Email input shows error when submitted with invalid format\n- Password must be at least 8 characters\n- Successful submission creates a user record in the database",
  "category": "functional"
}
```

Step 2 — Call the script:

```bash
python .claude/skills/localforge/scripts/lf.py feature-create 1 --file /tmp/feature.json
```

### Example: bulk-creating features

Step 1 — Write a JSON array file:

```json
[
  {
    "title": "Set up database schema for users and recipes",
    "description": "...",
    "acceptanceCriteria": "...",
    "category": "functional"
  },
  {
    "title": "Build REST API endpoints for recipe CRUD",
    "description": "...",
    "acceptanceCriteria": "...",
    "category": "functional"
  }
]
```

Step 2 — Call:

```bash
python .claude/skills/localforge/scripts/lf.py feature-create-bulk 1 --file /tmp/features.json
```

The script creates each feature sequentially, prints progress to stderr, and outputs a summary JSON with `created` (array of created features with IDs) and `errors` (any failures).

### Example: updating a feature

```json
{
  "title": "Updated title here",
  "status": "in_progress"
}
```

```bash
python .claude/skills/localforge/scripts/lf.py feature-update 42 --file /tmp/update.json
```

Updatable fields: `title`, `description`, `acceptanceCriteria`, `status` (backlog|in_progress|completed), `priority`, `category`.

### Example: setting dependencies

```json
{
  "dependsOn": [1, 3, 5]
}
```

```bash
python .claude/skills/localforge/scripts/lf.py deps-set 42 --file /tmp/deps.json
```

This bulk-replaces all dependencies for feature 42. Pass `{"dependsOn": []}` to clear all dependencies.

## Connecting to LocalForge

The LocalForge server must be running for this skill to work. The default URL is `http://localhost:7777`. If the user says their server is on a different port, use `--base http://localhost:PORT` on every script call.

**Step 1 — always check connectivity first:**

```bash
python .claude/skills/localforge/scripts/lf.py health
```

If this fails, stop and tell the user:

> "I can't reach LocalForge at http://localhost:7777. Please make sure LocalForge is running (run `npm run dev` in the LocalForge directory) and try again."

Do not proceed until the health check passes.

## Workflow

Follow these steps in order. Do not skip the conversation phase — the whole point is writing detailed features, and that requires understanding the app deeply.

### Step 1: List projects

```bash
python .claude/skills/localforge/scripts/lf.py projects
```

Present the projects to the user as a numbered list showing name, status, and progress (e.g., "3/12 features done"). If no projects exist, offer to create one.

### Step 2: Select or create a project

Ask the user which project to work on. If they want a new project, write the project data to a file and call the script:

```bash
python .claude/skills/localforge/scripts/lf.py project-create --file /tmp/project.json
```

Where the JSON file contains:

```json
{"name": "Project Name", "description": "Brief description"}
```

This returns `{ "project": { "id": N, ... } }`. Use the project ID for all subsequent calls.

### Step 3: Review existing features

```bash
python .claude/skills/localforge/scripts/lf.py features PROJECT_ID
```

If features already exist, show the user a summary (title, status, category for each). This context prevents duplicates and helps you understand what's already been planned or built.

### Step 4: Requirements conversation

This is the most important step. Have a genuine conversation with the user about what they're building. Do not rush to create features.

Ask about these areas, one or two at a time. Wait for answers before moving on:

**Round 1 — The big picture:**

- What is the app? What problem does it solve?
- Who uses it? What's their main goal?
- Walk me through what a user does from opening the app to accomplishing their task.

**Round 2 — Data and structure:**

- What "things" exist in the app? (users, posts, items, orders, etc.)
- How do they relate to each other?
- What does the main screen look like? What other screens/pages are there?

**Round 3 — Details and edges:**

- What happens when something goes wrong? (network errors, invalid input, empty states)
- Are there different user roles or permissions?
- Any external services or APIs involved?
- Any specific UI preferences? (dark mode, specific layout style, component library)

Ask follow-up questions when answers are vague. "Users can manage their stuff" needs to become "Users can create, edit, and delete recipes. Each recipe has a title, ingredient list, step-by-step instructions, and an optional photo."

You should ask at least 2-3 rounds of questions before moving on. If the user gives very detailed requirements upfront, you can shorten this — but always confirm your understanding before proceeding.

### Step 5: Plan the feature breakdown

Before creating anything, present a proposed feature list. Show:

1. Feature titles in the order they should be built
2. Category for each (functional or style)
3. Dependencies (which features must be built first)

Structure features in dependency order:

- **Foundation first:** database schema, project setup, app shell/layout
- **Then data layer:** API routes, data fetching, core CRUD operations
- **Then UI and behavior:** pages, forms, interactive components, navigation
- **Then polish:** animations, responsive design, theme refinements, visual tweaks

Ask the user: "Here's my proposed feature breakdown. Want to add, remove, or change anything before I create them?"

Only proceed after the user approves the plan.

### Step 6: Create features

Write all features as a JSON array file and use the bulk-create command:

```bash
python .claude/skills/localforge/scripts/lf.py feature-create-bulk PROJECT_ID --file /tmp/features.json
```

The output includes each created feature's ID. Parse the response to build a title-to-ID mapping for wiring dependencies.

Create features in dependency order (foundational features first) so that when you wire dependencies, all referenced IDs already exist.

### Step 7: Wire dependencies

After all features are created, set up dependencies using the deps-set command. Write a JSON file for each feature that has dependencies:

```bash
python .claude/skills/localforge/scripts/lf.py deps-set FEATURE_ID --file /tmp/deps.json
```

Where the JSON file contains:

```json
{"dependsOn": [ID1, ID2]}
```

Only add dependencies where they genuinely matter — where a feature cannot be built without another being complete first. Don't over-chain features that could be implemented independently.

### Step 8: Verify and summarize

Fetch the features one more time to confirm everything was created:

```bash
python .claude/skills/localforge/scripts/lf.py features PROJECT_ID
```

Present a final summary: total features created, the dependency graph, and any notes about build order. Let the user know they can now go to the LocalForge UI to see their kanban board populated with the new features.

## Feature quality standards

This is the heart of the skill. Every feature you create must be detailed enough that a less-capable local model can implement it without asking clarifying questions.

### Titles

- Short imperative sentence, under 100 characters
- Start with an action verb: "Build", "Create", "Implement", "Add", "Set up"
- Be specific about what's being built

Good: `Create user registration form with email and password validation`
Good: `Build REST API endpoints for CRUD operations on recipes`
Good: `Implement drag-and-drop reordering for task list items`

Bad: `User auth` (too vague)
Bad: `Set up the backend stuff for managing data` (what data?)
Bad: `Make the UI look good` (not actionable)

### Descriptions

Write 150-500 words describing exactly what "done" looks like. Include:

- **UI specifics:** What components appear on screen, where they're positioned, what they display. "A form with two text inputs (email and password), a 'Sign Up' button below them, and a link to the login page underneath."
- **Data details:** Field names, types, validation rules. "The recipe title is required, max 200 characters. The ingredient list is an array of objects with `name` (string), `amount` (number), and `unit` (string, one of: cups, tbsp, tsp, oz, g, ml, pieces)."
- **Behavior:** What happens on user actions. "When the user clicks Submit: validate all fields, show inline error messages for invalid fields, and if valid, POST to /api/recipes. On success, redirect to the recipe detail page. On error, show a toast notification with the error message."
- **Edge cases:** Empty states, loading states, error handling. "If the user has no recipes, show a centered illustration with the text 'No recipes yet' and a 'Create your first recipe' button."
- **Scope boundaries:** What this feature does NOT include, if it could be ambiguous. "This feature covers the creation form only — editing and deletion are handled in separate features."

### Acceptance criteria

Write a checklist of testable criteria. Each item should be independently verifiable — a coding agent (or a human tester) should be able to check each one without ambiguity.

Format as a bulleted list. Aim for 5-15 criteria per feature depending on complexity.

Good criteria:

- `Page renders a form with email input, password input, and Submit button`
- `Email input shows error "Valid email required" when submitted with invalid format`
- `Password must be at least 8 characters; error shown if shorter`
- `Successful submission creates a user record in the database`
- `After successful signup, user is redirected to the dashboard`
- `If email already exists, form shows "An account with this email already exists"`
- `Submit button shows a loading spinner while the request is in flight`
- `Form is centered on the page and works on both desktop and mobile widths`

Bad criteria:

- `It works` (not testable)
- `Form validates input` (which input? what validation? what error messages?)
- `Good UX` (subjective)

### Categories

- **`functional`** — any feature involving logic, data, API endpoints, state management, navigation, user interaction. This is the default.
- **`style`** — purely visual changes with no logic: colors, spacing, typography, animations, responsive breakpoints, theme adjustments.

When in doubt, use `functional`.

### Dependencies

A feature should depend on another only when it genuinely cannot be built without the other being complete. Common dependency patterns:

- API routes depend on database schema
- UI pages depend on the API routes they call
- Complex interactions depend on the base components they compose
- Style features depend on the functional features they're styling

Don't create unnecessary chains — if two features are independent, don't make one depend on the other just because you'd build them in a certain order.

## Example feature

Here's one complete example showing the expected level of detail:

**Title:** `Build recipe creation form with title, ingredients, and instructions`

**Description:**
Create a full-page form at the route `/recipes/new` for adding a new recipe. The form has three sections arranged vertically.

Section 1 — Basics: A text input for the recipe title (required, max 200 characters) and a textarea for an optional description (max 1000 characters). Show a character counter below each field.

Section 2 — Ingredients: A dynamic list where the user can add ingredient rows. Each row has three fields: ingredient name (text input), amount (number input), and unit (dropdown select with options: cups, tbsp, tsp, oz, g, ml, pieces, whole). There's an "Add ingredient" button below the list. Each row has a delete button (trash icon) on the right side. At least one ingredient is required.

Section 3 — Instructions: A dynamic list of step-by-step instructions. Each step is a textarea. Steps are numbered automatically. Users can add and remove steps with "Add step" and delete buttons. At least one step is required.

At the bottom of the form, there are two buttons: "Save Recipe" (primary, submits the form) and "Cancel" (secondary, navigates back to the recipe list). When the user clicks Save: validate all required fields and show inline error messages. If valid, POST to `/api/recipes` with the form data as JSON. On success, redirect to `/recipes/:id` (the new recipe's detail page) and show a success toast. On server error, show an error toast with the message.

The form should be responsive — single column on mobile, with comfortable spacing between sections on desktop (max-width 640px, centered).

**Acceptance Criteria:**

- Form page renders at `/recipes/new` with title, ingredients, and instructions sections
- Title input is required; submitting without it shows "Recipe title is required"
- Title input enforces 200-character max with visible character counter
- Description textarea is optional with 1000-character max and counter
- Ingredient list starts with one empty row; "Add ingredient" adds another
- Each ingredient row has name (text), amount (number), and unit (select) fields
- Unit dropdown contains: cups, tbsp, tsp, oz, g, ml, pieces, whole
- Deleting the last ingredient row shows error "At least one ingredient required"
- Instructions list starts with one empty step; steps are auto-numbered
- Deleting the last instruction step shows error "At least one step required"
- Save button validates all fields and shows inline errors for invalid ones
- Valid form submits POST /api/recipes with JSON body
- Successful save redirects to /recipes/:id and shows success toast
- Server error shows error toast with the error message
- Cancel button navigates back to /recipes without saving
- Form layout is single-column, max-width 640px, centered on desktop
- Form is usable on mobile screen widths (320px+)

**Category:** `functional`

## Complete API reference

All endpoints use `Content-Type: application/json`. Base URL: `http://localhost:7777` (configurable).

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects with feature counts |
| GET | `/api/projects/:id` | Get a single project |
| POST | `/api/projects` | Create project. Body: `{name, description?}` |
| PATCH | `/api/projects/:id` | Update project. Body: `{name?, description?, status?}` |
| DELETE | `/api/projects/:id` | Delete project. Query: `?removeFiles=true` to also delete files |

### Features

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/:id/features` | List features for a project (with dependency info) |
| GET | `/api/features/:id` | Get a single feature |
| POST | `/api/projects/:id/features` | Create feature. Body: `{title, description, acceptanceCriteria, category?, status?, priority?}` |
| PATCH | `/api/features/:id` | Update feature. Body: any of `{title, description, acceptanceCriteria, status, priority, category}` |
| DELETE | `/api/features/:id` | Delete feature (cascades to dependencies) |

**Feature field constraints:**
- `title`: required, max 200 characters
- `description`: max 5000 characters
- `status`: one of `backlog`, `in_progress`, `completed`
- `category`: one of `functional`, `style`
- `priority`: integer (lower = higher priority)

### Dependencies

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/features/:id/dependencies` | List dependencies for a feature |
| POST | `/api/features/:id/dependencies` | Add single: `{dependsOnFeatureId}` or bulk-replace: `{dependsOn: [ids]}` |
| DELETE | `/api/features/:id/dependencies?dependsOnFeatureId=N` | Remove one dependency |

**Constraints:** no self-dependencies, no cycles, no cross-project dependencies.

## Error handling

- If a command returns an `error` field in the JSON response, show the error message to the user and ask how to proceed.
- If the server becomes unreachable mid-workflow, suggest the user check that LocalForge is still running.
- If feature creation fails validation (title too long, invalid category), fix the issue and retry automatically.
- If dependency wiring fails with a cycle error, explain the issue and ask the user whether to skip that dependency or restructure the feature order.
- If creating many features, the bulk-create command prints progress to stderr automatically.
