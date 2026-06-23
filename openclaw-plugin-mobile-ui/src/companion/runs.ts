import fs from "fs/promises";
import os from "os";
import path from "path";
import { intentCanvas } from "./canvas";
import { callOpenClawGateway, expectedCompanionSessionKey, normalizeCompanionSessionId, type OpenClawAgentSubmitResult } from "./openclawAgentClient";
import type { CompanionRunProgress, CompanionRunProgressEvent, CompanionRunStatus, CompanionRunTokenUsage, IntentAttachment } from "./types";

type StoredRun = {
  runId: string;
  sessionId: string;
  sessionKey?: string;
  text: string;
  userText?: string;
  attachments?: IntentAttachment[];
  acceptedAt: number;
  updatedAt?: number;
  state?: CompanionRunStatus["state"];
  error?: string;
};

type CompanionRunRegistry = {
  runs: StoredRun[];
  archivedSessionIds: string[];
};

type TrajectorySummary = {
  runId?: string;
  prompt?: string;
  result?: string;
  state?: CompanionRunStatus["state"];
  startedAt?: number;
  updatedAt?: number;
  endedAt?: number;
  progress?: CompanionRunProgress;
  tokenUsage?: CompanionRunTokenUsage;
};

type TranscriptSummary = {
  prompt: string;
  result: string;
  startedAt?: number;
  endedAt?: number;
  progressEvents: CompanionRunProgressEvent[];
  tokenUsage?: CompanionRunTokenUsage;
};

const submittedRuns = new Map<string, StoredRun>();

export async function rememberSubmittedRun(
  text: string,
  result: OpenClawAgentSubmitResult,
  options: { userText?: string; attachments?: IntentAttachment[] } = {},
) {
  const existing = submittedRuns.get(result.runId)
    || (await findStoredRun(result.runId).catch(() => null));
  const stored = {
    ...existing,
    runId: result.runId,
    sessionId: result.sessionId,
    sessionKey: normalizedStoredSessionKey(result.sessionId, result.sessionKey),
    text,
    userText: options.userText || existing?.userText,
    attachments: options.attachments && options.attachments.length > 0 ? options.attachments : existing?.attachments,
    acceptedAt: existing?.acceptedAt || result.acceptedAt || Date.now(),
    updatedAt: Date.now(),
    state: "running" as const,
    error: undefined,
  };
  submittedRuns.set(result.runId, stored);
  await saveStoredRun(stored).catch(() => undefined);
}

export async function markSubmittedRunFailed(runId: string, message: string) {
  const existing = submittedRuns.get(runId)
    || (await findStoredRun(runId).catch(() => null));
  if (!existing) return;

  const stored: StoredRun = {
    ...existing,
    state: "failed",
    error: message,
    updatedAt: Date.now(),
  };
  submittedRuns.set(runId, stored);
  await saveStoredRun(stored).catch(() => undefined);
}

export async function archiveSession(sessionId: string) {
  const normalizedSessionId = normalizeCompanionSessionId(sessionId || "");
  if (!normalizedSessionId) {
    return {
      success: false,
      message: "Session id is required.",
      sessionId: normalizedSessionId,
    };
  }

  const registry = await readCompanionRunRegistry().catch(() => defaultCompanionRunRegistry());
  const archivedSessionIds = Array.from(new Set([
    ...registry.archivedSessionIds,
    normalizedSessionId,
  ]));
  await writeCompanionRunRegistry(registry.runs, archivedSessionIds);

  return {
    success: true,
    message: "Session archived.",
    sessionId: normalizedSessionId,
  };
}

export async function deleteSession(sessionId: string) {
  const normalizedSessionId = normalizeCompanionSessionId(sessionId || "");
  if (!normalizedSessionId) {
    return {
      success: false,
      message: "Session id is required.",
      sessionId: normalizedSessionId,
    };
  }

  const registry = await readCompanionRunRegistry().catch(() => defaultCompanionRunRegistry());
  const nextRuns = registry.runs.filter((run) => normalizeCompanionSessionId(run.sessionId || "default") !== normalizedSessionId);
  const archivedSessionIds = Array.from(new Set([
    ...registry.archivedSessionIds.filter((id) => id !== normalizedSessionId),
    normalizedSessionId,
  ]));
  let removedRuns = 0;
  for (const [runId, run] of submittedRuns.entries()) {
    if (normalizeCompanionSessionId(run.sessionId || "default") === normalizedSessionId) {
      submittedRuns.delete(runId);
      removedRuns += 1;
    }
  }
  removedRuns += registry.runs.length - nextRuns.length;
  await writeCompanionRunRegistry(nextRuns, archivedSessionIds);

  return {
    success: true,
    message: "Session deleted from companion history.",
    sessionId: normalizedSessionId,
    removedRuns,
  };
}

