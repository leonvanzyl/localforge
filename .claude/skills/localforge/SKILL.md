---
name: localforge
description: Create detailed, well-structured features for AutoForge projects by talking through the requirements and then writing them to the AutoForge database via its REST API. Use this skill whenever the user wants to create features in AutoForge, plan features, create a feature backlog, break down an app into implementable tasks, add features to an AutoForge project, or populate a kanban board. Also trigger when the user mentions AutoForge, feature planning for local AI coding agents, or writing detailed feature descriptions — even if they don't explicitly say "create features." AutoForge is the app that uses local AI models to build software autonomously.
allowed-tools: Bash(curl *)
---

# Create Features for AutoForge

## Why this skill exists

AutoForge uses local AI models to implement features one by one. These local models are capable coders, but they struggle when feature descriptions are vague. A feature titled "Add authentication" with no further detail leaves the coding agent guessing about login flows, session handling, password rules, and error states — and it will guess wrong.

This skill exists so that a more capable model (you) can have a thorough conversation with the user, understand exactly what they want, and write features detailed enough that the local coding agent can implement them by following the instructions step by step. Think of yourself as a senior engineer writing tickets for a competent but literal junior developer — every feature should be self-contained and unambiguous.

## Connecting to AutoForge

The AutoForge server must be running for this skill to work. The default URL is `http://localhost:7777`. If the user says their server is on a different port, use that instead.

**Step 1 — always check connectivity first:**

```bash
curl -sf http://localhost:7777/api/health
```

If this fails or returns anything other than `{"status":"ok",...}`, stop and tell the user:

> "I can't reach AutoForge at http://localhost:7777. Please make sure AutoForge is running (run `npm run dev` in the AutoForge directory) and try again."

Do not proceed until the health check passes.

## Workflow

Follow these steps in order. Do not skip the conversation phase — the whole point is writing detailed features, and that requires understanding the app deeply.

### Step 1: List projects

```bash
curl -s http://localhost:7777/api/projects
```

This returns `{ "projects": [...] }`. Present the projects to the user as a numbered list showing name, status, and progress (e.g., "3/12 features done"). If no projects exist, offer to create one.

### Step 2: Select or create a project

Ask the user which project to work on. If they want a new project:

```bash
curl -s -X POST http://localhost:7777/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"Project Name","description":"Brief description"}'
```

This returns `{ "project": { "id": N, ... } }`. Use the project ID for all subsequent calls.

### Step 3: Review existing features

```bash
curl -s http://localhost:7777/api/projects/PROJECT_ID/features
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

Create each feature by calling the API. Track the returned IDs — you need them for wiring dependencies in the next step.

```bash
curl -s -X POST http://localhost:7777/api/projects/PROJECT_ID/features \
  -H "Content-Type: application/json" \
  -d '{"title":"...","description":"...","acceptanceCriteria":"...","category":"functional"}'
```

Parse the response to extract `feature.id`. Keep a running mapping of feature title to ID.

Create features in dependency order (foundational features first) so that when you wire dependencies, all referenced IDs already exist.

### Step 7: Wire dependencies

After all features are created, set up dependencies using the bulk-replace endpoint:

```bash
curl -s -X POST http://localhost:7777/api/features/FEATURE_ID/dependencies \
  -H "Content-Type: application/json" \
  -d '{"dependsOn":[ID1,ID2]}'
```

Only add dependencies where they genuinely matter — where a feature cannot be built without another being complete first. Don't over-chain features that could be implemented independently.

### Step 8: Verify and summarize

Fetch the features one more time to confirm everything was created:

```bash
curl -s http://localhost:7777/api/projects/PROJECT_ID/features
```

Present a final summary: total features created, the dependency graph, and any notes about build order. Let the user know they can now go to the AutoForge UI to see their kanban board populated with the new features.

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

## API quick reference

All endpoints use `Content-Type: application/json`. Replace `BASE` with `http://localhost:7777` (or the user's custom URL) and `PID`/`FID` with actual IDs.

```bash
# Health check
curl -sf BASE/api/health

# List projects
curl -s BASE/api/projects

# Create project
curl -s -X POST BASE/api/projects -H "Content-Type: application/json" \
  -d '{"name":"...","description":"..."}'

# List features for a project
curl -s BASE/api/projects/PID/features

# Create feature
curl -s -X POST BASE/api/projects/PID/features -H "Content-Type: application/json" \
  -d '{"title":"...","description":"...","acceptanceCriteria":"...","category":"functional"}'

# Set dependencies (bulk replace)
curl -s -X POST BASE/api/features/FID/dependencies -H "Content-Type: application/json" \
  -d '{"dependsOn":[ID1,ID2]}'
```

## Error handling

- If a `curl` command returns an `error` field in the JSON response, show the error message to the user and ask how to proceed.
- If the server becomes unreachable mid-workflow, suggest the user check that AutoForge is still running.
- If feature creation fails validation (title too long, invalid category), fix the issue and retry automatically.
- If dependency wiring fails with a cycle error, explain the issue and ask the user whether to skip that dependency or restructure the feature order.
- If creating many features, give the user a progress update every few features (e.g., "Created 5/12 features...").
