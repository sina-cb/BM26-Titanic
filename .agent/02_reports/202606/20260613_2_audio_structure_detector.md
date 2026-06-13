# Audio Structure Detector (docs/30 Phase 1) + micFlux primitive

- **Branch:** `dev/claude/audio_structure_detector` (worktree, slot 2)
- **Parent branch:** `claude/laughing-lamport-tb6cc9`
- **Worktree:** `~/BM26-Titanic-worktrees/audio_structure_detector`
- **Date:** 2026-06-13
- **Mode:** developer (04.2 marsin_engine_expert) — engine-only, observe-and-publish
- **Spec:** `docs/30_[todo]_audio_structure_detector.md` (Phase 1) with the
  feasibility-review corrections in
  `.agent/02_reports/202606/20260612_2_audio_analysis_review_docs30_feasibility.md` §2
  folded in (they override the doc where they conflict).

---

## What shipped

Two coherent, dependent pieces:

### Piece A — `micFlux` spectral-flux primitive
Half-wave-rectified spectral flux (SuperFlux-lite, Böck & Widmer 2013;
research memo §A2) computed in the analyzer's `_analyzeOnce()` by keeping
the previous hop's magnitude spectrum and summing rising-only per-bin
deltas: `flux = Σ_k max(0, |X[k]|now − |X[k]|prev)`. Normalized through
the SAME `/ fftSize` + `softCompress(PRE_CLAMP_GAIN·E)` mapping as the
bands so it lands in [0,1] like them. Emitted as a new `flux` field on
`onAnalysis({low,mid,high,kick,flux})` — the four existing outputs are
byte-for-byte unchanged. `_prevMag` is reset in `reset()`.

Wired through as a normal live signal: `micFlux` runs the chain framework
(`signalPostProcessor.process('micFlux', flux, dt)`) and lands on CPC
alongside a `micFluxRaw` mirror, with `micFluxGain` as the operator gain.

### Piece B — Audio Structure Detector
New `marsin_engine/lib/audio_structure_detector.js` — a class with
`tick(now, dt)`, `reset()`, `getStatus()`, `dispose()`, constructed with
`{paramCenter, broadcast, getConfig}`. Pattern-after `modulation_controller.js`.
Pure JS, no new deps, no WASM. **Observe-and-publish only — never triggers
any irreversible action.** Disabled by default; `tick()` no-ops (and resets
once on the enable→disable edge) until `audio.structureDetector.enabled`
flips true via `PATCH /audio/config`. Wired into the analyzer
`onAnalysis` callback (lowest latency, auto-pauses when the analyzer is off).

3-state machine THIN→BUILD→SUSTAIN with: short/long energy IIRs →
log-mapped `audioEnergyRatio`; flux-driven `audioBuildScore` EMA; stems
booleans; a decaying `audioDropPulse`; and a sparse `dropFired` WS event
on the drop edge.

### Review corrections applied (override the doc)
1. **Consumes RAW pre-gain mirrors** (`micLowRaw`, `stemsBassRaw`, …) so it
   models the music, not the operator's gain sliders. Uses the new
   `micFlux` for the build-score flux input.
2. **`audioStructure` is a float-encoded enum** (0.0/1.0/2.0), range [0,2]
   — no int-typed live keys in this codebase.
