# _184 — Audio suggestion metadata + the FLUX fix

**Date:** 2026-08-06 · **Agent:** _184 (Opus, primary implementer)
**Branch:** `feat/bm_readiness` (post `9e8b23b8`) · **No git operations.**
**Map:** `.agent/reports/202608/20260806_183_audio_meta_recon.md` (trusted,
spot-verified — every claim I built on was re-probed offline before use).

Three things landed, in this order: the FLUX producer fix (independent, and
the one with show impact), the audio-suggestion metadata contract end to end
(parser → engine → CaptainPad), and the `13_sparkle` pilot rename with its
saved-work migration.

**All verification was offline / in-process.** No live process was started or
touched; nothing bound an operator port (6966-6972, 5568, 8081, 10000); no
live engine or Companion API was called. The two engine E2E suites I touched
spawn their own throwaway engines on high random ports with temp state and
playlist dirs and black-holed sACN.

---

## 1 · FLUX — root cause, fix, proof

### Verdict

`_183` was right and I re-confirmed it offline before changing anything: **the
Audio Companion never published `micFlux`.** The engine side was complete —
`micFlux` is a first-class CPC key bound to `/marsin/mic/flux` — but nothing
ever sent on that address, so the key sat at its default `0`.

That is worse than a dead meter. `applyModulations` skips a mapping only when
its source key is **absent** from the CPC frame. `micFlux` was **present at
zero**, so every `micFlux` mapping was applied every frame with signal 0, and
in `override` mode that pins the target parameter at `range[0]` and ignores
the operator's slider. 32 patterns declare `<- micFlux`; 11 saved playlist
modulations bind it.

