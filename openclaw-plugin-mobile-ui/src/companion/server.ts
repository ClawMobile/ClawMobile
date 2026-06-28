import { execFile, spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { URL } from "url";
import { android_health } from "../tools/android";
import { clearAgentConversationMessages, listAgentConversationMessages, listAgentConversations, markAgentMessageRead } from "./agentMessages";
import { getGatewayStatus, getRuntimeLog, restartRuntime, startRuntime, stopRuntime } from "./openclawGatewayClient";
import { submitIntent } from "./intent";
import { deleteNostrContact, fetchNostrInbox, getNostrStatus, listNostrContacts, sendNostrAgentMessage, setupNostrIdentity, shareSkillViaNostr, upsertNostrContact } from "./nostr";
import { archiveSession, deleteSession, getRunStatus, listRuns } from "./runs";
import { getWorkspaceSkill, listWorkspaceSkills, previewWorkspaceSkill, routeWorkspaceSkills, runWorkspaceFastPath, runWorkspaceSkill } from "./skills";
import { acceptSkillImport, createSkillSharePackage, listPendingSkillImports, rejectSkillImport, storePendingSkillImport } from "./skillSharing";
import type { CompanionHealth, CompanionRunStatus, IntentAttachment, RunCreateRequest, TerminalCommandRequest, TerminalCommandResponse, TerminalSessionRequest, TerminalSessionResponse } from "./types";

const VERSION = "0.1.0";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TERMINAL_COMMAND_CHARS = 2000;
const MAX_TERMINAL_OUTPUT_BYTES = 64 * 1024;
const TERMINAL_COMMAND_TIMEOUT_MS = 30_000;
const MAX_TERMINAL_SESSION_OUTPUT_CHARS = 128 * 1024;
const CWD_SENTINEL_PREFIX = "__CLAWMOBILE_CWD:";
const CWD_SENTINEL_SUFFIX = "__";

type TerminalShellSession = {
  child: ChildProcessWithoutNullStreams;
  output: string;
  cwd: string;
  running: boolean;
  updatedAt: number;
};

export function startCompanionServer() {
  const configuredHost = (process.env.CLAWMOBILE_COMPANION_HOST || DEFAULT_HOST).trim();
  const host = listenHost(configuredHost);
  const port = parsePort(process.env.CLAWMOBILE_COMPANION_PORT, DEFAULT_PORT);

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (error: any) {
      writeJson(res, error?.statusCode || 500, {
        success: false,
        message: error?.message || "Internal server error.",
      });
    }
  });

  const onListening = () => {
    const address = server.address();
    const resolvedHost = typeof address === "object" && address ? address.address : configuredHost || "::";
    console.log(`[companion] ClawMobile companion server listening on ${resolvedHost}:${port}`);
  };
  if (host) {
    server.listen(port, host, onListening);
  } else {
    server.listen(port, onListening);
  }
  server.once("error", (error: any) => {
    console.error(`[companion] unable to start companion server: ${error?.message || error}`);
    process.exit(1);
  });

  const shutdown = () => {
    console.log("[companion] shutting down companion server");
    stopTerminalShellSession();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  startTerminalShellSession();

  return server;
}

