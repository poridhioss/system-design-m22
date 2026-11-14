// src/monitor.js: watch the DLQ and send an alarm when it grows
const redis = require("./redis");

const ALARM_URL = process.env.ALARM_URL || "http://localhost:4000/alarm";
const CHECK_EVERY_MS = 5000;  // look at the DLQ every 5 seconds
const QUIET_MS = 60000;       // after an alarm, don't send another one for 60 seconds

const time = () => new Date().toISOString().slice(11, 19);
const log = (message) => console.log(`${time()} [monitor] ${message}`);

let lastLength = null; // DLQ length at the previous check

async function check() {
  const length = await redis.llen("q:dlq");

  // The first check only records where we start, so old DLQ entries don't raise an alarm.
  if (lastLength !== null && length > lastLength) {
    const newJobs = length - lastLength;
    // When did we last send an alarm? Kept in Redis, so a restarted monitor still knows.
    const lastAlarmAt = Number(await redis.get("monitor:lastAlarmAt")) || 0;

    if (Date.now() - lastAlarmAt >= QUIET_MS) {
      const sampleJobIds = (await redis.lrange("q:dlq", 0, 2)).map((id) => id.slice(0, 8)); // the newest 3
      await fetch(ALARM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "dlq_growth", newJobs, dlqLength: length, sampleJobIds }),
      });
      await redis.set("monitor:lastAlarmAt", Date.now());
      log(`ALARM dlq_growth: ${newJobs} new job(s) in the DLQ (now ${length}), alarm sent`);
    } else {
      log(`DLQ grew by ${newJobs} (now ${length}), alarm already sent in the last 60 s`);
    }
  }

  lastLength = length;
}

log(`watching the DLQ every ${CHECK_EVERY_MS / 1000} s`);
setInterval(() => {
  check().catch((err) => log(`check failed: ${err.message}`));
}, CHECK_EVERY_MS);
