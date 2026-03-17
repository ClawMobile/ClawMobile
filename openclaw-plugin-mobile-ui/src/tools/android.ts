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

// Composite mobile runtime wrappers.
// These are the higher-level tool implementations exposed as `android_*`.
// They sit above backend adapters and currently still contain some backend
// selection policy, which is why Step 1 only documents that seam.

type CompositeBackend = "auto" | "adb" | "droidrun";

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

function auditStart(tool: string, backend: string, start: number) {
  appendToolAudit({
    time: new Date(start).toISOString(),
    tool,
    phase: "start",
    backend,
    cwd: process.cwd(),
    env: envFlags(),
  });
}

function auditEnd(tool: string, start: number, res: any, extra?: Record<string, any>) {
  appendToolAudit({
    time: new Date().toISOString(),
    tool,
    phase: "end",
    ok: Boolean((res as any)?.ok),
    elapsed_ms: Date.now() - start,
    error: (res as any)?.error,
    stderr: (res as any)?.extra?.stderr_snip || (res as any)?.stderr,
    exit_code: (res as any)?.extra?.exit_code,
    ...(extra || {}),
  });
}

async function runWithBackendFallback(args: {
  backend?: CompositeBackend;
  adbAction: () => Promise<any>;
  droidrunAction: () => Promise<any>;
}) {
  const backend = args.backend ?? "auto";

  if (backend === "adb") {
    return { res: await args.adbAction(), resolvedBackend: "adb" as const };
  }

  if (backend === "droidrun") {
    return { res: await args.droidrunAction(), resolvedBackend: "droidrun" as const };
  }

  const hasAdb = await hasAdbDevice();
  if (hasAdb) {
    const adbRes = await args.adbAction();
    if ((adbRes as any)?.ok) {
      return { res: adbRes, resolvedBackend: "adb" as const };
    }
  }

  return { res: await args.droidrunAction(), resolvedBackend: "droidrun" as const };
}

export async function android_health() {
  return droidrun_health();
}

export async function android_screenshot(input: { backend?: CompositeBackend }) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  auditStart("android_screenshot", backend, start);
  // TODO: move backend-selection policy out of runtime wrappers into a narrower execution layer.
  const { res, resolvedBackend } = await runWithBackendFallback({
    backend,
    adbAction: () => adb_screenshot(),
    droidrunAction: () => droidrun_screenshot(),
  });
  auditEnd("android_screenshot", start, res, { resolved_backend: resolvedBackend });
  return res;
}

export async function android_tap(input: { x: number; y: number; backend?: CompositeBackend }) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  auditStart("android_tap", backend, start);
  const { res, resolvedBackend } = await runWithBackendFallback({
    backend,
    adbAction: () => adb_tap({ x: input.x, y: input.y }),
    droidrunAction: () => droidrun_tap(input.x, input.y),
  });
  auditEnd("android_tap", start, res, { resolved_backend: resolvedBackend });
  return res;
}

export async function android_type(input: {
  text: string;
  index?: number;
  clear?: boolean;
  backend?: CompositeBackend;
}) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  auditStart("android_type", backend, start);
  const { res, resolvedBackend } = await runWithBackendFallback({
    backend,
    adbAction: () => adb_type({ text: input.text }),
    droidrunAction: () => droidrun_type(input.text, input.index ?? -1, input.clear ?? false),
  });
  auditEnd("android_type", start, res, { resolved_backend: resolvedBackend });
  return res;
}

export async function android_swipe(input: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  durationMs?: number;
  backend?: CompositeBackend;
}) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  auditStart("android_swipe", backend, start);
  const { res, resolvedBackend } = await runWithBackendFallback({
    backend,
    adbAction: () => adb_swipe(input),
    droidrunAction: () => droidrun_swipe(input.x1, input.y1, input.x2, input.y2, input.durationMs ?? 300),
  });
  auditEnd("android_swipe", start, res, { resolved_backend: resolvedBackend });
  return res;
}

// ---- semantic UI wrappers ----
export async function android_ui_dump() {
  const start = Date.now();
  auditStart("android_ui_dump", "droidrun", start);
  const res = await droidrun_ui_dump();
  auditEnd("android_ui_dump", start, res);
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
  auditStart("android_agent_task", "droidrun", start);
  const res = await droidrun_agent_task(input);
  const elapsedS = Math.round((Date.now() - start) / 1000);
  auditEnd("android_agent_task", start, res);
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
  // Runtime helper only: tells composite tools whether the ADB path is
  // currently available before they fall back to DroidRun.
  try {
    const res = await adb_devices();
    return Array.isArray((res as any)?.devices) && (res as any).devices.some((d: any) => d?.state === "device");
  } catch {
    return false;
  }
}
