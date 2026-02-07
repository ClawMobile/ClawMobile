# Clawbot Mobile (Android) – Installation Guide

This project allows you to control the current Android device itself using OpenClaw + DroidRun, typically via a chat interface such as Telegram.

It runs entirely on the phone using:
- Termux
- Ubuntu (proot-distro)
- OpenClaw (agent framework)
- DroidRun (Android UI automation)

---

## What this does
- Runs an AI agent on your phone
- Uses ADB + Accessibility (DroidRun) to interact with the UI
- Accepts commands via OpenClaw (Telegram is used as an example)
- Supports both:
- Deterministic UI tools (find / tap / type)
- Optional DroidRun agent mode

⚠️ This system controls the same phone it is running on.

---

## Before you start

### 1. Android system requirements

On your phone, enable:
1. Developer options
2. USB debugging
3. (Recommended) Wireless debugging

During installation, Android will show permission dialogs.
You must accept them (preferably with “Always allow”).

---

### 2. Termux

Install Termux (F-Droid recommended).

Open Termux and make sure proot-distro is available.

---

### 3. API keys (prepare in advance)

You should have at least one model provider API key ready.

Examples:
- OpenAI
- Gemini
- Anthropic
- DeepSeek

These keys are required to setting as environment variables in Termux for DroidRun agent mode later.
OpenClaw itself will still be configured interactively.

---

### 4. Chat interface (example: Telegram)

OpenClaw supports multiple interfaces.
This guide uses Telegram as an example.

To use Telegram:
1. Create a bot via @BotFather
2. Save the Bot Token

---

## Installation (one-time)

All commands below are run from the project root directory.

---

## Step 1 – Run the installer

In Termux, from the project root:

```sh
./installer/termux/install.sh
```

This script will:
- Enter Ubuntu (proot)
- Install OpenClaw
- Install DroidRun dependencies
- Install the DroidRun Portal (Android will prompt you)
- Build and install the mobile UI plugin

---

## Step 2 – Required manual actions during install

While `install.sh` is running, you will be asked to:
1. Accept Android debugging authorization
2. Allow installation of DroidRun Portal
3. Run OpenClaw interactive configuration (onboard)

During OpenClaw configuration you can:
- Choose your model provider
- Configure Telegram (or another interface)
- Skip features you don’t need

⚠️ Important

When OpenClaw onboarding finishes:

Press Ctrl + C to exit the installer

This is expected behavior, not an error.

---

## Running the system

### Step 3 – Export model API key (for DroidRun agent)

In Termux, before starting the gateway:

```sh
export OPENAI_API_KEY=sk-xxxxxxxx
```

Optional (override model):

```sh
export DROIDRUN_MODEL=gpt-5.2
```

These environment variables are used only by DroidRun agent mode.
OpenClaw continues to use its own interactive configuration.

---

### Step 4 – Start the Gateway

From the project root:

```sh
./run.sh
```

This script will:
- Detect the local Android ADB device (prefers the emulator-style device representing this phone)
- Automatically install/update the plugin (idempotent)
- Prepare DroidRun + ADB
- Start the OpenClaw Gateway

You should see output similar to:

```
[run] adb selected serial: emulator-5554
[run] droidrun chosen: provider=OpenAI model=gpt-5.2
[openclaw] Gateway listening on ...
```

Leave this terminal running.

---

## Telegram pairing (first time only)

### Step 5 – Get pairing code

In Telegram:
1. Send any message to your bot
2. The bot will respond with a pairing code / ID

---

### Step 6 – Pair the bot (second Termux window)

⚠️ Do not stop the running gateway.
1. Open a new Termux window
2. From the project root, run:

```sh
./installer/termux/pairing.sh <CODE>
```

Example:

```sh
./installer/termux/pairing.sh ABCD-1234
```

Once paired, you can close this second window.

---

## Using Clawbot

After pairing:
- Return to Telegram
- Send commands to the bot
- The agent will interact with the current phone UI

### About UI interaction

By default, the system prefers:
- Accessibility-based UI actions
- Only falls back to coordinates when needed

This makes automation more stable across devices.

---

## Directory overview

```
installer/
├─ termux/
│  ├─ install.sh
│  ├─ pairing.sh
│  └─ README.md
├─ ubuntu/
│  └─ bootstrap.sh

openclaw-plugin-mobile-ui/
memory/
run.sh
```

---

## Quick summary

1. `./installer/termux/install.sh`
   → accept Android permissions and install Droidrun Portal
   → configure OpenClaw interactively
   → Ctrl + C
2. `export OPENAI_API_KEY=...`
3. `./run.sh`
4. Send message to Telegram bot → get code
5. New Termux window: `./installer/termux/pairing.sh <code>`
6. Start chatting

---

For troubleshooting and common issues, see `FAQ.md`.
