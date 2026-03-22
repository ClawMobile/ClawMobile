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
3. **Manual ADB tools** (`adb_*`, `android_*`) only when agent mode fails or is unsafe.

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
   - Use manual ADB tools only if agent mode fails or is unsafe.

## UI Workflow Efficiency
- Avoid redundant UI observation on the same step.
- Do not run XML/screenshot observation before every action by default.
  - Use `adb_ui_dump_xml` or `android_screenshot` when you need diagnosis, disambiguation, or post-action verification.
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
  - `adb_ui_dump_xml` or `android_screenshot`
- If a tool returns `ok:false` or fails: report failure; do not claim success.

## Escalation & Recovery
- If deterministic path cannot verify state reliably, escalate to `android_agent_task`.
- If `android_agent_task` appears stuck:
  1) run `android_screenshot` or `adb_ui_dump_xml` to collect evidence,
  2) retry once,
  3) if still stuck, fall back to manual ADB tools only if safe.

## IME Safety
Before pausing for user confirmation, restore the user IME if it was changed by agent mode.
Emergency recovery:
- `android_shell backend="adb" cmd="ime list -s"`
- `android_shell backend="adb" cmd="ime set <IME_ID>"`

## Completion Signal
After a successful task that leaves the chat view, call `android_signal_complete` (unless disabled by user).
