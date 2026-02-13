import { spawn } from "child_process";
import { runTermuxCommand, tx_toast } from "../backends/termux";

type AdbResult = { ok: boolean; code: number; stdout: string; stderr: string };

function runAdb(args: string[], timeoutMs = 10_000): Promise<AdbResult> {
  return new Promise((resolve) => {
    const p = spawn("adb", args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        p.kill("SIGKILL");
      } catch {}
      resolve({ ok: false, code: -1, stdout, stderr: stderr || "timeout" });
    }, timeoutMs);

    p.on("error", (e: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const msg = e?.code === "ENOENT" ? "adb not found in PATH" : String(e?.message || e);
      resolve({ ok: false, code: -1, stdout, stderr: msg });
    });

    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code: typeof code === "number" ? code : -1, stdout, stderr });
    });
  });
}

async function adb_notify(input: { title: string; content: string }) {
  const title = input?.title ?? "Clawbot";
  const content = input?.content ?? "Task completed.";
  return runAdb(["shell", "cmd", "notification", "post", "clawbot", title, content]);
}

export async function signalComplete(args?: {
  ms?: number;
  repeat?: number;
  gapMs?: number;
  tts?: string;
  title?: string;
  content?: string;
}) {
  const envMs = Number(process.env.CLAW_MOBILE_NOTIFY_VIBRATE_MS || 500);
  const ms = Math.max(1, Math.min(args?.ms ?? envMs, 5000));
  const title = args?.title ?? "Clawbot";
  const content = args?.content ?? "Task completed.";
  const toastEnabled = String(process.env.CLAW_MOBILE_NOTIFY_TOAST || "1").toLowerCase() !== "0";

  const details: any[] = [];

  // 1) Single Termux vibrate (low-level hardware)
  const v = await runTermuxCommand("termux-vibrate", ["-d", String(ms), "-f"]);
  if (v.ok) {
    details.push({ step: "termux-vibrate", ok: true, ms });
  } else {
    details.push({ step: "termux-vibrate", ok: false, err: v.stderr || v.stdout });
  }

  // 2) Toast via Termux (demo-stable visibility)
  if (toastEnabled) {
    const text = title ? `${title}: ${content}` : content;
    const t = await tx_toast({ text });
    if (t.ok) {
      details.push({ step: "termux-toast", ok: true });
    } else {
      details.push({ step: "termux-toast", ok: false, err: t.stderr || t.stdout });
    }
  }

  // 3) ADB notification fallback (best-effort)
  const a = await adb_notify({ title, content });
  if (a.ok) details.push({ step: "adb-notification", ok: true });
  else details.push({ step: "adb-notification", ok: false, err: a.stderr || a.stdout });

  // Final fallback: return a safe response (no crash)
  const ok = details.some((d) => d.ok);
  return { ok, method: ok ? "demo-signal" : null, details };
}
