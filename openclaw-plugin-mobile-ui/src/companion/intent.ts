import crypto from "crypto";
import { getGatewayStatus } from "./openclawGatewayClient";
import { describeOpenClawResult, expectedCompanionSessionKey, normalizeCompanionSessionId, submitToOpenClawAgent } from "./openclawAgentClient";
import { intentCanvas } from "./canvas";
import { markSubmittedRunFailed, rememberSubmittedRun } from "./runs";
import { buildAutoSkillContextForIntent } from "./skills";
import type { OpenClawAgentSubmitResult } from "./openclawAgentClient";
import type { IntentAttachment, IntentSubmitResponse } from "./types";

export async function submitIntent(
  text: string,
  sessionId = "default",
  attachments: IntentAttachment[] = [],
  options: { userText?: string; clientRunId?: string } = {},
): Promise<IntentSubmitResponse> {
  const normalized = text.trim();
  const visibleUserText = (options.userText || normalized).trim();
  const normalizedSessionId = normalizeCompanionSessionId(sessionId);
  if (!normalized) {
    return {
      success: false,
      runId: "",
      clientRunId: options.clientRunId,
      sessionId: normalizedSessionId,
      result: "",
      message: "Intent text is required.",
      canvas: intentCanvas(""),
    };
  }

  const runId = `run_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const gateway = await getGatewayStatus();
  if (!gateway.reachable) {
    return {
      success: false,
      runId,
      clientRunId: options.clientRunId,
      sessionId: normalizedSessionId,
      result: gateway.message,
      message: gateway.message,
      canvas: intentCanvas(visibleUserText, gateway.message),
      attachments,
    };
  }

  const accepted = acceptedRun(runId, normalizedSessionId);
  const promptWithAttachments = appendAttachmentContext(normalized, attachments);
  const routed = buildAutoSkillContextForIntent(promptWithAttachments);
  const submittedPrompt = routed?.prompt || promptWithAttachments;
  await rememberSubmittedRun(submittedPrompt, accepted, { userText: visibleUserText, attachments });
  void submitIntentInBackground(submittedPrompt, runId, normalizedSessionId, visibleUserText, attachments);

  const message = describeOpenClawResult(accepted);
  return {
    success: true,
    runId,
    clientRunId: options.clientRunId,
    sessionId: normalizedSessionId,
    state: "running",
    result: message,
    message,
    userText: visibleUserText,
    canvas: intentCanvas(visibleUserText, message),
    attachments,
    gatewayRun: includeRawIntent() ? { ...accepted, skillRouting: routed?.routed } : undefined,
  };
}

async function submitIntentInBackground(
  text: string,
  runId: string,
  sessionId: string,
  userText: string,
  attachments: IntentAttachment[],
) {
  try {
    const openclaw = await submitToOpenClawAgent(text, runId, sessionId);
    await rememberSubmittedRun(text, {
      ...openclaw,
      runId,
      sessionId,
    }, { userText, attachments });
  } catch (error: any) {
    await markSubmittedRunFailed(
      runId,
      `OpenClaw gateway accepted the connection but did not run the intent: ${error?.message || error}`,
    );
  }
}

function appendAttachmentContext(text: string, attachments: IntentAttachment[]) {
  const imageAttachments = attachments.filter((attachment) =>
    String(attachment.type || "").toLowerCase() === "image" && (attachment.path || attachment.serverPath),
  );
  if (imageAttachments.length === 0) return text;

  const attachmentLines = imageAttachments.map((attachment, index) => {
    const label = attachment.displayName || attachment.id || `image-${index + 1}`;
    const mime = attachment.mimeType ? `, ${attachment.mimeType}` : "";
    const size = attachment.sizeBytes ? `, ${attachment.sizeBytes} bytes` : "";
    return `- ${label}${mime}${size}: ${attachment.path || attachment.serverPath}`;
  });

  return [
    text,
    "",
    "Attached image files are available on the local Termux filesystem:",
    ...attachmentLines,
    "Use these image paths as supporting evidence when the task depends on the shared image.",
  ].join("\n");
}

function acceptedRun(runId: string, sessionId: string): OpenClawAgentSubmitResult {
  return {
    runId,
    sessionId,
    sessionKey: expectedCompanionSessionKey(sessionId),
    status: "accepted",
    acceptedAt: Date.now(),
    waitedForFinal: false,
    raw: {
      accepted: true,
      mode: "background",
    },
  };
}

function includeRawIntent() {
  return ["1", "true", "yes"].includes((process.env.CLAWMOBILE_INTENT_INCLUDE_RAW || "").toLowerCase());
}
