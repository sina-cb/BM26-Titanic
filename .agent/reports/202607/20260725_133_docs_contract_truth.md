# 20260725_133 — Documentation contract truth sweep (Sub-agent A)

**Scope:** bring `docs/COLOR_THEORY.md`, `docs/MARSIN_ENGINE_PATTERNS.md` and
`docs/MARSIN_PB_LANG_SPEC.md` into agreement with the current engine, the
current WASM runtime, the finished Titanic mapping, and the operator's creative
decisions.

**Files changed (exactly three, plus this report and the tracker block):**

- `docs/COLOR_THEORY.md` — rewritten around the five instruments.
- `docs/MARSIN_ENGINE_PATTERNS.md` — restructured: hard contracts first,
  production conventions second, recipes last.
- `docs/MARSIN_PB_LANG_SPEC.md` — targeted corrections (§1.3–1.5, §2.4, §5.1,
  §5.2 + new §5.2.1/§5.2.2, §6.5.2/§6.5.3, §6.6, §9.3, §9.5, §11, §12.3, §12.4,
  §13.2, §13.4, §14). Version bumped 2.2 → 2.3 with a changelog naming every
  withdrawn claim.

**No code, scene, model, or config file was touched.** In particular
`simulation/scenes/titanic/views.yaml` and
`marsin_engine/models/titanic.viewmasks.js` were read only — Sub-agent B owns
those.

---

## 1. The corrected parameter philosophy

The old §0 "consistency ground rules" forced `direction`, autonomous direction
reversal, a movement `radius`, a brightness `kick`, two palette colours
spanning the rig, true-black negative space, `peakMaxChan >= 200`, and
never-static-at-zero-audio onto **every** pattern. That is now replaced.

**The binding rule, as written:**

- Every production pattern has a **truthful `localSpeed`**, and it is the
  **FIRST** local control. Truthful = motion visibly accelerates/decelerates
  across the range.
- **Direction exists only when the pattern's visual concept has meaningful
  directional motion.** When it exists it is the **SECOND** local control, its
  endpoints must visibly produce opposite motion, and it must not freeze at
  slider centre (dead-zone guard retained).
- **Autonomous direction reversal is demoted to an OPTIONAL CAPABILITY**, with
  the warning that layering an auto-flip over a manual `direction` is exactly
  what made `01_cylon_sweep`'s direction unobservable.
- **No other generic slider is required** — no radius, kick, brightness punch,
  width, trail. Every other control must arise from that pattern's artistic
  idea, and every declared control must be truthful, perceptible, independently
  useful, and meaningfully effective across its range.
- **Do not invent controls to fill MIDI knobs.** An empty knob is fine.
- **Preserved:** global-before-local declaration order, and declaration order =
  physical MIDI knob order.
- **Audio stays modulators-only**; patterns do not read live audio globals.
- Explicitly de-mandated: "high-definition", true black, a non-black floor,
  constant beat behaviour, party brightness, two-colour spread, per-pattern
  audio reactivity. A quiet/ambient pattern may be subtle.

The document now sorts every statement into **HARD CONTRACT** (engine/compiler/
ABI/CI enforces it), **PRODUCTION CONVENTION** (operator decision about how this
show is authored), or **OPTIONAL CAPABILITY**, with an explicit instruction
never to describe an artistic preference as a runtime requirement.

Evidence cited in-document:
`.agent/reports/202607/20260725_32_pattern_param_truth_sweep.md` — 170 DEAD /
39 WRONG / 25 WEAK out of 817 measured parameters, with the largest clusters
being exactly the generically-mandated ones.

---

## 2. Code source per corrected runtime claim

