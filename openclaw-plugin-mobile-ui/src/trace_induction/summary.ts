import fs from "fs";
import os from "os";
import path from "path";
import { getWorkspaceDir } from "../tools/workspace";
import { TraceJson, TraceStep } from "../recording/types";

const SKILL_CANDIDATE_SCHEMA_VERSION = "clawmobile.skill_candidate.v1";
const TRACE_DIGEST_SCHEMA_VERSION = "clawmobile.trace_digest.v1";
const GROUNDING_TOLERANCE_NORM = 0.02;
const SOFT_KEYBOARD_KEY_Y_MIN_NORM = 0.6;
const SOFT_KEYBOARD_KEY_Y_MAX_NORM = 0.88;
const POST_TEXT_ACTION_X_MIN_NORM = 0.75;
const POST_TEXT_ACTION_Y_MIN_NORM = 0.35;
const POST_TEXT_ACTION_Y_MAX_NORM = 0.65;
const PRE_TEXT_TYPING_GAP_MS = 650;
const MAX_EMBEDDED_PRE_TEXT_ACTIONS = 3;

type PrepareInput = {
  recording_dir_or_trace_path?: string;
  recording_dir?: string;
  trace_path?: string;
  max_steps?: number;
  write_artifacts?: boolean;
};

type SaveInput = {
  recording_dir_or_trace_path?: string;
  recording_dir?: string;
  trace_path?: string;
  candidate: any;
  summary_markdown?: string;
};

type LoadedTrace = {
  recordingDir: string;
  tracePath: string;
  trace: TraceJson;
};

type AnchorPoint = {
  id: string;
  step_id: number;
  kind: "tap" | "long_press" | "swipe_start" | "swipe_end";
  x_norm: number;
  y_norm: number;
  x?: number;
  y?: number;
  role:
    | "recorded_touch"
    | "text_input_focus_candidate"
    | "soft_keyboard_key"
    | "possible_send_or_confirm";
  replay_allowed: boolean;
  replay_block_reason?: string;
  derived_cluster_id?: string;
  suggested_replay_action?: string;
  screenshot?: string | null;
  state?: {
    package?: string;
    activity?: string;
  };
};

type StepSemanticHint = {
  role: AnchorPoint["role"];
  replay_allowed: boolean;
  replay_block_reason?: string;
  derived_cluster_id?: string;
  suggested_replay_action?: string;
};

type TraceSemantics = {
  stepHints: Map<number, StepSemanticHint>;
  preTextInputActionCandidates: Array<{
    id: string;
    type: "text_entry_option_or_focus";
    source_step_id: number;
    source_anchor_id: string;
    x_norm: number;
    y_norm: number;
    replay_allowed: boolean;
    replay_block_reason?: string;
    suggested_replay_action: string;
    confidence: number;
    reason: string;
  }>;
  textInputClusters: Array<{
    id: string;
    type: "soft_keyboard_text_input";
    source_step_ids: number[];
    excluded_anchor_ids: string[];
    replay_action: "type_parameter";
    parameter_name: string;
    exclude_from_replay_anchors: boolean;
    confidence: number;
    reason: string;
  }>;
  postTextInputActionCandidates: Array<{
    id: string;
    type: "possible_send_or_confirm";
    source_step_id: number;
    source_anchor_id: string;
    x_norm: number;
    y_norm: number;
    confidence: number;
    reason: string;
  }>;
};

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function writeJsonFile(file: string, value: any) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sortedTraceSteps(trace: TraceJson) {
  return [...(trace.steps || [])].sort((a, b) => {
    const at = Number(a.start_time || 0);
    const bt = Number(b.start_time || 0);
    if (at !== bt) return at - bt;
    return Number(a.step_id || 0) - Number(b.step_id || 0);
  });
}

function resolveInputPath(input: PrepareInput | SaveInput) {
  const requested = String(
    input.trace_path || input.recording_dir || input.recording_dir_or_trace_path || ""
  ).trim();
  if (!requested) {
    throw new Error("recording_dir_or_trace_path, recording_dir, or trace_path is required");
  }
  return path.isAbsolute(requested) ? requested : path.join(getWorkspaceDir(), requested);
}

function loadTrace(input: PrepareInput | SaveInput): LoadedTrace {
  const requested = resolveInputPath(input);
  const stat = fs.existsSync(requested) ? fs.statSync(requested) : null;
  if (!stat) throw new Error(`trace input not found: ${requested}`);

  const tracePath = stat.isDirectory() ? path.join(requested, "trace.json") : requested;
  if (!fs.existsSync(tracePath)) throw new Error(`trace.json not found: ${tracePath}`);
  const recordingDir = path.dirname(tracePath);
  return { recordingDir, tracePath, trace: readJsonFile<TraceJson>(tracePath) };
}

function firstApp(trace: TraceJson) {
  const fallback = { package: "", activity: "" };
  for (const step of sortedTraceSteps(trace)) {
    const state = step.state || {};
    if (state.package || state.activity) {
      const app = {
        package: state.package || "",
        activity: state.activity || "",
      };
      if (!fallback.package && !fallback.activity) Object.assign(fallback, app);
      if (!/launcher/i.test(app.package)) return app;
    }
  }
  return fallback;
}

function screenshotPath(recordingDir: string, relPath: string | null | undefined) {
  if (!relPath) return null;
  return path.isAbsolute(relPath) ? relPath : path.join(recordingDir, relPath);
}

function isTapLikeStep(
  step: TraceStep
): step is Extract<TraceStep, { type: "tap" | "long_press" }> {
  return step.type === "tap" || step.type === "long_press";
}

function anchorIdForTapStep(step: Extract<TraceStep, { type: "tap" | "long_press" }>) {
  return `step_${step.step_id}_${step.type}`;
}

function isSoftKeyboardKeyZone(step: TraceStep) {
  return (
    isTapLikeStep(step) &&
    step.screen.y_norm >= SOFT_KEYBOARD_KEY_Y_MIN_NORM &&
    step.screen.y_norm <= SOFT_KEYBOARD_KEY_Y_MAX_NORM
  );
}

function isLikelyTextFocusStep(step: TraceStep) {
  return isTapLikeStep(step) && step.screen.y_norm > SOFT_KEYBOARD_KEY_Y_MAX_NORM;
}

function isLikelyTextEntryMenuTrigger(step: TraceStep) {
  return isTapLikeStep(step) && step.screen.x_norm >= 0.7 && step.screen.y_norm >= 0.8;
}

