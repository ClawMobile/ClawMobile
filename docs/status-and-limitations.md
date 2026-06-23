# Project Status And Limitations

ClawMobile is in public preview for real Android devices. The default Termux
runtime includes the installer, OpenClaw mobile plugin, optional OCR support,
ADB-backed UI tools, and the trace-to-skill workflow.

The Android companion app is the recommended first control surface for setup,
runtime status, tasks, skills, logs, and trusted-agent messaging. Termux remains
the local runtime where ClawMobile and OpenClaw actually run.

## Generated Skills

Generated skills are useful today, but they are still preview software. They
work best on the same device, app version, and starting state used for the
demonstration. Reliability improves with additional demos and execution
feedback, and fast paths may fall back to normal UI recovery when a workflow is
not stable enough.

## Known Limitations

- ADB-backed UI control requires Android developer options, USB or wireless ADB,
  and an authorized device connection.
- Termux package mirrors can occasionally be stale or unreachable; the
  installer includes mirror fallback logic, but network conditions still matter.
- Generated skills start from recorded evidence and are useful immediately for
  repeatable workflows, but become more robust after additional demonstrations
  and execution feedback.
- Generated skills should first be tested on the same device, app version, and
  starting app state used for the demo. Cross-device, cross-layout, and dynamic
  list workflows may require additional demonstrations.
- Screenshot-heavy verification can be slower on phone hardware than on desktop;
  deterministic fast paths for stable generated-skill actions are still
  experimental accelerators.

## Archived Backend

The older DroidRun/MobileRun backend has been archived and is no longer updated
on `main`. Historical files remain available on the
`legacy-full-backend-archive` branch.
