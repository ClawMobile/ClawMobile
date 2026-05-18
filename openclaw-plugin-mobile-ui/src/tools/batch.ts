import {
  android_ocr_dump,
  android_resolve_text_queries,
  android_screenshot,
  android_swipe,
  android_tap,
  android_type,
  android_ui_dump,
} from "./android";
import { adb_current_app, adb_keyevent, adb_open_app, adb_ui_dump_xml } from "../backends/adb";
import { truncateString } from "./workspace";
import { queryUiXml } from "./ui_xml";

const BATCH_SCHEMA_VERSION = "clawmobile.batch.v1";
const DEFAULT_MAX_STEPS = 20;
const HARD_MAX_STEPS = 50;

type BatchStep = {
  id?: string;
  action?: string;
  optional?: boolean;
  stop_on_error?: boolean;
  anchor?: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  durationMs?: number;
  text?: string;
  texts?: string[];
  parameter?: string;
  exact?: boolean;
  ignoreCase?: boolean;
  scope?: "line" | "word" | "all";
  matchPickStrategy?: "highest_confidence" | "clickable_first" | "bottom_most" | "top_most" | "left_most" | "right_most" | "largest" | "widest" | "tallest";
  key?: "HOME" | "BACK" | "RECENTS" | "ENTER";
  keycode?: number;
  ms?: number;
  contains?: string;
  package?: string;
  activity?: string;
  component?: string;
  waitMs?: number;
  ui_text_any?: string[];
  ui_text_all?: string[];
  allow_uncertain?: boolean;
  path?: string;
  lang?: string;
  psm?: number;
  minConfidence?: number;
  scale?: number;
  region?: { left: number; top: number; width: number; height: number };
};

type BatchInput = {
  label?: string;
  steps?: BatchStep[];
  anchors?: Record<string, any>;
  parameters?: Record<string, any>;
  screen_width?: number;
  screen_height?: number;
  dry_run?: boolean;
  stop_on_error?: boolean;
  screenshot_on_failure?: boolean;
  max_steps?: number;
};

type OcrMatchPickStrategy = Exclude<NonNullable<BatchStep["matchPickStrategy"]>, "clickable_first">;

function nowIso() {
  return new Date().toISOString();
}

function normalizeAction(action?: string) {
  return String(action || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function stepId(step: BatchStep, index: number) {
  return String(step.id || step.action || `step_${index + 1}`);
}

function clampMaxSteps(value: any) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_STEPS;
  return Math.min(Math.max(Math.trunc(n), 1), HARD_MAX_STEPS);
}

function numberOrNull(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveCoordinate(input: BatchInput, step: BatchStep) {
  const explicitX = numberOrNull(step.x);
  const explicitY = numberOrNull(step.y);
  if (explicitX !== null && explicitY !== null) {
    return { ok: true as const, x: Math.round(explicitX), y: Math.round(explicitY), source: "step_xy" };
  }

  const anchorName = String(step.anchor || "").trim();
  const anchor = anchorName ? input.anchors?.[anchorName] : null;
  if (!anchor) {
    return { ok: false as const, error: anchorName ? `anchor_not_found:${anchorName}` : "x_y_or_anchor_required" };
  }

  const anchorX = numberOrNull(anchor.x);
  const anchorY = numberOrNull(anchor.y);
  if (anchorX !== null && anchorY !== null) {
    return { ok: true as const, x: Math.round(anchorX), y: Math.round(anchorY), source: `anchor:${anchorName}` };
  }

  const xNorm = numberOrNull(anchor.x_norm);
  const yNorm = numberOrNull(anchor.y_norm);
  const width = numberOrNull(input.screen_width);
  const height = numberOrNull(input.screen_height);
  if (xNorm !== null && yNorm !== null && width !== null && height !== null) {
    return {
      ok: true as const,
      x: Math.round(xNorm * width),
      y: Math.round(yNorm * height),
      source: `anchor_norm:${anchorName}`,
    };
  }

  return { ok: false as const, error: `anchor_missing_coordinate:${anchorName}` };
}

function resolveText(input: BatchInput, step: BatchStep, action: string) {
  if (action === "type_parameter") {
    const name = String(step.parameter || "").trim();
    if (!name) return { ok: false as const, error: "parameter_required" };
    const value = input.parameters?.[name];
    if (value === undefined || value === null) return { ok: false as const, error: `parameter_not_found:${name}` };
    return { ok: true as const, text: String(value), source: `parameter:${name}` };
  }
  const text = String(step.text ?? "");
  if (!text) return { ok: false as const, error: "text_required" };
  return { ok: true as const, text, source: "step_text" };
}

function summarizeResult(result: any) {
  if (!result || typeof result !== "object") return result;
  const summarized: any = { ...result };
  if (typeof summarized.xml === "string") {
    summarized.xml_len = summarized.xml.length;
    summarized.xml_snip = truncateString(summarized.xml, 1200);
    delete summarized.xml;
  }
  if (typeof summarized.stdout === "string") summarized.stdout = truncateString(summarized.stdout, 1200);
  if (typeof summarized.stderr === "string") summarized.stderr = truncateString(summarized.stderr, 1200);
  if (Array.isArray(summarized.lines) && summarized.lines.length > 20) {
    summarized.lines = summarized.lines.slice(0, 20);
    summarized.lines_truncated = true;
  }
  if (Array.isArray(summarized.words) && summarized.words.length > 20) {
    summarized.words = summarized.words.slice(0, 20);
    summarized.words_truncated = true;
  }
  return summarized;
}

function isOk(result: any) {
  return result?.ok === true || result?.code === 0;
}

function normalizedText(value: any) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function textList(value: any) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8)
    : [];
}

