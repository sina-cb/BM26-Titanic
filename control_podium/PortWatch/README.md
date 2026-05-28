# PortWatch

> **Status:** Titanic field-ops app for iPhone and iPad (Expo SDK 54).

PortWatch is the operator's BLE $\to$ LoRa control surface and live telemetry display for the rig. It pairs with a captain Heltec radio, signs every command with the camp's pre-shared AES-128 key, and routes frames through the Raspberry Pi bridge to the MarsinEngine.

---

## 🚀 Quick Start

Run PortWatch locally in development:

```bash
# 1. Sync the pre-shared AES-128 key from the engine (development only)
cd control_podium/PortWatch
npm run sync-secret

# 2. Build the native iOS environment and run on a physical device
npm run ios
```

---

## 1. Prerequisites

Before setting up PortWatch, ensure you have:
* **Node.js**: `v20` LTS or newer (e.g., `v26.0.0` verified).
* **Workstation tools**: Xcode 15+ (for local iOS builds) and the EAS CLI (`npm i -g eas-cli`).
* **Heltec Hardware**: At least one Heltec V3/V4 radio flashed with `podium_tx` client firmware.
* **Pi Bridge**: The `server_bridge` running on the Pi and connected to `MarsinEngine`.

---

## 2. Keys & Security Setup

