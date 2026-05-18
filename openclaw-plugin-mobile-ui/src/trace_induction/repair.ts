import fs from "fs";
import path from "path";
import { getWorkspaceDir } from "../tools/workspace";
import { refreshExecutionExperience } from "./experience";
import { renderGeneralizedSkillMarkdown } from "./generalize";
import { resolveWorkspaceSkillDirByName } from "./skill_paths";

const GENERALIZED_SKILL_SCHEMA_VERSION = "clawmobile.skill.v2";
const MAX_REPAIR_HISTORY = 50;

type TapTextRepair = {
  step_id?: string;
  anchor?: string;
  texts?: string[];
};

type FastPathFailureReflectionInput = {
  skill_dir?: string;
  skill_path?: string;
  skill_name?: string;
  failed_step?: string;
  failed_anchor?: string;
  failure_summary?: string;
  diagnosis?: string;
  repair_goal?: string;
  repair_kind?: string;
  relax_entry_ui_text_checks?: boolean;
  remove_entry_ui_text_checks?: boolean;
  add_entry_ui_text_any?: string[];
  tap_text_repairs?: TapTextRepair[];
  mark_fast_path_ineligible?: boolean;
  notes?: string;
  previous_fast_path_result?: any;
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

function uniqueStrings(values: any[], max = 24) {
  return Array.from(
    new Set(values.map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean))
  ).slice(0, max);
}

