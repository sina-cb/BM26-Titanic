# _183 — Audio suggestion metadata recon + FLUX root cause

**Date:** 2026-08-06 · **Agent:** _183 (Opus, investigation, read-only)
**Branch:** `feat/bm_readiness` (post `9e8b23b8`) · **No source edits, no git ops.**

Two deliverables: (A) the full existing contract trace for the
"audio-binding suggestions as separate metadata" feature, and (B) the root
cause of the operator-reported FLUX problem. Everything below is read from
the current working-tree file contents (the concurrent uncommitted engine +
size-lock work is included as truth).

---

## PART B FIRST — FLUX root cause (it is short and it is certain)

### The broken link

**The Audio Companion never publishes `micFlux`. It has no FLUX output
signal at all.**

Evidence chain, offline-verified:

1. **Engine side is correct and complete.** `micFlux` is a first-class
   built-in CPC key: declared in the authoritative registry at
   `marsin_engine/audio/postproc/audio_signals.js:90`
   (`{ key: 'micFlux', label: 'Mic · Flux', gainLabel: 'Mic Flux Gain', osc: 'flux', hz: 15 }`),
   built into a descriptor with `oscAddress: '/marsin/mic/flux'`,
   `live: true`, `processed: true` at `audio_signals.js:270-279`.
   Probed live (offline `ParamCenter` instantiation, temp state file,
   no ports):

   ```
   micFlux  range [0,1]  live:true  broadcastHz:15
            oscAddress:/marsin/mic/flux  dynamic:false
   ```

   So the engine binds `/marsin/mic/flux` (canonical bindings are built
   from the schema's `oscAddress` — `marsin_engine/lib/osc_listener.js:320-322`)
   and the key appears in `GET /param-center/schema`.

2. **CaptainPad side is correct.** `deriveAudioSignals`
   (`CaptainPad/hooks/useEngineState.ts:1386-1432`) includes every
   `live:true` audio-family key, and the modulation source picker is built
   straight off it (`CaptainPad/components/Modulation.tsx:741-756`
   `useModulationSourceOptions` → `useAudioSignals`). `micFlux` therefore
   *is* in the list, rendered as label `FLUX`
   (`_shortAudioLabel`, `useEngineState.ts:1347-1354`) — but it is
   **permanently 0**, so it reads as a dead bar / dead chip. Nothing
   filters it out; nothing rejects it.

3. **The Companion is the sole analyzer and a SEPARATE process** with its
   own `ParamCenter` (`marsin_engine/audio/companion/companion_server.js:163`,
   `new ParamCenter(null)`). The engine only ever gets what the Companion
   emits over OSC.

4. **The Companion's design has no flux signal.**
   - Built-in default design: `marsin_engine/audio/companion/companion_config.js:237-250`
     — `micLow, micMid, micHigh, micKick, micDomFreq1, micDomFreq2,
     micDomEnergy1, micDomEnergy2`. **No flux.**
   - Persisted operator design `marsin_engine/audio/companion/companion_config.yaml`
     — same eight signals. **No flux.**
   - Offline probe of `loadCompanionConfig()` → resolved outputs:

     ```
     micLow /marsin/mic/low · micMid /marsin/mic/mid · micHigh /marsin/mic/high
     micKick /marsin/mic/kick · micDomFreq1·2 /marsin/dom/freq1·2
     micDomEnergy1·2 /marsin/dom/energy1·2
     has /marsin/mic/flux ? false
     ```

5. **And it cannot be fixed from the Companion UI alone.** `CURATED_OUTPUTS`
   (`companion_config.js:94-106`) — the map that lets an `osc_out` name keep
   its canonical engine-bound address — **omits `micFlux`**. Probed:

   ```
   resolveOscOut("micFlux") => { cpcKey: "micflux", address: "/marsin/audio/micflux" }
   ```

   So an operator who adds a FLUX signal in the designer and names it
   `micFlux` gets a *new dynamic key* `micflux` on `/marsin/audio/micflux`,
   **not** the built-in `micFlux` every pattern and playlist references.
   (`slug()` is `signal_post_processor.js:345-352`.)

The raw analyzer flux value *is* computed — `r.flux` is published into the
**Companion's own** ParamCenter as `micFluxRaw`
(`companion_server.js:1295`) so the local detector / derived signals can use
it — but raw mirrors carry no `oscAddress`
(`audio_signals.js:204-213` `rawMirrorDescriptor`), so it never leaves the
Companion process. Nothing is broken in transport, serialization,
CaptainPad filtering, type schema, memoization, labels, or runtime
validation. The signal is simply **never produced on the wire**.

### Why this is worse than a dead meter (show impact)

`applyModulations` skips a mapping only when the source key is *absent*
from the CPC snapshot (`marsin_engine/lib/modulation_engine.js:260-262`).
`micFlux` is **present** — at its default `0`. So a `micFlux` mapping is
**applied every frame with signal 0**, and in `override` mode
(`modulation_engine.js:153-155`) that pins the target parameter at
`range[0]` forever, ignoring the operator's slider.

Blast radius in tracked content:

| Where | Count |
|---|---|
| Patterns declaring `<- micFlux` in `AUDIO_MODULATION_V1` | **32** of 75 |
| Saved playlist modulations with `key: micFlux` | **11** (`titanic/ambient.yaml` ×4, `titanic/ambient_sound_reactive.yaml` ×6, `titanic/default.yaml` ×1, plus `test_bench/default.yaml`) |

Concrete example: `simulation/scenes/titanic/playlists/ambient_sound_reactive.yaml:29-42`
— `mod_sliderEmberSwell_micFlux`, `mode: override`, `range: [0.08, 0.78]`
→ `sliderEmberSwell` is nailed to **0.08** whenever that entry is live.

### Minimal fix sketch (no aliasing, no fallback keys — fix the true path)

Three edits, all in the Companion, all on the true key/address:

1. `marsin_engine/audio/companion/companion_config.js:94-106` — add
   `micFlux: '/marsin/mic/flux'` to `CURATED_OUTPUTS`. (The comment at
   `:93` already says the map "mirrors `audio_signals.js` oscAddress
   fields" — flux is the one that was missed.)
2. `companion_config.js:237-250` (`defaultCompanionConfig`) — add
   `intensity('flux', 'micFlux', 'rawFlux', <cutoffHz>)` after `kick`.
   `rawFlux` already exists as a designable raw source at
   `companion_config.js:44`. Pick the LPF cutoff deliberately: flux is a
   transient/rise measure, so it should smooth *less* than kick's 18 Hz —
   the implementer should tune it against a real track rather than copying
   a band value.
3. `marsin_engine/audio/companion/companion_config.yaml` — add the matching
   persisted signal (the on-disk design overrides the built-in default, so
   editing only the JS leaves the running Companion unchanged).

**Secondary gap, decide explicitly (do not silently paper over):**
`gainByKeyForOsc()` (`audio_signals.js:453-461`) deliberately excludes
`micFlux` with the comment "its gain is applied in the analyzer, not the OSC
path". The Companion has **no** micFlux gain concept, so once flux flows the
`micFluxGain` CPC knob (`audio_signals.js:287-289`, persisted, OSC-bound at
`/marsin/param/micFluxGain`) is a **dead knob**, and — because the engine's
`<key>Raw` mirrors are only wired for `GAIN_BY_KEY` entries
(`osc_listener.js:338-353`) — engine-side `micFluxRaw` stays 0, so
CaptainPad's RAW ghost trace for FLUX stays flat. Either add `micFlux` to
`gainByKeyForOsc()` (gain + raw mirror both come alive) or remove
`micFluxGain` from the registry. Leaving it as-is is a half-wired knob,
exactly the failure mode that map exists to prevent.

**Verification without touching the live stack:** use
`marsin_engine/tests/helpers/companion_isolation.mjs` (the `_173` seam —
scratch `MARSIN_CONFIG_FILE` with black-holed companion endpoints,
`assertEngineLinkDown`). A new test in `tests/companion/` should assert
`loadCompanionConfig()` resolves an output on `/marsin/mic/flux` with
`cpcKey === 'micFlux'`, and — the real regression guard — that **every**
`oscAddress` in `audioSignalDescriptors()` marked as a mic band has a
Companion output pointing at it.

---

## PART A — the 7-point contract trace

### 1. Pattern-source header metadata: `AUDIO_MODULATION_V1`

**Canonical parser:** `marsin_engine/tools/audio_mod_spec.mjs`
(`parseAudioModSpec`, line 127). It is the **only** parser of the block in
the repo — grep for `AUDIO_MODULATION_V1` outside `patterns/` returns this
file, `tools/gallery/gen_variations.mjs`, `tools/pattern_derived_harness.mjs`,
skills, and reports. **The engine does not parse it at all today** — it is
pure offline tooling (gallery clip generation + the audio harness).

Grammar (`audio_mod_spec.mjs:59-62`):

```
slider<Name> <- mic<Sig> range <a>..<b> curve <linear|pow2|ease>  # note
```

What it already declares, per mapping: `slider`, `signal`, `min`, `max`,
`curve`, and a free-text `# note`. **The `note` field is parsed and then
STRIPPED** from the public contract at `audio_mod_spec.mjs:188-191` — the
"short explanation" the feature wants **already exists in every pattern
header** and is being thrown away one line before the return. That is the
single highest-leverage change in the whole feature.

Failure posture is already correct (codex P0): unknown signal →
throw (`:161-164`), unknown curve → throw (`:165-169`), malformed mapping
line → throw (`:155-159`), block present with zero mappings → throw
(`:179-181`), no block → `null`.

**Verdict: yes, extend this parser. Do not write a second one.** Concretely:
stop stripping `note`; add optional trailing fields if richer metadata is
wanted. Keep `parseAudioModSpec` dependency-free (Node built-ins only, no
I/O) — the gallery and harness rely on that.

**Join key is exact and free:** the block's `slider<Name>` token **is** the
WASM export `name`. `pattern_defaults.js:56-58` states it outright — the
slider CONTROL name is the setter function name, "exactly what
`wasmHost.getExports()` reports as the kind-1 export `name`". And
`ModulationMapping.target.parameter` is that same export name
(`modulation_engine.js:46-47`, and see the saved YAML:
`parameter: sliderEmberSwell`). So header ⇄ export ⇄ mapping already share
one identifier. No mapping table needed.

### 2. Pattern discovery / param extraction — where metadata rides along

- `marsin_engine/patterns/manifest.json` is a **flat array of 75 pattern
  name strings**. No schema, no params. Not a useful metadata carrier.
- The real param schema comes from the WASM VM:
  `wasm_host.getExports(handle)` → `marsin_get_exports_json`
  (`marsin_engine/lib/wasm_host.js:88, 187-190`) → `{ id, name, kind, v0, v1, v2 }`.
  `kind === 1` is `EXPORT_SLIDER`.
- **The engine already augments that array from the pattern SOURCE** — this
  is the precedent the feature should copy exactly:
  - `marsin_engine/lib/pattern_defaults.js` (`parsePatternDefaults`) parses
    the source for `export var` defaults keyed by slider control name.
  - `api_server.js:997-1010` `codeDefaultsForPattern(patternName)` —
    per-pattern `Map` cache, loads the source via `loadPattern`, tolerates a
    parse failure with a warning.
  - `api_server.js:1018-1024` `annotateCodeDefaults(channel, exportsArr)` —
    "Additive: stamp each SLIDER export (kind 1) with `codeDefault` … Does
    NOT touch existing fields".
  - Applied at the two serializers: `api_server.js:3561` and `:3718`.

**This is THE extension point.** Add a sibling `audioSuggestionsForPattern()`
(same cache shape, backed by `parseAudioModSpec`) and stamp an additive
per-export field, e.g. `e.audioSuggestion = { signal, range, curve, note }`,
inside/next to `annotateCodeDefaults`. Zero new endpoints, zero new
round-trips, and it lands in both existing payloads at once.

Note the cache-invalidation comment at `api_server.js:993-996`: the cache is
keyed by pattern name and a live-edit recompile keeps the name, so the
stamped value is a **hint only** — same posture is fine for suggestions.

### 3. Engine REST/WS parameter schema — where recommendations serialize

- Pattern params ride the `exports:` array on the **`/mixer`** and
  **`/deck`** channel serializers (`api_server.js:3561`, `:3718`), filtered
  to `localControlKinds`, with per-export values patched from
  `channel.localControls`.
- **Labels already exist** on that array, but only for CPC-matched exports:
  `cpcOwned` / `cpcKey` / `cpcLabel` (`api_server.js:3565-3572` and
  `:3720-3728`). That is precedent for additive per-export UI metadata that
  CaptainPad renders as a badge.
- The **CPC** schema is a different surface: `GET /param-center/schema` ←
  `ParamCenter.getSchema()` (`marsin_engine/lib/param_center.js:612`), built
  from `PARAM_REGISTRY` (`:32`) with the audio family spliced in via
  `...audioRegistryEntries()` (`:105`). CPC entries carry `label`; pattern
  exports do **not** carry a human label at all today (CaptainPad derives
  one client-side — see §5).
- WS: `modulationState` frames are broadcast on `/ws/params`
  (`modulation_engine.js:19-25`, emitted from
  `modulation_controller.js:174-179`, throttled ~20 Hz). `paramSchema` +
  `sharedParams` are re-broadcast when the Companion manifest changes the
  registry shape (`api_server.js:8592-8595`).

### 4. Modulation validation + persistence, and what refuses unknown signals

- **Schema validation:** `validateModulationMapping`
  (`modulation_engine.js:290-346`). Validates id/type/enabled/source.scope
  (`'cpc'`)/target.scope (`'pattern'`)/mode/polarity/curve/range bounds.
- **There is NO source-key allow-list.** Explicit, deliberate, documented
  twice: `modulation_engine.js:86-92` and `:311-315` — "any non-empty CPC
  key is a valid source". A mapping to a key absent from the frame is a
  no-op (`:260-262`).
- **Persistence:** playlist YAML, per entry, `modulations: [...]`
  (see `simulation/scenes/titanic/playlists/ambient_sound_reactive.yaml:14`).
  - Load is **lenient** — `playlist_manager.js:183` `_coerceModulations`,
    drops invalid mappings with a warning (comment at `:171-177`).
  - Save is **strict** — `playlist_manager.js:234-246`: every mapping runs
    `validateModulationMapping`, and duplicate targets throw (v1
    one-per-target policy).
- **REST CRUD:** `PUT/PATCH/DELETE /api/playlists/:name/items/:itemId/modulations/:mappingId`
  (`api_server.js:8704-8800`), pushing into `ModulationController.setActiveEntry`
  (`api_server.js:1112-1127`).
- **The only thing in the repo that refuses an unknown signal name** is
  `audio_mod_spec.mjs:56` `VALID_SIGNALS` — offline tooling, not the engine.

### 5. CaptainPad param controls + modulation-source picker

- **Param name rendering:** `prettySliderName`
  (`CaptainPad/components/Modulation.tsx:90-108`) — strips a `_vN` suffix,
  strips the `slider|toggle|trigger|hsvPicker` prefix, splits on capitals,
  splits trailing digits, uppercases, truncates to 15 chars. Duplicated
  (slightly differently) as `shortTarget` in
  `CaptainPad/components/AllModulationsPanel.tsx:72-78` and inline in
  `CaptainPad/components/GlobalParams.tsx:134`.
  Consumers: `app/(tabs)/mixer.tsx:239, 351, 364`, `Modulation.tsx:382`.

  **This is the direct evidence for the feature.** `prettySliderName('sliderLOW_Level')`
  → strip prefix → `LOW_Level` → capital-split → `L O W_ L evel` →
  `"L O W_ L EVEL"`. The name hack is not merely ugly in source, it renders
  as garbage on the operator's screen. (Only **one** pattern uses the hack
  today: `marsin_engine/patterns/13_sparkle.js` — `sliderLOW_Level`,
  `sliderFLUX_StarCount`, `sliderHIGH_Brilliance`, `sliderKICK_Burst`.
  Every other pattern already uses clean names + a header block, e.g.
  `patterns/00_golden_hour_wash.js`, `patterns/44_biolume_swell.js`.)

- **Where a badge/tooltip goes:** the per-slider row in
  `app/(tabs)/mixer.tsx:239-243` already renders a MIDI knob badge and a
  modulation badge next to `niceLabel`; `ModulationBadges` /
  `ModulationReadonlyBadge` live in `Modulation.tsx:~482-556`. A
  "suggested: FLUX" chip belongs beside those, and inside the popover it
  belongs in `SECTION 1 · SOURCE` (`Modulation.tsx:1047-1075`), where the
  `SourceChip` list is rendered — a suggested source should be visually
  pre-flagged there rather than pre-selected.

- **How the picker builds its list:** `useModulationSourceOptions`
  (`Modulation.tsx:741-756`) → `useAudioSignals()`
  (`useEngineState.ts:1440-1453`) → `deriveAudioSignals(schema)`
  (`:1386-1432`), which takes every `live:true` key that is audio-family
  (`_isAudioFamilyKey`, `:1374-1377`: `entry.dynamic === true` **or**
  `/^(mic|audio|stems|dom)/`), minus `*Raw` / `*Gain` / `tempoBpm` /
  `audioBpm`. A saved-but-no-longer-live source is kept and labelled
  `… · retired` (`:748-753`). Default source seeding: existing mapping →
  `micLow` if live → first live signal (`Modulation.tsx:786-790`).

- **Client-side identity/curation lists** (relevant, not authoritative):
  `CaptainPad/utils/audioSignals.ts` — `COMPANION_ACCENT` (`:37-50`, has a
  `flux` violet), `CURATED_DECK_TOKENS` (`:219-227`, **flux intentionally
  not on the deck row**), `PULSE_KEY_TOKENS` (`:117-129`),
  `AUDIO_GENRE_NAMES` (`:65-73`).

### 6. Audio Companion → engine signal publication

- **Protocol: OSC over UDP.** Companion → engine OSC port `10000`
  (companion side: `companion_config.yaml` `osc:` block; engine side:
  `marsin_engine/config.yaml:29-35` `osc: enabled/port/host/allowedSenders/bindings`;
  the companion's engine link is `config.yaml:94-101`, engine API port `6968`).
  Confirmed still current on this branch (docs/24 is the reference).
- **What it publishes:**
  - Designed operator signals → `processDesignedSignals`
    (`companion_server.js:1302-1330`), each emitting its post-chain value to
    its resolved `osc_out` address.
  - Built-in BPM emit (`emitDerivedBpm`) + the **full** derived/detector set
    (`emitAllDerived`) — `companion_server.js:1388-1393`. The Companion is
    the sole analyzer (2026-06-21 contract), so every `DETECTORS`/`DERIVED`
    key in `audio_signals.js:101-151` has an inbound OSC binding.
  - Raw analyzer mirrors → **the Companion's own ParamCenter only**
    (`companion_server.js:1289-1301`), consumed locally by
    `detector.tick` / `derived.tick`.
- **Where the engine ingests:** `marsin_engine/lib/osc_listener.js` —
  canonical bindings built from the CPC schema's `oscAddress`
  (`:320-322`), gain/raw-mirror wiring at `:338-353`, dispatch at `:639`.
  Dynamic Companion keys arrive via `POST /audio/signals/manifest`
  (`api_server.js:8499-8600`) → `paramCenter.registerDynamicLiveParam` +
  `listener.addDynamicBinding`; keys absent from a manifest are
  deregistered and their modulations purged
  (`purgeModulationsForSource`, `api_server.js:1138-1160`). **Built-in keys
  are never touched by the manifest** (refused at `:8528-8535`).
- **Published mic-band set today: low, mid, high, kick — and nothing else.**
  See Part B.

### 7. Runtime application of a bound signal (e.g. micFlux)

`marsin_engine/lib/modulation_controller.js` — called once per render tick,
after `paramCenter.flushDirty` and before `mixer.beginFrame`
(`applyFrame`, `:79`):

1. Perf early-out when there are no mappings and nothing owed (`:95-99`).
2. Read `exports` and build `baseParams` from `channel.localControls`
   (kind 1 only) — `:101-111`.
3. `paramCenter.getAll()` → `resolveModulationSources`
   (`modulation_engine.js:188-216`) — every finite numeric CPC value becomes
   a source; **builtin** descriptors whose curated range is wider than
   `[0,1]` are normalized via `descriptorByKey` (so Hz/bpm/note/structure
   drive the full range); **dynamic** Companion keys pass through raw by
   design.
4. `applyModulations` (`modulation_engine.js:234-280`) → per-target
   `applyContinuousModulation` (`:132-179`): curve shapes the **signal**,
   then range-lerp, then mode (`override` / `multiply` / `offset` with
   uni/bipolar), then `clamp01`. One mapping per target (runtime safety net
   at `:254-259`).
5. Write back with `wasmHost.setControl(handle, exp.id, modulated, 0, 0)`
   (`modulation_controller.js:129`); restore base one-shot for targets that
   stopped being modulated (`:137-146`).
6. Throttled `modulationState` broadcast with the >0→0 clearing-frame gate
   (`:148-179`).

CaptainPad mirrors this math **by hand** in
`Modulation.tsx:587-641` ("These MUST match `modulation_engine.js` exactly")
for the transfer-function plot — a known lockstep hazard.

---

## THE AUTHORITATIVE SIGNAL REGISTRY — verdict

### `marsin_engine/audio/postproc/audio_signals.js`

It says so itself at line 1 ("the SINGLE SOURCE OF TRUTH for the AUDIO
signal family") and it earns it: `param_center.js:105` splices
`audioRegistryEntries()` into the CPC registry;
`signal_post_processor.js` derives `KNOWN_SIGNALS` from
`processedSignalKeys()`; `osc_listener.js:23,46` derives `GAIN_BY_KEY` from
`gainByKeyForOsc()`; CaptainPad derives its live-key set from
`GET /param-center/schema` (`useEngineState.ts:447-455`). It is pinned by
`marsin_engine/tests/audio_signals.test.js`.

**The feature must extend `MIC_BANDS` / the descriptor table, not duplicate
it.**

### Places the signal list is hard-coded MORE THAN ONCE (flagged)

| # | Location | Duplicate of | Status |
|---|---|---|---|
| 1 | `audio_signals.js:85-91` `MIC_BANDS` | — | **AUTHORITATIVE** |
| 2 | `audio_signals.js:401` `MIC_ORDER` in `processedSignalKeys()` | #1 | Duplicated but **guarded**: throws on drift (`:405-410`). Acceptable. |
| 3 | `audio_signals.js:432-438` `GAIN_OP_ID` | #1 | Duplicated, ungated. Includes `flux: 'flux_gain'`. |
| 4 | `audio_signals.js:455` order list in `gainByKeyForOsc()` | #1 | Duplicated, ungated, **deliberately omits `micFlux`** — see Part B secondary gap. |
| 5 | `tools/audio_mod_spec.mjs:56` `VALID_SIGNALS` | #1 | **Hard duplicate.** The one place that rejects an unknown signal name, and it is a hand-typed 5-element Set in offline tooling. **Fix this in the feature** — derive it from `audioSignalDescriptors()`. |
| 6 | `tools/pattern_audio_harness.mjs:122` `SIG_FIELD` | #1 | **Hard duplicate** (signal → synth field). Guarded only by its own `MOD_FAIL` at `:140`. |
| 7 | `audio/companion/companion_config.js:39-49` `RAW_SOURCES` | #1 (companion naming) | Legitimately a different namespace (`rawLow`…`rawFlux`), but the family membership is retyped. |
| 8 | `audio/companion/companion_config.js:94-106` `CURATED_OUTPUTS` | the descriptors' `oscAddress` fields | **Hard duplicate, and the site of the FLUX bug.** Comment at `:93` even claims it "mirrors audio_signals.js oscAddress fields" — it does not. Best long-term fix: derive it from `audioSignalDescriptors()`. |
| 9 | `audio/companion/companion_config.js:237-250` default design | #8 | **Missing flux.** |
| 10 | `CaptainPad/utils/audioSignals.ts:37-50` `COMPANION_ACCENT` | Companion `companion_app.js:17` `SOURCE_ACCENT` | Cosmetic (colour identity), documented as a deliberate mirror. Low risk. |

**Recommendation for `_184`:** the feature's "recommended signals from
{micLow, micMid, micHigh, micFlux, micKick}" set must be **derived**, e.g.
export a `modulatableSignalKeys()` (or reuse `processedSignalKeys()`) from
`audio_signals.js` and consume it in `audio_mod_spec.mjs` (#5),
`pattern_audio_harness.mjs` (#6), and any new engine-side parser. Adding a
sixth signal must then be a one-line descriptor edit, which is exactly the
promise `audio_signals.js` was written to keep.

---

## MFT / knob-order constraints that must survive the feature

- **Declaration order is physical MIDI knob order.** Asserted in
  `13_sparkle.js:32` ("declaration order is physical MIDI knob order") and
  enforced client-side by `CaptainPad/utils/midi/knob_order.ts` (kind-1
  exports, in export order; 12 physical knobs, the rest marked `overflow`),
  with `knob_badge.ts` rendering it. `CaptainPad/utils/midi/knob_order.test.ts`
  is the existing seam.
- Engine-side, the export order comes from `marsin_get_exports_json`, i.e.
  from the order the `export function slider*` declarations appear in the
  source. **A rename that keeps each setter in place is order-safe; moving a
  setter is not.** For `13_sparkle.js` the four hacked setters are at
  `:49-58` — rename in place, do not reorder.
- **`direction` must be the 2nd local param** (bank-1 MFT layout,
  `.agent/memory/mft-bank-usage.md` / `pattern-param-order.md`).
  `13_sparkle.js` has no `direction`; nothing to preserve there.
- **W == A** (white and amber always carry the same value) is pinned by
  `marsin_engine/tests/patterns/white_amber_lane_match.test.js` — it renders
  every `rgbwau()` pattern and asserts byte-identical lanes. Any pattern
  touched by a rename must be re-run through it.

---

## Recommended implementation order for `_184`

**Phase 0 — make the parser the contract (engine-agnostic, zero risk).**
1. `tools/audio_mod_spec.mjs`: stop stripping `note` (`:188-191`) — return it
   as `explanation`. Derive `VALID_SIGNALS` (`:56`) from
   `audio_signals.js` instead of hand-listing.
2. Add the first-ever test for it: `tests/tools/audio_mod_spec.test.mjs` —
   round-trip a real pattern header; assert every `slider` token in every
   pattern's block resolves to an actual kind-1 export name (this catches
   header/code drift repo-wide and is cheap); assert every declared signal
   is a live audio descriptor. **This test is what makes the rest safe.**

**Phase 1 — surface it (additive, no schema break).**
3. `api_server.js`: add `audioSuggestionsForPattern(patternName)` beside
   `codeDefaultsForPattern` (`:997-1010`), same `Map` cache, same
   warn-on-parse-failure posture; stamp `e.audioSuggestion` inside/next to
   `annotateCodeDefaults` (`:1018-1024`). It reaches both serializers
   (`:3561`, `:3718`) for free.
4. CaptainPad: read the new field. Badge next to `niceLabel`
   (`mixer.tsx:239`), and a pre-flag (not pre-select) on the matching
   `SourceChip` in the popover (`Modulation.tsx:1047-1075`). Tooltip text =
   the `explanation`.

**Phase 2 — the rename (last, smallest, most reviewable).**
5. `patterns/13_sparkle.js` only: `sliderLOW_Level → sliderLevel`,
   `sliderFLUX_StarCount → sliderStarCount`,
   `sliderHIGH_Brilliance → sliderBrilliance`,
   `sliderKICK_Burst → sliderBurst`. **Rename in place at `:49-58`; do not
   reorder.** Update the header block's slider tokens to match — Phase 0's
   test now enforces that they do.
6. Re-run `tests/patterns/white_amber_lane_match.test.js` and
   `tests/patterns/param_truth_smoke.test.js`.

**Phase 3 — FLUX (independent of 0-2; can land first if the operator wants
the show fixed sooner).** The three Companion edits in Part B + the
`gainByKeyForOsc` decision + the isolated companion test.

### Hazards for the implementer

- **PLAYLIST EDITS ARE A LIVE-WRITE HAZARD.** The running engine owns
  `simulation/scenes/*/playlists/*.yaml` — `savePlaylist` rewrites the whole
  file on every modulation CRUD call and on defaults capture. **Never
  hand-edit a playlist YAML while the operator's stack is up**; it will be
  clobbered, or you will clobber the operator. Phase 2's rename **breaks
  saved `target.parameter` values** for any playlist entry bound to a
  `13_sparkle` slider — check first (`grep 'parameter: sliderLOW_Level'`
  across `simulation/scenes/*/playlists/`) and coordinate the edit with the
  operator rather than racing the engine. Load is lenient
  (`playlist_manager.js:171-183`) so a stale target silently disappears —
  that is a *silent* loss of the operator's work, the worst failure mode
  here.
- **The engine writes `marsin_engine/states/**` constantly** — that churn is
  expected residue, not your change.
- **CaptainPad duplicates the engine's modulation math** by hand
  (`Modulation.tsx:587-641`). If you touch `applyContinuousModulation`,
  touch both.
- **Three different "pretty name" implementations** exist
  (`Modulation.tsx:90`, `AllModulationsPanel.tsx:72`,
  `GlobalParams.tsx:134`). If the feature changes naming, unify or you will
  ship three different labels for one param.
- **`audio_mod_spec.mjs` must stay dependency-free and I/O-free** — the
  gallery generator and both harnesses import it directly.
- **Do not add a fallback for a missing/unparseable header block.** Today
  `parseAudioModSpec` returns `null` for "no block" and **throws** for
  "malformed block". Preserve exactly that split; a suggestion that silently
  vanishes is worse than no suggestion (codex P0).
- **Do not pre-select a suggested source in the picker.** The suggestion is
  metadata; the operator's saved mapping is truth. Auto-applying would
  rewrite playlists behind the operator's back.

---

## Method note

All probes were offline and in-process (`node -e` importing
`param_center.js` and `companion_config.js`, temp state file under the
scratch dir). **No ports bound, no engine/companion/CaptainPad process
touched, no tracked file modified** other than this report and the tracker
block.