function tapTextCandidates(step: BatchStep) {
  return Array.from(new Set([
    String(step.text || "").trim(),
    ...textList(step.texts),
  ].filter(Boolean))).slice(0, 8);
}

function ocrMatchPickStrategy(strategy?: BatchStep["matchPickStrategy"]): OcrMatchPickStrategy | undefined {
  return strategy === "clickable_first" ? "highest_confidence" : strategy;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateStep(input: BatchInput, step: BatchStep, action: string) {
  if (!action) return { ok: false, error: "action_required" };
  if (action === "tap" || action === "tap_anchor") return resolveCoordinate(input, step);
  if (action === "tap_text") {
    return tapTextCandidates(step).length > 0 ? { ok: true } : { ok: false, error: "text_required" };
  }
  if (action === "type" || action === "type_parameter") return resolveText(input, step, action);
  if (action === "swipe") {
    for (const key of ["x1", "y1", "x2", "y2"] as const) {
      if (numberOrNull(step[key]) === null) return { ok: false, error: `${key}_required` };
    }
    return { ok: true };
  }
  if (action === "keyevent") {
    if (step.key || numberOrNull(step.keycode) !== null) return { ok: true };
    return { ok: false, error: "key_or_keycode_required" };
  }
  if (action === "wait") {
    const ms = numberOrNull(step.ms);
    return ms !== null && ms >= 0 ? { ok: true } : { ok: false, error: "ms_required" };
  }
  if (action === "assert_ui_contains") {
    return String(step.contains || step.text || "").trim()
      ? { ok: true }
      : { ok: false, error: "contains_required" };
  }
  if (action === "assert_app_state") {
    const hasPackage = String(step.package || "").trim();
    const hasActivity = String(step.activity || "").trim();
    const hasTexts = textList(step.ui_text_any).length > 0 || textList(step.ui_text_all).length > 0;
    return hasPackage || hasActivity || hasTexts
      ? { ok: true }
      : { ok: false, error: "package_activity_or_ui_text_required" };
  }
  if (action === "open_app") {
    const hasPackage = String(step.package || "").trim();
    const hasComponent = String(step.component || "").trim();
    return hasPackage || hasComponent
      ? { ok: true }
      : { ok: false, error: "package_or_component_required" };
  }
  if (["screenshot", "ui_dump", "ocr_dump"].includes(action)) return { ok: true };
  return { ok: false, error: `unsupported_action:${action}` };
}

function activityMatches(actual: string, expected: string) {
  const a = String(actual || "").trim();
  const e = String(expected || "").trim();
  if (!e) return true;
  if (!a) return false;
  return a === e || a.endsWith(`.${e}`) || a.endsWith(e.replace(/^\./, "."));
}

async function assertAppState(step: BatchStep) {
  const expectedPackage = String(step.package || "").trim();
  const expectedActivity = String(step.activity || "").trim();
  const uiTextAny = textList(step.ui_text_any);
  const uiTextAll = textList(step.ui_text_all);
  const current = await adb_current_app();

  if (!isOk(current)) {
    return {
      ok: step.allow_uncertain === true,
      assertion: "app_state",
      error: "current_app_unavailable",
      needs_llm_state_check: true,
      current,
    };
  }

  const packageOk = !expectedPackage || (current as any).package === expectedPackage;
  const activityOk = activityMatches((current as any).activity, expectedActivity);
  if (!packageOk || !activityOk) {
    return {
      ok: false,
      assertion: "app_state",
      error: !packageOk ? "package_mismatch" : "activity_mismatch",
      expected: { package: expectedPackage, activity: expectedActivity },
      current,
      needs_regrounding: true,
    };
  }

  if (uiTextAny.length === 0 && uiTextAll.length === 0) {
    return {
      ok: true,
      assertion: "app_state",
      expected: { package: expectedPackage, activity: expectedActivity },
      current,
      static_check: "package_activity",
    };
  }

  const dump = await adb_ui_dump_xml({ maxOutputBytes: 0 });
  const xml = normalizedText((dump as any)?.xml || "");
  if (!isOk(dump) || !xml) {
    return {
      ok: step.allow_uncertain === true,
      assertion: "app_state",
      error: "ui_dump_unavailable_for_entry_text",
      expected: { package: expectedPackage, activity: expectedActivity, ui_text_any: uiTextAny, ui_text_all: uiTextAll },
      current,
      dump: summarizeResult(dump),
      needs_llm_state_check: true,
    };
  }

  const anyMatches = uiTextAny.filter((text) => xml.includes(normalizedText(text)));
  const missingAll = uiTextAll.filter((text) => !xml.includes(normalizedText(text)));
  const anyOk = uiTextAny.length === 0 || anyMatches.length > 0;
  const allOk = missingAll.length === 0;

  return {
    ok: anyOk && allOk,
    assertion: "app_state",
    expected: { package: expectedPackage, activity: expectedActivity, ui_text_any: uiTextAny, ui_text_all: uiTextAll },
    current,
    static_check: "package_activity_ui_text",
    ui_text_any_matches: anyMatches,
    ui_text_all_missing: missingAll,
    error: anyOk && allOk ? undefined : "entry_ui_text_mismatch",
    needs_llm_state_check: !(anyOk && allOk),
  };
}

async function executeStep(input: BatchInput, step: BatchStep, action: string) {
  if (action === "tap" || action === "tap_anchor") {
    const coord = resolveCoordinate(input, step);
    if (!coord.ok) return { ok: false, error: coord.error };
    const result = await android_tap({ x: coord.x, y: coord.y });
    return { ...result, resolved: { x: coord.x, y: coord.y, source: coord.source } };
  }

  if (action === "tap_text") {
    const texts = tapTextCandidates(step);
    if (texts.length === 0) return { ok: false, error: "text_required" };
    const dump = await adb_ui_dump_xml({ maxOutputBytes: 0 });
    const uiQuery = isOk(dump)
      ? queryUiXml(String((dump as any)?.xml || ""), {
          queries: texts.map((text, index) => ({
            name: `tap_text_${index + 1}`,
            text,
            exact: step.exact,
            ignoreCase: step.ignoreCase,
            region: step.region,
            matchPickStrategy: step.matchPickStrategy,
            maxMatches: 3,
          })),
        })
      : null;
    const uiMatch = (uiQuery as any)?.best?.selected || null;
    if (uiMatch) {
      const tap = await android_tap({ x: uiMatch.centerX, y: uiMatch.centerY });
      return {
        ...tap,
        resolved: {
          source: "ui_dump_text",
          text: (uiQuery as any)?.best?.query?.text || texts[0],
          candidates: texts,
          x: uiMatch.centerX,
          y: uiMatch.centerY,
          match: uiMatch,
          query_result: summarizeResult(uiQuery),
        },
      };
    }

    const resolved = await android_resolve_text_queries({
      path: step.path,
      matchRegion: step.region,
      matchPickStrategy: ocrMatchPickStrategy(step.matchPickStrategy),
      queries: texts.map((text, index) => (
        {
          name: `${step.id || "tap_text"}_${index + 1}`,
          text,
          region: step.region,
          scale: step.scale,
          lang: step.lang,
          psm: step.psm,
          minConfidence: step.minConfidence,
          exact: step.exact === true,
          ignoreCase: step.ignoreCase !== false,
          scope: step.scope || "all",
        }
      )),
    });
    const selected = (resolved as any)?.best?.selected;
    const x = numberOrNull(selected?.centerX);
    const y = numberOrNull(selected?.centerY);
    if (!isOk(resolved) || x === null || y === null) {
      return { ok: false, error: (resolved as any)?.error || "text_not_resolved", resolved: summarizeResult(resolved) };
    }
    const tap = await android_tap({ x: Math.round(x), y: Math.round(y) });
    return {
      ...tap,
      resolved: {
        source: "ocr_text",
        text: selected?.query?.text || texts[0],
        candidates: texts,
        x: Math.round(x),
        y: Math.round(y),
        match: selected,
        query_result: summarizeResult(resolved),
      },
    };
  }

  if (action === "type" || action === "type_parameter") {
    const resolved = resolveText(input, step, action);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const result = await android_type({ text: resolved.text });
    return { ...result, resolved: { source: resolved.source, text_length: resolved.text.length } };
  }

  if (action === "swipe") {
    return android_swipe({
      x1: Math.round(Number(step.x1)),
      y1: Math.round(Number(step.y1)),
      x2: Math.round(Number(step.x2)),
      y2: Math.round(Number(step.y2)),
      durationMs: step.durationMs,
    });
  }

  if (action === "keyevent") {
    return adb_keyevent({
      key: step.key,
      keycode: numberOrNull(step.keycode) === null ? undefined : Math.round(Number(step.keycode)),
    });
  }

  if (action === "wait") {
    const ms = Math.min(Math.max(Math.round(Number(step.ms)), 0), 30_000);
    await wait(ms);
    return { ok: true, waited_ms: ms };
  }

  if (action === "screenshot") return android_screenshot();
  if (action === "ui_dump") return android_ui_dump();
  if (action === "ocr_dump") {
    return android_ocr_dump({
      path: step.path,
      lang: step.lang,
      psm: step.psm,
      minConfidence: step.minConfidence,
      scale: step.scale,
      region: step.region,
    });
  }

  if (action === "assert_ui_contains") {
    const needle = String(step.contains || step.text || "");
    const dump = await adb_ui_dump_xml({ maxOutputBytes: 0 });
    const xml = String((dump as any)?.xml || "");
    return {
      ok: isOk(dump) && xml.includes(needle),
      assertion: "ui_contains",
      contains: needle,
      dump: summarizeResult(dump),
    };
  }

  if (action === "assert_app_state") {
    return assertAppState(step);
  }

  if (action === "open_app") {
    return adb_open_app({
      package: step.package,
      activity: step.activity,
      component: step.component,
      waitMs: step.waitMs ?? step.ms,
    });
  }

  return { ok: false, error: `unsupported_action:${action}` };
}

export async function clawmobile_batch_execute(input: BatchInput) {
  const startedAt = Date.now();
  const steps = Array.isArray(input?.steps) ? input.steps.slice(0, clampMaxSteps(input.max_steps)) : [];
  const warnings: string[] = [];
  const results: any[] = [];
  const dryRun = input?.dry_run === true;
  const defaultStopOnError = input?.stop_on_error !== false;

  if (!Array.isArray(input?.steps) || input.steps.length === 0) {
    return {
      ok: false,
      schema_version: BATCH_SCHEMA_VERSION,
      error: "steps_required",
      steps: [],
      warnings,
    };
  }
  if (input.steps.length > steps.length) {
    warnings.push(`steps truncated to ${steps.length}; requested ${input.steps.length}`);
  }

  let stoppedAt: any = null;
  let failure: any = null;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index] || {};
    const id = stepId(step, index);
    const action = normalizeAction(step.action);
    const validation = validateStep(input, step, action);
    const stepStarted = Date.now();

    if (!validation.ok) {
      const stepResult = {
        ok: false,
        id,
        index,
        action,
        error: (validation as any).error || "invalid_step",
        duration_ms: Date.now() - stepStarted,
      };
      results.push(stepResult);
      const shouldStop = step.stop_on_error ?? defaultStopOnError;
      if (!step.optional && shouldStop) {
        stoppedAt = { id, index, action };
        failure = stepResult;
        break;
      }
      continue;
    }

    if (dryRun) {
      results.push({
        ok: true,
        id,
        index,
        action,
        dry_run: true,
        duration_ms: Date.now() - stepStarted,
      });
      continue;
    }

    const rawResult = await executeStep(input, step, action);
    const stepOk = isOk(rawResult);
    const stepResult: any = {
      ok: stepOk,
      id,
      index,
      action,
      optional: step.optional === true,
      duration_ms: Date.now() - stepStarted,
      result: summarizeResult(rawResult),
    };
    results.push(stepResult);

    const shouldStop = step.stop_on_error ?? defaultStopOnError;
    if (!stepOk && !step.optional && shouldStop) {
      stoppedAt = { id, index, action };
      failure = stepResult;
      if (input.screenshot_on_failure === true) {
        const shot = await android_screenshot();
        stepResult.failure_screenshot = summarizeResult(shot);
      }
      break;
    }
  }

  const ok = !failure && results.every((item) => item.ok || item.optional);
  return {
    ok,
    schema_version: BATCH_SCHEMA_VERSION,
    label: input?.label || "",
    dry_run: dryRun,
    started_at: new Date(startedAt).toISOString(),
    completed_at: nowIso(),
    duration_ms: Date.now() - startedAt,
    executed_count: results.length,
    stopped_at: stoppedAt,
    failure,
    recoverable: Boolean(failure),
    results,
    warnings,
  };
}
