import fs from "fs";
import net from "net";
import path from "path";
import { spawn } from "child_process";
import { ensureLogsDir } from "../tools/workspace";
import type { GatewayStatus, RuntimeCommandResponse, RuntimeLogResponse } from "./types";

const DEFAULT_GATEWAY_HOST = "127.0.0.1";
const DEFAULT_GATEWAY_PORT = 18789;
const DEFAULT_RUNTIME_START_WAIT_MS = 90_000;
const DEFAULT_RUNTIME_STOP_WAIT_MS = 10_000;
const GATEWAY_LOG_FILE = "companion-openclaw-gateway.log";
const GATEWAY_PID_FILE = "companion-openclaw-gateway.pid";
let startInFlight: { startedAt: number; logPath: string } | null = null;

export function gatewayHost() {
  return process.env.CLAWMOBILE_GATEWAY_HOST || DEFAULT_GATEWAY_HOST;
}

export function gatewayPort() {
  const raw = process.env.CLAWMOBILE_GATEWAY_PORT || process.env.GATEWAY_PORT || "";
  const port = Number.parseInt(raw, 10);
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_GATEWAY_PORT;
}

export async function getGatewayStatus(timeoutMs = 500): Promise<GatewayStatus> {
  const host = gatewayHost();
  const port = gatewayPort();

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (reachable: boolean, message: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ host, port, reachable, message });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, `OpenClaw gateway is reachable at ${host}:${port}.`));
    socket.once("timeout", () => finish(false, `OpenClaw gateway timed out at ${host}:${port}.`));
    socket.once("error", (error) => finish(false, `OpenClaw gateway is not reachable: ${error.message}`));
  });
}

export async function startRuntime(): Promise<RuntimeCommandResponse> {
  const before = await getGatewayStatus();
  if (before.reachable) {
    return {
      success: true,
      state: "running",
      message: "OpenClaw gateway is already running.",
      gateway: before,
    };
  }

  if (startInFlight) {
    return {
      success: false,
      state: "not_started",
      message: `OpenClaw gateway start is already in progress. Logs: ${startInFlight.logPath}`,
      gateway: before,
    };
  }

  const configuredCommand = process.env.CLAWMOBILE_RUNTIME_START_COMMAND || "";
  const command = configuredCommand || "clawmobile";
  const args = process.env.CLAWMOBILE_RUNTIME_START_ARGS
    ? process.env.CLAWMOBILE_RUNTIME_START_ARGS.split(/\s+/).filter(Boolean)
    : configuredCommand
      ? []
      : ["run"];

  try {
    const logPath = gatewayLogPath();
    let out: number | null = null;
    try {
      fs.writeFileSync(logPath, `--- OpenClaw gateway start ${new Date().toISOString()} ---\n`);
      out = fs.openSync(logPath, "a");
      const child = spawn(command, args, {
        detached: true,
        stdio: ["ignore", out, out],
        env: process.env,
      });
      if (child.pid) {
        fs.writeFileSync(gatewayPidPath(), `${child.pid}\n`);
      }
      startInFlight = { startedAt: Date.now(), logPath };
      child.once("exit", () => {
        startInFlight = null;
      });
      child.once("error", () => {
        startInFlight = null;
      });
      child.unref();
    } finally {
      if (out !== null) fs.closeSync(out);
    }

    const deadline = Date.now() + runtimeStartWaitMs();
    while (Date.now() < deadline) {
      await delay(500);
      const status = await getGatewayStatus();
      if (status.reachable) {
        startInFlight = null;
        return {
          success: true,
          state: "running",
          message: `Started OpenClaw gateway. Logs: ${logPath}`,
          gateway: status,
        };
      }
    }

    const after = await getGatewayStatus();
    cleanupGatewayPidFile();
    return {
      success: false,
      state: "not_started",
      message: `OpenClaw gateway start was requested but is not reachable yet. Logs: ${logPath}`,
      gateway: after,
    };
  } catch (error: any) {
    const after = await getGatewayStatus();
    cleanupGatewayPidFile();
    return {
      success: false,
      state: "failed",
      message: `Unable to start OpenClaw gateway: ${error?.message || error}`,
      gateway: after,
    };
  }
}

export function getRuntimeLog(maxBytes = 64 * 1024): RuntimeLogResponse {
  const logPath = gatewayLogPath();
  if (!fs.existsSync(logPath)) {
    return {
      success: false,
      message: "Gateway log is not available yet. Start Runtime to create it.",
      path: logPath,
      text: "",
      exists: false,
      size: 0,
      truncated: false,
    };
  }

  const stat = fs.statSync(logPath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(logPath, "r");
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }

  return {
    success: true,
    message: start > 0 ? `Showing last ${length} bytes of gateway log.` : "Gateway log loaded.",
    path: logPath,
    text: buffer.toString("utf8"),
    exists: true,
    size: stat.size,
    truncated: start > 0,
    updatedAt: stat.mtimeMs,
  };
}

