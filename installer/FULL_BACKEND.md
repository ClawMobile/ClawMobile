# Full DroidRun/MobileRun Backend

This is the legacy advanced backend for ClawMobile. It uses OpenClaw +
DroidRun/MobileRun, Termux + Ubuntu/proot, and the DroidRun Portal.

Most users should install the default ClawMobile Termux runtime from
[INSTALL.md](INSTALL.md). Use this full backend only for experiments that
specifically need DroidRun/MobileRun style code-generated multi-step UI
execution or Accessibility-backed control.

---

## What This Backend Does

- Runs an AI agent on your phone
- Uses ADB + Accessibility to interact with the UI through DroidRun/MobileRun
- Accepts commands through OpenClaw, with Telegram commonly used as the chat
  channel

---

## Prerequisites

### Android

On your phone, enable:

1. Developer options
2. USB debugging or wireless debugging
3. Accessibility service permissions for DroidRun Portal

During installation, Android will show permission dialogs. Accept them when you
intend to use this backend.

### Termux

Install Termux and Termux:API from F-Droid.

Open Termux and make sure this project directory is available.

### Model Provider

Prepare at least one model provider API key.

Examples:

- OpenAI
- Anthropic
- Gemini
- DeepSeek
- OpenAI-compatible endpoints

These keys are used by DroidRun agent mode and may need to be exported as
environment variables in Termux. OpenClaw itself still uses its own onboarding
configuration.

### Chat Interface

OpenClaw supports multiple interfaces. Telegram is commonly used for phone-side
testing.

To use Telegram:

1. Create a bot through BotFather.
2. Save the bot token.
3. Complete OpenClaw pairing after the gateway starts.

### ADB Connection

Check whether Termux can see the device:

```sh
adb devices
```

If no device is listed, use wireless ADB:

```sh
adb pair 127.0.0.1:<PAIRING_PORT> <PAIRING_CODE>
adb connect 127.0.0.1:<CONNECT_PORT>
adb devices
```

The pairing port and connect port are different. Keep the wireless debugging
screen visible while entering the pairing command.

For a more stable local connection after pairing:

```sh
adb tcpip 5555
adb connect 127.0.0.1:5555
adb disconnect 127.0.0.1:<CONNECT_PORT>
```

---

## Installation

Clone the repository in Termux:

```sh
pkg install git
git clone https://github.com/ClawMobile/ClawMobile.git
cd ClawMobile
```

Run the full backend installer:

```sh
./installer/termux/install.sh
```

Optional version overrides:

```sh
export OPENCLAW_VERSION=2026.3.13
export DROIDRUN_VERSION=0.5.1
export DROIDRUN_PORTAL_VERSION=0.6.1
./installer/termux/install.sh
```

The installer will:

- enter Ubuntu/proot
- install DroidRun dependencies
- install or update DroidRun Portal
- install OpenClaw

---

## Configure OpenClaw

Run:

```sh
./installer/termux/onboard.sh
```

Follow OpenClaw's prompts to select provider and channel options. For provider
details, see the OpenClaw model documentation:

```text
https://docs.openclaw.ai/concepts/models
```

---

## Configure DroidRun Agent Mode

In Termux, export the provider key before starting the gateway. For OpenAI:

```sh
export OPENAI_API_KEY=sk-xxxxxxxx
```

Optional model override:

```sh
export DROIDRUN_MODEL=gpt-5.2
```

These variables are for DroidRun agent mode. OpenClaw continues to use its own
configuration.

If DroidRun Portal is missing or needs to be reconfigured:

```sh
./installer/termux/droidrun-setup.sh
```

To remove DroidRun Portal:

```sh
./installer/termux/droidrun-uninstall.sh
```

---

## Start The Gateway

From the project root:

```sh
./installer/termux/run.sh
```

You should see output similar to:

```text
[run] adb selected serial: 127.0.0.1:5555
[run] droidrun chosen: provider=OpenAI model=gpt-5.2
[openclaw] Gateway listening on ...
```

Leave this terminal running.

---

## Pair Telegram

In Telegram:

1. Send a message to your bot.
2. The bot replies with a pairing code.
3. Open a second Termux session without stopping the gateway.
4. Run:

```sh
./installer/termux/pairing.sh <CODE>
```

After pairing, return to Telegram and send commands.

---

## Reset

```sh
./installer/termux/reset.sh
```

Useful reset levels:

- `--level soft`: stop the gateway only
- `--level workspace`: clear seeded workspace files
- `--level state`: clear OpenClaw state and plugin build output
- `--level full`: also remove the global `openclaw` CLI package

After `--level full`, rerun `./installer/termux/install.sh` before onboarding
again.

---

## Quick Summary

```sh
./installer/termux/install.sh
./installer/termux/onboard.sh
export OPENAI_API_KEY=...
./installer/termux/run.sh
./installer/termux/pairing.sh <code>
```

For common issues, see [FAQ.md](FAQ.md).
