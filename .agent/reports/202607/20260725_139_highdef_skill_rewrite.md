# `_139` — `highdef_pattern_generation` skill rewritten to the post-`_133`/`_135` pattern policy

**Scope (operator-commissioned):** rewrite
`.agent/skills/highdef_pattern_generation.md` — the last artifact still
teaching the overruled pattern policy. It is the **generator** skill: every
future pattern-writing agent, and the `_90` ChatGPT tuning loop, follows it, so
until it was rewritten it kept manufacturing dead knobs and non-portable
targeting.

**Files written (exactly three):**

- `.agent/skills/highdef_pattern_generation.md` — full rewrite (458 → 697
  lines).
- this report
- the tracker landing block in `.agent/memory/bm_readiness_thread_tracker.md`

**No code, doc, scene, model, config or pattern file was touched.** Branch
`feat/bm_readiness`. **No git operation of any kind. No live engine boot, no
port bound, no deploy, no install.** Every harness ran in-process from the
session scratchpad against the vendored WASM / pure library modules; ports
6966–6972, 5568, 8081 and 10000 were never touched. The tree's large volume of
other agents' uncommitted work is untouched.

---

## 1. What was overruled, and by which ruling

| Removed from the skill | Overruled by |
|---|---|
| The "four production bars" — audio-reactive PRIMARY `corr >= 0.5`, two colours `hueSpread >= 0.10`, non-repeating math, "high-def + bright" with `peakMaxChan >= 200` and true-black-ish negative space — as **universal** requirements | `MARSIN_ENGINE_PATTERNS.md` §1.6 (`_133` §1): "high-definition", true black, a mandated non-black floor, constant beat behaviour, party brightness, two-colour spread and per-pattern audio reactivity are all **explicitly de-mandated** |
| "Consistency ground rules" §1–7: a guarded `direction` on **every** pattern **plus** autonomous auto-reversal; "expose clearly audio-reactive knobs — at minimum a movement **radius** and a brightness **kick**" | `MARSIN_ENGINE_PATTERNS.md` §1.3 (direction is **conditional**, second **when present**; autonomous reversal demoted to OPTIONAL CAPABILITY, with `01_cylon_sweep` named as the pattern that auto-flip made unobservable) and §1.4 ("there is **no** required `radius`, `kick`, brightness punch, width, trail … do not invent controls to fill MIDI knobs") |
| §2 "The rig + coordinate model" table hard-coding `sectionId 1 = Pars, 2 = Vintage, 3 = Bars`, and the instruction *"Branch on `sectionId` for per-fixture behaviour"* | `MARSIN_ENGINE_PATTERNS.md` §7.2 — section ids are model-specific and are **never a portable taxonomy**; the Titanic uses values like 514/515. §7.3/§7.3.1 make `inView("Authored View Name")` the targeting layer |
| §8/§8.1 "Vintage blinder: `if (sectionId == 2) { …drive W hard… }`" as the headline white technique, and `whiteWarmth` tinting white "toward warm (amber `a`) vs cool/UV" | §7.2 (the branch never executes on the ship — the measured source of a large share of the 137 dead params) **and** §6.2, the `w == a` HARD CONTRACT: amber is not an independent authoring accent, warmth is shaped on RGB |
| `var N = 52;` as the buffer-sizing rule | §11.2 — 52 is a *test-bench* number; the Titanic is 964. Model-sized arrays are explicitly model-specific; prefer scalar/spatial formulations or the `feedbackTrails` global effect |
| The double-speed-adjacent framing and the old §6 "you get global speed free" narrative | §3 HARD CONTRACT — the engine owns the global speed clock; a pattern applies **only** `localSpeed`; `speed`/`size` are engine-owned and never injected |
| "Reinterpret a 00–25 pattern … most show patterns should be these" as a taste mandate, and the fixed "AUDIO (modulators-only)" free-text header | Retained in substance but re-scoped: the concept step is now artistic-idea-first, and the audio header is the **real** parseable `AUDIO_MODULATION_V1` block that `tools/audio_mod_spec.mjs` / `gen_variations.mjs` actually consume |

`_135` check 5 is what named this file as the remaining offender; `_133` §6
item 2 flagged it explicitly ("it now contradicts `docs/MARSIN_ENGINE_PATTERNS.md`
§1 and §7.2 and should be corrected in a follow-up, or it will keep
regenerating the dead-knob population"). The measurement behind the whole
policy is `_32`: **170 DEAD, 39 WRONG, 25 WEAK out of 817 controls**, with the
largest clusters being exactly the generically-mandated ones.

---

## 2. What the rewrite now says

Structure is **procedural** — ten numbered steps plus scale and gotchas. It
does not restate the guide; it links to it and defers on every contract, and it
carries the guide's three-tier vocabulary (HARD CONTRACT / PRODUCTION
CONVENTION / OPTIONAL CAPABILITY) with the instruction never to describe a
preference as a runtime rule.