| Claim as now documented | Authoritative source |
|---|---|
| Engine owns the global speed clock; accumulates `patternClockSeconds += wallDelta * globalSpeedMultiplier()` and passes it to `mixer.beginFrame(elapsed)` | `marsin_engine/engine.js` L720–750, L788–815 |
| Global speed range is 0.25×…4×, 0.5 = exactly 1× | `marsin_engine/engine.js` `SPEED_MIN_MULT` / `SPEED_MAX_MULT` |
| A channel must not re-apply global speed; it differences consecutive `elapsed`, scales by tap-tempo, accumulates `_phaseSeconds` | `marsin_engine/lib/pattern_channel.js` `beginFrame()` (explicit "do NOT re-apply the global speed here — that would double-count it") |
| `speed` and `size` are engine-owned and never injected into patterns | `marsin_engine/lib/param_center.js` PARAM_REGISTRY `engineOwned: true`; `registerChannel()` skips `entry.engineOwned`; `cpcKeyForExport()` skips them too |
| Global `size` rescales the coord buffer, not a pattern variable | `marsin_engine/lib/wasm_host.js` `applySizeScale()` |
| `t` == the `elapsed` seconds passed to `begin_frame` | offline probe E (see §3) |
| `time(scale)` period = `65.536 × scale` s, driven by that same clock | offline probe F |
| `delta` = `(elapsed_now − elapsed_prev) × 1000` ms — it **does** track `elapsed` | offline probes A–D (see §3) |
| `delta` is global-speed-scaled (because the host passes a scaled clock) | probes + `engine.js` above |
| `delta` initialization: nominal **16.0 ms** on frame 1 and on any frame whose predecessor's `elapsed` was exactly `0`; a repeated `elapsed` yields `delta == 0` | offline probes A–D |
| `pixelCount` compiles to literal 144 regardless of runtime pixel count | offline probe (VMs of 4 / 144 / 964 px all report ~144) |
| Meta ABI is **7 int32 lanes**: controllerId, sectionId, fixtureId, viewMask, fixtureTypeId, pixelLocalIndex, viewMaskHi | `marsin_engine/lib/meta_abi.js`; packed in `lib/wasm_host.js setPixelMeta()` and `lib/marsin_wasm_runtime.js setPixelMeta()` |
| Language builtin names: `fixtureType` (not `fixtureTypeId`), `pixelLocalIndex`; `pixelIndex` does not exist | compile probe against vendored WASM |
| `viewMaskHi` may **only** appear as `(viewMaskHi & MASK)` with a literal mask | compile probe error text, verbatim; `lib/in_view_intrinsic.js` header |
| All seven metadata names are reserved and cannot be declared | compile probe (`Cannot declare reserved name '<name>'`) |
| `inView("Name")` folds at compile time, resolves both view words, hard-errors on an unknown name, promotes bit-free views on demand, ignores commented-out calls | `marsin_engine/lib/in_view_intrinsic.js` |
| `MASK_*` / `FIX_*` unknown references fail the compile | `lib/view_mask_constants.js`, `lib/fixture_type_constants.js`, `lib/wasm_host.js compile()` |
| `FIX_*` ids: RAW_LED 1, PAR 2, VINTAGE_6 3, BAR_18 4, HAZE 5, FOG 6; id 0 = UNTYPED, not a fallback target | `lib/fixture_type_constants.js` REGISTRY |
| Titanic section ids are model-specific (e.g. 514, 515), not a global taxonomy | `simulation/scenes/titanic/patches.yaml` |
| Titanic `inView()` names today = the 24 base group names; no custom views | `simulation/scenes/titanic/views.yaml`, `marsin_engine/models/titanic.viewmasks.js` (`viewMasks = []`), `engine.js` viewTable build L627–632 |
| Patterns never receive live audio; the engine refuses to bind the live audio family | `lib/param_center.js registerChannel()` + `isLiveAudioSharedFnName` from `audio/postproc/audio_signals.js` |
| Untouched sliders seed to 0.5 (toggles 0, hsv pickers h0/s1/v1) | `lib/pattern_channel.js seedLocalControlDefaults()` |
| LED strands: amber folded into RGB at `[0.9, 0.6, 0.0]`, UV dropped, joint clip-proof pre-scale, gamma only on the controller | `simulation/src/dmx/led_wire.js` |
| DMX fixtures: authored RGBWAU bytes; W synthesized as `min(R,G,B)` only when the pattern emitted none | `simulation/src/dmx/sacn_mapper.js mapPixelsToSacn()` |
| RGB `R + W + 0.8A + 0.1U` equations are a preview/legacy path, not the physical rig | `sacn_mapper.js` (DMX preview blend) + `led_wire.js` (real wire encode) |
| Valid channel blend modes are exactly `blend_screen`, `blend_add`, `blend_over` (+ transient `trans_*`) | `lib/api_server.js VALID_CHANNEL_BLEND_MODES`; `lib/pattern_mixer.js _compileBlend()` |
| `w == a` enforced by CI over every `rgbwau()` pattern | `marsin_engine/tests/patterns/white_amber_lane_match.test.js` |

