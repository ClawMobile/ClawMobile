import fs from "fs";
import path from "path";
import { getWorkspaceDir } from "../tools/workspace";
import { runSkillFastPath } from "../trace_induction/fastpath";
import { getSkillStatus } from "../trace_induction/status";
import { describeOpenClawResult, normalizeCompanionSessionId, submitToOpenClawAgent } from "./openclawAgentClient";
import { getGatewayStatus } from "./openclawGatewayClient";
import { rememberSubmittedRun } from "./runs";

export type CompanionSkillSummary = {
  id: string;
  name: string;
  description: string;
  status: "draft" | "tested" | "trusted" | "broken";
  risk: "low" | "medium" | "high";
  source: "demo" | "generated" | "installed" | "unknown";
  scope: "app" | "scenario" | "system" | "tool" | "unknown";
  tags: string[];
  primaryUse: string;
  appPackage?: string;
  routeCount: number;
  fastPathCount: number;
  knowledgeCount: number;
  lastRunAt?: number;
  successCount: number;
  failureCount: number;
  requiresConfirmation: boolean;
};

export type CompanionSkillOverview = {
  primaryUse: string;
  agentValue: string;
  whenToUse: string[];
  whenNotToUse: string[];
};

export type CompanionSkillKnowledgeSection = {
  id: string;
  title: string;
  summary: string;
  items: string[];
};

export type CompanionSkillFastPath = {
  id: string;
  title: string;
  description: string;
  source: "demo" | "successful_run" | "manual" | "generated" | "unknown";
  status: "draft" | "tested" | "trusted" | "broken";
  risk: "low" | "medium" | "high";
  inputSummary: string[];
  successCount: number;
  failureCount: number;
  lastRunAt?: number;
  canRun: boolean;
};

export type CompanionSkillExecutionRoute = {
  id: string;
  title: string;
  description: string;
  mode: "agent_with_skill_context" | "fast_path" | "non_ui_shortcut" | "manual_handoff" | "reference";
  source: "demo" | "successful_run" | "manual" | "generated" | "unknown";
  status: "draft" | "tested" | "trusted" | "broken";
  risk: "low" | "medium" | "high";
  primary: boolean;
  canRun: boolean;
  inputSummary: string[];
};

export type CompanionSkillHistoryItem = {
  id: string;
  title: string;
  kind: "demo" | "run" | "feedback" | "update" | "unknown";
  status: "success" | "failed" | "partial" | "unknown";
  timestamp?: number;
  summary: string;
};

export type CompanionSkillDetail = CompanionSkillSummary & {
  version: string;
  overview: CompanionSkillOverview;
  appModel: any;
  knowledge: CompanionSkillKnowledgeSection[];
  knowledgeShortcuts: string[];
  executionRoutes: CompanionSkillExecutionRoute[];
  fastPaths: CompanionSkillFastPath[];
  history: CompanionSkillHistoryItem[];
  inputs: any[];
  outputs: string[];
  capabilities: string[];
  confirmationPolicy: string;
  privacyUsage: string[];
  recentRuns: any[];
  createdAt?: number;
  updatedAt?: number;
};

type LoadedSkill = {
  skillDir: string;
  generatedJson: any | null;
  candidateJson: any | null;
  summary: CompanionSkillSummary;
  detail: CompanionSkillDetail;
};

type FeedbackSummary = {
  successCount: number;
  failureCount: number;
  lastRunAt?: number;
  history: CompanionSkillHistoryItem[];
};

export type SkillPreviewRequest = {
  inputs?: Record<string, any>;
  instruction?: string;
  taskText?: string;
  text?: string;
};

export type SkillRunRequest = SkillPreviewRequest & {
  sessionId?: string;
};

export type FastPathRunRequest = {
  inputs?: Record<string, any>;
  parameters?: Record<string, any>;
  parameter_values?: Record<string, any>;
  finalCheckTexts?: string[];
  final_check_texts?: string[];
  dryRun?: boolean;
  dry_run?: boolean;
  recordFeedback?: boolean;
  record_feedback?: boolean;
  allowIneligible?: boolean;
  allow_ineligible?: boolean;
  stopOnError?: boolean;
  stop_on_error?: boolean;
  screenshotOnFailure?: boolean;
  screenshot_on_failure?: boolean;
  maxSteps?: number;
  max_steps?: number;
};

export type SkillRouteRequest = {
  text?: string;
  taskText?: string;
  instruction?: string;
  inputs?: Record<string, any>;
  appPackage?: string;
  limit?: number;
  includeInternal?: boolean;
  allowAutoFastPath?: boolean;
};

export type SkillRouteSuggestion = {
  skillId: string;
  name: string;
  description: string;
  score: number;
  confidence: "low" | "medium" | "high";
  reasons: string[];
  recommendedRoute: CompanionSkillExecutionRoute;
  secondaryRoutes: CompanionSkillExecutionRoute[];
  missingInputs: string[];
  autoRun: {
    mode: "none" | "fast_path";
    allowed: boolean;
    reason: string;
    fastPathId?: string;
  };
  summary: CompanionSkillSummary;
};

export function listWorkspaceSkills(): CompanionSkillSummary[] {
  return loadWorkspaceSkills().map((skill) => skill.summary);
}

export function getWorkspaceSkill(id: string): CompanionSkillDetail | null {
  return findWorkspaceSkill(id)?.detail || null;
}

export function routeWorkspaceSkills(request: SkillRouteRequest = {}) {
  const taskText = String(request.text || request.taskText || request.instruction || "").trim();
  const inputs = request.inputs || {};
  const appPackage = String(request.appPackage || "").trim();
  const limit = Math.min(Math.max(Number(request.limit || 5), 1), 10);
  const candidates = loadWorkspaceSkills()
    .filter((loaded) => request.includeInternal === true || isUserTaskSkill(loaded.detail))
    .map((loaded) => routeScore(loaded.detail, taskText, appPackage, inputs, request.allowAutoFastPath === true))
    .filter((suggestion) => suggestion.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    ok: true,
    query: taskText,
    appPackage: appPackage || undefined,
    tokenCost: "none_local_metadata_match",
    suggestions: candidates,
    best: candidates[0] || null,
  };
}

export function buildAutoSkillContextForIntent(text: string) {
  if (process.env.CLAWMOBILE_AUTO_SKILL_ROUTING === "0") return null;
  const routed = routeWorkspaceSkills({ text, limit: 2 });
  const best = routed.best;
  if (!best || best.confidence !== "high") return null;
  if (routed.suggestions[1]?.confidence === "high") return null;
  const skill = getWorkspaceSkill(best.skillId);
  if (!skill) return null;
  const context = compactSkillContextForIntent(skill, best);
  if (!context) return null;
  return {
    routed,
    prompt: [
      text.trim(),
      "",
      "Local ClawMobile skill router selected compact skill context below. Use it only if it remains relevant to the user task.",
      context,
    ].join("\n"),
  };
}

