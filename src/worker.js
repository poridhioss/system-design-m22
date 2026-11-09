// src/worker.js: ask the picker for a job, run it, mark it done or failed, repeat
const queue = require("./queue");
const { takeNextJob, LANE_RULE, TENANT_RULE } = require("./picker");
const { runJob } = require("./handlers");

const WORKER_ID = process.env.WORKER_ID || "worker";
const short = (id) => id.slice(0, 8);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const recovered = await queue.recover(WORKER_ID);
  for (const id of recovered) {
    console.log(`[${WORKER_ID}] found job ${short(id)} on my tray after a crash, scheduled a retry`);
  }

  console.log(`[${WORKER_ID}] ready (lane rule: ${LANE_RULE}, tenant rule: ${TENANT_RULE})`);

  while (true) {
    const job = await takeNextJob(WORKER_ID);
    if (!job) {
      await sleep(200); // nothing waiting anywhere, look again soon
      continue;
    }

    console.log(`[${WORKER_ID}] took job ${short(job.id)} (${job.priority}, ${job.tenant})`);

    try {
      await runJob(job);
      await queue.finish(WORKER_ID, job);
    } catch (err) {
      const result = await queue.fail(WORKER_ID, job, err.message);
      if (result.dead) {
        console.log(`[${WORKER_ID}] job ${short(job.id)} failed ${result.attempts}/${job.maxAttempts} times -> moved to DLQ`);
      } else {
        console.log(`[${WORKER_ID}] job ${short(job.id)} failed (${err.message}), retry in ${(result.delayMs / 1000).toFixed(1)}s`);
      }
    }
  }
}

main().catch((err) => {
  console.error(`[${WORKER_ID}] stopped:`, err);
  process.exit(1);
});
