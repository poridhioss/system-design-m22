// src/alarm-sink.js: receives alarms and remembers when each one arrived
// (it stands in for Slack, email or PagerDuty)
const express = require("express");

const app = express();
app.use(express.json());

let alarms = [];

// The monitor sends alarms here.
app.post("/alarm", (req, res) => {
  const alarm = { ...req.body, receivedAt: Date.now() };
  alarms.push(alarm);
  console.log(
    `${new Date().toISOString().slice(11, 19)} [alarm-sink] ALARM ${alarm.name}: ` +
      `${alarm.newJobs} new job(s) in the DLQ, ${alarm.dlqLength} in total, e.g. ${alarm.sampleJobIds.join(", ")}`
  );
  res.status(204).end();
});

// The check script reads the alarms from here.
app.get("/alarms", (req, res) => res.json(alarms));

// The load test clears old alarms before it starts.
app.delete("/alarms", (req, res) => {
  alarms = [];
  res.status(204).end();
});

app.listen(4000, () => console.log("[alarm-sink] listening on port 4000"));