**Titanic hardware inventory** (cross-checked against the repo, all five
operator-supplied numbers reconcile exactly, total 964):

| Instrument | Count | Derivation |
|---|---:|---|
| Hull Canvas | 360 | 4 wall groups × 5 `ShehdsBar` fixtures × 18 px |
| Silhouette | 320 | 8 rope runs × 40 px |
| Jewelry | 96 | 16 `VintageLed` rail fixtures × 6 heads |
| Organs | 40 | 8+8 stack pars + 4+4 small-stack pars + 8+8 auditorium pars |
| Identity | 148 | 2 signs × (40 + 34) px |

Emitters verified from the fixture models: `ShehdsBar` = 18 RGBWAV pixels,
`UkingPar` = 1 RGBWAU pixel, `VintageLed` = 6 RGBW heads, `te_sign_v3` = RGBW
pucks ("the SAME LEDs as the rope strands"); rope + sign controllers are
`order: RGBW, stride: 4, whiteMode: native`.

---

## 3. The offline delta probe

Written to the session scratchpad (never the source tree), imported
`marsin_engine/lib/marsin_wasm_runtime.js` directly, created VMs, drove
`beginFrame(elapsed)` with controlled sequences and read `delta` / `t` /
`time()` back out through a pixel byte. **No engine boot, no socket, no port
bind, no config write.**

| `elapsed` sequence (s) | observed `delta` per frame (ms) |
|---|---|
| `0, 0.025, 0.05, 0.075, 0.1` | `16, 16, 25, 25, 25` |
| `0, 0.01, 0.03, 0.13, 0.14, 0.14, 0.20` | `16, 16, 20, 100, 10, 0, 60` |
| `1.0, 1.2, 1.4, 1.6` | `16, 200, 200, 200` |
| `0, 0.2, 0.4, 0.6` | `16, 16, 200, 200` |
| `0.5, 0.5, 0.7, 0.9` | `16, 0, 200, 200` |
| `0, 0, 0, 0` | `16, 16, 16, 16` |

Interpretation: `delta = (elapsed_now − elapsed_prev) × 1000`, with `0` doubling
as the "no previous frame" sentinel — hence the nominal `16.0` on frame 1 and
on any frame following an `elapsed == 0`. `t` returned the elapsed value
exactly (0→0, 1→1, 100→100); `time(0.1)` wrapped at 6.5536 s.

