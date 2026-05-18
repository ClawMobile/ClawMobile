import fs from "fs";
import path from "path";
import { getWorkspaceDir } from "../tools/workspace";
import { generalizeSkill } from "./generalize";

const SKILL_CANDIDATE_SCHEMA_VERSION = "clawmobile.skill_candidate.v1";
const GENERATED_SKILL_MANIFEST_VERSION = "clawmobile.generated_skill_manifest.v1";
const GENERATED_INDEX_SKILL_NAME = "clawmobile-generated-index";

type PromoteInput = {
  recording_dir_or_candidate_path?: string;
  recording_dir?: string;
  candidate_path?: string;
  output_dir?: string;
  install?: boolean;
  skill_name?: string;
};

type LoadedCandidate = {
  recordingDir: string;
  candidatePath: string;
  tracePath: string | null;
  candidate: any;
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

function resolvePath(requested: string) {
  return path.isAbsolute(requested) ? requested : path.join(getWorkspaceDir(), requested);
}

function loadCandidate(input: PromoteInput): LoadedCandidate {
  const requested = String(
    input.candidate_path || input.recording_dir || input.recording_dir_or_candidate_path || ""
  ).trim();
  if (!requested) {
    throw new Error("candidate_path, recording_dir, or recording_dir_or_candidate_path is required");
  }

  const resolved = resolvePath(requested);
  const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
  if (!stat) throw new Error(`candidate input not found: ${resolved}`);

  const candidatePath = stat.isDirectory() ? path.join(resolved, "skill_candidate.json") : resolved;
  if (!fs.existsSync(candidatePath)) throw new Error(`skill_candidate.json not found: ${candidatePath}`);

  const recordingDir = path.dirname(candidatePath);
  const tracePath = path.join(recordingDir, "trace.json");
  return {
    recordingDir,
    candidatePath,
    tracePath: fs.existsSync(tracePath) ? tracePath : null,
    candidate: readJsonFile<any>(candidatePath),
  };
}

function asArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function asObject(value: any) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function slugify(value: string, fallback: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

function shortTraceId(candidate: any) {
  const traceId = String(candidate.source_trace_id || "").trim();
  const match = traceId.match(/rec_(\d{8,})_(\d+)/);
  if (match) return `${match[1]}-${match[2].slice(0, 6)}`;
  return slugify(traceId, "trace").slice(0, 32);
}

function generatedSkillName(candidate: any, override?: string) {
  if (override && override.trim()) return slugify(override, "generated-skill");
  const intentName = String(candidate.intent?.name || candidate.task_summary || "recorded-task");
  return `clawmobile-generated-${slugify(intentName, "recorded-task")}-${shortTraceId(candidate)}`;
}

function hasPresentValue(value: any) {
  return typeof value !== "undefined" && value !== null && String(value).trim() !== "";
}

function validateCandidateForPromotion(candidate: any) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (candidate.schema_version !== SKILL_CANDIDATE_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SKILL_CANDIDATE_SCHEMA_VERSION}`);
  }
  if (!candidate.source_trace_id) errors.push("source_trace_id is required");
  if (!candidate.task_summary) warnings.push("task_summary is missing");
  if (!candidate.intent?.name) errors.push("intent.name is required");
  if (!candidate.intent?.description) errors.push("intent.description is required");
  if (!candidate.intent?.parameters || typeof candidate.intent.parameters !== "object") {
    errors.push("intent.parameters object is required");
  }

  const validation = asObject(candidate.validation);
  if (!candidate.validation || typeof validation.rejected_anchor_count === "undefined") {
    errors.push("candidate.validation is required; save it with clawmobile_trace_save_skill_candidate before promotion");
  }
  if (Number(validation.rejected_anchor_count || 0) > 0) {
    errors.push(`candidate has ${validation.rejected_anchor_count} rejected anchors`);
  }

  const anchors = asObject(candidate.anchors);
  const anchorNames = new Set(Object.keys(anchors));
  if (anchorNames.size === 0) errors.push("at least one grounded anchor is required");

  for (const [name, anchorValue] of Object.entries(anchors)) {
    const anchor = asObject(anchorValue);
    if (anchor.type !== "coordinate_anchor") errors.push(`anchor ${name}: type must be coordinate_anchor`);
    for (const key of ["x_norm", "y_norm"]) {
      const n = Number(anchor[key]);
      if (!Number.isFinite(n) || n < 0 || n > 1) errors.push(`anchor ${name}: ${key} must be a number in [0,1]`);
    }
    if (!hasPresentValue(anchor.source_step_id)) {
      errors.push(`anchor ${name}: source_step_id is required`);
    } else if (!Number.isInteger(Number(anchor.source_step_id))) {
      errors.push(`anchor ${name}: source_step_id must be an integer`);
    }
    if (!anchor.source_anchor_id) errors.push(`anchor ${name}: source_anchor_id is required`);
    if (anchor.replay_allowed === false) errors.push(`anchor ${name}: replay_allowed=false cannot be promoted`);
  }

  const steps = asArray(candidate.steps);
  if (steps.length === 0) errors.push("at least one replay step is required");
  const parameters = asObject(candidate.intent?.parameters);
  for (const [index, stepValue] of steps.entries()) {
    const step = asObject(stepValue);
    const action = String(step.action || "");
    if (!action) errors.push(`steps[${index}]: action is required`);

    for (const key of ["x", "y", "x_norm", "y_norm", "coordinate", "screen", "raw"]) {
      if (key in step) errors.push(`steps[${index}]: direct coordinate field ${key} is not allowed`);
    }

    if (action === "tap_anchor" || action.includes("anchor")) {
      const target = String(step.target || step.anchor || "").trim();
      if (!target) errors.push(`steps[${index}]: tap_anchor target is required`);
      if (target && !anchorNames.has(target)) errors.push(`steps[${index}]: unknown anchor target ${target}`);
    }

    if (action === "type_parameter") {
      const parameter = String(step.parameter || "").trim();
      if (!parameter) errors.push(`steps[${index}]: type_parameter parameter is required`);
      if (parameter && !parameters[parameter]) {
        warnings.push(`steps[${index}]: parameter ${parameter} is not declared in intent.parameters`);
      }
    }
  }

  if (asArray(candidate.verification).length === 0) warnings.push("verification rules are missing");
  if (asArray(candidate.fallback).length === 0) warnings.push("fallback rules are missing");

  return { ok: errors.length === 0, errors, warnings };
}

function markdownList(items: any[]) {
  if (items.length === 0) return "- None recorded\n";
  return items.map((item) => `- ${String(item)}`).join("\n") + "\n";
}

function renderParameters(parameters: any) {
  const entries = Object.entries(asObject(parameters));
  if (entries.length === 0) return "- None\n";
  return (
    entries
      .map(([name, schema]) => {
        const spec = asObject(schema);
        const required = spec.required === true ? "required" : "optional";
        const type = String(spec.type || "string");
        const desc = spec.description ? ` - ${String(spec.description)}` : "";
        return `- \`${name}\`: ${type}, ${required}${desc}`;
      })
      .join("\n") + "\n"
  );
}

