<!-- CLAWMOBILE_BEGIN -->
## Android Tools (ClawMobile)

This runtime provides Android UI automation tools. These tools operate a real Android phone (ADB/Termux/UI). Interpret user requests as phone actions by default.

This file documents the plugin tool surface only.
Tool selection policy and task escalation rules live in the seeded skills.
Capability lookup lives in `skills/clawmobile-capabilities/SKILL.md`, not in a plugin tool.

### Backends (3 kinds)
- **DroidRun / Portal (Accessibility)**: semantic UI tools (`android_ui_*`, `android_agent_task`).
- **ADB (low-level deterministic)**: `adb_*` tools and `android_*` with `backend=auto|adb`.
- **Termux:API (device UX)**: `tx_*` tools; completion alerts via `android_signal_complete`.

> Tool selection / escalation / verification policy lives in: `skills/clawmobile-policy/SKILL.md`.

---

### Tool catalog (selected)

The current interface layers are:
- Workspace seed: this file plus `AGENTS.mobile.md`
- Skills: policy and capability contracts under `skills/`
- Plugin runtime: public tools registered by `openclaw-plugin-mobile-ui`

Use this ownership rule when extending the system:
- Base plugin tools should stay device-generic and reusable across apps.
- Skill files should define policy, capability interpretation, and execution guidance.
- App-specific workflows should move into app-specific extensions rather than into the base runtime layer.

#### Health / observation
- `android_health`
- `android_screenshot` — writes a PNG file and returns `{ ok, path, bytes, width, height }` (no base64).
- `android_ui_dump` — may return `{ ok:false, logPath }` if Portal is unstable; deterministic fallback: `adb_ui_dump_xml`.

#### Completion alerts
- `android_signal_complete` — attention layer; uses lightweight local completion signals.

#### Agent mode
- `android_agent_task` — preferred for multi-step UI workflows.
  - If stuck: run `android_screenshot` or `android_ui_dump` to diagnose, then retry.

#### Semantic UI tools
- `android_ui_find`, `android_ui_tap_find`, `android_ui_type_find`
- `android_ui_tap`, `android_ui_type`
- Efficiency hint:
  - Prefer `android_ui_tap_find` over `android_ui_find` + `android_ui_tap` when one matched tap is the goal.
  - Prefer `android_ui_type_find` over `android_ui_find` + `android_ui_type` when one matched input is the goal.
  - Use `android_ui_dump` when you need inspection or verification, not as a mandatory pre-step for every semantic action.

#### ADB tools
- `adb_devices`, `adb_keyevent`, `adb_ui_dump_xml`
- `adb_screenshot` — writes a PNG file and returns `{ ok, path, bytes, width, height }`.
- `adb_tap`, `adb_swipe`, `adb_type`

#### Termux tools
- `tx_notify`, `tx_tts`, `tx_toast`
- `tx_clipboard_get`, `tx_clipboard_set`
- `tx_battery_status`

#### Command runner
- `android_shell` — recommended mechanism to execute catalog-listed Termux/ADB commands:
  - Termux: `android_shell backend="termux" cmd="termux-..."`
  - ADB: `android_shell backend="adb" cmd="..."`
  Outputs are truncated for safety.

---

### Notes
- If UI changes unexpectedly, re-run `android_screenshot` or `android_ui_dump` before acting.
- If ADB shows `unauthorized`, accept the debugging prompt on the phone.

<!-- CLAWMOBILE_END -->
