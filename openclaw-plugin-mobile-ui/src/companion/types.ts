export type RuntimeCommandState = "not_started" | "running" | "failed";

export type GatewayStatus = {
  host: string;
  port: number;
  reachable: boolean;
  message: string;
};

export type ModelKeyStatus = {
  configured: boolean;
  provider?: string;
  message: string;
};

export type CompanionHealth = {
  status: "ok" | "degraded";
  message: string;
  version: string;
  gateway: GatewayStatus;
  runtime: any;
  model?: ModelKeyStatus;
};

export type IntentRequest = {
  text: string;
  sessionId?: string;
  attachments?: IntentAttachment[];
};

export type IntentAttachment = {
  id: string;
  clientId?: string;
  type: "image" | string;
  mimeType?: string;
  displayName?: string;
  sizeBytes?: number;
  path?: string;
  createdAt?: number;
};

export type TerminalCommandRequest = {
  command: string;
};

export type TerminalCommandResponse = {
  success: boolean;
  command: string;
  cwd: string;
  output: string;
  message: string;
  exitCode?: number;
  durationMs?: number;
};

export type TerminalSessionRequest = {
  text: string;
};

export type TerminalSessionResponse = {
  success: boolean;
  message: string;
  output: string;
  cwd: string;
  running: boolean;
  pid?: number;
  updatedAt: number;
};

export type IntentSubmitResponse = {
  success: boolean;
  runId: string;
  sessionId?: string;
  state?: CompanionRunStatus["state"];
  result: string;
  message: string;
  userText?: string;
  canvas: CanvasSchema;
  attachments?: IntentAttachment[];
  gatewayRun?: unknown;
};

export type CompanionRunStatus = {
  success: boolean;
  runId: string;
  sessionId?: string;
  sessionKey?: string;
  state: "running" | "done" | "failed" | "unknown";
  status?: string;
  message: string;
  result?: string;
  progress?: CompanionRunProgress;
  prompt?: string;
  userText?: string;
  attachments?: IntentAttachment[];
  submittedAt?: number;
  startedAt?: number;
  updatedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  tokenUsage?: CompanionRunTokenUsage;
  canvas?: CanvasSchema;
  raw?: unknown;
};

export type CompanionRunTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  estimatedCost?: string;
};

export type CompanionRunProgress = {
  text: string;
  detail?: string;
  updatedAt?: number;
  events: CompanionRunProgressEvent[];
};

export type CompanionRunProgressEvent = {
  type: string;
  label: string;
  detail?: string;
  at?: number;
  seq?: number;
};

export type RuntimeCommandResponse = {
  success: boolean;
  state: RuntimeCommandState;
  message: string;
  gateway: GatewayStatus;
};

export type RuntimeLogResponse = {
  success: boolean;
  message: string;
  path: string;
  text: string;
  exists: boolean;
  size: number;
  truncated: boolean;
  updatedAt?: number;
};

export type CanvasSchema = {
  title: string;
  summary?: string;
  fields: CanvasField[];
  actions: CanvasAction[];
};

export type CanvasField = {
  id: string;
  label: string;
  type: "Text" | "Checkbox";
  textValue?: string;
  checked?: boolean;
};

export type CanvasAction = {
  id: string;
  label: string;
};
