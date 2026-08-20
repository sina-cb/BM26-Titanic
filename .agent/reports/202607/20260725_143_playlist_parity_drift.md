# `_143` — Playlist parity drift: the `specialty_white_uv` byte-identity red

**Date:** 2026-08-03. **Branch:** `feat/bm_readiness`.

**Outcome: DEFERRED TO THE OPERATOR. Nothing was modified** — not the scene
files, not the test. The drift is the operator's own slider values, captured
automatically by a real bench session; deciding whether that pass is keeper
tuning or audition residue is a taste call no agent should make silently.

**READ-ONLY.** Zero source edits, zero scene writes, zero git operations of any
kind (only `git log` / `git show` / `git status`). No engine boot, no sim boot,
no server, no port bound — ports 6966–6972, 5568, 8081, 10000 untouched. The
only thing executed was the offline pattern test suite. `_142`'s paths
(`marsin_engine/tools/`, `marsin_engine/tests/tools/`) untouched.

---

## 1. The red

```
tests/patterns/specialty_white_uv.test.js
  › both scenes carry byte-identical copies of every specialty/themed playlist
```

Measured baseline this session:

```
cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs \
  --test "tests/patterns/**/*.test.js"
ℹ tests 95
ℹ pass 94
ℹ fail 1        ← this test, and only this test
```

The assertion (`specialty_white_uv.test.js:283-289`) byte-compares
`simulation/scenes/{test_bench,titanic}/playlists/<list>.yaml` for the 2
specialty + 7 themed playlists.

---

## 2. The drift is wider than reported, and it runs BOTH directions

The test's loop aborts on the first mismatch (`white_only`), which hid the rest.
Full sweep of all 15 bench playlists against titanic:

| Playlist | State | Direction |
|---|---|---|
| `white_only` | **DRIFTED** | bench has captures, titanic `defaults: {}` |
| `temple_white` | **DRIFTED** | bench captures OVERWROTE titanic's authored values |
| `white_wednesday` | **DRIFTED** | bench captures OVERWROTE titanic's authored values |
| `ambient` | **DRIFTED** (not in the test's list) | **titanic** has captures, **bench** `defaults: {}` |
| `default` | **DRIFTED** (not in the test's list) | both sides diverged heavily |
| `burn_night`, `deep_sea`, `first_class_1912`, `iceberg_ahead`, `party_high`, `party_low`, `tutu_tuesday`, `uv_test` | identical | — |
| `dirty_probe`, `slow` | bench-only files | — |

Among the *tested* lists the drift is **exactly the three WHITE playlists** —
a single bench session's footprint, not scattered rot.

`ambient` drifting the **opposite** way is the important one: drift is
**bidirectional and routine**, so this is not a one-off accident on one file.

**Both files were born already drifted.** `git log --follow` on each returns
exactly one commit — `3246deb2` (2026-07-30, "BM readiness wave: push/save
workflow, …"), which *added* them. The divergence happened in the working tree
before that commit and was committed as-is. Working tree is currently **clean**
vs HEAD for every playlist path (`git status --porcelain` → empty).

### 2.1 Mtimes — one bench session, one afternoon

```
test_bench/white_wednesday.yaml   2026-07-28 14:37
test_bench/temple_white.yaml      2026-07-28 15:12
test_bench/white_only.yaml        2026-07-28 16:01
titanic/{all three}.yaml          2026-07-27 16:32   (untouched since authoring)
```

---

## 3. Mechanism — identified exactly

The write path, end to end:

- `api_server.js:1738` `captureOrDeferOutgoingDeckEntry(channel)` — the **deck
  capture-on-switch** hook. Fires when the channel is the deck, the operator
  touched params since load, and there is an active playlist entry.
- → `api_server.js:1881` `captureActiveEntryDefaults(channel)`
- → `api_server.js:1894` `writeEntryDefaults(name, entryId, defaults)` — "the
  single playlist-file writeback path".
- The payload comes from `playlist_manager.js:392` `captureDefaults()`.

Three findings from that path:

**(a) The write is AUTOMATIC, not a deliberate save.** The in-code rationale is
explicit — it is the *"night of deck tuning lost on switch"* fix
(`api_server.js:1731-1732`). No operator "save to playlist" action is required;
merely switching entries persists the outgoing one. (Note: the docstring on
`captureActiveEntryDefaults` still claims *"EXPLICIT operator action only —
never wired to a control-write path"*. That comment is **stale** — the
capture-on-switch path calls it. Filed below.)

**(b) The captured values ARE genuine operator knob movements.** The gate is
`channel._paramsTouchedSinceLoad`, and `markDeckParamsTouched()`
(`api_server.js:1669`) is set **only** by the operator control-write routes
(legacy `/control`, `POST /deck/channel/control`, WS `setControl`). Autopilot,
`applyEntryDefaults` and seeded pattern defaults do **not** set it. So these are
real knob positions, not autopilot residue or untouched initial values.

**(c) `captureDefaults` snapshots ALL local exports, in declaration order.** It
walks `wasmHost.getExports()` and emits every kind-1/2/6 export, touched or not.
That explains two signatures of the bench files that hand-editing could never
produce:
  - the **full** slider set appears (incl. `sliderDirection`, `sliderKick`,
    `sliderRadius`) where the authored files carried a sparse curated subset;
  - keys are **reordered** into export-declaration order — e.g. in
    `temple_white`/`61`, `sliderWarmth` moved from mid-block to the end.

### 3.1 The values are tuned, not noise

Cross-checked against each pattern's declared `export var` defaults:

| Entry | Untouched (= declared default) | Moved |
|---|---|---|
| `60_white_wash` | `localSpeed 0.5`, `whiteLevel 0.7` | `direction 1`, `level 0.17`, `kick 0`, `radius 0.94`, `evenness 0.05`, `whiteKick 0.15`, `warmth 0.15` |
| `61_white_breathe` | `localSpeed 0.35`, `whiteLevel 0.65` | `direction 0.76`, `level 0.2`, `radius 0.09`, `depth 0.92`, `whiteKick 0.2`, `warmth 0.2` |
| `62_white_shimmer` | — | **nothing — still `defaults: {}`** |
| `63_white_chase` | `localSpeed 0.5`, `tailLength 0.45` | `whiteLevel 0.93` (from 0.60), `level 0.07`, `radius 0.4`, `count 0.35`, `whiteKick 0.86`, `warmth 0.7` |
| `64_temple_warm_white` | — | `localSpeed 0.83` (from 0.25), `whiteLevel 0.95` (from 0.70), `direction 0.59`, `level 0.05`, `radius 0.06`, `ceiling 0.29`, `warmth 0.94` |

Varied, non-round, deliberate. Contrast with the `ambient`/titanic captures,
which are mostly flat `0.5` with a single moved `sliderLocalSpeed` — that side
*is* mostly mechanical residue. The white captures are not.

`62_white_shimmer` staying empty is consistent: the operator never touched it
(or never switched away after touching), so no capture fired.

---

## 4. Show impact: NONE. This is test-only.

`state_paths.js:74` `resolvePlaylistsDir(engineDir, modelName)` resolves to
`simulation/scenes/<modelName>/playlists`. The engine running `--model titanic`
reads **only** `scenes/titanic/playlists/` and can never read the bench copy.

Independently, report `_91`'s playlist audit (§ coverage table) lists
`white_only`, `white_wednesday` and `temple_white` all as **"unassigned"** — no
timeline look or cue references any of them, on either scene. Nothing in the
show plan reaches this content today.

So the drift costs a red test and nothing else.

---

## 5. Why this is genuinely ambiguous — the two sides

### Side A: the bench captures are audition residue that ate curated values

Report `_13` §5.1 is explicit about the titanic side. It ships those defaults as
*"authored **and measured** in this wave, and the operator's intent for them is
explicit"*, and it deliberately ships `white_only` with `defaults: {}` (it is
the raw family audition list; only `white_wednesday` and `temple_white` were
given real defaults).

The bench captures **overwrote** those explicit values, and in places contradict
the lists' documented character:

- `temple_white` is documented as *"dim warm white, **slow**"* — the capture
  moved `64`'s `sliderLocalSpeed` **0.18 → 0.75** and added `sliderRadius 0.45`.
- `temple_white`/`61` `sliderLevel` **0.34 → 0.13**.
- `white_wednesday` is documented as *"full brightness"* — the capture on `61`
  kept `level 1` but added `localSpeed 0.89`.

An automatic capture-on-switch needs no intent, so a pattern-audition pass
(twiddle knobs, switch, repeat) produces exactly this footprint.

### Side B: the bench captures are the operator's real tuning on real hardware

The touched-flag proves a human moved those knobs. The titanic values are an
agent-generated seed — `_13` itself calls the themed lists **"DRAFT — Sina
re-curates"** and names its generator `~/tmp/gen_specialty_playlists.mjs`. Real
knob work on the rig arguably beats a generated draft. And capture-on-switch
exists precisely because the project decided live deck tuning is worth keeping.

**Neither side is decidable from the repo.** What cannot be recovered is whether
the fingers on the bench that afternoon were Sina's tuning pass or an agent
driving the deck (the curator role's brief scopes `scenes/*/playlists/` to it
and permits driving the one live engine). That is the crux, and it is exactly
the operator's call.

---

## 6. There is also no mechanism holding this invariant

The test asserts cross-scene byte-identity, but:

- the engine writes **only the running scene's** playlist dir (§4), and
- **no cross-scene sync exists.** The tracker's curator kickoff list queues both
  *"(5) playlist clone/parity tool"* and *"(6) CaptainPad 'save current tuning
  to playlist entry' + diff + **cross-scene copy**"* as **unbuilt** features.

So the test pins an invariant nothing maintains, over files the live engine
mutates by design. It has re-reddened repeatedly and was consciously left alone
by `_129`, `_140`, `_141` and others as a known environmental baseline.

**Live hazard, right now:** the operator's stack is running on **titanic** this
session — `titanic/ambient.yaml` (17:06) and `titanic/default.yaml` (18:07)
carry today's mtimes. Editing titanic playlist files under a live engine risks
colliding with its own writes. Another reason not to hand-patch parity today.

Governance also points away from an agent deciding this: `_91` states plainly
that playlist contents and `marsin_engine/patterns/**` *"were measured, never
touched — those are ChatGPT+operator territory."*

---

## 7. Decision

**Deferred. No file changed, and the test stays red.** Per the brief's high bar:
the evidence does not *clearly* show accidental residue (the values are real
knob movements), does not *clearly* show wanted show state (they overwrote
explicitly-documented intent and contradict the lists' stated character), and
per-scene divergence is not yet a *ratified* design position — the sync tooling
is queued, not built.

### The question for Sina (one line)

> On 2026-07-28 a bench deck session auto-captured knob positions into
> `test_bench`'s `white_only` / `temple_white` / `white_wednesday`, overwriting
> the authored "temple = slow/dim" values (e.g. `temple_white`/`64` speed
> 0.18 → 0.75) — was that a real tuning pass you want kept, or audition residue?

### Recommendation if he has no strong feeling

**Revert the three bench files to the authored `_13` §5.1 values** (restoring
parity, test green). Rationale: those values are documented as measured and
intentional; the bench captures contradict the lists' documented character; and
the bench scene never runs the show, so nothing of show value is lost. If he
says the bench pass *was* his tuning, the correct move is the mirror image —
propagate bench → titanic for all three.

**Either way it is a one-command change, and it should be his call.**

### Durable follow-up (separate from the values question)

Whatever is decided, this test **will** go red again the next time anyone tunes
the deck on either scene. The lasting fix is one of:
  1. build the queued playlist clone/parity tool (curator items 5 + 6), or
  2. relax the assertion to **structural** parity (same entry ids / patterns /
     order) and let `defaults` be per-scene by design.

Not done here — both need an operator ruling first.

---

## 8. Filed, not fixed

1. **Stale docstring.** `captureActiveEntryDefaults` (`api_server.js:1876-1880`)
   claims *"EXPLICIT operator action only — never wired to a control-write
   path"*. It **is** wired to one, via `captureOrDeferOutgoingDeckEntry`. The
   comment misleads exactly the reader trying to answer the question this report
   asks. One-line doc fix; left alone to keep this thread read-only.
2. **`ambient` + `default` drift** the same way and are **not** covered by the
   parity test — whatever ruling lands should cover them too.

---

## 9. Verification + compliance

**Test baseline (unchanged, nothing was modified):**

```
cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs \
  --test "tests/patterns/**/*.test.js"
ℹ tests 95 · pass 94 · fail 1
```

The single red is the parity test, failing on `white_only` (first mismatch in
the loop) — the exact stated baseline, confirmed rather than assumed.

**Security check:** `python scripts/security_check.py --all` → **6 findings =
the stated baseline**, all `bm26-mac-address` in **untracked**
`simulation/.scene_backups/studiodj/**`. Zero new.

**Compliance.** Write set: this report + the tracker block, nothing else. No git
operations of any kind. No engine/sim boot, no server, no port bound, no deploy,
no install. Scratch confined to `~/tmp/_143_baseline.txt` and the session
scratchpad. `_142`'s paths untouched; the operator's live stack untouched.