**This falsifies the previous §9.3 claim** ("a fixed nominal step of ≈15.7 per
frame — it does not vary with the `elapsed` argument") and the §10.5 gotcha row
("SPEED scales `time()`, not raw `delta`"). Both are removed and named as
withdrawn in the changelog.

---

## 4. Stale material cleaned

- Two `file:///Users/ssolaimanpour/...` absolute links → repository-relative.
- `.agent/01_skills/12_highdef_pattern_generation.md` and
  `13_pattern_gallery.md` → `.agent/skills/highdef_pattern_generation.md`,
  `.agent/skills/pattern_gallery.md`.
- The static "patterns that depend on this idiom today" inventory (13 named
  pattern files) — removed; it would go stale on the next rename/migration.
- The stale channel-blend table (`blend_crossfade`, `blend_wipe_left`,
  `blend_dissolve`, `blend_iris`, `blend_flash` — none of which exist under
  `patterns/channel_blends/`) → the three real modes plus a pointer to read the
  transitions directory.
- The metadata example hard-coding `SECTION_LEFT/CENTER/RIGHT` → an
  `inView()` example, with an explicit "do not write `sectionId == 2 //
  Vintage`" callout.
- The "always include a `== 0` fallback for v1 model compatibility" advice —
  withdrawn in both documents as a codex-P0 fallback behaviour, with the
  parameter-truth 137-dead-knob finding as the cost.
- `docs/36` / `docs/40` / `docs/41` shorthand → real relative links.
- Removed the `Last Updated: 2026-06-14` / `Author: coordinator session
  2026-08-03` header stamps rather than inventing new ones.

**Filename convention violation reported, not renamed:**
`marsin_engine/effects/feedbackTrails.js` is camelCase and violates the repo's
`snake_case` source-filename rule. Both documents link to it under its **actual**
name and carry a note that renaming it is a code change, not a doc change.
(Sibling files in the same directory are split: `blastWhite.js`, `colorWash.js`,
`dropHit.js`, `uvBlast.js`, `vintageWhite.js` are camelCase; the rest are
snake_case. A separate cleanup wave should decide this, since the names are
referenced from state files and the API.)

---

## 5. Verification performed

| Check | Result |
|---|---|
| `file:///` in the three docs | 0 |
| `.agent/01_skills` / `.agent/00_gol` in the three docs | 0 |
| Obsolete four-variable metadata claim | 0 (one deliberate "the old four-variable description is obsolete" callout) |
| Hard-coded semantic section IDs presented as portable | 0 (three deliberate "do not do this" callouts remain) |
| Double global-speed multiplication in any example | 0 (three deliberate "this was removed / this was wrong" callouts remain) |
| Every relative link target exists | verified by script — **all resolve** |
| Referenced code paths exist | `meta_abi.js`, `in_view_intrinsic.js`, `fixture_type_constants.js`, `marsin_wasm_runtime.js`, `effects/feedbackTrails.js`, `white_amber_lane_match.test.js`, `tools/param_truth/*` — all present |
| Real IPs / MACs in prose | 0 |
| Future dates | 0 (only 2026-06-17 and 2026-06-19, both past) |
| `python scripts/security_check.py --all` | **no finding in any of the three files** |

---

## 6. Remaining contradictions / open items

1. **PENDING-B — the semantic view list.** `MARSIN_ENGINE_PATTERNS.md` §7.3
   lists the 24 group names from the *current*
   `simulation/scenes/titanic/views.yaml` and is marked
   `<!-- PENDING-B: reconcile with final views.yaml -->`. Sub-agent B is
   revising that file and `titanic.viewmasks.js` concurrently; the list must be
   reconciled after B lands. Nothing else in the three docs enumerates view
   names.
2. **`.agent/skills/highdef_pattern_generation.md` still carries the old
   universal-parameter rules** — its §0 four bars and its "Consistency ground
   rules" §1–7 mandate direction + autonomous reversal + radius + kick +
   two-colour + `peakMaxChan >= 200`, and its §2 rig table hard-codes
   `sectionId 1/2/3` as the fixture identity for the Titanic. That skill was
   **out of my write scope**. It now contradicts
   `docs/MARSIN_ENGINE_PATTERNS.md` §1 and §7.2 and should be corrected in a
   follow-up, or it will keep regenerating the dead-knob population.
   `.agent/skills/pattern_gallery.md` is unaffected (tooling only).
3. **`lib/pattern_channel.js` L25 comment** lists `'blend_crossfade'` as a
   channel mode; the API's `VALID_CHANNEL_BLEND_MODES` does not include it and
   no `channel_blends/blend_crossfade.js` exists. Code comment only — reported,
   not touched.
4. **`docs/06_pixelblaze_engine.md` and `docs/12_marsin_engine.md`** were not in
   scope and were not audited for the same stale claims.

---

## 7. Compliance statement

- **No git operation of any kind** was run — no `status`, `add`, `commit`,
  `diff`, `restore`, `checkout`, `branch`, or `stash`.
- **No deploy, no `npm install`, no live engine boot.**
- **No default port was bound, killed, or probe-written.** Ports 6966–6972,
  5568, 8081 and 10000 were never touched; nothing in the 31xxx range was
  needed either, because the delta probe drove the WASM VM in-process with no
  transport at all.
- All temporary probe scripts were written to the session scratchpad, never to
  the source tree.
- Writes were confined to `docs/COLOR_THEORY.md`,
  `docs/MARSIN_ENGINE_PATTERNS.md`, `docs/MARSIN_PB_LANG_SPEC.md`, this report,
  and the tracker landing block. `simulation/scenes/titanic/views.yaml` and
  `marsin_engine/models/titanic.viewmasks.js` were read-only.
- The uncommitted working-tree changes from other agents were left untouched.

---

## 8. Addendum — PENDING-B reconciled (after `_134` landed)

Re-read the FINAL `simulation/scenes/titanic/views.yaml` and
`marsin_engine/models/titanic.viewmasks.js` (sidecar regenerated) and brought
the docs into exact agreement. **The files were treated as the authority, not
the hand-off message**; every number below was independently recomputed from
the model rather than transcribed.

### What B landed

**17 custom views** on top of the unchanged 24 base groups = **41
`inView()`-able names**. Words: the seven `Hull Canvas` … `Jewelry` are word 0;
the ten `Left Jewelry` … `Auditoriums` are word 1.

### Independent verification (offline, in-process, no engine/ports)

Summed each view's member-group pixel counts straight from
`marsin_engine/models/titanic.js`:

| View | px | View | px | View | px |
|---|---:|---|---:|---|---:|
| Hull Canvas | 360 | Jewelry | 96 | Identity | 148 |
| Left Hull | 180 | Left Jewelry | 48 | Stacks | 24 |
| Right Hull | 180 | Right Jewelry | 48 | Left Stacks | 12 |
| Silhouette | 320 | Organs | 40 | Right Stacks | 12 |
| Left Silhouette | 160 | Left Organs | 20 | Auditoriums | 16 |
| Right Silhouette | 160 | Right Organs | 20 | | |

**All 17 match the hand-off counts exactly.** Model total 964; 24 groupBits
entries, every one populated, no pixel group missing from `groupBits` and no
`groupBits` entry without pixels.

Additional checks, each of which could have silently broken every pattern:

- Rebuilt the engine's `viewTable` the way `engine.js` L627–632 does → **41
  names**, no collisions.
- `buildMaskConstants()` → **41 `MASK_*` entries, no sanitized-name collision
  throw** (a collision here would fail every compile).
- Folded `inView("<name>")` for all 41 through the real
  `injectInViewIntrinsic()`: **31 fold to `(viewMask & …)`, 10 to
  `(viewMaskHi & <literal>)`, 0 failures** — matching B's word split (24 base +
  7 word-0 composites = 31 low; 10 high). Every high-word fold emitted an
  inlined literal, as the Tier-C firmware requires.
