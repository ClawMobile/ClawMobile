import fs from "fs";
import os from "os";
import path from "path";

export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024;
const AUDIT_MAX_BYTES = 2000;

let _cachedWorkspaceDir: string | null = null;

function resolveWorkspaceDir(): string {
  if (process.env.OPENCLAW_WORKSPACE) return process.env.OPENCLAW_WORKSPACE;

  const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
  const configPath = path.join(stateDir, "config.json");

  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      const ws = parsed?.agents?.defaults?.workspace;
      if (typeof ws === "string" && ws.trim()) return ws.trim();
    }
  } catch {
    // ignore and fall back
  }

  if (process.env.OPENCLAW_STATE_DIR) return path.join(stateDir, "workspace");
  return "/root/.openclaw/workspace";
}

export function getWorkspaceDir() {
  if (_cachedWorkspaceDir !== null) return _cachedWorkspaceDir;
  _cachedWorkspaceDir = resolveWorkspaceDir();
  return _cachedWorkspaceDir;
}

export function resetWorkspaceDirCache() {
  _cachedWorkspaceDir = null;
}

export function ensureScreenshotsDir() {
  const ws = getWorkspaceDir();
  const dir = path.join(ws, "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureLogsDir() {
  const ws = getWorkspaceDir();
  const dir = path.join(ws, "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeLog(dir: string, prefix: string, content: string) {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const file = path.join(dir, `${prefix}_${ts}_${rand}.log`);
  fs.writeFileSync(file, truncateString(content, DEFAULT_MAX_OUTPUT_BYTES));
  return file;
}

function safeJsonLine(obj: any, maxBytes = AUDIT_MAX_BYTES) {
  let line = "";
  try {
    line = JSON.stringify(obj);
  } catch {
    line = JSON.stringify({ tool: obj?.tool, time: obj?.time, error: "stringify_failed" });
  }
  if (line.length <= maxBytes) return line;
  return JSON.stringify({
    truncated: true,
    original_len: line.length,
    head: line.slice(0, maxBytes - 100),
  });
}

export function appendToolAudit(entry: any) {
  const dir = ensureLogsDir();
  const file = path.join(dir, "tool-audit.jsonl");
  const line = safeJsonLine(entry, AUDIT_MAX_BYTES);
  fs.appendFileSync(file, line + "\n");
  return file;
}

export function makeScreenshotPath() {
  const dir = ensureScreenshotsDir();
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  return path.join(dir, `shot_${ts}_${rand}.png`);
}

export function pngDimensions(buf: Buffer): { width: number; height: number } {
  if (!buf || buf.length < 24) return { width: 0, height: 0 };
  const signature = "89504e470d0a1a0a";
  if (buf.slice(0, 8).toString("hex") !== signature) return { width: 0, height: 0 };
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function truncateString(text: string, maxBytes = DEFAULT_MAX_OUTPUT_BYTES) {
  if (text.length <= maxBytes) return text;
  return text.slice(0, maxBytes) + `\n...truncated ${text.length - maxBytes} bytes`;
}

export function truncateLargeStrings<T>(value: T, maxBytes = DEFAULT_MAX_OUTPUT_BYTES): T {
  if (typeof value === "string") {
    return truncateString(value, maxBytes) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => truncateLargeStrings(v, maxBytes)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      out[k] = truncateLargeStrings(v, maxBytes);
    }
    return out as T;
  }
  return value;
}
