# Slot 0 — genre_detection + note→colour fix

- **Branch:** dev/genre_signals
- **Parent branch:** feat/audio_analysis_2
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/genre_signals
- **Slot ports:** engine 31068 / OSC 31000 (not booted; validated offline)

> Note: this slice's sub-agent stalled mid-task after writing the
> implementation; the **instigator finished it** (validation tests, datasets
> note, this report) and verified before merge. The implementation below
> (genre_classifier, note/colour fix, wiring) is the sub-agent's work; the two
> new test files + this report are the instigator's.

## Scope
1. **Genre detection for party mode** (operator: techno / melodic house / deep
   house + BM-popular genres, "simple", driven by the signals we already have).
   New `audio/signals/genre_classifier.js` (`GenreClassifier`, pure/alloc-free)
   publishes `audioGenre` (0..6 index) + `audioGenreConf` (0..1) via
   `DerivedSignals`. Canonical enum (cross-module contract):
   `['ambient','deep_house','melodic_house','tech_house','techno','melodic_techno','downtempo']`.
2. **Note→colour fix** (operator: "the note colour change signals weren't
   working"): root-caused + fixed in `audio/signals/switch_signals.js`.

## How genre detection works
Driven ENTIRELY from already-derived signals (no new FFT): realtime BPM, kick
density + regularity (from the `micKickRaw` pulse train), low/mid/high band
balance + high-band variance (offbeat-hat "groove"), note-change rate (pitch-
class flips), spectral flux. Aggregated over a ~4 s window into an 8-feature
vector, scored against a fixed bank of per-genre prior PROFILES (weighted
distance → similarity), argmax with score-EMA + hysteresis + 4 s min-dwell so
the published genre holds steady (no bar-to-bar flicker). Genre is meaningful
ONLY in party mode; when `audioParty` is off it publishes 0 (ambient).
Key empirical insight baked into the profiles: the note-rate feature saturates
high for any track with moving chord roots, so `melodic≈0` is **techno's**
exclusive signature; BPM is the strongest single axis (downtempo's sub-4/4
tempo is the cleanest cue); `sparkleVar` is tech_house's offbeat-hat signature.

## Note→colour root cause + fix
The old code advanced `_prevPc` / `_lastNoteChangeMs` the moment the pitch
class differed — EVEN when the colour fire was then blocked by `colorMinDwellMs`.
So a note change landing inside the colour dwell was silently **consumed** with
no recolour; the rig coloured at ~half the real note rate and felt disconnected
from the melody. Fix: latch a PENDING note intent and commit `_prevPc` /
`_lastNoteChangeMs` ONLY when the colour actually fires, so a blocked change
stays pending and fires on the next eligible hop; a note that returns to the
last-coloured class before firing is dropped (no recolour to the same hue).

## Files changed
```
A  marsin_engine/audio/signals/genre_classifier.js      (classifier, 406 lines)
M  marsin_engine/audio/signals/derived_signals.js       (+ genre wiring, publish audioGenre/Conf)
M  marsin_engine/audio/signals/switch_signals.js         (note→colour pending-latch fix)
M  marsin_engine/audio/postproc/audio_signals.js         (register audioGenre/audioGenreConf, hz 5)
M  marsin_engine/audio/synth/test_synths.js              (+ chord_progression melodic synth)
M  marsin_engine/tests/audio_signals.test.js             (registry assertion for the 2 new keys)
A  marsin_engine/tests/genre_classifier.test.js          (9 tests — instigator)
A  marsin_engine/tests/switch_color_note.test.js         (4 tests — instigator)
M  marsin_engine/datasets/README.md                      (genre datasets note)
```

## New CPC keys (for reconciliation)
- `audioGenre` (int 0..6, range [0,6], broadcast 5 Hz) — engine-internal derived,
  no inbound OSC. `audioGenreConf` (0..1, 5 Hz). Both publish 0 when not party.

## Verification proof (commands + output)
- `node --test tests/genre_classifier.test.js` → **9 pass / 0 fail**. Asserts:
  party-gate (no party → 0/conf0), warmup holds ambient, techno-like
  (130bpm/dark/steady/non-melodic) → techno family, downtempo-like (102bpm,
  moving roots) → downtempo (6), house-like (123bpm/bright/melodic) → house
  family, tech_house (offbeat-hat variance) → tech_house (3), party-drop resets
  to ambient, steady section → **0 genre changes** (no flicker).
- `node --test tests/switch_color_note.test.js` → **4 pass / 0 fail**. Asserts:
  first stable note recolours; a change blocked by `colorMinDwell` is NOT lost —
  it fires after the dwell (the fix); a note returning to the last-coloured
  class is dropped; a held note does not strobe.
- `node --test tests/audio_*.test.js tests/genre_classifier.test.js tests/switch_color_note.test.js tests/note_estimator_synthetic.test.js`
  → **169 pass / 0 fail** (full audio suite incl. the 13 new tests).
- Module load smoke: `GENRE_NAMES = ambient,deep_house,melodic_house,tech_house,techno,melodic_techno,downtempo`.

## Process
Instigator took over the stalled slice: read the full `genre_classifier.js`
(coherent, well-tuned) and the `derived_signals`/`switch_signals` diffs
(clean root-cause fix), confirmed the partial work loaded + the existing
registry tests passed (16), then wrote the two missing validation suites.
The genre test initially failed on downtempo/tech_house because the first-pass
scenarios fed zero note-changes — corrected to realistic melodic content (the
classifier expects `melodic≈0` ONLY for techno), after which all pass.

## Known gaps / follow-ups
- Genre profiles tuned on **synthetic** signal scenarios (real audio is
  datacenter-gated) — re-tune against real labelled per-genre audio on an
  un-gated IP for field-grade accuracy (datasets/README note).
- Genre is engine-internal derived (in CPC); wiring it into actual
  pattern/palette behaviour is a downstream task. The companion DERIVED panel
  shows it (sibling slot 1).

## Operator action requested
Ready for review and merge.