- **§0** names what the old revision said and why each half is overruled, with
  report citations.
- **§2 parameter philosophy** — truthful/perceptible/independently-useful/
  effective-across-range; `localSpeed` first always; `direction` only when the
  concept has real directional motion, then **second**, endpoints visibly
  opposite, dead-zone guarded; everything else earns its place from the
  artistic idea; never invent a knob to fill a MIDI slot; identity-slider shape
  storing the raw value; declaration order = MIDI knob order with the 12-knob
  reality and the "a pattern never declares hue" rule.
- **§3 targeting** — `inView("Authored View Name")` only. The five instruments
  with pixel counts and emitters, the halves, `Stacks`/`Auditoriums`, and all
  **24 base group names verbatim**, with the spelling-irregularity warning
  (`Right SmokeStacks` plural vs `Left SmokeStack` singular; underscored strand
  groups; `TE Sign` / `TE Sign 2`; singular `Left/Right Auditorium` vs the
  composite `Auditoriums`). Unknown view names fail the compile loudly; the six
  forbidden aliases are listed as such. The five-instrument partition (exclusive
  + exhaustive, 964 px) is cited as what makes a per-instrument `if / else if`
  chain provably complete. Never hard-code a view's word or bit. `FIX_*` for
  capability; raw `sectionId`/`fixtureId` only for declared single-model work.
- **§4 timing** — engine owns the global clock, `localSpeed` trim only, the
  measured delta contract including the **`16, 16, <real>, <real>` first-frames
  quirk**, zero-step tolerance, the house divisors, and large-multiple phase
  wrapping (`34_moire_interference` named).
- **§5 colour/output** — RGB-space palette lerp, the `w == a` invariant with a
  compiling `rgbwau` example, "assign amber *from* white, never staple it on"
  (`13_sparkle / sliderAmberGlint` named), the per-instrument capability table
  (RGBWAU DMX for bars/pars; RGBW wire for ropes/vintage-rail pixels/signs with
  **amber folded into RGB and UV dropped**), and a six-item colour-theory
  checklist folded into the workflow: wash-warm/saturate-pixels, stacks-stay-
  warm **as operator-ruled guidance not an engine rule**, one-palette-many-
  positions (with the compiling per-instrument `inView` chain), dark paint as
  free negative space, Identity punctuates rather than competes, keep the
  Silhouette lit as *judgement*.
- **§6 portability** — `pixelCount` is a literal 144; don't hard-code a bench
  count either; the substitution table (scalar decay envelope / spatial
  smoothstep tail / `feedbackTrails`); a compiling portable-trail example;
  model-sized arrays must be labelled model-specific; state resets on
  recompile; coords already `0..1`; the 5000-instruction budget.
- **§7 audio** — modulators-only, not required per pattern, and the real
  `AUDIO_MODULATION_V1` block grammar with its hard-error-on-malformed rule.
- **§8 verification** — param-truth as the gate for the parameter policy
  (`--model titanic` default, `--cross-model`, `--out` to scratch), the audio
  harness **with `--gate` on every gate run** and the three named failure
  reasons, the QUALITY/AUDIO_REACT numbers re-labelled as **diagnostics rather
  than universal bars**, the derived harness, the CI tests, the discontinuity
  check.
- **§9–§12** — clips/gallery, manifest registration, the sub-agent fleet
  discipline, gotchas.

**"High-definition" is reframed** in the header and §0 as a *craft* bar
(controls that do not lie, motion that never re-locks, geometry that reads on
its instrument) and explicitly **not** a mandate for true black, a constant
beat, or party brightness — with the operator's ambient-dominant show
philosophy stated.

---

## 3. What was retained, and re-verified before keeping it

Every retained claim was checked against the current code/tool, not against the
old text.

