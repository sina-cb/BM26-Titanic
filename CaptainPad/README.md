# CaptainPad — Engine Interface

CaptainPad is the native remote-control surface for the MarsinEngine environment. It operates over WebSockets and REST APIs, eliminating the need to physically access the server or parse `yaml` configuration manually.

**Canonical iPad build runbook:** [`../.agent/ops/build_ipad_release.md`](../.agent/ops/build_ipad_release.md) (EAS log reading, provisioning gotchas, Metro block-list rules). This README is the operator-facing quick path; the runbook is the deep reference.

---

## 1. Local development

```bash
cd CaptainPad
npm install          # once

npm start            # Expo dev server
npm run start:k      # kill stuck port, then start
npm run start:kc     # kill port + clear Metro cache
```

- **iPad / iPhone:** install **Expo Go** from the App Store and scan the QR code.
- **Web:** `npm run web:build && npm run web:serve` → `http://localhost:6967`

Quality gates before any iOS ship:

```bash
npm run check        # typecheck + lint
npm test             # vitest (includes ios prebuild contract)
node scripts/verify_ios_prebuild_scratch.mjs   # optional: scratch prebuild freshness
npx expo export:embed --eager --platform ios --dev false --reset-cache
```

---

## 2. Windows — EAS cloud build only

Windows cannot run Xcode or `pod install`. **All Windows iOS builds go through EAS Build** (Expo's macOS cloud builders). Do not attempt local native compilation on Windows.

Use a **session-only** Expo token and Apple app-specific password — never commit them, and never paste them into agent chats:

```powershell
$env:EXPO_TOKEN = "your_expo_token_here"
$env:EXPO_APPLE_APP_SPECIFIC_PASSWORD = "your_apple_app_specific_password_here"

cd path\to\BM26-Titanic\CaptainPad

# Catch JS bundle errors locally before uploading
npx expo export:embed --eager --platform ios --dev false --reset-cache

# Internal Release .ipa (preview profile)
npx eas-cli build --profile preview --platform ios --clear-cache --non-interactive

Remove-Item Env:EXPO_TOKEN
Remove-Item Env:EXPO_APPLE_APP_SPECIFIC_PASSWORD
```

- **`preview`** is a **Release** build (`buildConfiguration: "Release"` in `eas.json`) — optimized bundle baked in, no Metro, runs offline on the playa.
- Requires an **Apple Developer Program** membership to sign for a physical device.
- Prefer `npx eas-cli` over a global install on shared machines.
- **New iPad registered?** Run one **interactive** build (drop `--non-interactive`) so EAS can refresh the provisioning profile to include the new device UDID.

EAS uploads your local `CaptainPad/` tree (excluding `node_modules`, `ios/`, `android/` per `.easignore`), installs deps, runs `expo prebuild`, and compiles on Expo's Mac builders. See the runbook for log reading when builds fail at `EAGER_BUNDLE`.

---

## 3. macOS — local iOS native build (no EAS)

Use this when you have a Mac with Xcode and USB access to the target iPad. Produces the same **Release** `.app` EAS would: no `__DEV__`, no RedBox, no Metro listener.

### 3.1 Prerequisites

| Requirement | Verify |
|---|---|
| macOS + **Xcode** (recent stable; `xcodebuild -version`) | |
| **CocoaPods** (`pod --version`; `brew install cocoapods` if missing) | |
| **Node** 20+ (`node --version`) | |
| Apple ID in **Xcode → Settings → Accounts** with an **Apple Development** cert | |
| iPad connected via USB, **unlocked**, **Trust This Computer** accepted | `xcrun devicectl list devices` |

### 3.2 Regenerating `ios/` (safe to delete)

`CaptainPad/ios/` is **gitignored and fully regenerable**. All native intent lives in tracked files:

| Tracked source | What it controls |
|---|---|
| `app.json` | Bundle ID, landscape lock, Bonjour (`_marsinengine._tcp`), local-network plist strings, encryption export flag |
| `app.json` → `plugins` | Expo Router, splash screen, web browser |
| `metro.config.js` + `yaml-transformer.js` | YAML imports, Metro block-list (must not hide `node_modules/*/dist`) |
| `package.json` | Native module versions (Skia, Reanimated, etc.) |

**Nothing in `ios/` should be hand-edited.** Signing team, device UDIDs, and Node paths are build-time overrides (below), not committed deltas.

```bash
cd CaptainPad
npm install
npx expo prebuild --platform ios --clean
```

This creates `ios/` and runs `pod install`. **First run: 15–30 min** on a cold CocoaPods cache; warm runs are ~1–2 min.

To prove freshness without touching your checkout:

```bash
node scripts/verify_ios_prebuild_scratch.mjs
```

That copies the project to a temp dir, prebuilds there, checks semantic plist/pbxproj output against `app.json`, and deletes the copy.

### 3.3 Signing (never bake into `project.pbxproj`)

`expo prebuild --clean` wipes `ios/CaptainPad.xcodeproj/project.pbxproj`. Pass signing on the **xcodebuild command line** instead:

1. Find your Apple Development team ID (10-character prefix from Xcode → Settings → Accounts, or decode a cached provisioning profile — see runbook § "Picking the right Apple team").
2. Find the iPad UDID: `xcrun devicectl list devices` → copy the **Identifier** for your paired device.

**Do not commit team IDs, UDIDs, or cert serials to the repo.**

Optional GUI path: open `ios/CaptainPad.xcworkspace` → target **CaptainPad** → **Signing & Capabilities** → pick your team. This writes into the regenerable pbxproj and will be lost on the next `--clean` prebuild — prefer CLI overrides for repeatability.

### 3.4 Release build (CLI)

```bash
xcodebuild \
  -workspace ios/CaptainPad.xcworkspace \
  -configuration Release \
  -scheme CaptainPad \
  -destination "id=<DEVICE_UDID>" \
  -jobs 4 \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM=<TEAM_ID> \
  CODE_SIGN_STYLE=Automatic \
  build
```

- **`-jobs 4`:** caps RAM during native + Hermes compile (lower to `-jobs 2` if macOS swaps/crashes).
- **`-allowProvisioningUpdates` / `-allowProvisioningDeviceRegistration`:** Xcode auto-registers the device and creates/refreshes the dev profile for `com.titanicrig.captainpad`.
- **First cold build:** ~15–30 min. **Incremental JS-only rebuilds:** ~1–5 min.

### 3.5 Install and launch

```bash
xcrun devicectl device install app --device <DEVICE_UDID> \
  ~/Library/Developer/Xcode/DerivedData/CaptainPad-*/Build/Products/Release-iphoneos/CaptainPad.app
```

Expect `App installed: bundleID: com.titanicrig.captainpad`. Icon appears on the home screen.

**JS-only changes** (`app/`, `components/`, `hooks/`, `utils/`, …): repeat §3.4 + §3.5 only — no re-prebuild.

One-liner:

```bash
xcodebuild -workspace ios/CaptainPad.xcworkspace \
  -configuration Release -scheme CaptainPad \
  -destination "id=<DEVICE_UDID>" \
  -jobs 4 -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=<TEAM_ID> CODE_SIGN_STYLE=Automatic build \
  && xcrun devicectl device install app --device <DEVICE_UDID> \
    ~/Library/Developer/Xcode/DerivedData/CaptainPad-*/Build/Products/Release-iphoneos/CaptainPad.app
```

### 3.6 When to re-run `expo prebuild`

Only when **`app.json`**, the **`plugins` list**, or a **native `package.json` dependency** changes. Pure TS/TSX edits do not need it.

### 3.7 Troubleshooting (macOS local)

| Symptom | Likely cause | Fix |
|---|---|---|
| `The developer disk image could not be mounted` | iPad locked or mid-setup | Unlock, replug, **Xcode → Window → Devices and Simulators**, wait for "Preparing device…" |
| `No profiles for 'com.titanicrig.captainpad' were found` | Apple ID not in Xcode, or wrong team | Sign in; pass correct `DEVELOPMENT_TEAM=<TEAM_ID>` on xcodebuild line |
| `error code 70` (destination timeout) | iPad locked/unplugged mid-build | Unlock, replug, retry |
| `xcodebuild` exit 65 / `ReactNativeDependencies` script failed | Stale Node path in Xcode script phase | Create `ios/.xcode.env.local` (gitignored): `export NODE_BINARY=$(command -v node)` or your nvm/fnm path |
| Mac crash during compile | `-jobs` too high for RAM | `-jobs 2`; close browsers/Metro/simulators |
| "Unable to verify app — internet connection required" on launch | Wildcard provisioning profile cached | See runbook § "Wildcard vs bundle-specific provisioning profiles" |
| "Developer Mode Required" on launch | iOS 16+ sideload lockout | §4 below |

---

## 4. iOS Developer Mode (sideloaded builds)

Ad-hoc / development-signed builds require Developer Mode on iOS 16+:

1. **Settings → Privacy & Security → Developer Mode** → **ON**
2. Restart when prompted
3. After reboot, tap **Turn On** and enter your PIN

Confirm: `xcrun devicectl device info details --device <DEVICE_UDID>` → `developerModeStatus: enabled`.

---

## 5. EAS profiles (macOS or Windows)

| Profile | Use case | Metro at runtime? |
|---|---|---|
| `development` | Dev client + hot reload over Wi‑Fi | Yes — must run `npm start` and connect |
| `preview` | Standalone Release for playa iPads | No — JS baked in |
| `production` | App Store / TestFlight (auto-increment) | No |

```bash
eas login                                    # once
eas build --platform ios --profile preview --clear-cache
```

Device registration: EAS prompts with a QR code during interactive builds. Scan from the target iPad to register its UDID with your Apple team.

---

## 6. Native reproducibility notes

**Audited conclusion:** `CaptainPad/ios/` can be deleted and recreated from `app.json` + plugins + `npm install` + `expo prebuild --platform ios --clean` + `pod install`. No custom Expo config plugins or hand-maintained native files are required.

| Item | Status |
|---|---|
| Info.plist keys (Bonjour, local network, landscape, bundle ID) | Declared in `app.json` |
| Signing team / device UDID | **Manual at build time** — CLI `DEVELOPMENT_TEAM=` + `-destination id=` |
| `ios/.xcode.env.local` Node path | **Optional local override** (gitignored); create if Xcode script phases can't find Node |
| `ios/Pods/`, `Podfile.lock`, `*.xcworkspace` | Generated by `pod install` |
| Metro YAML + block-list | Tracked in `metro.config.js` / `yaml-transformer.js` |

Automated guard: `utils/ios_prebuild_contract.test.ts` (runs with `npm test`). Optional full scratch check: `node scripts/verify_ios_prebuild_scratch.mjs`.
