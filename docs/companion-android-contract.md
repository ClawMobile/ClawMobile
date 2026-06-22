# Companion Android Contract

This note is for the Android companion frontend implementation and the backend
agent maintaining the Termux companion server.

The `companion-server-mvp` branch already contains the current companion server
implementation in `openclaw-plugin-mobile-ui/src/companion/`. Backend agents
should sync to that state, verify it against this contract, and only fill gaps
or fix bugs. Do not reimplement the same API surface from scratch.

## Current Android State

The latest Android frontend already has a skill library MVP:

- models in `runtime/SkillModels.kt`;
- HTTP bindings in `runtime/http/HttpRuntimeClient.kt`;
- UI in `ui/screens/SkillsScreen.kt`;
- existing calls for list/detail/preview/run/fast-path/run-history.

So the next step is sync, verification, and incremental fixes, not a rewrite.

Current backend compatibility notes:

- `POST /skills/:skillId/preview`, `/run`, and `/fast-paths/:fastPathId/run`
  already accept the frontend's `{ inputs: ... }` body.
- `GET /skills/:skillId/runs` and `GET /skill-runs/:runId` are compatibility
  aliases for the Android skill history UI.
- skill run responses include both `state` and Android-facing `status`.
- the Android app already consumes `appPackage`, `routeCount`, `appModel`,
  `knowledgeShortcuts`, `executionRoutes`, `executionState`,
  `recommendedAction`, `missingInputs`, `eligibleFastPaths`, and
  `routeSkills(...)`.

## Runtime And Chat Contract

The Android app talks to the companion server at `http://127.0.0.1:8765`.

Runtime endpoints currently used by the Android app and covered by the current
companion server work:

```text
GET    /health
POST   /attachments
POST   /runtime/start
POST   /runtime/stop
GET    /runtime/log?maxBytes=64000
POST   /terminal/command
GET    /terminal/session
POST   /terminal/session/input
POST   /terminal/session/reset
POST   /intent
GET    /runs?limit=100
GET    /runs/:runId
POST   /sessions/:sessionId/archive
DELETE /sessions/:sessionId
GET    /nostr/status
POST   /nostr/setup-key
GET    /nostr/contacts
POST   /nostr/contacts
DELETE /nostr/contacts/:contactId
POST   /nostr/send
GET    /nostr/inbox
GET    /agent/conversations
GET    /agent/conversations/:agentId/messages
POST   /agent/conversations/:agentId/messages
DELETE /agent/conversations/:agentId/messages
POST   /agent/inbox/fetch
POST   /agent/messages/:messageId/read
POST   /skills/:skillId/share
POST   /skills/:skillId/share/nostr
GET    /skill-imports
POST   /skill-imports
POST   /skill-imports/:importId/accept
POST   /skill-imports/:importId/reject
```

For chat history and unread badges, keep these fields stable:

- `sessionId`: groups runs into one chat.
- `state`: `running`, `done`, or `failed`.
- `result`: final assistant text.
- `updatedAt`: changes when the final result or failure arrives.
- `progress.events`: tool activity and interim status.
- `userText`, `inputText`, or `intentText`: original user-visible request.
- `attachments`: optional image references uploaded before the intent.

Do not make the Android app display an auto-expanded OpenClaw prompt as the
user message. If the server injects compact skill context, preserve the
original request in `userText`.

Nostr and skill-import endpoints are local companion operations. The backend
keeps them loopback-only by default, like the terminal endpoints.

Image input is a two-step flow:

```text
POST /attachments
POST /intent
```

`POST /attachments` receives a raw `image/*` body, saves it to a Termux-local
path, and returns an object with `id`, `type`, `mimeType`, `displayName`,
`sizeBytes`, and `path`. `POST /intent` then includes that object in
`attachments[]`. The server may append the attachment path to the internal
OpenClaw prompt, but the frontend should continue to receive the original
user-facing text through `userText`.

Token usage is optional and does not require an extra frontend call. If the
server has it, return:

- `inputTokens`
- `outputTokens`
- `cachedTokens`
- `reasoningTokens`
- `totalTokens`
- `estimatedCost`

Unread UI should be driven by terminal run updates. Progress-only updates should
not create a new unread final-message badge.

## Product Direction

Generated skills are reusable mobile app/task knowledge objects.

They are not fast-path wrappers. A fast path is one optional execution route
inside a skill. The default user-facing action should be a normal agent run with
skill context.

## Skill Card

Use `GET /skills` for cards.

Important fields:

