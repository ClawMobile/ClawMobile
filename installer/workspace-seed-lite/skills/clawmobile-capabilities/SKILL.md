---
name: clawmobile-capabilities
description: Capability-stage map for the ClawMobile Lite runtime.
---

# ClawMobile Lite Capabilities

Use this skill to map common phone actions to the currently available Lite
capabilities. Call `android_health` when the current permission stage is
unknown.

## Stages

| Stage | Capability shape |
| --- | --- |
| `termux` | OpenClaw, local shell, files, network, CLI tools, and OCR on existing image files when `local_ocr=true` |
| `termux_api` | Termux plus local phone APIs such as toast, notification, clipboard, battery, and TTS |
| `adb_shell` | Termux plus Android UI observation/input and `adb shell` commands |

Do not use ADB-required tools unless `android_health.capabilities.ui_input`,
`ui_observe`, `screenshot`, or `android_shell` says that capability is true.
Do not use OCR tools unless `android_health.capabilities.ocr` or
`local_ocr` is true. Use OCR without a `path` only when `screen_ocr` is true.

## Navigation

| Capability | Tool |
| --- | --- |
| Go home | `adb_keyevent HOME` when `ui_input=true` |
| Go back | `adb_keyevent BACK` when `ui_input=true` |
| Recent apps | `adb_keyevent RECENTS` when `ui_input=true` |
| Press enter | `adb_keyevent ENTER` when `ui_input=true` |

## Observation

| Capability | Tool |
| --- | --- |
| List connected devices | `adb_devices` |
| Check runtime capabilities | `android_health` |
| Discover UI keywords compactly | `android_ui_dump` when `ui_observe=true`; returns a local `dump_id` and keyword index, not raw XML by default |
| Query UI nodes compactly | `android_ui_query` when `ui_observe=true`; it fresh-dumps and caches UI XML when no `dumpId` is provided |
| Dump raw UI hierarchy | `adb_ui_dump_xml` or `android_ui_dump rawXml=true` when raw XML is genuinely needed |
| Take screenshot | `adb_screenshot` or `android_screenshot` when `screenshot=true` |
| OCR existing image file | `android_ocr_dump`, `android_match_text_queries`, or `android_resolve_text_queries` with `path` when `ocr=true` or `local_ocr=true` |
| OCR current phone screen | OCR tools without `path` when `screen_ocr=true` |

## App / System Commands

| Capability | Tool |
| --- | --- |
| Local Termux command | `android_shell backend="termux" cmd="..."` |
| Open app by package | `android_shell backend="adb" cmd="monkey -p <package> -c android.intent.category.LAUNCHER 1"` when `android_shell=true` |
| Open Android settings | `android_shell backend="adb" cmd="am start -a android.settings.SETTINGS"` when `android_shell=true` |
| Open Wi-Fi settings | `android_shell backend="adb" cmd="am start -a android.settings.WIFI_SETTINGS"` when `android_shell=true` |
| List IMEs | `android_shell backend="adb" cmd="ime list -s"` when `android_shell=true` |
| Set IME | `android_shell backend="adb" cmd="ime set <IME_ID>"` when `android_shell=true` |

## Touch / Text

| Capability | Tool |
| --- | --- |
| Tap coordinate | `adb_tap` or `android_tap` when `ui_input=true` |
| Swipe coordinate path | `adb_swipe` or `android_swipe` when `ui_input=true` |
| Type into focused field | `adb_type` or `android_type` when `ui_input=true` |
| Run generated-skill fast path | `clawmobile_skill_run_fast_path` when a generated skill provides an eligible fast path; it loads the skill and calls `clawmobile_batch_execute` internally |
| Run raw deterministic batch | `clawmobile_batch_execute` when explicit batch steps are already available and required ADB/OCR capabilities are available |

Observe before coordinate actions unless the coordinates are explicitly
provided by the user, a previous tool result, or a reliable generated-skill
anchor. For UI XML, call `android_ui_query` directly when the target is known.
Use `android_ui_dump` first only when you need a complete keyword index or plan
to run several related queries on the same screen; then reuse its `dumpId`.
Use `nodeId` and `detail="full"` only when you need to inspect one candidate.
For generated skills, prefer entry/final checkpoint verification over fresh
screenshots after every low-risk coordinate action.

## Demonstration Learning

| Capability | Tool |
| --- | --- |
| Record a fresh touch trace | `clawmobile_record_start` then `clawmobile_record_stop` when ADB/shell-level event and screenshot access are available |
| Parse existing recording | `clawmobile_record_parse` |
| Prepare trace summary | `clawmobile_trace_prepare_summary` |
| Save candidate | `clawmobile_trace_save_skill_candidate` |
| Promote generated skill | `clawmobile_skill_candidate_promote` |
| Refresh generalized skill | `clawmobile_skill_generalize` |
| Read generated skill status | `clawmobile_skill_status` |
| Execute generated skill fast path | `clawmobile_skill_run_fast_path` |

Use the `clawmobile-trace-induction` skill for the full record-to-generated
skill workflow.