I pinned that failure mode as behaviour rather than prose (test #12 below):
absent source → parameter untouched; present-at-zero → parameter pinned at
`range[0]`; real value → the intended sweep.

### What was actually broken, and what I changed

Three defects, all of them the same shape — a hand-typed list that had drifted
from the authoritative registry:

**(a) `CURATED_OUTPUTS` omitted `micFlux`.**
`marsin_engine/audio/companion/companion_config.js`. This map lets a designed
signal keep its canonical engine-bound address; its own comment claimed it
"mirrors `audio_signals.js` oscAddress fields", and it did not. An operator who
added a FLUX signal and named it `micFlux` got a *new dynamic key* `micflux`
on `/marsin/audio/micflux` — a key no pattern or playlist references.

Fixed by **deriving the map** from `audioSignalDescriptors()` (every descriptor
publishing on `/marsin/mic/*` or `/marsin/dom/*` — the two namespaces a
designed companion signal can occupy). That divergence was the bug class, so
the fix is that the divergence is no longer expressible.

I also added the invariant whose violation hid the gap, as an **import-time**
two-way parity guard: every designable `RAW_SOURCES` entry must have a curated
output, and every curated output must be reachable from a raw source. Adding a
sixth mic band is now a one-line descriptor edit plus one raw-source line, and
forgetting either half crashes the Companion at boot instead of quietly
orphaning the band.

**(b) No flux signal in either design.**
`defaultCompanionConfig()` and the persisted `companion_config.yaml` both went
low/mid/high/kick → dom. Added `intensity('flux', 'micFlux', 'rawFlux', 22.0)`
in family order, and the matching persisted entry.

*Cutoff choice:* 22 Hz, deliberately **above** kick's 18 Hz. Spectral flux is a
transient rise measure, not a band energy — smoothing it harder than the kick
rounds off the very edges it exists to report. I did not copy a band value.
This is the one number in the fix that wants an ear on a real track; it is a
single field in the YAML and safe for the operator to retune.

**(c) `gainByKeyForOsc()` deliberately excluded `micFlux` — decided: wire it.**
`marsin_engine/audio/postproc/audio_signals.js`. The old comment said flux's
"gain is applied in the analyzer, not the OSC path". That was true when the
engine ran its own analyzer; under the 2026-06-21 sole-analyzer contract it is
simply stale, and the exclusion left **three** things dead:

- `micFluxGain` — persisted, OSC-bound, and applied nowhere;
- the `micFlux` post-processing chain (Gain + smoothing LPF), which exists in
  `DEFAULT_CHAINS` and never ran on the OSC path;
- `micFluxRaw` — the pre-gain mirror **`audio_structure_detector.js` reads as
  its build-score flux input** (`audio_structure_detector.js:488`). It was
  pinned at 0, so the structure detector's flux term was dead too.

`gainByKeyForOsc()` now derives from `processedSignalKeys()` (no hand-listed
order at all), so `micFlux` joins on the same terms as every other band. The
registry test that pinned the old four-key map is updated with the reasoning
in-line, and now also asserts the map's keys **equal** `processedSignalKeys()`.

### Proof (offline, in-process, no sockets)

`marsin_engine/tests/companion/companion_flux_output.test.js` — 9 tests:

- `CURATED_OUTPUTS` equals the descriptors it claims to mirror, and carries
  `micFlux → /marsin/mic/flux`;
- `resolveOscOut('micFlux')` returns the canonical key + address, and
  explicitly **not** the pre-fix `micflux` slug;
- both the built-in default design and the persisted YAML publish it;
- `GAIN_BY_KEY.micFlux === 'micFluxGain'` and the raw mirror is live;
- **the full chain:** an injected `/marsin/mic/flux` stream → `OscListener`
  dispatch → post-chain (gain + LPF) → `ParamCenter.micFlux` →
  `applyModulations` → a bound pattern parameter lifts off `range[0]`. The
  listener is constructed but **never started** — the constructor binds nothing
  and `_dispatchMessage` is driven directly, so no port is touched. (The signal
  has to be *streamed*, not poked once: the post-chain ends in a 4.5 Hz LPF
  whose dt comes from wall-clock packet spacing, so a single dt=0 dispatch can
  never move it — exactly like the real wire.)
- `micFluxGain` at 0 mutes the post value while `micFluxRaw` still carries the
  analyzer's value — proving the knob is live and the detector's raw read is
  independent of it.

### THE OPERATOR ACTION — what is needed to get FLUX live

`companion_config.yaml` is **tracked config**, not live runtime state — I
verified it with `git ls-files` (tracked, and clean in the working tree), and
it still carries its hand-written comments, which `saveCompanionConfig`'s
`yaml.dump` would have stripped had the UI ever exported over it. So the
mission's open question resolves to *tracked* → I edited it directly.

**Restart the Audio Companion.** That is the whole action. The design is read
once at boot (`loadCompanionConfig()` at `companion_server.js:174`), so a
Companion that is currently running is still on the old flux-less design no
matter what the file says. After the restart, FLUX should move on the AUDIO
tab and every `micFlux` modulation in the show comes alive at once — **check
the sound-reactive playlists on a low master first**, because 11 saved
mappings that have been effectively frozen at `range[0]` will start moving.

There is no silent merge and no fallback anywhere in this path. If the
operator ever re-exports a config from the Companion UI that drops a curated
signal, the boot path now **says so, by name**:

```
⚠ COMPANION DESIGN INCOMPLETE — these engine-bound signals are NOT published:
    micFlux  →  /marsin/mic/flux
  The engine will hold each at 0. A modulation bound to one in OVERRIDE mode
  will PIN its parameter at the low end of its range and ignore the slider.
  Fix: add the signal in the designer, or remove <path>/companion_config.yaml
  to fall back to the built-in default design, then restart the Companion.
```

That is a report, not a repair — `missingCuratedOutputs(cfg)` is a pure
function, the config is never modified, and boot is not blocked (refusing to
start the analyzer over a missing band would be a worse show outcome than a
named warning plus a dead band).

---

## 2 · Audio-suggestion metadata

### The canonical source, and the version decision

The `AUDIO_MODULATION_V1` header block, parsed by the one parser
`marsin_engine/tools/audio_mod_spec.mjs`. **The block tag stays V1.**

The mission allowed a version bump "ONLY if the shape actually changes
incompatibly". It does not. The grammar already carried everything the feature
needs:

```
slider<Name> <- mic<Sig> range <a>..<b> curve <linear|pow2|ease>  # note
```

`range` and `curve` were always there. The `# note` — the "short explanation"
— was **parsed and then thrown away one line before the return**, kept only
for the synth heuristic. Nothing about the syntax changed; every existing
header parses byte-identically. A bump would have been a lie, and would have
forced 62 patterns to be touched for nothing.

What did change in the parser's *output*: `note` now rides the public contract,
and the result carries an explicit `version` so downstream validation asserts
what it is reading instead of assuming.

### The stamped schema

`audioSuggestionsBySlider(spec)` returns a map keyed by the **runtime parameter
name** (the slider export name — which is already identical to
`ModulationMapping.target.parameter`, so no lookup table exists anywhere):

```js
sliderStarCount: {
  version: 'AUDIO_MODULATION_V1',
  signal: 'micFlux',            // enum-checked against the registry
  range: [0.12, 0.86],
  curve: 'ease',                // the token the header declared
  modulationCurve: 'easeOut',   // the SAME curve in the engine's vocabulary
  note: 'build reveals more stars',   // OMITTED when the header had none
}
```

`modulationCurve` is the one addition I made beyond the brief, and it is there
specifically to *avoid* creating another of the hand-copied tables this whole
wave is about. The block speaks `linear|pow2|ease`; the modulation engine
speaks `linear|easeIn|easeOut|exp`. They are the same three functions
(`pow2 = x² = easeIn`, `ease = 1-(1-x)² = easeOut`) — a correspondence the
operator's saved `13_sparkle` mappings already used by hand. Publishing the
translation once from `MODULATION_CURVE_BY_BLOCK_CURVE` means CaptainPad
prefills a mapping without owning a private copy. A test pins the targets
against `MODULATION_VALID_CURVES` and asserts every accepted block token has an
engine equivalent.

**`note` absent means absent.** No empty-string placeholder, nothing inferred.

### Folding the duplicate signal lists into the registry

`audio_signals.js` gains one derivation, `micSignalShortNames()` — `{ micLow:
'low', … micFlux: 'flux' }`, built from each processed descriptor's OSC address
(the last segment *is* the analyzer/synth field name). Three former hand-typed
lists now come from it:

| Was | Now |
|---|---|
| `audio_mod_spec.mjs` `VALID_SIGNALS` — a hand-typed 5-element Set, and the **only** thing in the repo that rejects an unknown signal name | `new Set(Object.keys(micSignalShortNames()))` |
| `pattern_audio_harness.mjs` `SIG_FIELD` — hand-typed signal→synth-field map | `micSignalShortNames()` |
| `companion_config.js` `CURATED_OUTPUTS` — hand-typed, and the site of the FLUX bug | derived from `audioSignalDescriptors()` |
| `gainByKeyForOsc()` order list — hand-typed, omitted micFlux | derived from `processedSignalKeys()` |

`audio_mod_spec.mjs` stays dependency-free and I/O-free (the gallery generator
and both harnesses import it directly): the new import is a sibling **pure**
module, no packages and no disk.

Unknown signal names fail loudly with the pattern name, the bad token, and the
valid list. I extended that posture: **every** parser throw now names the
pattern (`parseAudioModSpec[13_sparkle]: …`) because the engine parses
arbitrary patterns now and "malformed mapping line" with no name is
unactionable on a rig at night. I also added a **duplicate-slider refusal** —
two header lines claiming one parameter cannot both be honoured (the engine
enforces one modulation per target), and a Map-keyed consumer would have
silently let the second win.

### The engine seam

Exactly the `codeDefault` precedent the recon identified, no new endpoints:

- `audioSuggestionsForPattern(patternName)` sits beside
  `codeDefaultsForPattern` in `api_server.js` with the same per-pattern `Map`
  cache and the same hint-only invalidation posture;
- `annotateCodeDefaults(channel, exportsArr)` now stamps `e.audioSuggestion`
  alongside `e.codeDefault` for kind-1 exports, so it reaches `/deck`,
  `/mixer` **and** the legacy `/exports` payload for free.

**On loudness vs. the rig staying lit.** A malformed header throws out of the
parser. I catch it in `audioSuggestionsForPattern`, log
`[AudioSuggest] REFUSED "<pattern>": <message>` at **error** level, and serve
no suggestions for that pattern. Letting it escape would 500 the hot
`/mixer`+`/deck` broadcast path and take the operator's control surface — and
the exterior lighting it drives — down over a comment typo. The **hard gate**
therefore lives in the test suite: `tests/tools/audio_mod_spec.test.mjs` parses
**every** pattern in the repo and fails the suite on any bad block, so a
malformed header can never reach the engine in the first place. That split is
deliberate and I want it on the record: refusal at the gate, surfacing at
runtime, never a substituted value.

A parameter with no block gets **no field at all** — asserted against a real
block-less pattern over HTTP.

---

## 3 · CaptainPad UX

**Clean names.** `prettySliderName` is unchanged; what changed is that the
parameters no longer carry a signal prefix to mangle (§4).

**The badge.** `AudioSuggestionBadge` — a small band-coloured `♪ FLUX` pill
beside the parameter label, using the same identity colours as the Companion
and the AUDIO tab, resolved from the bare key (a *recommendation* may name a
signal that is not currently live, so the colour cannot depend on a live
descriptor). `AudioSuggestionNote` puts the author's explanation on a quiet
secondary line, and renders nothing when there is none.

- **Deck** (`GlobalParams` → `ModulatedSlider`): badge is interactive.
- **Mixer strip** (`mixer.tsx`): badge is read-only, matching the read-only ◎
  modulation pill already there — the mixer shows what a parameter wants, the
  deck is where mappings are made.

**Prefill — the adjudicated rule, implemented exactly.** Two distinct entry
points into the same editor:

| Entry | Behaviour |
|---|---|
| ◎ badge / plain "add modulation" | **Unchanged.** Neutral seed (`offset`, `[0, 0.35]`, `linear`, micLow-or-first-live). Every valid signal bindable. |
| ♪ suggestion badge (explicit tap) | Seeds source = suggested signal, mode = `override` (the semantics the block documents and the engine applies), range = suggested range, curve = the pre-translated `modulationCurve`. |

Guards: an **existing saved mapping always wins** — a suggestion never
overwrites operator work, and the ♪ badge is inert (visible, not tappable)
when a mapping exists or there is no playlist entry to write to. **Nothing is
auto-created**; the operator still has to press Save. In *both* flows the
matching source chip in the picker is **flagged** with a `♪` and a one-line
"pattern suggests FLUX — build reveals more stars" caption — flagged, never
pre-selected.

The decision itself lives in the pure, unit-tested
`components/audio_suggestion_logic.ts` and the component calls it, so the
shipped path is the tested path.

**The three pretty-name implementations.** Per scope I did not unify all three.
`AllModulationsPanel.shortTarget` renders my parameters correctly
(`sliderStarCount` → `STAR COUNT`) and I left it. I did fix the one inline
duplicate **in a file I was already editing and that renders the migrated
params** — `GlobalParams.tsx` had a private inline namer for its
matched/no-v0 rows that skipped the `_vN` strip, the digit split and the
upper-casing, so the same parameter read differently on two rows of one
screen. It now calls the shared `prettySliderName` that file already imported.

---

## 4 · Pattern 13 migration

Renamed **in place** — every setter kept its position, so declaration order
(= physical MFT knob order) is byte-identical and knob N drives the same
control it always did. `13_sparkle` has no `direction` param, so the
"direction is 2nd" rule is not in play. W == A re-verified.

| Old export | New export | Suggestion now carried as metadata |
|---|---|---|
| `sliderLOW_Level` | `sliderLevel` | micLow · 0.20–0.72 · linear · "total elegance budget" |
| `sliderHIGH_Brilliance` | `sliderBrilliance` | micHigh · 0.16–0.76 · linear · "high-frequency diamonds" |
| `sliderFLUX_StarCount` | `sliderStarCount` | micFlux · 0.12–0.86 · ease · "build reveals more stars" |
| `sliderKICK_Burst` | `sliderBurst` | micKick · 0.00–0.78 · pow2 · "constellation burst" |

The signal/range/curve/note are **unchanged** — they simply moved from the
identifier into the header block, which already declared all four of them.
On-screen this turns `F L U X_ STAR C` (truncated mid-word) into `STAR COUNT`
with a `♪ FLUX` badge.

### Saved-value preservation — the proof

`manifest.json` needed nothing: it is a flat array of pattern *names* and the
name did not change. I did not regenerate it.

Every 13_sparkle entry in the titanic scene, old key → new key → value. Values
re-read from disk **after** the edits; line numbers were identical before and
after, so no concurrent rewrite occurred mid-edit.

**`titanic/ambient.yaml` · `e_ambient_6_13_sparkle`**

| Old key | New key | Value |
|---|---|---|
| `sliderLocalSpeed` | *(unchanged)* | 0.57 |
| `sliderLOW_Level` | `sliderLevel` | **0.17** |
| `sliderFLUX_StarCount` | `sliderStarCount` | **0.73** |
| `sliderHIGH_Brilliance` | `sliderBrilliance` | **0.59** |
| `sliderTwinkleFocus` | *(unchanged)* | 0.88 |
| `sliderAfterglow` | *(unchanged)* | 0.13 |
| `sliderStarChorus` | *(unchanged)* | 0.63 |
| `sliderKICK_Burst` | `sliderBurst` | **0.15** |
| `sliderJewelryWhite` | *(unchanged)* | 0.81 |
| `sliderUvStars` | *(unchanged)* | 0.78 |

**`titanic/default.yaml` · `e_default_22_13_sparkle`**

| Old key | New key | Value |
|---|---|---|
| `sliderLocalSpeed` | *(unchanged)* | 0.3 |
| `sliderLOW_Level` | `sliderLevel` | **1** |
| `sliderFLUX_StarCount` | `sliderStarCount` | **0.5** |
| `sliderHIGH_Brilliance` | `sliderBrilliance` | **0.7** |
| `sliderTwinkleFocus` / `sliderAfterglow` / `sliderStarChorus` | *(unchanged)* | 0.5 / 0.5 / 0.55 |
| `sliderKICK_Burst` | `sliderBurst` | **0** |
| `sliderJewelryWhite` / `sliderUvStars` | *(unchanged)* | 0.5 / 0.3 |

**`titanic/ambient_sound_reactive.yaml` · `e_ambient_6_13_sparkle`** — defaults
0.3 / **0.45** / **0.5** / **0.7** / 0.5 / 0.5 / 0.55 / **0** / 0.5 / 0.3 in
the same order, plus the four modulations (id, target and nothing else
retargeted — every source key, mode, range and curve byte-identical):

| Old mapping id → new | Source | Target old → new | Mode | Range | Curve |
|---|---|---|---|---|---|
| `mod_sliderLOW_Level_micLow` → `mod_sliderLevel_micLow` | micLow | `sliderLOW_Level` → `sliderLevel` | override | [0.2, 0.7] | linear |
| `mod_sliderHIGH_Brilliance_micHigh` → `mod_sliderBrilliance_micHigh` | micHigh | `sliderHIGH_Brilliance` → `sliderBrilliance` | override | [0.16, 0.76] | linear |
| `mod_sliderKICK_Burst_micKick` → `mod_sliderBurst_micKick` | micKick | `sliderKICK_Burst` → `sliderBurst` | override | [0, 0.78] | easeIn |
| `mod_sliderFLUX_StarCount_micFlux` → `mod_sliderStarCount_micFlux` | micFlux | `sliderFLUX_StarCount` → `sliderStarCount` | override | [0.12, 0.86] | easeOut |

(The mapping **ids** follow CaptainPad's own `mod_<target>_<source>` derivation
convention, so renaming them keeps the convention intact; ids are free-form and
not referenced anywhere else.)

`first_class_1912.yaml` also carries a 13_sparkle entry — its `defaults` are
empty and it has no modulations, so there was nothing to migrate. No other
scene's playlists reference the hacked names.

### The loud guard the mission asked for

`marsin_engine/tests/playlist/sparkle_param_migration.test.js` — because
playlist load is **lenient** in both directions (an unresolvable modulation is
dropped with a warning; an unmatched `defaults` key is simply never replayed),
a missed rename deletes a night of operator tuning with no error anywhere. The
test asserts:

- the pattern's declared control order, exactly, and that the four old exports
  are gone;
- the four suggestions parse out of the header unchanged;
- **every** saved `defaults` key and `modulations[].target.parameter` for
  13_sparkle across all titanic playlists resolves against the pattern's
  current exports;
- the migrated values equal the pinned pre-rename numbers;
- the sound-reactive entry still carries all four mappings, retargeted only.

---

## 5 · The 11 test points

| # | Requirement | Where |
|---|---|---|
| 1 | metadata parses / round-trips without changing names | `tests/tools/audio_mod_spec.test.mjs` — block → `{version, mappings, modString, synth}` with the note surfaced; `modString` byte-identical to before; keyed-by-runtime-name assertion. Repo-wide: every header slider token resolves to a real `export function slider*` in the same file (>100 mappings checked). |
| 2 | invalid metadata / signals fail loudly | same file — unknown signal (names the pattern, quotes the token, lists the valid set), unknown curve, malformed line, block-with-no-mappings, duplicate slider, and a wrong-version spec. |
| 3 | engine API exposes recommendations | `tests/e2e/audio_suggestion_api.test.js` — real spawned engine; `GET /deck/channel` stamps exactly the four expected suggestions incl. the micFlux one; `GET /mixer` and legacy `GET /exports` carry the same additive field. |
| 4 | CaptainPad renders the recommendation separately from the label | `CaptainPad/utils/audio_suggestion_labels.test.ts` — pins that the OLD names rendered as garbage (`F L U X_ STAR C`) and the migrated ones render as `STAR COUNT`, and that the recommendation has its own word + its own band colour. **Partial by construction:** the vitest env is node-only and excludes `.tsx`, so the badge's JSX is not render-tested — its *inputs and decisions* are. |
| 5 | badge-entry prefill correct | `CaptainPad/components/audio_suggestion_logic.test.ts` — 13 tests: prefill only on explicit badge entry for a new mapping; source/override-mode/range/translated-curve; the plain flow byte-identical to a param with no suggestion; no aliasing of the shared seed or the suggestion's range. |
| 6 | micFlux appears in the CaptainPad source list | `audio_suggestion_labels.test.ts` "the suggestible signal family" — pins the five-key family, each with a distinct badge word and identity colour, against `processedSignalKeys()`. **Registry-level, as the mission specified** — `deriveAudioSignals` lives in the RN-only `useEngineState.ts` and cannot load in the node test env. The engine half (`micFlux` live in `/param-center/schema`) is covered by `tests/audio/audio_signals.test.js`. |
| 7 | injected micFlux reaches a pattern param at runtime | `tests/companion/companion_flux_output.test.js` — OSC dispatch → post-chain → CPC → `applyModulations` → target lifts off `range[0]`. In-process, no socket bound. |
| 8 | playlist save/load preserves the modulation | `tests/playlist/sparkle_param_migration.test.js` — the four mappings survive with every field but the target name identical, and every saved reference resolves. |
| 9 | patterns without metadata unchanged | `audio_mod_spec.test.mjs` (no block → `null` → `{}`) **and** over HTTP in `audio_suggestion_api.test.js` against a real block-less pattern: no `audioSuggestion` field on any export. Byte-level: only `13_sparkle.js` was edited among the 77 patterns. |
| 10 | pattern 13 saved values survive migration | `sparkle_param_migration.test.js` + the tables in §4. |
| 11 | engine + offline harness metadata parity | `audio_mod_spec.test.mjs` — `VALID_SIGNALS` deep-equals `processedSignalKeys()` deep-equals `Object.keys(micSignalShortNames())`, and the harness is asserted to *derive* `SIG_FIELD` from the same call rather than hand-list it. `tests/audio/audio_signals.test.js` pins the derivation itself. |
| **12** | *(added)* the present-at-zero footgun | `audio_mod_spec.test.mjs` — absent source → untouched; present-at-0 → pinned at `range[0]`; real value → full sweep. This is the FLUX regression class as executable behaviour, and it is why `missingCuratedOutputs()` shouts. |

---

## 6 · Files changed

**Mine, this task:**

| File | What |
|---|---|
| `marsin_engine/audio/postproc/audio_signals.js` | `gainByKeyForOsc()` derives from `processedSignalKeys()` (micFlux joins); new `micSignalShortNames()` |
| `marsin_engine/tools/audio_mod_spec.mjs` | `VALID_SIGNALS` derived; `note` surfaced; `version` returned; duplicate-slider refusal; every throw names the pattern; `MODULATION_CURVE_BY_BLOCK_CURVE`; `audioSuggestionsBySlider()` |
| `marsin_engine/tools/pattern_audio_harness.mjs` | `SIG_FIELD` derived from the registry |
| `marsin_engine/audio/companion/companion_config.js` | `CURATED_OUTPUTS` derived + import-time parity guard; flux in the default design; `missingCuratedOutputs()` |
| `marsin_engine/audio/companion/companion_config.yaml` | the flux signal (tracked config) |
| `marsin_engine/audio/companion/companion_server.js` | loud boot warning naming unpublished curated outputs |
| `marsin_engine/patterns/13_sparkle.js` | four renames in place + header block + stale prose |
| `simulation/scenes/titanic/playlists/{ambient,default}.yaml` | 13_sparkle entry keys only |
| `simulation/scenes/titanic/playlists/ambient_sound_reactive.yaml` | 13_sparkle entry keys + the four modulation targets/ids |
| `CaptainPad/utils/audioSignals.ts` | `audioAccentHexForKey()`, `shortSignalLabel()` |
| `CaptainPad/utils/midi/knob_order.ts` | `Export.audioSuggestion` (type-only relative import) |
| `CaptainPad/components/Modulation.tsx` | badge + note components, deck wiring, two-entry popover, source-chip flag |
| `CaptainPad/components/GlobalParams.tsx` | forwards the suggestion; uses the shared pretty-namer |
| `CaptainPad/app/(tabs)/mixer.tsx` | read-only badge + note |
| **new** `CaptainPad/components/audio_suggestion_logic.ts` (+ `.test.ts`) | the pure prefill rules |
| **new** `CaptainPad/utils/audio_suggestion_labels.test.ts` | name/recommendation separation |
| **new** `marsin_engine/tests/tools/audio_mod_spec.test.mjs` | the parser gate |
| **new** `marsin_engine/tests/companion/companion_flux_output.test.js` | the FLUX chain |
| **new** `marsin_engine/tests/e2e/audio_suggestion_api.test.js` | the engine surface |
| **new** `marsin_engine/tests/playlist/sparkle_param_migration.test.js` | saved-work guard |
| `marsin_engine/tests/audio/audio_signals.test.js` | GAIN_BY_KEY expectation + `micSignalShortNames` |
| `marsin_engine/tests/playlist/playlist_api.test.js` | its `13_sparkle` probe slider `sliderDensity` → `sliderStarCount` (see §8) |

**Foreign-adjacent — files carrying someone else's uncommitted work that I
edited surgically on top of, never regenerating:**

- `marsin_engine/lib/api_server.js` (_182 SIZE-lock work) — added the parser
  import, `audioSuggestionsForPattern`, and the stamp inside
  `annotateCodeDefaults`. Nothing else touched.
- `CaptainPad/utils/api.ts`, `CaptainPad/hooks/useEngineState.ts` (_182) — one
  type each.
- `marsin_engine/patterns/13_sparkle.js` and the two tracked titanic playlists
  already carried uncommitted changes; I re-read each immediately before
  editing and re-read after to confirm no concurrent rewrite.
- `simulation/scenes/titanic/playlists/ambient_sound_reactive.yaml` is
  **untracked** — a new playlist someone else created and has not committed.
  Flagging it so it does not get lost.

**I did not touch** the other AI's four files (`engine.js`, `config.yaml`,
`lib/fire_sync_listener.js`, `lib/global_effects_controller.js`),
`marsin_engine/states/**`, calibration patterns, or calibration playlists.

