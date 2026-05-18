import fs from "fs";
import path from "path";
import {
  EventIndexSample,
  RecorderThresholds,
  RecordingMetadata,
  ScreenshotSample,
  StateSample,
  TouchAxis,
  TouchPoint,
  TraceJson,
  TraceStep,
} from "./types";

export const DEFAULT_RECORDER_THRESHOLDS: RecorderThresholds = {
  tap_max_duration_ms: 300,
  tap_max_movement_px: 30,
  long_press_min_duration_ms: 500,
  after_screenshot_delay_ms: 500,
};

type EventLine = {
  time: number;
  device: string;
  eventType: string;
  code: string;
  value: string;
};

type ParsedEpisode =
  | {
      type: "tap" | "long_press";
      start_time: number;
      end_time: number;
      duration_ms: number;
      movement_px: number;
      raw: { x: number; y: number };
      screen: { x: number; y: number; x_norm: number; y_norm: number };
    }
  | {
      type: "swipe";
      start_time: number;
      end_time: number;
      duration_ms: number;
      distance_px: number;
      movement_px: number;
      raw: { start_x: number; start_y: number; end_x: number; end_y: number };
      screen: {
        start_x: number;
        start_y: number;
        end_x: number;
        end_y: number;
        start_x_norm: number;
        start_y_norm: number;
        end_x_norm: number;
        end_y_norm: number;
      };
    };

type EpisodeDraft = {
  start_time: number;
  end_time: number;
  points: TouchPoint[];
  last_raw_x: number | null;
  last_raw_y: number | null;
};

type ParseInput = {
  text: string;
  screen_width: number;
  screen_height: number;
  touch_axis: TouchAxis;
  thresholds?: Partial<RecorderThresholds>;
};

type ParseOutput = {
  episodes: ParsedEpisode[];
  warnings: string[];
};

const EVENT_CODE = {
  synReport: ["SYN_REPORT", "0000"],
  btnTouch: ["BTN_TOUCH", "014a"],
  trackingId: ["ABS_MT_TRACKING_ID", "0039"],
  mtPositionX: ["ABS_MT_POSITION_X", "0035"],
  mtPositionY: ["ABS_MT_POSITION_Y", "0036"],
  absX: ["ABS_X", "0000"],
  absY: ["ABS_Y", "0001"],
};

const EVENT_TYPE = {
  syn: ["EV_SYN", "0000"],
  abs: ["EV_ABS", "0003"],
  key: ["EV_KEY", "0001"],
};

function mergeThresholds(input?: Partial<RecorderThresholds>): RecorderThresholds {
  return { ...DEFAULT_RECORDER_THRESHOLDS, ...(input || {}) };
}

function tokenEquals(value: string, candidates: string[]) {
  const normalized = String(value || "").trim().toLowerCase();
  return candidates.some((candidate) => normalized === candidate.toLowerCase());
}

function parseEventLine(line: string): EventLine | null {
  const match = String(line).match(
    /^\[\s*([0-9]+(?:\.[0-9]+)?)\]\s+(?:(\/dev\/input\/event\d+):\s+)?(\S+)\s+(\S+)\s+(\S+)/
  );
  if (!match) return null;
  return {
    time: Number(match[1]),
    device: match[2] || "",
    eventType: match[3],
    code: match[4],
    value: match[5],
  };
}

export function parseGeteventLineTime(line: string): number | null {
  return parseEventLine(line)?.time ?? null;
}

