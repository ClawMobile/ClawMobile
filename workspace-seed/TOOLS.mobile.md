<!-- CLAWBOT_MOBILE_BEGIN -->
## Android Tools (Clawbot Mobile)

This runtime provides Android UI automation tools.  
**Default: agent-first** (DroidRun agent mode is usually faster on mobile UI).

### Quick start (recommended)
1. `android_health` — verify toolchain (python/droidrun/adb)
2. `android_agent_task` — attempt the user goal (multi-step)
3. If stuck: `android_screenshot` (and optionally `android_ui_dump`)
4. Use deterministic semantic tools for the next step, then retry agent mode.

### Tool catalog

#### Health / observation
- `android_health`  
  Verify environment readiness.

- `android_screenshot`  
  Capture the current screen to re-orient and confirm state.

- `android_ui_dump`  
  Dump the UI hierarchy for semantic targeting (useful when screenshots are not enough).

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

### Notes
- The gateway runs on the phone. ADB device selection is handled by `run.sh` and typically targets the **local emulator-like device** representing this phone.
- If ADB shows `unauthorized`, the user must accept the debugging prompt on the phone.
- If the UI changes unexpectedly, re-run `android_screenshot` (and optionally `android_ui_dump`) before acting.
<!-- CLAWBOT_MOBILE_END -->