export async function listRuns(options: { limit?: number } = {}): Promise<CompanionRunStatus[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 100));
  const storedRuns = await readStoredRuns();
  const sessions = await readSessionsIndex();
  const archivedSessionIds = await readArchivedSessionIds();
  if (storedRuns.length > 0) {
    return Promise.all(
      storedRuns.slice(0, limit).map(async (stored) => {
        const session = findSessionForStoredRun(sessions, stored);
        const fallback = session
          ? statusFromSessionInfo(session, stored.runId, stored)
          : statusFromStoredRun(stored);
        return enrichFromSessionFile(fallback, session, stored);
      }),
    );
  }

  return Promise.all(
    sessions
      .filter((session: any) => isCompanionSession(session))
      .filter((session: any) => !archivedSessionIds.has(companionSessionIdFromSession(session)))
      .slice(0, limit)
      .map(async (session: any) => {
      const fallback = statusFromSessionInfo(session);
      return enrichFromSessionFile(fallback, session);
    }),
  );
}

export async function getRunStatus(runId: string): Promise<CompanionRunStatus> {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId) {
    return unknownRun("", "Run id is required.");
  }

  const stored = submittedRuns.get(normalizedRunId)
    || (await findStoredRun(normalizedRunId).catch(() => null));
  const listed = await findSessionInfo(normalizedRunId, stored).catch(() => null);
  if (listed) {
    const fallback = statusFromSessionInfo(listed, normalizedRunId, stored || undefined);
    return enrichFromSessionFile(fallback, listed, stored);
  }
  if (stored) {
    return statusFromStoredRun(stored);
  }

  try {
    const sessionKey = stored?.sessionKey || expectedCompanionSessionKey(stored?.sessionId || "default");
    const history = await callOpenClawGateway("chat.history", { sessionKey });
    return statusFromHistory(normalizedRunId, sessionKey, history, stored);
  } catch (error: any) {
    return unknownRun(normalizedRunId, error?.message || "Run was not found.");
  }
}

function statusFromHistory(runId: string, sessionKey: string, history: any, stored?: StoredRun): CompanionRunStatus {
  const sessionInfo = history?.sessionInfo || {};
  const state = normalizeState(sessionInfo.status, sessionInfo.hasActiveRun, sessionInfo);
  const result = latestAssistantText(history?.messages);
  const prompt = stored?.text || latestUserText(history?.messages) || "";
  const userText = stored?.userText || latestUserText(history?.messages) || prompt;
  const message = result || messageForState(state);

  return {
    success: state !== "failed" && state !== "unknown",
    runId,
    sessionId: stored?.sessionId,
    sessionKey: includeTechnicalIds() ? sessionKey : undefined,
    state,
    status: typeof sessionInfo.status === "string" ? sessionInfo.status : undefined,
    message,
    result,
    prompt,
    userText,
    attachments: stored?.attachments,
    submittedAt: stored?.acceptedAt,
    startedAt: numberOrUndefined(sessionInfo.startedAt),
    updatedAt: numberOrUndefined(sessionInfo.updatedAt),
    endedAt: numberOrUndefined(sessionInfo.endedAt),
    runtimeMs: numberOrUndefined(sessionInfo.runtimeMs),
    canvas: intentCanvas(prompt, message),
    raw: includeRaw() ? {
      sessionInfo,
    } : undefined,
  };
}

async function enrichFromSessionFile(
  status: CompanionRunStatus,
  sessionInfo: any,
  stored?: StoredRun,
): Promise<CompanionRunStatus> {
  const sessionId = String(sessionInfo?.sessionId || "");
  if (!sessionId) return status;

  const [transcript, trajectory] = await Promise.all([
    readSessionTranscript(sessionId, stored?.text).catch(() => null),
    readSessionTrajectory(sessionId, status.runId, stored?.text).catch(() => null),
  ]);
  if (!transcript && !trajectory) return status;

  const prompt = stored?.text || transcript?.prompt || trajectory?.prompt || status.prompt || "";
  const userText = stored?.userText || status.userText;
  const result = transcript?.result || trajectory?.result || status.result;
  const progress = mergeProgress(status.progress, transcript?.progressEvents || [], trajectory?.progress);
  const state = resolveState(status.state, result, trajectory?.state, progress);
  const message = result || progress?.text || status.message;
  const startedAt = transcript?.startedAt || trajectory?.startedAt || status.startedAt;
  const endedAt = transcript?.endedAt || trajectory?.endedAt || status.endedAt;
  const tokenUsage = mergeTokenUsage(status.tokenUsage, transcript?.tokenUsage, trajectory?.tokenUsage);

  return {
    ...status,
    success: state !== "failed" && state !== "unknown",
    state,
    message,
    result,
    progress,
    prompt,
    userText,
    attachments: stored?.attachments || status.attachments,
    submittedAt: stored?.acceptedAt || status.submittedAt,
    startedAt,
    updatedAt: trajectory?.updatedAt || status.updatedAt,
    endedAt,
    runtimeMs: startedAt && endedAt ? endedAt - startedAt : status.runtimeMs,
    tokenUsage,
    canvas: prompt || result ? intentCanvas(prompt, message) : status.canvas,
  };
}

