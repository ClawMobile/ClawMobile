<p align="center">
  <img src="assets/clawmobile-logo-whitebg.png" width="250" alt="ClawMobile logo" />
</p>

<p align="center">
  <b>Talk to one agent. Let your phone act, learn, and connect.</b>
</p>

<p align="center">
  <a href="https://clawmobile.ae/">Website</a> ·
  <a href="https://dl.acm.org/doi/10.1145/3805621.3807655">Paper</a> ·
  <a href="docs/android-companion-app.md">Android App</a> ·
  <a href="docs/runtime-protocol-v1.md">Runtime Protocol</a> ·
  <a href="installer/INSTALL.md">Install</a> ·
  <a href="installer/FAQ.md">FAQ</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://www.linkedin.com/in/clawmobile-mbzuai/">LinkedIn</a> ·
  <a href="https://www.youtube.com/@ClawMobile-l4x">YouTube</a> ·
  <a href="https://space.bilibili.com/3706946571995651">Bilibili</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Android-3DDC84">
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-App--local%20%2B%20Shell-black">
  <img alt="OpenClaw" src="https://img.shields.io/badge/powered%20by-OpenClaw-blue">
</p>

ClawMobile is an agent-first phone environment for Android. It explores what
phones could become when the primary interface is an agent instead of manual app
switching: the agent can use local tools and files, observe Android state,
control apps with permission, learn reusable mobile skills, and communicate
with trusted agents.

Instead of treating the phone as a remote screen, ClawMobile makes it the
runtime. The Android app now includes an app-local runtime for everyday use,
while advanced users can still connect to the Termux/OpenClaw shell runtime for
full OpenClaw workflows.

<p align="center">
  <img src="assets/clawmobile-feature-graphic.png" width="780" alt="ClawMobile app-local runtime overview" />
</p>

## Get The Android App

The Android app is the recommended way to try ClawMobile. It provides a
phone-native UI for tasks, skills, runtime status, logs, trusted-agent
messaging, and app-local agent execution. Termux setup is optional for users who
want the full shell-backed OpenClaw runtime.