export function previewWorkspaceSkill(id: string, request: SkillPreviewRequest = {}) {
  const loaded = findWorkspaceSkill(id);
  const skill = loaded?.detail || null;
  if (!skill) return null;

  const inputs = request.inputs || {};
  const status = safeSkillStatus(loaded);
  const missingInputs = missingRequiredInputs(skill, inputs);
  const executionState = skillExecutionState(skill, status, missingInputs);
  const runnableFastPaths = skill.fastPaths.filter((fastPath) => fastPath.canRun);
  const providedCount = Object.values(inputs).filter((value) => String(value || "").trim()).length;
  return {
    skillId: id,
    executionState,
    summary: `${skill.name} provides reusable app/task knowledge for an agent run. ${providedCount} input value${providedCount === 1 ? "" : "s"} provided.`,
    appModel: skill.appModel,
    capabilities: skill.capabilities,
    privacyUsage: skill.privacyUsage,
    requiresConfirmation: skill.requiresConfirmation,
    missingInputs,
    status,
    recommendedAction: recommendedAction(skill, status, missingInputs),
    knowledgeShortcuts: skill.knowledgeShortcuts.slice(0, 8),
    executionRoutes: skill.executionRoutes,
    eligibleFastPaths: runnableFastPaths.map((fastPath) => ({
      id: fastPath.id,
      title: fastPath.title,
      canRun: fastPath.canRun,
      risk: fastPath.risk,
      inputSummary: fastPath.inputSummary,
    })),
    steps: [
      {
        id: "load_skill_context",
        title: "Load skill context",
        description: "Read the app model, reusable knowledge shortcuts, decision hints, and known failure points before planning.",
        backend: "OpenClaw workspace",
        risk: "low",
      },
      {
        id: "choose_execution_route",
        title: "Choose execution route",
        description: "Use the skill as compact app knowledge for normal agent planning; use a fast path only when its inputs and app-state assumptions match.",
        backend: "ClawMobile agent",
        risk: skill.risk,
        requiresConfirmation: skill.requiresConfirmation,
      },
    ],
  };
}

export async function runWorkspaceSkill(id: string, request: SkillRunRequest = {}) {
  const loaded = findWorkspaceSkill(id);
  const skill = loaded?.detail || null;
  if (!skill) return null;

  const runId = `skill-run-${id}-${Date.now()}`;
  const inputs = request.inputs || {};
  const instruction = String(request.instruction || request.taskText || request.text || skill.primaryUse || "").trim();
  const sessionId = normalizeCompanionSessionId(request.sessionId || `skill-${id}`);
  const gateway = await getGatewayStatus();
  if (!gateway.reachable) {
    return {
      success: false,
      runId,
      skillId: id,
      sessionId,
      state: "not_started",
      status: "failed",
      startedAt: Date.now(),
      message: gateway.message,
      errorSummary: gateway.message,
      gateway,
      inputs,
    };
  }

  const prompt = buildSkillAgentPrompt(skill, instruction, inputs);
  try {
    const submitted = await submitToOpenClawAgent(prompt, runId, sessionId);
    await rememberSubmittedRun(prompt, submitted);
    return {
      success: true,
      runId: submitted.runId,
      skillId: id,
      sessionId,
      state: submitted.waitedForFinal ? "completed" : "running",
      status: submitted.waitedForFinal ? "completed" : "running",
      startedAt: submitted.acceptedAt || Date.now(),
      message: describeOpenClawResult(submitted),
      currentStep: submitted.waitedForFinal ? undefined : "OpenClaw is working on this skill run.",
      resultSummary: submitted.waitedForFinal ? describeOpenClawResult(submitted) : undefined,
      gatewayRun: submitted,
      inputs,
    };
  } catch (error: any) {
    const message = `Unable to start skill agent run: ${error?.message || error}`;
    return {
      success: false,
      runId,
      skillId: id,
      sessionId,
      state: "failed",
      status: "failed",
      startedAt: Date.now(),
      message,
      errorSummary: message,
      inputs,
    };
  }
}

export async function runWorkspaceFastPath(id: string, fastPathId: string, request: FastPathRunRequest = {}) {
  const loaded = findWorkspaceSkill(id);
  const skill = loaded?.detail || null;
  const fastPath = skill?.fastPaths.find((item) => item.id === fastPathId);
  if (!skill || !fastPath) return null;

  const parameters = {
    ...(request.parameter_values || {}),
    ...(request.inputs || {}),
    ...(request.parameters || {}),
  };
  const startedAt = Date.now();
  if (!fastPath.canRun) {
    return {
      success: false,
      runId: `fast-path-${id}-${fastPathId}-${startedAt}`,
      skillId: id,
      fastPathId,
      state: "not_started",
      status: "failed",
      startedAt,
      message: "This fast path is recorded as reference-only and cannot run directly.",
      errorSummary: "This fast path is recorded as reference-only and cannot run directly.",
      inputs: parameters,
    };
  }

  try {
    const rawResult = await runSkillFastPath({
      skill_dir: loaded.skillDir,
      parameters,
      final_check_texts: request.final_check_texts || request.finalCheckTexts,
      dry_run: request.dry_run ?? request.dryRun,
      record_feedback: request.record_feedback ?? request.recordFeedback,
      allow_ineligible: request.allow_ineligible ?? request.allowIneligible,
      stop_on_error: request.stop_on_error ?? request.stopOnError,
      screenshot_on_failure: request.screenshot_on_failure ?? request.screenshotOnFailure,
      max_steps: request.max_steps ?? request.maxSteps,
    });
    const ok = rawResult?.ok === true;
    return {
      success: ok,
      runId: `fast-path-${id}-${fastPathId}-${startedAt}`,
      skillId: id,
      fastPathId,
      state: ok ? "completed" : "failed",
      status: ok ? "completed" : "failed",
      startedAt,
      finishedAt: Date.now(),
      message: ok
        ? "Fast path completed."
        : String(rawResult?.error || rawResult?.hint || "Fast path did not complete successfully."),
      resultSummary: ok ? "Fast path completed." : undefined,
      errorSummary: ok ? undefined : String(rawResult?.error || rawResult?.hint || "Fast path did not complete successfully."),
      inputs: parameters,
      rawResult,
      fallbackRequired: rawResult?.fallback_required === true || !ok,
      selfRepair: rawResult?.self_repair,
    };
  } catch (error: any) {
    const message = `Fast path runner failed: ${error?.message || error}`;
    return {
      success: false,
      runId: `fast-path-${id}-${fastPathId}-${startedAt}`,
      skillId: id,
      fastPathId,
      state: "failed",
      status: "failed",
      startedAt,
      finishedAt: Date.now(),
      message,
      errorSummary: message,
      inputs: parameters,
    };
  }
}

function findWorkspaceSkill(id: string): LoadedSkill | null {
  return loadWorkspaceSkills().find((skill) => skill.summary.id === id) || null;
}

function safeSkillStatus(skill: LoadedSkill | null) {
  if (!skill?.generatedJson) return null;
  try {
    return getSkillStatus({
      skill_dir: skill.skillDir,
      include_history: true,
      include_paths: false,
      include_validation: false,
      max_history: 5,
      max_contexts: 5,
      max_patterns: 5,
    });
  } catch (error: any) {
    return {
      ok: false,
      error: error?.message || String(error),
    };
  }
}

function missingRequiredInputs(skill: CompanionSkillDetail, inputs: Record<string, any>) {
  return skill.inputs
    .filter((input) => input?.required === true)
    .map((input) => String(input?.id || ""))
    .filter((id) => id && !String(inputs[id] ?? "").trim());
}

