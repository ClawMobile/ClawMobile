import fs from "fs";
import path from "path";
import { adb_devices, selectPreferredAdbDevice } from "../backends/adb";

export type MobileStage =
  | "unavailable"
  | "termux"
  | "termux_api"
  | "adb_shell"
  | "shizuku_shell"
  | "root";

export type MobileCapabilityName =
  | "local_shell"
  | "local_ocr"
  | "termux_api"
  | "phone_notify"
  | "clipboard"
  | "battery_status"
  | "ui_observe"
  | "ui_input"
  | "android_shell"
  | "screenshot"
  | "ocr"
  | "screen_ocr";

export type MobileCapabilities = {
  local_shell: boolean;
  local_ocr: boolean;
  termux_api: boolean;
  phone_notify: boolean;
  clipboard: boolean;
  battery_status: boolean;
  ui_observe: boolean;
  ui_input: boolean;
  android_shell: boolean;
  screenshot: boolean;
  ocr: boolean;
  screen_ocr: boolean;
};

type CommandMap = Record<string, boolean>;

const TERMUX_API_COMMANDS = [
  "termux-notification",
  "termux-vibrate",
  "termux-toast",
  "termux-tts-speak",
  "termux-clipboard-get",
  "termux-clipboard-set",
  "termux-battery-status",
];

function termuxBin() {
  return process.env.CLAW_MOBILE_TERMUX_BIN || "/data/data/com.termux/files/usr/bin";
}

function pathExists(p: string) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function resolveCommand(cmd: string) {
  const candidates = [
    path.join(termuxBin(), cmd),
    ...String(process.env.PATH || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, cmd)),
  ];
  return candidates.find(pathExists) || "";
}

export function getTermuxShellPath() {
  const preferred =
    process.env.CLAW_MOBILE_TERMUX_SHELL ||
    path.join(termuxBin(), "bash");
  const fallback = path.join(termuxBin(), "sh");
  return pathExists(preferred) ? preferred : pathExists(fallback) ? fallback : "";
}

function detectTermuxApiCommands() {
  const commands: CommandMap = {};
  for (const cmd of TERMUX_API_COMMANDS) {
    commands[cmd] = Boolean(resolveCommand(cmd));
  }
  return commands;
}

function detectAdbState(adb: any) {
  if (!adb.ok) {
    const stderr = String(adb.stderr || "");
    if (/not found|ENOENT/i.test(stderr)) return "missing";
    return "error";
  }

  const devices = Array.isArray(adb.devices) ? adb.devices : [];
  if (devices.some((d: any) => d.state === "device")) return "ready";
  if (devices.some((d: any) => d.state === "unauthorized")) return "unauthorized";
  if (devices.some((d: any) => d.state === "offline")) return "offline";
  if (devices.length > 0) return "no_ready_device";
  return "no_device";
}

function stageFor(input: {
  termuxReady: boolean;
  termuxApiReady: boolean;
  adbReady: boolean;
  shizukuReady: boolean;
  rootReady: boolean;
}): MobileStage {
  if (input.rootReady) return "root";
  if (input.shizukuReady) return "shizuku_shell";
  if (input.adbReady) return "adb_shell";
  if (input.termuxApiReady) return "termux_api";
  if (input.termuxReady) return "termux";
  return "unavailable";
}

export async function detectMobileCapabilities() {
  const shellPath = getTermuxShellPath();
  const termuxReady = Boolean(shellPath);
  const termuxApiCommands = detectTermuxApiCommands();
  const termuxApiReady = Object.values(termuxApiCommands).some(Boolean);

  const adb = await adb_devices();
  const adbState = detectAdbState(adb);
  const adbReady = adbState === "ready";
  const selectedAdbDevice = adbReady
    ? selectPreferredAdbDevice(adb.devices || [])
    : null;

  const rishPath = resolveCommand("rish");
  const shizukuReady = false;
  const suPath = resolveCommand("su");
  const rootReady = false;
  const tesseractPath = resolveCommand("tesseract");

  const capabilities: MobileCapabilities = {
    local_shell: termuxReady,
    local_ocr: Boolean(tesseractPath),
    termux_api: termuxApiReady,
    phone_notify: Boolean(
      termuxApiCommands["termux-toast"] ||
      termuxApiCommands["termux-notification"] ||
      termuxApiCommands["termux-vibrate"]
    ),
    clipboard: Boolean(
      termuxApiCommands["termux-clipboard-get"] &&
      termuxApiCommands["termux-clipboard-set"]
    ),
    battery_status: Boolean(termuxApiCommands["termux-battery-status"]),
    ui_observe: adbReady || shizukuReady || rootReady,
    ui_input: adbReady || shizukuReady || rootReady,
    android_shell: adbReady || shizukuReady || rootReady,
    screenshot: adbReady || shizukuReady || rootReady,
    ocr: Boolean(tesseractPath),
    screen_ocr: Boolean(tesseractPath) && (adbReady || shizukuReady || rootReady),
  };

  const stage = stageFor({
    termuxReady,
    termuxApiReady,
    adbReady,
    shizukuReady,
    rootReady,
  });

  return {
    ok: stage !== "unavailable",
    mode: "termux_capability_aware",
    stage,
    capabilities,
    backends: {
      termux: {
        ready: termuxReady,
        prefix: process.env.PREFIX || "",
        termuxBin: termuxBin(),
        shell: shellPath,
      },
      termuxApi: {
        ready: termuxApiReady,
        commands: termuxApiCommands,
      },
      adb: {
        ready: adbReady,
        state: adbState,
        selectedSerial: adb.selectedSerial || selectedAdbDevice?.serial || "",
        devices: adb.devices || [],
        stderr: adb.stderr || "",
      },
      shizuku: {
        ready: shizukuReady,
        state: rishPath ? "rish_installed_unverified" : "missing",
        rishPath,
      },
      root: {
        ready: rootReady,
        state: suPath ? "su_installed_unverified" : "missing",
        suPath,
      },
      ocr: {
        ready: Boolean(tesseractPath),
        engine: tesseractPath ? "tesseract" : "",
        path: tesseractPath,
        defaultLang: process.env.CLAW_MOBILE_OCR_LANG || "eng",
      },
    },
  };
}

export function capabilityUnavailable(
  capability: MobileCapabilityName,
  detected: Awaited<ReturnType<typeof detectMobileCapabilities>>,
  message?: string
) {
  const reason =
    message ||
    `Capability '${capability}' is not available in the current Termux runtime permission stage.`;
  return {
    ok: false,
    code: -1,
    stdout: "",
    stderr: reason,
    error: "capability_unavailable",
    capability,
    stage: detected.stage,
    message: reason,
    capabilities: detected.capabilities,
    backends: detected.backends,
  };
}