function parseHexValue(value: string): number | null {
  const normalized = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTouchDown(event: EventLine) {
  if (!tokenEquals(event.eventType, EVENT_TYPE.key)) return false;
  if (!tokenEquals(event.code, EVENT_CODE.btnTouch)) return false;
  const value = event.value.toLowerCase();
  return value === "down" || value === "00000001" || value === "1";
}

function isTouchUp(event: EventLine) {
  if (!tokenEquals(event.eventType, EVENT_TYPE.key)) return false;
  if (!tokenEquals(event.code, EVENT_CODE.btnTouch)) return false;
  const value = event.value.toLowerCase();
  return value === "up" || value === "00000000" || value === "0";
}

function isTrackingStart(event: EventLine) {
  if (!tokenEquals(event.eventType, EVENT_TYPE.abs)) return false;
  return tokenEquals(event.code, EVENT_CODE.trackingId) && event.value.toLowerCase() !== "ffffffff";
}

function isTrackingEnd(event: EventLine) {
  if (!tokenEquals(event.eventType, EVENT_TYPE.abs)) return false;
  return tokenEquals(event.code, EVENT_CODE.trackingId) && event.value.toLowerCase() === "ffffffff";
}

function isPositionX(event: EventLine) {
  if (!tokenEquals(event.eventType, EVENT_TYPE.abs)) return false;
  return tokenEquals(event.code, EVENT_CODE.mtPositionX) || tokenEquals(event.code, EVENT_CODE.absX);
}

function isPositionY(event: EventLine) {
  if (!tokenEquals(event.eventType, EVENT_TYPE.abs)) return false;
  return tokenEquals(event.code, EVENT_CODE.mtPositionY) || tokenEquals(event.code, EVENT_CODE.absY);
}

function isSynReport(event: EventLine) {
  if (!tokenEquals(event.eventType, EVENT_TYPE.syn)) return false;
  return tokenEquals(event.code, EVENT_CODE.synReport);
}

function safeRange(min: number, max: number) {
  return max === min ? 1 : max - min;
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mapPoint(
  raw_x: number,
  raw_y: number,
  screen_width: number,
  screen_height: number,
  axis: TouchAxis,
  time: number
): TouchPoint {
  const x = ((raw_x - axis.x_min) / safeRange(axis.x_min, axis.x_max)) * screen_width;
  const y = ((raw_y - axis.y_min) / safeRange(axis.y_min, axis.y_max)) * screen_height;
  return {
    time,
    raw_x,
    raw_y,
    x: round(x),
    y: round(y),
    x_norm: round(x / screen_width, 6),
    y_norm: round(y / screen_height, 6),
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function maxMovement(points: TouchPoint[]) {
  if (points.length < 2) return 0;
  const first = points[0];
  return Math.max(...points.map((point) => distance(first, point)));
}

function averagePoint(points: TouchPoint[]) {
  const sum = points.reduce(
    (acc, point) => ({
      raw_x: acc.raw_x + point.raw_x,
      raw_y: acc.raw_y + point.raw_y,
      x: acc.x + point.x,
      y: acc.y + point.y,
      x_norm: acc.x_norm + point.x_norm,
      y_norm: acc.y_norm + point.y_norm,
    }),
    { raw_x: 0, raw_y: 0, x: 0, y: 0, x_norm: 0, y_norm: 0 }
  );
  const n = Math.max(1, points.length);
  return {
    raw_x: Math.round(sum.raw_x / n),
    raw_y: Math.round(sum.raw_y / n),
    x: Math.round(sum.x / n),
    y: Math.round(sum.y / n),
    x_norm: round(sum.x_norm / n, 6),
    y_norm: round(sum.y_norm / n, 6),
  };
}

function pushCurrentPoint(
  draft: EpisodeDraft,
  eventTime: number,
  screen_width: number,
  screen_height: number,
  axis: TouchAxis
) {
  if (draft.last_raw_x === null || draft.last_raw_y === null) return;
  const point = mapPoint(
    draft.last_raw_x,
    draft.last_raw_y,
    screen_width,
    screen_height,
    axis,
    eventTime
  );
  const prev = draft.points[draft.points.length - 1];
  if (prev && prev.raw_x === point.raw_x && prev.raw_y === point.raw_y && prev.time === point.time) {
    return;
  }
  draft.points.push(point);
}

function finalizeEpisode(
  draft: EpisodeDraft,
  thresholds: RecorderThresholds
): ParseOutput["episodes"][number] | null {
  if (draft.points.length === 0) return null;
  const start = draft.points[0];
  const end = draft.points[draft.points.length - 1];
  const duration_ms = Math.max(0, (draft.end_time - draft.start_time) * 1000);
  const movement_px = round(maxMovement(draft.points));
  const end_distance = round(distance(start, end));

  if (movement_px >= thresholds.tap_max_movement_px) {
    return {
      type: "swipe",
      start_time: round(draft.start_time, 6),
      end_time: round(draft.end_time, 6),
      duration_ms: round(duration_ms, 1),
      distance_px: end_distance,
      movement_px,
      raw: {
        start_x: start.raw_x,
        start_y: start.raw_y,
        end_x: end.raw_x,
        end_y: end.raw_y,
      },
      screen: {
        start_x: Math.round(start.x),
        start_y: Math.round(start.y),
        end_x: Math.round(end.x),
        end_y: Math.round(end.y),
        start_x_norm: start.x_norm,
        start_y_norm: start.y_norm,
        end_x_norm: end.x_norm,
        end_y_norm: end.y_norm,
      },
    };
  }

  const point = averagePoint(draft.points);
  const type =
    duration_ms >= thresholds.long_press_min_duration_ms ? "long_press" : "tap";
  return {
    type,
    start_time: round(draft.start_time, 6),
    end_time: round(draft.end_time, 6),
    duration_ms: round(duration_ms, 1),
    movement_px,
    raw: { x: point.raw_x, y: point.raw_y },
    screen: {
      x: point.x,
      y: point.y,
      x_norm: point.x_norm,
      y_norm: point.y_norm,
    },
  };
}

export function parseGeteventLog(input: ParseInput): ParseOutput {
  const thresholds = mergeThresholds(input.thresholds);
  const warnings: string[] = [];
  const episodes: ParseOutput["episodes"] = [];
  let current: EpisodeDraft | null = null;
  let lastRawX: number | null = null;
  let lastRawY: number | null = null;

  function begin(time: number) {
    if (current) return;
    current = {
      start_time: time,
      end_time: time,
      points: [],
      last_raw_x: lastRawX,
      last_raw_y: lastRawY,
    };
  }

  function end(time: number) {
    if (!current) return;
    current.end_time = time;
    pushCurrentPoint(current, time, input.screen_width, input.screen_height, input.touch_axis);
    const episode = finalizeEpisode(current, thresholds);
    if (episode) episodes.push(episode);
    else warnings.push(`empty touch episode at ${round(current.start_time, 6)}`);
    current = null;
  }

  for (const line of input.text.split(/\r?\n/)) {
    const event = parseEventLine(line);
    if (!event) continue;

    if (isTouchDown(event) || isTrackingStart(event)) begin(event.time);

    if (isPositionX(event)) {
      const parsed = parseHexValue(event.value);
      if (parsed !== null) lastRawX = parsed;
    } else if (isPositionY(event)) {
      const parsed = parseHexValue(event.value);
      if (parsed !== null) lastRawY = parsed;
    }

    if (current) {
      current.end_time = event.time;
      current.last_raw_x = lastRawX;
      current.last_raw_y = lastRawY;
      if (isSynReport(event)) {
        pushCurrentPoint(current, event.time, input.screen_width, input.screen_height, input.touch_axis);
      }
    }

    if (isTouchUp(event) || isTrackingEnd(event)) end(event.time);
  }

  if (current) {
    warnings.push(`unterminated touch episode at ${round(current.start_time, 6)}`);
    current.end_time = current.end_time || current.start_time;
    pushCurrentPoint(current, current.end_time, input.screen_width, input.screen_height, input.touch_axis);
    const episode = finalizeEpisode(current, thresholds);
    if (episode) episodes.push(episode);
  }

  return { episodes, warnings };
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function rel(recordingDir: string, filePath: string | null) {
  if (!filePath) return null;
  return path.relative(recordingDir, filePath).replace(/\\/g, "/");
}

function parseScreenTimeFromName(file: string): number | null {
  const match = path.basename(file).match(/^screen_(\d+)_(\d+)\.png$/);
  if (!match) return null;
  return Number(match[1]) + Number(match[2]) / 1_000_000;
}

function loadScreens(recordingDir: string): ScreenshotSample[] {
  const indexPath = path.join(recordingDir, "screens.jsonl");
  const screens = readJsonl<ScreenshotSample>(indexPath).filter((s) => s.ok && s.path);
  if (screens.length > 0) {
    return screens
      .map((screen) => ({
        ...screen,
        path: path.isAbsolute(screen.path)
          ? screen.path
          : path.join(recordingDir, screen.path),
      }))
      .sort((a, b) => a.time - b.time);
  }

  const screensDir = path.join(recordingDir, "screens");
  if (!fs.existsSync(screensDir)) return [];
  return fs
    .readdirSync(screensDir)
    .filter((name) => name.endsWith(".png"))
    .map((name) => {
      const filePath = path.join(screensDir, name);
      return {
        time: parseScreenTimeFromName(name) ?? fs.statSync(filePath).mtimeMs / 1000,
        wall_time: fs.statSync(filePath).mtime.toISOString(),
        path: filePath,
        ok: true,
      };
    })
    .sort((a, b) => a.time - b.time);
}

function nearestBefore<T extends { time: number }>(items: T[], time: number): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (item.time <= time) best = item;
    else break;
  }
  return best;
}

function nearestAfter<T extends { time: number }>(items: T[], time: number): T | null {
  return items.find((item) => item.time >= time) || null;
}

function nearestByTime<T extends { time: number }>(items: T[], time: number): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const distance = Math.abs(item.time - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item;
    }
  }
  return best;
}

type TimeAnchor = {
  time: number;
  wallMs: number;
};

function parseWallTimeMs(wallTime: string | undefined) {
  const parsed = Date.parse(String(wallTime || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function nearestByWallTime(items: TimeAnchor[], wallMs: number): TimeAnchor | null {
  let best: TimeAnchor | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const distance = Math.abs(item.wallMs - wallMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item;
    }
  }
  return best;
}

function makeTimeAnchors(screens: ScreenshotSample[], states: StateSample[]): TimeAnchor[] {
  return [...screens, ...states]
    .map((sample) => {
      const wallMs = parseWallTimeMs(sample.wall_time);
      if (wallMs === null || !Number.isFinite(sample.time)) return null;
      return { time: sample.time, wallMs };
    })
    .filter((sample): sample is TimeAnchor => sample !== null)
    .sort((a, b) => a.wallMs - b.wallMs);
}

function loadEventIndex(recordingDir: string, metadata: RecordingMetadata): EventIndexSample[] {
  const indexPath = path.join(recordingDir, metadata.artifacts.events_index || "events_index.jsonl");
  return readJsonl<EventIndexSample>(indexPath)
    .filter((sample) => Number.isFinite(sample.event_time) && parseWallTimeMs(sample.wall_time) !== null)
    .sort((a, b) => a.event_time - b.event_time || a.line - b.line);
}

function eventTimeToSampleTime(
  eventTime: number,
  eventIndex: EventIndexSample[],
  anchors: TimeAnchor[]
): number | null {
  if (eventIndex.length === 0 || anchors.length === 0) return null;
  const eventSample = nearestByTime(eventIndex.map((sample) => ({
    ...sample,
    time: sample.event_time,
  })), eventTime);
  if (!eventSample) return null;
  const wallMs = parseWallTimeMs(eventSample.wall_time);
  if (wallMs === null) return null;
  const anchor = nearestByWallTime(anchors, wallMs);
  if (!anchor) return null;
  return round(anchor.time + (wallMs - anchor.wallMs) / 1000, 6);
}

function alignEpisodeTime(
  episode: ParsedEpisode,
  eventIndex: EventIndexSample[],
  anchors: TimeAnchor[]
): ParsedEpisode {
  const mappedStart = eventTimeToSampleTime(episode.start_time, eventIndex, anchors);
  if (mappedStart === null) return episode;
  const durationSeconds = Math.max(0, episode.end_time - episode.start_time);
  return {
    ...episode,
    start_time: mappedStart,
    end_time: round(mappedStart + durationSeconds, 6),
  };
}

function summarizeState(state: StateSample | null): Partial<StateSample> | null {
  if (!state) return null;
  return {
    time: state.time,
    package: state.package,
    activity: state.activity,
    screen_width: state.screen_width,
    screen_height: state.screen_height,
    density: state.density,
    orientation: state.orientation,
  };
}

export function parseRecording(
  recordingDir: string,
  options?: { thresholds?: Partial<RecorderThresholds>; writeTrace?: boolean }
): TraceJson {
  const metadataPath = path.join(recordingDir, "metadata.json");
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as RecordingMetadata;
  const thresholds = mergeThresholds({ ...metadata.thresholds, ...(options?.thresholds || {}) });
  const warnings = [...(metadata.warnings || [])];
  const eventsPath = path.join(recordingDir, metadata.artifacts.events_log || "events.log");
  const eventsText = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, "utf8") : "";
  if (!eventsText) warnings.push("events.log is missing or empty");

  const parsed = parseGeteventLog({
    text: eventsText,
    screen_width: metadata.device.screen_width,
    screen_height: metadata.device.screen_height,
    touch_axis: metadata.device.touch_axis,
    thresholds,
  });
  warnings.push(...parsed.warnings);

  const screens = loadScreens(recordingDir);
  const states = readJsonl<StateSample>(path.join(recordingDir, metadata.artifacts.states_log || "states.jsonl"))
    .sort((a, b) => a.time - b.time);
  const eventIndex = loadEventIndex(recordingDir, metadata);
  const timeAnchors = makeTimeAnchors(screens, states);
  if (eventIndex.length === 0 && (screens.length > 0 || states.length > 0)) {
    warnings.push("events_index.jsonl is missing; using raw getevent timestamps for alignment");
  } else if (eventIndex.length > 0 && timeAnchors.length === 0) {
    warnings.push("no wall-clock anchors found; using raw getevent timestamps for alignment");
  }

  const steps: TraceStep[] = parsed.episodes.map((episode, index) => {
    const alignedEpisode = alignEpisodeTime(episode, eventIndex, timeAnchors);
    const before = nearestBefore(screens, alignedEpisode.start_time);
    let after = nearestAfter(
      screens,
      alignedEpisode.end_time + thresholds.after_screenshot_delay_ms / 1000
    );
    if (!after) after = nearestAfter(screens, alignedEpisode.end_time);
    if (!before) warnings.push(`step ${index + 1}: no before screenshot`);
    if (!after) warnings.push(`step ${index + 1}: no after screenshot`);
    const state = nearestByTime(states, (alignedEpisode.start_time + alignedEpisode.end_time) / 2);
    return {
      step_id: index + 1,
      ...alignedEpisode,
      before_screenshot: rel(recordingDir, before?.path || null),
      after_screenshot: rel(recordingDir, after?.path || null),
      state: summarizeState(state),
    } as TraceStep;
  });

  const trace: TraceJson = {
    trace_id: metadata.trace_id,
    task_hint: metadata.task_hint,
    created_at: metadata.created_at,
    device: metadata.device,
    artifacts: {
      events_log: metadata.artifacts.events_log || "events.log",
      events_index: metadata.artifacts.events_index || "events_index.jsonl",
      screens_dir: metadata.artifacts.screens_dir || "screens/",
      screens_index: metadata.artifacts.screens_index || "screens.jsonl",
      states_log: metadata.artifacts.states_log || "states.jsonl",
    },
    steps,
    warnings,
  };

  if (options?.writeTrace !== false) {
    fs.writeFileSync(path.join(recordingDir, "trace.json"), `${JSON.stringify(trace, null, 2)}\n`);
  }

  return trace;
}

export function parseTouchAxis(geteventPOutput: string): TouchAxis | null {
  const x =
    parseAxisRange(geteventPOutput, EVENT_CODE.mtPositionX) ||
    parseAxisRange(geteventPOutput, EVENT_CODE.absX);
  const y =
    parseAxisRange(geteventPOutput, EVENT_CODE.mtPositionY) ||
    parseAxisRange(geteventPOutput, EVENT_CODE.absY);
  if (!x || !y) return null;
  return {
    x_min: x.min,
    x_max: x.max,
    y_min: y.min,
    y_max: y.max,
  };
}

function parseAxisRange(
  geteventPOutput: string,
  codes: string[]
): { min: number; max: number } | null {
  for (const line of String(geteventPOutput || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const token = trimmed.split(/\s+/)[0].replace(/:$/, "");
    const tokenWithoutParen = token.replace(/\([0-9a-fA-F]+\)$/, "");
    const matchesCode =
      tokenEquals(tokenWithoutParen, codes) ||
      codes.some((code) => trimmed.toLowerCase().startsWith(`${code.toLowerCase()} `));
    if (!matchesCode) continue;
    const range = trimmed.match(/\bmin\s+(-?\d+),\s+max\s+(-?\d+)/i);
    if (!range) continue;
    return { min: Number(range[1]), max: Number(range[2]) };
  }
  return null;
}