function skillExecutionState(skill: CompanionSkillDetail, status: any, missingInputs: string[]) {
  if (status?.ok === false) return "broken";
  if (status?.recommended_next_action?.tool === "clawmobile_skill_reflect_fast_path_failure") return "needs_repair";
  if (skill.source === "generated" || skill.knowledgeCount > 0 || skill.executionRoutes.length > 0) return "skill_ready";
  if (missingInputs.length > 0) return "needs_inputs";
  return "agent_guidance";
}

function recommendedAction(skill: CompanionSkillDetail, status: any, missingInputs: string[]) {
  const fastPath = skill.fastPaths.find((item) => item.canRun);
  if (status?.recommended_next_action?.tool === "clawmobile_skill_reflect_fast_path_failure") {
    return {
      mode: "run_with_skill_context",
      message: "Use this skill as app/task knowledge for a normal agent run; prior fast-path failure evidence should be treated as diagnostic context.",
      raw: status.recommended_next_action,
      secondaryAction: fastPath ? {
        mode: "run_fast_path",
        fastPathId: fastPath.id,
        blockedByRepair: true,
      } : undefined,
    };
  }
  return {
    mode: "run_with_skill_context",
    message: "Use this skill as compact app/task knowledge for a normal agent run.",
    missingInputsForDirectRoutes: missingInputs,
    secondaryAction: fastPath ? {
      mode: "run_fast_path",
      message: missingInputs.length > 0
        ? `Fast path requires: ${missingInputs.join(", ")}.`
        : "Fast path is available as an optional acceleration route.",
      fastPathId: fastPath.id,
    } : undefined,
  };
}

function routeScore(
  skill: CompanionSkillDetail,
  taskText: string,
  appPackage: string,
  inputs: Record<string, any>,
  allowAutoFastPath: boolean,
): SkillRouteSuggestion {
  const queryTokens = tokenize(taskText);
  const haystackParts = [
    skill.id,
    skill.name,
    skill.description,
    skill.primaryUse,
    skill.overview.primaryUse,
    skill.overview.agentValue,
    skill.appModel?.package,
    skill.appModel?.intentName,
    skill.appModel?.intentDescription,
    ...skill.tags,
    ...skill.overview.whenToUse,
    ...skill.knowledgeShortcuts,
    ...skill.executionRoutes.map((route) => `${route.title} ${route.description}`),
  ];
  const haystack = normalizeSearchText(haystackParts.join(" "));
  const reasons: string[] = [];
  let score = 0;

  if (appPackage && skill.appPackage && appPackage === skill.appPackage) {
    score += 8;
    reasons.push(`app package matches ${appPackage}`);
  } else if (skill.appPackage && normalizeSearchText(taskText).includes(normalizeSearchText(skill.appPackage))) {
    score += 5;
    reasons.push(`task mentions app package ${skill.appPackage}`);
  }

  if (queryTokens.length > 0) {
    let matches = 0;
    for (const token of queryTokens) {
      if (haystack.includes(token)) matches += 1;
    }
    if (matches > 0) {
      score += matches;
      reasons.push(`${matches} task term${matches === 1 ? "" : "s"} match skill metadata`);
    }
  }

  const phraseScore = phraseMatchScore(taskText, [
    skill.name,
    skill.description,
    skill.primaryUse,
    skill.appModel?.intentName,
    skill.appModel?.intentDescription,
  ]);
  if (phraseScore > 0) {
    score += phraseScore;
    reasons.push("task phrase matches skill purpose");
  }

  if (skill.source === "generated") score += 1;
  if (skill.successCount > 0) {
    score += Math.min(skill.successCount, 3);
    reasons.push(`prior success count=${skill.successCount}`);
  }
  if (skill.failureCount > 0) {
    score -= Math.min(skill.failureCount, 3);
    reasons.push(`prior failure count=${skill.failureCount}`);
  }
  if (skill.scope === "system" || skill.scope === "tool") score -= 4;

  const missingInputs = missingRequiredInputs(skill, inputs);
  const confidence = score >= 8 ? "high" : score >= 4 ? "medium" : "low";
  const recommendedRoute = skill.executionRoutes.find((route) => route.mode === "agent_with_skill_context")
    || skill.executionRoutes.find((route) => route.primary)
    || skill.executionRoutes[0]
    || fallbackAgentRoute(skill);
  const secondaryRoutes = skill.executionRoutes.filter((route) => route.id !== recommendedRoute.id).slice(0, 4);
  const fastPath = skill.fastPaths.find((item) => item.canRun);
  const autoRun = autoFastPathDecision(skill, fastPath, missingInputs, allowAutoFastPath, confidence);

  return {
    skillId: skill.id,
    name: skill.name,
    description: skill.description,
    score,
    confidence,
    reasons: unique(reasons),
    recommendedRoute,
    secondaryRoutes,
    missingInputs,
    autoRun,
    summary: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      status: skill.status,
      risk: skill.risk,
      source: skill.source,
      scope: skill.scope,
      tags: skill.tags,
      primaryUse: skill.primaryUse,
      appPackage: skill.appPackage,
      routeCount: skill.routeCount,
      fastPathCount: skill.fastPathCount,
      knowledgeCount: skill.knowledgeCount,
      lastRunAt: skill.lastRunAt,
      successCount: skill.successCount,
      failureCount: skill.failureCount,
      requiresConfirmation: skill.requiresConfirmation,
    },
  };
}

function autoFastPathDecision(
  skill: CompanionSkillDetail,
  fastPath: CompanionSkillFastPath | undefined,
  missingInputs: string[],
  allowAutoFastPath: boolean,
  confidence: "low" | "medium" | "high",
) {
  if (!fastPath) {
    return { mode: "none" as const, allowed: false, reason: "no runnable fast path" };
  }
  if (!allowAutoFastPath) {
    return { mode: "none" as const, allowed: false, reason: "caller did not opt into automatic fast-path execution", fastPathId: fastPath.id };
  }
  if (confidence !== "high") {
    return { mode: "none" as const, allowed: false, reason: "skill route confidence is not high", fastPathId: fastPath.id };
  }
  if (missingInputs.length > 0) {
    return { mode: "none" as const, allowed: false, reason: `missing direct-route inputs: ${missingInputs.join(", ")}`, fastPathId: fastPath.id };
  }
  if (skill.risk === "high" || fastPath.risk === "high") {
    return { mode: "none" as const, allowed: false, reason: "high-risk skill or route requires explicit user confirmation", fastPathId: fastPath.id };
  }
  if (skill.requiresConfirmation && fastPath.risk !== "low" && skill.successCount < 2) {
    return { mode: "none" as const, allowed: false, reason: "route is not proven enough to skip confirmation", fastPathId: fastPath.id };
  }
  if (skill.failureCount > 0 && skill.successCount === 0) {
    return { mode: "none" as const, allowed: false, reason: "prior failures without successes block automatic fast path", fastPathId: fastPath.id };
  }
  return { mode: "fast_path" as const, allowed: true, reason: "high-confidence low-risk/proven fast path", fastPathId: fastPath.id };
}

