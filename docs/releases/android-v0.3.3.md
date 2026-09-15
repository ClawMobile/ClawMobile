# Android 0.3.3 — Clearer Target and Content Evidence

Android 0.3.3 is a focused reliability update for ordinary app-local agent tasks.

## What's Improved

- **UI references:** a bound control identifier is no longer mistaken for
  numeric text that should appear in its label. Stale-target protection remains.
- **Input readback:** recover evidence from the same focused field after a
  layout change, without replaying input or relaxing write-target checks.
- **Clipboard source preservation:** tool guidance and completion review
  distinguish pasting existing content from replacing the clipboard. This
  guidance does not add clipboard reading or guarantee model compliance.
- **Visible row text:** separate bounded, owner-bound visible content from
  accessibility descriptions, which some apps leave stale. Partial samples
  remain supplemental; target identity is unchanged.
- **Creation evidence:** guide the agent to inspect the current item when write
  evidence is missing, rather than delete or recreate it just to obtain a receipt.

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

[Download ClawMobile for Android](https://github.com/ClawMobile/ClawMobile/releases/download/android-latest/ClawMobile-v0.3.3.apk)

- Android version: **0.3.3** (`versionCode 17`).
- APK filename: `ClawMobile-v0.3.3.apk`.
- SHA-256: `5acf37104a14c4c5d07b7f5355f400da15c5fc36ba8d8c2fb6571d0b4840049e`.

The `android-latest` release is the fixed Android download channel. It contains
only the current APK and update manifest; version history is kept in the
[changelog](../../CHANGELOG.md). The [current APK metadata](android-companion.json)
tracks the latest published Android version.

## Known Limitations

These fixes depend on the target app exposing useful Accessibility information.
Visible-text sampling and input recovery retain explicit safety limits.
Task outcomes still depend on the selected model, permissions, app, and starting
state. Generated Skills remain preview functionality.
