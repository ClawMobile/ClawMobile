---
name: clawmobile-policy
description: Reference policy for complex ClawMobile Termux runtime recovery, generated-skill execution, and capability boundaries. Routine UI lookup should follow AGENTS/TOOLS without reading this skill.
---

# ClawMobile Termux Runtime Policy

Use this skill as a reference for complex ClawMobile Termux runtime decisions. Do not read
it for routine mobile UI lookup, simple shell work, or generated-skill fast path
execution when `AGENTS.mobile.md` and `TOOLS.mobile.md` already provide enough
guidance.

## Read This Skill When

- A routine ClawMobile tool path failed and recovery needs a policy decision.
- A task is high-risk or requires balancing screenshots, OCR, UI XML, and
  generated-skill replay.
- A generated skill needs feedback, status interpretation, or failure analysis.
- You need the Termux runtime capability boundaries.

## Verification Policy

When the simple hot path is not enough, use this verification order:

1. Tool result and exit status.
2. Cheap state checks such as package/activity/orientation.
3. `android_ui_query` when the target term is known; it can fresh-dump and
   cache UI XML by itself. Use `android_ui_dump` first only for discovery or
   multiple related queries, then reuse the returned `dump_id`.
4. `adb_ui_dump_xml` or `android_ui_dump rawXml=true` only when the compact
   keyword/query result is insufficient and a raw hierarchy snippet is genuinely
   useful.
5. OCR on an existing screenshot path or bounded region when text is visually
   present but not available in the UI hierarchy.
6. A fresh `android_screenshot` only when visual state matters, earlier checks
   are inconclusive, or failure recovery needs evidence.
7. LLM visual judgment only for semantic uncertainty, recovery, or high-risk
   actions.

For stable generated skills, prefer an entry checkpoint, the recorded-anchor
procedure, and a final checkpoint. Do not take a fresh screenshot or UI dump
after every low-risk tap/type when the skill's anchors are reliable and the
current state remains plausible.

When using OCR after a screenshot has already been captured, pass that image
path to the OCR tool. Avoid triggering another fresh screen capture unless the
UI has changed or a fresh observation is required.

When a UI query returns many matches, prefer the adaptive compact results and
select by label, bounds, region, or `nodeId`. If a query finds no match, inspect
`fallback_keywords` and retry with a better `text`, `contentDesc`,
`resourceId`, or `className` before falling back to screenshots or OCR.

Do not claim success unless the tool result supports it.

## Generated-Skill Policy

Generated skills should be used as compact app/task knowledge first. Prefer
their app model, applicability rules, anchors, verification hints, and prior
execution evidence to avoid repeated UI probing. If a generated skill has an
eligible fast path, treat it as an optional acceleration route, not the
definition of the skill.

When the generated skill name is known, call `clawmobile_skill_status` before
manual expansion when prior execution evidence may matter. If the user request
provides the skill's required values and the app state matches a fast path, you
may call `clawmobile_skill_run_fast_path` with a top-level `parameters` object,
for example `parameters: {"title_text":"...","body_text":"..."}`. Do not
reject the runner because of uncertainty about parameter passing; `parameters`
is the primary argument and `parameter_values` is an alias.

`clawmobile_skill_run_fast_path` loads the generated skill's
`generalized_skill.json`, executes the deterministic fast path, and can perform
one final checkpoint plus low-friction feedback. Internally it uses
`clawmobile_batch_execute`, which does not run arbitrary code and does not ask
an LLM to recover inside the batch.

Generated skills should keep execution feedback through
`clawmobile_skill_record_feedback` when it is low-friction. This is most useful
when a run exposes a bad anchor, a partial completion, or a verified success
that should strengthen future confidence. Feedback updates compact verified
contexts and failure patterns in the generated skill's `evolution` block.
Use `clawmobile_skill_status` when structured generated-skill experience is
more useful than reading the full generated `SKILL.md`.

When a generated fast path fails, continue with normal grounded execution using
the same skill context. Use a one-repair loop only when the structured failure
suggests a small safe repair:

1. Record or preserve the fast-path failure evidence.
2. Inspect the structured failure and cheap UI state. If the failure is a
   repairable verifier/text-query issue, call
   `clawmobile_skill_reflect_fast_path_failure` with an agent-written diagnosis
   and one bounded repair.
3. Retry `clawmobile_skill_run_fast_path` at most once with the same parameters.
4. If the repaired fast path still fails, use normal stepwise
   execution/regrounding and record feedback.
5. If normal execution fails too, clearly report the failed step and suggest a
   correction demonstration for the same task.

The reflection tool may soften entry text checks, add observed entry text
evidence, or add tap-text candidates. It should not invent new coordinates or
turn a different task into the same skill.

## Artifact Retention

Keep raw recording screenshots and traces as evidence for later debugging and
skill evolution. Runtime screenshots taken only for verification or recovery
should be treated as temporary evidence: keep useful final/failure artifacts in
feedback, but do not create extra fresh screenshots just to confirm every
intermediate action.

## Limits

Termux-only stage can run OpenClaw, local shell commands, files, network tools,
and Termux:API integrations where Android permissions allow them. It cannot
inspect or control other apps' UIs.

Termux-only stage can still help the user enable wireless ADB. When the user
provides a pairing port/code or connect port from Android wireless debugging,
run `adb pair`, `adb connect`, and `adb devices` through
`android_shell backend="termux"`, then recheck `android_health`. This is a
local Termux command path, not ADB shell, so it is available before ADB is
ready. After the first successful connection, try `adb tcpip 5555` and
`adb connect 127.0.0.1:5555`; ClawMobile prefers that stable loopback serial
when it is available. If the 5555 switch fails, keep using the temporary
connect port and retry after ADB is authorized.

ADB shell stage can open apps, press keys, type, swipe, tap, dump UI XML, take
screenshots, and run bounded ADB shell commands. It is still not root, not a
high-level UI agent, and should not pretend to infer multi-step app workflows
without observing and verifying each step.

The generated-skill workflow is available in the Termux runtime through
`clawmobile-trace-induction`. Recording a fresh trace still requires
ADB/shell-level input-event and screenshot access. Parsing, summarizing,
generalizing, and promoting an existing trace are local file operations.