- `name`
- `description`
- `source`
- `scope`
- `status`
- `risk`
- `primaryUse`
- `appPackage`
- `routeCount`
- `knowledgeCount`
- `fastPathCount`
- `successCount`, `failureCount`, `lastRunAt`
- `requiresConfirmation`
- `tags`

Suggested card emphasis:

- show the app/task capability first;
- show knowledge/route counts as secondary metadata;
- do not make `fastPathCount` the main badge.

## Skill Detail

Use `GET /skills/:skillId`.

Primary sections:

- overview: what this skill helps the agent do;
- app model: package/activity, intent family, entry states, reusable controls;
- knowledge shortcuts: facts that avoid repeated UI probing or LLM reasoning;
- execution routes: normal agent route, optional fast path, non-UI shortcuts,
  or manual handoff;
- history and execution feedback.

Fast paths should appear as an advanced or secondary route section.

The current Android `knowledge` and `fastPaths` sections can stay. Add
`appModel`, `knowledgeShortcuts`, and `executionRoutes` around them so the UI
does not frame the feature mainly as a fast-path/macro library.

## Preview Flow

Use `POST /skills/route` when the user enters a free-form task and the UI wants
local skill suggestions before starting a run. This route does not call a
model. It returns ranked `suggestions`, each with `confidence`, `reasons`,
`recommendedRoute`, `secondaryRoutes`, `missingInputs`, and `autoRun`.

Only show automatic execution affordances when `autoRun.allowed === true`.
Otherwise show the suggested skill as context the user can run with.

Use `POST /skills/:skillId/preview` before showing route-specific actions.

Key fields:

- `executionState`
- `recommendedAction`
- `executionRoutes`
- `knowledgeShortcuts`
- `missingInputs`
- `eligibleFastPaths`
- `privacyUsage`

The primary action should follow:

- `recommendedAction.mode === "run_with_skill_context"`:
  show **Run with skill** or **Run with agent**.
- eligible fast path exists:
  show **Run fast path** as a secondary action.
- `executionState === "needs_repair"`:
  show the normal skill run as primary and surface the fast-path failure as
  diagnostic context.

Do not block the primary agent route only because fast-path inputs are missing.
Missing inputs mainly affect direct routes.

The current Android implementation validates required inputs before preview,
normal skill run, and fast-path run. For the knowledge-first route, change this
so missing inputs only block direct execution routes. A normal agent run with
skill context can still start and ask/resolve missing information in the task
flow.

## Run Routes

Primary route:

```text
POST /skills/:skillId/run
```

This submits a normal OpenClaw agent run with compact skill context.

Optional fast path:

```text
POST /skills/:skillId/fast-paths/:fastPathId/run
```

Use only when preview reports an eligible fast path and the user has supplied
the required direct-route inputs.

If fast path returns `fallbackRequired`, offer a normal skill run with the same
inputs. Do not present the skill as failed or useless.

## UX Copy

Prefer language like:

- "Run with skill"
- "Uses learned app knowledge"
- "Optional fast path"
- "Known entry state"
- "Reusable controls"
- "Verification hints"

Avoid making the UI sound like the product simply generated files or replays a
fixed macro.

## Agent-To-Agent Sharing

The backend now exposes a minimal Nostr-based sharing MVP. The product frame is
trusted-user collaboration, not a public skill marketplace.

The Android app currently keeps a small local message cache so Contacts opens
quickly. That cache is only a UI cache. The companion server should become the
source of truth for agent-to-agent conversations.

Frontend MVP screens:

- Nostr setup: show current `npub`, relay list, and configured state from
  `GET /nostr/status`.
- Key setup: call `POST /nostr/setup-key` with optional `nsec` and `relays`.
  If no `nsec` is supplied, the backend generates one and returns it once for
  backup display.
- Contacts: list, add, and delete trusted contacts through
  `GET/POST/DELETE /nostr/contacts`.
- Inbox: call `GET /nostr/inbox?limit=50`; only messages from trusted contacts
  are returned or persisted. Unknown senders are ignored by default. Skill-share
  messages are stored as pending imports only when they come from trusted
  contacts, unless `autoStoreSkillShares=0`.
- Skill share: on a skill detail page, offer **Share** with two routes:
  **Share via Nostr** and **Share with other apps**.

Message storage direction:

- Store incoming Nostr direct messages only when the sender is a trusted
  contact. Ignore unknown senders by default; the user's public key is public
  and should not create an open inbox.
- Store outgoing messages when `POST /nostr/send` succeeds or is accepted for
  relay publish.
- Deduplicate by event id for incoming messages and by local message id for
  outgoing messages.
- Group messages by trusted contact so the frontend can show a normal
  conversation list.
