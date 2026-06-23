# Release Checklist

Use this checklist before syncing a dev branch to the public ClawMobile
repository or creating a release tag.

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
- [ ] Internal companion contracts and implementation notes are not included in
      public docs.
- [ ] The default install path is ClawMobile on the Termux runtime.
- [ ] Archived DroidRun/MobileRun backend files are not presented as the active
      install path.

## Documentation

- [ ] `README.md` quick start is current.
- [ ] `installer/INSTALL.md` matches the recommended install path.
- [ ] `installer/FAQ.md` covers common Termux, Telegram, ADB, model key, and
      generated-skill failures.
- [ ] `SECURITY.md` and `CONTRIBUTING.md` are present.
- [ ] `CHANGELOG.md` includes the release summary.

## Android Companion App Release

- [ ] Bump Android `versionName` and `versionCode`.
- [ ] Build the signed release APK.
- [ ] Verify the APK file name and SHA-256. Do not publish or rename an
      unsigned APK as the public release asset.
- [ ] Upload the APK to the public `ClawMobile/ClawMobile` release assets.
- [ ] Update `docs/releases/android-companion.json`.
- [ ] Update `README.md` and `docs/android-companion-app.md` with the latest
      main ClawMobile release APK link.
- [ ] Confirm the public release page and direct APK download link both resolve.
- [ ] Update GitHub release notes, including Social / Trusted Contacts changes
      when relevant.
- [ ] Smoke test setup, Start ClawMobile, Tasks, Skills, Social, and task
      completion notifications on a real Android device.

## Release

- [ ] Create a tag, for example `v0.1.0-preview`.
- [ ] Include release notes that describe:
      - recommended install path
      - generated-skill preview status
      - experimental fast path/batch status
      - known limitations
- [ ] Test the one-command bootstrap from a clean Termux environment when
      possible.
