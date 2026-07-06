# 2026-06-21 — Adversarial review + fix: COMPANION + PATTERNS + TOOLS

Branch `dev/r2_companion_patterns` (worktree, parent `feat/audio_analysis_2`).
Scope OWNED: `marsin_engine/audio/companion/*` (server + ui/*),
`marsin_engine/patterns/*` (+ manifest.json), `marsin_engine/tools/*` audio
harnesses, and their `companion_*` tests. Did NOT touch
signals/analyzer/detector/postproc/config or CaptainPad.

Bar met: `node --test tests/companion_*.test.js` → 72/72 green. Manifest valid.
Dry-run on touched pattern exit 0. Companion boots; `/osc_accounting`, `/catalog`,
`/`, `/companion_app.css` all serve. Clean git status (only the 2 touched files).
Ports killed.

## FIXED (committed)

### Patterns
1. **`60_chest_thump.js` — silence floor lift (mission-critical visibility).**
   At `--synth silence --model titanic` it read the DIMMEST of all new patterns
   (peakChan **42/255**, below the 59/64/65/66 lifted-floor reference of ~60–90).
   Two coupled defects:
   - `export var base = 0.28` — low idle floor vs the sibling reference `0.42–0.46`.
   - `sliderBase(v){ base = v; }` was **unclamped** (operator could set base→0, fully
     dark) and its comment falsely claimed "mapped 0.18..0.70 by the engine" (the
     engine override only applies when audio-mapped; the operator handle passed raw
     `v`). Replaced with `base = 0.18 + v * 0.42` (0.18..0.60, never near-dark),
     matching 64/65/66 verbatim. Default raised to `0.42`.
   - Result: silence peakChan **42 → 60**, total brightness ~53k → ~76k on titanic.
     The chest-hit SLAM still reaches full output (max-composite), so the reactive
     look is unchanged; only the always-on floor was lifted. Dry-run exit 0.

### Companion (CSS — hardcoded hex → theme tokens; codex/UI "no hardcoded hex")
Found 6 spots using literal colors that did NOT restyle across the 5 `[data-theme]`
blocks. Each mapped cleanly onto an existing theme token; converted using the same
`color-mix(... var(--token) N%, transparent)` idiom already used elsewhere in the
file. No look change on the default `dark` theme (the literals WERE the dark values);
the other 4 themes now restyle these correctly:
2. `.status.ok/.err` backgrounds `rgba(52,211,181/255,93,108,.08)` → `color-mix(var(--ok)/var(--err))`.
3. `.sig-x` remove button `rgba(255,93,108,…)` + `#ff5d6c` + `#fff` → `var(--err)`/`var(--bg)` + color-mix.
4. `.viz-sub` `color:#566` → `var(--muted)`.
5. `.dot.ghost` `#888` → `var(--muted)`; `.dot.energy` dashed `rgba(255,255,255,.85)` → `color-mix(var(--text))`.
6. range thumb borders `#0c0f13` → `var(--bg)` (webkit + moz).
7. `.op.op-source` / `.op.osc-out` `#34d3b5` + `rgba(52,211,181,.06)` → `var(--ok)` + color-mix.

### Verified clean (no fix needed)
- **Manifest hygiene**: disk⇄manifest exact match (73 entries); `test_const`/
  `test_dualband` correctly excluded as dev helpers; no duplicate numbers; gaps at
  55/56 are intentional and consistent across disk+manifest.
- **All 5 `[data-theme]` blocks + `:root`** define every var used (`--bg --panel
  --panel2 --raised --border --text --muted --accent --ok --err --on-accent`).
  `--on-accent` is correctly a per-theme token (documented WCAG reason). No missing
  token → no silent-wrong-color P0.
- **No native-dialog leftovers**: `removeSignal`/`removeView`/`promptAddSignal` all
  use the themed `confirmModal`/picker; zero `window.confirm/alert/prompt`.
- **Pattern docs ⇄ keys**: every new pattern's `AUDIO_MODULATION_V1` block resolves
  to valid ParamCenter keys + valid slider targets (harness `DERIVED_MAP`, no MOD_FAIL).
- **Harness completeness** (`tools/pattern_derived_harness.mjs`): its onAnalysis
  mirror matches the engine's 21-key bundle exactly, INCLUDING the chroma keys
  (`micTonalStabilityRaw/ChromaFluxRaw/ChromaTiltRaw`). post==raw is a documented,
  correct default-rig simplification, not a gap.
- All new patterns 59–72 compile and animate at `--synth silence --model titanic`
  (peakChan ≥ 42 before fix, ≥ 60 after).

## FLAGGED FOR OPERATOR DECISION

1. **`61_riser_release.js` silence floor.** Lowest-but-one at silence (peakChan
   **48/255**); `base = 0.16` default and `sliderBase(v){ base = v * 0.3; }` (can
   reach 0 → fully dark). UNLIKE 60, darkness-at-rest is plausibly the INTENDED
   dramatic design — it is an anticipation/build pattern ("the rig visibly loads")
   whose whole point is to be dim until the build charges and the drop discharges.
   Lifting its floor to the 64/65/66 level would blunt that build/release contrast,
   so this is a LOOK/feel decision, not a safe floor-lift. **Decision needed:** lift
   61's floor to the ~0.42 sibling reference (full night-visibility, softer build),
   or keep it dark-at-rest by design? If lift is wanted I'll mirror the 60 fix.
   (68_riser_sweep is similarly low-total but ANIMATES strongly and peaks 78, so it
   reads; not flagging it.)
