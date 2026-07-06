# iPad Build Runbook — CaptainPad + PortWatch

This is the canonical guide for future agents building either of the two Titanic
iPad apps. Both apps ship to physical iPads via two parallel pipelines (EAS
cloud build OR local Mac build directly to USB). The pipelines, gotchas, and
signing rules are nearly identical between the two apps — but the apps
themselves are completely independent and should never be conflated.

> ⚠️ **Do not leak credentials into this file.** No Apple IDs, passwords, App
> Store Connect session paths, certificate serial numbers, full provisioning
> profile UUIDs, device UDIDs, auth tokens, or signed log URLs. If a build log
> contains those values, summarize the technical failure instead of pasting
> the secret-bearing line. The 3-letter team-ID prefix (`5JN…`) IS allowed —
> see "Picking the Right Apple Team" below.

Use repo-relative paths only. Do not write machine-specific absolute paths such
as a Windows user profile path into this document.

---

## Apps at a glance

| | **CaptainPad** | **PortWatch** |
|---|---|---|
| Purpose | VJ / engine control surface (WebSocket + REST to MarsinEngine) | Field-ops LoRa control surface + telemetry (BLE → captain Heltec → LoRa → Pi bridge → engine) |
| App root in repo | `CaptainPad/` | `control_podium/PortWatch/` |
| iOS bundle ID | `com.titanicrig.captainpad` | `com.titanicrig.portwatch` |
| Xcode scheme | `CaptainPad` | `PortWatch` |
| Workspace | `ios/CaptainPad.xcworkspace` | `ios/PortWatch.xcworkspace` |
| Expo SDK | `~54.0.34` | `~54.0.34` |
| React Native | `0.81.5` | `0.81.5` |
| React | `19.1.0` | `19.1.0` |
| New architecture | enabled | enabled |
| iPad support | `ios.supportsTablet: true` | `ios.supportsTablet: true` |
| Bonjour service | `_marsinengine._tcp` (local LAN to engine) | — (no LAN discovery; uses BLE) |
| Native modules needing prebuild | YAML transformer + Metro source exts | `react-native-ble-plx`, `expo-secure-store` |
| Pre-build step (mandatory) | none | `npm run sync-all` (bakes AES key + engine config) |
| EAS preview profile | `preview` | `preview` |
| Current known-good install target | iPad (10th gen) — `FoH iPad 1` | iPad (10th gen) — `FoH iPad 1` |

**Run all Expo / npm / EAS commands from the app's own root directory** —
`CaptainPad/` for CaptainPad, `control_podium/PortWatch/` for PortWatch.
Mixing them is a common cause of "but this worked yesterday" weirdness.

---

## Shared setup (applies to both apps)

These rules apply to whichever app you're building. Read them once; the
per-app sections below assume them.

### Prerequisites

- macOS with **Xcode 26+** (`xcodebuild -version`)
- **CocoaPods** (`pod --version`; install with `brew install cocoapods` if missing)
- **Node** 20 LTS or newer (`node --version`)
- **EAS CLI** for cloud builds (`npm i -g eas-cli`)
- Target iPad **paired and trusted** with the Mac. Confirm with
  `xcrun devicectl list devices` — the row must show `available (paired)`.
- An Apple Developer team membership that owns `com.titanicrig.*` bundle IDs.
  See "Picking the Right Apple Team" below.
- That Apple ID **signed into Xcode → Settings → Accounts**. Under Manage
  Certificates an `Apple Development` cert must exist for the team — if
  not, click `+` and create one. Without this the
  `-allowProvisioningUpdates` flag has nothing to talk to and the build
  fails with `No profiles for 'com.titanicrig.<app>' were found`.
- **(Nice to have) Explicit App ID registered per bundle** at
  https://developer.apple.com/account/resources/identifiers/list. Without
  this, Xcode under `-allowProvisioningUpdates` falls back to issuing a
  fresh wildcard profile (`iOS Team Provisioning Profile: *`) for the
  build, and the iPad will refuse to launch the app with "Unable to verify
  app — internet connection required" (see "Wildcard vs bundle-specific
  provisioning profiles" below for why and the registration steps). Both
  `com.titanicrig.captainpad` and `com.titanicrig.portwatch` should already
  be registered as of 2026-05-28; any new bundle ID needs the same
  treatment before its first successful iPad install.

### Picking the right Apple team (critical gotcha — affects BOTH apps)

The dev/test machine has codesigning identities for **two different Apple
teams**. Only one of them owns valid provisioning profiles for the
`com.titanicrig.*` family:

```bash
security find-identity -p codesigning -v
```

This lists multiple `Apple Development:` / `Developer ID Application:` rows.
**On this test rig the team that signs successfully has ID prefix `5JN…`.**
Pass that prefix to `xcodebuild` via `DEVELOPMENT_TEAM=…`. The other prefix
that `find-identity` may list first (its `Apple Development` cert displays a
different 10-char ID in its CN) has no matching profile, and the build will
either fail outright (`No profiles for 'com.titanicrig.<app>' were found`) or
will succeed against a wildcard profile while iOS later refuses to launch
the app with "Unable to verify app — internet connection required".

