# PortWatch Implementation — Handoff

**Date**: 2026-05-16
**Spec**: `docs/21_portwatch_monitor.md`
**Scope**: `control_podium/PortWatch/` (Expo / iOS / iPadOS),
`control_podium/comms/` (bridge), `control_podium/firmware/` (Heltec
controllers), `CaptainPad/` (sync glue), `docs/16_captain_pad.md`,
`docs/21_portwatch_monitor.md`.

Addressed to the next engineer picking this up. Read this once,
then live in `docs/21_portwatch_monitor.md`.

---

## 1. What you inherit

A working, end-to-end LoRa control plane:

```
PortWatch (iPhone/iPad)
   ↕  BLE (GATT, Nordic UART-shape)        ← AES-128-GCM (Titanic Frame v2)
Heltec WiFi LoRa V4  (tcon_<name>)
   ↕  LoRa SF7/BW250 (RadioLib)            ← same frame, same key
Heltec WiFi LoRa V4  (server / podium)
   ↕  USB-Serial
control_podium/comms/bridge.py  (Python)
   ↕  HTTP + WebSocket (Wi-Fi)
marsin_engine (Node.js)  → simulation @ :6969
```

Operators carry an iPhone/iPad, pair to a Heltec over BLE, type
the displayed PIN, and now have authoritative control of the rig
via LoRa — pattern switches, deck overrides, global parameters
(speed / size / count / palette / …), playlist switching, live
status, range tests. CaptainPad still has wired Wi-Fi control;
the two stay in sync via a dual-path mechanism (PUB + 5 s polling)
described below.

---

## 2. The road to here (short version)

1. **Prototype** — `CaptainPad/iphone_companion/` was a 1-screen
   Expo app that proved BLE → LoRa → bridge → engine end-to-end
   with a single hard-coded test pattern.
2. **Productionisation** — moved to `control_podium/PortWatch/`,
   split into tabs (Deck, Status, Logs, Tests, Settings),
   plumbed Heltec OLED + dynamic BLE name (`tcon_<node>`), wrote
   `README.md` covering EAS build / TestFlight / App Store paths,
   and added an icon.
3. **Lock / lease** — added the deck override as a CPC global
   parameter (`controlLock` owner + 30 s lease, renewed every 20 s
   from PortWatch). CaptainPad now greys out behind a
   `EngineLockoutOverlay` while PortWatch holds the lock.
4. **Global + local parameters** — `GlobalParamsCard` and
   `LocalParamsCard` mirror CaptainPad's CPC sliders and per-pattern
   exports. Intent reconciliation makes the sliders feel instant
   over the LoRa round trip.
5. **Bulletproofing** — caching for the playlist library, per-playlist
   pattern cache, ready-gate state machine, serial playlist→patterns
   hydration, intent reconciliation hardening, **dual-path
   synchronisation** (PUB + 5 s polling).
6. **Cleanup** — removed the `TargetChannelPicker` and its wire
   plumbing (May 2026 — see §3 below).

If you need to understand any one of these, the design doc has a
section on it.

---

## 3. Most recent change — target-channel removal

**TL;DR**: the deck is always bound to its base channel. The
TARGET CHANNEL picker (chip group + pills) is gone everywhere.

### What got deleted

| Surface | What went |
| ------- | --------- |
| PortWatch UI | `TargetChannelPicker` component + its three styles (`targetChannelBox`, `targetChannelLabel`, `targetChannelValue`) in `control_podium/PortWatch/src/ui/DeckScreen.tsx`. |
| PortWatch parse | `targetChannelName`, `channelCount`, `channelNames` fields on `EngineStatus`; `tildeListOrNull` helper. `control_podium/PortWatch/src/status/parse.ts`. |
| Bridge wire | `tch`, `nch`, `chs` fields in `compact_status`. `CH_NAMES_MAX` / `CH_NAME_LEN_MAX` constants and the per-name sanitisation loop. `control_podium/comms/engine_client.py`. |
| CaptainPad UI | `selectedDeckChannel` state, TARGET CHANNEL pills, the per-pill `setMixerView('deck', c.id)` plumbing. `CaptainPad/app/(tabs)/index.tsx`. |
| CaptainPad API | `setMixerView`'s second `deckChannel?` argument. `CaptainPad/utils/api.ts`. |
| Tests | `state["base_channel_name_override"]` escape hatch; `test_target_channel_change_via_mixer_propagates`; positive `test_compact_status_surfaces_target_channel`. Renamed `test_polling_picks_up_pattern_and_playlist_and_target_channel` → `test_polling_picks_up_pattern_and_playlist`. Added negative regression `test_compact_status_does_not_surface_target_channel`. |
| Docs | `docs/21_portwatch_monitor.md` §10.14 / §10.15 rewritten as a single "Target-channel removal (2026-05)" section that explains what's gone and why. `docs/16_captain_pad.md` Tab 1 description got a "Target channel removal" subsection. |