function renderAnchorTable(anchors: any) {
  const lines = Object.entries(asObject(anchors)).map(([name, anchorValue]) => {
    const anchor = asObject(anchorValue);
    return `- \`${name}\`: tap at x=${anchor.x ?? "?"}, y=${anchor.y ?? "?"} (x_norm=${anchor.x_norm}, y_norm=${anchor.y_norm}); source=${anchor.source_anchor_id}; confidence=${anchor.confidence ?? ""}`;
  });
  return lines.length ? lines.join("\n") + "\n" : "- None\n";
}

function renderExecutionSteps(candidate: any) {
  return asArray(candidate.steps)
    .map((stepValue, index) => {
      const step = asObject(stepValue);
      const action = String(step.action || "");
      if (action === "tap_anchor" || action.includes("anchor")) {
        const target = String(step.target || step.anchor || "");
        return `${index + 1}. Tap anchor \`${target}\` using \`android_tap\` with that anchor's x/y coordinates. ${step.verify_after ? `Verify: ${step.verify_after}` : ""}`;
      }
      if (action === "type_parameter") {
        return `${index + 1}. Type parameter \`${step.parameter || ""}\` using \`android_type\`. ${step.verify_after ? `Verify: ${step.verify_after}` : ""}`;
      }
      return `${index + 1}. ${JSON.stringify(step)}`;
    })
    .join("\n") + "\n";
}

