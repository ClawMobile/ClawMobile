import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { getWorkspaceDir, pngDimensions } from "../tools/workspace";
import {
  parseGeteventLineTime,
  parseRecording,
  parseTouchAxis,
  DEFAULT_RECORDER_THRESHOLDS,
} from "./parser";
import {
  RecorderThresholds,
  RecordingMetadata,
  ScreenshotSample,
  StateSample,
  TouchAxis,
} from "./types";

type CommandResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
};

type BufferResult = {
  ok: boolean;
  code: number;
  stdout: Buffer;
  stderr: string;
};

type StartInput = {
  task_hint?: string;
  input_device?: string;
  screenshot_interval_ms?: number;
  state_interval_ms?: number;
  thresholds?: Partial<RecorderThresholds>;
};

type ActiveRecording = {
  trace_id: string;
  dir: string;
  started_at: string;
  active: boolean;
  getevent: ChildProcess;
  eventsStream: fs.WriteStream;
  eventsIndexStream: fs.WriteStream;
  errorStream: fs.WriteStream;
  eventLineBuffer: string;
  eventLineCount: number;
  metadata: RecordingMetadata;
  screenshot_interval_ms: number;
  state_interval_ms: number;
  screenshotLoop: Promise<void>;
  stateLoop: Promise<void>;
};

let activeRecording: ActiveRecording | null = null;
let shutdownHookInstalled = false;

function adbCommandArgs(args: string[]) {
  const serial = process.env.DROIDRUN_SERIAL || process.env.ANDROID_SERIAL || "";
  return serial ? ["-s", serial, ...args] : args;
}

