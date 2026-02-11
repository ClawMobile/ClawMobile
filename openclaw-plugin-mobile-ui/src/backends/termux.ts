import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export type TermuxResult = { ok: boolean; code: number; stdout: string; stderr: string };

const DEFAULT_TIMEOUT_MS = 15_000;

const TERMUX_BIN = process.env.CLAW_MOBILE_TERMUX_BIN || "/data/data/com.termux/files/usr/bin";

function resolveTermuxCmd(cmd: string) {
  const p = path.join(TERMUX_BIN, cmd);
  if (fs.existsSync(p)) return p;
  return "";
}

export function runTermuxCommand(
  cmd: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<TermuxResult> {
  const resolved = resolveTermuxCmd(cmd);
  if (!resolved) {
    return Promise.resolve({
      ok: false,
      code: -1,
      stdout: "",
      stderr: `termux command not found: ${cmd} (install pkg termux-api + Termux:API app)`,
    });
  }

  return new Promise((resolve) => {
    const p = spawn(resolved, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
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
      resolve({ ok: false, code: -1, stdout, stderr: String(e?.message || e) });
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

export async function tx_notify(input: { title: string; content: string }) {
  return runTermuxCommand("termux-notification", [
    "--title",
    input?.title ?? "",
    "--content",
    input?.content ?? "",
  ]);
}

export async function tx_tts(input: { text: string }) {
  if (input?.text == null) return { ok: false, code: -1, stdout: "", stderr: "text is required" };
  return runTermuxCommand("termux-tts-speak", [String(input.text)], 30_000);
}

export async function tx_toast(input: { text: string }) {
  if (input?.text == null) return { ok: false, code: -1, stdout: "", stderr: "text is required" };
  return runTermuxCommand("termux-toast", [String(input.text)]);
}

export async function tx_clipboard_get() {
  return runTermuxCommand("termux-clipboard-get", []);
}

export async function tx_clipboard_set(input: { text: string }) {
  if (input?.text == null) return { ok: false, code: -1, stdout: "", stderr: "text is required" };
  return runTermuxCommand("termux-clipboard-set", [String(input.text)]);
}

export async function tx_battery_status() {
  const res = await runTermuxCommand("termux-battery-status", []);
  if (!res.ok) return res;
  try {
    return { ...res, data: JSON.parse(res.stdout) };
  } catch {
    return { ...res, data: null };
  }
}
