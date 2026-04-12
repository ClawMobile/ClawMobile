#!/usr/bin/env node
// =============================================================================
// Benchmark: getWorkspaceDir() — Uncached (BEFORE) vs Memoized (AFTER)
//
// Measures the per-call cost of resolving the OpenClaw workspace directory
// through the config.json → existsSync → readFileSync → JSON.parse path,
// comparing the old (uncached) implementation against the new memoized version.
//
// This function is in the hot path of every tool call:
//   appendToolAudit → ensureLogsDir → getWorkspaceDir()   (×2 per tool: start+end)
//   makeScreenshotPath → ensureScreenshotsDir → getWorkspaceDir()
//
// Usage:
//   node benchmarks/bench_workspace_dir.mjs           # default 10 000 iterations
//   node benchmarks/bench_workspace_dir.mjs 50000     # 50 000 iterations
//   OPENCLAW_WORKSPACE=/tmp/ws node benchmarks/bench_workspace_dir.mjs  # env-var path
// =============================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const ITERATIONS = parseInt(process.argv[2] || "10000", 10);
const WARMUP = Math.min(500, Math.floor(ITERATIONS / 10));

// ---------------------------------------------------------------------------
// Setup: create a temporary config.json so the benchmark exercises the real
// code path (existsSync → readFileSync → JSON.parse → extract workspace).
// ---------------------------------------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-ws-"));
const stateDir = path.join(tmpDir, ".openclaw");
const configPath = path.join(stateDir, "config.json");
const workspacePath = path.join(tmpDir, "workspace");

fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(
  configPath,
  JSON.stringify({
    agents: { defaults: { workspace: workspacePath } },
  })
);

// Save original env and override for the benchmark
const origWorkspace = process.env.OPENCLAW_WORKSPACE;
const origStateDir = process.env.OPENCLAW_STATE_DIR;
delete process.env.OPENCLAW_WORKSPACE;
process.env.OPENCLAW_STATE_DIR = stateDir;

// ---------------------------------------------------------------------------
// BEFORE: uncached — reads config.json from disk on every call
// ---------------------------------------------------------------------------
function getWorkspaceDirUncached() {
  if (process.env.OPENCLAW_WORKSPACE) return process.env.OPENCLAW_WORKSPACE;

  const sd =
    process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
  const cp = path.join(sd, "config.json");

  try {
    if (fs.existsSync(cp)) {
      const raw = fs.readFileSync(cp, "utf8");
      const parsed = JSON.parse(raw);
      const ws = parsed?.agents?.defaults?.workspace;
      if (typeof ws === "string" && ws.trim()) return ws.trim();
    }
  } catch {
    // fall back
  }

  if (process.env.OPENCLAW_STATE_DIR) return path.join(sd, "workspace");
  return "/root/.openclaw/workspace";
}

// ---------------------------------------------------------------------------
// AFTER: memoized — resolves once, returns from memory afterwards
// ---------------------------------------------------------------------------
let _cached = null;

function getWorkspaceDirCached() {
  if (_cached !== null) return _cached;
  _cached = getWorkspaceDirUncached();
  return _cached;
}

