#!/usr/bin/env node
/**
 * Lightweight endpoint performance sampler.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 \
 *   AUTH_TOKEN=<jwt> \
 *   QUERY_METRICS_ENABLED=true \
 *   node scripts/measure-query-performance.js
 */

const axios = require("axios");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ITERATIONS = Number(process.env.PERF_ITERATIONS || 20);
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const ENDPOINTS = (process.env.PERF_ENDPOINTS ||
  "/api/leaderboard?page=1&limit=50,/api/users/me/decks,/api/leaderboard/me").split(",");

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function measureEndpoint(endpoint) {
  const latencies = [];
  const dbQueryCounts = [];
  const dbQueryTimes = [];
  const statuses = {};

  for (let i = 0; i < ITERATIONS; i++) {
    const started = Date.now();
    try {
      const response = await axios.get(`${BASE_URL}${endpoint}`, {
        timeout: 15000,
        headers: AUTH_TOKEN
          ? {
              Authorization: `Bearer ${AUTH_TOKEN}`,
            }
          : {},
        validateStatus: () => true,
      });
      const elapsed = Date.now() - started;
      latencies.push(elapsed);
      statuses[response.status] = (statuses[response.status] || 0) + 1;

      const queryCount = Number(response.headers["x-db-query-count"] || 0);
      const queryTime = Number(response.headers["x-db-query-time-ms"] || 0);
      dbQueryCounts.push(queryCount);
      dbQueryTimes.push(queryTime);
    } catch (error) {
      const elapsed = Date.now() - started;
      latencies.push(elapsed);
      statuses["ERR"] = (statuses["ERR"] || 0) + 1;
    }
  }

  return {
    endpoint,
    requests: ITERATIONS,
    statuses,
    latency: {
      p50_ms: percentile(latencies, 50),
      p95_ms: percentile(latencies, 95),
      avg_ms:
        latencies.length > 0
          ? Math.round(
              (latencies.reduce((sum, value) => sum + value, 0) /
                latencies.length) *
                100
            ) / 100
          : 0,
    },
    db: {
      query_count_avg:
        dbQueryCounts.length > 0
          ? Math.round(
              (dbQueryCounts.reduce((sum, value) => sum + value, 0) /
                dbQueryCounts.length) *
                100
            ) / 100
          : 0,
      query_time_avg_ms:
        dbQueryTimes.length > 0
          ? Math.round(
              (dbQueryTimes.reduce((sum, value) => sum + value, 0) /
                dbQueryTimes.length) *
                100
            ) / 100
          : 0,
    },
  };
}

async function main() {
  console.log(`Measuring ${ENDPOINTS.length} endpoints @ ${BASE_URL}`);
  console.log(`Iterations per endpoint: ${ITERATIONS}`);
  if (!AUTH_TOKEN) {
    console.log("AUTH_TOKEN not set; auth endpoints may return 401");
  }

  const reports = [];
  for (const endpoint of ENDPOINTS) {
    const trimmed = endpoint.trim();
    if (!trimmed) continue;
    // eslint-disable-next-line no-await-in-loop
    reports.push(await measureEndpoint(trimmed));
  }

  console.log(JSON.stringify({ generated_at: new Date().toISOString(), reports }, null, 2));
}

main().catch((error) => {
  console.error("Performance measurement script failed:", error);
  process.exit(1);
});

