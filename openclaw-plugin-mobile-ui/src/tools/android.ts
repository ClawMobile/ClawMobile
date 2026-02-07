import { DroidrunExecutor } from "../droidrun/executor";
import { DroidrunAgent } from "../droidrun/agent";

export type Mode = "executor" | "agent";

function getMode(): Mode {
  const m = (process.env.CLAW_MOBILE_MODE || "executor").toLowerCase();
  return m === "agent" ? "agent" : "executor";
}

const exec = new DroidrunExecutor();
const agent = new DroidrunAgent();

export async function android_health() {
  return exec.health();
}

export async function android_screenshot(input: { output?: string }) {
  // v1：无论 executor/agent，截图先走 executor
  return exec.screenshot(input?.output);
}

export async function android_tap(input: { x: number; y: number }) {
  return exec.tap(input.x, input.y);
}

export async function android_type(input: { text: string }) {
  return exec.typeText(input.text);
}

export async function android_swipe(input: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  durationMs?: number;
}) {
  return exec.swipe(input.x1, input.y1, input.x2, input.y2, input.durationMs ?? 300);
}

export async function android_task(input: { task: string }) {
  // v1：只有 agent 模式才走 agent，否则也给个可用结果
  if (getMode() === "agent") return agent.runTask(input.task);
  return {
    ok: true,
    data: {
      mode: "executor",
      note: "android_task is agent-oriented; set CLAW_MOBILE_MODE=agent to enable agent behavior.",
      task: input.task,
    },
  };
}