function resetCache() {
  _cached = null;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
function runBench(label, fn, { perCallReset } = {}) {
  // warm up
  for (let i = 0; i < WARMUP; i++) {
    if (perCallReset) perCallReset();
    fn();
  }

  const times = new Float64Array(ITERATIONS);
  for (let i = 0; i < ITERATIONS; i++) {
    if (perCallReset) perCallReset();
    const t0 = performance.now();
    fn();
    times[i] = performance.now() - t0;
  }
  return times;
}

function stats(times) {
  const sorted = Float64Array.from(times).sort();
  const n = sorted.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const avg = sum / n;
  const median =
    n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
  const min = sorted[0];
  const max = sorted[n - 1];
  const p95 = sorted[Math.min(Math.ceil(n * 0.95) - 1, n - 1)];
  const p99 = sorted[Math.min(Math.ceil(n * 0.99) - 1, n - 1)];
  return { avg, median, min, max, p95, p99, total: sum };
}

function fmtUs(ms) {
  return `${(ms * 1000).toFixed(1)}µs`;
}

function fmtMs(ms) {
  return `${ms.toFixed(2)}ms`;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
console.log("=== getWorkspaceDir() Benchmark ===");
console.log(`Iterations : ${ITERATIONS}`);
console.log(`Warmup     : ${WARMUP}`);
console.log(`Config path: ${configPath}`);
console.log(`Resolved ws: ${getWorkspaceDirUncached()}`);
console.log("");

console.log("--- BEFORE (uncached — disk read every call) ---");
const beforeTimes = runBench("uncached", getWorkspaceDirUncached);
const bStats = stats(beforeTimes);
console.log(
  `  avg=${fmtUs(bStats.avg)}  median=${fmtUs(bStats.median)}  ` +
    `min=${fmtUs(bStats.min)}  max=${fmtUs(bStats.max)}  ` +
    `p95=${fmtUs(bStats.p95)}  p99=${fmtUs(bStats.p99)}`
);
console.log(`  total wall time: ${fmtMs(bStats.total)}`);
console.log("");

console.log("--- AFTER (memoized — single resolve, then memory) ---");
resetCache();
const afterTimes = runBench("cached", getWorkspaceDirCached);
const aStats = stats(afterTimes);
console.log(
  `  avg=${fmtUs(aStats.avg)}  median=${fmtUs(aStats.median)}  ` +
    `min=${fmtUs(aStats.min)}  max=${fmtUs(aStats.max)}  ` +
    `p95=${fmtUs(aStats.p95)}  p99=${fmtUs(aStats.p99)}`
);
console.log(`  total wall time: ${fmtMs(aStats.total)}`);
console.log("");

// Simulate the real hot path: appendToolAudit calls ensureLogsDir which calls
// getWorkspaceDir, and this happens twice per tool invocation (start + end).
// With 30 tool calls in a task, that's 60 resolutions.
const TOOL_CALLS = 30;
const CALLS_PER_TOOL = 2; // auditStart + auditEnd
const totalCalls = TOOL_CALLS * CALLS_PER_TOOL;

console.log(`--- Real-world projection (${TOOL_CALLS}-step task, ${CALLS_PER_TOOL} audit calls/tool) ---`);
const uncachedPerTask = bStats.avg * totalCalls;
const cachedPerTask = aStats.avg * totalCalls;
console.log(`  Uncached: ${totalCalls} × ${fmtUs(bStats.avg)} = ${fmtMs(uncachedPerTask)}`);
console.log(`  Cached:   ${totalCalls} × ${fmtUs(aStats.avg)} = ${fmtMs(cachedPerTask)}`);
console.log("");

const speedup = bStats.avg / Math.max(aStats.avg, 1e-9);
const savedPct =
  bStats.avg > 0 ? ((bStats.avg - aStats.avg) / bStats.avg) * 100 : 0;

console.log("==================================================================");
console.log("                       RESULTS SUMMARY");
console.log("==================================================================");
console.log("");
console.log(
  `  ${" ".repeat(12)}${"avg".padStart(10)}${"median".padStart(10)}` +
    `${"min".padStart(10)}${"max".padStart(10)}${"p95".padStart(10)}${"p99".padStart(10)}`
);
console.log("  " + "-".repeat(72));
console.log(
  `  ${"BEFORE".padEnd(12)}${fmtUs(bStats.avg).padStart(10)}${fmtUs(bStats.median).padStart(10)}` +
    `${fmtUs(bStats.min).padStart(10)}${fmtUs(bStats.max).padStart(10)}` +
    `${fmtUs(bStats.p95).padStart(10)}${fmtUs(bStats.p99).padStart(10)}`
);
console.log(
  `  ${"AFTER".padEnd(12)}${fmtUs(aStats.avg).padStart(10)}${fmtUs(aStats.median).padStart(10)}` +
    `${fmtUs(aStats.min).padStart(10)}${fmtUs(aStats.max).padStart(10)}` +
    `${fmtUs(aStats.p95).padStart(10)}${fmtUs(aStats.p99).padStart(10)}`
);
console.log("  " + "-".repeat(72));
console.log(
  `  Speedup: ${speedup.toFixed(1)}x  (${savedPct.toFixed(1)}% reduction per call)`
);
console.log(
  `  Saved per 30-step task: ${fmtMs(uncachedPerTask - cachedPerTask)}`
);
console.log("");

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
if (origWorkspace !== undefined) process.env.OPENCLAW_WORKSPACE = origWorkspace;
else delete process.env.OPENCLAW_WORKSPACE;
if (origStateDir !== undefined) process.env.OPENCLAW_STATE_DIR = origStateDir;
else delete process.env.OPENCLAW_STATE_DIR;

fs.rmSync(tmpDir, { recursive: true, force: true });