> 🪤 **`security find-identity` is misleading.** It returns the cert with
> `QX7…` in its CN first, but that cert's `OU` (the actual Apple team) is
> still `5JN…`. The two are the same team displayed differently; iOS shows
> the CN value in its verify dialog, which is purely cosmetic. The
> `DEVELOPMENT_TEAM=` value passed to `xcodebuild` must always be the OU
> value (`5JN…`).

Per the no-secrets rule above, **full team IDs, profile UUIDs, cert serials,
and device UDIDs are deliberately not written here**. The 3-letter prefix
`5JN…` is the maximum hint allowed and is enough to disambiguate the two
locally cached identities on the test rig.

To rediscover the correct team prefix on a fresh machine, decode each
cached profile:

```bash
cd ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/
for f in *.mobileprovision; do
  echo "=== $f ==="
  security cms -D -i "$f" 2>/dev/null \
    | plutil -extract Name           xml1 -o - - | grep -o '<string>[^<]*' | head -1
  security cms -D -i "$f" 2>/dev/null \
    | plutil -extract TeamIdentifier xml1 -o - - | grep -o '<string>[^<]*' | head -1
  security cms -D -i "$f" 2>/dev/null \
    | plutil -extract ExpirationDate xml1 -o - - | grep -o '<date>[^<]*'
done
```

Pick the team whose profile `Name` ends with `.captainpad` or `.portwatch`
and whose `ExpirationDate` is in the future. Note its team-ID prefix
(3 chars is enough) and pass that prefix to `xcodebuild`.

### Wildcard vs bundle-specific provisioning profiles

Xcode's auto-provisioning caches two kinds of dev profiles:

- **Wildcard** — `iOS Team Provisioning Profile: *` (entitlement
  `application-identifier = 5JN….*`). Valid for any bundle ID under the
  team. Xcode reuses this aggressively because it satisfies almost any build.
- **Bundle-specific** — `iOS Team Provisioning Profile: com.titanicrig.<app>`
  (entitlement `application-identifier = 5JN….com.titanicrig.<app>`).
  Only valid for that one bundle ID.

iOS treats bundle-specific dev profiles more leniently at first launch. A
binary signed against a wildcard profile sometimes hits the "Unable to verify
app — internet connection required" dialog even when the iPad has internet,
the cert is valid, the UDID is in the profile, and Developer Mode is on. The
bundle-specific profile makes the verify check go through cleanly.

> ⚠️ **Hard prerequisite: the bundle ID must exist as an explicit App ID
> at https://developer.apple.com/account/resources/identifiers/list under
> team `5JN…` before Xcode will issue a bundle-specific profile.** If it
> doesn't, every `xcodebuild -allowProvisioningUpdates` run will produce a
> brand-new wildcard profile from Apple (UUIDs rotate every build), and
> the wildcard-parking recipe below will loop forever. This was learned
> the hard way on 2026-05-28 with `com.titanicrig.portwatch` — the build
> was repeatedly minting fresh wildcards because no explicit App ID
> existed.
>
> To register a new bundle ID (one-time, ~30 s):
> 1. Sign in at https://developer.apple.com/account/resources/identifiers/list
>    as the team owner (same Apple ID that's signed into Xcode for team
>    `5JN…`).
> 2. `+` → **App IDs** → **App** → **Explicit**.
> 3. Description: human-readable name (e.g. `PortWatch`). Bundle ID: the
>    exact bundle id from `app.json::ios.bundleIdentifier`
>    (e.g. `com.titanicrig.portwatch`).
> 4. Capabilities: leave defaults unless the app needs a specific
>    entitlement (PortWatch + CaptainPad don't — Bluetooth is
>    permission-only, not an entitlement).
> 5. Continue → Register.
>
> Both `com.titanicrig.captainpad` and `com.titanicrig.portwatch` are
> registered as of 2026-05-28. Any new app added to this rig needs the
> same step before its first iPad install attempt.

> ⏳ **Wait 5-15 minutes after registering the App ID before the first
> install attempt.** Apple's developer-cert verification chain
> (`ppq.apple.com` et al) caches the registered App ID set on a CDN that
> propagates with delay. Building immediately after registration produces
> a perfectly valid bundle-specific profile — `codesign -dvv` and
> `embedded.mobileprovision` will look textbook — but iOS first-launch
> verification will still refuse to launch the app with "Unable to verify
> app — internet connection required" (showing the cert's CN ID, e.g.
> `QX7AE9285T`, which looks alarming but is just the cert's display
> label, NOT the team). Symptom: the same .app binary that won't launch
> at registration+30s launches fine ~10 min later from the iPad's
> perspective, with no rebuild required. This was learned the hard way
> on 2026-05-28 with PortWatch:
> - v3 build, installed at registration+30s → verify dialog, won't launch
> - v4 build, installed at registration+12min → launches cleanly
> - The two binaries were nearly identical (same cert, same embedded
>   profile UUID `1651079c-…`, same TeamIdentifier `5JN36VJQ9Y`); only
>   wall-clock time differed.
>
> If you're impatient: try `xcrun devicectl device uninstall app` and
> reinstall after waiting; sometimes that nudges the iPad to re-attempt
> verification with fresh Apple-side state. But the cheapest fix is
> patience.

