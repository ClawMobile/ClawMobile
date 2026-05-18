# Known Issues & FAQ

The recommended public runtime is **ClawMobile** on the default Termux runtime.
This FAQ starts with that path and keeps legacy full-backend notes only where
they are still useful.

If something feels randomly broken, first check:

```sh
clawmobile doctor
```

If the `clawmobile` command is not installed yet, run the same checks from the
repository checkout:

```sh
./installer/termux-lite/clawmobile doctor
```

## Which Termux should I install?

Use the latest Termux from F-Droid or GitHub. The old Play Store Termux package
is not recommended because its repositories are outdated.

Also install Termux:API only if you want optional phone integrations such as
clipboard, battery, notifications, or text-to-speech.

## GitHub raw URL or `curl` does not work

The one-command bootstrap uses `raw.githubusercontent.com`. Some networks block
or slow that domain.

Use an existing checkout instead:

```sh
git clone https://github.com/ClawMobile/ClawMobile.git
cd ClawMobile
./installer/termux-lite/clawmobile setup --quick --start
```

If `git clone` is also blocked, download the repository as a zip file, extract
it in Termux, and run the same local setup command from the extracted directory.

## Termux package install fails

Symptoms may include:

```text
File has unexpected size
Mirror sync in progress?
Unable to locate package
```

ClawMobile already tries several Termux mirror fallbacks and clears stale
apt lists when a mirror looks broken. If the install still fails:

```sh
pkg update
clawmobile setup --quick
```

You can force a known mirror for one run:

```sh
CLAWMOBILE_TERMUX_APT_MIRROR=https://packages.termux.dev/apt/termux-main \
clawmobile setup --quick
```

If the selected network cannot reach Termux mirrors, switch networks and rerun
setup. Re-running setup is safe; it is designed to repair an incomplete install.

## What does quick setup ask for?

`clawmobile setup --quick` asks for three kinds of information:

- **Model provider/API key**: choose the model service OpenClaw will use, such
  as OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, or a custom
  OpenAI-compatible endpoint. Get the API key from that provider's dashboard.
  Quick setup shows pasted keys by default so you can confirm the input on your
  phone. Use `CLAWMOBILE_HIDE_SECRETS=1 clawmobile setup --quick` if you want
  hidden input.
- **Chat channel**: Telegram is the recommended first channel because it lets
  you send commands to the phone from another phone or computer.
- **Telegram bot/user IDs**: create a bot with `@BotFather` and paste the bot
  token. Your numeric Telegram user ID is optional but recommended because it
  lets quick setup allowlist you immediately. You can get it from
  `@userinfobot` / `@getidsbot`, or by messaging your bot and checking Telegram
  Bot API `getUpdates`.

You can skip the model or channel during quick setup and run `clawmobile setup`
later for OpenClaw's full interactive setup. See
[termux-lite/README.md](termux-lite/README.md) for the full install flow.

## Setup finished. What should I run next?

If you used `--start`, the gateway is already running. Keep that Termux session
open and send a message through your configured channel.

If you omitted `--start`, run:

```sh
clawmobile doctor
clawmobile run
```

Keep that Termux session open while the gateway is running. If you configured
Telegram, send a message to your bot from the allowlisted user.

## Telegram replies do not work

Check:

- the bot token was copied from BotFather correctly
- the numeric Telegram user ID was allowlisted during quick setup, or pairing
  was completed with `clawmobile pair <code>`
- the gateway is still running in Termux

If you skipped the user ID during setup, start the gateway, message the bot, and
run:

```sh
clawmobile pair <code>
```

## The gateway stops responding after a while

Android battery optimization may stop Termux in the background.

Fix:

1. Open Android system settings.
2. Find Termux under Battery / App management.
3. Set it to Unrestricted / No restrictions.
4. Allow background activity.
5. Keep Termux open or pin it in recent apps on devices that aggressively kill
   background processes.

## ADB is not available

ClawMobile still works without ADB for Termux-side tools, files, network tasks,
and local OCR on existing images.

ADB is needed for UI control, live screenshots, UIAutomator XML, Android shell,
fresh trace recording, and generated-skill execution against apps.

Check:

```sh
adb devices
```

If no device is listed, enable Android developer options and wireless debugging,
then pair from Termux:

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

If entering those commands on the same phone is inconvenient, start the
ClawMobile gateway first and send the pairing details from another device. Ask
ClawMobile to use the Termux shell:

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

This does not require ADB to already be available. Once pairing succeeds,
ClawMobile detects the new ADB-backed capabilities on later tool calls.

## `adb devices` shows unauthorized

Android has not authorized this ADB session.

Fix:

1. Enable developer options.
2. Enable USB debugging or wireless debugging.
3. Accept the Android debugging prompt.
4. Check "Always allow from this computer" when available.
5. Rerun `adb devices`.

## OpenClaw says no model or no API key

Run quick setup again:

```sh
clawmobile setup --quick
```

Or provide the key non-interactively:

```sh
OPENAI_API_KEY=sk-... clawmobile setup --non-interactive --auth-choice openai-api-key
```

The quick setup can store the key in `~/.openclaw/.env` if you choose to save
it. Do not commit this file or paste it into public logs.

## Skills are visible but mobile tools are missing

Force a plugin rebuild and reinstall:

```sh
CLAWMOBILE_LITE_FORCE_BUILD=1 \
CLAWMOBILE_LITE_FORCE_PLUGIN_INSTALL=1 \
clawmobile run
```

Then ask OpenClaw to check `android_health`.

## Generated skill execution failed

Generated skills are evidence-driven and may need more than one demo for robust
execution, especially when an app opens in a different state.

Recommended recovery:

1. Let OpenClaw finish the normal recovery path if possible.
2. Ask it for the generated skill status.
3. Record another clean demo from the app state that failed.
4. Use the trace-induction workflow to update the existing skill from the new
   demo.

Do not publish generated skills or trace folders until you have checked them for
screenshots, typed text, app names, and personal data.

## How do I reset?

Common resets:

```sh
clawmobile reset --level plugin
clawmobile reset --level workspace
clawmobile reset --level state
clawmobile reset --level full
```

Use `plugin` after plugin/tool registration problems, `workspace` after skill
seed issues, `state` after broken OpenClaw local state, and `full` when you want
to reinstall OpenClaw itself.

After a full reset:

```sh
clawmobile setup --quick --start
```

## Full DroidRun backend notes

The legacy full backend uses Termux + Ubuntu/proot + DroidRun/MobileRun. Use it
only when you specifically need the advanced DroidRun path.

Full backend entrypoints are still under:

```sh
./installer/termux/install.sh
./installer/termux/onboard.sh
./installer/termux/run.sh
./installer/termux/reset.sh
```

Most public users should start with the default ClawMobile install instead.