### Why

We had three signals all pointing the same way:

1. **Playlists already do the job.** Swapping the deck's content is
   what operators reach for the TARGET CHANNEL picker to do — and
   it's exactly what the playlist switcher does, but with
   first-class engine support, hash-based caching, autopilot, etc.
2. **PortWatch's chip group was view-only.** Tapping a non-LIVE
   chip surfaced "channel switching coming soon" — operators
   reasonably expected the tap to do something. We never built the
   write surface (no `cmd target/<id>`), and now we don't have to.
3. **It cost LoRa air time.** `tch` / `nch` / `chs` shipped on
   every compact-status PUB (≤ 8 channels × 8 chars per name with
   tilde separators ≈ 72 B of payload, plus the field keys). The
   bytes are now reclaimed.

### What stayed

* The mixer base channel discovery in `compact_status` —
  `base_id = mx['baseChannelId']` with a `ch_base_` prefix
  fallback. We still need it to find `pat` and `pl`.
* CaptainPad's MIXER tab (Tab 2). Multi-channel routing lives
  there, untouched.
* The engine endpoint `POST /mixer/view` still accepts a
  `deckChannel` field for backward compatibility with any other
  client. First-party UIs just don't send it any more.

### Validation

* `test_compact_status_does_not_surface_target_channel` (Python
  e2e) asserts the bridge wire is clean.
* `test_polling_picks_up_pattern_and_playlist` (Python e2e) now
  also negatively asserts `tch` / `nch` / `chs` are absent from
  the polling REP.
* `npx tsc --noEmit` is clean across PortWatch and CaptainPad.
* All vitest + Python e2e suites pass — see §7.

---

## 4. Architecture you need to know

### 4.1 BLE link
* Service UUID + Tx/Rx characteristics live in
  `control_podium/firmware/src/titanic_ble.h` and
  `control_podium/PortWatch/src/ble/`.
* BLE name = `tcon_<node>` from
  `control_podium/.config.nodes.yaml`. Firmware advertises by
  service UUID **and** name; PortWatch scans by service UUID
  primarily (iOS truncates names mid-advert) and filters by name
  prefix.
* Pairing uses a 6-digit numeric PIN displayed on the Heltec OLED.
  The PIN is rolled every 10 min or on use. See firmware
  `bond_manager.c`.

### 4.2 LoRa link
* RadioLib SX1262, SF7 / BW 250 / CR 4:5 (set in
  `.config.firmware.yaml`).
* Titanic Frame v2 — AES-128-GCM, 12-byte nonce, 4-byte length, 16-byte tag.
  Key lives in `marsin_engine/secret.yaml` (baked at build time for
  dev/preview; runtime entry in production). See
  `control_podium/comms/frame.py` + `firmware/src/titanic_frame.*`.

### 4.3 Bridge
* `control_podium/comms/bridge.py` — single asyncio process,
  three responsibilities:
  1. **Frame in/out** over serial to the server-side Heltec.
  2. **Engine proxy** — translates `qry`/`cmd` frames into HTTP
     requests against `marsin_engine`. Lives mostly in
     `engine_client.py`.
  3. **Status publisher** — fires `pub` broadcasts of
     `compact_status` on a periodic + event-driven cadence
     (WS subscriber on `mixer` / `globals` / `viewOverride` /
     `playlistLibrary` events wakes the publisher).
* Config in `control_podium/.config.bridge.yaml`. Note
  `status_publish.short_interval_s: 15` — bumped from 5 s after
  polling shipped (PUB is the fast path, polling is the reliable
  backstop).

### 4.4 PortWatch state model
* Zustand store at `control_podium/PortWatch/src/state/store.ts`.
  Key fields:
  * `engineStatus` — last compact_status snapshot.
  * `globalParams` / `intent.globalParams` — CPC mirror with
    optimistic-write reconciliation.
  * `localExports` / `intent.localExports` — per-pattern WASM
    exports with the same reconciliation pattern.
  * `playlistLibrary` + `engineLibraryHash` + `cachedHash` —
    playlist library cache (CRC32 of sorted names).
  * `patternsByPlaylist` — per-playlist pattern cache keyed by
    playlist name.
  * `connectGeneration` — bumps on every BLE pair; resets all
    "did I already hydrate this" sentinels.
  * `controlLock` owner + `controlLockLeaseRemainSec` —
    drives DECK CARD enable/disable and the renew timer.

