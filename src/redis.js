// src/redis.js: one shared Redis connection for this process
const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
redis.on("error", (err) => console.error("[redis]", err.message));

module.exports = redis;
