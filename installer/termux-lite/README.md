# ClawMobile Termux Runtime

This is the recommended public runtime for ClawMobile. It runs OpenClaw
directly in Termux and adds a capability-aware Android tool layer for local
files, shell commands, networking, OCR, optional ADB UI control, generated
skills, and execution feedback.

The same installation can serve as a lightweight phone-side assistant, a mobile
automation runtime, or a demonstration-learning environment. Extra phone-control
capabilities are unlocked automatically when the matching backend is available.

It runs OpenClaw directly in Termux by using the same core approach as:

- https://github.com/AidanPark/openclaw-android

The Termux runtime bootstrap carries the small compatibility subset it needs under
`openclaw-compat/`, with MIT attribution in `openclaw-compat/NOTICE.md`.

## Public Preview Status

The Termux runtime is the recommended public preview path. It is designed for
real-device testing and currently includes the OpenClaw runtime bootstrap, the
mobile-ui plugin, OCR setup, ADB capability detection, trace recording,
generated skill promotion, skill updates, execution feedback, and runtime batch
execution.
Generated skills are part of the public preview: the record -> generate ->
promote -> reuse flow is available now, while multi-demo evolution, automatic
feedback use, fast paths, and batch execution should still be treated as
experimental accelerators.

Recordings and generated skills may contain sensitive app screenshots, input
traces, app state, and model-visible summaries. Review those artifacts before
sharing a workspace or repository snapshot.

## What It Provides

- OpenClaw gateway running directly on the phone
- Termux-only operation for shell, files, network, and local tools
- Termux:API integration when the companion app/package are installed
- optional ADB-backed UI actions, screenshots, UIAutomator XML, and Android
  shell access
- OCR as a base observation tool for screenshots and local images
- preview trace recording, offline trace parsing, skill candidate generation,
  promotion, generalization, update, and feedback
- experimental deterministic batch execution for low-risk generated-skill steps

## Flow

### Option A: Command wrapper

From an existing checkout, install the local `clawmobile` command and run the
normal setup:

```sh
./installer/termux-lite/clawmobile setup
clawmobile run
```

For the shortest guided setup, use ClawMobile's wrapper around OpenClaw
non-interactive onboarding:

```sh
./installer/termux-lite/clawmobile setup --quick --start
```

