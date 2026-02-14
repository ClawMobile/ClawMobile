# ClawMobile

TL;DR: **OpenClaw on your mobile — an AI agent in your pocket**.

ClawMobile turns your phone into a pocket-sized agent that goes beyond OpenClaw’s server‑style automation: it runs locally, drives the Android UI with semantic actions, and completes on‑device tasks by interacting with apps, settings, and system UI wherever you are.

## Demo videos

<table>
  <tr>
    <td align="center"><strong>Hardware demo</strong></td>
    <td align="center"><strong>Chrome demo</strong></td>
    <td align="center"><strong>Python demo</strong></td>
    <td align="center"><strong>Talabat demo</strong></td>
  </tr>
  <tr>
    <td><video src="assets/hardware.mp4" controls width="280"></video></td>
    <td><video src="assets/chrome.mp4" controls width="280"></video></td>
    <td><video src="assets/randomnumber.mp4" controls width="280"></video></td>
    <td><video src="assets/ice_cream.mp4" controls width="280"></video></td>
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