If the App ID is registered, you've waited the propagation window, and
you STILL hit the verify failure (because Xcode already cached a wildcard
for that bundle from an earlier failed build), force Xcode to fetch a
fresh bundle-specific profile by moving the wildcard out of the way AND
wiping the per-app DerivedData (Xcode caches the resolved profile inside
the build artifacts and will happily reuse a moved-aside wildcard if
DerivedData survives):

```bash
mkdir -p ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/_parked
# Identify and park ONLY the wildcard (its `Name` ends with ": *"); leaving
# bundle-specific profiles in place is harmless.
for f in ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision; do
  name=$(security cms -D -i "$f" 2>/dev/null \
    | plutil -extract Name raw -o - - 2>/dev/null)
  case "$name" in
    *": *") mv "$f" ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/_parked/ ;;
  esac
done
# Then nuke the per-app DerivedData so xcodebuild can't reuse the old embedded
# profile from the previous build.
rm -rf ~/Library/Developer/Xcode/DerivedData/<AppName>-*
# Re-run the canonical xcodebuild command (with DEVELOPMENT_TEAM=5JN…
# CODE_SIGN_STYLE=Automatic on the line) — under -allowProvisioningUpdates
# Xcode will request a fresh bundle-specific profile from Apple.
```

Restore the parked profiles afterward if you want the wildcard back for
other bundle IDs. Confirm the new build embedded the right profile:

```bash
security cms -D -i <App>/embedded.mobileprovision \
  | plutil -extract Name raw -o - -
# Expect: "iOS Team Provisioning Profile: com.titanicrig.<app>" (NOT ": *")
```

### Developer Mode on the iPad (iOS 16+)

iOS refuses to launch any sideloaded development-signed app until Developer
Mode is enabled. Symptom: "Developer Mode Required" alert on first tap.

1. iPad → Settings → Privacy & Security → scroll to bottom → **Developer Mode**
2. Toggle **ON** → tap **Restart**
3. After reboot, unlock, tap **Turn On** in the confirmation, enter PIN

Confirm via `xcrun devicectl device info details --device <UDID>`; look for
`developerModeStatus: enabled`.

### Common xcodebuild gotchas (both apps)

| Failure | Cause | Fix |
|---|---|---|
| `No Account for Team "<TEAM>"` + `No profiles for 'com.titanicrig.<app>' were found` | Wrong team prefix passed | Switch `DEVELOPMENT_TEAM=` to `5JN…` |
| `The developer disk image could not be mounted on this device` | iPad locked or stuck mid developer-mode setup | Unlock iPad, replug, open Xcode → Window → Devices and Simulators, wait for "Preparing device…" to finish, retry |
| `error code 70` ("Timed out waiting for all destinations") | iPad got locked or unplugged mid-build | Unlock, replug, retry |
| Mac crashes mid-compile | `-jobs 4` peaked above free RAM | Drop to `-jobs 2`, close Chrome / Metro / running simulators |
| `xcodebuild` exit 65 / `ReactNativeDependencies` Script failed | Stale Node path in Xcode env cache | Edit `ios/.xcode.env.local`, set `export NODE_BINARY=/opt/homebrew/bin/node` |
| App launches to "Unable to verify app — internet connection required" | Wildcard profile + iOS being strict | See "Wildcard vs bundle-specific provisioning profiles" above |
| App launches to "Developer Mode Required" | iOS 16+ lockdown | See "Developer Mode on the iPad" above |

---

# Part 1 — CaptainPad

CaptainPad is the React Native / Expo VJ control surface that talks directly
to MarsinEngine over WebSocket + REST on the local LAN.

## 1.1 Project location

Repository root: the directory that contains `.agent/` and `CaptainPad/`.

Expo app root:

```text
CaptainPad/
```

Run all Expo, npm, and EAS commands from `CaptainPad` unless this doc says
otherwise.

## 1.2 Current app specs

- App name: `CaptainPad`
- Main entry: `expo-router/entry`
- Expo SDK: `~54.0.34`
- React Native: `0.81.5`
- React: `19.1.0`
- EAS CLI requirement: `>= 18.7.0`
- iOS bundle identifier: `com.titanicrig.captainpad`
- iPad support: enabled through `ios.supportsTablet: true`
- Native architecture: `newArchEnabled: true`
- iOS preview build profile: internal distribution, Release configuration
- Managed Expo app: generated `ios/` and `android/` folders are ignored
- App uses local network access for MarsinEngine communication
- Bonjour service declared in iOS plist: `_marsinengine._tcp`
- YAML imports are supported by `yaml-transformer.js` and Metro `sourceExts`

The `preview` profile is the normal iPad install build profile. It uses remote
iOS credentials stored on EAS. Do not document the Apple account, certificates,
provisioning profile identifiers, or device UDIDs here.

## 1.3 EAS build (preview profile)

### How EAS gets the code

EAS Build uploads an archive from the local `CaptainPad` folder when this
command runs:

```powershell
eas build --platform ios --profile preview --clear-cache
```

It does not pull the app source from a remote branch for this workflow. Local
files are archived, except files ignored by `.easignore` if present, otherwise
by the ignore rules EAS derives from the project. `node_modules`, `.expo`,
`dist`, `ios`, and `android` should not be uploaded; EAS installs dependencies
and generates native files on the builder.

Agents must not use git commands for this build flow unless the human
explicitly asks. Build, inspect logs, and edit files directly.

### Normal build commands

Interactive build:

```powershell
cd CaptainPad
eas build --platform ios --profile preview --clear-cache
```

Non-interactive build, useful when credentials already exist on EAS:

```powershell
cd CaptainPad
eas build --platform ios --profile preview --clear-cache --non-interactive
```

Interactive mode may ask whether to log in to Apple. That is acceptable only
when the human is present or has explicitly allowed it. Never store Apple
credentials in repo files or agent docs.

### Required local checks before remote build

Install dependencies:

```powershell
cd CaptainPad
npm ci
```

Run lint:

```powershell
npm run lint
```

Run the same iOS JavaScript bundle phase that failed on EAS:

```powershell
npx expo export:embed --eager --platform ios --dev false --reset-cache
```

If Metro config, asset imports, route files, YAML imports, or dependency
resolution changed, this local bundle command must pass before starting
another remote EAS build.

### Reading EAS logs

The terminal prints a build URL like:

```text
See logs: https://expo.dev/accounts/.../projects/.../builds/<build-id>
```

Open that URL in a browser and look for the failed phase. For the failures
seen on 2026-05-08, the real error was under:

```text
EAGER_BUNDLE
Bundle JavaScript
```

The top-level EAS message can be vague:

```text
iOS build failed:
Unknown error. See logs of the Bundle JavaScript build phase for more information.
```

That message is not enough. Always inspect the `Bundle JavaScript` or
`EAGER_BUNDLE` phase before making a fix.

Useful CLI commands:

```powershell
eas build:list --platform ios --limit 5
eas build:view <build-id>
eas build:view <build-id> --json
```

PowerShell helper to extract relevant log lines without storing full signed log
URLs in docs:

```powershell
$buildId = "<build-id>"
$raw = eas build:view $buildId --json 2>$null | Out-String
$start = $raw.IndexOf("{")
$end = $raw.LastIndexOf("}")
$json = $raw.Substring($start, $end - $start + 1) | ConvertFrom-Json

for ($i = 0; $i -lt $json.logFiles.Count; $i++) {
  $text = (Invoke-WebRequest -Uri $json.logFiles[$i] -UseBasicParsing).Content
  if ($text -match "EAGER_BUNDLE|Bundle JavaScript|Bundling failed|Unable to resolve|Error:") {
    "----- log file $i -----"
    $text -split "`n" |
      Select-String -Pattern "EAGER_BUNDLE|Bundle JavaScript|Bundling failed|Unable to resolve|Error:" -Context 3,8
  }
}
```

Do not paste the full JSON output into repo docs. It can include signed URLs
and credential metadata.

## 1.4 Local Mac build (no EAS, direct USB install)

Use this path when EAS build minutes are exhausted, when you need rapid
iteration, or when you have physical USB access to the target iPad and a Mac
with Xcode. Produces the same Release `.app` EAS would: no `__DEV__` checks,
no RedBox, no Metro listener.

Cold-start total on the test rig: ~22 min. Warm rebuild for JS-only changes:
~3-5 min.

### Steps

1. **Install JS deps** (warm: ~5 s; cold: ~3 min)
   ```bash
   cd CaptainPad
   npm install
   ```

2. **Generate the native iOS project** (warm pods cache: ~2 min; cold: 15-30 min)
   ```bash
   npx expo prebuild --platform ios --clean
   ```
   Regenerates `CaptainPad/ios/` from `app.json` + plugins and runs
   `pod install`. `ios/` is `.gitignored` and intentionally regenerable.
   Subsequent prebuilds in the same checkout are seconds once the
   CocoaPods spec cache is warm.

3. **Find the target iPad UDID** (do not paste into this file)
   ```bash
   xcrun devicectl list devices
   ```
   Copy the long `Identifier` column for the target iPad.

4. **Build Release with CLI overrides** (warm DerivedData: 1-5 min;
   cold: ~18 min on Apple Silicon)
   ```bash
   xcodebuild \
     -workspace ios/CaptainPad.xcworkspace \
     -configuration Release \
     -scheme CaptainPad \
     -destination "id=<DEVICE_UDID>" \
     -jobs 4 \
     -allowProvisioningUpdates \
     -allowProvisioningDeviceRegistration \
     DEVELOPMENT_TEAM=5JN… \
     CODE_SIGN_STYLE=Automatic \
     build
   ```

   Why pass `DEVELOPMENT_TEAM` / `CODE_SIGN_STYLE` on the command line
   rather than `sed`-patching `ios/CaptainPad.xcodeproj/project.pbxproj`:
   the pbxproj is wiped by every `expo prebuild --clean`, so an in-file
   patch does not survive a re-prebuild. CLI overrides do.

   The two `-allow…` flags let xcodebuild auto-register the iPad's UDID
   with the team and refresh the cached profile if needed.

   Cap parallelism at `-jobs 4` to keep RAM in check; native + Swift
   frontend + Hermes XCFramework copy can spike to 16-32 GB peak on Apple
   Silicon and crash macOS otherwise. Bump to `-jobs 8` only with 32+ GB RAM.

5. **Install on the iPad** (~5 s)
   ```bash
   xcrun devicectl device install app --device <DEVICE_UDID> \
     ~/Library/Developer/Xcode/DerivedData/CaptainPad-*/Build/Products/Release-iphoneos/CaptainPad.app
   ```
   Watch for `App installed: bundleID: com.titanicrig.captainpad`. The icon
   appears on the iPad's home screen immediately. If the iPad has Developer
   Mode disabled (iOS 16+), see "Developer Mode on the iPad" in the Shared
   Setup section above before launching.

### Rebuilding after JS-only changes

Anything under `app/`, `components/`, `hooks/`, `utils/`, etc. — Steps 4 + 5
only. **No re-prebuild needed.** One-liner:

```bash
xcodebuild -workspace ios/CaptainPad.xcworkspace \
  -configuration Release -scheme CaptainPad \
  -destination "id=<DEVICE_UDID>" \
  -jobs 4 -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=5JN… \
  CODE_SIGN_STYLE=Automatic build \
  && xcrun devicectl device install app --device <DEVICE_UDID> \
    ~/Library/Developer/Xcode/DerivedData/CaptainPad-*/Build/Products/Release-iphoneos/CaptainPad.app
