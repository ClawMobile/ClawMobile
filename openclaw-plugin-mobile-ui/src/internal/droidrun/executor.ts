import { spawn } from "child_process";
import path from "path";
import { parseJsonFromStdout } from "./protocol";

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
      const exitCode = typeof code === "number" ? code : -1;
      const parsed = parseJsonFromStdout(out);

      if (parsed && typeof parsed === "object" && typeof parsed.ok === "boolean") {
        if (err) {
          parsed.extra = { ...(parsed.extra || {}), stderr_snip: truncate(err) };
        }
        parsed.extra = { ...(parsed.extra || {}), exit_code: exitCode };
        resolve(parsed);
        return;
      }

      if (!(out || "").trim()) {
        resolve({
          ok: false,
          error: "empty_output",
          extra: { stderr: truncate(err), stderr_snip: truncate(err), exit_code: exitCode },
        });
        return;
      }

      resolve({
        ok: false,
        error: exitCode === 0 ? "invalid_json" : "python_failed",
        extra: { stdout: truncate(out), stderr: truncate(err), stderr_snip: truncate(err), exit_code: exitCode },
      });
    });
  });
}

export class DroidrunExecutor {
  async health() {
    return runPython(["health"], 10_000);
  }
}
