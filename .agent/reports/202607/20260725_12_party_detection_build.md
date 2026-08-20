# 20260725_12 — R1 build: party-mode detection + session logic

**Author:** Implementation agent (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-27
**Workstream:** `bm26_show_readiness.md` R1 · **Design:** `20260725_10_party_mode_detection_audit.md` (approved)
**Deploy:** `DEPLOY OK: titanic-ext is running test_bench` (verified live, twice — see §7)

## TL;DR

1. **`audioPartyStrong` is live** — a new hard party gate that ANDs a calibrated
   level, real rhythmic evidence, a spectral-shape test (the far-camp rejector)
   and not-silent, then debounces 20 s on / 30 s off. Every threshold is an
   operator tunable in `config.yaml` → `party:`.
2. **The five previously-thrown-away metrics are published** and readable on
   `GET /param-center`: `audioLoudness`, `audioKickRate`, `audioKickReg`,
   `audioBpmLocked`, `audioBpmConf`. Confirmed moving on the show machine.
3. **The staleness guard is in.** `timeline.mood.key` is now read through
   `MoodSource`, which trusts the key only while it is being *republished*. A
   dead companion no longer freezes the rig in party mode: the mood drops to
   CALM, `console.error` fires on the edge, and `GET /timeline/state` carries
   `moodStale` / `moodStaleForSec` / `moodRawValue` / `moodStaleEpisodes`.
4. **Config flipped + plan authored** on both scenes: `defaultCue` → `ambient`,
   mood cue → `party_high` with `minDwellSec 120` / `durationMin 12` /
   `cooldownSec 900`, `whenPhase` dropped.
5. **A real latent bug was caught by deploying and looking.** The companion's OSC
   emit list is hand-maintained; a new key can register on the CPC, publish
   inside the companion, and never reach the engine. `audioPartyStrong` did
   exactly that on the first deploy — the whole feature would have been silently
   dead. Fixed, and pinned with a regression test in both drift directions.
6. **Two live gotchas the operator must know before validating** (§8): the plan
   is `planActive: false` until the festival window opens (34 days out), and the
   ambient floor is uncalibrated (playa capture procedure in §6).

---

## 1. What was built

| # | Item | File | Lines |
|---|---|---|---|
| 1 | `PartyModeStrong` shaper — the hard gate | `marsin_engine/audio/signals/party_mode_strong.js` | new, 293 |
| 2 | Wired into the derived chain + 6 new publishes | `marsin_engine/audio/signals/derived_signals.js` | 12-19, 76-80, 108-111, 195-206, 209, 179-186, 321-328, 396-402 |
| 3 | 6 new CPC keys + OSC addresses | `marsin_engine/audio/postproc/audio_signals.js` | 139-151 |
| 4 | **Companion OSC emit list** (the bug in §5) | `marsin_engine/audio/companion/companion_server.js` | 305-319 |
| 5 | `party:` tunables applied on companion boot | `marsin_engine/audio/companion/companion_server.js` | 1848-1860 |
| 6 | `MoodSource` — the staleness guard | `marsin_engine/lib/timeline/mood_source.js` | new, 158 |
| 7 | `getLastRevision(key)` on the CPC | `marsin_engine/lib/param_center.js` | 572-585 |
| 8 | `getMood()` routed through the guard | `marsin_engine/lib/api_server.js` | 46, 4385-4404, 4411-4424, 4522 |
| 9 | Guard state on `GET /timeline/state` | `marsin_engine/lib/timeline/timeline_service.js` | 1495-1496, 1644-1660 |
| 10 | `timeline.mood.key` flip + `party:` block | `marsin_engine/config.yaml` | 102-116 |
| 11 | Plan: `defaultCue`, 3 looks, rewritten mood cue | `simulation/scenes/{titanic,test_bench}/timeline/playa_default.yaml` | — |
| 12 | DRAFT playlists ×3 ×2 scenes | `simulation/scenes/{titanic,test_bench}/playlists/{ambient,party_high,party_low}.yaml` | new |
| 13 | Detector tests (13) | `marsin_engine/tests/audio/party_mode_strong.test.js` | new, 260 |
| 14 | Staleness tests (8) | `marsin_engine/tests/timeline/mood_source_staleness.test.js` | new, 181 |
| 15 | Emit-list drift guard (3) | `marsin_engine/tests/companion/companion_party_detection_emits.test.js` | new, 74 |
| 16 | Registry snapshot updated | `marsin_engine/tests/audio/audio_signals.test.js` | 100-107 |

### The gate, in one block

```
L        = EMA_1.5s( 0.35·low + 0.45·mid + 0.20·high )      → audioLoudness
level    : L ≥ ambientFloor × marginX
beat     : kickRate ∈ [kickRateMin, kickRateMax] AND kickReg ≥ kickRegMin
                                                 AND bpmLocked (if required)
shape    : lowShare ≥ shapeLowMin AND highShare ≥ shapeHighMin
quiet    : audioSilence < silenceMax
qualify  = level AND beat AND shape AND quiet
party    = latch(qualify, on after onSustainMs, off after offConfirmMs)
```

`kickRate` / `kickReg` are computed **in the shaper** from `micKickRaw`, not
borrowed from the genre classifier — the classifier's copy is gated behind
`audioParty`, the very signal we do not trust, so reusing it would be circular.
If no kick arrives for `kickIdleMs` the interval ring is **cleared** and both
read 0: a stale mean must never keep asserting "there is a beat".

`audioParty` is untouched — it keeps its existing consumers (genre gating,
effects). `audioPartyStrong` is a sibling, and it is the only thing the show
director reads.

---

## 2. Config / threshold reference

`marsin_engine/config.yaml`. Change, then **restart the companion only** — the
engine keeps running. A bad key or a non-numeric value makes the companion
**throw at boot** rather than silently run on defaults (codex P0).

| Key | Shipped | Unit | What it does | When to change it |
|---|---|---|---|---|
| `ambientFloor` | `0.09` | `audioLoudness` | The venue's quiet-night baseline. **Uncalibrated placeholder — capture it on playa (§6).** | Always, once, on playa |
| `marginX` | `2.5` | ratio | Party must be this many × the floor | Raise if a loud neighbour trips it; lower if a real party doesn't |
| `kickRateMin` | `1.2` | kicks/s | Below this it is not a dance beat (~72 BPM 4-on-floor) | Rarely |
| `kickRateMax` | `3.2` | kicks/s | Above this it is noise, not a kick (~192 BPM) | Rarely |
| `kickRegMin` | `0.45` | 1−CV | Kick-interval regularity | **Loose by design** — the analyzer drops onsets; `requireBpmLock` is its co-guard. Pinned by a test |
| `requireBpmLock` | `true` | bool | Demand the BPM tracker's LOCKED state | Set false only if the tracker proves flaky on playa |
| `shapeLowMin` | `0.20` | share | Minimum bass share | Raise to demand more bass |
| `shapeHighMin` | `0.12` | share | **The far-camp rejector.** Distant music is bass-only (air absorbs HF first) | **Raise this first** if a camp across the playa trips the gate |
| `silenceMax` | `0.5` | — | `audioSilence` ≥ this ⇒ disqualified | Rarely |
| `onSustainMs` | `20000` | ms | Continuous qualification before ON | Lower to ~3000 **temporarily** while validating plumbing |
| `offConfirmMs` | `30000` | ms | Continuous disqualification before OFF | Raise if long breakdowns drop the session |

Non-config (coded) defaults available to `setParams` if ever needed:
`wLow/wMid/wHigh`, `loudTau 1.5`, `shapeTau 1.5`, `warmupMs 3000`,
`kickEdgeThresh 0.5`, `kickMinIntervalMs 220`, `kickRingN 12`, `kickIdleMs 2500`.

### Timeline block

```yaml
timeline:
  mood:
    key: audioPartyStrong    # was audioParty
    partyThreshold: 0.5
    staleSec: 10             # NEW — freshness budget (≈50 missed 5 Hz frames)
```

### Session numbers (operator-decided, option A)

| Setting | Value | Where |
|---|---|---|
| Sustain before a session starts | `minDwellSec: 120` | plan, `c_mood_to_party.trigger` |
| Session length | `durationMin: 12` | plan, `c_mood_to_party` |
| Cooldown before re-trigger | `cooldownSec: 900` | plan, `c_mood_to_party.trigger` |
| Phase gate | **dropped** (`whenPhase` removed) | plan |
| Fallback program | `defaultCue → look: ambient` | plan, top level |

Total time from music starting to lights going party: **20 s** (detector sustain)
**+ 120 s** (timeline dwell) ≈ **2 min 20 s**. Both stack deliberately — an art
car parked for 30 s cannot reach it.

---

## 3. New CPC keys (all on `GET /param-center`, all OSC-emitted)

| Key | Range | Hz | OSC address | Meaning |
|---|---|---|---|---|
| `audioPartyStrong` | 0/1 | 5 | `/marsin/audio/partystrong` | **the gate** — `timeline.mood.key` |
| `audioLoudness` | 0–1 | 10 | `/marsin/audio/loudness` | the scalar to calibrate against |
| `audioKickRate` | 0–8 | 5 | `/marsin/audio/kickrate` | kicks/s, 0 when the beat stops |
| `audioKickReg` | 0–1 | 5 | `/marsin/audio/kickreg` | 1 − CV of the kick interval ring |
| `audioBpmLocked` | 0/1 | 5 | `/marsin/audio/bpmlocked` | tracker lock state |
| `audioBpmConf` | 0–1 | 5 | `/marsin/audio/bpmconf` | tracker confidence |

Timeline state gains: `moodKey`, `moodStale`, `moodStaleForSec`, `moodStaleSec`,
`moodRawValue`, `moodStaleEpisodes`.

---

## 4. The staleness guard (build item 3)

**The failure:** the mood key comes from a separate process. When the companion
dies the CPC does not go quiet — it **freezes**. A frozen `1` pins party mode
forever, and nothing says why.

**The rule:** freshness is measured on the CPC **write revision**, not the value.
The companion republishes at 5 Hz and every packet bumps the revision even when
the value repeats, so a still revision means the *producer* stopped — which is
the thing that actually matters. Past `staleSec` the mood is forced to CALM and
the `defaultCue` (ambient) reclaims the deck.

**It is a designed failure state, and it is observable — not a silent fallback:**

- `console.error` on the stale **edge** (once, not per tick), naming the key, the
  age, and that the show is now on ambient *because of it*; `console.warn` on
  recovery with the outage duration.
- `GET /timeline/state` carries `moodStale`, `moodStaleForSec`, `moodStaleSec`,
  `moodStaleEpisodes`, and **`moodRawValue`** — the frozen value being refused,
  so the operator can see a stuck `1` being correctly ignored.
- A **misconfigured** key (typo in `timeline.mood.key`) is a different,
  separately-messaged failure: `rawValue: null` and "NOT REGISTERED", so "wrong
  key name" is never mistaken for "companion died".
- Flapping is counted (`moodStaleEpisodes`), so a marginal companion is visible
  after the fact rather than only in the moment.

---

## 5. The bug the deploy caught

The first deploy reported `DEPLOY OK` and every new key appeared on
`/param-center` — but `audioLoudness` read exactly `0` while the mic was clearly
picking up sound. Cause: `ENGINE_INTERNAL_DERIVED` in `companion_server.js` is a
**hand-maintained** list, while the CPC schema is generated from
`audio_signals.js`. A new key registers on both sides, publishes happily inside
the companion, and is **never emitted over OSC** — so the engine's copy stays at
its default forever.

For `audioPartyStrong` that means the show director would have read a permanent
`0` and **party mode could never have fired**, on a stack that boots clean,
deploys clean, and passes its tests. Fixed at `companion_server.js:305-319`, and
guarded in both directions by
`tests/companion/companion_party_detection_emits.test.js`:

- every party key is registered *and* carries an `oscAddress` *and* is in the
  emit list;
- every key in the emit list is a real registered key with an address (a typo'd
  or retired entry is otherwise silently dropped by the address filter).

Re-deployed and re-verified: `audioLoudness` now tracks the room,
`audioBpmLocked = 1`, `audioBpmConf = 0.589`.

---

## 6. LIVE TUNING PROCEDURE (for Sina)

Designed to be done in **minutes**, on the playa, with a laptop and no restarts
except one companion bounce at the end.

### 6.1 Watch the numbers

One line, from any laptop on the show LAN:

```powershell
while ($true) {
  $j = (iwr http://10.x.x.151:6968/param-center -UseBasicParsing).Content | ConvertFrom-Json
  $p = $j.params
  "{0:HH:mm:ss}  L={1,6:N3}  kick/s={2,5:N2}  reg={3,4:N2}  lock={4}  low={5,5:N2} mid={6,5:N2} high={7,5:N2}  STRONG={8}" -f `
    (Get-Date), $p.audioLoudness.value, $p.audioKickRate.value, $p.audioKickReg.value,
    $p.audioBpmLocked.value, $p.micLowRaw.value, $p.micMidRaw.value, $p.micHighRaw.value,
    $p.audioPartyStrong.value
  Start-Sleep 1
}
```

`L` is the ONLY number the level threshold is built on. Watch `kick/s`, `reg`
and `lock` together — they are the room-noise rejector, and on a genuinely
empty driveway all three should read 0/0/0.

Session-side, separately: `GET http://10.x.x.151:6968/timeline/state` →
`currentMood`, `moodValue`, `moodStale`, `activeCue`, `recentFires`, `wouldFire`.

