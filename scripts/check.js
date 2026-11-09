// scripts/check.js: wait until the queue is empty, then check that acc-1's balance is right
const redis = require("../src/redis");
const queue = require("../src/queue");
const { getBalance } = require("../src/handlers");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForEmptyQueue() {
  for (let i = 0; i < 150; i++) { // up to 5 minutes
    const s = await queue.stats();
    const onTrays = Object.values(s.processing).reduce((a, b) => a + b, 0);
    const left = s.ready + s.delayed + onTrays;
    console.log(`Jobs still waiting or running: ${left}`);
    if (left === 0) return;
    await sleep(2000);
  }
  throw new Error("the queue did not empty within 5 minutes");
}

async function main() {
  await waitForEmptyQueue();

  // Read type, status and payload of every job. A pipeline sends all commands in one go.
  const keys = await redis.keys("job:*");
  const pipeline = redis.pipeline();
  keys.forEach((key) => pipeline.hmget(key, "type", "status", "payload"));
  const jobs = (await pipeline.exec()).map(([, [type, status, payload]]) => ({
    type,
    status,
    payload: JSON.parse(payload),
  }));

  const credits = jobs.filter((j) => j.type === "credit" && j.payload.account === "acc-1");
  const done = credits.filter((j) => j.status === "done");
  const dead = credits.filter((j) => j.status === "dead");
  const expected = done.reduce((sum, j) => sum + j.payload.amount, 0);
  const balance = await getBalance("acc-1");

  console.log("");
  console.log(`Credit jobs for acc-1: ${credits.length} total, ${done.length} done, ${dead.length} in the DLQ`);
  console.log(`Balance of acc-1: ${balance} (expected ${expected})`);
  console.log("");

  const checks = [
    ["every credit job finished", done.length === credits.length],
    ["balance is correct (nothing lost, nothing counted twice)", balance === expected],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);

  await redis.quit();
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