function statusFromSessionInfo(sessionInfo: any, preferredRunId?: string, stored?: StoredRun): CompanionRunStatus {
  const sessionKey = String(sessionInfo?.key || "");
  const runId = preferredRunId || runIdFromSessionKey(sessionKey) || sessionKey;
  const sessionId = stored?.sessionId || sessionIdFromSessionKey(sessionKey);
  const storedStatus = stored ? statusFromStoredRun(stored) : undefined;
  const sessionState = normalizeState(sessionInfo?.status, sessionInfo?.hasActiveRun, sessionInfo);
  const state = storedStatus?.state || sessionState;
  const message = messageForState(state);

  return {
    success: state !== "failed" && state !== "unknown",
    runId,
    sessionId,
    sessionKey: includeTechnicalIds() ? sessionKey : undefined,
    state,
    status: typeof sessionInfo?.status === "string" ? sessionInfo.status : undefined,
    message,
    progress: state === "running" ? storedStatus?.progress : undefined,
    prompt: stored?.text,
    userText: stored?.userText,
    attachments: stored?.attachments,
    submittedAt: stored?.acceptedAt,
    startedAt: numberOrUndefined(sessionInfo?.startedAt),
    updatedAt: numberOrUndefined(sessionInfo?.updatedAt),
    endedAt: numberOrUndefined(sessionInfo?.endedAt),
    runtimeMs: numberOrUndefined(sessionInfo?.runtimeMs),
    raw: includeRaw() ? {
      sessionInfo,
    } : undefined,
  };
}

function statusFromStoredRun(stored: StoredRun): CompanionRunStatus {
  const failed = stored.state === "failed";
  const message = failed
    ? stored.error || "OpenClaw did not accept this run."
    : "OpenClaw is still working on this run.";
  return {
    success: !failed,
    runId: stored.runId,
    sessionId: stored.sessionId,
    state: failed ? "failed" : "running",
    message,
    progress: {
      text: failed ? "OpenClaw submit failed." : "Working...",
      detail: failed ? message : undefined,
      updatedAt: stored.updatedAt || stored.acceptedAt,
      events: [
        {
          type: failed ? "companion.failed" : "companion.accepted",
          label: failed ? "OpenClaw submit failed." : "Working...",
          detail: failed ? message : undefined,
          at: stored.acceptedAt,
        },
      ],
    },
    prompt: stored.text,
    userText: stored.userText,
    attachments: stored.attachments,
    submittedAt: stored.acceptedAt,
    updatedAt: stored.updatedAt,
  };
}

async function findSessionInfo(runId: string, stored?: StoredRun | null): Promise<any | null> {
  const sessions = await readSessionsIndex();
  if (stored) {
    return findSessionForStoredRun(sessions, stored);
  }
  return sessions.find((session: any) => runIdFromSessionKey(String(session?.key || "")) === runId) || null;
}

function findSessionForStoredRun(sessions: any[], stored: StoredRun): any | null {
  const expected = stored.sessionKey || expectedCompanionSessionKey(stored.sessionId);
  return sessions.find((session: any) => session?.key === expected) || null;
}

function normalizedStoredSessionKey(sessionId: string, sessionKey?: string) {
  const value = String(sessionKey || "").trim();
  if (!value) return expectedCompanionSessionKey(sessionId);
  if (value.startsWith("agent:")) return value;
  return `agent:${agentId()}:${value}`;
}

async function readSessionsIndex(): Promise<any[]> {
  const filePath = path.join(openClawStateDir(), "agents", agentId(), "sessions", "sessions.json");
  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw);
  if (Array.isArray(data?.sessions)) return data.sessions;
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];

  return Object.entries(data)
      .map(([key, value]: [string, any]) => ({ key, ...(value || {}) }))
    .sort((left: any, right: any) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
}