function compactSkillContextForIntent(skill: CompanionSkillDetail, suggestion: SkillRouteSuggestion) {
  const lines: string[] = [
    `Skill: ${skill.name} (${skill.id})`,
    `Recommended route: ${suggestion.recommendedRoute.mode}`,
    `Why selected: ${suggestion.reasons.slice(0, 3).join("; ") || "local metadata match"}`,
    `Primary use: ${skill.primaryUse}`,
  ];
  if (skill.appPackage) lines.push(`App package: ${skill.appPackage}`);
  const shortcuts = skill.knowledgeShortcuts.slice(0, 5);
  if (shortcuts.length) {
    lines.push("Knowledge shortcuts:");
    for (const item of shortcuts) lines.push(`- ${item}`);
  }
  const verifiers = normalizeArray(skill.appModel?.verification).map(String).slice(0, 3);
  if (verifiers.length) {
    lines.push("Verification hints:");
    for (const item of verifiers) lines.push(`- ${item}`);
  }
  const fastPath = suggestion.secondaryRoutes.find((route) => route.mode === "fast_path" && route.canRun);
  if (fastPath) {
    lines.push(`Optional fast path: ${fastPath.id.replace(/^fast-path:/, "")}; use only when inputs and app state match.`);
  }
  lines.push("Policy: use this as reusable app knowledge; do not force replay if current state differs.");
  return lines.join("\n");
}

function fallbackAgentRoute(skill: CompanionSkillDetail): CompanionSkillExecutionRoute {
  return {
    id: "agent-with-skill-context",
    title: "Run with skill context",
    description: "Use this skill as compact context during a normal agent run.",
    mode: "agent_with_skill_context",
    source: skill.source === "generated" ? "generated" : "manual",
    status: skill.status,
    risk: skill.risk,
    primary: true,
    canRun: true,
    inputSummary: inputSummary(null, null),
  };
}

function buildSkillAgentPrompt(skill: CompanionSkillDetail, instruction: string, inputs: Record<string, any>) {
  const task = instruction || skill.primaryUse || skill.description;
  const inputLines = Object.keys(inputs).length
    ? JSON.stringify(inputs, null, 2)
    : "{}";
  const whenToUse = skill.overview.whenToUse.slice(0, 5).map((item) => `- ${item}`).join("\n") || "- Use when the task matches the skill purpose.";
  const whenNotToUse = skill.overview.whenNotToUse.slice(0, 5).map((item) => `- ${item}`).join("\n") || "- none";
  const knowledge = skill.knowledge
    .slice(0, 5)
    .map((section) => {
      const items = section.items.slice(0, 5).map((item) => `  - ${item}`).join("\n");
      return `- ${section.title}: ${section.summary || ""}${items ? `\n${items}` : ""}`;
    })
    .join("\n") || "- none";
  const appModel = summarizeAppModelForPrompt(skill.appModel);
  const shortcuts = skill.knowledgeShortcuts.slice(0, 8).map((item) => `- ${item}`).join("\n") || "- none";
  const routes = skill.executionRoutes.map((route) =>
    `- ${route.id}: ${route.title} (mode=${route.mode}, canRun=${route.canRun}, primary=${route.primary})`
  ).join("\n") || "- none";
  const fastPaths = skill.fastPaths.map((fastPath) =>
    `- ${fastPath.id}: ${fastPath.title} (canRun=${fastPath.canRun}, risk=${fastPath.risk})`
  ).join("\n") || "- none";
  return [
    `Use workspace skill "${skill.id}" (${skill.name}) as compact app/task knowledge for this mobile task.`,
    "",
    `Task: ${task}`,
    "",
    "Inputs:",
    inputLines,
    "",
    "Skill overview:",
    `- Primary use: ${skill.overview.primaryUse}`,
    `- Agent value: ${skill.overview.agentValue}`,
    `- Confirmation policy: ${skill.confirmationPolicy}`,
    "",
    "App model:",
    appModel,
    "",
    "When to use:",
    whenToUse,
    "",
    "When not to use:",
    whenNotToUse,
    "",
    "Skill knowledge:",
    knowledge,
    "",
    "Knowledge shortcuts:",
    shortcuts,
    "",
    "Execution routes:",
    routes,
    "",
    "Fast paths:",
    fastPaths,
    "",
    "Execution policy:",
    "- Treat the skill as reusable app knowledge, not as a command to replay a trace.",
    "- Prefer the cheapest safe route: shell/API/intent/deep link when the skill says one exists, then grounded UI tools, then visual reasoning only when needed.",
    "- Use a generated fast path only when required inputs and current app state match its assumptions.",
    "- If fast path is unavailable or fails, continue with normal grounded execution using the skill knowledge; do not mark the skill unusable.",
    "- Record feedback when it is useful and does not disrupt the user-facing task.",
  ].join("\n");
}

function loadWorkspaceSkills(): LoadedSkill[] {
  const skillsDir = path.join(getWorkspaceDir(), "skills");
  if (!fs.existsSync(skillsDir)) return [];

  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => loadSkill(path.join(skillsDir, entry.name), entry.name))
    .filter((skill): skill is LoadedSkill => skill !== null)
    .sort((a, b) => a.summary.name.localeCompare(b.summary.name));
}

function loadSkill(skillDir: string, id: string): LoadedSkill | null {
  const markdownPath = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(markdownPath)) return null;

  const markdown = readText(markdownPath);
  const frontmatter = parseFrontmatter(markdown);
  const name = String(frontmatter.name || id).trim() || id;
  const description = String(frontmatter.description || firstParagraph(markdown) || "Workspace skill.").trim();
  const stat = fs.statSync(markdownPath);
  const generatedJson = readJson(path.join(skillDir, "generalized_skill.json"));
  const candidateJson = readJson(path.join(skillDir, "skill_candidate.json"));
  const generated = frontmatter.clawmobile_generated === "true" || !!generatedJson || !!candidateJson;
  const feedback = readFeedback(path.join(skillDir, "execution_feedback.jsonl"));
  const risk = inferRisk(id, description, generated);
  const scope = inferScope(id, description, generatedJson, candidateJson);
  const overview = buildOverview(markdown, description, scope, generated);
  const knowledge = buildKnowledge(markdown, generatedJson, candidateJson);
  const appModel = buildAppModel(generatedJson, candidateJson);
  const knowledgeShortcuts = buildKnowledgeShortcuts(generatedJson, candidateJson);
  const fastPaths = buildFastPaths(id, generatedJson, candidateJson, feedback, generated);
  const executionRoutes = buildExecutionRoutes(fastPaths, generatedJson, candidateJson, generated, feedback);
  const history = buildHistory(feedback, generated, stat);

  const summary: CompanionSkillSummary = {
    id,
    name: toTitle(name),
    description,
    status: inferStatus(generated, feedback, fastPaths),
    risk,
    source: generated ? "generated" : "installed",
    scope,
    tags: inferTags(id, description, generated, scope, fastPaths.length),
    primaryUse: overview.primaryUse,
    appPackage: appModel?.package,
    routeCount: executionRoutes.length,
    fastPathCount: fastPaths.length,
    knowledgeCount: knowledge.reduce((count, section) => count + section.items.length, 0),
    lastRunAt: feedback.lastRunAt,
    successCount: feedback.successCount,
    failureCount: feedback.failureCount,
    requiresConfirmation: risk !== "low",
  };

  return {
    skillDir,
    generatedJson,
    candidateJson,
    summary,
    detail: {
      ...summary,
      version: String(frontmatter.version || "workspace"),
      overview,
      appModel,
      knowledge,
      knowledgeShortcuts,
      executionRoutes,
      fastPaths,
      history,
      inputs: buildInputs(generatedJson, candidateJson),
      outputs: inferOutputs(id, generated, fastPaths.length),
      capabilities: inferCapabilities(id, description),
      confirmationPolicy: inferConfirmationPolicy(risk, generated, fastPaths.length),
      privacyUsage: inferPrivacyUsage(id, generated),
      recentRuns: feedback.history
        .filter((item) => item.kind === "run" || item.kind === "feedback")
        .slice(0, 5)
        .map((item) => ({
          runId: item.id,
          skillId: id,
          status: item.status === "success" ? "completed" : item.status === "failed" ? "failed" : "running",
          startedAt: item.timestamp,
          finishedAt: item.timestamp,
          resultSummary: item.status === "success" ? item.summary : undefined,
          errorSummary: item.status === "failed" ? item.summary : undefined,
        })),
      createdAt: stat.birthtimeMs ? Math.round(stat.birthtimeMs) : undefined,
      updatedAt: Math.round(stat.mtimeMs),
    },
  };
}

