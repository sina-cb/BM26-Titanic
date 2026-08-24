# CaptainPad production TestFlight release

Happy-path checklist for building CaptainPad with EAS, uploading it to App
Store Connect, and making it installable through TestFlight. Run commands from
the repository root unless noted.

## Release identity

- App: `CaptainPad`
- Bundle identifier: `com.titanicrig.captainpad`
- App Store Connect app ID: `6769843059`
- Version format: `1.0.0`
- Optional downloaded filename: `CaptainPad_v1_0_0.ipa`
- EAS profile: `production`

The IPA filename is only for local archives. App Store Connect identifies the
release by bundle identifier, app version, and EAS-managed iOS build number.

## 1. Set the release version

Update `expo.version` in `CaptainPad/app.json` when starting a new public app
version. Keep the semantic form, such as `1.0.0` or `1.0.1`.

`CaptainPad/eas.json` uses remote app-version state and automatically
increments the iOS build number for every production build.

## 2. Run release checks

```powershell
Set-Location .\CaptainPad
npm ci
npm run check
npm test
npx expo export:embed --eager --platform ios --dev false --reset-cache
npx eas-cli@latest whoami
```

Continue only when all commands pass. Lint warnings may be recorded, but lint
errors, test failures, type errors, or bundle errors block the release.

## 3. Build on EAS

From `CaptainPad`:

```powershell
$env:EAS_NO_VCS = "1"
$env:EAS_PROJECT_ROOT = (Get-Location).Path
npx eas-cli@latest build --platform ios --profile production --clear-cache
```

The variables keep the EAS upload scoped to `CaptainPad`. Use the interactive
command so EAS can request Apple authentication when required. Production uses
a Release Xcode configuration, the current App Store-required iOS SDK, and App
Store distribution signing. The EAS post-install step prepares the matching
Apple Metal toolchain before compilation.

Keep the build-details page printed by EAS:

```text
https://expo.dev/accounts/<account>/projects/CaptainPad/builds/<build-id>
```

Wait until that build reports `Finished` before submitting it.

## 4. Upload to App Store Connect

Submit the newest successful production build:

```powershell
npx eas-cli@latest submit --platform ios --profile production --latest
```

If prompted, select the existing CaptainPad App Store Connect record. Confirm
that its bundle identifier is exactly `com.titanicrig.captainpad`.

After EAS reports submission success, wait for Apple to process the build under
**App Store Connect → CaptainPad → TestFlight → iOS**.

## 5. Enable TestFlight installation

For internal testing:

1. Open the processed build in App Store Connect.
2. Complete any export-compliance prompt.
3. Add the build to the intended internal testing group.
4. Open TestFlight on the iPad and install CaptainPad.

For external testing:

1. Complete the TestFlight beta description, feedback contact, and review
   information.
2. Add the build to an external testing group.
3. Submit the build for Beta App Review.
4. After approval, invite testers or share the approved public TestFlight link.

Review notes should explain that CaptainPad is a dedicated local-network
control surface for a lighting installation and requires a compatible
MarsinEngine service on the same LAN. Provide screenshots or a short demo for
reviewers who do not have the physical rig. Do not include real network
addresses or credentials.

## 6. Verify on iPad

1. Install the offered build from Apple's TestFlight app.
2. Confirm the version and build number match App Store Connect.
3. Launch CaptainPad and allow Local Network access.
4. Confirm landscape-only presentation.
5. Connect to the test MarsinEngine stack and complete the release smoke test.

The TestFlight release is complete only after the intended iPad can install
and launch the uploaded build.

## 7. Clean the shell environment

```powershell
Remove-Item Env:EAS_NO_VCS -ErrorAction SilentlyContinue
Remove-Item Env:EAS_PROJECT_ROOT -ErrorAction SilentlyContinue
```

## References

- [`../CaptainPad/README.md`](../CaptainPad/README.md) — CaptainPad development and local builds
- [`../.agent/ops/build_ipad_release.md`](../.agent/ops/build_ipad_release.md) — agent-facing diagnostics
- [`../OPERATIONS_HANDBOOK.md`](../OPERATIONS_HANDBOOK.md) — operator command summary
