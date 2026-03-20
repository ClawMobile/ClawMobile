---
name: clawmobile-policy
description: Deterministic-first mobile policy for tool selection, verification, and escalation.
---

# ClawMobile Policy (Skill)

This skill defines the **interaction-level policy** for mobile autonomy: tool selection, verification, and escalation.
It does not add new tools; it constrains how existing tools are used.

## Ownership
- This skill owns planning policy, tool-selection policy, escalation, and verification rules.
- The base mobile plugin owns executable runtime primitives.
- App-specific behavior should not be encoded into the base plugin when it can be modeled as a separate extension.

## Policy: Deterministic-First (Priority)
1. **Command-line (Termux / ADB)** when it can **COMPLETE** and/or **VERIFY** the task.
2. **DroidRun agent mode** (`android_agent_task`) for multi-step UI workflows.
3. **Manual UI tools** (`android_ui_*`) only when agent mode fails or is unsafe.

## Decision Procedure (Strict)
1. Consult `skills/clawmobile-capabilities/SKILL.md`.
2. If a **COMPLETE** entry exists:
   - Execute the deterministic command/tool.
   - Verify (prefer deterministic verification when possible; otherwise UI dump/screenshot).
3. If a **BOOTSTRAP** entry exists:
   - Run the bootstrap command **once**.
   - Immediately switch to `android_agent_task` to finish and verify.
4. If no entry exists:
   - Use `android_agent_task` for UI workflows.
   - Use manual `android_ui_*` only if agent mode fails or is unsafe.

## UI Workflow Efficiency
- Avoid redundant UI observation on the same step.
- Prefer fused semantic actions when they match the goal:
  - use `android_ui_tap_find` instead of `android_ui_find` followed by `android_ui_tap`
  - use `android_ui_type_find` instead of `android_ui_find` followed by `android_ui_type`
- Do not run `android_ui_dump` before every semantic action by default.
  - Use it when you need diagnosis, disambiguation, or post-action verification.
- For a single deterministic UI action, prefer:
  1. choose the most direct tool,
  2. perform the action,
  3. verify once after the UI-changing step.

## Extension Rule
- If a new behavior is device-generic and reusable across apps, it belongs in the base plugin.
- If a new behavior is about choosing, sequencing, or verifying tools, it belongs in skills.
- If a new behavior depends on one app's selectors or flows, it belongs in an app-specific extension layer.

## Verification Requirements (Non-negotiable)
- Do NOT claim success unless a tool was called and the result is verified.
- For UI-changing steps, verify using:
  - `android_ui_dump` or `android_screenshot`
  - If Portal is unstable: fallback to `adb_ui_dump_xml`
- If a tool returns `ok:false` or fails: report failure; do not claim success.

## Escalation & Recovery
- If deterministic path cannot verify state reliably, escalate to `android_agent_task`.
- If `android_agent_task` appears stuck:
  1) run `android_screenshot` or `android_ui_dump` to collect evidence,
  2) retry once,
  3) if still stuck, fall back to manual `android_ui_*` only if safe.

## IME Safety
Before pausing for user confirmation, restore the user IME if it was changed by agent mode.
Emergency recovery:
- `android_shell backend="adb" cmd="ime list -s"`
- `android_shell backend="adb" cmd="ime set <IME_ID>"`

## Completion Signal
After a successful task that leaves the chat view, call `android_signal_complete` (unless disabled by user).
