# Android Beta Testing

This guide is for invited testers of the ClawMobile Android public preview.
The test target is Android **0.3.3** (`versionCode 17`). See the
[release notes](releases/android-v0.3.3.md) and
[published APK metadata](releases/android-companion.json) for the download and
checksum.

## Get A Test Invitation

Apply through the
[ClawMobile waitlist](https://clawmobile.ae/#waitlist) and select the Android
feature you want to test. Invitations are issued individually and may be
limited by device compatibility and testing capacity.

Do not request, post, or exchange invitation codes in a public GitHub issue.
Each tester should receive a code privately from a ClawMobile maintainer.

## Install The Test Build

1. Download the release-signed APK from the
   [latest ClawMobile release](https://github.com/ClawMobile/ClawMobile/releases/latest).
2. Confirm that the asset filename and version match the published APK metadata.
3. Confirm its SHA-256 against the release note and published APK metadata.
4. Allow your browser or file manager to install this APK when Android asks.
5. Open ClawMobile and confirm that the app or system app details show the
   published Android version.

A release-signed APK can update an earlier public release that used the same
signing key; do not uninstall first. If a debug-signed test APK is installed,
Android may require you to uninstall it first. Uninstalling or clearing app data
removes local settings, task history, locally stored skills, and saved beta access.

## Activate ClawMobile Beta

1. Open **Settings**.
2. Open **Runtime Setup**.
3. Select **ClawMobile Beta** as the model provider.
4. Enter the invitation code sent to you privately.
5. Tap **Activate** and wait for **ClawMobile Beta activated**.
6. Confirm that monthly usage and an access-expiry time are shown.
7. Open **Tasks** and send a simple request.

Activation requires network access to `https://api.clawmobile.ae`. The
invitation code is redeemed once. The app clears the entered code after a
successful redemption and stores the resulting access credential in
Android-protected app storage.

## Invitation And Access Rules

- Treat the invitation code like a private credential until it is redeemed.
- A code is single-use and should be activated on the intended test device.
- Do not forward the code or include it in screenshots, logs, issues, or chat
  transcripts.
- Do not tap **Remove access**, clear app data, or uninstall the app unless a
  maintainer has arranged replacement access.
- If access expires, keep the existing access state and contact the test
  maintainer. Access may be extended without removing the saved credential.
- If activation fails, report the exact on-screen error but redact the code.

## Usage And Quota

The ClawMobile Beta settings panel shows:

- monthly requests used and the monthly request limit;
- monthly requests remaining;
- daily requests and a suggested daily guide;
- input, output, cached, and reasoning-token totals when available;
- the monthly reset time and access-expiry time.

The monthly request limit is enforced. The daily value is a usage guide rather
than a separate daily hard limit. Times are displayed in the phone's local time
when the app can parse the Gateway timestamp.

ClawMobile Beta is a hosted model path. Model-backed tasks send the task content
and relevant context needed to answer or operate the phone through the
ClawMobile Gateway and its configured model provider. Do not use private,
regulated, or production data during this preview unless you have reviewed and
accepted the applicable privacy and provider terms.

## Capability Setup

Only the model provider is required for normal app-local tasks. Additional
phone-control layers are optional:

| Capability | When to use it | Setup |
| --- | --- | --- |
| Accessibility | Visible UI context, screenshots, OCR, tapping, typing, scrolling, and demo recording | Enable from **Settings > Runtime Setup** and approve the Android disclosure |
| Built-in ADB | Stronger taps, swipes, key events, focused text input, and supported diagnostics | Authorize Android debugging and test `127.0.0.1:5555` in **ADB Bridge** |
| Shell Runtime | Termux/OpenClaw, shell tools, or advanced backend workflows | Enable backend switching and follow the optional Shell Runtime setup |

ADB does not replace Accessibility for understanding the visible UI. It can be
bootstrapped with a USB-connected computer using `adb tcpip 5555`, or without a
computer by pairing Android Wireless debugging from Termux and switching the
authorized session to port `5555`.

## Suggested Test Pass

Run tests with non-sensitive sample data:

1. **Activation:** redeem the invitation and refresh usage.
2. **Basic task:** ask a normal question and confirm the reply completes.
3. **Task lifecycle:** leave and return to a running task; confirm the composer
   unlocks after success or failure.
4. **Visible phone action:** with Accessibility enabled, open an app and perform
   a reversible action.
5. **Skill recording:** record a short workflow using test data.
6. **Skill reuse:** run the generated Skill from a known starting state.
7. **Recovery:** begin from a slightly different safe state and observe whether
   ClawMobile recovers or falls back cleanly.
8. **Optional ADB:** when configured, repeat a text-input or key-event task and
   confirm Home still reports ADB ready.

Avoid destructive actions, financial transactions, account changes, or
messages to real contacts during initial testing.

For Android 0.3.3, also check a short task with disposable sample data, such as
adding a heading to an existing plain-text note while preserving its body and
blank lines, or pasting a known test clipboard value without replacing its
source. Confirm both the actual app state and ClawMobile's final report.
Check that previous task history and
settings remain available after the update. If a task fails, report the visible
error text rather than repeatedly retrying and consuming quota.

## Known Preview Limitations

- Generated Skills work best on the same device, app version, layout, and
  starting state used for the demonstration.
- Dynamic lists and repeated labels can be ambiguous. ClawMobile may reject a
  fast path and use normal model-guided UI execution instead.
- Note and Maps workflows may use stable fast paths; some YouTube workflows
  with repeated `Action menu` controls intentionally fall back.
- Screenshot-heavy verification may be slower on phone hardware.
- ADB may need to be re-enabled after a phone reboot.

## Report A Problem

Include:

- phone model and Android version;
- ClawMobile version;
- whether Accessibility, built-in ADB, or Shell Runtime was enabled;
- exact reproduction steps;
- expected and actual results;
- a redacted screenshot when safe;
- the visible activation, quota, or task error text.

Never include an invitation code, Gateway access credential, provider API key,
Social Recovery Key, private screenshot, or unreviewed task/runtime log.
Security-sensitive reports should follow the
[security policy](../SECURITY.md). General limitations are tracked in
[status and limitations](status-and-limitations.md).
