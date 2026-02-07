import { DroidrunExecutor } from "../droidrun/executor";
import { DroidrunAgent } from "../droidrun/agent";

export type Mode = "executor" | "agent";

function getMode(): Mode {
  // 通过环境变量控制，默认 executor
  const m = (process.env.CLAW_MOBILE_MODE || "executor").toLowerCase();
  return m === "agent" ? "agent" : "executor";
}

const exec = new DroidrunExecutor();
const agent = new DroidrunAgent();

export async function android_health() {
  return exec.health();
}

export async function android_screenshot(input: { output?: string }) {
  if (getMode() === "agent") {
    // agent 模式下也可以先走 executor 的 screenshot
    return exec.screenshot(input?.output);
  }
  return exec.screenshot(input?.output);
}

export async function android_tap(input: { x: number; y: number }) {
  return exec.tap(input.x, input.y);
}

export async function android_type(input: { text: string }) {
  return exec.typeText(input.text);
}

export async function android_swipe(input: { x1: number; y1: number; x2: number; y2: number; durationMs?: number }) {
  return exec.swipe(input.x1, input.y1, input.x2, input.y2, input.durationMs ?? 300);
}

export async function android_task(input: { task: string }) {
  // 只在 agent 模式有意义
  return agent.runTask(input.task);
}