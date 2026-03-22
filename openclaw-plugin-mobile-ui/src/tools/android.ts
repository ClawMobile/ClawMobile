import { adb_screenshot, adb_tap, adb_type, adb_swipe, adb_ui_dump_xml } from "../backends/adb";
import {
  auditEnd,
  auditError,
  auditStart,
  LowLevelBackend,
  runWithBackendFallback,
} from "../internal/runtime";
import { signalComplete } from "./attention";
import {
  droidrun_health,
  droidrun_agent_task,
} from "../backends/droidrun";

// Composite mobile runtime wrappers.
// These are the higher-level tool implementations exposed as `android_*`.
// They sit above backend adapters and currently still contain some backend
// selection policy, which is why Step 1 only documents that seam.

export async function android_health() {
  return droidrun_health();
}

export async function android_screenshot(input: { backend?: LowLevelBackend }) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  auditStart("android_screenshot", backend, start);
  try {
    const { res, resolvedBackend } = await runWithBackendFallback({
      backend,
      adbAction: () => adb_screenshot(),
    });
    auditEnd("android_screenshot", start, res, { resolved_backend: resolvedBackend });
    return res;
  } catch (error) {
    auditError("android_screenshot", start, error, { backend });
    throw error;
  }
}

export async function android_tap(input: { x: number; y: number; backend?: LowLevelBackend }) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  auditStart("android_tap", backend, start);
  try {
    const { res, resolvedBackend } = await runWithBackendFallback({
      backend,
      adbAction: () => adb_tap({ x: input.x, y: input.y }),
    });
    auditEnd("android_tap", start, res, { resolved_backend: resolvedBackend });
    return res;
  } catch (error) {
    auditError("android_tap", start, error, { backend });
    throw error;
  }
}

export async function android_type(input: { text: string; backend?: LowLevelBackend }) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  auditStart("android_type", backend, start);
  try {
    const legacyInput = input as any;
    if (legacyInput?.index !== undefined || legacyInput?.clear !== undefined) {
      const res = {
        ok: false,
        error: "android_type_only_supports_typing_into_the_focused_field",
        extra: {
          unsupported_fields: [
            ...(legacyInput?.index !== undefined ? ["index"] : []),
            ...(legacyInput?.clear !== undefined ? ["clear"] : []),
          ],
        },
      };
      auditEnd("android_type", start, res, {
        resolved_backend: "unsupported",
        requested_backend: backend,
        rejection_reason: "legacy_index_or_clear_not_supported_in_adb_only_mode",
      });
      return res;
    }

    const { res, resolvedBackend } = await runWithBackendFallback({
      backend,
      adbAction: () => adb_type({ text: input.text }),
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
  backend?: LowLevelBackend;
}) {
  const start = Date.now();
  const backend = input?.backend ?? "auto";
  auditStart("android_swipe", backend, start);
  try {
    const { res, resolvedBackend } = await runWithBackendFallback({
      backend,
      adbAction: () => adb_swipe(input),
    });
    auditEnd("android_swipe", start, res, { resolved_backend: resolvedBackend });
    return res;
  } catch (error) {
    auditError("android_swipe", start, error, { backend });
    throw error;
  }
}

// ---- observation + agent wrappers ----
export async function android_ui_dump() {
  const start = Date.now();
  auditStart("android_ui_dump", "adb", start);
  try {
    const res = await adb_ui_dump_xml({});
    auditEnd("android_ui_dump", start, res);
    return { ...res, source: "adb_ui_dump_xml" };
  } catch (error) {
    auditError("android_ui_dump", start, error, { backend: "adb" });
    throw error;
  }
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

export async function android_signal_complete(args?: {
  ms?: number;
  title?: string;
  content?: string;
  vibrate?: boolean;
  toast?: boolean;
  wait?: boolean;
}) {
  return signalComplete(args);
}
