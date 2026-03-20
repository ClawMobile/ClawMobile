# Contributing

Thanks for contributing to ClawMobile.

This repository is still evolving quickly, so the goal of this guide is to keep contributions understandable, easy to review, and consistent with the current architecture.

## Repository layout

- `openclaw-plugin-mobile-ui/`
  - The executable mobile runtime plugin.
  - Contains Android runtime tools, backend adapters, and internal execution helpers.
- `installer/workspace-seed/`
  - Seeded workspace content copied into the OpenClaw workspace.
- `installer/workspace-seed/skills/`
  - Skill-owned policy and capability contracts.
- `installer/termux/` and `installer/ubuntu/`
  - Installer and bootstrap scripts for the phone runtime.

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

Skills live under:
- `installer/workspace-seed/skills/`

When adding a new skill, keep the boundary clear:
- use skills for policy, capability interpretation, and workflow guidance
- use the base plugin for device-generic runtime primitives
- use app-specific skill or extension layers for app-specific workflows

## Capability contract workflow

The capability skill is generated from a structured contract.

Source of truth:
- `installer/workspace-seed/skills/clawmobile-capabilities/contract.json`

Generated artifact:
- `installer/workspace-seed/skills/clawmobile-capabilities/SKILL.md`

Generator:
- `installer/workspace-seed/skills/clawmobile-capabilities/generate_skill.py`

You only need this workflow when you are changing the capability catalog itself, for example:
- adding a new deterministic capability
- changing COMPLETE vs BOOTSTRAP classification
- updating preferred tools/backends
- changing capability notes or examples

After editing the contract, regenerate the skill:

```sh
python3 installer/workspace-seed/skills/clawmobile-capabilities/generate_skill.py
```

Commit the contract change and the regenerated `SKILL.md` together.

## Local verification

There is not yet a full automated test suite in this repository.

Before opening a change, at minimum:

1. Re-read the changed docs/scripts for path correctness.
2. If you changed the capability contract, regenerate `SKILL.md`.
3. If you changed the plugin TypeScript, run a local plugin build if your environment has Node installed:

```sh
cd openclaw-plugin-mobile-ui
npm install
npm run build
```

If you cannot run the build in your environment, say so clearly in the PR or commit notes.

## Branching and review

- Prefer small branches and small commits.
- Keep commit messages specific.
- If a change affects public behavior, call that out explicitly.
- Public-facing docs should use `ClawMobile` as the project name.
