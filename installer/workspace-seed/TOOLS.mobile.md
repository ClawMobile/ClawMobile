<!-- CLAWBOT_MOBILE_BEGIN -->
## Android Tools (Clawbot Mobile)

This runtime provides Android UI automation tools.  
**Default: agent-first** (DroidRun agent mode is usually faster on mobile UI).

### Backends (3 kinds)
- **DroidRun / Portal (Accessibility)**  
  Semantic UI tools: `android_ui_*` and `android_agent_task`. Best for safe, human-like UI interaction.
- **ADB (low-level deterministic)**  
  Direct device control: `adb_*` tools and `android_*` with `backend=auto|adb`.
- **Termux:API (device UX signals)**  
  Local device UX: `tx_*` and `android_signal_complete` (vibrate/notification/TTS).

### Tool selection rules
1. Prefer semantic UI tools (`android_ui_*`) or `android_agent_task` for navigation and high-level tasks.
2. Use ADB for deterministic input/screen capture or when Portal is unstable.
3. Use Termux:API only for device-level signals (notifications, TTS, clipboard, battery).
4. Use `android_shell` only for advanced debugging and disable it by default via OpenClaw tool allow/deny config.

### Quick start (recommended)
1. `android_health` — verify toolchain (python/droidrun/adb)
2. `android_agent_task` — attempt the user goal (multi-step)
3. If stuck: `android_screenshot` (and optionally `android_ui_dump`)
4. Use deterministic semantic tools for the next step, then retry agent mode.

### Tool catalog

#### Backends overview
- `droidrun` (semantic UI): preferred for UI automation and safe element targeting.
- `adb` (low-level control): direct input, screenshots, and UIAutomator XML.
- `termux-api` (device UX): notifications, TTS, clipboard, battery, vibration.

#### Health / observation
- `android_health`  
  Verify environment readiness.

- `android_screenshot`  
  Capture the current screen to re-orient and confirm state.

- `android_ui_dump`  
  Dump the UI hierarchy for semantic targeting (useful when screenshots are not enough).
  If Portal is unstable, may return `{ ok:false, logPath }` with a log file under workspace `logs/`.
  Fallback: use `adb_ui_dump_xml`.

#### Agent mode (default)
- `android_agent_task`  
  Runs a higher-level autonomous task using DroidRun agent mode.  
  Use for most multi-step goals and navigation.

**Important guardrail:**  
For high-risk actions (payments, deletes, permissions, sending messages), switch to deterministic tools and confirm with the user if unclear.

#### Semantic UI interaction (preferred deterministic)
Use these when you need precise and safe control (especially before confirmations):

- `android_ui_find`  
  Find UI elements by text/role/hints.

- `android_ui_tap_find`  
  Find a matching element and tap it (one step).

- `android_ui_type_find`  
  Find a matching element and type into it (one step).

- `android_ui_tap`  
  Tap a specific element (when you already have a target reference).

- `android_ui_type`  
  Type into a specific element (when you already have a target reference).

#### Coordinate / gesture tools (fallback)
Use only when semantic UI tools cannot proceed:

- `android_tap`  
  Tap by coordinates.

- `android_swipe`  
  Swipe gesture (use for scrolling).

- `android_type`  
  Type text (general). Prefer `android_ui_type` when possible.

#### ADB tools (low-level)
- `adb_devices`  
  List connected adb devices and states.

- `adb_screenshot`  
  Capture screen via adb (base64 PNG).

- `adb_ui_dump_xml`  
  Dump UIAutomator XML via adb.

- `adb_tap` / `adb_swipe` / `adb_type`  
  Direct input commands.

- `adb_keyevent`  
  HOME/BACK/RECENTS/ENTER or numeric keycodes.

#### Termux:API tools (device UX)
- `tx_notify`  
  Local notification.

- `tx_tts`  
  Text-to-speech.

- `tx_toast`  
  Toast message.

- `tx_clipboard_get` / `tx_clipboard_set`  
  Clipboard access.

- `tx_battery_status`  
  Battery status JSON.

#### Fallback shell
- `android_shell`  
  Execute a command via backend `adb`, `termux`, or `bash` (dangerous commands are blocked; outputs truncated).
  **Advanced / potentially dangerous**. Recommended to disable by default via OpenClaw tool allow/deny config.

### Notes
- The gateway runs on the phone. ADB device selection is handled by `run.sh` and typically targets the **local wireless connected device** representing this phone.
- If ADB shows `unauthorized`, the user must accept the debugging prompt on the phone.
- If the UI changes unexpectedly, re-run `android_screenshot` (and optionally `android_ui_dump`) before acting.

### IME (keyboard) note — important
DroidRun may temporarily switch the default input method (IME).  
Normally it restores the previous IME when the task finishes, but if the agent pauses to ask for user confirmation, the IME may remain on the DroidRun keyboard, making manual typing difficult.

Recovery (ADB):
1. List IMEs: `adb shell ime list -s`
2. Switch back to your preferred IME:
   - `adb shell ime set <your.default.ime/.Service>`

### Completion signaling
Chat notifications may not always appear due to Android system behavior, use android_signal_complete as the completion signal, default signaling is a single 400ms vibration.

<!-- CLAWBOT_MOBILE_END -->