Download the
[latest ClawMobile Android APK](https://github.com/ClawMobile/ClawMobile/releases/latest),
read the [Android app guide](docs/android-companion-app.md), or follow the
[Android beta testing guide](docs/android-beta-testing.md) if you received an
invitation code. Testers who need an invitation can
[apply through the ClawMobile waitlist](https://clawmobile.ae/#waitlist).

[Android 0.3.1](docs/releases/android-v0.3.1.md) improves everyday agent tasks:
UI interaction, task-local notes, completion checks, and recovery. New App-local
OpenAI/Beta setups default to GPT-5.6-Sol; saved model choices are preserved.
See the release notes for the changes and upgrade guidance.

<table>
  <tr>
    <td align="center">
      <img src="assets/clawmobile-app-home-latest.png" width="190" alt="ClawMobile Android app home status dashboard" />
    </td>
    <td align="center">
      <img src="assets/clawmobile-app-tasks-latest.png" width="190" alt="ClawMobile Android app task history screen" />
    </td>
    <td align="center">
      <img src="assets/clawmobile-app-skills-latest.png" width="190" alt="ClawMobile Android app skill library screen" />
    </td>
    <td align="center">
      <img src="assets/clawmobile-app-social-latest.png" width="190" alt="ClawMobile Android app social trusted contacts screen" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Check readiness</strong></td>
    <td align="center"><strong>Continue tasks</strong></td>
    <td align="center"><strong>Reuse skills</strong></td>
    <td align="center"><strong>Connect with trusted contacts</strong></td>
  </tr>
</table>

## Quick Start

### Android App (Recommended)

1. Download the latest APK from the
   [ClawMobile release page](https://github.com/ClawMobile/ClawMobile/releases/latest).
2. Open the ClawMobile app and choose the app-local runtime to start quickly.
3. Configure a model provider. Invitation-based testers can select
   **ClawMobile Beta** and redeem their one-time code in **Settings > Runtime
   Setup**.
4. Use Tasks, Skills, Social, and Settings from the phone-native UI.

The app-local runtime can run tasks, use local tools, manage skills, process
shared content, show token usage, and communicate with trusted agents. Shell
Runtime setup remains available in Settings for Termux/OpenClaw users.

### iOS App

ClawMobile is also available on the
[iOS App Store](https://apps.apple.com/app/id6787042935). The iOS
app focuses on the app-local mobile-agent experience: tasks, shared-content
workflows, artifacts, and skill-ready interaction patterns. Android remains the
platform for the full phone-control demo, including Accessibility/ADB
capabilities and app walkthrough recording.

### Advanced: Termux CLI

Install Termux from [F-Droid](https://f-droid.org/packages/com.termux/) first.
If F-Droid is unavailable, use the official
[Termux GitHub releases](https://github.com/termux/termux-app/releases).
The Google Play Termux build is not the supported ClawMobile install path.

Then run in Termux:

```bash
# Install ClawMobile with the guided quick setup and start the gateway
curl -fsSL https://raw.githubusercontent.com/ClawMobile/ClawMobile/main/installer/termux-lite/bootstrap.sh | bash -s -- --quick --start
```

From an existing repository checkout:

```bash
./installer/termux-lite/clawmobile setup --quick --start
```

Omit `--start` if you want setup to finish before launching the long-running
OpenClaw gateway.

Quick setup will ask for a model provider/API key and, optionally, Telegram
bot details so you can message the phone from another device. If those terms
are unfamiliar, see the FAQ before starting.

More setup paths:

- [Installation guide](installer/INSTALL.md)
- [Runtime reference](installer/termux-lite/README.md)
- [FAQ](installer/FAQ.md)

After the gateway starts, try:

```text
What can you do on this phone?
```

```text
What phone capabilities are available right now?
```

More demos, including skill learning and Android task examples, are in the
[demo gallery](docs/demos.md). Runtime capability details are in the
[runtime reference](installer/termux-lite/README.md).

## Why ClawMobile?

Mobile agents should not just watch a phone screen from the outside.
ClawMobile puts the runtime on the Android device, where the apps, files,
notifications, and user-approved control channels already live.

| Capability | Why it matters |
| --- | --- |
| **One agent-facing phone surface** | The agent can use local files, shell tools, Android state, screenshots, and app control from the same runtime. |
| **Progressive user control** | Start with Termux tools, then add Termux:API, ADB, app control, and trusted-agent messaging only when the user enables them. |
| **From repeated UI work to reusable skills** | Demonstrations and successful runs can become durable app knowledge instead of one-off screen reasoning. |

This makes ClawMobile useful today as a phone-side OpenClaw gateway, a
personal mobile assistant, a generated-skill testbed, and a practical bridge
between language-agent reasoning and deterministic Android actions.

## Runtime Architecture

| Layer | Role |
| --- | --- |
| User channel | Android app, Telegram, or another OpenClaw-supported interface. |
| App-local runtime | The built-in Android runtime for tasks, skills, tools, sharing, and trusted-agent messaging. |
| Optional OpenClaw gateway | The Termux/OpenClaw shell runtime for advanced workflows. |
| ClawMobile workspace | Policies, reusable skills, and generated-skill artifacts. |
| `mobile-ui` plugin | Tool bridge between OpenClaw and mobile backends. |
| Mobile backends | App-local Android tools, Accessibility/ADB control when authorized, optional Termux tools, optional OCR, and generated skill storage. |
| Android apps and device state | The real mobile environment the agent observes and acts on. |

The important design choice is progressive capability. The same agent can run
with only Termux permissions, then use richer phone-control tools when the user
authorizes them.

## Status And Safety

ClawMobile is a public preview for real Android devices. It can run through the
Android app-local runtime or the optional Termux/OpenClaw shell runtime, can use
strong phone-control capabilities when authorized, and may store sensitive
runtime artifacts such as API keys, screenshots, traces, logs, and
generated-skill evidence.

Read the [status and limitations](docs/status-and-limitations.md) and
[security policy](SECURITY.md) before sharing traces, logs, or generated skills.

## Repository Map

- `openclaw-plugin-mobile-ui/`
  Mobile runtime plugin, Android/Termux/ADB/OCR tools, recorder, trace parser,
  generated-skill pipeline, and Termux runtime batch fast path.

- `installer/termux-lite/`
  Current Termux runtime scripts. The directory name is historical; this is the
  maintained default runtime on `main`.

- `installer/workspace-seed-lite/`
  Default OpenClaw workspace seed, policies, and trace-induction skills.

## Where To Go Next

- Use the Android app: [docs/android-companion-app.md](docs/android-companion-app.md)
- Test the Android beta: [docs/android-beta-testing.md](docs/android-beta-testing.md)
- Install ClawMobile: [installer/INSTALL.md](installer/INSTALL.md)
- Runtime reference: [installer/termux-lite/README.md](installer/termux-lite/README.md)
- Status and limitations: [docs/status-and-limitations.md](docs/status-and-limitations.md)
- Troubleshoot setup: [installer/FAQ.md](installer/FAQ.md)
- Report issues safely: [SECURITY.md](SECURITY.md)
- Contribute fixes or skills: [CONTRIBUTING.md](CONTRIBUTING.md)
- Follow public changes: [CHANGELOG.md](CHANGELOG.md)
- Read the paper: https://dl.acm.org/doi/10.1145/3805621.3807655

## Citation

```bibtex
@inproceedings{du2026clawmobile,
  title        = {{ClawMobile}: Rethinking Smartphone-Native Agentic Systems},
  author       = {Du, Hongchao and Wu, Shangyu and Li, Qiao and Pan, Riwei and Li, Jinheng and Sun, Youcheng and Xue, Chun Jason},
  year         = {2026},
  publisher    = {Association for Computing Machinery},
  address      = {New York, NY, USA},
  booktitle    = {Proceedings of the Sixth European Workshop on Machine Learning and Systems},
  pages        = {370--376},
  numpages     = {7},
  series       = {EuroMLSys '26},
  location     = {Edinburgh, Scotland, UK},
  doi          = {10.1145/3805621.3807655},
  url          = {https://doi.org/10.1145/3805621.3807655}
}
```
