import fs from "fs";
import path from "path";
import { android_ocr_dump, android_ui_dump } from "../tools/android";
import { clawmobile_batch_execute } from "../tools/batch";
import { getWorkspaceDir, truncateString } from "../tools/workspace";
import { recordSkillFeedback } from "./feedback";
import { resolveWorkspaceSkillDirByName } from "./skill_paths";

type FastPathRunInput = {
  skill_dir?: string;
  skill_path?: string;
  skill_name?: string;
  parameters?: Record<string, any>;
  parameter_values?: Record<string, any>;
  dry_run?: boolean;
  allow_ineligible?: boolean;
  stop_on_error?: boolean;
  screenshot_on_failure?: boolean;
  max_steps?: number;
  final_check_texts?: string[];
  final_check_mode?: string;
  final_check_all?: boolean;
  record_feedback?: boolean;
};

function readJsonFile<T>(file: string) {
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

function requiredParameterNames(generalized: any) {
  return Object.entries(asObject(generalized.intent?.parameters))
    .filter(([, schema]) => asObject(schema).required === true)
    .map(([name]) => name);
}

function parameterTextRole(name: string) {
  const normalized = String(name || "").toLowerCase();
  if (/(title|subject|heading|name)/.test(normalized)) return "title";
  if (/(body|message|content|text|note|memo|description)/.test(normalized)) return "body";
  return "";
}

function checkTextRole(text: string) {
  const normalized = String(text || "").toLowerCase();
  if (/\b(title|subject|heading)\b/.test(normalized)) return "title";
  if (/\b(body|message|content|text|note|memo)\b/.test(normalized)) return "body";
  return "";
}

function inferMissingParametersFromCheckTexts(
  parameters: Record<string, any>,
  missing: string[],
  checkTexts: string[]
) {
  const assignments: string[] = [];
  const used = new Set<number>();

  for (const name of missing) {
    const role = parameterTextRole(name);
    if (!role) continue;
    const index = checkTexts.findIndex(
      (text, candidateIndex) => !used.has(candidateIndex) && checkTextRole(text) === role
    );
    if (index >= 0) {
      parameters[name] = checkTexts[index];
      used.add(index);
      assignments.push(`${name}<-${role}`);
    }
  }

  for (const name of missing) {
    if (typeof parameters[name] !== "undefined") continue;
    const index = checkTexts.findIndex((_text, candidateIndex) => !used.has(candidateIndex));
    if (index >= 0) {
      parameters[name] = checkTexts[index];
      used.add(index);
      assignments.push(`${name}<-position`);
    }
  }

  return assignments;
}

function inferParameters(input: FastPathRunInput, requiredNames: string[]) {
  const parameters = {
    ...asObject(input.parameter_values),
    ...asObject(input.parameters),
  };
  const warnings: string[] = [];
  const missing = requiredNames.filter((name) => typeof parameters[name] === "undefined");
  const checkTexts = asArray(input.final_check_texts)
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  if (missing.length > 0 && checkTexts.length >= missing.length) {
    const assignments = inferMissingParametersFromCheckTexts(parameters, missing, checkTexts);
    warnings.push(
      `inferred missing required parameters from final_check_texts: ${assignments.join(", ")}`
    );
  }

  return {
    parameters,
    warnings,
    missing: requiredNames.filter((name) => typeof parameters[name] === "undefined"),
  };
}

function asStringList(value: any) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8)
    : [];
}

function runtimeAppStateCheck(generalized: any) {
  const fastPath = asObject(generalized.fast_path);
  const fastCheck = asObject(fastPath.app_state_check);
  const entryChecks = asObject(generalized.entry_state_checks);
  const entryCheck = asObject(entryChecks.after_app_open || entryChecks.initial_app_state);
  const app = asObject(generalized.app);
  const pkg = String(fastCheck.package || entryCheck.package || app.package || "").trim();
  const activity = String(fastCheck.activity || entryCheck.activity || app.activity || "").trim();
  const uiTextAny = asStringList(fastCheck.ui_text_any || entryCheck.ui_text_any);
  const uiTextAll = asStringList(fastCheck.ui_text_all || entryCheck.ui_text_all);
  if (!pkg && !activity && uiTextAny.length === 0 && uiTextAll.length === 0) return null;
  const step: any = {
    id: "runtime_assert_app_state",
    action: "assert_app_state",
    package: pkg || undefined,
    activity: activity || undefined,
  };
  if (uiTextAny.length > 0) step.ui_text_any = uiTextAny;
  if (uiTextAll.length > 0) step.ui_text_all = uiTextAll;
  return step;
}

