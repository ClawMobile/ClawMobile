import {
  android_health,
  android_screenshot,
  android_tap,
  android_type,
  android_swipe,
  android_agent_task,
  android_ui_dump,
  android_ui_query,
  android_match_text_queries,
  android_resolve_text_queries,
  android_ocr_dump,
} from "./tools/android";
import { signalComplete as android_signal_complete } from "./tools/attention";
import {
  adb_devices,
  adb_keyevent,
  adb_ui_dump_xml,
  adb_screenshot,
  adb_tap,
  adb_type,
  adb_swipe,
} from "./backends/adb";
import {
  tx_notify,
  tx_tts,
  tx_toast,
  tx_clipboard_get,
  tx_clipboard_set,
  tx_battery_status,
} from "./backends/termux";
import { android_shell } from "./tools/shell";
import {
  clawmobile_record_parse,
  clawmobile_record_start,
  clawmobile_record_status,
  clawmobile_record_stop,
} from "./recording/recorder";
import {
  prepareTraceSummary as clawmobile_trace_prepare_summary,
  saveSkillCandidate as clawmobile_trace_save_skill_candidate,
} from "./trace_induction/summary";
import { promoteSkillCandidate as clawmobile_skill_candidate_promote } from "./trace_induction/promote";
import { generalizeSkill as clawmobile_skill_generalize } from "./trace_induction/generalize";
import { updateSkillFromTrace as clawmobile_skill_update_from_trace } from "./trace_induction/evolve";
import { recordSkillFeedback as clawmobile_skill_record_feedback } from "./trace_induction/feedback";
import { getSkillStatus as clawmobile_skill_status } from "./trace_induction/status";
import { runSkillFastPath as clawmobile_skill_run_fast_path } from "./trace_induction/fastpath";
import { reflectFastPathFailure as clawmobile_skill_reflect_fast_path_failure } from "./trace_induction/repair";
import { clawmobile_batch_execute } from "./tools/batch";

type JsonSchema = Record<string, any>;

const visionRegionSchema = {
  type: "object",
  properties: {
    left: { type: "integer", minimum: 0 },
    top: { type: "integer", minimum: 0 },
    width: { type: "integer", minimum: 1 },
    height: { type: "integer", minimum: 1 },
  },
  required: ["left", "top", "width", "height"],
  additionalProperties: false,
};

const recorderThresholdSchema = {
  type: "object",
  properties: {
    tap_max_duration_ms: { type: "number", minimum: 0 },
    tap_max_movement_px: { type: "number", minimum: 0 },
    long_press_min_duration_ms: { type: "number", minimum: 0 },
    after_screenshot_delay_ms: { type: "number", minimum: 0 },
  },
  additionalProperties: false,
};

const batchStepSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    action: {
      type: "string",
      enum: [
        "tap",
        "tap_anchor",
        "tap_text",
        "type",
        "type_parameter",
        "swipe",
        "keyevent",
        "wait",
        "screenshot",
        "ui_dump",
        "ocr_dump",
        "assert_ui_contains",
        "assert_app_state",
        "open_app",
      ],
    },
    optional: { type: "boolean" },
    stop_on_error: { type: "boolean" },
    anchor: { type: "string" },
    x: { type: "integer" },
    y: { type: "integer" },
    x1: { type: "integer" },
    y1: { type: "integer" },
    x2: { type: "integer" },
    y2: { type: "integer" },
    durationMs: { type: "integer", minimum: 0 },
    text: { type: "string" },
    texts: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    parameter: { type: "string" },
    exact: { type: "boolean" },
    ignoreCase: { type: "boolean" },
    scope: { type: "string", enum: ["line", "word", "all"] },
    matchPickStrategy: {
      type: "string",
      enum: ["highest_confidence", "clickable_first", "bottom_most", "top_most", "left_most", "right_most", "largest", "widest", "tallest"],
    },
    key: { type: "string", enum: ["HOME", "BACK", "RECENTS", "ENTER"] },
    keycode: { type: "integer" },
    ms: { type: "integer", minimum: 0, maximum: 30000 },
    contains: { type: "string" },
    package: { type: "string" },
    activity: { type: "string" },
    component: { type: "string" },
    waitMs: { type: "integer", minimum: 0, maximum: 10000 },
    ui_text_any: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    ui_text_all: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    allow_uncertain: { type: "boolean" },
    path: { type: "string" },
    lang: { type: "string" },
    psm: { type: "integer", minimum: 0, maximum: 13 },
    minConfidence: { type: "integer", minimum: 0, maximum: 100 },
    scale: { type: "integer", minimum: 1, maximum: 8 },
    region: visionRegionSchema,
  },
  required: ["action"],
  additionalProperties: false,
};

