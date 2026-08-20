# 20260805_160 — TITANIC scene: full playa-operation review (data + wire path)

**Agent:** reviewer `_160` (Opus, operator-requested) · **Branch:** `feat/bm_readiness` · **Task:** `_160`
**Scope:** the TITANIC scene as it will run on playa — normal operation, **bench mirror DISARMED**.
The mirror-inertness question is `_159`'s; this report owns the scene itself and does not re-litigate it.
**Inputs:** `AGENTS.md`, `.agent/codex.md`, tracker tail, `_153`/`_154`/`_156`/`_157`/`_158`.

**REVIEW ONLY.** Zero production edits. Zero git writes (read-only `status`/`diff`/`show`/`log`).
No port in 6966-6972 / 5568 / 8081 / 10000 bound. No packet sent to anything. No engine booted
against the real config. Scratch in `~/tmp/titanic_scene_review_160/`. IPs redacted `10.x.x.NN`.

**Tree state.** `_156` was still writing into this tree during the review (modified set grew
30 → 51 files, untracked 6 → 18 while I worked; `sacn_bridge.js` mtime 13:58, `bench_mirror.cjs`
14:05). **The titanic scene files themselves were never touched** —
`controllers.yaml` / `patches.yaml` / `scene_config.yaml` / `views.yaml` are all clean vs HEAD, which
is why every measurement below is stable. Files that DID move under me are named where they matter.

---

## 0. Verdict

**NOT READY FOR PLAYA — 3 BLOCKERs, 6 HIGH.**

The good news first, because it is the larger half: **the titanic scene data and its route table are
correct.** `scene_model_parity --strict` PASSES with zero errors and zero warnings; the engine emits
exactly 38 universes and the bridge builds exactly 38 relay routes; every universe the engine emits
has a route, every route is fed, no universe is claimed by two controllers, no address overlaps, no
fixture is orphaned, the 58-name view catalog is internally consistent and `CTRL_n` selects the
physically correct box for all 18 controllers. **The U10/U12 dark-fixture story from `_153`/`_157` is
closed and verified closed** (§4.3). Offline readiness is clean: no CDN, no external fetch, no DNS
dependency, every vendored dep present.

The blockers are not in the mapping. They are in **persisted show state**, in **an operational path
that promises darkness and delivers a frozen rig**, and in **a second writer the operator is actively
told to create**.

| # | Finding | Rank | New? |
|---|---|---|---|
| T1 | `stop` force-kills the stack — the engine's blackout never runs; the ship holds its last frame. Docs promise "lights OFF … before generator work" | **BLOCKER** | NEW |
| T2 | Persisted titanic show state boots **every** ship section at 2.7 %–17.9 % brightness, silently | **BLOCKER** | NEW |
| T3 | D1 ×2.55 clip — everything ≥ DMX 101 leaves as 255. **And it is currently masking T2** | **BLOCKER** (sequencing) | known + NEW interaction |
| T4 | A sim tab in `sacn_in` is an unsuppressable priority-150 second writer to every titanic controller, **sharing the engine's CID** | **HIGH** | known (D2+D3), titanic exposure NEW |
| T5 | That tab holds its last frame forever if the engine or bridge dies — masking a dead show at a priority that outranks the relay | **HIGH** | NEW |
| T6 | `playlists/default.yaml`: **45 of 72 entries** name patterns that do not exist | **HIGH** | NEW (pre-existing at HEAD) |
| T7 | `states/titanic/audio_state.yaml` carries `capture.device: test` — no mic at boot, every audio modulation dead | **HIGH** | NEW (pre-existing at HEAD) |
| T8 | 3 of 6 LED controllers are `provisional` (board never met); a 4th is bound to the **test-bench** board | **HIGH** | NEW |
| T9 | Uncommitted tree: tracked code top-level-imports untracked files — a clean checkout cannot boot | **HIGH** (process) | NEW |
| T10 | D4 arbitration dead by config **and global across universes** | MEDIUM | known |
| T11 | Injection surfaces: `:6972` unauthenticated on all interfaces, OSC `:10000` with an empty allowlist, `:6969` serves the **repo root** with CORS | MEDIUM | partly known (D7) |
| T12 | D5 silent receiver drops — no `PacketOutOfOrder`/`PacketCorruption` listener | MEDIUM | known |
| T13 | D8 no `'error'` listener on any Sender socket | MEDIUM | known |
| T14 | Persisted mixer layer masked to `RIGHT` at full fader; deck left on `13_sparkle` | MEDIUM | NEW |
| T15 | `default` playlist entry 0 at `sliderLevel: 0.12` vs the pattern's own 0.62 | MEDIUM | NEW |
| T16 | `CTRL_n` ordinal is not countable in the panel it is named after; 12 of 18 collide with a *different* controller's stable `id:` | MEDIUM | NEW |
| T17 | Headless prod emits **no** periodic proof that frames are flowing | MEDIUM | NEW |
| T18 | Any single child exit tears the whole stack down; a *frozen* bridge takes up to ~42 s to detect | MEDIUM | NEW |
| T19-T27 | see §8 | LOW | mixed |

---

## 1. The verified titanic route table

Derived offline (`~/tmp/titanic_scene_review_160/route_table.cjs`) by feeding the real
`simulation/scenes/titanic/patches.yaml` through the real
`simulation/lib/bridge_routing.cjs` `readPatchDeclarations` → `partitionRoutePairs` — i.e. the exact
functions `sacn_bridge.js` calls. **38 routes, 38 distinct universes, 0 refusals, 0 anomalies,
0 universes routed to more than one IP.**

