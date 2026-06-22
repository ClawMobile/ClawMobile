# ClawMobile Termux Runtime Reference

This file is the technical reference for ClawMobile's current Termux runtime.
For normal installation, start with the
[installation guide](../INSTALL.md).

ClawMobile runs OpenClaw directly in Termux and adds Android-aware tools for
local files, shell commands, networking, optional OCR, optional ADB UI control,
demonstration recording, generated skills, and execution feedback.

The `termux-lite/` directory name is historical. It is the maintained default
Termux runtime on `main`; user-facing docs should simply call it the ClawMobile
Termux runtime.

The OpenClaw-on-Android bootstrap follows the same core approach as:

- https://github.com/AidanPark/openclaw-android

The small compatibility subset used by this runtime is kept in
`openclaw-compat/`, with MIT attribution in `openclaw-compat/NOTICE.md`.

## Install Source

The supported Termux source is
[F-Droid](https://f-droid.org/packages/com.termux/). If F-Droid is unavailable,
use the official
[Termux GitHub releases](https://github.com/termux/termux-app/releases).
Install optional Termux companion apps such as Termux:API from the same source
as Termux.

Google Play Termux is best-effort for this runtime because it follows a
separate codebase/package path and can differ in package availability,
Termux:API behavior, and Android permission behavior. The installer blocks
Google Play Termux before changing packages unless you explicitly allow it:

```sh
CLAWMOBILE_ALLOW_PLAY_TERMUX=1 clawmobile setup --quick
```

If the `clawmobile` command is not installed yet and you are running from a
repository checkout, use:

```sh
CLAWMOBILE_ALLOW_PLAY_TERMUX=1 ./installer/termux-lite/clawmobile setup --quick
```

## Normal Commands

The recommended fresh-install command is documented in
[../INSTALL.md](../INSTALL.md). From an existing repository checkout, the
shortest guided setup is:

```sh
./installer/termux-lite/clawmobile setup --quick --start
```

`--quick` asks for the model provider/API key, optionally configures Telegram,
applies ClawMobile defaults, and leaves ADB as a later capability upgrade.
The guided model path currently uses verified defaults for OpenAI, Anthropic,
and DeepSeek; use full setup for Gemini, OpenRouter, or custom endpoints.
`--start` launches the OpenClaw gateway immediately after setup and keeps it in
the current Termux session.

Common commands after the wrapper is installed:

```sh
clawmobile doctor
clawmobile run
clawmobile server
clawmobile repair
clawmobile reset --level plugin
clawmobile reset --level workspace
clawmobile configure defaults
```

For scripted setup, use OpenClaw's non-interactive onboarding flags:

```sh
OPENAI_API_KEY=sk-... clawmobile setup --non-interactive --auth-choice openai-api-key
```

For tests that intentionally skip model/channel setup:

```sh
clawmobile setup --non-interactive --auth-choice skip
```

## Runtime Behavior

`clawmobile setup` installs or updates OpenClaw, installs runtime dependencies,
installs the mobile-ui plugin, syncs the workspace seed, runs onboarding, and
prints the next command. Full diagnostics are skipped by default for faster
Termux setup; run `clawmobile doctor` when you want the detailed check.

Package installs run in non-interactive mode and keep existing Termux config
files by default. If the configured Termux mirror reports an integrity or sync
error, the installer backs up `$PREFIX/etc/apt/sources.list`, tries a small set
of Termux mirrors, clears stale apt lists, and retries the package command.

Useful mirror overrides:

```sh
CLAWMOBILE_TERMUX_APT_MIRROR=https://packages.termux.dev/apt/termux-main clawmobile setup --quick
CLAWMOBILE_TERMUX_APT_MIRRORS="url1 url2" clawmobile setup --quick
CLAWMOBILE_TERMUX_APT_FALLBACK=0 clawmobile setup --quick
```

Termux can be noticeably slower than a desktop when starting fresh OpenClaw CLI
processes. `clawmobile setup` writes the normal defaults once, so gateway
startup does not refresh config on every run. If you intentionally reset or
hand-edit OpenClaw config, refresh once with:

```sh
clawmobile configure defaults
```

## Capability Stages

The Termux runtime exposes one stable tool set and detects which capabilities
are available at tool-call time.

| Stage | How it is reached | Available examples |
| --- | --- | --- |
| Termux | Default after ClawMobile starts | OpenClaw, local shell, files, network, CLI tools, and local OCR on existing image files when the optional OCR engine is installed |
| Termux:API | Termux:API app plus `termux-api` package are present | toast, notifications, clipboard, battery status, text-to-speech |
| ADB shell | `adb devices` shows a device in `device` state | taps, swipes, typing, screenshots, UIAutomator XML, `adb shell` commands |

Inside OpenClaw, call `android_health` first. It returns the current `stage`,
backend states, and booleans such as `local_shell`, `termux_api`, `ui_input`,
`ui_observe`, `screenshot`, `android_shell`, `local_ocr`, `ocr`, and
`screen_ocr`.

## Android Companion Server

The native Android companion app talks to a small local HTTP facade running in
Termux:

```sh
clawmobile server
```

The current `companion-server-mvp` branch already includes this companion server
surface under `openclaw-plugin-mobile-ui/src/companion/`. Treat that
implementation as the baseline for Android testing and backend follow-up work.

By default it listens on the local loopback host at `127.0.0.1:8765`, so the
Android companion app can call it on the same device without exposing a shell
endpoint to the local network. It checks the existing OpenClaw gateway at
`127.0.0.1:18789`.

Current MVP endpoints:

```text
GET  /health
POST /attachments
POST /intent
POST /runtime/start
POST /runtime/stop
GET  /runtime/log
POST /terminal/command
GET  /terminal/session
POST /terminal/session/input
POST /terminal/session/reset
GET  /skills
POST /skills/route
GET  /skills/:skillId
POST /skills/:skillId/preview
POST /skills/:skillId/run
POST /skills/:skillId/fast-paths/:fastPathId/run
GET  /skills/:skillId/runs
GET  /skill-runs/:runId
GET  /nostr/status
POST /nostr/setup-key
GET  /nostr/contacts
POST /nostr/contacts
DELETE /nostr/contacts/:contactId
POST /nostr/send
GET  /nostr/inbox
GET  /agent/conversations
GET  /agent/conversations/:agentId/messages
POST /agent/conversations/:agentId/messages
DELETE /agent/conversations/:agentId/messages
POST /agent/inbox/fetch
POST /agent/messages/:messageId/read
POST /skills/:skillId/share
POST /skills/:skillId/share/nostr
GET  /skill-imports
POST /skill-imports
POST /skill-imports/:importId/accept
POST /skill-imports/:importId/reject
GET  /runs
```

`/health` returns ClawMobile capability health plus OpenClaw gateway reachability.
`/runtime/start` starts the existing Termux gateway through `run.sh` if it is not
already reachable. `/runtime/log` returns the current gateway log tail for the
Android cockpit terminal. Terminal endpoints execute commands inside Termux and
are restricted to loopback requests by default. `/intent` accepts a user task,
returns a run id and session id, and lets the Android app poll `/runs/:runId`
and `/runs?limit=100` for chat history, progress, tool activity, final result,
and optional token usage.

`/attachments` accepts raw `image/*` uploads from the Android share sheet and
saves them under `${CLAWMOBILE_ATTACHMENT_DIR:-$HOME/.clawmobile/companion-attachments}`.
The Android app includes the returned attachment objects in `/intent.attachments`.
The server appends local image paths to the internal OpenClaw prompt while
preserving the original user-visible request as `userText`.

The companion server also exposes a minimal Nostr-based agent message and skill
sharing MVP. Nostr endpoints are local-only companion operations by default.
They let the Android app configure a local Nostr identity, add trusted contacts,
send encrypted direct messages, fetch inbox messages, keep local trusted-agent
conversation history, and import received skill shares as pending drafts. Shared
skill packages intentionally omit raw traces, screenshots, private artifacts,
and executable fast paths; received packages are never auto-run and require
explicit local import.

### Skills Library API Contract

The Android app treats `/skills` as a unified Skills Library, not as a generated
skill-only list. The server should return ordinary installed OpenClaw skills,
generated skills, imported skills, and future user-created skills through the
same shape. Generated skills can add richer app/scenario knowledge and fast
paths, but ordinary skills must remain valid without those fields. A generated
skill should be presented as reusable app/task knowledge first; fast paths are
optional execution routes.

`GET /skills` returns compact cards:

- `id`, `name`, `description`
- `source`: `installed`, `generated`, `demo`, or `unknown`
- `scope`: `app`, `scenario`, `system`, `tool`, or `unknown`
- `status`: `draft`, `tested`, `trusted`, or `broken`
- `risk`: `low`, `medium`, or `high`
- `primaryUse`
- `appPackage`
- `routeCount`
- `fastPathCount`
- `knowledgeCount`
- `successCount`, `failureCount`, `lastRunAt`
- `requiresConfirmation`
- `tags`

`GET /skills/:skillId` returns the full detail used by the Android skill page:

- `overview`
  - `primaryUse`
  - `agentValue`
  - `whenToUse`
  - `whenNotToUse`
- `knowledge`
  - sections with `id`, `title`, `summary`, and concise `items`
- `appModel`
  - compact app/task model derived from generated artifacts, including package,
    activity, intent family, entry states, reusable controls, verification
    hints, and learned limits when available
- `knowledgeShortcuts`
  - compact facts that should reduce repeated probing, screenshots, UI dumps,
    or LLM visual reasoning
- `executionRoutes`
  - route choices such as `agent_with_skill_context`, `fast_path`,
    `non_ui_shortcut`, or `manual_handoff`
- `fastPaths`
  - each fast path has `id`, `title`, `description`, `source`, `status`,
    `risk`, `inputSummary`, `successCount`, `failureCount`, `lastRunAt`, and
    `canRun`
- `history`
  - demo, run, feedback, and update events
- compatibility fields already used by the earlier MVP:
  - `inputs`, `outputs`, `capabilities`, `confirmationPolicy`,
    `privacyUsage`, and `recentRuns`

The current implementation scans `$OPENCLAW_WORKSPACE/skills/*/SKILL.md` and
derives this shape from markdown, frontmatter, `generalized_skill.json`,
`skill_candidate.json`, and `execution_feedback.jsonl` when available.

### Local Skill Routing

`POST /skills/route` performs local metadata routing without a model call:

```json
{
  "text": "Create a checklist note for my shopping list",
  "inputs": {
    "title": "Shopping"
  },
  "appPackage": "com.google.android.keep",
  "limit": 3,
  "allowAutoFastPath": false
}
```

It returns `suggestions` ranked by local app/package, intent, description,
tags, knowledge shortcut, and prior execution evidence matches. Each suggestion
includes `confidence`, `reasons`, `recommendedRoute`, `secondaryRoutes`,
`missingInputs`, and an `autoRun` decision. The route step itself has
`tokenCost: "none_local_metadata_match"`.

`POST /intent` also uses the same local router conservatively. When exactly one
high-confidence skill match exists, the runtime appends a compact skill context
to the submitted prompt. When no high-confidence match exists, the submitted
prompt is unchanged. Set `CLAWMOBILE_AUTO_SKILL_ROUTING=0` to disable this
automatic context attachment.

Automatic fast-path execution is not enabled by default. A caller must set
`allowAutoFastPath: true`, and the route must be high-confidence, have required
inputs available, avoid high-risk actions, and have no blocking failure history.

### Skills Execution API

`POST /skills/:skillId/preview` accepts:

```json
{
  "inputs": {
    "title": "Example title",
    "body": "Example body"
  },
  "instruction": "Optional user task text"
}
```

It returns a preview object with `executionState`, `missingInputs`,
`executionRoutes`, `knowledgeShortcuts`, `eligibleFastPaths`,
`recommendedAction`, `privacyUsage`, and short UI steps. Generated skills also
include the result of `clawmobile_skill_status` when `generalized_skill.json`
exists.

`executionState` is one of:

- `skill_ready`: generated or installed skill knowledge is available for a
  normal agent run.
- `needs_inputs`: required inputs are missing for a direct route such as a fast
  path; the agent route can still ask follow-up questions or infer safe values.
- `needs_repair`: prior fast-path failure evidence recommends one bounded
  repair or a normal agent run before another direct fast-path attempt. Treat
  the failure as diagnostic context, not as proof that the skill is unusable.
- `guidance_only`: legacy/generated guidance exists, but the richer skill route
  metadata is not available.
- `agent_guidance`: ordinary installed skill guidance.
- `broken`: the generated skill metadata could not be loaded.

`POST /skills/:skillId/run` creates a normal OpenClaw agent run with the skill
loaded as compact context. It accepts `instruction`, `taskText`, `text`,
`inputs`, and optional `sessionId`. This route does not force replay. Use it
as the default route when the UI wants the agent to reuse app knowledge,
grounding hints, verification rules, prior execution evidence, and available
tools.

`POST /skills/:skillId/fast-paths/:fastPathId/run` calls the generated skill
fast-path runner. It accepts:

```json
{
  "inputs": {
    "title": "Example title"
  },
  "finalCheckTexts": ["Expected visible text"],
  "recordFeedback": true,
  "dryRun": false
}
```

The current generated-skill backend exposes the singular generated route as
`default-fast-path` when the skill stores `fast_path` rather than `fast_paths`.
Entries loaded from future `fast_paths` arrays are shown as reference routes
with `canRun: false` until the runner supports variant selection. The response
includes `success`, `state`, Android-facing `status`, `message`,
`resultSummary` or `errorSummary`, `rawResult`, `fallbackRequired`, and optional
`selfRepair`.

### Frontend Integration Notes

- The Android frontend already has a Skill Library MVP in `SkillModels.kt`,
  `HttpRuntimeClient.kt`, and `SkillsScreen.kt`; the next step is sync,
  verification, and incremental fixes, not a rewrite.
- Keep the existing list/detail/preview/run/fast-path/run-history calls. The
  companion server also supports `/skills/:skillId/runs` and
  `/skill-runs/:runId` for the Android skill history UI.
- The Android frontend consumes optional fields for the knowledge-first model:
  `appPackage`, `routeCount`, `appModel`, `knowledgeShortcuts`,
  `executionRoutes`, `executionState`, `recommendedAction`, `missingInputs`,
  and `eligibleFastPaths`.
- Keep `POST /skills/route` available for local skill suggestions before a
  free-form intent is submitted.
- Preserve the original user task as `userText`, `inputText`, or `intentText`
  when `/intent` injects compact skill context. The Android chat UI uses this
  field instead of the expanded OpenClaw prompt.
- Preserve the original user task as `userText` when `/intent` injects local
  attachment paths for shared images.
- Update run `updatedAt` when a terminal `done` or `failed` result arrives so
  the Android unread badges and recent chats can refresh correctly.
- Return token usage when available; the Android app can hide or show it
  without making another model call.
- Treat generated skills as reusable app/task knowledge objects, not as fast
  path wrappers.
- Prefer `preview` before showing a direct fast-path button.
- Show `Run with skill` / `Run with agent` as the primary action for all skills.
  Show `Run fast path` only as a secondary action when an eligible fast path
  exists.
- Do not block the primary `Run with skill` agent route only because fast-path
  inputs are missing. Missing direct-route inputs should mainly block direct
  fast-path execution.
- If `executionState === "needs_repair"`, avoid a direct fast-path primary
  action; prefer the normal agent route and show the repair recommendation as
  diagnostic context.
- If a fast path fails with `fallbackRequired`, offer a normal agent run using
  the same inputs instead of reporting the skill as unusable.
- Do not require optional inputs. Only fields with `required: true` should block
  execution.
- Keep generated skills visually distinct from ordinary installed skills, but
  keep the detail page structure shared.
- See `docs/companion-android-contract.md` for the Android companion contract.

### Remaining Skills Backend Work

- Backfill older generated skills and add a first-class manifest/card so the UI
  does not need to infer display fields from markdown.
- Add explicit non-UI shortcut discovery/routes where Android intents, app
  shortcuts, shell, files, or app APIs are safer than UI control.
- Support multiple named fast paths inside one skill as optional execution
  routes without losing the simple `default-fast-path` case.
- Add richer progress streaming for long-running agent and fast-path execution.
- Add migration and compatibility checks for copied skills across devices.
- Feed fast-path failures into skill repair and evolution more consistently.

Useful overrides:

```sh
CLAWMOBILE_COMPANION_PORT=8765 clawmobile server
CLAWMOBILE_COMPANION_HOST=127.0.0.1 clawmobile server
CLAWMOBILE_GATEWAY_PORT=18789 clawmobile server
```

When ADB is not ready, UI-control tools return a structured
`capability_unavailable` result instead of breaking the runtime. If ADB is
paired after the gateway starts, later calls can use the newly available
capability without reinstalling or resetting the workspace.

`clawmobile doctor` reports the Termux app source/version, apt source, key
package availability, OpenClaw, Node/npm, ADB devices, Termux:API commands,
plugin registration, and seeded skills.

## Demonstration Learning

The runtime includes a public-preview trace-to-skill workflow:

- `clawmobile_record_start`
- `clawmobile_record_stop`
- `clawmobile_record_parse`
- `clawmobile_trace_prepare_summary`
- `clawmobile_trace_save_skill_candidate`
- `clawmobile_skill_candidate_promote`
- `clawmobile_skill_generalize`
- `clawmobile_skill_update_from_trace`
- `clawmobile_skill_record_feedback`
- `clawmobile_skill_status`
- `clawmobile_skill_run_fast_path`

Ask OpenClaw to use the `clawmobile-trace-induction` skill to run the full
record -> induce -> promote flow. Recording a fresh trace requires the ADB shell
stage because the recorder reads `getevent`, screenshots, and Android state.
Parsing, summarizing, generalizing, and promoting an existing trace are local
file operations.

Generated skills are evidence-backed execution guides, not guaranteed hardcoded
scripts. They can work from one clean demo for stable workflows, but additional
demonstrations and execution feedback are the intended path for improving
dynamic app states, list selections, layout changes, or app versions.

Example request after `clawmobile run` and ADB authorization:

```text
Use clawmobile-trace-induction to record my next phone demonstration.
```

The generated skill's primary `SKILL.md` is the generalized skill. The fixed
trace-derived version is retained beside it as `fixed_SKILL.md`.

Generated skills may include an experimental deterministic fast path. For those
skills, OpenClaw can call `clawmobile_skill_run_fast_path` with the required
parameters. The tool returns a compact result with `fallback_required` when the
fast path cannot finish; the agent or companion UI should then continue with a
normal agent run or stepwise recovery.

## OCR

OCR is a generic observation substrate and can be useful for generated skills,
but it is not required for trace recording or promotion.

The setup path does not install the local OCR engine by default. This keeps the
normal install smaller and avoids large optional packages on slow or unreliable
Termux mirrors.

Install OCR when you need screenshot text recognition:

```sh
CLAWMOBILE_TERMUX_INSTALL_OCR=1 clawmobile install
```

Verify it with:

```sh
tesseract --version
tesseract --list-langs
```

English OCR is installed by the Termux `tesseract` package. For simplified
Chinese OCR, place a traineddata file under `$PREFIX/share/tessdata/` and run
with:

```sh
CLAW_MOBILE_OCR_LANG=chi_sim+eng clawmobile run
```

## Maintenance

Use reset levels to recover from partial installs or stale runtime state:

```sh
clawmobile reset --level plugin
clawmobile reset --level workspace
clawmobile reset --level state
clawmobile reset --level full
```

Use `plugin` after plugin/tool registration problems, `workspace` after seeded
skill or policy issues, `state` after broken OpenClaw local state, and `full`
when you want to reinstall OpenClaw itself.

`clawmobile run` skips plugin rebuild/reinstall when the runtime dist output
and local install stamp are current. Force a refresh with:

```sh
CLAWMOBILE_TERMUX_FORCE_BUILD=1 clawmobile run
CLAWMOBILE_TERMUX_FORCE_PLUGIN_INSTALL=1 clawmobile run
CLAWMOBILE_TERMUX_FORCE_BUILD=1 CLAWMOBILE_TERMUX_FORCE_PLUGIN_INSTALL=1 clawmobile run
```

If OpenClaw sees the seeded skills but not tools such as
`clawmobile_record_start` or `android_ocr_dump`, force the combined refresh.
The installer pins and enables the local plugin entry, refreshes the plugin
registry, and declares the plugin's tool contract in `openclaw.plugin.json`.

## Developer Entrypoints

The public path should use `clawmobile setup`. The script entrypoints remain
available for local development and debugging:

```sh
./installer/termux-lite/install-openclaw.sh
./installer/termux-lite/install.sh
./installer/termux-lite/onboard.sh
./installer/termux-lite/run.sh
./installer/termux-lite/doctor.sh
```

Useful bootstrap overrides:

```sh
CLAWMOBILE_OPENCLAW_NPM_SPEC=openclaw@2026.6.1
CLAWMOBILE_OPENCLAW_NODE_VERSION=22.22.0
CLAWMOBILE_INSTALL_CLAWDHUB=0
CLAWMOBILE_OPENCLAW_RUN_UPDATE=0
CLAWMOBILE_TERMUX_UPGRADE=1
```

The bootstrap pins OpenClaw to `openclaw@2026.6.1` by default. It does not run
`openclaw update` after installing a pinned version unless
`CLAWMOBILE_OPENCLAW_RUN_UPDATE=1` is set. Use
`CLAWMOBILE_OPENCLAW_NPM_SPEC=openclaw@latest` only when intentionally testing
the latest OpenClaw.

In this runtime, the plugin exposes capability-aware Termux/ADB tools. The
archived DroidRun/MobileRun backend is not part of the maintained `main` path.

Default settings applied by `clawmobile setup --quick` and
`clawmobile configure defaults`:

- `tools.profile=full`
- web search enabled with provider left unset for OpenClaw auto-detection
- bundled Codex plugin disabled for the Android/Termux gateway path
- `skills.install.nodeManager="npm"`
- `skills.install.preferBrew=false`
- hooks/session-memory left off by default

## Privacy

Recordings and generated skills may contain sensitive screenshots, input
traces, app state, package/activity names, model-visible summaries, and
API-key-adjacent configuration. Review those artifacts before sharing a
workspace, recording directory, or repository snapshot.
