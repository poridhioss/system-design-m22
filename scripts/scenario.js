// scripts/scenario.js: send a pattern of jobs and print live progress every second
// Usage: node scripts/scenario.js priority | tenants | mixed
const API = process.env.API_URL || "http://localhost:3000";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const start = Date.now();
const seconds = () => String(Math.round((Date.now() - start) / 1000)).padStart(3);

// Send `count` jobs of one priority from one tenant, 50 at a time.
async function send(count, priority, tenant) {
  for (let i = 0; i < count; i += 50) {
    const batch = [];
    for (let j = i; j < Math.min(i + 50, count); j++) {
      batch.push(
        fetch(`${API}/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "credit",
            priority,
            tenant,
            payload: { account: tenant, amount: 1, workMs: 100 },
          }),
        })
      );
    }
    await Promise.all(batch);
  }
}

// Print one progress line. Returns how many jobs are still waiting or running.
async function printProgress() {
  const s = await (await fetch(`${API}/stats`)).json();
  const lanes = ["high", "normal", "low"].map((l) => `${l} ${String(s.done[l]).padStart(4)}`).join("  ");
  const tenants = Object.entries(s.doneByTenant)
    .map(([t, n]) => `${t} ${String(n).padStart(4)}`)
    .join("  ");
  const waiting = s.waiting.high + s.waiting.normal + s.waiting.low;
  console.log(`t=${seconds()}s | done by lane: ${lanes} | done by tenant: ${tenants} | waiting: ${waiting}`);
  return waiting + s.running;
}

const scenarios = {
  // 100 low jobs, then 15 seconds of high jobs arriving FASTER than the workers can finish them.
  async priority() {
    await send(100, "low", "acme");
    for (let i = 0; i < 15; i++) {
      await send(40, "high", "acme"); // 40 per second, more than the ~25-30 the workers can do
      await printProgress();
      await sleep(1000);
    }
  },

  // One busy tenant sends 900 jobs, then a small tenant sends 20. Same lane for both.
  async tenants() {
    await send(900, "normal", "bigco");
    await sleep(1000);
    await send(20, "normal", "smallco");
  },

  // Everything at once: a big low-priority backlog, a few normal jobs, and a stream of high jobs.
  async mixed() {
    await send(600, "low", "bigco");
    await send(30, "normal", "smallco");
    for (let i = 0; i < 15; i++) {
      await send(10, "high", "bigco");
      await send(10, "high", "smallco");
      await printProgress();
      await sleep(1000);
    }
  },
};

async function main() {
  const name = process.argv[2];
  if (!scenarios[name]) {
    console.log("Usage: node scripts/scenario.js priority | tenants | mixed");
    process.exit(1);
  }
  console.log(`Running scenario "${name}"`);
  await scenarios[name]();
  while ((await printProgress()) > 0) await sleep(1000); // keep printing until everything is done
  console.log("All jobs finished. Now run: node scripts/report.js");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
