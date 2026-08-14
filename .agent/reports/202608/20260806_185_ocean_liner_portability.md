# _185 — `08_ocean_liner` FIX_ constant portability

**Date:** 2026-08-06 · **Agent:** _185 (Opus, bounded implementer)
**Branch:** `feat/bm_readiness` · **No git operations.**
**Map:** `.agent/reports/202608/20260806_184_audio_meta_impl.md` (§ follow-up 3)
flagged this; _184's repro reproduced exactly.

**All verification was offline / in-process.** No live process was started or
touched. The engine E2E suite (`playlist_api`) spawns its own throwaway engines
on high ports with temp state/playlist dirs and black-holed sACN, via the
existing helpers. Scratch work lived in `~/tmp/fix_185/` only.

---

## 1. Outcome, up front

`marsin_engine/patterns/08_ocean_liner.js` now compiles on `summer_camp_dome`
and the two named `playlist_api` tests pass again. **My net edit to the pattern
is zero bytes** — the operator's other AI session landed the same fix, in the
same idiom, in the file *while I was working in it*. I removed my duplicate
block and kept theirs. Details in §4.

## 2. How FIX_ constants are actually injected

The mechanism is deliberate, and it rules option (b) out.

- `marsin_engine/lib/fixture_type_constants.js` owns the canonical, **global,
  append-only** registry: `FIX_RAW_LED`=1, `FIX_PAR`=2, `FIX_VINTAGE_6`=3,
  `FIX_BAR_18`=4, `FIX_HAZE`=5, `FIX_FOG`=6, `FIX_TE_SIGN`=7. Ids are pinned by
  the `fixtureTypeStability` test and must never be renumbered.
- `buildFixtureTypeIds(pixels)` emits a constant table containing **only the
  roles a model's pixels actually carry** (`presentTypeIds`). Its own docstring
  states the intent: "Only PRESENT types are emitted, so a `FIX_*` reference to
  a type the model does not carry still fails loudly at compile (codex P0)
  rather than silently matching nothing."
