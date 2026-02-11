import { spawn } from "child_process";
import { runTermuxCommand, tx_notify, tx_tts } from "../backends/termux";

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
  const ms = Math.max(1, Math.min(args?.ms ?? 250, 5000));
  const repeat = Math.max(1, Math.min(args?.repeat ?? 2, 5));
  const gapMs = Math.max(0, Math.min(args?.gapMs ?? 120, 2000));
  const tts = args?.tts ?? "Done";
  const title = args?.title ?? "Clawbot";
  const content = args?.content ?? "Task completed.";

  const details: any[] = [];
  const sleep = (n: number) => new Promise((r) => setTimeout(r, n));

  // 1) Try Termux vibrate (low-level hardware), if available
  let ok = true;
  for (let i = 0; i < repeat; i++) {
    const r = await runTermuxCommand("termux-vibrate", ["-d", String(ms), "-f"]);
    if (!r.ok) {
      ok = false;
      details.push({ step: "termux-vibrate", ok: false, err: r.stderr || r.stdout });
      break;
    }
    if (i < repeat - 1 && gapMs > 0) await sleep(gapMs);
  }
  if (ok) {
    details.push({ step: "termux-vibrate", ok: true, repeat, ms });
    return { ok: true, method: "termux-vibrate", details };
  }

  // 2) Notification via Termux
  const n = await tx_notify({ title, content });
  if (n.ok) {
    details.push({ step: "termux-notification", ok: true });
    return { ok: true, method: "termux-notification", details };
  }
  details.push({ step: "termux-notification", ok: false, err: n.stderr || n.stdout });

  // 3) TTS via Termux
  const t = await tx_tts({ text: tts });
  if (t.ok) {
    details.push({ step: "termux-tts-speak", ok: true });
    return { ok: true, method: "termux-tts-speak", details };
  }
  details.push({ step: "termux-tts-speak", ok: false, err: t.stderr || t.stdout });

  // 4) ADB notification fallback (best-effort)
  const a = await adb_notify({ title, content });
  if (a.ok) {
    details.push({ step: "adb-notification", ok: true });
    return { ok: true, method: "adb-notification", details };
  }
  details.push({ step: "adb-notification", ok: false, err: a.stderr || a.stdout });

  // Final fallback: return a safe response (no crash)
  return { ok: false, method: null, details };
}
