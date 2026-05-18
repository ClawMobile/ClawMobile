---
name: clawmobile-trace-induction
description: Record or summarize a ClawMobile demonstration and save a validated reusable skill candidate draft.
---

# ClawMobile Trace Induction

Use this skill when the user wants to record, demonstrate, summarize, induce,
draft, or convert a ClawMobile mobile task into a reusable skill candidate.

This skill is **not** a skill executor. It records or reads a demonstration,
then creates human-readable and machine-readable draft artifacts for later
implementation. Do not replay the task or claim the candidate is production
ready.

## Choose The Entry Point

- If the user provides a recording directory or `trace.json`, use **Existing
  Trace Flow**.
- If the user provides an existing generated skill directory and a new
  recording/candidate for the same task, use **Update Existing Skill Flow**.
- If the user wants to create a candidate from a new human demonstration and no
  recording path is provided, use **Record Then Induce Flow**.
- If a recording is already active and the user says they are finished, continue
  from **Stop Recording And Induce**.

Do not ask the user to read coordinates, label every step, or explain raw touch
events. The user should operate the phone naturally.

## Record Then Induce Flow

Use this flow when the user asks to record or create a new candidate skill from
a demonstration.

1. Pick a concise `task_hint` from the user's request, such as
   `wechat.send_message`. Ask only if the task is genuinely unclear.
2. Call `clawmobile_record_start` with `task_hint`.
3. Tell the user to perform the demonstration naturally on the phone and reply
   when finished.
4. Stop here and wait for the user. Do not call `clawmobile_record_stop` until
   the user indicates the demonstration is complete.

## Stop Recording And Induce

Use this flow after the user says the demonstration is done.

1. Call `clawmobile_record_stop`.
2. Use the returned `recording_dir` or `trace_path`.
3. Continue immediately with **Existing Trace Flow**. Do not ask for another
   confirmation before generating the candidate.

## Existing Trace Flow

Use this flow when a recording directory or `trace.json` is already available.

1. Call `clawmobile_trace_prepare_summary`.
   - Use `recording_dir_or_trace_path`, `recording_dir`, or `trace_path`.
   - If the user did not provide a path and no just-finished recording is
     available, ask for the recording directory or `trace.json` path.
2. Read the returned:
   - `trace_digest`
   - `trace_digest.derived_semantics`
   - `grounding_rules`
   - `candidate_schema`
   - `allowed_anchors`
   - screenshot paths and state snippets
3. Think through the demonstrated task using only the returned trace evidence.
4. Produce a JSON candidate that matches `candidate_schema`.
5. Call `clawmobile_trace_save_skill_candidate` with the candidate JSON.
6. If validation reports rejected anchors or missing anchor references, revise
   the candidate once using the same `trace_digest`, then call
   `clawmobile_trace_save_skill_candidate` again.
7. If validation then passes with no rejected anchors, call
   `clawmobile_skill_candidate_promote` with the saved `skill_candidate_path`
   and `install: true`.
8. Report the saved `skill_candidate_path`, `skill_summary_path`, promoted
   primary `SKILL.md` path, `fixed_SKILL.md` path, generated skill name,
   `generalized_skill.json`, `generalized_SKILL.md`, and any remaining
   warnings.
9. Also give the user a short skill review:
   - what the skill does
   - required parameters
   - plain-language execution steps
   - whether fast path is available
   - important uncertainties or anchors that may need regrounding
   - how to improve it by recording another demonstration of the same task

## Update Existing Skill Flow

Use this flow when a generated skill already exists and the user records or
provides another demonstration for the same task.

1. First produce a validated `skill_candidate.json` for the new trace by using
   **Record Then Induce Flow** or **Existing Trace Flow**.
2. Call `clawmobile_skill_update_from_trace` with:
   - `existing_skill_dir`: the existing generated skill directory
   - `new_recording_dir_or_candidate_path`: the new recording directory or
     `skill_candidate.json`
3. Read the returned validation and `anchor_updates`.
4. If validation fails because the intent, app, or required parameters do not
   match, stop and report that the new trace should create a separate skill.
5. If validation succeeds, report the updated primary `SKILL.md`,
   `generalized_skill.json`, source traces, evidence directory, anchor
   stability changes, and warnings.
6. Explain what changed in the skill and whether the new trace strengthened
   anchors, added a new entry state, or recorded a failure/correction pattern.

Do not merge unrelated traces just because the app is the same. Evolution is
for the same task intent. Stable UI anchors such as composer or send buttons may
become stronger replay-first anchors when multiple traces agree. Context or
parameter anchors such as chats, contacts, files, and search results should stay
reground-friendly.

