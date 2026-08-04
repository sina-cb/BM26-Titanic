# `_144` — Bench white playlists: audition residue reverted (executes the operator ruling on `_143`)

**Date:** 2026-08-03. **Branch:** `feat/bm_readiness`.

**Outcome: LANDED.** The three drifted `test_bench` white playlists are byte-identical to
their `titanic` counterparts again, and `tests/patterns/**` is **95/95** (was 94/95).

---

## 1. The ruling this executes

`_143` investigated the `specialty_white_uv` byte-identity red, established the mechanism
(automatic deck capture-on-entry-switch, `captureActiveEntryDefaults` in
`marsin_engine/lib/api_server.js`), proved the captured values were real operator knob
movements from a single bench session on 2026-07-28, and **deferred the taste call**: keeper
tuning, or audition residue?

**The operator (Sina) ruled: audition residue — revert the bench files.** That is `_143` §7's
"Recommendation if he has no strong feeling" branch, now authorized. This report executes it
and nothing more. The mirror-image option (propagate bench → titanic) is **not** taken.

---

## 2. What changed — exactly four files

| File | Change |
|---|---|
| `simulation/scenes/test_bench/playlists/white_only.yaml` | 5 captured `defaults:` blocks → `defaults: {}` ×5 |
| `simulation/scenes/test_bench/playlists/temple_white.yaml` | entries `64` + `61` restored to the `_13` §5.1 authored values (entry `60` was already authored-clean) |
| `simulation/scenes/test_bench/playlists/white_wednesday.yaml` | entry `61` restored to the authored value set |
| `marsin_engine/lib/api_server.js` | docstring correction only (§5) |

**Not touched, deliberately:** `ambient.yaml` and `default.yaml` on either scene (they drifted
too — `_143` §2 — but they are outside the ruling, and the operator's LIVE engine is actively
writing the titanic copies right now; hand-editing would race it). **No file under
`simulation/scenes/titanic/playlists/` was written at all.**

### 2.1 Method — derived from the titanic files, not hand-massaged

`_143` §3(c) found the captures carry a signature hand-editing cannot undo cleanly: the full
export set appears where the authored files carried a sparse curated subset, and keys are
**reordered into export-declaration order** (in `temple_white`/`61`, `sliderWarmth` had moved
from mid-block to the end). Byte parity therefore had to come from the authoritative side, so
each bench file's content was written from its `titanic` counterpart's exact bytes — LF line
endings, trailing newline, key order and all.

The titanic side was first confirmed to still carry the authored values, cross-read against
report `_13` §5.1's table:

| Entry | `_13` §5.1 says | `titanic/*.yaml` on disk |
|---|---|---|
| `temple_white`/`64` | speed 0.18, level 0.50, ceiling 0.32, warmth 0.92, whiteLevel 0.70, whiteKick 0.03 | **matches** |
| `temple_white`/`61` | speed 0.15, level 0.34, depth 0.30, warmth 0.90, whiteKick 0.02 | **matches** (+ `sliderWhiteLevel 0.7`, as shipped) |
| `temple_white`/`60` | speed 0.14, level 0.30, evenness 0.70, warmth 0.90, whiteKick 0.0 | **matches** |
| `white_wednesday`/all | `sliderLevel 1.0`, `sliderWhiteLevel 0.55`, low `sliderWarmth`; `64` + `sliderCeiling 1.0` | **matches** |
| `white_only`/all | ships `defaults: {}` (raw family audition list) | **matches** |

So "byte-identical to titanic" and "the authored `_13` §5.1 values" are the same target here —
no conflict to resolve.

**No git checkout / restore / stash of any kind was used**, per the brief. File contents were
written directly.

### 2.2 What the revert gives back

The values `_143` §5 flagged as contradicting the lists' documented character are restored:

- `temple_white` is documented *"dim warm white, slow"* — `64`'s `sliderLocalSpeed` goes
  **0.75 → 0.18** and the capture's `sliderRadius 0.45` is gone.
- `temple_white`/`61` `sliderLevel` **0.13 → 0.34**.
- `white_wednesday`/`61` drops the capture's `sliderLocalSpeed 0.89` (the list is documented
  *"full brightness"*, not fast).
- `white_only` returns to `defaults: {}` on all five entries — it is the raw family audition
  list by design.

**Show impact: none.** Per `_143` §4, `resolvePlaylistsDir` (`state_paths.js:74`) means the
engine running `--model titanic` reads only `scenes/titanic/playlists/` and can never read the
bench copy; and `_91`'s audit lists all three of these playlists as unassigned to any timeline
look or cue on either scene.

---

## 3. Byte-parity proof (measured)

SHA-256, both scenes, all **9** playlists the parity test covers
(`SPECIALTY_PLAYLISTS` + `THEMED_PLAYLISTS`, `specialty_white_uv.test.js:61-65`) — not just
the three that were touched:

```
name               bench(sha256[0:16]) titanic(sha256[0:16])  result
white_only         dd31a8c0cb9f95f9    dd31a8c0cb9f95f9       IDENTICAL
uv_test            6af99401603c627a    6af99401603c627a       IDENTICAL
tutu_tuesday       bd0ecfd38a7d6cd5    bd0ecfd38a7d6cd5       IDENTICAL
white_wednesday    c9c41bc53decba55    c9c41bc53decba55       IDENTICAL
iceberg_ahead      f3f09a73e4f318c7    f3f09a73e4f318c7       IDENTICAL
first_class_1912   cad496abc3976d19    cad496abc3976d19       IDENTICAL
deep_sea           0d2885e51a1953cd    0d2885e51a1953cd       IDENTICAL
burn_night         e5b15b3678a920f5    e5b15b3678a920f5       IDENTICAL
temple_white       0f42b1b0b0c6133d    0f42b1b0b0c6133d       IDENTICAL
```

