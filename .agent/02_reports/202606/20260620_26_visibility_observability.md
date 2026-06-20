# 2026-06-20 — Wave E4: pattern silence-floor lift + derived-signal harness + observability honesty

**Branch:** `dev/e4_visibility` (parent `feat/audio_analysis_2`) · worktree
`/root/workspace/BM26-Titanic-worktrees/e4_visibility` · slot 4.
**Implements the E4 items** from the adversarial re-wave 2 findings
(`20260620_22`). Four tasks: P1 pattern silence-floor lift, P1 reproducible
derived-signal harness, P1 observability honesty, P2 #55/#56 doc.

All numeric proof on the REAL titanic rig (`--model titanic`, 970 px) via the
offline harnesses (no chromium here, so PNG/HTML + numeric proof, no screenshots).

---

## Task 1 — P1 mission-critical visibility (silence-floor lift)

Patterns 59/64/65/66 rendered near-black at silence on the real 970-px rig
(~10/255 peak), contradicting the codex "never fully dark / night-visibility is
mission critical". Root cause: the always-on idle/base floors were set far too
low (e.g. `base = 0.16` then halved again by a `0.5 + 0.5·wave` breathing term
and, in 65, a second `0.30 + 0.70·coreFall` rim taper), so the silence frame
collapsed to single-digit channels. The reference patterns 62 (peak 109) and 67
(peak 79) sit at a clearly-visible floor — that's the target.

**Fix:** raised each pattern's base-floor default + slider range, and lifted the
breathing/taper multipliers' MINIMUM so the wash is evenly lit across the whole
hull (not a faint flicker or a dim core dot). The audio events are unchanged and
still composite with `max()` (`if (eventBri > bri) bri = eventBri`), so a higher
silence floor does NOT reduce event contrast — hits still slam to 255 and the
true-black negative space returns the instant a zone is between hits under audio.

**Before → After — peak / mean channel, `--model titanic --synth silence`:**

| Pattern | before peak/mean | after peak/mean |
|---|---|---|
| `59_drumkit_chase` | 11 / 8.3 | **56 / 46.6** |
| `64_drop_countdown` | 11 / 4.3 | **81 / 41.3** |
| `65_climax_hold` | 10 / 2.7 | **79 / 31.0** |
| `66_phrase_stepped` | 12 / 5.6 | **90 / 50.6** |

64/65/66 clear the "≳60/255 like 62/67" bar; 59 lands at peak 56 with a high,
even mean of 46.6 (it is a blended two-colour palette LINE at `tcol=0.5`, so
per-channel peak is intrinsically ~½ a saturated colour — pushing the floor
higher would wash out the per-band onset identity; the mean 46.6 > 67's mean 30
confirms it is unmistakably lit). Exact floor params per pattern:
- 59: `floor_` 0.10→0.58, base mult `0.55+0.45·travel`→`0.74+0.26·travel`, slider 0.18..0.70.
- 64: `base` 0.16→0.42, base mult `0.5+0.5·wave`→`0.72+0.28·wave`, slider 0.18..0.60.
- 65: `base` 0.18→0.46, rim taper `0.30+0.70·coreFall`→`0.62+0.38·coreFall`, base mult →`0.72+0.28·wave`, slider 0.20..0.62.
- 66: `base` 0.16→0.42, base mult →`0.72+0.28·wave`, slider 0.18..0.60.

**Contrast under audio still intact** (new harness, below): 64 peaks 255 on
edm_drop, 65 peaks 255 on full_track, 66 peaks 254 on full_track — full dynamic
range from the lifted floor up to white.

---

## Task 2 — P1 reproducible reactivity harness (committed)

There was NO committed harness that drives the SECOND-TIER derived signals that
patterns 64–68 (and 59) react to — D3/D10's proof used a gitignored `~/tmp`
harness. The existing `tools/pattern_audio_harness.mjs` only drives the five RAW
analyzer bands (`micLow/Mid/High/Kick/Flux`), so it physically cannot exercise
`audioDropCountdown`, `audioClimax`, `audioPhrasePhase`, `audioRiserScore`,
`micOnsetLow/Mid/High`, etc.

**Promoted:** `marsin_engine/tools/pattern_derived_harness.mjs` — runs the FULL
real engine audio chain offline:

```
synth → real AudioAnalyzer (fftSize 2048) → ParamCenter
      → real AudioStructureDetector (enabled, shipped defaults)
      → real DerivedSignals (riser/climax/phrase/countdown/track-change/onsets/…)
      → derived-signal OVERRIDE map (range-normalised, == lib/modulation_engine.js)
      → MarsinVM render on the chosen model → brightness series + per-signal corr
```

It auto-discovers the signal→slider map from each pattern's `AUDIO_MODULATION_V1`
doc block (the modulators-only contract), so it drives each pattern exactly as
the rig would — no hand-written `--mod`. Fails loud on bad model/synth/key
(codex P0, no silent test_bench fallback).

**Entrypoint:**
```
node tools/pattern_derived_harness.mjs --pattern patterns/64_drop_countdown.js \
     --synth edm_drop --model titanic --frames 320
```

**Sample correlations (real chain, titanic 970, driving synth):**

