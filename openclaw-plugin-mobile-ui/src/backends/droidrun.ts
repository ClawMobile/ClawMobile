import fs from "fs";
import { DroidrunExecutor } from "../internal/droidrun/executor";
import { DroidrunAgent } from "../internal/droidrun/agent";
import {
  makeScreenshotPath,
  pngDimensions,
  truncateLargeStrings,
  ensureLogsDir,
  writeLog,
  appendToolAudit,
} from "../tools/workspace";

const exec = new DroidrunExecutor();
const agent = new DroidrunAgent();

let portalLock: Promise<void> = Promise.resolve();

async function withPortal<T>(fn: () => Promise<T>): Promise<T> {
  const prev = portalLock;
  let release: () => void;
  portalLock = new Promise((r) => (release = r));
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
}

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

async function audit<T>(tool: string, fn: () => Promise<T>) {
  const start = Date.now();
  appendToolAudit({
    time: new Date(start).toISOString(),
    tool,
    backend: "droidrun",
    phase: "start",
    cwd: process.cwd(),
    env: envFlags(),
  });
  try {
    const res: any = await fn();
  appendToolAudit({
    time: new Date().toISOString(),
    tool,
    backend: "droidrun",
    phase: "end",
    ok: Boolean(res?.ok),
    elapsed_ms: Date.now() - start,
    error: res?.error,
    stderr: res?.extra?.stderr_snip,
    exit_code: res?.extra?.exit_code,
  });
    return res as T;
  } catch (e: any) {
    appendToolAudit({
      time: new Date().toISOString(),
      tool,
      backend: "droidrun",
      phase: "end",
      ok: false,
      elapsed_ms: Date.now() - start,
      error: String(e?.message || e || "unknown_error"),
    });
    throw e;
  }
}

function withFailureLog(tool: string, res: any) {
  if (res && res.ok === false) {
    const logDir = ensureLogsDir();
    const logPath = writeLog(
      logDir,
      tool,
      JSON.stringify({ error: res?.error || "droidrun_failed", res }, null, 2)
    );
    return { ...res, error: res?.error || "droidrun_failed", logPath };
  }
  return res;
}

export async function droidrun_health() {
  const res = await audit("droidrun_health", () => withPortal(() => exec.health()));
  return withFailureLog("droidrun_health", res);
}

export async function droidrun_screenshot() {
  const res = await audit("droidrun_screenshot", () =>
    withPortal(async () => {
    const outPath = makeScreenshotPath();
    const res = await exec.screenshot(outPath);
    const ok = (res as any)?.ok === true;
    if (!ok) {
      console.warn("[android_screenshot] droidrun screenshot failed");
      return { ok: false, error: "droidrun_screenshot_failed", path: "", bytes: 0, width: 0, height: 0 };
    }

    try {
      const buf = fs.readFileSync(outPath);
      const dims = pngDimensions(buf);
      console.log(`[android_screenshot] saved to ${outPath}. If attachments are unavailable, use the path.`);
      return { ok: true, path: outPath, bytes: buf.length, width: dims.width, height: dims.height };
    } catch (e: any) {
      console.warn(`[android_screenshot] read failed: ${String(e?.message || e)}`);
      return { ok: false, error: "droidrun_screenshot_read_failed", path: "", bytes: 0, width: 0, height: 0 };
    }
    })
  );
  return withFailureLog("droidrun_screenshot", res);
}

export async function droidrun_tap(x: number, y: number) {
  const res = await audit("droidrun_tap", () => withPortal(() => exec.tap(x, y)));
  return withFailureLog("droidrun_tap", res);
}

export async function droidrun_type(text: string, index = -1, clear = false) {
  const res = await audit("droidrun_type", () => withPortal(() => exec.typeText(text, index, clear)));
  return withFailureLog("droidrun_type", res);
}

export async function droidrun_swipe(x1: number, y1: number, x2: number, y2: number, durationMs = 300) {
  const res = await audit("droidrun_swipe", () => withPortal(() => exec.swipe(x1, y1, x2, y2, durationMs)));
  return withFailureLog("droidrun_swipe", res);
}

export async function droidrun_ui_dump() {
  const res = await audit("droidrun_ui_dump", () =>
    withPortal(async () => {
    const res = await exec.uiDump();
    const ok = (res as any)?.ok === true;
    if (!ok) {
      const logDir = ensureLogsDir();
      const logPath = writeLog(
        logDir,
        "ui_dump",
        JSON.stringify({ error: (res as any)?.error || "ui_dump_failed", res }, null, 2)
      );
      return { ok: false, error: "ui_dump_failed", logPath };
    }
    return truncateLargeStrings(res);
    })
  );
  return withFailureLog("droidrun_ui_dump", res);
}

export async function droidrun_ui_tap(index: number) {
  const res = await audit("droidrun_ui_tap", () => withPortal(() => exec.uiTap(index)));
  return withFailureLog("droidrun_ui_tap", res);
}

export async function droidrun_ui_type(index: number, text: string, clear = false) {
  const res = await audit("droidrun_ui_type", () => withPortal(() => exec.uiType(index, text, clear)));
  return withFailureLog("droidrun_ui_type", res);
}

export async function droidrun_ui_find(input: {
  textContains?: string;
  descContains?: string;
  resourceIdContains?: string;
  classContains?: string;
  clickableOnly?: boolean;
  enabledOnly?: boolean;
  preferClickable?: boolean;
  limit?: number;
}) {
  const res = await audit("droidrun_ui_find", () =>
    withPortal(async () => truncateLargeStrings(await exec.uiFind(input || {})))
  );
  return withFailureLog("droidrun_ui_find", res);
}

export async function droidrun_ui_tap_find(input: {
  textContains?: string;
  descContains?: string;
  resourceIdContains?: string;
  classContains?: string;
  clickableOnly?: boolean;
  enabledOnly?: boolean;
  limit?: number;
}) {
  const res = await audit("droidrun_ui_tap_find", () =>
    withPortal(async () => truncateLargeStrings(await exec.uiTapFind(input || {})))
  );
  return withFailureLog("droidrun_ui_tap_find", res);
}

export async function droidrun_ui_type_find(input: {
  textContains?: string;
  descContains?: string;
  resourceIdContains?: string;
  classContains?: string;
  enabledOnly?: boolean;
  limit?: number;
  clear?: boolean;
  text: string;
}) {
  const res = await audit("droidrun_ui_type_find", () =>
    withPortal(async () => truncateLargeStrings(await exec.uiTypeFind(input || ({} as any))))
  );
  return withFailureLog("droidrun_ui_type_find", res);
}

export async function droidrun_agent_task(input: {
  goal: string;
  steps?: number;
  timeout?: number;
  deviceSerial?: string;
  tcp?: boolean;
}) {
  const res = await audit("droidrun_agent_task", () => agent.runTask(input));
  return withFailureLog("droidrun_agent_task", res);
}
