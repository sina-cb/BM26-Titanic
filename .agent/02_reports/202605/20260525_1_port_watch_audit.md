# PortWatch / Server Bridge / LoRa Control System Audit

This audit report extracts ground-truth facts from the BM26-Titanic codebase to document its protocol, sync logic, power profiles, deployment, and security vulnerabilities.

---

## 1. Current Frame v2 Wire Format

The Frame v2 protocol uses an authenticated-encryption-associated-data (AEAD) wire layout designed to prevent manipulation and eavesdropping.

### Exact Frame Layout
Frames are transmitted as single, newline-terminated ASCII lines with fields delimited by the pipe character (`|`):
```text
T2|<src>|<dst>|<seq>|<typ>|<flags>|<ctr>|<body>|<tag>
```
* **Magic Version (`T2`)**: Constant wire magic prefix identifying v2 secured frames. (See [secure.py](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/comms/secure.py#L50) and [codec.ts](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/PortWatch/src/crypto/codec.ts#L33)).
* **`<src>`**: 2-character lowercase hex representing the source node ID (values `00`..`fe`). Node `0x00` is reserved; `0x01` is the bridge server.
* **`<dst>`**: 2-character lowercase hex representing the destination node ID, or `ff` for broadcast.
* **`<seq>`**: 2-character lowercase hex representing the sequence number (`00`..`ff`), incremented modulo 256 per request.
* **`<typ>`**: 3-character ASCII frame type (e.g., `ack`, `nak`, `qry`, `rep`, `pub`, `hlo`, `pin`, `pon`).
* **`<flags>`**: 1 hex digit representing a 4-bit flags bitmask:
  * `0x1`: `FLAG_ACK_REQUESTED`
  * `0x2`: `FLAG_PRIVILEGED`
  * `0x4`: `FLAG_RETRY`
* **`<ctr>`**: 12-character lowercase hex representing a 48-bit big-endian per-sender counter.
* **`<body>`**: `base64url` no-pad encoding of the ciphertext. If there is no plaintext, this contains a single dash `-`.
* **`<tag>`**: 32-character lowercase hex representing the 16-byte (128-bit) GCM tag.

### AAD Fields
The Associated Data (AAD) is the exact cleartext header through `<ctr>` (excluding any trailing pipe):
```text
T2|<src>|<dst>|<seq>|<typ>|<flags>|<ctr>
```
This is encoded as ASCII bytes and passed to the AES-GCM engine to ensure header integrity. (See [secure.py](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/comms/secure.py#L213-L217) and [codec.ts](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/PortWatch/src/crypto/codec.ts#L220-L228)).

### Nonce Construction
The nonce is a 12-byte array composed of:
```text
src(1 byte) || 0x00 × 5 (5 bytes) || ctr_be(6 bytes)
```
Disjoint nonce spaces are structurally guaranteed because each node is assigned a unique single-byte `src` ID. (See [_make_nonce](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/comms/secure.py#L320-L327) and [makeNonce](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/PortWatch/src/crypto/codec.ts#L134-L152)).

### Wire Metadata Questions
* **TAG_BYTES**: 16 bytes (128-bit tag). Hex-encoded as 32 characters on the wire.
* **CTR_BYTES**: 6 bytes (48-bit monotone counter). Hex-encoded as 12 characters on the wire.
* **key_id field**: None. The key is pre-shared and implicitly matched.
* **TTL field**: None. Refresh and timeout logic are handled entirely by application pollers.
* **Binary formats**: No binary format exists on the wire. Plaintext frames are ASCII, and secured v2 frames are serialized entirely into ASCII (via hex and base64url) to survive firmware and serial line limitations.

### Replay Protection Logic
Managed by [ReplayWindow](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/comms/replay.py#L58):
1. **First contact**: The first frame seen anchors `highest_ctr` to that frame's counter and marks the corresponding bit.
2. **Strictly newer**: If `ctr > highest_ctr`, the bitmap shifts right by `shift = ctr - highest_ctr` bits (capped at 64), `highest_ctr` updates to `ctr`, and the bottom bit is set to 1.
3. **In-window**: If `ctr` is in `[highest_ctr - 63, highest_ctr]`, the offset bit in the 64-bit bitmap is checked. If set, it is rejected as `REPLAY_DUP`. If unset, the bit is filled and the frame is accepted as `OK_REORDER`.
4. **Too old**: If `ctr < highest_ctr - 63`, it is rejected as `REPLAY_TOO_OLD`.
5. **Re-anchor**: An `hlo` frame can reset `highest_ctr` to the incoming counter if the counter drops by at least `1 << 32` (`DEFAULT_REANCHOR_DROP`).

---

## 2. Counter / Nonce Persistence

### Client Counter Storage
In PortWatch, `this.counter` is managed by `DurableCounter` (implemented in [counterStore.ts](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/PortWatch/src/security/counterStore.ts)) using Expo SecureStore. To avoid writing to storage on every single send, PortWatch uses a block reservation system of 1024 values:
1. On first install, it seeds a random 48-bit counter (using `crypto.getRandomValues`).
2. It writes `nextCtr + 1024` to SecureStore, reserving a block of 1024 counters.
3. Counters are consumed sequentially from memory.
4. When the block is exhausted, the next block is reserved in SecureStore.
5. On app restart, a new `DurableCounter` is instantiated and resumes from the next block (the previously written value), ensuring counters never step backward or repeat.

### Bridge/Server Counter Storage
The server-side bridge instantiates `ReplayWindow` in memory only (stored on the `RadioPort` instance). It is **not persisted** to disk.

### Lifecycle Impacts & Resolved Defect
* **App Restart**: PortWatch instantiates a new `DurableCounter` which loads the next reserved counter block start from SecureStore, guaranteeing it is strictly greater than any previously used counter value. This completely resolves the Critical restart lockout defect.
* **Firmware Flash**: Firmware is a dumb relay; flashing has no impact on counters.
* **Bridge Restart**: Wipes `ReplayWindow._sources` from memory. The next client frame will successfully anchor a fresh counter window.
* **Secret Rotation**: Rebuilds the Codec and restarts the counter from a new random seed.

### Tests
Unit tests in `counterStore.test.ts` verify the durable counter seeding, block reservation, and distinct namespace separation. The Python comms test `test_comms_replay.py` has been updated with `test_simulated_durable_counter_restart` to verify that simulated app restarts with durable counters are successfully accepted by the bridge replay window while replayed older frames are rejected.

---

## 3. Profile Switching

LoRa parameters (bandwidth, spreading factor, coding rate, TX power) are switched at runtime via raw ASCII side-channel lines.

### Code Paths & Wire Format
* **Format**: Plain ASCII line:
  ```text
  *CFG name=<name> sf=<7-12> bw=<62|125|250|500> cr=<5-8> hi=<dbm> lo=<dbm> t=<delay_ms>
  ```
* **Emitter**:
  * Python bridge: [bridge.py::request_profile_change](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/comms/bridge.py#L262) sends the command over serial using `RadioPortSerial.send_raw_line()` (bypassing the codec).
  * PortWatch UI: `StatusScreen.tsx`'s `ProfilePicker` calls `POST /profile` on the bridge, triggering a profile change.
* **Acceptor**:
  * Firmware: Intercepted in [titanic_profiles.h::titanic_profile_handle_cfg_line](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/firmware/src/titanic_profiles.h#L353).
  * If received over serial (locally), the firmware schedules the switch and echoes the `*CFG` payload over LoRa so the other peer nodes switch. If received over LoRa (remotely), it schedules the switch but does not echo (preventing echo loops).

### Security Posture & Vulnerabilities
* **No Authentication on raw LoRa *CFG**: The `*CFG` line is plaintext and **bypasses GCM verification**.
* **Production Status (Gated)**: Gated via the compile-time flag `ALLOW_PLAINTEXT_PROFILE_CFG` in [titanic_profiles.h](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/firmware/src/titanic_profiles.h). By default, it compiles to `0` in production configurations, forcing the firmware to reject unauthenticated LoRa-originated `*CFG` profile changes. Plaintext profile switching can be optionally allowed for bench/dev testing using build configuration overrides.
* **Bridge `/profile` Gated**: The bridge `/profile` HTTP endpoint reads configuration flags from `.config.bridge.yaml`. If `usb_cfg_enabled` is set to false, the endpoint returns `503 Service Unavailable` with `{"error": "profile_switching_unavailable"}` for mutations, and sets `enabled: false` in queries.
* **PortWatch UI Gated**: The PortWatch `ProfilePicker` UI block is hidden from the StatusScreen in production builds unless `features.profile_switching_enabled` is explicitly enabled in `.config.portwatch.yaml`.
* **Orphaning Recovery**: Profiles are saved to NVS. If radios mismatch, local recovery remains available over USB serial commands (which are always accepted locally regardless of `ALLOW_PLAINTEXT_PROFILE_CFG`).
* **Tests**: Verified by `control_podium/tests/test_profile_side_channel.py` (including configurations where profile switching is disabled).

---

## 4. ACK / REP Semantics

### Frame Types
* `hlo`: Hello. Sent by client to announce presence and wake the bridge.
* `pin` / `pon`: Ping / Pong. Connectivity verification.
* `cmd`: Mutation commands sent by privileged nodes.
* `ack` / `nak`: Positive / negative acknowledgments for commands and hello.
* `qry`: Queries requesting status pages.
* `rep`: Reply frames returning queried payloads.
* `pub`: Periodic status broadcasts.

### Execution Timing
The bridge's command handler is synchronous with respect to the engine:
1. `_handle_cmd` receives `cmd`.
2. It awaits `_exec_cmd(path)`, which makes a blocking HTTP REST call to `MarsinEngine` via `EngineClient` (e.g., `set_pattern`, `set_param`).
3. Only **after** the REST call returns successfully does the bridge emit the radio-level `ack` frame containing the success argument. If the REST call fails, it emits `nak engine_error`.
4. There is no separate radio-level ACK; the application ACK *is* the engine confirmation.

### Optimistic Intent Reconciliation
PortWatch uses optimistic state rendering:
* On toggle/slider write, PortWatch pushes a `CommandIntent` to the store with `pending: true` and shimmers the UI element.
* When the bridge's `ack` frame lands, it triggers `markIntentResolved()`, flipping `pending` to `false`.
* When a status `pub` or polled `rep` arrives, `reconcileIntent` checks if `pending === false`. If the engine state still disagrees with the intent, it drops the intent, allowing the engine's state to override the UI. This prevents the UI from getting stuck on a stale value if the command was ignored or overridden. (See [intent.ts](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/PortWatch/src/state/intent.ts#L73-L82)).

---

## 5. Sync Model

### Cadences
* **Bridge Broadcast (`pub`)**:
  * `short_interval_s`: 60 s (when clients are active).
  * `long_interval_s`: 120 s (when idle).
  * Wakes instantly on engine events if `enable_engine_ws_subscriber` is active.
* **PortWatch Polling**:
  * `status_interval_ms`: 8000 ms (8 s) (primary sync path via `qry engine/status`).
  * `local_exports_interval_ms`: 8000 ms (8 s) (via `qry exports`).
  * `global_params` poll: 8000 ms (8 s) (via `qry params/snapshot`).

### Payload Split
* **PUB and `engine/status`**: Carry `pat` (active pattern), `pl` (playlist), `vw` (view), `vov` (override), `lk` (lock owner), `lku` (lease remaining), `br` (brightness), `blk` (blackout), `ap` (autopilot), `apd` (autopilot delay), `aps` (autopilot shuffle), `sp`/`dr`/`ct`/`sz`/`rt` (CPC variables), `p1`/`p2` (palettes), and `dn` (down).
* **`qry params/snapshot`**: Delivers CPC parameters exclusively.
* **`qry exports`**: Paginated retrieval of per-pattern WASM parameters.

### Cache Hashes (`plh`/`pph`)
**Removed**. Both `plh` (playlist library hash) and `pph` (pattern hash) were stripped from the bridge and client code. The client now manages a simple name-keyed AsyncStorage cache.
* *Doc Mismatch*: [21_portwatch_monitor.md](file:///Users/ssolaimanpour/workspace/BM26-Titanic/docs/21_portwatch_monitor.md#L769) still documents `plh` and `pph` as active status fields.

---

## 6. LoRa Airtime / Profile Config

### Default Parameters
* Spreading Factor (SF): `10`
* Bandwidth (BW): `125.0` kHz
* Coding Rate (CR): `5` (4/5)
* Default TX Power: `22` dBm (HIGH) / `14` dBm (LOW)

### Profile Parameters Table
| Profile Name | Bandwidth (kHz) | SF | CR | TX High (dBm) | TX Low (dBm) |
|---|---|---|---|---|---|
| `test_bench` | 500.0 | 7 | 5 | 0 | -9 |
| `local` | 250.0 | 9 | 5 | 14 | 6 |
| `playa` | 125.0 | 10 | 5 | 22 | 14 |

### Transmit Redundancy & MTU
* **Redundant TX**: `LORA_REDUNDANT_TX_COUNT` is set to `1` (disabled) in the firmware.
  * *Doc Mismatch*: `.config.bridge.yaml` claims the system runs at 4x redundancy.
* **BLE MTU**: Requested at `247` bytes.
* **Plaintext Budget**: Hard-capped at ~138 characters to fit within a single 250-byte encrypted BLE notification.

---

## 7. Battery / Power Behavior

### Voltage Thresholds
* **Warning Voltage**: `3.40V` (triggers `BATT_SRC_LOW` state).
* **Shutdown Voltage**: `3.10V` (triggers `BATT_SRC_CRITICAL` and calls `heltec_deep_sleep()`).

### Charging Heuristics
* **USB-Only/CV Phase**: $\ge 4.18\text{V}$ (pins display to 100%).
* **USB-Attached Float**: $4.10\text{V}$..$4.18\text{V}$ (labeled `CHRG`, reads curve %).
* **Slope Detection**: For voltages $< 4.10\text{V}$, reads are taken every 5 s. If the voltage rises by $\ge +5\text{mV}$ across a 60 s window, the state changes to `CHRG`. It remains in charging mode until a negative slope of $\le -5\text{mV}$ is measured.

### HIGH / LOW State Transitions
* **Wake (LOW $\to$ HIGH)**: BLE connect (locked in HIGH while connected), BLE characteristic write, and PRG button press.
* **LoRa RX**: Deliberately does **not** wake the client to save power.
* **Sleep (HIGH $\to$ LOW)**: After 60 s (`PWR_FAST_IDLE_MS`) of no activity triggers (and no BLE connection).
* **Server Pinned**: The server is USB-powered and pins its profile to HIGH forever.
* **Overridden Production default**: `pin_high_forever` is committed as `true` in [.config.firmware.yaml](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/.config.firmware.yaml#L213), which prevents battery-saving mode entirely.

---

## 8. Bridge Deployment / Resilience

### Systemd Unit Properties
Located at `/etc/systemd/system/titanic-bridge.service`:
* `Restart=on-failure`, with `RestartSec=5`.
* `StartLimitIntervalSec=60` and `StartLimitBurst=5` to prevent CPU thrashing.
* Runs within the custom virtualenv Python interpreter (`venv/bin/python`).
* Sandboxed with `ProtectSystem=strict`, `NoNewPrivileges=true`, `ProtectHome=true`, and `PrivateTmp=true`.
* `ReadWritePaths` limits writes to `${INSTALL_ROOT}` and `/var/lib/titanic-bridge`.

### Serial Reconnect Behavior
`RadioPortSerial.recv_frames()` handles disconnection automatically. It detaches the invalid file handle on an `OSError`/`SerialException`, sleeps with an exponential backoff (1 s to 30 s cap), and repeatedly tries to reopen the serial port. Outbound frames sent during this window are silently dropped.

### Deploy --firmware Flow
1. Scans the Pi using SSH (`_remote_scan_pi`) to locate the matching board by MAC.
2. Compiles the firmware locally on the developer's laptop.
3. Stages the bootloader and `boot_app0.bin`.
4. `rsync`s the images to `/opt/titanic-bridge/firmware-images` on the Pi.
5. Issues a remote `systemctl stop titanic-bridge.service` and executes `fuser -k` on the port.
6. Invokes `esptool.py` remotely to flash the board, then restarts the service with `systemctl restart`.

---

## 9. Documentation Mismatches

1. **AES Tag Length**: `docs/21_portwatch_monitor.md` mentions a 24-bit truncated tag. The code enforces full 128-bit (16-byte) GCM tags.
2. **Redundant TX**: `.config.bridge.yaml` refers to 4x redundant transmits. The firmware has redundancy set to 1x (disabled) to avoid deaf-times.
3. **plh/pph Hashes**: `docs/21_portwatch_monitor.md` describes `plh` and `pph` fields as active status keys used to validate the cache. These hashes have been completely removed from both the bridge's status formatter and PortWatch's parser.
4. **CFG Side-channel**: Code documentation implies the link is fully encrypted and authenticated, but the runtime LoRa profile switching side-channel (`*CFG`) bypasses the encryption codec completely, exposing a Denial of Service (DOS) vulnerability.
5. **Polling Intervals**: Documentation references 5 s polling loops, but [.config.portwatch.yaml](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/PortWatch/.config.portwatch.yaml#L162) defaults to 8 s with a 12 s timeout.

---

## Actionable Recommendations & Gaps

| Status | Issue | Files Affected | Emitters/Remedies |
| :--- | :--- | :--- | :--- |
| **RESOLVED** | Client counter restart lock | [codec.ts](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/PortWatch/src/crypto/codec.ts), [counterStore.ts](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/PortWatch/src/security/counterStore.ts), [titanicLink.ts](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/PortWatch/src/link/titanicLink.ts), [test_comms_replay.py](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/tests/test_comms_replay.py) | Implemented `DurableCounter` with block reservation (1024-step blocks) using Expo SecureStore. Next counter persists across restarts, preventing lockout. Sim replay tests added. |
| **RESOLVED** | Unauthenticated profile switching (`*CFG`) | [titanic_profiles.h](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/firmware/src/titanic_profiles.h), [bridge.py](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/comms/bridge.py), [bridge_health.py](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/comms/bridge_health.py), [StatusScreen.tsx](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/PortWatch/src/ui/StatusScreen.tsx), [test_profile_side_channel.py](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/tests/test_profile_side_channel.py) | Plaintext LoRa-originated `*CFG` is rejected in production (compiles with `ALLOW_PLAINTEXT_PROFILE_CFG=0` default). Local serial configuration changes remain active. `/profile` endpoints and UI profile switcher are disabled/hidden unless configured. |
| **RESOLVED** | Outdated plh/pph cache hashes | [21_portwatch_monitor.md](file:///Users/ssolaimanpour/workspace/BM26-Titanic/docs/21_portwatch_monitor.md) | Documentation updated to align with the name-keyed AsyncStorage cache and clarify that `plh`/`pph` were removed. |
| **RESOLVED** | Outdated redundant TX config docs | [config.bridge.yaml](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/.config.bridge.yaml) | Updated comment in bridge configuration file to correctly show 1x transmit redundancy (redundant TX disabled). |
| **RESOLVED** | Pinned high default in production | [config.firmware.yaml](file:///Users/ssolaimanpour/workspace/BM26-Titanic/control_podium/.config.firmware.yaml) | `pin_high_forever` default is set to `false` in committed configs. Local developer machines can use `.config.firmware.local.yaml` to override for bench/HIL testing. |

---

## 10. Post-Audit Requirements

> [!IMPORTANT]
> After applying these audit changes in the codebase (PR 1 through PR 4), we must update the main design documents (such as [07_control_podium.md](file:///Users/ssolaimanpour/workspace/BM26-Titanic/docs/07_control_podium.md), [21_portwatch_monitor.md](file:///Users/ssolaimanpour/workspace/BM26-Titanic/docs/21_portwatch_monitor.md), and [22_server_bridge.md](file:///Users/ssolaimanpour/workspace/BM26-Titanic/docs/22_server_bridge.md)) to align them with the hardened code behavior and secure configuration gates. This has been completed in PR 1.
