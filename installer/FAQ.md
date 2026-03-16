# Known Issues & FAQ

This section lists common problems and platform-specific pitfalls when running Clawbot Mobile on Android (Termux + Ubuntu).

If something feels “randomly broken”, check here first.

1. [The gateway stops responding after a while](#-the-gateway-stops-responding-after-a-while)
2. [adb devices shows unauthorized](#-adb-devices-shows-unauthorized)
3. [No ADB device found / wrong device selected](#-no-adb-device-found--wrong-device-selected)
4. [Agent mode fails: “No model / no API key”](#-agent-mode-fails-no-model--no-api-key)
5. [Final note when in doubt](#final-note-when-in-doubt)

---

## 🔋 The gateway stops responding after a while

**Symptom**
- Telegram bot stops replying
- No error message in the terminal
- `run.sh` was previously working

**Cause**

Android battery optimization stops Termux in the background.

**Fix (Required)**

Disable battery optimization for Termux:
1. Open System Settings
1. Go to Battery / Power / App management
1. Find Termux
1. Set it to Unrestricted / No restrictions
1. Allow background activity

On some devices you may also need to:
- Disable “App sleep”
- Disable “Background limits”
- Pin Termux in recent apps

If battery optimization is enabled, the OpenClaw Gateway could be killed silently.

On the other side, if you keep the Termux app open and active, the power of your device is likely consumed more quickly.

---

## 📱 adb devices shows unauthorized

**Symptom**

```
adb devices
emulator-5554    unauthorized
```

**Cause**

Android has not authorized this ADB session.

**Fix**

On the phone:
1. Enable Developer options
1. Enable USB debugging (or Wireless debugging)
1. Accept the “Allow USB debugging” prompt
1. Check “Always allow from this computer”

Then rerun:

```sh
./installer/termux/run.sh
```

---

## 📱 No ADB device found / wrong device selected

**Symptom**
- DroidRun cannot control the device
- Agent fails immediately
- ADB reports no device

**Explanation**

In this setup, the current phone can be connected with wireless ADB.

You need to use pair mode to connect it first and it only works when the pairing code is in the foreground when you enter it.

You need split screen or floating window to keep the pairing code visible while running the command in Termux.

After successful pairing, the device will be connected and selected automatically in `run.sh`.

You can also use tcpip to keep a more stable connection.

---

## 🧠 Agent mode fails: “No model / no API key”

**Symptom**
- DroidRun agent errors about missing model
- Agent works only when you manually export variables inside Ubuntu

**Cause**

Environment variables were not exported in Termux before running `run.sh`.

**Fix**

In Termux, before starting the gateway:

```sh
export OPENAI_API_KEY=sk-...
# optional
export DROIDRUN_MODEL=gpt-5.2
./run.sh
```

`run.sh` automatically detects exported keys and passes only the selected provider/model into Ubuntu.

---

## Final note when in doubt

If something breaks:
1. Stop the gateway (Ctrl + C)
1. Re-export API keys if needed
1. Run:

```sh
./installer/termux/run.sh
```

Most issues are resolved by a clean restart.

If problems persist, you can always reset to a clean state:
```sh
./installer/ubuntu/reset-openclaw.sh
```

And then start fresh:

```sh
./installer/termux/onboard.sh
export OPENAI_API_KEY=sk-...
./installer/termux/run.sh
```

Or you can just remove the whole proot ubuntu and start over:

```sh
proot-distro remove ubuntu
./installer/termux/install.sh
...
```