### 6.2 Capture the two baselines (playa, at night)

**A — Ambient baseline, 5 min, our system OFF.** Log the poll above with camp at
rest. Take the **95th percentile of `L`** → that is `ambientFloor`.

Do it **twice**: once at a quiet hour, and once while a neighbouring camp is
audibly thumping. The second reading is the one that must NOT trip the gate.
- If the two are close → `shapeHighMin` is doing the work; leave `marginX`.
- If the distant-camp reading is much higher → raise `marginX`.

**B — Party reading, 5 min, our system at real party volume.** Take the **5th
percentile of `L`** (the quietest moment of a genuine party), plus typical
`kickReg` and whether `bpmLocked` holds.

**Then set:**
```
ambientFloor = P95(ambient)
marginX      = 0.5 × ( P5(party) / P95(ambient) )      # halfway, in ratio terms
kickRegMin   = min(0.45, 0.8 × typical party kickReg)  # only if the real reg is low
```

### 6.3 Apply and verify

1. Edit `marsin_engine/config.yaml` → `party:` on the show machine (or deploy).
2. **Restart the companion only.** A bad key/value throws at boot — check the
   log for `🎉 party gate tunables applied from config.yaml (N keys)`.
3. Temporarily set `onSustainMs: 3000` and the plan's `minDwellSec: 20` while
   validating the plumbing.
