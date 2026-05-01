import { type ChildProcess, spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

interface DevServerEntry {
  process: ChildProcess;
  port: string;
  projectId: number;
  startedAt: string;
  lastError: string | null;
}

const servers = new Map<number, DevServerEntry>();

function killProcessOnPort(port: string): void {
  try {
    if (process.platform === "win32") {
      const output = execSync(
        `netstat -ano | findstr :${port} | findstr LISTENING`,
        { encoding: "utf-8", timeout: 5000 },
      );
      const pids = new Set<string>();
      for (const line of output.trim().split("\n")) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== "0" && /^\d+$/.test(pid)) pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, {
            stdio: "ignore",
            timeout: 5000,
          });
        } catch {
          // process may have already exited
        }
      }
    } else {
      execSync(`lsof -ti :${port} | xargs -r kill -9`, {
        stdio: "ignore",
        timeout: 5000,
      });
    }
  } catch {
    // no process on this port, or command failed — either way, proceed
  }
}

export type DevServerStatus = {
  running: boolean;
  port?: string;
  url?: string;
  startedAt?: string;
  error?: string;
};

export function getDevServerStatus(projectId: number): DevServerStatus {
  const entry = servers.get(projectId);
  if (!entry) return { running: false };

  if (entry.process.exitCode !== null || entry.process.killed) {
    const error = entry.lastError;
    servers.delete(projectId);
    return { running: false, error: error ?? "Process exited unexpectedly" };
  }

  return {
    running: true,
    port: entry.port,
    url: `http://localhost:${entry.port}`,
    startedAt: entry.startedAt,
  };
}

export function startDevServer(
  projectId: number,
  folderPath: string,
  port: string,
): DevServerStatus {
  const existing = getDevServerStatus(projectId);
  if (existing.running) return existing;

  const resolved = path.resolve(folderPath);
  const pkgPath = path.join(resolved, "package.json");
  if (!existsSync(pkgPath)) {
    return {
      running: false,
      error:
        "No package.json found in project folder. The coding agent needs to set up the project first.",
    };
  }

  killProcessOnPort(port);

  const child = spawn("npm", ["run", "dev", "--", "--port", port], {
    cwd: resolved,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    windowsHide: true,
  });

  const entry: DevServerEntry = {
    process: child,
    port,
    projectId,
    startedAt: new Date().toISOString(),
    lastError: null,
  };

  const stderrChunks: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrChunks.push(text);
    if (stderrChunks.length > 20) stderrChunks.shift();
    entry.lastError = stderrChunks.join("").slice(-500);
  });

  child.stdout?.on("data", () => {
    // drain stdout to prevent backpressure
  });

  child.on("error", (err) => {
    entry.lastError = err.message;
    servers.delete(projectId);
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      entry.lastError =
        entry.lastError || `Process exited with code ${code}`;
    }
    servers.delete(projectId);
  });

  servers.set(projectId, entry);

  return {
    running: true,
    port,
    url: `http://localhost:${port}`,
    startedAt: entry.startedAt,
  };
}

export function stopDevServer(projectId: number): boolean {
  const entry = servers.get(projectId);
  if (!entry) return false;

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(entry.process.pid), "/T", "/F"], {
        shell: true,
        stdio: "ignore",
      });
    } else {
      entry.process.kill("SIGTERM");
    }
  } catch {
    // already dead
  }

  servers.delete(projectId);
  return true;
}
