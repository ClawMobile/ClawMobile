# Changelog

All notable public changes to ClawMobile are tracked here.

This project is still in public-preview development, so version numbers mark
useful snapshots rather than long-term API stability.

## Unreleased

- Prepare the default ClawMobile Termux runtime as the recommended public path.
- Add Termux-first `clawmobile` command wrapper and one-command bootstrap path.
- Document `--quick --start` as the shortest install-and-run path.
- Document remote-assisted wireless ADB setup through the Termux shell, so a
  user can send pairing commands from another device after the gateway starts.
- Add Termux runtime installer hardening for non-interactive package installs
  and Termux mirror fallback.
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
- Update public README, installer docs, FAQ, security policy, contribution
  guidance, and GitHub templates.

## 0.1.0-preview

Initial ClawMobile public-preview target.

- OpenClaw gateway can run directly in Termux.
- The default Termux runtime can start with Termux-only capabilities and upgrade
  when ADB is authorized.
- Generated skills can be learned from demonstrations and reused through the
  OpenClaw skill system.
