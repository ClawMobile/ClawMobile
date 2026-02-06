# Clawbot Mobile (Android / Termux)

Clawbot Mobile runs **OpenClaw directly on an Android device** using
**Termux + proot Ubuntu**, and allows you to control the phone through
a Telegram bot.

There is **no background daemon** on Android.
OpenClaw runs as a foreground process when needed.

---

## What this project does

- Runs OpenClaw on a real Android phone
- Executes actions locally on the device
- Does not rely on a PC, server, or remote runtime

---

## Requirements

- Android phone
- Termux
- Internet connection
- A Telegram bot token

---

## Project layout

```text
installer/
├─ termux/
│  ├─ install.sh   # One-time installation
│  ├─ onboard.sh   # Interactive OpenClaw configuration
│  └─ run.sh       # Start OpenClaw Gateway
└─ ubuntu/
   ├─ bootstrap.sh
   └─ env.sh


⸻

Step 1: Install (one-time)

From the project root directory in Termux:

./installer/termux/install.sh

This script will:
	1.	Install proot-distro
	2.	Install Ubuntu (ubuntu-22.04) if needed
	3.	Enter Ubuntu
	4.	Install OpenClaw and dependencies

Important note

The official OpenClaw install script automatically starts
the interactive configuration (onboard) if no configuration exists.

This is expected behavior.

⸻

Step 2: Interactive configuration (onboard)

During installation, or when you run:

./installer/termux/onboard.sh

OpenClaw will ask you to configure:
	•	Model provider and API key
	•	Telegram bot token
	•	Other OpenClaw options

When you see:

Onboard complete

What to do next
	•	Press Ctrl + C to exit the onboard process
	•	You will be returned to the Termux shell

This is normal and required on Android.

On Android, OpenClaw cannot install a background daemon.
The onboard command only writes configuration and performs a temporary check.

⸻

Step 3: Start the Gateway (required)

After configuration, you must manually start the OpenClaw Gateway.

Run:

./installer/termux/run.sh

This will:
	•	Enter Ubuntu
	•	Switch to the project directory
	•	Start openclaw gateway in the foreground

You should see logs similar to:

Gateway listening on http://127.0.0.1:18789
Telegram channel initialized

As long as this process is running, the Telegram bot will respond.

Stop it with Ctrl + C.

⸻

Telegram pairing (first use)
	1.	Send any message (e.g. hi) to your Telegram bot
	2.	The bot will reply with a pairing code

⸻

Approving the pairing

Open a second Termux window and run:

proot-distro login ubuntu-22.04 --shared-tmp
openclaw pairing approve telegram <PAIRING_CODE>

This allows the gateway to keep running.

⸻

Normal usage

After pairing is approved:
	•	Send messages to the Telegram bot
	•	OpenClaw will respond and execute actions on the device

⸻

Stopping OpenClaw

Press Ctrl + C in the gateway terminal.

There is no background service on Android.

⸻

Important concepts

install.sh
	•	Ensures the environment exists
	•	May automatically trigger onboarding on first install

onboard.sh
	•	Runs interactive configuration
	•	You must exit it manually with Ctrl + C

run.sh
	•	Starts the actual OpenClaw Gateway
	•	This is the command you will use most often

⸻

Summary

Typical workflow:

# One-time
./installer/termux/install.sh

# If you want to reconfigure
./installer/termux/onboard.sh

# Every time you want to use the bot
./installer/termux/run.sh

This behavior is intentional and matches OpenClaw’s design
when running without a system daemon.