function touchGapMs(
  left: Extract<TraceStep, { type: "tap" | "long_press" }>,
  right: Extract<TraceStep, { type: "tap" | "long_press" }>
) {
  const leftEnd = Number(left.end_time || left.start_time || 0);
  const rightStart = Number(right.start_time || right.end_time || 0);
  return Math.max(0, (rightStart - leftEnd) * 1000);
}

function embeddedPreTextActionCount(
  cluster: Extract<TraceStep, { type: "tap" | "long_press" }>[],
  previous: TraceStep | null
) {
  if (cluster.length < 5) return 0;
  if (!isLikelyTextEntryMenuTrigger(cluster[0]) && !(previous && isLikelyTextEntryMenuTrigger(previous))) {
    return 0;
  }

  const maxIndex = Math.min(MAX_EMBEDDED_PRE_TEXT_ACTIONS - 1, cluster.length - 4);
  for (let index = maxIndex; index >= 0; index -= 1) {
    const tailLength = cluster.length - index - 1;
    if (tailLength < 3) continue;
    if (touchGapMs(cluster[index], cluster[index + 1]) >= PRE_TEXT_TYPING_GAP_MS) {
      return index + 1;
    }
  }
  return 0;
}

function isPostTextActionCandidate(step: TraceStep) {
  return (
    isTapLikeStep(step) &&
    step.screen.x_norm >= POST_TEXT_ACTION_X_MIN_NORM &&
    step.screen.y_norm >= POST_TEXT_ACTION_Y_MIN_NORM &&
    step.screen.y_norm <= POST_TEXT_ACTION_Y_MAX_NORM
  );
}

function inferTraceSemantics(trace: TraceJson): TraceSemantics {
  const steps = sortedTraceSteps(trace);
  const stepHints = new Map<number, StepSemanticHint>();
  const preTextInputActionCandidates: TraceSemantics["preTextInputActionCandidates"] = [];
  const textInputClusters: TraceSemantics["textInputClusters"] = [];
  const postTextInputActionCandidates: TraceSemantics["postTextInputActionCandidates"] = [];

  const flushCluster = (
    cluster: Extract<TraceStep, { type: "tap" | "long_press" }>[],
    startIndex: number
  ) => {
    if (cluster.length < 2) return;

    const sortedCluster = [...cluster].sort((a, b) => Number(a.start_time || 0) - Number(b.start_time || 0));
    const id = `text_input_cluster_${textInputClusters.length + 1}`;
    let textCluster = sortedCluster;
    let leadingActions: Extract<TraceStep, { type: "tap" | "long_press" }>[] = [];
    const previous = startIndex > 0 ? steps[startIndex - 1] : null;

    const embeddedLeadingCount = embeddedPreTextActionCount(sortedCluster, previous);
    const hasEmbeddedLeadingActions = embeddedLeadingCount > 0;
    if (embeddedLeadingCount > 0) {
      leadingActions = sortedCluster.slice(0, embeddedLeadingCount);
      textCluster = sortedCluster.slice(embeddedLeadingCount);
    } else if (previous && isLikelyTextEntryMenuTrigger(previous) && sortedCluster.length >= 4) {
      leadingActions = [sortedCluster[0]];
      textCluster = sortedCluster.slice(1);
    }

    for (const [leadingIndex, leadingAction] of leadingActions.entries()) {
      const sourceAnchorId = anchorIdForTapStep(leadingAction);
      const isAmbiguousEmbeddedOption = hasEmbeddedLeadingActions && leadingIndex > 0;
      const replayAllowed = !isAmbiguousEmbeddedOption;
      const replayBlockReason = isAmbiguousEmbeddedOption
        ? "Embedded pre-text tap is in the soft-keyboard band and may be a visible menu option, a focus tap, or an accidental tap; use text/UI grounding instead of coordinate replay."
        : undefined;
      const suggestedReplayAction = isAmbiguousEmbeddedOption
        ? "tap_text_or_reground_then_type_parameter"
        : hasEmbeddedLeadingActions
          ? "tap_anchor_then_ground_text_entry_option"
          : "tap_anchor_then_type_parameter";
      preTextInputActionCandidates.push({
        id: `pre_text_input_action_${preTextInputActionCandidates.length + 1}`,
        type: "text_entry_option_or_focus",
        source_step_id: leadingAction.step_id,
        source_anchor_id: sourceAnchorId,
        x_norm: leadingAction.screen.x_norm,
        y_norm: leadingAction.screen.y_norm,
        replay_allowed: replayAllowed,
        replay_block_reason: replayBlockReason,
        suggested_replay_action: suggestedReplayAction,
        confidence: replayAllowed ? 0.65 : 0.45,
        reason: isAmbiguousEmbeddedOption
          ? "Soft-keyboard-zone tap before sustained typing, but it is embedded among multiple pre-text taps. Keep it as evidence for a text-entry route; do not replay its coordinate unless separately grounded."
          : hasEmbeddedLeadingActions
            ? "First soft-keyboard-zone tap before a text-entry menu/route; likely opens text-entry options before a later visible option is selected."
            : "Soft-keyboard-zone tap before sustained typing; likely selects a text-entry mode/menu option before actual keyboard text input.",
      });
      stepHints.set(leadingAction.step_id, {
        role: "text_input_focus_candidate",
        replay_allowed: replayAllowed,
        replay_block_reason: replayBlockReason,
        derived_cluster_id: id,
        suggested_replay_action: suggestedReplayAction,
      });
    }

    if (textCluster.length < 2) return;

    const excludedAnchorIds = textCluster.map((step) => anchorIdForTapStep(step));
    const confidence = textCluster.length >= 3 ? 0.75 : 0.55;
    textInputClusters.push({
      id,
      type: "soft_keyboard_text_input",
      source_step_ids: textCluster.map((step) => step.step_id),
      excluded_anchor_ids: excludedAnchorIds,
      replay_action: "type_parameter",
      parameter_name: "message_text",
      exclude_from_replay_anchors: true,
      confidence,
      reason:
        "Consecutive taps landed in the soft-keyboard key band; replay should use a text input action instead of individual key taps.",
    });

    for (const step of textCluster) {
      stepHints.set(step.step_id, {
        role: "soft_keyboard_key",
        replay_allowed: false,
        replay_block_reason:
          "Human soft-keyboard taps should be abstracted to type_parameter/android_type during skill replay.",
        derived_cluster_id: id,
        suggested_replay_action: "type_parameter",
      });
    }
  };

  let cluster: Extract<TraceStep, { type: "tap" | "long_press" }>[] = [];
  let clusterStartIndex = -1;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (isTapLikeStep(step) && isSoftKeyboardKeyZone(step)) {
      if (cluster.length === 0) clusterStartIndex = index;
      cluster.push(step);
      continue;
    }
    flushCluster(cluster, clusterStartIndex);
    cluster = [];
    clusterStartIndex = -1;
  }
  flushCluster(cluster, clusterStartIndex);

  for (const textCluster of textInputClusters) {
    const firstStepId = textCluster.source_step_ids[0];
    const lastStepId = textCluster.source_step_ids[textCluster.source_step_ids.length - 1];
    const firstIndex = steps.findIndex((step) => step.step_id === firstStepId);
    const lastIndex = steps.findIndex((step) => step.step_id === lastStepId);

    if (firstIndex > 0) {
      const previous = steps[firstIndex - 1];
      if (isLikelyTextFocusStep(previous) && !stepHints.has(previous.step_id)) {
        stepHints.set(previous.step_id, {
          role: "text_input_focus_candidate",
          replay_allowed: true,
          derived_cluster_id: textCluster.id,
          suggested_replay_action: "tap_anchor_then_type_parameter",
        });
      }
    }

    if (lastIndex >= 0) {
      for (const step of steps.slice(lastIndex + 1)) {
        if (!isTapLikeStep(step)) continue;
        if (isSoftKeyboardKeyZone(step)) continue;
        if (!isPostTextActionCandidate(step)) break;

        const sourceAnchorId = anchorIdForTapStep(step);
        postTextInputActionCandidates.push({
          id: `post_text_action_${postTextInputActionCandidates.length + 1}`,
          type: "possible_send_or_confirm",
          source_step_id: step.step_id,
          source_anchor_id: sourceAnchorId,
          x_norm: step.screen.x_norm,
          y_norm: step.screen.y_norm,
          confidence: 0.7,
          reason:
            "First right-side tap after a soft-keyboard text input cluster, outside the keyboard key band.",
        });
        if (!stepHints.has(step.step_id)) {
          stepHints.set(step.step_id, {
            role: "possible_send_or_confirm",
            replay_allowed: true,
            derived_cluster_id: textCluster.id,
            suggested_replay_action: "tap_anchor_after_type_parameter",
          });
        }
        break;
      }
    }
  }

  return { stepHints, preTextInputActionCandidates, textInputClusters, postTextInputActionCandidates };
}

