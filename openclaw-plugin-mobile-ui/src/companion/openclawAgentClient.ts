import { spawn } from "child_process";

export type OpenClawAgentSubmitResult = {
  runId: string;
  sessionId: string;
  sessionKey?: string;
  status?: string;
  acceptedAt?: number;
  waitedForFinal: boolean;
  raw: any;
};

const DEFAULT_SUBMIT_TIMEOUT_MS = 15_000;
const DEFAULT_FINAL_TIMEOUT_MS = 120_000;
const DEFAULT_GATEWAY_CALL_TIMEOUT_MS = 10_000;

export async function submitToOpenClawAgent(
  text: string,
  runId: string,
  sessionId = "default",
): Promise<OpenClawAgentSubmitResult> {
  const waitedForFinal = shouldWaitForFinal();
  const timeoutMs = configuredTimeoutMs(waitedForFinal);
  const normalizedSessionId = normalizeCompanionSessionId(sessionId);
  const sessionKey = companionSessionKey(normalizedSessionId);
  const agentId = (process.env.CLAWMOBILE_AGENT_ID || "").trim();
  const params = {
    sessionKey,
    ...(agentId ? { agentId } : {}),
    label: "ClawMobile Companion",
    message: text,
    deliver: false,
    bootstrapContextMode: "lightweight",
    idempotencyKey: runId,
  };

  const raw = await callOpenClawGateway("agent", params, {
    expectFinal: waitedForFinal,
    timeoutMs,
  });
  return {
    runId: String(raw?.runId || runId),
    sessionId: normalizedSessionId,
    sessionKey: typeof raw?.sessionKey === "string" ? raw.sessionKey : undefined,
    status: typeof raw?.status === "string" ? raw.status : undefined,
    acceptedAt: typeof raw?.acceptedAt === "number" ? raw.acceptedAt : undefined,
    waitedForFinal,
    raw,
  };
}

export async function callOpenClawGateway(
  method: string,
  params: Record<string, any> = {},
  options: { expectFinal?: boolean; timeoutMs?: number } = {},
): Promise<any> {
  const timeoutMs = options.timeoutMs || DEFAULT_GATEWAY_CALL_TIMEOUT_MS;
  const args = ["gateway", "call", method, "--json", "--timeout", String(timeoutMs), "--params", JSON.stringify(params)];
  if (options.expectFinal) {
    args.splice(3, 0, "--expect-final");
  }
  return runOpenClaw(args, timeoutMs + 5_000);
}

export function describeOpenClawResult(result: OpenClawAgentSubmitResult) {
  if (result.waitedForFinal) {
    const text = extractText(result.raw);
    if (text) return text;
    return `OpenClaw finished run ${result.runId}.`;
  }

  return "OpenClaw is working on your task.";
}

function runOpenClaw(args: string[], hardTimeoutMs: number): Promise<any> {
  const command = process.env.CLAWMOBILE_OPENCLAW_BIN || "openclaw";

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`OpenClaw gateway call timed out after ${hardTimeoutMs}ms.`));
    }, hardTimeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const out = Buffer.concat(stdout).toString("utf8").trim();
      const err = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(err || out || `OpenClaw gateway call exited with code ${code}.`));
        return;
      }

      try {
        resolve(parseJsonOutput(out));
      } catch (error: any) {
        reject(new Error(`OpenClaw gateway returned invalid JSON: ${error?.message || error}`));
      }
    });
  });
}

function parseJsonOutput(output: string) {
  if (!output) return {};
  try {
    return JSON.parse(output);
  } catch {
    const first = output.indexOf("{");
    const last = output.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(output.slice(first, last + 1));
    }
    throw new Error("no JSON object found");
  }
}

function companionSessionKey(sessionId: string) {
  return `companion-chat-${normalizeCompanionSessionId(sessionId)}`;
}

export function expectedCompanionSessionKey(sessionId: string) {
  const agentId = (process.env.CLAWMOBILE_AGENT_ID || "main").trim() || "main";
  return `agent:${agentId}:${companionSessionKey(sessionId)}`;
}

export function normalizeCompanionSessionId(sessionId: string) {
  const safe = (sessionId || "default")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return safe || "default";
}

function shouldWaitForFinal() {
  return ["1", "true", "yes"].includes((process.env.CLAWMOBILE_INTENT_WAIT_FOR_FINAL || "").toLowerCase());
}

function configuredTimeoutMs(waitedForFinal: boolean) {
  const raw = Number.parseInt(process.env.CLAWMOBILE_INTENT_TIMEOUT_MS || "", 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return waitedForFinal ? DEFAULT_FINAL_TIMEOUT_MS : DEFAULT_SUBMIT_TIMEOUT_MS;
}

function extractText(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  for (const key of ["result", "message", "text", "output", "summary"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return value[key].trim();
    }
  }
  if (value.final) return extractText(value.final);
  if (value.response) return extractText(value.response);
  return "";
}