async function readSessionTranscript(
  sessionId: string,
  targetPrompt?: string,
): Promise<TranscriptSummary> {
  const filePath = path.join(openClawStateDir(), "agents", agentId(), "sessions", `${sessionId}.jsonl`);
  const raw = await fs.readFile(filePath, "utf8");
  let prompt = "";
  let result = "";
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  const progressEvents: CompanionRunProgressEvent[] = [];
  let tokenUsage: CompanionRunTokenUsage | undefined;
  let isTargetTurn = !targetPrompt;
  let candidatePrompt = "";
  let candidateResult = "";
  let candidateStartedAt: number | undefined;
  let candidateEndedAt: number | undefined;
  let candidateProgressEvents: CompanionRunProgressEvent[] = [];
  let candidateTokenUsage: CompanionRunTokenUsage | undefined;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event?.type !== "message") continue;
    const role = event?.message?.role;
    const text = contentText(event?.message?.content);
    const at = messageTimestamp(event, true);
    const turnIsActive = targetPrompt ? isTargetTurn : true;

    if (role === "assistant" && turnIsActive) {
      const toolEvents = toolCallEventsFromMessage(event);
      progressEvents.push(...toolEvents);
      if (targetPrompt) candidateProgressEvents.push(...toolEvents);
      const messageUsage = tokenUsageFromMessage(event);
      if (messageUsage) {
        tokenUsage = accumulateTokenUsage(tokenUsage, messageUsage);
        if (targetPrompt) candidateTokenUsage = accumulateTokenUsage(candidateTokenUsage, messageUsage);
      }
    } else if (role === "toolResult" && turnIsActive) {
      const toolEvent = toolResultEventFromMessage(event);
      if (toolEvent) {
        progressEvents.push(toolEvent);
        if (targetPrompt) candidateProgressEvents.push(toolEvent);
      }
    }

    if (!text) continue;

    if (role === "user") {
      const clean = stripOpenClawTimestamp(text);
      prompt = clean;
      startedAt = messageTimestamp(event);
      if (targetPrompt) {
        if (clean === targetPrompt) {
          isTargetTurn = true;
          candidatePrompt = clean;
          candidateResult = "";
          candidateStartedAt = messageTimestamp(event);
          candidateEndedAt = undefined;
          candidateProgressEvents = [];
          candidateTokenUsage = undefined;
        } else if (isTargetTurn && candidateResult) {
          isTargetTurn = false;
        } else if (isTargetTurn) {
          isTargetTurn = false;
        }
      }
    } else if (role === "assistant") {
      result = text;
      endedAt = at;
      if (isTargetTurn) {
        candidateResult = text;
        candidateEndedAt = at;
      }
    }
  }

  if (targetPrompt) {
    return {
      prompt: candidatePrompt || targetPrompt,
      result: candidateResult,
      startedAt: candidateStartedAt,
      endedAt: candidateEndedAt,
      progressEvents: candidateProgressEvents,
      tokenUsage: candidateTokenUsage,
    };
  }
  return { prompt, result, startedAt, endedAt, progressEvents, tokenUsage };
}

async function readSessionTrajectory(
  sessionId: string,
  runId?: string,
  targetPrompt?: string,
): Promise<TrajectorySummary | null> {
  const filePath = path.join(openClawStateDir(), "agents", agentId(), "sessions", `${sessionId}.trajectory.jsonl`);
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = raw
    .split(/\r?\n/)
    .map((line) => parseJsonLine(line))
    .filter(Boolean);
  if (parsed.length === 0) return null;

  const targetRunId = isOpenClawRunId(runId)
    ? runId
    : runIdForPrompt(parsed, targetPrompt) || latestRunId(parsed);
  const events = targetRunId
    ? parsed.filter((event: any) => event?.runId === targetRunId)
    : parsed;
  if (events.length === 0) return null;

  let prompt = "";
  let result = "";
  let state: CompanionRunStatus["state"] | undefined;
  let startedAt: number | undefined;
  let updatedAt: number | undefined;
  let endedAt: number | undefined;
  const progressEvents: CompanionRunProgressEvent[] = [];
  let tokenUsage: CompanionRunTokenUsage | undefined;

  for (const event of events) {
    const at = trajectoryTimestamp(event);
    if (at) updatedAt = at;

    if (event?.type === "session.started" && at && !startedAt) {
      startedAt = at;
    }

    if (event?.type === "prompt.submitted" && typeof event?.data?.prompt === "string") {
      prompt = stripOpenClawTimestamp(event.data.prompt);
    }

    const assistantText = assistantTextFromTrajectory(event);
    if (assistantText) {
      result = assistantText;
      if (state !== "failed") state = "done";
    }

    if (event?.type === "session.ended") {
      endedAt = at || endedAt;
      state = stateFromSessionEnd(event?.data?.status) || state;
    }

    const progressEvent = progressEventFromTrajectory(event);
    if (progressEvent) progressEvents.push(progressEvent);
    tokenUsage = accumulateTokenUsage(tokenUsage, tokenUsageFromTrajectory(event));
  }

  const latestProgress = progressEvents[progressEvents.length - 1];
  return {
    runId: targetRunId,
    prompt,
    result,
    state,
    startedAt,
    updatedAt,
    endedAt,
    tokenUsage,
    progress: latestProgress
      ? {
        text: latestProgress.label,
        detail: latestProgress.detail,
        updatedAt: latestProgress.at,
        events: progressEvents.slice(-8),
      }
      : undefined,
  };
}

function isCompanionSession(session: any) {
  const key = String(session?.key || "");
  return key.includes(":companion-chat-") || key.includes(":companion-run-") || key.includes(":companion-test-") || session?.label === "ClawMobile Companion";
}

function companionSessionIdFromSession(session: any) {
  const sessionId = sessionIdFromSessionKey(String(session?.key || ""));
  return sessionId ? normalizeCompanionSessionId(sessionId) : "";
}

