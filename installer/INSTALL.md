# ClawMobile Installation Guide

This is the recommended public installation path for **ClawMobile**. It runs
OpenClaw directly in Termux and includes the mobile tool runtime, optional OCR,
optional ADB control, and the public-preview
generated-skill workflow.

Most users should start here.

---

## Before You Start

Install Termux before running ClawMobile. The supported baseline is the latest
Termux from [F-Droid](https://f-droid.org/packages/com.termux/); if F-Droid is
unavailable, use the official
[Termux GitHub releases](https://github.com/termux/termux-app/releases).
If you install optional Termux companion apps such as Termux:API, install them
from the same source as Termux.

ClawMobile currently treats the Google Play Termux build as best-effort only:
it uses a separate Termux codebase/package path and may differ in package
availability, Termux:API behavior, and Android permission behavior. For demos,
experiments, and supported installs, use F-Droid or GitHub Termux. If you are
switching from another Termux source, back up anything important, uninstall
Termux and Termux companion apps first, then reinstall all Termux-related apps
from the same source.

The installer checks the Termux source before installing packages. If you are
intentionally testing the Google Play build, rerun with:

```sh
CLAWMOBILE_ALLOW_PLAY_TERMUX=1 clawmobile setup --quick
```

If you are running from an existing repository checkout before the `clawmobile`
command has been installed, use:

```sh
CLAWMOBILE_ALLOW_PLAY_TERMUX=1 ./installer/termux-lite/clawmobile setup --quick
```

Prepare:

- an Android phone that can run Termux
- a stable network connection for Termux packages, Node.js, and OpenClaw
- a model provider API key, such as OpenAI, Anthropic, Gemini, OpenRouter,
  DeepSeek, or another OpenAI-compatible endpoint
- optionally, a Telegram bot token from BotFather and your numeric Telegram
  user ID if you want the phone to receive commands from Telegram
- optionally, Android developer options and ADB authorization if you want UI
  control, screenshots, fresh trace recording, or generated-skill execution

If you are not sure what the quick setup questions mean, see
[FAQ.md](FAQ.md#what-does-quick-setup-ask-for) before starting.

For long-running gateway sessions, disable battery optimization for Termux and
allow background activity.

---

## Quick Install

For a fresh Termux install:

```sh
curl -fsSL https://raw.githubusercontent.com/ClawMobile/ClawMobile/main/installer/termux-lite/bootstrap.sh | bash -s -- --quick --start
```

From an existing checkout:

```sh
./installer/termux-lite/clawmobile setup --quick --start
```

`--start` launches the gateway immediately after setup and keeps it in the
foreground. Omit it when you want installation and first run as two separate
steps.

If you omitted `--start`, a quick health check is:

```sh
clawmobile doctor
```

The doctor output includes the Termux source/version, apt source, key package
availability, OpenClaw, Node/npm, ADB, Termux:API, plugin, and workspace checks.

If you omitted `--start`, start the gateway with:

```sh
clawmobile run
```

If you used `--start` and still want to run diagnostics, open another Termux
session or stop the gateway first.

ClawMobile starts with Termux capabilities. Android UI control, fresh trace
recording, and screenshot/state capture become available once ADB is
authorized.

The default runtime provides:

- OpenClaw running directly in Termux
- capability-aware Termux/ADB/mobile tools
- optional OCR for screenshot text recognition
- recorder and offline trace parser
- preview generated skill candidate, promotion, generalization, update, and
  feedback
- optional Telegram quick setup with numeric user allowlisting

Runtime internals and developer commands are in
[termux-lite/README.md](termux-lite/README.md).
Common setup failures are covered in [FAQ.md](FAQ.md).

Before publishing logs or recording directories, review them for screenshots,
typed text, app state, API-key-adjacent configuration, and generated skill
summaries.

---

## Existing Checkout

If you already cloned the repository in Termux:

```sh
cd ClawMobile
./installer/termux-lite/clawmobile setup --quick --start
```

Useful follow-up commands:

```sh
clawmobile doctor
clawmobile repair
clawmobile reset --level plugin
clawmobile reset --level workspace
```

---

## Optional OCR Setup

OCR is useful when ClawMobile needs text from screenshots, but it is not needed
for first install, gateway startup, ADB control, trace recording, or generated
skill promotion. It is not installed by default so the normal setup stays
smaller and less sensitive to slow package mirrors.

Install OCR when you need screenshot text recognition:

```sh
CLAWMOBILE_TERMUX_INSTALL_OCR=1 clawmobile install
```

Verify it with:

```sh
tesseract --version
tesseract --list-langs
```

If an OCR tool is called before OCR is installed, ClawMobile reports the missing
capability and points back to this install command.

---

## Optional ADB Setup

ClawMobile can run without ADB for Termux-side tools, files, network tasks, and
local OCR on existing images when the optional OCR engine is installed.

ADB is required for app UI control, live screenshots, UIAutomator XML, Android
shell commands, fresh trace recording, and generated-skill execution against
apps.

Check ADB:

```sh
adb devices
```

If no device is listed, enable Android developer options and wireless
debugging, then pair from Termux:

```sh
adb pair 127.0.0.1:<PAIRING_PORT> <PAIRING_CODE>
adb connect 127.0.0.1:<CONNECT_PORT>
adb devices
```

The pairing port and connect port are different. Keep the wireless debugging
screen visible while entering the pairing command.

After the first successful connection, the Android wireless debugging connect
port may change. For a more stable local loopback connection, switch the
authorized session to TCP/IP port 5555:

```sh
adb tcpip 5555
adb connect 127.0.0.1:5555
adb disconnect 127.0.0.1:<CONNECT_PORT>
adb devices
```

ClawMobile prefers `127.0.0.1:5555` when it is available. If the 5555 switch
fails, keep using the temporary `<CONNECT_PORT>` connection and retry the
switch after ADB is authorized.

If typing those commands on the same phone is awkward, you can start the
gateway first and send ClawMobile the pairing values from another device, such
as Telegram on a laptop or another phone. Ask it to use the Termux shell, not
ADB shell, for the setup commands:

```text
Use the Termux shell to run:
adb pair 127.0.0.1:<PAIRING_PORT> <PAIRING_CODE>
adb connect 127.0.0.1:<CONNECT_PORT>
adb tcpip 5555
adb connect 127.0.0.1:5555
adb disconnect 127.0.0.1:<CONNECT_PORT>
adb devices
Then check the Android capability status.
```

This works before ADB is ready because the commands run in Termux. After ADB is
authorized, ClawMobile detects the new UI-control capabilities on later tool
calls.

---

## Archived Backend

The legacy full DroidRun/MobileRun backend is no longer updated on `main`.
Historical files are available on the `legacy-full-backend-archive` branch for
researchers who specifically need the old Ubuntu/proot, DroidRun Portal, or
Accessibility-backed path.
