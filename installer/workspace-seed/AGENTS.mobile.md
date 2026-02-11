<!-- CLAWBOT_MOBILE_BEGIN -->
# Clawbot Mobile Agent Rules

This file defines how Clawbot should choose execution paths on Android devices.

---

## Core Principle: Efficiency First

Always choose the most efficient and deterministic execution path.

### Priority Order (strict)

1. **Direct command-line tools (Termux / ADB)**
   - If the task can be completed using a single command or a small number of commands,
     prefer `android_shell` (backend="termux" or backend="adb").
   - These are the fastest and most reliable.

2. **DroidRun Agent mode**
   - If no direct command exists but the task is clearly multi-step and semantic
     (e.g., navigate UI, search, interact with elements),
     use `android_agent_task`.
   - Prefer agent mode when it is faster than manually chaining UI tools.

3. **Manual UI interaction (android_ui_*)**
   - Use `android_ui_find`, `android_ui_tap_find`, etc.
   - Only when:
     - No direct command exists, AND
     - Agent mode is unnecessary or fails.

Do NOT use manual UI clicking for tasks that have a direct command available.

---

## Execution Decision Procedure

Before acting:

1. Consult `CAPABILITIES.md`.
2. If a direct Termux or ADB command is listed → use it.
3. If no command exists:
   - If task is high-level and multi-step → use `android_agent_task`.
   - Otherwise → use `android_ui_*` tools.
4. Always signal completion unless explicitly instructed not to.

---

## Completion Rule

At the end of any successful task:

- Call `android_signal_complete` (unless user disables notification).
- The signal layer decides whether to use Termux notify, vibration, TTS, or fallback methods.

Never silently finish a task without signaling completion.

---

## Failure Handling

If a backend fails:

1. Retry with backoff if transient.
2. Fallback to the next priority layer.
3. Log diagnostic information if available.
4. Continue execution if safe.

---

## Safety

Avoid dangerous shell commands unless explicitly requested.
Do not use `android_shell` for destructive operations.

---

## Keyboard / IME Rule (Critical)

DroidRun may temporarily switch the default input method (IME). This can block user typing if the agent pauses.

Rules:
- **Before pausing for user confirmation**, restore the user's original IME so the user can type.
- **After any DroidRun-driven typing/action**, ensure IME is restored.

Emergency recovery (when user cannot type):
- Use ADB to switch IME:
  - List IMEs: `android_shell backend="adb" cmd="shell ime list -s"`
  - Set first IME: `android_shell backend="adb" cmd="shell ime set $(adb shell ime list -s | head -n 1)"`
- Prefer switching back to the previously active IME if known.

<!-- CLAWBOT_MOBILE_END -->
