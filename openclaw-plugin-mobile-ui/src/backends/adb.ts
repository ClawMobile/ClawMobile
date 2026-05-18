import { spawn } from "child_process";
import fs from "fs";
import { makeScreenshotPath, pngDimensions, truncateString, DEFAULT_MAX_OUTPUT_BYTES } from "../tools/workspace";

// Low-level ADB adapter used by the public plugin tools.
// These functions should stay device-generic; higher-level policy belongs in
// the composite `android_*` wrappers or in workspace-seeded skills.

export type AdbResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
};

export type AdbDevice = {
  serial: string;
  state: string;
  info: Record<string, string>;
  extra: string[];
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_SCREENSHOT_TIMEOUT_MS = 30_000;
const DEFAULT_TYPE_TIMEOUT_MS = 30_000;

let autoSelectedSerial = "";
let autoSelectedAtMs = 0;

function explicitAdbSerial() {
  const serial = process.env.DROIDRUN_SERIAL || process.env.ANDROID_SERIAL || "";
  return serial.trim();
}

function runAdbRaw(
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<AdbResult> {
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

export function parseAdbDevices(stdout: string) {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const devices: AdbDevice[] = [];

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

  return devices;
}

export function selectPreferredAdbDevice(devices: AdbDevice[]) {
  const ready = devices.filter((d) => d.state === "device");
  if (ready.length === 0) return null;
  return ready.find((d) => d.serial === "127.0.0.1:5555") || ready[0];
}

async function autoAdbSerial() {
  const explicit = explicitAdbSerial();
  if (explicit) return explicit;

  const now = Date.now();
  if (autoSelectedSerial && now - autoSelectedAtMs < 5000) return autoSelectedSerial;

  const res = await runAdbRaw(["devices", "-l"], 10_000);
  if (!res.ok) {
    autoSelectedSerial = "";
    autoSelectedAtMs = now;
    return "";
  }

  const selected = selectPreferredAdbDevice(parseAdbDevices(res.stdout));
  autoSelectedSerial = selected?.serial || "";
  autoSelectedAtMs = now;
  return autoSelectedSerial;
}

export async function buildAdbCommandArgs(args: string[]) {
  const serial = await autoAdbSerial();
  return serial ? ["-s", serial, ...args] : args;
}

async function runAdb(
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  options?: { useSerial?: boolean }
): Promise<AdbResult> {
  const adbArgs = options?.useSerial === false ? args : await buildAdbCommandArgs(args);
  return runAdbRaw(adbArgs, timeoutMs);
}

function encodeInputText(text: string) {
  return text.replace(/ /g, "%s");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function adb_devices() {
  const res = await runAdbRaw(["devices", "-l"], 10_000);
  if (!res.ok) return { ...res, devices: [], selectedSerial: "" };

  const devices = parseAdbDevices(res.stdout);
  const explicit = explicitAdbSerial();
  const selectedSerial = explicit || selectPreferredAdbDevice(devices)?.serial || "";
  if (selectedSerial && !explicit) {
    autoSelectedSerial = selectedSerial;
    autoSelectedAtMs = Date.now();
  }
  return { ...res, devices, selectedSerial };
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

function componentMatches(actual: string, expected: string) {
  const a = String(actual || "").trim();
  const e = String(expected || "").trim();
  if (!e) return true;
  if (!a) return false;
  return a === e || a.endsWith(`.${e}`) || a.endsWith(e.replace(/^\./, "."));
}

export async function adb_open_app(input: {
  package?: string;
  activity?: string;
  component?: string;
  waitMs?: number;
}) {
  const component = String(input?.component || "").trim();
  const parsed = component ? parseComponent(component) : null;
  const pkg = String(input?.package || parsed?.package || "").trim();
  const activity = normalizeActivityName(pkg, String(input?.activity || parsed?.activity || "").trim());
  const waitMs = Math.min(Math.max(Math.round(Number(input?.waitMs ?? 1200)), 0), 10_000);

  if (!pkg) {
    return { ok: false, code: -1, stdout: "", stderr: "package or component is required" };
  }

  const targetComponent = activity ? `${pkg}/${activity}` : "";
  let launchMethod = targetComponent ? "am_start_component" : "monkey_package";
  let launchRes = targetComponent
    ? await runAdb(["shell", "am", "start", "-W", "-n", targetComponent], 30_000)
    : await runAdb(["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"], 30_000);
  if (!launchRes.ok && targetComponent) {
    const fallbackRes = await runAdb(["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"], 30_000);
    launchMethod = "monkey_package_after_component_failed";
    launchRes = {
      ...fallbackRes,
      stdout: `${launchRes.stdout}\n${fallbackRes.stdout}`.trim(),
      stderr: `${launchRes.stderr}\n${fallbackRes.stderr}`.trim(),
    };
  }

  if (waitMs > 0) await wait(waitMs);
  const current = await adb_current_app();
  const currentPackage = String((current as any)?.package || "");
  const currentActivity = String((current as any)?.activity || "");
  const packageOk = currentPackage === pkg;
  const activityOk = componentMatches(currentActivity, activity);

  return {
    ok: launchRes.ok && packageOk && activityOk,
    code: launchRes.code,
    stdout: truncateString(launchRes.stdout, 2000),
    stderr: truncateString(launchRes.stderr, 1000),
    launch_method: launchMethod,
    package: pkg,
    activity,
    component: targetComponent,
    wait_ms: waitMs,
    current,
    verification: {
      package_ok: packageOk,
      activity_ok: activityOk,
    },
    error: launchRes.ok
      ? packageOk && activityOk
        ? undefined
        : packageOk
          ? "activity_mismatch_after_open_app"
          : "package_mismatch_after_open_app"
      : "open_app_command_failed",
  };
}

export async function adb_ui_dump_xml(input: { compressed?: boolean; maxOutputBytes?: number }) {
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

  const maxOutputBytes = input?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const xml = maxOutputBytes > 0 ? truncateString(catRes.stdout, maxOutputBytes) : catRes.stdout;
  return { ...catRes, xml };
}

function normalizeActivityName(pkg: string, activity: string) {
  const trimmed = String(activity || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith(".")) return `${pkg}${trimmed}`;
  return trimmed;
}

function parseComponent(component: string) {
  const cleaned = String(component || "")
    .trim()
    .replace(/[)}\]]+$/g, "");
  const match = cleaned.match(/^([A-Za-z0-9_.]+)\/([A-Za-z0-9_.$]+)$/);
  if (!match) return null;
  const pkg = match[1];
  const activity = normalizeActivityName(pkg, match[2]);
  return { package: pkg, activity, component: `${pkg}/${activity}` };
}

export function parseForegroundApp(text: string) {
  const raw = String(text || "");
  const patterns = [
    /mCurrentFocus=[^\n]*?\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/,
    /mFocusedApp=[^\n]*?\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/,
    /topResumedActivity=[^\n]*?\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/,
    /ResumedActivity:[^\n]*?\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/,
    /ACTIVITY\s+([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const parsed = match ? parseComponent(match[1]) : null;
    if (parsed) return parsed;
  }

  return null;
}

export async function adb_current_app() {
  const windowRes = await runAdb(["shell", "dumpsys", "window"], 15_000);
  const windowParsed = parseForegroundApp(`${windowRes.stdout}\n${windowRes.stderr}`);
  if (windowParsed) {
    return {
      ok: true,
      code: windowRes.code,
      stdout: truncateString(windowRes.stdout, 2000),
      stderr: truncateString(windowRes.stderr, 1000),
      source: "dumpsys window",
      ...windowParsed,
    };
  }

  const activityRes = await runAdb(["shell", "dumpsys", "activity", "top"], 15_000);
  const activityParsed = parseForegroundApp(`${activityRes.stdout}\n${activityRes.stderr}`);
  if (activityParsed) {
    return {
      ok: true,
      code: activityRes.code,
      stdout: truncateString(activityRes.stdout, 2000),
      stderr: truncateString(activityRes.stderr, 1000),
      source: "dumpsys activity top",
      ...activityParsed,
    };
  }

  return {
    ok: false,
    code: activityRes.code || windowRes.code || -1,
    stdout: truncateString(`${windowRes.stdout}\n${activityRes.stdout}`, 2000),
    stderr: truncateString(`${windowRes.stderr}\n${activityRes.stderr}`.trim() || "unable to parse foreground app", 1000),
    source: "dumpsys window/activity top",
    package: "",
    activity: "",
    component: "",
  };
}

export async function adb_screenshot(input?: { timeoutMs?: number }): Promise<any> {
  const adbArgs = await buildAdbCommandArgs(["exec-out", "screencap", "-p"]);
  return await new Promise((resolve) => {
    const p = spawn("adb", adbArgs, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    let stderr = "";
    let done = false;
    const timeoutMs = input?.timeoutMs ?? DEFAULT_SCREENSHOT_TIMEOUT_MS;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        p.kill("SIGKILL");
      } catch {}
      resolve({ ok: false, path: "", bytes: 0, width: 0, height: 0, stderr: stderr || "timeout" });
    }, timeoutMs);

    p.on("error", (e: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const msg = e?.code === "ENOENT" ? "adb not found in PATH" : String(e?.message || e);
      console.warn(`[adb_screenshot] ${msg}`);
      resolve({ ok: false, path: "", bytes: 0, width: 0, height: 0, stderr: msg });
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
        const msg = String(e?.message || e || "write failed");
        console.warn(`[adb_screenshot] write failed: ${msg}`);
        resolve({ ok: false, path: "", bytes: 0, width: 0, height: 0, stderr: msg });
        return;
      }
      const dims = pngDimensions(buf);
      if (code !== 0) {
        console.warn(`[adb_screenshot] adb exited with code ${code}: ${stderr}`);
        resolve({ ok: false, path: "", bytes: 0, width: 0, height: 0, stderr });
        return;
      }
      resolve({ ok: true, path: outPath, bytes: buf.length, width: dims.width, height: dims.height });
    });
  });
}

export async function adb_tap(input: { x: number; y: number; timeoutMs?: number }) {
  return runAdb(["shell", "input", "tap", String(input.x), String(input.y)], input?.timeoutMs);
}

export async function adb_type(input: { text: string; timeoutMs?: number }) {
  if (input?.text == null) return { ok: false, code: -1, stdout: "", stderr: "text is required" };
  const text = encodeInputText(String(input.text));
  return runAdb(["shell", "input", "text", text], input?.timeoutMs ?? DEFAULT_TYPE_TIMEOUT_MS);
}

export async function adb_swipe(input: { x1: number; y1: number; x2: number; y2: number; durationMs?: number; timeoutMs?: number }) {
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
  ], input?.timeoutMs);
}
