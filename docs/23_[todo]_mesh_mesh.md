# 23 — Mesh networking (rooted-tree relay)

> **Status:** design — no implementation yet. Target: ~1 week of
> firmware + bridge + PortWatch work (see §11).
>
> **Companion docs:**
> - `docs/22_server_bridge.md` (today's hub-and-spoke architecture)
> - `.agent/00_gol/12_operating_raspberry_pi.md` (server / Pi
>   operational model — unchanged by this design)
> - `control_podium/comms/frame.py` (wire format we're extending)
> - `control_podium/comms/replay.py` (dedup pattern we're porting to
>   firmware)

---

## 0. TL;DR

Today every captain/crew must have **direct LoRa reach** to the
server controller. If a captain walks behind a steel container, it
goes dark.

This design adds **rooted-tree relay**: any node in the mesh can act
as a transparent relay for any other node's server-bound or
server-originated traffic. Concretely:

* **All traffic flows TO or FROM the server** (node `0x01`). In v0
  there is NO leaf-to-leaf messaging. Server remains the single
  point of authority and the single point of failure-by-design.
* **Every captain and crew controller is simultaneously a leaf AND
  a relay** at the firmware level. No special "relay" role. A
  captain being actively used by its operator is also silently
  forwarding another captain's frames.
* **Nodes know about each other** via a **peer roster** maintained
  by the server and broadcast to all leaves. The captain's PortWatch
  surfaces the roster so the operator can see "who else is online"
  — but in v0 this is **informational only**. No leaf-to-leaf
  addressing is enabled.
* **Routing is opportunistic gossip** with TTL + per-node seen-set
  dedup + RSSI-weighted jitter for storm suppression. No
  spanning-tree protocol, no parent election, no neighbor table.
* **Frame payload (AES-GCM ciphertext) is opaque to relays.**
  End-to-end integrity is preserved by the existing v2 codec; relays
  only touch the cleartext header to decrement TTL.

The wire-format change is **one byte** (TTL). Backward compatibility
is intentionally NOT preserved — all firmware on the mesh must be
updated at once.

### v0 scope vs future

| Capability | v0 | Future |
| --- | --- | --- |
| Multi-hop server-bound traffic | ✅ | — |
| Multi-hop leaf-bound traffic | ✅ | — |
| Multi-hop broadcast (PUB) | ✅ | — |
| Peer roster (visible to operator) | ✅ (server-sourced) | self-snooping for resilience |
| Leaf-to-leaf addressing | ❌ | possible — frame format already supports it |
| Leaf-to-leaf messaging UI | ❌ | possible — operator-to-operator chat |
| Automatic profile bootstrap for new nodes | ❌ | scan-profiles-on-silence |

---

## 1. Goals and non-goals

### Goals

1. **Range extension.** A leaf that cannot reach the server directly
   can still issue cmds/qrys and receive replies, as long as some
   other node is in earshot of both.
2. **Self-healing.** When a relay node disappears (battery dies,
   walks out of range), another in-earshot node automatically takes
   over on the next frame. No reconfiguration.
3. **Bounded airtime cost.** A frame that would have used 1×
   airtime in star mode uses at most `N×` in mesh mode, where `N` =
   TTL. We aim for typical `N ≤ 2`.
4. **Captain situational awareness.** The captain's PortWatch shows
   a live roster of all online nodes (other captains, crew) so the
   operator can tell at a glance who's reachable. The roster does
   NOT enable leaf-to-leaf messaging in v0.
5. **Single firmware build per role.** Captain firmware is identical
   whether deployed as a "pure leaf" near the server or as an
   "in-the-field relay" between two other captains. Behavior is
   data-driven (the TTL on each frame), not config-driven.
6. **Bridge architecture unchanged.** The Pi-side server bridge sees
   the same logical traffic it sees today — replay dedup + ACL by
   `src` node id. It does not need to know whether a frame arrived
   directly or via 2 hops.

### Non-goals (v0)

1. **Peer-to-peer messaging between leaves.** Captain A cannot send
   a frame `dst=captain_B`. Every cross-leaf interaction goes
   through the server's application layer. The frame format
   technically supports it but the firmware and ACL reject it.
   Future enhancement; not in v0.
2. **Multi-server / failover.** There is exactly one server (node
   `0x01`). If the server dies, the mesh is dead. The whole rig was
   designed around this premise (Pi is always on, on USB, in the
   road case) — re-architecting it is out of scope.
3. **Dynamic SF/BW per link.** All nodes on a given LoRa profile
   (`test_bench` / `local` / `playa`) transmit and receive at the
   same SF/BW. The profile-switch protocol (`*CFG`) already changes
   it for the whole mesh atomically; this design doesn't replace it.
4. **Authenticated routing.** The TTL field is plaintext and
   mutable by relays (it has to be — relays decrement it). An
   attacker on the LAN could inject high-TTL frames to waste
   airtime. Mitigated by a hard per-node cap on accepted TTL (§7).
5. **Self-discovered peer roster.** v0's roster is server-sourced
   (the bridge knows who's transmitted recently and broadcasts the
   list). Each node trusting the server roster is simpler than
   every node snooping the air independently. A future version could
   add peer-snooping for resilience when the server roster is stale.

---

## 2. Glossary

| Term | Meaning |
| --- | --- |
| **node** | Any device on the LoRa radio: server (`0x01`), captain (`0x0A`, `0x0B`, …), crew (`0x10`, `0x11`, …). |
| **leaf** | A node that ORIGINATES traffic (captain / crew). Every leaf is also potentially a relay. |
| **server** | The node at id `0x01`. The only node a leaf addresses; the only node that originates broadcasts. |
| **relay** | A node that **forwards** a frame it received whose `dst != self && dst != BROADCAST`. Every leaf does this automatically; there is no "relay role" in the ACL. |
| **server-bound** | A frame whose `dst == SERVER_ID (0x01)`. Originated by a leaf. |
| **leaf-bound** | A frame whose `dst` is a specific leaf id. Originated by the server (as a reply to that leaf's qry/cmd). |
| **broadcast** | A frame whose `dst == BROADCAST (0xFF)`. Originated by the server (status PUBs and roster updates). |
| **TTL** | "Time to live" — actually a hop count. New byte in the frame header. Decremented by each relay; dropped at 0. |
| **seen-set** | A per-node short-TTL cache of `(src, ctr)` pairs we've recently relayed or processed, so we don't relay the same logical frame twice. |
| **gossip suppression** | A jittered random delay before relaying, during which we listen for ANOTHER node already relaying the same frame; if heard, cancel our own relay. |
| **peer roster** | The list of `(node_id, role, last_seen_at)` entries the bridge tracks. Broadcast to leaves periodically so each PortWatch can render a "who's online" view. |

---

## 3. Topology and traffic patterns

There are three frame disposition classes for any frame arriving at
any node:

```
              ┌─────────────────────────────────────────────┐
   ARRIVE →   │  decide based on (dst, ttl, seen?)          │
              └─────────────────────────────────────────────┘
                  │                  │                 │
                  ▼                  ▼                 ▼
              ACCEPT             RELAY            ACCEPT + RELAY
              (dst == self)      (dst != self     (dst == BROADCAST
                                  && dst !=        && ttl > 0)
                                  BROADCAST
                                  && ttl > 0
                                  && !seen)
```

### 3.1 Server-bound traffic (LEAF → SERVER)

```
captain_far  ──(ttl=3)──▶  captain_mid  ──(ttl=2)──▶  server
                                        ▲
                                        │  (captain_near also heard
                                        │   the original, but its
                                        │   gossip jitter happened
                                        │   to be longer than
                                        │   captain_mid's so it
                                        │   suppressed its relay)
                                  captain_near
```

* Leaf encodes its frame with `ttl=DEFAULT_TTL` (proposed: 3).
* Any node hearing it whose `dst != self`: enters the relay
  evaluation path (§5.3).
* The server only ever ACCEPTS — never relays — because server is
  always the destination (`dst == SERVER_ID == self`).

### 3.2 Leaf-bound traffic (SERVER → LEAF)

```
server  ──(ttl=3)──▶  captain_mid  ──(ttl=2)──▶  captain_far
```

* Server's reply has `dst=<leaf id>`, `ttl=DEFAULT_TTL`.
* Same relay rules apply; the leaf with `dst==self` accepts (and
  does NOT relay further).
* Asymmetric paths are fine: leaf→server may have gone via
  captain_near, while server→leaf may go via captain_mid. The
  application doesn't notice.

### 3.3 Broadcast traffic (SERVER → all)

```
server  ──(ttl=3)──▶  captain_mid  ──(ttl=2)──▶  captain_far
                       (accept)                    (accept)
                                  ──▶  crew_01
                                       (accept)
```

* Server PUB with `dst=BROADCAST`, `ttl=DEFAULT_TTL`.
* Every node that hears it ACCEPTS it (processes it like a normal
  PUB), AND if not-yet-seen, jitters + relays with `ttl-1`.
* Each hop is gossip-suppressed: if a neighbor already started
  relaying, we suppress our own.

### 3.4 What we explicitly do NOT carry (v0)

* **Leaf → Leaf direct messaging.** The bridge's ACL drops any
  frame with `dst` in the leaf id range. Leaves themselves never
  set `dst` to another leaf — the codec's high-level API doesn't
  expose that capability. Frame format supports it; future v.1 will
  enable.
* **Leaf-originated broadcasts.** Leaves only ever address
  `dst=SERVER`. Broadcasts are exclusively server-originated.
* **Routing tables, link-state advertisements, parent election
  messages.** None of these exist in this design.

---

## 4. Wire format changes

### 4.1 New TTL field

Today's v2 secured frame (`comms/frame.py` + `comms/secure.py`):

```
T2|<src>|<dst>|<seq>|<typ>|<flags>|<ctr_be12hex>:<ciphertext_b64>:<tag_b64>
```

Proposed:

```
T2|<src>|<dst>|<seq>|<typ>|<flags>|<ttl>|<ctr_be12hex>:<ciphertext_b64>:<tag_b64>
                                  ▲
                              new — 2 hex chars (1 byte, 0..15)
```

* Type: `uint8_t`, but only the low 4 bits are used (max TTL = 15).
* Default for new traffic: **3** — see §6 for sizing rationale.
* On the wire: 2 hex characters. Total frame overhead: +3 bytes
  (2 hex + 1 separator).
* Field position: after `flags`, before the encrypted payload. Easy
  to parse and easy for relays to modify without touching the
  payload boundaries.

### 4.2 AAD (Associated Data) — leave TTL OUT

The AES-GCM Associated Data string today is:

```
v=2;src=<hex>;dst=<hex>;seq=<hex>;typ=<typ>;flags=<hex>
```

**Do NOT add TTL to the AAD.** If TTL were in the AAD, every relay
would have to re-encrypt (or break the tag) when decrementing TTL —
which is impossible without the shared secret in firmware, and
unwanted even if possible (we don't want relays to decrypt).

Leaving TTL out of the AAD means:
* Relays can decrement TTL freely without touching the encrypted
  payload. The tag still verifies end-to-end (sender → server).
* Attackers on the radio can modify TTL but cannot modify the
  payload or other header fields without breaking the tag.
* The legitimate TTL of a frame is "best effort, plaintext" — fine
  for our threat model (the radio is already trusted to within the
  shared-key boundary).

### 4.3 Backward compatibility — none

The TTL field is **mandatory** in the new format. A node running
old firmware that receives a new frame will fail the parser and
drop it. A new node receiving an old frame (no TTL field) will also
fail.

This is acceptable because:
1. Profile-switch infrastructure already supports rolling firmware
   updates atomically (`*CFG`-style coordination).
2. There are at most a handful of nodes on any rig; flashing them
   all in one session is operationally normal.
3. Carrying two parser paths forever to support partial upgrades
   would be a permanent tax for a transitional concern.

`firmware/deploy.py --all` already handles the "flash everything in
one shot" workflow. Document it in the release notes: "all
controllers must be on firmware vN.NN+ before deploying to the
field."

### 4.4 Concrete Frame dataclass changes

In `comms/frame.py`:

```python
@dataclass
class Frame:
    src: int
    dst: int
    seq: int
    typ: str
    flags: int
    ttl: int          # NEW — default 1 (no relay) for source compat
    arg: str
```

`Frame.encode()` and `Frame.decode()` gain the TTL field. The bridge
sets `ttl=3` for PUBs and outbound REP/ACK/NAK after Phase 3+;
leaves set `ttl=3` for everything they originate after Phase 2.

---

## 5. Per-node routing logic

The same logic runs on EVERY node — server, captain, crew. The only
data-driven asymmetries are:

| Node type | Originates frames? | Accepts dst=self? | Relays? |
| --- | --- | --- | --- |
| **server** | YES (REP, ACK, NAK, PUB, roster) | YES (it IS dst for all leaf-originated traffic) | NO¹ |
| **captain** | YES (HLO, QRY, CMD, PING) | YES (its own replies + broadcasts) | YES |
| **crew** | YES (HLO, QRY, PING) | YES (its own replies + broadcasts) | YES |

¹ The server doesn't relay because it's always the destination. A
frame whose `dst != server` shouldn't be on a server-bound LoRa link
at all in this design; if one shows up, the server logs and drops.

### 5.1 Frame disposition decision

Pseudocode, called once per incoming frame:

```
function on_lora_rx(frame):
    rssi, snr = radio.getRSSI(), radio.getSNR()

    # 1. Sanity: have we seen this exact (src, ctr) recently?
    #    The ctr is in the cleartext nonce so we can dedup without
    #    decrypting.
    if seen_set.contains(frame.src, frame.ctr):
        stats.relay_dedup_count += 1
        return

    # 2. Stamp seen-set BEFORE anything else. If our subsequent
    #    work crashes / drops the frame, we still won't re-relay it
    #    in the next 30 s.
    seen_set.insert(frame.src, frame.ctr)

    # 3. Decide acceptance.
    is_for_me   = (frame.dst == self.node_id)
    is_broadcast = (frame.dst == BROADCAST)
    if is_for_me or is_broadcast:
        accept_locally(frame, rssi, snr)
        # Falls through — broadcasts also relay.

    # 4. Decide relay.
    is_someone_elses = (not is_for_me)
    can_relay = (frame.ttl > 1)
    if is_someone_elses and can_relay:
        schedule_relay(frame, rssi)
```

A few subtleties:

* `is_for_me` is checked AFTER the dedup. This means the leaf will
  not process the same reply twice if it arrives via two relays.
* Broadcasts (server PUBs) are accepted by everyone AND relayed —
  this is what carries the PUB across the mesh to nodes out of
  direct earshot of the server.
* Server-bound frames (`dst == SERVER`) are not accepted by leaves
  (the server isn't them) — they're relay-only.

### 5.2 Seen-set design

We need a small data structure on each node that answers:
"Have we relayed (or processed) `(src, ctr)` recently?"

The AES-GCM counter (`ctr`, 48 bits) is monotonically increasing per
sender. Combined with `src` (8 bits), `(src, ctr)` uniquely names
every frame that has ever existed on the mesh.

**Simplification:** we only need to track the **highest counter seen
per source**, plus a small "recent history bitmap" for out-of-order
arrivals. This is exactly the design already in `comms/replay.py` on
the Python side. Port it to C:

```c
struct PerSourceWindow {
    uint64_t highest_ctr;       // largest ctr ever seen from this src
    uint64_t bitmap;            // bit i = "have we seen ctr=highest-i?"
    uint32_t last_seen_at_ms;   // monotonic; for GC of unused sources
};

static PerSourceWindow seen_window[256];  // indexed by src node id
```

**Memory cost:** 256 × 24 bytes = 6 KB. Comfortable on the
ESP32-S3's 512 KB SRAM. Most slots will be empty (only allocated
when first frame from that src arrives).

**GC:** every 5 minutes, walk `seen_window[]` and reset entries
whose `last_seen_at_ms` is > 10 minutes old. Frees up the slot if
that source disappears from the mesh.

**Boot semantics:** on fresh boot, all entries are zero. A node that
boots into the middle of a busy mesh will accept and relay the FIRST
frame from every source it hears (because dedup says "never seen
this src before"), regardless of ctr value. This is harmless: at
worst we re-relay one already-in-flight frame; the receiver dedups
anyway via its own seen-set.

### 5.3 Gossip suppression (jittered relay)

When a frame qualifies for relay (§5.1 step 4), we don't transmit
immediately. We:

1. **Compute jitter delay** based on the incoming RSSI:
   ```
   delay_ms = base_ms + jitter_factor * (rssi_floor - rssi)
   ```
   where:
   - `base_ms = 30` (always wait at least this long; gives the
     incoming frame's tail propagation time)
   - `rssi_floor = -130` (worst we can ever hear)
   - `jitter_factor = 1.5` (so RSSI=-100 → +45 ms; RSSI=-130 → 0 ms;
     RSSI=-70 → +90 ms)

   **Stronger receivers wait less.** Rationale: a node that heard
   the source LOUDLY is closer to the source (or has a clearer
   path) and is therefore a better candidate to relay. Weaker
   receivers should hold back and let the better one win.

2. **Add random noise** to break ties between nodes at similar RSSI:
   ```
   delay_ms += random_uniform(0, 30)
   ```
   Prevents two nodes with identical RSSI from transmitting at
   exactly the same time and stomping each other.

3. **Schedule the relay.** During the delay, the node is back in RX
   mode (the post-TX `startReceive()` from the original frame already
   put it there).

4. **Listen for suppression.** If during the delay window we receive
   another copy of `(src, ctr)`, we know another node beat us to the
   relay. Cancel our scheduled transmit. Bump
   `stats.relay_suppress_count`.

5. **Transmit.** If the delay expires without suppression, decrement
   TTL and re-transmit:
   ```
   frame.ttl -= 1
   radio.transmit(reframe_for_relay(line, frame.ttl))
   ```

   `reframe_for_relay()` just rewrites the cleartext TTL field in the
   wire string; the encrypted payload bytes stay identical.

### 5.4 Relay budget caps

To prevent pathological storms or malicious flooding, each node
enforces:

| Cap | Default value | What it prevents |
| --- | --- | --- |
| `MAX_ACCEPTED_TTL` | 5 | An attacker injecting `ttl=15` to force lots of re-broadcasts. Frames arriving with `ttl > MAX_ACCEPTED_TTL` are clamped to `MAX_ACCEPTED_TTL`. |
| `MAX_RELAYS_PER_SECOND` | 8 | A burst storm. If exceeded, additional relays are dropped (with a `RELAY_THROTTLE` log line). |
| `MAX_RELAY_PAYLOAD_BYTES` | 240 | Sanity. Captain firmware's BLE buffer is 250 bytes; if a frame is bigger, it's probably corrupted or from an incompatible build. |

These are compile-time defines so the user can tune per rig.

---

## 6. TTL sizing

### 6.1 Why TTL = 3 by default

We want to support up to **2 relay hops** between a leaf and the
server. That covers:

* Captain → Captain → Server (one relay)
* Captain → Captain → Captain → Server (two relays)

At SF=10/BW=125 each frame takes ~250 ms of airtime. Two relays =
3 transmissions = ~750 ms of LoRa airtime per direction = ~1.5 s
RTT minimum for a multi-hop qry.

TTL=3 means:
* Original transmission: TTL=3, sender uses 3
* First relay: receives at TTL=3, transmits at TTL=2
* Second relay: receives at TTL=2, transmits at TTL=1
* Destination: receives at TTL=1, accepts (TTL=1 is the "don't relay
  further, accept-only" signal)

So TTL=3 → up to 2 relays.

### 6.2 When operators should override

The TTL field is exposed in `Bridge` config (`.config.bridge.yaml`)
and `EngineClient`-side intent for the leaf side. Defaults:

```yaml
mesh:
  default_ttl: 3
  # Outbound traffic from server to leaves uses this TTL; inbound
  # traffic from leaves carries this TTL when they initiate. Set to
  # 1 to disable relay temporarily (useful for benchmarking a known-
  # direct link).
  max_accepted_ttl: 5   # cap for relays accepting "weird" inbound
```

Override to 4 or 5 in deployments where you expect deeper meshes
(e.g. crew spread along a long fence line). Keep it as low as
operationally needed — every increment adds airtime cost on the
worst case.

### 6.3 Server-side: skip relay logic

The server controller is special: it's always the dst of leaf
traffic, and the originator of leaf-bound + broadcast traffic. It
should NEVER relay — its CPU is busy with engine HTTP, USB to the
bridge, and a high PUB cadence. If a frame `dst != server` arrives,
the server firmware drops it with a `MESH_UNEXPECTED_DST` log line
(might indicate a misconfiguration on a leaf).

---

## 7. Security

### 7.1 What an attacker can do

The attacker is assumed to have RF reach to the mesh but NOT the
shared secret in `marsin_engine/secret.yaml`. They can:

* **Sniff:** see every frame on the air. (Already true — LoRa is
  unencrypted at the PHY layer; v2 AES-GCM protects the payload.)
* **Replay:** transmit a previously-recorded frame. Defended by the
  per-source counter window (§5.2 + `comms/replay.py`).
* **Modify TTL:** flip TTL bits before retransmitting. Worst case:
  inject a high-TTL frame to waste airtime. Defended by
  `MAX_ACCEPTED_TTL` (§5.4).
* **Modify other header fields:** breaks the AES-GCM tag because
  they're in the AAD. Receiver drops with `BadTagError`.
* **Modify payload:** same — tag breaks.

### 7.2 What an attacker cannot do

* **Originate a fresh authentic frame.** Requires the shared key.
* **Resurrect old frames past the replay window.** Counter must be
  in the seen-set's recent range; old counters are rejected with
  `REPLAY_TOO_OLD`.
* **Cause the mesh to relay attacker frames indefinitely.** Each
  frame's TTL is bounded and decrements on every hop.
* **Carry out a partition attack by spoofing dst.** Sure, an attacker
  can inject a frame with `dst=0xAA` (some nonexistent leaf), and
  every relay will dutifully forward it until TTL=0. But that's
  just one frame's worth of airtime cost. Mitigated by per-source
  rate limit at the relay (`MAX_RELAYS_PER_SECOND`).

### 7.3 Operational implications

* Keep the shared key off the radio (already true — it's only in
  `marsin_engine/secret.yaml`, never transmitted).
* If a node is compromised (e.g. an attacker pairs a phone and
  extracts the AES key from PortWatch storage), they get
  attacker-capable status: can originate authentic frames as that
  node. Revocation: rotate `secret.yaml` and re-flash all firmware.
  Same procedure as today.

---

## 8. Boot and admission

### 8.1 The profile-bootstrap problem (unchanged)

When a new node boots:
1. It starts on its compile-time default profile (currently
   `playa` = SF=10/BW=125/+22 dBm).
2. The mesh may be running on a different profile (e.g. `local`).
3. The new node listens at `playa`; the mesh is talking at `local`;
   the new node hears nothing.
4. The bridge's PUBs include `prof/<name>` so a new node hearing one
   could in principle auto-switch — but the new node can't hear
   them at the wrong profile.

**This is not solved by mesh.** It's the same chicken-and-egg as
today. Operational workaround (already in place):
* USB-push the new node to the active profile before deploying it:
  `echo '*CFG name=<active> t=0' > /dev/cu.usbmodem...`
* OR: when changing the mesh-wide profile, accept that any
  out-of-range nodes will be lost until they're re-bootstrapped.

A future enhancement (not in this design): nodes that fail to hear
any traffic for `STARTUP_TIMEOUT_S` (e.g. 60 s) automatically cycle
through known profiles and listen for `prof/`-bearing PUBs. Out of
scope here.

### 8.2 HLO admission with TTL

When a leaf joins the mesh, it sends `HLO` with `dst=SERVER, ttl=3`.
The hop count from leaf to server is unknown at boot, so we use the
default TTL.

If the leaf is direct-reachable: server gets it in 1 hop, replies
`ACK welcome` with `dst=<leaf>, ttl=3` (no relay needed but TTL
budget unused costs nothing).

If the leaf is 2 hops away: relay nodes carry the HLO. Server gets
it eventually; ACK comes back via (possibly different) relay. Either
way the leaf gets its welcome.

If the leaf gets no ACK within the existing `client_companion`'s
HLO timeout (4 s × N retries): same retry pattern as today applies.
The multi-hop case typically needs ~3-5 s round-trip; bump
`HLO_TIMEOUT_S` to 10 s in `client_companion.py` for mesh
deployments.

### 8.3 Lost-relay recovery

Scenario: leaf is talking to server via relay R. R disappears
(battery, fall, …).

Leaf's next qry: TTL=3, sent normally.
- No relay hears it OR R was the only one in range: server gets
  nothing, leaf times out and retries.
- Some OTHER node is in range and hears it: that node's relay logic
  fires, frame reaches server. Self-healing.

No explicit "relay died" signaling. The mesh forgets R within
~30 s (next seen-set GC). Until then, R's slot in seen-window stays
populated but harmless.

The server's roster (§9) tracks R's `last_seen_at`; the next roster
PUB after R's silence threshold (say 60 s) marks R as
`status=offline`, and the next PortWatch render dims R in the
"PEERS" card.

---

## 9. Peer roster (server-sourced)

### 9.1 What the roster contains

The bridge maintains a small in-memory map:

```python
@dataclass
class RosterEntry:
    node_id: int            # e.g. 0x0A
    name: str               # from .config.nodes.yaml
    role: str               # "captain" / "crew" / "server"
    last_seen_at_ms: float  # monotonic; updated on every accepted frame
    last_rssi_dbm: float    # from the last-hop transmitter, not necessarily src
    last_snr_db: float

class Roster:
    entries: dict[int, RosterEntry]   # keyed by node_id
    own_node_id: int                  # 0x01

    def online_threshold_s(self) -> float:
        # A node not heard from for this long is considered offline.
        return 60.0
```

The bridge updates `entries[src]` on every accepted (decrypted +
ACL-passing) frame.

The static parts (name, role) come from `.config.nodes.yaml`; the
dynamic parts (last_seen, RSSI/SNR) come from observation.

### 9.2 Roster delivery to leaves

Two delivery channels, both implemented:

**Channel A — periodic compact PUB.** Every Nth compact_status PUB
(proposed: every 5th, so ~5 minutes between roster broadcasts at the
current 60 s PUB cadence) includes a `roster/` field:

```
br/55,pat/sunset,...,prof/playa,roster/0A:on,0B:off,10:on
```

Format: comma-separated `<node_id_hex>:<state>` pairs, where state
is `on` (seen within 60 s) or `off` (stale). Excludes the server
itself.

**Channel B — on-demand qry.** New endpoint `qry mesh/roster`
returns the full roster with timestamps:

```
0A:captain:on:-95.0:5.2:412,0B:captain:off:-118.0:-2.1:89,10:crew:on:-105.0:1.0:1234
```

Format: `<id>:<role>:<state>:<last_rssi>:<last_snr>:<rx_count>`.

PortWatch issues `qry mesh/roster` on first connect and refreshes
when the operator pulls-to-refresh the Status screen. The periodic
PUB-borne roster keeps the UI loosely up-to-date between explicit
pulls without burning a separate qry round-trip.

### 9.3 Why PUB-borne roster is short, not full

The compact PUB is already ~80-150 bytes pre-roster. A full roster
(6 fields × ~6 nodes = ~250 bytes) blows past the SF=10/BW=125
frame budget (~256-byte payload limit). The `on/off` shorthand fits
even at 8 leaves with room to spare.

If the operator wants details, the on-demand `qry mesh/roster` is
one round-trip. Cheap.

### 9.4 Captain UX (PortWatch)

A new "PEERS" card on the Status screen, below the existing
SERVER BRIDGE card. Reads `engineStatus.mesh.peers` (parsed from
the `roster/` field):

```
PEERS                                                    [REFRESH]
  ● captain      0x0A    YOU
  ● captain_02   0x0B    online                            -95 dBm
  ○ crew_01      0x10    offline (last seen 4m ago)
  ○ crew_02      0x11    never seen
  ● crew_03      0x12    online                           -118 dBm
```

The captain's own row is marked "YOU" and shown at top regardless of
sort order. Other rows are sorted online-first, then by node id.

**No tap action in v0.** The card is read-only. Future v.1 may add
"send a ping" or "open a chat" tap actions; the wire format already
supports them.

### 9.5 Where this lives

* Bridge: `comms/bridge.py` gains `Roster` class + integration into
  `_status_publisher()` and a new `qry mesh/roster` handler.
* PortWatch: `status/parse.ts` extends `EngineStatus.mesh.peers`
  (new field); StatusScreen.tsx renders the PEERS card.
* Captain firmware: nothing — roster is fully bridge-side and PortWatch.

---

## 10. Implementation phases

### Phase 1: Frame format extension (~1 day)

**Files:**
- `comms/frame.py`: add `ttl` field; update `encode()` + `decode()`;
  decide whether to bump frame version to `T3|...` or keep `T2|`
  with a version-2.1 decoded variant.
- `comms/secure.py`: confirm AAD does NOT include TTL.
- `firmware/src/titanic_common.h`: Frame parsing — add TTL slot.
- All call sites that construct Frames: pass `ttl=1` for now.

**Tests:**
- Round-trip encode/decode with various TTL values.
- Codec test: AAD verification succeeds even when TTL is mutated.
- Existing `comms_e2e_sim` suite still passes (with `ttl=1`
  semantics, no relay).

### Phase 2: Server-bound relay (~2 days)

**Firmware (captain + crew identical):**
- Port `comms/replay.py` semantics to C — `SeenSet` class in
  `titanic_common.h` (or new `titanic_mesh.h`).
- Add `mesh_evaluate(frame, rssi)` called from the RX path in
  `podium_tx/main.cpp`.
- Implement gossip-suppression scheduler:
  - On qualifying RX, compute jitter from RSSI, push to a small
    priority queue keyed by deadline.
  - Main loop checks the queue every tick; transmits when deadline
    fires.
  - On RX during pending relay, check seen-set; if dup, cancel.

**Server firmware:**
- Refuse to relay (`mesh_evaluate` returns early if `DEVICE_ROLE
  == server`). Logged as
  `MESH_DROP src=0x?? dst=0x?? reason=server-no-relay`.

**Bridge:**
- Default `ttl=3` for received-from-leaf observation (no code change
  — relay happens entirely in firmware).
- Tests: HIL with 3 controllers at different distances; verify
  multi-hop qry succeeds.

### Phase 3: Leaf-bound relay (~1 day)

**Firmware:**
- Generalize Phase 2's relay path to handle any frame with
  `dst != self && dst != BROADCAST` (today's Phase 2 only handles
  `dst == SERVER`).
- Server firmware sets `ttl=3` on outbound replies.

**Bridge:**
- `bridge.py::_send` defaults `ttl=3` for outbound REP / ACK / NAK.
- Tests: HIL with leaf 2 hops away from server; verify reply lands.

### Phase 4: Broadcast relay (~1 day)

**Firmware:**
- Handle `dst == BROADCAST`: accept locally AND schedule relay.
- Server PUBs already have `dst == BROADCAST`; only need to set
  `ttl=3` instead of `ttl=1`.

**Bridge:**
- `_status_publisher()` sets `ttl=3`.
- Tests: leaf far from server hears PUBs via relay; confirms
  `engineStatus.loraProfile` ground-truth still works.

### Phase 5: Peer roster (~1 day)

**Bridge:**
- New `Roster` class in `comms/bridge.py`.
- Track `last_seen_at_ms` + last RSSI/SNR per accepted-from src.
- Periodic GC of stale entries (keep entry, just flip `state` based
  on threshold).
- Inject `roster/<...>` into every Nth compact PUB.
- Implement `qry mesh/roster` handler returning the full table.

**PortWatch:**
- `status/parse.ts`: extend `EngineStatus` with
  `mesh: { peers: PeerEntry[] }`.
- `frame/ops.ts`: new `buildMeshRosterQuery()` helper.
- `state/store.ts`: a `peers` field + setter.
- `ui/StatusScreen.tsx`: new PEERS card.

### Phase 6: Metrics + observability (~1 day, optional)

- Bridge: per-source RSSI map in `/health.mesh.per_source`.
- Firmware: BLE characteristics for `relay_count`,
  `relay_dedup_count`, `relay_suppress_count`,
  `relay_throttle_count`.
- PortWatch: extend the PEERS card to show "I am relaying for N
  peers in last minute" stat on the YOU row.

**Total: ~6-7 days of focused work.**

---

## 11. Test plan

### 11.1 Unit tests (Phase 1-2)

**`comms/frame.py`:**
- Encode + decode round-trip with TTL = 0, 1, 3, 15.
- Decode rejects TTL > 15 (out of nibble range — paranoia, frame is
  corrupt).
- Encode rejects TTL < 0.

**`comms/secure.py`:**
- AAD does NOT include TTL: decode with mutated TTL still verifies
  payload integrity.

**Firmware `SeenSet`:**
- Insert (src, ctr) → contains(src, ctr) returns true.
- Insert (src, ctr-1) → contains(src, ctr-1) returns true even after
  inserting (src, ctr+5) (out-of-order arrival inside window).
- Insert (src, ctr+100) (way out of window) → contains(src, ctr-1)
  returns false (window slid past it).
- GC: 11 minutes after last insert, slot is reset.

### 11.2 HIL — Phase 2 multi-hop server-bound

Setup: 3 controllers — `server` (on Pi), `captain_relay` (close to
server), `captain_far` (placed such that it can ONLY hear
captain_relay, NOT server — use foil or distance).

Run: `cmd pattern/<name>` from captain_far via PortWatch (or HIL
client).

Expected:
- Captain_far transmits at TTL=3.
- Captain_relay hears it, dedupes (first time), jitters, relays at
  TTL=2.
- Server hears the relayed frame, processes cmd, replies with
  ACK at TTL=3 to captain_far.
- Captain_relay hears the ACK, relays at TTL=2.
- Captain_far hears the relayed ACK.

Assert: ACK arrives at captain_far within `LORA_RELAY_RTT_BUDGET_S`
(propose 8 s). Bridge's seen-set rejects any duplicate.

### 11.3 HIL — Phase 4 multi-hop broadcast

Setup: same as 11.2.

Run: trigger a PUB (e.g. by changing an engine param).

Expected: captain_far sees the PUB via captain_relay. PortWatch's
`engineStatus.loraProfile` updates correctly.

### 11.4 HIL — Phase 5 roster

Setup: 3 controllers all in direct range. captain_2 is then powered
off mid-test.

Run: `qry mesh/roster` from captain_1.

Expected (initial):
- Returns `0A:captain:on:..., 0B:captain:on:..., 01:server:on:...`
  (or similar).

Run again after captain_2 silence > 60 s:
- Returns `..., 0B:captain:off:..., ...`

PortWatch's PEERS card shows the dimmed row.

### 11.5 Storm test

Setup: 3 captains all within direct range of the server AND of each
other.

Run: HIL client sends 50 qrys from one captain at 200 ms spacing.

Expected:
- All 50 qrys reach the server (the captain is direct-reachable).
- The OTHER 2 captains observe their own gossip suppression firing
  most of the time (they hear the original, schedule a relay, then
  hear the server's RX of the original, dedupe, cancel their own).
- Total airtime usage stays bounded — should be ~50 × 1× (no
  relay needed) for forward direction + 50 × 1× for the ACK.

Assert: per-source `relay_count` on the two onlooker captains is
small (≤ 10 over the 50-frame burst). NOT close to 50.

### 11.6 Lost-relay test

Setup: same as 11.2, but during the test, kill captain_relay (pull
power) after the first 5 qrys succeed.

Run: continue sending qrys from captain_far.

Expected: qrys 6+ fail with timeout. Operator brings captain_relay
back; subsequent qrys succeed.

(No explicit "relay died" alarm; the operator infers from PortWatch's
PEERS card showing captain_relay going offline after 60 s.)

---

## 12. Operational metrics

Bridge `/health` gains a `mesh` section:

```json
{
  "mesh": {
    "default_ttl": 3,
    "roster": [
      {"node_id": "0x0A", "role": "captain", "state": "online",
       "last_rssi_dbm": -95.0, "last_snr_db": 5.2,
       "last_seen_ms_ago": 1234, "rx_count": 412},
      {"node_id": "0x0B", "role": "captain", "state": "offline",
       "last_rssi_dbm": -118.0, "last_snr_db": -2.1,
       "last_seen_ms_ago": 82431, "rx_count": 89}
    ],
    "relay_dedup_count_total": 1247
  }
}
```

PortWatch's Status screen shows the new "PEERS" card (§9.4). Phase 6
adds relay-self stats to the YOU row.

---

## 13. Known limitations and future work

### 13.1 Multi-hop is slow at SF=10

At SF=10/BW=125, each hop adds ~250 ms of airtime per direction. A
2-hop round-trip is ~1 s + engine response time + decode = ~3 s
minimum. On a marginal link with retries, could easily hit 10 s.

**Mitigation:** combine with the LoRa profile switcher
(`docs/22 §9`, implemented in commit `876d7f4`). Operator uses
`local` (SF=9/BW=250) or `test_bench` (SF=7/BW=500) profile when
the mesh is dense enough to provide redundancy at lower link
budget. Mesh + fast profile = both range AND speed.

### 13.2 No automatic profile fallback

If the mesh is on `local` and a leaf walks into a marginal area, it
goes dark. There's no automatic "drop to playa" fallback. Operator
must observe the dead link and switch the WHOLE mesh back to playa.

**Future:** per-link adaptive profile would require negotiation per
neighbor — fundamentally incompatible with this design's "leaves
don't talk to each other" v0 constraint. May address in v1 if
operators ask for it.

### 13.3 No mesh-wide profile bootstrap for new nodes

Covered in §8.1. The compile-time default profile must match the
field-active profile, OR new nodes must be USB-pushed before
deployment. Acceptable operationally; not solving in this design.

### 13.4 No congestion control

If the mesh has many leaves issuing qrys simultaneously, the airtime
gets saturated and frames start colliding. The relay logic adds
gossip suppression (which reduces redundant transmits) but does NOT
back off the leaves' originate rate.

**Future:** add a "channel-busy" signal where leaves see the CAD
(channel activity detect) on their SX1262 and defer their next
transmit if busy. Existing `radio.scanChannel()` supports this. Out
of scope here.

### 13.5 Server is still SPOF

By design (per the user constraint). If we ever need
no-single-point-of-failure, the design becomes much more complex
(distributed engine state, consensus protocols, …) — different
project.

### 13.6 Leaf-to-leaf messaging deferred to v1

The frame format will support it (`dst=<leaf_id>` is valid after
this design), but v0 firmware drops such frames and the bridge's
ACL rejects them. Enabling it later requires:
1. A new ACL rule: "any captain may send `cmd` to another captain".
2. A new command in `.config.commands.yaml`: `chat <to_id> <msg>`.
3. PortWatch UI: a "MESSAGE" tap action on the PEERS card row.
4. The captain firmware passes through frames not addressed to the
   server (already true — frame format is destination-agnostic at
   the firmware level).

Doable in ~2 days when the operator wants it. Out of v0 because the
operational use case isn't yet validated.

---

## 14. Worked scenarios

### 14.1 Scenario A: 2 captains, both in server range

```
       server
        ▲ ▲
       /   \
   c_A       c_B   (both direct)
```

Captain A sends `cmd pattern/sunset`. TTL=3.

- Captain B hears it (dst=server, not self) → schedules relay with
  jitter based on its RSSI of A.
- Server hears the original directly.
- Server processes, replies with `dst=A, ttl=3`.
- During captain B's jitter, captain B hears the server's REP
  (and is the dst? no, dst=A). Captain B also schedules a relay
  for the REP since `dst != self`.
- But captain A receives the REP directly (it's in server range)
  and processes it. Captain B's jitter expires, transmits the
  relayed REP. Captain A's seen-set rejects the dup. Captain B's
  relay was airtime that didn't help anybody.

Inefficiency observed: in fully-direct topologies, every leaf
gratuitously relays for every other leaf. This is the cost of
"nodes don't (yet) coordinate routing decisions."

**Mitigation:** the gossip suppression catches MOST of these — if
captain B can hear A AND the server can hear A AND captain B is in
range of the server, then captain B's RSSI of A is strong (low
jitter delay), but the server doesn't relay (no suppression
signal). So captain B's relay fires anyway.

Acceptable cost: ~1 extra frame airtime per round-trip in the
"everyone-direct" topology. If operationally annoying, we could add
a heuristic: if our last seen frame from `dst` was within the relay
window, assume `dst` heard the original directly, skip relay.
Optional optimization — leave out of v0.

### 14.2 Scenario B: captain → relay → server

```
   captain_far  ←→ captain_relay  ←→  server
            (only hears relay)            (only hears relay
                                           direction by physics
                                           — server is direct)
```

Captain_far sends `cmd pattern/sunset`. TTL=3.

- Server does NOT hear it (out of range).
- Captain_relay hears it. Schedules jitter (based on its RSSI of
  captain_far). No other relay candidate, so nothing to suppress.
  Jitter expires, transmits at TTL=2.
- Server hears the relayed frame. Processes cmd. Replies with
  `dst=captain_far, ttl=3`.
- Captain_far does NOT hear the server directly.
- Captain_relay hears the server's REP. Schedules relay. Transmits
  at TTL=2.
- Captain_far hears the relayed REP. Accepts. PortWatch shows
  success.

Round-trip airtime: 4 frames × ~250 ms = ~1 s LoRa airtime.

### 14.3 Scenario C: server PUB through 2 hops

```
   server  →  captain_relay  →  captain_far
```

Server transmits PUB at TTL=3, dst=BROADCAST.

- Captain_relay hears it. Accepts locally (broadcasts go to
  everyone). Schedules relay at TTL=2.
- Captain_far does NOT hear original.
- Captain_relay's jitter expires, transmits relayed PUB at TTL=2.
- Captain_far hears it. Accepts locally. No further relay needed
  (or its own attempted relay is suppressed by lack of further
  audience).

Both captain_relay and captain_far have the latest PUB. PortWatch
on captain_far gets the latest `engineStatus.loraProfile`, pattern,
etc. — AND the roster (when this is a roster-bearing PUB).

### 14.4 Scenario D: 3 captains form a 2-hop line

```
   c_far ←→ c_mid ←→ c_near ←→ server
   (only      (hears      (hears
   hears      c_far +     c_mid +
   c_mid)     c_near)     server)
```

Captain_far sends `cmd ...`. TTL=3.

- c_mid hears it. Schedules relay at TTL=2.
- c_near does NOT hear c_far. (Won't relay c_far's frame this hop.)
- c_mid's jitter expires, transmits relayed frame at TTL=2.
- c_near hears the relayed frame from c_mid. Schedules relay at
  TTL=1.
- Server hears the relayed frame from c_mid OR from c_near (whoever
  is in range). c_mid is probably out of server range (by topology),
  so server only hears c_near's TTL=1 relay.
- c_near's jitter expires, transmits at TTL=1.
- Server processes. Replies at TTL=3.
- Mirror path back: c_near relays at TTL=2, c_mid at TTL=1,
  c_far accepts.

Total airtime: 6 frames per direction × ~250 ms = 3 s LoRa per
round-trip. PortWatch RTT would be ~5-6 s.

This is **the worst case** with TTL=3. Acceptable for cmd/qry,
unworkable for status polling — recommend operators on long lines
reduce status polling cadence to keep PortWatch from saturating
the mesh.

### 14.5 Scenario E: roster lifecycle

T=0: server boots. Roster is empty.
T=5s: captain_A sends HLO. Bridge accepts, adds
      `entries[0x0A] = (online, last_seen=now)`.
T=12s: captain_B sends HLO. Same.
T=60s: bridge emits its second compact PUB. Includes
       `roster/0A:on,0B:on`.
T=120s: captain_B walks out of range. Bridge keeps getting traffic
        from captain_A but not B.
T=180s (captain_B silent for 60s = online_threshold_s): next PUB
        carries `roster/0A:on,0B:off`.
T=300s: captain_A's PortWatch shows captain_B as offline.

If captain_B walks back into range and sends a frame:
T=315s: bridge re-marks `entries[0x0B].state = online`.
T=360s: next PUB carries `roster/0A:on,0B:on`.

PortWatch's PEERS card update lag is bounded by the PUB cadence
(currently 60 s, configurable in `.config.bridge.yaml`).

---

## 15. Appendix: file pointers for implementer

| Phase | File | Change |
| --- | --- | --- |
| 1 | `control_podium/comms/frame.py` | Add `ttl` to `Frame`; update `encode`/`decode`. |
| 1 | `control_podium/comms/secure.py` | Verify AAD excludes TTL. |
| 1 | `control_podium/firmware/src/titanic_common.h` | Parse TTL field in Frame helpers. |
| 1 | `control_podium/comms/bridge.py::_send` | Accept TTL param; default `ttl=1` initially. |
| 1 | `control_podium/companions/client_companion.py::_send` | Same. |
| 1 | `control_podium/tests/test_comms_frame.py` | New TTL round-trip tests. |
| 2 | `control_podium/firmware/src/titanic_mesh.h` | NEW. `SeenSet`, `RelayQueue`, `mesh_evaluate(frame, rssi)`. |
| 2 | `control_podium/firmware/src/podium_tx/main.cpp` | Call `mesh_evaluate` from RX path. |
| 2 | `control_podium/firmware/src/server_rx/main.cpp` | Same, but `mesh_evaluate` is a no-op for server. |
| 2 | `control_podium/tests/hil/test_hil_mesh_2hop.py` | NEW. Multi-hop HIL fixture. |
| 3 | `control_podium/comms/bridge.py::_send_reply` | Pass `ttl=3` for outbound REP/ACK/NAK. |
| 4 | `control_podium/comms/bridge.py::_status_publisher` | Pass `ttl=3` for PUBs. |
| 5 | `control_podium/comms/bridge.py` | NEW `Roster` class. Inject `roster/` into PUBs. Handle `qry mesh/roster`. |
| 5 | `control_podium/comms/registry.py` | Add `mesh/roster` to qry allowlist for captain+crew. |
| 5 | `control_podium/PortWatch/src/status/parse.ts` | Parse `roster/` field; new `mesh.peers` array on `EngineStatus`. |
| 5 | `control_podium/PortWatch/src/frame/ops.ts` | `buildMeshRosterQuery()` helper. |
| 5 | `control_podium/PortWatch/src/state/store.ts` | `peers` field + setter. |
| 5 | `control_podium/PortWatch/src/ui/StatusScreen.tsx` | NEW PEERS card. |
| 6 | `control_podium/comms/bridge_health.py` | Add `mesh.per_source` to `/health`. |
| 6 | `control_podium/PortWatch/src/ui/StatusScreen.tsx` | Extend PEERS row to show self-relay stats. |

---

## 16. Risks and open questions

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Relay storm in dense topologies | Medium | Gossip suppression + `MAX_RELAYS_PER_SECOND` cap. Test in Phase 2 HIL. |
| Multi-hop adds enough latency that PortWatch UX degrades | High | Operationally: combine with `local`/`test_bench` profile when mesh is dense. Document in §13.1. |
| New nodes can't bootstrap onto a non-default profile | High (already) | Same as today — USB-push procedure. Future enhancement out of scope. |
| Cleartext TTL is mutable → DoS via airtime exhaustion | Low | `MAX_ACCEPTED_TTL` clamp + `MAX_RELAYS_PER_SECOND` cap. |
| Per-source seen-window memory on ESP32-S3 | Low | 6 KB worst case (256 sources × 24 bytes). Plenty of headroom. |
| Out-of-order ACK from server arrives via relay BEFORE the original | Low | Both go through seen-set; whichever wins satisfies the awaiter. No problem. |
| Roster format change in future breaks PortWatch | Low | Parser is defensive (rejects malformed `roster/` content, treats as missing). Version-tagged if we add fields. |
| Roster size at 50+ leaves overflows compact PUB | Medium (future) | Today's compact-only "on/off" shorthand fits ~30 leaves. Beyond that, drop the PUB-borne roster and rely on on-demand `qry mesh/roster` only. |

### Open questions for the operator

1. **Default TTL value:** 3 (proposed) covers 2 hops. Want 4 for
   deeper meshes, accepting more airtime? Or 2 for tighter rigs?
2. **Should crew nodes be allowed to relay?** Or only captains? My
   recommendation: ALL nodes relay (same firmware, same behavior).
   Restricting to "only captains" requires per-role config and
   introduces an asymmetry that complicates debugging.
3. **Where to surface mesh metrics?** Today's `/health` is the
   bridge view. Should PortWatch have a dedicated "MESH" tab, or
   just the PEERS card on Status? Recommend: PEERS card only in v0;
   tab if/when we add leaf-to-leaf messaging (v1).
4. **Roster online threshold:** 60 s (proposed) — long enough to
   survive a brief BLE re-pair on the captain's side without
   flickering, short enough that a real disconnect surfaces within
   a minute. Adjust to taste.
5. **Should the captain's own PortWatch issue `qry mesh/roster` on
   pull-to-refresh, or always rely on PUB-borne short roster?**
   Recommend: yes, allow explicit pull. The operator wants
   authoritative "who's online RIGHT NOW" sometimes.

---

*End of design. Send feedback / sanity-check questions to the
operator before starting Phase 1.*
