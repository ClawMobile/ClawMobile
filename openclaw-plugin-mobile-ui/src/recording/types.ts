export type TouchAxis = {
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
};

export type RecorderThresholds = {
  tap_max_duration_ms: number;
  tap_max_movement_px: number;
  long_press_min_duration_ms: number;
  after_screenshot_delay_ms: number;
};

export type RecordingDevice = {
  serial?: string;
  screen_width: number;
  screen_height: number;
  density?: number | null;
  touch_device: string;
  touch_axis: TouchAxis;
};

export type RecordingMetadata = {
  trace_id: string;
  task_hint?: string;
  created_at: string;
  started_at?: string;
  stopped_at?: string;
  start_time?: number;
  end_time?: number;
  status: "recording" | "stopped" | "parsed" | "error";
  device: RecordingDevice;
  artifacts: {
    events_log: string;
    events_index?: string;
    screens_dir: string;
    screens_index: string;
    states_log: string;
    metadata: string;
    trace?: string;
  };
  thresholds: RecorderThresholds;
  warnings: string[];
};

export type ScreenshotSample = {
  time: number;
  wall_time: string;
  path: string;
  ok: boolean;
  bytes?: number;
  width?: number;
  height?: number;
  stderr?: string;
};

export type StateSample = {
  time: number;
  wall_time: string;
  package?: string;
  activity?: string;
  screen_width?: number;
  screen_height?: number;
  density?: number | null;
  orientation?: string | null;
  raw?: {
    wm_size?: string;
    wm_density?: string;
    window_focus?: string;
    activity_top?: string;
  };
};

export type EventIndexSample = {
  line: number;
  event_time: number;
  wall_time: string;
  received_at_ms: number;
};

export type TouchPoint = {
  time: number;
  raw_x: number;
  raw_y: number;
  x: number;
  y: number;
  x_norm: number;
  y_norm: number;
};

export type TraceStep =
  | {
      step_id: number;
      type: "tap" | "long_press";
      start_time: number;
      end_time: number;
      duration_ms: number;
      movement_px: number;
      raw: { x: number; y: number };
      screen: { x: number; y: number; x_norm: number; y_norm: number };
      before_screenshot: string | null;
      after_screenshot: string | null;
      state: Partial<StateSample> | null;
    }
  | {
      step_id: number;
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
      before_screenshot: string | null;
      after_screenshot: string | null;
      state: Partial<StateSample> | null;
    };

export type TraceJson = {
  trace_id: string;
  task_hint?: string;
  created_at: string;
  device: RecordingDevice;
  artifacts: {
    events_log: string;
    events_index?: string;
    screens_dir: string;
    screens_index: string;
    states_log: string;
  };
  steps: TraceStep[];
  warnings: string[];
};
