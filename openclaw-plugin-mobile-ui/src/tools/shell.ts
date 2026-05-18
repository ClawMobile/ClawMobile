import { spawn } from "child_process";
import { buildAdbCommandArgs } from "../backends/adb";
import {
  capabilityUnavailable,
  detectMobileCapabilities,
  getTermuxShellPath,
} from "../runtime/mobileCapabilities";

export type ShellBackend = "adb" | "termux" | "bash";

export type ShellResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 8 * 1024;

const DENYLIST: RegExp[] = [
  /(^|\s)rm\s+-rf(\s|$)/i,
  /(^|\s)mkfs(\.|\s|$)/i,
  /(^|\s)dd(\s|$)/i,
  /(^|\s)shutdown(\s|$)/i,
  /(^|\s)reboot(\s|$)/i,
  /(^|\s)poweroff(\s|$)/i,
  /(^|\s)halt(\s|$)/i,
  /(^|\s)init\s+0(\s|$)/i,
  /(^|\s)wipefs(\s|$)/i,
  /(^|\s)fdisk(\s|$)/i,
  /(^|\s)parted(\s|$)/i,
];

function truncate(text: string, maxBytes = MAX_OUTPUT_BYTES) {
  if (text.length <= maxBytes) return text;
  return text.slice(0, maxBytes) + `\n...truncated ${text.length - maxBytes} bytes`;
}

function denied(cmd: string) {
  return DENYLIST.some((re) => re.test(cmd));
}

async function runWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<ShellResult> {
  return await new Promise((resolve) => {
    const p = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        p.kill("SIGKILL");
      } catch {}
      resolve({
        ok: false,
        code: -1,
        stdout: truncate(stdout),
        stderr: truncate(stderr || "timeout"),
      });
    }, timeoutMs);

    p.on("error", (e: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: -1,
        stdout: truncate(stdout),
        stderr: truncate(String(e?.message || e || "spawn failed")),
      });
    });

    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code: typeof code === "number" ? code : -1,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
      });
    });
  });
}

export async function android_shell(input: {
  backend: ShellBackend;
  cmd: string;
  timeoutMs?: number;
}) {
  const backend = input?.backend;
  const cmd = input?.cmd ?? "";
  const timeoutMs = input?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!backend || !cmd) {
    return { ok: false, code: -1, stdout: "", stderr: "backend and cmd are required" };
  }

  if (denied(cmd)) {
    return { ok: false, code: -1, stdout: "", stderr: "command blocked by safety denylist" };
  }

  if (
    backend === "bash" &&
    (process.env.CLAW_MOBILE_ADB_ONLY === "1" || process.env.CLAWMOBILE_LITE === "1")
  ) {
    return {
      ok: false,
      code: -1,
      stdout: "",
      stderr: "bash backend is disabled in ClawMobile Lite; use backend=adb or backend=termux",
    };
  }

  if (backend === "adb") {
    if (process.env.CLAW_MOBILE_ADB_ONLY === "1" || process.env.CLAWMOBILE_LITE === "1") {
      const detected = await detectMobileCapabilities();
      if (!detected.capabilities.android_shell) {
        return capabilityUnavailable(
          "android_shell",
          detected,
          "ADB shell commands require a ready ADB/shell-level backend. Termux-only Lite can use backend=termux."
        );
      }
    }

    const adbArgs = await buildAdbCommandArgs(["shell", cmd]);
    return await runWithTimeout("adb", adbArgs, timeoutMs);
  }

  if (backend === "termux") {
    const termuxShell = getTermuxShellPath();

    if (!termuxShell) {
      return {
        ok: false,
        code: -1,
        stdout: "",
        stderr: "termux shell not found (install pkg termux-api and ensure Termux paths are visible)",
      };
    }

    return await runWithTimeout(termuxShell, ["-lc", cmd], timeoutMs);
  }

  return await runWithTimeout("bash", ["-lc", cmd], timeoutMs);
}
