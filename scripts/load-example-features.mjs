#!/usr/bin/env node
// Load the DreamForgeIdeas example backlog into a project via the running
// LocalForge HTTP API. This goes through the same code path as the UI, so
// timestamps, validation, and dependency FK constraints all behave exactly
// as they would for a manually-created feature.
//
// Usage:
//   node scripts/load-example-features.mjs <projectId> [baseUrl]
//
// Example (DreamForgeIdeas at project id 2, default port 7777):
//   node scripts/load-example-features.mjs 2
//
// Prerequisites:
//   - LocalForge dev server running (npm run dev)
//   - The target project already exists in LocalForge
//   - docs/example-app-features.json present (committed in this repo)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectIdArg = process.argv[2];
const baseUrl = process.argv[3] ?? "http://localhost:7777";

if (!projectIdArg || !/^[0-9]+$/.test(projectIdArg)) {
  console.error("usage: node scripts/load-example-features.mjs <projectId> [baseUrl]");
  process.exit(2);
}
const projectId = Number.parseInt(projectIdArg, 10);

const jsonPath = path.resolve(__dirname, "..", "docs", "example-app-features.json");
const raw = fs.readFileSync(jsonPath, "utf8");
const spec = JSON.parse(raw);

if (!Array.isArray(spec.features) || spec.features.length === 0) {
  console.error(`no features found in ${jsonPath}`);
  process.exit(1);
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`POST ${url} → ${res.status}: ${data.error ?? text}`);
  }
  return data;
}

// Phase 1: create features. Map each spec key → real DB id so we can wire
// dependencies in phase 2.
const keyToId = new Map();

console.log(`Creating ${spec.features.length} features in project ${projectId}...`);
for (const f of spec.features) {
  const created = await postJson(`${baseUrl}/api/projects/${projectId}/features`, {
    title: f.title,
    description: f.description,
    acceptanceCriteria: f.acceptanceCriteria,
    category: f.category,
    priority: f.priority,
  });
  const id = created?.feature?.id;
  if (typeof id !== "number") {
    throw new Error(`unexpected response for ${f.key}: ${JSON.stringify(created)}`);
  }
  keyToId.set(f.key, id);
  console.log(`  + #${id}  [${f.key}]  ${f.title}`);
}

// Phase 2: wire dependencies. The dependencies endpoint expects the full
// list each time — we built each feature's full prereq set up front so
// one POST per feature is enough.
console.log("\nWiring dependencies...");
let depCount = 0;
for (const f of spec.features) {
  if (!Array.isArray(f.dependsOn) || f.dependsOn.length === 0) continue;
  const featureId = keyToId.get(f.key);
  const dependsOn = f.dependsOn.map((k) => {
    const id = keyToId.get(k);
    if (typeof id !== "number") {
      throw new Error(`unknown dependency key "${k}" referenced by "${f.key}"`);
    }
    return id;
  });
  await postJson(`${baseUrl}/api/features/${featureId}/dependencies`, {
    dependsOn,
  });
  depCount += dependsOn.length;
  console.log(
    `  • #${featureId} (${f.key}) depends on ${f.dependsOn.join(", ")} ` +
      `→ [${dependsOn.join(", ")}]`,
  );
}

console.log(
  `\nDone. Created ${spec.features.length} features and ${depCount} dependency links in project ${projectId}.`,
);