### 4.5 Sync architecture (dual-path)

This is the single most important thing in PortWatch. Read
`docs/21_portwatch_monitor.md` §10.11 if you're new.

* **PUB (fast path, event-driven)** — bridge wakes on engine WS
  events, builds a `compact_status`, broadcasts. Latency ~hundreds
  of ms. Drops are normal under BLE / LoRa contention.
* **POLL (reliable path, cadence-driven)** — PortWatch unicasts
  `qry engine/status` and `qry params/snapshot` every 5 s
  (configurable in `.config.portwatch.yaml::polling`). Even if
  every PUB in the previous 5 s window dropped, the next poll
  rebuilds `engineStatus` and `globalParams` end-to-end.
* Hooks: `useStatusPoller`, `useGlobalParamsPoller` in
  `src/state/`. Both fire the first poll immediately on
  `connectGeneration` bump, maintain an in-flight guard,
  swallow failures.

### 4.6 Ready-gate
PortWatch's deck card is a 4-state machine evaluated in this order:
1. **DISCONNECTED** — no BLE link.
2. **CONNECTED / NO STATUS** — BLE up, no compact_status yet.
3. **MIXER MODE** — engine reports `vw=mixer` (no PortWatch
   override held) → grey "engine in mixer mode" overlay.
4. **DECK MODE READY** — full controls enabled.

This is what fixed the "loaded PortWatch in mixer mode and it
shows deck controls" report. The gate refuses to render real
controls until all four of these compact-status fields are
present: `vw`, `vov`, `lk`, `pl`. Don't relax this without
re-running the e2e tests.

### 4.7 Intent reconciliation
Every PortWatch write (pattern, blackout, autopilot, global param,
local export) goes through `intent.*` first and gets snapped into
the UI optimistically. The reconciliation rules
(`store.ts::setEngineStatus`, `setGlobalParams`, `setLocalExports`)
are:

| condition                              | action               |
| -------------------------------------- | -------------------- |
| no engine signal                       | keep intent          |
| intent agrees with engine              | DROP intent          |
| intent disagrees AND intent.pending    | KEEP (optimistic UI) |
| intent disagrees AND !intent.pending   | DROP (engine wins)   |

That last row is the one that fixed the "CaptainPad changes a
param and PortWatch keeps showing the stale value" bug. Don't
soften it.

---

## 5. Design doc updates

### `docs/21_portwatch_monitor.md`
* §10.5 — ready-gate state machine (4 states, hard ordering).
* §10.7 — compact-status field reference table. Now lists
  `pat` / `pl` / `plh` / `vw` / `vov` / `lk` / `lku` and friends;
  the `tch` / `nch` / `chs` rows are gone.
* §10.8 — serial-load gate (playlists hydrate first, patterns
  second).
* §10.9 — intent reconciliation full rules + "CaptainPad change
  vanishes" regression rationale.
* §10.11 — **dual-path sync architecture (PUB + 5 s polling)**.
  Read this first if you're chasing a sync bug.
* §10.12 — per-playlist pattern cache (`patternsByPlaylist`)
  with the manual-REFRESH bypass and the explicit "library edits
  while running require manual refresh" trade-off.
* §10.13 — `setGlobalParams` / `setLocalExports` reconciliation
  decision table.
* §10.14 — **target-channel removal (2026-05)**, replacing the
  old §10.14 (Target channel REFRESH) and §10.15 (Deck channel
  picker).

### `docs/16_captain_pad.md`
* Tab 1 ("Control Deck") description updated to call out that
  the playlist IS the pattern list (no TARGET CHANNEL pill row
  any more).
* New subsection under Tab 1 — "Target channel removal (2026-05)"
  — explains the deletion, why we did it, and the engine
  backwards-compat note (the `POST /mixer/view` endpoint still
  accepts `deckChannel` for non-first-party clients).

### Nothing else needed updating
`docs/12_marsin_engine.md`, `docs/15_central_param_center_cpc.md`
already describe the engine-side surfaces correctly; the removal
was pure deletion on the UI / wire layers, not a behaviour
change at the engine.

---

## 6. File map

