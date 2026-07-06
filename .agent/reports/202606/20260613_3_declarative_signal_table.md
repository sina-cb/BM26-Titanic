# Slot 3 — declarative_signal_table

- **Branch:** dev/claude/declarative_signal_table
- **Parent branch:** claude/laughing-lamport-tb6cc9 (Wave-1 merged tip)
- **Worktree:** ~/BM26-Titanic-worktrees/declarative_signal_table
- **Slot ports:** engine 31368, sim 31369, metro 31381 (none booted — no
  server was needed; the HIL test boots its own ephemeral engine).

## Scope

Made the AUDIO signal family declarative. Until this slice, adding one audio
live signal required editing FIVE places in lockstep (KNOWN_SIGNALS,
param_center.js registry, DEFAULT_CHAINS, osc_listener.js maps, CaptainPad's
hardcoded `liveKeys` Set) and they drifted. This slice introduces
`marsin_engine/lib/audio_signals.js` as the single source of truth — a
declarative descriptor table for the audio family (mic bands+kick+flux,
stems, their `*Gain` and `*Raw` mirrors, tempoBpm, and the 5 detector keys) —
and DERIVES the four engine-side structures and CaptainPad's live-key set
from it. This is a pure REFACTOR: every generated structure is byte-identical
to its pre-refactor hand-written form (verified by a snapshot test plus a
direct schema-equality probe against git HEAD).

## Files changed

```
A  marsin_engine/lib/audio_signals.js          (new — single source of truth)
M  marsin_engine/lib/param_center.js           (audio block → ...audioRegistryEntries())
M  marsin_engine/lib/signal_post_processor.js  (KNOWN_SIGNALS + gain DEFAULT_CHAINS derived)
M  marsin_engine/lib/osc_listener.js           (GAIN_BY_KEY derived from table)
M  CaptainPad/hooks/useEngineState.ts          (live keys seeded from engine schema)
A  marsin_engine/tests/audio_signals.test.js   (new — refactor guard / snapshot pin)
```

### What was derived from `audio_signals.js`

- `param_center.js` — the entire hand-listed audio block is replaced by
  `...audioRegistryEntries()`, spliced in the SAME registry position
  (between the colors and the BPM-sync params) preserving registry order.
  Every NON-audio entry (speed, size, rotate, colors, bpmSpeed*) is left
  exactly as-is.
- `signal_post_processor.js` — `KNOWN_SIGNALS = processedSignalKeys()` and
  the gain-only `DEFAULT_CHAINS` entries come from `defaultGainChainFor()`.
  The special `micKick` Envelope→Schmitt→Hold default stays hand-written
  there (its DSP-tuning params are post-processing behaviour, not family
  metadata) — but even its leading Gain op id + paramKey come from the
  table. The op catalog (OP_SCHEMA) and the normalizer op are untouched.
- `osc_listener.js` — `GAIN_BY_KEY` is `Object.freeze(gainByKeyForOsc())`.
  The `<key>Raw` mirror map was ALREADY derived at construction time from
  the registry (`registryByKey[rawKey]`), so it needed no change — it now
  tracks the table automatically.

### CaptainPad path taken

Took the FULL "seed from engine schema" path (the preferred option). The
hook already fetched `GET /param-center/schema` into `_cached.paramSchema`,
and each schema entry already carries a `live` boolean. I replaced the
hardcoded `liveKeys` Set with `_liveKeysFromSchema(schema)` (the `live:true`
keys) via a new `_seedLiveFromSchema()` helper. Because the `/param-center`
value-seed and the `/param-center/schema` fetch run in PARALLEL, the schema
may not have landed when the value-seed runs — per Codex P0 there is NO
hardcoded fallback: the live set is simply empty for that frame (the exact
"acceptable worst case" the old comment named), and the schema-fetch `.then`
re-runs the extraction against the cached sharedParams the moment it lands,
so cold-boot meters still get a correct first paint without waiting for the
WS `liveParams` tick.

## Tests run

- **Unit:** `node --test tests/*.test.js` → **585 pass / 0 fail**
  (579 pre-existing + 6 new in `audio_signals.test.js`).
- **HIL:** `node --test tests/hil/hil_ws_topic_split_test.mjs` →
  **39/39 PASS, 0 fail** (1 top-level test, 39 internal `✓ PASS` assertions).
- **New test** `audio_signals.test.js` pins: the derived audio-family
  registry deep-equals a hand-written pre-refactor snapshot (count + order +
  every field), the ParamCenter schema carries those entries with identical
  fields, `KNOWN_SIGNALS` is unchanged as an ordered list AND as a set,
  `DEFAULT_CHAINS` matches the pre-refactor gain defaults + micKick chain,
  and `GAIN_BY_KEY` is byte-identical (ordered).
- **Byte-identity probe:** generated `getSchema()` (38 entries) === git-HEAD
  `getSchema()` — confirmed identical before writing the test.
- **Engine auto-check:** `git diff --check` clean; `node --check` on all 5
  changed/new engine files OK; `node engine.js --dry-run` exits 0, no
  missing-blend/transition warnings.
- **CaptainPad:** `npx tsc --noEmit` → only the **2 PRE-EXISTING** errors in
  `components/Modulation.tsx` (transitionDuration), **ZERO new errors**.
  `npm run lint` (expo lint) → 0 errors, 14 pre-existing warnings, none in
  `useEngineState.ts`.

## Known gaps / follow-ups

- `audio_signals.js` is engine-side only; CaptainPad reads the live-key set
  over HTTP (correct — the iPad must not import engine source). If the engine
  is unreachable at boot, CaptainPad shows no live meters until the WS
  reconnects — same as before this change, by design (P0: no fake fallback).
- The micKick trigger-chain params still live in `signal_post_processor.js`.
  That is intentional (behaviour, not family metadata) and documented in both
  files; a future slice could move op-level DSP defaults into the table if
  the operator ever wants per-band non-gain defaults.

## Operator action requested

Ready for review and merge. This is the last slice; suggest merging it LAST
(it edits shared engine files — param_center.js, signal_post_processor.js,
osc_listener.js — so it should land against the cleanest tip per §8.2). No
residual behavior risk: every derived structure is pinned byte-identical by
the new test and the full suite + HIL are green.
