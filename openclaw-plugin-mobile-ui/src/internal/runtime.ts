import { appendToolAudit } from "../tools/workspace";

export function runtimeEnvFlags() {
  return {
    DROIDRUN_SERIAL: process.env.DROIDRUN_SERIAL || "",
    DROIDRUN_PROVIDER: process.env.DROIDRUN_PROVIDER || "",
    DROIDRUN_MODEL: process.env.DROIDRUN_MODEL || "",
    CLAW_MOBILE_PYTHON: process.env.CLAW_MOBILE_PYTHON || "",
    DROIDRUN_USE_TCP: process.env.DROIDRUN_USE_TCP || "",
    OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
    GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
    ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    DEEPSEEK_API_KEY: Boolean(process.env.DEEPSEEK_API_KEY),
  };
}

export function auditStart(tool: string, backend: string, start: number) {
  appendToolAudit({
    time: new Date(start).toISOString(),
    tool,
    phase: "start",
    backend,
    cwd: process.cwd(),
    env: runtimeEnvFlags(),
  });
}

export function auditEnd(tool: string, start: number, res: any, extra?: Record<string, any>) {
  appendToolAudit({
    time: new Date().toISOString(),
    tool,
    phase: "end",
    ok: Boolean((res as any)?.ok),
    elapsed_ms: Date.now() - start,
    error: (res as any)?.error,
    stderr: (res as any)?.extra?.stderr_snip || (res as any)?.stderr,
    exit_code: (res as any)?.extra?.exit_code,
    ...(extra || {}),
  });
}

export function auditError(tool: string, start: number, error: unknown, extra?: Record<string, any>) {
  appendToolAudit({
    time: new Date().toISOString(),
    tool,
    phase: "end",
    ok: false,
    elapsed_ms: Date.now() - start,
    error: String((error as any)?.message || error || "unknown_error"),
    ...(extra || {}),
  });
}
