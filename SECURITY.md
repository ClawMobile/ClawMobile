# Security Policy

ClawMobile runs an OpenClaw agent runtime on Android and can interact with local
files, model providers, chat channels, screenshots, Android UI state, and ADB.
Please treat any runtime workspace, trace recording, generated skill, and log as
potentially sensitive.

## Supported Versions

The current public preview is **ClawMobile** on the default Termux runtime.
Security fixes should target the latest public release and the `main` branch
first.

## What May Be Sensitive

- Model provider keys such as `OPENAI_API_KEY`, Anthropic, Gemini, OpenRouter,
  or OpenAI-compatible endpoint credentials.
- Chat channel credentials such as Telegram bot tokens and user allowlists.
- Demonstration recordings, screenshots, OCR text, UIAutomator XML, app package
  names, activity names, touch coordinates, typed text, and Android shell output.
- Generated skills and feedback files, because they can preserve task evidence,
  paths, summaries, failure notes, and learned UI anchors.
- ADB authorization state, because ADB-backed tools can control the device UI
  and run Android shell commands.

The repository ignores common local artifact directories such as `logs/`,
`recordings/`, `rec_*/`, and token proxy captures. Do not publish those folders
unless you have reviewed and sanitized them.

## Reporting A Vulnerability

If you find a vulnerability, please do not open a public issue with exploit
details or private credentials.

Preferred reporting path:

1. Use GitHub private vulnerability reporting if it is enabled for the public
   repository. Otherwise, email the maintainers at the contact address listed on
   the project website or contact the project maintainers directly through the
   linked public profiles.
2. Include the affected commit or release, Android/Termux/OpenClaw versions,
   the capability stage in use, and a minimal reproduction if one is safe to
   share.
3. Redact API keys, bot tokens, screenshots, phone numbers, chat IDs, and
   personal app data before sending logs.

We will acknowledge reports as quickly as possible and coordinate fixes before
public disclosure when appropriate.

## Safe Debugging Checklist

Before sharing a bug report, demo trace, or generated skill:

1. Search for provider keys and bot tokens.
2. Check screenshots and OCR text for private app content.
3. Check generated `SKILL.md`, `skill_candidate.json`, feedback JSONL files,
   and trace summaries for typed text or app-specific personal data.
4. Prefer `clawmobile doctor` output over raw runtime logs when possible.
5. If a full trace is required, create a fresh demo on a test account with
   non-sensitive data.

## Runtime Safety Notes

- Only authorize ADB on devices you control.
- Keep Termux and OpenClaw configuration files private.
- Use Telegram user allowlisting when using Telegram as the control channel.
- Revoke model provider keys or Telegram bot tokens immediately if they were
  accidentally committed or shared.
