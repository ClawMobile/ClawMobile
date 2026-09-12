# Changelog

All notable public changes to ClawMobile are tracked here.

This project is still in public-preview development, so version numbers mark
useful snapshots rather than long-term API stability.

## Unreleased

## Android 0.3.2

- Preserve original plain text and whitespace during explicit insertions and
  unique-fragment replacements, with local readback checks.
- Improve clickable-parent selection, long-press input handling, and evidence
  for newly opened creation forms.
- Read more deeply nested controls within bounded local indexing limits.
- Recheck enabled capabilities before tool execution and stop cancellation
  from being mistaken for a recoverable task failure.
- Keep model defaults, saved settings, permissions, and generated-Skill behavior
  unchanged. No new benchmark score is claimed.
- See the [Android 0.3.2 release notes](docs/releases/android-v0.3.2.md) for
  download verification and upgrade guidance.

## Android 0.3.1

- Improve UI target tracking, long-text reading, form filling, and input correction.
- Add task-local working notes and improve completion checks against the full
  original request and observed results.
- Improve recovery from stale UI targets, task-history reliability, and network
  error messages.
- Default new App-local OpenAI/Beta setups to GPT-5.6-Sol, with low reasoning and
  an 8192-token completion cap for ordinary Sol agent actions.
- Preserve existing model preferences and the optional Shell Runtime, with no
  new Android permissions required.
- See the [Android 0.3.1 release notes](docs/releases/android-v0.3.1.md) for
  download verification and upgrade guidance.

## 0.5.1

- Prepare the public v0.5.1 documentation and release metadata for the Android
  0.2.4 (`versionCode 11`) test build.
- Add an Android beta testing guide covering invitation activation, single-use
  code handling, hosted Gateway access, quota and expiry behavior, optional
  Accessibility/ADB setup, suggested tests, and safe issue reporting.
- Harden Android UI-skill recording and replay, structured multi-step UI
  execution evidence, failure recovery, and action verification.
- Document that stable Note and Maps workflows may use fast paths while
  ambiguous dynamic-list workflows, including some repeated YouTube
  `Action menu` controls, fall back to model-guided UI execution.
- Keep the Feedback settings feature out of the Android 0.2.4 test build.

## 0.5.0

- Prepare v0.5.0 public documentation for the Android app-local runtime and the
  optional Termux/OpenClaw Shell Runtime.
- Update the public README and Android app guide to describe the app as the
  recommended phone-native entry point for tasks, skills, shared content, token
  visibility, and trusted-agent messaging.
- Mention iOS App Store availability while clarifying that Android remains the
  platform for full phone-control and demo-to-skill capabilities.
- Clarify that the Termux/OpenClaw install path is now the advanced Shell Runtime
  path for users who need OpenClaw parity, shell-backed tools, remote debugging,
  or repeatable CLI setup.
- Update the public citation from the arXiv preprint to the EuroMLSys 2026 ACM
  publication.

## 0.4.x public preview

- Prepare the ClawMobile Termux runtime as the recommended public path before
  the Android app-local runtime became the default entry point.
- Add Termux-first `clawmobile` command wrapper and one-command bootstrap path.
- Document `--quick --start` as the shortest install-and-run path.
- Document supported Termux download sources and same-source Termux companion
  app guidance for F-Droid/GitHub installs.
- Simplify the Termux runtime reference and remove user-facing Lite naming.
- Clarify Google Play Termux override commands and update contribution guidance
  after archiving the legacy full backend.
- Add Termux runtime installer hardening, install-source preflight, doctor
  diagnostics, package mirror fallback, and OpenClaw-on-Android compatibility
  bootstrap for glibc Node/OpenClaw.
- Add capability-aware mobile tools for Termux, Termux:API, ADB shell, OCR,
  screenshots, UIAutomator XML, app/window state, and Android shell commands.
- Add public-preview trace recording, parsing, skill candidate generation,
  promotion, generalization, skill update, execution feedback, and experimental
  generated-skill fast paths.
- Add default workspace seed files for mobile policy, tool guidance, and
  trace-induction workflow.
- Archive the legacy DroidRun/MobileRun full backend on the
  `legacy-full-backend-archive` branch and remove it from the maintained `main`
  install path.
- Remove dormant DroidRun/MobileRun plugin backend source from `main`; the
  maintained plugin contract now exposes only Termux runtime tools.
- Update public README, installer docs, FAQ, security policy, contribution
  guidance, and GitHub templates.

## 0.1.0-preview

Initial ClawMobile public-preview target.

- OpenClaw gateway can run directly in Termux.
- The default Termux runtime can start with Termux-only capabilities and upgrade
  when ADB is authorized.
- Generated skills can be learned from demonstrations and reused through the
  OpenClaw skill system.
