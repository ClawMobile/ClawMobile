# Android 0.3.1 — More Reliable Everyday Tasks

Android 0.3.1 strengthens ordinary app-local agent execution, with improvements
to UI interaction, task state, completion checks, and recovery.

## What's Improved

- **Reading and interacting with apps:** improved UI target tracking, long-text
  reading, form filling, scrolling, and correction of text entered into fields.
- **Keeping track of a task:** task-local working notes help retain findings
  across screens without requiring a saved workflow.
- **Checking completion:** review considers the full original request and
  observed results, with clearer incomplete or uncertain outcomes.
- **Recovery and reliability:** bounded recovery from stale UI targets, more
  reliable task history, and clearer network error messages.
- **New-setup model defaults:** App-local OpenAI/Beta setups select GPT-5.6-Sol.
  Ordinary Sol agent actions use low reasoning and an 8192-token completion cap
  (including reasoning tokens, not a fixed cost per request). Explicit workflow
  tuning and other models keep their existing request settings.

The update focuses on ordinary app-local agent execution. Existing generated
Skills and the optional Termux/OpenClaw Shell Runtime remain available.

In an internal AndroidWorld evaluation, the frozen agent-only build underlying
this release achieved 101/116 task successes (87.1%) using GPT-5.6-Sol (low), with
supplemental retries and one empty-target instance replacement.

## Upgrading

- Existing model-provider settings and preferences are preserved. No new Android
  permissions are required.
- Install over an existing release-signed build to retain settings, task history,
  local skills, and saved beta access. Do not uninstall first.
- A debug-signed test build may require uninstalling before the release-signed
  build can be installed. This clears local data; invited testers should arrange
  replacement access with a maintainer before uninstalling.
- Android app versions and ClawMobile core/runtime versions are independent.

## Android Download

[Download ClawMobile for Android](https://github.com/ClawMobile/ClawMobile/releases/download/v0.5.2/ClawMobile-v0.3.1.apk)

- Android version: **0.3.1** (`versionCode 15`).
- APK filename: `ClawMobile-v0.3.1.apk`.
- SHA-256:
  `3c6687eb4da6beee46853b6e623402394babbbf95281d4c29029ad45e5b7dcb8`.

The APK checksum must match the value above and the
[published APK metadata for this version](https://github.com/ClawMobile/ClawMobile/blob/v0.5.2/docs/releases/android-companion.json).

## Known Limitations

Tasks still depend on the selected model, available permissions, and the target
app's UI and starting state. Long or complex tasks can fail or reach resource
limits. Generated Skills remain preview functionality; the
[Android testing guide](../android-beta-testing.md) describes safe testing and
reporting.
