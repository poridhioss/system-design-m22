// src/api.js: add jobs with a priority and a tenant, show stats, move due retries
const express = require("express");
const queue = require("./queue");

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/jobs", async (req, res) => {
  const { type, payload = {}, maxAttempts = 5, priority = "normal", tenant = "default" } = req.body || {};
  if (typeof type !== "string" || type === "") {
    return res.status(400).json({ error: "type is required" });
  }
  if (!queue.LANES.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${queue.LANES.join(", ")}` });
  }
  const result = await queue.enqueue({
    type,
    payload,
    priority,
    tenant: String(tenant),
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

setInterval(() => {
  queue.moveDueJobs().catch((err) => console.error("[mover]", err.message));
}, 500);

app.listen(3000, () => console.log("[api] listening on port 3000"));