function truncateText(value: any, max = 500) {
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

function parseSkillName(skillMarkdownPath: string, fallback: string) {
  if (!fs.existsSync(skillMarkdownPath)) return fallback;
  const text = fs.readFileSync(skillMarkdownPath, "utf8");
  const match = text.match(/^name:\s*([^\n]+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : fallback;
}

function resolveSkillDir(input: FastPathFailureReflectionInput) {
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

function validationFor(generalized: any) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (generalized.schema_version !== GENERALIZED_SKILL_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${GENERALIZED_SKILL_SCHEMA_VERSION}`);
  }
  if (!generalized.intent?.name) errors.push("intent.name is required");
  if (!generalized.fast_path) warnings.push("fast_path object is missing");
  if (!generalized.evolution) warnings.push("evolution object is missing");
  return { ok: errors.length === 0, errors, warnings };
}

function stepMatches(step: any, failedStep: string) {
  const id = String(asObject(step).id || "");
  return Boolean(failedStep) && (id === failedStep || id.includes(failedStep) || failedStep.includes(id));
}

function shouldRepairAppStateStep(step: any, input: FastPathFailureReflectionInput) {
  const item = asObject(step);
  if (String(item.action || "") !== "assert_app_state") return false;
  if (input.failed_step && stepMatches(item, input.failed_step)) return true;
  return Boolean(item.package || item.activity);
}

function moveHardTextChecksToEvidence(target: any, addedTexts: string[], label: string) {
  const item = asObject(target);
  const priorAny = asArray(item.ui_text_any);
  const priorAll = asArray(item.ui_text_all);
  const priorEvidence = asArray(item.ui_text_evidence);
  const evidence = uniqueStrings([...priorEvidence, ...priorAny, ...priorAll, ...addedTexts]);
  if (evidence.length > 0) item.ui_text_evidence = evidence;
  delete item.ui_text_any;
  delete item.ui_text_all;
  item.ui_text_required = false;
  item.repair_note = uniqueStrings([
    item.repair_note,
    `${label}: package/activity is the hard entry gate; UI text is evidence only after fast-path reflection.`,
  ], 6).join(" ");
  return item;
}

function addHardEntryTexts(target: any, texts: string[]) {
  const item = asObject(target);
  const prior = asArray(item.ui_text_any);
  item.ui_text_any = uniqueStrings([...prior, ...texts], 12);
  return item;
}

function applyEntryTextRepair(generalized: any, input: FastPathFailureReflectionInput) {
  const changes: string[] = [];
  const addedTexts = uniqueStrings(asArray(input.add_entry_ui_text_any), 12);
  const relax = input.relax_entry_ui_text_checks === true || input.remove_entry_ui_text_checks === true;

  if (!relax && addedTexts.length === 0) return changes;

  const fastPath = asObject(generalized.fast_path);
  generalized.fast_path = fastPath;

  if (fastPath.app_state_check) {
    fastPath.app_state_check = relax
      ? moveHardTextChecksToEvidence(fastPath.app_state_check, addedTexts, "fast_path.app_state_check")
      : addHardEntryTexts(fastPath.app_state_check, addedTexts);
    changes.push(relax ? "relaxed fast_path.app_state_check UI text gate" : "added entry UI text candidates to fast_path.app_state_check");
  }

  const entryChecks = asObject(generalized.entry_state_checks);
  if (entryChecks.after_app_open || entryChecks.initial_app_state) {
    const key = entryChecks.after_app_open ? "after_app_open" : "initial_app_state";
    entryChecks[key] = relax
      ? moveHardTextChecksToEvidence(entryChecks[key], addedTexts, `entry_state_checks.${key}`)
      : addHardEntryTexts(entryChecks[key], addedTexts);
    generalized.entry_state_checks = entryChecks;
    changes.push(relax ? `relaxed entry_state_checks.${key} UI text gate` : `added entry UI text candidates to entry_state_checks.${key}`);
  }

  for (const step of asArray(fastPath.steps)) {
    if (!shouldRepairAppStateStep(step, input)) continue;
    if (relax) {
      moveHardTextChecksToEvidence(step, addedTexts, String(step.id || "assert_app_state"));
      changes.push(`relaxed assert_app_state step ${step.id || "(unnamed)"}`);
    } else if (addedTexts.length > 0) {
      addHardEntryTexts(step, addedTexts);
      changes.push(`added entry UI text candidates to assert_app_state step ${step.id || "(unnamed)"}`);
    }
  }

  return changes;
}

function applyTapTextRepairs(generalized: any, input: FastPathFailureReflectionInput) {
  const changes: string[] = [];
  const fastPath = asObject(generalized.fast_path);
  const repairs = asArray(input.tap_text_repairs).map(asObject);
  if (repairs.length === 0) return changes;

  for (const repair of repairs) {
    const texts = uniqueStrings(asArray(repair.texts), 12);
    if (texts.length === 0) continue;
    const stepId = String(repair.step_id || "").trim();
    const anchor = String(repair.anchor || "").trim();
    for (const step of asArray(fastPath.steps)) {
      const item = asObject(step);
      if (String(item.action || "") !== "tap_text") continue;
      const idMatches = stepId && String(item.id || "") === stepId;
      const anchorMatches = anchor && String(item.anchor || "") === anchor;
      if (!idMatches && !anchorMatches) continue;
      item.texts = uniqueStrings([...asArray(item.texts), item.text, ...texts], 16);
      changes.push(`added tap_text candidates to ${item.id || item.anchor || "(unnamed)"}`);
    }
  }

  return changes;
}

function appendRepairHistory(generalized: any, input: FastPathFailureReflectionInput, appliedChanges: string[]) {
  generalized.evolution = asObject(generalized.evolution);
  generalized.evolution.fast_path_repair_history = asArray(generalized.evolution.fast_path_repair_history);
  const record = {
    recorded_at: new Date().toISOString(),
    failed_step: input.failed_step,
    failed_anchor: input.failed_anchor,
    failure_summary: truncateText(input.failure_summary),
    diagnosis: truncateText(input.diagnosis, 900),
    repair_goal: truncateText(input.repair_goal),
    repair_kind: truncateText(input.repair_kind, 160),
    applied_changes: appliedChanges,
    notes: truncateText(input.notes),
    previous_fast_path_result: input.previous_fast_path_result
      ? truncateText(input.previous_fast_path_result, 1200)
      : undefined,
  };
  generalized.evolution.fast_path_repair_history.push(record);
  if (generalized.evolution.fast_path_repair_history.length > MAX_REPAIR_HISTORY) {
    generalized.evolution.fast_path_repair_history = generalized.evolution.fast_path_repair_history.slice(-MAX_REPAIR_HISTORY);
  }
  generalized.evolution.open_uncertainties = uniqueStrings([
    ...asArray(generalized.evolution.open_uncertainties),
    appliedChanges.length > 0
      ? `Fast path reflection applied after ${input.failed_step || "unknown step"}: ${appliedChanges.join("; ")}`
      : `Fast path reflection recorded without an automatic safe repair for ${input.failed_step || "unknown step"}.`,
  ], 80);
}

function updateManifest(skillDir: string, generalized: any) {
  const manifestPath = path.join(skillDir, "manifest.json");
  const manifest = fs.existsSync(manifestPath) ? readJsonFile<any>(manifestPath) : {};
  manifest.clawmobile_generated = true;
  manifest.feedback_supported = true;
  manifest.feedback_tool = "clawmobile_skill_record_feedback";
  manifest.status_tool = "clawmobile_skill_status";
  manifest.fast_path_reflection_tool = "clawmobile_skill_reflect_fast_path_failure";
  manifest.updated_at = new Date().toISOString();
  manifest.fast_path_repair_count = asArray(generalized.evolution?.fast_path_repair_history).length;
  writeJsonFile(manifestPath, manifest);
  return manifestPath;
}

export function reflectFastPathFailure(input: FastPathFailureReflectionInput) {
  const skillDir = resolveSkillDir(input);
  const generalizedPath = path.join(skillDir, "generalized_skill.json");
  if (!fs.existsSync(generalizedPath)) {
    throw new Error(`generalized_skill.json not found in skill dir: ${skillDir}`);
  }

  const generalized = readJsonFile<any>(generalizedPath);
  const skillName = input.skill_name || parseSkillName(path.join(skillDir, "SKILL.md"), path.basename(skillDir));
  const appliedChanges = [
    ...applyEntryTextRepair(generalized, input),
    ...applyTapTextRepairs(generalized, input),
  ];

  if (input.mark_fast_path_ineligible === true) {
    generalized.fast_path = asObject(generalized.fast_path);
    generalized.fast_path.eligible = false;
    generalized.fast_path.unsupported = uniqueStrings([
      ...asArray(generalized.fast_path.unsupported),
      `Marked ineligible by fast-path reflection: ${truncateText(input.diagnosis || input.failure_summary, 160)}`,
    ], 20);
    appliedChanges.push("marked fast path ineligible");
  }

  appendRepairHistory(generalized, input, appliedChanges);
  refreshExecutionExperience(generalized);
  generalized.updated_at = new Date().toISOString();
  const validation = validationFor(generalized);
  generalized.validation = validation;
  writeJsonFile(generalizedPath, generalized);

  const markdown = renderGeneralizedSkillMarkdown(generalized, validation, skillName);
  const markdownPath = path.join(skillDir, "generalized_SKILL.md");
  const primarySkillPath = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(markdownPath, markdown);
  fs.writeFileSync(primarySkillPath, markdown);
  const manifestPath = updateManifest(skillDir, generalized);

  return {
    ok: validation.ok,
    skill_name: skillName,
    skill_dir: skillDir,
    generalized_skill_path: generalizedPath,
    generalized_skill_markdown_path: markdownPath,
    primary_skill_path: primarySkillPath,
    manifest_path: manifestPath,
    applied_changes: appliedChanges,
    repair_applied: appliedChanges.length > 0,
    validation,
    next_steps: appliedChanges.length > 0
      ? [
          "Retry clawmobile_skill_run_fast_path once with the same parameters and final checks.",
          "If the repaired fast path still fails, switch to normal stepwise execution/regrounding and record feedback.",
        ]
      : [
          "No safe automatic repair was applied. Use normal stepwise execution/regrounding and record feedback.",
          "If stepwise execution also fails, ask the user for another demonstration of the same task.",
        ],
  };
}