4. Play music → `audioPartyStrong` must flip to 1 within ~`onSustainMs`.
   Stop → back to 0 within ~`offConfirmMs`.
5. Watch `/timeline/state` for the mood fire and the 12-min window.
6. **Put `onSustainMs` back to 20000 and `minDwellSec` back to 120.**

### 6.4 The anti-goal check (the one that matters)

Stand the system on the driveway with **no music for 30 minutes** and confirm
`audioPartyStrong` stays `0` the whole time. Today's `audioParty` fails this
test; the new gate is built to pass it. Unit-tested against the literal live
false-positive trace from the audit, but it must be proven on the real rig.

---

## 7. Test + deploy evidence

### Engine suite

```
ℹ tests 2155   ℹ pass 2148   ℹ fail 7   ℹ skipped 0
```

All 7 failures are **pre-existing and environmental** on this Windows dev box,
none in touched code — verified by running each in isolation:

| Failure | Cause |
|---|---|
| 5 × `tests/audio/audio_capture.test.js` | `Windows audio capture requires a pinned device` — no mic pinned on the dev box |
| `osc_listener` "EADDRINUSE when port is already bound" | Windows returns `EACCES` on the ephemeral bind, not `EADDRINUSE` |
| `tests/effects/effects_v2_mode_page_layout.test.js` | Node worker flake (`Unable to deserialize cloned data`); **all subtests pass in isolation** |