```
control_podium/
├── PortWatch/                          ← the iPhone/iPad app
│   ├── App.tsx                         ← top-level, wires pollers
│   ├── .config.portwatch.yaml          ← single source of truth
│   ├── scripts/sync-config.mjs         ← bakes YAML → TS
│   ├── README.md                       ← bring-up, EAS, TestFlight
│   ├── src/
│   │   ├── ble/                        ← BLE GATT link
│   │   ├── codec/                      ← Titanic Frame v2
│   │   ├── ops/                        ← buildXxx() command builders
│   │   ├── state/
│   │   │   ├── store.ts                ← Zustand + intent reconciliation
│   │   │   ├── store.test.ts           ← reconciliation + cache tests
│   │   │   ├── useStatusPoller.ts      ← qry engine/status poll
│   │   │   ├── useStatusPoller.test.ts
│   │   │   ├── useGlobalParamsPoller.ts
│   │   │   └── useLocalExportsPoller.ts ← per-pattern exports poll (Phase 7)
│   │   ├── status/
│   │   │   ├── parse.ts                ← KV → EngineStatus + lift globals
│   │   │   └── parse.test.ts           ← Phase 7 parser coverage
│   │   └── ui/
│   │       ├── DeckScreen.tsx          ← the deck card + playlist switcher
│   │       ├── StatusScreen.tsx
│   │       ├── LogsScreen.tsx
│   │       ├── TestsScreen.tsx
│   │       └── ScanScreen.tsx
│   └── ios/                            ← Expo prebuild output
├── comms/
│   ├── bridge.py                       ← BLE↔HTTP/WS bridge
│   ├── engine_client.py                ← compact_status + REST proxy
│   ├── frame.py                        ← Titanic Frame v2 (encode_kv etc.)
│   └── radio_port_*.py                 ← serial / sim radio backends
├── firmware/
│   ├── deploy.py                       ← build + flash + monitor
│   └── src/                            ← ESP32-S3 (PlatformIO)
├── tests/
│   └── test_comms_e2e_sim.py           ← 100+ Python e2e tests
└── .config.bridge.yaml                 ← bridge config (status_publish: 15s)

CaptainPad/
├── app/(tabs)/index.tsx                ← Control Deck (no more TARGET CHANNEL)
├── app/(tabs)/mixer.tsx                ← Mixer tab (multi-channel routing)
├── components/EngineLockoutOverlay.tsx ← shown when PortWatch holds the lock
├── components/ViewOverrideBanner.tsx   ← shown when deck override pinned
├── hooks/useEngineState.ts             ← single WS subscriber for the app
└── utils/api.ts                        ← setMixerView('deck') etc.

docs/
├── 16_captain_pad.md                   ← updated Tab 1 + target-channel note
├── 21_portwatch_monitor.md             ← living design doc; READ FIRST
└── …

.agent/02_reports/202605/
└── 20260516_1_port_watch_impl.md       ← you are here
```

---

## 7. Testing

### TypeScript / vitest (PortWatch)

```bash
cd control_podium/PortWatch
npm install              # one-time
npx tsc --noEmit         # type check (must be clean)
npm test                 # vitest suite
```

Current count: 36 vitest cases across:
* `src/state/store.test.ts` — intent reconciliation (drop when
  agree, drop when !pending+disagree, keep when pending+disagree,
  …), per-playlist pattern cache (atomic write with hash,
  single-key + full-map invalidation, cache-survives-reset), and
  the `setGlobalParams` partial-merge contract (Phase 7).
* `src/state/intent.test.ts` — pure-function `reconcileIntent`
  decision-table coverage.
* `src/state/useStatusPoller.test.ts` — 7 cases:
  immediate-first-poll, periodic ticks, in-flight skip, stop()
  cancellation, null-link no-op, sendOp failures don't crash,
  double-start guarded.
* `src/status/parse.test.ts` — `pph` extraction + dash sentinel
  + missing-key default + `liftGlobalParamsFromCompactStatus`
  partial/full/substring-collision coverage (Phase 7).

### Python e2e (`pytest`)

```bash
cd control_podium
python -m pytest tests/                # all e2e
python -m pytest tests/test_comms_e2e_sim.py -k polling   # just polling
```

Current count: 108 Python e2e cases (29 in
`test_comms_e2e_sim.py`, the rest split across other
`control_podium/tests/*.py`) covering bridge ↔ engine proxy, frame
encode/decode, view-override + lease, eager-PUB on HLO, ready-gate
hydration, playlist switching, polling, cache, target-channel
removal (negative regression), etc.

A few load-bearing tests to know about:
* `test_polling_picks_up_pattern_and_playlist` — PUBs starved,
  polling alone propagates pattern + playlist changes within one
  tick. Negative-asserts `tch` / `nch` / `chs` absent.
* `test_polling_picks_up_global_params_changes` — same pattern
  for the 7 global params via `useGlobalParamsPoller`.
* `test_polling_carries_playlist_library_hash_for_cache` — `plh`
  propagates via polling so the cache can warm up without PUBs.
* `test_compact_status_does_not_surface_target_channel` —
  negative regression for the May 2026 deletion.