function renderSkillMarkdown(skillName: string, candidate: any, manifest: any) {
  const description = String(candidate.intent?.description || candidate.task_summary || "Generated mobile demonstration skill.");
  return `---
name: ${skillName}
description: ${JSON.stringify(description.replace(/\n/g, " "))}
clawmobile_generated: true
clawmobile_skill_role: fixed_trace_reference
feedback_supported: true
feedback_tool: clawmobile_skill_record_feedback
status_tool: clawmobile_skill_status
---

# ${candidate.intent?.name || skillName}

Generated ClawMobile skill from a recorded demonstration.

This skill is a reusable execution guide for OpenClaw. It is not a hardcoded
script: follow the verification and fallback rules, and stop if the current UI
no longer matches the recorded assumptions.

## Source

- Trace: \`${candidate.source_trace_id || ""}\`
- Generated at: \`${manifest.generated_at}\`
- Candidate schema: \`${candidate.schema_version || ""}\`

## Intent

${candidate.task_summary || description}

## Parameters

${renderParameters(candidate.intent?.parameters)}
## Preconditions

${markdownList(asArray(candidate.preconditions))}
## Anchors

${renderAnchorTable(candidate.anchors)}
## Execution Flow

${renderExecutionSteps(candidate)}
## Verification

${markdownList(asArray(candidate.verification))}
## Fallback

${markdownList(asArray(candidate.fallback))}
## Warnings

${markdownList(asArray(candidate.warnings))}
## Raw Candidate

The full source candidate is stored next to this file as
\`skill_candidate.json\`. Use it as the source of truth for exact anchor
metadata.
`;
}

function copyIfExists(src: string | null, dst: string) {
  if (!src || !fs.existsSync(src)) return false;
  fs.copyFileSync(src, dst);
  return true;
}

function writeGeneratedSkill(dir: string, skillName: string, loaded: LoadedCandidate, validation: any) {
  ensureDir(dir);
  const generatedAt = new Date().toISOString();
  const fixedSkillPath = path.join(dir, "fixed_SKILL.md");
  const primarySkillPath = path.join(dir, "SKILL.md");
  const manifestPath = path.join(dir, "manifest.json");
  const manifest: any = {
    schema_version: GENERATED_SKILL_MANIFEST_VERSION,
    clawmobile_generated: true,
    feedback_supported: true,
    feedback_tool: "clawmobile_skill_record_feedback",
    status_tool: "clawmobile_skill_status",
    generated_at: generatedAt,
    skill_name: skillName,
    source_trace_id: loaded.candidate.source_trace_id || "",
    source_candidate_path: loaded.candidatePath,
    source_trace_path: loaded.tracePath,
    primary_skill_path: primarySkillPath,
    fixed_skill_path: fixedSkillPath,
    generalized_skill_path: path.join(dir, "generalized_skill.json"),
    generalized_skill_markdown_path: path.join(dir, "generalized_SKILL.md"),
    candidate_intent: loaded.candidate.intent || {},
    validation,
  };

  writeJsonFile(path.join(dir, "skill_candidate.json"), loaded.candidate);
  copyIfExists(loaded.tracePath, path.join(dir, "source_trace.json"));
  fs.writeFileSync(fixedSkillPath, renderSkillMarkdown(skillName, loaded.candidate, manifest));
  const generalized = generalizeSkill({ recording_dir: dir, output_dir: dir, skill_name: skillName });
  manifest.generalized_validation = generalized.validation;
  writeJsonFile(manifestPath, manifest);
  return manifest;
}

function loadRegistry(registryPath: string) {
  if (!fs.existsSync(registryPath)) {
    return { schema_version: "clawmobile.generated_skill_registry.v1", updated_at: "", skills: [] as any[] };
  }
  try {
    const parsed = readJsonFile<any>(registryPath);
    if (!Array.isArray(parsed.skills)) parsed.skills = [];
    return parsed;
  } catch {
    return { schema_version: "clawmobile.generated_skill_registry.v1", updated_at: "", skills: [] as any[] };
  }
}

function renderIndexSkill(registry: any) {
  const lines = [
    "---",
    `name: ${GENERATED_INDEX_SKILL_NAME}`,
    `description: ${JSON.stringify("Index of ClawMobile skills generated from recorded demonstrations.")}`,
    "---",
    "",
    "# ClawMobile Generated Skill Index",
    "",
    "Use this skill when the user asks to reuse a task generated from a prior ClawMobile demonstration.",
    "",
    "Generated skills are stored as sibling directories under this workspace `skills/` directory.",
    "",
    "## Available Generated Skills",
    "",
  ];

  if (!registry.skills.length) {
    lines.push("- None yet.");
  } else {
    for (const item of registry.skills) {
      lines.push(
        `- \`${item.skill_name}\`: ${item.description || item.intent_name || ""} (trace: \`${item.source_trace_id || ""}\`, path: \`${item.skill_dir || ""}\`, status: \`${item.status_tool || "clawmobile_skill_status"}\`)`
      );
    }
  }

  lines.push("", "When using a generated skill, open its `SKILL.md` and follow its verification and fallback rules.");
  lines.push("Generated skills should also record lightweight execution feedback with `clawmobile_skill_record_feedback` when it is low-friction, especially after failures, partial completions, or informative successes.");
  lines.push("Use `clawmobile_skill_status` when structured prior execution evidence is useful.");
  return lines.join("\n") + "\n";
}

