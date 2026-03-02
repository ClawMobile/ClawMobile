import { spawn } from "child_process";
import path from "path";

export type ExecResult = { ok: boolean; data?: any; error?: string; extra?: any };

function truncate(s: string, max = 2000) {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function buildEnv(py: string) {
  return {
    ...process.env,
    CLAW_MOBILE_PYTHON: py,
    DROIDRUN_SERIAL: process.env.DROIDRUN_SERIAL || "",
    DROIDRUN_PROVIDER: process.env.DROIDRUN_PROVIDER || "",
    DROIDRUN_MODEL: process.env.DROIDRUN_MODEL || "",
    DROIDRUN_USE_TCP: process.env.DROIDRUN_USE_TCP || "",
  };
}

function runPython(args: string[], timeoutMs = 30_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const script = path.resolve(__dirname, "..", "..", "pyexec", "android_exec.py");
    const PY = process.env.CLAW_MOBILE_PYTHON || "python3";

    const p = spawn(PY, [script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: buildEnv(PY),
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

    p.on("close", (code) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse((out || "").trim() || "{}");
        if (parsed && typeof parsed === "object" && err) {
          parsed.extra = { ...(parsed.extra || {}), stderr_snip: truncate(err) };
        }
        if (parsed && typeof parsed === "object") {
          parsed.extra = { ...(parsed.extra || {}), exit_code: code };
        }
        resolve(parsed);
      } catch {
        resolve({
          ok: false,
          error: "invalid_json",
          extra: { stdout: truncate(out), stderr: truncate(err), stderr_snip: truncate(err), exit_code: code },
        });
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
  async uiDump() {
    const args = ["ui_dump"];
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

  async uiFind(q: {
    textContains?: string;
    descContains?: string;
    resourceIdContains?: string;
    classContains?: string;
    clickableOnly?: boolean;
    enabledOnly?: boolean;
    preferClickable?: boolean;
    limit?: number;
  }) {
    const args: string[] = ["ui_find"];

    if (q?.textContains) args.push("--text-contains", q.textContains);
    if (q?.descContains) args.push("--desc-contains", q.descContains);
    if (q?.resourceIdContains) args.push("--resource-id-contains", q.resourceIdContains);
    if (q?.classContains) args.push("--class-contains", q.classContains);

    if (q?.clickableOnly) args.push("--clickable-only");
    if (q?.enabledOnly) args.push("--enabled-only");
    if (q?.preferClickable) args.push("--prefer-clickable");

    if (typeof q?.limit === "number") args.push("--limit", String(q.limit));

    return runPython(args, 30_000);
  }

  async uiTapFind(q: {
    textContains?: string;
    descContains?: string;
    resourceIdContains?: string;
    classContains?: string;
    clickableOnly?: boolean;
    enabledOnly?: boolean;
    limit?: number;
  }) {
    const args: string[] = ["ui_tap_find"];
    if (q?.textContains) args.push("--text-contains", q.textContains);
    if (q?.descContains) args.push("--desc-contains", q.descContains);
    if (q?.resourceIdContains) args.push("--resource-id-contains", q.resourceIdContains);
    if (q?.classContains) args.push("--class-contains", q.classContains);
    if (q?.clickableOnly) args.push("--clickable-only");
    if (q?.enabledOnly) args.push("--enabled-only");
    if (typeof q?.limit === "number") args.push("--limit", String(q.limit));
    return runPython(args, 30_000);
  }

  async uiTypeFind(q: {
    textContains?: string;
    descContains?: string;
    resourceIdContains?: string;
    classContains?: string;
    enabledOnly?: boolean;
    limit?: number;
    clear?: boolean;
    text: string;
  }) {
    const args: string[] = ["ui_type_find"];
    if (q?.textContains) args.push("--text-contains", q.textContains);
    if (q?.descContains) args.push("--desc-contains", q.descContains);
    if (q?.resourceIdContains) args.push("--resource-id-contains", q.resourceIdContains);
    if (q?.classContains) args.push("--class-contains", q.classContains);
    if (q?.enabledOnly) args.push("--enabled-only");
    if (typeof q?.limit === "number") args.push("--limit", String(q.limit));
    if (q?.clear) args.push("--clear");
    args.push(q.text ?? "");
    return runPython(args, 60_000);
  }
}
