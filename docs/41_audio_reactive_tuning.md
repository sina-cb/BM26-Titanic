# Audio-reactive autopilot — tuning & testing with fake audio

The `audio_reactive` autopilot profile drives **pattern switches, pattern speed,
and colour** from the Audio Companion's live signals. This doc covers (1) the
tunable knobs and their Burning Man defaults, (2) the art-car robustness design,
and (3) how to test the profile with **fake / synthetic audio** — no real music
required.

Code: `marsin_engine/lib/autopilot_profiles/audio_reactive_profile.js`
(`AUDIO_REACTIVE_DEFAULTS`). Unit tests: `marsin_engine/tests/audio_reactive_profile.test.js`.
HIL: `marsin_engine/tests/hil/hil_audio_reactive_profile_test.mjs`.

## Design principle (why it's playa-safe)

From a **single mic** we cannot separate our own sound system from a passing
art car. A car is loud EXTERNAL audio for ~10–40 s, then gone. So the profile
**reacts to the SUSTAINED musical context of OUR track (over tens of seconds to
minutes) and treats brief swells as noise**:

- **PATTERN** reacts to *dynamics* but only **sustained** ones — a switch needs
  energy to rise from a calm and **stay elevated for `switchConfirmMs`**. A
  passing car peaks then fades before the window elapses, so it is rejected; our
  track's build plateaus and fires.
- **SPEED** rides the **slow** energy envelope (`energySlowTau`), so a transient
  can't yank the tempo. A stable shift from high→low energy **slows the patterns
  down** (a multiplicative scale on the bpm-sync mapping); a stable rise speeds
  them back up.
- **COLOUR** reacts to a **stable mood descriptor** (a coarse energy band, held
  past `colorHoldMs`), NOT to the instantaneous note — a car's foreign pitch
  never recolours. The note only chooses *which* palette when a mood change fires.
- A heavy `minIntervalMs` caps churn even if a false trigger slips through.

**Honest limit:** a car *parked adjacent* and blasting continuously for longer
than `switchConfirmMs` will cause at most **one** (minInterval-capped) switch,
and a genuinely sustained loud passage will drift the colour. That is
unavoidable from one mic — raise `switchConfirmMs` / `colorHoldMs` to trade
responsiveness for more rejection.

## Tunables (`AUDIO_REACTIVE_DEFAULTS`)

| Knob | BM default | What it does | More reactive ↔ more stable |
|---|---|---|---|
| `minIntervalMs` | 12000 | floor between any two pattern switches | lower = snappier / higher = calmer, more art-car-proof |
| `maxDwellS` | 300 | force an advance if nothing has for this long (anti-freeze) | lower = never dwells / higher = can sit longer |
| `switchConfirmMs` | 15000 | a pickup must hold elevated this long to switch | lower = reacts to shorter builds (and to art cars) / higher = rejects longer swells |
| `pickupArmBelow` | 0.45 | energy must dip below this (a calm) to arm a pickup | — |
| `pickupSustainAbove` | 0.6 | energy must climb above this and stay there | lower = easier to trigger / higher = needs a bigger build |
| `energyFastTau` | 2.0 s | fast envelope (dynamics/pickup detection) | — |
| `energySlowTau` | 25.0 s | slow envelope (mood → speed arc + colour band) | lower = speed/colour chase the music / higher = ride only the macro trend |
| `speedScaleFloor` | 0.35 | slowest the patterns run in a deep calm (× tempo speed) | higher = never slows much / lower = can nearly stall |
| `speedArcRatePerS` | 0.5 | how fast the speed scale ramps to its target | — |
| `colorHoldMs` | 15000 | a mood change must hold this long to recolour | lower = colour drifts sooner / higher = only very settled shifts |
| `colorMinIntervalMs` | 8000 | floor between recolours | — |
| `energyBandEdges` | [0.25,0.5,0.75] | quantise the slow energy into 4 mood bands | — |
| `bpmSpeedMin/Max` | 60 / 160 | the BPM→speed window armed on attach (does NOT move) | — |
| `energyShuffleHi` | 0.6 | loud → shuffle pick bias | — |
| `slowGroupHi` | 0.55 | slow-zone → group-locality pick bias | — |
| `silenceHi` / `partyLo` | 0.5 / 0.5 | gates: suppress advances on silence / non-party | — |

