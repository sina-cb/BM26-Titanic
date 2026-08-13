# Audio Signals — making patterns listen musically

**Status:** REFERENCE — signal selection and authoring guidance for patterns,
looks, playlists, and program-optimizer agents. **Operator:** Sina Solaimanpour.

This document explains the audio signals that the current engine publishes and
how to use them without making a look nervous, brittle, or dependent on audio.
It does not redefine the registry. Exact keys, ranges, OSC addresses, and
broadcast rates come from
[`audio_signals.js`](../marsin_engine/audio/postproc/audio_signals.js).

Where this guide states a runtime rule, it uses the same tiers as
[`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md): **HARD CONTRACT**,
**PRODUCTION CONVENTION**, or **OPTIONAL CAPABILITY**. Artistic suggestions are
guidance, not engine rules.

---

## 1. The core contract in one line

**Audio drives an ordinary pattern slider through a playlist modulation;
pattern code never reads a live audio key directly.**

That separation is a **HARD CONTRACT**:

```text
microphone / file / synth
        ↓
Audio Companion analysis and signal shaping
        ↓ OSC
Central Param Center (CPC)
        ↓ playlist modulation
ordinary slider* control
        ↓
pattern render
```

A pattern must remain a complete, good-looking, silence-safe design when no
modulation is attached. Audio is a performance layer, not life support.

Do this:

```javascript
export var kick = 0.0;
export function sliderKick(v) { kick = v; }
```

Then attach `micKick` to `sliderKick` on the playlist entry. Do **not** declare
`export var micKick`; the engine deliberately refuses to bind live audio keys
into pattern globals.

---

## 2. Choose a signal by the visual job

| Visual job | Start with | Why |
|---|---|---|
| broad breathing / brightness | `micLow`, `micMid` | continuous, readable energy |
| bass punch | `micKick`, `micOnsetLow`, `audioChestHit` | shaped transients with distinct jobs |
| snare / chord-stab chase | `micOnsetMid` | responds to new mid-band energy |
| hats / sparkle density | `micHigh`, `micOnsetHigh` | bright-band energy or transient |
| motion complexity / turbulence | `micFlux` | tracks spectral change, not just volume |
| beat-locked motion | `audioBeat`, `audioBarPhase` | stable beat pulse or continuous bar phase |
| once-per-bar accent | `audioDownbeat` | bar-start pulse; absolute beat 1 is an estimate |
| build-up / anticipation | `audioRiserScore`, with `audioRiserConf` | continuous pre-drop evidence |
| hit the drop | `audioDropPulse` | sparse structural transient |
| hold the biggest look | `audioClimax` | sustained peak score, not another hit |
| calm versus party behavior | `audioParty` | debounced loud-music gate; use only for reversible visual state |
| harmonic color | `audioNoteHue` | stable pitch class already mapped to `0..1` |
| intentional pattern change | `audioSwitchPattern` or `audioPhraseBoundary` | sparse musical change cue |
| intentional palette change | `audioSwitchColor` | note/structure/drop-informed change cue |
| silence behavior | `audioSilence` | debounced quiet-gap state |

Start with one primary mapping. Add a second only when it controls a genuinely
different visual dimension. Four signals all pushing brightness usually read
as noise, not responsiveness.

---

## 3. Signal catalog

### 3.1 Continuous energy and motion

These are the normal first choices for pattern modulation.

| Key | Range / rate | Meaning | Good uses | Caution |
|---|---|---|---|---|
| `micLow` | `0..1`, 15 Hz | shaped low-band energy | hull brightness, bass-size, slow swell | continuous bass body, not a discrete kick |
| `micMid` | `0..1`, 15 Hz | shaped mid-band energy | organs, vocal/chord presence, texture density | speech and room sound also live here |
| `micHigh` | `0..1`, 15 Hz | shaped high-band energy | sparkle, UV detail, fine motion | wind/hiss can raise it; avoid using it alone as “music present” |
| `micKick` | `0..1`, 30 Hz | kick trigger envelope | short punch, expansion, blinder bite | transient; do not treat a held high sample as repeated kicks |
| `micFlux` | `0..1`, 15 Hz | spectral change / transient density | turbulence, width, build complexity | busy noise can also have high flux |
| `audioEnergyRatio` | `0..1`, 10 Hz | current short energy relative to its longer context | section contrast, quiet-to-loud scaling | relative, not an absolute loudness meter |
| `audioBuildScore` | `0..1`, 10 Hz | structure detector's build evidence | build brightness and acceleration | detector is opt-in; verify it is enabled first |
| `audioRiserScore` | `0..1`, 15 Hz | multi-signal rising-build score | charge-up, tightening chase, rising coverage | pair with `audioRiserConf` for consequential behavior |
| `audioClimax` | `0..1`, 10 Hz | sustained full-spectrum peak score | hold maximum coverage, open the whole ship | a state-like score, not a one-frame event |
| `audioSlowZone` | `0..1`, 10 Hz | slow / breakdown evidence | soften motion, reduce density, move toward ambient | use gentle curves; threshold chatter is visually expensive |

`audioVocalsHot`, `audioPartyStrong`, `audioLoudness`, `audioKickRate`,
`audioKickReg`, `audioBpmLocked`, and `audioBpmConf` are **not** in this
worktree's current registry. An optimizer must not assign a signal merely
because it exists in another branch, report, or older schema.

### 3.2 Band onsets and body hits

These answer “what just started?” rather than “how loud is this band?”

| Key | Range / rate | Meaning | Best visual metaphor |
|---|---|---|---|
| `micOnsetLow` | pulse `0..1`, 30 Hz | new low-band energy | kick-side hull chase |
| `micOnsetMid` | pulse `0..1`, 30 Hz | new mid-band energy | snare, chord, or auditorium response |
| `micOnsetHigh` | pulse `0..1`, 30 Hz | new high-band energy | hats, jewelry sparkle, outline tick |
| `audioChestHit` | pulse `0..1`, 30 Hz | transient 30–60 Hz sub slam above a held drone | whole-hull body thump |

`micKick` and `audioChestHit` are intentionally different. `micKick` follows the
kick trigger; `audioChestHit` emphasizes the felt sub-bass attack and suppresses
a held 808/drone.

### 3.3 Dominant-frequency dancers and harmonic color

| Key | Range / rate | What it actually carries | Use |
|---|---|---|---|
| `micDomFreq1` | `0..22050 Hz`, 15 Hz | center frequency of the strongest currently ranked tracked partial | advanced frequency position or scale control |
| `micDomEnergy1` | `0..1`, 15 Hz | smoothed spectral-lobe energy paired with lane 1 | visibility, size, or weight for lane 1 |
| `micDomFreq2` | `0..22050 Hz`, 15 Hz | center frequency of the second currently ranked distinct partial | secondary frequency motion |
| `micDomEnergy2` | `0..1`, 15 Hz | smoothed spectral-lobe energy paired with lane 2 | visibility, size, or weight for lane 2 |
| `audioNote` | integer `0..11`, 10 Hz | pitch class: `0=C` through `11=B` | readout or discrete harmonic logic |
| `audioNoteHue` | `0..1`, 10 Hz | held pitch class mapped through the configured circle-of-fifths color wheel | palette position / harmonic color |

The four `micDom*` keys are two **frequency + energy pairs**, not four
interchangeable modulation values. Frequency says *where the partial is in the
spectrum*. Energy says *how much of that partial is present*; it is useful as a
weight but is not a formal confidence probability. The default Companion design
passes each frequency straight through to its canonical OSC output and gives
each energy signal its own 10 Hz LPF before its OSC output. Keep the canonical
`micDomFreq1/2` outputs in Hertz: the note estimator and other frequency-aware
consumers expect Hertz.

`audioNoteHue` is deliberately hue-only. Its checked-in map follows the
operator's circle-of-fifths wheel: C yellow, then clockwise G green, D
green-cyan, A/E blue, B violet, F♯ magenta, D♭ rose, A♭ red, E♭ orange-red,
B♭ orange, and F amber. `DERIVED TUNE → NOTES → COLORS` edits the 12 hue
positions live. Companion previews them at HSV saturation `100%` and value
`100%`; the signal does not carry or modify saturation or brightness. The
`RESET ALL` button atomically restores all 12 positions to this reference wheel.
Edits and resets are stored with the scene under
`states/<scene>/audio_state.yaml` in `derivedSignals.noteColors`, so the
Companion restores them on its next start.

#### What note tracking actually delivers — and where it does not

`audioNote` / `audioNoteHue` are a **harmonic bed, not a transcription**. The
estimator commits a pitch class only after its evidence window agrees and the
change is confirmed, so the numbers below are the honest envelope. Do not
design a program that needs more than this.

**Latency.** At the shipped 86.13 hops/s a far move (more than 2 semitones)
commits in 18 hops (0.21 s) ideal; a **near** move (1–2 semitones — the common
case inside a chord progression) costs 32 hops (0.37 s) ideal, because a small
step is indistinguishable from a dominant-frequency glide and is deliberately
made expensive. Through the real analyzer at 18 dB SNR the same near move lands
in **440 ms (p50) to 856 ms (p95)**. Design consequence: a note held for less
than about **0.5 s never commits at all**. Sustained notes and chords track;
arps, fills and fast melodic lines freeze the colour on the last committed
chord.

**Validated tier.** The estimator is validated at the `moderate` virtual-mic
tier only (**18 dB SNR**), on a synthetic 124 BPM house chord progression over
12 seeds. Measured there: 93.7% mean accuracy over the settled part of each
chord, **51.9% over the full chord** (commit latency eats the first ~45% of a
968 ms chord), 99.4% mean chord-change recall, and 10 of 12 seeds with a
perfectly ordered change sequence — the other 2 emit one spurious or one
missing flip.

**Degradation profile.** At the `heavy` tier (**9 dB SNR**) note tracking is
**non-functional**: measured 0–25% accuracy and 0–27% chord-change recall over
seeds 1–4, and on one seed the estimator never commits a single note across a
19 s clip. There is no graceful middle regime — treat 9 dB as "no note colour".

**Unvalidated.** The `playa` and `adversarial` tiers (wind gusts,
neighbour-camp bleed, hard clipping) have **never been scored** for note
tracking. Any claim about note colour on a windy night beside another camp is
currently unsupported. Closing that gap is a redesign — chroma-based pitch
estimation instead of dominant-frequency folding — not a retune of the
`noteTracking` knobs.

Evidence: `marsin_engine/tests/audio/note_estimator_noisy.test.mjs` (corpus and
per-seed numbers) and
`marsin_engine/tests/audio/note_estimator_synthetic.test.js` (ideal latency,
constructor and warmup contracts).

#### Why raw dominant-frequency motion looks jerky

The analyzer Kalman-smooths each track, slowly ranks tracks by energy, and
softens the special lane-2 retarget. It still cannot turn a changing musical
mixture into two permanent voice identities. Lane numbers are energy rank, so
partials can exchange lanes; a new partial can replace an old one; and a dead
or non-distinct lane emits frequency `0` and energy `0`. A weak lane's center is
therefore not useful visual position merely because it is finite.

`danceMaker` addresses only the visible step: it is a frequency-only,
critically damped spring that glides toward the input without overshoot. Its
default `omega` is `7` (about a 0.4 s settle), lower values move more slowly,
and the validated maximum is `40`. Its output is still Hertz. It does **not**
normalize, gate on energy, or preserve the identity of a partial. Frequency
`lpf`, `slew`, and `clamp` also operate in Hertz.

The Companion `normalizer` does a different job. On a frequency signal it
adaptively maps the recent floor/peak span to `0..1`; `windowSec` controls how
slowly that operating range relaxes, and `strength < 1` compresses travel toward
`0.5`. This is an adaptive linear position signal, not a fixed logarithmic
pitch scale.

#### Recommended mappings

| Visual intent | Recommended source and shaping |
|---|---|
| harmonic palette | use `audioNoteHue`; it already chooses an in-range partial, energy-gates weak input, rejects short flips, and holds color through gaps — inside its validated envelope only (18 dB SNR, chords/sustained notes, ~0.4–0.9 s to change; non-functional at 9 dB — see *What note tracking actually delivers*) |
| dancer brightness, radius, trail, or opacity | use the matching `micDomEnergy1/2`, normally with a nonzero visual floor and a gentle `linear` or `easeOut` curve |
| dancer position with venue-adaptive full travel | create a **separately named** Companion frequency signal from `rawDom1` or `rawDom2`, then use `clamp` → `lpf` or `slew` → `normalizer` → `osc_out`; map that dynamic `0..1` output to the position slider |
| fixed perceptual pitch position | use a purpose-built slider whose control math converts the built-in normalized value back to Hertz and applies a documented logarithmic window such as `30..8000 Hz` |
| diagnostic or genuinely Hz-scaled behavior | use canonical `micDomFreq1/2` directly and document the intended Hertz window |

Always pair a position lane with its matching energy lane. The position slider
chooses *where* the dancer is; the energy slider controls whether its motion is
large or visible. For patterns that accept both controls, freeze the last good
position or hide the moving element below an explicit energy threshold. Lane 1
is the safer primary dancer; add lane 2 only when the look still reads well as
that secondary partial appears, disappears, or changes rank.

There are two implementation traps:

1. Playlist modulation normalizes a built-in `micDomFreq*` linearly by its
   registry range, so ordinary `40..1200 Hz` music occupies only about
   `0.002..0.054` of the slider. Do not treat a direct built-in mapping as
   perceptually normalized. Also do not put `normalizer` on the canonical
   `micDomFreq*` output: the canonical key would no longer contain truthful
   Hertz, and playlist modulation would divide that resulting `0..1` value by
   `22050` again. Use a separately named dynamic output for normalized position.
2. A frequency signal containing `danceMaker` can become the DOM DANCE center
   for its raw lane. Do not append `normalizer` to that same dance-producing
   signal: the view would interpret its `0..1` post value as Hertz. Keep a
   dance-producing chain in Hertz and make normalized position a second chain
   without `danceMaker`.

Current pattern code illustrates the distinction. `26_dom_dancers_chevron`
exposes separate X and energy sliders, but its checked-in
`AUDIO_MODULATION_V1` intentionally leaves both X targets static and drives the
two energy controls from `micMid` and `micHigh`; its name does not mean it
automatically consumes dominant-frequency lanes. `27_swipe` uses
`micDomEnergy1` for trail strength, which is an energy-shaped use. Existing
test-bench playlist entries map energy to position and raw `micDomFreq1` to an
ordinary slider; they are scene-state examples, not recommended templates for
a frequency-position dancer.

#### What the DOM DANCE view proves

The `✦ DOM DANCE` view is a visual diagnostic, not end-to-end proof of a
pattern mapping. It places each center on a logarithmic display axis calibrated
for `30..8000 Hz`, draws spring-smoothed cluster width and a trail, and sizes
the orb from the analyzer's raw lane energy. If a matching frequency signal has
an enabled `danceMaker`, the view uses that signal's post value for the center;
otherwise it silently uses its own default `omega=7` spring. The orb energy is
not the post-processed `micDomEnergy*` output. A smooth, bright orb therefore
does not prove that the CPC received shaped Hertz or shaped energy.

Validate a dominant-frequency dancer with deterministic tones before room
tuning:

1. Check raw and post values plus the OSC output row: canonical frequency must
   remain plausible Hertz, normalized custom position must span a bounded
   `0..1`, and energy must remain `0..1`.
2. Exercise a held tone, a large frequency step, two partials exchanging
   strength, lane-2 loss, weak energy, and silence. Position must stay bounded;
   weak or absent lanes must not produce a conspicuous jump or blackout.
3. Verify the actual playlist target through CPC modulation, not only the DOM
   DANCE canvas. The canvas's logarithmic axis and fallback spring are not used
   by the playlist modulation engine.
4. Run the frequency-chain, spring, Companion-routing, and modulation tests:

   ```bash
   cd marsin_engine
   node --test tests/audio/freq_ops_synthetic.test.js \
     tests/playlist/dance_maker.test.js \
     tests/companion/companion_signal_designer.test.js \
     tests/audio/modulation_engine.test.js
   ```

The derived-pattern harness publishes canonical dominant frequencies and
energies, but it does not execute a live Companion-designed dynamic signal
manifest. It can validate a pattern's response to canonical inputs; it cannot
by itself prove a custom normalized position chain.

### 3.4 Future chord detection and two-color palettes

**Status: FUTURE DESIGN — not implemented and not a live signal contract.**

The current engine does **not** detect chords. `audioNote` is one held dominant
pitch class, normally biased toward the bass root. The analyzer also computes a
12-bin chroma vector internally, but currently publishes only three aggregate
diagnostics: tonal stability, chroma change, and chroma tilt. Those aggregates
cannot distinguish C major from C minor. A program optimizer must not infer a
chord, quality, or two-color palette from `audioNote` alone.

The existing chroma vector is nevertheless the correct evidence for a future
chord layer. The design below records how that layer should work so it can be
implemented and evaluated without changing today's note semantics.

#### Proposed signal contract

The detector remains observe-and-publish. It must never write the Deck/Mixer
palette directly.

| Proposed key | Type | Meaning |
|---|---|---|
| `audioChordRoot` | enum `0..11` | chord root, using the same C=0 pitch-class convention as `audioNote` |
| `audioChordQuality` | enum | `0=unknown`, `1=major`, `2=minor`; later qualities require an explicit schema revision |
| `audioChordConf` | continuous `0..1` | confidence in the combined root + quality decision, not merely signal level |
| `audioChordHue1` | hue `0..1` | root color from the operator's 12-note wheel |
| `audioChordHue2` | hue `0..1` | quality-defining companion color from the same wheel |
| `audioChordChange` | one-hop event | a new confident chord was committed |
| `audioChordChangeSeq` | monotonic counter | reliable transport for automation that cannot miss a one-hop change |

When confidence falls below the validity threshold, quality becomes `unknown`,
confidence falls honestly, no change event fires, and the last committed chord
palette holds. The detector must abstain rather than confidently inventing a
major or minor chord from drums, noise, or a single bass note.

#### Wheel-derived color-pair rule

The supplied circle-of-fifths image remains the artistic source. The one stored
source of truth is still `derivedSignals.noteColors`: twelve editable hues with
full-saturation/full-value previews and one `RESET ALL`. Chord pairs are
**derived** from those twelve hues; they are not 24 duplicated palette records.
Changing one note hue therefore updates every chord pair that uses that note,
and `RESET ALL` restores the entire note and chord system atomically.

For a confident chord:

- `color 1` = the chord root's wheel hue;
- major `color 2` = the major third, `root + 4 semitones`;
- minor `color 2` = the minor third, `root + 3 semitones`;
- unknown/power-chord preview = the perfect fifth, `root + 7 semitones`, but it
  is advisory only and must not auto-apply while quality is unknown;
- saturation and value are always `1.0` when the pair is applied. Only hue comes
  from this system.

This makes quality visible: C major is yellow + blue (C + E), while C minor is
yellow + orange-red (C + E-flat). Both colors are exact members of the supplied
wheel rather than interpolated or newly invented hues.

| Root | Root color | Major companion | Minor companion | Unknown preview fifth |
|---|---|---|---|---|
| C | yellow | E · blue | E-flat · orange-red | G · green |
| C-sharp / D-flat | rose | F · amber | E · blue | A-flat · red |
| D | green-cyan | F-sharp · magenta | F · amber | A · cyan-blue |
| D-sharp / E-flat | orange-red | G · green | F-sharp · magenta | B-flat · orange |
| E | blue | A-flat · red | G · green | B · violet |
| F | amber | A · cyan-blue | A-flat · red | C · yellow |
| F-sharp / G-flat | magenta | B-flat · orange | A · cyan-blue | D-flat · rose |
| G | green | B · violet | B-flat · orange | D · green-cyan |
| G-sharp / A-flat | red | C · yellow | B · violet | E-flat · orange-red |
| A | cyan-blue | D-flat · rose | C · yellow | E · blue |
| A-sharp / B-flat | orange | D · green-cyan | D-flat · rose | F · amber |
| B | violet | E-flat · orange-red | D · green-cyan | F-sharp · magenta |

#### Detection pipeline

The first implementation should deliberately support only `major`, `minor`,
and `unknown`. Dance music commonly adds sevenths, ninths, suspensions, and
inversions; v1 should identify the underlying major/minor triad when evidence is
strong and abstain otherwise, not produce a large unvalidated chord vocabulary.

1. Expose the analyzer's normalized 12-bin chroma evidence as internal raw
   diagnostics (`micChromaC...Raw`). Keep these internal by default; do not add
   12 ordinary pattern sources or OSC outputs merely because they exist.
2. Score rotated major and minor templates against normalized chroma. Reward
   root/third/fifth energy, penalize strong non-chord energy, and use the
   dominant bass note only as a weak root prior so inversions remain possible.
3. Derive confidence from absolute template fit, best-versus-runner-up margin,
   tonal stability, and input activity. Do not define confidence as “locked.”
4. Smooth candidate evidence over musical time. At house tempos, chords often
   hold for 1–4 beats. A candidate should normally commit within one beat, while
   ambiguous or contradictory evidence holds the previous chord. Use a bounded
   millisecond window when BPM is unlocked and a beat-relative window only when
   BPM is genuinely locked.
5. Emit `audioChordChange` and increment `audioChordChangeSeq` exactly once when
   a different root or quality commits. Silence, low confidence, and repeated
   frames of the same chord do not create events.

Detector thresholds and timing belong in
`audio.derivedSignals.chordTracking`. The artistic hue source remains
`audio.derivedSignals.noteColors`. That separation prevents DSP tuning from
silently rewriting the operator's color language.

#### Deck and Mixer ownership

`colorPalette1` and `colorPalette2` are the existing authoritative global HSV
pair consumed by patterns and shown in Deck/Mixer; there must not be separate
audio-only copies that drift from them. Chord signals describe a desired pair.
An explicitly enabled audio-reactive color owner applies it.

- Add an opt-in `chord_pair` mode to the audio-reactive color profile. The
  current nearest-curated-palette mode remains a separate behavior; the two
  modes never run concurrently.
- On a valid `audioChordChangeSeq`, after the profile's dwell, confidence, party,
  silence, and operator-lease gates pass, atomically write both global HSV
  values: `{h: audioChordHue1, s: 1, v: 1}` and
  `{h: audioChordHue2, s: 1, v: 1}`.
- Route the write through the existing palette application/transition path so
  Deck and Mixer receive the same authoritative broadcast and patterns use the
  existing color slew. Never mutate the checked-in `colorPalettes` catalog to
  represent a transient chord.
- A manual operator color action, show-plan look, or stronger color owner wins.
  Audio must pause for the existing owner/lease period instead of fighting the
  operator. Disabling chord color leaves the last rendered pair in place to
  avoid a blackout or surprise jump; it simply stops future audio writes.
- Pattern source remains audio-agnostic. Patterns consume
  `colorPalette1/2`; they do not implement chord tables or read chord enums.

The Derived Tune page should show a chromagram, root, quality, confidence, the
two bright swatches, and the expected/committed state. It may tune detection
thresholds, but `NOTES → COLORS` remains the only hue editor. No per-chord color
editor is needed because it would duplicate and eventually contradict the
wheel.

#### Acceptance gates before this becomes production

Use the same real analyzer, virtual-mic model, stateful chord smoother, and
palette application path that production uses.

1. All 24 major/minor triads, multiple octaves and inversions, at five fixed
   seeds per mic tier. Clean root+quality accuracy at least 98%; moderate
   (18 dB SNR) at least 90%, with root accuracy at least 95%.
2. Joined house progressions at 120, 124, and 128 BPM with 1-, 2-, and 4-beat
   chords. For two- and four-beat chords: change precision at least 98%, recall
   at least 95%, zero duplicate events, and p95 commit latency below one beat.
   One-beat results must be reported separately rather than hidden in an
   aggregate.
3. Heavy noise may produce `unknown`; confidently wrong root+quality decisions
   must stay below 5%. Abstention is preferable to a false palette.
4. Negative cases: single notes, power chords, drums, risers, white noise,
   silence, and chromatic sweeps must not be mislabeled as confident major/minor
   chords or emit a chord-change sequence.
5. Mapping tests must prove all 24 pairs derive from the live 12-note map,
   remain at saturation/value `1.0`, update after one note edit, and return
   exactly to the supplied wheel after `RESET ALL`.
6. Ownership tests must prove an operator palette action suppresses audio,
   Deck/Mixer show one identical authoritative pair, both colors change in one
   transaction, and disabling the feature stops writes without changing the
   detector.

Until those gates pass and the proposed keys appear in `audio_signals.js`, the
program optimizer must continue using `audioNoteHue` as single-note harmonic
color and must not claim chord-aware palettes.

### 3.5 Tempo, beat, bar, and phrase

| Key | Range / rate | Meaning | Good uses | Honesty rule |
|---|---|---|---|---|
| `audioBpm` | `0..300 BPM`, 5 Hz | analyzer's published tempo | readout, rate selection | no public lock/confidence key exists in this registry; do not invent one |
| `tempoBpm` | `0..300 BPM`, 5 Hz | general `/lx/tempo/bpm` reference | external-tempo compatibility | may be absent or stale if no external tempo source feeds it |
| `audioBeat` | pulse `0..1`, 30 Hz | phase-locked beat envelope | rhythmic expansion or punch | one beat may span several render frames |
| `audioBeatInBar` | integer `1..4` when valid, 30 Hz | estimated beat number in 4/4 | diagnostics / discrete accents | absolute “beat 1” can be off |
| `audioBarPhase` | `0..1`, 30 Hz | continuous position through the bar | smooth 4-beat travel, rotation, wipe | best continuous tempo source for motion |
| `audioDownbeat` | pulse `0..1`, 30 Hz | estimated start of a bar | once-per-bar hit | phase-coherent estimate, not DJ-deck ground truth |
| `audioDownbeatSeq` | counter `0..2147483647`, 5 Hz | increments once per downbeat | optimizer/controller event cursor | do not map the counter directly to a visual slider |
| `audioPhrasePhase` | `0..1`, 15 Hz | position through the current 8-bar phrase | slow structural travel | meaningful only with BPM lock and active music |
| `audioPhraseBoundary` | event pulse `0/1`, 15 Hz | new phrase or drop re-anchor | palette/pattern punctuation | relative phrase grid; absolute alignment is unknowable from audio alone |
| `audioPhraseBoundarySeq` | counter `0..2147483647`, 5 Hz | increments once per phrase-boundary event | optimizer/controller event cursor | do not map the counter directly to a visual slider |

Use `audioBarPhase` for continuous movement. Use `audioBeat` or
`audioDownbeat` for accents. Driving speed directly from `audioBpm` is often
less stable and less expressive than advancing motion from phase.

### 3.6 Structure, builds, drops, and track state

| Key | Range / rate | Meaning | Consumer behavior |
|---|---|---|---|
| `audioStructure` | enum `0..2`, 10 Hz | `0=THIN`, `1=BUILD`, `2=SUSTAIN` | choose a section behavior; do not treat as ordinary brightness |
| `audioDropPulse` | pulse `0..1`, 15 Hz | precision-first detected drop | one strong accent or transition request |
| `audioRiserConf` | `0..1`, 10 Hz | confidence in riser/ETA evidence | gate anticipation behavior |
| `audioBuildEta` | `0..60 seconds`, 10 Hz | best-effort time to predicted drop | readout / advanced anticipation; `0` means no honest estimate |
| `audioDropCountdown` | decaying beat pulse `0..1`, 30 Hz | late-build count-in beats | flash/tighten on final build beats |
| `audioSilence` | gate `0/1`, 5 Hz | debounced quiet gap | enter a deliberate calm/safe state |
| `audioTrackChange` | one-hop event `0/1`, 15 Hz | silence→music re-onset or BPM relock at a new tempo | request a fresh look or palette |
| `audioTrackChangeSeq` | counter `0..2147483647`, 5 Hz | increments once per track-change event | reliable optimizer/controller event consumption |

The drop detector is intentionally precision-first: a false drop is more
damaging than a missed one. A pattern should still look coherent when no
`audioDropPulse` arrives. Always gate a nonzero `audioBuildEta` with adequate
`audioRiserConf`.

### 3.7 Party, intent, and advisory classification

| Key | Kind | Meaning | Correct role |
|---|---|---|---|
| `audioParty` | held gate `0/1` | loud full-band music is present | reversible party/calm visual behavior; can false-trigger on room mid/high noise |
| `audioSwitchPattern` | event pulse `0/1` | musically sensible moment to change geometry/animation | director or momentary pattern trigger |
| `audioSwitchPatternSeq` | counter `0..2147483647` | increments once per pattern-switch event | reliable optimizer/controller event consumption |
| `audioSwitchColor` | event pulse `0/1` | musically sensible moment to change palette | palette transition request |
| `audioSwitchColorSeq` | counter `0..2147483647` | increments once per color-switch event | reliable optimizer/controller event consumption |
| `audioGenre` | enum `0..6` | `ambient`, `deep_house`, `melodic_house`, `tech_house`, `techno`, `melodic_techno`, `downtempo` | advisory readout / soft bias |
| `audioGenreConf` | `0..1` | confidence in `audioGenre` | required validity gate for genre use |

`audioParty` is a held, debounced state—not an event. If a controller wants to
start something once when party mode begins, it must act on the `0 → 1` edge
and apply its own dwell/cooldown policy. It must not repeat the action every
frame while the key remains `1`. This gate is based on weighted band loudness;
it is suitable for reversible visual behavior, not irreversible automation.

Use `audioGenre` only as a soft aesthetic bias, and only when
`audioGenreConf` is adequate and music is active. Do not use inferred genre for
blackout, hardware, deployment, irreversible, or safety-critical decisions.

### 3.8 Raw and operator-only keys

The following keys exist for analysis, calibration, and debugging. They are
technically visible in CPC, but they are not the first choice for authored
looks:

- pre-processing mirrors: `micLowRaw`, `micMidRaw`, `micHighRaw`,
  `micKickRaw`, `micFluxRaw`;
- raw onset/sub inputs: `micOnsetLowRaw`, `micOnsetMidRaw`,
  `micOnsetHighRaw`, `micSubRaw`;
- raw chroma features: `micTonalStabilityRaw`, `micChromaFluxRaw`,
  `micChromaTiltRaw`;
- persistent operator levels: `micLowGain`, `micMidGain`, `micHighGain`,
  `micKickGain`, `micFluxGain`.

The `*Raw` keys bypass some or all of the shaping that makes signals visually
usable. Use them for diagnostics, detector development, or a deliberately
custom shaper—not as an optimizer's automatic default. The `*Gain` keys are
operator controls, not musical sources; never map a pattern to them.

---

## 4. State, pulse, phase, and confidence are different data types

The registry stores numeric values, but their temporal meanings are different.
An optimizer must classify the signal before assigning it.

| Semantic kind | Examples | Correct consumption |
|---|---|---|
| continuous level | `micLow`, `micFlux`, `audioRiserScore`, `audioClimax` | continuous modulation with a useful curve/range |
| phase | `audioBarPhase`, `audioPhrasePhase` | position or motion phase; handle wrap from near 1 to 0 |
| held gate/state | `audioParty`, `audioSilence` | change reversible behavior while held; rising-edge for a one-time request |
| enum/readout | `audioStructure`, `audioBeatInBar`, `audioGenre`, `audioNote` | discrete logic or display; avoid blind brightness mapping |
| pulse/envelope | `micKick`, `audioBeat`, `audioDropPulse`, `micOnset*`, `audioChestHit`, `audioDropCountdown` | momentary response; re-arm below a low threshold |
| one-hop event | `audioTrackChange`, `audioPhraseBoundary`, `audioSwitchPattern`, `audioSwitchColor` | director/event logic; do not treat as a sustained level |
| event counter | the matching five `*Seq` keys | compare with the last consumed value; each increment represents one event |
| confidence | `audioRiserConf`, `audioGenreConf` | validity gate or crossfade, not the visual idea itself |

### 4.1 Edge discipline inside a pattern

A pulse can remain high for more than one render frame. If a slider launches a
one-shot animation, edge-detect and re-arm it:

```javascript
export var dropTrigger = 0.0;
var dropArmed = 1.0;
var dropFire = 0.0;

export function sliderDropTrigger(v) {
  dropTrigger = v;
  if (dropArmed > 0.5 && v >= 0.6) {
    dropFire = 1.0;
    dropArmed = 0.0;
  }
  if (v <= 0.2) dropArmed = 1.0;
}
```

Consume `dropFire` once in `beforeRender`, then clear it. The separate fire and
re-arm thresholds prevent repeated triggers and boundary chatter.

One-hop event keys are suitable for momentary visual modulation. For optimizer
or controller logic that must not miss an event, use the matching monotonic
counter: `audioSwitchPatternSeq`, `audioSwitchColorSeq`, `audioDownbeatSeq`,
`audioTrackChangeSeq`, or `audioPhraseBoundarySeq`. Store the last consumed
counter and act once for each new value. Do not map a `*Seq` value directly to a
pattern slider: its registry range is intentionally huge and its meaning is an
event cursor, not intensity. Irreversible show-control actions still belong in
the director/event layer, where dwell, cooldown, logging, and authority are
explicit.

---

## 5. Wiring a pattern

### 5.1 Expose truthful, silence-safe handles

```javascript
export var level = 0.65;
export var sparkle = 0.25;
export var kick = 0.0;

export function sliderLevel(v) { level = v; }
export function sliderSparkle(v) { sparkle = v; }
export function sliderKick(v) { kick = v; }
```

At those defaults, the look must already be readable with no audio.

### 5.2 Map CPC signals on the playlist entry

```yaml
modulations:
  - id: mod_sliderLevel_micLow
    type: continuous
    enabled: true
    source: { scope: cpc, key: micLow }
    target: { scope: pattern, parameter: sliderLevel }
    mode: override
    polarity: unipolar
    range: [0.30, 0.95]
    curve: linear

  - id: mod_sliderKick_micKick
    type: continuous
    enabled: true
    source: { scope: cpc, key: micKick }
    target: { scope: pattern, parameter: sliderKick }
    mode: override
    polarity: unipolar
    range: [0.00, 1.00]
    curve: easeIn
```

Modes operate in normalized slider space:

- `override`: signal directly drives the mapped range;
- `offset`: signal adds to the static slider value;
- `multiply`: signal scales the static slider value.

Curves shape the signal first: `linear` is direct; `easeIn` suppresses small
noise and emphasizes strong values; `easeOut` exposes low-level detail; `exp`
strongly reserves the response for peaks.

### 5.3 Declare the basic offline mapping

Patterns supported by the gallery/audio harness carry a strict header block:

```text
AUDIO_MODULATION_V1:
  sliderLevel   <- micLow  range 0.30..0.95 curve linear  # PRIMARY brightness
  sliderSparkle <- micHigh range 0.10..0.80 curve ease    # high-band detail
  sliderKick    <- micKick range 0.00..1.00 curve pow2    # beat punch
```

The current `AUDIO_MODULATION_V1` parser accepts the five basic sources
`micLow`, `micMid`, `micHigh`, `micKick`, and `micFlux`. Richer derived signals
are valid playlist modulation sources but must be exercised with
`tools/pattern_derived_harness.mjs`; do not put an unsupported key in this
header and expect tooling to ignore it. It fails loudly by design.

---

## 6. Rules for a program-optimizer agent

When an agent optimizes or generates audio mappings, follow this order:

1. **Understand the visual handle first.** Name what the slider changes:
   brightness, width, speed, density, position, palette mix, or trigger.
2. **Choose the matching semantic kind.** Level→continuous level,
   position→phase, one-shot→pulse, session mode→gate.
3. **Keep one primary source per target.** The runtime allows only one
   continuous mapping per target; duplicates beyond the first are ignored.
4. **Use shaped outputs before raw mirrors.** Prefer `micLow` over
   `micLowRaw`, `micOnsetHigh` over its raw input, and `audioNoteHue` over raw
   dominant Hertz.
5. **Pair estimates with available confidence.** Build ETA needs riser
   confidence; genre needs genre confidence and active music. This registry
   does not publish BPM lock/confidence, so do not fabricate that evidence.
6. **Treat party correctly.** `audioParty` is held state for reversible visual
   behavior. Edge-detect it for a one-time request and never use it alone for
   an irreversible automation.
7. **Treat pulses correctly.** A pulse controls a momentary slider or an
   edge-detected trigger. A held sample is not a new event every frame.
8. **Never make silence equal failure.** Static defaults render a deliberate,
   visible resting look when the source is zero or the Companion is offline.
9. **Prefer perceptible ranges over full ranges.** Technically moving a slider
   with no visible result is a failed mapping.
10. **Do not assign every available signal.** Fewer independent, legible
    relationships make a stronger musical picture.

Recommended first pass:

| Control intent | Candidate source | Typical mapping |
|---|---|---|
| overall level / body | `micLow` or `micMid` | `override`, `0.3..1.0`, linear |
| kick / punch / expansion | `micKick` or `audioChestHit` | `override`, `0..1`, easeIn/exp |
| sparkle / fine detail | `micHigh` | `override` or positive `offset`, easeOut |
| complexity / agitation | `micFlux` | moderate range, linear |
| build charge | `audioRiserScore` | moderate range; gate large changes on confidence |
| bar travel | `audioBarPhase` | `override`, `0..1`, linear |
| harmonic palette position | `audioNoteHue` | `override`, `0..1`; slew palette changes |
| big-look hold | `audioClimax` | level/coverage boost with slow attack/release |
| one-shot drop gesture | `audioDropPulse` | trigger slider plus edge/re-arm logic |

---

## 7. Microphone calibration, in plain language

Calibration has two existing steps. This guide does not change them:

1. **Set input gain with typical loud music playing.** The five-second gain
   calibration measures the loudest analyzed band and recommends a software
   preamp that puts that peak near `0.70`. A measured peak from `0.40..0.95` is
   reported as healthy.
2. **Set the noise floor at the normal quiet baseline.** With the gain already
   set and no nearby loud source, the four-second floor calibration measures
   each band's 90th-percentile ambient level. It recommends a low, mid, and
   high gate at that value, never below the global gate.

Gain comes first because it changes every measured level. If input gain changes
substantially later, repeat the noise-floor calibration. This is the existing
MIC TUNE process; the explanation here only makes its meaning explicit.

### 7.1 Gain is not a floor

`INPUT GAIN` is the software microphone preamp applied to the PCM before FFT
analysis. `×1.0` is unity, `×5.0` multiplies every captured sample by five, and
`×0.0` mutes the analysis input. It affects low, mid, high, kick, flux, dominant
frequency, and all derived signals.

The persistent `micLowGain`, `micMidGain`, `micHighGain`, `micKickGain`, and
`micFluxGain` controls are later signal-shaping trims. They are not substitutes
for microphone input calibration.

### 7.2 “Floor” has three separate meanings

| Layer | Current rule | What it does |
|---|---|---|
| analyzer band gate | global gate, optionally overridden per low/mid/high band | a band at or below its effective gate reads as zero |
| `audioSilence` detector | weighted level `< 0.10` for `450 ms`; music returns at `≥ 0.20` | declares a debounced quiet gap without chattering |
| `audioParty` gate | weighted loudness turns on at `≥ 0.22`; turns off below `0.12` after confirmation | declares held loud-music state, not literal digital silence |

The weighted level for `audioSilence` is:

```text
0.4 × low + 0.4 × mid + 0.2 × high
```

It is smoothed with a `0.35 s` time constant before the thresholds apply. The
gap must remain below `0.10` for `450 ms` before `audioSilence` becomes `1`.
The separate `0.20` return threshold is hysteresis: once music comes back, the
state clears cleanly instead of fluttering near one threshold.

`audioParty` uses the same band weights but its own `0.4 s` smoothing, startup
guard, hold, and thresholds. It turns on at `0.22`; while on, it requires
sustained loudness below `0.12` before turning off. Therefore
`audioSilence = 0` does **not** imply `audioParty = 1`: the middle region is
intentional.

The BPM tracker's `activityThreshold: 0.05` is a fourth internal activity
threshold, not the definition of `audioSilence`. In the current configuration,
its silence-reset behavior is disabled.

### 7.3 Reading the MIC TUNE page

- The filled bar is the current band level.
- The vertical gate line is that band's effective floor.
- A numeric per-band value overrides the global gate.
- The reset-arrow clears the override, so the band inherits `GLOBAL GATE`.
- `Apply` changes the live analyzer now.
- `Save to <profile>` persists the values into the selected calibration
  profile. The selected profile name and unsaved live values can differ.

At the time this reference was written, the isolated test session reported:

| Live setting | Value |
|---|---:|
| input gain | `×5.02` |
| global gate | `0.060` |
| low gate | `0.120` |
| mid gate | `0.100` |
| high gate | `0.140` |

Those are a live test-session snapshot, not universal production defaults. The
checked-in boot defaults remain input gain `×1.0`, global gate `0.040`, with
bands inheriting the global gate unless a profile or live override supplies
per-band values.

The test session currently labels `Quiet room` as selected, but its saved
profile still contains `×1.0` and the `0.040` global gate. The live `×5.02` and
per-band gates above are therefore unsaved live tuning, not the stored
`Quiet room` profile. That distinction matters when restarting.

### 7.4 Reading the DERIVED TUNE page

`DERIVED TUNE` changes what the cleaned analyzer values *mean*. It does not
change microphone gain, the per-band noise floors, or either calibration
procedure. Its live meters show the detector's own smoothed loudness beside
the active OFF and ON thresholds, so an operator can see why a state is calm,
party, silent, or music.

The page groups controls by temporal contract:

- **STATE:** silence/track-change and party detection. These are held decisions
  with hysteresis and confirmation time, not one-hop triggers.
- **CONTINUOUS:** published BPM slew. It limits how quickly the BPM sent to
  patterns moves; the tracker's exact BPM estimate is unchanged.
- **EVENT:** pattern/color switches, band onsets, chest hit, phrase boundary,
  and drop countdown. Threshold edits reset only the touched detector's
  history; unrelated derived signals keep running.

The checked-in values live under `audio.derivedSignals` in
`marsin_engine/config.yaml`. Edits are validated as a complete candidate before
they apply: unknown fields, non-finite values, and invalid pairs such as
`offThresh >= onThresh` fail loudly and leave the previous configuration
intact. When the page says **mirrored to engine**, accepted edits use the shared
engine audio-config path and persist with the scene. When it says **local only
(engine offline)**, they affect only the running Companion and are intentionally
not presented as persisted state.

---

## 8. Tuning and verification

For every authored mapping, verify:

1. **Static:** silence or an absent source still produces an intentional look.
2. **Low/high:** the whole mapped range is perceptible, bounded, and truthful.
3. **Step:** discontinuities appear only on controls explicitly meant to punch.
4. **Hold:** a gate or envelope held high does not fire repeatedly.
5. **Release:** the look returns cleanly and does not leave stale state.
6. **Confidence loss:** BPM/riser/genre consumers return to their honest idle.
7. **Silence transition:** no phantom beat, phrase, drop, or party action.
8. **Noisy input:** wind/room noise does not become a convincing false cue.
9. **Real music:** test a calm passage, steady groove, build/drop, and gap or
   track transition.

Offline tools:

```bash
cd marsin_engine

# Basic micLow/mid/high/kick/flux mappings from AUDIO_MODULATION_V1.
node tools/pattern_audio_harness.mjs --pattern <pattern> --model titanic

# Structure, tempo, party, phrase, and event signals.
node tools/pattern_derived_harness.mjs --pattern <pattern> --model titanic
```

Use deterministic synth/file sources before microphone tuning. The microphone
is the final room-and-placement validation, not the only test fixture.

---

## 9. Related references

- [`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md) §8 — the
  modulators-only hard contract.
- [`37_marsin_audio_framework.md`](37_marsin_audio_framework.md) — Companion,
  OSC, CPC, and UI architecture.
- [`41_audio_reactive_tuning.md`](41_audio_reactive_tuning.md) — tuning and
  offline injection workflow.
- [`26_audio_params_playlist.md`](26_audio_params_playlist.md) — playlist
  modulation schema and runtime math.
- [`audio_signals.js`](../marsin_engine/audio/postproc/audio_signals.js) — exact
  live registry; authoritative when a key or range changes.
- [`highdef_pattern_generation.md`](../.agent/skills/highdef_pattern_generation.md)
  §7 — agent authoring procedure and `AUDIO_MODULATION_V1` format.
