# Changelog

All notable public changes to ClawMobile are tracked here.

This project is still in public-preview development, so version numbers mark
useful snapshots rather than long-term API stability.

## Unreleased

- Prepare the default ClawMobile Termux runtime as the recommended public path.
- Add Termux-first `clawmobile` command wrapper and one-command bootstrap path.
- Document `--quick --start` as the shortest install-and-run path.
- Document supported Termux download sources and same-source Termux companion
  app guidance for F-Droid/GitHub installs.
- Simplify the Termux runtime reference and remove user-facing Lite naming.
- Align the first generated-skill demo prompt with trace-inferred task
  induction.
- Clarify Google Play Termux override commands and update contribution guidance
  after archiving the legacy full backend.
- Document remote-assisted wireless ADB setup through the Termux shell, so a
  user can send pairing commands from another device after the gateway starts.
- Add Termux runtime installer hardening for non-interactive package installs
  and Termux mirror fallback.
- Add Termux install-source preflight and doctor diagnostics for Termux source,
  version, package sources, and key package availability. Google Play Termux is
  blocked by default unless explicitly allowed for best-effort debugging.
- Add OpenClaw-on-Android compatibility bootstrap for glibc Node/OpenClaw.
- Add capability-aware mobile tools for Termux, Termux:API, ADB shell, OCR,
  screenshots, UIAutomator XML, app/window state, and Android shell commands.
- Add OCR as a default capability.
- Add public-preview trace recording, parsing, skill candidate generation,
  promotion, generalization, skill update, and execution feedback.
- Add experimental generated-skill fast paths for deterministic low-risk
  actions, including app launch handling and local UI XML query support.
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