* `test_compact_status_surfaces_playlist_library_hash` — `plh`
  appears, stays stable when nothing changed, changes when a
  playlist is added/removed.
* `test_compact_status_surfaces_playlist_patterns_hash` (Phase 7) —
  `pph` shape + stability + invalidation on playlist swap + `-`
  sentinel when no playlist is loaded.
* `test_compact_status_carries_full_cpc_globals` (Phase 7) — every
  CPC short-key (`sp`/`dr`/`ct`/`sz`/`rt`/`p1`/`p2`) appears on
  the PUB and a server-side mutation lands on the next tick.
* `test_ws_event_filter_includes_shared_params` (Phase 7) — the
  bridge wakes the publisher on a `sharedParams` event.
* `test_connect_time_hydration_in_mixer_mode` — full hydration
  set (status + playlists + deck/playlist + playlist-patterns)
  reaches a freshly-paired client in mixer mode.
* `test_eager_pub_carries_full_ready_gate_payload` — the HLO eager
  PUB carries the four ready-gate fields (`vw`/`vov`/`lk`/`pl`)
  so the deck card can light up on the first frame.

### CaptainPad

```bash
cd CaptainPad
npm install
npx tsc --noEmit
```

There is no vitest suite for CaptainPad; behavioural changes are
covered by the bridge's e2e suite (`tests/test_comms_e2e_sim.py`)
through CaptainPad-shaped HTTP calls against a fake engine.

### Firmware

```bash
cd control_podium/firmware
python deploy.py        # menu-driven build + flash + monitor
```

There's no automated firmware test gate; bring-up is done by
flashing a controller and watching the OLED + log over serial.
`docs/21_portwatch_monitor.md` §6 covers the bring-up checklist.

---

## 8. Process notes (how I worked through this)

Three things that turned out to matter:

1. **Polling beat clever broadcast.** I spent a sprint trying to
   make every CaptainPad change reach PortWatch instantly via PUB
   broadcasts (WS-wake, immediate-PUB-on-mixer-event, etc.).
   Single drops over BLE / LoRa kept making things look broken.
   The actual fix was admitting "broadcast is best-effort" and
   adding a 5 s poll on top. The user's framing ("eventual
   consistency is fine, just don't be stale") is the right one.
2. **Intent reconciliation needs four rules, not two.** The
   original drop-when-agree-only rule was correct for the
   happy-path round trip but let stale resolved intents shadow
   external (CaptainPad) changes forever. The full table is in
   §4.7 and §10.13. Resist any simplification that removes the
   `!pending + disagree → DROP` row.
3. **Less is more.** The target-channel picker was the second
   thing this sprint we removed because it was costing more in
   confusion than it was worth. The first was the explicit
   "mixer channel preview" toggle on the deck card. If a feature
   in the deck card has a meaningful test plan that reads
   "tap a chip and confirm nothing happens", delete the chip.

---

## 9. Open follow-ups

| # | Item | Notes |
| - | ---- | ----- |
| ~~1~~ | ~~`pph` (playlist patterns hash) field in `compact_status`~~ | **Done in Phase 7 (2026-05-16).** Hash-validated per-playlist pattern cache with HIT/MISS toasts. See §13 below. |
| 2 | Multi-Heltec from one phone | Tracked in §11. Today PortWatch pairs to one Heltec at a time. Real camp may want pinned multi-controller. |
| 3 | iPad-specific layout pass | The current layout is responsive but designed primarily for iPhone. iPad has more real estate that could fit the LOGS + STATUS side by side. |
| 4 | Android | Permission scaffolding is in `app.json`; nobody has built an Android binary. Expo's `expo-bluetooth-le` works on Android, the BLE service UUID + characteristics are platform-agnostic. |
| 5 | LoRa SF tuning | We're at SF7/BW250 today, optimized for short range + fast turnaround. Range tests in the Tests tab plot SNR / RSSI; future work is to wire a "negotiate SF/BW per link quality" handshake. |
| 6 | Production secret prompt UX | The dev/preview build bakes the key; production prompts. The prompt UI lives in `ScanScreen.tsx` and works, but could use a "is this the right key?" verification step (e.g. send a HLO and check for ACK). |

---

## 10. If something breaks

Tier-1 ("rig is down at the playa"):
1. Force-quit and reopen PortWatch.
2. Power-cycle the Heltec.
3. Check the bridge process on the Raspberry Pi —
   `systemctl status titanic-bridge` (or `bridge.py` foreground
   for the dev setup).
4. Check `marsin_engine` health on `http://10.1.1.172:6968/status`.