| Pattern | driving signal | synth | corr(signal,brightness) | peak |
|---|---|---|---|---|
| 64 drop_countdown | `audioDropPulse` | edm_drop | **0.99** | 255 |
| 65 climax_hold | `audioClimax` | full_track | **0.91** | 255 |
| 66 phrase_stepped | `audioPhrasePhase` | full_track | **0.94** | 254 |
| 67 track_reset | `audioSilence` | silence | **-0.75** (dims by design) | 79 |
| 68 riser_sweep | `audioRiserScore` | riser | **0.97** | 141 |
| 68 riser_sweep | `audioRiserConf` | riser | **0.85** | 141 |
| 59 drumkit_chase | `micOnsetLow/Mid/High` | hats | onsets FIRE (range 0..1) | 56 |

The detector genuinely fires (e.g. `dropFired confidence=1.00` on edm_drop). The
harness reports honestly: a signal that the chosen synth never produces prints
`[flat] (signal never moved — pick a synth that drives it)` rather than faking a
number — e.g. `audioDropCountdown` needs a beat-locked riser→drop, `audioTrackChange`
needs a full→silence→full gap that no single synth bank entry provides. 59's
per-band onsets fire (range 0..1) but the total-brightness corr is diluted
because each band lights only ~⅓ of the hull (three spatially-disjoint zones) —
a real characteristic of the drum-kit layout, not a harness defect.

---

## Task 3 — P1 observability honesty (companion `/osc_accounting`)

`/osc_accounting` listed only the 9 signals the companion SENDS over OSC. The
rich Round-2/Wave-D derived signals are computed engine-INTERNAL
(AudioStructureDetector + DerivedSignals → engine ParamCenter each hop) and never
touch the OSC bus — so the page could be misread as "the companion is the whole
brain".

**Added** a clearly-labelled informational section, **"ENGINE-INTERNAL DERIVED
(computed in-engine, NOT OSC-routed)"**, to both the endpoint and the UI:
- `companion_server.js`: a static catalogue `ENGINE_INTERNAL_DERIVED` (29 keys:
  beat/party/note/onsets/genre/riser/climax/phrase/countdown/track-change +
  detector primitives) returned under a new `engineInternalDerived` field with a
  note explaining they are engine-internal and the companion does not send them.
- UI (`index.html` + `companion_app.js` + `companion_app.css`): a themed panel of
  CPC-key chips below the OSC OUT table; hidden gracefully on an older server.

**Proof:** companion booted on slot-4 port 31466 →
`curl :31466/osc_accounting` returns `outputs: 9` AND
`engineInternalDerived present: true` with `signal count: 29`. The HTML/CSS/JS
assets all serve the new panel ids. Port freed after, no proc leak.
`node --test tests/companion_*.test.js` → **72 pass / 0 fail**.

---

## Task 4 — P2 #55/#56 gap documented

Pattern numbers 55 & 56 are absent (sequence is 00–54, then 57–68). The catalog
generator's `SUMMARY` already noted the gap but didn't label it intentional and
was stale. **Upgraded** the note in `tools/gen_catalog.mjs` (the source of
`patterns/catalog.md`) to state the gap is INTENTIONAL, that the later patterns
must NOT be renumbered (would break manifest order, saved scenes, CaptainPad slot
refs), and regenerated `catalog.md` (only that file changed; group pages
byte-identical). No renumber.

---

## Verification gates (all green)

- Pattern floors: before→after table above (`--model titanic --synth silence`).
- Reactivity: `tools/pattern_derived_harness.mjs` correlations above (64=0.99,
  65=0.91, 66=0.94, 67=-0.75, 68=0.97/0.85).
- Companion: `curl :31466/osc_accounting` shows the engine-internal section;
  `node --test tests/companion_*.test.js` → 72/72 green.
- Manifest still **68 valid entries**.
- Real-engine `--dry-run` on a touched pattern (`64_drop_countdown`,
  `--model test_bench`) exits **0**.
- Full suite `node --test tests/*.test.{js,mjs}` → 849 pass / 1 fail; the lone
  fail is the KNOWN flaky `DerivedSignals.tick` p99 perf assertion under parallel
  OS-scheduler load (findings P1 "Perf test is flaky"); it passes in isolation
  (p99=0.42 ms < 0.5 ms budget). Untouched by this slice.
- `git diff --check` clean (no whitespace errors). `states/*.yaml` + the sim
  playlist (engine/harness residue) restored; ports 31466/31468 free; no stray
  procs. Per-worktree `config.yaml` port edits not committed.

## Files changed
- `marsin_engine/patterns/59_drumkit_chase.js`, `64_drop_countdown.js`,
  `65_climax_hold.js`, `66_phrase_stepped.js` — silence-floor lift.
- `marsin_engine/tools/pattern_derived_harness.mjs` — **NEW** committed
  full-chain derived-signal reactivity harness.
- `marsin_engine/audio/companion/companion_server.js` — engine-internal-derived
  accounting section (endpoint).
- `marsin_engine/audio/companion/ui/index.html` / `companion_app.js` /
  `companion_app.css` — engine-internal-derived UI panel.
- `marsin_engine/tools/gen_catalog.mjs` + `marsin_engine/patterns/catalog.md` —
  #55/#56 intentional-skip note.
