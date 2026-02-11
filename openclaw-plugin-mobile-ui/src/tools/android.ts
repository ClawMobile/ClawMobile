import { adb_devices, adb_screenshot, adb_tap, adb_type, adb_swipe } from "../backends/adb";
import { signalComplete } from "./attention";
import {
  droidrun_health,
  droidrun_screenshot,
  droidrun_tap,
  droidrun_type,
  droidrun_swipe,
  droidrun_ui_dump,
  droidrun_ui_tap,
  droidrun_ui_type,
  droidrun_ui_find,
  droidrun_ui_tap_find,
  droidrun_ui_type_find,
  droidrun_agent_task,
} from "../backends/droidrun";

export type Mode = "executor" | "agent";

function getMode(): Mode {
  const m = (process.env.CLAW_MOBILE_MODE || "executor").toLowerCase();
  return m === "agent" ? "agent" : "executor";
}

export async function android_health() {
  return droidrun_health();
}

export async function android_screenshot(input: { output?: string; backend?: "auto" | "adb" | "droidrun" }) {
  const backend = input?.backend ?? "auto";
  if (backend === "adb") return adb_screenshot();
  if (backend === "droidrun") return await droidrun_screenshot();

  const hasAdb = await hasAdbDevice();
  if (hasAdb) {
    const res = await adb_screenshot();
    if ((res as any)?.ok) return res;
  }
  return await droidrun_screenshot();
}

export async function android_tap(input: { x: number; y: number; backend?: "auto" | "adb" | "droidrun" }) {
  const backend = input?.backend ?? "auto";
  if (backend === "adb") return adb_tap({ x: input.x, y: input.y });
  if (backend === "droidrun") return droidrun_tap(input.x, input.y);

  const hasAdb = await hasAdbDevice();
  if (hasAdb) {
    const res = await adb_tap({ x: input.x, y: input.y });
    if ((res as any)?.ok) return res;
  }
  return droidrun_tap(input.x, input.y);
}

export async function android_type(input: {
  text: string;
  index?: number;
  clear?: boolean;
  backend?: "auto" | "adb" | "droidrun";
}) {
  const backend = input?.backend ?? "auto";
  if (backend === "adb") return adb_type({ text: input.text });
  if (backend === "droidrun") return droidrun_type(input.text, input.index ?? -1, input.clear ?? false);

  const hasAdb = await hasAdbDevice();
  if (hasAdb) {
    const res = await adb_type({ text: input.text });
    if ((res as any)?.ok) return res;
  }
  return droidrun_type(input.text, input.index ?? -1, input.clear ?? false);
}

export async function android_swipe(input: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  durationMs?: number;
  backend?: "auto" | "adb" | "droidrun";
}) {
  const backend = input?.backend ?? "auto";
  if (backend === "adb") return adb_swipe(input);
  if (backend === "droidrun") return droidrun_swipe(input.x1, input.y1, input.x2, input.y2, input.durationMs ?? 300);

  const hasAdb = await hasAdbDevice();
  if (hasAdb) {
    const res = await adb_swipe(input);
    if ((res as any)?.ok) return res;
  }
  return droidrun_swipe(input.x1, input.y1, input.x2, input.y2, input.durationMs ?? 300);
}

// ---- NEW: a11y-based ----
export async function android_ui_dump(input: { onlyClickable?: boolean }) {
  return droidrun_ui_dump(input?.onlyClickable ?? true);
}

export async function android_ui_tap(input: { index: number }) {
  return droidrun_ui_tap(input.index);
}

export async function android_ui_type(input: { index: number; text: string; clear?: boolean }) {
  return droidrun_ui_type(input.index, input.text, input.clear ?? false);
}

export async function android_agent_task(input: {
  goal: string;
  steps?: number;
  timeout?: number;
  deviceSerial?: string;
  tcp?: boolean;
}) {
  return droidrun_agent_task(input);
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
  return droidrun_ui_find(input || {});
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
  return droidrun_ui_tap_find(input || {});
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
  return droidrun_ui_type_find(input || ({} as any));
}

export async function android_signal_complete(args?: {
  ms?: number;
  repeat?: number;
  gapMs?: number;
  tts?: string;
  title?: string;
  content?: string;
}) {
  return signalComplete(args);
}

async function hasAdbDevice() {
  try {
    const res = await adb_devices();
    return Array.isArray((res as any)?.devices) && (res as any).devices.some((d: any) => d?.state === "device");
  } catch {
    return false;
  }
}
