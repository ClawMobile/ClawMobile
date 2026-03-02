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
import { appendToolAudit } from "./workspace";

function envFlags() {
  return {
    DROIDRUN_SERIAL: process.env.DROIDRUN_SERIAL || "",
    DROIDRUN_PROVIDER: process.env.DROIDRUN_PROVIDER || "",
    DROIDRUN_MODEL: process.env.DROIDRUN_MODEL || "",
    CLAW_MOBILE_PYTHON: process.env.CLAW_MOBILE_PYTHON || "",
    DROIDRUN_USE_TCP: process.env.DROIDRUN_USE_TCP || "",
    OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
    GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
    ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    DEEPSEEK_API_KEY: Boolean(process.env.DEEPSEEK_API_KEY),
  };
}

export type Mode = "executor" | "agent";

function getMode(): Mode {
  const m = (process.env.CLAW_MOBILE_MODE || "executor").toLowerCase();
  return m === "agent" ? "agent" : "executor";
}

export async function android_health() {
  return droidrun_health();
}

export async function android_screenshot(input: { output?: string; backend?: "auto" | "adb" | "droidrun" }) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  appendToolAudit({
    time: new Date(start).toISOString(),
    tool: "android_screenshot",
    phase: "start",
    backend,
    cwd: process.cwd(),
    env: envFlags(),
  });
  let res: any;
  let resolvedBackend = backend;
  if (backend === "adb") {
    res = await adb_screenshot();
  } else if (backend === "droidrun") {
    res = await droidrun_screenshot();
  } else {
    const hasAdb = await hasAdbDevice();
    if (hasAdb) {
      const adbRes = await adb_screenshot();
      if ((adbRes as any)?.ok) {
        res = adbRes;
        resolvedBackend = "adb";
      } else {
        res = await droidrun_screenshot();
        resolvedBackend = "droidrun";
      }
    } else {
      res = await droidrun_screenshot();
      resolvedBackend = "droidrun";
    }
  }
  appendToolAudit({
    time: new Date().toISOString(),
    tool: "android_screenshot",
    phase: "end",
    resolved_backend: resolvedBackend,
    ok: Boolean((res as any)?.ok),
    elapsed_ms: Date.now() - start,
    error: (res as any)?.error,
    stderr: (res as any)?.extra?.stderr_snip || (res as any)?.stderr,
    exit_code: (res as any)?.extra?.exit_code,
  });
  return res;
}

export async function android_tap(input: { x: number; y: number; backend?: "auto" | "adb" | "droidrun" }) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  appendToolAudit({
    time: new Date(start).toISOString(),
    tool: "android_tap",
    phase: "start",
    backend,
    cwd: process.cwd(),
    env: envFlags(),
  });
  let res: any;
  let resolvedBackend = backend;
  if (backend === "adb") {
    res = await adb_tap({ x: input.x, y: input.y });
  } else if (backend === "droidrun") {
    res = await droidrun_tap(input.x, input.y);
  } else {
    const hasAdb = await hasAdbDevice();
    if (hasAdb) {
      const adbRes = await adb_tap({ x: input.x, y: input.y });
      if ((adbRes as any)?.ok) {
        res = adbRes;
        resolvedBackend = "adb";
      } else {
        res = await droidrun_tap(input.x, input.y);
        resolvedBackend = "droidrun";
      }
    } else {
      res = await droidrun_tap(input.x, input.y);
      resolvedBackend = "droidrun";
    }
  }
  appendToolAudit({
    time: new Date().toISOString(),
    tool: "android_tap",
    phase: "end",
    resolved_backend: resolvedBackend,
    ok: Boolean((res as any)?.ok),
    elapsed_ms: Date.now() - start,
    error: (res as any)?.error,
    stderr: (res as any)?.extra?.stderr_snip || (res as any)?.stderr,
    exit_code: (res as any)?.extra?.exit_code,
  });
  return res;
}

export async function android_type(input: {
  text: string;
  index?: number;
  clear?: boolean;
  backend?: "auto" | "adb" | "droidrun";
}) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  appendToolAudit({
    time: new Date(start).toISOString(),
    tool: "android_type",
    phase: "start",
    backend,
    cwd: process.cwd(),
    env: envFlags(),
  });
  let res: any;
  let resolvedBackend = backend;
  if (backend === "adb") {
    res = await adb_type({ text: input.text });
  } else if (backend === "droidrun") {
    res = await droidrun_type(input.text, input.index ?? -1, input.clear ?? false);
  } else {
    const hasAdb = await hasAdbDevice();
    if (hasAdb) {
      const adbRes = await adb_type({ text: input.text });
      if ((adbRes as any)?.ok) {
        res = adbRes;
        resolvedBackend = "adb";
      } else {
        res = await droidrun_type(input.text, input.index ?? -1, input.clear ?? false);
        resolvedBackend = "droidrun";
      }
    } else {
      res = await droidrun_type(input.text, input.index ?? -1, input.clear ?? false);
      resolvedBackend = "droidrun";
    }
  }
  appendToolAudit({
    time: new Date().toISOString(),
    tool: "android_type",
    phase: "end",
    resolved_backend: resolvedBackend,
    ok: Boolean((res as any)?.ok),
    elapsed_ms: Date.now() - start,
    error: (res as any)?.error,
    stderr: (res as any)?.extra?.stderr_snip || (res as any)?.stderr,
    exit_code: (res as any)?.extra?.exit_code,
  });
  return res;
}

