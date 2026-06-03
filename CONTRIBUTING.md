# Contributing

Thanks for contributing to ClawMobile.

This repository is still evolving quickly, so the goal of this guide is to keep contributions understandable, easy to review, and consistent with the current architecture.

## Repository layout

- `openclaw-plugin-mobile-ui/`
  - The executable mobile runtime plugin.
  - Contains Android runtime tools, backend adapters, and internal execution helpers.
- `installer/termux-lite/`
  - Recommended public installer, bootstrap, command wrapper, reset, doctor,
    pairing, and runtime scripts.
- `installer/workspace-seed-lite/`
  - Default Termux runtime workspace content copied into the OpenClaw workspace.
- `installer/workspace-seed-lite/skills/`
  - Default skill-owned policy, capability, and trace-induction guidance.

The legacy DroidRun/MobileRun full backend is archived on the
`legacy-full-backend-archive` branch. It is no longer updated on `main`.

## Common contribution areas

Common contribution types include:
- doc fixes
- installer improvements
- small runtime bug fixes
- new reusable mobile primitives
- skill and policy clarifications
- new skills or skill extensions

When possible, keep changes narrow and avoid mixing runtime refactors, app-specific workflows, and public interface changes into one large update.

## Adding or updating skills

Public default-runtime skills live under:
- `installer/workspace-seed-lite/skills/`

When adding a new skill, keep the boundary clear:
- use skills for policy, capability interpretation, and workflow guidance
- use the base plugin for device-generic runtime primitives
- use app-specific skill or extension layers for app-specific workflows
- keep generated traces, screenshots, and local feedback artifacts out of commits
  unless they are sanitized examples

## Capability guidance

The default Termux runtime keeps public capability guidance directly in:
- `installer/workspace-seed-lite/skills/clawmobile-capabilities/SKILL.md`

If you update default runtime capabilities, keep the policy wording, tool
contracts, and runtime implementation aligned. This guidance is not generated
from a legacy full-backend capability contract on `main`.

## Local verification

Before opening a change, at minimum:

1. Re-read the changed docs/scripts for path correctness.
2. If you changed default capability guidance, check the matching tool
   implementation and workspace policy wording.
3. If you changed the plugin TypeScript, run the runtime plugin build:

```sh
cd openclaw-plugin-mobile-ui
npm install
npm run build
npm run test:trace-induction
```

If you changed only docs, explain what you reviewed. If you cannot run the
build in your environment, say so clearly in the PR.

For installer or phone-runtime changes, also test the relevant command path when
possible:

```sh
./installer/termux-lite/clawmobile doctor
./installer/termux-lite/clawmobile setup --quick
./installer/termux-lite/clawmobile run
```

Use a test account or sanitized phone state when recording traces.

## Privacy and artifacts

Do not commit local runtime artifacts unless they are intentionally sanitized:

- `logs/`
- `recordings/`
- `rec_*/`
- token proxy captures
- generated trace directories
- API keys, bot tokens, chat IDs, private screenshots, and typed personal text

See [SECURITY.md](SECURITY.md) for the full security and privacy checklist.

## Branching and review

- Prefer small branches and small commits.
- Keep commit messages specific.
- If a change affects public behavior, call that out explicitly.
- Public-facing docs should use `ClawMobile` as the project name.
- Keep default runtime changes independent from token-analysis experiments
  unless the PR is explicitly about measurement tooling.
