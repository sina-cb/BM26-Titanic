# CaptainPad — Engine Interface

CaptainPad is the native remote-control surface for the MarsinEngine environment. It operates over WebSockets and REST APIs, eliminating the need to physically access the server or parse `yaml` configuration manually.

## 1. Local Development
Because of the React Native / Expo architecture, you can run this locally and connect to your engine instantly:
```bash
# Navigate to the dashboard UI
cd CaptainPad

# Install dependencies (only required once)
npm install

# Start Local Server (will generate a QR code)
npm start -c
```
- **iPad / iPhone**: Download the **Expo Go** application from the App Store and aggressively scan the QR code via your generic camera app.
- **Android**: Download **Expo Go** from the Play Store and scan within the app.

---

## 2. Permanent iOS Installation (Production)
Because the primary deployment target is an iPad operating on a Windows-based engineering network, standard Xcode compilation is strictly impossible natively. We bind the deployment vector to the **EAS (Expo Application Services)** Cloud.

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
eas build --platform ios --profile development
```
*Note: A development build generates an "empty" shell! When you launch it on your iPad, it will scream "No development server found." You MUST start your local Windows server (`npm start`) and scan that terminal's QR code using your iPad's camera to bridge the connection and pull the Javascript payload over WiFi.*

**B. Preview / Production Profile (Standalone)**
If you want the app permanently installed and capable of running securely without your laptop entirely:
```bash
eas build --platform ios --profile preview
```
*Note: This aggressively bundles all Javascript directly into the `.ipa`. It will open and run permanently disconnected from any development server.*

### Step 4: Apple Developer Provisioning Flow
- **Device Registration:** EAS will ask if you want to register new devices natively. **Accept this**, and a QR code will spawn in the terminal.
- **Scan:** Use your physical iPad (and iPhone) to scan that terminal QR code. It will download an Apple Configuration Profile securely mapping your UDID directly to the Apple Developer portal.
- **Final Install:** When compilation succeeds (~5-10 minutes), scan the final generated QR code to passively download the `CaptainPad.ipa` directly to your iOS springboard.

---

## 3. iOS Troubleshooting: "Developer Mode Required"
Because CaptainPad is signed via Ad-Hoc internal provisioning (not the public App Store), iOS 16+ enforces a brutal security lockout by default. 

To authorize the build on your iPad/iPhone:
1. Open the native **Settings** app.
2. Navigate to **Privacy & Security**.
3. Scroll to the very bottom to the **Security** section.
4. Tap **Developer Mode** and toggle it **ON**.
5. Your device will prompt you to **Restart**.
6. After booting up, unlock the screen and tap **Turn On** on the final confirmation pop-up. Enter your PIN.

The app will now launch perfectly!
