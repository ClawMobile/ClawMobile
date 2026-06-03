import fs from "fs";
import path from "path";
import { getWorkspaceDir } from "../tools/workspace";
import { refreshExecutionExperience } from "./experience";

const GENERALIZED_SKILL_SCHEMA_VERSION = "clawmobile.skill.v2";
const SKILL_CANDIDATE_SCHEMA_VERSION = "clawmobile.skill_candidate.v1";

type GeneralizeInput = {
  skill_or_trace_path?: string;
  recording_dir_or_candidate_path?: string;
  recording_dir?: string;
  candidate_path?: string;
  output_dir?: string;
  skill_name?: string;
};

type LoadedCandidate = {
  baseDir: string;
  candidatePath: string;
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

function asArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function asObject(value: any) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asStringList(value: any) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8)
    : [];
}

function slugify(value: string, fallback: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

function loadCandidate(input: GeneralizeInput): LoadedCandidate {
  const requested = String(
    input.candidate_path ||
      input.recording_dir ||
      input.recording_dir_or_candidate_path ||
      input.skill_or_trace_path ||
      ""
  ).trim();
  if (!requested) {
    throw new Error("skill_or_trace_path, candidate_path, or recording_dir is required");
  }

  const resolved = resolvePath(requested);
  const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
  if (!stat) throw new Error(`generalization input not found: ${resolved}`);

  let candidatePath = stat.isDirectory() ? path.join(resolved, "skill_candidate.json") : resolved;
  if (path.basename(candidatePath) === "trace.json") {
    candidatePath = path.join(path.dirname(candidatePath), "skill_candidate.json");
  }
  if (!fs.existsSync(candidatePath)) {
    throw new Error(`skill_candidate.json not found: ${candidatePath}; run trace induction/save before generalization`);
  }

  return {
    baseDir: path.dirname(candidatePath),
    candidatePath,
    candidate: readJsonFile<any>(candidatePath),
  };
}

function hasDeclaredParameter(candidate: any, names: string[]) {
  const parameters = asObject(candidate.intent?.parameters);
  return names.some((name) => Object.prototype.hasOwnProperty.call(parameters, name));
}

function isMessagingSkill(candidate: any) {
  const haystack = [
    candidate.intent?.name,
    candidate.intent?.description,
    candidate.task_summary,
    candidate.app?.package,
  ]
    .map((item) => String(item || "").toLowerCase())
    .join(" ");
  return /(message|chat|wechat|weixin|send)/.test(haystack);
}

function skillDomain(candidate: any) {
  if (isMessagingSkill(candidate)) return "messaging";
  const haystack = [
    candidate.intent?.name,
    candidate.intent?.description,
    candidate.task_summary,
    candidate.app?.package,
  ]
    .map((item) => String(item || "").toLowerCase())
    .join(" ");
  if (/(keep|note|notes|memo|notepad)/.test(haystack)) return "notes";
  if (/(search|query)/.test(haystack)) return "search";
  if (/(form|submit|field)/.test(haystack)) return "form";
  return "generic";
}

function explicitAnchorRole(anchor: any) {
  const role = String(anchor.anchor_role || anchor.action_role || "").trim();
  const allowed = new Set([
    "launcher_icon",
    "text_input_trigger",
    "text_input",
    "post_text_action",
    "navigation_action",
    "list_entry",
    "generic",
  ]);
  return allowed.has(role) ? role : "";
}

function anchorKind(name: string, anchor: any, _candidate?: any) {
  const explicit = explicitAnchorRole(anchor);
  if (explicit) return explicit;
  const evidence = asArray(anchor.evidence).join(" ");
  const identity = `${name} ${anchor.role || ""} ${anchor.source_anchor_id || ""}`.toLowerCase();
  const haystack = `${identity} ${evidence}`.toLowerCase();
  if (/launcher|home.*icon|app[_ -]?icon/.test(haystack)) return "launcher_icon";
  if (/send|confirm|post_text/.test(haystack)) return "post_text_action";
  if (/keyboard|hide[_ -]?keyboard|toolbar.*back|back.*toolbar|nav(igation)?|back/.test(identity)) return "navigation_action";
  if (/message_input/.test(haystack)) return "text_input";
  if (/text_input_focus_candidate|new.*(text|note)|create.*(text|note)|add.*(text|note)|take.*note/.test(haystack)) {
    return "text_input_trigger";
  }
  if (/conversation|contact|chat.*entry/.test(haystack)) return "list_entry";
  if (/input|composer|text|field|title|body|note/.test(haystack)) return "text_input";
  if (/list|grid|row|item|card/.test(haystack)) return "list_entry";
  return "generic";
}

function anchorStability(kind: string) {
  if (kind === "text_input" || kind === "text_input_trigger" || kind === "post_text_action") return "semi_static";
  if (kind === "list_entry" || kind === "navigation_action") return "contextual";
  return "observed_once";
}

function anchorPolicy(kind: string) {
  if (kind === "text_input") {
    return [
      "use_recorded_anchor_if_text_entry_context_matches",
      "verify_focus_after_tap",
      "reground_only_if_recorded_tap_fails",
    ];
  }
  if (kind === "text_input_trigger") {
    return [
      "use_recorded_anchor_if_text_entry_trigger_matches",
      "verify_expected_text_entry_state_after_tap",
      "reground_only_if_recorded_tap_fails",
    ];
  }
  if (kind === "post_text_action") {
    return [
      "use_recorded_anchor_after_required_text_input",
      "do_not_replace_with_visual_guess_before_first_tap",
      "verify_after_recorded_tap",
      "reground_only_if_recorded_tap_fails",
    ];
  }
  if (kind === "navigation_action") {
    return [
      "use_recorded_anchor_if_navigation_state_matches",
      "prefer_keyevent_if_equivalent_and_safer",
      "verify_expected_state_change",
    ];
  }
  if (kind === "list_entry") {
    return ["use_recorded_anchor_if_list_or_grid_matches", "reground_by_visible_text_if_available", "otherwise_applicable_with_regrounding"];
  }
  if (kind === "launcher_icon") {
    return ["use_recorded_anchor_if_launcher_matches", "reground_by_app_icon_if_available", "open_package_if_supported"];
  }
  return ["use_recorded_anchor_if_screen_matches", "reground_if_uncertain"];
}

function validWhen(candidate: any, kind: string) {
  const pkg = candidate.app?.package ? `package=${candidate.app.package}` : "same app";
  if (kind === "launcher_icon") {
    return "Android launcher/home screen is visible and the recorded app icon remains at the recorded location.";
  }
  if (kind === "text_input") return `${pkg}; the recorded text-entry screen or field/control is visible.`;
  if (kind === "text_input_trigger") return `${pkg}; the recorded control that opens or focuses text entry is visible.`;
  if (kind === "post_text_action") {
    return `${pkg}; required text parameters have been entered and the recorded post-text action control is visible.`;
  }
  if (kind === "navigation_action") return `${pkg}; the recorded navigation, toolbar, or keyboard state matches this procedure point.`;
  if (kind === "list_entry") return `${pkg}; the recorded list/grid item or equivalent regrounded item is visible.`;
  return `${pkg}; the current screen matches the recorded UI state closely enough.`;
}

function domainRoleForAnchor(name: string, anchor: any, kind: string, candidate: any) {
  const domain = skillDomain(candidate);
  const evidence = asArray(anchor.evidence).join(" ");
  const haystack = `${name} ${anchor.role || ""} ${anchor.source_anchor_id || ""} ${evidence}`.toLowerCase();
  if (domain === "messaging") {
    if (kind === "post_text_action") return "send_button";
    if (kind === "text_input") return "message_input";
    if (kind === "text_input_trigger") return "open_or_focus_message_input";
    if (kind === "list_entry" && /(conversation|contact|chat|entry)/.test(haystack)) return "conversation_entry";
  }
  if (domain === "notes") {
    if (kind === "post_text_action") return "save_or_finish_action";
    if (kind === "navigation_action") return "back_or_finish_control";
    if (kind === "text_input_trigger") return "new_text_note_action";
    if (kind === "text_input" && /title/.test(haystack)) return "title_field";
    if (kind === "text_input" && /body|note|content/.test(haystack)) return "body_field";
  }
  if (domain === "search") {
    if (kind === "text_input") return "search_field";
    if (kind === "post_text_action") return "search_or_submit_action";
  }
  if (domain === "form") {
    if (kind === "text_input") return "form_field";
    if (kind === "post_text_action") return "submit_action";
  }
  return "";
}

function buildAnchors(candidate: any) {
  const result: Record<string, any> = {};
  const domain = skillDomain(candidate);
  for (const [name, value] of Object.entries(asObject(candidate.anchors))) {
    const anchor = asObject(value);
    const kind = anchorKind(name, anchor, candidate);
    const domainRole = domainRoleForAnchor(name, anchor, kind, candidate);
    const built: Record<string, any> = {
      type: anchor.type || "coordinate_anchor",
      anchor_role: kind,
      action_role: kind,
      stability: anchorStability(kind),
      x_norm: Number(anchor.x_norm),
      y_norm: Number(anchor.y_norm),
      x: anchor.x,
      y: anchor.y,
      source_anchor_id: anchor.source_anchor_id,
      source_step_id: anchor.source_step_id,
      valid_when: validWhen(candidate, kind),
      evidence: asArray(anchor.evidence).map(String),
      confidence: Number.isFinite(Number(anchor.confidence)) ? Number(anchor.confidence) : 0.5,
      grounding_policy: anchorPolicy(kind),
      replay_priority:
        kind === "text_input" || kind === "text_input_trigger" || kind === "post_text_action"
          ? "recorded_anchor_first"
          : "recorded_anchor_if_screen_matches",
      reground_only_after:
        kind === "text_input"
          ? "the recorded text input anchor tap fails to focus the expected field/control"
          : kind === "text_input_trigger"
            ? "the recorded text input trigger tap fails to open or focus the expected text-entry UI"
            : kind === "post_text_action"
              ? "the recorded post-text action tap fails task-specific verification"
              : kind === "navigation_action"
                ? "the recorded navigation control does not produce the expected state change"
                : "screen evidence no longer matches and a safer grounding source is available",
    };
    if (domain !== "generic") built.domain = domain;
    if (domainRole) built.domain_role = domainRole;
    result[name] = built;
  }
  return result;
}

function buildGroundingPolicy(anchors: any) {
  const result: Record<string, string[]> = {};
  for (const [name, anchor] of Object.entries(asObject(anchors))) {
    result[name] = asArray((anchor as any).grounding_policy).map(String);
  }
  return result;
}

function hasAnchorKind(anchors: any, kind: string, candidate: any) {
  return Object.entries(asObject(anchors)).some(([name, anchor]) => anchorKind(name, anchor, candidate) === kind);
}

function stepAnchor(step: any) {
  return String(
    step.anchor || step.target || step.target_anchor || step.anchor_id || step.fallback_target || ""
  ).trim();
}

function normalizedAction(step: any) {
  return String(step.action || step.type || step.kind || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function declaredParameterNames(candidate: any) {
  return Object.keys(asObject(candidate.intent?.parameters));
}

function stepParameter(step: any, candidate: any) {
  const explicit = String(step.parameter || step.param || step.parameter_name || step.target_parameter || "").trim();
  if (explicit) return explicit;

  const names = declaredParameterNames(candidate);
  const text = [
    step.step,
    step.description,
    step.target,
    step.anchor,
    step.field,
    step.name,
  ].map((value) => String(value || "").toLowerCase());
  for (const name of names) {
    const normalized = name.toLowerCase();
    if (text.some((value) => value.includes(normalized))) return name;
  }
  return names.length === 1 ? names[0] : "";
}

function isTypeAction(action: string) {
  return [
    "type_parameter",
    "type",
    "type_text",
    "input",
    "input_text",
    "enter_text",
    "fill_text",
    "set_text",
    "paste_text",
  ].includes(action);
}

function isTapLikeAction(action: string) {
  return (
    action === "tap_anchor" ||
    action.includes("anchor") ||
    [
      "tap",
      "click",
      "press",
      "select",
      "choose",
      "open",
      "open_app",
      "activate",
      "focus",
      "touch",
    ].includes(action)
  );
}

function isTapTextAction(action: string, step: any) {
  return action === "tap_text" || (action === "tap" && String(step.text || "").trim() && !stepAnchor(step));
}

function normalizeKeyName(value: any) {
  const key = String(value || "").trim().toUpperCase().replace(/^KEYCODE_/, "");
  if (["BACK", "HOME", "ENTER", "RECENTS"].includes(key)) return key;
  return "";
}

function stepKey(step: any, action: string) {
  return normalizeKeyName(step.key || step.keyevent || step.key_event || step.keycode || action);
}

function isKeyAction(action: string, step: any) {
  return Boolean(
    stepKey(step, action) &&
      [
        "key_event",
        "keyevent",
        "press_key",
        "android_keyevent",
        "adb_keyevent",
        "back",
        "home",
        "enter",
        "recents",
      ].includes(action)
  );
}

function tapGroundingPolicy(anchor: string, anchors: any, candidate: any) {
  const info = asObject(anchors[anchor]);
  const kind = anchorKind(anchor, info, candidate);
  if (kind === "text_input") {
    const x = info.x ?? "?";
    const y = info.y ?? "?";
    return (
      `When the expected text-entry screen or field/control is visible, first tap the recorded ${anchor} coordinate ` +
      `x=${x}, y=${y}. Reroute to regrounding only if the tap does not focus the expected input target.`
    );
  }
  if (kind === "text_input_trigger") {
    const x = info.x ?? "?";
    const y = info.y ?? "?";
    return (
      `When the expected control for opening or focusing text entry is visible, first tap the recorded ${anchor} coordinate ` +
      `x=${x}, y=${y}. Reroute to regrounding only if the tap does not open or focus the expected text-entry UI.`
    );
  }
  if (kind === "post_text_action") {
    const x = info.x ?? "?";
    const y = info.y ?? "?";
    return (
      `After required text parameters are entered, first tap the recorded ${anchor} coordinate ` +
      `x=${x}, y=${y}. Do not substitute a visually guessed coordinate before this first tap. ` +
      "Only reground if that recorded tap fails task-specific verification and the UI is still safe."
    );
  }
  if (anchor && anchors[anchor]) {
    return `Use ${anchor} when its valid_when condition holds; otherwise keep the procedure applicable_with_regrounding.`;
  }
  return "Anchor must be grounded before execution.";
}

function buildProcedure(candidate: any, anchors: any) {
  return asArray(candidate.steps).map((stepValue, index) => {
    const step = asObject(stepValue);
    const action = normalizedAction(step);
    const anchor = stepAnchor(step);
    if (isTapTextAction(action, step)) {
      const text = String(step.text || step.target_text || step.label || "").trim();
      return {
        step: text ? `tap text ${JSON.stringify(text)}` : String(step.step || `tap text step ${index + 1}`),
        action: "tap_text",
        text,
        grounding_policy:
          "Use deterministic UI hierarchy text grounding with `android_ui_query` first, then tap the resolved text center. Fall back to OCR text grounding only when UI XML cannot expose the target.",
        verify_after: step.verify_after || "",
        source_action: action !== "tap_text" ? action : undefined,
      };
    }
    if (isTypeAction(action)) {
      const parameter = stepParameter(step, candidate);
      return {
        step: `type parameter ${parameter || "declared parameter"}`,
        action: "type_parameter",
        parameter,
        grounding_policy: "No coordinate replay. Use a text-input tool after the input anchor is focused.",
        verify_after: step.verify_after || "",
        source_action: action !== "type_parameter" ? action : undefined,
      };
    }
    if (action === "open_app") {
      const app = asObject(candidate.app);
      const pkg = String(step.package || app.package || "").trim();
      const activity = String(step.activity || app.activity || "").trim();
      return {
        step: String(step.step || `open app ${pkg || "target app"}`),
        action: "open_app",
        package: pkg,
        activity,
        grounding_policy:
          "Use the trace-grounded app package/activity to open the app, then verify package/activity before replaying recorded in-app anchors.",
        verify_after: step.verify_after || "",
        raw: step,
      };
    }
    if ((isTapLikeAction(action) || anchor) && anchor && anchors[anchor]) {
      return {
        step: `tap ${anchor}`,
        action: "tap_anchor",
        anchor,
        grounding_policy: tapGroundingPolicy(anchor, anchors, candidate),
        verify_after: step.verify_after || "",
        source_action: action !== "tap_anchor" ? action : undefined,
      };
    }
    if (isKeyAction(action, step)) {
      const key = stepKey(step, action);
      return {
        step: `press ${key}`,
        action: "key_event",
        key,
        grounding_policy: "No coordinate grounding. Use the key event only after the current UI state matches this procedure point.",
        verify_after: step.verify_after || "",
        source_action: action,
      };
    }
    return {
      step: String(step.step || `step ${index + 1}`),
      action,
      grounding_policy: "Non-standard action preserved from the candidate; inspect raw evidence and validate the current UI before execution.",
      raw: step,
    };
  });
}

function appStateCheckFromCandidate(candidate: any) {
  const checks = asObject(candidate.entry_state_checks);
  const directCandidates = [
    asObject(checks.after_app_open),
    asObject(checks.initial_app_state),
    asObject(candidate.entry_state_check),
    asObject(candidate.app_state_check),
  ];
  const direct = directCandidates.find((item) => Object.keys(item).length > 0) || {};
  const app = asObject(candidate.app);
  const pkg = String(direct.package || app.package || "").trim();
  const activity = String(direct.activity || app.activity || "").trim();
  const uiTextAny = asStringList(direct.ui_text_any || direct.text_any || direct.visible_text_any);
  const uiTextAll = asStringList(direct.ui_text_all || direct.text_all || direct.visible_text_all);
  if (!pkg && !activity && uiTextAny.length === 0 && uiTextAll.length === 0) return null;
  return {
    package: pkg || undefined,
    activity: activity || undefined,
    ui_text_any: uiTextAny,
    ui_text_all: uiTextAll,
    fallback: "If this static app-state checkpoint fails or is inconclusive, stop the fast path and let the agent/LLM inspect or reground before continuing.",
  };
}

function buildAppStateStep(id: string, check: any) {
  const step: any = {
    id,
    action: "assert_app_state",
    package: check.package,
    activity: check.activity,
  };
  if (asArray(check.ui_text_any).length > 0) step.ui_text_any = check.ui_text_any;
  if (asArray(check.ui_text_all).length > 0) step.ui_text_all = check.ui_text_all;
  return step;
}

function openAppStepFromProcedureStep(step: any, candidate: any, index: number) {
  const raw = asObject(step.raw);
  const app = asObject(candidate.app);
  const pkg = String(step.package || raw.package || app.package || "").trim();
  const activity = String(step.activity || raw.activity || app.activity || "").trim();
  const component = String(step.component || raw.component || "").trim();
  if (!pkg && !component) return null;
  const out: any = {
    id: `step_${index + 1}_open_app`,
    action: "open_app",
  };
  if (pkg) out.package = pkg;
  if (activity) out.activity = activity;
  if (component) out.component = component;
  out.waitMs = 1200;
  return out;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function humanizeAnchorName(name: string) {
  return String(name || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b(anchor|button|btn|option|item|control|field|tap)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function labelsFromFallback(candidate: any, anchorName: string) {
  const labels: string[] = [];
  const identity = humanizeAnchorName(anchorName).toLowerCase();
  const strongTerms = ["create", "text", "title", "message", "send", "search", "back", "done"]
    .filter((term) => identity.includes(term));
  for (const text of asArray(candidate.fallback)) {
    const source = String(text || "");
    const lower = source.toLowerCase();
    if (strongTerms.length > 0 && !strongTerms.some((term) => lower.includes(term))) continue;
    for (const match of source.matchAll(/\blabeled\s+["'`]?([^"',.;:`]+)["'`]?/gi)) {
      const label = String(match[1] || "").trim();
      if (label && label.length <= 40) labels.push(label);
    }
  }
  return labels;
}

function explicitTapTextCandidatesForAnchor(anchor: any, candidate: any, anchorName: string) {
  const values: string[] = [];
  for (const key of ["text", "target_text", "label", "content_desc", "contentDesc", "visible_text"]) {
    const value = String(anchor?.[key] || "").trim();
    if (value) values.push(value);
  }
  values.push(...labelsFromFallback(candidate, anchorName));
  return uniqueStrings(values)
    .filter((value) => value.length > 0 && value.length <= 40)
    .slice(0, 8);
}

function recordedCoordinateFastPathReason(anchor: any, kind: string) {
  const replayPriority = String(anchor?.replay_priority || "");
  const policies = asArray(anchor?.grounding_policy).map((item) => String(item || ""));
  if (replayPriority === "recorded_anchor_first") return "recorded_anchor_first";
  if (kind === "launcher_icon" && policies.includes("use_recorded_anchor_if_launcher_matches")) {
    return "launcher_anchor_if_screen_matches";
  }
  if (kind === "navigation_action" && policies.includes("use_recorded_anchor_if_navigation_state_matches")) {
    return "navigation_anchor_if_state_matches";
  }
  if (kind === "post_text_action" && policies.includes("use_recorded_anchor_after_required_text_input")) {
    return "post_text_recorded_anchor";
  }
  return "";
}

function expectedUiTextsAfterStep(step: any) {
  const verify = String(step.verify_after || step.verify || "").trim();
  const texts: string[] = [];
  const fields = verify.match(/\bwith\s+(.+?)\s+fields?\s+visible\b/i);
  if (fields) {
    for (const part of String(fields[1] || "").split(/\s*(?:,|\/|\band\b|\bor\b)\s*/i)) {
      const value = part.trim();
      if (/^[A-Z][A-Za-z0-9 ]{0,30}$/.test(value) && !/^(A|An|The|Google|Keep)$/i.test(value)) {
        texts.push(value);
      }
    }
  }
  return uniqueStrings(texts).slice(0, 4);
}

function buildFastPath(procedure: any[], anchors: any, candidate: any) {
  const steps: any[] = [];
  const unsupported: string[] = [];
  const appStateCheck = appStateCheckFromCandidate(candidate);
  let insertedInitialAppCheck = false;

  function pushInitialAppCheck(id: string) {
    if (!appStateCheck || insertedInitialAppCheck) return;
    steps.push(buildAppStateStep(id, appStateCheck));
    insertedInitialAppCheck = true;
  }

  for (const [index, value] of procedure.entries()) {
    const step = asObject(value);
    if (step.action === "open_app") {
      const openStep = openAppStepFromProcedureStep(step, candidate, index);
      if (!openStep) {
        unsupported.push(`step_${index + 1}: open_app lacks package/component`);
        continue;
      }
      steps.push(openStep);
      const check = appStateCheck || {
        package: openStep.package,
        activity: openStep.activity,
        ui_text_any: [],
        ui_text_all: [],
      };
      steps.push(buildAppStateStep(`step_${index + 1}_assert_app_state_after_open_app`, check));
      insertedInitialAppCheck = true;
      continue;
    }
    if (step.action === "tap_anchor") {
      const anchorName = String(step.anchor || "");
      const anchor = asObject(anchors[anchorName]);
      const kind = String(anchor.anchor_role || anchor.action_role || "");
      if (steps.length === 0 && kind !== "launcher_icon") {
        pushInitialAppCheck("step_0_assert_initial_app_state");
      }
      const x = Number(anchor.x);
      const y = Number(anchor.y);
      if (!anchorName || !Number.isFinite(x) || !Number.isFinite(y)) {
        unsupported.push(`step_${index + 1}: tap_anchor ${anchorName || "(missing)"} lacks recorded x/y`);
        continue;
      }
      const coordinateReason = recordedCoordinateFastPathReason(anchor, kind);
      if (!coordinateReason) {
        const textCandidates = explicitTapTextCandidatesForAnchor(anchor, candidate, anchorName);
        if (textCandidates.length > 0) {
          steps.push({
            id: `step_${index + 1}_tap_text_${anchorName}`,
            action: "tap_text",
            anchor: anchorName,
            texts: textCandidates,
            exact: true,
            ignoreCase: true,
            matchPickStrategy: "clickable_first",
          });
          continue;
        }
        unsupported.push(
          `step_${index + 1}: tap_anchor ${anchorName} requires runtime grounding before fast-path replay (${kind || "unknown"})`
        );
        continue;
      }
      steps.push({
        id: `step_${index + 1}_${anchorName}`,
        action: "tap_anchor",
        anchor: anchorName,
        x: Math.round(x),
        y: Math.round(y),
        coordinate_reason: coordinateReason,
      });
      if (index < procedure.length - 1 && (kind === "launcher_icon" || kind === "text_input_trigger")) {
        steps.push({
          id: `step_${index + 1}_wait_after_${anchorName}`,
          action: "wait",
          ms: kind === "launcher_icon" ? 1200 : 700,
          optional: true,
        });
        const expectedTexts = expectedUiTextsAfterStep(step);
        if (kind === "text_input_trigger" && expectedTexts.length > 0) {
          steps.push({
            id: `step_${index + 1}_assert_after_${anchorName}`,
            action: "assert_app_state",
            ui_text_all: expectedTexts,
          });
        }
        if (kind === "launcher_icon") {
          pushInitialAppCheck(`step_${index + 1}_assert_app_state_after_${anchorName}`);
        }
      }
      continue;
    }
    if (steps.length === 0) {
      pushInitialAppCheck("step_0_assert_initial_app_state");
    }
    if (step.action === "type_parameter") {
      const parameter = String(step.parameter || "");
      if (!parameter) {
        unsupported.push(`step_${index + 1}: type_parameter lacks parameter`);
        continue;
      }
      steps.push({
        id: `step_${index + 1}_type_${parameter}`,
        action: "type_parameter",
        parameter,
      });
      continue;
    }
    if (step.action === "tap_text") {
      const text = String(step.text || "");
      if (!text) {
        unsupported.push(`step_${index + 1}: tap_text lacks text`);
        continue;
      }
      steps.push({
        id: `step_${index + 1}_tap_text_${slugify(text, "text").slice(0, 24)}`,
        action: "tap_text",
        text,
        exact: true,
        ignoreCase: true,
        scope: "all",
      });
      continue;
    }
    if (step.action === "key_event") {
      const key = String(step.key || "");
      if (!key) {
        unsupported.push(`step_${index + 1}: key_event lacks key`);
        continue;
      }
      steps.push({
        id: `step_${index + 1}_key_${key.toLowerCase()}`,
        action: "keyevent",
        key,
      });
      continue;
    }
    unsupported.push(`step_${index + 1}: unsupported action ${step.action || "(missing)"}`);
  }

  return {
    schema_version: "clawmobile.fast_path.v1",
    execution_tool: "clawmobile_batch_execute",
    runner_tool: "clawmobile_skill_run_fast_path",
    mode: "recorded_anchor_batch",
    eligible: steps.length >= 2 && unsupported.length === 0,
    use_when:
      "Entry state is plausible, required parameters are available, anchors are reliable enough for recorded-first replay, and the task is not high-risk.",
    fallback: "If the batch fails or eligibility is false, stop and use normal stepwise execution/regrounding.",
    validation: {
      precheck: ["intent_matches", "entry_state_plausible", "app_state_checkpoint_at_app_boundary"],
      final_check: ["task_specific_verification_rules"],
      avoid_per_step_screenshots: true,
    },
    app_state_check: appStateCheck,
    steps,
    unsupported,
  };
}

function buildNotCoveredParameters(candidate: any) {
  const notCovered: Record<string, any> = {};
  if (isMessagingSkill(candidate) && !hasDeclaredParameter(candidate, ["contact", "conversation", "conversation_title", "chat"])) {
    notCovered.contact = {
      type: "string",
      reason:
        "Single trace does not establish arbitrary contact selection. The procedure may still apply after an external contact/chat grounding step.",
      applicability_if_requested: "applicable_with_regrounding",
    };
  }
  return notCovered;
}

function buildEntryStates(candidate: any, anchors: any) {
  const anchorNames = Object.keys(anchors);
  const states: any[] = [];
  if (anchorNames.some((name) => anchorKind(name, anchors[name], candidate) === "launcher_icon")) {
    states.push({
      name: "launcher_or_app_entry_visible",
      confidence: 0.55,
      note: "Observed once. Use with regrounding or package launch if the launcher icon moved.",
    });
  }
  if (anchorNames.some((name) => anchorKind(name, anchors[name], candidate) === "text_input")) {
    states.push({
      name: "text_entry_screen_visible",
      confidence: 0.7,
      note: "A compatible text-entry screen or field/control can be focused before parameterized typing.",
    });
  }
  if (anchorNames.some((name) => anchorKind(name, anchors[name], candidate) === "text_input_trigger")) {
    states.push({
      name: "text_entry_trigger_visible",
      confidence: 0.65,
      note: "A recorded control can open or focus a text-entry screen before parameterized typing.",
    });
  }
  if (anchorNames.some((name) => anchorKind(name, anchors[name], candidate) === "list_entry")) {
    states.push({
      name: "recorded_list_or_grid_visible",
      confidence: 0.55,
      note: "Observed once. Use with regrounding if the recorded list/grid item moved.",
    });
  }
  if (states.length === 0) {
    states.push({ name: "recorded_screen_state", confidence: 0.4 });
  }
  return states;
}

function buildApplicability(_candidate: any, _anchors: any, notCoveredParameters: any) {
  const rules: any[] = [
    {
      if: "intent matches, required parameters are available, and current screen satisfies entry_states plus anchor valid_when conditions",
      then: "applicable",
    },
    {
      if: "intent matches but one or more anchors must be relocated while the reusable procedure still fits",
      then:
        "applicable_with_regrounding; for recorded-first anchors, attempt the recorded anchor before relocation unless the current state is clearly unsafe",
    },
    {
      if: "intent matches but a requested parameter is listed in intent.not_covered_parameters",
      then: "applicable_with_regrounding only when another skill/tool can ground that parameter; otherwise not_applicable",
    },
    {
      if: "app/package, task intent, or required procedure does not match the current user request",
      then: "not_applicable",
    },
  ];
  if (Object.keys(notCoveredParameters).length > 0) {
    rules.push({
      if: `the user asks for unsupported parameters: ${Object.keys(notCoveredParameters).join(", ")}`,
      then: "do not silently generalize; request or perform explicit grounding before executing",
    });
  }
  return {
    decision_modes: ["applicable", "applicable_with_regrounding", "not_applicable"],
    procedure_applicability:
      "Procedure can remain applicable even when anchors need relocation, as long as the task intent and entry state still match.",
    anchor_applicability:
      "Recorded coordinates are operational evidence. For recorded-first anchors, weak visual uncertainty is not enough to replace the coordinate before the first attempt.",
    rules,
  };
}

function buildOpenUncertainties(candidate: any, notCoveredParameters: any) {
  const uncertainties = [
    "Single-trace draft: anchor stability has not been proven across devices, layouts, or app versions.",
  ];
  if (Object.keys(notCoveredParameters).length > 0) {
    uncertainties.push(`Not covered parameters require future grounding: ${Object.keys(notCoveredParameters).join(", ")}.`);
  }
  if (asArray(candidate.warnings).length > 0) {
    uncertainties.push(...asArray(candidate.warnings).map(String));
  }
  return Array.from(new Set(uncertainties));
}

function buildLifecyclePolicy(candidate: any) {
  const intentName = String(candidate.intent?.name || "recorded_mobile_task");
  return {
    schema_version: "clawmobile.skill_lifecycle.v1",
    after_generation: {
      explain_to_user: true,
      include: [
        "task_intent",
        "required_parameters",
        "plain_language_steps",
        "fast_path_availability",
        "entry_state_checks",
        "uncertain_or_regroundable_anchors",
        "how_to_improve_with_another_demo",
      ],
      user_satisfaction_policy:
        "If the user says the generated behavior is wrong, incomplete, or overfit, ask them to demonstrate the same task again and update this skill from that new trace.",
    },
    after_execution: {
      success:
        "Record compact feedback when low-friction. Tell the user the skill succeeded and can become more reliable with more successful traces if they want.",
      partial_or_failure:
        "Record failure or partial feedback, summarize the failed step/anchor, recover if safe, and suggest recording a correction demo for the same task.",
      do_not_block_user:
        "Feedback and evolution should not delay the user-facing task unless failure repair needs more evidence.",
    },
    improvement: {
      preferred_update_tool: "clawmobile_skill_update_from_trace",
      preferred_feedback_tool: "clawmobile_skill_record_feedback",
      preferred_fast_path_reflection_tool: "clawmobile_skill_reflect_fast_path_failure",
      same_task_requirement:
        "Only merge traces that demonstrate the same intent and compatible required parameters.",
      correction_demo_hint: `To improve ${intentName}, record another demonstration of the same task from the state that failed or from the preferred starting state, then update the existing skill instead of creating an unrelated one.`,
    },
  };
}

function buildGeneralizedSkill(candidate: any, candidatePath: string) {
  const anchors = buildAnchors(candidate);
  const notCoveredParameters = buildNotCoveredParameters(candidate);
  const procedure = buildProcedure(candidate, anchors);
  const generalized = {
    schema_version: GENERALIZED_SKILL_SCHEMA_VERSION,
    source_traces: candidate.source_trace_id ? [String(candidate.source_trace_id)] : [],
    source_candidate_path: candidatePath,
    status: "draft_generalized",
    intent: {
      name: candidate.intent?.name || "recorded_mobile_task",
      description: candidate.intent?.description || candidate.task_summary || "Generalized from a recorded mobile demonstration.",
      parameters: asObject(candidate.intent?.parameters),
      not_covered_parameters: notCoveredParameters,
    },
    metadata: {
      clawmobile_generated: true,
      feedback_supported: true,
      feedback_tool: "clawmobile_skill_record_feedback",
      status_tool: "clawmobile_skill_status",
      primary_skill_format: "generalized_skill_markdown",
    },
    app: candidate.app || {},
    entry_state_checks: {
      after_app_open: appStateCheckFromCandidate(candidate),
    },
    entry_states: buildEntryStates(candidate, anchors),
    procedure,
    fast_path: buildFastPath(procedure, anchors, candidate),
    anchors,
    verification: asArray(candidate.verification).map(String),
    validation_policy: {
      mode: "checkpoint",
      verify_every_step: false,
      cheap_checks_first: true,
      llm_vision: "on_uncertainty_or_failure",
      fresh_screenshot: "on_visual_need_or_failure",
      max_fresh_screenshots_per_run: 2,
      preferred_checkpoints: ["entry", "after_recorded_anchor_procedure", "final"],
      preferred_order: [
        "tool_result",
        "package_activity_or_orientation",
        "ui_dump_when_text_or_hierarchy_can_confirm",
        "ocr_existing_screenshot_or_bounded_region",
        "fresh_screenshot",
        "llm_visual_judgment",
      ],
      retention: {
        keep_recording_artifacts: true,
        keep_runtime_success_screenshots: "only_if_useful_for_feedback",
        keep_runtime_failure_screenshots: true,
      },
    },
    lifecycle: buildLifecyclePolicy(candidate),
    applicability: buildApplicability(candidate, anchors, notCoveredParameters),
    grounding_policy: buildGroundingPolicy(anchors),
    evolution: {
      can_update_from_future_traces: true,
      open_uncertainties: buildOpenUncertainties(candidate, notCoveredParameters),
      verified_contexts: [],
      failure_patterns: [],
      success_count: 0,
      failure_count: 0,
    },
    warnings: [
      "Draft generalized from a single trace. Prefer applicable_with_regrounding over hard rejection when only anchors changed.",
      ...asArray(candidate.warnings).map(String),
    ],
  };
  refreshExecutionExperience(generalized);
  return generalized;
}

function validateGeneralizedSkill(generalized: any, sourceCandidate: any) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (generalized.schema_version !== GENERALIZED_SKILL_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${GENERALIZED_SKILL_SCHEMA_VERSION}`);
  }
  if (generalized.status !== "draft_generalized") errors.push("status must be draft_generalized");
  if (!Array.isArray(generalized.source_traces) || generalized.source_traces.length === 0) {
    errors.push("source_traces must contain at least one trace id");
  }
  if (!generalized.intent?.name) errors.push("intent.name is required");
  if (!generalized.intent?.parameters || typeof generalized.intent.parameters !== "object") {
    errors.push("intent.parameters object is required");
  }
  const modes = asArray(generalized.applicability?.decision_modes);
  for (const mode of ["applicable", "applicable_with_regrounding", "not_applicable"]) {
    if (!modes.includes(mode)) errors.push(`applicability.decision_modes missing ${mode}`);
  }
  if (!generalized.evolution?.can_update_from_future_traces) {
    warnings.push("evolution.can_update_from_future_traces should be true for single-trace generalized skills");
  }
  if (generalized.validation_policy?.verify_every_step === true) {
    warnings.push("validation_policy.verify_every_step should normally be false for generated ClawMobile skills");
  }
  if (asArray(generalized.evolution?.open_uncertainties).length === 0) {
    warnings.push("evolution.open_uncertainties is empty");
  }

  const sourceAnchors = asObject(sourceCandidate.anchors);
  for (const [name, value] of Object.entries(asObject(generalized.anchors))) {
    const anchor = asObject(value);
    const source = asObject(sourceAnchors[name]);
    if (!sourceAnchors[name]) {
      errors.push(`anchor ${name}: not present in source candidate`);
      continue;
    }
    for (const key of ["x_norm", "y_norm"]) {
      const n = Number(anchor[key]);
      const sourceN = Number(source[key]);
      if (!Number.isFinite(n) || n < 0 || n > 1) errors.push(`anchor ${name}: ${key} must be a number in [0,1]`);
      if (Number.isFinite(n) && Number.isFinite(sourceN) && Math.abs(n - sourceN) > 1e-9) {
        errors.push(`anchor ${name}: ${key} does not match source candidate`);
      }
    }
    if (anchor.source_anchor_id !== source.source_anchor_id) {
      errors.push(`anchor ${name}: source_anchor_id does not match source candidate`);
    }
    if (!anchor.stability) warnings.push(`anchor ${name}: stability is missing`);
  }

  const declaredParams = asObject(generalized.intent.parameters);
  for (const step of asArray(generalized.procedure)) {
    const item = asObject(step);
    if (item.action === "type_parameter" && item.parameter && !declaredParams[item.parameter]) {
      warnings.push(`procedure step references undeclared parameter ${item.parameter}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function skillNameForGeneralized(generalized: any, override?: string) {
  if (override && override.trim()) return slugify(override, "clawmobile-generalized-skill");
  return `clawmobile-generalized-${slugify(String(generalized.intent?.name || "recorded-task"), "recorded-task")}`;
}

export function renderGeneralizedSkillMarkdown(generalized: any, validation: any, skillName: string) {
  const lines: string[] = [];
  const lifecycle = asObject(generalized.lifecycle);
  lines.push("---");
  lines.push(`name: ${skillName}`);
  lines.push(`description: ${JSON.stringify(String(generalized.intent.description || "Generalized ClawMobile skill draft.").replace(/\n/g, " "))}`);
  lines.push("clawmobile_generated: true");
  lines.push(`clawmobile_schema: ${GENERALIZED_SKILL_SCHEMA_VERSION}`);
  lines.push("feedback_supported: true");
  lines.push("feedback_tool: clawmobile_skill_record_feedback");
  lines.push("status_tool: clawmobile_skill_status");
  lines.push("---");
  lines.push("");
  lines.push(`# ${generalized.intent.name}`);
  lines.push("");
  lines.push(generalized.intent.description || "Generalized ClawMobile skill draft.");
  lines.push("");
  lines.push("## Skill Review");
  lines.push("");
  lines.push("After generating or updating this skill, briefly explain it to the user before treating it as settled.");
  lines.push("- What it does: summarize the intent in one sentence.");
  lines.push("- Parameters: name the required values the user can change.");
  lines.push("- Steps: describe the procedure in plain language, without raw implementation detail.");
  lines.push("- Confidence: mention any important uncertainty, regrounding point, or unsupported parameter.");
  lines.push("- Improvement path: if the user says the behavior is wrong or incomplete, record another demonstration of the same task and update this skill from that trace.");
  lines.push("");
  lines.push("## Applicability");
  lines.push("");
  lines.push("This skill separates procedure applicability from anchor applicability.");
  lines.push("If the intent matches but an anchor moved, prefer `applicable_with_regrounding` over immediate rejection.");
  lines.push("For recorded-first anchors, visual uncertainty alone should not replace the recorded coordinate before the first safe attempt.");
  lines.push("");
  for (const rule of asArray(generalized.applicability.rules)) {
    lines.push(`- If ${rule.if}, then \`${rule.then}\`.`);
  }
  lines.push("");
  lines.push("## Parameters");
  lines.push("");
  for (const [name, schema] of Object.entries(asObject(generalized.intent.parameters))) {
    lines.push(`- \`${name}\`: ${JSON.stringify(schema)}`);
  }
  const notCovered = Object.entries(asObject(generalized.intent.not_covered_parameters));
  if (notCovered.length > 0) {
    lines.push("");
    lines.push("### Not Covered Parameters");
    lines.push("");
    for (const [name, schema] of notCovered) lines.push(`- \`${name}\`: ${JSON.stringify(schema)}`);
  }
  lines.push("");
  lines.push("## Procedure");
  lines.push("");
  asArray(generalized.procedure).forEach((step: any, index: number) => {
    lines.push(`${index + 1}. ${step.step}`);
    if (step.anchor) lines.push(`   - Anchor: \`${step.anchor}\``);
    if (step.parameter) lines.push(`   - Parameter: \`${step.parameter}\``);
    if (step.action === "tap_anchor") {
      const anchor = asObject(generalized.anchors?.[step.anchor]);
      if (anchor.replay_priority === "recorded_anchor_first" && Number.isFinite(Number(anchor.x)) && Number.isFinite(Number(anchor.y))) {
        lines.push(`   - Tool: use \`android_tap\` at the recorded coordinate first: x=${anchor.x}, y=${anchor.y}.`);
      } else {
        lines.push("   - Tool: use `android_tap` after the anchor is accepted or regrounded.");
      }
    }
    if (step.action === "tap_text") lines.push(`   - Tool: use \`android_ui_query\`/batch \`tap_text\` first, with OCR fallback for text ${JSON.stringify(step.text || "")}.`);
    if (step.action === "type_parameter") lines.push("   - Tool: use `android_type` with the parameter value.");
    if (step.action === "key_event") lines.push(`   - Tool: use \`adb_keyevent\` with key \`${step.key || ""}\`.`);
    if (step.source_action) lines.push(`   - Source action: \`${step.source_action}\``);
    lines.push(`   - Grounding: ${step.grounding_policy}`);
  });
  lines.push("");
  lines.push("## Anchor Replay Discipline");
  lines.push("");
  lines.push("- Do not invent substitute coordinates for a recorded anchor while the recorded UI state is still plausible.");
  lines.push("- Visual checks may reject an unsafe state, but weak visual localization should not override a recorded coordinate.");
  lines.push("- For fast paths, only checkpoint app state at app entry or app switches. If this checkpoint is inconclusive, stop fast execution and let the agent/LLM inspect or reground.");
  if (hasAnchorKind(generalized.anchors, "send_button", generalized)) {
    lines.push("- For post-text send/confirm anchors, once the composer contains the parameter text, tap the recorded send/confirm coordinate first.");
  }
  if (hasAnchorKind(generalized.anchors, "post_text_action", generalized)) {
    lines.push("- For post-text action anchors, once required text fields contain their parameter values, tap the recorded action coordinate first.");
  }
  if (hasAnchorKind(generalized.anchors, "text_input", generalized)) {
    lines.push("- For text-entry anchors, focus the recorded field/control before typing, then reground only if focus verification fails.");
  }
  if (hasAnchorKind(generalized.anchors, "text_input_trigger", generalized)) {
    lines.push("- For text-entry trigger anchors, use the recorded trigger first, then verify that the expected text-entry UI opens or becomes focused.");
  }
  lines.push("- Enter `applicable_with_regrounding` only after the recorded anchor attempt fails verification or the current state clearly does not match.");
  lines.push("");
  lines.push("## Fast Path Batch");
  lines.push("");
  const fastPath = asObject(generalized.fast_path);
  lines.push(`- Preferred runner: \`${fastPath.runner_tool || "clawmobile_skill_run_fast_path"}\``);
  lines.push(`- Batch tool: \`${fastPath.execution_tool || "clawmobile_batch_execute"}\``);
  lines.push(`- Eligible: ${fastPath.eligible === true}`);
  lines.push(`- Mode: ${fastPath.mode || "recorded_anchor_batch"}`);
  lines.push(`- Use when: ${fastPath.use_when || ""}`);
  lines.push(`- Fallback: ${fastPath.fallback || ""}`);
  const requiredParams = Object.entries(asObject(generalized.intent?.parameters))
    .filter(([, schema]) => asObject(schema).required === true)
    .map(([name]) => name);
  if (requiredParams.length > 0) {
    lines.push(`- Required runner parameters: ${requiredParams.map((name) => `\`${name}\``).join(", ")}`);
    lines.push(`- Call the preferred runner with \`parameters: { ${requiredParams.map((name) => `${JSON.stringify(name)}: "..."`).join(", ")} }\`.`);
    lines.push("- The runner tool schema has a top-level `parameters` object and `parameter_values` alias; do not manually expand the procedure because of parameter-passing uncertainty.");
  }
  lines.push("- If eligible, call the preferred runner first with the required `parameters` object instead of manually expanding each step.");
  lines.push("- This is an optional acceleration path. It must stop on structured failure and return artifacts for normal stepwise recovery.");
  lines.push("- If the fast path fails, inspect the structured failure and cheap UI evidence, then use `clawmobile_skill_reflect_fast_path_failure` for one bounded self-repair attempt before falling back to normal stepwise execution.");
  lines.push("- Retry the repaired fast path at most once. If it still fails, continue with normal UI tools, record feedback, and tell the user whether another demo would help.");
  lines.push("- If final verification text is provided, let the runner use its default `ui_dump_then_ocr` checkpoint unless the skill has a stronger deterministic verifier.");
  lines.push("- Do not use it for high-risk actions or when entry state/required parameters are uncertain.");
  if (asArray(fastPath.steps).length > 0) {
    lines.push("- Batch steps:");
    for (const step of asArray(fastPath.steps)) {
      const item = asObject(step);
      const target = item.anchor
        ? ` anchor=${item.anchor}`
        : item.parameter
          ? ` parameter=${item.parameter}`
          : item.key
            ? ` key=${item.key}`
            : item.package
              ? ` package=${item.package}`
              : "";
      lines.push(`  - ${item.id || item.action}: ${item.action}${target}`);
    }
  }
  for (const item of asArray(fastPath.unsupported)) lines.push(`- Unsupported for batch: ${item}`);
  lines.push("");
  lines.push("## Anchors");
  lines.push("");
  for (const [name, anchor] of Object.entries(asObject(generalized.anchors))) {
    lines.push(`- \`${name}\`: stability=${(anchor as any).stability}, x_norm=${(anchor as any).x_norm}, y_norm=${(anchor as any).y_norm}, confidence=${(anchor as any).confidence}`);
    if ((anchor as any).anchor_role) lines.push(`  - Anchor role: ${(anchor as any).anchor_role}`);
    if ((anchor as any).domain_role) {
      const domain = (anchor as any).domain ? ` (${(anchor as any).domain})` : "";
      lines.push(`  - Domain role: ${(anchor as any).domain_role}${domain}`);
    }
    if (Number.isFinite(Number((anchor as any).x)) && Number.isFinite(Number((anchor as any).y))) {
      lines.push(`  - Recorded coordinate: x=${(anchor as any).x}, y=${(anchor as any).y}`);
    }
    if ((anchor as any).replay_priority) lines.push(`  - Replay priority: ${(anchor as any).replay_priority}`);
    if ((anchor as any).reground_only_after) lines.push(`  - Reground only after: ${(anchor as any).reground_only_after}`);
    lines.push(`  - Valid when: ${(anchor as any).valid_when}`);
  }
  lines.push("");
  lines.push("## Grounding Policy");
  lines.push("");
  for (const [name, policy] of Object.entries(asObject(generalized.grounding_policy))) {
    lines.push(`- \`${name}\`: ${asArray(policy).join(" -> ")}`);
  }
  lines.push("");
  lines.push("## Verification");
  lines.push("");
  const validationPolicy = asObject(generalized.validation_policy);
  lines.push("Use checkpoint verification rather than fresh screenshot/UI-dump checks after every low-risk step.");
  lines.push(`- Mode: ${validationPolicy.mode || "checkpoint"}`);
  lines.push(`- Verify every step: ${validationPolicy.verify_every_step === true ? "true" : "false"}`);
  lines.push(`- Cheap checks first: ${validationPolicy.cheap_checks_first === false ? "false" : "true"}`);
  lines.push(`- LLM vision: ${validationPolicy.llm_vision || "on_uncertainty_or_failure"}`);
  lines.push(`- Fresh screenshot: ${validationPolicy.fresh_screenshot || "on_visual_need_or_failure"}`);
  lines.push(`- Max fresh screenshots per run: ${validationPolicy.max_fresh_screenshots_per_run ?? 2}`);
  lines.push("- Preferred observation order:");
  for (const item of asArray(validationPolicy.preferred_order)) lines.push(`  - ${item}`);
  lines.push("- Preferred checkpoints:");
  for (const item of asArray(validationPolicy.preferred_checkpoints)) lines.push(`  - ${item}`);
  lines.push("- When OCR can use an existing screenshot path, reuse that path unless the UI has changed.");
  lines.push("- Keep raw recording screenshots as evidence; keep runtime success screenshots only when useful for feedback, and keep failure screenshots for repair.");
  lines.push("");
  lines.push("### Task-Specific Verification Rules");
  lines.push("");
  for (const item of asArray(generalized.verification)) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## Prior Execution Experience");
  lines.push("");
  lines.push("Use `clawmobile_skill_status` when structured prior execution evidence could affect this run, especially if failures or verified contexts exist.");
  lines.push("Treat prior experience as grounding/fallback evidence, not as a reason to skip normal verification.");
  const guidance = asObject(generalized.evolution.execution_guidance);
  const selfRepair = asObject(guidance.fast_path_self_repair);
  if (selfRepair.recommended === true) {
    lines.push("- Recommended next action: use `clawmobile_skill_reflect_fast_path_failure` once for the latest generated fast-path failure, then retry `clawmobile_skill_run_fast_path` once before normal UI fallback.");
    if (selfRepair.failed_step || selfRepair.failed_anchor) {
      lines.push(`  - Latest fast-path issue: step=${selfRepair.failed_step || "unknown"}, anchor=${selfRepair.failed_anchor || "unknown"}`);
    }
  }
  for (const hint of asArray(guidance.hints)) lines.push(`- ${hint}`);
  for (const item of asArray(guidance.anchor_guidance).slice(-5)) {
    const anchor = asObject(item);
    lines.push(`- Anchor \`${anchor.anchor || "unknown"}\`: ${anchor.reliability || "unknown"} (${anchor.success_count || 0} success, ${anchor.failure_count || 0} failure). ${anchor.guidance || ""}`);
  }
  lines.push("");
  lines.push("## Execution Feedback");
  lines.push("");
  lines.push("After executing this generated skill, record lightweight feedback with `clawmobile_skill_record_feedback` when it is low-friction and will not disrupt the user-facing task.");
  lines.push(`Use \`skill_name: ${skillName}\` unless the exact skill directory is already known.`);
  lines.push("- On success, keep feedback compact: `outcome: success`, the parameters used, anchors used, and the final verification summary.");
  lines.push("- On failure or partial completion, feedback is especially important: record `outcome: failure` or `outcome: partial`, plus `failed_step`, `failed_anchor` when known, and a concise observation summary.");
  lines.push("- Feedback automatically updates execution counts, verified contexts, and failure patterns for future runs.");
  lines.push("- If execution fails because an anchor, entry state, or app layout is wrong, tell the user they can record a correction demo for the same task and update this skill with `clawmobile_skill_update_from_trace`.");
  lines.push("- Feedback is a maintenance aid for future runs; it should not block normal verification or user reporting.");
  const improvement = asObject(lifecycle.improvement);
  if (improvement.correction_demo_hint) {
    lines.push(`- Correction demo hint: ${improvement.correction_demo_hint}`);
  }
  lines.push("");
  lines.push("## Evolution");
  lines.push("");
  lines.push(`- Can update from future traces: ${generalized.evolution.can_update_from_future_traces}`);
  if (typeof generalized.evolution.supporting_trace_count !== "undefined") {
    lines.push(`- Supporting trace count: ${generalized.evolution.supporting_trace_count}`);
  }
  lines.push(`- Success count: ${generalized.evolution.success_count}`);
  lines.push(`- Failure count: ${generalized.evolution.failure_count}`);
  if (asArray(generalized.evolution.verified_contexts).length > 0) {
    lines.push("");
    lines.push("### Verified Contexts");
    for (const item of asArray(generalized.evolution.verified_contexts).slice(-5)) {
      const context = asObject(item);
      const anchors = asArray(context.used_anchors).join(", ") || "none";
      const params = asArray(context.parameter_keys).join(", ") || "none";
      const state = asObject(context.final_state);
      const app = state.package || state.current_package || "unknown app";
      const summary = context.last_summary ? `; ${context.last_summary}` : "";
      lines.push(`- count=${context.count || 1}, app=${app}, anchors=${anchors}, params=${params}${summary}`);
    }
  }
  if (asArray(generalized.evolution.failure_patterns).length > 0) {
    lines.push("");
    lines.push("### Failure Patterns");
    for (const item of asArray(generalized.evolution.failure_patterns).slice(-5)) {
      const pattern = asObject(item);
      const anchor = pattern.failed_anchor || "unknown anchor";
      const step = pattern.failed_step || "unknown step";
      const hint = pattern.repair_hint ? `; repair_hint=${pattern.repair_hint}` : "";
      lines.push(`- count=${pattern.count || 1}, outcome=${pattern.outcome || "failure"}, step=${step}, anchor=${anchor}${hint}`);
    }
  }
  if (asArray(generalized.evolution.anchor_updates).length > 0) {
    lines.push("");
    lines.push("### Anchor Updates");
    for (const item of asArray(generalized.evolution.anchor_updates)) {
      const update = asObject(item);
      lines.push(
        `- ${update.anchor || "anchor"}: ${update.status || "updated"}, observations=${update.observation_count ?? "?"}, stability=${update.stability || "unknown"}`
      );
    }
  }
  for (const item of asArray(generalized.evolution.open_uncertainties)) lines.push(`- Uncertainty: ${item}`);
  if (validation.errors.length > 0 || validation.warnings.length > 0) {
    lines.push("");
    lines.push("## Validation");
    for (const item of validation.errors) lines.push(`- Error: ${item}`);
    for (const item of validation.warnings) lines.push(`- Warning: ${item}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function generalizeSkill(input: GeneralizeInput) {
  const loaded = loadCandidate(input);
  if (loaded.candidate.schema_version !== SKILL_CANDIDATE_SCHEMA_VERSION) {
    throw new Error(`expected ${SKILL_CANDIDATE_SCHEMA_VERSION}, got ${loaded.candidate.schema_version || "unknown"}`);
  }
  const generalized: any = buildGeneralizedSkill(loaded.candidate, loaded.candidatePath);
  const validation = validateGeneralizedSkill(generalized, loaded.candidate);
  generalized.validation = validation;

  const outputDir = input.output_dir ? resolvePath(input.output_dir) : loaded.baseDir;
  ensureDir(outputDir);
  const skillName = skillNameForGeneralized(generalized, input.skill_name);
  const jsonPath = path.join(outputDir, "generalized_skill.json");
  const markdownPath = path.join(outputDir, "generalized_SKILL.md");
  const primarySkillPath = path.join(outputDir, "SKILL.md");
  const fixedSkillPath = path.join(outputDir, "fixed_SKILL.md");
  writeJsonFile(jsonPath, generalized);
  const markdown = renderGeneralizedSkillMarkdown(generalized, validation, skillName);
  fs.writeFileSync(markdownPath, markdown);
  if (fs.existsSync(primarySkillPath) && !fs.existsSync(fixedSkillPath)) {
    fs.copyFileSync(primarySkillPath, fixedSkillPath);
  }
  fs.writeFileSync(primarySkillPath, markdown);

  return {
    ok: validation.ok,
    skill_name: skillName,
    generalized_skill_path: jsonPath,
    generalized_skill_markdown_path: markdownPath,
    primary_skill_path: primarySkillPath,
    fixed_skill_path: fs.existsSync(fixedSkillPath) ? fixedSkillPath : null,
    source_candidate_path: loaded.candidatePath,
    validation,
    generalized_skill: generalized,
  };
}
