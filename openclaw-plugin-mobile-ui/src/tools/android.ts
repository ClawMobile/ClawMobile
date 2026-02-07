import { DroidrunExecutor } from "../droidrun/executor";
import { DroidrunAgent } from "../droidrun/agent";

import { spawn } from "child_process";
import path from "path";

function getPython(): string {
  // 你现在已经在 run.sh 里 export 了 CLAW_MOBILE_PYTHON
  return process.env.CLAW_MOBILE_PYTHON || "python3";
}

async function runPyJson(scriptName: string, payload: any): Promise<any> {
  const script = path.resolve(__dirname, "..", "..", "pyexec", scriptName);
  const py = getPython();

  return await new Promise((resolve, reject) => {
    const p = spawn(py, [script], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let err = "";

    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));

    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`python tool failed (code=${code}): ${err || out}`));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`invalid json from python: ${out}\nstderr: ${err}`));
      }
    });

    p.stdin.write(JSON.stringify(payload ?? {}));
    p.stdin.end();
  });
}

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

export async function android_agent_task(input: {
  goal: string;
  steps?: number;
  timeout?: number;
  deviceSerial?: string;
  tcp?: boolean;
}) {
  return agent.runTask(input);
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

export async function android_vibrate(args?: { ms?: number; repeat?: number; gapMs?: number }) {
  const payload = {
    ms: args?.ms ?? 200,
    repeat: args?.repeat ?? 1,
    gapMs: args?.gapMs ?? 120,
  };

  // 这里假设你已有一个“执行 pyexec 下脚本并返回 JSON”的封装：
  // 比如 runPyJson("android_vibrate.py", payload)
  const res = await runPyJson("android_vibrate.py", payload);
  return res;
}