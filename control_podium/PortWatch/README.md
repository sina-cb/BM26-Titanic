# PortWatch

> TITANIC field-ops app for iPhone and iPad.

PortWatch is the operator's BLE→LoRa control surface and live telemetry
display for the rig. It pairs with a captain Heltec radio, signs every
command with the camp's pre-shared AES-128 key (baked in at build time
from `marsin_engine/secret.yaml`), and round-trips through the Pi
bridge to the MarsinEngine.

For background on the architecture (LoRa mesh, Pi bridge, why this
isn't part of CaptainPad), read:

- [`docs/21_portwatch_monitor.md`](../../docs/21_portwatch_monitor.md) — PortWatch's design rationale and command surface
- [`docs/07_control_podium.md`](../../docs/07_control_podium.md) — the Titanic mesh, frame format, AEAD
- [`docs/21_lora_captain_integration.md`](../../docs/21_lora_captain_integration.md) — how PortWatch and CaptainPad coexist

---

## Repository layout

```
control_podium/PortWatch/
├── App.tsx              # tab structure + status pub wiring
├── app.json             # Expo manifest (bundle id, permissions, plugins)
├── eas.json             # EAS Build profiles (development / preview / production)
├── package.json         # npm scripts and dependencies
├── index.js             # explicit Expo entry (SafeAreaProvider wrapper)
├── babel.config.js
├── metro.config.js      # locks Metro to this directory
├── tsconfig.json
├── assets/
│   └── icon.png         # iOS app icon + splash image (1254×1254)
├── scripts/
│   ├── sync-secret.mjs  # bakes marsin_engine/secret.yaml into the bundle
│   └── ble-scan.py      # cross-platform BLE diagnostic
└── src/
    ├── ble/             # react-native-ble-plx wrapper, GATT UUIDs
    ├── crypto/          # Titanic Frame v2 AEAD codec (TS port of secure.py)
    ├── frame/           # frame types + command builders
    ├── link/            # codec + BLE → wire-event bridge
    ├── status/          # parse engine-status pub/rep arg → typed object
    ├── state/           # zustand store (conn, log, intent, status)
    └── ui/
        ├── primitives/  # Card, Toggle, StepperBar, StatRow
        ├── DeckScreen.tsx    # quick actions + deck + global FX
        ├── StatusScreen.tsx  # live engine / bridge / sim health
        ├── LogsScreen.tsx    # wire-level event log
        ├── TestsScreen.tsx   # connectivity probe + range test
        ├── ScanScreen.tsx    # discover / pair / connect
        ├── LinkBar.tsx       # persistent connection strip
        ├── theme.ts          # colors / fonts / spacing / radii
        └── layout.ts         # responsive form-factor hook (iPhone vs iPad)
```

---

## Prerequisites

| Tool                                    | Version                       | Why                       |
| --------------------------------------- | ----------------------------- | ------------------------- |
| Node.js                                 | 20 LTS or newer               | Expo / Metro              |
| npm                                     | 10+                           | comes with Node           |
| Xcode                                   | 15+ (macOS only)              | iOS device builds locally |
| iOS Simulator                           | iOS 17+                       | quick smoke tests         |
| EAS CLI                                 | `npm i -g eas-cli` (≥ 18.7)   | cloud builds for device   |
| Apple Developer Program enrollment      | required                      | TestFlight / App Store    |
| `marsin_engine/secret.yaml`             | see [`secret.yaml.example`](../../marsin_engine/secret.yaml.example) | AEAD key (gitignored)     |
| At least one Heltec running the firmware | `control_podium/firmware/`    | something to talk to      |
| Bridge running on a Mac or Pi           | `bridge_companion.py`         | something on the LoRa end |

---

## Bring-up: dev install

```bash
# 1. From the repo root, copy the example secret and edit it for your camp.
#    EVERY component (engine, bridge, firmware, this app) reads the same file.
cp marsin_engine/secret.yaml.example marsin_engine/secret.yaml
# edit marsin_engine/secret.yaml — set `key:` (string) for dev or
# `key_hex:` (32 hex chars) for production.

# 2. Install JS dependencies.
cd control_podium/PortWatch
npm install
# postinstall runs `sync-secret --allow-missing` so install always succeeds;
# the strict check happens later, on `npm run ios` / `expo prebuild`.

# 3. Bake the secret into the app for development.
npm run sync-secret
# writes src/_generated/secret.generated.ts (gitignored). Re-run any
# time secret.yaml changes.
```

You're now ready to run the app.

### Secret handling per build profile

PortWatch follows a strict, profile-aware policy so we never ship a
production binary with a baked-in radio key:

| Profile (`EAS_BUILD_PROFILE` / `--profile`) | Behaviour                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `development` (default `npm run sync-secret`)         | Reads `marsin_engine/secret.yaml` and bakes the AES-128 key into the JS bundle. **FAILS the build** if the file is missing.            |
| `preview` (`eas build --profile preview`)             | Same as `development` — bakes the dev/test secret in for ad-hoc TestFlight builds. **FAILS** if `secret.yaml` is missing.              |
| `production` (`eas build --profile production`)       | Skips the file entirely and emits a stub with `BAKED_AT_BUILD = false`. The app prompts for the key on first launch and stores it in iOS Keychain via `expo-secure-store`. |

The runtime UI (`SecretEntrySheet`) accepts either a `key:` string
(passphrase) or a 32-hex `key_hex:` value, shows a SHA-256 fingerprint
preview as the user types so two operators can verify they typed the
same secret, and stores the key with
`WHEN_UNLOCKED_THIS_DEVICE_ONLY` accessibility (no iCloud sync). The
Scan screen exposes a **FORGET KEY** button so an operator can wipe
and re-enter the secret without reinstalling.

`npm run sync-secret -- --allow-missing` is reserved for the
`postinstall` hook; it emits a stub that surfaces a clear in-app
"set up `marsin_engine/secret.yaml`" message instead of letting the
build silently boot with no crypto.

---

## Run on the iOS Simulator

```bash
cd control_podium/PortWatch
npm run ios:simulator
```

Note: **the iOS Simulator does NOT support Bluetooth**, so this only
exercises the UI. Use it for quick UI iteration; use a real device
(below) for anything BLE-related.

---

## Run on a real iPhone or iPad (local dev build)

This path requires Xcode, a paired device, and a free Apple ID for
signing. For TestFlight / App Store paths, jump to the EAS section
below — they're easier and more reliable.

```bash
# Plug in your iPhone/iPad over USB and trust the computer prompt.
# Make sure xcrun devicectl list devices shows it.

cd control_podium/PortWatch
npm run prebuild           # generates ios/ from app.json
npm run ios                # opens Xcode-equivalent build, deploys to device
```

Common gotchas:

- **"No bundle URL present"** — Metro isn't running; another shell
  with `npm run start` is needed alongside.
- **"Could not launch"** — first install of a free-account-signed app
  needs `Settings → General → VPN & Device Management → Trust …`.
- **BLE permission prompt doesn't appear** — uninstall the app from
  the device, reset privacy preferences, install fresh.

---

## Build with EAS for device install (recommended)

EAS Build runs the iOS toolchain in the cloud, signs with your real
provisioning profile, and gives you an `.ipa` you install via
TestFlight or ad-hoc distribution. No Xcode dance required after the
initial setup.

### One-time EAS setup

```bash
cd control_podium/PortWatch
npm i -g eas-cli                # if not already installed
npm run eas:login               # paste your Expo account password / SSO

# Create or link the EAS project. First run prompts you through it.
npx eas init                    # writes extra.eas.projectId into app.json
```

Then either register your iPhone for ad-hoc distribution:

```bash
npm run eas:device              # opens a QR code; scan from the iPhone Camera
```

…or wire up TestFlight (App Store Connect):

1. Log in to [App Store Connect](https://appstoreconnect.apple.com),
   create a new app called PortWatch with bundle id
   `com.titanicrig.portwatch`.
2. Edit `eas.json` and replace `REPLACE_WITH_APP_STORE_CONNECT_APP_ID`
   with the numeric App ID from App Store Connect.

### Build and install (preview = ad-hoc)

```bash
# Bakes the secret then triggers a cloud build with the preview profile.
npm run eas:build:preview
# When the build finishes, the EAS dashboard shows a QR code. Scan it
# from your iPhone's Camera app to install the .ipa over the air.
```

### Build for TestFlight / App Store (production)

```bash
npm run eas:build:store         # cloud build with the production profile
npm run eas:submit              # uploads the latest .ipa to App Store Connect
# Then in App Store Connect: process the build → add to TestFlight
# group → invite testers (or submit for App Store review).
```

---

## App Store submission checklist

Before tapping "Submit for Review":

- [ ] `app.json` `expo.version` and `expo.ios.buildNumber` are bumped.
      EAS Build's `production` profile auto-increments the build
      number; you still need to bump `expo.version` manually for each
      user-visible release.
- [ ] App Store Connect screen has matching bundle id
      (`com.titanicrig.portwatch`).
- [ ] Required screenshots (iPhone 6.7" + iPad 12.9" minimum) uploaded.
- [ ] Privacy nutrition label declares Bluetooth (we use it for nothing
      except connecting to physically-controlled hardware — none of
      this is sent off-device).
- [ ] App Privacy section: "Data Not Collected" — PortWatch does not
      collect, transmit, or store any user data. Network requests are
      constrained to the local LoRa mesh via BLE, with no internet
      egress.
- [ ] Export Compliance: app.json sets
      `ITSAppUsesNonExemptEncryption: false` (we use AES for local
      authentication only, which is exempt under
      [BIS §740.17(b)(1)](https://www.bis.doc.gov/index.php/policy-guidance/encryption)).
- [ ] Demo account: not applicable (no login).
- [ ] Sign-in section: "App does not use Sign-in".
- [ ] Reviewer notes should explain that the app requires physical
      pairing with TITANIC hardware to do anything functional, and
      include the test PIN flow and a screenshot of the Heltec PIN
      page so the reviewer doesn't get stuck at the BLE pairing step.

---

## Permissions

PortWatch declares the minimum iOS permissions needed to talk to a
Heltec radio:

| Key                                       | Purpose                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `NSBluetoothAlwaysUsageDescription`       | Connect to and write/read characteristics on the captain Heltec               |
| `NSBluetoothPeripheralUsageDescription`   | Legacy iOS 13.0–13.4 string (kept for App Review pedantry)                    |
| `UIBackgroundModes: [bluetooth-central]`  | Maintain the active BLE link if the operator backgrounds the app briefly      |

We deliberately do **not** request:

- Location (we don't use it; service-UUID scanning is enough).
- Network (we don't make any network requests).
- Camera, mic, contacts, photos, calendar, motion, etc.

The `react-native-ble-plx` Expo plugin in `app.json` wires the
permission strings into the generated Info.plist; do not add them
manually.

---

## Tabs

| Tab     | Purpose                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------- |
| **Deck**   | Quick actions (Blackout / Brightness), Deck (autopilot, transitions, pattern picker), Global FX, Pyro placeholder. The primary control surface. |
| **Status** | Read-only health: Connection / Server Bridge / MarsinEngine / Simulation. Pyro and Horn live as disabled placeholders to communicate scope. |
| **Logs**   | Wire-level event log: every TX and RX, raw frame body, decode status. Capped at 200 entries (newest first). |
| **Tests**  | Connectivity probe (one-shot firmware metadata + LoRa round-trip) + range test (ping bursts with histogram + percentiles). |

The form factor is detected automatically: a single-column, full-width
layout on iPhone-class width (≤ 600 dp) and a max-width-clamped
column on iPad and split-view, so cards stay readable rather than
stretching to fill the screen.

---

## BLE pairing

The first time you connect to a Heltec, iOS prompts for a 6-digit
pairing PIN. The Heltec OLED auto-jumps to the PIN page (full
brightness) so you can read the digits across a workshop. Subsequent
connects don't re-prompt — the bond persists in iOS Settings →
Bluetooth and on the Heltec in NVS.

To unpair from PortWatch, tap the **UNPAIR** button on a paired row in
the scan list. Because iOS doesn't expose an API for apps to remove
BLE bonds, this can only:

1. Clear PortWatch's local "PAIRED" badge for that device.
2. Deep-link you to **Settings → Bluetooth** so you can tap the *(i)*
   next to the device and "Forget This Device".

The `tcon_*` advertised name comes from the `name` field in
`control_podium/.config.nodes.yaml`. To rename, edit the YAML and
re-flash via `firmware/deploy.py`.

---

## Diagnostics

```bash
# Cross-platform BLE scanner (Bleak, Python). Confirms whether the
# Heltec is actually advertising. Use this when "PortWatch doesn't see
# the device" to figure out if it's the firmware or the app.
npm run ble:scan

# Live serial monitor for the captain Heltec on USB. Shows boot
# banner, NimBLE init, passkey rotations, every TX/RX.
npm run serial:monitor

# TypeScript check (no JS emitted).
npm run typecheck

# Expo project sanity check.
npm run doctor
```

---

## Security notes

- **AEAD principal is the phone, not the Heltec.** The Heltec radio
  carries Titanic frames byte-for-byte but has zero access to the AES
  key. A stolen-but-locked iPhone can't talk to the mesh; a stolen
  Heltec can't impersonate one.
- **`marsin_engine/secret.yaml` is gitignored** and must be deployed
  out-of-band (e.g. via secure file transfer, a private wiki, or a
  password manager). Never commit it.
- **Pairing requires display + keyboard.** NimBLE on the Heltec is
  configured for `BLE_HS_IO_DISPLAY_ONLY` + `mitm=true` + Secure
  Connections, which forces a real PIN exchange (no Just-Works) and
  ECDH (no legacy random).
- **No `fire/*` path.** The bridge HARD-rejects every command that
  contains "fire" regardless of role. The Flame Effect Controller
  lives on a separate transport with its own interlocks.

---

## Versioning

`app.json`'s `expo.version` is the user-visible app version. Bump it
manually for each release. EAS Build's `production` profile
auto-increments `ios.buildNumber` so you don't have to.

`package.json`'s `version` tracks the JS surface independently of the
shipped app. Bump it whenever the wire protocol or major UI changes.

---

## Troubleshooting

| Symptom                                                | Likely cause                                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `SECRET NOT BAKED` screen                              | `marsin_engine/secret.yaml` was missing at build time. Create it and re-run `npm run sync-secret`.                                |
| iOS app doesn't see any Heltec                         | Heltec isn't on, isn't advertising, or BLE permission is denied. Run `npm run ble:scan` to confirm.                                |
| App crashes on launch with "Cannot find native module" | Native dependencies (`react-native-ble-plx`) changed but the app wasn't rebuilt. Re-run `npm run prebuild` or do a fresh EAS build. |
| Pairing prompt never appears                           | iOS thinks it's already bonded. Forget the device in Settings → Bluetooth, then reconnect.                                         |
| Every command times out                                | Bridge isn't running, or bridge can't reach the engine. Run `bridge_companion.py` and check its log.                              |
| `qry engine/patterns` reply is truncated               | Expected — bridge clamps to ~115 plaintext chars per LoRa frame and appends `+N` for the remainder. See `parsePatternList` in `src/status/parse.ts`. |
| Build fails with `pio not found`                       | Firmware build, not PortWatch. See `control_podium/firmware/README.md`.                                                            |

---

## License & ownership

Internal TITANIC tooling. Same conventions and ownership as the rest
of the camp tooling — see the repo root for project-level details.
