// src/api.js: add jobs, look at jobs and stats, and move due retries back to the queue
const express = require("express");
const queue = require("./queue");
const { getBalance } = require("./handlers");

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

// Add a job. Send an Idempotency-Key header to make retries of this request safe.
app.post("/jobs", async (req, res) => {
  const { type, payload = {}, maxAttempts = 5 } = req.body || {};
  if (typeof type !== "string" || type === "") {
    return res.status(400).json({ error: "type is required" });
  }
  const result = await queue.enqueue({
    type,
    payload,
    maxAttempts: Number(maxAttempts),
    idempotencyKey: req.get("Idempotency-Key"),
  });
  res.status(result.duplicate ? 200 : 202).json(result);
});

app.get("/jobs/:id", async (req, res) => {
  const job = await queue.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(job);
});

app.get("/stats", async (req, res) => res.json(await queue.stats()));

app.get("/accounts/:account", async (req, res) => {
  res.json({ account: req.params.account, balance: await getBalance(req.params.account) });
});

// The retry mover: every half second, move retries whose wait is over back to q:ready.
setInterval(() => {
  queue.moveDueJobs().catch((err) => console.error("[mover]", err.message));
}, 500);

app.listen(3000, () => console.log("[api] listening on port 3000"));
