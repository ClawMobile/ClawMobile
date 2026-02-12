<!-- CLAWBOT_MOBILE_BEGIN -->
# Mobile Capability Catalog

**Rule:** Prefer command-line when it can COMPLETE the task. If BOOTSTRAP only, run it once then switch to DroidRun agent mode to finish and verify.

---

## Hardware / Device Controls

| Task | Preferred Backend | Label | Example |
|------|-------------------|-------|---------|
| Flashlight on | Termux | COMPLETE | `android_shell backend="termux" cmd="termux-torch on"` |
| Flashlight off | Termux | COMPLETE | `android_shell backend="termux" cmd="termux-torch off"` |
| Volume set | Termux | COMPLETE | `android_shell backend="termux" cmd="termux-volume music 7"` |
| Brightness set | Termux | COMPLETE | `android_shell backend="termux" cmd="termux-brightness 150"` |

---

## Clipboard

| Task | Preferred Tool | Label |
|------|----------------|-------|
| Get clipboard | `tx_clipboard_get` | COMPLETE |
| Set clipboard | `tx_clipboard_set` | COMPLETE |

---

## System Navigation

| Task | Preferred Backend | Label | Example |
|------|-------------------|-------|---------|
| Go Home | ADB | BOOTSTRAP | `adb_keyevent HOME` |
| Go Back | ADB | BOOTSTRAP | `adb_keyevent BACK` |
| Open Wi‑Fi settings | ADB | BOOTSTRAP | `android_shell backend="adb" cmd="shell am start -a android.settings.WIFI_SETTINGS"` |
| Open app by package | ADB | BOOTSTRAP | `android_shell backend="adb" cmd="shell monkey -p <package> -c android.intent.category.LAUNCHER 1"` |

---

## Notification / Attention

| Task | Preferred Tool | Label |
|------|----------------|-------|
| Completion alert | `android_signal_complete` | COMPLETE |
| Speak text | `tx_tts` | COMPLETE |
| Toast message | `tx_toast` | COMPLETE |

---

## Rules
1. If a **COMPLETE** entry exists → use the command/tool path and verify success.
2. If a **BOOTSTRAP** entry exists → run it once, then immediately use `android_agent_task` to finish and verify.
3. If no entry exists → use `android_agent_task` for UI workflows; use `android_ui_*` only if agent mode fails.
4. Always verify UI changes via `android_ui_dump` or `android_screenshot` (or `adb_ui_dump_xml`).

Verification for COMPLETE entries should use the same backend when possible (e.g., check command result or simple state query) before escalating to DroidRun.

---

## IME Recovery

| Task | Preferred Backend | Label | Example |
|------|-------------------|-------|---------|
| List input methods | ADB | COMPLETE | `android_shell backend="adb" cmd="ime list -s"` |
| Switch to a specific IME | ADB | COMPLETE | `android_shell backend="adb" cmd="ime set <IME_ID>"` |

<!-- CLAWBOT_MOBILE_END -->
