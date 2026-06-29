# ClawMobile Runtime Protocol v1

**Status:** draft shared contract  
**Audience:** Android app, iOS app, Termux/OpenClaw companion server, future cloud or desktop runtimes  
**Last updated:** 2026-06-29

## Purpose

ClawMobile clients should be able to talk to different runtime backends through
one stable protocol. A backend may be:

- Android Termux + OpenClaw;
- an iOS app-local runtime;
- another phone on the LAN or Tailscale;
- a desktop/server/cloud runtime.

The protocol does not require every backend to support the same tools. Instead,
every backend must expose a small common task API and a capability description
that tells clients what optional features are available.

## Stability Rules

This document defines the v1 wire contract. Additive changes are allowed:

- servers may add optional fields to existing objects;
- clients must ignore unknown fields and preserve them for diagnostics where
  practical;
- clients should not assume every optional endpoint or feature is present;
- required fields should not be renamed or removed inside `/v1`.

Breaking changes should use a new namespace such as `/v2`.

## Compatibility Model

`/v1` is the cross-platform runtime protocol namespace.

Legacy Android companion endpoints such as `/intent`, `/runs`, `/skills`, and
`/runtime/log` are historical implementation details. They are not part of the
v1 contract, and v1 clients must call `/v1` endpoints directly.

During migration, implementations may use the old endpoint behavior internally,
but exposed routes should use the v1 namespace. Clients should be liberal
readers:

- accept `camelCase` and `snake_case`;
- accept ISO-8601 timestamps, epoch seconds, and epoch milliseconds;
- normalize run states such as `queued`, `pending`, `running`, `done`,
  `completed`, `success`, `failed`, `cancelled`, and `waiting_for_approval`;
- preserve unknown fields for debugging where the platform makes that easy.

## Transport

The baseline transport is HTTP JSON.

Streaming is optional in v1:

```text
WS /v1/events
```

If WebSocket events are not supported, clients must be able to poll run status.

Clients should send these headers when possible:

```text
Accept: application/json
Content-Type: application/json
Authorization: Bearer <pairing-token>
X-ClawMobile-Client: android
X-ClawMobile-Request-Id: req_<client-generated-id>
```

`Authorization` may be omitted for an explicitly local, unpaired runtime. Remote
LAN, Tailscale, desktop, and cloud runtimes should require it for every endpoint
except unauthenticated pairing/bootstrap routes.

Suggested `X-ClawMobile-Client` values are `android`, `ios`, `desktop`, and
`cloud`. Clients may append version detail in `User-Agent`.

## Error Model

Non-2xx HTTP responses should use a common JSON shape:

```json
{
  "success": false,
  "error": {
    "code": "auth_required",
    "message": "Pairing token is missing or invalid.",
    "retryable": false,
    "details": {}
  },
  "requestId": "req_abc123"
}
```

Recommended HTTP status mapping:

| Status | Meaning |
| --- | --- |
| `400` | Invalid JSON, invalid query parameter, or malformed request. |
| `401` | Missing or invalid authentication. |
| `403` | Authenticated but not permitted by pairing, policy, or capability scope. |
| `404` | Run, session, skill, artifact, approval, or extension route not found. |
| `409` | State conflict, for example approving an already resolved approval. |
| `413` | Attachment or request payload too large. |
| `422` | Valid JSON but semantically invalid inputs. |
| `429` | Rate limited or runtime concurrency limit reached. |
| `500` | Backend bug or unexpected runtime failure. |
| `503` | Runtime dependency unavailable, such as Termux/OpenClaw not running. |

Common error codes should be stable strings such as:

```text
bad_request
auth_required
forbidden
not_found
state_conflict
payload_too_large
validation_failed
rate_limited
runtime_unavailable
tool_unavailable
approval_required
internal_error
```

Successful command responses may continue to use the lightweight
`{ "success": true, "message": "..." }` shape.

## Authentication and Pairing

Remote execution must be explicitly paired. A backend should maintain a trust
record per client device:

```json
{
  "clientId": "ios-device-abc",
  "clientName": "Alice iPhone",
  "platform": "ios",
  "trustStatus": "paired",
  "scopes": ["runs:create", "runs:read", "skills:read"],
  "createdAt": "2026-06-29T10:00:00Z",
  "lastSeenAt": "2026-06-29T10:24:03Z"
}
```

Trust status values:

```text
unpaired | paired | revoked
```

Pairing endpoints are intentionally outside the required core surface because
local-only and cloud runtimes may pair differently. Implementations may expose
pairing routes under an extension namespace, for example:

```text
/v1/extensions/pairing/challenge
/v1/extensions/pairing/confirm
/v1/extensions/pairing/revoke
```

Before a client is paired, a remote backend should make pairing discoverable in
one of two ways:

- allow unauthenticated `GET /v1/capabilities` that returns only safe bootstrap
  fields and the pairing extension routes;
- or expose fixed unauthenticated pairing routes and document them out of band,
  for example in a QR code, setup screen, or local network discovery response.

Unauthenticated capabilities must not advertise runnable tools, existing runs,
sessions, logs, artifacts, or private device metadata.

Capabilities may be scoped by the current token. A backend should only advertise
tools, extension routes, and feature states that the authenticated client can use.
High-risk actions must still use approval checks even after pairing.

## Required Endpoints

Every v1 backend should implement:

```text
GET  /v1/health
GET  /v1/capabilities
POST /v1/runs
GET  /v1/runs?limit=100
GET  /v1/runs/{runId}
```

This is enough for a client to check readiness, understand backend features,
start a task, show history, and poll task completion.

## Recommended Endpoints

Backends should implement these when the feature is meaningful:

```text
POST   /v1/runs/{runId}/cancel
GET    /v1/sessions
POST   /v1/sessions
POST   /v1/sessions/{sessionId}/archive
DELETE /v1/sessions/{sessionId}

POST   /v1/attachments
GET    /v1/attachments/{attachmentId}/content
GET    /v1/artifacts/{artifactId}

GET    /v1/runtime/log?maxBytes=64000
POST   /v1/runtime/start
POST   /v1/runtime/restart
POST   /v1/runtime/stop

GET    /v1/skills
POST   /v1/skills/route
GET    /v1/skills/{skillId}
POST   /v1/skills/{skillId}/preview
POST   /v1/skills/{skillId}/run
GET    /v1/skills/{skillId}/runs
GET    /v1/skill-runs/{runId}

GET    /v1/approvals?runId={runId}
GET    /v1/approvals/{approvalId}
POST   /v1/approvals/{approvalId}
```

## Extensions

Platform-specific features should not be required by the core protocol. They can
be exposed as extensions and advertised through `/v1/capabilities`.

Suggested namespace:

```text
/v1/extensions/{namespace}/...
```

Examples:

```text
/v1/extensions/android/terminal/command
/v1/extensions/nostr/contacts
/v1/extensions/nostr/inbox
/v1/extensions/skill-sharing/imports
```

Android-specific routes should be exposed through extension namespaces instead
of top-level legacy paths such as `/terminal/*`, `/nostr/*`, `/agent/*`,
`/skill-imports/*`, or `/skills/{skillId}/share`.

Extensions should be discoverable. Each advertised extension may include route
metadata so clients and agents can decide what is callable:

```json
{
  "namespace": "android",
  "basePath": "/v1/extensions/android",
  "status": "available",
  "routes": [
    {
      "id": "terminal.command",
      "method": "POST",
      "path": "terminal/command",
      "label": "Run Terminal Command",
      "risk": "high",
      "requiresApproval": true,
      "inputSchema": {
        "type": "object",
        "properties": {
          "command": { "type": "string" },
          "timeoutMs": { "type": "integer" }
        },
        "required": ["command"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "exitCode": { "type": "integer" },
          "stdout": { "type": "string" },
          "stderr": { "type": "string" }
        }
      }
    }
  ]
}
```

`routes[].path` is relative to `basePath`. In the example above, the full route
is `/v1/extensions/android/terminal/command`. Route `status` uses the same
values as feature status, such as `available`, `local_only`, `setup_required`,
or `unavailable`.

`inputSchema` and `outputSchema` are recommended, but extension routes may
initially advertise only `id`, `method`, `path`, `status`, `risk`, and
`requiresApproval`. Core clients may ignore unknown extensions. Agent runtimes
should treat extension route metadata as capability discovery, not as permission
to bypass approval.

## Health

```text
GET /v1/health
```

Response:

```json
{
  "status": "connected",
  "message": "Runtime is ready.",
  "version": "0.4.1",
  "stage": "ready",
  "checks": [
    {
      "id": "runtime",
      "label": "Runtime",
      "state": "online",
      "detail": "OpenClaw gateway is reachable."
    }
  ]
}
```

`status` values:

```text
connected | disconnected | unknown
```

`checks[].state` values:

```text
online | degraded | offline | unknown
```

## Capabilities

```text
GET /v1/capabilities
```

This endpoint tells the frontend what a backend can do. It is the main mechanism
for making Android, iOS, cloud, and desktop runtimes compatible without forcing
them to expose identical tools.

Response:

```json
{
  "platform": "android",
  "runtime": "termux-openclaw",
  "version": "0.4.1",
  "features": {
    "tasks": "available",
    "sessions": "available",
    "skills": "available",
    "attachments": "available",
    "artifacts": "planned",
    "approvals": "planned",
    "events": "unavailable",
    "runtimeLifecycle": "available",
    "runtimeLog": "available",
    "notifications": "frontend",
    "adb": "available",
    "ocr": "setup_required",
    "terminal": "local_only",
    "social": "available",
    "appIntents": "unavailable"
  },
  "tools": [
    {
      "id": "android_health",
      "label": "Android Health",
      "description": "Read Android runtime health and setup status.",
      "status": "available",
      "risk": "low",
      "requiresApproval": false,
      "extension": "android",
      "permissions": [],
      "inputSchema": {
        "type": "object",
        "properties": {}
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "message": { "type": "string" }
        }
      },
      "availabilityReason": null
    }
  ],
  "extensions": [
    {
      "namespace": "nostr",
      "basePath": "/v1/extensions/nostr",
      "status": "available",
      "routes": []
    }
  ]
}
```

Feature status values:

```text
available | setup_required | unavailable | local_only | frontend | planned
```

`frontend` means the capability is handled by the client app rather than the
backend. For example, mobile notifications may be posted by the Android/iOS app
after polling a run to completion.

Tool risk values:

```text
low | medium | high | critical
```

Tool status values:

```text
available | setup_required | unavailable | permission_required | planned
```

`requiresApproval` means the backend must pause the run and create an approval
request before executing the tool or extension route. Clients should still show
risk and permission information before starting a run when it is known.

## Create Run

```text
POST /v1/runs
```

Request:

```json
{
  "clientRunId": "client-run-abc123",
  "instruction": "Summarize the shared web page and list any action items.",
  "displayText": "Summarize this link\nhttps://example.com",
  "sessionId": "share-2026-06-29",
  "attachments": [],
  "source": {
    "surface": "share",
    "actionId": "webpage.summarize",
    "contentType": "text/uri-list"
  },
  "metadata": {
    "client": "android"
  }
}
```

Fields:

- `clientRunId`: optional client-generated idempotency key. If the same client
  retries the same request, the backend should return the original accepted run
  when practical. The idempotency scope is `clientId + clientRunId`, where
  `clientId` is the paired client identity or another stable authenticated
  client identifier. If the same client repeats the same `clientRunId` with the
  same request body, the backend should return the original run. If the body is
  materially different, the backend should return `409 state_conflict`.
- `instruction`: the complete instruction sent to the agent. This may include
  hidden context or prompt scaffolding.
- `displayText`: the user-facing text that clients should show in task/chat UI.
- `sessionId`: client-selected conversation/session id.
- `attachments`: attachment references.
- `source`: where this run came from, such as `task`, `share`, `skill`,
  `social`, or `automation`.
- `metadata`: optional backend-agnostic metadata.

Legacy compatibility:

```json
{
  "text": "Do something",
  "sessionId": "default",
  "attachments": []
}
```

If `instruction` is missing, the server should treat `text` as the instruction.
If `displayText` is missing, the server should use `userText`, then `text`, then
`instruction` as the visible user text.

Response:

```json
{
  "success": true,
  "message": "Task accepted.",
  "runId": "run_abc123",
  "clientRunId": "client-run-abc123",
  "sessionId": "share-2026-06-29",
  "state": "running",
  "userText": "Summarize this link\nhttps://example.com",
  "attachments": [],
  "requestId": "req_abc123"
}
```

## Run Status

```text
GET /v1/runs/{runId}
```

Response:

```json
{
  "success": true,
  "runId": "run_abc123",
  "sessionId": "share-2026-06-29",
  "state": "done",
  "message": "Task complete.",
  "result": "The page explains...",
  "pendingApprovals": [],
  "progress": {
    "text": "Finished",
    "detail": "Final answer is ready.",
    "updatedAt": "2026-06-29T10:24:03Z",
    "events": [
      {
        "type": "tool_call",
        "label": "Opened browser",
        "detail": "Loaded https://example.com",
        "at": "2026-06-29T10:23:55Z"
      }
    ]
  },
  "prompt": "Summarize the shared web page and list any action items.",
  "userText": "Summarize this link\nhttps://example.com",
  "attachments": [],
  "startedAt": "2026-06-29T10:23:40Z",
  "updatedAt": "2026-06-29T10:24:03Z",
  "runtimeMs": 23000,
  "tokenUsage": {
    "inputTokens": 12000,
    "outputTokens": 900,
    "totalTokens": 12900,
    "cachedTokens": 8000,
    "reasoningTokens": 300,
    "estimatedCostUsd": 0.0123,
    "estimatedCost": "$0.0123"
  }
}
```