---

## 7 · Deferred / flagged

- **Pre-existing orphaned playlist references (not mine, and they matter).**
  Auditing every scene turned up **137** saved `defaults` keys and **3**
  modulation targets that no longer resolve against their pattern's exports —
  e.g. `test_bench/slow.yaml`'s `13_sparkle` entry still carries a dozen keys
  from a long-retired version, and `test_bench/default.yaml`'s
  `26_dom_dancers_chevron` has 7 stale defaults plus 2 stale modulation
  targets. That tuning is *already* being dropped silently on every load. This
  is why I scoped my resolution test to the titanic 13_sparkle entries rather
  than repo-wide — a repo-wide guard would fail on day one. **Filed as a
  follow-up task.**
- **A test suite spawns engines onto operator ports.**
  `tests/mixer/performance_mode.test.js` uses `portBase: 6960, portSpan: 30`,
  i.e. 6960-6989, which overlaps the operator's pinned 6967-6972. Pre-existing;
  my new E2E suite deliberately sits at 7420-7479. **Filed as a follow-up
  task**, with the suggestion that `createEngineHarness` itself throw on a
  reserved-port window rather than leaving it to memory.
- **The flux LPF cutoff (22 Hz) wants an ear.** Chosen from first principles
  (transient measure ⇒ smooth less than kick), not from a real track.