export async function stopRuntime(): Promise<RuntimeCommandResponse> {
  const before = await getGatewayStatus();
  if (!before.reachable) {
    cleanupGatewayPidFile();
    return {
      success: true,
      state: "not_started",
      message: "OpenClaw gateway is already stopped.",
      gateway: before,
    };
  }

  try {
    await stopGatewayProcess();
    const after = await waitForGatewayStopped();
    if (!after.reachable) cleanupGatewayPidFile();
    return {
      success: !after.reachable,
      state: after.reachable ? "running" : "not_started",
      message: after.reachable ? "Stop command ran, but OpenClaw gateway is still reachable." : "OpenClaw gateway stopped.",
      gateway: after,
    };
  } catch (error: any) {
    const after = await getGatewayStatus();
    return {
      success: false,
      state: after.reachable ? "running" : "failed",
      message: `Unable to stop OpenClaw gateway: ${error?.message || error}`,
      gateway: after,
    };
  }
}

export async function restartRuntime(): Promise<RuntimeCommandResponse> {
  const stopped = await stopRuntime();
  if (!stopped.success) {
    return {
      success: false,
      state: stopped.state,
      message: `Unable to restart runtime: ${stopped.message}`,
      gateway: stopped.gateway,
    };
  }

  const started = await startRuntime();
  return {
    ...started,
    message: started.success
      ? `Restarted OpenClaw gateway. ${started.message}`
      : `Gateway stopped, but restart failed: ${started.message}`,
  };
}

async function stopGatewayProcess() {
  const command = process.env.CLAWMOBILE_RUNTIME_STOP_COMMAND || "";
  if (command) {
    await runCommand(command, []);
    return;
  }

  const pid = readGatewayPid();
  const candidates = await listGatewayProcessCandidates();
  const targets = selectGatewayStopTargets(candidates, pid);
  for (const candidate of targets) {
    killPidBestEffort(candidate.pid, "SIGTERM");
  }

  await delay(750);
  const stillReachable = await getGatewayStatus(300);
  if (!stillReachable.reachable) return;

  const remaining = selectGatewayStopTargets(await listGatewayProcessCandidates(), pid);
  for (const candidate of remaining) {
    killPidBestEffort(candidate.pid, "SIGKILL");
  }
}

async function waitForGatewayStopped() {
  const deadline = Date.now() + runtimeStopWaitMs();
  let status = await getGatewayStatus();
  while (status.reachable && Date.now() < deadline) {
    await delay(500);
    status = await getGatewayStatus();
  }
  return status;
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", env: process.env });
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
    child.once("error", reject);
  });
}

type ProcessCandidate = {
  pid: number;
  ppid: number;
  command: string;
};

async function listGatewayProcessCandidates(): Promise<ProcessCandidate[]> {
  const output = await captureCommand("ps", ["-ef"]).catch(() => "");
  return output
    .split(/\r?\n/)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 8) return null;
      const pid = Number.parseInt(parts[1] || "", 10);
      const ppid = Number.parseInt(parts[2] || "", 10);
      const command = parts.slice(7).join(" ");
      if (!Number.isFinite(pid) || !Number.isFinite(ppid)) return null;
      if (!isGatewayRuntimeCommand(command)) return null;
      if (command.includes("companion/server.js")) return null;
      return { pid, ppid, command };
    })
    .filter((candidate): candidate is ProcessCandidate => candidate != null);
}

function selectGatewayStopTargets(candidates: ProcessCandidate[], recordedPid: number | null) {
  const selected = new Map<number, ProcessCandidate>();
  for (const candidate of candidates) {
    const launchedByCompanion = candidate.ppid === process.pid;
    const isRecordedProcess = recordedPid != null && candidate.pid === recordedPid;
    const isRecordedChild = recordedPid != null && candidate.ppid === recordedPid;
    if (launchedByCompanion || isRecordedProcess || isRecordedChild) {
      selected.set(candidate.pid, candidate);
    }
  }
  return [...selected.values()];
}

function isGatewayRuntimeCommand(command: string) {
  return (
    /\bopenclaw\b.*\bgateway\b/.test(command) ||
    /(clawmobile|openclaw|mobile-ui).*\brun\b/.test(command) ||
    /\brun\b.*(clawmobile|openclaw|mobile-ui)/.test(command)
  );
}

function captureCommand(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.once("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(err || `${command} exited ${code}`))));
    child.once("error", reject);
  });
}

function killPidBestEffort(pid: number, signal: NodeJS.Signals) {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return;
  try {
    process.kill(pid, signal);
  } catch {
    // Best effort. The process may have already exited.
  }
}

function readGatewayPid() {
  try {
    const raw = fs.readFileSync(gatewayPidPath(), "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function cleanupGatewayPidFile() {
  try {
    fs.unlinkSync(gatewayPidPath());
  } catch {
    // Nothing to clean.
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runtimeStartWaitMs() {
  const raw = Number.parseInt(process.env.CLAWMOBILE_RUNTIME_START_WAIT_MS || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RUNTIME_START_WAIT_MS;
}

function runtimeStopWaitMs() {
  const raw = Number.parseInt(process.env.CLAWMOBILE_RUNTIME_STOP_WAIT_MS || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RUNTIME_STOP_WAIT_MS;
}

function gatewayLogPath() {
  return path.join(ensureLogsDir(), GATEWAY_LOG_FILE);
}

function gatewayPidPath() {
  return path.join(ensureLogsDir(), GATEWAY_PID_FILE);
}
