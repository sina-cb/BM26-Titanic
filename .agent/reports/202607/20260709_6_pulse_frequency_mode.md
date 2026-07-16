# 20260709_6 — Pulse: consolidate strobe frequency variants into ONE moded effect

**Project:** effects_v2_midi_layout (Track E — engine)
**Branch:** feat/party_integration_20260711 (work in place, no git ops)
**Zone:** `marsin_engine/effects/strobe.js`, the `strobe` entry +
`PRIMARY_MODE_REGISTRY` / `normalizeModeDescriptor` in
`marsin_engine/lib/global_effect_library.js`, `marsin_engine/tests/*`.
Did **not** touch `lib/vsn1_layout_deploy.js`, `lib/global_effect_slot_manager.js`,
or `lib/api_server.js` (parallel agent owns those).

## What Sina asked for

The `strobe` effect ("Pulse") had FIVE presets that were just different
frequencies — each a separate slot choice. Consolidate them into ONE moded
"Pulse" effect: jog-wheel = Flash Strength (unchanged), encoder press =
Frequency (5 steps). Keep backward-compat loud, keep the [1..20] Hz safety.

## What I did

1. **Name → "Pulse".** `GLOBAL_EFFECT_LIBRARY.strobe.name` changed from
   `'Software Sync Strobe'` to `'Pulse'` (frequency dropped from the name; it
   now lives on the mode wheel). No test asserted the old name string.

2. **`primaryMode` = Frequency.** `strobeEffect.primaryMode` now declares the
   exact registry-validated shape (mirrors beatPump/feedbackTrails/colorWash):
   `{ label: 'Frequency', param: 'hz', values: [2,4,5,10,20], default: 2,
   valueLabels: [...] }`. Cycling (encoder press → `cycleSlotMode`) walks the
   five frequencies and writes the chosen Hz into the slot's `hz` param
   override — which flows through `validateParams('strobe',…)` and is re-checked
   against the [1..20] safety range on every step.

3. **Per-value display labels.** The registry's `normalizeModeDescriptor`
   gained an **optional** `valueLabels` field: a string array parallel to
   `values` (same length, validated loud on a length/type mismatch, absent =>
   `null`). Every other effect omits it (unchanged). Surfaces render these on
   the VSN1 LCD + CaptainPad so the operator reads a real name, never "M1/M2".
   The five labels: **`2 Hz · 1/4`, `4 Hz · 1/8`, `5 Hz Punch`, `10 Hz Hard`,
   `20 Hz Max`**.

4. **`primaryIntensity` untouched** — still `{ label:'Flash Strength',
   param:'intensity', default:1.0, min:0, max:1 }`. On Pulse, intensity = flash
   strength: how hard the ON frame slams. Jog and encoder-press are independent
   (they write `intensity` and `hz` respectively).

## The five frequencies + rationale

| Value | Label | Musical role (~120–128 BPM electronic) |
|---|---|---|
| **2 Hz** (default) | `2 Hz · 1/4` | Quarter-note pulse @ 120 BPM — safe, most musical default |
| 4 Hz | `4 Hz · 1/8` | Eighth notes — driving |
| 5 Hz | `5 Hz Punch` | Off-grid punch |
| 10 Hz | `10 Hz Hard` | Hard machine-gun strobe |
| 20 Hz | `20 Hz Max` | Ceiling flutter |

**Why not re-grid to strict beat divisions:** the existing preset set
(2/4/5/10/20) already spans quarter-note → ceiling, and — decisively — those
five values are the frequencies of the five KEPT preset keys and appear in
state files / `DEFAULT_SLOT_CONFIG`. Keeping the mode values identical to the
preset frequencies keeps mode ↔ preset in lockstep and avoids any divergence or
migration risk. The task said "refine only if you have a clear musical
rationale"; the lockstep + compat argument outweighs a cosmetic re-grid, so the
values are unchanged and the labels carry the beat framing.

## Backward compatibility