This answers `_143`'s "the loop aborts on the first mismatch" hazard directly: the assertion
never sees a second mismatch because **there is no second mismatch** — every list it iterates
is byte-equal, verified independently of the test.

Independent binary compare of the three touched files (`fc /b`), full-file, exact bytes:

```
white_only.yaml       test_bench vs titanic → FC: no differences encountered   (841 B)
temple_white.yaml     test_bench vs titanic → FC: no differences encountered   (994 B)
white_wednesday.yaml  test_bench vs titanic → FC: no differences encountered   (1328 B)
```

Before the revert those three were 1777 / 1137 / 1453 bytes — the capture bloat is gone.

---

## 4. Test suite — 95/95

```
cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs \
  --test "tests/patterns/**/*.test.js"
ℹ tests 95
ℹ suites 0
ℹ pass 95
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2512.4048
```

`_143`'s measured baseline was `95 / 94 / 1`, the single red being
`both scenes carry byte-identical copies of every specialty/themed playlist`. That test is now
green and **no other test changed state** — the delta is exactly +1 pass, −1 fail.

No `marsin_engine/states/` residue: a post-run sweep for files modified in the last 30 minutes
shows zero state files (the pattern suite is offline, as `_13` §6 also measured).

---

## 5. The docstring correction (comment-only)

`_143` §8.1 filed this and left it alone to stay read-only. Fixed here.

`captureActiveEntryDefaults` (`marsin_engine/lib/api_server.js`) claimed
*"EXPLICIT operator action only — never wired to a control-write path"*. That is false and it
misleads exactly the reader trying to answer the question `_143` asked. The real contract, read
off the three call sites (`grep -n captureActiveEntryDefaults lib/api_server.js` → `1746`,
`9400`, `9905`):

1. **Explicit** operator capture routes — `POST /deck/playlist/capture` and
   `POST /mixer/channel/<id>/playlist/capture`.
2. **Automatic** deck capture-on-entry-switch — `captureOrDeferOutgoingDeckEntry`
   (`api_server.js:1738`) calls it on **every** deck entry switch when auto-save is ON, the
   channel is the deck, and there is an active entry. No operator "save" action is required.

The automatic path is gated on `channel._paramsTouchedSinceLoad`, set **only** by the operator
control-write routes (legacy `/control`, `POST /deck/channel/control`, WS `setControl`) —
autopilot, `applyEntryDefaults` and seeded pattern defaults do not set it. So the capture is
never wired to a control-write *directly*, but a control-write **arms** it, and the next entry
switch then writes the playlist file without further operator intent. That distinction is what
the new comment states.

**Zero behaviour change.** The edit is inside a `/** … */` block; `node --check
marsin_engine/lib/api_server.js` → clean, and the diff hunk contains no executable line.
`tests/mixer/channel_param_isolation.test.js:221` greps for the string
`function captureActiveEntryDefaults`, which is untouched; nothing asserts the comment text.

---

## 6. Known limitation — this will re-red, and the durable fix is still unbuilt

Unchanged from `_143` §6 and restated so it is not mistaken for solved: the test pins a
cross-scene byte-identity invariant that **nothing maintains**. The engine writes only the
running scene's playlist dir, there is no cross-scene sync, and the curator kickoff list still
carries *"(5) playlist clone/parity tool"* and *"(6) CaptainPad save-to-playlist + diff +
cross-scene copy"* as unbuilt. The next deck tuning session on either scene reddens this test
again.

The two lasting options (unchanged, both still needing an operator ruling): build the clone/
parity tool, or relax the assertion to **structural** parity (same entry ids / patterns /
order) and let `defaults` be per-scene by design.

**Also still open:** `ambient.yaml` and `default.yaml` drift (`_143` §8.2) — bidirectional,
not covered by the parity test, and explicitly out of scope for this ruling.

---

## 7. Verification + compliance

- **Byte parity:** §3 — 9/9 lists identical by SHA-256, 3/3 touched files identical by `fc /b`.
- **Tests:** §4 — `tests/patterns/**` **95 / 95 / 0**.
- **Syntax:** `node --check marsin_engine/lib/api_server.js` → clean.
- **Security check:** `python scripts/security_check.py --all` → **6 findings = the stated
  baseline**, all `bm26-mac-address` in **untracked**
  `simulation/.scene_backups/studiodj/**` (unchanged `10.x.x.NN`-class privacy findings that
  predate this thread). **Zero new.**

**Write set:** the three `test_bench` playlist YAMLs, the `api_server.js` docstring, this
report, the tracker block. Nothing else.

**No git operations of any kind** — read-only `git diff --stat` / `git config --get` /
`git check-attr` only, to prove the change surface. No engine boot, no sim boot, no server, no
port bound, no deploy, no install; the operator's live stack (6966–6972, 5568, 8081, 10000,
running on the titanic scene) was untouched throughout. `_142`'s paths
(`marsin_engine/tools/`, `marsin_engine/tests/tools/`) untouched. Scratch confined to the
session scratchpad.

**Note for whoever commits this:** `core.autocrlf=true` on this box and there is no
`.gitattributes` rule for `*.yaml`, so git warns *"LF will be replaced by CRLF"* on the three
reverted files. Harmless for parity — both scenes' copies normalize the same way, and the index
stores LF for both sides — but it is why the warning appears on `git diff`/`git add`.