| U | → controller | name | U | → controller | name |
|---|---|---|---|---|---|
| 2 | 10.x.x.10 | LeftFrontWall p1 | 22 | 10.x.x.19 | RightBackWall p1 |
| 3 | 10.x.x.10 | LeftFrontWall p2 | 23 | 10.x.x.19 | RightBackWall p2 |
| 4 | 10.x.x.10 | LeftFrontWall p3 | 24 | 10.x.x.19 | RightBackWall p3 |
| 5 | 10.x.x.11 | LeftFrontDeck p1 | 25 | 10.x.x.20 | RightSmokeStack p1 |
| 6 | 10.x.x.11 | LeftFrontDeck p2 | 26 | 10.x.x.20 | RightSmokeStack p2 |
| 7 | 10.x.x.12 | LeftBackDeck p1 | 27 | 10.x.x.21 | RightSmallSmokeStack p1 |
| 8 | 10.x.x.12 | LeftBackDeck p2 | 30 | 10.x.x.60 | LeftLeftRopes o1 (LED) |
| 9 | 10.x.x.13 | LeftBackWall p1 | 31 | 10.x.x.60 | LeftLeftRopes o2 (LED) |
| 10 | 10.x.x.13 | LeftBackWall p2 | 32 | 10.x.x.61 | LeftRightRopes o1 (LED) |
| 11 | 10.x.x.13 | LeftBackWall p3 | 33 | 10.x.x.61 | LeftRightRopes o2 (LED) |
| 12 | 10.x.x.14 | LeftSmokeStacks p1 | 34 | 10.x.x.62 | RightLeftRopes o1 (LED) |
| 13 | 10.x.x.14 | LeftSmokeStacks p2 | 35 | 10.x.x.62 | RightLeftRopes o2 (LED) |
| 14 | 10.x.x.15 | LeftSmallSmokeStack p1 | 36 | 10.x.x.63 | RightRightRopes o1 (LED) |
| 15 | 10.x.x.16 | RightFrontWall p1 | 37 | 10.x.x.63 | RightRightRopes o2 (LED) |
| 16 | 10.x.x.16 | RightFrontWall p2 | 38 | 10.x.x.64 | LeftTeSign o1 (LED) |
| 17 | 10.x.x.16 | RightFrontWall p3 | 39 | 10.x.x.64 | LeftTeSign o2 (LED) |
| 18 | 10.x.x.17 | RightFrontDeck p1 | 40 | 10.x.x.65 | RightTESign o1 (LED) |
| 19 | 10.x.x.17 | RightFrontDeck p2 | 41 | 10.x.x.65 | RightTESign o2 (LED) |
| 20 | 10.x.x.18 | RightBackDeck p1 | | | |
| 21 | 10.x.x.18 | RightBackDeck p2 | | | |

**Cross-checks, all clean:**

- **Engine-emitted set == route set.** Parsing all 964 pixels of `marsin_engine/models/titanic.js`
  (`~/tmp/.../model_scan.cjs`) gives emitted universes `{2..27, 30..41}` — **38, identical to the
  route table**. `engine.js:1363-1371` builds `universeIds` from exactly those pixel patches.
  → **No universe the engine emits lacks a route. No route lacks an engine feed.**
- **Zero unpatched pixels, zero pixels without a `patch:` block** (964/964).
- **controllers.yaml ports == route universes**, and every route IP equals the IP of the controller
  whose port declares that universe. No orphan route, no dark port.
- The single `parkedOutputs` entry (`LeftLeftRopes` output 3, U42) correctly has **no** patch record
  and therefore **no** route — parked, not dark.