- Track `read`, `unread`, `sent`, `failed`, and `createdAt`/`updatedAt`.
- Keep skill-share import state linked to the message that carried it.

Preferred conversation routes:

```text
GET /agent/conversations
```

Return one item per trusted contact that has a conversation or contact record.
Each item should include:

- `agentId`: stable contact key, preferably npub when available;
- `label`: local contact label;
- `lastMessage`: short preview text;
- `lastMessageAt`: timestamp for sorting;
- `unreadCount`;
- `hasPendingSkillImport`;
- `status`: optional contact/message health such as `ok` or `relay_pending`.

```text
GET /agent/conversations/:agentId/messages?limit=100&before=<cursor>
```

Return messages for one contact, newest-page compatible but displayable in
chronological order. Each message should include:

- `id`
- `direction`: `incoming` or `outgoing`
- `text`
- `createdAt`
- `updatedAt`
- `status`: `sent`, `received`, `read`, or `failed`
- `error`: optional failure text
- `pendingImportId`: optional skill import link
- `eventId`: optional Nostr event id

```text
POST /agent/conversations/:agentId/messages
```

Send a normal text message to a trusted contact and persist the outgoing row.
The response should return the stored message object so the app does not need to
invent local ids.

```text
DELETE /agent/conversations/:agentId/messages
```

Clear the local view of one conversation. This should not try to delete already
published Nostr events. Instead, persist a per-conversation cutoff so messages
before the clear time are hidden from `GET /agent/conversations` and
`GET /agent/conversations/:agentId/messages` by default. Messages received or
sent after the clear time should continue to appear normally.

Expected response:

```json
{
  "ok": true,
  "success": true,
  "agentId": "npub-or-hex",
  "hiddenBefore": 1710000000000,
  "hiddenCount": 12,
  "message": "12 conversation messages hidden."
}
```

```text
POST /agent/inbox/fetch
```

Fetch from configured relays, persist new messages, and return a compact
summary with `newMessageCount`, `newImportCount`, and `updatedConversationIds`.
Messages from unknown senders should be ignored and not counted as unread.

```text
DELETE /nostr/contacts/:contactId
```

Remove a trusted contact by `id`, `npub`, or raw pubkey. This does not delete
already published Nostr events or the sender's copy of messages. After removal,
messages from that sender should no longer appear in `GET /agent/conversations`
unless the user adds the contact again.

```text
POST /agent/messages/:messageId/read
```

Mark one message, or all messages in the same conversation if the backend
supports a request body such as `{ "conversation": true }`, as read.

Frontend cache expectations:

- The app may cache conversation and message responses for fast initial paint.
- The app should replace cached rows with backend rows after refresh.
- The app should not be required to reconstruct conversation state from raw
  `GET /nostr/inbox` results.
- Reinstalling the app should not lose sent/received message history as long as
  the Termux companion server data remains.
- Backend maintenance note: `server.ts` is still acceptable for this MVP, but
  the next social or skills endpoint expansion should move those groups into
  small route modules so runtime, terminal, skills, and agent-sharing logic do
  not keep growing in one file.

Backend routes:

```text
POST /nostr/send
```

Body:

```json
{
  "recipientPubkey": "npub-or-hex",
  "message": "optional text",
  "payload": {}
}
```

Use this for ordinary agent-to-agent messages. The backend wraps the message in
a ClawMobile envelope, encrypts it as a Nostr direct message, signs it, and
publishes it to the configured relays.

```text
POST /skills/:skillId/share
```

Returns a compact `clawmobile.skill.share` package. This package intentionally
omits raw traces, screenshots, private artifacts, and executable fast paths.
The Android share sheet can send this JSON through any app.

```text
POST /skills/:skillId/share/nostr
```

Body:

```json
{
  "recipientPubkey": "npub-or-hex",
  "message": "optional text"
}
```

Creates the same compact share package and sends it to the recipient through
Nostr.

```text
GET /skill-imports
POST /skill-imports
POST /skill-imports/:importId/accept
POST /skill-imports/:importId/reject
```

Received skill shares stay in `pending` state until the user accepts them. On
accept, the backend creates a local draft skill under the workspace `skills/`
directory. Imported skills should be presented as untrusted/draft local
knowledge until they collect local success feedback.

Important UX constraints:

- Never auto-run an externally received skill.
- Never present shared fast paths as directly runnable in the first MVP.
- Show sender pubkey/contact and source app package before import.
- Make import explicit: **Review** -> **Import as draft**.
- For non-Nostr sharing, export the package returned by
  `POST /skills/:skillId/share` through Android's system share sheet.
