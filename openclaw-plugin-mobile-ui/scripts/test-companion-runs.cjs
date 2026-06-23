const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawmobile-companion-runs-"));
process.env.OPENCLAW_STATE_DIR = path.join(root, "openclaw-state");
process.env.CLAWMOBILE_AGENT_ID = "main";

const sessionsDir = path.join(process.env.OPENCLAW_STATE_DIR, "agents", "main", "sessions");
fs.mkdirSync(sessionsDir, { recursive: true });

const sessionId = "session-token-usage";
const runId = "run_123_cost";
fs.writeFileSync(
  path.join(sessionsDir, "sessions.json"),
  JSON.stringify({
    sessions: [
      {
        sessionId,
        key: "agent:main:companion-run-123-cost",
        label: "ClawMobile Companion",
        status: "completed",
        startedAt: 1000,
        endedAt: 2000,
      },
    ],
  }, null, 2),
);

const trajectoryEvents = [
  {
    type: "prompt.submitted",
    runId,
    ts: "2026-06-24T00:00:00.000Z",
    data: { prompt: "Measure token usage." },
  },
  {
    type: "model.completed",
    runId,
    ts: "2026-06-24T00:00:01.000Z",
    data: {
      assistantTexts: ["First model response."],
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        prompt_tokens_details: { cached_tokens: 800 },
        estimated_cost_usd: 0.0123,
      },
    },
  },
  {
    type: "model.completed",
    runId,
    ts: "2026-06-24T00:00:02.000Z",
    data: {
      assistantTexts: ["Second model response."],
      usage: {
        inputTokens: 500,
        outputTokens: 50,
        costUsd: 0.004,
      },
    },
  },
  {
    type: "model.completed",
    runId,
    ts: "2026-06-24T00:00:03.000Z",
    data: {
      assistantTexts: ["Final model response."],
      usage: {
        input_tokens: 30,
        output_tokens_details: { reasoning_tokens: 7 },
        estimatedCostUsd: 0.001,
      },
    },
  },
  {
    type: "session.ended",
    runId,
    ts: "2026-06-24T00:00:04.000Z",
    data: { status: "success" },
  },
];
fs.writeFileSync(
  path.join(sessionsDir, `${sessionId}.trajectory.jsonl`),
  trajectoryEvents.map((event) => JSON.stringify(event)).join("\n"),
);

const { getRunStatus } = require("../dist/companion/runs.js");

(async () => {
  const status = await getRunStatus(runId);
  assert.strictEqual(status.success, true);
  assert.strictEqual(status.state, "done");
  assert.strictEqual(status.result, "Final model response.");
  assert.ok(status.tokenUsage);
  assert.ok(Math.abs(status.tokenUsage.estimatedCostUsd - 0.0173) < 0.0000001);
  assert.deepStrictEqual({
    ...status.tokenUsage,
    estimatedCostUsd: undefined,
  }, {
    inputTokens: 1530,
    outputTokens: 250,
    totalTokens: 1787,
    cachedTokens: 800,
    reasoningTokens: 7,
    estimatedCost: "$0.02",
    estimatedCostUsd: undefined,
  });
  console.log(`companion runs test passed: ${root}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
