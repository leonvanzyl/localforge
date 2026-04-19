// Kill any process listening on a given TCP port (default 3000) on Windows.
// Used during development / verification to fully restart the dev server
// because pkill / lsof are unavailable in this Git Bash environment.

const { execSync } = require("node:child_process");

const port = Number(process.argv[2] || 3000);

let lines = "";
try {
  lines = execSync(`netstat -ano -p tcp`, { encoding: "utf8" });
} catch (err) {
  console.error("netstat failed:", err.message);
  process.exit(1);
}

const pids = new Set();
for (const line of lines.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("TCP")) continue;
  const parts = trimmed.split(/\s+/);
  // parts: [Proto, LocalAddr, RemoteAddr, State, PID]
  if (parts.length < 5) continue;
  const local = parts[1];
  const state = parts[3];
  const pid = parts[4];
  if (state !== "LISTENING") continue;
  if (!local.endsWith(":" + port)) continue;
  pids.add(pid);
}

if (pids.size === 0) {
  console.log(`No process listening on port ${port}`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    execSync(`taskkill /F /PID ${pid} /T`, { stdio: "inherit" });
    console.log(`Killed PID ${pid}`);
  } catch (err) {
    console.error(`Failed to kill PID ${pid}:`, err.message);
  }
}