- **All six forbidden aliases hard-error** as intended: `All Bars`,
  `All Ropes`, `All Vintage Lights`, `All TE Signs`, `Left Identity`,
  `Right Identity`.
- `Left Auditorium` / `Right Auditorium` confirmed still present as **base
  group** views (the composite is the separate `Auditoriums`).
- **New finding, recorded rather than assumed:** the five instrument views
  (`Hull Canvas`, `Silhouette`, `Jewelry`, `Organs`, `Identity`) are **mutually
  exclusive and exhaustive** — they partition all 24 base groups with zero
  overlap and sum to exactly 964. That is what makes the `if / else if`
  per-instrument idiom now documented in `COLOR_THEORY.md` §7 safe (nothing
  unlit, nothing double-assigned).

### Doc changes

- `MARSIN_ENGINE_PATTERNS.md`: `<!-- PENDING-B -->` marker **removed**;
  §7.3's provisional 24-name paragraph replaced by a new **§7.3.1 "The semantic
  views on `titanic`"** — the 17 composites with pixel counts and coverage in a
  table, the 24 base groups, the word placement, and an explicit
  "names that do NOT exist" list. Added a spelling-irregularity warning
  (`Right SmokeStacks` plural vs `Left SmokeStack` singular; underscored strand
  groups; `Left/Right Auditorium` singular vs composite `Auditoriums`), since
  `inView()` matches literally and a mistyped name is a compile error. The §7.3
  example now uses `inView("Hull Canvas")`.
