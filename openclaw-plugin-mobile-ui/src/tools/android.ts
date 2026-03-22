import { adb_screenshot, adb_tap, adb_type, adb_swipe, adb_ui_dump_xml } from "../backends/adb";
import {
  auditEnd,
  auditError,
  auditStart,
} from "../internal/runtime";
import { truncateString } from "./workspace";
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

export async function android_screenshot() {
  const start = Date.now();
  auditStart("android_screenshot", "adb", start);
  try {
    const res = await adb_screenshot();
    auditEnd("android_screenshot", start, res, { resolved_backend: "adb" });
    return res;
  } catch (error) {
    auditError("android_screenshot", start, error, { backend: "adb" });
    throw error;
  }
}

export async function android_tap(input: { x: number; y: number }) {
  const start = Date.now();
  auditStart("android_tap", "adb", start);
  try {
    const res = await adb_tap({ x: input.x, y: input.y });
    auditEnd("android_tap", start, res, { resolved_backend: "adb" });
    return res;
  } catch (error) {
    auditError("android_tap", start, error, { backend: "adb" });
    throw error;
  }
}

type AndroidTypeInput = {
  text: string;
  // Deprecated legacy fields from the old DroidRun-backed contract.
  // We still accept them at runtime so older callers get a structured
  // rejection instead of silently ignoring the request.
  index?: number;
  clear?: boolean;
};

export async function android_type(input: AndroidTypeInput) {
  const start = Date.now();
  auditStart("android_type", "adb", start);
  try {
    if (input.index !== undefined || input.clear !== undefined) {
      const res = {
        ok: false,
        error: "android_type_only_supports_typing_into_the_focused_field",
        extra: {
          unsupported_fields: [
            ...(input.index !== undefined ? ["index"] : []),
            ...(input.clear !== undefined ? ["clear"] : []),
          ],
        },
      };
      auditEnd("android_type", start, res, {
        resolved_backend: "unsupported",
        requested_backend: "adb",
        rejection_reason: "legacy_index_or_clear_not_supported_in_adb_only_mode",
      });
      return res;
    }

    const res = await adb_type({ text: input.text });
    auditEnd("android_type", start, res, { resolved_backend: "adb" });
    return res;
  } catch (error) {
    auditError("android_type", start, error, { backend: "adb" });
    throw error;
  }
}

export async function android_swipe(input: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  durationMs?: number;
}) {
  const start = Date.now();
  auditStart("android_swipe", "adb", start);
  try {
    const res = await adb_swipe(input);
    auditEnd("android_swipe", start, res, { resolved_backend: "adb" });
    return res;
  } catch (error) {
    auditError("android_swipe", start, error, { backend: "adb" });
    throw error;
  }
}

// ---- observation + agent wrappers ----
export async function android_ui_dump() {
  const start = Date.now();
  auditStart("android_ui_dump", "adb", start);
  try {
    const res = await adb_ui_dump_xml({});
    const shaped = {
      ok: res.ok,
      code: res.code,
      stderr: res.stderr,
      xml: res.xml,
      source: "adb_ui_dump_xml" as const,
      ...(!res.ok && res.stdout
        ? { stdout_snip: truncateString(res.stdout) }
        : {}),
    };
    auditEnd("android_ui_dump", start, shaped);
    return shaped;
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
