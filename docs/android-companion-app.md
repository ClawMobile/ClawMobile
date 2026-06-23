# Android Companion App

ClawMobile Companion is an Android app for running ClawMobile from a phone-native UI.
It does not replace Termux. Instead, it uses SSH to install and maintain the
ClawMobile runtime inside Termux, then talks to the local companion server over
HTTP for daily use.

Download the latest APK from the public ClawMobile release page:

- [Latest ClawMobile release](https://github.com/ClawMobile/ClawMobile/releases/latest)
- APK: [`ClawMobile-v0.1.2.apk`](https://github.com/ClawMobile/ClawMobile/releases/latest/download/ClawMobile-v0.1.2.apk)
- SHA-256: `772f6967ea9e489ae58963abffdea01991d3678ff578f5ef24230519d9783547`

If you installed an earlier debug-signed test APK, uninstall it before installing
this release-signed APK.

## What It Adds

- Guided Termux setup from a native Android screen.
- Runtime status for SSH, companion server, OpenClaw runtime, ADB, model key,
  and workspace skills.
- A task chat UI for sending requests to the phone runtime.
- Task completion notifications when long-running work finishes after you leave
  the app.
- A skills browser for generated skills, built-in guidance, and shared skills.
- A social/contact UI for trusted agent messaging and skill sharing.
- A terminal/debug surface for setup logs, runtime logs, and shell commands.

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

## How It Works

The app uses two local channels:

1. SSH to Termux for setup, maintenance, and runtime start commands.
2. Local HTTP to `http://127.0.0.1:8765` for tasks, skills, status, logs, and
   trusted-agent messaging once the companion server is running.

The Termux runtime remains the source of truth. The Android app is a companion
shell for installation, control, monitoring, and user interaction.

The local HTTP interface is an implementation detail between the Android app
and the Termux companion server. It is not a stable public API; prefer the
Android app or the `clawmobile` CLI unless you are working on the runtime
itself.

## What Still Runs In Termux

The app is not a replacement for Termux. Termux still hosts:

- the OpenClaw gateway and ClawMobile runtime
- the local companion HTTP server
- package installs, setup scripts, and runtime start commands
- the OpenClaw workspace and installed skills
- generated-skill artifacts, logs, and runtime state

The Android app controls and observes that local service through SSH and HTTP.

## Recommended Setup Flow

1. Install Termux from F-Droid or the official Termux GitHub releases.
2. Run the SSH setup commands shown in the app.
3. Pair the app with Termux using the local SSH host, port, and username.
4. Run setup from the app.
5. Start the runtime and use the Tasks, Skills, and Social tabs.

ADB is optional, but enables richer phone-control capabilities. Follow the main
ClawMobile setup guide for the current ADB authorization flow.
