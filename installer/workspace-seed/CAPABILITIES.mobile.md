<!-- CLAWBOT_MOBILE_BEGIN -->

# Mobile Capability Catalog

This catalog lists common tasks and the most efficient execution path.

Clawbot must consult this before choosing an execution strategy.

---

## Hardware / Device Controls

| Task | Preferred Backend | Example |
|------|-------------------|---------|
| Flashlight on | Termux | android_shell backend="termux" cmd="termux-torch on" |
| Flashlight off | Termux | android_shell backend="termux" cmd="termux-torch off" |
| Volume set | Termux | android_shell backend="termux" cmd="termux-volume music 7" |
| Brightness set | Termux | android_shell backend="termux" cmd="termux-brightness 150" |

---

## Clipboard

| Task | Preferred Tool |
|------|----------------|
| Get clipboard | tx_clipboard_get |
| Set clipboard | tx_clipboard_set |

---

## System Navigation

| Task | Preferred Backend | Example |
|------|-------------------|---------|
| Go Home | ADB | adb_keyevent HOME |
| Go Back | ADB | adb_keyevent BACK |
| Open Wi-Fi settings | ADB | android_shell backend="adb" cmd="shell am start -a android.settings.WIFI_SETTINGS" |

---

## Notification / Attention

| Task | Preferred Tool |
|------|----------------|
| Completion alert | android_signal_complete |
| Speak text | tx_tts |
| Toast message | tx_toast |

---

## Rules

1. If a task appears in this catalog → use the listed backend/tool.
2. Do NOT use UI clicking for catalog-listed tasks.
3. If a direct command fails, retry once, then escalate to next layer.
4. When unsure, use `mobile_capabilities` tool to query available capabilities.

---

## Input Method (IME) Recovery

| Task | Preferred Backend | Example |
|------|-------------------|---------|
| List input methods | ADB | android_shell backend="adb" cmd="shell ime list -s" |
| Switch to a specific IME | ADB | android_shell backend="adb" cmd="shell ime set <IME_ID>" |

<!-- CLAWBOT_MOBILE_END -->
