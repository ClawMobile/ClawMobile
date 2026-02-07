# Known Issues & FAQ

This section lists common problems and platform-specific pitfalls when running Clawbot Mobile on Android (Termux + Ubuntu).

If something feels “randomly broken”, check here first.

---

## 🔋 The gateway stops responding after a while

**Symptom**
- Telegram bot stops replying
- No error message in the terminal
- `run.sh` was previously working

**Cause**

Android battery optimization killed Termux in the background.

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

If battery optimization is enabled, the OpenClaw Gateway will be killed silently.

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
./run.sh
```

---

## 📱 No ADB device found / wrong device selected

**Symptom**
- DroidRun cannot control the device
- Agent fails immediately
- ADB reports no device

**Explanation**

In this setup, the current phone appears as a local emulator device inside Ubuntu (proot).

**What the system does**
- `run.sh` automatically selects a usable ADB device
- It prefers `emulator-*` devices, which usually represent the current phone

**If you want to override**

You can force a specific device:

```sh
export DROIDRUN_SERIAL=emulator-5554
./run.sh
```

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

## 🤖 OpenClaw configuration is confusing / too many options

**Explanation**

OpenClaw supports many features and integrations.
You do not need to configure everything.

**Minimum required**
- Choose a model provider
- Configure one interface (Telegram is used in this guide)

Everything else can be skipped or left default.

---

## ⌨️ Input method changes after automation

**Symptom**
- Keyboard switches to DroidRun input method
- You cannot type manually afterward

**Explanation**

DroidRun temporarily switches the input method to perform automation.

**What we do**
- The plugin automatically restores the previous input method
- If something still goes wrong, restart `run.sh`

---

## 🧩 Plugin changes don’t take effect

**Symptom**
- You changed code, but behavior didn’t change
- New tools are not available

**Cause**

OpenClaw loads the compiled plugin, not TypeScript source.

**Fix**

Always rebuild and restart:

```sh
cd openclaw-plugin-mobile-ui
npm run build
cd ..
./run.sh
```

---

## 🔁 Ctrl + C during installation — is this correct?

Yes.

During installation:
- `openclaw onboard` is interactive
- When onboarding finishes, the installer will not exit automatically

You must press:

Ctrl + C

This is expected and correct behavior.

---

## 🧪 Agent vs Executor confusion

**Explanation**
- Executor tools (`ui_find` / `ui_tap` / `ui_type`) → deterministic, stable, preferred
- Agent mode → higher-level, more autonomous, optional

By default:
- The system prefers executor tools
- Agent mode is explicitly invoked

This is intentional for safety and stability.

---

## 📦 Re-running run.sh feels redundant

Yes, and that’s on purpose.

`run.sh` is designed to be idempotent:
- Rebuilds the plugin if needed
- Re-installs the plugin if needed
- Re-selects ADB device
- Re-applies configuration

This trades a bit of startup time for much higher reliability.

---

## 🆘 When in doubt

If something breaks:
1. Stop the gateway (Ctrl + C)
1. Re-export API keys if needed
1. Run:

```sh
./run.sh
```

Most issues are resolved by a clean restart.

---

## Final note

Running a long-lived AI agent on a phone is fundamentally different from a server.

The setup here is optimized for:
- Stability
- Recoverability
- Minimal user guesswork

If you treat `run.sh` as the single source of truth, you’ll avoid 90% of problems.