function withRuntimeAppStateCheck(generalized: any, steps: any[]) {
  if (steps.some((step) => String(asObject(step).action || "").trim() === "assert_app_state")) {
    return steps;
  }

  const check = runtimeAppStateCheck(generalized);
  if (!check || steps.length === 0) return steps;

  const anchors = asObject(generalized.anchors);
  const firstStep = asObject(steps[0]);
  const firstAnchor = asObject(anchors[String(firstStep.anchor || "")]);
  const firstRole = String(firstAnchor.anchor_role || firstAnchor.action_role || "");
  if (String(firstStep.action || "") === "tap_anchor" && firstRole === "launcher_icon") {
    const out = [...steps];
    const insertAt = String(asObject(out[1]).action || "") === "wait" ? 2 : 1;
    out.splice(insertAt, 0, { ...check, id: `runtime_assert_app_state_after_${firstStep.anchor || "app_launch"}` });
    return out;
  }

  return [check, ...steps];
}

function parseSkillName(skillMarkdownPath: string, fallback: string) {
  if (!fs.existsSync(skillMarkdownPath)) return fallback;
  const text = fs.readFileSync(skillMarkdownPath, "utf8");
  const match = text.match(/^name:\s*([^\n]+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : fallback;
}

function resolveSkillDir(input: FastPathRunInput) {
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

function summarizeToolResult(result: any) {
  if (!result || typeof result !== "object") return result;
  const out: any = { ...result };
  if (typeof out.xml === "string") {
    out.xml_len = out.xml.length;
    out.xml_snip = truncateString(out.xml, 1200);
    delete out.xml;
  }
  if (typeof out.text === "string") {
    out.text_len = out.text.length;
    out.text_snip = truncateString(out.text, 1200);
    delete out.text;
  }
  if (Array.isArray(out.words) && out.words.length > 20) {
    out.words = out.words.slice(0, 20);
    out.words_truncated = true;
  }
  if (Array.isArray(out.lines) && out.lines.length > 20) {
    out.lines = out.lines.slice(0, 20);
    out.lines_truncated = true;
  }
  return out;
}

function normalizeCheckText(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function containsAllOrAny(haystack: string, needles: string[], requireAll: boolean) {
  const lower = String(haystack || "").toLowerCase();
  const normalized = normalizeCheckText(haystack);
  const matches = needles.map((needle) => {
    const text = String(needle || "").trim();
    const direct = Boolean(text) && lower.includes(text.toLowerCase());
    const normalizedNeedle = normalizeCheckText(text);
    const normalizedMatch = Boolean(normalizedNeedle) && normalized.includes(normalizedNeedle);
    return { text, matched: direct || normalizedMatch, direct, normalized_match: normalizedMatch };
  });
  const ok = requireAll ? matches.every((item) => item.matched) : matches.some((item) => item.matched);
  return { ok, matches };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textFromOcrResult(result: any) {
  const chunks: string[] = [];
  if (typeof result?.text === "string") chunks.push(result.text);
  if (Array.isArray(result?.lines)) {
    chunks.push(
      result.lines
        .map((line: any) => String(line?.text || "").trim())
        .filter(Boolean)
        .join("\n")
    );
  }
  return chunks.filter(Boolean).join("\n");
}

function textFromUiDumpResult(result: any) {
  const keywords = asObject(result?.keywords);
  const chunks: string[] = [];
  for (const field of ["text", "content_desc"] as const) {
    const values = asArray(keywords[field]).map((item) => String(item || "").trim()).filter(Boolean);
    if (values.length > 0) chunks.push(values.join("\n"));
  }
  return chunks.filter(Boolean).join("\n");
}

async function runUiDumpTextCheck(texts: string[], requireAll: boolean) {
  const dump = await android_ui_dump({ compressed: true });
  const text = textFromUiDumpResult(dump);
  const result = containsAllOrAny(text, texts, requireAll);
  return {
    ok: result.ok,
    mode: "ui_dump_keyword_index",
    texts,
    require_all: requireAll,
    matches: result.matches,
    observation: summarizeToolResult(dump),
  };
}

async function runOcrTextCheck(texts: string[], requireAll: boolean, mode: string) {
  const ocr = await android_ocr_dump({});
  const text = textFromOcrResult(ocr);
  const result = containsAllOrAny(text, texts, requireAll);
  return {
    ok: result.ok,
    mode: mode === "ui_dump_then_ocr" ? "ocr_after_ui_query" : "ocr",
    texts,
    require_all: requireAll,
    matches: result.matches,
    observation: summarizeToolResult(ocr),
  };
}

async function runFinalCheck(input: FastPathRunInput) {
  const texts = asArray(input.final_check_texts).map(String).map((item) => item.trim()).filter(Boolean);
  const mode = String(input.final_check_mode || (texts.length ? "ui_dump_then_ocr" : "none")).trim().toLowerCase();
  const requireAll = input.final_check_all !== false;
  if (mode === "none" || texts.length === 0) {
    return { ok: true, skipped: true, mode, texts, matches: [] };
  }

  const checks: any[] = [];

  if (mode === "ui_dump" || mode === "ui_dump_then_ocr") {
    const dumpResult = await runUiDumpTextCheck(texts, requireAll);
    checks.push({ ...dumpResult, check: "ui_dump_keyword_index" });
    if (dumpResult.ok) {
      return {
        ...dumpResult,
        mode: "ui_dump_keyword_index",
        checks,
        verified_by: "ui_dump_keyword_index",
      };
    }

    if (mode === "ui_dump") {
      return {
        ok: dumpResult.ok,
        mode: "ui_dump_keyword_index",
        texts,
        require_all: requireAll,
        matches: dumpResult.matches,
        observation: dumpResult.observation,
        checks,
      };
    }
  }

  if (mode === "ocr" || mode === "ui_dump_then_ocr") {
    const result = await runOcrTextCheck(texts, requireAll, mode);
    checks.push({ ...result, check: "ocr" });
    if (result.ok || mode === "ocr") {
      return {
        ok: result.ok,
        mode: result.mode,
        texts,
        require_all: requireAll,
        matches: result.matches,
        observation: result.observation,
        checks,
        verified_by: result.ok ? result.mode : undefined,
      };
    }

    await wait(1200);
    const settled = await runUiDumpTextCheck(texts, requireAll);
    checks.push({ ...settled, check: "settled_ui_dump_keyword_index", delay_ms: 1200 });
    return {
      ok: settled.ok,
      mode: settled.ok ? "settled_ui_dump_keyword_index_after_ocr" : result.mode,
      texts,
      require_all: requireAll,
      matches: settled.ok ? settled.matches : result.matches,
      observation: settled.ok ? settled.observation : result.observation,
      checks,
      verified_by: settled.ok ? "settled_ui_dump_keyword_index_after_ocr" : undefined,
    };
  }

  return {
    ok: false,
    mode,
    texts,
    error: `unsupported_final_check_mode:${mode}`,
  };
}

function usedAnchorsFromSteps(steps: any[]) {
  return Array.from(
    new Set(
      steps
        .map((step) => String(asObject(step).anchor || "").trim())
        .filter(Boolean)
    )
  );
}

function failedAnchorFromBatch(batch: any) {
  const failure = asObject(batch?.failure);
  const stopped = asObject(batch?.stopped_at);
  const step = failure.id || stopped.id || "";
  const result = asObject(failure.result);
  const resolved = asObject(result.resolved);
  if (resolved.source && String(resolved.source).startsWith("anchor:")) {
    return String(resolved.source).slice("anchor:".length);
  }
  return String(step).match(/step_\d+_([^/]+)/)?.[1] || "";
}

function compactResolved(resolved: any) {
  const item = asObject(resolved);
  if (Object.keys(item).length === 0) return {};
  const match = asObject(item.match);
  return {
    source: item.source || "",
    text: item.text || undefined,
    x: item.x,
    y: item.y,
    match: Object.keys(match).length
      ? {
          text: match.text,
          content_desc: match.content_desc,
          resource_id: match.resource_id,
          class: match.class,
          left: match.left,
          top: match.top,
          width: match.width,
          height: match.height,
          centerX: match.centerX,
          centerY: match.centerY,
          matched_field: match.matched_field,
        }
      : undefined,
  };
}

function compactStepResult(step: any) {
  const item = asObject(step);
  const result = asObject(item.result);
  const failureScreenshot = asObject(item.failure_screenshot);
  const current = asObject(result.current);
  const expected = asObject(result.expected);
  return {
    ok: item.ok === true,
    id: item.id || "",
    index: item.index,
    action: item.action || "",
    optional: item.optional === true,
    duration_ms: item.duration_ms,
    error: item.error || result.error || undefined,
    assertion: result.assertion || undefined,
    expected: Object.keys(expected).length
      ? {
          package: expected.package,
          activity: expected.activity,
          ui_text_any: expected.ui_text_any,
          ui_text_all: expected.ui_text_all,
        }
      : undefined,
    current: Object.keys(current).length
      ? {
          package: current.package,
          activity: current.activity,
        }
      : undefined,
    needs_llm_state_check: result.needs_llm_state_check === true || undefined,
    needs_regrounding: result.needs_regrounding === true || undefined,
    resolved: compactResolved(result.resolved),
    failure_screenshot: failureScreenshot.path
      ? {
          path: failureScreenshot.path,
          width: failureScreenshot.width,
          height: failureScreenshot.height,
        }
      : undefined,
  };
}

function compactBatch(batch: any) {
  const item = asObject(batch);
  const results = asArray(item.results).map(compactStepResult);
  return {
    ok: item.ok === true,
    schema_version: item.schema_version,
    label: item.label,
    dry_run: item.dry_run === true,
    duration_ms: item.duration_ms,
    executed_count: item.executed_count,
    stopped_at: item.stopped_at || null,
    failure: item.failure ? compactStepResult(item.failure) : null,
    recoverable: item.recoverable === true,
    results,
    warnings: asArray(item.warnings),
  };
}

function compactObservation(observation: any) {
  const item = asObject(observation);
  const lines = asArray(item.lines)
    .map((line) => ({
      text: asObject(line).text,
      confidence: asObject(line).confidence,
      left: asObject(line).left,
      top: asObject(line).top,
      width: asObject(line).width,
      height: asObject(line).height,
    }))
    .filter((line) => String(line.text || "").trim())
    .slice(0, 12);
  return {
    ok: item.ok === true,
    engine: item.engine,
    path: item.path,
    captured: item.captured,
    width: item.width,
    height: item.height,
    xml_len: item.xml_len,
    text_len: item.text_len,
    lineCount: item.lineCount,
    wordCount: item.wordCount,
    lines,
    stderr_snip: item.stderr_snip,
  };
}

function compactFinalCheck(finalCheck: any) {
  const item = asObject(finalCheck);
  const checks = asArray(item.checks).map((check) => {
    const current = asObject(check);
    return {
      ok: current.ok === true,
      check: current.check,
      mode: current.mode,
      delay_ms: current.delay_ms,
      verified_by: current.verified_by,
      matches: asArray(current.matches),
      observation: current.observation ? compactObservation(current.observation) : undefined,
    };
  });
  return {
    ok: item.ok === true,
    skipped: item.skipped === true || undefined,
    mode: item.mode,
    verified_by: item.verified_by,
    texts: asArray(item.texts),
    require_all: item.require_all,
    matches: asArray(item.matches),
    checks: checks.length > 0 ? checks : undefined,
    error: item.error,
    observation: item.observation ? compactObservation(item.observation) : undefined,
  };
}

function compactFeedback(feedback: any) {
  const item = asObject(feedback);
  if (Object.keys(item).length === 0) return null;
  return {
    ok: item.ok === true,
    outcome: item.outcome,
    success_count: item.success_count,
    failure_count: item.failure_count,
    verified_context_count: item.verified_context_count,
    failure_pattern_count: item.failure_pattern_count,
    validation: item.validation,
    feedback_log_path: item.feedback_log_path,
  };
}

function fastPathSelfRepairGuidance(ok: boolean, batch: any, finalCheck: any) {
  if (ok) {
    return {
      recommended: false,
      reason: "fast_path_succeeded",
    };
  }

  const failure = asObject(batch?.failure);
  const failedStep = String(failure.id || asObject(batch?.stopped_at).id || "");
  const failedAction = String(failure.action || asObject(batch?.stopped_at).action || "");
  const failureError = String(failure.error || asObject(failure.result).error || "");
  const result = asObject(failure.result);
  const expected = asObject(result.expected);
  const current = asObject(result.current);
  const packageActivityMatched =
    failedAction === "assert_app_state" &&
    failureError === "entry_ui_text_mismatch" &&
    Boolean(expected.package || expected.activity) &&
    current.package === expected.package;

  const hints: string[] = [];
  if (packageActivityMatched) {
    hints.push(
      "Package/activity matched but entry UI text did not. Consider a one-time fast-path reflection that relaxes entry text from a hard gate to evidence, or adds observed entry text candidates."
    );
  } else if (failedAction === "tap_text") {
    hints.push(
      "A tap_text step failed. Inspect the current UI with android_ui_query/android_ui_dump, then add better text candidates for that step if the target is visible."
    );
  } else if (failedAction === "tap_anchor") {
    hints.push(
      "A recorded anchor failed. Inspect whether the current state is wrong or the anchor moved before changing the skill."
    );
  }
  if (finalCheck && finalCheck.ok === false) {
    hints.push("Execution finished but final verification failed; reflect on whether the procedure or final verifier needs repair.");
  }

  return {
    recommended: true,
    tool: "clawmobile_skill_reflect_fast_path_failure",
    retry_limit: 1,
    failed_step: failedStep,
    failed_action: failedAction,
    failure_error: failureError,
    safe_repair_hints: hints,
    fallback_after_retry:
      "If one repaired fast-path retry fails, switch to normal stepwise execution/regrounding and record feedback. If normal execution fails too, ask the user for another demonstration of the same task.",
  };
}

export async function runSkillFastPath(input: FastPathRunInput) {
  const skillDir = resolveSkillDir(input);
  const skillName = input.skill_name || parseSkillName(path.join(skillDir, "SKILL.md"), path.basename(skillDir));
  const generalizedPath = path.join(skillDir, "generalized_skill.json");
  if (!fs.existsSync(generalizedPath)) {
    throw new Error(`generalized_skill.json not found in skill dir: ${skillDir}`);
  }

  const generalized = readJsonFile<any>(generalizedPath);
  const fastPath = asObject(generalized.fast_path);
  const steps = withRuntimeAppStateCheck(generalized, asArray(fastPath.steps));
  const eligible = fastPath.eligible === true;
  const allowIneligible = input.allow_ineligible === true;
  const parameterBinding = inferParameters(input, requiredParameterNames(generalized));
  const missingParameters = parameterBinding.missing;

  if (missingParameters.length > 0) {
    return {
      ok: false,
      skill_name: skillName,
      skill_dir: skillDir,
      error: "missing_required_parameters",
      missing_parameters: missingParameters,
      hint: "Pass required skill variables under the `parameters` object, for example parameters: {\"message_text\":\"...\"}.",
    };
  }
  if (!eligible && !allowIneligible) {
    return {
      ok: false,
      skill_name: skillName,
      skill_dir: skillDir,
      error: "fast_path_not_eligible",
      unsupported: asArray(fastPath.unsupported),
      hint: "Regenerate the skill with a batch-compatible fast path, or rerun with allow_ineligible=true for debugging.",
    };
  }
  if (steps.length === 0) {
    return { ok: false, skill_name: skillName, skill_dir: skillDir, error: "fast_path_steps_required" };
  }

  const batch = await clawmobile_batch_execute({
    label: `generated-skill:${skillName}`,
    steps,
    anchors: asObject(generalized.anchors),
    parameters: parameterBinding.parameters,
    dry_run: input.dry_run === true,
    stop_on_error: input.stop_on_error,
    screenshot_on_failure: input.screenshot_on_failure !== false,
    max_steps: input.max_steps,
  });
  const executionOk = batch.ok === true;
  const finalCheck = executionOk && input.dry_run !== true ? await runFinalCheck(input) : { ok: true, skipped: true };
  const verificationOk = finalCheck.ok === true;
  const ok = executionOk && verificationOk;
  const compactedBatch = compactBatch(batch);
  const compactedFinalCheck = compactFinalCheck(finalCheck);
  const selfRepair = fastPathSelfRepairGuidance(ok, compactedBatch, compactedFinalCheck);

  let feedback: any = null;
  if (input.record_feedback === true && input.dry_run !== true) {
    const outcome = ok ? "success" : executionOk ? "partial" : "failure";
    feedback = recordSkillFeedback({
      skill_dir: skillDir,
      outcome,
      execution_summary: ok
        ? `Generated skill fast path completed for ${skillName}.`
        : `Generated skill fast path did not fully verify for ${skillName}.`,
      failed_step: executionOk ? "" : String(asObject(batch.stopped_at).id || ""),
      failed_anchor: executionOk ? "" : failedAnchorFromBatch(batch),
      used_anchors: usedAnchorsFromSteps(steps),
      parameters: parameterBinding.parameters,
      observations: { final_check: compactedFinalCheck },
      tool_results: { batch: compactedBatch },
      repair_hint: ok ? "" : "Use normal stepwise recovery/regrounding, then record updated feedback.",
    });
  }

  return {
    ok,
    skill_name: skillName,
    skill_dir: skillDir,
    schema_version: "clawmobile.skill_fast_path_run.v1",
    execution_ok: executionOk,
    verification_ok: verificationOk,
    dry_run: input.dry_run === true,
    fast_path: {
      eligible,
      mode: fastPath.mode || "",
      step_count: steps.length,
      unsupported: asArray(fastPath.unsupported),
      parameter_warnings: parameterBinding.warnings,
    },
    batch: compactedBatch,
    final_check: compactedFinalCheck,
    feedback: compactFeedback(feedback),
    self_repair: selfRepair,
    fallback_required: !ok,
  };
}