New tests, all green:
- `tests/audio/party_mode_strong.test.js` — **13 pass**. Room noise (the literal
  live trace: `mid 0.27 / high 0.20 / kick 0`) never qualifies over 2 min;
  bass-only far music never qualifies (beat *is* real — shape is what rejects
  it); level under floor×margin never qualifies; qualification is immediate but
  the latch waits `onSustainMs`; two 15 s bursts never accumulate; the gate holds
  through a 20 s breakdown and releases past `offConfirmMs`; kick rate/reg
  collapse to 0 on idle; bursty speech-like onsets fail `kickReg` while sitting
  *inside* the rate band; a real beat with 25 % dropped onsets still passes;
  `requireBpmLock` gates the beat term; `setParams` throws on unknown key / bad
  type; lowering `ambientFloor` opens the gate on the same audio; non-finite
  input throws.
- `tests/timeline/mood_source_staleness.test.js` — **8 pass**. 5 Hz republish of
  an identical value reads fresh; a frozen `1` drops to CALM past the budget with
  `rawValue` preserved; the loud log is edge-only (1 line, not 50); recovery is
  reported and re-trusted, second death counted separately; a never-published key
  ages from boot; an unregistered key is stale immediately with its own message;
  threshold semantics; constructor validation.
- `tests/companion/companion_party_detection_emits.test.js` — **3 pass** (§5).

