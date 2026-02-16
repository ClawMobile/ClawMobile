# ClawMobile

TL;DR: **OpenClaw on your mobile — an AI agent in your pocket**.

ClawMobile turns your phone into a pocket-sized agent that goes beyond OpenClaw’s server‑style automation: it runs locally, drives the Android UI with semantic actions, and completes on‑device tasks by interacting with apps, settings, and system UI wherever you are.

## Demo videos

<table>
  <tr>
    <td align="center">
      <strong>Hardware demo</strong><br>
      <video src="https://github.com/user-attachments/assets/98f4eb0c-57a4-4ee6-aa18-06b7b721e41c" controls width="320"></video>
    </td>
    <td align="center">
      <strong>System demo</strong><br>
      <video src="https://github.com/user-attachments/assets/56ea6594-4cca-4e5c-9421-6ee195ac608b" controls width="320"></video>
    </td>
    <td align="center">
      <strong>Script demo</strong><br>
      <video src="https://github.com/user-attachments/assets/3d04f10e-c64e-4298-a78e-d2e3c3d106f3" controls width="320"></video>
    </td>
  </tr>
  <tr>
    <td align="center">
      <strong>Chrome demo</strong><br>
      <video src="https://github.com/user-attachments/assets/5a54672b-86fe-4f79-aa05-063a4e12453d" controls width="320"></video>
    </td>
    <td align="center">
      <strong>Maps demo</strong><br>
      <video src="https://github.com/user-attachments/assets/778b64e7-d524-433d-a81c-c3b13cc0799d" controls width="320"></video>
    </td>
    <td align="center">
      <strong>Icecream demo</strong><br>
      <video src="https://github.com/user-attachments/assets/afe9d09d-4f61-4243-95d0-5ff14699dd66" controls width="320"></video>
    </td>
  </tr>
</table>

## It combines
- OpenClaw — an extensible agent framework
- On-device Android automation — Android UI automation via ADB + Accessibility
- Termux + Ubuntu (proot) — a fully local runtime on the phone
- Mobile Workspace (To be released…)

The result is a self‑hosted, portable gateway that can orchestrate tools and drive the Android UI without any remote control server.

---

## How ClawMobile works

ClawMobile runs OpenClaw directly on a mobile device, turning the phone into a self-contained AI agent platform. Rather than simply hosting OpenClaw on-device, ClawMobile integrates it with structured UI automation and deterministic mobile control layers (ADB, Termux, and Accessibility-based tooling). This enables agents not only to converse on the phone, but to actively manipulate apps, inspect UI state, and execute reliable, reproducible workflows.

- 🧠 **Local runtime**: runs fully on-device without requiring a remote control server
- 🔌 **OpenClaw as orchestration layer**: reusable tools and skills plug into existing OpenClaw interfaces
- 👁️ **Semantic UI control**: accessibility-driven actions and ADB, instead of fragile coordinate-based automation
- 🧩 **Extensible control pipeline**: add tools or providers without rewriting the agent loop

---

## What can it do?

ClawMobile can:
- Do everything OpenClaw can do, but locally on the phone, using the same multi‑channel interfaces and tool routing
- Extend OpenClaw with mobile‑only capabilities (semantic UI control, on‑device context, and portability)
- Operate on semantic UI elements via accessibility metadata (text, role, labels) 
- Combine deterministic UI actions with higher‑level task planning when needed
- Run tasks inside proot and treat the phone as a portable gateway

---

## Why run the agent on the phone?

Running locally enables:
- 📱 Control of apps that cannot be automated remotely
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
- Android permissions
- OpenClaw interactive configuration

👉 See the full installation guide here:
[INSTALL.md](installer/INSTALL.md)

---

## Next steps (To be released…)
- Better planning/execution separation
- More robust UI selection strategies
- Improved safety constraints

---

## Where to go next
- Install & run: [INSTALL.md](installer/INSTALL.md)
- FAQ: [FAQ.md](installer/FAQ.md)