| Retained | Re-verification |
|---|---|
| `tools/pattern_audio_harness.mjs` invocation shape | Header re-read; `--pattern --synth --frames --seconds --out-fps --max-cells --bpm --model --set --mod --out` and the range-aware `--mod` grammar `<sig>:<slider>[:<min>:<max>[:<curve>]]` confirmed in source |
| `--gate` usage (operator instruction; `_90` depends on it) | Confirmed: `--gate` only changes the **exit code** (3), the verdict always prints. Named reasons `DARK` / `BLACK_LATCH` / `OVER_BUDGET` and the defaults `--gate-frames 600`, `--budget-ms 25`, `--mix-channels 4`, `--max-dark-frac 0.5` read from source. `GATE_WARN DIM` is advisory. **The skill now passes `--gate` on both harness invocations** (checked mechanically) |
| Harness output lines | `COMPILE_OK`, `TOTAL_BRI … (ANIMATING\|LOW-VARIATION)`, `LIT_BY_SECTION`, `QUALITY hueSpread=… peakMaxChan=…`, `AUDIO_REACT …corr(signal,brightness)=…`, `GATE …`, `GATE_PASS`/`GATE_FAIL`, `OUT=` — all read from the emit sites. **Corrected two stale thresholds**: the tool labels `(REACTIVE)` above \|0.35\| (not 0.5) and flags two-colour above `hueSpread` 0.06 (not 0.10); both are now presented as tool heuristics, not bars |
| Synth bank | `tone kick_4floor bassline hats chord_stab chord_progression riser edm_drop full_track sine_sweep white_noise silence` enumerated from `audio/synth/test_synths.js`; only names in that set are cited |
| `tools/make_vis_clip.mjs` flags | `--in --out --fps --layout strip\|map\|auto --view top\|front\|auto`, `auto` = strip for `test_bench` / map for other rigs — confirmed in source, matching the skill |
| `tools/gallery/publish.mjs` + `server.mjs` | `--name --capture --in --fps --model --layout --view`; `<pattern>__<model>.html` naming; port from `gallery_config.json` (6965) — confirmed |
| `--seconds 10` real-time clips, `--out-fps 20`, big-rig auto-downsample with a printed `DOWNSAMPLED:` line | Confirmed in the harness header + `--max-cells` logic |
| The sub-agent fleet discipline (one pattern per agent; manifest + git central; orchestrator independently re-runs the gate) | Kept; the re-run instruction now points at the two real gates |
| `patterns/manifest.json` registration; `patterns/examples/` stays unregistered | Manifest is a flat array of stems; `inview_demo` is absent from it (0 matches) |
| Engine-boot state residue | Kept as "report it, do not silently revert it" (matches `AGENTS.md` and `MARSIN_ENGINE_PATTERNS.md` §13); the old "`git restore marsin_engine/states/ simulation/` after any boot" instruction was **dropped** — it contradicts the repo's no-hiding-side-effects rule |
| Reserved-identifier list | Widened to the current seven metadata builtins + `pixelLocalIndex` + `viewMaskHi`, with the `(viewMaskHi & MASK)`-only restriction, per `MARSIN_PB_LANG_SPEC.md` §2.4 |
| Incommensurate-ratio / phase-wrap guidance | Kept verbatim in substance (§4) — still true and still the fix for the `34_moire_interference` seam |
| Referenced skills | `pattern_gallery.md`, `visualize_patterns_widget.md` exist; the old numeric shorthand ("skill `08`", "skill `13`") is replaced with real relative links |

**New material that did not exist in the old skill:** the `AUDIO_MODULATION_V1`
block (62 of 68 top-level patterns already carry one), `tools/param_truth/`
as the parameter gate, `tools/pattern_derived_harness.mjs`,
`tools/gallery/gen_variations.mjs`'s static/sound variation pairing, and the
`--out`-to-scratch warning for param-truth.

---

## 4. Verification evidence (offline, in-process)

A scratchpad harness (`verify_139.mjs`) drives the **real** engine machinery:
`tools/param_truth/render_context.js` → `loadModelForGauge('titanic')` +
`buildMaskConstants()` + `WasmHost.setViewTable()` + `createBitFreeViewPromoter()`
— i.e. the same compile path `engine.js` uses at load, on the 964-pixel ship.

```
[1] 9 javascript block(s) found
    titanic render context: 964 px
  PASS  block @ line 96 compiles (2 exports)
  PASS  block @ line 113 compiles (2 exports)
  PASS  block @ line 144 compiles (2 exports)
  PASS  block @ line 176 compiles (0 exports)
  PASS  block @ line 243 compiles (0 exports)
  PASS  block @ line 270 compiles (2 exports)
  PASS  block @ line 332 compiles (0 exports)
  PASS  block @ line 384 compiles (0 exports)
  PASS  block @ line 425 compiles (4 exports)

[2] view table: 41 authored names
  PASS  every concrete inView("…") resolves (8 distinct strings)
        Authored View Name | Hull Canvas | Identity | Jewelry | Organs |
        Silhouette | Stacks | …          (the last two are placeholders)

[3] referenced paths
  PASS  all 29 referenced paths exist

[4] banned content
  PASS  no sectionId == N taxonomy (1 guarded mention)
  PASS  no double global-speed multiplier
  PASS  no file:/// links
  PASS  no legacy .agent/01_skills or .agent/00_gol paths
  PASS  no IPv4 literals
  PASS  w == a on all 1 rgbwau() call(s) in examples

[5] backticked view names
  PASS  41 backticked view names all authored; 6 are the deliberate
        "do not exist" aliases

[6] base-group list completeness
  PASS  all 24 base group names appear verbatim

[7] --gate on harness invocations
  PASS  all 2 pattern_audio_harness invocations pass --gate

ALL CHECKS PASSED
```

