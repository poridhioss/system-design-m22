// src/picker.js: decide which line a worker takes its next job from
const queue = require("./queue");

const LANE_RULE = process.env.LANE_RULE || "weighted";     // "strict" or "weighted"
const TENANT_RULE = process.env.TENANT_RULE || "take-turns"; // "oldest-first" or "take-turns"

// ---------- choice 1: which lane? ----------

// The weighted pattern: out of every 10 picks, 6 go to high, 3 to normal, 1 to low.
const PATTERN = ["high", "high", "high", "high", "high", "high", "normal", "normal", "normal", "low"];
let patternPosition = 0; // each worker keeps its own place in the pattern

// Returns the lanes in the order this worker should try them.
function laneOrder() {
  if (LANE_RULE === "strict") return ["high", "normal", "low"];

  const first = PATTERN[patternPosition];
  patternPosition = (patternPosition + 1) % PATTERN.length;
  // Try the lane the pattern points at first. If it's empty, fall back to the others,
  // so a worker never sits idle while there is work in another lane.
  return [first, ...queue.LANES.filter((lane) => lane !== first)];
}

// ---------- choice 2: which tenant inside the lane? ----------

const turnPosition = { high: 0, normal: 0, low: 0 }; // whose turn is next, per lane

async function chooseTenant(lane) {
  const tenants = await queue.getTenants();

  if (TENANT_RULE === "oldest-first") {
    // Compare the next job of every tenant and take the one that was added first.
    let best = null;
    let bestTime = Infinity;
    for (const tenant of tenants) {
      const createdAt = await queue.oldestCreatedAt(lane, tenant);
      if (createdAt !== null && createdAt < bestTime) {
        best = tenant;
        bestTime = createdAt;
      }
    }
    return best;
  }

  // take-turns: start at the tenant whose turn it is, skip tenants with nothing waiting.
  for (let i = 0; i < tenants.length; i++) {
    const index = (turnPosition[lane] + i) % tenants.length;
    if ((await queue.waitingCount(lane, tenants[index])) > 0) {
      turnPosition[lane] = index + 1; // next time, start with the tenant after this one
      return tenants[index];
    }
  }
  return null; // nobody is waiting in this lane
}

// ---------- put the two choices together ----------

async function takeNextJob(workerId) {
  for (const lane of laneOrder()) {
    const tenant = await chooseTenant(lane);
    if (!tenant) continue; // this lane is empty, try the next one

    const job = await queue.take(workerId, lane, tenant);
    if (job) return job;
    // Another worker took that job a moment before us. Just try the next lane;
    // the next call to takeNextJob will look again.
  }
  return null; // every lane is empty
}

module.exports = { takeNextJob, LANE_RULE, TENANT_RULE };