Run states:

```text
queued | running | waiting_for_approval | done | failed | cancelled | unknown
```

Clients should treat `done`, `failed`, and `cancelled` as terminal.

When a run is waiting for user approval, the run status should include compact
approval cards so clients know what to render without an additional discovery
request:

```json
{
  "state": "waiting_for_approval",
  "pendingApprovals": [
    {
      "approvalId": "approval_abc123",
      "title": "Run terminal command?",
      "risk": "high",
      "kind": "tool_call"
    }
  ]
}
```

Recommended state transitions:

```text
queued -> running
running -> waiting_for_approval
waiting_for_approval -> running
running -> done
running -> failed
queued|running|waiting_for_approval -> cancelled
```

`POST /v1/runs/{runId}/cancel` should be idempotent. Cancelling a terminal run
should return the current terminal run status rather than creating a new failure.
Backends may reject cancellation when the underlying platform cannot stop the
operation, but they should report the resulting state clearly.

## List Runs

```text
GET /v1/runs?limit=100
```

Response:

```json
{
  "runs": [],
  "nextCursor": null
}
```

Wrapped list responses are preferred over bare arrays so future pagination and
warnings can be added without changing the shape.

## Attachments

```text
POST /v1/attachments
```

This endpoint is optional but recommended for remote image/file shares.

Clients may upload files first and then reference the returned attachment in
`POST /v1/runs`.

Backends should support `multipart/form-data` for binary uploads. JSON-only
backends may support base64 payloads for small files, but clients should prefer
multipart when it is available. Backends should document `maxBytes` in
`/v1/capabilities` when they enforce a limit.

Attachment object:

```json
{
  "id": "client-attachment-id",
  "type": "image",
  "mimeType": "image/png",
  "displayName": "screenshot.png",
  "sizeBytes": 123456,
  "serverId": "att_abc123",
  "serverPath": "/home/user/.clawmobile/companion-attachments/att_abc123.png",
  "downloadUrl": "/v1/attachments/att_abc123/content",
  "expiresAt": null
}
```

The backend should not expose local filesystem paths to remote clients unless the
path is meaningful and safe for that client. Prefer `serverId` and
`downloadUrl` for cross-device clients. Treat `serverPath` as a legacy/local
backend hint, not as the portable way to read attachment bytes.

## Runtime Lifecycle and Log

```text
POST /v1/runtime/start
POST /v1/runtime/restart
POST /v1/runtime/stop
GET  /v1/runtime/log?maxBytes=64000
```

Lifecycle endpoints are optional. An app-local iOS runtime may report them as
`unavailable` or implement them as no-ops, while an Android Termux backend can
use them to start or restart the OpenClaw gateway.

Command response:

```json
{
  "success": true,
  "message": "Runtime start command was sent."
}
```

Log response:

```json
{
  "success": true,
  "message": "Runtime log loaded.",
  "text": "...",
  "path": "/tmp/openclaw-gateway.log",
  "exists": true,
  "size": 2048,
  "truncated": false,
  "updatedAt": "2026-06-29T10:24:03Z"
}
```

## Skills

Skills are optional, but backends that expose a skills library should use these
routes:

```text
GET  /v1/skills
POST /v1/skills/route
GET  /v1/skills/{skillId}
POST /v1/skills/{skillId}/preview
POST /v1/skills/{skillId}/run
GET  /v1/skills/{skillId}/runs
GET  /v1/skill-runs/{runId}
```

The first version may reuse the current Android skill JSON shape. Required
client-visible fields for a skill summary:

```json
{
  "id": "skill_id",
  "name": "Skill Name",
  "description": "What this skill does.",
  "status": "trusted",
  "risk": "low",
  "source": "generated",
  "scope": "app",
  "tags": [],
  "primaryUse": "When to use it.",
  "requiresConfirmation": false
}
```

## Approvals

Approvals are optional in the HTTP surface, but they are required for backends
that expose high-risk tools or extension routes.

Approval request object:

```json
{
  "approvalId": "approval_abc123",
  "runId": "run_abc123",
  "sessionId": "share-2026-06-29",
  "status": "pending",
  "kind": "tool_call",
  "title": "Run terminal command?",
  "detail": "The Android runtime wants to execute a shell command.",
  "risk": "high",
  "toolId": "android_terminal_command",
  "proposedAction": {
    "command": "ls -la",
    "timeoutMs": 10000
  },
  "createdAt": "2026-06-29T10:23:55Z"
}
```