```

Re-run `npx expo prebuild --platform ios --clean` only when `app.json`,
`app.config.js`, the `plugins` list, or any native-package `package.json`
entry changes. Pure JS/TS edits do not need it.

## 1.5 Known critical Metro rule (CaptainPad-specific)

`CaptainPad/metro.config.js` must not block every `dist` folder globally.
Dependency packages commonly publish their runtime files under
`node_modules/*/dist`.

Good pattern:

```js
function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function projectPathPattern(...segments) {
  const absolutePath = path.resolve(__dirname, ...segments);
  const pattern = absolutePath.split(path.sep).map(escapeRegExp).join('[\\\\/]');
  return new RegExp(`^${pattern}(?:[\\\\/].*)?$`);
}

config.resolver.blockList = [
  projectPathPattern('dist'),
  projectPathPattern('.expo'),
  projectPathPattern('node_modules', '.cache'),
];
```

Bad pattern:

```js
config.resolver.blockList = [
  /dist\/.*/,
  /\.expo\/.*/,
  /node_modules\/\.cache\/.*/,
];
```

The bad pattern hides package files such as:

- `node_modules/whatwg-fetch/dist/fetch.umd.js`
- `node_modules/abort-controller/dist/abort-controller.js`
- `node_modules/memoize-one/dist/memoize-one.cjs.js`
- `node_modules/react-native-is-edge-to-edge/dist/index.js`

Metro then reports those files as missing even though npm installed them.
If the log says a package `package.json` was found but its `main` under
`dist` does not exist, check `metro.config.js` before adding shims or
dependencies.

Quick verification:

```powershell
node -e "const config=require('./metro.config'); const rules=Array.isArray(config.resolver.blockList)?config.resolver.blockList:[config.resolver.blockList]; const paths=[require('path').resolve('dist/index.js'), require('path').resolve('node_modules/whatwg-fetch/dist/fetch.umd.js'), require('path').resolve('node_modules/react-native-is-edge-to-edge/dist/index.js')]; for (const p of paths) console.log(p, rules.some((r)=>r.test(p)));"
```

Expected result:

- `CaptainPad\dist\...` prints `true`
- `CaptainPad\node_modules\...\dist\...` prints `false`

## 1.6 CaptainPad-specific failure signatures

### Package main file appears missing under `dist`

Example:

```text
The package .../node_modules/react-native-is-edge-to-edge/package.json was successfully found.
However, this package itself specifies a main module field that could not be resolved:
.../node_modules/react-native-is-edge-to-edge/dist/index
```

Likely cause: Metro `blockList` is hiding dependency `dist` files.

Fix: keep the block list anchored to project-local generated folders with
`projectPathPattern(...)`.

Do not add empty shims for these packages. An empty `whatwg-fetch` shim
caused a runtime crash:

```text
TypeError: Cannot set property 'Headers' of undefined
Invariant Violation: "main" has not been registered
```

That crash means an early module failed before React Native registered the
app. Find the first runtime error, not the later `main has not been
registered` message.

### Top-level EAS says only `Unknown error`

Likely cause: the meaningful error is inside a build phase log.

Fix: inspect `EAGER_BUNDLE`, `Bundle JavaScript`, `INSTALL_DEPENDENCIES`,
`PREBUILD`, or `RUN_FASTLANE`, depending on where EAS marks the failure.

### Credentials or provisioning prompt fails

Likely cause: Apple session expired, missing device in provisioning profile,
or remote credentials need validation.

Fix: rerun interactively with the human present:

```powershell
eas build --platform ios --profile preview --clear-cache
```

Do not write Apple credentials, team IDs, cert serials, profile IDs, or
device UDIDs into docs.

## 1.7 CaptainPad current known-good state

As of 2026-05-08, the iOS preview EAS build passed after fixing the Metro
block list to stop hiding dependency `dist` folders.

The successful EAS path was:

```powershell
cd CaptainPad
npx expo export:embed --eager --platform ios --dev false --reset-cache
eas build --platform ios --profile preview --clear-cache --non-interactive
```

As of 2026-05-27, the local Mac Release build path also verified working on
the test rig (Apple Silicon, Xcode 26.5, CocoaPods 1.16.2). Cold-start
timings observed:

- `npm install` (already current): ~5 s
- `npx expo prebuild --platform ios --clean` (warm pods spec cache): ~1 min 51 s
- `xcodebuild ... DEVELOPMENT_TEAM=5JN… CODE_SIGN_STYLE=Automatic build`: ~18 min 33 s
- `xcrun devicectl device install app`: ~5 s

Total: ~22 min cold. Confirmed install on a paired iPad (10th generation),
bundle ID `com.titanicrig.captainpad`, signed against the team prefix
`5JN…` using the existing locally cached
`iOS Team Provisioning Profile: com.titanicrig.captainpad`.

---

# Part 2 — PortWatch

PortWatch is the React Native / Expo field-ops surface. It does NOT talk to
the engine directly — it pairs with a captain Heltec radio over BLE, signs
every command with the camp's pre-shared AES-128 key, and relays frames
through the Pi server bridge to MarsinEngine over LoRa. See
`control_podium/PortWatch/README.md` and
`.agent/00_gol/12_operating_raspberry_pi.md` for the full radio topology.

## 2.1 Project location

Repository root: the directory that contains `.agent/` and `control_podium/`.

Expo app root:

```text
control_podium/PortWatch/
```

Run all Expo, npm, and EAS commands from `control_podium/PortWatch` unless
this doc says otherwise. **Don't `cd CaptainPad/`** by muscle memory — that's
a different app.

## 2.2 Current app specs

- App name: `PortWatch`
- Main entry: `index.js` (registers `App.tsx`)
- Expo SDK: `~54.0.34`
- React Native: `0.81.5`
- React: `19.1.0`
- EAS CLI requirement: `>= 18.7.0`
- iOS bundle identifier: `com.titanicrig.portwatch`
- iPad support: enabled through `ios.supportsTablet: true`
- Native architecture: `newArchEnabled: true`
- Native modules requiring prebuild: `react-native-ble-plx`,
  `expo-secure-store`, `expo-haptics`, `expo-splash-screen`,
  `expo-system-ui`
- iOS background modes: `bluetooth-central`
- iOS preview build profile: internal distribution, Release configuration
- Default user-interface style: `dark`

## 2.3 Mandatory pre-build: sync secret & config

Unlike CaptainPad, PortWatch's runtime depends on two generated files baked
into the JS bundle at build time:

| Generated file | Sourced from | Generator | Required for |
|---|---|---|---|
| `src/_generated/secret.generated.ts` | `marsin_engine/secret.yaml` | `scripts/sync-secret.mjs` | Signing every LoRa command frame with the camp AES-128 key |
| `src/_generated/config.generated.ts` | `control_podium/PortWatch/.config.portwatch.yaml` | `scripts/sync-config.mjs` | Behaviour knobs the bundler can't read from YAML at runtime: BLE MTU + timeouts, lease renew cadence, patterns/exports paging budgets, status poll cadence, layout caps, feature flags |

Both files are `.gitignored` and MUST be regenerated before any local Mac
build or EAS build. Run:

```bash
cd control_podium/PortWatch
npm run sync-all     # = sync-secret && sync-config
```

The `package.json` `pre*` scripts hook this in for the common paths
(`npm start`, `npm run ios`, `npm run prebuild`, `npm run eas:build:*`) — but
when you invoke `xcodebuild` directly (as in the local Mac build path
below), the pre-hook does NOT fire. Run `npm run sync-all` manually before
`xcodebuild` to avoid shipping a stale or missing key.

Production EAS builds use `BAKED_AT_BUILD = false` (see
`PortWatch/README.md` §2) and prompt the operator on first launch for the
key, which is then stored in the iOS Keychain. The local Mac Release path
bakes the key in (treated as a dev rig artifact), so do not distribute that
build externally.

## 2.4 EAS build (preview profile)

PortWatch's `eas.json` profiles:

| Profile | Distribution | Channel | Bundles secret? | Use case |
|---|---|---|---|---|
| `development` | internal, dev client | — | yes (BAKED_AT_BUILD=true) | Hot-reload over Metro |
| `preview` | internal | `preview` | yes | Standalone, install-and-go |
| `production` | (default) | `production` | no (operator enters at first launch) | App Store / TestFlight |

Normal command (mirrors CaptainPad's `preview` path):

```bash
cd control_podium/PortWatch
npm run sync-all
eas init                          # first time on a new machine only
npm run eas:device                # register the testing iPad/iPhone
npm run eas:build:preview         # = eas build --platform ios --profile preview
```

Scan the resulting QR code with the iPhone camera to download the `.ipa`.
Log interpretation is identical to CaptainPad — see §1.3 "Reading EAS logs".

## 2.5 Local Mac build (no EAS, direct USB install)

This is the path verified on 2026-05-27 for installing PortWatch on
`FoH iPad 1`. Produces the same Release `.app` EAS would, with the AES key
and bridge config baked in (because we ran `sync-all` first).

Cold-start total on the test rig: ~25 min. Warm rebuild for JS-only changes:
~3-5 min.

### Steps

1. **Install JS deps + sync secret/config** (warm: ~10 s; cold: ~3 min)
   ```bash
   cd control_podium/PortWatch
   npm install
   npm run sync-all      # MANDATORY — bakes AES key + bridge config
   ```
   Skipping `sync-all` produces an app that opens to a `SECRET NOT BAKED`
   error screen. The `postinstall` hook calls `sync-secret --allow-missing`,
   which — when `marsin_engine/secret.yaml` isn't readable — writes a
   tripwire stub (`KEY_FINGERPRINT = '<NOT-BAKED>'`) instead of failing the
   install. The build then proceeds, but the app refuses to scan / connect /
   send anything at runtime. "npm install succeeded" is therefore NOT a
   guarantee the secret got baked; you must run `npm run sync-secret`
   (without `--allow-missing`) before `xcodebuild` to force a real bake.

2. **Generate the native iOS project** (warm pods cache: ~2 min; cold:
   15-30 min)
   ```bash
   npm run prebuild      # = expo prebuild --platform ios --clean
   ```
   Regenerates `control_podium/PortWatch/ios/` from `app.json` + plugins
   and runs `pod install`. `ios/` is `.gitignored` and intentionally
   regenerable. The `ble-plx`, `secure-store`, and `splash-screen` plugins
   write their native bits in here on every prebuild.

3. **Find the target iPad UDID** (do not paste into this file)
   ```bash
   xcrun devicectl list devices
   ```
   Copy the long `Identifier` column for the target iPad. As of 2026-05-27
   the rig has two FoH iPads paired (both `iPad (10th generation)`); confirm
   which is "Yours" before installing.

4. **Build Release with CLI overrides** (warm DerivedData: 1-5 min;
   cold: ~20 min on Apple Silicon — PortWatch has more native modules
   than CaptainPad)
   ```bash
   xcodebuild \
     -workspace ios/PortWatch.xcworkspace \
     -configuration Release \
     -scheme PortWatch \
     -destination "id=<DEVICE_UDID>" \
     -jobs 4 \
     -allowProvisioningUpdates \
     -allowProvisioningDeviceRegistration \
     DEVELOPMENT_TEAM=5JN… \
     CODE_SIGN_STYLE=Automatic \
     build
   ```

   Same overrides rationale as CaptainPad (see §1.4). The pbxproj is wiped
   by every `expo prebuild --clean`, so an in-file team patch does not
   survive — CLI overrides do.

   Validate the resulting signing combo before installing:
   ```bash
   APP=$(ls -d ~/Library/Developer/Xcode/DerivedData/PortWatch-*/Build/Products/Release-iphoneos/PortWatch.app | head -1)
   codesign -dvv "$APP" 2>&1 | grep -E "TeamIdentifier|Authority"
   # Expect:  TeamIdentifier=5JN…
   #          Authority=Apple Development: SINA SOLAIMANPOUR (QX7…)   ← cosmetic CN, OU is 5JN…
   security cms -D -i "$APP/embedded.mobileprovision" \
     | plutil -extract Name raw -o - -
   # Expect either "iOS Team Provisioning Profile: com.titanicrig.portwatch"
   # or             "iOS Team Provisioning Profile: *"  — both work, but bundle-specific
   # avoids the iOS "unable to verify" verify-dialog. See Shared Setup §
   # "Wildcard vs bundle-specific provisioning profiles" if you hit it.
   ```

5. **Install on the iPad** (~5 s)
   ```bash
   xcrun devicectl device install app --device <DEVICE_UDID> \
     ~/Library/Developer/Xcode/DerivedData/PortWatch-*/Build/Products/Release-iphoneos/PortWatch.app
   ```
   Watch for `App installed: bundleID: com.titanicrig.portwatch`. The icon
   appears on the home screen immediately.

   If the install errors with `app already installed`, uninstall first:
   ```bash
   xcrun devicectl device uninstall app --device <DEVICE_UDID> com.titanicrig.portwatch
   ```

### Rebuilding after JS-only changes

Anything under `src/`, `App.tsx`, or unchanged native deps — Steps 4 + 5
only. **No re-prebuild needed.** If you changed the AES key or bridge
config, re-run `npm run sync-all` (Step 1) first to refresh the baked
bundle. One-liner that does both:

```bash
xcodebuild -workspace ios/PortWatch.xcworkspace \
  -configuration Release -scheme PortWatch \
  -destination "id=<DEVICE_UDID>" \
  -jobs 4 -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=5JN… \
  CODE_SIGN_STYLE=Automatic build \
  && xcrun devicectl device install app --device <DEVICE_UDID> \
    ~/Library/Developer/Xcode/DerivedData/PortWatch-*/Build/Products/Release-iphoneos/PortWatch.app
