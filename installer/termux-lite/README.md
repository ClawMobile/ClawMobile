# ClawMobile Termux Runtime Reference

This file is the technical reference for ClawMobile's current Termux runtime.
For normal installation, start with the
[installation guide](../INSTALL.md).

ClawMobile runs OpenClaw directly in Termux and adds Android-aware tools for
local files, shell commands, networking, optional OCR, optional ADB UI control,
demonstration recording, generated skills, and execution feedback.

The `termux-lite/` directory name is historical. It is the maintained default
Termux runtime on `main`; user-facing docs should simply call it the ClawMobile
Termux runtime.

The OpenClaw-on-Android bootstrap follows the same core approach as:

- https://github.com/AidanPark/openclaw-android

The small compatibility subset used by this runtime is kept in
`openclaw-compat/`, with MIT attribution in `openclaw-compat/NOTICE.md`.

## Install Source

The supported Termux source is
[F-Droid](https://f-droid.org/packages/com.termux/). If F-Droid is unavailable,
use the official
[Termux GitHub releases](https://github.com/termux/termux-app/releases).
Install optional Termux companion apps such as Termux:API from the same source
as Termux.

Google Play Termux is best-effort for this runtime because it follows a
separate codebase/package path and can differ in package availability,
Termux:API behavior, and Android permission behavior. The installer blocks
Google Play Termux before changing packages unless you explicitly allow it:

```sh
CLAWMOBILE_ALLOW_PLAY_TERMUX=1 clawmobile setup --quick
```

If the `clawmobile` command is not installed yet and you are running from a
repository checkout, use:

```sh
CLAWMOBILE_ALLOW_PLAY_TERMUX=1 ./installer/termux-lite/clawmobile setup --quick
```

## Normal Commands

The recommended fresh-install command is documented in
[../INSTALL.md](../INSTALL.md). From an existing repository checkout, the
shortest guided setup is:

```sh
./installer/termux-lite/clawmobile setup --quick --start
```

`--quick` asks for the model provider/API key, optionally configures Telegram,
applies ClawMobile defaults, and leaves ADB as a later capability upgrade.
The guided model path currently uses verified defaults for OpenAI, Anthropic,
and DeepSeek; use full setup for Gemini, OpenRouter, or custom endpoints.
`--start` launches the OpenClaw gateway immediately after setup and keeps it in
the current Termux session.

Common commands after the wrapper is installed:

```sh
clawmobile doctor
clawmobile run
clawmobile repair
clawmobile reset --level plugin
clawmobile reset --level workspace
clawmobile configure defaults
```

For scripted setup, use OpenClaw's non-interactive onboarding flags:

```sh
OPENAI_API_KEY=sk-... clawmobile setup --non-interactive --auth-choice openai-api-key
```

For tests that intentionally skip model/channel setup:

```sh
clawmobile setup --non-interactive --auth-choice skip
```

## Runtime Behavior

`clawmobile setup` installs or updates OpenClaw, installs runtime dependencies,
installs the mobile-ui plugin, syncs the workspace seed, runs onboarding, and
prints the next command. Full diagnostics are skipped by default for faster
Termux setup; run `clawmobile doctor` when you want the detailed check.

Package installs run in non-interactive mode and keep existing Termux config
files by default. If the configured Termux mirror reports an integrity or sync
error, the installer backs up `$PREFIX/etc/apt/sources.list`, tries a small set
of Termux mirrors, clears stale apt lists, and retries the package command.

Useful mirror overrides:

```sh
CLAWMOBILE_TERMUX_APT_MIRROR=https://packages.termux.dev/apt/termux-main clawmobile setup --quick
CLAWMOBILE_TERMUX_APT_MIRRORS="url1 url2" clawmobile setup --quick
CLAWMOBILE_TERMUX_APT_FALLBACK=0 clawmobile setup --quick
```

Termux can be noticeably slower than a desktop when starting fresh OpenClaw CLI
processes. `clawmobile setup` writes the normal defaults once, so gateway
startup does not refresh config on every run. If you intentionally reset or
hand-edit OpenClaw config, refresh once with:

```sh
clawmobile configure defaults
```

## Capability Stages

The Termux runtime exposes one stable tool set and detects which capabilities
are available at tool-call time.

| Stage | How it is reached | Available examples |
| --- | --- | --- |
| Termux | Default after ClawMobile starts | OpenClaw, local shell, files, network, CLI tools, and local OCR on existing image files when the optional OCR engine is installed |
| Termux:API | Termux:API app plus `termux-api` package are present | toast, notifications, clipboard, battery status, text-to-speech |
| ADB shell | `adb devices` shows a device in `device` state | taps, swipes, typing, screenshots, UIAutomator XML, `adb shell` commands |

Inside OpenClaw, call `android_health` first. It returns the current `stage`,
backend states, and booleans such as `local_shell`, `termux_api`, `ui_input`,
`ui_observe`, `screenshot`, `android_shell`, `local_ocr`, `ocr`, and
`screen_ocr`.

When ADB is not ready, UI-control tools return a structured
`capability_unavailable` result instead of breaking the runtime. If ADB is
paired after the gateway starts, later calls can use the newly available
capability without reinstalling or resetting the workspace.

`clawmobile doctor` reports the Termux app source/version, apt source, key
package availability, OpenClaw, Node/npm, ADB devices, Termux:API commands,
plugin registration, and seeded skills.

## Demonstration Learning

The runtime includes a public-preview trace-to-skill workflow:

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
record -> induce -> promote flow. Recording a fresh trace requires the ADB shell
stage because the recorder reads `getevent`, screenshots, and Android state.
Parsing, summarizing, generalizing, and promoting an existing trace are local
file operations.

Generated skills are evidence-backed execution guides, not guaranteed hardcoded
scripts. They can work from one clean demo for stable workflows, but additional
demonstrations and execution feedback are the intended path for improving
dynamic app states, list selections, layout changes, or app versions.

Example request after `clawmobile run` and ADB authorization:

```text
Use clawmobile-trace-induction to record my next phone demonstration.
```

The generated skill's primary `SKILL.md` is the generalized skill. The fixed
trace-derived version is retained beside it as `fixed_SKILL.md`.

Generated skills may include an experimental deterministic fast path. For those
skills, OpenClaw can call `clawmobile_skill_run_fast_path` with the required
parameters. The tool returns a compact result and falls back to normal recovery
when the fast path cannot finish.

## OCR

OCR is a generic observation substrate and can be useful for generated skills,
but it is not required for trace recording or promotion.

The setup path does not install the local OCR engine by default. This keeps the
normal install smaller and avoids large optional packages on slow or unreliable
Termux mirrors.

Install OCR when you need screenshot text recognition:

```sh
CLAWMOBILE_TERMUX_INSTALL_OCR=1 clawmobile install
```

Verify it with:

```sh
tesseract --version
tesseract --list-langs
```

English OCR is installed by the Termux `tesseract` package. For simplified
Chinese OCR, place a traineddata file under `$PREFIX/share/tessdata/` and run
with:

```sh
CLAW_MOBILE_OCR_LANG=chi_sim+eng clawmobile run
```

## Maintenance

Use reset levels to recover from partial installs or stale runtime state:

```sh
clawmobile reset --level plugin
clawmobile reset --level workspace
clawmobile reset --level state
clawmobile reset --level full
```

Use `plugin` after plugin/tool registration problems, `workspace` after seeded
skill or policy issues, `state` after broken OpenClaw local state, and `full`
when you want to reinstall OpenClaw itself.

`clawmobile run` skips plugin rebuild/reinstall when the runtime dist output
and local install stamp are current. Force a refresh with:

```sh
CLAWMOBILE_TERMUX_FORCE_BUILD=1 clawmobile run
CLAWMOBILE_TERMUX_FORCE_PLUGIN_INSTALL=1 clawmobile run
CLAWMOBILE_TERMUX_FORCE_BUILD=1 CLAWMOBILE_TERMUX_FORCE_PLUGIN_INSTALL=1 clawmobile run
```

If OpenClaw sees the seeded skills but not tools such as
`clawmobile_record_start` or `android_ocr_dump`, force the combined refresh.
The installer pins and enables the local plugin entry, refreshes the plugin
registry, and declares the plugin's tool contract in `openclaw.plugin.json`.

## Developer Entrypoints

The public path should use `clawmobile setup`. The script entrypoints remain
available for local development and debugging:

```sh
./installer/termux-lite/install-openclaw.sh
./installer/termux-lite/install.sh
./installer/termux-lite/onboard.sh
./installer/termux-lite/run.sh
./installer/termux-lite/doctor.sh
```

Useful bootstrap overrides:

```sh
CLAWMOBILE_OPENCLAW_NPM_SPEC=openclaw@2026.6.1
CLAWMOBILE_OPENCLAW_NODE_VERSION=22.22.0
CLAWMOBILE_INSTALL_CLAWDHUB=0
CLAWMOBILE_OPENCLAW_RUN_UPDATE=0
CLAWMOBILE_TERMUX_UPGRADE=1
```

The bootstrap pins OpenClaw to `openclaw@2026.6.1` by default. It does not run
`openclaw update` after installing a pinned version unless
`CLAWMOBILE_OPENCLAW_RUN_UPDATE=1` is set. Use
`CLAWMOBILE_OPENCLAW_NPM_SPEC=openclaw@latest` only when intentionally testing
the latest OpenClaw.

In this runtime, the plugin exposes capability-aware Termux/ADB tools. The
archived DroidRun/MobileRun backend is not part of the maintained `main` path.

Default settings applied by `clawmobile setup --quick` and
`clawmobile configure defaults`:

- `tools.profile=full`
- web search enabled with provider left unset for OpenClaw auto-detection
- `skills.install.nodeManager="npm"`
- `skills.install.preferBrew=false`
- hooks/session-memory left off by default

## Privacy

Recordings and generated skills may contain sensitive screenshots, input
traces, app state, package/activity names, model-visible summaries, and
API-key-adjacent configuration. Review those artifacts before sharing a
workspace, recording directory, or repository snapshot.