PortWatch requires the shared AES-128 key from [marsin_engine/secret.yaml](file:///Users/ssolaimanpour/workspace/BM26-Titanic/marsin_engine/secret.yaml) to authenticate and encrypt LoRa communication.

### Development & Preview Builds (Local & Simulator)
In development, the key is baked directly into the JavaScript bundle.
1. Ensure your [marsin_engine/secret.yaml](file:///Users/ssolaimanpour/workspace/BM26-Titanic/marsin_engine/secret.yaml) is configured on your laptop.
2. From the `control_podium/PortWatch` directory, run:
   ```bash
   npm run sync-secret
   ```
   This generates the gitignored [src/_generated/secret.generated.ts](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/PortWatch/src/_generated/secret.generated.ts). The build will fail if this file is missing.

### Production Builds (EAS / App Store)
For security, the production profile **does not** bake the secret at build time (`BAKED_AT_BUILD = false`).
* On first launch, the app displays a **Secret Entry Sheet**.
* The operator must manually input either the passphrase string (`key:`) or the 32-character hexadecimal key (`key_hex:`).
* The key is stored securely in the iOS Keychain via `expo-secure-store`.
* You can clear the key at any time by tapping **FORGET KEY** on the Scan Screen.

---

## 3. Running PortWatch

### Run on iOS Simulator (UI Iteration Only)
> [!NOTE]
> The iOS Simulator does **not** support Bluetooth/BLE. Use this only for layout and UI diagnostics.
```bash
cd control_podium/PortWatch
npm run ios:simulator
```

### Run on a Physical iOS Device (Local Xcode Build)
1. Connect your iPhone/iPad to your Mac via USB and unlock it.
2. Generate the iOS native project and launch the build:
   ```bash
   npm run prebuild
   npm run ios
   ```

### Build with EAS (Ad-hoc / TestFlight)
To bypass Xcode local signing issues, build the app in the Expo cloud:
```bash
# 1. Initialize EAS (first time only)
eas init

# 2. Register your testing device
npm run eas:device

# 3. Build a development client (.ipa)
npm run eas:build:preview
```
Scan the resulting QR code with your iPhone camera to download and install the build.

---

## 4. Local Mac Release Build (No EAS Required)

If you have a Mac, you can build the Release `.app` entirely locally — no EAS account, no cloud-build minutes, no internet round-trip after the initial dependency download. Faster iteration than EAS, and useful when EAS free-tier limits run out.

This produces the **same production bundle** EAS would: no `__DEV__` checks, no RedBox, no Metro hot-reload listener, no Hermes lazy parsing. Substantially snappier on-device than an Expo Go dev build, and the AES key is baked into the bundle (via `sync-secret`) so there is no first-launch Secret Entry Sheet.

### Prerequisites
- macOS with **Xcode 26+** (`xcodebuild -version` to confirm)
- **CocoaPods** (`pod --version`; install with `brew install cocoapods` if missing)
- An **Apple Developer account** (free Personal Team works; paid Developer Program gives push, app transfer, etc.)
- Apple ID signed into **Xcode → Settings → Accounts**. Confirm under Manage Certificates that an **"Apple Development"** cert exists for your team — if not, click `+` and create one.
- iPad/iPhone connected via USB, **unlocked**, and "Trust This Computer" accepted.

### Step 1: Generate the native iOS project (only on first build, or when native deps change)
```bash
cd control_podium/PortWatch
npm install
npm run sync-all                # bake AES key + engine config into the JS bundle
npm run prebuild                # expo prebuild --platform ios --clean
```
`prebuild` creates `control_podium/PortWatch/ios/` (gitignored) and runs `pod install`. **First run takes 15-30 min** on a cold CocoaPods spec cache; subsequent runs are seconds. The `ios/` directory is regenerable from `app.json` + plugins, so feel free to delete and re-prebuild whenever native deps change.

### Step 2: Set your signing team
The Apple Developer team that owns `com.titanicrig.portwatch` and has the FoH iPads registered is **`5JN36VJQ9Y`**. Use that as the `DEVELOPMENT_TEAM` value — passed on the `xcodebuild` command line in Step 4 (don't bake it into `project.pbxproj`, since prebuild regenerates that file).

> ⚠️ **Don't trust `security find-identity` to pick the team for you.** It returns the `Apple Development` cert with `QX7AE9285T` in its CN first, which Xcode would otherwise use as the team — but the *real* working team (per the cert's `OU` field and the existing provisioning profile) is `5JN36VJQ9Y`. The two are bridged because the QX7AE9285T-labeled cert is actually issued under team 5JN36VJQ9Y; the CN label is cosmetic but iOS will display it in the first-launch "verify" dialog.

### Step 3: Find your iPad's UDID
```bash
xcrun devicectl list devices
```
Look for your iPad/iPhone in `available (paired)` rows. Copy the long **Identifier** column value (this is the UDID xcodebuild + devicectl need).

### Step 4: Build (Release config)
```bash
xcodebuild \
  -workspace ios/PortWatch.xcworkspace \
  -configuration Release \
  -scheme PortWatch \
  -destination "id=<DEVICE_UDID>" \
  -jobs 4 \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM=5JN36VJQ9Y \
  CODE_SIGN_STYLE=Automatic \
  build
```

**Why pass `DEVELOPMENT_TEAM` + `CODE_SIGN_STYLE=Automatic` on the command line:** keeps the team out of the regenerable `project.pbxproj` (which gets nuked by `npm run prebuild`) AND forces Xcode to fetch a **bundle-specific** provisioning profile (`iOS Team Provisioning Profile: com.titanicrig.portwatch`) instead of reusing a stale cached wildcard profile (`iOS Team Provisioning Profile: *`). Bundle-specific profiles avoid iOS's first-launch "Unable to verify app — internet connection required" dialog on devices that already have other titanicrig apps installed.

**Why `-jobs 4`:** capping parallelism keeps RAM in check. Native compile + Swift frontend + Hermes XCFrameworks copy can otherwise spike to 16-32 GB peak on an Apple Silicon Mac and crash macOS. Bump to `-jobs 8` if you have 32 GB+ RAM and want faster cold builds.

**Provisioning:** the two `-allow…` flags let Xcode auto-register your iPad's UDID with your Apple Developer team and auto-create the provisioning profile for `com.titanicrig.portwatch` on first build. Without an Apple ID signed into Xcode this step fails — see Prerequisites.

**First build:** 15-30 min. **Subsequent incremental builds:** 1-5 min (Pods stay compiled in `~/Library/Developer/Xcode/DerivedData/`).

### Step 5: Install on the device
```bash
xcrun devicectl device install app --device <DEVICE_UDID> \
  ~/Library/Developer/Xcode/DerivedData/PortWatch-*/Build/Products/Release-iphoneos/PortWatch.app
```
Watch for `App installed: bundleID: com.titanicrig.portwatch`. The icon appears on the home screen.

### Rebuilding after code changes
Pure TS/TSX changes (everything under `src/`, `App.tsx`, etc.) just need Steps 4 + 5 again. **No re-prebuild needed.** If you changed the AES key or engine config, re-run `npm run sync-all` first to refresh the baked bundle. One-liner that does build + install:
```bash
xcodebuild -workspace ios/PortWatch.xcworkspace \
  -configuration Release -scheme PortWatch \
  -destination "id=<DEVICE_UDID>" \
  -jobs 4 -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=5JN36VJQ9Y CODE_SIGN_STYLE=Automatic build \
  && xcrun devicectl device install app --device <DEVICE_UDID> \
    ~/Library/Developer/Xcode/DerivedData/PortWatch-*/Build/Products/Release-iphoneos/PortWatch.app
```

### When you DO need to re-run `prebuild`
Only when `app.json`, the `plugins` list, or any native package in `package.json` changes. Pure JS/TS edits don't need it.

### Common failures
- **`The developer disk image could not be mounted on this device`** — unlock the iPad, plug it in, open **Xcode → Window → Devices and Simulators**, wait for "Preparing device for development…" to finish. Retry.
- **`No profiles for 'com.titanicrig.portwatch' were found`** — your Apple ID isn't signed into Xcode, OR the team in `project.pbxproj` doesn't match an account in Xcode → Settings → Accounts. Fix the team or sign in, then rebuild.
- **`xcodebuild ... error code 70` ("Timed out waiting for all destinations")** — iPad got locked or unplugged. Unlock, replug, retry.
- **`xcodebuild` exit code 65 / `ReactNativeDependencies` Script failed** — stale Node path in Xcode env cache. Edit `ios/.xcode.env.local` and set `export NODE_BINARY=/opt/homebrew/bin/node` (or wherever `which node` points).
- **Mac crash during compile** — `-jobs` too high for your RAM. Lower to `-jobs 2` or close other heavy apps (Chrome, Metro bundler, simulators).
- **App opens to a "Developer Mode Required" alert** — on iOS 16+, enable **Settings → Privacy & Security → Developer Mode**, then reboot the device and confirm **Turn On** when prompted.
- **App opens to "Unable to verify app — internet connection required" even though the iPad has internet** — Xcode reused a wildcard provisioning profile (`iOS Team Provisioning Profile: *`) instead of a bundle-specific one. Confirm with `codesign -dvv <App>` and `security cms -D -i <App>/embedded.mobileprovision | grep -A1 "<key>Name</key>"`. Fix: wipe `~/Library/Developer/Xcode/DerivedData/PortWatch-*` and rebuild with `DEVELOPMENT_TEAM=5JN36VJQ9Y CODE_SIGN_STYLE=Automatic` on the `xcodebuild` line — that forces a fresh `com.titanicrig.portwatch`-specific profile.

---

## 5. Bluetooth pairing & Connection

1. Wake your captain Heltec radio. The OLED display will show its BLE name (e.g., `tcon_sina`).
2. Open PortWatch on your iPhone and go to the **Scan Screen**.
3. Tap the device named `tcon_<name>`.
4. iOS will pop up a **Bluetooth Pairing Request** dialog.
5. The Heltec OLED will automatically jump to the **Pairing PIN** screen. Read the 6-digit PIN and enter it on your phone.
6. Once bonded, the app will transition to the **Deck Screen** and begin receiving live engine telemetry.

---

## 6. Troubleshooting & Diagnostics

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| **`SECRET NOT BAKED` Screen** | `sync-secret` was not run. | Run `npm run sync-secret` and rebuild the app. |
| **`xcodebuild` exit code 65** / `ReactNativeDependencies` Script failed | Stale/invalid Node path in Xcode env cache. | Open [ios/.xcode.env.local](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/PortWatch/ios/.xcode.env.local) and update `NODE_BINARY` to a valid path (e.g. `export NODE_BINARY=/opt/homebrew/bin/node`). |
| **Cannot launch PortWatch because the device is locked** | Phone screen was locked during installation. | Unlock your iPhone screen and run `npm run ios` again. |
| **BLE Pairing Prompt never appears** | iOS has a stale bond cache. | Go to iOS Settings $\to$ Bluetooth, find the `tcon_*` device, tap the *(i)* icon, select **Forget This Device**, and try connecting again in the app. |
| **Command Queue Drops (`BLE_CMD_DROP`)** | Commands are sent faster than the half-duplex LoRa link can transmit them. | Avoid rapid multi-taps in the UI. Ensure the status publish rate is not set too low. |
| **All Commands Time Out** | The server bridge on the Pi is down or cannot reach the engine. | Verify the bridge health: `curl http://<pi-ip>:7099/health`. Ensure the Pi is pointing to your current laptop IP. |