3. **Explicit trend trackers** with timestamp state ("energyRatio rising
   for >1s", "<0.3 for >1s", "buildScore decaying vs peak").
4. Open Questions answered in code: `buildDurationMs` in the `dropFired`
   payload; N=3-in-30s → 60s self-quiet surfaced in `getStatus()`;
   `barPhase` not bound on this rig → `nearDownbeat` defaults true,
   `getStatus().barPhaseAvailable:false`.
5. 2 s `dropFired` refractory.

Stems freshness is a HARD prerequisite (codex P0): the detector stamps its
own per-write timestamps via `paramCenter.subscribe` and degrades loudly
when stems are stale (booleans false, lower confidence,
`getStatus().structureDetectorStems === 'offline'`) — it never pretends a
stale `stemsBass=0` is real. A `paramCenter` write failure latches the
detector off for the session (no silent retry).

**Freshness-clock note:** stem freshness is stamped on the SAME clock
`tick(now)` is driven by (the analyzer hop clock), not wall time — the
engine passes `Date.now()` as `now` so they coincide in production, but
this keeps the detector correct under any DI'd/synthetic clock.

---

## Files changed (all my intended diff)

| File | Change |
|---|---|
| `marsin_engine/lib/audio_structure_detector.js` | **NEW** — detector module |
| `marsin_engine/lib/audio_analyzer.js` | flux primitive (+`_prevMag`) + `flux` on `onAnalysis`; reset clears `_prevMag`; doc comments |
| `marsin_engine/lib/param_center.js` | +`micFlux`, `micFluxRaw`, `micFluxGain`, and 5 detector live keys |
| `marsin_engine/lib/signal_post_processor.js` | tiny: `micFlux` in `KNOWN_SIGNALS` + `DEFAULT_CHAINS` (single Gain `micFluxGain`) |
| `marsin_engine/lib/ws_topic_routing.js` | `dropFired: TOPICS.CONTROL` |
| `marsin_engine/lib/audio_config.js` | `structureDetector` live group + validators + boolean-`enabled` branch in `validateLivePatch` |
| `marsin_engine/engine.js` | import + always-construct detector at bootstrap; `micFlux`/`micFluxRaw` in the onAnalysis bundle; `detector.tick()` call |
| `CaptainPad/hooks/useEngineState.ts` | +`micFlux` and the 5 detector keys in the hardcoded `liveKeys` Set |
| tests | new detector test + analyzer/audio_config/spp/ws-routing/HIL extensions |

### Exact touched lines (for predicting conflicts with the declarative-table refactor)
- **`signal_post_processor.js`**: line 56 (`KNOWN_SIGNALS` — added `'micFlux'`);
  lines 85–87 (`DEFAULT_CHAINS.micFlux` single Gain entry). Both are the
  "tiny, localized" additions requested to keep the merge with slot 1 trivial.
- **`param_center.js`**: line 194 (`micFlux`), 232 (`micFluxRaw`), 262
  (`micFluxGain`), 276/282/288/294/300 (`audioStructure`/`audioBuildScore`/
  `audioEnergyRatio`/`audioVocalsHot`/`audioDropPulse`). All are new registry
  entries inserted between existing blocks — a declarative-table refactor that
  rewrites the registry will need to absorb these 8 keys.
- **`engine.js`**: line 36 (import); 1214/1219 (construct detector + stash on
  `audioState`); 1321 onAnalysis destructure now includes `flux`; 1329
  (`fluxPost`); 1341 (`micFlux` in setMany); 1346 (`micFluxRaw` in setMany);
  1352 (`audioStructureDetector.tick`). The setMany bundle grew from 8 to 10 keys.
- **`useEngineState.ts`**: line 588 (`micFlux` appended to mic row); 593–594
  (5 detector keys added to the `liveKeys` Set near line 587).

---

## Tests — ALL PASS

Required unit suites (single run):
```
node --test tests/audio_analyzer.test.js tests/audio_structure_detector.test.js \
  tests/audio_config.test.js tests/signal_post_processor.test.js \
  tests/param_center.test.js tests/ws_topic_routing.test.js
# tests 182 · pass 182 · fail 0
```

- `audio_structure_detector.test.js` (NEW, 9 tests): THIN→BUILD→SUSTAIN on a
  rising-energy+flux ramp; `dropFired` emits once on an energy jump with fresh
  stems and respects the 2 s refractory + the self-quiet; disabled→tick is a
  no-op and zeroes keys; enable→disable edge resets; stems-stale degrades
  (vocalsHot false, `structureDetectorStems==='offline'`); `reset()` returns
  to THIN; constructor guards.
- `audio_analyzer.test.js` (+4): `flux` present/finite/[0,1]; ~0 on a steady
  tone across hops; spikes on a sudden broadband change; settles post-reset.
- `audio_config.test.js` (+4 and contract update): `structureDetector` group
  accepted; non-boolean `enabled` rejected; out-of-range threshold rejected;
  unknown field rejected. **Also fixed a PRE-EXISTING failure**: the
  `AUDIO_LIVE_FIELDS is the contract surface` deepEqual was already stale on
  baseline (it omitted `kickEma`, which the source had added without updating
  the test) — updated to include `kickEma` + `structureDetector`.
- `signal_post_processor.test.js` (+micFlux): `KNOWN_SIGNALS` now 8 signals;
  `fullGainPC()` gains `micFluxGain` so the DEFAULT_CHAINS persistence
  round-trips still pass.
- `ws_topic_routing.test.js` (+`dropFired` in the control-topic list).

HIL: `tests/hil/hil_ws_topic_split_test.mjs` — **PASS**. Added `dropFired`
to the test's `EXPECTED_TOPIC_BY_TYPE` snapshot, and also `audioChainsChanged`
which was a PRE-EXISTING drift blocking this test on baseline.

CaptainPad `npx tsc --noEmit`: ran. Reports **2 pre-existing errors in
`components/Modulation.tsx`** (`transitionDuration` on ViewStyle) — confirmed
present on baseline WITHOUT my change; my `useEngineState.ts` edit (string
literals into a `Set<string>`) adds no new type errors.

---

## Notes / residue

- **Worktree-stability incident:** mid-task an external `git` operation in the
  shared worktree swept my then-uncommitted working changes into `stash@{0}`
  (and left unrelated engine-runtime residue: `config.yaml playlist.active`
  toggle, `states/summer_camp_dome/*` deck/mixer YAML, and deleted
  `simulation/.../playlists/*.yaml`). Recovered the full diff via
  `git stash pop`; reverted the runtime `config.yaml` change. The state-file /
  playlist residue is NOT mine and was left unstaged / uncommitted — flagging
  it so the operator knows it predates or is parallel to this work.
- Detector defaults live in `DETECTOR_DEFAULTS` in the module AND are
  range-checked in `audio_config.js`. Disabled by default; verifiable purely
  with `curl` + log tailing (Phase 1 has no iPad UI beyond the seed-list entry).
- Not booted: no engine/sim run (engine-only unit + HIL coverage). I merge
  nothing — operator/parent merges.