### Runtime-state residue

`marsin_engine/states/` was **already dirty at session start** (7 files, from
prior work on this branch — visible in the session-start `git status`). The test
suite itself leaves **no** residue: md5 of every
`marsin_engine/states/*/*.yaml` before and after a full `npm test` run is
**identical** (`diff` clean, verified twice).

### End-to-end proof (in-process, real BPM tracker)

40 s of synthetic 128 BPM full-band music through the real `DerivedSignals`
chain: `audioBpm 128.5`, `audioBpmLocked 1`, `audioBpmConf 0.60`,
`audioKickRate 2.135`, `audioKickReg 0.988`, `audioLoudness 0.455`,
**`audioPartyStrong 1`**, `getStatus() → {fatal:false, degraded:false}`.

### Deploy

```
DEPLOY OK: titanic-ext is running test_bench from e805ef01.
```

Ran twice (second time carrying the §5 emit-list fix). Live verification after
the second deploy, on a quiet room:

```
audioLoudness 0.00195   audioKickRate 0   audioKickReg 0
audioBpmLocked 1        audioBpmConf 0.589  audioBpm 138
audioParty 0            audioPartyStrong 0  audioSilence 1

/timeline/state → moodKey audioPartyStrong · moodStale False · moodStaleForSec 0
                  moodStaleSec 10 · moodRawValue 0 · moodStaleEpisodes 0
                  currentMood calm · lastError None
```

`moodStale: false` with `staleForSec: 0` proves the guard is observing the
companion's 5 Hz republish live.

---

## 8. Two things the operator must know before validating

1. **The plan is not driving the rig yet.** `/timeline/state` reports
   `planActive: false`, `controller: manual`, `inFestivalWindow: false`,
   `festivalStartsInDays: 34`. `planActive` is gated on the festival window
   (`startDate: 2026-08-30`), so the mood cue cannot move the deck until then.
   **To test the full chain on the driveway, temporarily set `festival.startDate`
   in `simulation/scenes/test_bench/timeline/playa_default.yaml` to today** —
   and put it back afterwards. Detector-only validation (§6.4) needs none of
   this: `audioPartyStrong` is live right now.
2. **`ambientFloor: 0.09` is a placeholder, not a measurement.** Until §6.2 is
   run on the real venue with the real sound system, the level term is a guess.
   The other three terms (beat / shape / quiet) are calibration-free and already
   reject the observed false positive.

---

## 9. DRAFT playlist memberships

**DRAFT — structure over membership.** Sina re-curates every pattern in the R2
tuning pass; this exists so the plan has something real to load and so R2 starts
from **full coverage**: all 57 top-level patterns are placed **exactly once**
(enforced by the generator — duplicates, missing files, or unplaced patterns
throw). Written for **both** scenes: `simulation/scenes/{titanic,test_bench}/playlists/`.

Every entry ships with empty `defaults: {}` — R2 fills in tuned speeds and
parameters, which is the whole point of that pass.

**`party_high`** (15) — beat-reactive / strobing / hard-hitting:
`01_cylon_sweep`, `03_dual_axis_crush`, `04_beat_folded_helix`, `09_cyclone`,
`25_heartbeat`, `28_spectrum_bloom`, `29_kick_shockwave`, `30_bass_comet`,
`31_strobe_lattice`, `36_orbital_pulse`, `48_heartbeat_drive`, `49_cylon_crush`,
`50_phase_cathedral_hd`, `51_confetti_cyclone`, `54_murmuration_storm`

**`party_low`** (18) — groove / flow, moving but not pounding:
`05_orbital_attractor_field`, `06_neon_elevator`, `10_chasers`,
`15_silk_prism_ribbons`, `17_rolling_color_dunes`,
`23_prismatic_strange_attractors`, `24_chromatic_murmuration`,
`26_dom_dancers_chevron`, `27_swipe`, `34_moire_interference`,
`37_chevron_chase`, `38_prism_helix`, `39_tide_riser`, `40_lissajous_weave`,
`42_phyllotaxis_spiral`, `47_quasicrystal_dunes`, `52_silk_ribbons`,
`53_neon_elevator_hd`

