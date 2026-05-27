# CaptainPad — Engine Interface

CaptainPad is the native remote-control surface for the MarsinEngine environment. It operates over WebSockets and REST APIs, eliminating the need to physically access the server or parse `yaml` configuration manually.

## 1. Local Development
Because of the React Native / Expo architecture, you can run this locally and connect to your engine instantly:
```bash
cd CaptainPad
npm install          # Only required once

npm start            # Start Expo dev server
npm run start:k      # Kill port before starting (if port is stuck)
npm run start:kc     # Kill port + clear Metro cache
```
- **iPad / iPhone**: Download the **Expo Go** application from the App Store and aggressively scan the QR code via your generic camera app.
- **Android**: Download **Expo Go** from the Play Store and scan within the app.

---

## 2. Permanent iOS Installation (Production)
Because the primary deployment target is an iPad operating on a Windows-based engineering network, standard Xcode compilation is strictly impossible natively. We bind the deployment vector to the **EAS (Expo Application Services)** Cloud.

For the canonical iPad build runbook, including EAS log reading and known Metro pitfalls, see `../.agent/00_gol/09_build_ipad_release.md`.

To permanently install the `.ipa` onto your iPad bypassing Expo Go entirely, follow this cloud-compile workflow:

### Prerequisite 
Ensure you have an active Apple Developer License.

### Step 1: Install Build Engine
Ensure the EAS core compiler is globally executable.
```bash
npm install -g eas-cli
```

### Step 2: Authenticate
Log into your EAS/Expo account via the CLI bridge.
```bash
eas login
```

### Step 3: Trigger Cloud Pipeline (Choose Your Profile)
EAS offers two radically different ways to compile your app depending on your current needs:

**A. Development Profile (Hot-Reloading Vessel)**
If you want to rapidly test code changes but need native modules (like Bluetooth or Native Pickers), compile a development build:
```bash
eas build --platform ios --profile development --clear-cache
```
*Note: A development build generates an "empty" shell! When you launch it on your iPad, it will scream "No development server found." You MUST start your local Windows server (`npm start`) and scan that terminal's QR code using your iPad's camera to bridge the connection and pull the Javascript payload over WiFi.*

**B. Preview / Production Profile (Standalone)**
If you want the app permanently installed and capable of running securely without your laptop entirely:
```bash
eas build --platform ios --profile preview --clear-cache
```
*Note: This aggressively bundles all Javascript directly into the `.ipa`. It will open and run permanently disconnected from any development server.*

### Step 4: Apple Developer Provisioning Flow
- **Device Registration:** EAS will ask if you want to register new devices natively. **Accept this**, and a QR code will spawn in the terminal.
- **Scan:** Use your physical iPad (and iPhone) to scan that terminal QR code. It will download an Apple Configuration Profile securely mapping your UDID directly to the Apple Developer portal.
- **Final Install:** When compilation succeeds (~5-10 minutes), scan the final generated QR code to passively download the `CaptainPad.ipa` directly to your iOS springboard.

---

## 3. Local Mac Build (No EAS Required)

If you have a Mac, you can build the Release `.app` entirely locally — no EAS account, no cloud-build minutes, no internet round-trip after the initial dependency download. Faster iteration than EAS, and useful when EAS free-tier limits run out.

This produces the **same production bundle** EAS would: no `__DEV__` checks, no RedBox, no Metro hot-reload listener, no Hermes lazy parsing. Substantially snappier on-device than an Expo Go dev build.

### Prerequisites
- macOS with **Xcode 26+** (`xcodebuild -version` to confirm)
- **CocoaPods** (`pod --version`; install with `brew install cocoapods` if missing)
- An **Apple Developer account** (free Personal Team works; paid Developer Program gives you push, app transfer, etc.)
- Apple ID signed into **Xcode → Settings → Accounts**. Confirm under Manage Certificates that an **"Apple Development"** cert exists for your team — if not, click `+` and create one.
- iPad connected via USB, **unlocked**, and "Trust This Computer" accepted.

### Step 1: Generate the native iOS project
```bash
cd CaptainPad
npm install
npx expo prebuild --platform ios --clean
```
This creates `CaptainPad/ios/` (gitignored) and runs `pod install`. **First run takes 15-30 min** on a cold CocoaPods spec cache; subsequent runs are seconds. The `ios/` directory is regenerable from `app.json` + plugins, so feel free to delete and re-prebuild whenever native deps change.

