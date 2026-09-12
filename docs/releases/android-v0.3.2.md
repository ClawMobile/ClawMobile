# Android 0.3.2 — More Reliable Phone Interaction

Android 0.3.2 is a focused reliability update for ordinary app-local agent tasks.

## What's Improved

- **Preserving existing text:** explicit insertions and unique-fragment edits keep
  the original plain text and whitespace locally, with bounded readback checks.
- **Finding and clicking controls:** improved handling of text labels inside
  clickable rows, safe parent selection, and long-press inputs.
- **Recognizing new forms:** better evidence after opening a creation form, while
  distinguishing new objects from new text added to existing objects.
- **Reading deeply nested screens:** a deeper, bounded local UI index exposes
  controls missed by the earlier depth limit. Model-facing output limits are
  unchanged, although actual observations and token usage can differ.
- **Stopping and permissions:** tool dispatch rechecks enabled capabilities, and
  cancellation is not treated as an ordinary failure that should trigger recovery.

Existing model preferences, GPT-5.6-Sol defaults, generated Skills, and the optional
Termux/OpenClaw Shell Runtime are unchanged. No new Android permissions are required.
This release does not introduce a new Workflow engine or claim a new benchmark score.

## Upgrading

Install over an existing release-signed build to retain settings, task history,
local skills, and saved beta access. Do not uninstall first. Debug-signed test
builds use a different signature; ask a maintainer before uninstalling because
uninstalling clears local data. Android app versions and ClawMobile core/runtime
versions are independent.

## Android Download

[Download ClawMobile for Android](https://github.com/ClawMobile/ClawMobile/releases/download/v0.5.3/ClawMobile-v0.3.2.apk)

- Android version: **0.3.2** (`versionCode 16`).
- APK filename: `ClawMobile-v0.3.2.apk`.
- SHA-256: `ed08426b5b0b045905ad4fc198b63a2d8f1e8a82659844160d237198043d5330`.

The APK checksum must match the [published APK metadata](android-companion.json).

## Known Limitations

Text-preserving edits require an app to expose its complete editable plain-text
value to Accessibility; rich-text styling and hidden content are not covered.
Very large UI trees still have explicit safety limits. Task outcomes depend on
the selected model, permissions, target app, and starting state. Generated Skills
remain preview functionality.
