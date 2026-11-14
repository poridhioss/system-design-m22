// scripts/check-all.js: after the load test, check every promise of the job tier
const redis = require("../src/redis");
const queue = require("../src/queue");
const { getBalance } = require("../src/handlers");

const ALARM_SINK_URL = process.env.ALARM_SINK_URL || "http://alarm-sink:4000";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const clock = (ms) => new Date(ms).toISOString().slice(11, 19);

async function waitForEmptyQueue() {
  for (let i = 0; i < 150; i++) { // up to 5 minutes
    const s = await queue.stats();
    const left = s.waiting.high + s.waiting.normal + s.waiting.low + s.running + s.delayed;
    console.log(`Jobs still waiting, running or waiting to retry: ${left}`);
    if (left === 0) return;
    await sleep(2000);
  }
  throw new Error("the queue did not empty within 5 minutes");
}

async function main() {
  await waitForEmptyQueue();

  // Read every job. KEYS is fine for a small lab. A pipeline sends all commands in one go.
  const keys = await redis.keys("job:*");
  const pipeline = redis.pipeline();
  keys.forEach((key) => pipeline.hmget(key, "type", "status", "priority", "tenant", "payload", "createdAt", "startedAt"));
  const jobs = (await pipeline.exec()).map(([, [type, status, priority, tenant, payload, createdAt, startedAt]]) => ({
    type,
    status,
    priority,
    tenant,
    payload: JSON.parse(payload),
    wait: (Number(startedAt) - Number(createdAt)) / 1000,
  }));

  // 1. The alarm: when did the first one arrive, compared with the first poison pill (T0)?
  const firstPoisonAt = Number(await redis.get("test:firstPoisonAt"));
  const alarms = await (await fetch(`${ALARM_SINK_URL}/alarms`)).json();
  const falseAlarms = alarms.filter((a) => a.receivedAt < firstPoisonAt);
  const firstAlarm = alarms.find((a) => a.receivedAt >= firstPoisonAt);
  const alarmDelay = firstAlarm ? (firstAlarm.receivedAt - firstPoisonAt) / 1000 : null;

  // 2. The DLQ: it should hold every poison pill, and nothing else.
  const poison = jobs.filter((j) => j.type === "poison");
  const dead = jobs.filter((j) => j.status === "dead");
  const deadPoison = dead.filter((j) => j.type === "poison").length;

  // 3. Money: each tenant's balance must equal its finished credit jobs (amount 1 each).
  const credits = jobs.filter((j) => j.type === "credit");
  const creditsDone = credits.filter((j) => j.status === "done");
  const tenants = [...new Set(credits.map((j) => j.tenant))].sort();
  const balances = [];
  for (const tenant of tenants) {
    const expected = creditsDone.filter((j) => j.tenant === tenant).length;
    balances.push({ tenant, expected, balance: await getBalance(tenant) });
  }

  // 4. Priority: average wait of credit jobs per lane.
  const waitOf = (lane) => average(credits.filter((j) => j.priority === lane).map((j) => j.wait));
  const wait = { high: waitOf("high"), normal: waitOf("normal"), low: waitOf("low") };

  // 5. The cron: no tick may have created more than one report job.
  const jobsPerTick = {};
  for (const j of jobs.filter((j) => j.type === "report")) {
    jobsPerTick[j.payload.scheduledFor] = (jobsPerTick[j.payload.scheduledFor] || 0) + 1;
  }
  const ticks = Object.keys(jobsPerTick).length;
  const ticksTwice = Object.values(jobsPerTick).filter((n) => n > 1).length;

  console.log("");
  console.log(`Alarm:    first poison pill at ${clock(firstPoisonAt)}, ` +
    (firstAlarm ? `first alarm at ${clock(firstAlarm.receivedAt)} (${alarmDelay.toFixed(1)} s later)` : "no alarm"));
  console.log(`DLQ:      ${dead.length} jobs (${deadPoison} poison pills) | poison pills sent: ${poison.length}`);
  console.log(`Credits:  ${credits.length} jobs, ${creditsDone.length} done`);
  for (const b of balances) console.log(`          ${b.tenant.padEnd(8)} balance ${b.balance} (expected ${b.expected})`);
  console.log(`Wait:     high ${wait.high.toFixed(1)} s | normal ${wait.normal.toFixed(1)} s | low ${wait.low.toFixed(1)} s`);
  console.log(`Cron:     ${ticks} ticks, ${ticksTwice} ran more than once`);
  console.log("");

  const checks = [
    ["the DLQ alarm fired within 60 s of the first poison pill", alarmDelay !== null && alarmDelay <= 60],
    ["no alarm fired before the first poison pill", falseAlarms.length === 0],
    ["every poison pill is in the DLQ", poison.length > 0 && poison.every((j) => j.status === "dead")],
    ["only poison pills are in the DLQ", dead.length === deadPoison],
    ["every credit job finished", creditsDone.length === credits.length],
    ["every balance is correct (nothing lost, nothing doubled)", balances.every((b) => b.balance === b.expected)],
    ["high jobs waited less than low jobs", wait.high < wait.low],
    ["no cron tick ran more than once", ticksTwice === 0],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);

  await redis.quit();
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