async function route(req: http.IncomingMessage, res: http.ServerResponse) {
  const method = req.method || "GET";
  const requestUrl = new URL(req.url || "/", "http://localhost");
  const routePath = normalizeProtocolPath(requestUrl.pathname);

  if (shouldBlockBrowserRequest(req, routePath || requestUrl.pathname)) {
    writeJson(res, 403, {
      success: false,
      message: "Browser-origin requests are not allowed for local companion control endpoints.",
    });
    return;
  }

  if (method === "OPTIONS") {
    writeJson(res, 204, {});
    return;
  }

  if (!routePath) {
    writeJson(res, 404, {
      success: false,
      message: `No route for ${method} ${requestUrl.pathname}. Use the /v1 runtime protocol.`,
    });
    return;
  }

  if (isLocalOnlyRoute(routePath) && !isLoopbackRequest(req) && process.env.CLAWMOBILE_COMPANION_ALLOW_REMOTE_TERMINAL !== "1") {
    writeJson(res, 403, {
      success: false,
      message: "This endpoint is restricted to local companion app requests.",
    });
    return;
  }

  if (method === "GET" && routePath === "/") {
    writeJson(res, 200, {
      name: "ClawMobile Companion Server",
      version: VERSION,
      protocol: "v1",
      endpoints: [
        "/v1/health",
        "/v1/capabilities",
        "/v1/attachments",
        "/v1/attachments/:attachmentId/content",
        "/v1/runs",
        "/v1/runs/:runId",
        "/v1/sessions/:sessionId/archive",
        "/v1/sessions/:sessionId",
        "/v1/runtime/start",
        "/v1/runtime/stop",
        "/v1/runtime/restart",
        "/v1/runtime/log",
        "/v1/skills",
        "/v1/skills/route",
        "/v1/skills/:skillId",
        "/v1/skills/:skillId/preview",
        "/v1/skills/:skillId/run",
        "/v1/skills/:skillId/fast-paths/:fastPathId/run",
        "/v1/skills/:skillId/runs",
        "/v1/skill-runs/:runId",
        "/v1/extensions/android/terminal/command",
        "/v1/extensions/android/terminal/session",
        "/v1/extensions/android/terminal/session/input",
        "/v1/extensions/android/terminal/session/reset",
        "/v1/extensions/nostr/status",
        "/v1/extensions/nostr/setup-key",
        "/v1/extensions/nostr/contacts",
        "/v1/extensions/nostr/contacts/:contactId",
        "/v1/extensions/nostr/send",
        "/v1/extensions/nostr/inbox",
        "/v1/extensions/agent/conversations",
        "/v1/extensions/agent/conversations/:agentId/messages",
        "/v1/extensions/agent/inbox/fetch",
        "/v1/extensions/agent/messages/:messageId/read",
        "/v1/extensions/skill-sharing/skills/:skillId/share",
        "/v1/extensions/skill-sharing/skills/:skillId/share/nostr",
        "/v1/extensions/skill-sharing/imports",
        "/v1/extensions/skill-sharing/imports/:importId/accept",
        "/v1/extensions/skill-sharing/imports/:importId/reject",
      ],
    });
    return;
  }

  if (method === "GET" && routePath === "/health") {
    writeJson(res, 200, await health());
    return;
  }

  if (method === "GET" && routePath === "/capabilities") {
    writeJson(res, 200, await capabilities());
    return;
  }

  if (method === "POST" && routePath === "/runs") {
    const body = await readJsonBody<RunCreateRequest>(req);
    const instruction = String(body?.instruction || body?.text || "");
    const displayText = String(body?.displayText || body?.userText || body?.text || instruction);
    const result = await submitIntent(
      instruction,
      String(body?.sessionId || "default"),
      body?.attachments || [],
      {
        userText: displayText,
        clientRunId: body?.clientRunId,
      },
    );
    writeJson(res, result.success ? 200 : 400, result);
    return;
  }

  if (method === "POST" && routePath === "/attachments") {
    const result = await saveAttachment(req);
    writeJson(res, result.success ? 200 : 400, result);
    return;
  }

  if (method === "GET" && routePath.startsWith("/attachments/") && routePath.endsWith("/content")) {
    const attachmentId = decodeURIComponent(routePath.slice("/attachments/".length, -"/content".length));
    await serveAttachmentContent(res, attachmentId);
    return;
  }

  if (method === "POST" && routePath === "/runtime/start") {
    writeJson(res, 200, await startRuntime());
    return;
  }

  if (method === "POST" && routePath === "/runtime/stop") {
    const result = await stopRuntime();
    writeJson(res, result.success ? 200 : 500, result);
    return;
  }

  if (method === "POST" && routePath === "/runtime/restart") {
    const result = await restartRuntime();
    writeJson(res, result.success ? 200 : 500, result);
    return;
  }

  if (method === "GET" && routePath === "/runtime/log") {
    const maxBytes = parsePort(requestUrl.searchParams.get("maxBytes") || undefined, 64 * 1024);
    writeJson(res, 200, getRuntimeLog(maxBytes));
    return;
  }

  if (method === "POST" && routePath === "/terminal/command") {
    const body = await readJsonBody<TerminalCommandRequest>(req);
    const result = await runTerminalCommand(String(body?.command || ""));
    writeJson(res, result.command ? 200 : 400, result);
    return;
  }

  if (method === "GET" && routePath === "/terminal/session") {
    writeJson(res, 200, terminalSessionSnapshot("Shell ready."));
    return;
  }

  if (method === "POST" && routePath === "/terminal/session/input") {
    const body = await readJsonBody<TerminalSessionRequest>(req);
    const result = sendTerminalSessionInput(String(body?.text || ""));
    writeJson(res, result.success ? 200 : 400, result);
    return;
  }

  if (method === "POST" && routePath === "/terminal/session/reset") {
    stopTerminalShellSession();
    const session = startTerminalShellSession();
    appendTerminalShellText(session, "Shell restarted.\n");
    writeJson(res, 200, terminalSessionSnapshot("Shell restarted."));
    return;
  }

  if (method === "GET" && routePath === "/skills") {
    writeJson(res, 200, {
      skills: listWorkspaceSkills(),
    });
    return;
  }

  if (method === "POST" && routePath === "/skills/route") {
    const body = await readJsonBody<Record<string, any>>(req);
    writeJson(res, 200, routeWorkspaceSkills(body || {}));
    return;
  }

  if (method === "GET" && routePath === "/nostr/status") {
    writeJson(res, 200, getNostrStatus());
    return;
  }

  if (method === "POST" && routePath === "/nostr/setup-key") {
    const body = await readJsonBody<Record<string, any>>(req);
    writeJson(res, 200, setupNostrIdentity({
      secretKey: body?.secretKey || body?.nsec,
      relays: Array.isArray(body?.relays) ? body.relays : undefined,
      revealSecret: body?.revealSecret === true,
    }));
    return;
  }

  if (method === "GET" && routePath === "/nostr/contacts") {
    writeJson(res, 200, listNostrContacts());
    return;
  }

  if (method === "POST" && routePath === "/nostr/contacts") {
    const body = await readJsonBody<Record<string, any>>(req);
    writeJson(res, 200, upsertNostrContact(body || {}));
    return;
  }

  const nostrContactMatch = routePath.match(/^\/nostr\/contacts\/([^/]+)$/);
  if (method === "DELETE" && nostrContactMatch) {
    const contactId = decodeURIComponent(nostrContactMatch[1]);
    const result = deleteNostrContact({ value: contactId });
    writeJson(res, result.ok ? 200 : 404, result);
    return;
  }

  if (method === "POST" && routePath === "/nostr/send") {
    const body = await readJsonBody<Record<string, any>>(req);
    const result = await sendNostrAgentMessage(body || {});
    writeJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (method === "GET" && routePath === "/nostr/inbox") {
    const limit = Number.parseInt(requestUrl.searchParams.get("limit") || "", 10);
    const since = Number.parseInt(requestUrl.searchParams.get("since") || "", 10);
    const relays = requestUrl.searchParams.getAll("relay").filter(Boolean);
    writeJson(res, 200, await fetchNostrInbox({
      limit: Number.isFinite(limit) ? limit : undefined,
      since: Number.isFinite(since) ? since : undefined,
      relays: relays.length ? relays : undefined,
      autoStoreSkillShares: requestUrl.searchParams.get("autoStoreSkillShares") !== "0",
    }));
    return;
  }

  if (method === "GET" && routePath === "/agent/conversations") {
    writeJson(res, 200, {
      ok: true,
      conversations: listAgentConversations(listNostrContacts().contacts),
    });
    return;
  }

  const agentMessagesMatch = routePath.match(/^\/agent\/conversations\/([^/]+)\/messages$/);
  if (method === "GET" && agentMessagesMatch) {
    const agentId = decodeURIComponent(agentMessagesMatch[1]);
    const limit = Number.parseInt(requestUrl.searchParams.get("limit") || "", 10);
    const before = requestUrl.searchParams.get("before") || undefined;
    writeJson(res, 200, {
      ok: true,
      agentId,
      messages: listAgentConversationMessages(agentId, {
        limit: Number.isFinite(limit) ? limit : undefined,
        before,
      }),
    });
    return;
  }

  if (method === "POST" && agentMessagesMatch) {
    const agentId = decodeURIComponent(agentMessagesMatch[1]);
    const body = await readJsonBody<Record<string, any>>(req);
    const result = await sendNostrAgentMessage({
      recipientPubkey: agentId,
      message: String(body?.message || body?.text || ""),
      payload: body?.payload,
      relays: Array.isArray(body?.relays) ? body.relays : undefined,
    });
    writeJson(res, result.ok ? 200 : 502, {
      ok: result.ok,
      success: result.ok,
      message: result.message,
      eventId: result.eventId,
      storedMessage: result.storedMessage,
      publish: result.publish,
    });
    return;
  }

  if (method === "DELETE" && agentMessagesMatch) {
    const agentId = decodeURIComponent(agentMessagesMatch[1]);
    const result = clearAgentConversationMessages(agentId);
    writeJson(res, result.ok ? 200 : 400, result);
    return;
  }

  if (method === "POST" && routePath === "/agent/inbox/fetch") {
    const body: Record<string, any> = await readJsonBody<Record<string, any>>(req).catch(() => ({}));
    const result = await fetchNostrInbox({
      limit: Number.isFinite(Number(body?.limit)) ? Number(body.limit) : 50,
      since: Number.isFinite(Number(body?.since)) ? Number(body.since) : undefined,
      relays: Array.isArray(body?.relays) ? body.relays : undefined,
      autoStoreSkillShares: body?.autoStoreSkillShares !== false,
    });
    writeJson(res, 200, {
      ok: result.ok,
      success: result.ok,
      message: result.message,
      newMessageCount: result.stored?.insertedCount || 0,
      updatedMessageCount: result.stored?.updatedCount || 0,
      newImportCount: result.messages.filter((message: any) => Boolean(message.pendingImportId)).length,
      updatedConversationIds: result.stored?.conversationIds || [],
    });
    return;
  }

  const markAgentMessageReadMatch = routePath.match(/^\/agent\/messages\/([^/]+)\/read$/);
  if (method === "POST" && markAgentMessageReadMatch) {
    const messageId = decodeURIComponent(markAgentMessageReadMatch[1]);
    const body: Record<string, any> = await readJsonBody<Record<string, any>>(req).catch(() => ({}));
    const result = markAgentMessageRead(messageId, { conversation: body?.conversation === true });
    writeJson(res, result.ok ? 200 : 404, result);
    return;
  }

  if (method === "GET" && routePath === "/skill-imports") {
    writeJson(res, 200, {
      imports: listPendingSkillImports(),
    });
    return;
  }

  if (method === "POST" && routePath === "/skill-imports") {
    const body = await readJsonBody<Record<string, any>>(req);
    const record = storePendingSkillImport(body?.package || body, body?.source || { transport: "manual" });
    writeJson(res, 200, {
      ok: true,
      import: record,
      message: "Skill share stored as a pending import.",
    });
    return;
  }

  const acceptSkillImportMatch = routePath.match(/^\/skill-imports\/([^/]+)\/accept$/);
  if (method === "POST" && acceptSkillImportMatch) {
    const importId = decodeURIComponent(acceptSkillImportMatch[1]);
    const result = acceptSkillImport(importId);
    writeJson(res, result ? 200 : 404, result || {
      ok: false,
      message: `Skill import not found: ${importId}`,
    });
    return;
  }

  const rejectSkillImportMatch = routePath.match(/^\/skill-imports\/([^/]+)\/reject$/);
  if (method === "POST" && rejectSkillImportMatch) {
    const importId = decodeURIComponent(rejectSkillImportMatch[1]);
    const result = rejectSkillImport(importId);
    writeJson(res, result ? 200 : 404, result || {
      ok: false,
      message: `Skill import not found: ${importId}`,
    });
    return;
  }

  const skillDetailMatch = routePath.match(/^\/skills\/([^/]+)$/);
  if (method === "GET" && skillDetailMatch) {
    const skillId = decodeURIComponent(skillDetailMatch[1]);
    const skill = getWorkspaceSkill(skillId);
    writeJson(res, skill ? 200 : 404, skill || {
      success: false,
      message: `Workspace skill not found: ${skillId}`,
    });
    return;
  }

  const skillShareMatch = routePath.match(/^\/skills\/([^/]+)\/share$/);
  if (method === "POST" && skillShareMatch) {
    const skillId = decodeURIComponent(skillShareMatch[1]);
    const result = createSkillSharePackage(skillId);
    writeJson(res, result ? 200 : 404, result || {
      ok: false,
      message: `Workspace skill not found: ${skillId}`,
    });
    return;
  }

  const skillShareNostrMatch = routePath.match(/^\/skills\/([^/]+)\/share\/nostr$/);
  if (method === "POST" && skillShareNostrMatch) {
    const skillId = decodeURIComponent(skillShareNostrMatch[1]);
    const body = await readJsonBody<Record<string, any>>(req);
    const result = await shareSkillViaNostr(skillId, body || {});
    writeJson(res, result ? (result.ok ? 200 : 502) : 404, result || {
      ok: false,
      message: `Workspace skill not found: ${skillId}`,
    });
    return;
  }

  const skillPreviewMatch = routePath.match(/^\/skills\/([^/]+)\/preview$/);
  if (method === "POST" && skillPreviewMatch) {
    const skillId = decodeURIComponent(skillPreviewMatch[1]);
    const body = await readJsonBody<Record<string, any>>(req);
    const result = previewWorkspaceSkill(skillId, body || {});
    writeJson(res, result ? 200 : 404, result || {
      success: false,
      message: `Workspace skill not found: ${skillId}`,
    });
    return;
  }

  const skillRunMatch = routePath.match(/^\/skills\/([^/]+)\/run$/);
  if (method === "POST" && skillRunMatch) {
    const skillId = decodeURIComponent(skillRunMatch[1]);
    const body = await readJsonBody<Record<string, any>>(req);
    const result = await runWorkspaceSkill(skillId, body || {});
    writeJson(res, result ? 200 : 404, result || {
      success: false,
      message: `Workspace skill not found: ${skillId}`,
    });
    return;
  }

  const fastPathRunMatch = routePath.match(/^\/skills\/([^/]+)\/fast-paths\/([^/]+)\/run$/);
  if (method === "POST" && fastPathRunMatch) {
    const skillId = decodeURIComponent(fastPathRunMatch[1]);
    const fastPathId = decodeURIComponent(fastPathRunMatch[2]);
    const body = await readJsonBody<Record<string, any>>(req);
    const result = await runWorkspaceFastPath(skillId, fastPathId, body || {});
    writeJson(res, result ? 200 : 404, result || {
      success: false,
      message: `Workspace fast path not found: ${skillId}/${fastPathId}`,
    });
    return;
  }

  const skillRunsMatch = routePath.match(/^\/skills\/([^/]+)\/runs$/);
  if (method === "GET" && skillRunsMatch) {
    const skillId = decodeURIComponent(skillRunsMatch[1]);
    const runs = (await listRuns())
      .filter((run) => companionRunBelongsToSkill(run, skillId))
      .map((run) => toSkillRunSummary(run, skillId));
    writeJson(res, 200, { runs });
    return;
  }

  if (method === "GET" && routePath.startsWith("/skill-runs/")) {
    const runId = decodeURIComponent(routePath.slice("/skill-runs/".length));
    const result = await getRunStatus(runId);
    writeJson(res, result.success || result.state !== "unknown" ? 200 : 404, toSkillRunSummary(result));
    return;
  }

  if (method === "GET" && routePath === "/runs") {
    const rawLimit = Number.parseInt(requestUrl.searchParams.get("limit") || "", 10);
    const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
    writeJson(res, 200, {
      runs: await listRuns({ limit }),
    });
    return;
  }

  if (method === "GET" && routePath.startsWith("/runs/")) {
    const runId = decodeURIComponent(routePath.slice("/runs/".length));
    const result = await getRunStatus(runId);
    writeJson(res, result.success || result.state !== "unknown" ? 200 : 404, result);
    return;
  }

  const archiveSessionMatch = routePath.match(/^\/sessions\/([^/]+)\/archive$/);
  if (method === "POST" && archiveSessionMatch) {
    const sessionId = decodeURIComponent(archiveSessionMatch[1]);
    const result = await archiveSession(sessionId);
    writeJson(res, result.success ? 200 : 400, result);
    return;
  }

  const deleteSessionMatch = routePath.match(/^\/sessions\/([^/]+)$/);
  if (method === "DELETE" && deleteSessionMatch) {
    const sessionId = decodeURIComponent(deleteSessionMatch[1]);
    const result = await deleteSession(sessionId);
    writeJson(res, result.success ? 200 : 400, result);
    return;
  }

  writeJson(res, 404, {
    success: false,
    message: `No route for ${method} ${requestUrl.pathname}.`,
  });
}

function normalizeProtocolPath(pathname: string): string | null {
  if (pathname === "/" || pathname === "/v1") return "/";
  if (!pathname.startsWith("/v1/")) return null;

  const path = pathname.slice("/v1".length);
  const extensionMappings: Array<[string, string]> = [
    ["/extensions/android", ""],
    ["/extensions/nostr", "/nostr"],
    ["/extensions/agent", "/agent"],
    ["/extensions/skill-sharing/imports", "/skill-imports"],
    ["/extensions/skill-sharing/skills", "/skills"],
  ];

  for (const [prefix, replacement] of extensionMappings) {
    if (path === prefix) return replacement || "/";
    if (path.startsWith(`${prefix}/`)) {
      return `${replacement}${path.slice(prefix.length)}` || "/";
    }
  }

  return path;
}

async function health(): Promise<CompanionHealth> {
  const [runtime, gateway] = await Promise.all([
    android_health().catch((error: any) => ({
      ok: false,
      error: error?.message || "android_health failed",
    })),
    getGatewayStatus(),
  ]);

  const runtimeOk = runtime?.ok !== false;
  const runtimeDetails: any = runtime;
  const runtimeStage = typeof runtimeDetails?.stage === "string" ? runtimeDetails.stage : undefined;
  const runtimeError = runtimeDetails?.error ? String(runtimeDetails.error) : undefined;
  const model = modelKeyHealth();
  return {
    status: runtimeOk ? "connected" : "disconnected",
    message: runtimeOk ? "ClawMobile companion server is running." : "Companion server is running with degraded runtime health.",
    version: VERSION,
    stage: runtimeStage,
    checks: [
      {
        id: "companion",
        label: "Companion",
        state: "online",
        detail: "Companion HTTP server is reachable.",
      },
      {
        id: "runtime",
        label: "Runtime",
        state: runtimeOk ? "online" : "offline",
        detail: runtimeOk ? String(runtimeStage || "Runtime capability check passed.") : String(runtimeError || "Runtime capability check failed."),
      },
      {
        id: "gateway",
        label: "OpenClaw",
        state: gateway.reachable ? "online" : "offline",
        detail: gateway.message,
      },
      {
        id: "model",
        label: "Model",
        state: model.configured ? "online" : "offline",
        detail: model.message,
      },
    ],
    gateway,
    runtime,
    model,
  };
}

async function capabilities() {
  const currentHealth = await health();
  const runtime = currentHealth.runtime || {};
  const rawCapabilities = runtime.capabilities || {};
  const modelConfigured = currentHealth.model?.configured === true;
  const adbReady = rawCapabilities.ui_input === true || rawCapabilities.adb === true;
  const ocrReady = rawCapabilities.ocr === true || rawCapabilities.screen_ocr === true;

  return {
    platform: "android",
    runtime: "termux-openclaw",
    version: VERSION,
    health: currentHealth,
    features: {
      tasks: "available",
      sessions: "available",
      skills: "available",
      attachments: "available",
      artifacts: "planned",
      approvals: "planned",
      events: "unavailable",
      runtimeLifecycle: "available",
      runtimeLog: "available",
      notifications: "frontend",
      adb: adbReady ? "available" : "setup_required",
      ocr: ocrReady ? "available" : "setup_required",
      terminal: "local_only",
      social: "available",
      appIntents: "unavailable",
      model: modelConfigured ? "available" : "setup_required",
    },
    tools: [
      {
        id: "android_health",
        label: "Android Health",
        description: "Read Android runtime health and setup status.",
        status: "available",
        risk: "low",
        requiresApproval: false,
        extension: "android",
        permissions: [],
      },
      {
        id: "terminal.command",
        label: "Run Terminal Command",
        description: "Run a shell command in the companion runtime.",
        status: "available",
        risk: "high",
        requiresApproval: true,
        extension: "android",
        permissions: ["local_loopback"],
      },
    ],
    extensions: [
      {
        namespace: "android",
        basePath: "/v1/extensions/android",
        status: "available",
        routes: [
          { id: "terminal.command", method: "POST", path: "/terminal/command", status: "available", risk: "high", requiresApproval: true },
          { id: "terminal.session", method: "GET", path: "/terminal/session", status: "available", risk: "medium", requiresApproval: false },
        ],
      },
      {
        namespace: "nostr",
        basePath: "/v1/extensions/nostr",
        status: "available",
        routes: [
          { id: "nostr.status", method: "GET", path: "/status", status: "available", risk: "low", requiresApproval: false },
          { id: "nostr.contacts", method: "GET", path: "/contacts", status: "available", risk: "low", requiresApproval: false },
          { id: "nostr.send", method: "POST", path: "/send", status: "available", risk: "medium", requiresApproval: false },
        ],
      },
      {
        namespace: "agent",
        basePath: "/v1/extensions/agent",
        status: "available",
        routes: [
          { id: "agent.conversations", method: "GET", path: "/conversations", status: "available", risk: "low", requiresApproval: false },
        ],
      },
      {
        namespace: "skill-sharing",
        basePath: "/v1/extensions/skill-sharing",
        status: "available",
        routes: [
          { id: "skill-sharing.imports", method: "GET", path: "/imports", status: "available", risk: "low", requiresApproval: false },
          { id: "skill-sharing.share", method: "POST", path: "/skills/:skillId/share", status: "available", risk: "medium", requiresApproval: false },
        ],
      },
    ],
  };
}

async function saveAttachment(req: http.IncomingMessage): Promise<IntentAttachment & { success: boolean; message: string }> {
  const mimeType = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (!mimeType.startsWith("image/")) {
    return {
      success: false,
      message: "Only image attachments are supported.",
      id: "",
      type: "image",
      mimeType,
    };
  }

  const body = await readRawBody(req, MAX_ATTACHMENT_BYTES);
  if (body.length === 0) {
    return {
      success: false,
      message: "Attachment body is empty.",
      id: "",
      type: "image",
      mimeType,
    };
  }

  const id = sanitizeFilePart(String(req.headers["x-clawmobile-attachment-id"] || "")) || `att_${Date.now().toString(36)}`;
  const requestedName = sanitizeFilePart(String(req.headers["x-clawmobile-filename"] || ""));
  const extension = extensionForMime(mimeType);
  const displayName = requestedName || `${id}.${extension}`;
  const outputDir = attachmentDir();
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${id}.${extension}`);
  fs.writeFileSync(outputPath, body);

  return {
    success: true,
    message: "Attachment uploaded.",
    id,
    serverId: id,
    type: "image",
    mimeType,
    displayName,
    sizeBytes: body.length,
    path: outputPath,
    serverPath: outputPath,
    downloadUrl: `/v1/attachments/${encodeURIComponent(id)}/content`,
    createdAt: Date.now(),
  };
}

async function serveAttachmentContent(res: http.ServerResponse, attachmentId: string) {
  const id = sanitizeFilePart(attachmentId);
  if (!id) {
    writeJson(res, 404, {
      success: false,
      message: "Attachment was not found.",
    });
    return;
  }

  const outputDir = attachmentDir();
  const candidates = ["png", "jpg", "webp", "gif", "img"].map((extension) =>
    path.join(outputDir, `${id}.${extension}`),
  );
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    writeJson(res, 404, {
      success: false,
      message: "Attachment was not found.",
    });
    return;
  }

  const mimeType = mimeForExtension(path.extname(filePath).replace(/^\./, ""));
  res.statusCode = 200;
  res.setHeader("Content-Type", mimeType);
  fs.createReadStream(filePath).pipe(res);
}

function attachmentDir() {
  const configured = (process.env.CLAWMOBILE_ATTACHMENT_DIR || "").trim();
  return configured || path.join(os.homedir(), ".clawmobile", "companion-attachments");
}

function mimeForExtension(extension: string) {
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96);
}

function extensionForMime(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/png":
      return "png";
    default:
      return "img";
  }
}

function runTerminalCommand(command: string): Promise<TerminalCommandResponse> {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) {
    return Promise.resolve({
      success: false,
      command: "",
      cwd: terminalCommandCwd(),
      output: "",
      message: "Command is empty.",
    });
  }

  if (trimmedCommand.length > MAX_TERMINAL_COMMAND_CHARS) {
    return Promise.resolve({
      success: false,
      command: trimmedCommand.slice(0, MAX_TERMINAL_COMMAND_CHARS),
      cwd: terminalCommandCwd(),
      output: "",
      message: `Command is too long. Limit is ${MAX_TERMINAL_COMMAND_CHARS} characters.`,
    });
  }

  const cwd = terminalCommandCwd();
  const shell = process.env.SHELL || "bash";
  const startedAt = Date.now();

  return new Promise((resolve) => {
    execFile(
      shell,
      ["-lc", trimmedCommand],
      {
        cwd,
        env: process.env,
        timeout: TERMINAL_COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_TERMINAL_OUTPUT_BYTES,
      },
      (error: any, stdout = "", stderr = "") => {
        const output = [stdout, stderr]
          .filter((text) => text && text.length > 0)
          .join(stdout && stderr ? "\n" : "")
          .trimEnd();
        const exitCode = typeof error?.code === "number" ? error.code : 0;
        const timedOut = Boolean(error?.killed) || error?.signal === "SIGTERM";
        const success = !error;
        const message = timedOut
          ? `Command timed out after ${TERMINAL_COMMAND_TIMEOUT_MS / 1000}s.`
          : success
            ? "Command completed."
            : `Command exited with ${exitCode}.`;

        resolve({
          success,
          command: trimmedCommand,
          cwd,
          output,
          exitCode,
          durationMs: Date.now() - startedAt,
          message,
        });
      },
    );
  });
}

function terminalCommandCwd() {
  const configured = (process.env.CLAWMOBILE_TERMINAL_CWD || "").trim();
  if (configured && fs.existsSync(configured)) {
    return configured;
  }
  try {
    return process.cwd();
  } catch {
    return os.homedir();
  }
}

let terminalShellSession: TerminalShellSession | null = null;

function startTerminalShellSession(): TerminalShellSession {
  if (terminalShellSession?.running) return terminalShellSession;

  const cwd = terminalCommandCwd();
  const shell = process.env.SHELL || "bash";
  const child = spawn(shell, ["--noprofile", "--norc"], {
    cwd,
    env: {
      ...process.env,
      TERM: process.env.TERM || "xterm-256color",
    },
    stdio: "pipe",
  });
  child.stdin.setDefaultEncoding("utf8");

  const session: TerminalShellSession = {
    child,
    output: "",
    cwd,
    running: true,
    updatedAt: Date.now(),
  };
  terminalShellSession = session;
  appendTerminalShellText(session, `ClawMobile shell started in ${cwd}\n`);

  child.stdout.on("data", (chunk) => appendTerminalShellChunk(session, chunk));
  child.stderr.on("data", (chunk) => appendTerminalShellChunk(session, chunk));
  child.once("close", (code, signal) => {
    session.running = false;
    appendTerminalShellText(
      session,
      `\n[shell exited${typeof code === "number" ? ` ${code}` : ""}${signal ? `, ${signal}` : ""}]\n`,
    );
  });
  child.once("error", (error) => {
    session.running = false;
    appendTerminalShellText(session, `\n[shell error] ${error.message}\n`);
  });

  writeTerminalShellInput(session, `printf '${CWD_SENTINEL_PREFIX}%s${CWD_SENTINEL_SUFFIX}\\n' "$PWD"\n`);
  return session;
}

function stopTerminalShellSession() {
  const session = terminalShellSession;
  if (!session) return;
  terminalShellSession = null;
  try {
    session.child.stdin.end("exit\n");
  } catch {
    // ignore shutdown races
  }
  setTimeout(() => {
    if (session.running) {
      try {
        session.child.kill("SIGTERM");
      } catch {
        // ignore shutdown races
      }
    }
  }, 500).unref();
}

function sendTerminalSessionInput(text: string): TerminalSessionResponse {
  const session = startTerminalShellSession();
  if (!session.running || session.child.stdin.destroyed) {
    return terminalSessionSnapshot("Shell is not running.", false);
  }

  const input = text.replace(/\r/g, "").trimEnd();
  if (!input) {
    writeTerminalShellInput(session, "\n");
    return terminalSessionSnapshot("Input sent.");
  }
  if (input.length > MAX_TERMINAL_COMMAND_CHARS) {
    return terminalSessionSnapshot(`Input is too long. Limit is ${MAX_TERMINAL_COMMAND_CHARS} characters.`, false);
  }

  appendTerminalShellText(session, `$ ${input}\n`);
  writeTerminalShellInput(session, `${input}\nprintf '${CWD_SENTINEL_PREFIX}%s${CWD_SENTINEL_SUFFIX}\\n' "$PWD"\n`);
  return terminalSessionSnapshot("Input sent.");
}

function writeTerminalShellInput(session: TerminalShellSession, input: string) {
  session.child.stdin.write(input);
  session.updatedAt = Date.now();
}

function appendTerminalShellChunk(session: TerminalShellSession, chunk: Buffer | string) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  appendTerminalShellText(session, stripCwdSentinels(session, text.replace(/\r/g, "")));
}

function stripCwdSentinels(session: TerminalShellSession, text: string) {
  return text.replace(new RegExp(`${CWD_SENTINEL_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\n]*)${CWD_SENTINEL_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`, "g"), (_match, cwd) => {
    const nextCwd = String(cwd || "").trim();
    if (nextCwd) session.cwd = nextCwd;
    return "";
  });
}

function appendTerminalShellText(session: TerminalShellSession, text: string) {
  if (!text) return;
  session.output = (session.output + text).slice(-MAX_TERMINAL_SESSION_OUTPUT_CHARS);
  session.updatedAt = Date.now();
}

function terminalSessionSnapshot(message = "Shell ready.", success = true): TerminalSessionResponse {
  const session = startTerminalShellSession();
  return {
    success,
    message,
    output: session.output,
    cwd: session.cwd,
    running: session.running,
    pid: session.child.pid,
    updatedAt: session.updatedAt,
  };
}

function modelKeyHealth() {
  const envFileValues = readOpenClawEnvFile();
  const providers = [
    { id: "openai", label: "OpenAI", keys: ["OPENAI_API_KEY"] },
    { id: "anthropic", label: "Anthropic", keys: ["ANTHROPIC_API_KEY"] },
    { id: "deepseek", label: "DeepSeek", keys: ["DEEPSEEK_API_KEY"] },
  ];
  const configuredProvider = providers.find((provider) =>
    provider.keys.some((key) => Boolean(process.env[key] || envFileValues[key])),
  );

  if (!configuredProvider) {
    return {
      configured: false,
      message: "No model API key configured.",
    };
  }

  return {
    configured: true,
    provider: configuredProvider.id,
    message: `${configuredProvider.label} key configured.`,
  };
}

function readOpenClawEnvFile(): Record<string, string> {
  const envFile = process.env.OPENCLAW_ENV_FILE || path.join(os.homedir(), ".openclaw", ".env");
  try {
    const raw = fs.readFileSync(envFile, "utf8");
    return raw.split(/\r?\n/).reduce<Record<string, string>>((values, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return values;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) return values;

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      values[key] = value;
      return values;
    }, {});
  } catch {
    return {};
  }
}

function parsePort(value: string | undefined, fallback: number) {
  const port = Number.parseInt(value || "", 10);
  return Number.isFinite(port) && port > 0 ? port : fallback;
}

function listenHost(value: string): string | undefined {
  const host = value.trim() || DEFAULT_HOST;
  if (host === "localhost" || host === "loopback") {
    return "127.0.0.1";
  }
  return host;
}

function isTerminalRoute(pathname: string) {
  return pathname === "/terminal/command" ||
    pathname === "/terminal/session" ||
    pathname === "/terminal/session/input" ||
    pathname === "/terminal/session/reset";
}

function isLocalOnlyRoute(pathname: string) {
  return isTerminalRoute(pathname) ||
    pathname === "/attachments" ||
    pathname.startsWith("/attachments/") ||
    pathname.startsWith("/agent/") ||
    pathname.startsWith("/nostr/") ||
    pathname === "/skill-imports" ||
    pathname.startsWith("/skill-imports/") ||
    /^\/skills\/[^/]+\/share(?:\/nostr)?$/.test(pathname);
}

function isLoopbackRequest(req: http.IncomingMessage) {
  const address = String(req.socket.remoteAddress || "").toLowerCase();
  return address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1";
}

function companionRunBelongsToSkill(run: CompanionRunStatus, skillId: string) {
  const expectedSessionId = `skill-${skillId}`;
  return run.sessionId === expectedSessionId ||
    run.runId.includes(`skill-run-${skillId}-`) ||
    String(run.prompt || "").includes(`workspace skill "${skillId}"`);
}

function toSkillRunSummary(run: CompanionRunStatus, fallbackSkillId?: string) {
  const skillId = fallbackSkillId || skillIdFromCompanionRun(run) || "unknown";
  const status = skillRunStatusFromCompanionRun(run);
  return {
    runId: run.runId,
    skillId,
    status,
    startedAt: run.startedAt || run.submittedAt,
    finishedAt: run.endedAt,
    currentStep: run.progress?.text,
    resultSummary: status === "completed" ? run.result || run.message : undefined,
    errorSummary: status === "failed" ? run.message : undefined,
  };
}

function skillIdFromCompanionRun(run: CompanionRunStatus) {
  const sessionMatch = String(run.sessionId || "").match(/^skill-(.+)$/);
  if (sessionMatch) return sessionMatch[1];
  const runIdMatch = run.runId.match(/^skill-run-(.+)-\d+$/);
  if (runIdMatch) return runIdMatch[1];
  const promptMatch = String(run.prompt || "").match(/workspace skill "([^"]+)"/);
  return promptMatch?.[1];
}

function skillRunStatusFromCompanionRun(run: CompanionRunStatus) {
  const raw = String(run.status || run.state || "").toLowerCase();
  if (["running", "queued", "pending", "processing"].includes(raw)) return "running";
  if (["done", "complete", "completed", "success"].includes(raw)) return "completed";
  if (["failed", "error"].includes(raw)) return "failed";
  if (["cancelled", "canceled", "aborted"].includes(raw)) return "cancelled";
  return "pending";
}

function writeJson(res: http.ServerResponse, statusCode: number, value: any) {
  const body = statusCode === 204 ? "" : JSON.stringify(value, null, 2);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const corsOrigin = (process.env.CLAWMOBILE_COMPANION_CORS_ORIGIN || "").trim();
  if (corsOrigin) {
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-clawmobile-client, x-clawmobile-request-id, x-clawmobile-attachment-id, x-clawmobile-filename, x-clawmobile-attachment-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  }
  res.end(body);
}

function shouldBlockBrowserRequest(req: http.IncomingMessage, pathname: string) {
  if (process.env.CLAWMOBILE_COMPANION_ALLOW_BROWSER_ORIGIN === "1") {
    return false;
  }
  if (!isSensitiveCompanionRoute(pathname)) {
    return false;
  }

  const origin = String(req.headers.origin || "").trim();
  if (origin) {
    return !isAllowedCorsOrigin(origin);
  }

  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite && fetchSite !== "none" && fetchSite !== "same-origin") {
    return true;
  }

  const referer = String(req.headers.referer || "").trim();
  return Boolean(referer && !refererStartsWithLocalCompanion(referer));
}

function isSensitiveCompanionRoute(pathname: string) {
  return pathname !== "/" && pathname !== "/health";
}

function isAllowedCorsOrigin(origin: string) {
  const configured = (process.env.CLAWMOBILE_COMPANION_CORS_ORIGIN || "").trim();
  return Boolean(configured && (configured === "*" || configured === origin));
}

function refererStartsWithLocalCompanion(referer: string) {
  try {
    const url = new URL(referer);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      port === String(parsePort(process.env.CLAWMOBILE_COMPANION_PORT, DEFAULT_PORT));
  } catch {
    return false;
  }
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  const raw = await readBody(req);
  if (!raw.trim()) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const raw = await readRawBody(req, MAX_BODY_BYTES);
  return raw.toString("utf8");
}

async function readRawBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new HttpError(413, "Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

if (require.main === module) {
  startCompanionServer();
}
