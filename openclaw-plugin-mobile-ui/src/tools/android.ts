import { adb_devices, adb_screenshot, adb_tap, adb_type, adb_swipe } from "../backends/adb";
import { auditEnd, auditError, auditStart, CompositeBackend, runWithBackendFallback } from "../internal/runtime";
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

// Composite mobile runtime wrappers.
// These are the higher-level tool implementations exposed as `android_*`.
// They sit above backend adapters and currently still contain some backend
// selection policy, which is why Step 1 only documents that seam.

export async function android_health() {
  return droidrun_health();
}

export async function android_screenshot(input: { backend?: CompositeBackend }) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  auditStart("android_screenshot", backend, start);
  try {
    // TODO: move backend-selection policy out of runtime wrappers into a narrower execution layer.
    const { res, resolvedBackend } = await runWithBackendFallback({
      backend,
      adbAction: () => adb_screenshot(),
      droidrunAction: () => droidrun_screenshot(),
      hasAdbDevice,
    });
    auditEnd("android_screenshot", start, res, { resolved_backend: resolvedBackend });
    return res;
  } catch (error) {
    auditError("android_screenshot", start, error, { backend });
    throw error;
  }
}

export async function android_tap(input: { x: number; y: number; backend?: CompositeBackend }) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  auditStart("android_tap", backend, start);
  try {
    const { res, resolvedBackend } = await runWithBackendFallback({
      backend,
      adbAction: () => adb_tap({ x: input.x, y: input.y }),
      droidrunAction: () => droidrun_tap(input.x, input.y),
      hasAdbDevice,
    });
    auditEnd("android_tap", start, res, { resolved_backend: resolvedBackend });
    return res;
  } catch (error) {
    auditError("android_tap", start, error, { backend });
    throw error;
  }
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
  try {
    const { res, resolvedBackend } = await runWithBackendFallback({
      backend,
      adbAction: () => adb_type({ text: input.text }),
      droidrunAction: () => droidrun_type(input.text, input.index ?? -1, input.clear ?? false),
      hasAdbDevice,
    });
    auditEnd("android_type", start, res, { resolved_backend: resolvedBackend });
    return res;
  } catch (error) {
    auditError("android_type", start, error, { backend });
    throw error;
  }
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
  try {
    const { res, resolvedBackend } = await runWithBackendFallback({
      backend,
      adbAction: () => adb_swipe(input),
      droidrunAction: () => droidrun_swipe(input.x1, input.y1, input.x2, input.y2, input.durationMs ?? 300),
      hasAdbDevice,
    });
    auditEnd("android_swipe", start, res, { resolved_backend: resolvedBackend });
    return res;
  } catch (error) {
    auditError("android_swipe", start, error, { backend });
    throw error;
  }
}

// ---- semantic UI wrappers ----
export async function android_ui_dump() {
  const start = Date.now();
  auditStart("android_ui_dump", "droidrun", start);
  try {
    const res = await droidrun_ui_dump();
    auditEnd("android_ui_dump", start, res);
    if ((res as any)?.error === "timeout") {
      return { ok: false, error: "timeout", elapsed_s: Math.round((Date.now() - start) / 1000), timeout_s: undefined, logPath: (res as any)?.logPath };
    }
    return res;
  } catch (error) {
    auditError("android_ui_dump", start, error, { backend: "droidrun" });
    throw error;
  }
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
  try {
    const res = await droidrun_agent_task({ ...input, timeout: timeoutS });
    const elapsedS = Math.round((Date.now() - start) / 1000);
    auditEnd("android_agent_task", start, res);
    if ((res as any)?.error === "timeout") {
      return { ok: false, error: "timeout", elapsed_s: elapsedS, timeout_s: timeoutS, logPath: (res as any)?.logPath };
    }
    return res;
  } catch (error) {
    auditError("android_agent_task", start, error, { backend: "droidrun" });
    throw error;
  }
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
  // TODO: consider removing this preflight check in a later performance pass
  // and falling back based on direct ADB action failure instead.
  try {
    const res = await adb_devices();
    return Array.isArray((res as any)?.devices) && (res as any).devices.some((d: any) => d?.state === "device");
  } catch {
    return false;
  }
}