function runAdbText(args: string[], timeoutMs = 20_000, useSerial = true): Promise<CommandResult> {
  return new Promise((resolve) => {
    const p = spawn("adb", useSerial ? adbCommandArgs(args) : args, {
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

function runAdbBuffer(args: string[], timeoutMs = 30_000): Promise<BufferResult> {
  return new Promise((resolve) => {
    const p = spawn("adb", adbCommandArgs(args), {
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
      resolve({ ok: false, code: -1, stdout: Buffer.concat(chunks), stderr: stderr || "timeout" });
    }, timeoutMs);

    p.on("error", (e: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const msg = e?.code === "ENOENT" ? "adb not found in PATH" : String(e?.message || e);
      resolve({ ok: false, code: -1, stdout: Buffer.concat(chunks), stderr: msg });
    });
    p.stdout.on("data", (d) => chunks.push(Buffer.from(d)));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code: typeof code === "number" ? code : -1, stdout: Buffer.concat(chunks), stderr });
    });
  });
}

async function androidUptime() {
  const res = await runAdbText(["shell", "cat", "/proc/uptime"], 5_000);
  if (!res.ok) return null;
  const first = String(res.stdout || "").trim().split(/\s+/)[0];
  const parsed = Number(first);
  return Number.isFinite(parsed) ? parsed : null;
}

async function monotonicMidpoint<T>(fn: () => Promise<T>) {
  const before = await androidUptime();
  const result = await fn();
  const after = await androidUptime();
  const time =
    before !== null && after !== null
      ? (before + after) / 2
      : before ?? after ?? Date.now() / 1000;
  return { time, result };
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function traceId() {
  const date = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.floor(Math.random() * 1e6).toString().padStart(6, "0");
  return `rec_${date}_${rand}`;
}

function formatUptime(time: number) {
  const seconds = Math.floor(time);
  const micros = Math.round((time - seconds) * 1_000_000);
  return `${String(seconds).padStart(10, "0")}_${String(micros).padStart(6, "0")}`;
}

function appendJsonl(file: string, value: any) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function appendJsonlToStream(stream: fs.WriteStream, value: any) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function writeMetadataSnapshot(dir: string, metadata: RecordingMetadata) {
  fs.writeFileSync(
    path.join(dir, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`
  );
}

function writeMetadata(session: ActiveRecording) {
  writeMetadataSnapshot(session.dir, session.metadata);
}

function clampInterval(value: any, fallback: number, min: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.round(parsed));
}

function parseScreenSize(stdout: string) {
  const match = String(stdout).match(/(?:Physical|Override)?\s*size:\s*(\d+)x(\d+)/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function parseDensity(stdout: string) {
  const match = String(stdout).match(/(?:Physical|Override)?\s*density:\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function parsePackageActivity(text: string) {
  const matches = Array.from(
    String(text || "").matchAll(/([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\/(\.?[A-Za-z0-9_.$]+)/g)
  );
  const first = matches[0];
  if (!first) return {};
  const packageName = first[1];
  const activity = first[2].startsWith(".") ? `${packageName}${first[2]}` : first[2];
  return { package: packageName, activity };
}

function parseOrientation(text: string) {
  const rotation = String(text || "").match(/(?:mCurrentRotation|mRotation)=ROTATION_(\d+)/);
  if (rotation) return `ROTATION_${rotation[1]}`;
  const numeric = String(text || "").match(/(?:mCurrentRotation|mRotation)=(\d+)/);
  if (numeric) return `ROTATION_${numeric[1]}`;
  return null;
}

async function sampleScreenshot(session: ActiveRecording) {
  const screensDir = path.join(session.dir, "screens");
  const screensIndex = path.join(session.dir, "screens.jsonl");
  const { time, result } = await monotonicMidpoint(() =>
    runAdbBuffer(["exec-out", "screencap", "-p"], 30_000)
  );
  const name = `screen_${formatUptime(time)}.png`;
  const relPath = path.posix.join("screens", name);
  const outPath = path.join(screensDir, name);
  const sample: ScreenshotSample = {
    time,
    wall_time: new Date().toISOString(),
    path: relPath,
    ok: result.ok,
    stderr: result.stderr || undefined,
  };
  if (result.ok) {
    fs.writeFileSync(outPath, result.stdout);
    const dims = pngDimensions(result.stdout);
    sample.bytes = result.stdout.length;
    sample.width = dims.width;
    sample.height = dims.height;
  }
  appendJsonl(screensIndex, sample);
}

async function sampleState(session: ActiveRecording) {
  const statesLog = path.join(session.dir, "states.jsonl");
  const { time, result } = await monotonicMidpoint(async () => {
    const [wmSize, wmDensity, windowFocus, activityTop] = await Promise.all([
      runAdbText(["shell", "wm", "size"], 10_000),
      runAdbText(["shell", "wm", "density"], 10_000),
      runAdbText([
        "shell",
        "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp|mTopFullscreenOpaqueWindowState|mCurrentRotation|mRotation' | head -n 30",
      ], 15_000),
      runAdbText(["shell", "dumpsys activity top | grep ACTIVITY | head -n 5"], 15_000),
    ]);
    return { wmSize, wmDensity, windowFocus, activityTop };
  });
  const size = parseScreenSize(result.wmSize.stdout);
  const focusText = `${result.windowFocus.stdout}\n${result.activityTop.stdout}`;
  const focus = parsePackageActivity(focusText);
  const sample: StateSample = {
    time,
    wall_time: new Date().toISOString(),
    ...focus,
    screen_width: size?.width,
    screen_height: size?.height,
    density: parseDensity(result.wmDensity.stdout),
    orientation: parseOrientation(focusText),
    raw: {
      wm_size: result.wmSize.stdout.trim(),
      wm_density: result.wmDensity.stdout.trim(),
      window_focus: result.windowFocus.stdout.trim(),
      activity_top: result.activityTop.stdout.trim(),
    },
  };
  appendJsonl(statesLog, sample);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function screenshotLoop(session: ActiveRecording) {
  while (session.active) {
    try {
      await sampleScreenshot(session);
    } catch (e: any) {
      session.metadata.warnings.push(`screenshot sample failed: ${String(e?.message || e)}`);
    }
    await delay(session.screenshot_interval_ms);
  }
}

async function stateLoop(session: ActiveRecording) {
  while (session.active) {
    try {
      await sampleState(session);
    } catch (e: any) {
      session.metadata.warnings.push(`state sample failed: ${String(e?.message || e)}`);
    }
    await delay(session.state_interval_ms);
  }
}

async function sampleFinalArtifacts(session: ActiveRecording) {
  await Promise.allSettled([
    sampleScreenshot(session).catch((e: any) => {
      session.metadata.warnings.push(`final screenshot sample failed: ${String(e?.message || e)}`);
    }),
    sampleState(session).catch((e: any) => {
      session.metadata.warnings.push(`final state sample failed: ${String(e?.message || e)}`);
    }),
  ]);
}

async function sampleInitialArtifacts(session: ActiveRecording) {
  await Promise.allSettled([
    sampleScreenshot(session).catch((e: any) => {
      session.metadata.warnings.push(`initial screenshot sample failed: ${String(e?.message || e)}`);
    }),
    sampleState(session).catch((e: any) => {
      session.metadata.warnings.push(`initial state sample failed: ${String(e?.message || e)}`);
    }),
  ]);
}

async function getDeviceInfo(inputDevice: string): Promise<{
  serial: string;
  screen_width: number;
  screen_height: number;
  density: number | null;
  axis: TouchAxis;
}> {
  const devices = await runAdbText(["devices"], 10_000, false);
  if (!devices.ok) {
    throw new Error(`adb unavailable: ${devices.stderr || devices.stdout || "adb devices failed"}`);
  }

  const serialRes = await runAdbText(["get-serialno"], 10_000);
  const serial = serialRes.ok ? serialRes.stdout.trim() : "";

  const sizeRes = await runAdbText(["shell", "wm", "size"], 10_000);
  if (!sizeRes.ok) throw new Error(`unable to read screen size: ${sizeRes.stderr || sizeRes.stdout}`);
  const size = parseScreenSize(sizeRes.stdout);
  if (!size) throw new Error(`unable to parse screen size from: ${sizeRes.stdout.trim()}`);

  const densityRes = await runAdbText(["shell", "wm", "density"], 10_000);
  const density = densityRes.ok ? parseDensity(densityRes.stdout) : null;

  const axisRes = await runAdbText(["shell", "getevent", "-p", inputDevice], 10_000);
  if (!axisRes.ok) {
    throw new Error(`unable to inspect input device ${inputDevice}: ${axisRes.stderr || axisRes.stdout}`);
  }
  const axis = parseTouchAxis(axisRes.stdout);
  if (!axis) {
    throw new Error(`unable to parse touch axis ranges from getevent -p ${inputDevice}`);
  }

  return { serial, screen_width: size.width, screen_height: size.height, density, axis };
}

function installShutdownHook() {
  if (shutdownHookInstalled) return;
  shutdownHookInstalled = true;
  process.on("exit", () => {
    if (!activeRecording) return;
    try {
      activeRecording.getevent.kill("SIGKILL");
    } catch {}
  });
}

function stopProcess(processToStop: ChildProcess) {
  return new Promise<void>((resolve) => {
    if (processToStop.exitCode !== null || processToStop.signalCode !== null) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    processToStop.once("close", finish);
    try {
      processToStop.kill("SIGINT");
    } catch {}
    setTimeout(() => {
      if (done) return;
      try {
        processToStop.kill("SIGTERM");
      } catch {}
    }, 800).unref?.();
    setTimeout(() => {
      if (done) return;
      try {
        processToStop.kill("SIGKILL");
      } catch {}
      finish();
    }, 2000).unref?.();
  });
}

function waitForEarlyProcessFailure(
  processToWatch: ChildProcess,
  getStderr: () => string,
  windowMs = 300
) {
  return new Promise<string | null>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      processToWatch.off("error", onError);
      processToWatch.off("close", onClose);
      if (timer) clearTimeout(timer);
    };
    const finish = (message: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(message);
    };
    const onError = (e: any) => {
      const msg = e?.code === "ENOENT" ? "adb not found in PATH" : String(e?.message || e);
      finish(`getevent failed to start: ${msg}`);
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      const stderr = getStderr().trim();
      const detail = stderr ? `: ${stderr}` : "";
      finish(
        `getevent exited before recording started: code=${code ?? "null"} signal=${signal ?? "null"}${detail}`
      );
    };
    timer = setTimeout(() => finish(null), windowMs);
    processToWatch.once("error", onError);
    processToWatch.once("close", onClose);
  });
}

function indexGeteventOutput(session: ActiveRecording, chunk: Buffer | string) {
  const received = new Date();
  session.eventLineBuffer += chunk.toString();
  const lines = session.eventLineBuffer.split(/\r?\n/);
  session.eventLineBuffer = lines.pop() ?? "";
  for (const line of lines) {
    const eventTime = parseGeteventLineTime(line);
    if (eventTime === null) continue;
    session.eventLineCount += 1;
    appendJsonlToStream(session.eventsIndexStream, {
      line: session.eventLineCount,
      event_time: eventTime,
      wall_time: received.toISOString(),
      received_at_ms: received.getTime(),
    });
  }
}

function flushGeteventIndexBuffer(session: ActiveRecording) {
  if (!session.eventLineBuffer.trim()) {
    session.eventLineBuffer = "";
    return;
  }
  indexGeteventOutput(session, "\n");
}

export async function clawmobile_record_start(input: StartInput) {
  if (activeRecording?.active) {
    return {
      ok: false,
      error: "recording_already_active",
      trace_id: activeRecording.trace_id,
      recording_dir: activeRecording.dir,
    };
  }

  installShutdownHook();
  const inputDevice =
    String(input?.input_device || process.env.CLAWMOBILE_RECORD_INPUT_DEVICE || "/dev/input/event2").trim();
  const device = await getDeviceInfo(inputDevice);
  const id = traceId();
  const dir = path.join(getWorkspaceDir(), "recordings", id);
  ensureDir(dir);
  ensureDir(path.join(dir, "screens"));

  const thresholds = { ...DEFAULT_RECORDER_THRESHOLDS, ...(input?.thresholds || {}) };
  const metadata: RecordingMetadata = {
    trace_id: id,
    task_hint: input?.task_hint,
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    start_time: (await androidUptime()) ?? Date.now() / 1000,
    status: "recording",
    device: {
      serial: device.serial,
      screen_width: device.screen_width,
      screen_height: device.screen_height,
      density: device.density,
      touch_device: inputDevice,
      touch_axis: device.axis,
    },
    artifacts: {
      events_log: "events.log",
      events_index: "events_index.jsonl",
      screens_dir: "screens/",
      screens_index: "screens.jsonl",
      states_log: "states.jsonl",
      metadata: "metadata.json",
    },
    thresholds,
    warnings: [],
  };

  const eventsStream = fs.createWriteStream(path.join(dir, "events.log"), { flags: "a" });
  const eventsIndexStream = fs.createWriteStream(path.join(dir, "events_index.jsonl"), { flags: "a" });
  const errorStream = fs.createWriteStream(path.join(dir, "events.err.log"), { flags: "a" });
  const getevent = spawn("adb", adbCommandArgs(["shell", "getevent", "-lt", inputDevice]), {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const session: ActiveRecording = {
    trace_id: id,
    dir,
    started_at: metadata.started_at || metadata.created_at,
    active: true,
    getevent,
    eventsStream,
    eventsIndexStream,
    errorStream,
    eventLineBuffer: "",
    eventLineCount: 0,
    metadata,
    screenshot_interval_ms: clampInterval(input?.screenshot_interval_ms, 500, 100),
    state_interval_ms: clampInterval(input?.state_interval_ms, 1000, 250),
    screenshotLoop: Promise.resolve(),
    stateLoop: Promise.resolve(),
  };
  const earlyStderr: string[] = [];

  getevent.stdout?.on("data", (chunk) => {
    eventsStream.write(chunk);
    indexGeteventOutput(session, chunk);
  });
  getevent.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    if (earlyStderr.join("").length < 4096) earlyStderr.push(text);
    errorStream.write(chunk);
  });

  const earlyFailure = await waitForEarlyProcessFailure(getevent, () => earlyStderr.join(""));
  if (earlyFailure) {
    metadata.status = "error";
    metadata.warnings.push(earlyFailure);
    writeMetadataSnapshot(dir, metadata);
    await new Promise<void>((resolve) => eventsStream.end(resolve));
    await new Promise<void>((resolve) => eventsIndexStream.end(resolve));
    await new Promise<void>((resolve) => errorStream.end(resolve));
    throw new Error(earlyFailure);
  }

  activeRecording = session;
  getevent.on("error", (e: any) => {
    session.metadata.status = "error";
    session.metadata.warnings.push(`getevent failed: ${String(e?.message || e)}`);
    writeMetadata(session);
  });
  getevent.on("close", (code, signal) => {
    if (!session.active) return;
    session.metadata.status = "error";
    session.metadata.warnings.push(
      `getevent exited while recording: code=${code ?? "null"} signal=${signal ?? "null"}`
    );
    writeMetadata(session);
  });
  await sampleInitialArtifacts(session);
  session.screenshotLoop = screenshotLoop(session);
  session.stateLoop = stateLoop(session);
  writeMetadata(session);

  return {
    ok: true,
    trace_id: id,
    recording_dir: dir,
    events_log: path.join(dir, "events.log"),
    events_index: path.join(dir, "events_index.jsonl"),
    screens_dir: path.join(dir, "screens"),
    states_log: path.join(dir, "states.jsonl"),
    device: metadata.device,
    screenshot_interval_ms: session.screenshot_interval_ms,
    state_interval_ms: session.state_interval_ms,
  };
}

export async function clawmobile_record_stop(input?: { parse?: boolean }) {
  const session = activeRecording;
  if (!session?.active) {
    return { ok: false, error: "no_active_recording" };
  }

  session.active = false;
  await stopProcess(session.getevent);
  await Promise.allSettled([session.screenshotLoop, session.stateLoop]);
  await sampleFinalArtifacts(session);
  flushGeteventIndexBuffer(session);
  await new Promise<void>((resolve) => session.eventsStream.end(resolve));
  await new Promise<void>((resolve) => session.eventsIndexStream.end(resolve));
  await new Promise<void>((resolve) => session.errorStream.end(resolve));
  session.metadata.stopped_at = new Date().toISOString();
  session.metadata.end_time = (await androidUptime()) ?? Date.now() / 1000;
  session.metadata.status = "stopped";
  writeMetadata(session);
  activeRecording = null;

  let trace: any = null;
  if (input?.parse !== false) {
    trace = parseRecording(session.dir);
    session.metadata.status = "parsed";
    session.metadata.artifacts.trace = "trace.json";
    writeMetadata(session);
  }

  return {
    ok: true,
    trace_id: session.trace_id,
    recording_dir: session.dir,
    trace_path: trace ? path.join(session.dir, "trace.json") : null,
    steps: trace?.steps?.length ?? null,
    warnings: trace?.warnings ?? session.metadata.warnings,
  };
}

export async function clawmobile_record_parse(input: {
  recording_dir: string;
  thresholds?: Partial<RecorderThresholds>;
}) {
  const requested = String(input?.recording_dir || "").trim();
  if (!requested) return { ok: false, error: "recording_dir is required" };
  const recordingDir = path.isAbsolute(requested)
    ? requested
    : path.join(getWorkspaceDir(), requested);
  if (!fs.existsSync(recordingDir)) {
    return { ok: false, error: `recording_dir not found: ${recordingDir}` };
  }
  const trace = parseRecording(recordingDir, { thresholds: input?.thresholds });
  return {
    ok: true,
    trace_id: trace.trace_id,
    recording_dir: recordingDir,
    trace_path: path.join(recordingDir, "trace.json"),
    steps: trace.steps.length,
    warnings: trace.warnings,
  };
}

export async function clawmobile_record_status() {
  if (!activeRecording?.active) return { ok: true, active: false };
  return {
    ok: true,
    active: true,
    trace_id: activeRecording.trace_id,
    recording_dir: activeRecording.dir,
    started_at: activeRecording.started_at,
    device: activeRecording.metadata.device,
    screenshot_interval_ms: activeRecording.screenshot_interval_ms,
    state_interval_ms: activeRecording.state_interval_ms,
  };
}