- **Address occupancy per universe** (from the model's own `addr`+`footprint`): max channel used is
  238 (the 3× ShehdsBar universes), no fixture crosses 512, **no channel claimed twice**.
- `📡 Subscribed Universes` (`simulation/scenes/common.yaml:192`) reads `1..27, 30..42` — a superset
  of all 38, so every titanic universe is joined at boot; nothing depends on the runtime re-diff.
- The bridge's `--scene` default is **`titanic`** (`simulation/server/sacn_bridge.js:27`), so the
  relay route set exists from boot regardless of the engine poll or any browser client.

**`scene_model_parity` (`simulation/tools/scene_model_parity.cjs titanic --strict`): PASS —
0 errors, 0 warnings, 1 info** (the info is "no `TB ` bench block", which is plan step 6 not yet
applied — expected). 80 DMX fixtures + 8 LED strands + 18 controllers → 964 model pixels; the scene
implies 964.

---

## 2. BLOCKER T1 — `stop` freezes the ship; it does not turn it off

`.agent/ops/show_server_ops.md:30` (`# park it: stop the stack (lights OFF)`), `:63`, `:75`
("`stop` **kills the lights**") and `deploy/README.md:19,364` ("park it safely (lights OFF) — e.g.
**before generator work**") all promise a dark rig.

What actually runs: `deploy/deploy.py stop_stack()` → `node launcher.js stop` →
**`launcher.js:1074` `if (IS_WIN) forceKillTree(lock.pid)`** → **`launcher.js:438-448`
`taskkill /PID <pid> /T /F`**. `/F` is `TerminateProcess`: **the engine never runs its SIGTERM
handler**, so the blackout at `marsin_engine/engine.js:2521-2549` (verified present and correct:
zeroes every pixel, re-maps, `sacnOut.sendFrame(blackBuffers)`) is **never sent**. The relay bridge
dies in the same tree, so nothing could carry a blackout even if one existed —
`sacn_bridge.js:2307-2313` exits immediately unless the *bench mirror* is armed.

**On playa today:** after `stop`, every controller holds its last live frame until its own E1.31
data-loss timeout. The repo itself calls that timeout unknown
(`sacn_bridge.js:2301-2303`: *"leaves the composed frame frozen on the box until an unknown
device-side `dmx.timeoutMs`"*). An operator doing generator or wiring work on the strength of
"lights OFF" may be working under a rig that is still lit — potentially at full.

**Operational workaround until fixed:** never treat `stop` as an isolation step. Before touching
anything electrical, drive an explicit blackout **and confirm it by eye**
(engine `POST /global-blackout`, or the pad's blackout), *then* `stop`, *then* kill power to the
controller PSUs. Do not rely on the docs' wording.

**Also note** (`_157` D10, re-confirmed at `engine.js:2549`): even on a *graceful* shutdown the
blackout is sent **once**, while the engine's own stale-universe path
(`engine.js:1753-1759`) documents and applies a 3× rule. One lost datagram on exit = frozen bright.

---

## 3. BLOCKER T2 — the persisted show state boots the entire ship at ~3-18 %

`marsin_engine/states/titanic/globals_state.yaml` `dimmers:` — **all 24 titanic groups are named,
and every one is in the 0.0268-0.1786 band**:

```
  TE Sign: 0.0535714285714286          Right Front Wall: 0.0267857142857143
  Left_Front_Left: 0.1339285714285714  Left Small SmokeStack: 0.0357142857142857
  Left_Back_Left: 0.0803571428571429   Right SmokeStacks: 0.0803571428571429
  Left Back Wall: 0.1607142857142857   Right Back Wall: 0.0982142857142857
  … 24 named groups total, range 0.0268 – 0.1786
```

At HEAD only **three** name keys existed (`TE Sign`, `Left_Front_Left`, `Left_Back_Left`) and all
three were **`1`** (full). This working tree drops those three to 0.05/0.13/0.08 and adds the other
21 at the same low band.

**This is restored at every show boot, silently:**

- `marsin_engine/lib/state_paths.js:1-33` — `marsin_engine/states/<scene>/` **is** the operator's
  tracked show state and is authoritative at boot unless `MARSIN_STATE_DIR` is set (it is not, in the
  show path).
- `marsin_engine/lib/state_manager.js:428-448` restores it directly:
  `if (Object.prototype.hasOwnProperty.call(groups, key)) intensityController.setSectionBrightness(groups[key], bright);`
  A **name** key that resolves logs nothing. Only an *unresolvable* name warns (`:444-446`).

I checked whether the legacy numeric keys also bite: they do not. The keys `'1'..'17'`, `'189'`,
`'486'..'498'` are applied verbatim via the `/^\d+$/` branch (`state_manager.js:441-442`), but the
titanic model's actual section ids are `{3, 18-25, 415, 514-527}` — **no numeric dimmer key
intersects that set**, so all of them are inert. The damage is done entirely by the 24 name keys.

The values are quantised to `n/112` — they are **hand-set UI slider positions**, not test output.
Almost certainly indoor/desk dimming that must not ship.

**Against the codex's first and only mission-critical goal — "make the Titanic exterior … highly
visible at night" — this is the single most direct failure in the tree, and nothing in the stack
says a word about it at boot.**

**Operational workaround:** before the first night, raise every section dimmer on the pad and
**re-save**, or clear the `dimmers:` map. Verify by reading back
`marsin_engine/states/titanic/globals_state.yaml` after the save — do not trust the slider positions,
because they are what got us here.

---

## 4. BLOCKER T3 — D1's ×2.55 clip, and the fact that it is currently *hiding* T2

### 4.1 Mechanism, independently reproduced

`marsin_engine/lib/sacn_output.js:75-80` builds `payload[ch+1] = data[ch]` with raw **0-255** DMX
values and never sets `useRawDmxValues`. The vendored `sacn@4.6.2` treats `payload` as **percent**:
`node_modules/sacn/dist/packet.js:138` → `n[125 + ch] = inRange(payload[ch] * 2.55)`,
`util.js:inRange` clamps at 255.

Reproduced in-process against the real `Packet` class, no socket opened
(`~/tmp/titanic_scene_review_160/d1_probe.cjs`):

```
engine DMX in :  0  1  2  5 10 20 26 40 50 64  80  99 100 101 128 153 180 200 230 254 255
wire byte out :  0  3  5 13 26 51 66 102 127 163 204 252 255 255 255 255 255 255 255 255 255
CID (16 B)    : 6b796c6548656e73656c44656661756c   ("kyleHenselDefaul" — the package default)
```

Everything at or above DMX 101 leaves as 255. The whole 101-255 half of the range is one flat clip;
the 0-100 half is stretched 2.55×. Colour is the casualty: an amber (255,128,0) leaves as
(255,255,0) — **yellow**. Every fade above 40 % is a plateau.

`sacn_output_bridge.js:187-190` has the **identical** bug on the sim's priority-150 lane.
The relay itself is innocent — `sacn_bridge.js` `sendVia()` resends the objectified percent floats,
which round-trip the already-clipped wire byte exactly (`_157` P8, not re-measured).

### 4.2 The NEW part — D1 and T2 are cancelling each other, and fixing D1 alone makes the ship darker

This is the one place where seeing the whole scene context changes `_157`'s picture. `_157` ranked
D1 #1 on colour and warned the fix needs its own before/after gate. Correct — but with T2's dimmers
now in the file, the two defects sit on top of each other:

```
group                    dimmer   engine DMX   wire byte   apparent
Right Front Wall           2.7 %       7          18          7 %
TE Sign                    5.4 %      14          36         14 %
Left Small SmokeStack      3.6 %       9          23          9 %
Left Back Wall            16.1 %      41         105         41 %
Left_Back_Right           17.9 %      46         117         46 %
```

The ×2.55 gain is the only reason a 2.7 %-dimmed section is putting out 7 % instead of 2.7 %.
**Flipping `useRawDmxValues` without first fixing T2 takes the wire byte down to the "engine DMX"
column — the ship gets 2.55× darker across the board.** The D1 slice and the dimmer reset must land
in the same operator gate, in that order, or the "fix" will read as a regression on the night.

**Operational workaround until the D1 slice lands:** none that preserves colour. Live with the
saturation; do **not** compensate by lowering pattern levels, because that moves the rig into the
part of the curve where the clip is *not* active and the fix will then double the brightness instead
of halving it. Note also that the browser preview is exactly 1/2.55 of the wire
(`sacn_bridge.js:2249-2256` writes percent floats into a `Uint8Array`, `sacn_mapper.js:124-131`
divides by 255) — so the sim shows the *shape* of the clip honestly but at 39 % of the brightness.

### 4.3 D6 / the U10-U12 story — verified CLOSED

`marsin_engine/config.yaml` now reads `sacn: { destinations: [127.0.0.1] }` with **no `controllers:`
block** and no stray `alsoFlat:`. `engine.js` builds `createSacnOutput` directly; the removed
`output_dispatch.js` / `artnet_output.js` are gone from the worktree. `/status.outputRouting` is a
hardcoded `{controllers: []}` (`api_server.js:4995`), so `engineOwnedPairs()`
(`bridge_routing.cjs:374-386`) returns an empty set and **subtracts nothing** from the 38 routes.
U10 (`10.x.x.13`, Left Back Wall 3/4) and U12 (`10.x.x.14`, Left SmokeStack 1-4) are in the route
table above, fed by the engine, subtracted by nobody. **Confirmed not dark.**

---

## 5. HIGH findings

### T4 — a sim tab in `sacn_in` is a second writer on every titanic controller, under the engine's own CID

`simulation/src/core/animate.js:703-736`: in `sacn_in` lighting mode the loop admits **every** patched
fixture (`:721`), groups by `universe:ip`, hard-codes **`priority: 150`** (`:726`), and sends the full
universe buffer at browser render rate (~60 fps vs the engine's 40) through `:6972` →
`sacn_output_bridge.js` → **direct unicast to the real controller**. Bench mirror **disarmed** means
`benchMirrorArmed` is false at `:702` and the `_156` gate is not asserted — nothing stops it.

For titanic that is **all 38 universes to all 18 controllers**, at a priority that outranks the
relay's 100, from a source whose CID is the *same* package default the relay uses
(`sacn_bridge.js:819-825` creates relay senders with **no `cid:`**; only the bench-mirror senders at
`:869-878` set a distinct one). Two writers sharing `CID + universe` is exactly the state `_157`
probe P4 measured at **98 of 100 packets dropped**.

The ops docs actively create this state: `show_server_ops.md` tells the operator to *"open the sim
view … and confirm the lights are actually animating"*.

**Operational workaround:** during the show, if you open the sim, keep it in a lighting mode **other
than `sacn_in`** with mapping disabled — in every other mode the output loop is gated by
`isMappingOutput` (`animate.js:721`) and titanic has no global-effect fixtures to force through, so
the tab is inert. If you must watch in `sacn_in`, accept that you are a second writer and expect
flicker/dropouts; close the tab the moment you are done. One tab, never two.

### T5 — that tab then holds its last frame forever

`animate.js:730-733` re-emits `window.dmxRouter.getFullFrame(u)` unconditionally.
`simulation/src/dmx/universe_frame_buffer.js:68-77` is explicit hold-last-frame ("If not dirty, read
buffer retains last valid frame"), and the 2 s staleness notion in `universe_router.js:116-161`
affects *merging*, never *emitting*. So if the engine or the input bridge dies while a `sacn_in` tab
is open, the tab keeps painting the ship with a frozen frame at priority 150 **indefinitely** — the
show is dead and the rig looks alive. Mitigating: prod is headless by default
(`deploy/boot_server.ps1:257` passes `--no-launch`), so this is armed only when someone opens the sim.

### T6 — 45 of 72 entries in `playlists/default.yaml` name patterns that do not exist

Measured: the titanic `default` playlist has 72 entries; **45** reference patterns absent from
`marsin_engine/patterns/` — `40_ghost_ship_reveal`, `44_apex_gyro_vortex`, `70_forest_canopy_reveal`,
`110_logsville_giant_pixel_chase`, … They are summer-camp / dome / tower / logsville patterns that
live in `marsin_engine/patterns/summer_camp/`, while `PlaylistManager.patternExists()`
(`marsin_engine/lib/playlist_manager.js:100-111`) resolves `<patternsDir>/<name>.js` against the
**root** patterns dir. Identical at HEAD (72 entries, 45 missing) — this is **pre-existing, not this
branch's residue**.

It degrades safely rather than crashing: `playlist_manager.js:187` marks them `_missing` and
`autopilot_pick.js:63` skips `_missing`/`_broken`. But the timeline plan's `daytime`,
`philharmonic`, `party`, `sunrise`, `burn_night` and `temple` looks **all** point at `default`
(`simulation/scenes/titanic/timeline/playa_default.yaml`), so the show's primary playlist is running
on **27 usable entries out of 72**, and the operator's pad shows 45 ⚠ rows. Every other titanic
playlist (`ambient`, `party_high`, `party_low`, `burn_night`, `white_only`, …) is clean — 131/131
pattern refs resolve.

### T7 — no microphone at boot

`marsin_engine/states/titanic/audio_state.yaml` carries `capture: { device: test, deviceLabel: null,
deviceId: null, inputFormat: null }` — unmodified in this branch, i.e. committed at HEAD.
`state_paths.js:1-15` names this exact value as the cause of a prior outage (a bogus `device: test`
restored at the next real boot spun ffmpeg into a crash loop). `findConfiguredDevice`
(`marsin_engine/audio/capture/audio_devices.js:172-189`) returns `null` for it. **`test_bench` was
fixed in this very tree** (`-device: test` → `+device: audio=Microphone (…)`) and **titanic was
not**. Every audio modulation in the retuned `default` playlist — and the timeline's whole
`mood: true` autopilot — is dead until this is set to a real device.

### T8 — LED controller bindings: half the LED fleet has never been met

`simulation/scenes/titanic/controllers.yaml`, `device:` blocks:

| controller | IP | binding grade |
|---|---|---|
| LeftLeftRopes | 10.x.x.60 | **VERIFIED, but `controllerId: testbench`, `boardId: angio4-old`**, `lastPush` 2026-08-03 |
| LeftRightRopes | 10.x.x.61 | VERIFIED — `leftside_stack_a` / `angio4-new` |
| RightLeftRopes | 10.x.x.62 | **provisional: true** |
| RightRightRopes | 10.x.x.63 | **provisional: true** |
| LeftTeSign | 10.x.x.64 | **provisional: true** |
| RightTESign | 10.x.x.65 | VERIFIED — `rightside_stack_a` / `angio4-new` |

`provisional` is a documented, *intentional* grade (`controller_registry.js:125-150`, operator ruling
2026-07-31): routes, patches and model lanes all exist so the chain completes the moment the board
powers on. So this is **not a data defect**. It is the size of the live-hardware gap: **3 of 6 LED
controllers are boards nobody has met and whose output/universe config has never been pushed**, and a
4th — the port carrying `Left_Front_Left` / `Left_Back_Left`, 80 px of the ship's silhouette — is
currently bound to the **test-bench** board. Per the `marsinled-controller-onboarding` memory, only
VERIFIED cards bind by `controllerId`; provisional cards are matched by IP alone.

### T9 — the tree only runs because of uncommitted files

Tracked, modified files import untracked modules at top level, so a clean checkout of this branch
hard-crashes at startup (correctly — codex P0, no fallback):

- `marsin_engine/engine.js:64` → `./lib/output_config_guard.js` — **untracked**
- `simulation/server/sacn_bridge.js:68` → `../lib/bench_mirror_resolve.cjs` — untracked
- `simulation/src/dmx/sacn_input_source.js:18` → `../gui/bench_mirror_banner.js` — untracked
- `simulation/src/gui/modern/controller_map_panel.js:42-43` → `bench_mirror_control.js`,
  `bench_mirror_picker.js` — untracked

Compounding: `marsin_engine/lib/{artnet_output,output_dispatch}.js` are **deleted but unstaged**, and
`config.yaml`'s `controllers:` block is removed — changes that are only consistent *with* the
untracked guard present. **This is `_156`'s in-flight slice, not a scene defect** — but it must land
as one unit, and no deploy may be cut from this tree until it does.

---

## 6. Known-defect exposure on playa — per-defect ruling

The operator asked specifically: what does each of `_157`'s open defects do to the **titanic** scene
today, what is the workaround, and is any of them worse than `_157` judged now that the whole scene
is in view.

| `_157` | Titanic exposure TODAY | Workaround until the fix slice lands | Worse than `_157` judged? |
|---|---|---|---|
| **D1** ×2.55 clip | Ship-wide. All 964 pixels, both lanes. Colour crushed, top 60 % of every fade flat. Ship is **bright**, not dark. | None that preserves colour. Do **not** compensate with lower pattern levels. | **YES, in sequencing.** It is currently the only thing lifting T2's 3-18 % dimmers to a visible level. Fixing D1 alone makes the rig 2.55× darker. The D1 slice must ship **with** the dimmer reset. `_157`'s severity ranking is not disputed. |
| **D3** shared CID | Latent while the engine is the only writer. Becomes a **98 %-drop event** the moment a `sacn_in` sim tab exists (T4) — the relay (`sacn_bridge.js:819`, no `cid:`) and the output bridge (`sacn_output_bridge.js:94-104`, no `cid:`) both use `kyleHenselDefaul`. Verified 16 B in my probe. | Never open `sacn_in` while the engine is driving. One writer at a time. | **YES, in reachability.** `_157` ranked it #3 as a general hazard; on titanic it is one operator click away and the click is the one the ops docs recommend. |
| **D4** dead + global arbitration | Confirmed at `common.yaml:200-205` (`sacn_high_priority: 100`, slider `min: 100`) and `sacn_bridge.js:1274-1300`. The engine's own 100 latches `highPriorityActive` permanently, so the `else` branch never runs and **both** writers are relayed rather than one winning. Globals mean any ≥100 source on **any** universe latches for **all**. | Keep third-party consoles off the lighting LAN; keep the threshold where it is (raising it to 150 *without* the per-universe scoping would let one stray tab black out the whole rig). | No — `_157`'s "latent trap in the planned fix" is exactly right, and this review adds nothing except that on titanic the latch source is the engine itself. |
| **D5** silent receiver drops | `sacn_bridge.js` registers only `receiver.on('error')` (`:1226`) and `receiver.on('packet')` (`:1263`). Grep: **zero** `PacketOutOfOrder` / `PacketCorruption` listeners anywhere. So every drop in D3's and D9's classes is invisible in every log and every monitor. | Diagnose two-writer symptoms by *closing browsers one at a time* and watching the rig, since the logs will not tell you. | **YES, in combination.** It is the reason T4 will present on the night as "the ship is behaving weirdly" with a clean log. It is also the cheapest fix in the list and should land first. |
| **D7** injection | `sacn_output_bridge.js:141` `new WebSocketServer({ port })` — **all interfaces**, no auth: any LAN client can push 519-byte frames → unicast sACN to **any IP at any priority**. Plus, newly found: `marsin_engine/config.yaml` `osc: { host: 0.0.0.0, port: 10000, allowedSenders: [] }`, and `osc_listener.js:542` only filters when the allowlist is **non-empty** — so any LAN device can drive `micLow`/`micKick`/`audioBpm`/every CPC param. Plus `simulation/start.js:89` serves the **repo root** on `:6969` with `--cors`. Plus multicast-in with no source filter and D4's threshold at 100. | Put the lighting LAN on its own SSID/VLAN with a password nobody hands out. Firewall 6969/6971/6972/10000/7703 to the show box. If CaptainPad is not in use, do not run the output bridge at all — **the titanic show does not need `:6972`**: light flows engine → loopback → input bridge relay → controllers, and `:6972` only carries browser→hardware traffic. | **YES, widened.** `_157` named `:6972` and multicast; the OSC port with an empty allowlist and the repo-root HTTP server are additional surfaces on the same LAN. |
| **D8** no sender socket error listener | Confirmed: `node_modules/sacn/dist/sender.js:41` creates the dgram socket and registers no `'error'`; no project code touches `sender.socket`. On titanic the engine holds 38 senders and the bridge 38 more, all aimed at boxes that will go up and down on a dusty playa network. A socket-level error event is an uncaught exception → **process death**. | If the engine or a bridge dies with no diagnosis in the log, suspect this. `start.js` restarts a bridge in ~1 s; an engine death tears the whole stack down for ~10 s + cold boot (T18). | No — but note the exposure scales with route count, and titanic has the largest route count in the repo (38 vs the bench's handful). |

**D2** is `_159`/`_156`'s; **D6** is closed (§4.3); **D9-D12** are LOW (§8).

---

## 7. Views / mixer, offline readiness, partial-stack boot

### 7.1 Views — clean, no blocker (measured against the real model)

`buildViewCatalog()` on `models/titanic.js` yields **exactly 58** names, and the `MaskRegistry` agrees
exactly (0 one-sided): **24 base groups + 7 authored word-1 composites + 27 auto-views**
(4 spatial `LEFT/RIGHT/FRONT/BACK`, 5 typed, 18 `CTRL_n`).

- **Zero dead selectors** — the smallest view is 4 px (`CTRL_8`, `CTRL_15`).
- **Zero bit collisions**; word-0 union `0xcf3ffff` (24 bits), word-1 union `0x12664` (7 bits);
  31 of 62 VM slots used, 31 free vs 27 promotable names — the budget cannot be exhausted.
- `LEFT ∪ RIGHT = 964`, exhaustive and disjoint — no controller straddles the centreline.
- `simulation/scenes/titanic/views.yaml` and `models/titanic.viewmasks.js` are **byte-equivalent**
  (24 groupBits same order/values, 7 customs matching name/bit/word/groups).
- **`CTRL_n` selects the correct physical box for all 18** — verified by joining model universes to
  `controllers.yaml` port universes: 18/18 exact, sum 964. `cId` is the controller's **panel
  ordinal** (`pixelblaze_model_exporter.js:247`, `controller_registry.js:1903-1912`, operator
  decision 20 in `docs/33`), not the stable `id:`. **No wrong-box bug.**
- The persisted `mixer_state.yaml` `target: RIGHT` **is** a valid catalog name (482 px). See T14 for
  why that is still a problem.

**T16 (MEDIUM)** falls out of the ordinal: the Controller Mapping panel renders **all DMX cards then
all LED cards** (`controller_map_editor.js:1025-1028`) while the ordinal is the *interleaved* array
index, so counting cards top-to-bottom gives the wrong number for **14 of 18**; no card displays its
ordinal; and the pad picker shows only `CTRL_9 · 80 px` with no name or IP
(`view_selection_picker_logic.ts:64-69`). Separately, **12 of the 18 `CTRL_n` numbers are also a
different controller's stable `id:`** in `controllers.yaml` (`CTRL_3` = LeftFrontDeck but `id: 3` is
LeftFrontWall; `CTRL_17` = LeftTeSign but `id: 17` is RightFrontDeck; …). At 3 a.m. in dust, that is
a strike-time trap.

### 7.2 Offline readiness — CLEAN

Swept `simulation/index.html`, `main.js`, `src/**`, `server/**`, `vendor/**`, `marsin_engine/**` and
`CaptainPad/dist/**` for external hosts, CDNs, fonts, telemetry, off-site sourcemaps, runtime `npm
install`, NTP and license checks. **No show-time external fetch exists.** Every browser→backend URL
is derived from `window.location.hostname` (`engine_endpoint.js:14-34`); all sim asset loads are
relative; every importmap entry and `<link>` in `index.html:11-32` resolves to a file present in
`simulation/vendor/**` (three.webgpu, three.tsl, js-yaml, chroma-js, preact, htm, preact-signals, both
font CSS files and all 6 woff2) — **zero missing**. `CaptainPad/dist`'s `fonts.gstatic.com` hits are
dead metadata; the TTFs are bundled. `node_modules` ships with the deploy (`deploy/deploy.py:92-104`).
Expo telemetry is suppressed (`launcher.js:1264`). No wall-clock/NTP dependency.

Two non-prod exceptions, recorded: `CaptainPad/package.json:15` `npx serve` would hit the registry
offline (`serve` is not a dependency and not in `node_modules`) — not on the prod profile but it *is*
the documented way to bring CaptainPad web up; and `CaptainPad/hooks/useServerDiscovery.ts:129`
`Network.getIpAddressAsync()` becomes `fetch('https://api.ipify.org…')` on **web** builds, which hangs
to timeout offline before degrading (iOS native is unaffected).

### 7.3 Boot order and partial-stack behaviour

```
Scheduled Task → deploy/boot_server.ps1 (relaunch loop, 10 s)
  └─ node launcher.js prod --scene <scene> --no-launch
       ├─1─ simulation/start.js  → http :6969 · save :6970 · sacn_bridge :6971 · out_bridge :6972
       │      launcher BLOCKS on 6969 (90 s) → 6970 → 6971 → 6972
       ├─2─ marsin_engine/engine.js :6968   (blocks on /status, 120 s)
       └─3─ audio companion :6966
```

Bridges **must** precede the engine: `config.yaml` sends only to `127.0.0.1` and
`lib/output_config_guard.js` forbids any direct-to-hardware route, so frames the bridge is not up to
receive are simply lost — nothing buffers.

| case | behaviour | loud? | show impact |
|---|---|---|---|
| engine up, `:6971` not listening | engine unicasts into a void; logs only "Sender started" (`sacn_output.js:106`) | **SILENT** | ship fully dark. Prevented in practice by `launcher.js:1168` |
| `:6972` down, `:6971` up | only the browser client and the mirror gate link care | browser console; ARM refuses loudly | **none** — the prio-100 relay is unaffected |
| `:6971` down, `:6972` up | all physical output stops; an open `sacn_in` tab keeps unicasting its **held** frame at 150 forever | silent at wire level | frozen ship (T5) or no feed |
| **no browser open at all** | `routeFrame()` relays **before** the `wss.clients.size === 0` return (`sacn_bridge.js:2241-2249`); routes seed from the `--scene` pin (`:625`) | n/a | **✅ light reaches the controllers with no browser. The show does not require a tab.** |
| a bridge crashes | `start.js:169-209` restarts after 1 s; >5 in 60 s escalates and kills the whole sim stack | LOUD | ~1 s gap (invisible to E1.31 receivers) or a full cold boot |
| engine crashes | `engine.js:1090-1103` exits(1) **without** the blackout; `launcher.js:1219` tears the whole stack down; boot_server relaunches after 10 s | LOUD | outage ≈10 s + cold boot; frozen-vs-dark is firmware-determined |
| machine sleeps / link drops | sleep disabled at provisioning (`setup_power.ps1:50-52`); a link drop throttles relay errors to 1/30 s and auto-recovers | throttled | dark/frozen for the outage, self-heals |

**T17 (MEDIUM)** — `sacn_bridge.js:1302-1309` gates the `N packets/5 s` line on `clientCount > 0`,
and `broadcastLog()` returns immediately with zero WS clients (`:1317`). Prod is headless, so
`boot_server_*.log` contains **no periodic proof the ship is being fed**. The deploy verify checks
`restart_count` and engine `/status` — never frame flow.
**T18 (MEDIUM)** — any tracked child exiting non-75 tears everything down (`launcher.js:651-668`), so
an audio-companion crash darks the ship exactly as hard as an engine crash; and a *frozen* (not
crashed) bridge takes up to **~42 s** to detect (`start.js:63-65`: 10 s × 3 misses × 4 s timeout).

---

## 8. Residue audit and LOW findings

Titanic **scene** files are clean vs HEAD except two UI-residue files. The engine **state** files are
where the real residue is (T2, T7, T14, T15 above). No merge-conflict markers, no added
TODO/FIXME/debugger, no `.only`/`.skip` added, anywhere under `simulation/` or `marsin_engine/`.
`python scripts/security_check.py --all` → **6 findings, exactly the known baseline** (all
`bm26-mac-address` in gitignored `.scene_backups/studiodj/**`). No cross-scene playlist leakage —
the other four scenes' playlist diffs are a coherent slider rename matching the new
`00_golden_hour_wash.js` exports, and the prior "playlist residue revert" has **not** reappeared.

- **T14 (MEDIUM)** `states/titanic/mixer_state.yaml`: channel `ch_1785801995942_0` ("New Layer") is
  `enabled: true, fader: 1, mode: blend_screen` with `viewSelection.target` changed
  `Stacks` → **`RIGHT`** — a full-fader screen layer over half the ship, restored at boot.
  `states/titanic/deck_state.yaml`: pattern `00_golden_hour_wash` → **`13_sparkle`**, cursor 2 → 22,
  and the whole `localControls` map replaced (14 ids). Both resolve, so nothing fails — the ship just
  opens on the wrong look, asymmetrically.
- **T15 (MEDIUM)** `playlists/default.yaml` entry 0 now carries `sliderLevel: 0.12` with a
  `0 .. 0.5` `micLow` modulation range, while `marsin_engine/patterns/00_golden_hour_wash.js:21,29`
  declares `level = 0.62` and documents `0.42..0.92`. `studiodj` got `0.62`. Stacked on T2's dimmers
  and T7's dead mic, the golden-hour cue lands at roughly 1 % of nominal.
- **T19 (LOW)** `RightRightRopes` is the only LED controller carrying an explicit `led.wire` block
  (`foldAmber: true`, `amberRgb [0.9,0.6,0]`, gamma 1s, `controllerWhite: fold_extract`). Measured:
  only its 80 pixels carry `ledWire:` in the model; the other 240 rope pixels do not. **Currently a
  no-op** — those values are byte-identical to `LED_WIRE_DEFAULTS` (`led_wire.js:111-124`,
  `:71`, `:87`), so all 8 ropes encode the same today. It is a **drift hazard**: change the defaults
  and 6 ropes follow while 2 do not, producing a visible left/right split on the silhouette.
- **T20 (LOW)** `FRONT ∪ BACK` = 776 px, not 964 — 188 px (both TE signs, all four smokestack groups,
  both auditoriums) are in **neither** (`auto_views.js:83-88` keys on group-name tokens). By design;
  worth knowing before assuming it is a full-ship split.
- **T21 (LOW)** `simulation/scenes/common.yaml` default camera moved from a wide framing to close-in
  (`z: 67.21 → 12.09`, target `y: 8 → 0.035`). Shared by every scene; `agent_render.cjs` preset views
  and any default sim load now come up zoomed into the hull. `pixel_map_views.yaml` changed only
  `framing.zoom/panX/panY`. Both are editor-viewport residue, zero rig impact.
- **T22 (LOW)** `pixel_map_views.yaml:19` excludes `group: Left Center Auditorium` — a group that
  exists nowhere in the repo. Unknown groups in an `exclude` list silently match nothing
  (`pixel_map/pixel_map_views.js:705-710`). Inert.
- **T23 (LOW)** `simulation/tests/pixel_map_view_defaults.test.js:487` fails on the live titanic
  scene: "the smallest collapsed band (5.20) is too close to the 5-unit threshold". A 2D-map layout
  fragility warning, not a rig defect — but it is a real margin that a future fixture move will break.
- **T24 (LOW)** `simulation/scenes/titanic/timeline/playa_default.yaml:9` carries
  `festival.startDate: '2026-08-30'` — a **future date in a tracked file**, which
  `AGENTS.md`/`security_privacy.md` forbid. The plan needs a date to function, so this needs an
  operator ruling (exemption, or move the date to config) rather than a silent fix.
- **T25 (LOW)** `_157` D9/D10/D11/D12 stand unchanged: sequence reset on sender re-creation (route
  churn, the `:6972` 15 s idle reap at `sacn_output_bridge.js:123-133`); Stream_Terminated never set
  and the shutdown blackout sent 1× (§2); unicast senders skip universe validation; falsy-default
  conflations.
- **T26 (LOW)** Silent browser fallbacks: `sacn_input_source.js:489-493` and
  `sacn_output_client.js:230-233` hardcode ports 6971/6972 when the config fetch fails — a codex-P0
  fallback, and it contradicts `engine_endpoint.js:9-11`'s explicit "throw loudly" contract.
- **T27 (LOW)** `marsin_engine/lib/ffmpeg_resolver.js:47-57` has an `await import()` inside a function
  wrapped in try/catch, falling back to bare `'ffmpeg'` on PATH — two codex rule violations in one
  place, on the audio path that T7 already breaks.

**Timeline plan cross-check (clean):** every playlist the plan names (`default`, `ambient`,
`party_high`, `party_low`, `white_only`) exists, and every palette it names (`deep_sea`,
`sunset_coral`, `bass_drop`, `aurora`, `ultraviolet`) is in `marsin_engine/config.yaml`.

---

## 9. Test measurements

| suite | result | note |
|---|---|---|
| `simulation` `npm test` | **1881 / 1875 / 6** | vs `_158`'s baseline **1875/1869/6** — **+6 tests, zero new failures**. All 6 pre-existing: 5 in `bench_section_sync.test.js` (the bench block reserves U10/U12, which titanic already occupies — plan step 6 **not yet applied**, exactly what `scene_model_parity`'s info line says) and 1 = T23. |
| `scene_model_parity titanic` | **PASS** — 0 err / 0 warn / 1 info | info = no `TB ` bench block |
| `scene_model_parity titanic --strict` | **PASS**, exit 0 | the hardware gate |
| `security_check.py --all` | **6**, baseline | gitignored `.scene_backups/studiodj/**` only |
| `marsin_engine` `npm test` | **not run** | deliberate: it rewrites `states/titanic/*.yaml`, which is the exact artifact T2/T7/T14 are about. `_158` ran it twice (2631-2634 / 7 fails, ±3 nondeterministic). Running it here would have destroyed my own evidence. |

---

## 10. READY / NOT-READY

### Scene data — **READY**

`controllers.yaml`, `patches.yaml`, `scene_config.yaml`, `views.yaml`, the 964-pixel model and its
viewmasks sidecar are mutually consistent and pass the strict hardware gate. 80 DMX fixtures +
8 strands + 18 controllers, no overlap, no orphan, no gap, no stale record. I found **no defect in
the titanic mapping itself.**

### Wire path — **READY IN SHAPE, NOT IN FIDELITY**

The topology is right: 38 emitted universes → 38 relay routes → 18 controllers, one writer, one
router, engine-owned exclusion proven empty rather than assumed. What is not ready is what travels
down it: T3 corrupts every value above DMX 100, T2 scales every section to ~10 % first, and T4 lets
a second writer onto the same wire under the same CID with a single operator click.

### Operations — **NOT READY**

T1 alone disqualifies the current build for a night where anyone touches the rig: the documented
"lights OFF" step does not turn the lights off.

### Ship-blocking list, in the order I would fix it

1. **T2** — clear/raise the persisted dimmers. (minutes)
2. **T5** + **T12** (D5 listeners) — cheapest real safety wins, and D5 is what will let you *see*
   T4 when it happens. (small)
3. **T1** — make `stop` a confirmed blackout before the force-kill, or correct every doc that says
   "lights OFF". (small)
4. **T7**, **T6**, **T14**, **T15** — show-content correctness. (small)
5. **T9** — land `_156`'s slice as one commit.
6. **T3 + T2 together**, in one operator-gated before/after capture, **never D1 alone.**
7. T4/D2's server-side gate, T10 (D4 per-universe), T11 (network isolation), T13 (D8).

### What offline cannot prove — the live-hardware checks that remain

1. **Every controller's E1.31 data-loss behaviour** — frozen-at-last-frame vs dark, and the timeout
   in seconds. Nothing in the repo determines it; `sacn_bridge.js:2301-2303` says so itself. **T1's
   severity turns entirely on this number.** Measure it per controller model and record it.
2. **The 3 provisional LED boards** (10.x.x.62, .63, .64) — power them, verify identity, push their
   output/universe config, promote them to VERIFIED (T8).
3. **10.x.x.60's identity** — is the board carrying `Left_Front_Left`/`Left_Back_Left` the ship board
   or the test-bench `angio4-old`? Re-push and re-verify (T8).
4. **D1's before/after capture** on real fixtures, per `_153` §7E — colour and dimming curve, with
   the dimmer reset applied first.
5. **A tshark multicast sweep on the playa LAN** — `_153` §7A step 5, still open (D7/F9): confirm no
   third-party source is on universes 2-41.
6. **D8's occurrence** — stream to a live host with nothing on :5568 for ≥60 s and watch for a
   process death on this OS/Node combo.
7. **Frame-flow proof in headless prod** (T17) — until an unconditional packet-rate log exists, the
   only way to know the ship is being fed is to look at it.
8. **The relay under real link churn** — 38 senders, dusty network, D9's sequence resets on route
   re-creation.

---

*Reviewer `_160`. Read-only. No production edit, no git write, no port bound, no packet sent,
nothing armed. Scratch: `~/tmp/titanic_scene_review_160/` (`route_table.cjs`, `model_scan.cjs`,
`wire_scan.cjs`, `d1_probe.cjs`, `sim_test.txt`).*