```

Re-run `npm run prebuild` only when `app.json`, the `plugins` list, or any
native-package `package.json` entry changes. Pure JS/TS edits do not need it.

## 2.6 PortWatch-specific failure signatures

### `SECRET NOT BAKED` screen on launch

Cause: `npm run sync-all` was not run before the build, or
`marsin_engine/secret.yaml` is empty / unreadable.

Fix:

```bash
cd control_podium/PortWatch
npm run sync-secret           # NOT --allow-missing — must fail loudly if secret is unset
npm run prebuild              # regenerate native side, then xcodebuild + install again
```

### App opens to "Unable to verify app — internet connection required" even with internet

Cause: Xcode reused a cached wildcard provisioning profile
(`iOS Team Provisioning Profile: *`) instead of a bundle-specific one for
`com.titanicrig.portwatch`. iOS is unusually strict about wildcard dev
profiles on fresh installs.

Diagnose: `security cms -D -i <App>/embedded.mobileprovision | plutil -extract Name raw -o - -`
will show `iOS Team Provisioning Profile: *` if you hit this.

Fix: see Shared Setup §"Wildcard vs bundle-specific provisioning profiles".
Move the wildcard profile out of
`~/Library/Developer/Xcode/UserData/Provisioning Profiles/`, wipe
`~/Library/Developer/Xcode/DerivedData/PortWatch-*`, and rebuild — Xcode
will fetch a fresh bundle-specific profile from Apple under
`-allowProvisioningUpdates`.

### BLE pairing prompt never appears in the app

Cause: stale iOS Bluetooth bond cache.

Fix: iPad → Settings → Bluetooth → find the `tcon_*` device → tap (i) →
**Forget This Device**, then re-tap in the PortWatch Scan Screen. See
`PortWatch/README.md` §5 for the full pairing flow.

### `BLE_CMD_DROP` in app logs

Cause: commands sent faster than the half-duplex LoRa link can transmit.

Fix: avoid rapid multi-taps in the UI; verify the engine status publish rate
is not configured aggressively low. Diagnose via the Pi bridge `/health`
endpoint — see `.agent/00_gol/12_operating_raspberry_pi.md` §6.

### All commands time out

Cause: server bridge on the Pi is down, or the Pi cannot reach the engine.

Fix: from the dev laptop, `curl http://<PI_HOST>:7099/health` (PI_HOST in
`control_podium/server_bridge/.ssh.secret`). If that fails, see
`.agent/00_gol/12_operating_raspberry_pi.md` §10 troubleshooting.

