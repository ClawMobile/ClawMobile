# Known Issues & FAQ

The recommended public runtime is **ClawMobile** on the default Termux runtime.
This FAQ starts with that path and includes only a short pointer to the archived
legacy full backend.

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

Use the latest Termux from
[F-Droid](https://f-droid.org/packages/com.termux/). If F-Droid is unavailable,
use the official
[Termux GitHub releases](https://github.com/termux/termux-app/releases).
ClawMobile currently treats the Google Play Termux build as best-effort only
because it follows a separate Termux codebase/package path and may differ in
package availability, Termux:API behavior, and Android permission behavior. For
demos, experiments, and supported installs, use F-Droid or GitHub Termux.

If you switch Termux sources, back up anything important, uninstall Termux and
Termux companion apps first, then reinstall all Termux-related apps from the
same source.

If the installer detects Google Play Termux, it stops before changing packages.
Install Termux from F-Droid/GitHub and rerun setup. To intentionally continue on
Google Play Termux for debugging, use:

```sh
CLAWMOBILE_ALLOW_PLAY_TERMUX=1 clawmobile setup --quick
```

If the `clawmobile` command is not installed yet and you are running from a
repository checkout, use:

```sh
CLAWMOBILE_ALLOW_PLAY_TERMUX=1 ./installer/termux-lite/clawmobile setup --quick
```

Also install Termux:API only if you want optional phone integrations such as
clipboard, battery, notifications, or text-to-speech, and install it from the
same source as Termux.

To confirm the installed source and package state, run:

```sh
clawmobile doctor
```

The first sections report the Termux source, version, apt source, and candidates
for key packages such as `termux-api`, `android-tools`, and `tesseract`.

## Setup stops because Google Play Termux was detected

ClawMobile blocks Google Play Termux before changing packages because that build
is best-effort for this runtime. The supported path is Termux from F-Droid or
the official Termux GitHub releases.

Recommended fix:

1. Back up anything important from the old Termux home directory.
2. Install Termux from F-Droid or the official Termux GitHub releases.
3. Re-run the ClawMobile bootstrap or checkout setup.

For explicit debugging on Google Play Termux, rerun with:

```sh
CLAWMOBILE_ALLOW_PLAY_TERMUX=1 clawmobile setup --quick
```

If the `clawmobile` command is not installed yet and you are running from a
repository checkout, use:

```sh
CLAWMOBILE_ALLOW_PLAY_TERMUX=1 ./installer/termux-lite/clawmobile setup --quick
```

This only bypasses the source gate; package availability and Termux:API behavior
may still differ from the supported F-Droid/GitHub path.

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

## `curl`, `git`, or `pkg` fails with an OpenSSL or QUIC symbol error

Some Termux installs can temporarily have mismatched OpenSSL, libngtcp2,
libcurl, curl, git, or package-manager dependencies. Symptoms may look like:

```text
CANNOT LINK EXECUTABLE ".../git-remote-https": cannot locate symbol "SSL_set_quic_tls_transport_params"
fatal: remote helper 'https' aborted session
```

The latest one-command bootstrap avoids touching Termux packages before it has
downloaded ClawMobile: fresh installs fetch the GitHub archive with the `curl`
that launched the bootstrap, then run setup from the downloaded tree. This
avoids depending on `git-remote-https` during the earliest install step.

If `pkg update`, `curl`, or `git` already fails with a linker error, the Termux
package state is probably partially upgraded. Try a full repair with `apt`:

```sh
apt update
apt full-upgrade -y
apt install -y openssl libngtcp2 libcurl curl git ca-certificates
```

If you previously used a fallback mirror, restore ClawMobile's source backup
before retrying:

```sh
if [ -f "$PREFIX/etc/apt/sources.list.clawmobile.bak" ]; then
  cp "$PREFIX/etc/apt/sources.list.clawmobile.bak" "$PREFIX/etc/apt/sources.list"
fi
rm -rf "$PREFIX/var/lib/apt/lists/"*
apt update
apt full-upgrade -y
```

If `apt` has the same linker error, Termux's package manager may be too broken
to repair in place. The fastest recovery is usually clearing Termux app data or
reinstalling Termux from F-Droid/GitHub, then rerunning the latest bootstrap.

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

## OCR tools say `tesseract` is missing

OCR is optional and is not installed by default. Install it only when you need
text recognition from screenshots:

```sh
CLAWMOBILE_TERMUX_INSTALL_OCR=1 clawmobile install
```

Then verify:

```sh
tesseract --version
tesseract --list-langs
```

If package mirrors are slow or failing, you can keep using ClawMobile without
OCR; ADB control, screenshots, UIAutomator XML, trace recording, and generated
skill promotion do not require the OCR package.

## What does quick setup ask for?

`clawmobile setup --quick` asks for three kinds of information:

- **Model provider/API key**: choose the model service OpenClaw will use.
  Quick setup currently has verified defaults for OpenAI, Anthropic, and
  DeepSeek. Use full setup for Gemini, OpenRouter, or a custom
  OpenAI-compatible endpoint until their model routing is verified in the
  current OpenClaw catalog. Get the API key from that provider's dashboard.
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
[INSTALL.md](INSTALL.md) for the main install flow.

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
and local OCR on existing images when the optional OCR engine is installed.

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
CLAWMOBILE_TERMUX_FORCE_BUILD=1 \
CLAWMOBILE_TERMUX_FORCE_PLUGIN_INSTALL=1 \
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

## Archived full backend notes

The legacy full backend used Termux + Ubuntu/proot + DroidRun/MobileRun. It is
no longer updated on `main`. Historical files are available on the
`legacy-full-backend-archive` branch.
