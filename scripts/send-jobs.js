// scripts/send-jobs.js: send N credit jobs of amount 1 to acc-1
const count = Number(process.argv[2] || 100);
const API = process.env.API_URL || "http://localhost:3000";
const runId = Date.now(); // a fresh idempotency key for every job in every run

async function send(i) {
  const res = await fetch(`${API}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `load-${runId}-${i}` },
    body: JSON.stringify({ type: "credit", payload: { account: "acc-1", amount: 1 } }),
  });
  if (!res.ok) throw new Error(`job ${i}: HTTP ${res.status}`);
}

async function main() {
  for (let i = 0; i < count; i += 50) {
    const batch = [];
    for (let j = i; j < Math.min(i + 50, count); j++) batch.push(send(j));
    await Promise.all(batch); // send 50 at a time
  }
  console.log(`Sent ${count} credit jobs to acc-1`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