Method notes:

- **[1]** every fenced ```javascript``` block is compiled independently through
  `WasmHost.compile()` on the titanic context. A block using `inView()`,
  `rgbwau()`, `FIX_PAR`, `pow`, `smoothstep`, `wave` or a reserved-name mistake
  would fail here. All nine compile.
- **[2]** `inView` strings are resolved against the view table rebuilt exactly
  as `engine.js` does (groupBits word 0 + viewMasks word 0/1). The only
  non-resolving strings are the deliberate generic placeholders.
- **[4]** the single guarded `sectionId ==` mention is the §0 sentence naming
  the *old* behaviour as wrong on the ship. Zero occurrences in any code block.
- **[5]/[6]** cross-checks that no backticked capitalised token in the file
  claims to be a view unless it is one — and that all 24 base groups are listed
  verbatim, so an author copying from this file cannot pick up a mistyped name.
- **Negative control:** compiling `inView("All Bars")` through the same context
  produced the expected hard error — *"Pattern references unknown view(s) via
  inView(): All Bars. Known views for this model: …"* — confirming the
  fail-loud claim the skill makes.

**Security:** `python scripts/security_check.py --all` → **6 findings, all
pre-existing, all in untracked `simulation/.scene_backups/studiodj/**`
(`bm26-mac-address`).** **Zero findings in
`.agent/skills/highdef_pattern_generation.md`**, this report, or the tracker.
No future dates, no IPs, no MACs, no `file:///`.

---

## 5. Finding — a real tooling gap, documented rather than papered over

**`tools/pattern_audio_harness.mjs` cannot compile an `inView()` pattern.**
Measured, not inferred:

```
node tools/pattern_audio_harness.mjs --pattern <scratch>/zz_probe.js \
  --model titanic --synth silence --frames 8
→ COMPILE_FAIL: Line 4: strings cannot be used as a function argument
```

Cause: the harness drives `lib/marsin_wasm_runtime.js` directly and applies
**only** `injectFixtureConstants()` (its own comment already says "`MASK_*`
injection is NOT mirrored here"). `WasmHost.compile()` applies three passes —
`injectInViewIntrinsic()` → `injectMaskConstants()` → `injectFixtureConstants()`
— so the view table and `MASK_*` are missing offline.

Everything built on that harness inherits the gap, including
`tools/gallery/gen_variations.mjs` (the static/sound clip generator) and
therefore the offline titanic clip path.

**How the skill handles it:** §8.2 carries an explicit, measured
"Known tooling gap" note — an `inView()`-targeted pattern is gated by
**§8.1 param-truth (full engine parity, view table included)** plus the CI
tests, and its clip comes from a live capture (`tools/capture_vis.mjs`,
operator-run). The note **forbids the tempting workaround** of rewriting
`inView()` targeting back into coordinates or `sectionId` — which is precisely
the regression this rewrite exists to stop.

**Recommended fix (not made here — out of scope, and it is a shared tool other
agents are working in):** mirror `WasmHost.compile()`'s injection in the
harness — build `viewTable` + `maskConstants` from `loadModelForGauge(model)`
and run `injectInViewIntrinsic()` / `injectMaskConstants()` before
`injectFixtureConstants()`. `render_context.js` already does exactly this and
is the working reference. Filed as a follow-up.

---

## 6. Compliance statement

- Writes confined to `.agent/skills/highdef_pattern_generation.md`, this
  report, and the tracker landing block.
- **No git command of any kind** — not `status`, `diff`, `show`, `ls-files`,
  `add`, `commit`, `restore`, `checkout`, `branch` or `stash`. Tracking status
  was established from `.gitignore` instead, and the skill's wording says
  "not gitignored" rather than asserting more than was measured.
- **No live engine boot, no sim server, no save server, no port bound.** Every
  harness ran in-process against the vendored WASM and the pure library
  modules; `run_param_truth.mjs` (used once, on `27_swipe --model titanic`, to
  confirm the documented invocation works) opens no socket and its output went
  to the scratchpad, not to `tools/param_truth/param_truth_results.*`.
- **No deploy, no `npm install`, no `package.json` / lockfile change.**
- All scratch files (`verify_139.mjs`, `probe1.mjs`, `zz_probe.js`, the
  param-truth probe output) live in the session scratchpad — **nothing was
  written into the source tree**.
- Other agents' uncommitted work in this tree is untouched.