function updateGeneratedIndex(workspaceSkillsDir: string, entry: any) {
  const indexDir = path.join(workspaceSkillsDir, GENERATED_INDEX_SKILL_NAME);
  ensureDir(indexDir);
  const registryPath = path.join(indexDir, "registry.json");
  const registry = loadRegistry(registryPath);
  registry.updated_at = new Date().toISOString();
  registry.skills = registry.skills.filter((item: any) => item.skill_name !== entry.skill_name);
  registry.skills.push(entry);
  registry.skills.sort((a: any, b: any) => String(a.skill_name).localeCompare(String(b.skill_name)));
  writeJsonFile(registryPath, registry);
  fs.writeFileSync(path.join(indexDir, "SKILL.md"), renderIndexSkill(registry));
  return { index_dir: indexDir, registry_path: registryPath };
}

export function promoteSkillCandidate(input: PromoteInput) {
  const loaded = loadCandidate(input);
  const validation = validateCandidateForPromotion(loaded.candidate);
  if (!validation.ok) {
    return {
      ok: false,
      candidate_path: loaded.candidatePath,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  const skillName = generatedSkillName(loaded.candidate, input.skill_name);
  const localBaseDir = input.output_dir
    ? resolvePath(input.output_dir)
    : path.join(loaded.recordingDir, "generated_skills");
  const localSkillDir = path.join(localBaseDir, skillName);
  const localManifest = writeGeneratedSkill(localSkillDir, skillName, loaded, validation);

  const install = input.install !== false;
  let installed: any = null;
  let index: any = null;
  if (install) {
    const workspaceSkillsDir = path.join(getWorkspaceDir(), "skills");
    const installedSkillDir = path.join(workspaceSkillsDir, skillName);
    const installManifest = writeGeneratedSkill(installedSkillDir, skillName, loaded, validation);
    installed = {
      skill_dir: installedSkillDir,
      skill_path: path.join(installedSkillDir, "SKILL.md"),
      fixed_skill_path: path.join(installedSkillDir, "fixed_SKILL.md"),
      generalized_skill_path: path.join(installedSkillDir, "generalized_skill.json"),
      generalized_skill_markdown_path: path.join(installedSkillDir, "generalized_SKILL.md"),
      manifest_path: path.join(installedSkillDir, "manifest.json"),
      manifest: installManifest,
    };
    index = updateGeneratedIndex(workspaceSkillsDir, {
      skill_name: skillName,
      skill_dir: installedSkillDir,
      description: loaded.candidate.intent?.description || loaded.candidate.task_summary || "",
      intent_name: loaded.candidate.intent?.name || "",
      source_trace_id: loaded.candidate.source_trace_id || "",
      clawmobile_generated: true,
      feedback_tool: "clawmobile_skill_record_feedback",
      status_tool: "clawmobile_skill_status",
      updated_at: new Date().toISOString(),
    });
  }

  return {
    ok: true,
    skill_name: skillName,
    candidate_path: loaded.candidatePath,
    source_trace_path: loaded.tracePath,
    local_skill_dir: localSkillDir,
    local_skill_path: path.join(localSkillDir, "SKILL.md"),
    local_fixed_skill_path: path.join(localSkillDir, "fixed_SKILL.md"),
    local_generalized_skill_path: path.join(localSkillDir, "generalized_skill.json"),
    local_generalized_skill_markdown_path: path.join(localSkillDir, "generalized_SKILL.md"),
    local_manifest_path: path.join(localSkillDir, "manifest.json"),
    local_manifest: localManifest,
    installed,
    generated_index: index,
    validation,
    next_steps: install
      ? [
          "The generated skill is installed under the OpenClaw workspace skills directory.",
          "Explain the generated skill to the user: intent, required parameters, plain-language steps, fast-path availability, and important uncertainties.",
          "If the user is not satisfied with the generated behavior, ask them to record another demonstration of the same task and update this skill rather than hand-editing app-specific rules.",
          "When execution fails or partially succeeds, record feedback and suggest a correction demo if the failure points to an anchor, entry-state, or layout mismatch.",
          "If the running OpenClaw session does not notice it immediately, restart or rerun the gateway so skills are reloaded.",
        ]
      : [
          "Review the generated SKILL.md, including the Skill Review and Execution Feedback sections.",
          "If it matches the intended behavior, rerun with install=true to copy it into the OpenClaw workspace skills directory.",
        ],
  };
}
