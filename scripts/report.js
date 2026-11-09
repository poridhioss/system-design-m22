// scripts/report.js: wait time per lane and per tenant
// Wait time = from "job added" (createdAt) to "a worker started it" (startedAt).
const redis = require("../src/redis");

const LANE_ORDER = ["high", "normal", "low"];

function summarize(jobs, field) {
  const groups = {};
  for (const job of jobs) (groups[job[field]] ||= []).push(job.wait);
  return Object.entries(groups).map(([name, waits]) => ({
    name,
    jobs: waits.length,
    avg: waits.reduce((a, b) => a + b, 0) / waits.length,
    max: Math.max(...waits),
  }));
}

function printTable(title, rows) {
  console.log(`${title.padEnd(12)}${"jobs".padStart(6)}${"avg wait".padStart(12)}${"max wait".padStart(12)}`);
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(10)}${String(r.jobs).padStart(6)}` +
        `${(r.avg.toFixed(1) + " s").padStart(12)}${(r.max.toFixed(1) + " s").padStart(12)}`
    );
  }
  console.log("");
}

async function main() {
  // Read every job. KEYS is fine for a small lab. A pipeline sends all commands in one go.
  const keys = await redis.keys("job:*");
  const pipeline = redis.pipeline();
  keys.forEach((key) => pipeline.hmget(key, "priority", "tenant", "createdAt", "startedAt"));
  const jobs = (await pipeline.exec())
    .map(([, [priority, tenant, createdAt, startedAt]]) => ({ priority, tenant, createdAt, startedAt }))
    .filter((j) => j.startedAt) // only jobs that have started
    .map((j) => ({ ...j, wait: (Number(j.startedAt) - Number(j.createdAt)) / 1000 }));

  if (jobs.length === 0) {
    console.log("No jobs have started yet.");
  } else {
    const byLane = summarize(jobs, "priority").sort(
      (a, b) => LANE_ORDER.indexOf(a.name) - LANE_ORDER.indexOf(b.name)
    );
    printTable("By lane", byLane);
    printTable("By tenant", summarize(jobs, "tenant"));
  }
  await redis.quit();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
