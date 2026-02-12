import { spawn } from "child_process";
import path from "path";

type ExecResult = { ok: boolean; data?: any; error?: string; extra?: any };

function buildEnv(py: string) {
  return {
    ...process.env,
    CLAW_MOBILE_PYTHON: py,
    DROIDRUN_SERIAL: process.env.DROIDRUN_SERIAL || "",
    DROIDRUN_PROVIDER: process.env.DROIDRUN_PROVIDER || "",
    DROIDRUN_MODEL: process.env.DROIDRUN_MODEL || "",
    DROIDRUN_USE_TCP: process.env.DROIDRUN_USE_TCP || "",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "",
  };
}

function runPython(args: string[], timeoutMs = 120_000): Promise<ExecResult> {
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
        if (parsed && typeof parsed === "object") {
          parsed.extra = { ...(parsed.extra || {}), exit_code: code };
        }
        resolve(parsed);
      } catch {
        resolve({ ok: false, error: "invalid_json", extra: { stdout: out, stderr: err, exit_code: code } });
      }
    });
  });
}

export class DroidrunAgent {
  async runTask(input: {
    goal: string;
    steps?: number;
    timeout?: number;
    deviceSerial?: string;
    tcp?: boolean;
  }) {
    const args: string[] = ["agent_task", input.goal];

    if (typeof input.steps === "number") args.push("--steps", String(input.steps));
    if (typeof input.timeout === "number") args.push("--timeout", String(input.timeout));
    if (input.deviceSerial) args.push("--device-serial", input.deviceSerial);
    if (input.tcp) args.push("--tcp");

    // agent may take longer than executor actions
    const envDefaultS = Number(process.env.CLAW_MOBILE_AGENT_TIMEOUT_S || 600);
    const defaultS = Number.isFinite(envDefaultS) && envDefaultS > 0 ? envDefaultS : 600;
    const maxS = 1800;
    const requestedS = typeof input.timeout === "number" ? input.timeout : defaultS;
    const clampedS = Math.min(Math.max(requestedS, 1), maxS);

    // Pass to python in seconds
    args.push("--timeout", String(clampedS));

    // Node-side timeout should exceed python timeout by 10s
    const timeoutMs = clampedS * 1000 + 10_000;
    return runPython(args, timeoutMs);
  }
}
