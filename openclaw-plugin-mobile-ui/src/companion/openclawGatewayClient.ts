import fs from "fs";
import net from "net";
import path from "path";
import { spawn } from "child_process";
import { ensureLogsDir } from "../tools/workspace";
import type { GatewayStatus, RuntimeCommandResponse, RuntimeLogResponse } from "./types";

const DEFAULT_GATEWAY_HOST = "127.0.0.1";
const DEFAULT_GATEWAY_PORT = 18789;
const DEFAULT_RUNTIME_START_WAIT_MS = 30_000;
const GATEWAY_LOG_FILE = "companion-openclaw-gateway.log";
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
    return {
      success: false,
      state: "not_started",
      message: `OpenClaw gateway start was requested but is not reachable yet. Logs: ${logPath}`,
      gateway: after,
    };
  } catch (error: any) {
    const after = await getGatewayStatus();
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
  const command = process.env.CLAWMOBILE_RUNTIME_STOP_COMMAND || "";
  const before = await getGatewayStatus();

  if (!command) {
    return {
      success: false,
      state: before.reachable ? "running" : "not_started",
      message: "Runtime stop is not configured yet. Stop the Termux gateway session manually.",
      gateway: before,
    };
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, [], { stdio: "ignore", env: process.env });
      child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`stop command exited ${code}`))));
      child.once("error", reject);
    });
    const after = await getGatewayStatus();
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runtimeStartWaitMs() {
  const raw = Number.parseInt(process.env.CLAWMOBILE_RUNTIME_START_WAIT_MS || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RUNTIME_START_WAIT_MS;
}

function gatewayLogPath() {
  return path.join(ensureLogsDir(), GATEWAY_LOG_FILE);
}
