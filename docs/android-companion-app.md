# Android App

The ClawMobile Android app is the recommended phone-native interface for
ClawMobile. It includes an app-local runtime for everyday tasks, skills, shared
content, token visibility, and trusted-agent messaging. Termux/OpenClaw remains
available as an optional Shell Runtime for users who want shell-backed tools and
full OpenClaw workflows.

Download the latest APK from the public ClawMobile release page:

- [Latest ClawMobile release](https://github.com/ClawMobile/ClawMobile/releases/latest)
- [Published APK metadata](releases/android-companion.json): version, filename,
  download URL, and SHA-256 for the currently available build.

The APK, release note, update manifest, and published APK metadata must agree on
the version. Verify the APK's SHA-256 against the release note and published
metadata before installing or redistributing it.

When updating an existing release-signed installation, install over it without
uninstalling to retain local settings, task history, skills, and saved beta access.
An earlier debug-signed test APK may require uninstalling first. Uninstalling
clears local app data; invited testers should arrange replacement access with a
maintainer before doing so.

## ClawMobile Beta Access

ClawMobile Beta is an invitation-based model option for selected testers. It is
not required when you configure another supported model provider.

If you received a code:

1. Open **Settings > Runtime Setup**.
2. Select **ClawMobile Beta** as the model provider.
3. Enter the invitation code and tap **Activate**.
4. Wait for **ClawMobile Beta activated**.
5. Confirm that the page shows monthly usage and an access-expiry time.
6. Open **Tasks** and send a simple test request.

Invitation codes are single-use. Redeem the code only on the device you intend
to test, do not share it, and do not include it in screenshots or issue
reports. After activation, avoid **Remove access**, clearing app data, or
uninstalling the app unless a maintainer has arranged a replacement code.

Access can be extended by the test administrator. If access expires, keep the
saved access state and contact the maintainer before removing it. See the
[Android beta testing guide](android-beta-testing.md) for quota, testing, and
reporting details. To request an invitation, use the
[ClawMobile waitlist](https://clawmobile.ae/#waitlist); do not post invitation
codes or access credentials in a public GitHub issue.

## What It Adds

- App-local task execution without requiring Termux setup.
- Optional Shell Runtime setup for Termux/OpenClaw users.
- Runtime status for model access, local tools, Accessibility, ADB, skills,
  and optional shell services.
- A task chat UI for sending requests to the active phone runtime.
- Task completion notifications when long-running work finishes after you leave
  the app.
- Share-sheet intake for text, URLs, images, and files from other apps.
- A skills browser for built-in skills, generated skills, draft imports, and
  shared skills.
- A social/contact UI for trusted agent messaging and skill sharing.
- Accessibility-based demo recording and optional UI control, enabled only after
  Android system consent.
- Optional built-in ADB for stronger taps, swipes, key events, focused text
  input, and supported diagnostics after Android debugging is authorized.
- A terminal/debug surface for setup logs, runtime logs, and shell commands when
  Shell Runtime is used.

## Social And Trusted Contacts

The Social tab lets ClawMobile devices talk to each other through trusted
contacts:

- Create an Agent ID for this phone and share that public ID with people you trust.
- Add another ClawMobile device by its shared Agent ID and a local label.
- Exchange messages with trusted contacts from a conversation-style UI.
- Share generated skills as compact knowledge packages for review and import.
- Messages from unknown senders are filtered from the app UI by default.
- Keep the Recovery Key private. It is shown when a new Agent ID is generated
  or explicitly revealed, and restores the same Agent ID on another device.

## Runtime Modes

The app supports two runtime modes:

1. **App-local runtime:** built into the Android app. It can run tasks, use
   app-local tools, manage skills, process shared content, record demos, and
   communicate with trusted agents.
2. **Shell Runtime:** an optional Termux/OpenClaw backend connected through SSH
   setup and the local runtime protocol.

The app-local runtime is the recommended starting point. The Shell Runtime is
useful for users who need full OpenClaw compatibility, terminal access, or
shell-backed skills.

The local HTTP interface used by the Shell Runtime is an implementation detail.
It is not a stable public API; prefer the Android app or the `clawmobile` CLI
unless you are working on the runtime itself.

## What Still Runs In Termux

Termux is only required for Shell Runtime mode. In that mode, Termux hosts:

- the OpenClaw gateway and ClawMobile runtime
- the local companion HTTP server
- package installs, setup scripts, and runtime start commands
- the OpenClaw workspace and installed skills
- generated-skill artifacts, logs, and runtime state

The Android app controls and observes that optional local service through SSH
and HTTP.

## Recommended Setup Flow

1. Install the APK from the latest ClawMobile release.
2. Open the app and configure a model provider. Invitation-based testers can
   activate ClawMobile Beta with their one-time code.
3. Use the app-local runtime from the Tasks, Skills, Social, and Settings tabs.
4. Enable Accessibility when testing visible phone control, screenshots, or
   demo recording.
5. Optionally configure built-in ADB for stronger low-level phone actions.
6. Optionally configure Shell Runtime if you need Termux/OpenClaw workflows.

Accessibility and ADB are separate capability layers. Accessibility provides
visible UI context and semantic controls. Built-in ADB can accelerate supported
low-level actions after an ADB endpoint has been authorized. ADB can be
bootstrapped once from a USB-connected computer with `adb tcpip 5555`, or
without a computer by pairing Android Wireless debugging from Termux and then
switching the authorized session to port `5555`.

The app-local runtime, normal model-backed tasks, Skills, and Social do not
require Termux. ADB is also not required for basic app-local use.

## Android 0.3.1 Update

Android 0.3.1 improves ordinary app-local agent execution: UI target tracking,
text reading and input, task-local notes, completion checks, and recovery.
New App-local OpenAI/Beta setups default to GPT-5.6-Sol. Ordinary Sol agent actions
use low reasoning and an 8192-token completion cap; saved model choices and
Shell Runtime defaults are preserved.
See the [release notes](releases/android-v0.3.1.md) for the changes, APK checksum,
and upgrade guidance.

## Generated Skills Preview

UI-skill recording and replay remain available. Stable Note and Maps workflows
may use deterministic fast paths. Dynamic or ambiguous interfaces can fall back
to normal model-guided UI execution.

Generated skills remain preview software. Start tests from a known app state,
use non-sensitive sample data, and expect dynamic lists or cross-device layouts
to require additional demonstrations. In particular, repeated controls such as
YouTube `Action menu` items may be too ambiguous for safe fast-path replay.

## Safe Testing And Support

When reporting a problem, include:

- phone model and Android version;
- ClawMobile version;
- the steps you performed;
- expected and actual results;
- whether Accessibility, built-in ADB, or Shell Runtime was enabled;
- a redacted screenshot when it is safe to share.

Do not include invitation codes, access credentials, provider keys, private
task content, recovery keys, or unreviewed runtime logs. Read the
[security policy](../SECURITY.md) and
[status and limitations](status-and-limitations.md) before sharing traces,
screenshots, or generated skills.