## Candidate Rules

- Use schema version `clawmobile.skill_candidate.v1`.
- Set `source_trace_id` to the trace id returned by prepare.
- Summarize the user's demonstrated intent in `task_summary`.
- Fill `app.package` and `app.activity` from trace state when available.
- Add an `intent` object with:
  - `name`: stable snake_case task name
  - `description`: concise human-readable task description
  - `parameters`: variable user inputs, such as `message_text`
- Add preconditions, verification rules, and fallback guidance that a future
  executor could use.
- Keep uncertain claims in `warnings` instead of pretending they are known.

## Generalization Rules

Promotion generates a merged skill directory. The primary `SKILL.md` is the
generalized skill. The fixed coordinate-heavy version is retained as
`fixed_SKILL.md` for evidence and rollback.

- Treat the fixed candidate as concrete evidence, not as a universal rule.
- Separate task/procedure applicability from anchor applicability.
- If the user intent matches but a coordinate or UI location changed, the
  generalized skill should remain `applicable_with_regrounding` when a
  plausible grounding path exists.
- Do not add arbitrary contact, account, file, or object parameters unless the
  trace evidence or candidate parameters already support them.
- Keep uncovered parameters under `intent.not_covered_parameters`.
- Preserve uncertainty under `evolution.open_uncertainties` so future traces or
  failures can improve the skill.
- When multiple traces support the same skill, keep `source_traces`,
  per-anchor observations, and `evolution.anchor_updates` as evidence. Do not
  delete older trace evidence.
- Generated skills should record execution feedback with
  `clawmobile_skill_record_feedback` when it is low-friction and does not
  disrupt the user-facing task. Success feedback can stay compact with outcome,
  parameters, anchors, and verification summary. Failure or partial feedback is
  especially useful when it includes the failed step/anchor and concise
  observations so later trace updates or repairs have evidence. The feedback
  tool automatically extracts compact verified contexts and failure patterns
  into the generated skill's `evolution` block.
- Generated skills carry frontmatter/manifest metadata:
  `clawmobile_generated=true`, `feedback_tool=clawmobile_skill_record_feedback`,
  and `status_tool=clawmobile_skill_status`.
- Use `clawmobile_skill_status` when a generated skill's prior execution
  experience is needed in structured form.
- Generated `SKILL.md` files render a `Prior Execution Experience` section
  from feedback-derived guidance. Use it as evidence for grounding/fallback
  choices, not as a replacement for normal verification.
- Generated `SKILL.md` files may also render an eligible fast path. When it is
  eligible and required parameters are clear, prefer
  `clawmobile_skill_run_fast_path` before manually expanding every step. The
  tool returns structured failure artifacts so normal stepwise recovery remains
  available. Pass required skill variables under the top-level `parameters`
  object. If the exact required names are unclear, call
  `clawmobile_skill_status`; do not assume the runner lacks parameter support.
- If `clawmobile_skill_run_fast_path` fails, do not immediately abandon the
  fast path. First inspect the structured failure, current UI evidence, and
  prior execution status. If the failure looks like a repairable entry-state,
  text-query, or verifier mismatch, call
  `clawmobile_skill_reflect_fast_path_failure` with a concise diagnosis and one
  safe repair, then retry `clawmobile_skill_run_fast_path` once. Only after that
  retry fails should you switch to normal stepwise execution/regrounding.
- If normal stepwise execution also fails, record feedback and tell the user
  whether another demonstration of the same task would likely improve the
  skill. Do not silently hand-code app-specific patches.
- Generated `SKILL.md` files render a `Skill Review` section. After generating
  or updating a skill, use it to briefly explain the new skill to the user.
  This is part of the learning loop: if the user says the skill is wrong,
  incomplete, or overfit, record another demonstration of the same task and use
  **Update Existing Skill Flow** rather than hand-coding app-specific patches.
- Fast paths should use app-state checkpoints only at app entry or app
  switches. Do not add per-step state checks. If the current package/activity
  or stable entry UI text cannot be confirmed cheaply, stop fast execution and
  use normal agent/LLM inspection or regrounding.

## Derived Semantics Rules

Always inspect `trace_digest.derived_semantics` before choosing replay steps.

- Preserve `derived_semantics.pre_text_input_action_candidates` as evidence
  before the related `type_parameter` step.
- Use a pre-text candidate as a coordinate replay anchor only when
  `replay_allowed=true`.
- When a pre-text candidate has `replay_allowed=false`, do not turn it into a
  `tap_anchor`. Use semantic grounding instead, usually `tap_text` for the
  visible menu option or UI text, then continue with `type_parameter`.
