// scripts/load-test.js: a minute of mixed traffic with poison pills mixed in
const redis = require("../src/redis");

const API = process.env.API_URL || "http://localhost:3000";
const ALARM_SINK_URL = process.env.ALARM_SINK_URL || "http://alarm-sink:4000";
const LANES = ["high", "normal", "low"];
const SECONDS = 60;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const start = Date.now();
const seconds = () => String(Math.round((Date.now() - start) / 1000)).padStart(3);

let sent = 0;
let poisonSent = 0;

function send(type, priority, tenant) {
  sent++;
  const payload = type === "credit" ? { account: tenant, amount: 1, workMs: 100 } : {};
  return fetch(`${API}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, priority, tenant, payload }),
  });
}

async function main() {
  await fetch(`${ALARM_SINK_URL}/alarms`, { method: "DELETE" }); // forget alarms from earlier runs
  await redis.del("test:firstPoisonAt");

  console.log("Sending a backlog of 600 low-priority jobs from bigco...");
  for (let i = 0; i < 600; i += 50) {
    await Promise.all(Array.from({ length: 50 }, () => send("credit", "low", "bigco")));
  }

  console.log(`Sending ${SECONDS} seconds of steady traffic, with a poison pill every 2 seconds...`);
  for (let s = 0; s < SECONDS; s++) {
    const batch = [];
    for (let i = 0; i < 8; i++) batch.push(send("credit", "high", i % 2 ? "bigco" : "smallco"));
    for (let i = 0; i < 6; i++) batch.push(send("credit", "normal", "acme"));
    for (let i = 0; i < 4; i++) batch.push(send("credit", "low", "smallco"));

    if (s % 2 === 0) {
      // T0: the time of the first poison pill. NX = only set it once.
      await redis.set("test:firstPoisonAt", Date.now(), "NX");
      batch.push(send("poison", LANES[(s / 2) % 3], "acme")); // rotate the poison through all lanes
      poisonSent++;
    }

    await Promise.all(batch);

    if (s % 10 === 0) {
      const stats = await (await fetch(`${API}/stats`)).json();
      const waiting = stats.waiting.high + stats.waiting.normal + stats.waiting.low;
      console.log(`t=${seconds()}s | sent ${sent} jobs (${poisonSent} poison) | waiting ${waiting} | DLQ ${stats.dlq}`);
    }
    await sleep(1000);
  }

  console.log(`Done: sent ${sent} jobs, ${poisonSent} of them poison pills.`);
  console.log("Now run: node scripts/check-all.js");
  await redis.quit();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