**`ambient`** (24) — slow washes, the default program:
`00_golden_hour_wash`, `02_phase_cathedral`, `07_shimmer`, `08_ocean_liner`,
`11_bioluminescence`, `12_breathing`, `13_sparkle`, `14_lunar_current`,
`16_ghost_tide_uv`, `18_deep_space_lattice`, `19_swaying_lattice_ballet`,
`20_parametric_sway_field`, `21_pelagic_manta_rays`, `22_abyssal_sway_garden`,
`32_caustic_shimmer`, `33_aurora_breath`, `35_sparkle_rain`,
`41_reaction_diffusion`, `43_golden_hour_pulse`, `44_biolume_swell`,
`45_manta_drift`, `46_abyssal_fronds`, `57_ink_diffuse`, `58_lighthouse_solo`

Plan looks added alongside (both scenes):

| Look | Playlist | Autopilot delay | Palette |
|---|---|---|---|
| `ambient` | `ambient` | 90 s, shuffle | `deep_sea` |
| `party_high` | `party_high` | 30 s, shuffle | `bass_drop` |
| `party_low` | `party_low` | 45 s, shuffle | `ultraviolet` |

`party_low` is authored but **not yet wired to a trigger** — it is there for R3
(a second, gentler party tier, e.g. flavour-selected by `audioGenre`, or a
scheduled early-evening party moment). The detection path drives `party_high`.

Existing looks (`daytime`, `philharmonic`, `party`, `sunrise`, `burn_night`,
`temple`) still point at `playlist: default` — repointing them is R3's job.

---

## 10. Follow-ups (not built — out of scope or another agent's zone)

1. **CaptainPad tuning row (audit §5 item 3) — NOT BUILT.** CaptainPad is owned
   by another agent this wave. Recommended when that zone frees up: a derived-panel
   row showing `loudness / kickRate / kickReg / bpmLocked / partyStrong` against
   their thresholds, plus a `moodStale` warning pill fed by `/timeline/state`.
   Everything it needs is already on the API — this is display-only work. The
   same row belongs on the **companion UI** (`audio/companion/ui/companion_app.js`),
   which is *not* in the CaptainPad exclusion zone and would be the faster win.
2. **Playa calibration run** (§6.2) — operator + agent, one evening. This is the
   only remaining blocker on R1 being *trustworthy* rather than merely *correct*.
3. **Session-end options B/C** — not built (operator chose A). Option A needed
   zero timeline code; B/C would need a `_reconcileDefaultCue` addition.
4. **`festival.startDate` gate** (§8.1) — decide whether driveway validation
   happens via a temporary date shift or by waiting for the window.
5. **A generalised emit-list guard.** §5's test covers the party keys plus
   list-integrity in both directions, but the underlying design smell remains:
   a hand-maintained emit list beside a generated registry. Deriving
   `ENGINE_INTERNAL_DERIVED` from the registry (or asserting the full derived
   family, not just the party subset) would kill the class of bug outright.
6. **`audioSilence` reads 1 while `micMidRaw ≈ 0.36`** on the show machine — the
   track-change detector's silence latch looks miscalibrated against the live mic
   gain. Out of R1 scope (the party gate treats it as one of four terms, and the
   other three already reject the room), but worth a look before playa: it makes
   `quietOk` stricter than intended.

## 11. Files

- `marsin_engine/audio/signals/party_mode_strong.js` — the gate
- `marsin_engine/audio/signals/derived_signals.js` — wiring + publishes
- `marsin_engine/audio/postproc/audio_signals.js` — CPC/OSC key registry
- `marsin_engine/audio/companion/companion_server.js` — emit list + config apply
- `marsin_engine/lib/timeline/mood_source.js` — staleness guard
- `marsin_engine/lib/param_center.js` — `getLastRevision()`
- `marsin_engine/lib/api_server.js` — `getMood()` through the guard
- `marsin_engine/lib/timeline/timeline_service.js` — guard state on the API
- `marsin_engine/config.yaml` — `timeline.mood` + `party:`
- `simulation/scenes/{titanic,test_bench}/timeline/playa_default.yaml`
- `simulation/scenes/{titanic,test_bench}/playlists/{ambient,party_high,party_low}.yaml`
- `marsin_engine/tests/{audio/party_mode_strong,timeline/mood_source_staleness,companion/companion_party_detection_emits}.test.js`