`setup --quick` asks only for the model provider/API key, stores the key in
`~/.openclaw/.env` when you allow it, optionally configures Telegram with a
BotFather token, applies ClawMobile defaults, and leaves ADB as a later optional
capability upgrade. If you also provide your numeric Telegram user ID, quick
setup allowlists that user and sets it as the command owner so the later
`clawmobile pair <code>` step is usually not needed.
Quick setup shows pasted keys/tokens by default so you can confirm the input on
your phone. Prefix the command with `CLAWMOBILE_HIDE_SECRETS=1` if you want
hidden input.
The short version of these prompts is covered in
[FAQ.md](../FAQ.md#what-does-quick-setup-ask-for).

`--start` launches the OpenClaw gateway immediately after setup. Omit it if you
want setup to finish before starting the long-running gateway with
`clawmobile run`.

Quick setup intentionally exposes only common provider shortcuts:

- OpenAI (recommended)
- Anthropic
- Gemini / Google AI Studio
- OpenRouter
- DeepSeek
- Custom OpenAI-compatible endpoint
- Skip / full OpenClaw interactive setup

Use `/model` or `/model list` in chat after setup to switch concrete models.
Run `clawmobile setup` for OpenClaw's full provider/channel picker.
For faster Termux setup, full diagnostics are skipped by default; run
`clawmobile doctor` when you want the detailed check, or add `--doctor` to
setup.

Telegram user IDs must be numeric. You can get yours from `@userinfobot` /
`@getidsbot`, or by messaging your bot and calling Telegram Bot API
`getUpdates`. If you leave the ID blank, OpenClaw keeps the normal pairing flow:
message the bot after the gateway starts, then run:

```sh
clawmobile pair <code>
```

After the wrapper is installed, common commands are:

```sh
clawmobile install
clawmobile onboard
clawmobile run
clawmobile doctor
clawmobile repair
clawmobile reset --level plugin
clawmobile configure defaults
```

Once the gateway starts, useful first requests are:

```text
Check the current Android capability status.
```

```text
Tell me what app or screen is currently open on the phone.
```

```text
Use clawmobile-trace-induction to record a demo for creating a note in the current notes app, then generate and promote a reusable skill.
```

If ADB is not configured yet, you can still ask ClawMobile from another device
to help with wireless ADB setup through the Termux shell. Keep Android's
wireless debugging pairing screen visible, then send:

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

This path does not require ADB to already work; it uses local Termux commands
and lets the agent verify when ADB-backed capabilities become available.
ClawMobile prefers `127.0.0.1:5555` when it is available because Android's
temporary wireless debugging connect port can change between sessions. If the
5555 switch fails, keep using the temporary `<CONNECT_PORT>` connection and
retry after ADB is authorized.

`clawmobile setup` keeps the existing script flow but wraps it in one command:
install OpenClaw if needed, install/update runtime dependencies and plugin,
sync the workspace seed, run onboarding, then print the next command. Full
diagnostics are optional because they start several fresh OpenClaw CLI
processes on Termux.

Package installs run in non-interactive mode and keep existing Termux config
files by default. This avoids prompts such as `openssl.cnf (Y/I/N/O/D/Z)`
blocking one-command setup.
The installer normally uses the Termux package source already configured on the
device.
If that mirror reports an integrity/sync error such as `File has unexpected
size`, it backs up `$PREFIX/etc/apt/sources.list` to
`sources.list.clawmobile.bak`, tries official primary/CDN plus several Termux
wiki mirrors, clears stale apt lists, and retries the original package command
on each candidate. Override the fallback list with
`CLAWMOBILE_TERMUX_APT_MIRRORS="url1 url2"`, set one mirror with
`CLAWMOBILE_TERMUX_APT_MIRROR=...`, or disable this behavior with
`CLAWMOBILE_TERMUX_APT_FALLBACK=0`.

For scripted local onboarding, provide OpenClaw's non-interactive flags:

```sh
OPENAI_API_KEY=sk-... clawmobile setup --non-interactive --auth-choice openai-api-key
```

The non-interactive path uses `openclaw onboard --non-interactive --mode local`
with `--skip-health`, so it writes local config without requiring the gateway to
already be running.

### Option B: One-command bootstrap

For a fresh Termux install, the optional bootstrap clones this repository,
installs the `clawmobile` wrapper, and runs `clawmobile setup`:

```sh
curl -fsSL https://raw.githubusercontent.com/ClawMobile/ClawMobile/main/installer/termux-lite/bootstrap.sh | bash
```

Pass `--quick` through bootstrap when you want the shorter ClawMobile guided
setup:

```sh
curl -fsSL https://raw.githubusercontent.com/ClawMobile/ClawMobile/main/installer/termux-lite/bootstrap.sh | bash -s -- --quick
```

To start the OpenClaw gateway immediately after setup, add `--start`:

```sh
curl -fsSL https://raw.githubusercontent.com/ClawMobile/ClawMobile/main/installer/termux-lite/bootstrap.sh | bash -s -- --quick --start
```

`--start` is explicit because the gateway is a long-running process and will
occupy the current Termux session.

Override the branch or target directory when testing:

```sh
CLAWMOBILE_REPO_BRANCH=main \
CLAWMOBILE_HOME="$HOME/ClawMobile" \
curl -fsSL https://raw.githubusercontent.com/ClawMobile/ClawMobile/main/installer/termux-lite/bootstrap.sh | bash
```

Skip automatic setup and only install the wrapper:

```sh
CLAWMOBILE_BOOTSTRAP_RUN_SETUP=0 \
curl -fsSL https://raw.githubusercontent.com/ClawMobile/ClawMobile/main/installer/termux-lite/bootstrap.sh | bash
```

### Option C: Manual scripts

The original script entrypoints are still supported.

Install OpenClaw for Android/Termux first:

```sh
./installer/termux-lite/install-openclaw.sh
```

This does not clone the upstream installer. It performs the minimal Termux
bootstrap locally:

- installs Termux build/runtime packages
- installs `glibc-runner` through Termux pacman
- downloads the official Linux arm64 Node.js release
- creates `node`, `npm`, and `npx` wrappers under `~/.openclaw-android/bin`
- installs the OpenClaw npm package and applies Termux path compatibility
  patches

Or let the runtime installer call this bootstrap first:

```sh
CLAWMOBILE_LITE_INSTALL_OPENCLAW=1 ./installer/termux-lite/install.sh
```

Then run from the repo root:

```sh
./installer/termux-lite/install.sh
./installer/termux-lite/onboard.sh
./installer/termux-lite/run.sh
```

`run.sh` starts in the best available capability stage. If no authorized ADB
device is available, OpenClaw starts in the Termux-only stage.

Termux can be noticeably slower than a desktop when starting a fresh
`openclaw` CLI process. `clawmobile setup` writes the normal defaults during
`clawmobile setup`, so `run.sh` avoids refreshing config on every gateway start.
If you intentionally reset or hand-edit OpenClaw config, refresh once with:

```sh
clawmobile configure defaults
```

or force the old per-run refresh behavior:

```sh
CLAWMOBILE_LITE_REFRESH_DEFAULTS_ON_RUN=1 clawmobile run
```

## Capability Stages

The Termux runtime exposes one stable tool set and detects what can actually
run at runtime:

| Stage | How it is reached | Available examples |
| --- | --- | --- |
| Termux | Default after ClawMobile starts | OpenClaw, local shell, files, network, CLI tools, OCR on existing image files when Tesseract is installed |
| Termux:API | Termux:API app + `termux-api` package are present | toast, notifications, clipboard, battery status, TTS |
| ADB shell | `adb devices` shows a device in `device` state | taps, swipes, typing, screenshots, UIAutomator XML, `adb shell` commands |
| Future privileged backends | Shizuku/rish or root support is added later | shell-level or root-level command paths |

Inside OpenClaw, call `android_health` first. It returns the current `stage`,
backend states, and booleans such as `local_shell`, `termux_api`, `ui_input`,
`ui_observe`, `screenshot`, `android_shell`, `local_ocr`, `ocr`, and
`screen_ocr`. `ocr`/`local_ocr` mean local image OCR is available.
`screen_ocr` means OCR plus live screenshot capability are both available.

When ADB is not ready, UI-control tools return a structured
`capability_unavailable` result instead of breaking the runtime.

Capability checks happen at tool-call time. If you start ClawMobile without ADB,
then pair/connect ADB later, later calls to `android_health`, UI observation,
screenshots, and input tools can use the newly available capability without a
reinstall or workspace reset. If ADB disconnects, those same tools degrade back
to structured unavailable results.

Outside OpenClaw, `./installer/termux-lite/doctor.sh` prints quick checks for
OpenClaw, Node/npm, ADB devices, Termux:API commands, plugin registration, and
seeded skills.

## Demonstration Learning

The Termux runtime includes the preview trace-to-skill learning workflow:

- `clawmobile_record_start`
- `clawmobile_record_stop`
- `clawmobile_record_parse`
- `clawmobile_trace_prepare_summary`
- `clawmobile_trace_save_skill_candidate`
- `clawmobile_skill_candidate_promote`
- `clawmobile_skill_generalize`
- `clawmobile_skill_update_from_trace`
- `clawmobile_skill_record_feedback`
- `clawmobile_skill_status`
- `clawmobile_skill_run_fast_path`

Ask OpenClaw to use the `clawmobile-trace-induction` skill to run the full
record -> induce -> promote flow. Recording a fresh trace still requires the
ADB shell stage because the recorder reads `getevent`, screenshots, and Android
state. Parsing, summarizing, generalizing, and promoting an existing trace are
local file operations.

The generated skill is an evidence-backed execution guide, not a guaranteed
hardcoded script. It can work from one clean demo for stable workflows, but more
demonstrations and execution feedback are the intended path for improving
dynamic app states, list selections, layout changes, or app versions. Test a new
skill first on the same device and starting app state used for the demo.

Example user request after `clawmobile run`:

```text
Use clawmobile-trace-induction to record a demo for "create a note in the
current notes app", then generate and promote a reusable skill.
```

The generated skill's primary `SKILL.md` is the generalized skill. The fixed
trace-derived version is retained beside it as `fixed_SKILL.md`.

## OCR

OCR is a generic observation substrate and can be useful for generated skills,
but it is not required for trace recording or promotion.

The Termux runtime installer installs the local OCR engine by default:

```sh
./installer/termux-lite/install.sh
```

Skip OCR installation when you need the smallest possible bootstrap:

```sh
CLAWMOBILE_LITE_INSTALL_OCR=0 ./installer/termux-lite/install.sh
```

You can also install or verify it directly in Termux:

```sh
pkg install -y tesseract
tesseract --version
tesseract --list-langs
```

English OCR is installed by the Termux `tesseract` package. For simplified
Chinese OCR, place a traineddata file under `$PREFIX/share/tessdata/` and run
with `CLAW_MOBILE_OCR_LANG=chi_sim+eng`.

Useful reset helpers:

```sh
./installer/termux-lite/reset.sh --level workspace
./installer/termux-lite/reset.sh --level plugin
```

`run.sh` skips plugin rebuild/reinstall when the runtime dist output and local
install stamp are current. Force a refresh with:

```sh
CLAWMOBILE_LITE_FORCE_BUILD=1 ./installer/termux-lite/run.sh
CLAWMOBILE_LITE_FORCE_PLUGIN_INSTALL=1 ./installer/termux-lite/run.sh
CLAWMOBILE_LITE_FORCE_BUILD=1 CLAWMOBILE_LITE_FORCE_PLUGIN_INSTALL=1 ./installer/termux-lite/run.sh
```

If OpenClaw sees the seeded skills but not tools such as
`clawmobile_record_start` or `android_ocr_dump`, force the combined refresh
above. The installer also pins and enables the local plugin entry, refreshes the
plugin registry, and declares the plugin's tool contract in
`openclaw.plugin.json`.

Generated skills can be updated from another demo after the new recording has a
validated `skill_candidate.json`:

```sh
# Usually invoked by the clawmobile-trace-induction skill inside OpenClaw:
# clawmobile_skill_update_from_trace(existing_skill_dir, new_recording_dir_or_candidate_path)
```

The update keeps the same skill directory, backs up the previous generated
files under `evolution_history/`, stores the new trace evidence under
`evidence/`, and rewrites the primary `SKILL.md` with merged anchor stability.

Generated skills also include a lightweight execution feedback habit. When it
does not interrupt the user-facing task, OpenClaw should call
`clawmobile_skill_record_feedback` after execution attempts so success/failure
counts, short execution history, verified contexts, and failure patterns stay
attached to the skill. Generated skills include metadata that marks them as
ClawMobile-generated and names the feedback/status tools; use
`clawmobile_skill_status` to inspect that state and feedback-derived execution
guidance in structured form.

Generated skills may also include an eligible experimental fast path. For those
skills, OpenClaw can call `clawmobile_skill_run_fast_path` with the required
parameters. The tool loads the generated skill, runs the deterministic batch,
and returns one compact result for normal recovery if the fast path cannot
finish.

The Termux runtime sets:

```sh
CLAW_MOBILE_ADB_ONLY=1
CLAWMOBILE_LITE=1
```

`CLAWMOBILE_LITE=1` is the preferred technical runtime flag.
`CLAW_MOBILE_ADB_ONLY=1` is kept as a legacy alias for the current build path.

In this mode the plugin exposes capability-aware Termux/ADB tools. DroidRun
agent mode is not available; if the compatibility tool is visible, it returns a
structured unavailable result in this runtime.

Useful bootstrap overrides:

```sh
CLAWMOBILE_OPENCLAW_NPM_SPEC=openclaw@2026.5.7
CLAWMOBILE_OPENCLAW_NODE_VERSION=22.22.0
CLAWMOBILE_INSTALL_CLAWDHUB=0
CLAWMOBILE_OPENCLAW_RUN_UPDATE=0
CLAWMOBILE_TERMUX_UPGRADE=1
```

The bootstrap pins OpenClaw to `openclaw@2026.5.7` by default. It does not
run `openclaw update` after installing a pinned version unless
`CLAWMOBILE_OPENCLAW_RUN_UPDATE=1` is set. Override
`CLAWMOBILE_OPENCLAW_NPM_SPEC=openclaw@latest` when intentionally testing the
latest OpenClaw.

Default settings applied by `clawmobile setup --quick` and
`clawmobile configure defaults`:

- `tools.profile=full`
- web search enabled with provider left unset for OpenClaw auto-detection
- `skills.install.nodeManager="npm"`
- `skills.install.preferBrew=false`
- hooks/session-memory left off by default