function parseFrontmatter(markdown: string): Record<string, string> {
  if (!markdown.startsWith("---")) return {};
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return {};

  const block = markdown.slice(3, end).trim();
  const result: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key) result[key] = value;
  }
  return result;
}

function firstParagraph(markdown: string): string {
  return stripFrontmatter(markdown)
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s*/, "").trim())
    .find((part) => part && !part.startsWith("|") && !part.startsWith("```")) || "";
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---[\s\S]*?\n---/, "").trim();
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readJson(file: string): any | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readFeedback(file: string): FeedbackSummary {
  const result: FeedbackSummary = { successCount: 0, failureCount: 0, history: [] };
  if (!fs.existsSync(file)) return result;

  let index = 0;
  for (const line of readText(file).split(/\r?\n/)) {
    if (!line.trim()) continue;
    index += 1;
    try {
      const parsed = JSON.parse(line);
      const status = feedbackStatus(parsed);
      if (status === "success") result.successCount += 1;
      else if (status === "failed") result.failureCount += 1;
      const at = jsonTimestamp(parsed);
      if (at) result.lastRunAt = Math.max(result.lastRunAt || 0, at);
      result.history.push({
        id: String(parsed?.run_id || parsed?.runId || `feedback_${index}`),
        title: String(parsed?.title || parsed?.task || parsed?.intent || "Execution feedback"),
        kind: "feedback",
        status,
        timestamp: at,
        summary: String(parsed?.summary || parsed?.result || parsed?.error || parsed?.message || "Feedback recorded."),
      });
    } catch {
      result.failureCount += 1;
      result.history.push({
        id: `feedback_parse_error_${index}`,
        title: "Unreadable feedback",
        kind: "feedback",
        status: "failed",
        summary: "A feedback entry could not be parsed.",
      });
    }
  }
  result.history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return result;
}

function feedbackStatus(parsed: any): "success" | "failed" | "partial" | "unknown" {
  const status = String(parsed?.status || parsed?.outcome || "").toLowerCase();
  if (parsed?.success === true || status === "success" || status === "completed" || status === "ok") return "success";
  if (parsed?.success === false || status === "failed" || status === "error") return "failed";
  if (status === "partial" || status === "repaired") return "partial";
  return "unknown";
}

