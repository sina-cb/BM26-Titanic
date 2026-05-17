# 21 — PortWatch: Field Operations App

> **Status:** Living design doc for the PortWatch iOS/iPadOS app.
>
> **Companions to read first:** `07_control_podium.md` (the LoRa mesh,
> Titanic Frame v2, the Pi bridge, the captain/crew/server roles) and
> `16_captain_pad.md` (CaptainPad — the VJ surface this doc is
> deliberately separate from).
>
> **Out of scope (deliberately):** the radio protocol itself (frame
> layout, AEAD, replay defence) — that lives in `07_control_podium.md`
> §3 and is treated as fixed here. This doc is about PortWatch's design,
> its BLE connection to the mesh, and the command surface it exposes.

---

## 1. What PortWatch Is

PortWatch is a standalone iPhone / iPad app for **field operations**.
Its job: connect to a Heltec radio over BLE, talk to the Titanic mesh
over LoRa, and give a captain on the playa live system status and the
handful of controls they actually need when they're 100 m from the camp.

It is **not** CaptainPad and is not a subset of CaptainPad.

| App           | Role               | Transport           | Form factor      | Command surface |
| ------------- | ------------------ | ------------------- | ---------------- | --------------- |
| **CaptainPad**| VJ control surface | Wi-Fi (REST + WS)   | iPad, in camp    | Full            |
| **PortWatch** | Field ops          | LoRa via BLE        | iPhone / iPad    | Captain MVP     |

CaptainPad has no BLE module, no LoRa module, and no knowledge of
PortWatch. PortWatch has no Wi-Fi REST path, no WebSocket, and no
knowledge of CaptainPad's internals. The two apps share nothing at
runtime. The isolation is intentional and permanent — it is not a
staging state on the way to merging.

### Why separate apps

1. **Native module isolation.** `react-native-ble-plx` requires an EAS
   dev/preview build and Bluetooth entitlements. If it breaks a Metro
   symlink or pins a peer dependency wrong, only PortWatch is affected.
   CaptainPad keeps bundling.
2. **Crypto correctness in a small blast radius.** Titanic Frame v2 is
   AES-128-GCM with 24-bit truncated tags, fingerprinted shared keys,
   and per-source sequence-number replay defence. The TS port has to be
   byte-exact compatible with `marsin_engine/comms/codec.py`. A
   single-purpose app makes this easy to test and audit in isolation.
3. **iPhone is the right tool for the playa.** Small, in a pocket, one
   hand. Walk-testing LoRa range at 2 AM in the dust is not an iPad job.
4. **Different UX contract.** CaptainPad assumes bandwidth and a stable
   connection. PortWatch assumes neither. Designing them separately means
   each can be honest about its own constraints rather than one trying to
   gracefully degrade into the other.

### PortWatch lives at

```
control_podium/PortWatch/
  app.json                    ← Expo manifest (bundle id, permissions)
  eas.json                    ← EAS Build profiles (dev / preview / production)
  package.json
  scripts/
    sync-secret.mjs           ← bakes marsin_engine/secret.yaml at build time
    ble-scan.py               ← cross-platform BLE diagnostic (bleak)
  src/
    ble/                      ← BLE link layer (scan, connect, pair, write, notify)
    crypto/                   ← Titanic Frame v2 encode/decode + AEAD
    frame/                    ← frame types + command builders
    link/                     ← codec ↔ BLE bridge (TitanicLink)
    state/                    ← zustand store (conn, log, intent, status)
    status/                   ← parse engine-status pub/rep arg
    ui/
      ScanScreen.tsx          ← discover + pair + connect
      DeckScreen.tsx          ← quick actions + deck + global FX + pyro placeholder
      StatusScreen.tsx        ← live engine / bridge / sim health
      LogsScreen.tsx          ← wire-level event log
      TestsScreen.tsx         ← connectivity probe + range walk
      LinkBar.tsx             ← persistent connection strip
      theme.ts / layout.ts    ← colors, fonts, spacing, responsive form-factor hook
      primitives/             ← Card, Toggle, StepperBar, StatRow
```

The `CaptainPad/iphone_companion/` prototype that predated this doc
was the proof of concept; it has been superseded by PortWatch (this
codebase) and the prototype folder removed from the tree.

---

## 2. Architecture

```
PortWatch (iPhone)
    │
    │  BLE (NimBLE, passkey-bonded, AES-128-GCM on CHAR_CMD)
    ▼
Heltec (captain node — e.g. tcon_sina, NODE_ID 0x0A)
    │
    │  LoRa 915 MHz, SF7/BW250, Titanic Frame v2 (AEAD)
    ▼
Heltec (server node — tcon_server, NODE_ID 0x01)
    │
    │  USB-CDC serial
    ▼
Pi bridge (bridge_companion.py)
    │
    │  HTTP REST
    ▼
MarsinEngine
```

PortWatch is the AEAD principal: it holds the AES-128 secret from
`marsin_engine/secret.yaml` (baked in at build time) and signs every
outbound frame. The captain Heltec is a dumb radio relay — it does not
hold the secret and cannot forge or modify frames. The bridge verifies
every frame before it touches the engine. There is no unauthenticated
path.

---

## 3. BLE Connection

### 3.1 Node names on the air

Every Heltec advertises as `tcon_<node-name>`, where `<node-name>` is
the `name:` field from `control_podium/.config.nodes.yaml`:

| Node id | YAML name | BLE advertised name |
| ------- | --------- | ------------------- |
| `0x01`  | `server`  | `tcon_server`       |
| `0x0A`  | `sina`    | `tcon_sina`         |
| `0x0B`  | `misha`   | `tcon_misha`        |
| `0x10`  | `crew_01` | `tcon_crew_01`      |

The mapping is enforced at flash time: `firmware/deploy.py` reads
`.config.nodes.yaml`, sanitises the name to `[a-z0-9_]`, and passes it
to the firmware as a `-DBLE_NODE_NAME=\"sina\"` build flag. The firmware
concatenates `"tcon_" + BLE_NODE_NAME` and uses that as both the BLE
local name and the OLED header. There is no runtime config for the name;
edit the YAML and re-flash to change it.

A plain `pio run` without `deploy.py` falls back to `tcon_node` so
bench tests work without specifying a node id.

### 3.2 Discovery

The 31-byte BLE primary advertisement packet can't fit both the 128-bit
Titanic service UUID and a multi-character local name without overflow.
The firmware splits them:

- **Primary advertisement** — `Flags`, `CompleteServices128(TITANIC_SERVICE)`, `TX power`.
- **Scan response** — `CompleteName("tcon_<name>")`.

iOS active-scans by default and merges both packets in the discovery
callback, so PortWatch sees the name normally.

The PortWatch scan filter is **by service UUID, not by name**
(`BleManager.startDeviceScan([TITANIC_SERVICE], ...)`), so:

- Discovery succeeds even if the scan response is dropped on a busy channel.
- The OS-level driver discriminates, so we don't burn battery waking on every nearby beacon.
- The `tcon_` prefix is used for cosmetic display and a defence-in-depth
  check (`isTitanicName()` in `src/ble/uuids.ts`) confirming the device
  is on-mesh before connecting.

### 3.3 Passkey pairing

Each Heltec generates a fresh random 6-digit passkey at boot
(`esp_random()` in `titanic_ble.h::begin()`). It's displayed on the
OLED and stored in NVS only as part of the bond — never as a static
file.

NimBLE security is configured for the strongest standard scheme the
ESP32-S3 supports:

- `setSecurityIOCap(BLE_HS_IO_DISPLAY_ONLY)` — peripheral has a display,
  central has a keyboard.
- `setSecurityAuth(true /*bond*/, true /*mitm*/, true /*sc*/)` — bond
  the LTK on both sides, require MITM protection (user must read and
  enter the PIN — no Just-Works), use Secure Connections (ECDH, not
  legacy random).
- `CHAR_CMD` is `WRITE_ENC` and `CHAR_LAST_RX` is `READ_ENC` — any
  access to operationally relevant characteristics requires an encrypted,
  authenticated link.

The PortWatch-side flow:

1. User taps a discovered radio in the scan list.
2. `src/ble/client.ts::connect()` calls `connectToDevice` and
   `discoverAllServicesAndCharacteristics`.
3. It forces the pairing handshake immediately by reading `CHAR_LAST_RX`,
   which iOS recognises as requiring encryption and pops its system
   "Bluetooth Pairing Request" dialog. This is intentional — without it,
   pairing is deferred until the first `CHAR_CMD` write, which makes
   the UX feel broken.
4. NimBLE's `onPassKeyDisplay()` fires on the firmware side, triggering
   a screen-wake event: the OLED force-jumps to the BLE PIN page at full
   contrast so the operator reads the digits without cycling pages.