**Chosen migration: KEEP all five preset keys** (`pulse_2hz`, `sync_4hz`,
`punch_5hz`, `hard_10hz`, `max_20hz`) verbatim, each with its display label +
safety tier. Existing playlists / `states/*.yaml` / `vsn1_layout.json` /
`DEFAULT_SLOT_CONFIG` references (slots 1 `sync_4hz`, 6 `max_20hz`, plus the
`states/summer_camp_*` + `test_bench` YAML) all still resolve to the right Hz —
zero breakage, nothing to migrate. The consolidation is at the NAME + mode
level (one "Pulse" slot can now cycle frequencies instead of needing five slots),
not a preset removal.

A *genuinely* unknown preset id (not one of the five) is handled by the
pre-existing slot-manager forward-compat path (`resolveSlotBinding`), which
canonicalizes to the first declared preset (`pulse_2hz`, 2 Hz) and
`console.warn`s loudly — never silently pointed at a phantom preset. That path
is owned by `global_effect_slot_manager.js` (not my zone) and is only reachable
for an id that was never real; I removed no real ids so no live reference hits it.

## Safety

Every mode frequency (2,4,5,10,20) is inside the strobe `[1..20]` Hz safety
range and passes `validateParams('strobe',{hz})`. `setSlotMode` re-runs that
validation via `resolveSlotBinding` on each step, so the safety gate holds for
every mode value; `21` / `0.5` still throw.

## Tests

- Updated `tests/effects_v2_mode_page_layout.test.js`: the stale
  `getPrimaryMode('strobe') === null` assertion → now asserts `param:'hz'`,
  `values:[2,4,5,10,20]`.
- New `tests/pulse_frequency_mode.test.js` (18 tests): name = "Pulse";
  primaryMode validates at load + exact frozen shape; five value-labels present
  and non-placeholder; valueLabels length/type contract fails loud; cycle walks
  all 5 Hz + wrap and writes `hz`; off-list Hz rejected; intensity still = Flash
  Strength and independent of mode; every frequency passes safety validation;
  live apply updates `strobeConfig.hz`; all five legacy preset keys resolve to
  the right Hz; unknown-preset fallback is loud, not silent.

**Tally:**
- Pulse + related effect/library/slot/timeline files
  (`pulse_frequency_mode`, `effects_v2_mode_page_layout`,
  `global_effect_macros`, `global_effect_intensity`, `party_mode`,
  `blend_mode_validation`, `timeline_show_plan`): **188/188 pass**.
- Full engine suite: **1987/2032 pass, 44 fail, 1 skip.** All 44 failures are
  pre-existing infra fails on this sandboxed Windows box — the entire
  `tests/hil/*` suite (spawns the engine + servers + audio) plus 6
  socket/stream tests in `audio_capture.test.js` / `osc_listener.test.js`
  (EACCES/EADDRINUSE on port bind, spawned child processes). None touch effects,
  strobe/pulse, the library, or the slot manager. (Larger than the "6 known env
  fails" note because the full HIL suite ran; my change is pure library
  metadata and cannot affect socket binding or HIL rendering.)

Engine NOT restarted (per instructions).

## Files changed

- `marsin_engine/effects/strobe.js` — `primaryMode` Frequency descriptor + doc.
- `marsin_engine/lib/global_effect_library.js` — `name: 'Pulse'`; optional
  `valueLabels` support in `normalizeModeDescriptor` + doc.
- `marsin_engine/tests/effects_v2_mode_page_layout.test.js` — updated strobe
  mode assertion.
- `marsin_engine/tests/pulse_frequency_mode.test.js` — new (18 tests).

## Follow-up for the parallel/UI tracks (not my zone)

`getPrimaryMode('strobe').valueLabels` now carries the LCD/CaptainPad strings,
but `global_effect_slot_manager.js._resolveModeInfo` currently surfaces only
`modeValues` + `modeLabel` in slot status — it does not yet pass `valueLabels`
through. Whoever owns the slot manager / device rendering should add
`modeValueLabels: desc.valueLabels` to the status surface so the VSN1/CaptainPad
show "2 Hz · 1/4" instead of the raw `2`. The engine-side data is ready.
