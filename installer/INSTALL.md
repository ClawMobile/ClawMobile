# ClawMobile – Installation Guide

This project allows you to control the current Android device itself using OpenClaw + DroidRun, typically via a chat interface such as Telegram.

---

## What this does
- Runs an AI agent on your phone
- Uses ADB + Accessibility to interact with the UI
- Accepts commands via OpenClaw (Telegram is used as an example)

⚠️ This system controls the same phone it is running on.

---

## Before you start

### 1. Android system requirements

On your phone, enable:
1. Developer options
2. USB debugging and wireless debugging (ADB)
3. Accessibility service

During installation, Android will show permission dialogs.
You should accept them (preferably with “Always allow”).

---

### 2. Termux

Install Termux and Termux-api with the F-Droid app.

Open Termux and make sure to have this project directory available.

---

### 3. API keys (prepare in advance)

You should have at least one model provider API key ready.

Examples:
- OpenAI
- MiniMax
- Anthropic

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

While `install.sh` is running, you will be asked to:
1. Accept Android debugging authorization
2. Allow installation of DroidRun Portal, you can cancel the overlay option if you want to keep using the original screen after installation.

During OpenClaw configuration you can:
- Configure Telegram (or another interface)
- Skip features you don’t need

---

### Step 2 – Configure OpenClaw interactively

Run OpenClaw interactive configuration (onboard)

Noted that you can not set up model provider during configuration now, so you need to add corresponding parameters when running `./installer/termux/onboard.sh`.

For example:

If you want to use OpenAI, you can run:

```sh
./installer/termux/onboard.sh --auth-choice openai-api-key
```

For other providers, you may need to check the [openclaw documents](https://docs.openclaw.ai/concepts/models).

---

### Step 3 – Export model API key and connect wirelessly (for DroidRun agent)

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

If you cannot find the device with adb in Termux, you should also connect wirelessly using ADB if you want to use DroidRun agent mode remotely. First, test if adb can see the device:

```sh
adb devices
```

If you see your device (e.g. `emulator-5554`), you can skip wireless setup, go to step 4.
If not, you need to connect wirelessly and setup Droidrun again to use the wireless device:

1. Find the pairing code on your phone, usually in the Developer options under Wireless debugging
2. In Termux, run:

```sh
adb pair 127.0.0.1:<PAIRING_PORT> <PAIRING_CODE>
```

Please note that the pairing port may vary and different with connect port. It will also change when you change to another app like Termux, so you need to use split screen or floating window to keep the pairing code visible while running the command in Termux. *

After successful pairing, connect to the device:

```sh
adb connect 127.0.0.1:<CONNECT_PORT>
```

3. You can also then use tcpip to keep more stable connection:

```sh
adb tcpip 5555
adb connect 127.0.0.1:5555
adb disconnect 127.0.0.1:<CONNECT_PORT> # you can disconnect the original connect port after tcpip connection is successful
```

To setup the Droidrun with the wireless device, you need to install the Droidrun Portal with the following command in Termux:

```sh
proot-distro login ubuntu
source /root/venvs/clawbot/bin/activate
droidrun setup
```

---

### Step 4 – Start the Gateway

From the project root:

```sh
./installer/termux/run.sh
```

This script will:
- Detect the local Android ADB device (prefers the emulator-style device representing this phone)
- Prepare DroidRun + ADB
- Start the OpenClaw Gateway

You should see output similar to:

```
[run] adb selected serial: 127.0.0.1:5555
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

If you find the bot is not responding, you may need to stop the battery optimization for Termux in Android settings to allow it to run in the background.

#### Onboarding new interfaces or reconfiguring
To onboard new interfaces or reconfigure OpenClaw:
1. Run `./installer/termux/onboard.sh`
2. Follow the prompts to select interfaces

#### Reset OpenClaw configuration
To reset OpenClaw configuration and start fresh:
```sh
./installer/ubuntu/reset-openclaw.sh
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
└─ ubuntu/
   ├─ bootstrap.sh
   ├─ env.sh
   └─ reset-openclaw.sh

```

---

## Quick summary

1. `./installer/termux/install.sh`
   → accept Android permissions and install Droidrun Portal
2. `./installer/termux/onboard.sh --auth-choice <provider>`
   → configure OpenClaw interactively
3. `export OPENAI_API_KEY=...`
3. `./installer/termux/run.sh`
4. Send message to Telegram bot → get code
5. New Termux window: `./installer/termux/pairing.sh <code>`
6. Start chatting

---

For troubleshooting and common issues, see [FAQ.md](FAQ.md).