- If a FAB/plus tap opens a menu and the next step should choose a visible
  option such as Text/List/Image, prefer replaying the FAB/plus coordinate and
  then `tap_text` for the visible option instead of replaying every recorded
  low-screen tap.
- Treat `derived_semantics.text_input_clusters` as human typing evidence.
- Turn each text input cluster into a parameterized `type_parameter` step,
  usually with `message_text`.
- Do not replay individual soft-keyboard taps as `tap_anchor` steps.
- Do not use anchors with `replay_allowed: false` as replay targets. They are
  evidence only.
- For send/confirm actions after typing, prefer
  `derived_semantics.post_text_input_action_candidates` when present.
- For a message-send flow, the usual replay shape is:
  1. tap a conversation or composer anchor when needed
  2. `type_parameter` with `message_text`
  3. tap the post-text send/confirm anchor

## Grounding Rules

- Do not invent coordinates.
- Coordinate anchors must come from `trace_digest.allowed_anchors`.
- For every `coordinate_anchor`, include:
  - `type: "coordinate_anchor"`
  - `x_norm` and `y_norm` copied from an allowed anchor
  - `source_anchor_id` copied from the allowed anchor id
  - `source_step_id`
  - `evidence` naming the relevant step and screenshot/state evidence
  - `confidence`
- Do not use shorthand such as `"coordinate_anchor": "step_1_tap"` in the final
  candidate. Expand it to the full coordinate anchor object.
- If the trace does not support a semantic claim, write it as a warning.
- Do not put raw coordinates directly in candidate `steps`; steps should target
  named anchors or use parameterized actions.

## Good Output Shape

```json
{
  "schema_version": "clawmobile.skill_candidate.v1",
  "source_trace_id": "rec_...",
  "task_summary": "The demo sends a parameterized message in an existing chat.",
  "app": {
    "package": "com.example",
    "activity": "com.example.MainActivity"
  },
  "intent": {
    "name": "send_current_chat_message",
    "description": "Send a parameterized message in the currently open chat.",
    "parameters": {
      "message_text": {"type": "string", "required": true}
    }
  },
  "preconditions": [
    "The target chat or conversation is visible or can be opened from the recorded app state."
  ],
  "entry_state_checks": {
    "after_app_open": {
      "package": "com.example",
      "activity": "com.example.MainActivity",
      "ui_text_any": ["stable visible entry text when the trace clearly shows one"]
    }
  },
  "anchors": {
    "message_input": {
      "type": "coordinate_anchor",
      "source_step_id": 2,
      "source_anchor_id": "step_2_tap",
      "x_norm": 0.48,
      "y_norm": 0.93,
      "evidence": ["step_2_tap", "before screenshot shows composer area"],
      "confidence": 0.75
    },
    "send_button": {
      "type": "coordinate_anchor",
      "source_step_id": 8,
      "source_anchor_id": "step_8_tap",
      "x_norm": 0.93,
      "y_norm": 0.56,
      "evidence": ["post_text_action_1", "after text input cluster"],
      "confidence": 0.7
    }
  },
  "steps": [
    {
      "action": "tap_anchor",
      "target": "message_input",
      "verify_after": "A text input should be focused."
    },
    {
      "action": "type_parameter",
      "parameter": "message_text",
      "verify_after": "The composer contains message_text."
    },
    {
      "action": "tap_anchor",
      "target": "send_button",
      "verify_after": "The message appears as an outgoing bubble or the composer clears."
    }
  ],
  "verification": [
    "Confirm the expected app/activity remains visible after the action."
  ],
  "fallback": [
    "If an anchor is not visible, stop and request a new demonstration or re-ground the UI."
  ],
  "warnings": []
}
```

## Final Response

After recording starts, keep the response short and tell the user to perform the
demo and reply when done.

After saving a candidate:

- Mention the saved candidate and summary paths.
- Mention the promoted primary generated skill path when promotion succeeds.
- Mention that the primary `SKILL.md` is generalized, with `fixed_SKILL.md`
  retained as source evidence.
- Mention the generalized skill JSON/markdown paths.
- Include a concise skill review: intent, parameters, steps, fast-path status,
  and important uncertainties.
- If the user is not satisfied, tell them they can demonstrate the same task
  again and the existing skill can be updated from the new trace.
- If future execution fails, suggest recording a correction demo from the failed
  or desired starting state, then use `clawmobile_skill_update_from_trace`.
- Mention validation warnings, especially rejected anchors.
- Do not claim the skill can execute yet.
