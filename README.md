# Clawbot Mobile

Clawbot Mobile turns your phone into a pocket‑size agent that goes beyond OpenClaw’s server‑style automation: it runs locally, drives the Android UI with semantic actions, and completes on‑device tasks by interacting with apps, settings, and system UI wherever you are.

## It combines
- OpenClaw — an extensible agent framework
- DroidRun — Android UI automation via ADB + Accessibility
- Termux + Ubuntu (proot) — a fully local runtime on the phone

The result is a self‑hosted, portable gateway that can orchestrate tools and drive the Android UI without any remote control server.

---

## What makes this different?

The mobile agent space is growing quickly, with systems that can drive apps via UI and run multi-step flows. Frameworks like DroidRun already offer natural-language control, planning, and screenshot-aware automation across mobile apps. Clawbot Mobile focuses on a different tradeoff: a local, extensible agent stack that prioritizes deterministic control and deep OpenClaw integration over thin “click-only” automation.

Clawbot Mobile is different:
- 🧠 Local runtime on the device: no remote control server required
- 🔌 OpenClaw as the orchestration layer: reusable tools and skills that plug into existing OpenClaw interfaces
- 👁️ Semantic UI control: accessibility-based actions via the DroidRun Portal app and ADB rather than fragile coordinates
- 🧩 Extensible pipeline: add tools/providers without rewriting the agent loop

---

## What can it do?

Clawbot Mobile can:
- Do everything OpenClaw can do, but locally on the phone, using the same multi‑channel interfaces and tool routing
- Extend OpenClaw with mobile‑only capabilities (semantic UI control, on‑device context, and portability)
- Operate on semantic UI elements via accessibility metadata (text, role, labels) using the DroidRun Portal app and ADB
- Combine deterministic UI actions with higher‑level task planning when needed
- Run tasks inside proot and treat the phone as a portable gateway

Examples:
- “Summarize my latest messages, then open Settings and connect to HomeNet”
- “Run a job in proot, then report the result back to Telegram”

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
  └─ Agent mode (advanced)
        ↓
     DroidRun Agent
        ↓
   Android UI (this device)
```

---

## Why run the agent on the phone?

Running locally enables:
- 📱 Control of apps that cannot be automated remotely
- 🔐 No need to stream your screen or inputs to a server
- 🧩 Full access to system UI, dialogs, and settings
- ⚙️ Experimentation with long-running agents on real devices

This project explores what “on-device agents” can look like in practice.

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
[INSTALL.md](INSTALL.md)

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
- Install & run: [INSTALL.md](INSTALL.md)
- Code: [openclaw-plugin-mobile-ui/](openclaw-plugin-mobile-ui/)
- FAQ: [FAQ.md](FAQ.md)
- Security & privacy: [SECURITY.md](SECURITY.md)
