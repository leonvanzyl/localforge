#!/usr/bin/env node
/**
 * Polls /api/agent-sessions/<id>/messages until at least one assistant
 * message is present, then prints the final transcript and exits 0.
 *
 * Used by the Feature #91 verification flow: after Send is clicked in the
 * bootstrapper UI, the LM Studio request can take 30-90s on local hardware,
 * and the existing shell hook in this project blocks `[`/`true` (so until
 * loops aren't possible). A tiny Node poll keeps the wait observable.
 *
 * Usage:
 *   node scripts/wait-for-assistant.js <sessionId> [timeoutSec=300]
 */
const http = require("node:http");

const sessionId = Number.parseInt(process.argv[2], 10);
const timeoutSec = Number.parseInt(process.argv[3] || "300", 10);
const minAssistant = Number.parseInt(process.argv[4] || "1", 10);
if (!Number.isFinite(sessionId) || sessionId <= 0) {
  console.error("Usage: node scripts/wait-for-assistant.js <sessionId> [timeoutSec]");
  process.exit(2);
}

const start = Date.now();
const deadline = start + timeoutSec * 1000;

function fetchMessages() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `http://localhost:7777/api/agent-sessions/${sessionId}/messages`,
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
  });
}

async function main() {
  while (Date.now() < deadline) {
    try {
      const { messages } = await fetchMessages();
      const assistant = messages.filter((m) => m.role === "assistant");
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      process.stdout.write(
        `[t+${elapsed}s] user=${messages.filter((m) => m.role === "user").length} assistant=${assistant.length}\n`,
      );
      if (assistant.length >= minAssistant) {
        const last = assistant[assistant.length - 1];
        console.log("===== assistant message =====");
        console.log(`id=${last.id} chars=${last.content.length}`);
        console.log(last.content);
        console.log("===== end =====");
        return process.exit(0);
      }
    } catch (err) {
      console.error("poll error:", err.message);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  console.error(`Timed out after ${timeoutSec}s waiting for assistant message`);
  process.exit(1);
}

main();