## 2.7 PortWatch current known-good state

As of 2026-05-27, the local Mac Release build path verified working on the
test rig (Apple Silicon, Xcode 26.5, CocoaPods 1.16.2). Cold-start timings:

- `npm install`: ~5 s (already current)
- `npm run sync-all`: ~1 s
- `npm run prebuild` (warm pods spec cache): ~2 min
- `xcodebuild ... DEVELOPMENT_TEAM=5JN… CODE_SIGN_STYLE=Automatic build`: ~20 min
- `xcrun devicectl device install app`: ~5 s

Total: ~25 min cold. `devicectl install` succeeded on a paired iPad (10th
generation, `FoH iPad 1`), bundle ID `com.titanicrig.portwatch`, signed
against the team prefix `5JN…`. The two install attempts so far both
embedded the cached wildcard profile (`iOS Team Provisioning Profile: *`,
expires 2027-05-14) — even after passing `DEVELOPMENT_TEAM=5JN…
CODE_SIGN_STYLE=Automatic` on the command line, because Xcode keeps
reusing the cached wildcard. The first attempt hit the "Unable to verify
app — internet connection required" dialog on launch. The second attempt's
launch outcome is not yet confirmed. If verify still fails, follow Shared
Setup §"Wildcard vs bundle-specific provisioning profiles" to force a
bundle-specific profile before the next install.

EAS preview build status: unverified end-to-end as of 2026-05-27 — the EAS
project ID in `app.json::expo.extra.eas.projectId` is still the placeholder
`REPLACE_WITH_EAS_PROJECT_ID`. Run `eas init` from
`control_podium/PortWatch/` to bind the project to your Expo account before
the first `npm run eas:build:preview`.

---

## Build discipline (both apps)

Do not run blind repeated remote builds. For every failed build:

1. Capture the build ID from the terminal.
2. Inspect the failed phase logs.
3. Identify the first concrete error, not the final wrapper error.
4. Reproduce locally when possible with `npx expo export:embed`.
5. Make the smallest config or code fix.
6. Run local checks.
7. Start one new remote EAS build.

Local Mac builds skip the EAS round-trip cost but still cost ~20 min cold.
Don't loop them as a debugging shortcut — diagnose the underlying issue,
make the smallest fix, then rebuild once.