Tier-2 ("things look stale"):
1. Watch PortWatch's LOGS tab. Polling fires every 5 s; if you
   don't see `qry engine/status → REP` lines, polling stopped.
2. Check `connectGeneration` in `store.ts` — if it's not bumping
   on reconnect, the BLE layer thinks the link is healthy when
   it isn't.
3. Run `test_polling_picks_up_pattern_and_playlist` against the
   FakeEngine to confirm the wire is intact.

Tier-3 ("did I break sync"):
1. Run the full vitest + pytest suite.
2. Read `docs/21_portwatch_monitor.md` §10.11.
3. If `setGlobalParams` / `setLocalExports` was touched, double
   check the decision table in §10.13.

---

## 11. One-liner

PortWatch is a thin optimistic UI bolted to a slow, lossy LoRa link;
polling and intent reconciliation are what make it feel snappy. Don't
remove the poll. Don't simplify the reconciliation table. When in
doubt, ship less and re-read §10.11.

Good luck.

---

## 13. Phase 7 — Pattern caching + params bug bash (2026-05-16)

Two parallel tracks landed on top of the May-2026 target-channel
cleanup:

* **Track 1 — hash-validated per-playlist pattern cache.** Closes
  follow-up #1 from §9: cache invalidation is now driven by a
  server-computed `pph` (playlist patterns hash) in `compact_status`.
  Cache hit/miss is explicit, surfaced in the lastReply ribbon, and
  preserved across BLE disconnects.
* **Track 2 — params synchronisation bugs.**
  * Bug 1: every CPC global (not just `sp`) now ships in `compact_status`.
  * Bug 2: `LocalParamsCard` auto-refreshes on the FIRST observed
    pattern change after a fresh connect (previously skipped to
    "avoid boot noise" — turned out the skip hid the live sliders
    on every reconnect).
  * Bug 3: new `useLocalExportsPoller` paginated background poll
    propagates CaptainPad-side slider nudges that don't change the
    active pattern.

### 13.1 Track 1 — pattern caching system

**Wire-format additions (one new field):**

| key | type     | source                                  | semantics |
| --- | -------- | --------------------------------------- | --------- |
| `pph` | `string` (8-hex CRC32 or `-`) | engine `/playlists/<active-name>.entries` | CRC32 of the active deck-playlist's pattern names (entry order, missing entries skipped, dups collapsed). `-` when no playlist is loaded. Stable across engine restarts. |

Computed in `engine_client.py::compact_status` after `pl` is resolved.
It re-uses `get_deck_playlist_patterns()` so the hashed input is the
exact same name list the paged `qry engine/playlist-patterns` reply
will produce — cache lookups are byte-deterministic.

**PortWatch side:**

1. `EngineStatus.playlistPatternsHash` parsed off `kv["pph"]`
   (`-` → `null`).
2. `patternsByPlaylist[name]` is now `PatternList & { hash }` —
   every cache write carries the engine-reported hash at fetch time.
   Inline extension type (vs. nested `{ patterns, hash }`) keeps the
   existing `.patterns` / `.truncatedExtra` / `.rawArg` accessors
   working everywhere.
3. `DeckCard.refreshPatterns` cache lookup:
   * **HIT** iff `force=false` AND a cache entry exists for the
     active playlist name AND `entry.hash !== null` AND
     `engineStatus.playlistPatternsHash === entry.hash`. Result:
     `setPatternList(cached)` + lastReply banner
     `PATTERNS  N cached · playlist=NAME · HIT`. Zero LoRa frames.
   * **MISS** otherwise. The banner names the reason — `first load`,
     `no cached hash`, `engine hash unknown`, or
     `hash changed (OLD → NEW)` — so operators understand whether
     the paginated fetch is paying for "new playlist contents" or
     just "cold start".
4. `resetIntent()` now PRESERVES `patternsByPlaylist`,
   `playlistLibrary`, and `playlistLibraryHash` across BLE
   disconnect/reconnect. Before this fix every reconnect was a
   guaranteed cache miss, which is the slow-load symptom the
   operator reported from the field. Hash validation is still
   correct after a reconnect because the next PUB tells us whether
   the engine mutated the playlist while we were offline — a
   mismatch invalidates the entry on the next lookup.
5. `PlaylistSwitcher.onSelect` issues an extra `qry engine/status`
   AFTER the `cmd playlist/<name>` ack and BEFORE calling
   `onSwitched()` (= `refreshPatterns`). Without this gate, the
   subsequent cache check would compare the NEW playlist's cached
   hash against the OLD playlist's `pph` (stale until the next
   periodic PUB lands), causing a false miss right after a clean
   switch. The extra round-trip costs ~one LoRa hop and is dwarfed
   by the cache hit it enables on the next visit.

