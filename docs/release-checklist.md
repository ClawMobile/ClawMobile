# Release Checklist

Use this checklist before publishing a ClawMobile branch or creating a release
tag.

## Code And Tests

- [ ] `cd openclaw-plugin-mobile-ui && npm run build`
- [ ] `cd openclaw-plugin-mobile-ui && npm run test:trace-induction`
- [ ] `git diff --check`
- [ ] Confirm the branch is based on the intended `main` commit.

## Public Repository Hygiene

- [ ] `logs/`, `recordings/`, `rec_*/`, token proxy captures, and local test
      artifacts are not tracked.
- [ ] No API keys, Telegram bot tokens, chat IDs, private screenshots, typed
      personal text, or generated traces are committed.
- [ ] Public docs point to the public repository URL, not private dev-only URLs.
- [ ] Public commits, pull requests, and docs do not expose private repository
      URLs, branches, commit IDs, or internal release records.
- [ ] Internal companion contracts and implementation notes are not included in
      public docs.
- [ ] The default entry point is the Android app-local runtime, with
      Termux/OpenClaw documented as the optional Shell Runtime.
- [ ] Archived DroidRun/MobileRun backend files are not presented as the active
      install path.

## Documentation

- [ ] `README.md` quick start is current.
- [ ] `docs/android-companion-app.md` matches the current Android app-local
      runtime and optional capability setup.
- [ ] `docs/android-beta-testing.md` matches the current invitation, quota,
      expiry, testing, and reporting flow.
- [ ] `installer/INSTALL.md` matches the recommended install path.
- [ ] `installer/FAQ.md` covers common invitation, quota, Termux, Telegram, ADB,
      model key, and generated-skill failures.
- [ ] `SECURITY.md` and `CONTRIBUTING.md` are present.
- [ ] `CHANGELOG.md` includes the release summary.
- [ ] The public website describes the Android app-local runtime as the
      recommended default and Termux/OpenClaw as the optional Shell Runtime.
- [ ] The website waitlist includes an Android beta application path and links
      to the current privacy policy.
- [ ] The privacy policy accurately describes ClawMobile Beta invitation
      redemption, hosted Gateway/model processing, access credentials, usage
      records, retention, and relevant third-party processors before codes are
      issued.

## Android App Release

- [ ] Bump Android `versionName` and `versionCode`.
- [ ] Build the signed release APK.
- [ ] Verify the APK file name and SHA-256. Do not publish or rename an
      unsigned APK as the public release asset.
- [ ] Upload the APK to the public `ClawMobile/ClawMobile` release assets.
- [ ] Upload the generated `ClawMobile-update.json` beside the APK.
- [ ] Update `docs/releases/android-companion.json` after the APK release exists.
- [ ] Update `README.md` and `docs/android-companion-app.md` with the latest
      main ClawMobile release APK link when the release asset is available.
- [ ] Confirm the public release page and direct APK download link both resolve.
- [ ] Update GitHub release notes, including Social / Trusted Contacts changes
      when relevant.
- [ ] Smoke test app-local Tasks, Skills, Social, Share, Settings, optional
      Accessibility/ADB capabilities, and task completion notifications on a
      real Android device.
- [ ] Redeem a fresh test invitation in **Settings > Runtime Setup >
      ClawMobile Beta**, refresh quota, run a task, and confirm the original code
      is not displayed or retained in the input field.
- [ ] Confirm the published test build does not contain the deferred Feedback
      settings entry.
- [ ] Confirm invitation codes are distributed privately rather than through
      public GitHub issues, release notes, or repository files.
- [ ] Smoke test Shell Runtime setup only when the release changes Termux/OpenClaw
      behavior.

## Release

- [ ] Create the public repository tag for this snapshot, for example `v0.5.1`.
- [ ] Include release notes that describe:
      - recommended install path
      - generated-skill preview status
      - experimental fast path/batch status
      - known limitations
- [ ] Test the one-command bootstrap from a clean Termux environment when
      possible.