function normalizeState(status: any, hasActiveRun: any, sessionInfo?: any): CompanionRunStatus["state"] {
  const value = String(status || "").toLowerCase();
  if (hasActiveRun || ["queued", "pending", "processing", "running"].includes(value)) return "running";
  if (["done", "completed", "complete", "success"].includes(value)) return "done";
  if (["failed", "error", "cancelled", "aborted"].includes(value)) return "failed";
  if (!value && sessionInfo?.updatedAt && !sessionInfo?.endedAt) return "running";
  return "unknown";
}

function messageForState(state: CompanionRunStatus["state"]) {
  switch (state) {
    case "running":
      return "OpenClaw is still working on this run.";
    case "done":
      return "OpenClaw finished this run.";
    case "failed":
      return "OpenClaw reported that this run failed.";
    default:
      return "Run status is not available yet.";
  }
}

function latestAssistantText(messages: any): string {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const text = contentText(message.content);
    if (text) return text;
  }
  return "";
}

function latestUserText(messages: any): string {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = contentText(message.content);
    if (text) return text;
  }
  return "";
}

function contentText(content: any): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function mergeProgress(
  fallback: CompanionRunProgress | undefined,
  transcriptEvents: CompanionRunProgressEvent[],
  trajectoryProgress?: CompanionRunProgress,
): CompanionRunProgress | undefined {
  const events = dedupeProgressEvents([
    ...(fallback?.events || []),
    ...transcriptEvents,
    ...(trajectoryProgress?.events || []),
  ]);
  if (events.length === 0) return trajectoryProgress || fallback;

  const latest = events[events.length - 1];
  return {
    text: latest.label,
    detail: latest.detail,
    updatedAt: latest.at || trajectoryProgress?.updatedAt || fallback?.updatedAt,
    events: events.slice(-12),
  };
}