**Files changed (Track 1):**

| file | change |
| ---- | ------ |
| `control_podium/comms/engine_client.py` | New `pph` field in `compact_status` (after `plh`). New `_compact_float` module-level helper (mirrors `bridge._short_float` for byte-identical wire formatting between the polled snapshot and the PUB). |
| `control_podium/PortWatch/src/status/parse.ts` | New `EngineStatus.playlistPatternsHash` field. Parser reads `kv["pph"]` via `dashOrNull`. |
| `control_podium/PortWatch/src/state/store.ts` | `patternsByPlaylist` typed as `Record<string, PatternList & { hash: string \| null }>`. `cachePatternsForPlaylist` takes a `hash` arg. `resetIntent` preserves `patternsByPlaylist` + `playlistLibrary*`. |
| `control_podium/PortWatch/src/ui/DeckScreen.tsx` | Hash-validated cache lookup in `refreshPatterns`. Cache-hit/miss toast strings. `PlaylistSwitcher.onSelect` awaits an explicit status query before the chained refresh. |
| `control_podium/tests/test_comms_e2e_sim.py` | New `test_compact_status_surfaces_playlist_patterns_hash` (8-hex shape, stability when contents don't change, invalidation on playlist swap, `-` sentinel when no playlist). |
| `control_podium/PortWatch/src/state/store.test.ts` | New `cache survives resetIntent` case + updated existing cache tests to pass a hash arg. |
| `control_podium/PortWatch/src/status/parse.test.ts` | New file — covers `pph` extraction + dash sentinel + missing-key default. |

### 13.2 Track 2 — params bugs

**13.2.1 Bug 1: global params not communicated to PortWatch UI**

Root cause: only `sp` (speed) was in `compact_status`. The other CPC
globals (`direction`, `count`, `size`, `rotate`, `colorPalette1`,
`colorPalette2`) only reached PortWatch via the 5 s
`useGlobalParamsPoller`, so CaptainPad-side nudges took up to 5 s
to appear. AND `sharedParams` WS events from the engine were NOT
in the bridge's WS-wake filter, so even the periodic PUB stayed on
the long 15 s cadence after a CaptainPad change.

Fix (three coordinated changes):

1. `engine_client.py::compact_status` now publishes the full CPC
   set: `sp`, `dr`, `ct`, `sz`, `rt`, `p1/<h>-<s>-<v>`,
   `p2/<h>-<s>-<v>`. Wire encoding matches what
   `bridge._exec_qry("params")` already produces, so the same
   parser is shared. Empty fields are omitted (not nulled) so
   "engine doesn't know this value" stays distinguishable from
   "value is genuinely 0".
2. `bridge.py::_is_relevant_ws_event` adds `"sharedParams"` to its
   wake filter. Now a CaptainPad nudge that fires the engine's
   `sharedParams` WS event triggers an immediate compact-status
   republish (~hundreds of ms latency).
3. `parse.ts` adds `liftGlobalParamsFromCompactStatus(arg, ts)` —
   returns a sparse `GlobalParamsSnapshot` (null fields for
   non-present keys) or `null` if no global-params key is in the
   PUB. `App.tsx::onWireEvent` calls it on every compact-status
   frame (PUB or status REP) and routes through `setGlobalParams`.

`setGlobalParams` got a partial-merge contract change to support
this routing: it now MERGES the incoming snapshot with the
previously-stored values, only overwriting fields that are
non-null in the new partial. Intent reconciliation is gated to
fields that were ACTUALLY reported this tick — a merged-from-prev
value doesn't get to drop unrelated optimistic intents. Without
this, a sparse PUB carrying just `sp/0.9` would have wiped every
other field to null and visibly blanked the GlobalParamsCard until
the next 5 s polling tick.

**13.2.2 Bug 2: local params not refreshed on pattern change**

Root cause: `LocalParamsCard`'s auto-refresh effect deliberately
skipped the FIRST observed `activePattern` value
(`lastFetchedFor.current === null` branch) to avoid "noisy boot".
That branch silenced the auto-fetch on every BLE reconnect AND on
every external CaptainPad pattern change that landed before the
operator opened the ParamsCard.

Fix: removed the skip-first branch. The auto-fetch now fires on
every distinct `activePattern` transition, including the first
non-null one after connect. The cold-start fetch costs one
paginated LoRa round (typically 1–2 frames), well worth the
silent-empty failure mode it eliminates.

**13.2.3 Bug 3: local params not propagated from CaptainPad**

Root cause: PortWatch had no mechanism to learn about CaptainPad
slider drags that didn't swap pattern. The pattern-change-triggers-
refresh path covers swaps; manual REFRESH covers operator distrust;
nothing covered "Captain nudged a slider WITHOUT swapping pattern".

Fix: new `useLocalExportsPoller` (`src/state/useLocalExportsPoller.ts`):

* Same design idioms as `useGlobalParamsPoller`: single in-flight,
  skipped while a manual REFRESH owns `localExportsLoading`,
  paused while disconnected, immediate first poll on
  `connectGeneration` bump.
* Paginates over the same `qry exports/p/<n>` flow the manual
  REFRESH uses; partial-page failures abort the tick (no partial
  writes that would shrink the slider strip).
* Routes through `setLocalExports`, whose reconciliation drops
  resolved-but-disagreeing intents (engine wins) and keeps
  in-flight (pending) intents (optimistic UI).
* Cadence configurable via
  `.config.portwatch.yaml::polling.local_exports_interval_ms`
  (default 10 s, longer than the 5 s status/globals pollers
  because the exports list paginates). Set to `0` to disable.

**Files changed (Track 2):**

| file | change |
| ---- | ------ |
| `control_podium/comms/engine_client.py` | Full CPC global set in `compact_status`. |
| `control_podium/comms/bridge.py` | `sharedParams` added to `_is_relevant_ws_event`. |
| `control_podium/PortWatch/src/status/parse.ts` | New `liftGlobalParamsFromCompactStatus(arg, ts)` helper. |
| `control_podium/PortWatch/src/state/store.ts` | `setGlobalParams` partial-merge; intent reconciliation gated to reported-this-tick fields. |
| `control_podium/PortWatch/App.tsx` | Route compact-status globals to `setGlobalParams`. Wire `useLocalExportsPoller`. |
| `control_podium/PortWatch/src/ui/ParamsCard.tsx` | Removed `LocalParamsCard` skip-first-fetch branch. |
| `control_podium/PortWatch/src/state/useLocalExportsPoller.ts` | New file. |
| `control_podium/PortWatch/.config.portwatch.yaml` | New `polling.local_exports_interval_ms` / `local_exports_timeout_ms` knobs. |
| `control_podium/PortWatch/scripts/sync-config.mjs` | Bindings for the two new polling knobs. |
| `control_podium/PortWatch/src/state/store.test.ts` | New `setGlobalParams partial-merge` describe block (2 cases: merge preserves prev, partial doesn't drop unrelated intent). |
| `control_podium/PortWatch/src/status/parse.test.ts` | New file — covers `liftGlobalParamsFromCompactStatus` full / partial / substring-collision behaviour. |
| `control_podium/tests/test_comms_e2e_sim.py` | New `test_compact_status_carries_full_cpc_globals` + `test_ws_event_filter_includes_shared_params`. |

### 13.3 Test totals after Phase 7

* **vitest** — 36 cases pass (was 26 before Phase 7). New: 6 parse
  cases (`parse.test.ts`), 2 partial-merge cases, 1 cache-survives-
  reset case. Existing cache tests updated for the new
  `cachePatternsForPlaylist(name, list, hash)` signature.
* **pytest** (control_podium) — 108 cases pass (was 105 before
  Phase 7). New: `test_compact_status_surfaces_playlist_patterns_hash`,
  `test_compact_status_carries_full_cpc_globals`,
  `test_ws_event_filter_includes_shared_params`.
* **tsc** — clean across PortWatch and CaptainPad.

### 13.4 Reading order for the next engineer

1. This file — §13 (what just landed) + §4 (architecture
   refresher).
2. `docs/21_portwatch_monitor.md` — high-level design + the
   compact-status field table in §10.7 (updated for `pph` + full
   globals).
3. The four most load-bearing tests:
   * `test_compact_status_surfaces_playlist_patterns_hash` — `pph`
     wire shape + stability + invalidation.
   * `test_compact_status_carries_full_cpc_globals` — every CPC
     short-key field on the PUB.
   * `store.test.ts::"cache survives resetIntent"` — the slow-
     reload regression.
   * `store.test.ts::"setGlobalParams partial-merge"` —
     PUB-driven partial doesn't blank the card.
4. The new code modules in dependency order:
   `engine_client.py::compact_status` (`pph`, globals),
   `bridge.py::_is_relevant_ws_event` (`sharedParams`),
   `parse.ts::liftGlobalParamsFromCompactStatus`,
   `App.tsx::onWireEvent` (the lift+route call site),
   `store.ts::setGlobalParams` (partial-merge),
   `useLocalExportsPoller.ts`,
   `DeckScreen.tsx::refreshPatterns` (cache HIT/MISS + reason).

