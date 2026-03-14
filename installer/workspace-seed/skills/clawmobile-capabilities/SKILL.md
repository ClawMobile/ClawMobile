---
name: clawmobile-capabilities
description: Capability contract (COMPLETE/BOOTSTRAP) for ClawMobile Android runtime.
---

# ClawMobile Capabilities (Contract)

This skill is a **capability contract** for ClawMobile’s Android runtime.

It answers:
- **What** can be done deterministically on-device (via Termux / ADB),
- What tasks are only **BOOTSTRAP-able** deterministically and must be finished via UI agent mode,
- What tools/backends to prefer and what minimal verification signals to use.

This skill is intentionally **declarative** (an index/contract), not a policy engine.
For tool selection / escalation / verification rules, see the platform policy skill:
- `clawmobile-policy` (or your current mobile policy skill)

---

## Labels

- **COMPLETE**: Deterministic path can complete the task end-to-end (still must verify).
- **BOOTSTRAP**: Deterministic path can only set up state; finish + verify via `android_agent_task`.

---

## Hardware / Device Controls

| Task | Preferred Backend | Label | Example |
|------|-------------------|-------|---------|
| Flashlight on | Termux | COMPLETE | `android_shell backend="termux" cmd="termux-torch on"` |
| Flashlight off | Termux | COMPLETE | `android_shell backend="termux" cmd="termux-torch off"` |
| Set media volume | Termux | COMPLETE | `android_shell backend="termux" cmd="termux-volume music 7"` |
| Set brightness | Termux | COMPLETE | `android_shell backend="termux" cmd="termux-brightness 150"` |

---

## Clipboard

| Task | Preferred Tool | Label | Notes |
|------|----------------|-------|-------|
| Get clipboard | `tx_clipboard_get` | COMPLETE | |
| Set clipboard | `tx_clipboard_set` | COMPLETE | |

---

## System Navigation / App Launch

| Task | Preferred Backend | Label | Example |
|------|-------------------|-------|---------|
| Go Home | ADB | BOOTSTRAP | `adb_keyevent HOME` |
| Go Back | ADB | BOOTSTRAP | `adb_keyevent BACK` |
| Open Wi-Fi settings | ADB | BOOTSTRAP | `android_shell backend="adb" cmd="am start -a android.settings.WIFI_SETTINGS"` |
| Open app by package | ADB | BOOTSTRAP | `android_shell backend="adb" cmd="monkey -p <package> -c android.intent.category.LAUNCHER 1"` |
| Toggle dark mode | ADB | BOOTSTRAP | `android_shell backend="adb" cmd="cmd uimode night yes"` (use `no` for off) |

---

## Notifications / Attention

| Task | Preferred Tool | Label | Notes |
|------|----------------|-------|-------|
| Completion alert | `android_signal_complete` | COMPLETE | Minimal attention pattern (vibrate + toast). |
| Speak text | `tx_tts` | COMPLETE | |
| Toast message | `tx_toast` | COMPLETE | |

---

## IME Recovery (Critical)

These are deterministic recovery actions to restore input method if agent mode changed it.

| Task | Preferred Backend | Label | Example |
|------|-------------------|-------|---------|
| List IMEs | ADB | COMPLETE | `android_shell backend="adb" cmd="ime list -s"` |
| Set IME | ADB | COMPLETE | `android_shell backend="adb" cmd="ime set <IME_ID>"` |

---

## Minimal Contract Rules

- If a **COMPLETE** entry exists for the user request: use that deterministic path and verify.
- If only a **BOOTSTRAP** entry exists: run it once, then complete + verify using `android_agent_task`.
- For UI-changing steps, verification must use one of:
  - `android_ui_dump` or `android_screenshot`
  - If Portal/UI dump is unstable: fallback to `adb_ui_dump_xml`
- Never claim success unless a tool was called and the result was verified.

---

## Extension Notes (for contributors)

When adding new capabilities:
- Prefer stable, vendor-agnostic commands (Termux / ADB intents).
- Indicate whether the deterministic path is **COMPLETE** or only **BOOTSTRAP**.
- Provide at least one concrete example command/tool invocation.
- If verification differs from the default rules, note the required verification signal.