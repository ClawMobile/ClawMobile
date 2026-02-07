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
  return exec.screenshot(input?.output);
}

export async function android_tap(input: { x: number; y: number }) {
  return exec.tap(input.x, input.y);
}

export async function android_type(input: { text: string; index?: number; clear?: boolean }) {
  return exec.typeText(input.text, input.index ?? -1, input.clear ?? false);
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

// ---- NEW: a11y-based ----
export async function android_ui_dump(input: { onlyClickable?: boolean }) {
  return exec.uiDump(input?.onlyClickable ?? true);
}

export async function android_ui_tap(input: { index: number }) {
  return exec.uiTap(input.index);
}

export async function android_ui_type(input: { index: number; text: string; clear?: boolean }) {
  return exec.uiType(input.index, input.text, input.clear ?? false);
}

export async function android_task(input: { task: string }) {
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

export async function android_ui_find(input: {
  textContains?: string;
  descContains?: string;
  resourceIdContains?: string;
  classContains?: string;
  clickableOnly?: boolean;
  enabledOnly?: boolean;
  preferClickable?: boolean;
  limit?: number;
}) {
  return exec.uiFind(input || {});
}

export async function android_ui_tap_find(input: {
  textContains?: string;
  descContains?: string;
  resourceIdContains?: string;
  classContains?: string;
  clickableOnly?: boolean;
  enabledOnly?: boolean;
  limit?: number;
}) {
  return exec.uiTapFind(input || {});
}

export async function android_ui_type_find(input: {
  textContains?: string;
  descContains?: string;
  resourceIdContains?: string;
  classContains?: string;
  enabledOnly?: boolean;
  limit?: number;
  clear?: boolean;
  text: string;
}) {
  return exec.uiTypeFind(input || ({} as any));
}