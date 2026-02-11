import { spawn } from "child_process";
import fs from "fs";
import { makeScreenshotPath, pngDimensions, truncateString, DEFAULT_MAX_OUTPUT_BYTES } from "../tools/workspace";

export type AdbResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
};

const DEFAULT_TIMEOUT_MS = 20_000;

function runAdb(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<AdbResult> {
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

function encodeInputText(text: string) {
  return text.replace(/ /g, "%s");
}

export async function adb_devices() {
  const res = await runAdb(["devices", "-l"], 10_000);
  if (!res.ok) return { ...res, devices: [] };

  const lines = res.stdout.split(/\r?\n/).filter(Boolean);
  const devices: Array<{ serial: string; state: string; info: Record<string, string>; extra: string[] }> = [];

  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const [serial, state, ...rest] = parts;
    const info: Record<string, string> = {};
    const extra: string[] = [];
    for (const token of rest) {
      const idx = token.indexOf(":");
      if (idx > 0) {
        info[token.slice(0, idx)] = token.slice(idx + 1);
      } else {
        extra.push(token);
      }
    }
    devices.push({ serial, state, info, extra });
  }

  return { ...res, devices };
}

export async function adb_keyevent(input: { key?: "HOME" | "BACK" | "RECENTS" | "ENTER"; keycode?: number }) {
  if (typeof input?.keycode === "number") {
    return runAdb(["shell", "input", "keyevent", String(input.keycode)]);
  }

  const key = input?.key;
  const map: Record<string, string> = {
    HOME: "KEYCODE_HOME",
    BACK: "KEYCODE_BACK",
    RECENTS: "KEYCODE_APP_SWITCH",
    ENTER: "KEYCODE_ENTER",
  };
  const code = key ? map[key] : "";
  if (!code) {
    return { ok: false, code: -1, stdout: "", stderr: "key or keycode is required" };
  }
  return runAdb(["shell", "input", "keyevent", code]);
}

export async function adb_ui_dump_xml(input: { compressed?: boolean }) {
  const dumpPath = "/sdcard/uidump.xml";
  const baseArgs = ["shell", "uiautomator", "dump"] as string[];
  if (input?.compressed) baseArgs.push("--compressed");
  baseArgs.push(dumpPath);

  let dumpRes = await runAdb(baseArgs, 25_000);
  if (!dumpRes.ok && input?.compressed) {
    const combined = `${dumpRes.stdout}\n${dumpRes.stderr}`;
    if (/unknown|unsupported|invalid/i.test(combined)) {
      dumpRes = await runAdb(["shell", "uiautomator", "dump", dumpPath], 25_000);
    }
  }
  if (!dumpRes.ok) return { ...dumpRes, xml: "" };

  const catRes = await runAdb(["shell", "cat", dumpPath], 25_000);
  if (!catRes.ok) return { ...catRes, xml: "" };

  return { ...catRes, xml: truncateString(catRes.stdout, DEFAULT_MAX_OUTPUT_BYTES) };
}

export async function adb_screenshot() {
  return await new Promise((resolve) => {
    const p = spawn("adb", ["exec-out", "screencap", "-p"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    let stderr = "";
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        p.kill("SIGKILL");
      } catch {}
      resolve({ ok: false, path: "", bytes: 0, width: 0, height: 0 });
    }, 30_000);

    p.on("error", (e: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const msg = e?.code === "ENOENT" ? "adb not found in PATH" : String(e?.message || e);
      console.warn(`[adb_screenshot] ${msg}`);
      resolve({ ok: false, path: "", bytes: 0, width: 0, height: 0 });
    });

    p.stdout.on("data", (d) => chunks.push(Buffer.from(d)));
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      const outPath = makeScreenshotPath();
      try {
        fs.writeFileSync(outPath, buf);
      } catch (e: any) {
        console.warn(`[adb_screenshot] write failed: ${String(e?.message || e || "write failed")}`);
        resolve({ ok: false, path: "", bytes: 0, width: 0, height: 0 });
        return;
      }
      const dims = pngDimensions(buf);
      if (code !== 0) {
        console.warn(`[adb_screenshot] adb exited with code ${code}: ${stderr}`);
        resolve({ ok: false, path: "", bytes: 0, width: 0, height: 0 });
        return;
      }
      resolve({ ok: true, path: outPath, bytes: buf.length, width: dims.width, height: dims.height });
    });
  });
}

export async function adb_tap(input: { x: number; y: number }) {
  return runAdb(["shell", "input", "tap", String(input.x), String(input.y)]);
}

export async function adb_type(input: { text: string }) {
  if (input?.text == null) return { ok: false, code: -1, stdout: "", stderr: "text is required" };
  const text = encodeInputText(String(input.text));
  return runAdb(["shell", "input", "text", text], 30_000);
}

export async function adb_swipe(input: { x1: number; y1: number; x2: number; y2: number; durationMs?: number }) {
  const duration = typeof input?.durationMs === "number" ? String(input.durationMs) : "300";
  return runAdb([
    "shell",
    "input",
    "swipe",
    String(input.x1),
    String(input.y1),
    String(input.x2),
    String(input.y2),
    duration,
  ]);
}

export async function adb_app_start(input: { package: string; activity?: string }) {
  const pkg = input?.package;
  if (!pkg) return { ok: false, code: -1, stdout: "", stderr: "package is required" };

  if (input?.activity) {
    return runAdb(["shell", "am", "start", "-n", `${pkg}/${input.activity}`], 30_000);
  }

  return runAdb(["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"], 30_000);
}
