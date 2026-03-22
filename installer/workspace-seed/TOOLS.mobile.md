<!-- CLAWMOBILE_BEGIN -->
## Android Tools (ClawMobile)

This runtime provides Android UI automation tools. These tools operate a real Android phone (ADB/Termux/UI). Interpret user requests as phone actions by default.

This file documents the plugin tool surface only.
Tool selection policy and task escalation rules live in the seeded skills.
Capability lookup lives in `skills/clawmobile-capabilities/SKILL.md`, not in a plugin tool.

### Backends (3 kinds)
- **DroidRun / Portal**: `android_agent_task` and health checks.
- **ADB (low-level deterministic)**: `adb_*` tools and the low-level `android_*` wrappers.
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
- `android_ui_dump` — deterministic compatibility wrapper around `adb_ui_dump_xml`; returns XML observation with `source: "adb_ui_dump_xml"`.

#### Completion alerts
- `android_signal_complete` — attention layer; uses lightweight local completion signals.

#### Agent mode
- `android_agent_task` — preferred for multi-step UI workflows.
  - If stuck: run `adb_ui_dump_xml` or `android_screenshot` to diagnose, then retry.

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
- If UI changes unexpectedly, re-run `adb_ui_dump_xml` or `android_screenshot` before acting.
- If ADB shows `unauthorized`, accept the debugging prompt on the phone.

<!-- CLAWMOBILE_END -->