- `lib/model_loader.js:306` (and `engine.js`'s own `loadModel`) build that table
  per model; `lib/wasm_host.js:134` runs `injectFixtureConstants` on **every**
  compile path (boot pattern, mixer channels, live-edit API, blends).
- `lib/name_id_registry.js:142 injectConstants` scans comment-stripped source for
  `FIX_[A-Z0-9_]+` tokens, prepends `var FIX_X = <id>;` for known ones, and
  throws the `Pattern references unknown FIX_ constant(s): …` error for the rest.

So per-model constant tables are **derived from model geometry, not authored** —
there is no place to "establish the constants for every model", and doing so
would defeat the loud-failure contract. Option (b) is not how the system works.

### The escape hatch the idiom uses

`injectConstants` treats a name as *self-declared* when the pattern itself
declares it as a `var` target. A self-declared name is never reported unknown.
On a model that DOES carry the role, the injected `var` is still prepended, so
the pattern's own declaration and the injected one must **agree in value** for
behavior to be unchanged — which is why the idiom declares the *canonical
registry id*, never an invented sentinel.

Confirmed empirically (scratch `check_prelude.mjs`), the injected prelude for
this pattern is byte-identical on the models that carry the roles:

```
test_bench:       var FIX_RAW_LED = 1; var FIX_TE_SIGN = 7; var FIX_BAR_18 = 4; …
titanic:          var FIX_RAW_LED = 1; var FIX_TE_SIGN = 7; var FIX_BAR_18 = 4; …
summer_camp_dome: var FIX_BAR_18 = 4; var FIX_VINTAGE_6 = 3; var FIX_PAR = 2;
```

Self-declaring `FIX_RAW_LED = 1` / `FIX_TE_SIGN = 7` therefore changes nothing on
titanic/test_bench (same value, later duplicate `var` wins with the same number)
and yields an id no pixel reports on dome/logsville — the branch simply never runs.

## 3. The idiom, and why only the OPTIONAL roles

Three sibling patterns already do exactly this, and all three declare **only**
`FIX_TE_SIGN`:

| File | Line | Comment |
|---|---|---|
| `patterns/14_lunar_current.js` | 56 | "Optional append-only role id. Models without TE signs simply have no type 7." |
| `patterns/21_pelagic_manta_rays.js` | 68 | "Self-declaration keeps the same source compilable on models without TE signs" |
| `patterns/35_sparkle_rain.js` | 63 | "so this portable pattern also compiles on models with no sign" |

The discipline is not "declare every FIX_ you touch". It is: **declare the roles
that are genuinely optional accents; let the pattern's primary instruments fail
loudly.** `08_ocean_liner`'s header says bars carry the water and Vintage rails
carry the portholes — those are load-bearing, and a model without them *should*
refuse to load the pattern rather than quietly render the untyped default role
(`waterRole 0.24 / portRole 0.10`), which would be a fallback behavior (codex P0).
Raw strands ("dim outline") and TE signs are the accents.

I initially wrote a five-constant block covering `FIX_PAR`/`FIX_VINTAGE_6`/
`FIX_BAR_18` too, to make the pattern compile on literally every model. **I backed
that out** — it buys `led202`/`studio`/`studio_top_loft` at the cost of silently
converting a missing primary instrument into a flat untyped wash. Two-constant is
the correct, idiomatic scope.

## 4. Shared-tree collision (report-worthy)

`08_ocean_liner.js` was under concurrent edit by the operator's other AI session.

- I hashed the file (`99707a6936182bd5f89c698295f25eb2`), read it, and inserted a
  five-constant block after the slider setters.
- The post-edit file came back containing **two** blocks: mine, and a new one at
  lines 22-25 that was not there when I read the file seconds earlier —

  ```
  // Canonical append-only optional fixture roles; absent roles match no pixels.
  var FIX_RAW_LED = 1;
  var FIX_TE_SIGN = 7;
  ```

  i.e. the other session reached the same conclusion and the same idiom
  independently, scoped to the two optional roles.
- Resolution: I deleted **my** block in full and left theirs untouched. The
  pattern now carries exactly one such block — theirs — and my net contribution
  to the artistic file is nothing. Every other byte of their rewrite is preserved
  (verified: single `var FIX_` block, CRLF line endings intact at 247/247 lines,
  matching siblings).

No further concurrent change was observed after that point.

## 5. Verification

All offline. Commands run from `marsin_engine/`.

| Suite | Result |
|---|---|
| `tests/playlist/playlist_api.test.js` | **19/19 pass**, 0 fail |
| `tests/mixer/all_models_load_lint.test.js` | **34/34 pass**, 0 fail |
| `tests/patterns/{calibration_patterns,param_truth_smoke,specialty_white_uv,white_amber_lane_match}.test.js` + `tests/io/fixture_type_constants.test.js` | **121/121 pass**, 0 fail |

The two named regressions are green:

```
✔ Create custom playlist, load it onto deck, switch entries (54.4794ms)
✔ Playlist assignment persists across engine restart (1321.7311ms)
```

`node --test tests/patterns/` (directory form) fails with
`ERR_UNSUPPORTED_DIR_IMPORT` on Node v24 — pass the four files explicitly.

**No repo-wide "compile every pattern against every model" test exists.** I wrote
one as scratch (`~/tmp/fix_185/audit_fix_constants.mjs`, not landed) by running
`injectConstants` over every `patterns/*.js` × every model's real
`fixtureConstants` table.

## 6. Honest finding: this is a catalog-wide condition, not an `08` bug

The scratch audit says `08_ocean_liner` was one instance of a broad pre-existing
pattern. Before the fix: **91** pattern×model FIX_ resolution failures. After:
**58**, and every remaining one is a *primary-instrument* absence on a small
model, which is the loud failure the design intends:

| Model | Roles it carries | Remaining failing patterns |
|---|---|---|
| `led202` | *(none)* | 24 |
| `studio` | RAW_LED, VINTAGE_6, BAR_18 | 17 |
| `studio_top_loft` | VINTAGE_6, BAR_18 | 17 |
| `studiodj`, `summer_camp_dome`, `summer_camp_logsville` | (no TE_SIGN; dome/logsville also no RAW_LED) | 0 |
| `test_bench`, `titanic` | all five | 0 |

Patterns still referencing `FIX_TE_SIGN` **without** self-declaring it — so they
cannot load on `studiodj`/`summer_camp_dome`/`summer_camp_logsville`, the exact
class of break _184 hit — are `11_bioluminescence`, `41_reaction_diffusion`,
`45_manta_drift`, `57_ink_diffuse`, `58_lighthouse_solo`. `57_ink_diffuse` and
`41_reaction_diffusion` additionally need `FIX_RAW_LED`. **Out of scope here, but
these are live landmines for any playlist/mixer test or show run on a non-titanic
model** — recommend a follow-up card, plus a real repo-wide compile-lint test so a
new pattern cannot reintroduce this silently.

## 7. Files

- `marsin_engine/patterns/08_ocean_liner.js` — carries the fix (authored by the
  other session; my net diff zero).
- Untouched, as instructed: `engine.js`, `config.yaml`, `lib/fire_sync_listener.js`,
  `lib/global_effects_controller.js`, `marsin_engine/states/**`, all scenes,
  calibration patterns/playlists.
