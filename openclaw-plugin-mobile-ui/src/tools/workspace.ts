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

  return path.join(stateDir, "workspace");
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

export function ensureUiDumpsDir() {
  const ws = getWorkspaceDir();
  const dir = path.join(ws, "ui-dumps");
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

// ---------------------------------------------------------------------------
// Async write-buffer for audit logging.
//
// BEFORE (blocking):  every tool call → fs.appendFileSync() → blocks event loop
// AFTER  (buffered):  tool calls push to in-memory buffer → flushed async on
//                     timer or when buffer reaches threshold.
//
// This mirrors the OS page-cache pattern: writes land in memory immediately
// and are flushed to storage asynchronously, trading a small durability window
// for significantly lower per-call latency. On a phone this avoids 5-50 ms of
// synchronous I/O per audit entry.
// ---------------------------------------------------------------------------

const AUDIT_FLUSH_INTERVAL_MS = 500;   // flush at most every 500 ms
const AUDIT_FLUSH_THRESHOLD   = 20;    // or when buffer reaches 20 lines

let _auditBuffer: string[]     = [];
let _auditFlushTimer: ReturnType<typeof setTimeout> | null = null;
let _auditLogPath: string | null = null;   // cached after first resolve
let _auditFlushing              = false;   // guard against concurrent flushes
let _inFlightBatch: string | null = null;  // batch handed to fs.appendFile, callback not yet fired

function resolveAuditLogPath(): string {
  if (!_auditLogPath) {
    const dir = ensureLogsDir();           // mkdirSync only once
    _auditLogPath = path.join(dir, "tool-audit.jsonl");
  }
  return _auditLogPath;
}

function scheduleFlush() {
  if (_auditFlushTimer) return;            // already scheduled
  _auditFlushTimer = setTimeout(() => {
    _auditFlushTimer = null;
    flushAuditBuffer();
  }, AUDIT_FLUSH_INTERVAL_MS);
  // Allow the Node process to exit even if the timer is pending.
  if (_auditFlushTimer && typeof _auditFlushTimer.unref === "function") {
    _auditFlushTimer.unref();
  }
}

function flushAuditBuffer() {
  if (_auditBuffer.length === 0 || _auditFlushing) return;
  _auditFlushing = true;
  const batch = _auditBuffer.join("");
  _auditBuffer = [];
  _inFlightBatch = batch;                 // not yet durably written
  const file = resolveAuditLogPath();
  fs.appendFile(file, batch, (err) => {
    _auditFlushing = false;
    if (err) {
      // Requeue the in-flight batch so it can be retried or recovered on shutdown.
      if (_inFlightBatch) {
        _auditBuffer.unshift(_inFlightBatch);
        _inFlightBatch = null;
      }
      console.warn(`[audit] async flush failed: ${err.message}`);
      if (_auditBuffer.length > 0) scheduleFlush();
      return;
    }
    _inFlightBatch = null;                // callback fired — write confirmed
    // If new entries arrived while we were flushing, schedule another.
    if (_auditBuffer.length > 0) scheduleFlush();
  });
}

// Synchronous drain — last-resort path on process exit so no audit lines are
// lost to the buffered-write window.
//
// Two things can be unflushed at shutdown:
//   1. Entries still queued in the active buffer (_auditBuffer).
//   2. A batch handed to fs.appendFile() whose callback hasn't fired yet
//      (_inFlightBatch). Once process.exit() runs, the event loop dies and
//      that pending callback may never run — so we can't assume it landed.
//
// Writing the in-flight batch here can occasionally duplicate a batch that
// actually did complete on disk (narrow window between syscall completion
// and the callback firing). For audit logs we prefer a rare duplicate over
// a silent loss.
export function flushAuditBufferSync() {
  if (_auditFlushTimer) {
    clearTimeout(_auditFlushTimer);
    _auditFlushTimer = null;
  }
  const parts: string[] = [];
  if (_inFlightBatch) parts.push(_inFlightBatch);      // preserve order
  if (_auditBuffer.length > 0) parts.push(_auditBuffer.join(""));
  _inFlightBatch = null;
  _auditBuffer = [];
  if (parts.length === 0) return;
  try {
    fs.appendFileSync(resolveAuditLogPath(), parts.join(""));
  } catch (err: any) {
    console.warn(`[audit] sync flush on shutdown failed: ${err?.message ?? err}`);
  }
}

let _shutdownHooksInstalled = false;
function installShutdownHooks() {
  if (_shutdownHooksInstalled) return;
  _shutdownHooksInstalled = true;
  // beforeExit — event loop is draining; async flush is still allowed here.
  process.on("beforeExit", () => {
    if (_auditBuffer.length > 0) flushAuditBuffer();
  });
  // exit — only sync APIs run; final safety net for anything still buffered.
  process.on("exit", () => {
    flushAuditBufferSync();
  });
}

export function appendToolAudit(entry: any) {
  installShutdownHooks();
  const line = safeJsonLine(entry, AUDIT_MAX_BYTES);
  _auditBuffer.push(line + "\n");

  if (_auditBuffer.length >= AUDIT_FLUSH_THRESHOLD) {
    // Buffer is full — flush immediately (still async, non-blocking).
    flushAuditBuffer();
  } else {
    scheduleFlush();
  }

  return resolveAuditLogPath();
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
