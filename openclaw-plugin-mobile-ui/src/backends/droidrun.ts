import { DroidrunExecutor } from "../internal/droidrun/executor";
import { DroidrunAgent } from "../internal/droidrun/agent";
import { auditEnd, auditError, auditStart } from "../internal/runtime";
import {
  ensureLogsDir,
  writeLog,
} from "../tools/workspace";

// DroidRun backend adapter.
// This module now keeps a deliberately small surface: health checks plus
// agent-mode execution. Low-level device actions and deterministic UI dumps
// live in the adb-backed path instead.

const exec = new DroidrunExecutor();
const agent = new DroidrunAgent();

let portalLock: Promise<void> = Promise.resolve();

async function withPortal<T>(fn: () => Promise<T>): Promise<T> {
  // Portal access is serialized because concurrent DroidRun actions can
  // interfere with each other at the device/session level.
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

async function audit<T>(tool: string, fn: () => Promise<T>) {
  const start = Date.now();
  auditStart(tool, "droidrun", start);
  try {
    const res: any = await fn();
    auditEnd(tool, start, res, { backend: "droidrun" });
    return res as T;
  } catch (e: any) {
    auditError(tool, start, e, { backend: "droidrun" });
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

export async function droidrun_agent_task(input: {
  goal: string;
  steps?: number;
  timeout?: number;
  deviceSerial?: string;
  tcp?: boolean;
}) {
  // TODO: keep agent-mode exposed here for now, but treat app/workflow policy
  // above this layer rather than inside backend adapters.
  const res = await audit("droidrun_agent_task", () => withPortal(() => agent.runTask(input)));
  return withFailureLog("droidrun_agent_task", res);
}
