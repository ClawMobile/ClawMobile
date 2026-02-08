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

⚠️ This system controls the same phone it is running on.

---

## Before you start

### 1. Android system requirements

On your phone, enable:
1. Developer options
2. USB debugging
3. Accessibility service for DroidRun Portal

During installation, Android will show permission dialogs.
You should accept them (preferably with “Always allow”).

---

### 2. Termux

Install Termux with the latest version.

Open Termux and make sure to have this project directory available.

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

## Installation steps

### Step 1 – Run the installer

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

### Step 2 – Required manual actions during install

While `install.sh` is running, you will be asked to:
1. Accept Android debugging authorization
2. Allow installation of DroidRun Portal, you can cancle the overlay option if you want to keep using the original screen after installation.
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

### Step 3 – Export model API key (for DroidRun agent)

In Termux, before starting the gateway (use openai as an example):

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
./installer/termux/run.sh
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

Next time, you can simply run `./installer/termux/run.sh` to start the gateway without going through installation again.

---

### Step 5 – Pair the bot (first time only)

In Telegram:
1. Send any message to your bot
2. The bot will respond with a pairing code / ID
3. Open a new Termux window (⚠️ Do not stop the running gateway)
4. From the project root, run:

```sh
./installer/termux/pairing.sh <CODE>
```

Example:

```sh
./installer/termux/pairing.sh ABCD1234
```

Once paired, you can close this second window.

---

### Step 6 – Using Clawbot

After pairing:
- Return to Telegram
- Send commands to the bot
- The agent will interact with the current phone UI

#### Onboarding new interfaces or reconfiguring
To onboard new interfaces or reconfigure OpenClaw:
1. Run `./installer/termux/onboard.sh`
2. Follow the prompts to select interfaces and providers

#### Reset OpenClaw configuration
To reset OpenClaw configuration and start fresh:
```sh
./installer/ubuntu/reset-openclaw.sh
```

Optional levels:
- `--level workspace` resets seeded workspace files (AGENTS/TOOLS/rules)
- `--level state` wipes OpenClaw state/config cache
- `--level full` wipes both state and workspace

Example:
```sh
./installer/ubuntu/reset-openclaw.sh --level workspace
```

---

## Directory overview

```
installer/
├─ termux/
│  ├─ install.sh
│  ├─ onboard.sh
│  ├─ pairing.sh
│  └─ run.sh
├─ ubuntu/
│  ├─ bootstrap.sh
│  ├─ env.sh
│  └─ reset-openclaw.sh
└─ workspace-seed/
   ├─ AGENTS.mobile.md
   ├─ TOOLS.mobile.md
   └─ rules/
      └─ clawbot-mobile/
         ├─ android_basics.md
         ├─ mobile-ui.md
         └─ playbooks/
            └─ open_app.yaml
openclaw-plugin-mobile-ui/
```

---

## Quick summary

1. `./installer/termux/install.sh`
   → accept Android permissions and install Droidrun Portal
   → configure OpenClaw interactively
   → Ctrl + C
2. `export OPENAI_API_KEY=...`
3. `./installer/termux/run.sh`
4. Send message to Telegram bot → get code
5. New Termux window: `./installer/termux/pairing.sh <code>`
6. Start chatting

---

For troubleshooting and common issues, see [FAQ.md](FAQ.md).
