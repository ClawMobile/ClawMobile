import fs from "fs";
import { DroidrunExecutor } from "../droidrun/executor";
import { DroidrunAgent } from "../droidrun/agent";
import {
  makeScreenshotPath,
  pngDimensions,
  truncateLargeStrings,
  ensureLogsDir,
  writeLog,
} from "./workspace";

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

export async function droidrun_health() {
  return await withPortal(() => exec.health());
}

export async function droidrun_screenshot() {
  return await withPortal(async () => {
    const outPath = makeScreenshotPath();
    const res = await exec.screenshot(outPath);
    const ok = (res as any)?.ok === true;
    if (!ok) {
      console.warn("[android_screenshot] droidrun screenshot failed");
      return { ok: false, path: "", bytes: 0, width: 0, height: 0 };
    }

    try {
      const buf = fs.readFileSync(outPath);
      const dims = pngDimensions(buf);
      console.log(`[android_screenshot] saved to ${outPath}. If attachments are unavailable, use the path.`);
      return { ok: true, path: outPath, bytes: buf.length, width: dims.width, height: dims.height };
    } catch (e: any) {
      console.warn(`[android_screenshot] read failed: ${String(e?.message || e)}`);
      return { ok: false, path: "", bytes: 0, width: 0, height: 0 };
    }
  });
}

export async function droidrun_tap(x: number, y: number) {
  return await withPortal(() => exec.tap(x, y));
}

export async function droidrun_type(text: string, index = -1, clear = false) {
  return await withPortal(() => exec.typeText(text, index, clear));
}

export async function droidrun_swipe(x1: number, y1: number, x2: number, y2: number, durationMs = 300) {
  return await withPortal(() => exec.swipe(x1, y1, x2, y2, durationMs));
}

export async function droidrun_ui_dump(onlyClickable = true) {
  return await withPortal(async () => {
    const res = await exec.uiDump(onlyClickable);
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
  });
}

export async function droidrun_ui_tap(index: number) {
  return await withPortal(() => exec.uiTap(index));
}

export async function droidrun_ui_type(index: number, text: string, clear = false) {
  return await withPortal(() => exec.uiType(index, text, clear));
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
  return await withPortal(async () => truncateLargeStrings(await exec.uiFind(input || {})));
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
  return await withPortal(async () => truncateLargeStrings(await exec.uiTapFind(input || {})));
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
  return await withPortal(async () => truncateLargeStrings(await exec.uiTypeFind(input || ({} as any))));
}

export async function droidrun_agent_task(input: {
  goal: string;
  steps?: number;
  timeout?: number;
  deviceSerial?: string;
  tcp?: boolean;
}) {
  return agent.runTask(input);
}
