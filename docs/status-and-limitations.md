# Project Status And Limitations

ClawMobile is in public preview for real Android devices. The Android app now
includes an app-local runtime for everyday tasks, skills, shared content, token
visibility, trusted-agent messaging, and optional phone-control capabilities.

The Termux/OpenClaw Shell Runtime remains available for advanced users who need
OpenClaw parity, shell-backed tools, remote debugging, or repeatable CLI setup.

Selected Android testers can use the invitation-based ClawMobile Beta model
provider. This hosted path requires network access, has access-expiry and usage
limits, and processes model-backed task content through the ClawMobile Gateway
and its configured model provider.

An iOS app is also available on the
[App Store](https://apps.apple.com/app/id6787042935). The iOS
version focuses on the app-local mobile-agent and shared-content experience; it
does not expose the Android-specific Accessibility, ADB, app-control, or
demo-recording capabilities.

## Generated Skills

Generated skills are useful today, but they are still preview software. They
work best on the same device, app version, and starting state used for the
demonstration. Reliability improves with additional demos and execution
feedback, and fast paths may fall back to normal UI recovery when a workflow is
not stable enough.

## Known Limitations

- ADB-backed UI control requires Android developer options, USB or wireless ADB,
  and an authorized device connection.
- The iOS app is more limited than the Android app for phone-control research:
  normal App Store apps cannot globally inspect or control other apps in the same
  way Android Accessibility/ADB can.
- Shell Runtime setup depends on Termux package mirrors, which can occasionally
  be stale or unreachable; the installer includes mirror fallback logic, but
  network conditions still matter.
- Generated skills start from recorded evidence and are useful immediately for
  repeatable workflows, but become more robust after additional demonstrations
  and execution feedback.
- Generated skills should first be tested on the same device, app version, and
  starting app state used for the demo. Cross-device, cross-layout, and dynamic
  list workflows may require additional demonstrations.
- Repeated controls in dynamic lists may not provide enough context for safe
  deterministic replay. For example, some YouTube `Action menu` workflows
  intentionally fall back to normal model-guided UI execution.
- Screenshot-heavy verification can be slower on phone hardware than on desktop;
  deterministic fast paths for stable generated-skill actions are still
  experimental accelerators.
- ClawMobile Beta invitation codes are single-use. Clearing app data,
  uninstalling the app, or removing access can require a replacement code.
- Hosted ClawMobile Beta access can expire or reach its monthly request limit.
  Testers should keep the saved access state and contact the maintainer before
  removing it.

## Archived Backend

The older DroidRun/MobileRun backend has been archived and is no longer updated
on `main`. Historical files remain available on the
`legacy-full-backend-archive` branch.
