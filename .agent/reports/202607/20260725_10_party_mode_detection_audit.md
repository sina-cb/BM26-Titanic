# 20260725_10 — Party-mode detection + session logic (R1 audit + design)

**Author:** Investigator agent (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-27
**Workstream:** `bm26_show_readiness.md` R1 · **Mode:** read-only (code + live GET probes of `10.x.x.NNN:6968` / `:6966`)

## TL;DR

1. **Almost all the machinery already exists.** The engine has a full
   timeline/show-director service (`lib/timeline/`) with an `ambient default →
   mood-triggered playlist → timed window → revert to default` path already
   implemented: `defaultCue` (ambient fallback), `mood` triggers with
   `minDwellSec` / `cooldownSec` / `whenPhase`, and `durationMin` (the cue owns
   the deck for N minutes, then the default cue reclaims it). **The ~2-min
   sustain + 10–15-min session + cooldown is expressible as plan YAML today**
   — no new state machine required.
2. **The detector is the weak link, and it is provably mis-firing right now.**
   `audioParty` is a pure band-loudness Schmitt trigger (`audio/signals/party_mode.js`).
   It has **no rhythmic evidence, no absolute-level calibration, and no
   spectral-shape test**. Live sampling of the show machine (no music playing,
   just room noise) shows `audioParty = 1` sustained, with `micKickRaw = 0`,
   `micLowRaw ≈ 0`, `audioGenre = melodic_house @ conf 0.44`. **This is exactly
   the "sits in party mode all the time" failure Sina named.**
3. **The build is small:** one new derived signal (`audioPartyStrong`) that ANDs
   loudness-above-calibrated-floor with rhythmic evidence (kick present + BPM
   locked + kick regularity) and a full-band shape test, plus two new CPC keys
   that are *already computed but not published* (`bpmLocked`/`bpmConf`,
   `kickReg`), plus plan YAML. Estimate ~1–1.5 days including the tuning UI row.

---

## 1. Signal inventory — what the companion already computes

Sole analyzer = the Audio Companion (`marsin_engine/audio/companion/`), running
the engine's real DSP (`audio/analyzer`, `audio/detector`, `audio/signals`) at
**~86 hops/s**, publishing to its own local CPC and emitting the whole derived
set over UDP OSC → engine `:10000` → engine CPC (`emitAllDerived()`,
`companion_server.js:1016`). Engine-side analysis is OFF.

| Signal (CPC key) | What | Where computed | Rate | Party-detection value |
|---|---|---|---|---|
| `micLowRaw` / `micMidRaw` / `micHighRaw` | FFT band energies [0,1], post gate + `inputGain` | `audio/analyzer/audio_analyzer.js` | 86 Hz (OSC ~60 Hz) | **core level input** |
| `micKickRaw` | kick-onset pulse train | analyzer (50–110 Hz band, thresh 2.4, 220 ms refractory) | 86 Hz | **best "real music" evidence** — 0 on room noise |
| `micFluxRaw` | spectral flux | analyzer | 86 Hz | busyness; noisy on speech |
| `micSubRaw`, `micOnset{Low,Mid,High}Raw` | sub-bass, per-band onsets | analyzer | 86 Hz | sub = distant-thump indicator |
| `micTonalStabilityRaw`, `micChromaFluxRaw`, `micChromaTiltRaw` | 12-bin chroma harmonic axes | analyzer | 86 Hz | live but classifier weights are 0 |
| `audioBpm` | Kalman-smoothed tempo | `signals/bpm_tracker.js` (v2, 2-state SEARCH/LOCKED) | 86 Hz | useful **only with lock state** (see gap) |
| `audioBeat`, `audioBeatInBar`, `audioBarPhase`, `audioDownbeat` | phase-locked beat/bar | bpm_tracker | 86 Hz | rhythm evidence |
| **`audioParty`** | **0/1 loud-music gate** | **`signals/party_mode.js`** | **86 Hz** | **today's detector — see §2** |
| `audioGenre` (0–6), `audioGenreConf` | dance-genre argmax + decision margin | `signals/genre_classifier.js` | re-scored every 8 hops | **not usable as a gate** — gated *behind* `audioParty`, 63.9 % corpus accuracy, and conf is a decision margin *anti-correlated* with correctness (documented in-file) |
| `audioSilence`, `audioTrackChange` | silence / track boundary | `signals/track_change.js` | 86 Hz | good negative evidence |
| `audioRiserScore`, `audioBuildEta`, `audioRiserConf`, `audioDropCountdown`, `audioClimax`, `audioPhrasePhase/Boundary` | build/drop/structure | `signals/*.js` | 86 Hz | not needed for the gate |
| `audioStructure`, `audioBuildScore`, `audioEnergyRatio`, `audioSlowZone`, `audioDropPulse` | THIN/BUILD/SUSTAIN detector | `audio/detector/audio_structure_detector.js` | 86 Hz | detector is flagged **"under development"** in `audio/README.md` — do not gate on it |
| `audioNote`, `audioNoteHue`, `audioSwitchPattern`, `audioSwitchColor`, `audioChestHit` | note/colour/switch cues | derived | 86 Hz | not gate material |

**Transport:** curated keys keep canonical OSC addresses (`audioParty` →
`/marsin/audio/party`, declared at 5 Hz in `audio/postproc/audio_signals.js:116`).
Everything is readable live via **`GET /param-center`** on the engine, and via
the companion WS frame (`derived:{…}`) at `:6966`.

### Gaps in what is exposed (all cheap to close)
- **BPM lock state + confidence are computed and thrown away.** `BpmTracker.update()`
  returns `{ …, confidence, locked }` (`bpm_tracker.js:257-301`); `derived_signals.js`
  publishes only `audioBpm`/`audioBeat`. **No CPC key tells you whether the tempo is
  trusted.** This is the single most valuable missing discriminator.
- **Kick regularity is computed and thrown away.** `GenreClassifier._updateKick()`
  maintains a 12-interval ring and a CV-based `kickReg` (`genre_classifier.js:445-480`)
  — never published.
- **No absolute-SPL / calibrated level.** Bands are post-`inputGain` (live value
  **6.6**) and post-gate, so "0.3" means nothing until calibrated against the
  venue. `audio/calibrate/audio_calibrate.js` exists as a CLI but there is no
  stored ambient baseline the detector consults.

---

## 2. Existing detection — what's there, and why it mis-fires

### 2.1 `PartyMode` (the only party detector)

`marsin_engine/audio/signals/party_mode.js`, params in `derived_signals.js:62`:

```
loudness = EMA_0.4s( 0.4*low + 0.4*mid + 0.2*high )
ON  when loudness ≥ 0.22   (after 1.5 s warmup)
OFF when loudness < 0.12 sustained 800 ms, and ≥1200 ms after ON
```

That is the **entire** algorithm. It contains **no** kick test, **no** BPM/lock
test, **no** beat regularity, **no** spectral-shape test, and **no** notion of a
calibrated ambient floor. Any sustained broadband sound at the mic — voices,
wind, a generator, a neighbouring camp — clears 0.22 and latches.

### 2.2 Live evidence from the show machine (read-only, 2026-07-27)

`GET http://10.x.x.NNN:6968/param-center`, 4 samples ~6 s apart, **no music
playing**, mic = `Microphone (Amazon USB Streaming Mic)`, `inputGain 6.6`:

```
T0 micLowRaw=0.000 micMidRaw=0.265 micHighRaw=0.181 micKickRaw=0.000 micFluxRaw=0.127
   audioParty=1.000 audioBpm=124 audioGenre=2 audioGenreConf=0.437 audioSilence=0.000
T1 micLowRaw=0.000 micMidRaw=0.351 micHighRaw=0.413 micKickRaw=0.000 audioParty=1.000
T2 micLowRaw=0.000 micMidRaw=0.255 micHighRaw=0.234 micKickRaw=0.000 audioParty=1.000
T3 micLowRaw=0.000 micMidRaw=0.227 micHighRaw=0.020 micKickRaw=0.000 audioParty=0.000 audioSilence=1.000
```

and `GET /timeline/state` reports `"currentMood":"party","party":1,"moodValue":1`.

Read that carefully:
- **`micKickRaw = 0.000` in every sample** — there is no kick at all, yet party is ON.
- **`micLowRaw ≈ 0`** (low band fully gated) — party is being driven **entirely by
  mid+high**, i.e. the *opposite* spectral shape of dance music.
- `audioBpm` sits frozen at 124 (coasting tracker), and the genre classifier —
  which is gated behind `audioParty` — happily reports *melodic_house @ 0.44*.

**Conclusion: the existing gate would put the fixture in party mode on an empty
driveway.** Tightening `onThresh` alone will not fix it (a loud conversation or a
generator will still clear any level threshold that a real party also clears);
the gate needs a *different kind* of evidence.

### 2.3 Prior art in-repo that already thinks about this

`lib/autopilot_profiles/audio_reactive_profile.js` has an explicit **"ART-CAR
ROBUSTNESS (Burning Man)"** section with the right instincts and tuned constants:
long envelopes (`energySlowTau 25 s`), a **sustained-elevation confirmation
window** (`switchConfirmMs 15 s`, arm-below/sustain-above latch), a heavy
`minIntervalMs 12 s`, and gates on `audioSilence`/`audioParty`. Tuning guidance
is in `docs/41_audio_reactive_tuning.md`. **Reuse this arm/sustain/confirm
pattern for the party gate — it is the same problem at a longer time-scale.**
Dossiers `autopilot_profiles_audio_reactive.md` and `deck_split_playlists.md`
are design references for the autopilot/deck half; neither contains a party
*session* concept.

---

## 3. Program / playlist switching machinery — what exists

**The show-director already exists in the engine** (`docs/38_timeline_show_scheduler.md`,
v2 = in-engine; `marsin_engine/lib/timeline/`, ~3.9 kLOC + tests). It is
**enabled in production** (`config.yaml:96-104`):

```yaml
timeline:
  enabled: true
  activePlan: playa_default
  tickMs: 1000
  programLeaseSec: 30
  operatorLeaseSec: 120
  mood: { key: audioParty, partyThreshold: 0.5 }
```

| Piece | File | Status |
|---|---|---|
| 1 s tick, plan load, dispatch, event log | `lib/timeline/timeline_service.js` (2050 L) | live |
| pure trigger eval (clock / sun / phase / **mood** / manual) | `lib/timeline/triggers.js` | live |
| precedence arbiter (PROGRAM > AUTOPILOT > MANUAL, leases) | `lib/timeline/arbiter.js` | live |
| plan schema + validation (`looks`, `phases`, `cues`, `durationMin`, `defaultCue`, `days`) | `lib/timeline/show_plan.js` (982 L) | live |
| offline sun math (BRC lat/lon prefilled) | `lib/timeline/sun.js` | live |
| 8-day festival model | `lib/timeline/festival.js` | live |
| mood source | `api_server.js:4395` `getMood()` reads `paramCenter.get('audioParty') >= 0.5` | live |
| REST | `GET /timeline/state|overview|plans`, `POST /timeline/plan/activate|mode|autopilot|hold|resume|program/end|cues/:id/fire` | live |
| plan on disk | `simulation/scenes/<scene>/timeline/playa_default.yaml`; runtime `marsin_engine/states/<scene>/timeline_state.yaml` | live |

**The three primitives R1 needs already exist:**

1. **Mood trigger with dwell + cooldown** — `triggers.js:210-235`:
   fires only after the mood has *held* at `party` for `minDwellSec` (arming
   latch + `moodSince` reset on any flip back), and not within `cooldownSec` of
   the last fire, and only inside `whenPhase`. **`minDwellSec: 120` is the
   operator's "sustained more than ~2 minutes", already implemented.**
2. **Timed session window** — `cue.durationMin` (`show_plan.js:647-656`,
   `timeline_service.js:716-729`): the firing cue OWNS the deck for
   `[now, now + durationMin)`. **`durationMin: 12` is the 10–15-min party session.**
3. **Return to ambient** — plan-level `defaultCue` (`show_plan.js:607-620`,
   `timeline_service._reconcileDefaultCue`): when the window elapses and nothing
   else owns the deck, the default cue is re-applied ("window-elapsed") and
   logged. **This is the ambient program.**

**What does NOT exist:** the ambient/party *content* (only `default` playlist
exists in the titanic scene; `default` + `slow` in test_bench — the July 9
Track B `party_high` / `party_low` / `ambient` trio was never built), and any
"extend the session while music persists" behaviour (see options in §4.2).

**Live plan reality check:** the active `playa_default` plan on both scenes has
**no `defaultCue`**, every look points at `playlist: default`, and the mood cue
uses `minDwellSec: 20 / cooldownSec: 300`. So today the mood cue would fire after
**20 seconds** of the (already broken) party gate, inside `party_night` only, and
then hold the deck indefinitely. Live state also shows `controller: manual`,
`planActive: false` — the plan isn't currently driving anything, which is why
nobody has noticed.

---

## 4. Proposed design

### 4.1 Detection metric — `audioPartyStrong`

Add **one new derived signal** (a sibling of `PartyMode`, not a replacement —
keep `audioParty` for the existing consumers). Party is asserted only when
**all four** hold, then debounced:

```
L    = EMA_1.5s( 0.35*low + 0.45*mid + 0.20*high )        # slower than PartyMode's 0.4 s
level  : L ≥ ambientFloor * marginX          # calibrated, not a magic 0.22
beat   : kickRate ∈ [1.2, 3.2] kicks/s  AND  kickReg ≥ 0.45   AND  bpmLocked
shape  : lowShare = low/(low+mid+high) ≥ shapeLowMin   AND  highShare ≥ shapeHighMin
quiet  : audioSilence < 0.5
→ partyStrong = schmitt(level & beat & shape & quiet,
                        onSustainMs = 20 000, offConfirmMs = 30 000)
```

Why each term, and specifically how it rejects the two failure modes:

| Failure mode | Rejected by |
|---|---|
| **Room noise / voices / generator / wind** (today's live failure) | `beat` — `micKickRaw` is flat 0 and `bpmLocked` false. This term alone kills the observed false positive. |
| **Distant camp across the playa** | `level` (air absorption + inverse-square: a camp 500 m+ away lands 20–40 dB down, far under a floor calibrated to *our* sound system) **and** `shape.highShare` — HF is absorbed first over distance, so distant music arrives as **bass-only thump**: low-share high, high-share near zero. Requiring a genuine high band is the physically-correct far-music discriminator. |
| **Art car parked adjacent for 30 s** | `onSustainMs` (20 s) inside the detector, plus the timeline's `minDwellSec` 120 s on top → needs >2 min of continuous qualifying audio. |
| **Our own track breakdown / gap between songs** | `offConfirmMs` (30 s) + the timeline's `durationMin` window, which does not care about momentary drops. |

**Calibration, not magic numbers.** `ambientFloor` is captured on the playa
(§4.4) and stored in config; the thresholds are all named tunables in one config
block so Sina turns knobs, never edits code:

```yaml
# marsin_engine/config.yaml
party:
  ambientFloor: 0.09        # ← captured on playa, quiet-night baseline
  marginX: 2.5              # party must be this many × the ambient floor
  kickRateMin: 1.2
  kickRateMax: 3.2
  kickRegMin: 0.45
  requireBpmLock: true
  shapeLowMin: 0.20
  shapeHighMin: 0.12        # ← the far-camp (bass-only) rejector
  onSustainMs: 20000
  offConfirmMs: 30000
```

**Do NOT gate on `audioGenre`/`audioGenreConf`.** It is gated *behind*
`audioParty` (circular), 63.9 % accurate on a real corpus, and its confidence is
documented as anti-correlated with correctness (`genre_classifier.js:559-566`).
It is fine as a *flavour* input for choosing which party playlist, never as the gate.

**Prerequisite CPC keys to publish** (all already computed, ~10 lines each in
`derived_signals.js`, plus one row each in `audio_signals.js`):
`audioBpmLocked` (0/1), `audioBpmConf` [0,1], `audioKickReg` [0,1],
`audioKickRate` (kicks/s), `audioLoudness` (the PartyMode/partyStrong loudness
scalar — currently internal, and it is *the* number Sina must watch to tune),
and `audioPartyStrong` (0/1).

### 4.2 Session state machine

```
AMBIENT (defaultCue: ambient playlist, slow autopilot)
   │  audioPartyStrong == 1 held ≥ 120 s        (timeline mood cue, minDwellSec: 120)
   ▼
PARTY SESSION (party playlist + palette + fast autopilot)
   │  durationMin elapses (10–15 min)
   ▼
COOLDOWN (defaultCue reclaims the deck; mood cue re-arm blocked by cooldownSec)
   │
   ▼  back to AMBIENT
```

Everything above except the detector is **plan YAML**, using existing fields.

**Options for the session END (Sina picks one):**

| Option | How | Trade-off |
|---|---|---|
| **A — Fixed timer (recommended v1)** | `durationMin: 12`, no extension. | Utterly predictable and already implemented (zero code); the rig will occasionally drop to ambient mid-banger, but the mood cue can re-fire after cooldown. |
| **B — Follow-the-music with a floor** | Session ends when `audioPartyStrong` has been 0 for 90 s, but never before `minDurationMin: 10`. | Musically the most natural — the lights stay up as long as the party does — but needs a small `_reconcileDefaultCue` addition (a "release on signal" window kind) and re-inherits the detector's false-negative risk mid-set. |
| **C — Timer extended while music persists, hard-capped** | Base 12 min; each time the window is within 2 min of expiry and `audioPartyStrong == 1`, extend by 5 min, cap 45 min. | Best of both and the safest failure mode (a stuck detector still hits the cap), but the most new logic and the hardest for Sina to predict on the playa. |

**Recommended cooldown: 15 minutes** (`cooldownSec: 900`), i.e. roughly one
session length. Rationale: after a real party ends we want the fixture visibly
back on the ambient program for a meaningful stretch, and a 15-min cooldown
caps worst-case detector thrash at ~50 % party duty even if everything else
fails. With option B/C, count the cooldown from *session end*, not from cue fire.

### 4.3 Integration point

- **Detector → the Audio Companion** (`audio/signals/party_mode_strong.js`, wired
  in `derived_signals.js`). Non-negotiable per the audio subsystem's hard rule:
  the companion is the sole analyzer and must not fork DSP. It rides the existing
  `emitAllDerived()` OSC path to the engine CPC — zero new transport.
- **Session/program → the engine timeline service**, unchanged. Only the config
  key flips:

  ```yaml
  timeline:
    mood: { key: audioPartyStrong, partyThreshold: 0.5 }   # was audioParty
  ```

  `api_server.js:4395 getMood()` already reads whatever key is configured — this
  is a **one-line config change**, no code.
- **Plan edit** (`simulation/scenes/titanic/timeline/playa_default.yaml`):

  ```yaml
  defaultCue:
    label: Ambient program
    action: { type: look, look: ambient }

  cues:
    - id: c_mood_to_party
      kind: mood
      trigger: { type: mood, from: calm, to: party,
                 minDwellSec: 120, cooldownSec: 900 }   # drop whenPhase, or keep party_night
      action: { type: look, look: party_high }
      durationMin: 12
  ```

  Note the live plan restricts the mood cue to `whenPhase: party_night`
  (sunset+2h → sunrise−1h). Sina should decide whether a daytime party is allowed
  (recommend: drop `whenPhase` and rely on the detector, keeping the *scheduled*
  party moments phase-anchored).
- **Prereq (R2/R3):** the `ambient` / `party_high` / `party_low` playlists +
  looks must actually exist. Today the titanic scene has only `default`.

### 4.4 Live tuning procedure for Sina (driveway + playa)

**Watch the numbers (three surfaces, all live today):**

1. **Companion UI — `http://<show-host>:6966`.** The MIC TUNE page meters the
   live band levels against their gate lines and the derived panel shows
   `party` / `bpm` / `genre`. This is the primary tuning surface; the new
   `loudness`, `kickReg`, `bpmLocked`, `partyStrong` fields should be added to
   that same derived panel (small UI addition, listed in §5).
2. **One-line poll from any laptop on the show LAN** (no UI, no restart):

   ```powershell
   while ($true) {
     $j = (iwr http://10.x.x.NNN:6968/param-center -UseBasicParsing).Content | ConvertFrom-Json
     "{0:HH:mm:ss} L={1:N3} M={2:N3} H={3:N3} kick={4:N3} party={5} strong={6} bpm={7:N0}" -f (Get-Date),
       $j.params.micLowRaw.value, $j.params.micMidRaw.value, $j.params.micHighRaw.value,
       $j.params.micKickRaw.value, $j.params.audioParty.value,
       $j.params.audioPartyStrong.value, $j.params.audioBpm.value
     Start-Sleep 1
   }
   ```
3. **`GET /timeline/state`** — shows `currentMood`, `moodValue`, `activeCue`,
   `recentFires`, `wouldFire` (mood fires that were suppressed). This is how you
   confirm the *session* fired and when it will end, without touching the deck.

**Capture the two baselines (do this ON the playa, at night, twice):**

- **Ambient baseline (5 min, no music of ours):** log the poll above with our
  system OFF and the camp at rest. Record the **95th percentile of `loudness`**
  → that is `ambientFloor`. Do it once at a quiet hour and once when a
  neighbouring camp is audibly thumping — the second reading is the number that
  must NOT trip the gate. If the distant-camp reading is close to the quiet
  reading, `shapeHighMin` is doing the work; if it is much higher, raise
  `marginX`.
- **Party reading (5 min, our system at real party volume):** record the
  **5th percentile of `loudness`** (i.e. the quietest part of a genuine party)
  plus typical `kickReg` and whether `bpmLocked` holds. Set
  `marginX = 0.5 * (partyP5 / ambientP95)` — i.e. put the threshold halfway (in
  ratio terms) between the two, then verify.

**Then set thresholds** in `marsin_engine/config.yaml` → `party:` block, and
restart the companion only (the engine keeps running; the deploy/supervisor
path is `deploy/deploy.py` + schtasks `BM26TitanicStack`). **Verify** by
watching `audioPartyStrong` flip on within ~20 s of the music starting and off
within ~30 s of it stopping, then watch `/timeline/state` for the mood fire at
the 2-minute mark. Shorten `minDwellSec` to 20 s temporarily while validating
the plumbing, then put it back to 120.

**Anti-goal check:** stand the system on the driveway with no music for 30
minutes and confirm `audioPartyStrong` stays 0 the whole time. Today's
`audioParty` fails that test.

---

## 5. Build list (smallest viable first)

| # | Item | Where | Effort | Notes |
|---|---|---|---|---|
| 1 | Publish `audioBpmLocked`, `audioBpmConf`, `audioKickReg`, `audioKickRate`, `audioLoudness` | `audio/signals/derived_signals.js` (+ `bpm_tracker`/`genre_classifier` already return them) + `audio/postproc/audio_signals.js` registry | **2 h** | Pure plumbing of values already computed. Immediately makes tuning possible even before the new gate exists. |
| 2 | `PartyModeStrong` shaper + `audioPartyStrong` key + `party:` config block | new `audio/signals/party_mode_strong.js`, wired in `derived_signals.js` | **4 h** | Pure, allocation-free, same shape as `party_mode.js`; unit test with synthetic level/kick traces. |
| 3 | Companion UI: `loudness / kickReg / bpmLocked / partyStrong` in the derived panel + a threshold read-out | `audio/companion/ui/companion_app.js` | **2 h** | This is the live tuning surface — do not skip it. |
| 4 | Flip `timeline.mood.key` → `audioPartyStrong` | `marsin_engine/config.yaml` | **5 min** | Config only. |
| 5 | Author the ambient/party looks + `defaultCue` + `durationMin`/`minDwellSec`/`cooldownSec` in the plan | `simulation/scenes/titanic/timeline/playa_default.yaml` | **1 h** | Blocked on R2/R3 producing real `ambient` / `party_high` playlists — today only `default` exists. |
| 6 | Playa calibration run + threshold commit | operator + agent | **1 evening** | §4.4. |
| 7 | *(Only if Sina picks END option B or C)* release-on-signal / extend-with-cap window | `lib/timeline/timeline_service.js` `_noteDeckWindow` / `_reconcileDefaultCue` | **4–6 h** | Option A needs **zero** code here. |
| 8 | *(R5 follow-up)* companion-down watchdog | engine | **2 h** | If the companion dies, `audioPartyStrong` freezes at its last value in the CPC — a stuck 1 would pin party mode forever. Add a staleness guard that forces the mood key to 0 when no audio frame has arrived for N seconds. **File this; it is a real single-point failure.** |

---

## 6. Open decisions for Sina

1. **Session end:** option A (fixed 12 min) / B (follow-the-music, min 10) / C
   (extend-while-playing, cap 45). Recommend **A for v1**, revisit on playa.
2. **Cooldown:** 15 min recommended. Longer = safer against thrash, shorter =
   more responsive to a genuinely long party.
3. **Phase gating:** keep `whenPhase: party_night` (party detection only after
   sunset+2h) or allow any time? Recommend **dropping it** once the detector is
   trustworthy, so a sunset dance party is honoured.
4. **Playlists:** confirm the `ambient` / `party_high` / `party_low` trio from the
   July 9 plan is still the content model (R2/R3 depend on it).
5. **Calibration slot:** which night/hour on playa for the ambient-vs-party
   baseline capture (§4.4). It needs our sound system, and ideally an audible
   neighbouring camp.

## 7. Files that matter

- `marsin_engine/audio/signals/party_mode.js` — the current detector (the problem)
- `marsin_engine/audio/signals/derived_signals.js` — publish point for all derived keys
- `marsin_engine/audio/signals/bpm_tracker.js` · `genre_classifier.js` — sources of the unpublished lock/regularity signals
- `marsin_engine/audio/postproc/audio_signals.js` — CPC/OSC key registry
- `marsin_engine/audio/companion/companion_server.js` — analyzer loop, `emitAllDerived()`
- `marsin_engine/lib/timeline/triggers.js` · `show_plan.js` · `timeline_service.js` · `arbiter.js` — the session machinery
- `marsin_engine/lib/api_server.js:4395` — `getMood()` (the one-line key swap)
- `marsin_engine/config.yaml:96-104` — `timeline:` block
- `simulation/scenes/titanic/timeline/playa_default.yaml` — the live plan
- `marsin_engine/lib/autopilot_profiles/audio_reactive_profile.js` + `docs/41_audio_reactive_tuning.md` — the art-car-robustness precedent to copy
- `docs/38_timeline_show_scheduler.md` — the show-director spec (§16.11 = defaultCue/durationMin)