- `COLOR_THEORY.md`: §2 instrument table gained a **View name** column; added
  the left/right halves and the `Stacks`/`Auditoriums` subdivisions; §4 now
  points at `Stacks` for the funnels with an explicit warning that `Organs`
  also covers the auditoriums; §7 gained a worked `inView()` per-instrument
  palette-distribution example.
- `MARSIN_PB_LANG_SPEC.md`: §5.2.1 example changed to `inView("Hull Canvas")`
  for consistency. No enumeration lives in the spec, by design — it documents
  the language, not one model's view set.

### Re-verification after the edits

- Extracted every `inView("…")` string from all three docs and resolved each
  against the real `viewTable`: **all concrete names resolve.** The only
  non-resolving strings are the deliberate generic placeholders
  (`"Name"`, `"Authored View Name"`, `"X"`, `"…"`) and the six forbidden
  aliases, which appear **only** inside the "these do not exist" list.
- All 17 composites and all 24 base groups are listed in
  `MARSIN_ENGINE_PATTERNS.md` — none missing.
- Relative link targets re-checked by script: **all resolve**. No `file:///`,
  no `.agent/01_skills`, no IPs.
- `python scripts/security_check.py --all`: **no finding in any file touched.**
- **No git command, no deploy, no install, no live engine boot, no port
  bound.** Verification scripts ran in-process from the session scratchpad.

### 8.1 Correction (2026-08-04) — word placement, after `_137`

**One substantive falsehood, found by the `_135` verifier and fixed.** My §7.3.1
"Word placement" paragraph claimed the 24 base groups **and the first seven
composites** (`Hull Canvas` … `Jewelry`) were low-word, with only ten composites
high-word. That was true when I wrote it against `_134`'s files, and was
invalidated by `_137`, which migrated all seven word-0 composites to word 1
(`Hull Canvas` moved word 0 `0x40000` → word 1 `0x400`).

Re-measured against the final `views.yaml` + `titanic.viewmasks.js` (both agree,
all 17 entries carry `word: 1`) and re-folded all 41 names through the real
`injectInViewIntrinsic()`: **24 low-word folds (base groups only), 17 high-word
folds (every composite), 0 failures.** Corrected text: *"the 24 base groups live
in the low word … all 17 composite views live in the high word"*, now attributed
to the allocator policy `CUSTOM_VIEW_WORD_ORDER = [1, 0]`
(`simulation/src/dmx/view_registry.js` — custom views prefer word 1 because base
group bits are hard-pinned to word 0 and are the only consumer that cannot move),
with the `Hull Canvas` bit migration cited as the concrete reason never to
hard-code a composite's word or bit.

Swept all three docs for any other sentence pinning a view to a word or bit:
**this was the only one.** The remaining word mentions are generic language
descriptions ("a low-word view folds to …"), which stay true; `COLOR_THEORY.md`
makes no word/bit claims, and the lang spec's Tier-C table (views 0..30 word 0,
31..61 word 1) is a general ABI statement matching `view_registry.js`.
Everything else in §7.3.1 re-verified unchanged: 964 px, 24 populated base
groups, all 17 composite counts identical, 41 viewTable names, 41 `MASK_*` with
no collision, six forbidden aliases still hard-erroring, five-instrument
partition still exclusive+exhaustive. Links re-checked (the new
`view_registry.js` link resolves); every concrete `inView("…")` name in the
three docs still resolves. No git op, no deploy, no install, no live boot, no
port bound.