- **`08_ocean_liner` will not compile on models without RAW_LED / TE_SIGN
  fixtures** (see §8). Someone else's in-flight pattern rewrite; **filed as a
  follow-up task** with the offline reproduction.
- **Docs not updated.** `docs/24_osc_integration.md` and
  `docs/MARSIN_ENGINE_PATTERNS.md` are the natural homes for the suggestion
  contract, but docs/24 currently carries foreign uncommitted edits and I chose
  not to race it. The contract is documented in the parser's own header block
  and in this report.
- **CaptainPad badge JSX is not render-tested** — the vitest config is node-only
  and excludes `.tsx` by design. Its inputs and decisions are covered.

---

## 8 · Suite results

**CaptainPad:** `tsc --noEmit` clean. `vitest run` — **47 files, 981 passed, 6
skipped, 0 failed** (baseline 960 passed; +21 from the two new files). No
pre-existing test changed behaviour.

**Engine:** `npm test` — **2874 tests, 2863 pass, 11 fail** (baseline
2829/2821/8; the +45 tests are my four new files). I then fixed one of the 11
(below), leaving **10**. Compared as LISTS, not counts:

| Failure | Verdict |
|---|---|
| `audio_capture.test.js` ×5 (framing / lifecycle / backoff / stop / onFrame) | **Baseline** — the known env failures (no capture device). |
| `effects_v2_mode_page_layout.test.js` | **Baseline** — the known effects_v2 IPC flake. |
| `osc_listener.test.js:525` EADDRINUSE | **Baseline** — the operator's OSC port is bound, so the "already bound" assertion can't set up. |
| `patterns/calibration_patterns.test.js:86` | **Was in the baseline, now PASSES** — someone else's concurrent fix. |
| `io/fire_sync_listener.test.js:135` "an ON edge sets the effect…" | **NEW, not mine.** Both `lib/fire_sync_listener.js` and this test are the other AI's staged in-progress work; I did not touch either. |
| `playlist_api.test.js` ×2 (entry switch, assignment across restart) | **NEW, not mine.** Independently reproduced with a scratch harness that touches none of my code: the uncommitted rewrite of `patterns/08_ocean_liner.js` references `FIX_RAW_LED` / `FIX_TE_SIGN`, which the `summer_camp_dome` model (this suite's scene) does not define, so `POST /deck/playlist/entry` onto that entry returns `400 Compile error: Pattern references unknown FIX_ constant(s)`. Filed as a follow-up task with the reproduction. |
| `playlist_api.test.js:154` "Two entries of same pattern keep independent defaults" | **In my blast radius — FIXED.** It probed `13_sparkle` for `sliderLocalSpeed` + `sliderDensity`; `sliderDensity` was retired by the pattern's (foreign, uncommitted) "First-Class Constellations" rewrite *before* my task, so it was already broken, and my rename does not restore it. The test's own comment states the intent — track the pattern's real exports — so I repointed the second probe slider to `sliderStarCount` and documented both hops. Now passes. |

**Zero new failures attributable to this work.** `tests/patterns/*.test.js`
(110 tests, incl. `white_amber_lane_match` across the whole catalog and
`param_truth_smoke`) ran green.

**Not run:** the simulation suite — the only `simulation/**` files I touched are
playlist YAML data, which the sim suite does not cover and which the engine's
playlist tests do.
