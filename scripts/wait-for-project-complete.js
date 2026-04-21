const http = require("node:http");
const projectId = process.argv[2];
const maxPolls = Number.parseInt(process.argv[3] ?? "90", 10);
if (!projectId) {
  console.error("usage: node wait-for-project-complete.js <projectId> [maxPolls]");
  process.exit(2);
}
function fetchJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://localhost:7777${path}`, (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
(function run() {
  let i = 0;
  function step() {
    fetchJson(`/api/projects/${projectId}/completion`)
      .then((r) => {
        const c = r.completion;
        console.log(
          `${i} status=${c.status} passed=${c.passedCount}/${c.featureCount}`,
        );
        if (c.status === "completed") process.exit(0);
        if (++i >= maxPolls) process.exit(1);
        sleep(3000).then(step);
      })
      .catch((err) => {
        console.error("poll err", err.message);
        if (++i >= maxPolls) process.exit(1);
        sleep(3000).then(step);
      });
  }
  step();
})();
