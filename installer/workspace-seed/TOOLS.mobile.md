<!-- CLAWBOT_MOBILE_BEGIN -->
## Android Tools (Clawbot Mobile)

This runtime provides Android UI automation tools.

### Backends (3 kinds)
- **DroidRun / Portal (Accessibility)**: semantic UI tools (`android_ui_*`, `android_agent_task`).
- **ADB (low-level deterministic)**: `adb_*` tools and `android_*` with `backend=auto|adb`.
- **Termux:API (device UX)**: `tx_*` tools; completion alerts via `android_signal_complete`.

### Tool selection rules (strict)
1. Prefer command-line (Termux/ADB) only when it can **COMPLETE** and/or **VERIFY** the task or part of the task.
2. If command is **BOOTSTRAP** only, run it once then switch to `android_agent_task` to finish and verify.
3. Use DroidRun agent mode for multi-step UI workflows.
4. Use manual `android_ui_*` only if agent mode fails or is unsafe.
5. Verify task-level UI changes (screen transitions or workflow milestones) with android_ui_dump or android_screenshot.

### Quick start
1. `android_health`
2. `android_agent_task`
3. If stuck: `android_screenshot` and `android_ui_dump`

### Tool catalog (selected)

#### Health / observation
- `android_health`
- `android_screenshot` — writes a PNG file and returns `{ ok, path, bytes, width, height }` (no base64).
- `android_ui_dump` — may return `{ ok:false, logPath }` if Portal is unstable; fallback: `adb_ui_dump_xml`.

#### Completion alerts
- `android_signal_complete` — attention layer; may use Termux or ADB internally (only one exposed tool).

#### Agent mode
- `android_agent_task` — preferred for multi-step UI workflows. DroidRun agent mode remains the primary engine for semantic UI workflows.

#### Semantic UI tools
- `android_ui_find`, `android_ui_tap_find`, `android_ui_type_find`
- `android_ui_tap`, `android_ui_type`

#### ADB tools
- `adb_devices`, `adb_keyevent`, `adb_ui_dump_xml`
- `adb_screenshot` — writes a PNG file and returns `{ ok, path, bytes, width, height }`.
- `adb_tap`, `adb_swipe`, `adb_type`

#### Termux tools
- `tx_notify`, `tx_tts`, `tx_toast`
- `tx_clipboard_get`, `tx_clipboard_set`
- `tx_battery_status`

#### Command runner
- `android_shell` — **recommended** mechanism to execute catalog-listed Termux/ADB commands:
  - Termux: `android_shell backend="termux" cmd="termux-..."`
  - ADB: `android_shell backend="adb" cmd="..."`
  Outputs are truncated for safety.

### Notes
- If UI changes unexpectedly, re-run `android_screenshot` or `android_ui_dump` before acting.
- If ADB shows `unauthorized`, accept the debugging prompt on the phone.

<!-- CLAWBOT_MOBILE_END -->
