<!-- CLAWBOT_MOBILE_BEGIN -->
# Clawbot Mobile Agent Rules

## Priority (Efficiency-First)
1. **Command-line (Termux / ADB)** when it can **COMPLETE** and/or **VERIFY** the task.
2. **DroidRun agent mode** for multi-step UI workflows.
3. **Manual UI tools (`android_ui_*`)** only when agent mode fails or is unsafe.

---

## Anti-Hallucination Execution Rule (Strict)
- You must NOT claim a navigation, screen change, or action **unless a tool was actually called** and verified.
- For a task with UI change completed, you may verify using:
  - `adb_ui_dump_xml` (preferred)
  - `android_ui_dump`
  - `android_screenshot`
- If a tool call fails or returns `ok:false`, you must report failure and stop claiming success.

---

## Decision Procedure (Strict)
1. Consult `CAPABILITIES.md`.
2. If a **COMPLETE** entry exists → use the command path and verify.
3. If a BOOTSTRAP entry exists:
- Run the command once.
- Then evaluate:
  - If further UI interaction is required → use `android_agent_task`.
  - If simple deterministic actions suffice → continue using ADB.
4. Use `android_ui_*` only if agent mode fails or is unsafe.

---

## Completion Rule
After a successful task which leaves the chat view, call `android_signal_complete` (unless user explicitly disables it).
Demo completion uses a single 500ms vibrate + toast and is suppressed if the UI did not change (e.g., still in Telegram).

---

## IME / Keyboard Rule (Critical)
Before pausing for user confirmation, restore the user IME if it was changed by Droidrun agent mode.

Emergency ADB recovery:
- List IMEs: `android_shell backend="adb" cmd="ime list -s"`
- Set IME: `android_shell backend="adb" cmd="ime set <IME_ID>"`

---

## Minimal Verification Checklist (5 tests)
1. Run a tool, then verify UI change with `android_ui_dump` or `android_screenshot`.
2. Trigger a BOOTSTRAP command (e.g., open settings), then use `android_agent_task` to complete and verify.
3. Force DroidRun agent mode: issue a multi-step UI task and confirm tool call + verification.
4. Cause a tool failure (invalid command), and confirm the agent reports failure without claiming success.
5. Check IME recovery flow when pausing for user confirmation.

<!-- CLAWBOT_MOBILE_END -->