function semanticHintForStep(semantics: TraceSemantics, step: TraceStep): StepSemanticHint {
  return (
    semantics.stepHints.get(step.step_id) || {
      role: "recorded_touch",
      replay_allowed: true,
    }
  );
}

function digestSemantics(semantics: TraceSemantics) {
  return {
    pre_text_input_action_candidates: semantics.preTextInputActionCandidates,
    text_input_clusters: semantics.textInputClusters,
    post_text_input_action_candidates: semantics.postTextInputActionCandidates,
    guidance: [
      "Preserve pre_text_input_action_candidates as evidence before the matching type_parameter step.",
      "Use a pre_text_input_action_candidate as a tap anchor only when replay_allowed=true.",
      "If a pre_text_input_action_candidate has replay_allowed=false, prefer semantic UI/text grounding such as tap_text for the visible option, then continue with type_parameter.",
      "Soft-keyboard text_input_clusters are evidence of human typing. Convert them to a type_parameter step instead of replaying individual key taps.",
      "Anchors with replay_allowed=false must not be used as tap_anchor replay targets.",
      "For send/confirm after typing, prefer post_text_input_action_candidates over soft-keyboard key anchors.",
    ],
  };
}

function stepToDigest(recordingDir: string, step: TraceStep, semantics: TraceSemantics) {
  const semanticHint = semanticHintForStep(semantics, step);
  const common = {
    step_id: step.step_id,
    type: step.type,
    start_time: step.start_time,
    end_time: step.end_time,
    duration_ms: step.duration_ms,
    semantic_role: semanticHint.role,
    replay_allowed: semanticHint.replay_allowed,
    replay_block_reason: semanticHint.replay_block_reason,
    derived_cluster_id: semanticHint.derived_cluster_id,
    suggested_replay_action: semanticHint.suggested_replay_action,
    before_screenshot: step.before_screenshot,
    before_screenshot_path: screenshotPath(recordingDir, step.before_screenshot),
    after_screenshot: step.after_screenshot,
    after_screenshot_path: screenshotPath(recordingDir, step.after_screenshot),
    state: step.state
      ? {
          package: step.state.package,
          activity: step.state.activity,
          orientation: step.state.orientation,
        }
      : null,
  };

  if (step.type === "swipe") {
    return {
      ...common,
      distance_px: step.distance_px,
      movement_px: step.movement_px,
      raw: step.raw,
      screen: step.screen,
    };
  }

  return {
    ...common,
    movement_px: step.movement_px,
    raw: step.raw,
    screen: step.screen,
  };
}

function allowedAnchorPoints(trace: TraceJson, semantics = inferTraceSemantics(trace)): AnchorPoint[] {
  const anchors: AnchorPoint[] = [];
  for (const step of sortedTraceSteps(trace)) {
    const state = step.state
      ? { package: step.state.package, activity: step.state.activity }
      : undefined;
    const semanticHint = semanticHintForStep(semantics, step);
    if (step.type === "tap" || step.type === "long_press") {
      anchors.push({
        id: anchorIdForTapStep(step),
        step_id: step.step_id,
        kind: step.type,
        x_norm: step.screen.x_norm,
        y_norm: step.screen.y_norm,
        x: step.screen.x,
        y: step.screen.y,
        role: semanticHint.role,
        replay_allowed: semanticHint.replay_allowed,
        replay_block_reason: semanticHint.replay_block_reason,
        derived_cluster_id: semanticHint.derived_cluster_id,
        suggested_replay_action: semanticHint.suggested_replay_action,
        screenshot: step.before_screenshot || step.after_screenshot,
        state,
      });
    } else {
      const screen = step.screen as Extract<TraceStep, { type: "swipe" }>["screen"];
      anchors.push({
        id: `step_${step.step_id}_swipe_start`,
        step_id: step.step_id,
        kind: "swipe_start",
        x_norm: screen.start_x_norm,
        y_norm: screen.start_y_norm,
        x: screen.start_x,
        y: screen.start_y,
        role: "recorded_touch",
        replay_allowed: true,
        screenshot: step.before_screenshot || step.after_screenshot,
        state,
      });
      anchors.push({
        id: `step_${step.step_id}_swipe_end`,
        step_id: step.step_id,
        kind: "swipe_end",
        x_norm: screen.end_x_norm,
        y_norm: screen.end_y_norm,
        x: screen.end_x,
        y: screen.end_y,
        role: "recorded_touch",
        replay_allowed: true,
        screenshot: step.after_screenshot || step.before_screenshot,
        state,
      });
    }
  }
  return anchors;
}

