// scripts/check-ticks.js: how many jobs did each cron tick create?
const redis = require("../src/redis");

const TICK_MS = 10000;

async function main() {
  // Read every job. KEYS is fine for a small lab. A pipeline sends all commands in one go.
  const keys = await redis.keys("job:*");
  const pipeline = redis.pipeline();
  keys.forEach((key) => pipeline.hmget(key, "type", "payload"));
  const rows = await pipeline.exec();

  // Count report jobs per tick.
  const jobsPerTick = {};
  for (const [, [type, payload]] of rows) {
    if (type !== "report") continue;
    const tick = JSON.parse(payload).scheduledFor;
    jobsPerTick[tick] = (jobsPerTick[tick] || 0) + 1;
  }

  const ticks = Object.keys(jobsPerTick).sort();
  if (ticks.length === 0) {
    console.log("No cron jobs yet. Wait at least 10 seconds and try again.");
    await redis.quit();
    return;
  }

  // Walk through every 10-second tick from the first to the last, including missed ones.
  let duplicates = 0;
  let missed = 0;
  let total = 0;
  console.log("Tick (UTC)   jobs");
  for (let ms = Date.parse(ticks[0]); ms <= Date.parse(ticks[ticks.length - 1]); ms += TICK_MS) {
    const tick = new Date(ms).toISOString();
    const count = jobsPerTick[tick] || 0;
    let note = "";
    if (count === 0) { missed++; note = "   <- missed"; }
    if (count > 1) { duplicates++; note = "   <- ran more than once"; }
    total++;
    console.log(`  ${tick.slice(11, 19)}     ${count}${note}`);
  }

  console.log("");
  console.log(`${total} ticks: ${total - missed - duplicates} ran once, ${duplicates} ran more than once, ${missed} missed`);
  console.log(duplicates === 0 ? "PASS  no tick ran more than once" : "FAIL  some ticks ran more than once");

  await redis.quit();
  process.exit(duplicates === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