function dedupeProgressEvents(events: CompanionRunProgressEvent[]) {
  const seen = new Set<string>();
  return events
    .filter((event) => event && event.label)
    .sort((left, right) => Number(left.at || 0) - Number(right.at || 0))
    .filter((event) => {
      const key = `${event.type}|${event.label}|${event.detail || ""}|${event.at || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function toolCallEventsFromMessage(event: any): CompanionRunProgressEvent[] {
  const content = event?.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((part: any) => part?.type === "toolCall" && typeof part?.name === "string")
    .map((part: any) => {
      const toolName = String(part.name);
      return {
        type: "tool.call",
        label: `Calling ${toolName}.`,
        detail: toolArgumentsSummary(part),
        at: messageTimestamp(event, true),
      };
    });
}

function toolResultEventFromMessage(event: any): CompanionRunProgressEvent | null {
  const toolName = typeof event?.message?.toolName === "string" ? event.message.toolName : "";
  if (!toolName) return null;
  const failed = event?.message?.isError === true || toolResultLooksFailed(event?.message);
  return {
    type: failed ? "tool.error" : "tool.result",
    label: `${failed ? "Tool failed" : "Completed"} ${toolName}.`,
    detail: toolResultSummary(event?.message),
    at: messageTimestamp(event, true),
  };
}

function toolArgumentsSummary(part: any): string | undefined {
  const args = part?.arguments ?? part?.partialJson;
  if (args == null) return undefined;
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (!trimmed || trimmed === "{}") return undefined;
    return truncateOneLine(trimmed, 120);
  }
  const json = JSON.stringify(args);
  return json && json !== "{}" ? truncateOneLine(json, 120) : undefined;
}

function toolResultLooksFailed(message: any) {
  const parsed = parseToolResultJson(message);
  return parsed?.ok === false || parsed?.isError === true;
}

function toolResultSummary(message: any): string | undefined {
  const parsed = parseToolResultJson(message);
  if (!parsed) return message?.isError ? "error" : "ok";
  if (parsed.ok === false) {
    return truncateOneLine(String(parsed.error || parsed.stderr || "error"), 140);
  }
  if (parsed.data && typeof parsed.data === "object") {
    const data = parsed.data;
    if (typeof data.percentage === "number" || typeof data.level === "number") {
      const level = typeof data.percentage === "number" ? data.percentage : data.level;
      const status = typeof data.status === "string" ? `, ${data.status}` : "";
      return `${level}%${status}`;
    }
  }
  if (typeof parsed.code === "number") return `exit code ${parsed.code}`;
  return "ok";
}

function parseToolResultJson(message: any): any | null {
  const text = contentText(message?.content);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function truncateOneLine(value: string, maxLength: number) {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= maxLength ? oneLine : `${oneLine.slice(0, maxLength - 1)}...`;
}

function resolveState(
  fallback: CompanionRunStatus["state"],
  result: string | undefined,
  trajectoryState?: CompanionRunStatus["state"],
  progress?: CompanionRunProgress,
): CompanionRunStatus["state"] {
  if (fallback === "failed" || trajectoryState === "failed") return "failed";
  if (result) return "done";
  if (trajectoryState) return trajectoryState;
  if (progress && fallback === "unknown") return "running";
  return fallback;
}

function parseJsonLine(line: string): any | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isOpenClawRunId(runId: string | undefined): runId is string {
  return typeof runId === "string" && /^run[_-]/.test(runId);
}

function runIdForPrompt(events: any[], targetPrompt?: string): string | undefined {
  if (!targetPrompt) return undefined;
  for (const event of events) {
    if (event?.type !== "prompt.submitted") continue;
    const prompt = typeof event?.data?.prompt === "string" ? stripOpenClawTimestamp(event.data.prompt) : "";
    if (prompt === targetPrompt && typeof event?.runId === "string") return event.runId;
  }
  return undefined;
}

function latestRunId(events: any[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const runId = events[index]?.runId;
    if (typeof runId === "string" && runId) return runId;
  }
  return undefined;
}

function assistantTextFromTrajectory(event: any): string {
  const assistantTexts = event?.data?.assistantTexts;
  if (!Array.isArray(assistantTexts)) return "";
  for (let index = assistantTexts.length - 1; index >= 0; index -= 1) {
    const text = assistantTexts[index];
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return "";
}

function progressEventFromTrajectory(event: any): CompanionRunProgressEvent | null {
  const at = trajectoryTimestamp(event);
  const type = String(event?.type || "");
  const seq = numberOrUndefined(event?.sourceSeq) || numberOrUndefined(event?.seq);

  switch (type) {
    case "session.started":
      return {
        type,
        label: "Started OpenClaw session.",
        detail: modelDetail(event) || "Runtime accepted the task.",
        at,
        seq,
      };
    case "context.compiled":
      return {
        type,
        label: "Prepared context.",
        detail: "System context and tools are ready.",
        at,
        seq,
      };
    case "prompt.submitted":
      return {
        type,
        label: "Submitted prompt.",
        detail: "Waiting for the model response.",
        at,
        seq,
      };
    case "model.completed":
      return {
        type,
        label: "Model response received.",
        detail: tokenDetail(event),
        at,
        seq,
      };
    case "trace.artifacts":
      return {
        type,
        label: "Saved run artifacts.",
        detail: finalStatusDetail(event),
        at,
        seq,
      };
    case "session.ended":
      return {
        type,
        label: stateFromSessionEnd(event?.data?.status) === "failed" ? "Run ended with an error." : "Run finished.",
        detail: finalStatusDetail(event),
        at,
        seq,
      };
    case "turn.client_closed":
      return {
        type,
        label: "Client connection closed.",
        detail: "OpenClaw may still finish writing the run transcript.",
        at,
        seq,
      };
    default:
      return null;
  }
}

function trajectoryTimestamp(event: any): number | undefined {
  const parsed = Date.parse(String(event?.ts || event?.timestamp || ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stateFromSessionEnd(status: any): CompanionRunStatus["state"] | undefined {
  const value = String(status || "").toLowerCase();
  if (["success", "done", "complete", "completed"].includes(value)) return "done";
  if (["failed", "error", "cancelled", "aborted", "timeout", "timed_out"].includes(value)) return "failed";
  return undefined;
}

function modelDetail(event: any): string | undefined {
  const modelId = typeof event?.modelId === "string" ? event.modelId : "";
  const provider = typeof event?.provider === "string" ? event.provider : "";
  if (modelId && provider) return `${provider} / ${modelId}`;
  return modelId || provider || undefined;
}

function tokenDetail(event: any): string | undefined {
  const usage = event?.data?.usage;
  const output = numberOrUndefined(usage?.output);
  if (output) return `${output} output tokens.`;
  return undefined;
}

function tokenUsageFromTrajectory(event: any): CompanionRunTokenUsage | undefined {
  if (String(event?.type || "") !== "model.completed") return undefined;
  return tokenUsageFromRaw(event?.data?.usage);
}

function tokenUsageFromMessage(event: any): CompanionRunTokenUsage | undefined {
  return tokenUsageFromRaw(event?.message?.usage);
}

function tokenUsageFromRaw(usage: any): CompanionRunTokenUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;

  const inputTokens = firstNumber(
    usage.inputTokens,
    usage.input_tokens,
    usage.promptTokens,
    usage.prompt_tokens,
    usage.input,
  );
  const outputTokens = firstNumber(
    usage.outputTokens,
    usage.output_tokens,
    usage.completionTokens,
    usage.completion_tokens,
    usage.output,
  );
  const cachedTokens = firstNumber(
    usage.cachedTokens,
    usage.cached_tokens,
    usage.cacheRead,
    usage.cache_read,
    usage.input_tokens_details?.cached_tokens,
    usage.prompt_tokens_details?.cached_tokens,
  );
  const reasoningTokens = firstNumber(
    usage.reasoningTokens,
    usage.reasoning_tokens,
    usage.output_tokens_details?.reasoning_tokens,
    usage.completion_tokens_details?.reasoning_tokens,
  );
  const totalTokens = firstNumber(
    usage.totalTokens,
    usage.total_tokens,
    usage.total,
  );
  const fallbackTotalTokens = totalTokens ?? fallbackTotalTokenCount(inputTokens, outputTokens, reasoningTokens);
  const estimatedCostUsd = firstNumber(
    usage.estimatedCostUsd,
    usage.estimated_cost_usd,
    usage.estimatedCost,
    usage.estimated_cost,
    usage.costUsd,
    usage.cost_usd,
    usage.cost?.total,
    usage.cost,
  );
  const estimatedCost = formatEstimatedCost(estimatedCostUsd);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cachedTokens === undefined &&
    reasoningTokens === undefined &&
    fallbackTotalTokens === undefined &&
    estimatedCost === undefined &&
    estimatedCostUsd === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: fallbackTotalTokens,
    cachedTokens,
    reasoningTokens,
    estimatedCost,
    estimatedCostUsd,
  };
}

function accumulateTokenUsage(
  left?: CompanionRunTokenUsage,
  right?: CompanionRunTokenUsage,
): CompanionRunTokenUsage | undefined {
  if (!left) return right;
  if (!right) return left;
  return compactTokenUsage({
    inputTokens: sumDefined(left.inputTokens, right.inputTokens),
    outputTokens: sumDefined(left.outputTokens, right.outputTokens),
    totalTokens: sumDefined(left.totalTokens, right.totalTokens),
    cachedTokens: sumDefined(left.cachedTokens, right.cachedTokens),
    reasoningTokens: sumDefined(left.reasoningTokens, right.reasoningTokens),
    estimatedCostUsd: sumDefined(left.estimatedCostUsd, right.estimatedCostUsd),
    estimatedCost: formatEstimatedCost(sumDefined(left.estimatedCostUsd, right.estimatedCostUsd)) || right.estimatedCost || left.estimatedCost,
  });
}

function mergeTokenUsage(
  ...items: Array<CompanionRunTokenUsage | undefined>
): CompanionRunTokenUsage | undefined {
  const merged = items.reduce<CompanionRunTokenUsage>((current, usage) => {
    if (!usage) return current;
    return {
      inputTokens: usage.inputTokens ?? current.inputTokens,
      outputTokens: usage.outputTokens ?? current.outputTokens,
      totalTokens: usage.totalTokens ?? current.totalTokens,
      cachedTokens: usage.cachedTokens ?? current.cachedTokens,
      reasoningTokens: usage.reasoningTokens ?? current.reasoningTokens,
      estimatedCostUsd: usage.estimatedCostUsd ?? current.estimatedCostUsd,
      estimatedCost: usage.estimatedCost ?? current.estimatedCost,
    };
  }, {});
  return compactTokenUsage(merged);
}

function compactTokenUsage(usage: CompanionRunTokenUsage): CompanionRunTokenUsage | undefined {
  if (
    usage.inputTokens === undefined &&
    usage.outputTokens === undefined &&
    usage.totalTokens === undefined &&
    usage.cachedTokens === undefined &&
    usage.reasoningTokens === undefined &&
    usage.estimatedCost === undefined &&
    usage.estimatedCostUsd === undefined
  ) {
    return undefined;
  }
  return usage;
}

function firstNumber(...values: any[]): number | undefined {
  for (const value of values) {
    const number = numberOrUndefined(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function sumDefined(...values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => value !== undefined);
  if (numbers.length === 0) return undefined;
  return numbers.reduce((sum, value) => sum + value, 0);
}

function fallbackTotalTokenCount(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  reasoningTokens: number | undefined,
): number | undefined {
  if (inputTokens !== undefined || outputTokens !== undefined) {
    return sumDefined(inputTokens, outputTokens ?? reasoningTokens);
  }
  return reasoningTokens;
}

function formatEstimatedCost(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value <= 0) return undefined;
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function finalStatusDetail(event: any): string | undefined {
  const finalStatus = typeof event?.data?.finalStatus === "string" ? event.data.finalStatus : "";
  const status = typeof event?.data?.status === "string" ? event.data.status : "";
  const value = finalStatus || status;
  return value ? `status: ${value}` : undefined;
}

function stripOpenClawTimestamp(text: string) {
  return text.replace(/^\[[^\]]+\]\s*/, "").trim();
}

function messageTimestamp(event: any, preferEventTimestamp = false): number | undefined {
  const parsed = Date.parse(String(event?.timestamp || ""));
  if (preferEventTimestamp && Number.isFinite(parsed)) return parsed;
  const value = event?.message?.timestamp;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function runIdFromSessionKey(sessionKey: string): string {
  const match = sessionKey.match(/:companion-(run-[a-zA-Z0-9-]+)/);
  if (!match) return "";
  return match[1].replace(/-/g, "_").replace(/^run_([0-9]+)_/, "run_$1_");
}

function sessionIdFromSessionKey(sessionKey: string): string | undefined {
  const match = sessionKey.match(/:companion-chat-([a-zA-Z0-9-]+)/);
  return match?.[1];
}

function unknownRun(runId: string, message: string): CompanionRunStatus {
  return {
    success: false,
    runId,
    state: "unknown",
    message,
  };
}

function numberOrUndefined(value: any) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function includeRaw() {
  return ["1", "true", "yes"].includes((process.env.CLAWMOBILE_RUNS_INCLUDE_RAW || "").toLowerCase());
}

function includeTechnicalIds() {
  return includeRaw() || ["1", "true", "yes"].includes((process.env.CLAWMOBILE_RUNS_INCLUDE_TECHNICAL_IDS || "").toLowerCase());
}

function openClawStateDir() {
  return process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
}

function agentId() {
  return (process.env.CLAWMOBILE_AGENT_ID || "main").trim() || "main";
}

async function findStoredRun(runId: string): Promise<StoredRun | null> {
  return (await readStoredRuns()).find((run) => run.runId === runId) || null;
}

async function readStoredRuns(): Promise<StoredRun[]> {
  for (const run of submittedRuns.values()) {
    if (!run.sessionId) run.sessionId = "default";
  }

  const fromMemory = Array.from(submittedRuns.values());
  const registry = await readCompanionRunRegistry().catch(() => defaultCompanionRunRegistry());
  const archivedSessionIds = new Set(registry.archivedSessionIds);
  const byId = new Map<string, StoredRun>();
  for (const run of [...registry.runs, ...fromMemory]) {
    byId.set(run.runId, {
      ...run,
      sessionId: normalizeCompanionSessionId(run.sessionId || "default"),
    });
  }
  return Array.from(byId.values())
    .filter((run) => !archivedSessionIds.has(normalizeCompanionSessionId(run.sessionId || "default")))
    .sort((left, right) => right.acceptedAt - left.acceptedAt);
}

async function saveStoredRun(run: StoredRun) {
  const registry = await readCompanionRunRegistry().catch(() => defaultCompanionRunRegistry());
  const storedRun = {
    ...run,
    sessionId: normalizeCompanionSessionId(run.sessionId || "default"),
  };
  const next = [storedRun, ...registry.runs.filter((existing) => existing.runId !== storedRun.runId)].slice(0, 100);
  const archivedSessionIds = registry.archivedSessionIds.filter((id) => id !== storedRun.sessionId);
  submittedRuns.set(storedRun.runId, storedRun);
  await writeCompanionRunRegistry(next, archivedSessionIds);
}

async function writeCompanionRunRegistry(runs: StoredRun[], archivedSessionIds: string[]) {
  await fs.mkdir(path.dirname(runRegistryPath()), { recursive: true });
  await fs.writeFile(runRegistryPath(), JSON.stringify({ version: 1, runs, archivedSessionIds }, null, 2));
}

async function readCompanionRunRegistry(): Promise<CompanionRunRegistry> {
  const raw = await fs.readFile(runRegistryPath(), "utf8");
  const data = JSON.parse(raw);
  const runs = Array.isArray(data?.runs) ? data.runs : [];
  const archivedSessionIds: string[] = Array.isArray(data?.archivedSessionIds)
    ? Array.from(new Set<string>(
      data.archivedSessionIds
        .map((id: any) => normalizeCompanionSessionId(String(id || "")))
        .filter((id: string) => id.length > 0),
    ))
    : [];
  return {
    archivedSessionIds,
    runs: runs
      .filter((run: any) => typeof run?.runId === "string")
    .map((run: any) => ({
      runId: run.runId,
      sessionId: normalizeCompanionSessionId(String(run.sessionId || "default")),
      sessionKey: typeof run.sessionKey === "string" ? run.sessionKey : undefined,
      text: typeof run.text === "string" ? run.text : "",
      userText: typeof run.userText === "string" ? run.userText : undefined,
      attachments: Array.isArray(run.attachments) ? run.attachments : undefined,
      acceptedAt: typeof run.acceptedAt === "number" ? run.acceptedAt : 0,
      updatedAt: typeof run.updatedAt === "number" ? run.updatedAt : undefined,
      state: ["running", "done", "failed", "unknown"].includes(String(run.state || ""))
        ? run.state
        : undefined,
      error: typeof run.error === "string" ? run.error : undefined,
    })),
  };
}

async function readArchivedSessionIds(): Promise<Set<string>> {
  const registry = await readCompanionRunRegistry().catch(() => defaultCompanionRunRegistry());
  return new Set(registry.archivedSessionIds);
}

function defaultCompanionRunRegistry(): CompanionRunRegistry {
  return { runs: [], archivedSessionIds: [] };
}

function runRegistryPath() {
  return path.join(openClawStateDir(), "clawmobile-companion", "runs.json");
}