function candidateJsonSchema() {
  return {
    type: "object",
    required: ["schema_version", "source_trace_id", "task_summary", "app", "intent", "anchors", "steps"],
    additionalProperties: true,
    properties: {
      schema_version: { const: SKILL_CANDIDATE_SCHEMA_VERSION },
      source_trace_id: { type: "string" },
      task_summary: { type: "string" },
      app: {
        type: "object",
        properties: {
          package: { type: "string" },
          activity: { type: "string" },
        },
        additionalProperties: true,
      },
      intent: {
        type: "object",
        required: ["name", "description", "parameters"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          parameters: { type: "object" },
        },
        additionalProperties: true,
      },
      preconditions: { type: "array", items: { type: "string" } },
      entry_state_checks: {
        type: "object",
        additionalProperties: true,
        properties: {
          after_app_open: {
            type: "object",
            additionalProperties: true,
            properties: {
              package: { type: "string" },
              activity: { type: "string" },
              ui_text_any: { type: "array", items: { type: "string" }, maxItems: 8 },
              ui_text_all: { type: "array", items: { type: "string" }, maxItems: 8 },
            },
          },
        },
      },
      anchors: {
        type: "object",
        additionalProperties: {
          type: "object",
          required: ["type", "x_norm", "y_norm"],
          additionalProperties: true,
          properties: {
            type: { const: "coordinate_anchor" },
            source_step_id: { type: "integer" },
            source_anchor_id: { type: "string" },
            x_norm: { type: "number", minimum: 0, maximum: 1 },
            y_norm: { type: "number", minimum: 0, maximum: 1 },
            x: { type: "number" },
            y: { type: "number" },
            evidence: { type: "array", items: { type: "string" } },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      steps: { type: "array", items: { type: "object" } },
      verification: { type: "array", items: { type: "string" } },
      fallback: { type: "array", items: { type: "string" } },
      warnings: { type: "array", items: { type: "string" } },
    },
  };
}

function groundingRules() {
  return [
    "Infer semantics from the trace, but only cite evidence present in trace_digest.",
    "Do not invent coordinates. Every coordinate anchor must be copied from trace_digest.allowed_anchors.",
    "Every anchor object must use type=\"coordinate_anchor\" and include x_norm, y_norm, source_step_id, source_anchor_id, evidence, and confidence.",
    "Use trace_digest.derived_semantics.pre_text_input_action_candidates as evidence for taps that select a text-entry mode or menu option immediately before keyboard typing.",
    "Only preserve a pre-text-input action as a tap_anchor when its candidate/allowed anchor has replay_allowed=true.",
    "When a pre-text-input candidate has replay_allowed=false, use semantic text/UI grounding such as tap_text for the visible option instead of replaying its coordinate.",
    "Use trace_digest.derived_semantics.text_input_clusters for human typing; convert those clusters to type_parameter steps instead of replaying individual soft-keyboard taps.",
    "Do not use anchors where replay_allowed=false as tap_anchor replay targets.",
    "When a text input cluster exists, prefer trace_digest.derived_semantics.post_text_input_action_candidates for send or confirm anchors.",
    "Prefer normalized coordinates for anchors; keep raw screenshots as evidence paths.",
    "Parameterize user-provided variable text, such as a message body, instead of hardcoding it.",
    "When the procedure opens or switches into an app, include entry_state_checks.after_app_open with package/activity and only stable visible UI text that can cheaply confirm the expected app state. Omit UI text if it is not clearly visible in the trace.",
    "Do not include execution or replay claims; this is only a skill candidate draft.",
  ];
}

function inductionPrompt() {
  return [
    "You are helping convert a recorded smartphone demonstration trace into a reusable ClawMobile skill candidate.",
    "Infer the demonstrated task, identify meaningful anchors from recorded actions and screenshots, parameterize variable user inputs, propose preconditions, verification rules, and fallback behavior.",
    "Only use evidence from the trace digest. Return valid JSON matching candidate_schema.",
    "Do not invent coordinates. For anchors, copy x_norm/y_norm/source_step_id/source_anchor_id from trace_digest.allowed_anchors.",
    "Preserve pre_text_input_action_candidates as evidence before the related type_parameter step; use them as tap anchors only when replay_allowed=true.",
    "For pre_text_input_action_candidates with replay_allowed=false, prefer semantic UI/text grounding such as tap_text for the visible menu option.",
    "Human soft-keyboard taps must be summarized as type_parameter actions, not replayed as individual tap anchors.",
    "For app entry, add a minimal entry_state_checks.after_app_open checkpoint using package/activity plus stable visible UI text when available; this is for fast-path gating, not per-step verification.",
  ].join(" ");
}

function buildTraceDigest(loaded: LoadedTrace, maxSteps: number) {
  const app = firstApp(loaded.trace);
  const semantics = inferTraceSemantics(loaded.trace);
  const anchors = allowedAnchorPoints(loaded.trace, semantics);
  return {
    schema_version: TRACE_DIGEST_SCHEMA_VERSION,
    trace_id: loaded.trace.trace_id,
    trace_path: loaded.tracePath,
    recording_dir: loaded.recordingDir,
    task_hint: loaded.trace.task_hint || "",
    app,
    device: loaded.trace.device,
    artifacts: loaded.trace.artifacts,
    warnings: loaded.trace.warnings || [],
    derived_semantics: digestSemantics(semantics),
    steps: sortedTraceSteps(loaded.trace)
      .slice(0, maxSteps)
      .map((step) => stepToDigest(loaded.recordingDir, step, semantics)),
    omitted_steps: Math.max(0, (loaded.trace.steps || []).length - maxSteps),
    allowed_anchors: anchors,
  };
}

function writeTraceSummaryArtifacts(loaded: LoadedTrace, digest: any) {
  writeJsonFile(path.join(loaded.recordingDir, "trace_digest.json"), digest);
  fs.writeFileSync(
    path.join(loaded.recordingDir, "trace_summary_prompt.md"),
    `${inductionPrompt()}\n\nGrounding rules:\n${groundingRules().map((rule) => `- ${rule}`).join("\n")}\n`
  );
}

export function prepareTraceSummary(input: PrepareInput) {
  const loaded = loadTrace(input);
  const maxSteps = Math.max(1, Math.min(Number(input.max_steps || 50), 200));
  const digest = buildTraceDigest(loaded, maxSteps);

  const result = {
    ok: true,
    trace_id: loaded.trace.trace_id,
    recording_dir: loaded.recordingDir,
    trace_path: loaded.tracePath,
    prompt: inductionPrompt(),
    grounding_rules: groundingRules(),
    candidate_schema: candidateJsonSchema(),
    trace_digest: digest,
    next_tool: "clawmobile_trace_save_skill_candidate",
  };

  if (input.write_artifacts !== false) {
    writeTraceSummaryArtifacts(loaded, digest);
  }

  return result;
}

function asObjectCandidate(candidate: any) {
  if (typeof candidate === "string") return JSON.parse(candidate);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("candidate must be a JSON object or a JSON object string");
  }
  return JSON.parse(JSON.stringify(candidate));
}

function asArrayOfStrings(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter((item) => item.trim());
}

function normalizeCandidate(candidate: any, trace: TraceJson) {
  const app = firstApp(trace);
  const normalized = {
    ...(candidate && typeof candidate === "object" ? candidate : {}),
    schema_version: SKILL_CANDIDATE_SCHEMA_VERSION,
    source_trace_id: String(candidate.source_trace_id || trace.trace_id || ""),
    task_summary: String(candidate.task_summary || trace.task_hint || "Draft skill candidate from recorded trace."),
    app: {
      package: String(candidate.app?.package || app.package || ""),
      activity: String(candidate.app?.activity || app.activity || ""),
      ...(candidate.app && typeof candidate.app === "object" ? candidate.app : {}),
    },
    intent: {
      name: String(candidate.intent?.name || trace.task_hint || "recorded_mobile_task"),
      description: String(candidate.intent?.description || candidate.task_summary || trace.task_hint || ""),
      parameters:
        candidate.intent?.parameters && typeof candidate.intent.parameters === "object"
          ? candidate.intent.parameters
          : {},
    },
    preconditions: asArrayOfStrings(candidate.preconditions),
    anchors:
      candidate.anchors && typeof candidate.anchors === "object" && !Array.isArray(candidate.anchors)
        ? candidate.anchors
        : {},
    steps: Array.isArray(candidate.steps) ? candidate.steps : [],
    verification: asArrayOfStrings(candidate.verification),
    fallback: asArrayOfStrings(candidate.fallback),
    warnings: asArrayOfStrings(candidate.warnings),
  };
  return normalized;
}

function nearestAnchor(
  anchors: AnchorPoint[],
  xNorm: number,
  yNorm: number
): { anchor: AnchorPoint; distance: number } | null {
  let best: { anchor: AnchorPoint; distance: number } | null = null;
  for (const anchor of anchors) {
    const distance = Math.hypot(anchor.x_norm - xNorm, anchor.y_norm - yNorm);
    if (!best || distance < best.distance) best = { anchor, distance };
  }
  return best;
}

function anchorById(anchors: AnchorPoint[], id: unknown): AnchorPoint | null {
  if (typeof id !== "string" || !id.trim()) return null;
  return anchors.find((anchor) => anchor.id === id.trim()) || null;
}

function anchorByStepId(anchors: AnchorPoint[], stepId: unknown): AnchorPoint | null {
  const numericStepId = Number(stepId);
  if (!Number.isInteger(numericStepId)) return null;
  const matches = anchors.filter((anchor) => anchor.step_id === numericStepId);
  return matches.length === 1 ? matches[0] : null;
}

function referencedAnchor(anchor: any, anchors: AnchorPoint[]): AnchorPoint | null {
  if (typeof anchor === "string") return anchorById(anchors, anchor);
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return null;
  return (
    anchorById(anchors, anchor.source_anchor_id) ||
    anchorById(anchors, anchor.coordinate_anchor) ||
    anchorById(anchors, anchor.anchor_id) ||
    anchorByStepId(anchors, anchor.source_step_id)
  );
}

function evidenceWithAnchor(anchor: any, allowed: AnchorPoint) {
  const evidence = Array.isArray(anchor?.evidence) ? anchor.evidence.map(String) : [];
  return Array.from(new Set([...evidence, allowed.id, ...(allowed.screenshot ? [allowed.screenshot] : [])]));
}

function groundedAnchorObject(anchor: any, allowed: AnchorPoint) {
  const source = anchor && typeof anchor === "object" && !Array.isArray(anchor) ? anchor : {};
  const { coordinate_anchor, anchor_id, ...rest } = source;
  const confidence = Number(rest.confidence);
  return {
    ...rest,
    type: "coordinate_anchor",
    x_norm: allowed.x_norm,
    y_norm: allowed.y_norm,
    x: allowed.x,
    y: allowed.y,
    source_step_id: allowed.step_id,
    source_anchor_id: allowed.id,
    role: allowed.role,
    replay_allowed: allowed.replay_allowed,
    replay_block_reason: allowed.replay_block_reason,
    derived_cluster_id: allowed.derived_cluster_id,
    suggested_replay_action: allowed.suggested_replay_action,
    evidence: evidenceWithAnchor(source, allowed),
    confidence: Number.isFinite(confidence) ? confidence : 0.6,
  };
}

function validateAndGroundAnchors(candidate: any, trace: TraceJson) {
  const warnings: string[] = [];
  const anchors = allowedAnchorPoints(trace);
  const grounded: Record<string, any> = {};
  const rejected: Record<string, any> = {};

  for (const [name, value] of Object.entries(candidate.anchors || {})) {
    const anchor =
      value && typeof value === "object" && !Array.isArray(value) ? { ...(value as any) } : value;
    const allowed = referencedAnchor(anchor, anchors);
    const anchorObject = anchor && typeof anchor === "object" && !Array.isArray(anchor) ? anchor : {};
    const hasCoordinateShortcut =
      typeof anchor === "string" || typeof anchorObject.coordinate_anchor === "string";
    const hasCoordinateType = anchorObject.type === "coordinate_anchor";
    const hasCoordinateValues = "x_norm" in anchorObject || "y_norm" in anchorObject;

    if (allowed && (hasCoordinateShortcut || hasCoordinateType || hasCoordinateValues || anchorObject.source_step_id)) {
      if (hasCoordinateShortcut && !hasCoordinateType) {
        warnings.push(`anchor ${name}: normalized coordinate_anchor shorthand to grounded coordinate object`);
      } else if (!hasCoordinateType) {
        warnings.push(`anchor ${name}: missing type=coordinate_anchor; normalized from trace reference`);
      }

      const xNorm = Number(anchorObject.x_norm);
      const yNorm = Number(anchorObject.y_norm);
      if (Number.isFinite(xNorm) && Number.isFinite(yNorm)) {
        const distance = Math.hypot(allowed.x_norm - xNorm, allowed.y_norm - yNorm);
        if (distance > GROUNDING_TOLERANCE_NORM) {
          warnings.push(`anchor ${name}: supplied coordinates differed from ${allowed.id}; normalized to recorded trace coordinates`);
        }
      }

      if (!allowed.replay_allowed) {
        warnings.push(
          `anchor ${name}: ${allowed.id} is ${allowed.role} and cannot be used as a replay anchor; use ${allowed.suggested_replay_action || "type_parameter"} instead`
        );
        rejected[name] = {
          ...groundedAnchorObject(anchorObject, allowed),
          confidence: 0,
          grounding_error: "replay_disallowed_anchor",
        };
        continue;
      }

      grounded[name] = groundedAnchorObject(anchorObject, allowed);
      continue;
    }

    if (!hasCoordinateType && !hasCoordinateValues && !hasCoordinateShortcut) {
      warnings.push(`anchor ${name}: unsupported anchor shape; expected a coordinate_anchor grounded in allowed_anchors`);
      rejected[name] = {
        ...(typeof anchorObject === "object" ? anchorObject : { value: anchor }),
        confidence: 0,
        grounding_error: "unsupported_anchor_shape",
      };
      continue;
    }

    const xNorm = Number(anchorObject.x_norm);
    const yNorm = Number(anchorObject.y_norm);
    if (!Number.isFinite(xNorm) || !Number.isFinite(yNorm)) {
      warnings.push(`anchor ${name}: coordinate_anchor missing numeric x_norm/y_norm`);
      rejected[name] = { ...anchorObject, confidence: 0, grounding_error: "missing_numeric_coordinate" };
      continue;
    }

    const nearest = nearestAnchor(anchors, xNorm, yNorm);
    if (!nearest || nearest.distance > GROUNDING_TOLERANCE_NORM) {
      warnings.push(`anchor ${name}: coordinate does not match a recorded trace step`);
      rejected[name] = {
        ...anchor,
        confidence: 0,
        grounding_error: "coordinate_not_grounded_in_trace",
      };
      continue;
    }

    if (!nearest.anchor.replay_allowed) {
      warnings.push(
        `anchor ${name}: ${nearest.anchor.id} is ${nearest.anchor.role} and cannot be used as a replay anchor; use ${nearest.anchor.suggested_replay_action || "type_parameter"} instead`
      );
      rejected[name] = {
        ...groundedAnchorObject(anchorObject, nearest.anchor),
        confidence: 0,
        grounding_error: "replay_disallowed_anchor",
      };
      continue;
    }

    grounded[name] = groundedAnchorObject(anchorObject, nearest.anchor);
  }

  return { anchors: grounded, rejected, warnings };
}

function candidateShapeWarnings(candidate: any, trace: TraceJson) {
  const warnings: string[] = [];
  if (!candidate.schema_version) warnings.push("candidate missing schema_version");
  if (candidate.schema_version && candidate.schema_version !== SKILL_CANDIDATE_SCHEMA_VERSION) {
    warnings.push(`candidate schema_version was ${candidate.schema_version}; normalized to ${SKILL_CANDIDATE_SCHEMA_VERSION}`);
  }
  if (!candidate.source_trace_id) warnings.push("candidate missing source_trace_id");
  if (candidate.source_trace_id && candidate.source_trace_id !== trace.trace_id) {
    warnings.push(`candidate source_trace_id ${candidate.source_trace_id} did not match trace ${trace.trace_id}; normalized`);
  }
  if (!candidate.task_summary) warnings.push("candidate missing task_summary");
  if (!candidate.intent?.name) warnings.push("candidate missing intent.name");
  if (!candidate.intent?.description) warnings.push("candidate missing intent.description");
  if (!candidate.anchors || typeof candidate.anchors !== "object") warnings.push("candidate missing anchors object");
  if (!Array.isArray(candidate.steps)) warnings.push("candidate missing steps array");
  return warnings;
}

function sanitizeStepCoordinates(candidate: any) {
  const warnings: string[] = [];
  const steps = Array.isArray(candidate.steps) ? candidate.steps : [];
  candidate.steps = steps.map((step: any, index: number) => {
    if (!step || typeof step !== "object") return step;
    const sanitized = { ...step };
    for (const key of ["x_norm", "y_norm", "x", "y", "coordinate", "screen", "raw"]) {
      if (key in sanitized) {
        delete sanitized[key];
        warnings.push(`steps[${index}]: removed direct coordinate field ${key}; use a grounded anchor target`);
      }
    }
    return sanitized;
  });
  return warnings;
}

function validateStepAnchorTargets(candidate: any) {
  const warnings: string[] = [];
  const availableAnchors = new Set(Object.keys(candidate.anchors || {}));
  const steps = Array.isArray(candidate.steps) ? candidate.steps : [];
  steps.forEach((step: any, index: number) => {
    if (!step || typeof step !== "object") return;
    const target = typeof step.anchor === "string" ? step.anchor : step.target;
    const action = String(step.action || "");
    if (
      typeof target === "string" &&
      target.trim() &&
      (action === "tap_anchor" || action.includes("anchor")) &&
      !availableAnchors.has(target)
    ) {
      warnings.push(`steps[${index}]: references missing or rejected anchor ${target}`);
    }
  });
  return warnings;
}

function renderSummaryMarkdown(candidate: any, validationWarnings: string[]) {
  const lines: string[] = [];
  lines.push(`# ${candidate.intent?.name || "Skill Candidate"}`);
  lines.push("");
  lines.push(candidate.task_summary || candidate.intent?.description || "Draft skill candidate.");
  lines.push("");
  lines.push("## App");
  lines.push(`- Package: ${candidate.app?.package || ""}`);
  lines.push(`- Activity: ${candidate.app?.activity || ""}`);
  lines.push("");
  lines.push("## Intent");
  lines.push(`- Description: ${candidate.intent?.description || ""}`);
  lines.push(`- Parameters: ${JSON.stringify(candidate.intent?.parameters || {})}`);
  lines.push("");
  lines.push("## Anchors");
  for (const [name, anchor] of Object.entries(candidate.anchors || {})) {
    lines.push(`- ${name}: ${JSON.stringify(anchor)}`);
  }
  lines.push("");
  lines.push("## Steps");
  (candidate.steps || []).forEach((step: any, index: number) => {
    lines.push(`${index + 1}. ${JSON.stringify(step)}`);
  });
  lines.push("");
  lines.push("## Verification");
  for (const item of candidate.verification || []) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## Fallback");
  for (const item of candidate.fallback || []) lines.push(`- ${item}`);
  if (validationWarnings.length > 0 || (candidate.warnings || []).length > 0) {
    lines.push("");
    lines.push("## Warnings");
    for (const item of [...(candidate.warnings || []), ...validationWarnings]) lines.push(`- ${item}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function saveSkillCandidate(input: SaveInput) {
  const loaded = loadTrace(input);
  const digest = buildTraceDigest(loaded, 50);
  const parsed = asObjectCandidate(input.candidate);
  const shapeWarnings = candidateShapeWarnings(parsed, loaded.trace);
  const candidate = normalizeCandidate(parsed, loaded.trace);
  candidate.source_trace_id = loaded.trace.trace_id;
  const anchorValidation = validateAndGroundAnchors(candidate, loaded.trace);
  const stepWarnings = sanitizeStepCoordinates(candidate);

  candidate.anchors = anchorValidation.anchors;
  const stepTargetWarnings = validateStepAnchorTargets(candidate);
  const validationWarnings = [...shapeWarnings, ...anchorValidation.warnings, ...stepWarnings, ...stepTargetWarnings];
  candidate.validation = {
    grounded_anchor_count: Object.keys(anchorValidation.anchors).length,
    rejected_anchor_count: Object.keys(anchorValidation.rejected).length,
    rejected_anchors: anchorValidation.rejected,
    warnings: validationWarnings,
  };
  candidate.warnings = Array.from(new Set([...(candidate.warnings || []), ...validationWarnings]));

  const candidatePath = path.join(loaded.recordingDir, "skill_candidate.json");
  const summaryPath = path.join(loaded.recordingDir, "skill_summary.md");
  ensureDir(loaded.recordingDir);
  writeTraceSummaryArtifacts(loaded, digest);
  writeJsonFile(candidatePath, candidate);
  fs.writeFileSync(summaryPath, input.summary_markdown || renderSummaryMarkdown(candidate, validationWarnings));

  return {
    ok: true,
    trace_id: loaded.trace.trace_id,
    recording_dir: loaded.recordingDir,
    skill_candidate_path: candidatePath,
    skill_summary_path: summaryPath,
    warnings: candidate.warnings,
    validation: candidate.validation,
  };
}

export function createMockTraceDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawmobile-trace-induction-"));
  const trace: TraceJson = {
    trace_id: "mock_trace",
    task_hint: "mock.send_message",
    created_at: "2026-05-12T00:00:00.000Z",
    device: {
      screen_width: 1080,
      screen_height: 2424,
      touch_device: "/dev/input/event2",
      touch_axis: { x_min: 0, x_max: 10799, y_min: 0, y_max: 24239 },
    },
    artifacts: {
      events_log: "events.log",
      screens_dir: "screens/",
      screens_index: "screens.jsonl",
      states_log: "states.jsonl",
    },
    steps: [
      {
        step_id: 1,
        type: "tap",
        start_time: 100,
        end_time: 100.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 5400, y: 12000 },
        screen: { x: 540, y: 1200, x_norm: 0.5, y_norm: 0.5 },
        before_screenshot: "screens/before.png",
        after_screenshot: "screens/after.png",
        state: { package: "com.example", activity: "com.example.MainActivity" },
      },
    ],
    warnings: [],
  };
  writeJsonFile(path.join(dir, "trace.json"), trace);
  return dir;
}

export function createMockTextInputTraceDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawmobile-trace-induction-text-"));
  const baseState = { package: "com.tencent.mm", activity: "com.tencent.mm.ui.LauncherUI" };
  const trace: TraceJson = {
    trace_id: "mock_text_input_trace",
    task_hint: "wechat.send_message",
    created_at: "2026-05-12T00:00:00.000Z",
    device: {
      screen_width: 1080,
      screen_height: 2424,
      touch_device: "/dev/input/event2",
      touch_axis: { x_min: 0, x_max: 10799, y_min: 0, y_max: 24239 },
    },
    artifacts: {
      events_log: "events.log",
      screens_dir: "screens/",
      screens_index: "screens.jsonl",
      states_log: "states.jsonl",
    },
    steps: [
      {
        step_id: 1,
        type: "tap",
        start_time: 100,
        end_time: 100.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 2900, y: 3930 },
        screen: { x: 291, y: 393, x_norm: 0.269284, y_norm: 0.162177 },
        before_screenshot: "screens/chat-list.png",
        after_screenshot: "screens/chat.png",
        state: baseState,
      },
      {
        step_id: 2,
        type: "tap",
        start_time: 101,
        end_time: 101.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 5220, y: 22700 },
        screen: { x: 522, y: 2270, x_norm: 0.4831, y_norm: 0.936507 },
        before_screenshot: "screens/chat.png",
        after_screenshot: "screens/keyboard.png",
        state: baseState,
      },
      {
        step_id: 3,
        type: "tap",
        start_time: 102,
        end_time: 102.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 6540, y: 18540 },
        screen: { x: 654, y: 1854, x_norm: 0.605612, y_norm: 0.764801 },
        before_screenshot: "screens/keyboard.png",
        after_screenshot: "screens/keyboard-h.png",
        state: baseState,
      },
      {
        step_id: 4,
        type: "tap",
        start_time: 103,
        end_time: 103.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 9760, y: 18570 },
        screen: { x: 976, y: 1857, x_norm: 0.904158, y_norm: 0.766121 },
        before_screenshot: "screens/keyboard-h.png",
        after_screenshot: "screens/keyboard-hi.png",
        state: baseState,
      },
      {
        step_id: 5,
        type: "tap",
        start_time: 104,
        end_time: 104.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 10080, y: 13540 },
        screen: { x: 1008, y: 1354, x_norm: 0.93342, y_norm: 0.558439 },
        before_screenshot: "screens/keyboard-hi.png",
        after_screenshot: "screens/sent.png",
        state: baseState,
      },
    ],
    warnings: [],
  };
  writeJsonFile(path.join(dir, "trace.json"), trace);
  return dir;
}

export function createMockMenuThenTextInputTraceDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawmobile-trace-induction-menu-text-"));
  const baseState = { package: "com.google.android.keep", activity: "com.google.android.keep.activities.BrowseActivity" };
  const trace: TraceJson = {
    trace_id: "mock_menu_then_text_input_trace",
    task_hint: "keep.create_note",
    created_at: "2026-05-12T00:00:00.000Z",
    device: {
      screen_width: 1080,
      screen_height: 2424,
      touch_device: "/dev/input/event2",
      touch_axis: { x_min: 0, x_max: 10799, y_min: 0, y_max: 24239 },
    },
    artifacts: {
      events_log: "events.log",
      screens_dir: "screens/",
      screens_index: "screens.jsonl",
      states_log: "states.jsonl",
    },
    steps: [
      {
        step_id: 1,
        type: "tap",
        start_time: 100,
        end_time: 100.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 9080, y: 21440 },
        screen: { x: 908, y: 2144, x_norm: 0.840726, y_norm: 0.88436 },
        before_screenshot: "screens/keep-grid.png",
        after_screenshot: "screens/keep-fab-menu.png",
        state: baseState,
      },
      {
        step_id: 2,
        type: "tap",
        start_time: 101,
        end_time: 101.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 8950, y: 19330 },
        screen: { x: 895, y: 1933, x_norm: 0.8287, y_norm: 0.7974 },
        before_screenshot: "screens/keep-fab-menu.png",
        after_screenshot: "screens/keep-editor-keyboard.png",
        state: baseState,
      },
      {
        step_id: 3,
        type: "tap",
        start_time: 102,
        end_time: 102.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 6450, y: 18430 },
        screen: { x: 645, y: 1843, x_norm: 0.5972, y_norm: 0.7603 },
        before_screenshot: "screens/keep-editor-keyboard.png",
        after_screenshot: "screens/keep-editor-keyboard-h.png",
        state: baseState,
      },
      {
        step_id: 4,
        type: "tap",
        start_time: 103,
        end_time: 103.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 2880, y: 16870 },
        screen: { x: 288, y: 1687, x_norm: 0.2666, y_norm: 0.696 },
        before_screenshot: "screens/keep-editor-keyboard-h.png",
        after_screenshot: "screens/keep-editor-keyboard-he.png",
        state: baseState,
      },
      {
        step_id: 5,
        type: "tap",
        start_time: 104,
        end_time: 104.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 9860, y: 18460 },
        screen: { x: 986, y: 1846, x_norm: 0.913, y_norm: 0.7615 },
        before_screenshot: "screens/keep-editor-keyboard-he.png",
        after_screenshot: "screens/keep-editor-keyboard-hel.png",
        state: baseState,
      },
    ],
    warnings: [],
  };
  writeJsonFile(path.join(dir, "trace.json"), trace);
  return dir;
}

export function createMockEmbeddedPreTextInputTraceDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawmobile-trace-induction-embedded-pre-text-"));
  const launcherState = {
    package: "com.google.android.apps.nexuslauncher",
    activity: "com.google.android.apps.nexuslauncher.NexusLauncherActivity",
  };
  const keepState = {
    package: "com.google.android.keep",
    activity: "com.google.android.keep.activities.BrowseActivity",
  };
  const trace: TraceJson = {
    trace_id: "mock_embedded_pre_text_input_trace",
    task_hint: "keep.create_note",
    created_at: "2026-05-12T00:00:00.000Z",
    device: {
      screen_width: 1080,
      screen_height: 2424,
      touch_device: "/dev/input/event2",
      touch_axis: { x_min: 0, x_max: 10799, y_min: 0, y_max: 24239 },
    },
    artifacts: {
      events_log: "events.log",
      screens_dir: "screens/",
      screens_index: "screens.jsonl",
      states_log: "states.jsonl",
    },
    steps: [
      {
        step_id: 1,
        type: "tap",
        start_time: 100,
        end_time: 100.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 820, y: 14280 },
        screen: { x: 82, y: 1428, x_norm: 0.076, y_norm: 0.589 },
        before_screenshot: "screens/home.png",
        after_screenshot: "screens/keep-grid.png",
        state: launcherState,
      },
      {
        step_id: 2,
        type: "tap",
        start_time: 102,
        end_time: 102.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 9410, y: 20900 },
        screen: { x: 941, y: 2090, x_norm: 0.871, y_norm: 0.862 },
        before_screenshot: "screens/keep-grid.png",
        after_screenshot: "screens/keep-fab-menu.png",
        state: launcherState,
      },
      {
        step_id: 4,
        type: "tap",
        start_time: 105,
        end_time: 105.05,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 6660, y: 18500 },
        screen: { x: 666, y: 1850, x_norm: 0.617, y_norm: 0.763 },
        before_screenshot: "screens/keep-editor-keyboard.png",
        after_screenshot: "screens/keep-editor-keyboard-h.png",
        state: launcherState,
      },
      {
        step_id: 3,
        type: "tap",
        start_time: 103.1,
        end_time: 103.15,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 9350, y: 19540 },
        screen: { x: 935, y: 1954, x_norm: 0.866, y_norm: 0.806 },
        before_screenshot: "screens/keep-fab-menu.png",
        after_screenshot: "screens/keep-editor-keyboard.png",
        state: launcherState,
      },
      {
        step_id: 9,
        type: "tap",
        start_time: 102.9,
        end_time: 102.95,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 5960, y: 21110 },
        screen: { x: 596, y: 2111, x_norm: 0.552, y_norm: 0.871 },
        before_screenshot: "screens/keep-fab-menu.png",
        after_screenshot: "screens/keep-editor-keyboard.png",
        state: launcherState,
      },
      {
        step_id: 5,
        type: "tap",
        start_time: 105.12,
        end_time: 105.17,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 2820, y: 17060 },
        screen: { x: 282, y: 1706, x_norm: 0.261, y_norm: 0.704 },
        before_screenshot: "screens/keep-editor-keyboard-h.png",
        after_screenshot: "screens/keep-editor-keyboard-he.png",
        state: keepState,
      },
      {
        step_id: 6,
        type: "tap",
        start_time: 105.25,
        end_time: 105.3,
        duration_ms: 50,
        movement_px: 0,
        raw: { x: 9690, y: 18400 },
        screen: { x: 969, y: 1840, x_norm: 0.897, y_norm: 0.759 },
        before_screenshot: "screens/keep-editor-keyboard-he.png",
        after_screenshot: "screens/keep-editor-keyboard-hel.png",
        state: keepState,
      },
    ],
    warnings: [],
  };
  writeJsonFile(path.join(dir, "trace.json"), trace);
  return dir;
}
