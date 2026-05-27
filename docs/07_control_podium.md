# 07 — Control Podium (v2): Multi-Client LoRa Mesh with Pi Bridge

> **Status:** Live design. Replaces the v1 point-to-point podium ↔ server doc.
> **Compared to v1:** v1 was strict point-to-point operator-podium ↔ server for cue triggering. v2 adds **many remote clients** (privileged + regular), keeps the low-latency operator path, and introduces a **Raspberry Pi bridge** that translates radio frames into MarsinEngine API calls and publishes engine status back over the air on a 5–10 s cadence.
>
> **Note on CaptainPad:** the radio is the **fallback transport**, not the only one. When Wi-Fi is available, CaptainPad uses its existing HTTP/WebSocket path to MarsinEngine and gets the full feature set. When Wi-Fi is unavailable (out on the playa), it falls back to BLE → client radio → LoRa → server radio → Pi → engine, with a deliberately reduced feature set (see §13). Large operations (live pattern editing, dimmer rack, per-fixture brightness) are disabled in radio mode.
>
> **Out of scope here (deliberately):** rate limiting / cooldowns (the captain companion or future CaptainPad UI handles pacing — this doc is the protocol, not the politeness layer); fire-effect commands (the Flame Effect Controller per FW-SPEC-001 runs separate firmware on a separate transport — the radio mesh carries no fire path); long-range hardware control surface internals (it's its own program; commands it issues still flow through this same allowlist when it joins the mesh).

---

## 1. Why a New Design

The v1 system (operator podium ↔ server, raw LoRa, ~50 ms one-way) was tuned for **show-control cue triggering only**: one transmitter, one receiver, no addressing, no routing, no auth. It does that job well.

What we need at Burning Man, in addition to that:

1. **Many camp/crew members carrying handhelds**, talking to the same server, from anywhere on the playa.
2. **Two-way comms.** Clients need to query "what's the engine doing right now?" and the server should be able to push status updates.
3. **Privilege tiers.** Some IDs can change patterns / scenes / params (privileged). Others can only read state (regular).
4. **Server-side translation into the MarsinEngine.** The radio doesn't talk HTTP; we need a translator (the Raspberry Pi) between the server radio and the engine.
5. **The dev path supports both with-and-without hardware.** Two physical Heltec V4 boards (server `0x01` and a captain handheld `0x0A`) are now on the bench, paired by USB MAC via `firmware/deploy.py` (see `control_podium/.config.nodes.yaml` and §10). The simulated radio bus (`sim_bus.py` + `RadioPortSim`) remains the daily inner loop; **HIL is now part of every commit's verification path.** Anything that lands here must boot on both real boards and pass the sim-bus mesh demo.
6. **The on-air channel must be cryptographically protected.** Anyone with a $30 Heltec on the same frequency can otherwise sniff or inject. We add a pre-shared symmetric key and AEAD per frame (see §3.6) so receivers ignore anything that doesn't authenticate. Confidentiality + integrity + replay defense, all with one shared secret deployed out-of-band as `marsin_engine/secret.yaml` (the single source of truth — same file consumed by every component of the TITANIC stack).

This document is the design + the bring-up plan.

---

## 2. Hardware Topology

```
                                     ┌──── Camp Crew #1 (privileged) ───┐
                                     │  CaptainPad iPhone               │
                                     │     │  BLE                       │
                                     │     ▼                            │
                                     │  Heltec Client Radio  (NODE_ID 0x0A)
                                     │     │  LoRa 915 MHz              │
                                     └─────┼────────────────────────────┘
                                           │
                                     ┌─────┼────────────────────────────┐
                                     │  Heltec Server Radio (NODE_ID 0x01)
                                     │     │  USB-CDC serial            │
                                     │     ▼                            │
                                     │  Raspberry Pi 4                  │
                                     │     ├─ radio_bridge.py           │
                                     │     │   - frame parser           │
                                     │     │   - ACL check              │
                                     │     │   - engine REST/WS client  │
                                     │     │   - status publisher 5/10s │
                                     │     │  Ethernet                  │
                                     │     ▼                            │
                                     │  Main Server PC                  │
                                     │     ├─ MarsinEngine   (port 6968)│
                                     │     ├─ simulation                │
                                     │     └─ DMX / sACN out → fixtures │
                                     └──────────────────────────────────┘
                                           ▲
                                           │  LoRa 915 MHz
                                     ┌─────┼────────────────────────────┐
                                     │  Heltec Client Radio  (NODE_ID 0x0B)
                                     │     │  BLE                       │
                                     │     ▼                            │
                                     │  CaptainPad iPhone               │
                                     │  Camp Crew #2 (regular, read-only)
                                     └──────────────────────────────────┘
                                              ...up to ~16 nodes
```

Notes on the layout:

- **Operator podium** stays point-to-point with the server radio on a **different LoRa channel/frequency** if we want zero cross-traffic. For the burn this can also live on the same channel since the addressing layer in v2 already discriminates traffic by `dst_id`. We start simple: one channel, one server `NODE_ID = 0x01`, many clients.
- **Raspberry Pi** is the new "smart" piece. It speaks framed bytes to the server radio over USB and JSON over Ethernet to the engine. This split keeps the firmware dumb (it just relays bytes; no protocol knowledge in C++).
- **Number of clients:** practical ceiling on a single raw-LoRa channel is somewhere around 16 active nodes before collisions hurt. Beyond that, this design needs a TDMA or proper mesh layer (out of scope for v2).

---

## 3. Wire Protocol — "Titanic Frame v2"

The on-air format is a **single-line ASCII string** with `|`-delimited fields, with the type-specific payload **AEAD-encrypted under a pre-shared key** (see §3.6). Text framing was chosen over a fully-binary protocol because:

- The firmware passes `radio.transmit(String)` / `radio.receive(String)` and the existing serial protocol `RX:<payload>:RSSI=...:SNR=...` is text. Keeping the wire format text means we don't have to change the firmware's serial format, only its output sanitization (no `:` inside payload — see §3.3).
- Frames are debuggable with a serial console: routing fields (`src`, `dst`, `seq`, `typ`, `flags`, `ctr`) are visible in the clear and authenticated; only the type-specific argument is opaque without the key.
- ASCII overhead is acceptable: header + nonce + base64 body + tag for a typical 32-byte plaintext is ~95 bytes ≈ 78 ms airtime at SF7/BW250. Larger than v1 (~46 ms) but well within the per-second airtime budget for our message rate.

> **Frame magic bumped to `T2`.** v1 receivers ignore `T2|…` frames as garbled; v2 receivers reject `T|…` frames immediately. This is a hard cutover — clear separation, no protocol-version fuzzing.

### 3.1 Frame Layout

```
T2|<src>|<dst>|<seq>|<typ>|<flags>|<ctr>|<body>|<tag>
```

| Field    | Width      | Encoding   | Description                                              |
|----------|------------|------------|----------------------------------------------------------|
| `T2`     | 2 chars    | literal    | Magic. Identifies a v2 Titanic frame.                    |
| `<src>`  | 2 chars    | hex u8     | Sender node ID (`00`–`FE`). Cleartext, authenticated.    |
| `<dst>`  | 2 chars    | hex u8     | Destination ID. `01` = server. `FF` = broadcast. Cleartext, authenticated. |
| `<seq>`  | 2 chars    | hex u8     | Per-sender sequence number for ACK matching. Cleartext, authenticated. |
| `<typ>`  | 3 chars    | ASCII      | Message type. See §3.2. Cleartext, authenticated.        |
| `<flags>`| 1 char     | hex u4     | Bit 0 = ACK requested. Bit 1 = privileged-only. Bit 2 = retry. Cleartext, authenticated. |
| `<ctr>`  | 12 chars   | hex u48 BE | Per-sender monotonically-increasing counter. Drives the AEAD nonce (§3.6) and the receiver's anti-replay window. Persisted to NVS so it survives reboot. Cleartext, authenticated. |
| `<body>` | 0–~200     | base64url, no padding | AEAD ciphertext of the original `<arg>` plaintext. Encrypted. Empty body is `-`. |
| `<tag>`  | 32 chars   | hex (16 B) | AEAD authentication tag over the cleartext header through `<ctr>` (as AD) plus the ciphertext. **Receivers MUST verify before parsing the body.** |

Header through `<ctr>` is **30 bytes** (cleartext, authenticated). For a 32-byte plaintext arg, total frame is ≈ 30 + 1 + 44 (base64 of 32 bytes) + 1 + 32 = ~108 chars on the wire.

> [!IMPORTANT]
> A receiver that fails the AEAD tag check MUST silently discard the frame (no log of the body, no ACK, no NAK). The only side-effect is incrementing a `bad_tag_count` metric for monitoring. Replying — even with `nak`-on-bad-key — would create an oracle for active attackers.

> [!NOTE]
> **Half-duplex timing on real radios.** The `podium_tx` firmware does `delay(30)` after a TX before re-arming the receiver, so a reply that arrives <~110 ms after a TX is missed (the preamble passes while the radio is still in TX-cleanup). The bridge's `RadioPortSerial` therefore inserts a `pre_send_delay_s=0.15` (configurable) before each on-the-wire send so the peer has had time to switch into RX mode. This is a temporary workaround until `podium_tx`'s `delay(30)` is replaced with a non-blocking LED scheduler — then the radio can be re-armed immediately after TX and the host-side delay can drop to zero.

### 3.2 Message Types

| `typ` | Direction      | Meaning / Description                                                                                  |
|-------|---------------|--------------------------------------------------------------------------------------------------------|
| `hlo` | C → S         | Hello / client presence / bridge wake. Arg `name/Sina,role/captain`. Server logs presence.             |
| `pin` | C → S         | Ping. Server replies with `pon`. Used for liveness/latency.                                            |
| `pon` | S → C         | Pong.                                                                                                  |
| `cmd` | C → S         | Mutation command requiring privileged ACL. Arg uses path/value syntax — see §3.4.                      |
| `qry` | C → S         | Query (read-only). Allowed for any role. Arg is a path: `engine/status`, `param/speed`, ...           |
| `ack` | S → C         | Authenticated command accepted, ACL passed, MarsinEngine REST call succeeded. `seq` echoes the original.|
| `nak` | S → C         | Authenticated command rejected (e.g. `acl_denied`, `unknown_cmd`) or engine operation failed (`engine_error`). |
| `rep` | S → C         | Reply with data for a `qry`. Arg is a compact key/value list (see §3.4).                              |
| `pub` | S → broadcast | Broadcast status publish. Sent periodically on `dst = FF`. Arg is a compact key/value list.            |

> [!IMPORTANT]
> **ACK Semantics:**
> There is currently **no radio-level ACK** in the Titanic protocol. Do not treat `ack` as "the radio heard the packet"; `ack` is emitted only after the bridge successfully authenticates the frame, passes ACL verification, and completes the engine-side REST operation. If the engine execution fails, the bridge emits `nak`.

### 3.3 Why no `:` in `<arg>`

The firmware's USB output is:

```
RX:<lora_payload>:RSSI=<r>:SNR=<s>\n
```

If `<lora_payload>` contains `:`, the existing companion parser (`utils/serial_parser.py`) breaks. We have two options:

1. **Forbid `:` in `<arg>`** and use `/` / `,` as separators inside arg. *(Chosen — zero firmware change required.)*
2. Change firmware output to use a different separator (e.g. `|` between metadata fields). Backward-incompatible.

Option 1 is what we are doing. In v2 the companion parser also becomes more robust (uses a regex with the `:RSSI=` suffix as the cut point), but the rule still applies for safety: **no `:` characters inside any frame field**.

### 3.4 Arg Encoding Conventions

Within `<arg>`, we use:

- `/` to separate path segments: `pattern/sunset`, `engine/status`, `param/speed`.
- `,` to separate multiple keyed values: `fps/40,pat/sunset,sp/0.7`.
- `=` to assign explicit values where ambiguity might otherwise occur: `seq=42`.
- Values are always strings on the wire. The Pi bridge does type coercion when calling the engine.

Examples — same logical frames in v1 (plaintext, for reference) and v2 (encrypted; `<body>`/`<tag>` shown as illustrative placeholders, not real ciphertext):

```
# v1 (deprecated)
T|0A|01|42|cmd|1|pattern/sunset
T|01|FF|99|pub|0|fps/40,pat/sunset,sp/0.7,br/100,blk/0,upt/3611

# v2 (current) — same payloads, AEAD-wrapped under marsin_engine/secret.yaml
T2|0A|01|42|cmd|1|0000000000A1|kJ9zPq…(b64)|9f3a4b…(32 hex)
T2|01|FF|99|pub|0|0000000004C7|MzYpL…(b64)|71e0d8…(32 hex)
T2|0A|01|43|qry|1|0000000000A2|aW5kZX…(b64)|c4a721…(32 hex)
T2|01|0A|43|rep|0|0000000004C8|Zmc1L…(b64)|0d9b2e…(32 hex)
```

The `<ctr>` is the per-sender frame counter (12 hex / 48 bits, big-endian); see §3.6 for how it derives the AEAD nonce. `<body>` and `<tag>` only round-trip through the cipher — no human-meaningful structure. The plaintext `arg` (e.g. `pattern/sunset`) follows the conventions above.

### 3.5 CRC?

For v2 we **do not** add a separate CRC. Justification:

- LoRa already has 16-bit CRC at the PHY layer; corrupted frames don't make it to the host.
- **The 128-bit AEAD tag (§3.6) covers integrity end-to-end** — any single-bit flip in header or body fails the tag check and is dropped. This is strictly stronger than a CRC for our threat model.
- The text format is self-validating: a missing/garbled delimiter fails the parser, which is a hard reject before the AEAD check even runs.
- Adding a CRC on top would be redundant overhead.

If we ever switch to binary frames (e.g. to pack more data into one airtime slot), the AEAD tag still gives us integrity; no separate CRC needed.

### 3.6 Authenticated Encryption ("secure channel")

> [!IMPORTANT]
> This section is the security spec the firmware and the bridge MUST both implement, byte-for-byte. Any inconsistency makes the channel silently fail closed (every frame rejected) or — worse — silently fail open. Treat it as a contract.

#### 3.6.1 Threat model

We protect against:

| Threat                                                | Defense in v2                                     |
|-------------------------------------------------------|---------------------------------------------------|
| Passive sniffing of payloads (someone with an SDR)    | Confidentiality via AEAD encryption of `<arg>`.   |
| Active injection (someone with a Heltec on our band)  | Integrity + authenticity via the AEAD tag.        |
| Replay of an old captured frame                       | Per-source counter window + monotonic `<ctr>`.    |
| Spoofing a node ID                                    | `<src>` is in the AD; no key, no forgeable tag.   |
| Bit-flip in transit (already mostly caught by LoRa CRC) | AEAD tag fails on any bit-flip; frame dropped.  |

We **do not** protect against:

- **Physical compromise of a node.** Anyone who pops open a Heltec or a Pi and reads flash gets the key, and from then on can issue valid frames as that node. For Burning Man this is acceptable — the playa-physical-access threat dominates anyway. (Per-node keys with a tiny KDF would lift this; see §18.)
- **Denial-of-service via airtime flooding.** A loud transmitter can drown the channel regardless of cryptography.
- **Traffic-analysis side channels.** Frame lengths and timing leak that *something* is happening; we don't pad. The wire-visible header (`src`/`dst`/`typ`) is also not hidden — it must be parseable in the clear so the receiver can filter on `dst` before paying the AEAD cost on every frame.

#### 3.6.2 Cipher choice

**AES-128-GCM** (authenticated encryption with associated data).

- **Why AES-GCM:** ESP32-S3 has hardware AES acceleration (mbedTLS `mbedtls_gcm_*` uses it). On the Pi, Python's `cryptography` package wraps OpenSSL's GCM. Both sides get fast, audited, identical-output AEAD with no fiddly hand-rolled crypto.
- **Why 128-bit and not 256:** key brute-force is not in our threat model; 128 bits saves a few microseconds per frame and 16 bytes of NVS.
- **Tag length:** 16 bytes (128 bits, the GCM default). Truncation is *not* an option — short tags weaken the authenticity guarantee in measurable ways and we have plenty of airtime budget for the full tag.

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-128-GCM |
| Key size  | 16 bytes (128 bits) |
| Nonce size | 12 bytes (96 bits) |
| Tag size  | 16 bytes (128 bits) |
| AD        | The cleartext frame prefix `T2|<src>|<dst>|<seq>|<typ>|<flags>|<ctr>` (the exact ASCII bytes, no trailing `|`) |
| Plaintext | The original `<arg>` UTF-8 bytes (may be empty) |
| Ciphertext | Same length as plaintext |

#### 3.6.3 Key — `marsin_engine/secret.yaml`

A single shared 16-byte symmetric key, deployed out-of-band as `marsin_engine/secret.yaml`. Living next to the engine is deliberate: the engine is the canonical source of truth for the camp's shared secret, and every TITANIC component (bridge, captain companion, future CaptainPad iPad app) reads the SAME file path. One key, one file, no drift.

```yaml
# marsin_engine/secret.yaml  (gitignored, hand-deployed per camp)
# 16-byte AES-128-GCM pre-shared key. Generate with:
#   python -c "import secrets; print(secrets.token_hex(16))"
key_hex: "f3a91e7c6b2d5849ab170c9e3f4d8c12"
# Format version. Lets us rotate cipher in the future without ambiguity.
version: 1
```

- **Two formats accepted.** `key_hex:` (32 hex chars) is the production form, used directly as the AES-128-GCM key. `key:` (any string) is the dev form, hashed with SHA-256 and truncated to 16 bytes. Use `key:` for hand-typed bring-up secrets like `"SECRET"`; switch to `key_hex:` before the burn.
- **Bring-up:** copy `marsin_engine/secret.yaml.example` → `marsin_engine/secret.yaml`, edit it, distribute the SAME content (USB stick / scp over trusted LAN) to every machine that runs an engine, bridge, or captain companion. Never in git. Never over the radio.
- **Bridge / companions:** every companion (`bridge_companion.py`, `client_companion.py`, the HIL demos) reads the file at startup and ABORTS if missing or malformed. Refusing to run is preferred to silently allowing plaintext on the air.
- **Override path:** `TITANIC_SECRET_PATH=/some/other/secret.yaml` env var. Tests that want to exercise the failure modes set `TITANIC_INSECURE=1` to bypass the codec entirely (never used in production).
- **Firmware:** in the **current** topology the firmware is a transparent ASCII byte relay — the AEAD lives entirely in the host-side companions, so the firmware doesn't need the key (see §3.6.8b). When CaptainPad eventually sends commands BLE→Heltec→radio without a host in the loop (§13.5), `firmware/deploy.py` will bake the same secret into the firmware image at build time via a `-DTITANIC_SECRET_HEX="…"` build flag, with a `panic()` in `setup()` if the macro is undefined.
- **Rotation:** replace the file and restart everything (bridges, companions, future CaptainPad). There's intentionally no "old + new key both accepted" grace path — that would be a downgrade attack vector.

> [!CAUTION]
> Recovering the key from a flashed Heltec — once firmware-side AEAD is enabled — is straightforward (read flash → grep for the hex string). **Treat physical control of any node as full key compromise.** This is acceptable because anyone with physical access also has physical access to the wires they want to interfere with. Do not deploy this design where attackers can quietly walk off with a node and the rest of the camp keeps trusting it. (See §18 for the per-node-key uplift if we ever care.)

#### 3.6.4 Nonce construction

GCM is catastrophic if you ever reuse a (key, nonce) pair. We construct the nonce so reuse is structurally impossible without an out-of-spec firmware bug:

```
nonce[12] = src[1]     ‖ 0x00 × 5     ‖ ctr_be[6]
            (1 byte)   (5 zero bytes) (6 bytes, big-endian)
```

- `src` is the sender's node ID (one byte).
- `ctr` is a per-sender 48-bit monotonically-increasing counter (the same value transmitted as `<ctr>` in the frame). Big-endian on the wire and inside the nonce, for unambiguous interop between Python and Arduino C.
- The five zero bytes are reserved for a future epoch field if we ever need to extend the counter space.

**Why this is collision-free:**

- Two distinct senders never share `src`, so their nonce spaces are disjoint.
- A single sender never reuses `ctr` because:
  1. The counter is monotonically incremented for every TX.
  2. The current value is persisted to NVS on a write-coalescing schedule (every 64 frames OR every 5 s, whichever first).
  3. On boot, the firmware reads the persisted counter and **adds a safety jump of 256** before its first TX, so any in-flight increments since the last NVS write can't be replayed.
  4. The 48-bit space (281 trillion frames) cannot be exhausted in any plausible deployment.

> [!IMPORTANT]
> **P0 Security Invariant: Counter Monotonicity & Durability**
> Every AEAD sender must maintain a monotonically increasing per-key, per-src counter. Counter reuse under the same key is strictly forbidden. A source that loses durable counter state must not continue using the same key without re-enrollment or key rotation.

> [!WARNING]
> **Durable Counter Defect:**
> PortWatch historically seeded a random 32-bit counter in-memory and did not persist it. This caused both replay-window lockouts (because the random seed was below the bridge's `highest_ctr` and the `hlo` re-anchor drop threshold is `1 << 32`) and nonce reuse across app restarts. This is a P0 defect. A durable, key-and-src-partitioned counter implementation in PortWatch's secure storage is required.

**Why explicit `src` in the nonce:**
Even though `src` is also in the AD, having it in the nonce makes per-sender counter spaces structurally independent: a future sender that comes online late and starts at `ctr=0` cannot collide with anyone else's `(key, nonce)` history.

#### 3.6.5 Replay defense (receiver side)

Each receiver maintains a small per-source state:

```python
class ReplayWindow:
    highest_ctr: int     # max ctr seen for this src
    bitmap: int          # 64-bit window; bit i means "we have seen highest_ctr - i"
```

For an incoming frame from `src` with counter `ctr`:

| Condition                            | Action                                                  |
|--------------------------------------|---------------------------------------------------------|
| `ctr > highest_ctr`                  | Slide window forward, mark new bit, accept.             |
| `highest_ctr - 64 < ctr ≤ highest_ctr` and bit not set  | Mark bit, accept (handles minor reorder). |
| `highest_ctr - 64 < ctr ≤ highest_ctr` and bit set      | **Reject as replay.** |
| `ctr ≤ highest_ctr - 64`             | **Reject as too old.** (Below the window.)              |

The window starts at `highest_ctr = 0` per source on boot; this means a sender that reboots can be desynced briefly. To recover, the bridge tolerates a *single* `hlo` from a known `src` whose `ctr` is dramatically lower than `highest_ctr`, treats it as an explicit re-init (re-anchoring `highest_ctr = ctr` and clearing the window), and logs it. Other frame types in that state are still rejected — only `hlo` is allowed to re-anchor, because `hlo` is idempotent and rate-limited at the source.

#### 3.6.6 Wire ordering and AAD layout

For interop, the **exact AD bytes** are the cleartext ASCII prefix up to but not including the second `|` after `<ctr>`:

```
T2|0A|01|42|cmd|1|0000000000A1
```

(no trailing pipe, no trailing newline). The receiver builds this string from the parsed fields rather than slicing the input — that way it's robust against extraneous whitespace and matches whatever the sender computed.

#### 3.6.7 Failure modes (what the receiver does)

| Failure                              | Action                                              | Counter incremented        |
|--------------------------------------|-----------------------------------------------------|----------------------------|
| Wrong magic (e.g. v1 `T\|`)          | Drop silently.                                      | `wrong_magic_count`        |
| Malformed structure (bad delimiters) | Drop silently.                                      | `parse_error_count`        |
| Counter below replay window          | Drop silently.                                      | `replay_too_old_count`     |
| Counter already seen                 | Drop silently.                                      | `replay_dup_count`         |
| AEAD tag verify fails                | Drop silently. **Never NAK, never log body.**       | `bad_tag_count`            |
| OK after decrypt                     | Process normally per §3.2.                          | `frames_ok`                |

The bridge exports these counters at `GET /bridge/stats` (debug-only endpoint, off by default in production). A sudden spike in `bad_tag_count` is the signal that someone is probing the channel, OR that key rotation didn't propagate cleanly.

#### 3.6.8 Test vectors

Implementations on both sides MUST pass a short fixed test vector at startup (in `test_comms_secure_frame.py` on the Pi, in `firmware/test/test_secure_frame.cpp` on the firmware) so a build with mismatched cipher / endianness / nonce layout fails loudly instead of silently rejecting every real frame:

```python
# Reference vector, hand-checked once
key_hex   = "f3a91e7c6b2d5849ab170c9e3f4d8c12"
src, ctr  = 0x0A, 0x0000_0000_00A1
header_ad = "T2|0A|01|42|cmd|1|0000000000A1"
plaintext = "pattern/sunset"
nonce     = bytes([0x0A, 0,0,0,0,0, 0,0,0,0,0,0xA1])  # 12 bytes
# expected ciphertext + tag (computed once, frozen):
expected_ct_b64u = "TBA — generated by the bridge harness on first run"
expected_tag_hex = "TBA — generated by the bridge harness on first run"
```

#### 3.6.8b Where the AEAD lives in production

The deployed topology the user is shipping looks like this:

```
[captain laptop]                                                     [server laptop / Pi]

companions/client_companion.py        LoRa air                companions/bridge_companion.py
   │ (does AEAD)                       (T2 frames)                │ (does AEAD + replay window)
   ▼                                                              ▼
USB-CDC ──→ Heltec 0x0A ────────────────────────────────────→ Heltec 0x01 ──→ USB-CDC
            (firmware = byte relay)                            (firmware = byte relay)

                                                                  HTTP ↔ LAN MarsinEngine (10.1.1.172:6968)
```

Both companions hold the AES-128 key from `marsin_engine/secret.yaml` and
run the codec in `comms/secure.py`. The two Heltecs see only opaque ASCII
(`T2|...|...`) and do not need to know the key. This is the same end-to-end
security posture as if the firmware did the AEAD, because there is no
untrusted hop between the laptop and the radio (USB-CDC is a direct cable).

**When firmware-side AEAD becomes necessary:** the §13.5 fallback mode
where CaptainPad on an iPad sends commands BLE→Heltec→radio **without a
host laptop in the loop**. In that flow the Heltec is the only thing
between the iPad UI and the air, so the AEAD has two reasonable homes:

1. **The iPad app does the AEAD itself**, then writes the already-encrypted
   ASCII frame to a BLE characteristic. The Heltec stays a transparent
   byte relay forever and never needs the secret. **This is the preferred
   target** — it keeps the Heltec firmware identical between the
   "host-laptop captain" and the "iPad captain" topologies.
2. **The Heltec does the AEAD on the iPad's behalf** (encrypt outbound
   plaintext from BLE → emit `T2|…` frame; decrypt inbound `T2|…` →
   notify plaintext over BLE). Reasonable fallback if the iPad runtime
   can't host the codec, but means flashing the secret into firmware.

Either way, the integration work happens after the host-side companion
apps are stable and the iPad app is ready to take over from
`client_companion.py`. Until then, the iPad code is **explicitly out of
scope for this milestone** — we do not change the CaptainPad app yet,
but we note the design hook here so the integration path is clear.

#### 3.6.9 What this changes elsewhere in the doc

- §3.1 (frame layout): the v2 9-field frame replaces the v1 7-field frame; v1 receivers see `T2|…` as garbled and drop it, v2 receivers reject `T|…` immediately.
- §4.2 (ACL): the per-frame caution about "no cryptographic auth" is now obsolete — see updated wording there. ACL remains the *policy* layer; AEAD is the *channel* layer underneath it.
- §6 (Firmware): firmware MAY in the future link mbedTLS GCM (already present in ESP-IDF) and persist the per-sender counter in NVS. In the **current** topology this is **not required** because both peers run companion apps on host laptops; the firmware is a transparent ASCII byte relay. See §3.6.8b for when that changes.
- §7 (Bridge): bridge reads `marsin_engine/secret.yaml` at startup and aborts if missing/malformed.
- §10 (Bring-up): the bring-up checklist gains a "secret deployed on every machine" step.
- §13 (CaptainPad): when CaptainPad falls back to BLE→radio, the AEAD work moves to the iPad app (preferred) or the Heltec firmware (fallback). The iPad change is **deferred** until after the host-side companion apps are stable.
- §19 (Milestones): the secured-channel item is done; firmware-side AEAD is tracked as a deferred follow-on.

#### 3.7 LoRa Profile Switching Policy (*CFG)

The system supports runtime swapping of LoRa radio parameters (spreading factor, bandwidth, TX power) via plaintext `*CFG` commands.

> [!WARNING]
> **Plaintext Over-the-Air Profile Change Vulnerability:**
> Plaintext `*CFG` profile switching is a development and bench diagnostic feature only. Unauthenticated `*CFG` commands received over the air present a high-risk Denial of Service (DoS) vector: any 915 MHz transmitter that can emit a valid-looking `*CFG` line can force radios onto another profile, causing link death.

**Production Rules:**
1. **Plaintext OTA CFG Rejected:** Production firmware must reject unauthenticated LoRa-originated `*CFG` changes.
2. **Local USB Allowed:** Plaintext `*CFG` profile changes are allowed only over local USB connection (for recovery) or via an authenticated Frame v2 command path.
3. **Bridge /profile Restricted:** The bridge's `/profile` REST endpoint and PortWatch's profile picker UI must be disabled/hidden by default in production configurations.
4. **Orphaned-Radio Recovery:** If a node misses a profile transition (due to RF packet loss), it becomes "orphaned" on the old profile and cannot communicate with the bridge. Because profile state is persisted to NVS, a simple power-cycle will not recover it. The operator must connect to the node locally via USB serial and send the matching `*CFG` command to restore synchronisation.

#### 3.8 Mesh Network Structure

The Titanic protocol design accommodates multi-hop mesh relays for extended range.

> [!NOTE]
> **Mesh Relaying is Phase 3:**
> Mesh relaying is not required for initial production readiness. Direct-link HIL (Hardware-in-the-Loop) reliability must be thoroughly verified and passing before mesh routing is enabled. MVP focus is entirely on a direct, point-to-point link.

---

## 4. Identity, ACL, Privilege

### 4.1 Node IDs

A node ID is a single byte. Assignment is **static**, kept in `control_podium/.config.nodes.yaml` (committed). Example:

```yaml
# Reserved
0x00: { name: reserved,  role: none,    notes: "0x00 is never used (avoids ambiguity)" }
0x01: { name: server,    role: server }
0xFF: { name: broadcast, role: bcast }

# Operator podium (existing v1 device)
0x02: { name: operator,  role: captain }

# Crew handhelds
0x0A: { name: sina,      role: captain }
0x0B: { name: misha,     role: captain }
0x10: { name: crew_01,   role: crew }
0x11: { name: crew_02,   role: crew }
```

Roles (ship-themed; the older `priv`/`reg` labels are still accepted in
YAML as deprecated aliases):

| Role      | Can send                                      | Notes                                                 |
|-----------|-----------------------------------------------|-------------------------------------------------------|
| `captain` | `hlo`, `pin`, `qry`, `cmd`                    | Full command surface.                                  |
| `crew`    | `hlo`, `pin`, `qry`                           | Read-only on the engine. CAN ping any captain to flag attention. |
| `server`  | All `S→C` types: `pon`, `ack`, `nak`, `rep`, `pub` | The Pi enforces this on TX.                       |

> [!NOTE]
> `crew` clients can `pin` *any* node, not just the server — handy for
> flagging a captain when something needs attention. The captain client
> auto-replies PONG to inbound pings (see §8.3 / `client_companion.py`).

> [!NOTE]
> The Flame Effect Controller (FW-SPEC-001) and the long-range hardware
> control surface deliberately **do not appear** in this table. They run
> separate firmware on separate transports. The FEC has no presence on
> the radio mesh at all (no fire path, by design). The control surface
> will eventually join the mesh as a `captain`-role client driving the
> same `cmd` allowlist below — but its hardware, firmware, and operator
> UX live in their own subsystem.

### 4.2 ACL Enforcement

The bridge (Pi) does the only enforcement. It:

1. Parses each frame.
2. Looks up `src` in `.config.nodes.yaml`.
3. If the frame's `typ` requires a role the sender doesn't have, replies `nak` with `reason=acl_denied` (only if `ACK_REQUESTED` flag is set, otherwise silent drop with log).
4. Otherwise, processes normally.

The bridge is the **single trust boundary**. The firmware does no auth. Clients can't trust other clients; the server is authoritative.

> [!NOTE]
> ACL is the **policy** layer — it answers "is this sender allowed to do that operation?" The **channel** layer underneath (§3.6) handles "did this frame really come from that sender, unmodified?" via AEAD. Without §3.6 the ACL would be paper-thin (a stranger with a Heltec could spoof any `src`), but with it in place an attacker who lacks the pre-shared key can't even produce a frame that survives parse — let alone one that's then evaluated for ACL. Physical compromise of a node still bypasses both layers; see §3.6.1 / §18 for the threat model.

### 4.3 Command Allowlist

Even privileged clients can only issue a fixed set of `cmd` paths. The
allowlist is loaded from `.config.commands.yaml` and consulted by the
bridge before any handler runs. Unknown commands → `nak unknown_cmd`.
Initial set:

| `cmd` arg path                    | Bridge action                                                      |
|-----------------------------------|--------------------------------------------------------------------|
| `pattern/<name>`                  | `PUT /pattern { "pattern": "<name>" }`                              |
| `param/<key>/<value>`             | `POST /param-center { "<key>": <value> }`                           |
| `blackout/<0\|1>`                 | `POST /global-blackout { "state": <0\|1> }`                         |
| `autopilot/<0\|1>`                | `POST /autopilot { "active": <bool> }`                              |
| `fx/<effect>/<0\|1>`              | `POST /global-effect { "effect": "<effect>", "state": <bool> }`. Effects: `vintageWhite`, `fogger`, `uvBlast`, `blastWhite`, `horn` (+ `*BypassDimmer`). **Any name containing `fire` is HARD-REJECTED at the bridge** regardless of role — the radio mesh carries no fire path. |
| `brightness/<0-100>`              | Master fader. `PATCH /mixer { "master": <v/100> }`. Was `bri`; renamed for clarity. |

Everything else is rejected. This is intentionally narrow — we add
commands as we need them, and pacing (rate limiting, drag-debouncing) is
the **client UI's** responsibility, not the bridge's.

### 4.4 Query Allowlist

Queries are read-only and allowed for any role on the mesh:

| `qry` arg path                | Bridge action                                       |
|-------------------------------|-----------------------------------------------------|
| `engine/status`               | `GET /status` → compact reply                       |
| `engine/patterns`             | `GET /list-patterns` → comma-joined list            |
| `param/<key>`                 | `GET /param-center` → one key's value               |
| `param/all`                   | `GET /param-center` → all keys (may need chunking)  |

---

## 5. Status Publish (Server → Broadcast, 5/10 s Cadence)

The bridge runs a periodic publisher:

```python
async def status_publisher():
    while True:
        status = await fetch_engine_status_compact()    # ~30–50 bytes
        radio.broadcast("pub", arg=status)
        await asyncio.sleep(STATUS_PUB_INTERVAL_S)      # 5 or 10
```

Compact status format (≤ 80 bytes):

```
fps/40,pat/sunset,sp/0.7,br/100,blk/0,ap/0,upt/3611
```

| Key  | Meaning                                |
|------|----------------------------------------|
| `fps`| Engine render FPS                       |
| `pat`| Active pattern name                     |
| `sp` | CPC shared speed                        |
| `br` | Mixer master brightness (0-100)         |
| `blk`| Global blackout (0/1)                   |
| `ap` | Autopilot (0/1)                         |
| `upt`| Uptime seconds                          |

Clients consume `pub` to keep their UI in sync without polling. Latency is up to 10 s for status, which is fine for the use case (current scene awareness, not real-time cueing).

Two intervals are configurable in `.config.bridge.yaml`:

```yaml
status_publish:
  short_interval_s: 5   # used when any client active within 60s
  long_interval_s: 30   # used when idle
```

This is a battery/airtime saver: if no client has spoken in 60 s we drop to 30 s pubs.

---

## 6. Firmware Changes (v2)

The firmware stays mostly the same — it's a relay. What we add:

### 6.1 Battery Readout (answers the user's question)

The Heltec V3 has VBAT_CTRL (GPIO37) and VBAT_ADC (GPIO1). The ropg library already provides:

```cpp
float heltec_vbat();          // volts
int   heltec_battery_percent(float v = -1);  // 0–100 from LiPo discharge curve
```

We add a `BATTERY` page to the OLED, and on every page show a small `[bat ##%]` indicator in the header. The status text becomes `LOW_BATT` when `vbat < 3.4 V`.

> **Accuracy:** ESP32-S3 ADC + the Heltec divider has ~±5% real-world accuracy out of the box (no per-board calibration). Plenty good for go/no-go and the LiPo curve.

### 6.2 Low-Battery Guard

```cpp
if (vbat < 3.10 V) {
    // Imminent brown-out. Save state, shut down cleanly.
    display.clear();
    display.drawString(0, 24, "LOW BATT — SLEEP");
    display.display();
    delay(1000);
    heltec_deep_sleep();   // never returns; wakes on next power cycle
}
```

This prevents the firmware from "fading out" via brown-out cycling.

### 6.3 OLED "Always Show Something" (answers user's other question)

The current firmware fully blanks the OLED after `OLED_TIMEOUT_SEC` (default 10 s). To you it looks like the device went off — and pressing the PRG button should wake it, but if you missed that detail or the button is awkward, you might assume the device died.

**Change:** after timeout, don't blank. Switch to a **minimal screen**: device name + battery % + uptime, drawn at low contrast (`display.setContrast(30)` instead of 255). The screen is always alive enough to see, and the average power saving is ~70% of "full screen on".

```cpp
if (millis() - _lastActivity > OLED_TIMEOUT_SEC * 1000UL) {
    if (_minimalMode != true) {
        _minimalMode = true;
        display.setContrast(30);
    }
    // render only the minimal status: NAME + BATT + UPTIME
}
```

PRG button still cycles pages and resets the timeout. The user always sees signs of life.

### 6.4 NODE_ID Compile-Time Define

Add to `platformio.ini` build flags (injected by `firmware/deploy.py` from `.config.nodes.yaml`):

```ini
build_flags = -DNODE_ID=0x01    ; server
```

The firmware uses `NODE_ID` only for the OLED "BLE" page label, e.g. `Ttnc-Server [01]`. The framing itself is enforced in software — but having it embedded helps debugging.

### 6.5 No backward-compat with v1

This is a hard cutover. The firmware boots into v2 framing only and the bridge only accepts v2 frames (`T2|…` magic). The old v1 plaintext path (`titanic:scene:sunset`, `T|…`) is **not** supported on this branch — supporting both would double the test surface and create a downgrade path for the AEAD layer. Any node still on v1 firmware is incompatible with this bridge and must be re-flashed via `firmware/deploy.py`.

The USB-CDC line shape between firmware and host (`RX:<payload>:RSSI=<r>:SNR=<s>` with `\n` outbound) is unchanged — that's what keeps the firmware itself a pure byte relay regardless of framing version. Only the on-air contents differ.

---

## 7. Raspberry Pi Bridge

### 7.1 Process Layout

```
                ┌───────────────────────────┐
USB ────────────►│ radio_bridge.py          │──── HTTP/REST ────►  MarsinEngine
(server radio)   │                          │      (port 6968)
                │ - frame parser           │
                │ - ACL                    │──── WebSocket  ────►  MarsinEngine
                │ - command translator     │      (param updates)
                │ - status publisher       │
                │ - replay queue           │
                └───────────────────────────┘
```

### 7.2 Implementation Sketch

```python
# control_podium/comms/bridge.py
class Bridge:
    def __init__(self, radio_port, engine_url, acl_path):
        self.radio = radio_port               # RadioPort instance
        self.engine = EngineClient(engine_url)
        self.acl = AclTable.load(acl_path)
        self.status_pub_task = None

    async def run(self):
        await asyncio.gather(
            self._rx_loop(),
            self._status_publisher(),
        )

    async def _rx_loop(self):
        async for frame in self.radio.recv_frames():
            await self._handle(frame)

    async def _handle(self, frame):
        if not self.acl.allow(frame.src, frame.typ):
            return self._reply_nak(frame, "acl_denied")
        if frame.typ == "cmd":
            ok, info = await self._dispatch_cmd(frame)
        elif frame.typ == "qry":
            ok, info = await self._dispatch_qry(frame)
        elif frame.typ == "pin":
            return self._reply(frame, "pon", "")
        elif frame.typ == "hlo":
            self.acl.touch(frame.src)
            return self._reply(frame, "ack", "welcome")
        if frame.flags & ACK_REQUESTED:
            self._reply(frame, "ack" if ok else "nak", info)

    async def _status_publisher(self):
        while True:
            interval = self._adaptive_interval()  # 5 or 30s
            arg = await self.engine.compact_status()
            self.radio.send(Frame(src=SERVER_ID, dst=BROADCAST, typ="pub", arg=arg))
            await asyncio.sleep(interval)
```

### 7.3 Engine Client

Thin wrapper around the existing MarsinEngine REST API (already documented in §11 of `15_central_param_center_cpc.md` and the engine README):

```python
class EngineClient:
    def __init__(self, base_url: str = "http://127.0.0.1:6968",
                 timeout_s: float = 2.0): ...
    async def set_pattern(self, name):       ...  # PUT /pattern
    async def set_param(self, key, value):   ...  # POST /param-center
    async def set_blackout(self, state):     ...  # POST /global-blackout
    async def compact_status(self) -> str:   ...  # GET /status + /param-center → compact arg
    # ...

    @classmethod
    async def discover(cls, urls, *, probe_timeout_s=1.0,
                       call_timeout_s=2.0) -> "EngineClient":
        """Probe a list of engines and bind to the first reachable one."""
```

Outbound URLs come from `.config.bridge.yaml` (operator-controlled, never radio-controlled), restricted to `http`/`https`. The bridge is a single-engine client at any moment, but **the engine doesn't have to live on the bridge box**: in the Burning Man rig the Pi runs the bridge while the engine and simulation live on a beefier machine elsewhere on the LAN (canonical ports come from `simulation/config.yaml`: `marsin_engine_port=6968`, `http_port=6969`).

#### Engine URL — multi-target / discovery

`.config.bridge.yaml` accepts a primary `engine.url` plus an optional `engine.fallback_urls` list. At startup the bridge probes them in order via `GET /status` (1 s timeout each) and binds to the first that responds; the rest are kept on the side for reference. If the primary is reachable it always wins; if it's not, the first reachable fallback is promoted with a clear log line. CLI `--engine URL` overrides everything (no discovery — operator was explicit).

```yaml
# .config.bridge.yaml — production rig: engine on a LAN box, fallback to local
engine:
  url: "http://10.1.1.172:6968"        # main rig
  fallback_urls:
    - "http://127.0.0.1:6968"          # bring-up on the laptop
  timeout_s: 2.0
```

> [!NOTE]
> "Discovery" today is a config-driven probe-and-pick — explicit, reviewable, no surprises. A future enhancement (out of scope for v2) would be true mDNS / Bonjour discovery of `_marsin-engine._tcp` services on the LAN, which would let the bridge auto-find the engine even if its IP moves. For now the static list is enough: when the engine moves, edit the YAML and restart the bridge. Multiple engines for failover (e.g. main rig + cold-spare laptop) is supported as-is via `fallback_urls`.

### 7.4 Failure Modes

| Mode                          | Bridge behavior                                                |
|-------------------------------|---------------------------------------------------------------|
| Engine offline / 5xx          | Reply `nak engine_error`. Status pub emits `down/1`.          |
| Engine timeout                | 2 s deadline → `nak timeout`.                                  |
| Radio port closed             | Bridge exits with error log so systemd / launchd restarts it.  |
| Bad frame (parse fail)        | Drop silently, increment `parse_errors` counter.               |
| Duplicate `seq` from same src | First wins. Duplicate gets the SAME `ack` (idempotent).        |

---

## 8. Companion Apps (Replaces iPad Prototype for Now)

For v2 development we **do not** touch CaptainPad. We extend the `control_podium/companions/` pattern instead. Once the protocol is stable, the same logic ports into `CaptainPad/utils/api.ts` plus a BLE bridge module.

### 8.1 The Two Apps That Run In Production

| File                                | Purpose                                                  |
|-------------------------------------|----------------------------------------------------------|
| `companions/client_companion.py`    | Captain or crew client — interactive CLI on the operator laptop. Holds the AEAD codec; the Heltec is a pure byte relay. |
| `companions/bridge_companion.py`    | Runs on the server-side host (Pi or laptop). Talks USB-CDC ↔ Heltec, executes the ACL + allowlist, calls the LAN MarsinEngine. |

The other Python entry points (`mesh_demo.py`, `hil_companion_demo.py`, `hil_secured_demo.py`) are dev-only acceptance harnesses; see `companions/README.md`.

### 8.2 Client Companion UX

```
$ python -m companions.client_companion --node-id 0A --role captain

  CLIENT COMPANION (NODE 0A sina, role=captain)
  ─────────────────────────────────────────────
  bus: sim   bridge: ✅   server: ✅   last_pub: 1.2s ago
  engine: fps=40 pat=sunset sp=0.7 br=100 blk=0

  client>  /qry engine/status
  ⇨ T2|0A|01|42|qry|1|0000000000A1|<b64>|<tag>
  ⇦ T2|01|0A|42|rep|0|0000000004C7|<b64>|<tag>
     → fps/40,pat/sunset,sp/0.7,br/100,blk/0,upt/3611

  client>  /cmd pattern/breathing
  ⇨ T2|0A|01|43|cmd|1|0000000000A2|<b64>|<tag>
  ⇦ T2|01|0A|43|ack|0|0000000004C8|<b64>|<tag> → ok

  client>  /cmd param/speed/0.5
  ⇨ T2|0A|01|44|cmd|1|0000000000A3|<b64>|<tag>
  ⇦ T2|01|0A|44|ack|0|0000000004C9|<b64>|<tag> → ok

  client>  /sub pub
  (subscribing to broadcasts...)
```

Captain (`role=captain`) gets `/cmd`, `/qry`, `/ping`. Crew (`role=crew`) loses `/cmd` (the bridge will `nak acl_denied`). The wire shows v2 frames; the companion prints the cleartext arg below each frame for human-readability.

### 8.3 Bridge Companion

```
$ python -m companions.bridge_companion --bus sim --engine http://10.1.1.172:6968

  BRIDGE (server node 0x01)
  ─────────────────────────
  engine: http://10.1.1.172:6968 ✅
  acl:    7 nodes loaded (.config.nodes.yaml)
  cmds:   6 entries loaded (.config.commands.yaml)
  secret: marsin_engine/secret.yaml ✅
  status_pub: every 5s (clients active)

  [09:01:02] RX  T2|0A|01|42|cmd|1|… → pattern/sunset
  [09:01:02]    ↳ PUT /pattern { pattern: sunset } → 200
  [09:01:02] TX  T2|01|0A|42|ack|0|… → ok

  [09:01:07] PUB T2|01|FF|99|pub|0|… → fps/40,pat/sunset,sp/0.7,...

  [09:01:09] RX  T2|0B|01|01|hlo|0|… → name/misha,role/captain
  [09:01:09]    ↳ acl: 0x0B is captain ✅
  [09:01:09] TX  T2|01|0B|01|ack|0|… → welcome
```

---

## 9. Hardware-Free Development: The Simulated Radio Bus

We need to build and test this whole stack right now, with **no Heltec hardware in the loop**. The strategy is a swappable transport:

```
                          ┌─────────────────────────┐
                          │       RadioPort         │  (abstract)
                          │  .send(frame)           │
                          │  .recv_frames()         │
                          └────┬───────────────┬────┘
                               │               │
                ┌──────────────▼──────┐  ┌────▼──────────────────┐
                │ RadioPortSim         │  │ RadioPortSerial       │
                │ - TCP client to bus  │  │ - serial.Serial wrap  │
                │ - on sim_bus.py      │  │ - same RX:/TX format  │
                └──────────────────────┘  └───────────────────────┘
                                                      │
                                              (USB → real firmware)
```

### 9.1 `sim_bus.py` — Broadcast Hub

A tiny TCP server. Each "radio" connects. Every line received from one connection is echoed to all others (the shared LoRa medium). Optional impairments: drop probability, added latency, RSSI/SNR fake values.

```bash
$ python -m comms.sim_bus --port 7100 --drop 0.02 --latency-ms 50

  SIM RADIO BUS  (port 7100)
  drop=2%  added_latency=50ms
  [09:00:00] node 01 (server) connected
  [09:00:01] node 0A (sina)   connected
  [09:00:01] 0A → ALL: T2|0A|01|42|cmd|1|<ctr>|<b64>|<tag>    (delivered to 1)
  [09:00:01] 01 → ALL: T2|01|0A|42|ack|0|<ctr>|<b64>|<tag>    (delivered to 1)
```

### 9.2 `RadioPortSim`

Implements the same interface as the production `RadioPortSerial`. The bridge, server radio sim, and clients all use the same class via dependency injection. Swap `--bus sim` for `--bus serial` and the same code talks to real hardware.

### 9.3 `RadioPortSerial` and the Firmware

For production, the bridge talks to the real firmware over USB-CDC. The protocol on the wire (USB serial) stays the v1 shape:

| Direction       | USB serial line                                  | Frame on LoRa                             |
|-----------------|--------------------------------------------------|-------------------------------------------|
| Bridge → server | `T\|01\|FF\|99\|pub\|0\|fps/40,...\n`            | (firmware transmits string verbatim)      |
| Server → bridge | `RX:T\|0A\|01\|42\|cmd\|1\|pattern/sunset:RSSI=-50:SNR=10.0` | (firmware received the LoRa string)        |

The `RadioPortSerial` adapter:

- On TX: writes the frame string + `\n` to the serial port (firmware already accepts this).
- On RX: reads lines, runs them through the **upgraded** `serial_parser.parse_rx_line()` (which now uses regex to handle `:` correctly), and yields `Frame` objects parsed from the payload.

### 9.4 Where the Sim Lives in the Repo

```
control_podium/
├── comms/
│   ├── __init__.py
│   ├── frame.py              # Frame v2 dataclass, encode/decode, types, flags
│   ├── secure.py             # AES-128-GCM codec; loads marsin_engine/secret.yaml
│   ├── replay.py             # Per-source replay-window state
│   ├── radio_port.py         # Abstract port
│   ├── radio_port_sim.py     # TCP client to sim_bus
│   ├── radio_port_serial.py  # serial.Serial wrapper (production)
│   ├── sim_bus.py            # TCP hub for sim_radio
│   ├── acl.py                # NodeID lookup, role checks
│   ├── registry.py           # Loader for .config.commands.yaml allowlist
│   ├── bridge.py             # Translator: frame → engine REST + status pub
│   ├── engine_client.py      # MarsinEngine REST client (Python)
│   └── README.md
├── companions/
│   ├── client_companion.py   # Captain / crew interactive client
│   ├── bridge_companion.py   # Server-side bridge runtime
│   ├── mesh_demo.py          # Hardware-free multi-client acceptance demo
│   ├── hil_secured_demo.py   # HIL acceptance: secured channel through real radios
│   ├── hil_companion_demo.py # HIL acceptance: full captain → bridge → engine flow
│   └── README.md
├── firmware/
│   ├── platformio.ini
│   ├── deploy.py             # MAC-locked role-aware flasher (.config.nodes.yaml)
│   ├── README.md
│   └── src/{podium_tx,server_rx}/main.cpp
├── .config.nodes.yaml        # Node ID + USB MAC → role mapping (committed)
├── .config.commands.yaml     # cmd/qry allowlist with per-cmd role gating
└── .config.bridge.yaml       # Bridge config: engine URL(s), pub interval, security
```

The shared AEAD secret lives outside this directory — `marsin_engine/secret.yaml` (gitignored) is the single source of truth shared with the engine and any future CaptainPad app.

---

## 10. End-to-End Bring-Up

Goal: from a cold checkout, get this running. Two flavors are supported and both are part of the verification path:

* **Hardware-free (sim radio):** fastest dev loop, no Heltecs needed. Uses `sim_bus.py` as the airwaves.
* **HIL (real radios):** what we actually deploy. Uses two paired Heltecs over USB-CDC.

```
  MarsinEngine (10.1.1.172:6968 in production) ◀──── HTTP/WS ────┐
                                                                 │
  Simulation (browser, optional)                                 │
        ▲                                                        │
        │ sACN                                                   │
        │                                                        │
  bridge_companion.py ◀── airwaves ──────── client_companion.py × N
        ▲                                          ▲
        │   sim: TCP via sim_bus.py                │
        │   HIL: USB-CDC ↔ paired Heltecs          │
```

### 10.1 Terminal Choreography (sim radio)

```bash
# T1: simulated radio bus
python -m control_podium.comms.sim_bus --port 7100

# T2: MarsinEngine (in production this lives on 10.1.1.172)
cd marsin_engine && node engine.js --pattern rainbow --model test_bench

# T3: simulation (optional, for visual feedback)
cd simulation && npm start

# T4: the bridge — talks to bus + engine
PYTHONPATH=. python -m control_podium.companions.bridge_companion \
    --bus sim --bus-port 7100 \
    --engine http://10.1.1.172:6968 \
    --node-id 01

# T5: captain client
PYTHONPATH=. python -m control_podium.companions.client_companion \
    --bus sim --bus-port 7100 \
    --node-id 0A --role captain

# T6: crew (read-only) client
PYTHONPATH=. python -m control_podium.companions.client_companion \
    --bus sim --bus-port 7100 \
    --node-id 10 --role crew
```

Each terminal runs one process. Stopping any one shouldn't crash the others (the bridge auto-reconnects, the bus tolerates disconnects). All companions read `marsin_engine/secret.yaml` at startup and refuse to run without it.

### 10.2 Terminal Choreography (HIL — real radios)

```bash
# T1: ensure both Heltecs are flashed and MAC-paired
PYTHONPATH=. python -m control_podium.firmware.deploy --status   # shows pairings
PYTHONPATH=. python -m control_podium.firmware.deploy --role server  # if needed
PYTHONPATH=. python -m control_podium.firmware.deploy --role captain # if needed

# T2: MarsinEngine on the rig
ssh rig "cd marsin_engine && node engine.js --pattern rainbow --model test_bench"

# T3: bridge against the SERVER Heltec on USB
PYTHONPATH=. python -m control_podium.companions.bridge_companion \
    --bus serial --serial-port /dev/cu.usbserial-SERVER \
    --engine http://10.1.1.172:6968 \
    --node-id 01

# T4: captain against the CLIENT Heltec on USB
PYTHONPATH=. python -m control_podium.companions.client_companion \
    --bus serial --serial-port /dev/cu.usbserial-CAPTAIN \
    --node-id 0A --role captain

# T5 (optional): the canned end-to-end HIL test
PYTHONPATH=. python -m control_podium.companions.hil_companion_demo
```

### 10.3 Acceptance Tests (both flavors)

1. `/cmd pattern/breathing` from 0x0A (captain) → engine pattern changes → simulation shows breathing → next `pub` shows `pat/breathing`.
2. `/cmd pattern/breathing` from 0x10 (crew) → bridge replies `nak acl_denied`.
3. `/qry engine/status` from 0x10 (crew) → bridge replies `rep ...` with status — read-only is allowed for any role.
4. `/cmd param/speed/0.5` from 0x0A → engine `/param-center` reflects speed=0.5 → simulation pattern updates → next `pub` shows `sp/0.5`.
5. Kill engine. From 0x0A do `/cmd pattern/x`. Bridge replies `nak engine_error`. `pub` shows `down/1`.
6. Restart the captain client (counter resets to 0) → bridge accepts the new `hlo` re-anchoring per §3.6.5; subsequent commands flow.
7. Tamper one byte of a captured `T2|…` frame on the wire (sim only) → bridge silently drops and increments `bad_tag_count`.

The sim variants are `tests/test_comms_e2e_sim.py`. The HIL equivalents live in `companions/hil_companion_demo.py` and `companions/hil_secured_demo.py`.

---

## 11. Migrating to Real Hardware

When we get the Heltecs back:

1. Flash the v2 firmware (battery readout + minimal-screen + NODE_ID define).
2. Run the same bridge with `--bus serial --serial-port /dev/ttyUSB0`.
3. Run the same clients on Heltec clients (still going through their own `--bus serial`).
4. Everything else stays identical. The transport swap is one CLI flag.

> [!IMPORTANT]
> Step 2 means the **Pi connects to the SERVER radio via USB**, and the SERVER radio sends/receives LoRa frames. The Pi doesn't need its own LoRa radio. The "client side" Heltecs each connect to a phone/iPad (BLE) and a Heltec client radio is what's on-air.

For BLE between phone and client radio, we re-use the existing `titanic_ble.h` GATT layout. The phone writes frames to the Command characteristic; the radio transmits them. Reads come back via Last-RX notifications (and we add a new "RX-stream" notify characteristic so the phone gets all `pub` broadcasts). The full dual-transport behavior of CaptainPad is specified in §15 below — radio is **the fallback**, not the only path.

---

## 12. Battery Question — Definitive Answer

The user's specific concern: *"the batteries were super full and they still go off after a few minutes — could it be that the screen goes off and we don't use buttons to bring them back on?"*

There are two distinct phenomena that look identical:

### A. The screen is blank but the device is alive

The firmware's `OLED_TIMEOUT_SEC` (default 10 s) blanks the OLED but the MCU keeps running. The PRG button wake-handler exists and works:

```cpp
attachInterrupt(digitalPinToInterrupt(PRG_BTN), _onBtnISR, FALLING);
// ...
if (_btnPressed) {
    if (!_screenAwake) { _lastActivity = millis(); _displayDirty = true; }
    else { _currentPage = (_currentPage + 1) % NUM_PAGES; ... }
}
```

So pressing PRG should wake the screen. If it doesn't, the most likely causes are:

- The button mechanically misses (Heltec PRG is sensitive). Press firmly.
- The screen *is* waking but you're not noticing (full-page render flickers in for ~1 frame then the new page draws).

**Easy way to check**: while "off", listen to USB serial — if you see periodic `BLE: …` lines or BLE clients reconnect, the device is alive.

### B. The device is actually powered down

Same root cause as before — LDO drops out under load even with a "full" battery, because:

- A cheap 250–500 mAh cell can't deliver 120 mA TX peaks without sagging. "Full" voltage at idle (4.2 V) drops to 2.9 V mid-pulse → brown-out → reset → if voltage hasn't recovered → off.
- "A few minutes" is consistent with this if you're transmitting frequently and the cell is small/old.

USB always saves you because 5 V → onboard buck → no sag.

### Why I'm changing both

We don't yet know which one you're seeing. The v2 firmware fixes BOTH:

1. **Minimal-screen mode** instead of full blank → if it's the screen issue, you'll see live battery % and uptime ticking up, and you'll know it's alive.
2. **Battery readout + low-batt deep-sleep** → if it's the brown-out, you'll see voltage drop in real time *and* the device shuts down cleanly instead of brown-out cycling. Plug USB → back on, all expected.

Run with the v2 firmware on a fresh cell. If the screen stays dim with reasonable battery % over 5–10 min, you have the screen UX answer. If voltage tanks fast → it's the battery / TX power combo and we should drop TX power on battery (a one-line change).

---

## 13. Dual-Transport CaptainPad — Wi-Fi Primary, Radio Fallback

At Burning Man, the CaptainPad iPad will sometimes be **on the camp Wi-Fi** (line-of-sight to the AP, full features) and sometimes **out on the playa** (only the BLE→radio path is reachable). The app should handle both transparently, with a clear feature gate so the operator knows what they can and can't do.

> [!IMPORTANT]
> The wire protocol (§3) is the **radio path**'s on-air format. The Wi-Fi path keeps using direct HTTP/WebSocket to MarsinEngine — no framing changes. The two transports do the *same thing* (read engine state, send commands) but through wildly different bandwidth and latency budgets.

### 13.1 The Two Paths

```
                    ┌─────────────────────────────┐
                    │           CaptainPad         │
                    │                              │
                    │  TransportController         │
                    │   - probes Wi-Fi every 5s    │
                    │   - decides current path     │
                    │   - exposes capabilities()   │
                    │                              │
                    │ ┌────────────┐ ┌──────────┐ │
                    │ │ WifiClient │ │ BleRadio │ │
                    │ │ (existing  │ │ (new)    │ │
                    │ │  api.ts)   │ │          │ │
                    │ └─────┬──────┘ └────┬─────┘ │
                    └───────┼─────────────┼───────┘
                            │             │
                  Wi-Fi/Ethernet         BLE GATT
                            │             │
                  ┌─────────▼──┐  ┌───────▼──────────┐
                  │MarsinEngine│  │  Heltec Client   │
                  │ port 6968  │  │      Radio       │
                  └────────────┘  └─────────┬────────┘
                                            │ LoRa
                                            ▼
                                  Heltec Server Radio
                                            │ USB
                                            ▼
                                       Raspberry Pi
                                            │ Ethernet
                                            ▼
                                       MarsinEngine
                                       (same as Wi-Fi target)
```

The radio path adds ~50–200 ms of latency, has a ~250 byte effective payload per frame, and is half-duplex with no retries except what we build in software. Wi-Fi is essentially "free": <5 ms RTT, 1500-byte MTU, full TCP.

### 13.2 Transport State Machine

The app sits in one of four states. Transitions are driven only by the periodic Wi-Fi probe and BLE link state — there's no manual switch.

| State            | Condition                                             | UI banner                       |
|------------------|-------------------------------------------------------|---------------------------------|
| `wifi_online`    | `GET /status` returns 200 within 3 s                  | (no banner)                     |
| `radio_only`     | Wi-Fi probe failed AND BLE is connected               | "RADIO MODE — limited commands" |
| `wifi_unreachable` | Wi-Fi probe failed AND BLE is not connected           | "OFFLINE — check Wi-Fi or BLE"  |
| `transitioning`  | Wi-Fi was online but missed a probe; waiting one more | (spinner; no functional change yet) |

Probe cadence is 5 s when in `wifi_online`, 2 s when in `radio_only` (we want to *promote* back to Wi-Fi quickly when it returns). A single missed probe drops to `transitioning`; two consecutive misses drop to `radio_only` / `wifi_unreachable`.

### 13.3 Capability Tiers

Every CaptainPad feature declares which transports it supports. The transport controller exposes a `capabilities()` set; UI components subscribe and disable / hide controls that aren't currently available.

| Feature                                  | Wi-Fi | Radio | Notes                                                                |
|------------------------------------------|:----:|:----:|---------------------------------------------------------------------|
| **Status display** (pat / br / blk / ap) | ✅   | ✅   | Free over radio via `pub` broadcasts.                               |
| **Pattern change**                       | ✅   | ✅   | `cmd pattern/<name>`. Patterns by name only.                         |
| **CPC param change** (slider, toggle)    | ✅   | ✅   | `cmd param/<key>/<value>`. One numeric value per command.            |
| **Global blackout**                      | ✅   | ✅   | `cmd blackout/0\|1`.                                                 |
| **Global effect toggle**                 | ✅   | ✅   | `cmd fx/<name>/<0\|1>`.                                              |
| **Master brightness fader**              | ✅   | ✅   | `cmd brightness/<0-100>`. We throttle to ≤2 frames/s in radio mode.  |
| **Autopilot on/off**                     | ✅   | ✅   | `cmd autopilot/0\|1`.                                                |
| **Mixer channel fader**                  | ✅   | ❌   | Removed from the radio surface — was `cmd mixer/<id>/fader/<v>`. The web UI keeps per-channel mixing; over radio the master fader is sufficient. |
| **Pattern list (full)**                  | ✅   | ⚠️   | Radio returns first ~200 bytes truncated. Use Wi-Fi for the full list. |
| **Add / remove mixer channel**           | ✅   | ❌   | Mixer schema is too rich for one frame.                              |
| **Live pattern code edit / save**        | ✅   | ❌   | Pattern source is kilobytes; do not even try.                        |
| **Per-fixture dimmer rack**              | ✅   | ❌   | Hundreds of channels at >1 Hz. Bandwidth-prohibitive.                |
| **Section brightness (all sections)**    | ✅   | ❌   | Similar.                                                              |
| **Scene / model swap**                   | ✅   | ❌   | High-risk operation; require Wi-Fi.                                  |
| **Export pattern code / config**         | ✅   | ❌   | Multi-kilobyte responses.                                            |

UI rules:

1. **Disable, don't hide.** Greying out a control + tooltip "needs Wi-Fi" is much better than removing the control and confusing the operator about what disappeared.
2. **Show last known state.** The `pub` broadcast (§5) keeps the radio-only client's status displays alive. The fader thumbs still snap to the most recent `pub`, even though the user can't drag them to anything not in the allowlist.
3. **Throttle in radio mode.** Sliders that are released-only on Wi-Fi must additionally be debounced in radio mode. The bridge already does duplicate-`seq` ACK collapsing (§7.4) so an aggressive user-drag won't spam the engine, but it will burn airtime.

### 13.4 Per-Component Wiring

`utils/api.ts` already has the Wi-Fi calls. The minimum change to integrate radio fallback (when CaptainPad work resumes — **deferred until after companions stabilize**) is roughly:

```ts
// New: utils/transport.ts
type TransportState = "wifi_online" | "radio_only" | "wifi_unreachable" | "transitioning";

interface Transport {
  state: TransportState;
  capabilities(): Set<FeatureCap>;
  // Same return shape as the existing api.ts methods, dispatches to either path
  setPattern(name: string): Promise<ApiResult<any>>;
  setParam(key: string, value: number): Promise<ApiResult<any>>;
  setBlackout(state: boolean): Promise<ApiResult<any>>;
  // ... etc, all the ones marked ✅ for radio
  // wifi-only methods exist but throw if state != wifi_online
  setPatternCode(name: string, code: string): Promise<ApiResult<any>>; // wifi-only
}
```

Each component reads `transport.capabilities()` and disables controls accordingly. The transport's `setPattern` internally chooses Wi-Fi or radio.

### 13.5 BLE GATT Service for the Radio Path

The existing `titanic_ble.h` already has a Command characteristic (Write) and a Last-RX characteristic (Notify). For dual-transport CaptainPad we need three small extensions:

1. **A new "Frame TX" Write characteristic.** Phone writes already-encrypted Titanic Frame v2 strings (`T2|…`) here; the firmware transmits each line via `radio.transmit()` verbatim. We do not reuse the existing command char (it predates the AEAD work and would have to learn new validation rules).
2. **A new "Frame RX stream" Notify characteristic.** Notifies for **every** valid Titanic frame received off-air, including broadcast `pub`s. The existing Last-RX only updates on the latest message, which is too lossy for a status stream.
3. **A small "link health" Read characteristic.** Returns last RSSI, link active flag, queued TX count. Used by the iPad to surface "weak radio link" warnings.

All three are on the same service UUID as the existing GATT — they're additive. The radio firmware itself does no per-frame parsing; it remains a transparent byte relay. The framing/ACL all lives on the iPad (or whichever host is driving it). Per §3.6.8b the **preferred** integration has the iPad doing the AEAD before the BLE write, so the firmware never needs the secret. **None of this changes the iPad app yet** — it's the integration hook for after the host-side companions stabilize.

### 13.6 Failure Modes (CaptainPad side)

| Mode                                  | Behavior                                                                 |
|---------------------------------------|--------------------------------------------------------------------------|
| Wi-Fi drops mid-session               | Probe fails twice → state → `radio_only`. Pending wifi-only requests reject locally with `wifi_required`. Radio-friendly requests get rerouted. |
| BLE drops while in `radio_only`       | State → `wifi_unreachable`. UI banner. Status displays freeze on last known. |
| `nak engine_error` over radio         | Same as wifi 5xx — surface "engine error" toast. Auto-retry once with backoff. |
| `nak acl_denied` over radio           | Surface "not authorized" toast. This is a config issue — make it visible. |
| Radio TX timeout (no ACK in 4 s)      | Surface "no link" toast, mark state as suspicious; next probe re-evaluates. |
| Pubs stop arriving for >3× short_interval | Surface "stale status" indicator on each value chip. Don't blank the UI. |

### 13.7 What We Don't Want To Do

- **No silent dropdown of features.** Every disable has a visible reason.
- **No background queueing of wifi-only writes to "replay later".** Too easy to surprise the operator with a delayed command. Wifi-only is wifi-only; user gets a clear error and has to retry when Wi-Fi returns.
- **No auto-merging of identical commands.** The bridge's idempotent ACK collapsing (§7.4) takes care of dedupe at the transport level; the app should still send the deliberate user action.

---

## 14. Battery Investigation Plan (next time hardware is in the loop)

The v2 firmware already addresses both candidate root causes (LDO brown-out vs. blank-screen UX). The plan to **finalize** the answer when you can run a Heltec again:

1. **Bench test, fresh full cell.** Flash v2. Plug a known-good fully charged LiPo. Don't connect USB. Note the OLED BATT page's voltage at t=0.
2. **Idle observation.** Leave the device on bench for 5–10 minutes. The minimal-screen heartbeat should keep ticking the whole time. Read the voltage again at the end.
   - If voltage > 3.7 V and device is alive → **screen-only UX issue confirmed**. The original "device off" perception was the screen blanking too aggressively. v2 already fixes this.
   - If voltage < 3.5 V or device entered the LOW BATTERY → SLEEP screen → **brown-out is the real cause**. Move to step 3.
3. **TX load test.** Drive the firmware with a steady cmd-flood from the bridge over USB (~10 frames/s). Watch the BATT page voltage. If voltage dips below 3.4 V quickly, the cell can't supply the LoRa TX peaks; lower TX_POWER on battery is the fix.
4. **TX power throttle (if step 3 triggers).** One-line firmware change: drop `TX_POWER` to 14 dBm when `_battVolts < 4.0 V` (i.e. when not on USB). Rebuild and retest.
5. **Document the result.** Update §12 with the actual measured answer, prune the speculation.

We are explicitly **not** doing step 4 preemptively — it costs ~15 dB of link margin we may need at burn distance, and we don't yet know we need it. Decide based on measurement.

---

## 15. Open Questions

1. **Channel sharing with the v1 operator podium link.** v1 operator ↔ server is bare. v2 is the only path on this branch; if we ever resurrect a v1 cohort we'll either give them their own LoRa channel or put a v1↔v2 shim on the bridge. Currently: not planned.
2. **Cryptographic auth.** ~~Worth doing?~~ **Decided: yes — see §3.6.** Pre-shared AES-128-GCM with per-sender 48-bit counter and replay window. The remaining open piece is per-node keys (vs the single shared key v2 ships with) so that a single compromised node doesn't taint the rest of the camp. That's a small KDF on top of the same machinery; deferred until we have a real reason (e.g. handing a Heltec to someone outside the trust circle).
3. **Mesh routing.** Out of scope for v2 — single-hop only. If we want multi-hop coverage (so a client behind a structure can reach the server via a third client), we either pick Meshtastic for the comms tier or add a small flooding layer. Defer.
4. **Persistence on the bridge.** Should the bridge remember last-seen state per client (last RSSI, last `hlo`)? Probably yes, for `/status` debug. Cheap.
5. **Pacing in the captain UI.** Cooldowns and slider debouncing are deliberately out of scope for the bridge; the captain companion (and eventually CaptainPad) owns it. When CaptainPad picks this up the design should mirror what `client_companion.py` does (a debounced slider stream, not a spammy event-per-tick).

---

## 16. Action Plan / Milestones

| #  | Milestone                                                                 | State        | Lives in                                                            |
|----|---------------------------------------------------------------------------|--------------|---------------------------------------------------------------------|
| 1  | Frame v2 format + parser + tests                                          | ✅ done     | `control_podium/comms/frame.py`                                     |
| 2  | Sim radio bus + RadioPortSim                                              | ✅ done     | `control_podium/comms/sim_bus.py`, `radio_port_sim.py`              |
| 3  | Bridge + engine client + ACL + adaptive pub cadence                       | ✅ done     | `control_podium/comms/bridge.py`, `acl.py`, `engine_client.py`      |
| 4  | Two-app companions (bridge + interactive captain/crew client)             | ✅ done     | `control_podium/companions/{bridge,client}_companion.py`            |
| 5  | Firmware: battery readout, minimal-screen, NODE_ID, low-batt shutdown     | ✅ done     | `control_podium/firmware/src/titanic_common.h`                      |
| 6  | E2E test suite: bus + bridge + fake engine + 2 clients                    | ✅ done     | `control_podium/tests/test_comms_e2e_sim.py`                        |
| 7  | RadioPortSerial: USB-CDC adapter for production                           | ✅ done     | `control_podium/comms/radio_port_serial.py`                         |
| 8  | YAML-driven command allowlist (no cooldowns — pacing is a UI concern)     | ✅ done     | `comms/registry.py`, `.config.commands.yaml`                        |
| 9  | MAC-locked role-aware firmware deploy (`deploy.py`)                       | ✅ done     | `control_podium/firmware/deploy.py`, `.config.nodes.yaml`           |
| 10 | Multi-client mesh demo (sim radio bus, captain + crew, CPC verified)      | ✅ done     | `companions/mesh_demo.py`                                           |
| 11 | **Secured channel: AES-128-GCM v2 frames + `marsin_engine/secret.yaml`**  | ✅ done     | `comms/secure.py`, `comms/replay.py`; HIL-verified                  |
| 12 | HIL secured-channel demo — bridge ↔ LAN engine ↔ real radios              | ✅ done     | `companions/hil_secured_demo.py`                                    |
| 13 | Firmware: non-blocking IRQ-poll RX + non-blocking LED scheduler           | ✅ done     | `firmware/src/{podium_tx,server_rx}/main.cpp`, `titanic_common.h`   |
| 14 | Captain↔bridge HIL integration test (full company flow against engine)    | ✅ done     | `companions/hil_companion_demo.py`                                  |
| 15 | Pi deployment story (systemd unit, USB rules, config layout)              | ⏳ pending  | `control_podium/comms/deploy/`                                      |
| 16 | BLE GATT service extension on the firmware (frame TX / RX stream chars)   | ⏳ pending  | `control_podium/firmware/src/titanic_ble.h`                         |
| 17 | **CaptainPad dual-transport integration** (per §13)                       | 🛑 deferred | `CaptainPad/utils/transport.ts` (new), component capability gating  |
| 18 | Battery investigation against real hardware (per §14)                     | 🛑 deferred | bench notes                                                          |
| 19 | Per-node keys (lift from camp-wide PSK to per-node)                       | 🛑 deferred | post-burn (see §15 Q2)                                               |
| 20 | **Firmware-side AEAD** — only needed if CaptainPad sends BLE→Heltec→radio without a host companion in the loop | 🛑 deferred | see §3.6.8b |

> [!NOTE]
> Items 17–20 are explicitly deferred. Items 15–16 are the small follow-ons that turn the HIL-ready dev system into a field deployment.

> [!IMPORTANT]
> §3.6.8b "Where the AEAD lives": for the production deployment topology the user is shipping (one **captain companion app** ↔ Heltec ↔ Heltec ↔ **bridge companion app** ↔ LAN MarsinEngine), the AEAD always runs on the host side. The firmware is a dumb byte relay that passes the already-encrypted ASCII frame from USB-CDC to the SX1262 verbatim. That's why item 20 is deferred — moving AEAD into the firmware (or, preferred, into the iPad app) only matters when CaptainPad sends commands directly via BLE→Heltec→radio without a host in the loop, which is the §13.5 fallback mode. As long as a host is in the loop the secured channel is end-to-end already.

---

## 17. Workflow for Future Agents

When picking this up:

1. **Read this doc first**, then `control_podium/README.md` and `control_podium/companions/README.md` for the operator's-eye view. They cover different things; all three are necessary.
2. **Make sure the secret is present.** `marsin_engine/secret.yaml` must exist on every machine that runs an engine, bridge, or captain companion. If it doesn't, copy `marsin_engine/secret.yaml.example` to `marsin_engine/secret.yaml`, edit it, and propagate the SAME content everywhere. Companions refuse to start without it.
3. **Verify the baseline.** Before any change, run:
   ```bash
   cd control_podium
   PYTHONPATH=. ../.venv-dev/bin/python -m companions.mesh_demo -q
   ```
   It must print `ALL CHECKS PASSED — mesh is HIL-ready` and exit 0. If it doesn't, fix that first. When real Heltecs are available, also run `companions.hil_companion_demo` against a live engine.
4. **Prefer YAML over code.** New commands → `.config.commands.yaml`. New nodes / role changes / MAC pairings → `.config.nodes.yaml`. Bridge URLs / pub cadence → `.config.bridge.yaml`. Code only when there's no YAML path.
5. **Add a test with every behavior change.** Pattern: copy a test in `tests/test_comms_e2e_sim.py`, swap the verb, assert the engine state changed (and the wire shape of the reply). 30 lines.
6. **Firmware compile-tests are non-negotiable.** Both `podium_tx` and `server_rx` must build clean after any change in `firmware/`. The Python stack can pretend to work; the binaries must actually build. `firmware/deploy.py` will check the MAC pairing in `.config.nodes.yaml` before flashing anything.
7. **Out-of-scope reminders.** This subsystem deliberately does NOT own: rate limiting / cooldowns (captain UI), fire-effect commands (Flame Effect Controller has its own firmware on its own transport — see FW-SPEC-001), the long-range hardware control surface internals (separate program; once it ships it joins the mesh as a captain-role client driving the same `cmd` allowlist). Don't reintroduce them here.
8. **Never commit `marsin_engine/states/test_bench/*.yaml`.** They're runtime state files; the engine writes them on every run. They have no business on this branch.

This document is the design. Implementation lands in subsequent commits.
