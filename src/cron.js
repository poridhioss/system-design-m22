// src/cron.js: send a "report" job every 10 seconds, from 3 replicas, without doing it 3 times
const express = require("express");
const cron = require("node-cron");
const { Etcd3 } = require("etcd3");

const CRON_ID = process.env.CRON_ID || "cron";
const API_URL = process.env.API_URL || "http://localhost:3000";
const ETCD_URL = process.env.ETCD_URL || "http://localhost:2379";
const USE_KEY = process.env.USE_KEY !== "false";       // send a tick key with each job?
const USE_LEADER = process.env.USE_LEADER !== "false"; // only the leader sends jobs?

const SCHEDULE = "*/10 * * * * *"; // every 10 seconds (the first field is seconds)
const TICK_MS = 10000;
const LEASE_SECONDS = 10;          // a leader's claim lasts 10 s unless it keeps renewing it

const time = () => new Date().toISOString().slice(11, 19);
const log = (message) => console.log(`${time()} [${CRON_ID}] ${message}`);

let isLeader = false;
let campaign = null;

// ---------- the scheduled job ----------

async function onTick() {
  if (USE_LEADER && !isLeader) return; // followers stay quiet

  // Round down to the 10-second mark, so every replica gives this tick the SAME name,
  // even if their timers fire a few milliseconds apart.
  const tick = new Date(Math.floor(Date.now() / TICK_MS) * TICK_MS).toISOString();

  const headers = { "Content-Type": "application/json" };
  if (USE_KEY) headers["Idempotency-Key"] = `cron:sales-report:${tick}`;

  try {
    const res = await fetch(`${API_URL}/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "report",
        priority: "high",
        tenant: "system",
        payload: { report: "sales-report", scheduledFor: tick },
      }),
    });
    const { id, duplicate } = await res.json();
    log(`tick ${tick.slice(11, 19)} -> job ${id.slice(0, 8)} ${duplicate ? "(duplicate, ignored)" : "(new)"}`);
  } catch (err) {
    log(`tick ${tick.slice(11, 19)} -> could not send the job: ${err.message}`);
  }
}

// ---------- leader election ----------

function runForLeader(election) {
  campaign = election.campaign(CRON_ID);

  campaign.on("elected", () => {
    isLeader = true;
    log("I am the leader now");
  });

  // Called when this replica loses its lease (it froze, or lost contact with etcd).
  campaign.on("error", (err) => {
    isLeader = false;
    log(`lost leadership (${err.message}), running again in 2 s`);
    setTimeout(() => runForLeader(election), 2000);
  });
}

// ---------- stop politely ----------

process.on("SIGTERM", async () => {
  log("stopping");
  if (campaign && isLeader) {
    await campaign.resign().catch(() => {}); // hand over leadership right away
    log("resigned as leader");
  }
  process.exit(0);
});

// ---------- "are you the leader?" ----------

const app = express();
app.get("/health", (req, res) => {
  const role = !USE_LEADER ? "no-election" : isLeader ? "leader" : "follower";
  res.json({ id: CRON_ID, role });
});
app.listen(3000);

// ---------- start ----------

log(`tick key: ${USE_KEY ? "on" : "off"}, leader election: ${USE_LEADER ? "on" : "off"}`);

if (USE_LEADER) {
  const client = new Etcd3({ hosts: ETCD_URL });
  runForLeader(client.election("cron-leader", LEASE_SECONDS));
  log("running for leader");
}

cron.schedule(SCHEDULE, onTick);
