// src/worker.js: take a job, run it, mark it done or failed, repeat
const queue = require("./queue");
const { runJob } = require("./handlers");

const WORKER_ID = process.env.WORKER_ID || "worker";
const short = (id) => id.slice(0, 8);

async function main() {
  // First, put back anything left on my tray by a previous crash.
  const recovered = await queue.recover(WORKER_ID);
  for (const id of recovered) {
    console.log(`[${WORKER_ID}] found job ${short(id)} on my tray after a crash, scheduled a retry`);
  }

  console.log(`[${WORKER_ID}] ready, waiting for jobs`);

  while (true) {
    const job = await queue.take(WORKER_ID);
    if (!job) continue; // no job arrived in 5 seconds, wait again

    console.log(`[${WORKER_ID}] took job ${short(job.id)} (${job.type}, attempt ${job.attempts + 1}/${job.maxAttempts})`);

    try {
      await runJob(job);
      await queue.finish(WORKER_ID, job);
      console.log(`[${WORKER_ID}] finished job ${short(job.id)}`);
    } catch (err) {
      const result = await queue.fail(WORKER_ID, job, err.message);
      if (result.dead) {
        console.log(`[${WORKER_ID}] job ${short(job.id)} failed ${result.attempts}/${job.maxAttempts} times: ${err.message} -> moved to DLQ`);
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
