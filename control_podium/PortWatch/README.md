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

## 4. Bluetooth pairing & Connection

1. Wake your captain Heltec radio. The OLED display will show its BLE name (e.g., `tcon_sina`).
2. Open PortWatch on your iPhone and go to the **Scan Screen**.
3. Tap the device named `tcon_<name>`.
4. iOS will pop up a **Bluetooth Pairing Request** dialog.
5. The Heltec OLED will automatically jump to the **Pairing PIN** screen. Read the 6-digit PIN and enter it on your phone.
6. Once bonded, the app will transition to the **Deck Screen** and begin receiving live engine telemetry.

---

## 5. Troubleshooting & Diagnostics

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| **`SECRET NOT BAKED` Screen** | `sync-secret` was not run. | Run `npm run sync-secret` and rebuild the app. |
| **`xcodebuild` exit code 65** / `ReactNativeDependencies` Script failed | Stale/invalid Node path in Xcode env cache. | Open [ios/.xcode.env.local](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/PortWatch/ios/.xcode.env.local) and update `NODE_BINARY` to a valid path (e.g. `export NODE_BINARY=/opt/homebrew/bin/node`). |
| **Cannot launch PortWatch because the device is locked** | Phone screen was locked during installation. | Unlock your iPhone screen and run `npm run ios` again. |
| **BLE Pairing Prompt never appears** | iOS has a stale bond cache. | Go to iOS Settings $\to$ Bluetooth, find the `tcon_*` device, tap the *(i)* icon, select **Forget This Device**, and try connecting again in the app. |
| **Command Queue Drops (`BLE_CMD_DROP`)** | Commands are sent faster than the half-duplex LoRa link can transmit them. | Avoid rapid multi-taps in the UI. Ensure the status publish rate is not set too low. |
| **All Commands Time Out** | The server bridge on the Pi is down or cannot reach the engine. | Verify the bridge health: `curl http://<pi-ip>:7099/health`. Ensure the Pi is pointing to your current laptop IP. |
