// Best-effort cleanup of the temporary test-workdir used by feature #34
// verification. Safe to run repeatedly.
const fs = require("node:fs");
const path = require("node:path");

const target = path.resolve(__dirname, "..", "test-workdir");
if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true });
  process.stdout.write(`removed ${target}\n`);
} else {
  process.stdout.write(`not present ${target}\n`);
}