### Step 2: Set your signing team
Open `ios/CaptainPad.xcworkspace`. Select the **CaptainPad** target → **Signing & Capabilities** → pick your team from the **Team** dropdown. Xcode writes the team ID into `project.pbxproj`.

Or do it from the CLI — find your team ID first:
```bash
security find-identity -p codesigning -v | grep "Apple Development"
# →  "Apple Development: <Name> (<TEAM_ID>)"
```
Then patch the project file:
```bash
sed -i '' 's/DEVELOPMENT_TEAM = .*/DEVELOPMENT_TEAM = "<TEAM_ID>";/g' \
  ios/CaptainPad.xcodeproj/project.pbxproj
```

### Step 3: Find your iPad's UDID
```bash
xcrun devicectl list devices
```
Look for your iPad in `available (paired)` rows. Copy the long **Identifier** column value (this is the UDID xcodebuild + devicectl need).

### Step 4: Build (Release config)
```bash
xcodebuild \
  -workspace ios/CaptainPad.xcworkspace \
  -configuration Release \
  -scheme CaptainPad \
  -destination "id=<DEVICE_UDID>" \
  -jobs 4 \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  build
```

**Why `-jobs 4`:** capping parallelism keeps RAM in check. Native compile + Swift frontend + Hermes XCFrameworks copy can otherwise spike to 16-32 GB peak on an Apple Silicon Mac and crash macOS. Bump to `-jobs 8` if you have 32 GB+ RAM and want faster cold builds.

**Provisioning:** the two `-allow…` flags let Xcode auto-register your iPad's UDID with your Apple Developer team and auto-create the provisioning profile for `com.titanicrig.captainpad` on first build. Without an Apple ID signed into Xcode this step fails — see Step 0.

**First build:** 15-30 min. **Subsequent incremental builds:** 1-5 min (Pods stay compiled in `~/Library/Developer/Xcode/DerivedData/`).

### Step 5: Install on the iPad
```bash
xcrun devicectl device install app --device <DEVICE_UDID> \
  ~/Library/Developer/Xcode/DerivedData/CaptainPad-*/Build/Products/Release-iphoneos/CaptainPad.app
```
Watch for `App installed: bundleID: com.titanicrig.captainpad`. The icon appears on the iPad's home screen.

### Rebuilding after code changes
Pure TS/TSX changes (everything under `app/`, `components/`, `hooks/`, `utils/`, etc.) just need Steps 4 + 5 again. **No re-prebuild needed.** A one-liner that does both:
```bash
xcodebuild -workspace ios/CaptainPad.xcworkspace \
  -configuration Release -scheme CaptainPad \
  -destination "id=<DEVICE_UDID>" \
  -jobs 4 -allowProvisioningUpdates build \
  && xcrun devicectl device install app --device <DEVICE_UDID> \
    ~/Library/Developer/Xcode/DerivedData/CaptainPad-*/Build/Products/Release-iphoneos/CaptainPad.app
```

### When you DO need to re-run `expo prebuild`
Only when `app.json`, `app.config.js`, the `plugins` list, or any native package in `package.json` changes. Pure JS/TS edits don't need it.

### Common failures
- **`The developer disk image could not be mounted on this device`** — unlock the iPad, plug it in, open **Xcode → Window → Devices and Simulators**, wait for "Preparing device for development…" to finish. Retry.
- **`No profiles for 'com.titanicrig.captainpad' were found`** — your Apple ID isn't signed into Xcode, OR the team in `project.pbxproj` doesn't match an account in Xcode → Settings → Accounts. Fix the team or sign in, then rebuild.
- **`xcodebuild ... error code 70` ("Timed out waiting for all destinations")** — iPad got locked or unplugged. Unlock, replug, retry.
- **Mac crash during compile** — `-jobs` too high for your RAM. Lower to `-jobs 2` or close other heavy apps (Chrome, Metro bundler, simulators).

---

## 4. iOS Troubleshooting: "Developer Mode Required"
Because CaptainPad is signed via Ad-Hoc internal provisioning (not the public App Store), iOS 16+ enforces a brutal security lockout by default. 

To authorize the build on your iPad/iPhone:
1. Open the native **Settings** app.
2. Navigate to **Privacy & Security**.
3. Scroll to the very bottom to the **Security** section.
4. Tap **Developer Mode** and toggle it **ON**.
5. Your device will prompt you to **Restart**.
6. After booting up, unlock the screen and tap **Turn On** on the final confirmation pop-up. Enter your PIN.

The app will now launch perfectly!