export async function android_swipe(input: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  durationMs?: number;
  backend?: "auto" | "adb" | "droidrun";
}) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  appendToolAudit({
    time: new Date(start).toISOString(),
    tool: "android_swipe",
    phase: "start",
    backend,
    cwd: process.cwd(),
    env: envFlags(),
  });
  let res: any;
  let resolvedBackend = backend;
  if (backend === "adb") {
    res = await adb_swipe(input);
  } else if (backend === "droidrun") {
    res = await droidrun_swipe(input.x1, input.y1, input.x2, input.y2, input.durationMs ?? 300);
  } else {
    const hasAdb = await hasAdbDevice();
    if (hasAdb) {
      const adbRes = await adb_swipe(input);
      if ((adbRes as any)?.ok) {
        res = adbRes;
        resolvedBackend = "adb";
      } else {
        res = await droidrun_swipe(input.x1, input.y1, input.x2, input.y2, input.durationMs ?? 300);
        resolvedBackend = "droidrun";
      }
    } else {
      res = await droidrun_swipe(input.x1, input.y1, input.x2, input.y2, input.durationMs ?? 300);
      resolvedBackend = "droidrun";
    }
  }
  appendToolAudit({
    time: new Date().toISOString(),
    tool: "android_swipe",
    phase: "end",
    resolved_backend: resolvedBackend,
    ok: Boolean((res as any)?.ok),
    elapsed_ms: Date.now() - start,
    error: (res as any)?.error,
    stderr: (res as any)?.extra?.stderr_snip || (res as any)?.stderr,
    exit_code: (res as any)?.extra?.exit_code,
  });
  return res;
}

// ---- NEW: a11y-based ----
export async function android_ui_dump() {
  const start = Date.now();
  appendToolAudit({
    time: new Date(start).toISOString(),
    tool: "android_ui_dump",
    phase: "start",
    backend: "droidrun",
    cwd: process.cwd(),
    env: envFlags(),
  });
  const res = await droidrun_ui_dump();
  appendToolAudit({
    time: new Date().toISOString(),
    tool: "android_ui_dump",
    phase: "end",
    ok: Boolean((res as any)?.ok),
    elapsed_ms: Date.now() - start,
    error: (res as any)?.error,
    stderr: (res as any)?.extra?.stderr_snip || (res as any)?.stderr,
    exit_code: (res as any)?.extra?.exit_code,
  });
  if ((res as any)?.error === "timeout") {
    return { ok: false, error: "timeout", elapsed_s: Math.round((Date.now() - start) / 1000), timeout_s: undefined, logPath: (res as any)?.logPath };
  }
  return res;
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
  const start = Date.now();
  const envDefaultS = Number(process.env.CLAW_MOBILE_AGENT_TIMEOUT_S || 600);
  const defaultS = Number.isFinite(envDefaultS) && envDefaultS > 0 ? envDefaultS : 600;
  const maxS = 1800;
  const timeoutS = Math.min(Math.max(input?.timeout ?? defaultS, 1), maxS);
  appendToolAudit({
    time: new Date(start).toISOString(),
    tool: "android_agent_task",
    phase: "start",
    backend: "droidrun",
    cwd: process.cwd(),
    env: envFlags(),
  });
  const res = await droidrun_agent_task(input);
  const elapsedS = Math.round((Date.now() - start) / 1000);
  appendToolAudit({
    time: new Date().toISOString(),
    tool: "android_agent_task",
    phase: "end",
    ok: Boolean((res as any)?.ok),
    elapsed_ms: Date.now() - start,
    error: (res as any)?.error,
    stderr: (res as any)?.extra?.stderr_snip || (res as any)?.stderr,
    exit_code: (res as any)?.extra?.exit_code,
  });
  if ((res as any)?.error === "timeout") {
    return { ok: false, error: "timeout", elapsed_s: elapsedS, timeout_s: timeoutS, logPath: (res as any)?.logPath };
  }
  return res;
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