function isLiteMode() {
  return process.env.CLAW_MOBILE_ADB_ONLY === "1" || process.env.CLAWMOBILE_LITE === "1";
}

function asContent(obj: any) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function toolDef(
  name: string,
  description: string,
  schema: JsonSchema,
  fn: (args: any) => Promise<any>
) {
  return {
    name,
    description,
    schema,
    inputSchema: schema,
    parameters: schema,
    async execute(_ctx: any, args: any) {
      return asContent(await fn(args ?? {}));
    },
  };
}

function register(api: any) {
  // Public plugin surface for OpenClaw.
  // This file is the contract boundary between the OpenClaw runtime and the
  // mobile runtime implementation below.
  const liteMode = isLiteMode();

  // ---- composite mobile runtime tools ----
  api.registerTool(
    toolDef(
      "android_health",
      liteMode
        ? "Check ClawMobile Lite capability stage and available Termux/ADB backends."
        : "Check droidrun/python availability (mobile executor health).",
      { type: "object", properties: {}, additionalProperties: false },
      async () => android_health()
    )
  );

  api.registerTool(
    toolDef(
      "android_screenshot",
      "Take a screenshot on the Android device when a shell-level backend is available.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => android_screenshot()
    )
  );

  api.registerTool(
    toolDef(
      "android_tap",
      "Tap at (x,y) on the Android device when UI input capability is available.",
      {
        type: "object",
        properties: {
          x: { type: "integer" },
          y: { type: "integer" },
        },
        required: ["x", "y"],
        additionalProperties: false,
      },
      async (args) => android_tap(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_type",
      "Type text into the focused Android field when UI input capability is available.",
      {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      async (args) => android_type(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_swipe",
      "Swipe from (x1,y1) to (x2,y2) when UI input capability is available.",
      {
        type: "object",
        properties: {
          x1: { type: "integer" },
          y1: { type: "integer" },
          x2: { type: "integer" },
          y2: { type: "integer" },
          durationMs: { type: "integer" },
        },
        required: ["x1", "y1", "x2", "y2"],
        additionalProperties: false,
      },
      async (args) => android_swipe(args)
    )
  );

  // ---- deterministic observation tools ----
  api.registerTool(
    toolDef(
      "android_ui_dump",
      "Dump current UI hierarchy into a local XML cache and return a compact keyword index for later android_ui_query calls. Use rawXml=true only for debugging.",
      {
        type: "object",
        properties: {
          rawXml: { type: "boolean" },
          compressed: { type: "boolean" },
        },
        additionalProperties: false,
      },
      async (args) => android_ui_dump(args)
    )
  );

  const uiQuerySchema = {
    type: "object",
    properties: {
      dumpId: { type: "string" },
      name: { type: "string" },
      nodeId: { type: "integer", minimum: 1 },
      text: { type: "string" },
      contentDesc: { type: "string" },
      resourceId: { type: "string" },
      className: { type: "string" },
      clickable: { type: "boolean" },
      enabled: { type: "boolean" },
      exact: { type: "boolean" },
      ignoreCase: { type: "boolean" },
      region: visionRegionSchema,
      matchPickStrategy: {
        type: "string",
        enum: ["highest_confidence", "clickable_first", "bottom_most", "top_most", "left_most", "right_most", "largest", "widest", "tallest"],
      },
      detail: {
        type: "string",
        enum: ["auto", "compact", "full"],
      },
      maxMatches: { type: "integer", minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  };

  api.registerTool(
    toolDef(
      "android_ui_query",
      "Query local UIAutomator XML, reusing dumpId when provided or creating a fresh local dump, and return compact matching nodes with bounds; does not expose raw XML.",
      {
        type: "object",
        properties: {
          ...uiQuerySchema.properties,
          queries: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: uiQuerySchema,
          },
        },
        additionalProperties: false,
      },
      async (args) => android_ui_query(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_match_text_queries",
      "Run OCR across bounded query regions and return the first bounded text match for the target text.",
      {
        type: "object",
        properties: {
          text: { type: "string" },
          path: { type: "string" },
          queries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                region: visionRegionSchema,
                scale: { type: "integer", minimum: 1, maximum: 8 },
                lang: { type: "string" },
                psm: { type: "integer", minimum: 0, maximum: 13 },
                minConfidence: { type: "integer", minimum: 0, maximum: 100 },
                exact: { type: "boolean" },
                ignoreCase: { type: "boolean" },
                scope: { type: "string", enum: ["line", "word", "all"] },
              },
              additionalProperties: false,
            },
          },
          matchRegion: visionRegionSchema,
          matchPickStrategy: {
            type: "string",
            enum: [
              "highest_confidence",
              "bottom_most",
              "top_most",
              "left_most",
              "right_most",
              "largest",
              "widest",
              "tallest",
            ],
          },
        },
        required: ["text", "queries"],
        additionalProperties: false,
      },
      async (args) => android_match_text_queries(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_resolve_text_queries",
      "Run a sequence of OCR text queries and return the first selected match.",
      {
        type: "object",
        properties: {
          path: { type: "string" },
          queries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                text: { type: "string" },
                region: visionRegionSchema,
                scale: { type: "integer", minimum: 1, maximum: 8 },
                lang: { type: "string" },
                psm: { type: "integer", minimum: 0, maximum: 13 },
                minConfidence: { type: "integer", minimum: 0, maximum: 100 },
                exact: { type: "boolean" },
                ignoreCase: { type: "boolean" },
                scope: { type: "string", enum: ["line", "word", "all"] },
              },
              required: ["text"],
              additionalProperties: false,
            },
          },
          matchRegion: visionRegionSchema,
          matchPickStrategy: {
            type: "string",
            enum: [
              "highest_confidence",
              "bottom_most",
              "top_most",
              "left_most",
              "right_most",
              "largest",
              "widest",
              "tallest",
            ],
          },
        },
        required: ["queries"],
        additionalProperties: false,
      },
      async (args) => android_resolve_text_queries(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_ocr_dump",
      "Run OCR on the current Android screenshot or a provided screenshot path and return detected text lines with bounding boxes.",
      {
        type: "object",
        properties: {
          path: { type: "string" },
          lang: { type: "string" },
          psm: { type: "integer", minimum: 0, maximum: 13 },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 300000 },
          minConfidence: { type: "integer", minimum: 0, maximum: 100 },
          region: visionRegionSchema,
          scale: { type: "integer", minimum: 1, maximum: 8 },
        },
        additionalProperties: false,
      },
      async (args) => android_ocr_dump(args)
    )
  );

  if (!liteMode) {
    api.registerTool(
      toolDef(
        "android_agent_task",
        "Run a high-level Android task using the full mobile agent backend.",
        {
          type: "object",
          properties: {
            goal: { type: "string" },
            steps: { type: "integer" },
            timeout: { type: "integer" },
            deviceSerial: { type: "string" },
            tcp: { type: "boolean" }
          },
          required: ["goal"],
          additionalProperties: false
        },
        async (args) => android_agent_task(args)
      )
    );
  }

  // ---- demonstration recorder and trace-to-skill workflow ----
  api.registerTool(
    toolDef(
      "clawmobile_record_start",
      "Start recording a human Android demonstration: raw getevent touch log, screenshots, and app/window state samples. Requires ADB/shell-level capability.",
      {
        type: "object",
        properties: {
          task_hint: { type: "string" },
          input_device: { type: "string" },
          screenshot_interval_ms: { type: "integer", minimum: 100 },
          state_interval_ms: { type: "integer", minimum: 250 },
          thresholds: recorderThresholdSchema,
        },
        additionalProperties: false,
      },
      async (args) => clawmobile_record_start(args)
    )
  );

  api.registerTool(
    toolDef(
      "clawmobile_record_stop",
      "Stop the active demonstration recording and, by default, parse it into trace.json.",
      {
        type: "object",
        properties: {
          parse: { type: "boolean" },
        },
        additionalProperties: false,
      },
      async (args) => clawmobile_record_stop(args)
    )
  );

  api.registerTool(
    toolDef(
      "clawmobile_record_parse",
      "Parse an existing recording directory into trace.json without starting a new recording.",
      {
        type: "object",
        properties: {
          recording_dir: { type: "string" },
          thresholds: recorderThresholdSchema,
        },
        required: ["recording_dir"],
        additionalProperties: false,
      },
      async (args) => clawmobile_record_parse(args)
    )
  );

  api.registerTool(
    toolDef(
      "clawmobile_record_status",
      "Return the active demonstration recorder status.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => clawmobile_record_status()
    )
  );

  api.registerTool(
    toolDef(
      "clawmobile_trace_prepare_summary",
      "Prepare a compact trace digest, grounding rules, and candidate schema for OpenClaw to summarize a recording into a skill candidate.",
      {
        type: "object",
        properties: {
          recording_dir_or_trace_path: { type: "string" },
          recording_dir: { type: "string" },
          trace_path: { type: "string" },
          max_steps: { type: "integer", minimum: 1, maximum: 200 },
          write_artifacts: { type: "boolean" },
        },
        additionalProperties: false,
      },
      async (args) => clawmobile_trace_prepare_summary(args)
    )
  );

  api.registerTool(
    toolDef(
      "clawmobile_trace_save_skill_candidate",
      "Validate and save an OpenClaw-generated skill candidate for a recorded trace.",
      {
        type: "object",
        properties: {
          recording_dir_or_trace_path: { type: "string" },
          recording_dir: { type: "string" },
          trace_path: { type: "string" },
          candidate: {},
          summary_markdown: { type: "string" },
        },
        required: ["candidate"],
        additionalProperties: false,
      },
      async (args) => clawmobile_trace_save_skill_candidate(args)
    )
  );

  api.registerTool(
    toolDef(
      "clawmobile_skill_candidate_promote",
      "Promote a validated ClawMobile skill_candidate.json into a reusable OpenClaw SKILL.md directory and optional workspace installation.",
      {
        type: "object",
        properties: {
          recording_dir_or_candidate_path: { type: "string" },
          recording_dir: { type: "string" },
          candidate_path: { type: "string" },
          output_dir: { type: "string" },
          install: { type: "boolean" },
          skill_name: { type: "string" },
        },
        additionalProperties: false,
      },
      async (args) => clawmobile_skill_candidate_promote(args)
    )
  );

  api.registerTool(
    toolDef(
      "clawmobile_skill_generalize",
      "Generalize a trace-derived skill_candidate.json into a reusable ClawMobile skill.v2 draft with applicability and grounding policies.",
      {
        type: "object",
        properties: {
          skill_or_trace_path: { type: "string" },
          recording_dir_or_candidate_path: { type: "string" },
          recording_dir: { type: "string" },
          candidate_path: { type: "string" },
          output_dir: { type: "string" },
          skill_name: { type: "string" },
        },
        additionalProperties: false,
      },
      async (args) => clawmobile_skill_generalize(args)
    )
  );

  api.registerTool(
    toolDef(
      "clawmobile_skill_update_from_trace",
      "Update an existing generated ClawMobile skill with another validated trace-derived skill_candidate.json.",
      {
        type: "object",
        properties: {
          existing_skill_dir: { type: "string" },
          skill_dir: { type: "string" },
          existing_skill_path: { type: "string" },
          new_recording_dir_or_candidate_path: { type: "string" },
          recording_dir: { type: "string" },
          candidate_path: { type: "string" },
          output_dir: { type: "string" },
          skill_name: { type: "string" },
          allow_intent_mismatch: { type: "boolean" },
        },
        additionalProperties: false,
      },
      async (args) => clawmobile_skill_update_from_trace(args)
    )
  );

  api.registerTool(
    toolDef(
      "clawmobile_skill_record_feedback",
      "Record lightweight execution feedback for an existing generated ClawMobile skill.",
      {
        type: "object",
        properties: {
          skill_dir: { type: "string" },
          skill_path: { type: "string" },
          skill_name: { type: "string" },
          outcome: { type: "string" },
          execution_summary: { type: "string" },
          failed_step: { type: "string" },
          failed_anchor: { type: "string" },
          used_anchors: { type: "array", items: { type: "string" } },
          parameters: { type: "object" },
          observations: { type: "object" },
          notes: { type: "string" },
          final_screenshot_path: { type: "string" },
          final_state: { type: "object" },
          tool_results: { type: "object" },
          repair_hint: { type: "string" },
        },
        required: ["outcome"],
        additionalProperties: false,
      },
      async (args) => clawmobile_skill_record_feedback(args)
    )
  );

  api.registerTool(
    toolDef(
      "clawmobile_skill_status",
      "Read compact structured status, execution guidance, verified contexts, and failure patterns for a generated ClawMobile skill. History, paths, validation, and detailed anchors are omitted by default to keep token use low.",
      {
        type: "object",
        properties: {
          skill_dir: { type: "string" },
          skill_path: { type: "string" },
          skill_name: { type: "string" },
          include_history: { type: "boolean" },
          include_feedback_log: { type: "boolean" },
          include_paths: { type: "boolean" },
          include_anchor_details: { type: "boolean" },
          include_open_uncertainties: { type: "boolean" },
          include_validation: { type: "boolean" },
          max_history: { type: "integer", minimum: 1, maximum: 50 },
          max_contexts: { type: "integer", minimum: 1, maximum: 25 },
          max_patterns: { type: "integer", minimum: 1, maximum: 25 },
        },
        additionalProperties: false,
      },
      async (args) => clawmobile_skill_status(args)
    )
  );

  api.registerTool(
    toolDef(
      "clawmobile_skill_run_fast_path",
      "Run an eligible generated ClawMobile skill fast path by skill name/path. Pass required skill variables in the top-level `parameters` object, or `parameter_values` as an alias. Loads generalized_skill.json, executes its deterministic batch steps, and optionally performs one final checkpoint plus feedback.",
      {
        type: "object",
        properties: {
          skill_dir: { type: "string" },
          skill_path: { type: "string" },
          skill_name: { type: "string" },
          parameters: {
            type: "object",
            description: "Required skill variables keyed by the names declared in generalized_skill.json intent.parameters. Example: {\"message_text\":\"hello\"}.",
            additionalProperties: true,
          },
          parameter_values: {
            type: "object",
            description: "Alias for parameters; use only if parameters is not already set.",
            additionalProperties: true,
          },
          dry_run: { type: "boolean" },
          allow_ineligible: { type: "boolean" },
          stop_on_error: { type: "boolean" },
          screenshot_on_failure: { type: "boolean" },
          max_steps: { type: "integer", minimum: 1, maximum: 50 },
          final_check_texts: {
            type: "array",
            items: { type: "string" },
            maxItems: 10,
          },
          final_check_mode: { type: "string" },
          final_check_all: { type: "boolean" },
          record_feedback: { type: "boolean" },
        },
        additionalProperties: false,
      },
      async (args) => clawmobile_skill_run_fast_path(args)
    )
  );

  api.registerTool(
    toolDef(
      "clawmobile_skill_reflect_fast_path_failure",
      "Record an agent diagnosis for a generated-skill fast-path failure and apply one safe, schema-bounded repair before retrying once.",
      {
        type: "object",
        properties: {
          skill_dir: { type: "string" },
          skill_path: { type: "string" },
          skill_name: { type: "string" },
          failed_step: { type: "string" },
          failed_anchor: { type: "string" },
          failure_summary: { type: "string" },
          diagnosis: { type: "string" },
          repair_goal: { type: "string" },
          repair_kind: { type: "string" },
          relax_entry_ui_text_checks: { type: "boolean" },
          remove_entry_ui_text_checks: { type: "boolean" },
          add_entry_ui_text_any: {
            type: "array",
            items: { type: "string" },
            maxItems: 12,
          },
          tap_text_repairs: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                step_id: { type: "string" },
                anchor: { type: "string" },
                texts: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 12,
                },
              },
              additionalProperties: false,
            },
          },
          mark_fast_path_ineligible: { type: "boolean" },
          notes: { type: "string" },
          previous_fast_path_result: { type: "object" },
        },
        required: ["diagnosis"],
        additionalProperties: false,
      },
      async (args) => clawmobile_skill_reflect_fast_path_failure(args)
    )
  );

  api.registerTool(
    toolDef(
      "clawmobile_batch_execute",
      "Execute a small deterministic ClawMobile Lite batch plan for generated-skill fast paths. No LLM/code execution; stops on structured failures.",
      {
        type: "object",
        properties: {
          label: { type: "string" },
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 50,
            items: batchStepSchema,
          },
          anchors: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                x_norm: { type: "number" },
                y_norm: { type: "number" },
              },
              additionalProperties: true,
            },
          },
          parameters: {
            type: "object",
            additionalProperties: true,
          },
          screen_width: { type: "integer", minimum: 1 },
          screen_height: { type: "integer", minimum: 1 },
          dry_run: { type: "boolean" },
          stop_on_error: { type: "boolean" },
          screenshot_on_failure: { type: "boolean" },
          max_steps: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["steps"],
        additionalProperties: false,
      },
      async (args) => clawmobile_batch_execute(args)
    )
  );

  // ---- device attention / completion ----
  api.registerTool(
    toolDef(
      "android_signal_complete",
      "Device-level completion signal (Termux:API vibrate/toast). Best-effort by default; set wait=true to block until local signals finish.",
      {
        type: "object",
        properties: {
          ms: { type: "integer", minimum: 1, maximum: 5000 },
          title: { type: "string" },
          content: { type: "string" },
          vibrate: { type: "boolean" },
          toast: { type: "boolean" },
          wait: { type: "boolean" }
        },
        additionalProperties: false
      },
      async (args) => android_signal_complete(args)
    )
  );

  // ---- raw adb primitives ----
  api.registerTool(
    toolDef(
      "adb_devices",
      "List adb devices and connection state.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => adb_devices()
    )
  );

  api.registerTool(
    toolDef(
      "adb_keyevent",
      "Send a key event via adb (HOME/BACK/RECENTS/ENTER or numeric keycode).",
      {
        type: "object",
        properties: {
          key: { type: "string", enum: ["HOME", "BACK", "RECENTS", "ENTER"] },
          keycode: { type: "integer" },
        },
        additionalProperties: false,
      },
      async (args) => adb_keyevent(args)
    )
  );

  api.registerTool(
    toolDef(
      "adb_ui_dump_xml",
      "Dump UIAutomator XML via adb and return the XML text.",
      { type: "object", properties: { compressed: { type: "boolean" } }, additionalProperties: false },
      async (args) => adb_ui_dump_xml(args)
    )
  );

  api.registerTool(
    toolDef(
      "adb_screenshot",
      "Take a screenshot via adb and return the saved PNG path plus image metadata.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => adb_screenshot()
    )
  );

  api.registerTool(
    toolDef(
      "adb_tap",
      "Tap at (x,y) via adb input.",
      {
        type: "object",
        properties: { x: { type: "integer" }, y: { type: "integer" } },
        required: ["x", "y"],
        additionalProperties: false,
      },
      async (args) => adb_tap(args)
    )
  );

  api.registerTool(
    toolDef(
      "adb_type",
      "Type text via adb input.",
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async (args) => adb_type(args)
    )
  );

  api.registerTool(
    toolDef(
      "adb_swipe",
      "Swipe via adb input.",
      {
        type: "object",
        properties: {
          x1: { type: "integer" },
          y1: { type: "integer" },
          x2: { type: "integer" },
          y2: { type: "integer" },
          durationMs: { type: "integer" },
        },
        required: ["x1", "y1", "x2", "y2"],
        additionalProperties: false,
      },
      async (args) => adb_swipe(args)
    )
  );

  // ---- raw termux primitives ----
  api.registerTool(
    toolDef(
      "tx_notify",
      "Send a local Termux notification.",
      {
        type: "object",
        properties: { title: { type: "string" }, content: { type: "string" } },
        required: ["title", "content"],
        additionalProperties: false,
      },
      async (args) => tx_notify(args)
    )
  );

  api.registerTool(
    toolDef(
      "tx_tts",
      "Speak text using Termux TTS.",
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async (args) => tx_tts(args)
    )
  );

  api.registerTool(
    toolDef(
      "tx_toast",
      "Show a Termux toast message.",
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async (args) => tx_toast(args)
    )
  );

  api.registerTool(
    toolDef(
      "tx_clipboard_get",
      "Read text from the Termux clipboard.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => tx_clipboard_get()
    )
  );

  api.registerTool(
    toolDef(
      "tx_clipboard_set",
      "Write text to the Termux clipboard.",
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async (args) => tx_clipboard_set(args)
    )
  );

  api.registerTool(
    toolDef(
      "tx_battery_status",
      "Read battery status from Termux.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => tx_battery_status()
    )
  );

  // ---- escape hatches / metadata ----
  api.registerTool(
    toolDef(
      "android_shell",
      "Fallback shell execution via backend: adb | termux | bash. Lite auto-detects whether adb is available.",
      {
        type: "object",
        properties: {
          backend: { type: "string", enum: liteMode ? ["adb", "termux"] : ["adb", "termux", "bash"] },
          cmd: { type: "string" },
          timeoutMs: { type: "integer" },
        },
        required: ["backend", "cmd"],
        additionalProperties: false,
      },
      async (args) => android_shell(args)
    )
  );

}

const pluginEntry = register as typeof register & {
  id: string;
  pluginId: string;
  displayName: string;
  description: string;
  register: typeof register;
  activate: typeof register;
};

pluginEntry.id = "openclaw-plugin-mobile-ui";
pluginEntry.pluginId = "openclaw-plugin-mobile-ui";
pluginEntry.displayName = "Mobile UI";
pluginEntry.description =
  "Android mobile runtime tools for OpenClaw. Set CLAWMOBILE_LITE=1 for capability-aware Termux/ADB Lite mode.";
pluginEntry.register = register;
pluginEntry.activate = register;

export { register };
export default pluginEntry;