Approval statuses:

```text
pending | approved | denied | expired | cancelled
```

Resolve an approval:

```text
POST /v1/approvals/{approvalId}
```

Request:

```json
{
  "decision": "approved",
  "message": "Allowed for this run only."
}
```

Decision values:

```text
approved | denied
```

After an approval is resolved, the run should either resume or move to `failed`
or `cancelled` with a clear message. Resolving an already resolved approval
should return `409 state_conflict` or the current approval object.

List or fetch approvals:

```text
GET /v1/approvals?runId=run_abc123
GET /v1/approvals/approval_abc123
```

Wrapped list response:

```json
{
  "approvals": [],
  "nextCursor": null
}
```

## Events

```text
WS /v1/events
```

Optional event payload:

```json
{
  "eventId": "evt_abc123",
  "sequence": 42,
  "type": "run.updated",
  "runId": "run_abc123",
  "sessionId": "share-2026-06-29",
  "state": "running",
  "message": "Reading screen...",
  "at": "2026-06-29T10:23:55Z",
  "data": {}
}
```

Event types should be extensible. Suggested core event types:

```text
run.created
run.updated
run.completed
run.failed
tool.called
tool.output
approval.requested
approval.resolved
token_usage.updated
log.line
```

`eventId` should be globally unique within the backend. `sequence` should be
monotonic per backend or per run so clients can de-duplicate events. WebSocket
clients should be able to reconnect with a cursor when the backend supports it:

```text
WS /v1/events?sinceSequence=42
```

If the backend cannot replay events, it should advertise `events: "available"`
but omit replay support in capabilities. Clients must still be able to poll
`GET /v1/runs/{runId}` to recover the latest state.

## Security

Remote execution must be explicit and auditable:

- clients should show the active runtime target before starting a task;
- remote endpoints should use a pairing token or another explicit trust flow;
- high-risk tools should require approval;
- logs and run history should make backend actions inspectable;
- extension capabilities should not imply permission to run high-risk actions.

LAN or Tailscale reachability does not replace ClawMobile pairing, capability
policy, or approval checks.

## Android Historical Mapping

This table documents how the original Android companion routes map to v1. It is
for migration review only; v1 servers do not need to keep these legacy routes
available.

| Legacy route | v1 route | Notes |
| --- | --- | --- |
| `GET /health` | `GET /v1/health` | Same response shape is acceptable initially. |
| `POST /intent` | `POST /v1/runs` | Accept `instruction/displayText`; fallback to `text`. |
| `GET /runs` | `GET /v1/runs` | Return `{ "runs": [...] }`. |
| `GET /runs/:runId` | `GET /v1/runs/:runId` | Same run status object. |
| `POST /attachments` | `POST /v1/attachments` | Same upload behavior. |
| `GET /runtime/log` | `GET /v1/runtime/log` | Same query parameter. |
| `POST /runtime/start` | `POST /v1/runtime/start` | Same command result. |
| `POST /runtime/restart` | `POST /v1/runtime/restart` | Same command result. |
| `POST /runtime/stop` | `POST /v1/runtime/stop` | Same command result. |
| `GET /skills` | `GET /v1/skills` | Prefer wrapped list response. |
| `POST /skills/route` | `POST /v1/skills/route` | Same request initially. |
| `GET /skills/:id` | `GET /v1/skills/:id` | Same response initially. |
| `POST /skills/:id/preview` | `POST /v1/skills/:id/preview` | Same response initially. |
| `POST /skills/:id/run` | `POST /v1/skills/:id/run` | Same response initially. |
| `GET /skills/:id/runs` | `GET /v1/skills/:id/runs` | Same wrapped list response. |
| `GET /skill-runs/:runId` | `GET /v1/skill-runs/:runId` | Same response initially. |

Do not require every Android-specific capability to move into the core protocol.
Nostr/social, terminal, skill sharing, and skill import should remain
extensions.

## Implementation Order

1. Switch the Termux/OpenClaw companion server public routes to `/v1`.
2. Add `GET /v1/capabilities` with feature statuses, tool schemas, and
   extension route discovery.
3. Upgrade `POST /v1/runs` to support `clientRunId`, `instruction`,
   `displayText`, `source`, and existing text fallbacks.
4. Update Android `HttpRuntimeClient` to call `/v1` for core operations.
5. Update iOS share/task flows to send structured `RunCreateRequest`.
6. Add the common error model and request id propagation.
7. Add pairing-token auth for non-local runtime endpoints.
8. Add approval read/resolve routes for high-risk tools and extension routes.
9. Add WebSocket events only after HTTP polling is stable across Android and iOS.