Override any subset when constructing the profile (unit tests do this to run the
5-minute paths in milliseconds). The wire/persisted autopilot state only carries
the profile *name*; these constants are in-code.

## Testing with FAKE audio

`audioParty` defaults to **0** (fail-closed) — nothing reacts until you open the
gates. Always inject `audioSilence:0, audioParty:1` first. Pulses are
**level-triggered** and single-hop at the source, so **hold** a value (set 1,
observe, set 0) — don't blip it.

### A. Automated (unit + HIL)

- **Unit** (`tests/audio_reactive_profile.test.js`): a fake `paramCenter`/`ctx`
  drives `_tick()` under a stubbed clock — deterministic, sub-second. Covers F1
  speed direction, sustained-build → switch, **art-car flyby → no switch / no
  recolour**, sustained-mood → recolour, silence gate, pick bias.
  `node --test tests/audio_reactive_profile.test.js`
- **HIL** (`tests/hil/hil_audio_reactive_profile_test.mjs`): boots a real engine
  on `:31068`, injects synthetic CPC via `POST /param-center` under a per-param
  **source-lock** (leases the injected keys to source `'api'` so the live mic
  can't clobber them), asserts the real `speed`/deck/palette move, restores all
  state in a `finally`. `node tests/hil/hil_audio_reactive_profile_test.mjs`

### B. Interactive — REST injection into a running stack (surgical)

Bring up sim → engine → CaptainPad (`.agent/skills/full_stack_smoke.md`), set the
autopilot profile to `audio_reactive` (CaptainPad dropdown, or
`POST /deck/playlist/autopilot {"active":true,"profile":"audio_reactive"}`), then:

```bash
# open the gates (party defaults to 0 → everything suppressed until this)
curl -s -X POST http://127.0.0.1:6968/param-center -d '{"audioSilence":0,"audioParty":1}'
# feed a tempo (re-send < every 1.5 s or the arbiter drops it) to see speed move
while true; do curl -s -X POST http://127.0.0.1:6968/param-center -d '{"audioBpm":128}'; sleep 1; done &
```

If a Companion/mic is also feeding, first lease your keys so they win:
`POST /param-center/source-lock {"mode":"per-param","leases":{"audioEnergyRatio":"api", ...}}`
— and **release with `{"mode":"open"}`** when done.

### C. Interactive — the Audio Companion's TEST synths (realistic, no speakers)

The Companion computes the real derived signals from any PCM and streams them to
the engine over OSC. Standalone it boots in `test` mode:

```bash
cd marsin_engine && node audio/companion/companion_server.js   # GUI on :6966
```

Pick a synth to exercise each behaviour: `edm_drop` / `riser` / `full_track`
(builds → sustained-pickup switch + speed), `silence` (silence gate),
`chord_progression` (mood/colour), or `file` to replay a real track. This is the
best "watch the sim dance with no speakers" path.

### Signal cookbook (what to fake for each behaviour)

| Behaviour | Inject | Expect |
|---|---|---|
| Pattern advance (musical cue) | `audioSwitchPattern:1` (after 12 s minInterval) | deck entry advances |
| **Energy-arc slow-down** | hold `audioEnergyRatio:0.95` then `0.05` for ~30 s (+ a re-sent `audioBpm`) | `speed` falls; `bpmSpeedMax` stays 160 |
| **Sustained build → switch** | after a calm, hold `audioEnergyRatio:0.92` > 15 s | deck advances |
| **Art-car flyby → NO switch/recolour** | a calm, then `0.92` for only ~8 s, then back to calm (with a foreign `audioNote`) | deck & palette unchanged |
| **Mood change → recolour** | hold a new `audioEnergyRatio` band > ~40 s, set `audioNoteHue` | palette snaps to nearest-hue |
| Silence gate | `audioSilence:1`, then a `audioSwitchPattern:1` | no advance |
