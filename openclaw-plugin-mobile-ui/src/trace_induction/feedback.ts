import fs from "fs";
import path from "path";
import { getWorkspaceDir } from "../tools/workspace";
import { refreshExecutionExperience } from "./experience";
import { renderGeneralizedSkillMarkdown } from "./generalize";
import { resolveWorkspaceSkillDirByName } from "./skill_paths";

const GENERALIZED_SKILL_SCHEMA_VERSION = "clawmobile.skill.v2";
const MAX_EXECUTION_HISTORY = 50;
const MAX_VERIFIED_CONTEXTS = 25;
const MAX_FAILURE_PATTERNS = 25;

type FeedbackInput = {
  skill_dir?: string;
  skill_path?: string;
  skill_name?: string;
  outcome?: string;
  execution_summary?: string;
  failed_step?: string;
  failed_anchor?: string;
  used_anchors?: string[];
  parameters?: any;
  observations?: any;
  notes?: string;
  final_screenshot_path?: string;
  final_state?: any;
  tool_results?: any;
  repair_hint?: string;
};

function readJsonFile<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function writeJsonFile(file: string, value: any) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function resolvePath(requested: string) {
  return path.isAbsolute(requested) ? requested : path.join(getWorkspaceDir(), requested);
}

function asArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function asObject(value: any) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values: any[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function truncateText(value: any, max = 240) {
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else if (typeof value !== "undefined" && value !== null) {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function stableKey(parts: any[]) {
  return parts.map((part) => truncateText(part, 120).toLowerCase()).filter(Boolean).join("|");
}

function parameterKeys(parameters: any) {
  return Object.keys(asObject(parameters)).sort();
}

function compactFinalState(finalState: any) {
  const state = asObject(finalState);
  const result: any = {};
  const keys = [
    "package",
    "activity",
    "current_package",
    "current_activity",
    "orientation",
    "screen_width",
    "screen_height",
    "density",
  ];
  for (const key of keys) {
    if (typeof state[key] !== "undefined") result[key] = state[key];
  }
  return result;
}

function parseSkillName(skillMarkdownPath: string, fallback: string) {
  if (!fs.existsSync(skillMarkdownPath)) return fallback;
  const text = fs.readFileSync(skillMarkdownPath, "utf8");
  const match = text.match(/^name:\s*([^\n]+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : fallback;
}

function resolveSkillDir(input: FeedbackInput) {
  const requested = String(input.skill_dir || input.skill_path || "").trim();
  if (requested) {
    const resolved = resolvePath(requested);
    const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
    if (!stat) throw new Error(`skill path not found: ${resolved}`);
    return stat.isDirectory() ? resolved : path.dirname(resolved);
  }

  const skillName = String(input.skill_name || "").trim();
  if (skillName) {
    const workspaceSkillDir = resolveWorkspaceSkillDirByName(skillName);
    if (fs.existsSync(workspaceSkillDir)) return workspaceSkillDir;
  }

  throw new Error("skill_dir, skill_path, or skill_name is required");
}

function normalizeOutcome(value: any) {
  const raw = String(value || "").trim().toLowerCase();
  if (/^(success|succeeded|ok|complete|completed|done)$/.test(raw)) return "success";
  if (/^(failure|failed|error|errored|exception)$/.test(raw)) return "failure";
  if (/^(partial|partially_succeeded|partial_success)$/.test(raw)) return "partial";
  if (/^(skipped|not_applicable|cancelled|canceled)$/.test(raw)) return raw;
  return raw || "unknown";
}

function anchorsFromProcedure(generalized: any) {
  return asArray(generalized.procedure)
    .map((step) => asObject(step).anchor)
    .filter(Boolean)
    .map(String);
}

function validationFor(generalized: any) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (generalized.schema_version !== GENERALIZED_SKILL_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${GENERALIZED_SKILL_SCHEMA_VERSION}`);
  }
  if (!generalized.intent?.name) errors.push("intent.name is required");
  if (!generalized.evolution) warnings.push("evolution object is missing");
  return { ok: errors.length === 0, errors, warnings };
}

function compactRecord(record: any) {
  const result: any = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "undefined" || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    result[key] = value;
  }
  return result;
}

function appendJsonl(file: string, value: any) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function incrementAnchorSuccesses(generalized: any, anchorNames: string[]) {
  for (const name of uniqueStrings(anchorNames)) {
    const anchor = asObject(generalized.anchors?.[name]);
    if (!generalized.anchors?.[name]) continue;
    anchor.execution_success_count = Number(anchor.execution_success_count || 0) + 1;
    anchor.last_success_at = new Date().toISOString();
    generalized.anchors[name] = anchor;
  }
}

function recordVerifiedContext(generalized: any, record: any, usedAnchors: string[]) {
  const anchors = uniqueStrings(usedAnchors);
  const params = parameterKeys(record.parameters);
  const finalState = compactFinalState(record.final_state);
  const observations = truncateText(record.observations);
  const summary = truncateText(record.execution_summary);
  if (anchors.length === 0 && params.length === 0 && !summary && !observations && Object.keys(finalState).length === 0) return;
  const key = stableKey([
    "success",
    anchors.join(","),
    params.join(","),
    finalState.package || finalState.current_package,
    finalState.activity || finalState.current_activity,
    observations,
  ]);
  if (!key) return;

  generalized.evolution.verified_contexts = asArray(generalized.evolution.verified_contexts);
  const existing = generalized.evolution.verified_contexts.find((item: any) => asObject(item).context_key === key);
  if (existing) {
    existing.count = Number(existing.count || 0) + 1;
    existing.last_verified_at = record.recorded_at;
    if (summary) existing.last_summary = summary;
    if (observations) existing.last_observations = observations;
    return;
  }

  generalized.evolution.verified_contexts.push(compactRecord({
    context_key: key,
    first_verified_at: record.recorded_at,
    last_verified_at: record.recorded_at,
    count: 1,
    used_anchors: anchors,
    parameter_keys: params,
    final_state: finalState,
    last_summary: summary,
    last_observations: observations,
  }));

  if (generalized.evolution.verified_contexts.length > MAX_VERIFIED_CONTEXTS) {
    generalized.evolution.verified_contexts = generalized.evolution.verified_contexts.slice(-MAX_VERIFIED_CONTEXTS);
  }
}

function recordAnchorFailure(generalized: any, record: any) {
  const failedAnchor = String(record.failed_anchor || "").trim();
  if (!failedAnchor || !generalized.anchors?.[failedAnchor]) return;
  const anchor = asObject(generalized.anchors[failedAnchor]);
  anchor.execution_failure_count = Number(anchor.execution_failure_count || 0) + 1;
  anchor.last_failure = {
    recorded_at: record.recorded_at,
    failed_step: record.failed_step,
    outcome: record.outcome,
    execution_summary: record.execution_summary,
    observations: record.observations,
    repair_hint: record.repair_hint,
  };
  generalized.anchors[failedAnchor] = anchor;
}

function recordFailurePattern(generalized: any, record: any) {
  const failedStep = truncateText(record.failed_step, 160);
  const failedAnchor = String(record.failed_anchor || "").trim();
  const observations = truncateText(record.observations);
  const repairHint = truncateText(record.repair_hint);
  const summary = truncateText(record.execution_summary);
  if (!failedStep && !failedAnchor && !observations && !repairHint && !summary) return;
  const key = stableKey([
    record.outcome,
    failedStep,
    failedAnchor,
    observations,
    repairHint,
  ]);
  if (!key) return;

  generalized.evolution.failure_patterns = asArray(generalized.evolution.failure_patterns);
  const existing = generalized.evolution.failure_patterns.find((item: any) => asObject(item).pattern_key === key);
  if (existing) {
    existing.count = Number(existing.count || 0) + 1;
    existing.last_seen_at = record.recorded_at;
    if (summary) existing.last_summary = summary;
    return;
  }

  generalized.evolution.failure_patterns.push(compactRecord({
    pattern_key: key,
    first_seen_at: record.recorded_at,
    last_seen_at: record.recorded_at,
    count: 1,
    outcome: record.outcome,
    failed_step: failedStep,
    failed_anchor: failedAnchor,
    observations,
    repair_hint: repairHint,
    last_summary: summary,
  }));

  if (generalized.evolution.failure_patterns.length > MAX_FAILURE_PATTERNS) {
    generalized.evolution.failure_patterns = generalized.evolution.failure_patterns.slice(-MAX_FAILURE_PATTERNS);
  }
}

function ensureGeneratedMetadata(generalized: any) {
  generalized.metadata = {
    ...asObject(generalized.metadata),
    clawmobile_generated: true,
    feedback_supported: true,
    feedback_tool: "clawmobile_skill_record_feedback",
    status_tool: "clawmobile_skill_status",
    primary_skill_format: "generalized_skill_markdown",
  };
}

function updateManifest(skillDir: string, generalized: any, record: any) {
  const manifestPath = path.join(skillDir, "manifest.json");
  const manifest = fs.existsSync(manifestPath) ? readJsonFile<any>(manifestPath) : {};
  manifest.clawmobile_generated = true;
  manifest.feedback_supported = true;
  manifest.feedback_tool = "clawmobile_skill_record_feedback";
  manifest.status_tool = "clawmobile_skill_status";
  manifest.updated_at = new Date().toISOString();
  manifest.execution_feedback = {
    success_count: generalized.evolution?.success_count || 0,
    failure_count: generalized.evolution?.failure_count || 0,
    verified_context_count: asArray(generalized.evolution?.verified_contexts).length,
    failure_pattern_count: asArray(generalized.evolution?.failure_patterns).length,
    last_outcome: record.outcome,
    last_recorded_at: record.recorded_at,
  };
  writeJsonFile(manifestPath, manifest);
  return manifestPath;
}

export function recordSkillFeedback(input: FeedbackInput) {
  const skillDir = resolveSkillDir(input);
  const generalizedPath = path.join(skillDir, "generalized_skill.json");
  if (!fs.existsSync(generalizedPath)) {
    throw new Error(`generalized_skill.json not found in skill dir: ${skillDir}`);
  }

  const generalized = readJsonFile<any>(generalizedPath);
  const skillName = input.skill_name || parseSkillName(path.join(skillDir, "SKILL.md"), path.basename(skillDir));
  const outcome = normalizeOutcome(input.outcome);
  const record = compactRecord({
    recorded_at: new Date().toISOString(),
    outcome,
    execution_summary: input.execution_summary,
    failed_step: input.failed_step,
    failed_anchor: input.failed_anchor,
    used_anchors: input.used_anchors,
    parameters: input.parameters,
    observations: input.observations,
    notes: input.notes,
    final_screenshot_path: input.final_screenshot_path,
    final_state: input.final_state,
    tool_results: input.tool_results,
    repair_hint: input.repair_hint,
  });

  generalized.evolution = asObject(generalized.evolution);
  ensureGeneratedMetadata(generalized);
  generalized.evolution.execution_history = asArray(generalized.evolution.execution_history);
  generalized.evolution.execution_history.push(record);
  if (generalized.evolution.execution_history.length > MAX_EXECUTION_HISTORY) {
    generalized.evolution.execution_history = generalized.evolution.execution_history.slice(-MAX_EXECUTION_HISTORY);
  }

  if (outcome === "success") {
    generalized.evolution.success_count = Number(generalized.evolution.success_count || 0) + 1;
    const usedAnchors = asArray(input.used_anchors).length > 0 ? asArray(input.used_anchors) : anchorsFromProcedure(generalized);
    incrementAnchorSuccesses(generalized, usedAnchors.map(String));
    recordVerifiedContext(generalized, record, usedAnchors.map(String));
  } else if (outcome === "failure" || outcome === "partial") {
    generalized.evolution.failure_count = Number(generalized.evolution.failure_count || 0) + 1;
    recordAnchorFailure(generalized, record);
    recordFailurePattern(generalized, record);
    const hint = [
      "Execution failure recorded",
      record.failed_step ? `step=${record.failed_step}` : "",
      record.failed_anchor ? `anchor=${record.failed_anchor}` : "",
      record.execution_summary ? `summary=${record.execution_summary}` : "",
    ].filter(Boolean).join("; ");
    generalized.evolution.open_uncertainties = uniqueStrings([
      ...asArray(generalized.evolution.open_uncertainties),
      hint,
      record.repair_hint,
    ]);
  }

  refreshExecutionExperience(generalized);
  generalized.updated_at = new Date().toISOString();
  const validation = validationFor(generalized);
  generalized.validation = validation;

  const feedbackLogPath = path.join(skillDir, "execution_feedback.jsonl");
  appendJsonl(feedbackLogPath, record);
  writeJsonFile(generalizedPath, generalized);
  const markdown = renderGeneralizedSkillMarkdown(generalized, validation, skillName);
  const markdownPath = path.join(skillDir, "generalized_SKILL.md");
  const primarySkillPath = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(markdownPath, markdown);
  fs.writeFileSync(primarySkillPath, markdown);
  const manifestPath = updateManifest(skillDir, generalized, record);

  return {
    ok: validation.ok,
    skill_name: skillName,
    skill_dir: skillDir,
    outcome,
    feedback_log_path: feedbackLogPath,
    generalized_skill_path: generalizedPath,
    generalized_skill_markdown_path: markdownPath,
    primary_skill_path: primarySkillPath,
    manifest_path: manifestPath,
    success_count: generalized.evolution.success_count || 0,
    failure_count: generalized.evolution.failure_count || 0,
    verified_context_count: asArray(generalized.evolution.verified_contexts).length,
    failure_pattern_count: asArray(generalized.evolution.failure_patterns).length,
    validation,
    record,
    generalized_skill: generalized,
    next_steps:
      outcome === "success"
        ? [
            "Tell the user the skill completed successfully and feedback was recorded.",
            "If the user wants broader coverage, invite them to record another successful demonstration of the same task and update this skill.",
          ]
        : outcome === "failure" || outcome === "partial"
          ? [
              "Tell the user which step or anchor failed, using failed_step/failed_anchor when available.",
              "If the task can be demonstrated again, ask the user to record a correction demo from the failed or preferred starting state.",
              "Generate a candidate from that new trace and call clawmobile_skill_update_from_trace for this existing skill.",
            ]
          : [
              "Report the feedback outcome and decide whether another demonstration is needed.",
            ],
  };
}