5. User types the 6 digits into iOS. NimBLE validates, runs the
   ECDH+passkey exchange, and stores the bond.
6. `onAuthenticationComplete()` fires; the firmware double-checks
   `connInfo.isEncrypted()` and disconnects if not (defence against
   misconfigured stacks that "complete" auth on a plaintext link), then
   raises `_ble_pairing_done` so the OLED jumps to the BLE INFO page.
7. PortWatch's `client.ts` retries the read; it succeeds on the now-
   encrypted link; `connect()` resolves; the UI moves to StatusScreen.

Subsequent connects don't re-prompt — the bond is in iOS Settings →
Bluetooth and on the Heltec in NVS. Forgetting the device on either side
requires re-pairing (intentional: this is how a stolen-but-locked iPhone
can't talk to the mesh).

### 3.4 Why this is enough

Two layers of strong cryptography, operationally trivial:

- **BLE link** — stops a bystander iPhone from silently bonding and
  writing arbitrary `CHAR_CMD` payloads. The PIN is on the OLED, in
  physical custody of the captain.
- **LoRa air interface** — even if a captain Heltec is stolen and paired
  with someone else's phone, every frame still has to be signed by the
  AES-128 secret in `marsin_engine/secret.yaml`, which the captain
  Heltec **does not store**. The phone is the AEAD principal, not the
  radio.

---

## 4. PortWatch Command Surface

PortWatch operates exclusively over LoRa at SF7/BW250, which delivers
roughly 1 kbps of payload after overhead and AEAD. A typical Titanic
Frame v2 command is ~40–60 bytes. That budget supports about **one
user-driven action per second** and a 5–10 s status publish from the
server. PortWatch's UI is designed around this constraint, not in spite
of it.

### 4.1 Commands PortWatch issues

These map 1:1 to the `min_role: captain` entries in
`control_podium/.config.commands.yaml`:

| Command                 | What it does on the engine                                                            |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `pattern/<n>`           | Switch to a named pattern.                                                            |
| `param/<k>/<v>`         | Set a Central Parameter Center scalar (`speed`, `direction`, `count`, `size`, `rotate`). |
| `param/colorPaletteN/<h>-<s>-<v>` | Set a CPC colour-palette HSV triple (slot 1 or 2). `palette/<n>/<h>-<s>-<v>` is the short alias. |
| `palette/<n>/<h>-<s>-<v>` | Alias for `param/colorPalette<n>/…`. Same wire cost, easier to type.                 |
| `exp/<crc32_id>/<v0>`   | Per-pattern WASM export write (local pattern parameter slider).                       |
| `playlist/<name>`       | Switch the deck base channel's active playlist. Engine reloads the first non-missing entry and re-broadcasts. |
| `blackout/0\|1`         | Hard mute / unmute everything (`globalsState.blackout`).                              |
| `autopilot/0\|1`        | Toggle autopilot.                                                                     |
| `fx/<n>/0\|1`           | Toggle a global rig effect (vintageWhite, fogger, etc.).                              |
| `brightness/<n>`        | Master brightness, 0–100.                                                             |
| `view/deck`             | Engine output override → "deck only". Implemented as the `controlLock` global param — see §10. The first take arms a 30 s lease; each repeat resets it. |
| `view/renew`            | Silent lease renew (same wire effect as `view/deck`, distinct verb so logs don't look like "TAKE LOCK every 20 s"). PortWatch sends this on a 20 s heartbeat while holding the lock. |
| `view/clear`            | Release the override; engine restores the pre-override target view, clears `controlLock`, and disarms the lease timer. |

### 4.2 Queries PortWatch issues

| Query                                | What it returns                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `qry engine/status`                  | Active pattern, brightness, blackout, autopilot, speed, deck/mixer view, **`controlLock` owner (`lk`), lease remaining seconds (`lku`), active deck playlist name (`pl`)**. The lock/playlist trio is what makes the "no-overriding-active-shows" guarantee possible — see §10. |
| `qry engine/patterns/p/<n>`          | One page of the **engine's full** pattern catalog. Reply: `p/<idx>,t/<total>,n/<count>,c/<csv>`.            |
| `qry engine/playlist-patterns/p/<n>` | One page of the **deck's currently-loaded playlist** patterns (the picker's actual scope). Reply: `p/<idx>,t/<total>,n/<count>,pl/<playlist_name>,c/<csv>`. `pl/-` for "no playlist loaded". |
| `qry param/<k>` or `qry param/all`   | Current value(s) of a CPC scalar (legacy shape).                                                           |
| `qry params`                         | Full global-params snapshot for ParamsCard: `sp/<f>,dr/<f>,ct/<f>,sz/<f>,rt/<f>,p1/<h>-<s>-<v>,p2/<h>-<s>-<v>`. One frame. |
| `qry exports/p/<n>`                  | Paginated per-pattern WASM exports for the deck base channel. Reply records: `<id>~<kind>~<v0>~<name>`. **Same filter as CaptainPad's deck card** — exports the CPC has taken ownership of (`sliderSpeed` when CPC owns `speed`, etc.) and engine metadata exports (kind ∉ {1,2,3,6}) are hidden, so PortWatch never shows a duplicate local slider for a global the operator already controls via the ParamsCard. |
| `qry playlists/p/<n>`                | Paginated playlist directory listing.                                                                      |
| `qry deck/playlist`                  | Deck-channel's currently-loaded playlist: `pl/<name>,en/<entryId>` or `pl/-`.                              |
| `qry mixer/state`                    | Mixer master + channel count (read-only display).                                                          |
| `hlo` / `pong`                       | Handshake / keepalive.                                                                                     |
| `pin`                                | Ping with RSSI echo (used by Range Test / LoRa Probe).                                                     |

Crew-role devices can issue queries and pings only. Captain-role devices
can issue the full command set above. This gating is enforced in the
bridge, not in PortWatch's UI — the UI just reflects what the bridge
will accept for the connected node's role.

> **Why two `patterns` queries?** `engine/patterns` returns the whole
> engine library — useful for diagnostics, but operators care about the
> *deck's working set*. `engine/playlist-patterns` scopes to the
> currently-loaded playlist so tapping a pattern in the picker keeps the
> deck pointer inside the playlist (instead of silently moving off-cursor
> to a pattern not in the playlist). PortWatch's picker uses
> `engine/playlist-patterns`; the legacy path is kept for backwards
> compatibility and one-off diagnostics.

### 4.3 What PortWatch explicitly does not do

These are not missing features — they are deliberate scope boundaries.

| Feature                      | Why it's out of scope                                                |
| ---------------------------- | -------------------------------------------------------------------- |
| Per-channel mixer writes     | Requires dozens of writes per gesture; radio budget is ~1/s. Master brightness only. |
| Pattern source editing       | Saving + compiling pushes whole files. No LoRa equivalent. Read-only display of current pattern name only. |
| Live visualisation           | Continuous stream / WebGL frame — no radio equivalent and no pretending otherwise. |
| Per-fixture / dimmer writes  | Same reason as per-channel mixer; no path in the command allowlist by design. |
| Any `*fire*` command         | Hard-rejected by the bridge regardless of role. The Flame Effect Controller runs on a separate transport. This is a safety boundary, not a usability one. |

---

## 5. PortWatch UI Screens

PortWatch has five screens. The first one (Scan) is what you see
before pairing; the next four are tabs once a Heltec is connected.
A persistent **LinkBar** sits above the tab bar in the connected
state showing device name, AES key fingerprint, BLE/LoRa RSSI, and
TX/RX counters.

### ScanScreen
List of discovered `tcon_*` Heltec radios (filtered by
TITANIC_SERVICE UUID). Tap to connect and pair. Shows node name,
RSSI, "PAIRED" badge for previously-bonded devices, and an honest
unpair UX that deep-links to iOS Settings → Bluetooth.

### DeckScreen (primary control surface)
The command tab. The card order top-to-bottom is intentional —
fastest-impact controls first, the most operator-visual context
(playlist + pattern picker) before per-parameter knobs:

* **QUICK ACTIONS** — stateful BLACKOUT toggle and a discrete
  BRIGHTNESS stepper (chip-style 0/10/25/50/75/100). No continuous
  sliders for anything that goes over the radio — the LoRa budget is
  ~1 fps and a continuous slider would overflow it.
* **DECK** — three things in one card:
  * **DECK OVERRIDE** — TAKE LOCK / RELEASE button (see §10). When
    PortWatch holds the lock, CaptainPad is muted; when released,
    CaptainPad regains control instantly.
  * Autopilot on/off, autopilot interval stepper
    (`param/autopilotInterval/<sec>`), a disabled Transitions
    placeholder, and the active-pattern read-out.
  * **DECK PLAYLIST switcher** chips for `qry playlists/p/<n>` +
    `cmd playlist/<name>`. Switching a playlist sets a global
    `deckPlaylistSwitching` flag that disables both the playlist
    chips and the pattern picker REFRESH until the engine has
    returned the new playlist's entries — no racing the engine
    while it's mid-reload.
  * **PATTERN PICKER** scrolling list, sourced from
    `qry engine/playlist-patterns/p/<n>` (scoped to the current
    playlist). All-or-nothing fetch with 3× retries per page; never
    shows a half-baked list.
* **PARAMS** — Central Parameter Center + per-pattern WASM exports,
  refreshable on-demand:
  * *Global params*: speed, size, count, direction, rotate as
    discrete stepper bars; two HSV palette swatches with a hue
    stepper. Writes go via `cmd param/<key>/<v>` (scalars) or
    `cmd palette/<n>/<h>-<s>-<v>` (colour). The card auto-refreshes
    on first mount.
  * *Local params*: the deck's active pattern WASM `kind=1` slider
    exports, queried via `qry exports/p/<n>` and written via
    `cmd exp/<crc32_id>/<v0>`. Auto-refreshes whenever the active
    pattern changes.
* **GLOBAL FX** — four stateful toggles (VintageWhite, Fogger,
  UVBlast, BlastAllWhite) and HORN as a press-and-hold momentary.
* **PYRO** (disabled) — present so the operator knows pyro is out of
  scope by design, not because we forgot.

### StatusScreen
Read-only system health. Six cards:

* **CONNECTION** — captain Heltec link, BLE RSSI, LoRa RSSI/SNR,
  TX/RX counters, AES key fingerprint.
* **SERVER BRIDGE** — green if a status pub/rep arrived in the last
  35 s; amber 35–60 s; red over 60 s. (Active publish cadence is 5 s.)
* **MARSINENGINE** — derived from the most recent status pub:
  active pattern, brightness, blackout, autopilot, speed, uptime.
  Red if `dn=1`.
* **SIMULATION** — green when engine FPS > 0; amber if engine alive
  but FPS = 0; red if engine down.
* **PYRO CONTROL** (disabled), **HORN CONTROL** (status not wired) —
  same-as-above placeholders for transparency about what's reachable.

### LogsScreen
Wire-level event log: every TX and RX, with timestamp, src/dst/seq,
counter, summary, and the raw `T2|…` line. Newest first; capped at
200 entries (older entries dropped).

### TestsScreen
Two cards:

* **CONNECTIVITY PROBE** — one-shot read of every firmware metadata
  characteristic over BLE (FW version, uptime, freq, SF, BW, TX
  power, LoRa counters), then a single `pin` and `qry engine/status`
  to time both LoRa round-trips. Runs in <2 s; the right-first thing
  to do before walking the rig.
* **RANGE TEST** — burst of pings (10/25/50/100) with configurable
  inter-ping delay (400 ms / 800 / 1.5 s / 3 s). Live histogram +
  percentile readouts + scrolling timeline. Cancel mid-burst.

---

## 6. The Raspberry Pi Bridge

### 6.1 What it is

A long-running Python process at
`control_podium/companions/bridge_companion.py`. It is the **only** path
by which an off-Wi-Fi client changes engine state. Its job:

1. Sit on the USB-CDC serial port of the server Heltec (`tcon_server`,
   NODE_ID `0x01`).
2. Read every Titanic Frame v2 line the Heltec emits as it receives
   radio frames.
3. Decrypt and authenticate each frame with the AES-128 secret from
   `marsin_engine/secret.yaml`. Frames that don't authenticate are
   silently dropped.
4. Look up the source node id in `.config.nodes.yaml` and check role:
   crew can query/ping, captains can also command.
5. Validate the command path against `.config.commands.yaml`.
6. Translate the validated command into a MarsinEngine REST call, wait
   for the response or a short timeout, and emit a reply frame back over
   the radio.
7. On a 5 s active / 30 s idle cadence, publish an engine status summary
   (active pattern, brightness, blackout, autopilot, speed) so all
   clients can keep their UI current without polling separately.

The bridge is the only code path that touches the engine on behalf of
the radio. Any future component that needs to inject commands over the
air goes through this bridge so the allowlist, role check, and AEAD
verify are applied uniformly.

### 6.2 Where it runs in production

A Raspberry Pi 4 next to the engine machine, on the same LAN:

1. **Always-on serial host.** The Heltec doesn't speak Wi-Fi in server
   mode; the Pi bridges USB-CDC to the network.
2. **Power durability.** The Pi lives in the generator plant and runs
   a crash-restart wrapper. The engine machine is a developer laptop
   that may sleep or be yanked mid-show.
3. **Headless deployment.** A single systemd unit; logs to
   `/var/log/titanic-bridge.log`. The bridge has been the most reliable
   component on the bench precisely because it does so little.

### 6.3 During development

The Pi is a deployment topology, not a code dependency. The same
`bridge_companion.py` runs on a developer Mac with the server Heltec
on USB:

```bash
.venv-dev/bin/python3 control_podium/companions/bridge_companion.py --bus serial
```

---

## 7. The Bridge as API Mirror

### 7.1 Design rule

The radio command surface (`.config.commands.yaml`) is the intersection
of:

- What MarsinEngine exposes via REST/WS, and
- What survives the LoRa bandwidth budget (§4), and
- What an operator could plausibly want standing 100 m from the camp.

Every command in that file maps to roughly one engine REST call with the
same semantics and the same failure modes. The bridge is the smallest
possible translator between a frame and an engine call — not a separate
API surface with its own opinions.

### 7.2 Adding a new command

When PortWatch needs a new capability:

1. Add an entry to `.config.commands.yaml` (path, `min_role`,
   description).
2. Add a handler in `Bridge._exec_cmd()` calling the same engine
   endpoint PortWatch would call over Wi-Fi.
3. Add a UI control in `OpsScreen.tsx` that builds the correct
   Frame v2 string.
4. Add a test vector to `tests/test_comms_e2e_sim.py`.

Anything not in `.config.commands.yaml` is, by construction, not
available to PortWatch. That's the bandwidth budget enforcing
architectural boundaries.

### 7.3 Intentionally no bridge path for

- Per-channel mixer writes — no `mixer/channel/<n>/<v>` path, ever.
- Pattern source upload — no `save-pattern` path.
- Simulation tunneling — the bridge does not proxy WebGL.
- Fire commands — hard-rejected with a logged warning, regardless of role.

---

## 8. Open Questions

1. **Multi-Heltec on one phone.** PortWatch today pairs to one Heltec
   at a time. In a real camp the operator may want to switch between
   their captain handheld and the server radio directly ("I'm in camp
   now, talk straight to the server for ground-truth"). Do we keep
   "one connected at a time, switch in ScanScreen" or build a pinned
   switch list?

2. **Bond persistence across firmware reflashes.** Re-flashing a Heltec
   wipes its NVS bond; the phone has to forget and re-pair. Worth
   persisting the bond key separately so `deploy.py` doesn't break
   paired phones? Probably no — the security story relies on fresh bonds
   per flash — but worth stating explicitly.

3. **iPad vs iPhone BLE range.** iPads have larger / different antenna
   layouts. If PortWatch on an iPad behaves measurably differently from
   PortWatch on an iPhone in a walk test, we need a known-good comparison
   baseline. Run one comparison test on every form factor we expect to
   deploy before the event.

4. **Android.** PortWatch has the Android permission scaffolding in
   `client.ts::requestPermissions()` but is configured iOS-only via the
   Expo plugin. If a crew tablet on Android is ever needed, revisit here.
   The original plan was to ship a crew Heltec instead.

5. **PortWatch as a crew tool.** The current command surface is
   `min_role: captain`. A crew-only build (queries and pings only, no
   ops) might be useful for a stage manager who needs system status
   without command authority. This is a role config change in the bridge,
   not a UI rebuild.

---

## 10. The Deck Override (`controlLock`) and CaptainPad Coordination

PortWatch and CaptainPad can both drive the rig. To keep them from
fighting over the deck during a live moment, we expose a single global
parameter — `controlLock` — that any UI can read, and PortWatch is the
only writer that ever sets it to `"portwatch"`.

### 10.1 Model

`controlLock` is a `globalsState` field on the engine. It is broadcast
in two channels so every UI can pick it up:

- **`viewOverride` WS event** — sent whenever the engine pins (or
  releases) the deck view. Carries `{override, controlLock}`.
- **`GET /globals`** — includes `controlLock` so a cold-booting UI can
  hydrate its lock state without waiting for the next broadcast.

The engine treats `view-override = 'deck'` as the only way to take the
lock today. Clearing the override clears `controlLock`. They are kept
in lockstep by `syncControlLockToGlobals()` in
`marsin_engine/lib/api_server.js`.

### 10.2 What it means for each UI

| UI         | When `controlLock === "portwatch"`                                                    |
| ---------- | ------------------------------------------------------------------------------------- |
| CaptainPad | A full-screen "EXTERNAL HAS THE RIG" overlay covers the deck and mixer tabs (see `CaptainPad/components/EngineLockoutOverlay.tsx`). All gestures are blocked. The overlay fades out the instant `controlLock` clears. |
| PortWatch  | Every actionable control on DeckScreen is enabled. The DECK card shows a RELEASE button (red), the override pill reads "DECK PINNED · PORTWATCH". |
| Scripts    | `/control` and `/param-center` POSTs still succeed at the HTTP layer — the lock is a UX coordination signal, not an authorisation barrier. A script that POSTs while PortWatch holds the lock will move the engine, but its writes will be immediately overwritten by PortWatch's next intent and the operator at the rig won't notice the conflict. |

### 10.3 Taking and releasing the lock

PortWatch:

1. Operator taps TAKE LOCK.
2. PortWatch sends `cmd view/deck`.
3. Bridge calls `POST /mixer/view-override {override: "deck"}`.
4. Engine sets `viewOverrideMode = "deck"`, calls
   `syncControlLockToGlobals()` (writes `globalsState.controlLock =
   "portwatch"`, saves state), and **arms a 30 s lease timer**.
5. Engine broadcasts `{type: "viewOverride", override: "deck",
   controlLock: "portwatch", controlLockLeaseExpiresAtMs: …,
   controlLockLeaseDurationMs: 30000}` on the WS.
6. CaptainPad's `useEngineLock()` hook receives the broadcast and
   raises its overlay within ~1 frame of the engine ack.

Releasing is the same path with `cmd view/clear`. The pre-override
target view is restored from `savedTargetViewFader` and the lease
timer is disarmed.

### 10.4 The lease (and why PortWatch renews every 20 s)

`controlLock` is a **lease**, not a permanent take. The engine arms a
30 s timer on every `POST /mixer/view-override {override: 'deck'}` and
auto-clears the override when it fires. This protects against three
failure modes that would otherwise permanently lock CaptainPad out:

* The phone walks out of LoRa range while holding the lock.
* The PortWatch app crashes or gets force-quit by iOS.
* The bridge or the radio link goes down silently.

PortWatch keeps the lease alive by sending **`cmd view/renew`** every
~20 s while the lock is held. The bridge translates this to the same
view-override POST as a fresh take — every successful POST restarts
the 30 s timer. The verb is split (`renew` vs `deck`) only so the wire
log doesn't read like "operator hammering TAKE LOCK every 20 s"; the
engine treats them identically.

If a renew is lost over LoRa, PortWatch's DeckCard also fires a
**defensive renew** when the engine reports `lku ≤ 12` (12 seconds
remaining on the lease). The picker uses `controlLockLeaseRemainSec`
from the compact PUB so the defensive renew is driven off engine
ground truth, not a client-side clock.

When PortWatch reconnects after a disconnection within the lease
window, its connect-time refresh (§10.5) reads the engine's current
lease state — if we're still the owner, the renew loop resumes
automatically.

| Constant | Value | Where |
| -------- | ----- | ----- |
| Lease duration | 30 s | `CONTROL_LOCK_LEASE_MS` in `marsin_engine/lib/api_server.js` |
| Renew interval | 20 s | `LEASE_RENEW_INTERVAL_MS` in `control_podium/PortWatch/src/ui/DeckScreen.tsx` |
| Defensive renew threshold | 12 s | `LEASE_LOW_WATER_SEC`, same file |

The bridge surfaces the lease state on every compact-status PUB:

```
fps/40,pat/sunset,br/100,blk/0,ap/1,vw/deck,vov/1,lk/portwatch,lku/22,pl/main_show,upt/123
```

A `lk/-,lku/0` reading means the lock is free (either nobody took it
or the lease expired). A non-zero `lku` ticking down toward zero is
the live countdown.

### 10.5 Connect-time state hydration & the ready-gate

When a PortWatch first comes online over BLE → LoRa, the engine could
already be mid-show — pinned to a specific playlist, with autopilot
running and the lock held by an earlier session. The UI **must not**
render any actionable affordance against guessed state. The contract
is: **never show bad data, never default to a wrong mode**.

#### The ready-gate (the "never guess" rule)

PortWatch's DeckCard is a strict 4-state machine, evaluated in this
exact order on every render:

| # | Trigger                                | UI                                          | Below-the-fold controls |
|---|----------------------------------------|---------------------------------------------|-------------------------|
| 1 | `engineStatus === null`                | "WAITING FOR ENGINE STATE" tile + spinner   | All disabled            |
| 2 | `viewOverrideActive`                   | "DECK OVERRIDE ACTIVE" + RELEASE button     | All enabled             |
| 3 | `engineView === "mixer"`               | "MIXER MODE · TAKE OVERRIDE" big button     | All disabled            |
| 4 | `engineView === "deck"`                | "DECK ACTIVE" + TAKE LOCK pill              | All enabled             |
| 5 | `engineView === null` after status set | "UNKNOWN ENGINE VIEW" warning               | All disabled            |

State #1 is the new fix. The previous renderer fell through to "DECK
ACTIVE" when status was null because `engineView === "mixer"` is
`null === "mixer"` → false. That was the bug behind "I put the engine
on mixer, opened PortWatch, and it shows deck controls". The rule now
is: **no engineStatus, no actionable UI**. Every Toggle / StepperBar
in QuickActions also receives `disabled={!status}` so the operator
can't fire a global blackout/brightness write before they can see what
the current state actually is.

State #5 is the second safety: if `vw` ever arrives missing or
unrecognised (e.g. a future engine adds a third view), we render the
UNKNOWN ENGINE VIEW warning instead of falling back to deck.

Source-of-truth: `control_podium/PortWatch/src/ui/DeckScreen.tsx`
DeckCard render block, gate constant `canControlDeck`.

#### `connectGeneration` drives all card hydration

Every successful BLE pair calls `bumpConnectGeneration()` in App.tsx.
The store's `connectGeneration: number` increments, and every card
that owns a fetched cache has a `useEffect` that listens for the
change. This replaces the previous "useRef-on-mount" latch which had
two failure modes in production:

* The latch was set BEFORE `refresh()` actually ran — if the first
  attempt happened before BLE finished its first round-trip, the qry
  timed out and we silently never retried.
* On Fast Refresh / parent re-render the latch survived spuriously,
  skipping the second hydration when it was actually needed.

`connectGeneration` is fired from `App.tsx::onConnect` immediately
after `setConn({kind: "connected"})` and BEFORE the App-level qry
burst, so the cards' `useEffect`s see the new counter, fire their
own `refresh()`, and the App-level HLO + status qry runs in parallel.
Worst-case the operator sees four LoRa frames in flight at once;
typical-case the bridge eager-PUB lands first and the explicit qrys
land within ~1s.

#### Per-card cache state — LOADING / FAILED + RETRY / READY

Each card that fetches a paginated cache surfaces three visible
states so the operator never sits on an ambiguous empty list:

| Card                | LOADING                            | FAILED + RETRY                              | READY                       |
| ------------------- | ---------------------------------- | ------------------------------------------- | --------------------------- |
| `PlaylistSwitcher`  | spinner + "Loading playlists from engine over LoRa…"  | red box + reason + RETRY pill | playlist chips with LIVE badge |
| `DeckCard` picker   | spinner + "Loading patterns from engine over LoRa…"   | red box + reason + RETRY pill | scrollable pattern list     |

The FAILED state is fed by two new store fields:

| Field | Set by | Cleared by |
| ----- | ------ | ---------- |
| `playlistLibraryError: string \| null` | `PlaylistSwitcher::refresh()` on abort | `PlaylistSwitcher::refresh()` on success |
| `patternListError: string \| null`     | `DeckCard::refreshPatterns()` on abort | `DeckCard::refreshPatterns()` on success |

Both errors are also reset by `bumpConnectGeneration()` so a fresh
connect always starts from a clean slate. A previous catalog (if any)
stays visible alongside a wire-log error message — we never replace
known-good data with a half-baked or empty list.

#### What App.tsx still owns

`App.tsx::onConnect` fires `HLO` followed by `qry engine/status`. The
HLO wakes the bridge's periodic publisher
(`self._publisher_wake.set()` in `bridge.py::_handle_frame`) which
broadcasts a fresh compact-status PUB toward us within tens of
milliseconds; the explicit `engine/status` qry is belt-and-suspenders
for the rare case the wake-up was lost. The compact-status reply
populates `engineStatus` with active pattern, blackout, autopilot,
view mode, lock owner, lease remaining, deck playlist name — every
field the ready-gate (#1–#5 above) needs.

The remaining hydration (playlists, patterns, params, exports) lives
in the cards because each card already owns its own parser and
reducer. App.tsx doesn't import any of them, which keeps
"add a new card that auto-loads on connect" a one-file change.

#### Hydration runs regardless of view mode

A freshly-connected PortWatch in mixer mode still loads the playlist
library, the active deck playlist, and that playlist's patterns. The
operator can preview the picker (greyed-out chips) without committing
to anything. If they then take the override, the cards are already
populated. The view-mode badge is a display-time gate, not a
load-time one.

#### Reconnect after a disconnect

`onDisconnect` calls `resetIntent()` which nulls `engineStatus`,
`patternList`, `playlistLibrary`, `deckPlaylist`, both errors, and
the loading flags. The next `onConnect` bumps `connectGeneration`,
the cards re-hydrate, and the ready-gate snaps back to `WAITING` →
the correct mode within ~1s of the eager PUB. No stale data ever
bleeds across sessions.

#### End-to-end tests for the wire half

These live in `control_podium/tests/test_comms_e2e_sim.py`:

| Test | Covers |
| ---- | ------ |
| `test_view_override_cmd` | `cmd view/deck` and `cmd view/clear` round-trip |
| `test_compact_status_surfaces_lock_and_playlist` | New `lk` / `lku` / `pl` fields in compact PUB |
| `test_view_renew_is_idempotent_take` | `cmd view/renew` extends the lease |
| `test_lock_lease_auto_expires` | Lease auto-clears when nobody renews |
| `test_hlo_triggers_eager_pub` | Bridge sends a fresh PUB on HLO |
| `test_connect_time_hydration_in_mixer_mode` | Bridge serves the full hydration set (status + playlists + deck/playlist + playlist-patterns) to a client connecting against a mixer-mode engine |
| `test_eager_pub_carries_full_ready_gate_payload` | The HLO eager-PUB MUST carry `vw`/`vov`/`lk`/`pl` so the ready-gate (§10.5) lights up the right state on the very first frame |
| `test_pattern_change_via_mixer_propagates`     | CaptainPad-style mixer-only pattern swap propagates to PortWatch in the next PUB (regression for the `/status.activePattern` vs `mixer.channels[].pattern` desync) |
| `test_compact_status_does_not_surface_target_channel` | Negative regression: the removed `tch` / `nch` / `chs` fields must NOT appear in any compact-status PUB (target-channel UX was removed May 2026 — see §10.14). |

### 10.6 Why expose this as a global parameter

Because there's nothing special about the deck override — it's the same
shape as blackout, autopilot, or `speed`. By tunnelling it through the
CPC / globals broadcast we get the same persistence, the same
hydration, the same fan-out, and the same UI-coordination guarantees
"for free". A future "muteRig" or "lockMixer" lock would follow exactly
the same pattern with no new infrastructure.

---

## 10.7 Compact-status field reference (PortWatch ↔ Bridge wire)

Every PUB the bridge sends to PortWatch is a comma-separated KV string
(see `compact_status` in `control_podium/comms/engine_client.py`). The
following fields drive the deck-card UI:

| Field | Source                                          | Purpose                                                                 |
| ----- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| `pat` | `mixer.channels[baseChannelId].pattern`         | Active pattern on the deck. **Reads from the mixer base channel, NOT `/status.activePattern`**, because CaptainPad's `POST /mixer/channels/:id/playlist/entry` swaps `ch.pattern` without touching the legacy `opts.pattern` — reading from `/status` would freeze PortWatch on whatever pattern was active when `/set-pattern` was last called. Regression-tested by `test_pattern_change_via_mixer_propagates`. |
| `pl`  | `mixer.channels[baseChannelId].playlist.name`   | Active deck playlist name. Drives the LIVE chip in `PlaylistSwitcher`; the chip prefers this over the one-shot `qry deck/playlist` reply so the badge populates from the very first PUB. |
| `plh` | `crc32(sorted(playlists.names).join(","))`      | 8-hex CRC32 of the playlist LIBRARY (sorted names). Drives PortWatch's playlist-library cache. Stable across engine restarts. `-` on empty / unreachable. Regression: `test_compact_status_surfaces_playlist_library_hash`. |
| `pph` | `crc32(active_playlist.entries.patterns.join(","))` | 8-hex CRC32 of the ACTIVE playlist's pattern names (entry order). Drives PortWatch's per-playlist pattern cache (§10.12). `-` when no playlist is on the deck. Regression: `test_compact_status_surfaces_playlist_patterns_hash`. |
| `vw`  | `mixerState.viewMode` (`deck` / `mixer`)        | Engine view mode. Drives the ready-gate (§10.5). |
| `vov` | `mixerState.viewOverrideActive`                  | Whether the operator is currently holding the deck override. |
| `lk`  | `globalsState.controlLock` owner                | `-` if free, otherwise owner name (`portwatch`). |
| `lku` | Engine-computed lease remaining (s)             | Seconds until the lease auto-expires if not renewed. |
| `sp`, `dr`, `ct`, `sz`, `rt` | CPC scalars (`speed`, `direction`, `count`, `size`, `rotate`) | Full CPC scalar set, compact-float encoded. PortWatch lifts these off the same PUB and merges into `globalParams` so CaptainPad nudges surface within ~PUB cadence (not the 5 s poll cadence). Omitted (not nulled) when the engine doesn't have the param registered. |
| `p1`, `p2` | CPC `colorPalette1` / `colorPalette2` | HSV triple as `<h>-<s>-<v>` (compact floats). Same propagation path as the scalars. |

All of these arrive on the eager PUB the bridge fires on every HLO
(`_handle_frame` in `bridge.py`), so PortWatch's ready-gate (§10.5)
and the deck card both have everything they need to render correctly
within ~100 ms of the BLE pair settling — no extra qrys required.

When CaptainPad changes any of these (e.g. swaps a playlist, picks a
different deck pattern, takes the deck view), the engine fires a
`mixer` or `viewOverride` WS event, the bridge subscriber wakes the
publisher, and the next compact PUB carries the new values out to
PortWatch automatically.

### 10.8 Serial-load gate (playlists → patterns)

`PlaylistSwitcher.refresh()` and `DeckCard.refreshPatterns()` used to
both auto-fire on `connectGeneration` — meaning right after a BLE
pair, PortWatch would kick TWO multi-page `qry` flows over LoRa
concurrently. On a half-duplex radio with `~200B` MTU and ~280 ms
per-page airtime that meant:

* Two pending acks → ack collisions.
* Two pending `rep` streams → the second one queues behind the first.
* `patterns.page_timeout_ms` (12 s default) starts firing on whichever
  stream got queued, even though everything was actually working —
  it just couldn't beat the other stream to a free transmit slot.

The store now owns a `playlistsHydratedForConn` sentinel
(`control_podium/PortWatch/src/state/store.ts`):

* `PlaylistSwitcher.refresh()` writes it in its `finally` block
  (so a transient LoRa failure on the playlists query still
  releases the gate — the operator can then tap REFRESH on the
  picker to recover).
* `DeckCard`'s patterns-hydration `useEffect` waits for
  `playlistsHydratedForConn === connectGeneration` before firing.
* `bumpConnectGeneration` resets the sentinel to 0 on every
  reconnect so the new session starts the serial sequence from
  scratch.

Net result: **playlists hydrate first, patterns hydrate second**,
back-to-back, no contention. Combined with the LoRa BW bump
(§13.4) this is what eliminated the "playlists failed · timeout /
patterns failed · timeout" double-failure operators were seeing.

### 10.9 Intent reconciliation (the "CaptainPad change vanishes" fix)

**Problem.** When the operator taps a control on PortWatch (pattern,
playlist, blackout, autopilot, etc.) the store immediately records an
"intent" so the UI snaps to the new value optimistically (without
waiting for the BLE → LoRa → engine → LoRa → BLE round trip). The
intent is later reconciled against the engine's authoritative value
via `setEngineStatus`.

Before the fix the reconciliation rule was just:

> If the intent value equals the engine value, drop the intent.

This was correct for the happy-path round trip but it left a critical
gap: if CaptainPad changed the same value AFTER the bridge ACK'd our
PortWatch write (e.g. operator on PortWatch taps playlist A,
ACK lands, then CaptainPad swaps to playlist B), the engine state moves
to **B** but PortWatch's intent stays pinned to **A**. Every subsequent
PUB carrying `pl/B` was ignored because `B !== A`, and the `LIVE` chip
stuck on A indefinitely. Users reported this as *"vibration arrives,
UI doesn't update"* for both pattern and playlist swaps.

**Fix.** The reconciliation rule now leverages the `pending` flag,
which the bridge ACK callback (`markIntentResolved`) flips from `true`
to `false` once the engine has been heard from:

```
intent absent                            → drop  (nothing to do)
engine value null                        → keep  (no signal yet)
engine == intent (regardless of pending) → drop  (matched)
engine != intent, pending=true           → keep  (optimistic phase)
engine != intent, pending=false          → drop  (engine wins —
                                           our write completed, the
                                           mismatch means a
                                           concurrent writer
                                           clobbered us; defer.)
```

Implemented in `src/state/intent.ts::reconcileIntent` (5-line pure
function, unit-tested in `src/state/intent.test.ts` — 7 cases
covering the full decision table + the end-to-end lifecycle).
Applied uniformly in `setEngineStatus` for every single-value intent:
`blackout`, `autopilot`, `autopilotInterval`, `brightness`,
`activePattern`, **`deckPlaylist`** (previously missed), `viewOverride`.

> Bridge ACKs are sent only AFTER `_exec_cmd` awaits the engine HTTP
> call (`bridge.py::_handle_cmd`), so `pending=false` is a strong
> "engine has heard us" signal. Once that's true, every subsequent
> PUB is the canonical truth and the optimistic intent loses its
> purpose.

### 10.10 Playlist library cache (`plh`)

PortWatch's playlist library lives in two places:

* **Authority:** the engine, fetched via `qry engine/playlists` (N
  pages over LoRa, can be ~3-5 s on a slow link).
* **Cache:** `store.playlistLibrary` + `store.playlistLibraryHash`,
  populated atomically by `setPlaylistLibrary(library, hash)`.

Every compact PUB carries `plh/<8-hex-char>` (CRC32 of the sorted
names list). The refresh flow now reads:

```
PlaylistSwitcher.refresh({ force? }):
  if !force AND engine.plh != null
              AND engine.plh == cache.hash
              AND cache.library non-empty:
      → cache HIT: skip ALL LoRa pages, open the serial gate
                   for the patterns hydration immediately.
  else:
      → cache MISS: do the full multi-page fetch, then
                   setPlaylistLibrary(library, engine.plh).
```

The cache survives BLE disconnect / reconnect within a single app
session (V1 — AsyncStorage persistence is a follow-up). The hash
is engine-side stable across restarts because it's a pure function
of the names list.

**Cache invalidation.** Three engine WS events now wake the bridge
publisher (in addition to the existing `pattern` / `mixer` /
`autopilot` / `viewOverride`):

* `playlistLibrary` — fires on bulk reload (engine startup, file
  watcher).
* `playlistSaved` — fires when a playlist is created or updated.
* `playlistDeleted` — fires when a playlist is removed.

Each one triggers a fresh `compact_status` PUB within a few hundred
ms; the new `plh` lands; PortWatch's cache-hit check fails on the
next refresh and the operator gets fresh data.

**Manual REFRESH bypasses the cache** (`refresh({ force: true })`)
because the operator tapping a button literally labelled REFRESH
wants a real round-trip, usually because they suspect something's
stale.

Regressions covered by `test_compact_status_surfaces_playlist_library_hash`:
hash appears, is stable across PUBs when nothing changes, and
**changes** when a playlist is added/removed.

### 10.11 Sync architecture: dual-path (PUB broadcast + 5 s polling)

**The lesson:** broadcast alone is not enough.

The bridge has always pushed `compact_status` PUBs to PortWatch on a
periodic + event-driven cadence (see `bridge.py::_status_publisher`
and `_engine_ws_subscriber`). On a wired network that's enough. On
BLE + LoRa, single-frame drops are routine:

* iOS can silently swallow a BLE characteristic notification under
  load (the app's monitor callback simply doesn't fire — no error).
* The half-duplex LoRa radio drops PUBs during contention (operator
  hammering, CaptainPad streaming params, pattern paging).
* One dropped PUB leaves `engineStatus` stale until the next event.
  If the engine is quiet that can be tens of seconds.

The user-visible symptom: *"I changed something on CaptainPad and
PortWatch doesn't reflect it."* Specifically pattern and (after the
cache landed) the playlist library hash were broadcast-only, so a
single PUB drop made them look frozen.

**Fix: add a second, independent sync path — 5 s polling.**

PortWatch unicasts three queries on a fixed cadence (status / globals
default 5 s, local exports default 10 s, all tunable via
`.config.portwatch.yaml::polling.*`):

| Hook                          | Query                  | Refreshes                                                                 |
| ----------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `useStatusPoller`             | `qry engine/status`    | The entire compact_status snapshot: `pat`, `pl`, `plh`, `pph`, `vw`, `vov`, `lk`, `lku`, `ap`, `apd`, `aps`, `sp`, `dr`, `ct`, `sz`, `rt`, `p1`, `p2`, `br`, `blk`, … |
| `useGlobalParamsPoller`       | `qry params/snapshot`  | `speed`, `direction`, `count`, `size`, `rotate`, `palette1`, `palette2`. Now a backstop — the same fields ride on every compact-status PUB. |
| `useLocalExportsPoller`       | `qry exports/p/<n>`    | Per-pattern WASM sliders. Catches the case where CaptainPad nudges a slider WITHOUT changing the active pattern (the pattern-change auto-refresh path wouldn't fire). Paginates; partial-page failures abort the tick without writing partial data. |

Both pollers:

* Fire the first poll **immediately** on `connectGeneration` bump
  (no 5 s wait after pairing).
* Maintain a single in-flight guard — overlapping qrys are skipped,
  not stacked.
* Are best-effort — failures fall through silently and the next tick
  tries again.
* Pause while disconnected; restart cleanly on every successful pair.

The REP from `qry engine/status` flows through the existing
`App.tsx::onWireEvent` routing (REPs containing `pat/` or `dn/` go
to `setEngineStatus`), so no new plumbing was needed. The
GlobalParamsPoller parses the snapshot via `parseGlobalParamsSnapshot`
and pushes through `setGlobalParams` directly.

**How the two paths interact:**

* **PUB (event-driven, broadcast)** — *fast path*. Engine WS event
  → bridge subscriber wakes publisher → broadcast PUB arrives in
  ~hundreds of ms when nothing drops. Includes the eager PUB the
  bridge fires on every HLO ACK.
* **POLL (cadence-driven, unicast)** — *reliable path*. Even when
  every PUB in a 4 s window dropped, the next poll's REP rebuilds
  `engineStatus` end-to-end.

As a consequence we **bumped the bridge's `short_interval_s` from
5 s to 15 s** (`.config.bridge.yaml::status_publish`). With polling
as the reliable backstop, the periodic broadcast loop only needs to
be a sanity check against a wedged WS subscriber. The WS-wake PUB
remains as the low-latency fast path; we just stopped re-broadcasting
the same snapshot every 5 s when polling already covers the gap.

**Coverage:**

* `test_polling_picks_up_pattern_and_playlist`
  (Python e2e) — disables all PUBs, mutates pat/pl on the
  FakeEngine, asserts the very next poll's REP carries both.
  Also negatively asserts that the removed `tch`/`nch`/`chs`
  fields are absent from the wire.
* `test_polling_carries_playlist_library_hash_for_cache`
  (Python e2e) — same setup, proves `plh` arrives via polling so
  the cache can warm up even without PUBs.
* `createStatusPoller` (vitest, 7 cases) — first-poll-on-start,
  per-interval ticks, in-flight skip, stop() cancellation, null
  link no-op, sendOp failures don't crash, double-start guarded.

**Cache closure fix:** the playlist-library cache had a latent bug
where `setPlaylistLibrary(library, engineLibraryHash)` was capturing
the value of `engineLibraryHash` from the `useCallback` closure —
which on the very first connect was `null` (PUB hadn't landed yet
when `refresh()` was created). The result: the cache stored the
library but a `null` hash, so every subsequent reconnect saw
`cachedHash === null` and re-fetched. Fixed by reading via
`useAppStore.getState().engineStatus?.playlistLibraryHash` at the
moment of writing, not at the moment of hook creation. Added an
auto-rehydrate effect that fires `refresh({ force: true })` when
`engineLibraryHash !== cachedHash`, so library mutations server-side
get picked up automatically (no need to tap REFRESH).

### 10.12 Per-playlist pattern cache (`patternsByPlaylist`)

Pattern catalogues are scoped to the currently-loaded playlist, and
PortWatch keeps a per-playlist cache so revisits over a session
(reconnect, swap-and-back) cost zero LoRa frames in the common case.

**Cache key:** playlist NAME (from `engineStatus.deckPlaylistName`).
**Cache entry:** the cached `PatternList` PLUS the engine-reported
`pph` (playlist patterns hash, §10.7) that was current at fetch
time.

**Lookup is hash-validated:** a cache HIT requires (a) a cached
entry for the active playlist name, (b) a non-null cached hash,
(c) a non-null `playlistPatternsHash` on the latest PUB, AND
(d) byte-identical hashes. Any failure of those is a MISS — the
paginated multi-page fetch runs and re-seeds the cache with the
fresh hash. The lastReply banner explicitly says HIT / MISS so the
operator can tell whether a load is paying for the LoRa hop or
serving from RAM.

**Cache survival:** the map AND each entry's hash survive BLE
disconnect / reconnect within a single app session — hash
validation against the next PUB is what makes a reconnect-after-
external-edit safe, so wiping on disconnect was strictly worse.
Lost on app kill (V1 in-memory only; AsyncStorage is a follow-up).

**Manual REFRESH bypasses the cache** because an operator tapping
a button literally labelled REFRESH wants a real round-trip.

**Playlist switch flow:** `PlaylistSwitcher.onSelect` issues an
explicit `qry engine/status` after the playlist-change ack and
BEFORE the chained `refreshPatterns`, so the cache check sees the
NEW playlist's `pph` (not the OLD one's, still stale on the local
`engineStatus` until the next periodic PUB).

Detailed implementation, file map, and the partial-merge logic for
the wire layer is in
`.agent/02_reports/202605/20260516_1_port_watch_impl.md` §13.1.

Coverage:

* `patternsByPlaylist cache` vitest suite — atomic write, single-
  key invalidation, full-map invalidation, **cache survives
  resetIntent**.
* `test_compact_status_surfaces_playlist_patterns_hash` Python
  e2e — pph wire shape, stability while contents are unchanged,
  invalidation on playlist swap, `-` sentinel when no playlist.
* `test_playlist_patterns_query_returns_same_data_on_repeated_calls`
  — wire-side determinism (same name → same reply) so the cache's
  key invariant holds.

### 10.13 GlobalParams / LocalExports reconciliation

The CaptainPad → PortWatch sync uses the same decision table we apply
to `engineStatus` (§10.9):

| condition                              | action               |
| -------------------------------------- | -------------------- |
| no engine signal                       | keep intent          |
| intent agrees with engine              | DROP intent          |
| intent disagrees AND intent.pending    | KEEP (optimistic UI) |
| intent disagrees AND !intent.pending   | DROP (engine wins)   |

Two important wrinkles ride on top of this base rule:

* **Partial-merge for PUB-driven globals.** `setGlobalParams` is
  called both from the polled snapshot (full) and from the
  compact-status PUB lift (sparse — only the keys the engine
  reported this tick). The setter MERGES rather than overwrites,
  preserving previously-known values for fields not reported this
  tick. Intent reconciliation is gated to fields the engine
  REPORTED this tick, so a sparse PUB doesn't drop intents on
  fields that came from a previous merge.
* **WS-wake on `sharedParams`.** The bridge's
  `_is_relevant_ws_event` filter includes `sharedParams` so a
  CaptainPad CPC nudge triggers an immediate compact-status
  republish (~hundreds of ms latency) instead of waiting for the
  next periodic tick.

Together, the two paths give PortWatch's global-params card
sub-second reflection of CaptainPad changes, with the 5 s
polling backstop covering any PUB drops.

Detailed wire trace and file-level changes live in
`.agent/02_reports/202605/20260516_1_port_watch_impl.md` §13.2.

### 10.14 Target-channel removal (2026-05)

PortWatch shipped a `TargetChannelPicker` chip group above the
playlist switcher and a REFRESH button next to it. The idea was
to mirror a CaptainPad concept where the deck card could "target"
either the deck base channel or any mixer channel. After dogfooding
we removed it for three reasons:

1. **Playlists already cover the same use case.** Switching
   playlists swaps the deck's active content, which is what the
   operator actually wanted when they were tapping channel chips.
2. **V1 was view-only and confusing.** Non-LIVE chips greyed out
   with a "coming soon" toast — operators reasonably expected the
   chip to do something on tap. Polling exposed every chip
   reliably; tapping did nothing useful.
3. **It cost LoRa air time.** The `tch` / `nch` / `chs` fields
   shipped on every compact-status PUB, capped at 8 channels × 8
   chars per name. Removing them shrinks the PUB payload back to
   essentials for the slow path.

What's gone:

* `TargetChannelPicker` component (and its `targetChannelBox` /
  `targetChannelLabel` / `targetChannelValue` styles) — deleted
  from `control_podium/PortWatch/src/ui/DeckScreen.tsx`.
* `targetChannelName` / `channelCount` / `channelNames` fields on
  `EngineStatus` — deleted from
  `control_podium/PortWatch/src/status/parse.ts`. The
  `tildeListOrNull` helper that only existed to parse `chs` is gone
  too.
* `tch` / `nch` / `chs` fields on the bridge wire — deleted from
  `control_podium/comms/engine_client.py::compact_status`. The
  `CH_NAMES_MAX` / `CH_NAME_LEN_MAX` constants and the per-name
  sanitisation loop are gone with them. The `base_ch` discovery
  loop stays (we still need it for `pat` and `pl`).
* `state["base_channel_name_override"]` test escape hatch in
  `control_podium/tests/test_comms_e2e_sim.py::FakeEngine` —
  removed; the base channel name is now hard-coded to `DECK MAIN`
  for the few tests that still read it.
* `test_target_channel_change_via_mixer_propagates` and the
  positive `test_compact_status_surfaces_target_channel` —
  replaced by a single **negative regression**
  `test_compact_status_does_not_surface_target_channel` that
  fails if the wire ever ships those fields again.
* `setMixerView(view, deckChannel?)` second argument in
  `CaptainPad/utils/api.ts` — removed. The deck is always bound
  to its base channel; `setMixerView('deck')` is all you get.

Today the deck is **always** wired to the mixer base channel. If
the operator wants different content there, they switch the
active playlist via the playlist switcher.

---

## 11. CaptainPad Sync (How PortWatch Writes Show Up Live)

PortWatch's writes go bridge → engine → WS broadcast → CaptainPad UI.
Three live-state surfaces matter, and CaptainPad now reads all three
through a single centralised hook so adding a new one doesn't mean
re-plumbing every component:

| Surface              | Engine event           | CaptainPad consumer                            |
| -------------------- | ---------------------- | ---------------------------------------------- |
| CPC global params    | `sharedParams`         | `useSharedParamValues()` → `CPCControls`        |
| Local pattern exports| `mixer` (channel.exports include v0/v1/v2) | `useChannelExports(channelId)` → `GlobalParams` deck/mixer variants |
| Deck override        | `viewOverride` (controlLock field) | `useEngineLock()` → `EngineLockoutOverlay` |

The hook (`CaptainPad/hooks/useEngineState.ts`) subscribes to
`engineEvents` *once* at module load and seeds itself from
`/param-center` + `/mixer` on first read. Tab focus changes don't cycle
the subscription, and the deck/mixer tabs both already fan their WS
messages through `engineEvents.emit()`, so any new mirror-this-state
component just calls `useEngineState()` / `useSharedParamValues()` /
`useChannelExports()` and gets re-renders for free.

This replaces an earlier per-component pattern that bound
`wsRef.current.addEventListener('message', …)` inside `useEffect` and
broke whenever (a) the WS hadn't connected yet at mount or (b) the
auto-reconnect loop replaced the WS instance. Both failure modes are
gone — there's no per-component WS plumbing left to break.

---

## 12. Configuration files (firmware + app)

PortWatch shares the project-wide convention that **every tunable**
lives in a committed YAML next to the code that consumes it. There
are no magic numbers in TS or C — both surfaces source their values
from YAML at build time.

| File                                                  | Consumer                          | Generator / Loader                                     | Local override (gitignored)                            |
| ----------------------------------------------------- | --------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `control_podium/.config.nodes.yaml`                   | Bridge ACL + firmware BLE name    | `firmware/deploy.py::load_nodes()` (build flags)       | n/a                                                    |
| `control_podium/.config.bridge.yaml`                  | Bridge runtime + companion        | read by `bridge.py`                                    | n/a                                                    |
| `control_podium/.config.commands.yaml`                | Bridge ACL + per-cmd metadata     | read by `bridge.py`                                    | n/a                                                    |
| `control_podium/.config.firmware.yaml`                | Heltec firmware (LoRa / BLE / OLED / power profile) | `firmware/deploy.py::load_radio_flags()` (build flags) | `control_podium/.config.firmware.local.yaml`           |
| `control_podium/PortWatch/.config.portwatch.yaml`     | PortWatch (paging, lease, BLE)    | `scripts/sync-config.mjs` → `src/_generated/config.generated.ts` | `control_podium/PortWatch/.config.portwatch.local.yaml` |

### 12.1 Firmware config (`.config.firmware.yaml`)

Drives BOTH the server and the client firmwares — `deploy.py` reads
the YAML, renders it into `PLATFORMIO_BUILD_FLAGS`, and runs
`pio run`. Every consuming firmware header has a matching
`#ifndef KEY / #define KEY default / #endif` block so a missing YAML
key falls back to a safe default rather than failing the build —
default values in C MUST mirror the YAML or silent drift is the
result.

Sections live under five top-level keys:

- `radio:` — LoRa freq, BW, SF, CR. SX1262 defaults are 915 MHz / 250
  kHz / SF7 / CR 4/5 (US ISM).
- `ble:` — passkey rotation age (10 min idle), bond-clear hold (5 s).
- `oled:` — 3-stage screen lifecycle (ACTIVE → DIM → OFF) timings.
- `battery:` — sample cadence, warn / shutdown voltages.
- `power_profile:` — client HIGH/LOW BLE+LoRa TX power, fast-idle
  drop-back timeout. The server controller is built with
  `-DPWR_PIN_HIGH=1` (emitted automatically when `role: server`
  in `nodes.yaml`) so it stays pinned to HIGH — see §13.

Per-developer overrides: drop a `.config.firmware.local.yaml` next to
the committed file and `deploy.py` will deep-merge it on top of the
committed defaults. Only the keys present in the override take effect;
everything else falls through. Useful for `debug.pin_high_forever:
true` when bench-testing range without a phone in the loop.

### 12.2 PortWatch config (`.config.portwatch.yaml`)

Driven by `scripts/sync-config.mjs` which writes a typed `as const`
TypeScript module to `src/_generated/config.generated.ts`. Consumers
import from `src/config/index.ts`:

```ts
import { CFG, lease, patterns } from "../config";

setInterval(renew, CFG.lease.renew_interval_ms);
const maxPages = patterns.max_pages;
```

The sync script runs automatically before every `expo start`, `expo
run:ios`, `expo prebuild`, and every EAS build profile (see
`package.json` `prestart` / `preios` / `preprebuild` / `preeas:*`
hooks chained through `npm run sync-all`). It's also wired into
`postinstall` so `npm install` always produces a buildable tree.

Sections live under six top-level keys:

- `lease:` — controlLock renew cadence + low-water defensive renew.
- `patterns:` — deck pattern-picker paging budget (max pages, retry
  count, per-page timeout, backoff).
- `exports:` — same shape, tuned tighter for per-pattern parameter
  fetches.
- `logs:` — UI log ring-buffer cap.
- `ble:` — connection MTU, connect timeout, RSSI poll cadence,
  state-probe timeout.
- `layout:` — UI sizing.

Per-developer overrides: `.config.portwatch.local.yaml` next to the
committed file. Today the sync script doesn't deep-merge — local
overrides are a planned addition behind `sync-config --merge-local`;
for now, dev tweaks can be made directly to the committed file under
a feature branch.

---

## 13. Firmware power profile (HIGH / LOW)

A field-observed problem: a battery-powered client controller sitting
idle would let its BLE/LoRa link degrade noticeably between commands;
pressing the PRG button or sending a fresh BLE write would "wake it
up". Root cause: BLE TX was pinned at +3 dBm (`ESP_PWR_LVL_P3`) and
LoRa TX was a compile-time constant — no runtime profile, so the iOS
side's adaptive connection-interval pacing would slowly back off and
the perceived latency would climb without anything to bump it.

The fix is a two-state profile (`titanic_pwr.h`):

| State | BLE TX                          | LoRa TX                         | SF             | When                                                                                |
| ----- | ------------------------------- | ------------------------------- | -------------- | ----------------------------------------------------------------------------------- |
| HIGH  | `PWR_BLE_TX_DBM_HIGH` (+9 dBm)  | `PWR_LORA_TX_DBM_HIGH` (+22)    | `SF` (7)       | Boot, BLE connect, BLE write, PRG button press                                       |
| LOW   | `PWR_BLE_TX_DBM_LOW` (+3 dBm)   | `PWR_LORA_TX_DBM_LOW` (+14)     | `PWR_LORA_SLOW_SF` (default 7; bump to 9 in YAML to favor range) | After `PWR_FAST_IDLE_MS` (60 s) of no triggers |

### 13.1 Trigger rules

- `titanic_pwr_bump()` is called from:
  - `_BLEServerCB::onConnect` — operator just paired a phone.
  - `_BLECmdCB::onWrite` — phone sent a real command.
  - PRG button press handler in `titanic_common.h::titanicDisplayUpdate`.
- LoRa RX **does not** trigger a bump. A packet from another client
  shouldn't light up the whole mesh; we only ramp when WE are the
  ones with outbound work.
- `titanic_pwr_loop()` runs every loop iteration and drops back to
  LOW if `millis() - lastBumpMs >= PWR_FAST_IDLE_MS`. Cheap (one
  compare).

### 13.2 Server pinning

The server controller (role=server in `nodes.yaml`) is USB-powered;
any added latency on a relay between bridge ↔ deck ↔ client meshes
is unacceptable. `deploy.py::load_radio_flags(role="server")` emits
`-DPWR_PIN_HIGH=1`, and `titanic_pwr.h` short-circuits every API call
to a no-op on that build. Defence in depth: `titanic_pwr_setup()`
also checks the `role` string (`"SERVER_RX"`) and force-pins if the
build flag was somehow lost. The OLED RADIO page displays the live
mode as `HIGH` / `LOW` / `HIGH*` (asterisk = pinned).

### 13.3 Tuning

Edit `.config.firmware.yaml::power_profile` and re-deploy. Useful
adjustments:

- Larger venue, weak link: bump `lora_tx_dbm_low` toward 22 (so even
  idle clients can still reach the bridge) and / or set
  `lora_slow_sf: 9` (slower but ~2× range).
- Bench testing: drop `fast_idle_ms` to 5000 to make the HIGH→LOW
  transition observable without waiting a minute, or add
  `debug.log_mode_transitions: true` for serial `PWR: HIGH/LOW`
  lines on every flip.
- Range walks: `debug.pin_high_forever: true` in
  `.config.firmware.local.yaml` (NOT committed) — pins the client to
  HIGH for the duration of the test without affecting team builds.

### 13.4 LoRa bandwidth bump (250 → 500 kHz)

The default `radio.bandwidth_khz` in `.config.firmware.yaml` is now
**500 kHz** (was 250 kHz). At SF7 / CR4-5 this ~doubles the symbol
rate (≈ 10.9 kbps vs 5.5 kbps), which directly halves the airtime
per `rep` paging frame. Combined with the serial-load gate (§10.8),
the per-page timeout pressure on `qry engine/playlists` and
`qry engine/playlist-patterns` drops by ~3-4× in practice.

Trade-off: BW500 has ~3 dB less sensitivity than BW250, so the
deck-to-stage line-of-sight range at +22 dBm drops from ~600 m to
~300 m. This is fine for every real venue we deploy to today
(deck and rig are within ~100 m line-of-sight), and any future
hostile-RF environment can revert by adding to a per-machine
override:

```yaml
# control_podium/.config.firmware.local.yaml  (NOT committed)
radio:
  bandwidth_khz: 250.0
```

After flashing the new BW you MUST reflash BOTH ends of every LoRa
link (server controller + every client) — a 500 kHz transmitter
talking to a 250 kHz receiver simply doesn't decode.

### 13.5 Test coverage

`firmware/deploy.py --node 0x01 --build-only` exercises the YAML →
build-flag → C-header pipeline end-to-end for the server (PWR_PIN_HIGH
on); `firmware/deploy.py --node 0x0A --build-only` does the same for
a client (PWR_PIN_HIGH off). Both link cleanly with the new
`titanic_pwr.h` and the YAML values surface in the build log under
`PLATFORMIO_BUILD_FLAGS=…`. The 500 kHz BW is also visible there as
`-DBANDWIDTH=500.0`.

---

## 14. References

- `07_control_podium.md` — LoRa mesh, Titanic Frame v2, AEAD, the full
  role/ACL story, bring-up plan.
- `12_marsin_engine.md` — engine WS event catalog, including
  `sharedParams`, `mixer`, `viewOverride`, and how PortWatch / CaptainPad
  consume each.
- `15_central_param_center_cpc.md` — CPC architecture, the
  `controlLock` global, how to add a new global parameter end-to-end.
- `16_captain_pad.md` — CaptainPad's tab structure, navigation rail,
  master-detail UX rules. Now also covers the lockout overlay PortWatch
  triggers.
- `control_podium/.config.nodes.yaml` — node id ↔ name ↔ role ↔ USB
  MAC mapping; source of truth for BLE advertised name.
- `control_podium/.config.commands.yaml` — the radio command allowlist;
  the contract between PortWatch and the bridge.
- `PortWatch/src/ble/` — the BLE link layer.
- `PortWatch/src/codec/` — Titanic Frame v2 encode/decode.
- `marsin_engine/secret.yaml` — the AEAD key. Single source of truth
  across firmware, bridge, and PortWatch. **Never commit.**
- `control_podium/PortWatch/README.md` — bring-up, EAS / TestFlight /
  App Store deployment, troubleshooting, security notes. Read this
  before doing anything to PortWatch.
