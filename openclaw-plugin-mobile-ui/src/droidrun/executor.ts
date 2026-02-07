import { spawn } from "child_process";
import path from "path";

export type ExecResult = { ok: boolean; data?: any; error?: string; extra?: any };

function runPython(args: string[], timeoutMs = 30_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const script = path.resolve(__dirname, "..", "..", "pyexec", "android_exec.py");
    const PY = process.env.CLAW_MOBILE_PYTHON || "python3";

    const p = spawn(PY, [script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let out = "";
    let err = "";

    const timer = setTimeout(() => {
      try {
        p.kill("SIGKILL");
      } catch {}
      resolve({ ok: false, error: "timeout", extra: { timeoutMs } });
    }, timeoutMs);

    p.on("error", (e: any) => {
      clearTimeout(timer);
      resolve({ ok: false, error: "spawn_failed", extra: { message: String(e), code: e?.code, PY } });
    });

    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));

    p.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse((out || "").trim() || "{}");
        resolve(parsed);
      } catch {
        resolve({ ok: false, error: "invalid_json", extra: { stdout: out, stderr: err } });
      }
    });
  });
}

export class DroidrunExecutor {
  async health() {
    return runPython(["health"], 10_000);
  }

  async screenshot(output?: string) {
    const args = ["screenshot"];
    if (output) args.push("--output", output);
    return runPython(args, 60_000);
  }

  async tap(x: number, y: number) {
    return runPython(["tap", String(x), String(y)]);
  }

  async typeText(text: string, index = -1, clear = false) {
    const args = ["type", text, "--index", String(index)];
    if (clear) args.push("--clear");
    return runPython(args, 60_000);
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, durationMs = 300) {
    return runPython(
      ["swipe", String(x1), String(y1), String(x2), String(y2), "--duration-ms", String(durationMs)],
      60_000
    );
  }

  // ---- NEW: ui dump / tap / type (a11y index based) ----
  async uiDump(onlyClickable = true) {
    const args = ["ui_dump"];
    if (onlyClickable) args.push("--only-clickable");
    return runPython(args, 30_000);
  }

  async uiTap(index: number) {
    return runPython(["ui_tap", String(index)], 30_000);
  }

  async uiType(index: number, text: string, clear = false) {
    const args = ["ui_type", String(index), text];
    if (clear) args.push("--clear");
    return runPython(args, 60_000);
  }
}