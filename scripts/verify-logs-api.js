// Verify the /api/features/:id/logs endpoint returns varied message types.
const http = require("node:http");

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

(async () => {
  const data = await getJson("http://localhost:7777/api/features/24/logs");
  const types = new Set(data.logs.map((l) => l.messageType));
  console.log(`count=${data.logs.length} types=${[...types].sort().join(",")}`);
})();
