# Clawbot Mobile

Clawbot Mobile is an experimental system that runs an AI agent directly on an Android phone, allowing the device to control itself through natural language commands.

## It combines
- OpenClaw — an extensible agent framework
- DroidRun — Android UI automation via ADB + Accessibility
- Termux + Ubuntu (proot) — a fully local runtime on the phone

The result is a self-hosted, on-device agent that can interact with apps, settings, and the UI without any remote control server.

---

## What makes this different?

Most “phone automation” systems fall into one of these categories:
- Remote desktop / mirroring
- Cloud-based agents controlling your phone
- Scripted automation with hard-coded coordinates

Clawbot Mobile is different:
- 🧠 The agent runs on the phone itself
- 🔐 No remote control server required
- 👁️ UI interaction is semantic, based on accessibility components, not screen coordinates
- 🔁 Deterministic tools first, agent second — stability before autonomy

---

## What can it do?

Clawbot Mobile can:
- Navigate Android UI using accessibility nodes
- Find and interact with UI elements by text, ID, or role
- Type into input fields
- Swipe, tap, go back, and launch apps
- Take screenshots and inspect UI state
- Execute high-level tasks using DroidRun’s agent mode (optional)

Examples:
- “Open Settings and turn on Wi-Fi”
- “Search for a Wi-Fi network named HomeNet”
- “Open Telegram and check the last message”

---

## Architecture overview

```
User (Telegram / CLI / other interface)
        ↓
    OpenClaw Gateway
        ↓
  Clawbot Mobile Plugin
        ↓
  ├─ Executor tools (deterministic)
  │    ├─ UI find / tap / type
  │    └─ ADB actions
  │
  └─ Agent mode (optional)
        ↓
     DroidRun Agent
        ↓
   Android UI (this device)
```

Key design choices:
- Accessibility-first UI interaction (not coordinates)
- Executor tools as the default path
- Agent mode is explicit and optional

---

## Why run the agent on the phone?

Running locally enables:
- 📱 Control of apps that cannot be automated remotely
- 🔐 No need to stream your screen or inputs to a server
- 🧩 Full access to system UI, dialogs, and settings
- ⚙️ Experimentation with long-running agents on real devices

This project explores what “on-device agents” can look like in practice.

---

## Supported platforms
- Android (tested on modern Android versions)
- Termux
- Ubuntu (via proot-distro)

---

## Interfaces

OpenClaw supports multiple interfaces.

This repository uses Telegram as an example, but you can use:
- Telegram
- CLI
- Other OpenClaw-supported channels

Telegram is used in the installer guide because it is easy to test and widely available.

---

## Installation & setup

Installation involves:
- Termux
- Ubuntu (proot)
- Android debugging permissions
- OpenClaw interactive configuration

👉 See the full installation guide here:
`installer/README.md`

---

## Current status
- Experimental / research-oriented
- Not intended for production or unattended automation
- Designed for developers, tinkerers, and agent researchers

Expect breaking changes.

---

## Why this project exists

Clawbot Mobile is an exploration of:
- Agentic interaction with real-world mobile UIs
- Accessibility-driven automation
- On-device AI agents with minimal infrastructure

If you are interested in agent systems, mobile automation, or on-device AI, this project is for you.

---

## License & disclaimer

This project controls the local Android device.

Use responsibly.

---

## Next steps (planned)
- Better planning/execution separation
- More robust UI selection strategies
- Additional OpenClaw interfaces
- Improved safety constraints

---

## TL;DR
- 📱 AI agent runs on the phone
- 🧠 OpenClaw for reasoning & orchestration
- 👁️ DroidRun for UI interaction
- 🔐 No remote control server
- 🧪 Experimental, but powerful

---

## Where to go next
- Install & run: `installer/README.md`
- Code: `openclaw-plugin-mobile-ui/`
- Automation rules: `memory/`