function jsonTimestamp(parsed: any): number | undefined {
  const value = Number(parsed?.timestamp || parsed?.updated_at || parsed?.updatedAt || parsed?.created_at || parsed?.createdAt || 0);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function buildOverview(markdown: string, description: string, scope: CompanionSkillSummary["scope"], generated: boolean): CompanionSkillOverview {
  const whenToUse = extractBulletsFromSections(markdown, [/read this skill when/i, /choose the entry point/i, /use this skill/i]).slice(0, 6);
  const whenNotToUse = extractDoNotLines(markdown).slice(0, 5);
  const primaryUse = firstUseSentence(markdown) || description;

  return {
    primaryUse,
    agentValue: generated
      ? "Keeps reusable app/task knowledge compact so the agent can avoid repeated UI probing; fast paths are optional acceleration routes."
      : scope === "system"
        ? "Gives the agent policy and recovery boundaries without forcing a fixed execution path."
        : "Provides compact workspace guidance that can speed up planning without replacing exploration.",
    whenToUse: whenToUse.length ? whenToUse : [description],
    whenNotToUse,
  };
}

function buildKnowledge(markdown: string, generatedJson: any | null, candidateJson: any | null): CompanionSkillKnowledgeSection[] {
  const sections = markdownSections(markdown)
    .filter((section) => !/good output shape|schema|json/i.test(section.title))
    .map((section) => ({
      id: slug(section.title),
      title: section.title,
      summary: firstPlainLine(section.body),
      items: extractKnowledgeItems(section.body).slice(0, 7),
    }))
    .filter((section) => section.summary || section.items.length)
    .slice(0, 6);

  const generatedItems = generatedKnowledgeItems(generatedJson, candidateJson);
  if (generatedItems.length) {
    sections.unshift({
      id: "generated-skill-model",
      title: "Generated Skill Model",
      summary: "Structured knowledge extracted from generated skill artifacts.",
      items: generatedItems.slice(0, 8),
    });
  }
  const shortcutItems = buildKnowledgeShortcuts(generatedJson, candidateJson);
  if (shortcutItems.length) {
    sections.unshift({
      id: "knowledge-shortcuts",
      title: "Knowledge Shortcuts",
      summary: "Compact facts that should reduce repeated app probing and LLM reasoning.",
      items: shortcutItems.slice(0, 8),
    });
  }
  return sections;
}

function buildAppModel(generatedJson: any | null, candidateJson: any | null): any {
  const source = generatedJson || candidateJson || {};
  const app = source?.app || {};
  const anchors = asObject(source?.anchors);
  const anchorRoles = Object.entries(anchors)
    .map(([name, value]) => {
      const anchor = asObject(value);
      return {
        id: name,
        role: anchor.anchor_role || anchor.action_role || anchor.domain_role || anchor.role || "unknown",
        stability: anchor.stability,
        validWhen: anchor.valid_when,
        confidence: anchor.confidence,
      };
    })
    .slice(0, 12);
  const entryStates = normalizeArray(source?.entry_states).map((item) => {
    const state = asObject(item);
    return {
      name: state.name || state.id || "entry_state",
      confidence: state.confidence,
      note: state.note || state.description,
    };
  }).slice(0, 8);
  const entryCheck = asObject(source?.entry_state_checks?.after_app_open || source?.entry_state_check || source?.app_state_check);

  return {
    package: app.package || source?.app_package || source?.package,
    activity: app.activity,
    intentName: source?.intent?.name || source?.name,
    intentDescription: source?.intent?.description || source?.task_summary || source?.summary || source?.description,
    entryStates,
    entryCheck,
    anchorRoles,
    verification: normalizeArray(source?.verification).map(String).slice(0, 8),
    applicabilityModes: normalizeArray(source?.applicability?.decision_modes).map(String),
    sourceTraceCount: normalizeArray(source?.source_traces).length || (source?.source_trace_id ? 1 : 0),
  };
}

function buildKnowledgeShortcuts(generatedJson: any | null, candidateJson: any | null): string[] {
  const source = generatedJson || candidateJson;
  if (!source) return [];
  const items: string[] = [];
  const app = source?.app || {};
  if (app.package) items.push(`Open target app by package ${app.package}${app.activity ? ` / activity ${app.activity}` : ""}.`);
  const entryCheck = asObject(source?.entry_state_checks?.after_app_open || source?.entry_state_check || source?.app_state_check);
  const entryTexts = [
    ...normalizeArray(entryCheck.ui_text_any || entryCheck.text_any || entryCheck.visible_text_any),
    ...normalizeArray(entryCheck.ui_text_all || entryCheck.text_all || entryCheck.visible_text_all),
  ].map(String);
  if (entryTexts.length) items.push(`Entry state can be checked with visible text: ${entryTexts.slice(0, 5).join(", ")}.`);
  for (const state of normalizeArray(source?.entry_states).slice(0, 4)) {
    const item = asObject(state);
    if (item.name) items.push(`Known entry state ${item.name}${item.note ? `: ${item.note}` : ""}.`);
  }
  const anchorItems = Object.entries(asObject(source?.anchors))
    .map(([name, value]) => {
      const anchor = asObject(value);
      const role = anchor.domain_role || anchor.anchor_role || anchor.action_role || "";
      if (!role) return "";
      const stability = anchor.stability ? `, stability=${anchor.stability}` : "";
      return `Anchor ${name} acts as ${role}${stability}.`;
    })
    .filter(Boolean)
    .slice(0, 8);
  items.push(...anchorItems);
  for (const rule of normalizeArray(source?.applicability?.rules).slice(0, 4)) {
    const item = asObject(rule);
    if (item.if && item.then) items.push(`Applicability rule: if ${item.if}, then ${item.then}.`);
  }
  const notCovered = Object.keys(asObject(source?.intent?.not_covered_parameters));
  if (notCovered.length) items.push(`Do not assume unsupported parameters without grounding: ${notCovered.join(", ")}.`);
  for (const verification of normalizeArray(source?.verification).slice(0, 4)) {
    items.push(`Verify success with: ${String(verification)}.`);
  }
  const preferredOrder = normalizeArray(source?.validation_policy?.preferred_order).map(String).slice(0, 5);
  if (preferredOrder.length) items.push(`Preferred observation order: ${preferredOrder.join(" -> ")}.`);
  for (const context of normalizeArray(source?.evolution?.verified_contexts).slice(-3)) {
    const item = asObject(context);
    const appName = asObject(item.final_state).package || asObject(item.final_state).current_package || "";
    items.push(`Verified context${appName ? ` in ${appName}` : ""}: ${item.last_summary || "prior successful run"}.`);
  }
  for (const pattern of normalizeArray(source?.evolution?.failure_patterns).slice(-3)) {
    const item = asObject(pattern);
    items.push(`Known failure pattern: step=${item.failed_step || "unknown"}, anchor=${item.failed_anchor || "unknown"}${item.repair_hint ? `, hint=${item.repair_hint}` : ""}.`);
  }
  return unique(items);
}

function buildExecutionRoutes(
  fastPaths: CompanionSkillFastPath[],
  generatedJson: any | null,
  candidateJson: any | null,
  generated: boolean,
  feedback: FeedbackSummary,
): CompanionSkillExecutionRoute[] {
  const routes: CompanionSkillExecutionRoute[] = [{
    id: "agent-with-skill-context",
    title: "Run with skill context",
    description: generated
      ? "Use this skill's app model, applicability rules, anchors, verification hints, and prior experience during a normal agent run."
      : "Use this workspace skill as compact guidance during a normal agent run.",
    mode: "agent_with_skill_context",
    source: generated ? "generated" : "manual",
    status: feedback.failureCount > 0 || feedback.successCount > 0 ? "tested" : generated ? "draft" : "trusted",
    risk: generated ? "medium" : "low",
    primary: true,
    canRun: true,
    inputSummary: inputSummary(generatedJson, candidateJson),
  }];

  for (const fastPath of fastPaths) {
    routes.push({
      id: `fast-path:${fastPath.id}`,
      title: fastPath.title,
      description: fastPath.canRun
        ? "Optional deterministic route for stable app states and matching inputs."
        : "Reference route captured from traces; useful as procedural evidence but not directly runnable.",
      mode: "fast_path",
      source: fastPath.source,
      status: fastPath.status,
      risk: fastPath.risk,
      primary: false,
      canRun: fastPath.canRun,
      inputSummary: fastPath.inputSummary,
    });
  }

  const nonUiRoutes = normalizeArray(generatedJson?.non_ui_routes || generatedJson?.capability_shortcuts || candidateJson?.non_ui_routes);
  for (const [index, value] of nonUiRoutes.entries()) {
    const item = asObject(value);
    routes.push({
      id: String(item.id || item.name || `non-ui-shortcut-${index + 1}`),
      title: toTitle(String(item.title || item.name || `Non-UI shortcut ${index + 1}`)),
      description: String(item.description || item.summary || "Use a non-UI route when it is safer or cheaper than UI control."),
      mode: "non_ui_shortcut",
      source: toFastPathSource(item.source || "generated"),
      status: toSkillStatus(item.status || "draft"),
      risk: toRisk(item.risk || "low"),
      primary: false,
      canRun: item.canRun === true,
      inputSummary: inputSummary(item, candidateJson),
    });
  }

  const boundary = asObject(generatedJson?.automation_boundary || candidateJson?.automation_boundary);
  if (boundary.required === true || String(boundary.type || "").includes("handoff")) {
    routes.push({
      id: "manual-handoff",
      title: "Manual handoff",
      description: String(boundary.reason || boundary.description || "Prepare the app state, then stop for user-controlled input."),
      mode: "manual_handoff",
      source: "generated",
      status: "draft",
      risk: "medium",
      primary: false,
      canRun: true,
      inputSummary: [],
    });
  }

  return routes;
}

function buildFastPaths(id: string, generatedJson: any | null, candidateJson: any | null, feedback: FeedbackSummary, generated: boolean): CompanionSkillFastPath[] {
  const paths: CompanionSkillFastPath[] = [];
  const singleFastPath = generatedJson?.fast_path || generatedJson?.fastPath;
  if (singleFastPath && typeof singleFastPath === "object" && !Array.isArray(singleFastPath)) {
    paths.push(fastPathFromJson({
      id: singleFastPath.id || "default-fast-path",
      title: singleFastPath.title || "Recorded fast path",
      description: singleFastPath.description || singleFastPath.use_when || "Replay the generated procedure when parameters and entry state match.",
      source: singleFastPath.source || "generated",
      ...singleFastPath,
    }, 0, feedback, generatedJson, candidateJson));
  }

  const rawFastPaths = normalizeArray(generatedJson?.fast_paths || generatedJson?.fastPaths);
  const knownIds = new Set(paths.map((item) => item.id));
  for (const [index, item] of rawFastPaths.entries()) {
    const id = String(item?.id || item?.name || `fast_path_${index + 1}`);
    if (knownIds.has(id)) continue;
    paths.push(fastPathFromJson(item, index, feedback, generatedJson, candidateJson, false));
    knownIds.add(id);
  }
  if (paths.length) return paths;

  const hasReplayPlan = !!(
    generatedJson?.execution?.steps ||
    generatedJson?.procedure?.steps ||
    generatedJson?.steps ||
    candidateJson?.steps
  );
  if (generated && hasReplayPlan) {
    return [{
      id: "default-fast-path",
      title: "Recorded fast path",
      description: "Reference procedure from generated artifacts. It is not directly runnable until a root-level fast_path is available.",
      source: "generated",
      status: feedback.failureCount > 0 ? "tested" : "draft",
      risk: "medium",
      inputSummary: inputSummary(generatedJson, candidateJson),
      successCount: feedback.successCount,
      failureCount: feedback.failureCount,
      lastRunAt: feedback.lastRunAt,
      canRun: false,
    }];
  }

  return [];
}

function fastPathFromJson(
  item: any,
  index: number,
  feedback: FeedbackSummary,
  inputSource?: any | null,
  candidateJson?: any | null,
  canRunOverride?: boolean,
): CompanionSkillFastPath {
  return {
    id: String(item?.id || item?.name || `fast_path_${index + 1}`),
    title: toTitle(String(item?.title || item?.name || `Fast path ${index + 1}`)),
    description: String(item?.description || item?.summary || "Reusable execution route from this skill."),
    source: toFastPathSource(item?.source),
    status: toSkillStatus(item?.status || (feedback.failureCount > 0 ? "tested" : "draft")),
    risk: toRisk(item?.risk || "medium"),
    inputSummary: inputSummary(inputSource || item, candidateJson || null),
    successCount: Number(item?.successCount || item?.success_count || feedback.successCount || 0),
    failureCount: Number(item?.failureCount || item?.failure_count || feedback.failureCount || 0),
    lastRunAt: Number(item?.lastRunAt || item?.last_run_at || feedback.lastRunAt || 0) || undefined,
    canRun: canRunOverride ?? (item?.canRun !== false && item?.eligible === true),
  };
}

function buildHistory(feedback: FeedbackSummary, generated: boolean, stat: fs.Stats): CompanionSkillHistoryItem[] {
  const history = [...feedback.history];
  history.push({
    id: "skill-created",
    title: generated ? "Generated skill installed" : "Workspace skill installed",
    kind: generated ? "demo" : "update",
    status: "unknown",
    timestamp: Math.round(stat.birthtimeMs || stat.mtimeMs),
    summary: generated
      ? "This skill was created from demonstration or generated artifacts."
      : "This skill is available in the OpenClaw workspace.",
  });
  return history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 12);
}

