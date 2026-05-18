import fs from "fs";
import path from "path";
import { getWorkspaceDir } from "../tools/workspace";
import { deriveExecutionGuidance } from "./experience";
import { resolveWorkspaceSkillDirByName } from "./skill_paths";

type StatusInput = {
  skill_dir?: string;
  skill_path?: string;
  skill_name?: string;
  include_history?: boolean;
  max_history?: number;
  max_contexts?: number;
  max_patterns?: number;
  include_paths?: boolean;
  include_anchor_details?: boolean;
  include_open_uncertainties?: boolean;
  include_validation?: boolean;
  include_feedback_log?: boolean;
};

function readJsonFile<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
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

function clampLimit(value: any, fallback: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function parseSkillName(skillMarkdownPath: string, fallback: string) {
  if (!fs.existsSync(skillMarkdownPath)) return fallback;
  const text = fs.readFileSync(skillMarkdownPath, "utf8");
  const match = text.match(/^name:\s*([^\n]+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : fallback;
}

function resolveSkillDir(input: StatusInput) {
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

function summarizeAnchors(anchors: any) {
  return Object.fromEntries(
    Object.entries(asObject(anchors)).map(([name, value]) => {
      const anchor = asObject(value);
      return [name, {
        stability: anchor.stability,
        confidence: anchor.confidence,
        x_norm: anchor.x_norm,
        y_norm: anchor.y_norm,
        x: anchor.x,
        y: anchor.y,
        replay_priority: anchor.replay_priority,
        valid_when: anchor.valid_when,
        execution_success_count: anchor.execution_success_count || 0,
        execution_failure_count: anchor.execution_failure_count || 0,
        last_success_at: anchor.last_success_at,
        last_failure: anchor.last_failure,
      }];
    })
  );
}

function summarizeAnchorStats(anchors: any) {
  const entries = Object.entries(asObject(anchors));
  const unstable: string[] = [];
  const failedRecently: string[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const [name, value] of entries) {
    const anchor = asObject(value);
    successCount += Number(anchor.execution_success_count || 0);
    failureCount += Number(anchor.execution_failure_count || 0);
    const stability = String(anchor.stability || "");
    if (stability && stability !== "stable" && unstable.length < 10) unstable.push(name);
    if (anchor.last_failure && failedRecently.length < 10) failedRecently.push(name);
  }

  return {
    count: entries.length,
    execution_success_count: successCount,
    execution_failure_count: failureCount,
    unstable_anchor_names: unstable,
    failed_anchor_names: failedRecently,
  };
}

function readFeedbackTail(feedbackLogPath: string, maxHistory: number) {
  if (!fs.existsSync(feedbackLogPath)) return [];
  const text = fs.readFileSync(feedbackLogPath, "utf8").trim();
  if (!text) return [];
  return text
    .split(/\n/)
    .slice(-maxHistory)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { parse_error: true, raw: line };
      }
    });
}

function requiredParameterNames(generalized: any) {
  return Object.entries(asObject(generalized.intent?.parameters))
    .filter(([, schema]) => asObject(schema).required === true)
    .map(([name]) => name);
}

function summarizeFastPath(generalized: any, skillName: string) {
  const fastPath = asObject(generalized.fast_path);
  if (Object.keys(fastPath).length === 0) return null;
  const steps = asArray(fastPath.steps);
  const requiredParameters = requiredParameterNames(generalized);
  const runnerTool = String(fastPath.runner_tool || "clawmobile_skill_run_fast_path");
  const eligible = fastPath.eligible === true;
  return {
    available: true,
    eligible,
    runner_tool: runnerTool,
    execution_tool: fastPath.execution_tool || "clawmobile_batch_execute",
    mode: fastPath.mode || "",
    step_count: steps.length,
    unsupported: asArray(fastPath.unsupported),
    required_parameters: requiredParameters,
    use_when: fastPath.use_when || "",
    fallback: fastPath.fallback || "",
    recommended_first_attempt: eligible,
    call_guidance: eligible
      ? "When user intent matches and required parameters are available, call the runner before manually expanding the procedure. The runner performs bounded checkpoints and returns structured failure data for repair/fallback."
      : "Fast path exists but is not currently eligible; use normal grounded execution unless explicitly debugging.",
    example_arguments: eligible
      ? {
          skill_name: skillName,
          parameters: Object.fromEntries(requiredParameters.map((name) => [name, `<${name}>`])),
          final_check_texts: ["<expected visible result text>"],
          record_feedback: true,
        }
      : undefined,
  };
}

function recommendedNextAction(generalized: any, skillName: string, executionGuidance: any) {
  const selfRepair = asObject(executionGuidance.fast_path_self_repair);
  if (selfRepair.recommended === true) return selfRepair;

  const fastPath = summarizeFastPath(generalized, skillName);
  if (fastPath?.eligible) {
    return {
      tool: fastPath.runner_tool,
      reason: "eligible_fast_path_available",
      priority: "try_before_manual_step_expansion",
      required_parameters: fastPath.required_parameters,
      example_arguments: fastPath.example_arguments,
      fallback_after_failure:
        "If the runner fails, inspect its structured failure. Use clawmobile_skill_reflect_fast_path_failure once when it recommends a safe repair; otherwise continue with normal UI tools and record feedback.",
    };
  }

  return null;
}

export function getSkillStatus(input: StatusInput) {
  const skillDir = resolveSkillDir(input);
  const skillName = input.skill_name || parseSkillName(path.join(skillDir, "SKILL.md"), path.basename(skillDir));
  const generalizedPath = path.join(skillDir, "generalized_skill.json");
  const manifestPath = path.join(skillDir, "manifest.json");
  const feedbackLogPath = path.join(skillDir, "execution_feedback.jsonl");
  if (!fs.existsSync(generalizedPath)) {
    throw new Error(`generalized_skill.json not found in skill dir: ${skillDir}`);
  }

  const generalized = readJsonFile<any>(generalizedPath);
  const manifest = fs.existsSync(manifestPath) ? readJsonFile<any>(manifestPath) : {};
  const evolution = asObject(generalized.evolution);
  const maxHistory = clampLimit(input.max_history, 3, 20);
  const maxContexts = clampLimit(input.max_contexts, 3, 10);
  const maxPatterns = clampLimit(input.max_patterns, 3, 10);
  const includeHistory = input.include_history === true;
  const includeFeedbackLog = includeHistory && input.include_feedback_log === true;
  const executionHistory = includeHistory
    ? asArray(evolution.execution_history).slice(-maxHistory)
    : [];
  const executionGuidance = deriveExecutionGuidance(generalized);
  const fastPath = summarizeFastPath(generalized, skillName);

  return {
    ok: true,
    skill_name: skillName,
    skill_dir: skillDir,
    paths: input.include_paths === true ? {
      skill_path: path.join(skillDir, "SKILL.md"),
      generalized_skill_path: generalizedPath,
      manifest_path: manifestPath,
      feedback_log_path: feedbackLogPath,
    } : undefined,
    generated: {
      clawmobile_generated: true,
      schema_version: generalized.schema_version,
      status: generalized.status,
      generated_at: manifest.generated_at,
      updated_at: generalized.updated_at || manifest.updated_at,
      feedback_supported: true,
      feedback_tool: "clawmobile_skill_record_feedback",
      status_tool: "clawmobile_skill_status",
    },
    intent: generalized.intent || manifest.candidate_intent || {},
    app: generalized.app || {},
    source_traces: asArray(generalized.source_traces),
    stats: {
      supporting_trace_count: evolution.supporting_trace_count || asArray(generalized.source_traces).length,
      success_count: evolution.success_count || 0,
      failure_count: evolution.failure_count || 0,
      verified_context_count: asArray(evolution.verified_contexts).length,
      failure_pattern_count: asArray(evolution.failure_patterns).length,
      open_uncertainty_count: asArray(evolution.open_uncertainties).length,
    },
    fast_path: fastPath,
    anchor_stats: summarizeAnchorStats(generalized.anchors),
    anchors: input.include_anchor_details === true ? summarizeAnchors(generalized.anchors) : undefined,
    verified_contexts: asArray(evolution.verified_contexts).slice(-maxContexts),
    failure_patterns: asArray(evolution.failure_patterns).slice(-maxPatterns),
    execution_guidance: executionGuidance,
    recommended_next_action: recommendedNextAction(generalized, skillName, executionGuidance),
    open_uncertainties: input.include_open_uncertainties === true
      ? asArray(evolution.open_uncertainties)
      : undefined,
    recent_execution_history: executionHistory,
    recent_feedback_log: includeFeedbackLog ? readFeedbackTail(feedbackLogPath, maxHistory) : [],
    validation: input.include_validation === true ? generalized.validation : undefined,
    manifest_execution_feedback: manifest.execution_feedback || {},
  };
}
