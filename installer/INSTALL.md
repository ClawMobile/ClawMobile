# ClawMobile – Installation Guide

This project allows you to control the current Android device itself using OpenClaw + DroidRun, typically via a chat interface such as Telegram.

---

## What this does
- Runs an AI agent on your phone
- Uses ADB + Accessibility to interact with the UI
- Accepts commands via OpenClaw (Telegram is used as an example)

⚠️ This system controls the same phone it is running on.

---

## Prerequisites

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

These keys will need to be exported as environment variables in Termux later for DroidRun agent mode.
OpenClaw itself will still be configured interactively.

---

### 4. Chat interface (example: Telegram)

OpenClaw supports multiple interfaces.
This guide uses Telegram as an example.

To use Telegram:
1. Create a bot via @BotFather
2. Save the Bot Token

---

### 5. ADB connection

If you cannot find the device with adb in Termux, you should also connect wirelessly using ADB if you want to use DroidRun agent mode remotely. First, test if adb can see the device:

```sh
adb devices
```

If you see your device (e.g. `emulator-5554`), you can skip wireless setup and continue to step 3.
If not, you need to connect wirelessly and set up DroidRun again to use the wireless device:

1. Find the pairing code on your phone, usually in the Developer options under Wireless debugging
2. In Termux, run:

```sh
adb pair 127.0.0.1:<PAIRING_PORT> <PAIRING_CODE>
```

Please note that the pairing port may vary and is different from the connect port. It can also change when you switch apps, so it is best to use split screen or a floating window to keep the pairing code visible while running the command in Termux.

After successful pairing, connect to the device:

```sh
adb connect 127.0.0.1:<CONNECT_PORT>
```

3. You can also then use tcpip to keep more stable connection:

```sh
adb tcpip 5555
adb connect 127.0.0.1:5555
```

you can disconnect the original connect port after tcpip connection is successful
```sh
adb disconnect 127.0.0.1:<CONNECT_PORT>
```

---

## Installation steps

### Step 1 – Run the installer

Before running the installer, make sure this repository is available inside Termux.

Recommended: clone the repo directly in Termux.

```sh
pkg install git
git clone https://github.com/ClawMobile/ClawMobile.git
cd ClawMobile
```

If you are working from your own fork or another remote, replace the clone URL with that repository.

Alternative: download the repository as a zip file, extract it somewhere Termux can access, and `cd` into the extracted project directory before continuing.

After the repository is available in Termux, run the installer from the project root:

```sh
./installer/termux/install.sh
```

If you want to override the pinned install versions, set them before running:

```sh
export OPENCLAW_VERSION=2026.3.13
export DROIDRUN_VERSION=0.5.1
export DROIDRUN_PORTAL_VERSION=0.6.1
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

Run the OpenClaw interactive onboarding flow.

At the moment, model providers are not fully configured during onboarding, so you should pass the provider choice when running `./installer/termux/onboard.sh`.

For example:

If you want to use OpenAI, you can run:

```sh
./installer/termux/onboard.sh
```

For other providers, refer to the [OpenClaw model documentation](https://docs.openclaw.ai/concepts/models).

---

### Step 3 - Configure DroidRun

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

If no DroidRun Portal is installed or if you hit errors when installing DroidRun Portal, you can install or reconfigure it from Termux:

```sh
./installer/termux/droidrun-setup.sh
```

If you want to remove the installed DroidRun Portal from the phone:

```sh
./installer/termux/droidrun-uninstall.sh
```

When installing or re-running Portal setup, the installer now checks the currently installed
Portal version. If it does not match `DROIDRUN_PORTAL_VERSION`, it will uninstall the old
Portal first and then install the requested version.

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

### Step 6 – Using ClawMobile

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
./installer/termux/reset.sh
```

Useful reset levels:
- `--level soft` only stops the gateway.
- `--level workspace` clears seeded workspace files.
- `--level state` clears OpenClaw state and plugin build output.
- `--level full` also removes the global `openclaw` CLI package.

If you use `--level full`, rerun `./installer/termux/install.sh` before onboarding again.

---

## Quick summary

1. `./installer/termux/install.sh`
   → accept Android permissions and install DroidRun Portal
2. `./installer/termux/onboard.sh --auth-choice <provider>`
   → configure OpenClaw interactively
3. `export OPENAI_API_KEY=...`
4. `./installer/termux/run.sh`
5. Send message to Telegram bot → get code
6. New Termux window: `./installer/termux/pairing.sh <code>`
7. Start chatting

---

For troubleshooting and common issues, see [FAQ.md](FAQ.md).