function buildInputs(generatedJson: any | null, candidateJson: any | null): any[] {
  const parameters = generatedJson?.intent?.parameters || generatedJson?.parameters || candidateJson?.intent?.parameters || {};
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return [];

  return Object.entries(parameters).map(([id, value]: [string, any]) => ({
    id,
    label: toTitle(id.replace(/_/g, " ")),
    type: value?.type === "boolean" ? "checkbox" : "text",
    required: value?.required === true,
    placeholder: value?.description || value?.summary,
    description: value?.description,
  }));
}

function markdownSections(markdown: string) {
  const body = stripFrontmatter(markdown);
  const lines = body.split(/\r?\n/);
  const sections: { title: string; body: string }[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const match = line.match(/^##+\s+(.+?)\s*$/);
    if (match) {
      if (current) sections.push({ title: current.title, body: current.lines.join("\n").trim() });
      current = { title: match[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ title: current.title, body: current.lines.join("\n").trim() });
  return sections;
}

function extractBulletsFromSections(markdown: string, titlePatterns: RegExp[]): string[] {
  return markdownSections(markdown)
    .filter((section) => titlePatterns.some((pattern) => pattern.test(section.title)))
    .flatMap((section) => extractKnowledgeItems(section.body))
    .filter((item) => !/^do not\b/i.test(item));
}

function extractDoNotLines(markdown: string): string[] {
  return stripFrontmatter(markdown)
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter((line) => /^do not\b/i.test(line))
    .slice(0, 8);
}

function extractKnowledgeItems(text: string): string[] {
  const items: string[] = [];
  let pendingBullet = "";
  const flushBullet = () => {
    if (pendingBullet) {
      items.push(cleanText(pendingBullet));
      pendingBullet = "";
    }
  };
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    const bullet = raw.match(/^[-*]\s+(.+)/)?.[1];
    const clean = cleanText(line);
    if (!clean || clean.startsWith("| ---") || clean === "|") continue;
    if (bullet) {
      flushBullet();
      pendingBullet = cleanText(bullet);
      continue;
    }
    if (pendingBullet && /^do not\b/i.test(clean)) {
      flushBullet();
      items.push(clean);
      continue;
    }
    if (pendingBullet && !clean.startsWith("|") && !/^\d+\./.test(clean) && !/^#+/.test(line.trim())) {
      pendingBullet = `${pendingBullet} ${clean}`;
      continue;
    }
    flushBullet();
    if (clean.startsWith("|") && clean.endsWith("|")) {
      const cells = clean.split("|").map((cell) => cleanText(cell)).filter(Boolean);
      if (cells.length >= 2 && !cells.some((cell) => /^-+$/.test(cell))) {
        items.push(cells.join(": "));
      }
      continue;
    }
    if (/^(use|prefer|if|when|do not|avoid|call)\b/i.test(clean)) items.push(clean);
  }
  flushBullet();
  return unique(items).slice(0, 20);
}

function firstUseSentence(markdown: string): string {
  return stripFrontmatter(markdown)
    .split(/\n\s*\n/)
    .map((paragraph) => cleanText(paragraph.replace(/\r?\n/g, " ")))
    .find((paragraph) => /^use this skill/i.test(paragraph)) || "";
}

function firstPlainLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .find((line) => line && !line.startsWith("|") && !line.startsWith("```") && !line.startsWith("- ")) || "";
}

function generatedKnowledgeItems(generatedJson: any | null, candidateJson: any | null): string[] {
  const source = generatedJson || candidateJson;
  if (!source) return [];
  const items: string[] = [];
  const appPackage = source?.app?.package || source?.app_package || source?.package;
  const intentName = source?.intent?.name || source?.name;
  const taskSummary = source?.task_summary || source?.summary || source?.description;
  if (appPackage) items.push(`App package: ${appPackage}`);
  if (intentName) items.push(`Intent: ${intentName}`);
  if (taskSummary) items.push(String(taskSummary));
  for (const warning of normalizeArray(source?.warnings || source?.open_uncertainties || source?.uncertainties)) {
    items.push(`Uncertainty: ${String(warning)}`);
  }
  return unique(items);
}

function inputSummary(generatedJson: any | null, candidateJson: any | null): string[] {
  const parameters = generatedJson?.intent?.parameters || generatedJson?.parameters || candidateJson?.intent?.parameters || {};
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return [];
  return Object.entries(parameters).map(([id, value]: [string, any]) => {
    const required = value?.required === true ? "required" : "optional";
    return `${id} (${required})`;
  });
}

function inferStatus(generated: boolean, feedback: FeedbackSummary, fastPaths: CompanionSkillFastPath[]): "draft" | "tested" | "trusted" | "broken" {
  if (feedback.failureCount > 0 && feedback.successCount === 0) return "tested";
  if (feedback.successCount > 0) return "tested";
  if (generated || fastPaths.length) return "draft";
  return "trusted";
}

function inferRisk(id: string, description: string, generated: boolean): "low" | "medium" | "high" {
  const text = `${id} ${description}`.toLowerCase();
  if (text.includes("payment") || text.includes("purchase") || text.includes("delete")) return "high";
  if (generated || text.includes("policy") || text.includes("record") || text.includes("promote")) return "medium";
  return "low";
}

function inferScope(id: string, description: string, generatedJson: any | null, candidateJson: any | null): CompanionSkillSummary["scope"] {
  const text = `${id} ${description}`.toLowerCase();
  if (generatedJson?.app || candidateJson?.app) return "app";
  if (text.includes("policy")) return "system";
  if (text.includes("capabilit") || text.includes("tool")) return "tool";
  if (text.includes("trace") || text.includes("demo") || text.includes("workflow")) return "scenario";
  return "unknown";
}

function inferTags(id: string, description: string, generated: boolean, scope: string, fastPathCount: number): string[] {
  const tags = new Set<string>();
  if (generated) tags.add("Generated");
  if (fastPathCount > 0) tags.add("Fast paths");
  if (scope !== "unknown") tags.add(toTitle(scope));
  if (id.includes("trace") || description.toLowerCase().includes("demonstration")) tags.add("Demo-to-skill");
  if (id.includes("policy")) tags.add("Policy");
  if (id.includes("capabilit")) tags.add("Capabilities");
  if (!tags.size) tags.add("Workspace");
  return Array.from(tags);
}

function inferOutputs(id: string, generated: boolean, fastPathCount: number): string[] {
  if (generated) return ["Reusable skill knowledge", "Fast path metadata", "Execution feedback"];
  if (fastPathCount > 0) return ["Fast path choices", "Reference guidance"];
  if (id.includes("trace")) return ["Skill candidate", "Generalized skill draft", "Evidence summary"];
  if (id.includes("capabilit")) return ["Capability map", "Recommended tool path"];
  if (id.includes("policy")) return ["Verification guidance", "Recovery policy", "Risk boundary"];
  return ["Skill guidance"];
}

function inferCapabilities(id: string, description: string): string[] {
  const text = `${id} ${description}`.toLowerCase();
  const capabilities = new Set<string>();
  if (text.includes("adb") || text.includes("ui")) capabilities.add("Android UI tools");
  if (text.includes("trace") || text.includes("record")) capabilities.add("Trace recording");
  if (text.includes("skill")) capabilities.add("OpenClaw skills");
  if (!capabilities.size) capabilities.add("OpenClaw workspace");
  return Array.from(capabilities);
}

function inferConfirmationPolicy(risk: string, generated: boolean, fastPathCount: number): string {
  if (generated) return fastPathCount > 0
    ? "Use generated app knowledge as the default route; preview parameters and app state before any direct fast-path run."
    : "Use generated app knowledge as context for normal grounded execution.";
  if (risk === "low") return "This skill provides guidance and does not perform side effects by itself.";
  return "Require confirmation before high-risk or external side effects.";
}

function inferPrivacyUsage(id: string, generated: boolean): string[] {
  if (generated) return ["Trace evidence", "Screenshots", "UI state", "Execution feedback"];
  if (id.includes("trace")) return ["Touch trace", "Screenshots", "UI state"];
  if (id.includes("policy")) return ["Runtime state", "Failure evidence when needed"];
  if (id.includes("capabilit")) return ["Runtime health", "Capability flags"];
  return ["Workspace files"];
}

function summarizeAppModelForPrompt(appModel: any): string {
  const model = asObject(appModel);
  if (!Object.keys(model).length) return "- none";
  const lines: string[] = [];
  if (model.package || model.activity) {
    lines.push(`- App: ${model.package || "unknown"}${model.activity ? ` / ${model.activity}` : ""}`);
  }
  if (model.intentName || model.intentDescription) {
    lines.push(`- Intent family: ${model.intentName || "unknown"}${model.intentDescription ? ` - ${model.intentDescription}` : ""}`);
  }
  for (const state of normalizeArray(model.entryStates).slice(0, 4)) {
    const item = asObject(state);
    lines.push(`- Entry state: ${item.name || "entry_state"}${item.note ? ` - ${item.note}` : ""}`);
  }
  for (const anchor of normalizeArray(model.anchorRoles).slice(0, 6)) {
    const item = asObject(anchor);
    lines.push(`- Anchor: ${item.id || "unknown"} as ${item.role || "unknown"}${item.stability ? ` (${item.stability})` : ""}`);
  }
  for (const verifier of normalizeArray(model.verification).slice(0, 3)) {
    lines.push(`- Verification: ${verifier}`);
  }
  return lines.length ? lines.join("\n") : "- none";
}

function toTitle(name: string): string {
  if (name.startsWith("clawmobile-")) {
    return name
      .replace(/^clawmobile-/, "ClawMobile ")
      .split(/[-_\s]+/)
      .map(titleWord)
      .join(" ");
  }
  return name
    .split(/[-_\s]+/)
    .map(titleWord)
    .join(" ");
}

function titleWord(part: string): string {
  return part ? part[0].toUpperCase() + part.slice(1) : part;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
}

function cleanText(value: string): string {
  return value
    .replace(/^#+\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_./:-]+/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];
  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .filter((token) => !STOP_WORDS.has(token));
  return unique(tokens).slice(0, 30);
}

function phraseMatchScore(query: string, values: any[]): number {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;
  let score = 0;
  for (const value of values) {
    const text = normalizeSearchText(String(value || ""));
    if (!text || text.length < 4) continue;
    if (normalizedQuery.includes(text) || text.includes(normalizedQuery)) {
      score += 4;
      continue;
    }
    const textTokens = tokenize(text);
    const queryTokens = tokenize(normalizedQuery);
    const overlap = textTokens.filter((token) => queryTokens.includes(token)).length;
    if (overlap >= 2) score += Math.min(overlap, 4);
  }
  return Math.min(score, 8);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function asObject(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeArray(value: any): any[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toFastPathSource(value: any): CompanionSkillFastPath["source"] {
  const text = String(value || "").toLowerCase();
  if (text === "demo") return "demo";
  if (text === "successful_run" || text === "success") return "successful_run";
  if (text === "manual") return "manual";
  if (text === "generated") return "generated";
  return "unknown";
}

function toSkillStatus(value: any): CompanionSkillFastPath["status"] {
  const text = String(value || "").toLowerCase();
  if (text === "tested") return "tested";
  if (text === "trusted") return "trusted";
  if (text === "broken") return "broken";
  return "draft";
}

function toRisk(value: any): CompanionSkillFastPath["risk"] {
  const text = String(value || "").toLowerCase();
  if (text === "high") return "high";
  if (text === "medium") return "medium";
  return "low";
}

function isUserTaskSkill(skill: CompanionSkillDetail): boolean {
  if (skill.status === "broken") return false;
  if (skill.id === "clawmobile-policy" || skill.id === "clawmobile-capabilities" || skill.id === "clawmobile-trace-induction") {
    return false;
  }
  if (skill.scope === "system" || skill.scope === "tool") return false;
  return true;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "use",
  "using",
  "open",
  "create",
  "make",
  "run",
  "task",
  "please",
  "帮我",
  "一个",
  "一下",
]);
