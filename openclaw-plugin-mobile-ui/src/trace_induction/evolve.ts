import fs from "fs";
import os from "os";
import path from "path";
import { getWorkspaceDir } from "../tools/workspace";
import { refreshExecutionExperience } from "./experience";
import { generalizeSkill, renderGeneralizedSkillMarkdown } from "./generalize";

const GENERALIZED_SKILL_SCHEMA_VERSION = "clawmobile.skill.v2";

type EvolveInput = {
  existing_skill_dir?: string;
  skill_dir?: string;
  existing_skill_path?: string;
  new_recording_dir_or_candidate_path?: string;
  recording_dir?: string;
  candidate_path?: string;
  output_dir?: string;
  skill_name?: string;
  allow_intent_mismatch?: boolean;
};

type LoadedExistingSkill = {
  skillDir: string;
  generalizedPath: string;
  generalized: any;
  skillName: string;
};

type LoadedCandidate = {
  candidatePath: string;
  candidate: any;
  recordingDir: string;
  tracePath: string | null;
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

function asArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function asObject(value: any) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values: any[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale;
}

function slugify(value: string, fallback: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

function parseSkillName(skillMarkdownPath: string, fallback: string) {
  if (!fs.existsSync(skillMarkdownPath)) return fallback;
  const text = fs.readFileSync(skillMarkdownPath, "utf8");
  const match = text.match(/^name:\s*([^\n]+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : fallback;
}

function loadExistingSkill(input: EvolveInput): LoadedExistingSkill {
  const requested = String(input.existing_skill_dir || input.skill_dir || input.existing_skill_path || "").trim();
  if (!requested) throw new Error("existing_skill_dir, skill_dir, or existing_skill_path is required");

  const resolved = resolvePath(requested);
  const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
  if (!stat) throw new Error(`existing skill path not found: ${resolved}`);

  const skillDir = stat.isDirectory() ? resolved : path.dirname(resolved);
  const generalizedPath = path.join(skillDir, "generalized_skill.json");
  if (!fs.existsSync(generalizedPath)) {
    throw new Error(`generalized_skill.json not found in existing skill dir: ${skillDir}`);
  }

  const generalized = readJsonFile<any>(generalizedPath);
  if (generalized.schema_version !== GENERALIZED_SKILL_SCHEMA_VERSION) {
    throw new Error(`expected ${GENERALIZED_SKILL_SCHEMA_VERSION}, got ${generalized.schema_version || "unknown"}`);
  }

  return {
    skillDir,
    generalizedPath,
    generalized,
    skillName: input.skill_name || parseSkillName(path.join(skillDir, "SKILL.md"), path.basename(skillDir)),
  };
}

function loadCandidate(input: EvolveInput): LoadedCandidate {
  const requested = String(
    input.candidate_path || input.recording_dir || input.new_recording_dir_or_candidate_path || ""
  ).trim();
  if (!requested) throw new Error("new_recording_dir_or_candidate_path, recording_dir, or candidate_path is required");

  const resolved = resolvePath(requested);
  const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
  if (!stat) throw new Error(`new trace/candidate path not found: ${resolved}`);

  let candidatePath = stat.isDirectory() ? path.join(resolved, "skill_candidate.json") : resolved;
  if (path.basename(candidatePath) === "trace.json") candidatePath = path.join(path.dirname(candidatePath), "skill_candidate.json");
  if (!fs.existsSync(candidatePath)) {
    throw new Error(`skill_candidate.json not found: ${candidatePath}; run trace induction/save before updating a skill`);
  }

  const recordingDir = path.dirname(candidatePath);
  const tracePath = path.join(recordingDir, "trace.json");
  return {
    candidatePath,
    candidate: readJsonFile<any>(candidatePath),
    recordingDir,
    tracePath: fs.existsSync(tracePath) ? tracePath : null,
  };
}

function buildNewGeneralized(candidatePath: string, skillName: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawmobile-skill-update-"));
  const res = generalizeSkill({ candidate_path: candidatePath, output_dir: tmpDir, skill_name: skillName });
  return res.generalized_skill;
}

function procedureSignature(generalized: any) {
  return asArray(generalized.procedure)
    .map((step) => {
      const item = asObject(step);
      return item.action === "type_parameter" ? `${item.action}:${item.parameter || ""}` : `${item.action}:${item.anchor || ""}`;
    })
    .join("|");
}

function validateMerge(existing: any, incoming: any, allowIntentMismatch: boolean) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (existing.intent?.name !== incoming.intent?.name) {
    const message = `intent mismatch: existing=${existing.intent?.name || ""}, incoming=${incoming.intent?.name || ""}`;
    if (allowIntentMismatch) warnings.push(message);
    else errors.push(message);
  }
  const existingPackage = existing.app?.package || "";
  const incomingPackage = incoming.app?.package || "";
  if (existingPackage && incomingPackage && existingPackage !== incomingPackage) {
    errors.push(`app.package mismatch: existing=${existingPackage}, incoming=${incomingPackage}`);
  }

  const existingParams = Object.keys(asObject(existing.intent?.parameters));
  const incomingParams = Object.keys(asObject(incoming.intent?.parameters));
  for (const param of existingParams) {
    if (!incomingParams.includes(param)) warnings.push(`incoming trace does not declare existing parameter: ${param}`);
  }
  for (const param of incomingParams) {
    if (!existingParams.includes(param)) warnings.push(`incoming trace declares new parameter: ${param}`);
  }

  if (procedureSignature(existing) !== procedureSignature(incoming)) {
    warnings.push("procedure shape differs; keeping existing procedure as primary and using the new trace as evidence");
  }

  return { ok: errors.length === 0, errors, warnings };
}

function observationFor(anchor: any, traceId: string, candidatePath: string) {
  return {
    trace_id: traceId || "unknown_trace",
    source_anchor_id: anchor.source_anchor_id || "",
    source_step_id: anchor.source_step_id,
    x_norm: Number(anchor.x_norm),
    y_norm: Number(anchor.y_norm),
    x: anchor.x,
    y: anchor.y,
    confidence: anchor.confidence,
    candidate_path: candidatePath,
  };
}

function existingObservations(anchor: any, traceId: string, candidatePath: string) {
  const existing = asArray(anchor.observations);
  if (existing.length > 0) return existing;
  return [observationFor(anchor, traceId, candidatePath)];
}

function distanceNorm(a: any, b: any) {
  const ax = Number(a.x_norm);
  const ay = Number(a.y_norm);
  const bx = Number(b.x_norm);
  const by = Number(b.y_norm);
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function averageCoordinate(observations: any[], key: string) {
  const nums = observations.map((item) => Number(item[key])).filter(Number.isFinite);
  if (nums.length === 0) return undefined;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function anchorKindFromPolicy(anchor: any) {
  const explicit = String(anchor.anchor_role || anchor.action_role || "").trim();
  if (explicit) return explicit;
  const policy = asArray(anchor.grounding_policy).join(" ");
  const haystack = `${policy} ${anchor.replay_priority || ""} ${anchor.valid_when || ""}`.toLowerCase();
  if (/launcher|app_icon|home/.test(haystack)) return "launcher_icon";
  if (/send_button|send|confirm/.test(haystack)) return "post_text_action";
  if (/post_text|required_text|post-text action/.test(haystack)) return "post_text_action";
  if (/text[_ -]?entry[_ -]?trigger|opens? or focuses? text|open.*text-entry/.test(haystack)) return "text_input_trigger";
  if (/message_input|composer/.test(haystack)) return "text_input";
  if (/navigation|keyboard|toolbar|back/.test(haystack)) return "navigation_action";
  if (/conversation|contact|chat.*entry/.test(haystack)) return "list_entry";
  if (/text[_ -]?entry|text input|text-input|field|input|text/.test(haystack)) return "text_input";
  if (/list|grid|row|item|card/.test(haystack)) return "list_entry";
  return "generic";
}

function mergedStability(kind: string, maxDelta: number | null, count: number) {
  if (count < 2) return kind === "list_entry" || kind === "navigation_action" ? "contextual" : "observed_once";
  if (kind === "text_input" || kind === "text_input_trigger" || kind === "post_text_action") {
    if (maxDelta !== null && maxDelta <= 0.035) return "stable_multi_trace";
    if (maxDelta !== null && maxDelta <= 0.08) return "semi_static_multi_trace";
    return "variable_observed";
  }
  if (kind === "list_entry" || kind === "navigation_action") return "contextual_multi_trace";
  if (kind === "launcher_icon") return "observed_once_multi_trace";
  return maxDelta !== null && maxDelta <= 0.04 ? "stable_multi_trace" : "observed_once_multi_trace";
}

function mergeAnchor(
  _name: string,
  existingAnchor: any,
  incomingAnchor: any,
  existingTraceId: string,
  existingCandidatePath: string,
  traceId: string,
  candidatePath: string
) {
  const kind = anchorKindFromPolicy({ ...existingAnchor, ...incomingAnchor });
  const observations = [
    ...existingObservations(existingAnchor, existingTraceId || "existing_trace", existingCandidatePath || ""),
    observationFor(incomingAnchor, traceId, candidatePath),
  ];
  const deltas = observations
    .slice(1)
    .map((observation) => distanceNorm(observations[0], observation))
    .filter((value): value is number => value !== null);
  const maxDelta = deltas.length > 0 ? Math.max(...deltas) : null;
  const stability = mergedStability(kind, maxDelta, observations.length);
  const stableForReplay = maxDelta === null || maxDelta <= 0.035;
  const confidenceBump = observations.length > 1 && stableForReplay ? 0.08 : -0.05;
  const confidence = clamp(Math.max(Number(existingAnchor.confidence) || 0.5, Number(incomingAnchor.confidence) || 0.5) + confidenceBump, 0, 0.95);

  const merged = {
    ...existingAnchor,
    evidence: uniqueStrings([...asArray(existingAnchor.evidence), ...asArray(incomingAnchor.evidence)]),
    confidence: round(confidence, 3),
    stability,
    observations,
    observation_count: observations.length,
    max_observed_delta_norm: maxDelta === null ? null : round(maxDelta, 6),
    source_traces: uniqueStrings([...asArray(existingAnchor.source_traces), existingTraceId, traceId]),
    source_candidates: uniqueStrings([...asArray(existingAnchor.source_candidates), existingCandidatePath, candidatePath]),
  };

  if (stableForReplay) {
    const avgXNorm = averageCoordinate(observations, "x_norm");
    const avgYNorm = averageCoordinate(observations, "y_norm");
    const avgX = averageCoordinate(observations, "x");
    const avgY = averageCoordinate(observations, "y");
    if (typeof avgXNorm !== "undefined") merged.x_norm = round(avgXNorm);
    if (typeof avgYNorm !== "undefined") merged.y_norm = round(avgYNorm);
    if (typeof avgX !== "undefined") merged.x = Math.round(avgX);
    if (typeof avgY !== "undefined") merged.y = Math.round(avgY);
  } else if (kind === "text_input" || kind === "text_input_trigger" || kind === "post_text_action") {
    merged.replay_priority = "recorded_anchor_if_screen_matches";
    merged.reground_only_after =
      "anchor drifted across traces; re-check screen state and prefer regrounding when the recorded coordinate is not clearly safe";
  }

  return merged;
}

function mergeAnchors(existingSkill: any, incoming: any, traceId: string, candidatePath: string) {
  const result: Record<string, any> = {};
  const updates: any[] = [];
  const warnings: string[] = [];
  const existing = asObject(existingSkill.anchors);
  const existingTraceId = asArray(existingSkill.source_traces)[0] || "existing_trace";
  const existingCandidatePath = String(existingSkill.source_candidate_path || asArray(existingSkill.source_candidate_paths)[0] || "");
  const names = uniqueStrings([...Object.keys(asObject(existing)), ...Object.keys(asObject(incoming))]);
  for (const name of names) {
    const oldAnchor = asObject(existing[name]);
    const newAnchor = asObject(incoming[name]);
    if (existing[name] && incoming[name]) {
      result[name] = mergeAnchor(name, oldAnchor, newAnchor, existingTraceId, existingCandidatePath, traceId, candidatePath);
      updates.push({
        anchor: name,
        status: "merged",
        observation_count: result[name].observation_count,
        stability: result[name].stability,
        max_observed_delta_norm: result[name].max_observed_delta_norm,
      });
    } else if (existing[name]) {
      result[name] = oldAnchor;
      warnings.push(`incoming trace did not provide anchor ${name}; keeping existing anchor`);
      updates.push({ anchor: name, status: "kept_existing" });
    } else {
      result[name] = {
        ...newAnchor,
        observations: [observationFor(newAnchor, traceId, candidatePath)],
        observation_count: 1,
        source_traces: [traceId],
        source_candidates: [candidatePath],
      };
      warnings.push(`incoming trace introduced new anchor ${name}; added as single-trace evidence`);
      updates.push({ anchor: name, status: "added_from_incoming" });
    }
  }
  return { anchors: result, updates, warnings };
}

function unionByName(existing: any[], incoming: any[]) {
  const result: any[] = [];
  const seen = new Set<string>();
  for (const item of [...existing, ...incoming]) {
    const obj = asObject(item);
    const key = String(obj.name || JSON.stringify(obj));
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function pruneSingleTraceUncertainty(items: any[], sourceTraceCount: number) {
  return uniqueStrings(items).filter((item) => {
    if (sourceTraceCount < 2) return true;
    return !/single-trace draft/i.test(item);
  });
}

function validateEvolvedSkill(skill: any) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (skill.schema_version !== GENERALIZED_SKILL_SCHEMA_VERSION) errors.push(`schema_version must be ${GENERALIZED_SKILL_SCHEMA_VERSION}`);
  if (!skill.intent?.name) errors.push("intent.name is required");
  if (!Array.isArray(skill.source_traces) || skill.source_traces.length < 2) {
    warnings.push("source_traces has fewer than two traces after update");
  }
  for (const [name, anchor] of Object.entries(asObject(skill.anchors))) {
    const item = asObject(anchor);
    const n = Number(item.observation_count || 0);
    if (n < 1) warnings.push(`anchor ${name}: observation_count is missing`);
    for (const key of ["x_norm", "y_norm"]) {
      const value = Number(item[key]);
      if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(`anchor ${name}: ${key} must be in [0,1]`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function backupExisting(skillDir: string) {
  const backupDir = path.join(skillDir, "evolution_history");
  ensureDir(backupDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const files = ["generalized_skill.json", "generalized_SKILL.md", "SKILL.md"];
  for (const file of files) {
    const src = path.join(skillDir, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(backupDir, `${timestamp}_${file}`));
  }
  return backupDir;
}

function copyEvidence(skillDir: string, traceId: string, candidate: LoadedCandidate) {
  const evidenceDir = path.join(skillDir, "evidence", slugify(traceId || path.basename(candidate.recordingDir), "trace"));
  ensureDir(evidenceDir);
  fs.copyFileSync(candidate.candidatePath, path.join(evidenceDir, "skill_candidate.json"));
  if (candidate.tracePath) fs.copyFileSync(candidate.tracePath, path.join(evidenceDir, "trace.json"));
  return evidenceDir;
}

function updateManifest(skillDir: string, evolved: any, validation: any, evidenceDir: string) {
  const manifestPath = path.join(skillDir, "manifest.json");
  const manifest = fs.existsSync(manifestPath) ? readJsonFile<any>(manifestPath) : {};
  manifest.updated_at = new Date().toISOString();
  manifest.source_trace_id = evolved.source_traces?.[0] || manifest.source_trace_id || "";
  manifest.source_traces = evolved.source_traces || [];
  manifest.generalized_validation = validation;
  manifest.latest_evidence_dir = evidenceDir;
  writeJsonFile(manifestPath, manifest);
  return manifestPath;
}

export function updateSkillFromTrace(input: EvolveInput) {
  const existing = loadExistingSkill(input);
  const candidate = loadCandidate(input);
  const incoming = buildNewGeneralized(candidate.candidatePath, existing.skillName);
  const traceId = String(candidate.candidate.source_trace_id || incoming.source_traces?.[0] || path.basename(candidate.recordingDir));
  const mergeValidation = validateMerge(existing.generalized, incoming, input.allow_intent_mismatch === true);
  if (!mergeValidation.ok) {
    return {
      ok: false,
      errors: mergeValidation.errors,
      warnings: mergeValidation.warnings,
      existing_skill_dir: existing.skillDir,
      incoming_candidate_path: candidate.candidatePath,
    };
  }

  const outputDir = input.output_dir ? resolvePath(input.output_dir) : existing.skillDir;
  ensureDir(outputDir);
  if (outputDir === existing.skillDir) backupExisting(existing.skillDir);

  const anchorMerge = mergeAnchors(existing.generalized, incoming.anchors, traceId, candidate.candidatePath);
  const sourceTraces = uniqueStrings([...asArray(existing.generalized.source_traces), ...asArray(incoming.source_traces), traceId]);
  const evolved = {
    ...existing.generalized,
    source_traces: sourceTraces,
    source_candidate_paths: uniqueStrings([
      ...asArray(existing.generalized.source_candidate_paths),
      existing.generalized.source_candidate_path,
      candidate.candidatePath,
    ]),
    status: "draft_generalized",
    updated_at: new Date().toISOString(),
    app: { ...asObject(existing.generalized.app), ...asObject(incoming.app) },
    intent: {
      ...asObject(existing.generalized.intent),
      parameters: {
        ...asObject(existing.generalized.intent?.parameters),
        ...asObject(incoming.intent?.parameters),
      },
      not_covered_parameters: {
        ...asObject(existing.generalized.intent?.not_covered_parameters),
        ...asObject(incoming.intent?.not_covered_parameters),
      },
    },
    metadata: {
      ...asObject(existing.generalized.metadata),
      ...asObject(incoming.metadata),
      clawmobile_generated: true,
      feedback_supported: true,
      feedback_tool: "clawmobile_skill_record_feedback",
      status_tool: "clawmobile_skill_status",
      primary_skill_format: "generalized_skill_markdown",
    },
    entry_states: unionByName(asArray(existing.generalized.entry_states), asArray(incoming.entry_states)),
    anchors: anchorMerge.anchors,
    grounding_policy: Object.fromEntries(
      Object.entries(anchorMerge.anchors).map(([name, anchor]) => [name, asArray((anchor as any).grounding_policy).map(String)])
    ),
    verification: uniqueStrings([...asArray(existing.generalized.verification), ...asArray(incoming.verification)]),
    warnings: uniqueStrings([...asArray(existing.generalized.warnings), ...asArray(incoming.warnings), ...mergeValidation.warnings, ...anchorMerge.warnings]),
    evolution: {
      ...asObject(existing.generalized.evolution),
      can_update_from_future_traces: true,
      success_count: Number(existing.generalized.evolution?.success_count || 0),
      failure_count: Number(existing.generalized.evolution?.failure_count || 0),
      supporting_trace_count: sourceTraces.length,
      anchor_updates: anchorMerge.updates,
      open_uncertainties: pruneSingleTraceUncertainty(
        [
          ...asArray(existing.generalized.evolution?.open_uncertainties),
          ...asArray(incoming.evolution?.open_uncertainties),
          ...anchorMerge.warnings,
          "Multi-trace draft: anchor policies are based on observed trace agreement, not guaranteed app semantics.",
        ],
        sourceTraces.length
      ),
      update_history: [
        ...asArray(existing.generalized.evolution?.update_history),
        {
          updated_at: new Date().toISOString(),
          trace_id: traceId,
          candidate_path: candidate.candidatePath,
          anchor_updates: anchorMerge.updates,
        },
      ],
    },
  };

  refreshExecutionExperience(evolved);
  const validation = validateEvolvedSkill(evolved);
  evolved.validation = validation;
  const skillName = input.skill_name || existing.skillName;
  const evidenceDir = copyEvidence(outputDir, traceId, candidate);
  const jsonPath = path.join(outputDir, "generalized_skill.json");
  const markdownPath = path.join(outputDir, "generalized_SKILL.md");
  const primarySkillPath = path.join(outputDir, "SKILL.md");
  writeJsonFile(jsonPath, evolved);
  const markdown = renderGeneralizedSkillMarkdown(evolved, validation, skillName);
  fs.writeFileSync(markdownPath, markdown);
  fs.writeFileSync(primarySkillPath, markdown);
  const manifestPath = updateManifest(outputDir, evolved, validation, evidenceDir);

  return {
    ok: validation.ok,
    skill_name: skillName,
    existing_skill_dir: existing.skillDir,
    updated_skill_dir: outputDir,
    generalized_skill_path: jsonPath,
    generalized_skill_markdown_path: markdownPath,
    primary_skill_path: primarySkillPath,
    manifest_path: manifestPath,
    evidence_dir: evidenceDir,
    source_traces: sourceTraces,
    anchor_updates: anchorMerge.updates,
    validation,
    warnings: evolved.warnings,
    generalized_skill: evolved,
  };
}
