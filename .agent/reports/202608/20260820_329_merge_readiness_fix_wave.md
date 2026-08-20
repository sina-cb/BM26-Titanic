# _329 — Merge-readiness fix wave for `feat/bm_readiness`

**Scope:** implement the operator's rulings on the merge blockers raised by
`_326` (security), `_327` (structure/code health) and `_328` (adversarial
verdict). Working-tree fixes only — **no git write operation of any kind was
performed**, no commit, no branch, no `git rm`. Sina commits after review.

**Constraints honoured:** no port in 6966-6972 / 6981 / 5568 was bound, killed
or restarted (`netstat` confirmed no show port was listening for the whole
wave). Nothing under `marsin_engine/states/**` was modified, reverted or
"cleaned up" — the operator's live tunings are intact. Scratch work lived in
`C:/Users/TITANI~1/tmp/` only.

**Method:** six slices, seven Sonnet workers, one Opus manager. Every slice was
re-verified by the manager independently — no worker-reported number was taken
on trust, and the manager implemented the COLOR HUB fix directly (§4.1) after
that slice stalled. Independent verification changed the outcome repeatedly:
a pattern-source edit was challenged and withdrawn (§7.2), a "fixed" groupBits
claim was reclassified as unshippable (§7.1), a wire-file change was
re-verified against the invariants and a neighbouring red proved pre-existing
by swapping in the stock file (§4.2), and two published root causes in `_327`
were refuted by measurement (§4.2).

---

## 1. Outcome at a glance

| Slice | Subject | Result |
|---|---|---|
| S1 | Wedding show ruled test_bench-only | **DONE** — 3 reds fixed, refusal made explicit + tested, CaptainPad picker gated |
| S2a | Engine infra contracts (8 test cases) | **DONE** — 3 fixed, 5 proven to be a local-machine artifact |
| S2b | Pattern/playlist contracts (8 test cases) | **6 fixed, 2 left red on purpose** — see §3 and §7.2 |
| S3 | Live Touch UI (2 reds) | **DONE** — both fixed; both published root causes were wrong (§4) |
| S4 | Test plumbing per rulings | **DONE** — guard reframed, 6 tests skip-with-reason |
| S5 | Pattern gallery audit + README link | **DONE** — 0 MB removable, link added, size story corrected |
| S6 | Report renumber + CI backlog | **DONE** — 4 pure renames, 6 citations repointed |

### What is still open, and what needs Sina

Nothing below is a blocker I could have closed without an art or ownership call.

| Open item | Where | What I need from you |
|---|---|---|
| UV violet-lane under-drive (`:257`) | §7.2 | Is the 160 bar right for test_bench's compressed capable band, or do these looks need more violet drive on the rig? At least `17` and `18` sit behind it — answer it **once**, not pattern by pattern. |
| UV distinctness `01` vs `04` (`:497`) | §7.2 | Re-art one of the two single-band travelling-wave looks, or accept the pair and relax the bar with a written rationale. I declined to relax it silently. |
| `05_breathing_violet_horizon` look changed | §7.2 | Eyeball it. The fix restores the header's documented 0.88-1.00 core; the old render you saw was under-realized. |
| `08_quiet_signal` look changed | §7.3 | Eyeball it. It now plays its whole envelope instead of the first 11.6%. You approved the buggy render. |
| Orphaned `wedding_party` gallery, 30 MB | §6 | Delete for consistency with the wedding ruling, or keep as a historical render. |
| Gallery size (1469 MB) | §6 | The GIFs are **81%** of it and back only a "Download GIF" link. Dropping them is a **−81%** cut that costs nothing displayed — and `_327` had this exactly backwards. |
| Pre-existing sim red | §9 | `touch_control_take_playback_overlay_browser:98`, proved not ours. |
| Load-sensitive engine flake | §9 | `live_touch_timeline_takeover_api:40` passes in isolation, fails under full-suite load. |

---

## 2. S1 — Wedding show (operator ruling: titanic carries none)

The wedding was **not** added to the titanic scene. The opposite was done.

**Root situation found:** the wedding is entirely data-driven — the only
`wedding` reference in `marsin_engine/` was the test file itself, and the only
one in `CaptainPad/` was a prose code comment. titanic carried
`special_events/wedding_program.yaml` plus a single `playlists/wedding_party.yaml`,
i.e. a show program referencing four playlists that did not exist in that
scene. That half-carried state was the actual defect.

**Removed** (completing the ruling; an earlier commit had already dropped 4 of
the 5 titanic wedding playlists and left two stragglers):

- `simulation/scenes/titanic/special_events/wedding_program.yaml`
- `simulation/scenes/titanic/playlists/wedding_party.yaml`

Verified independently by the manager that **nothing** in the titanic scene
tree still references either file (`grep -rn "wedding" simulation/scenes/titanic/`
returns zero hits), so no dangling cue was left to fail at fire time.

**Fail-loud, not silent absence.** `marsin_engine/lib/special_events/special_events_service.js`
already refused loudly at ARM (`SPECIAL_EVENT_PLAYLIST_MISSING`, naming scene,
missing playlists and what is available). Rather than duplicate it, the throwing
check was split into a non-throwing `_checkPlaylistsUsable` / `isShowUsableHere(show)`
and `getState()` now publishes `playlistsUsable` per show per frame (`:1604`).
The `SHOW_NOT_FOUND` refusal was tightened to name the **scene** as well as the
show.

**CaptainPad** (`utils/special_events_api.ts`, `components/special_events/special_events_view.ts`):
the picker now offers only shows the active scene can actually ARM. Two details
matter and both are covered by new tests:

- an **already-armed** show is resolved from the *unfiltered* catalog, so gating
  can never make a running show vanish from its own screen;
- `playlistsUsable` is parsed **strictly** — a payload missing the flag throws
  rather than defaulting, per the no-fallback rule.

Engine and client halves land together, so there is no wire break.

**Tests.** `wedding_show.test.js` now pins the real contract: playlists,
palette-immunity and lit-render are asserted against **test_bench**, plus a new
converse test that titanic carries **neither** the show file **nor** any wedding
playlist, plus a new fail-loud test that builds a real `SpecialEventsService`
against titanic's real directory and asserts `arm('wedding_program')` rejects
with `SHOW_NOT_FOUND` naming both show and scene. No test was skipped or
deleted, and nothing dropped below what it protected before.

---

## 3. S2 — Content-vs-contract reconciliation

Per-failure resolution for all 19 engine reds from `_327` P0-1:

| # | Test | Resolution | Why |
|---|---|---|---|
| 1 | `companion_single_analyzer_contract:13` | **fixed-contract** | Test read the live, operator-tuned `states/titanic/audio_state.yaml` as if it were a static contract. Reframed onto `config.yaml`'s portable default + `mergeAudioConfig(base,{})` (the documented never-tuned-scene path). The state file was **not** touched. |
| 2 | `revert_clears_spatial:85` | **fixed-contract** | Test drove `/movement-rate`, deliberately retired for Live Touch. Rewritten onto the authoritative overlay slot action (bind `movementTrace`, stage the five-colour palette, dispatch on the slot). |
| 3 | `revert_clears_spatial:140` | **no change needed** | Pure cascade from #2 holding the arm lease. Passes once #2 is fixed. |
| 4-8 | `all_models_load_lint` ×5 (`dev_test_bench` groupBits) | **local-machine artifact — no shippable change** | See §7.1. Not a branch defect. |
| 9 | `ambient_playlist_derivation:83` | **fixed-contract** | Promoted block located by position instead of assumed to be the literal tail; other approved families may follow it. |
| 10 | `te_sign_surface_contract:84` | **fixed-content (real art bug)** | See §7.3 — the pattern only ever played 11.6% of its envelope. |
| 11 | `transition_gallery_tool:89` | **fixed-contract** | Test pinned 20/30/30 entries; reality is 13/10/10. Manager verified against the live `baby_tease.yaml` (13 entries) and the frozen `baby_boy`/`baby_girl` gallery manifests (10 items each). The 20/30/30 predates `_305`/`_306`. |
| 12 | `uv_only_contract:257` | **partly fixed — still RED, now on `17_violet_mantas`** | Three-layer story, see §7.2. (a) `01_blacklight_tide` was a **measurement** artefact: the 400-step (~5 s) window was tuned on titanic, where capable pixels span the full `nx` range, but test_bench's violet-die pixels occupy only `nx ≈ 0.45..0.93` so a slow travelling wall never crosses that band in 5 s. Widened to 1600 steps (~20 s, > one cycle) — the **threshold was not lowered**, the measurement was made long enough to see the real peak. (b) That unmasked `05_breathing_violet_horizon`, a **genuine content defect** (fixed). (c) That in turn unmasked `18_uv_ink_plumes` (could **not** be justified as a defect — reverted) and then `17_violet_mantas` (138/160). Left red deliberately: this is a population problem, not one bad pattern. |
| 13 | `uv_only_contract:488` | **RED — escalated to the operator as an art decision** | `01_blacklight_tide` vs `04_cathedral_uv_ribs` median class separation **0.1725** against a 0.18 bar, **27 of 30** sampling windows below it. That is genuine similarity between two single-band travelling-wave looks, not sampling luck. See §7.2. |
| 14 | `white_only_playlist_contract:30` | **fixed-contract** | Test's `WHITE_IDS` listed only the 5 legacy patterns; the playlist is the 5 legacy **plus** `white_only/01..20` (25 total, byte-identical across both scenes — verified). That is report `_312`'s wave. `WHITE_IDS` extended to 25; every other protection (all sliders in declaration order, finite and in `[0,1]`, no modulations, no MIDI, byte-identity) kept. **No playlist entry was deleted.** |
| 15 | `white_pattern_intent_contract:20` | **fixed-fixture** | `62_white_shimmer` source has had `whiteKick = 0.30` since the file was created (`git log -L`); the design-intent record carried `0.2` for that one control while all nine others matched. Fixture corrected to `0.3`. The pattern source was not touched and `validatePatternIntent` was not relaxed — catching exactly this drift is the test's purpose. |
| 16 | `ambient_extra_contract:152` | **fixed-contract** | Same positional-block fix as #9. |
| 17-19 | `wedding_show` ×3 | **fixed-contract** | §2. |

---

## 4. S3 — Live Touch UI

### 4.1 COLOR HUB overflow — FIXED (manager-implemented)

`simulation/tests/live_touch_ui_layout.test.js:1890` now passes.

**Cause.** The docs/70 W4 landscape compaction block in
`CaptainPad/live_touch/touch_control.html` compacts every shared `.ch-*` row,
but `_289`'s spacing pass and that block's own measurement were both taken
against the **TWO COLOUR / PALETTE TURNS** cards. `.ch-follow-empty` and
`.ch-follow-state` exist **only** inside `#chCardFollow`, so neither was in the
measured stack and both kept portrait-sized margins (8px, and 2px/8px) while
every row around them gave its back. FOLLOW is also the tallest card, so it is
the one card that could not afford the omission — hence the 4.9px overrun that
pushed `#chRunFollow`, the card's **primary action**, below
`.panel { overflow: hidden }`: invisible and unreachable in the show
orientation.

**Fix.** Both rows added to the same block at its existing 3px convention.
Both are plain **text** rows carrying no `::after` hit region and no 44pt
obligation, so this is pure chrome — `.ch-run`'s 44px real box is untouched and
no touch target shrank. 11px recovered against a 4.9px overrun.

**Verified:** the named test passes, and the full file is **39 pass / 1 fail**
(the remaining fail is 4.2 below) — no other layout test regressed.

### 4.2 TAKE readiness gate — FIXED, after both published root causes proved wrong

`simulation/tests/live_touch_ui_layout.test.js:582` now passes; the file is
**40/40**.

Worth recording how this one went, because two confident diagnoses were both
wrong and the real cause was somewhere else entirely.

**`_327`'s stated root cause is refuted by measurement.**

`_327` P0-4 attributed the 30 s timeout to the TAKE scripts being injected
dynamically with `?v=Date.now()` at `touch_control.html:4395-4400`, "timing-
fragile under `file://`". Direct measurement disproves this:

- Loading the panel **raw** over `file://`: `window.TouchTake`,
  `window.TouchTakeBankRuntime` and `window.__wire` are **all present**, zero
  page errors. The `document.write` injection works.
- Loading it under a faithful replica of the test's own hermetic harness, in
  **both** `captainpad_embed=native` and web mode: all three globals present,
  `TouchPixelViews.readyStatus === 'fulfilled'`, zero errors.
- `_327` also never mentions that the gate at `:610-611` has a **fourth**
  clause — `window.TouchPixelViews?.state().readyStatus === 'fulfilled'`.
  Measured trajectory: satisfied at **t = 0 ms**.
- A rAF-throttling hypothesis (puppeteer's `waitForFunction` defaults to
  `polling: 'raf'`) was tested and also **refuted**: the gate is satisfied in
  **6 ms** under both raf and 100 ms interval polling, with rAF ticking
  normally (20-60 ticks/s).

**So the readiness gate is not what times out** — the test sails through it and
hangs on a later wait.

**The actual root cause** (found by the S3 worker, by instrumenting the events
around the failure and reproducing it deterministically twice):

`touch_control_wire.js` publishes a periodic `touchtransportstate` heartbeat
every ~2 s. In this hermetic suite it always reported `leaseAcquired: false`,
because the only thing that ever flips that flag true is the engine's ARM ACK
over the control socket — and the harness's stub `WebSocket.send()`
deliberately **throws**, so the ACK can never arrive. `touch_control.html`'s
listener for that heartbeat tears down any in-progress TAKE recording whenever
the lease is unconfirmed. The recording was therefore being wiped every ~2 s,
the test's stop-recording click kept starting a fresh empty one, and the loop
ran until the 30 s timeout. Nothing to do with script loading.

**Fix** — deliberately minimal, and it does **not** change production
behaviour:

- `CaptainPad/live_touch/touch_control_wire.js`: the closure-private
  `armLeaseAcquired` var is renamed to `state.leaseAcquired` (9 sites),
  exposing it through the same `window.__wire = state` "headless verification
  only" seam that `armed` / `online` / `phase` already use. Pure rename — every
  real timing and condition is untouched.
- `simulation/tests/live_touch_ui_layout.test.js`: one line,
  `window.__wire.leaseAcquired = true`, placed **beside the existing
  `TouchTakeEligibility` stub that exists for the identical reason**.

**Manager verification of this fix**, since it touches the invariant-bearing
wire file:

- The diff touches **none** of the do-not-touch invariants — `grep` over the
  diff for `spatialSlotUsed` / `allocateSpatialSlot` / `releaseSpatialSlot` /
  `pointer.slot` / `spatialContactKey` / `acquireLease` / `assertState` /
  prepare-queueing returns **zero** hits, and all invariants remain present in
  the file.
- The stub does **not** weaken the lease-refusal contract: the assertion
  `assert.match(eligibilityReasons.lease.reason, /lease is not confirmed/)` at
  `:611` runs **before** the stub at `:626` and still exercises the genuine
  `leaseAcquired === false` refusal path.
- The one remaining sim red, `touch_control_take_playback_overlay_browser.test.js:98`
  ("PLAY must still emit spatial writes"), was **proved pre-existing**: I
  swapped in the stock `HEAD` copy of `touch_control_wire.js`, re-ran that
  suite, and it failed identically — then restored the fixed file and
  re-verified. It is not caused by this change.

The Live Touch do-not-touch invariants (spatial stroke-slot pool, spatial
contact key, ARM chain order, atomic prepare queueing) were **not** modified by
this wave.

---

## 5. S4 — Test plumbing (both per operator ruling)

**(a) `bench_mirror_state.yaml` stays tracked.** The guard at
`simulation/tests/bench_mirror_state.test.js:224` asserted the file was
**absent**, which can never hold for a deliberately tracked file. What the test
actually guards is that the suite never **writes** to the repo's real scenes
directory, so it now snapshots the file's bytes before the refused writes and
asserts they are **byte-identical** afterwards — present-and-unchanged proves
non-mutation exactly as absent-and-still-absent did. The absent case is still
handled explicitly (no silent fallback). The operator ruling is recorded in a
comment. The file was **not** untracked, gitignored or deleted.

**(b) Six `:6969`-dependent sim tests now skip with a reason.** New probe-only
helper `simulation/tests/helpers/sim_server_probe.mjs` opens a `net.connect`,
destroys the socket immediately, and **never binds or listens**. Wired to
exactly the six call sites named in `_327` P1-3 (manager counted the skip sites
to confirm: 6). The skip reason names the port and says how to start the sim.

---

## 6. S5 — Pattern gallery (operator ruled KEEP) + README

**Nothing was removed — correctly.** The audit found **zero** unreferenced
media: 1162 media files on disk, 1162 referenced. Manager re-ran an independent
reference check across all 37 HTML pages: **1175 distinct local references, 0
dangling.**

**The size story in `_327` is backwards, and this matters for the operator's
B4 decision.** Measured composition:

| Ext | Count | MB |
|---|---:|---:|
| `.gif` | 575 | **1194.4** |
| `.mp4` | 587 | 266.0 |
| `.json` | 36 | 2.6 |
| `.html` | 37 | 2.3 |
| `.md` | 1 | 0.0 |

`_327` P1-1 advised shipping "the `.mp4`s **or** the `.gif`s, not both — that
alone is roughly half the payload". It is not half: **the GIFs are 81% of the
payload and the MP4s only 18%.** The wave brief's instruction to prefer the GIF
wherever an MP4 has a GIF equivalent would have made the gallery roughly
**4.5× larger per clip**, not smaller.

And the two formats are not interchangeable here. Inspecting the pages:

- the **MP4 is the displayed artefact** — `<video src="videos/….mp4" autoplay
  muted playsinline loop>` driven by real transport controls (play/pause, a
  seek `<input type="range">`, repeat, elapsed time);
- the **GIF is only a download link** — `<a href="gifs/….gif" download>Download
  GIF</a>`, never rendered inline.

So removing MP4s would break the viewing experience outright. **Size delta this
wave: 0 MB** (1469 MB before and after), which is the right answer given the
ruling to keep the gallery.

**Concrete option for Sina, costed:** dropping the GIFs and their "Download
GIF" links would take the gallery from ~1465 MB to ~271 MB (**−81%**), lose
nothing that is actually displayed, and bring it under the GitHub Pages 1 GB
published-site limit. That is an operator decision, not taken here.

**One file in the gallery did change, and it created a loose end.**
`docs/pattern_gallery/index.html` was regenerated by the permanent tool while
fixing #11. The only diff is the **Wedding Party card being dropped** — a
direct, correct consequence of S1 removing titanic's `wedding_party.yaml`.

Side effect worth a decision: `docs/pattern_gallery/playlists/titanic/wedding_party/`
(**30 MB**, gifs + videos + its own index) is now **orphaned** — nothing links
to it except its own `index.html` and `manifest.json`. I deliberately did
**not** delete it: it is complete rendered art, not junk, it became unreferenced
only as a mid-wave side effect, and the operator's ruling was that the gallery
stays. **Sina's call:** delete it to reclaim 30 MB and stay consistent with the
"titanic has no wedding" ruling, or keep it as a historical render. Deferring
costs nothing and is reversible; deleting is not.

**README.** `README.md:422` gains a relative
`[Pattern gallery](docs/pattern_gallery/index.html)` entry in the existing key-docs
list; the entry point was verified to exist. Note a `_327` misattribution: the
root README never advertised the Pages gallery URL — that URL lives in
`docs/pattern_gallery/README.md:8`, and the 1 GB Pages concern applies there.

---

## 7. Corrections to `_327` / `_328`, and one held item

### 7.1 The 5 `dev_test_bench` groupBits reds are a local-machine artifact

`_327` counted these among "19 engine failures, all from test files new on this
branch". They are not a branch defect and cannot reproduce on a fresh clone:

- `marsin_engine/models/dev_test_bench.js` is a **zero-pixel placeholder**
  (`pixelCount = 0`, `pixels = []`).
- The stale `groupBits` lived in `marsin_engine/models/dev_test_bench.viewmasks.js`,
  which is **untracked and gitignored** (`.gitignore:205`).
- `model_loader.js:55-68` returns `declaredGroupBits: null` when that sidecar is
  absent, and `assignGroupBits` (`:142`) runs the missing/stale drift check
  **only** when it is non-null.

So on a clean checkout the sidecar does not exist, the check never runs, and
those five tests pass. The sidecar was repaired locally for consistency, but
**no shippable file changed** and none could. Worth noting as a suite-honesty
issue: a gitignored local file can silently redden this suite on one machine.

### 7.2 The UV cascade: one fix accepted, one refused, one escalated

`uv_only_contract:257` is a loop that stops at its first violation, so each fix
unmasked the next pattern. The manager challenged every pattern-source edit
before accepting it, because "tune constants until the metric passes" is the
exact failure mode to guard against here.

**`01_blacklight_tide` — measurement, not art.** Accepted (see #12).

**`05_breathing_violet_horizon` — ACCEPTED as a genuine defect.** One
coefficient, `resolvedTravel = liveBreathDepth * 0.38` → `* 0.70`. I verified
the justification independently against the pattern's **own header**, which
states: *"the un-lit hull rests at a 0.15-0.21 violet keep; the afterglow
spread carries a 0.35-0.58 mid field; **the horizon core peaks at 0.88-1.00**"*,
with `breathDepth` documented as *"vertical travel distance"*. The old
coefficient pinned the band to `ny ∈ [0.31, 0.69]` and peaked at **54/255** —
it cannot deliver a 0.88-1.00 core. Decisively, it was under-realized **on
titanic itself** (peak 204), so this is not a test_bench measurement artefact.
Same shape as §7.3: code that fails to deliver what its own documented intent
promises. After: test_bench 54 → 194, titanic 204.

**`18_uv_ink_plumes` — REFUSED, reverted.** The worker attempted a `radiusBase`
tune, could not justify it as a defect rather than metric-chasing (its attempts
only reached 152 against a 160 bar), and **reverted the file itself** — I
confirmed it is byte-identical to `HEAD`. Its diagnosis: peaks **101/255** on
test_bench's compressed capable band (`nx 0.447-0.927`, `ny 0.093-0.146`).
Refusing to ship an unjustified art tune was the right call.

**`:257` remains RED, and the final full run shows it now stops at
`17_violet_mantas` (peaks at 138 against the 160 bar)** — not 18. That is the
important signal in this whole cascade: this is **not one bad pattern**, it is
a *population* of UV looks that under-drive the violet lane when measured
against test_bench's compressed capable band. `01` was a measurement artefact,
`05` was a real defect, and behind them sit at least `17` and `18`. Chasing
them one constant at a time is precisely the wrong response. **Recommendation
for Sina:** treat this as one question — is the 160 bar right for test_bench's
geometry at all, or do these looks genuinely need more violet drive on the rig?
— and answer it once, with eyes on the fixtures, rather than pattern by pattern.

**`:488` distinctness — ESCALATED to Sina, deliberately left red.**
`01_blacklight_tide` vs `04_cathedral_uv_ribs`: median class separation
**0.1725** against the 0.18 bar, with **27 of 30** sampling windows below it.
Extended sampling confirms persistent similarity, not sampling luck. I
explicitly declined the available "adjust the bar" option: lowering a
distinctness contract to accommodate two looks that genuinely are similar would
hide the finding, and the bar is not obviously wrong — two of twenty UV looks
reading as near-duplicates is exactly what such a contract should flag.
**This is an art decision:** re-art one of the two single-band travelling-wave
looks, or accept the pair and relax the bar with a written rationale.

### 7.3 `08_quiet_signal` was a genuine art bug the test caught

`te_sign_surface_contract:84` ("TE sign mean range 23.9 is too static") was
**correct**. `eventClock` advanced by `dt * localMultiplier` and wrapped at
`eventPeriod`, but `eventAge` advanced by unscaled `dt` and was reset at the
same wrap, so `eventPhase = eventAge / eventPeriod` could never exceed
`1 / localMultiplier`. Manager reproduced the arithmetic: at the saved default
`localSpeed = 0.30` the multiplier is **8.620**, so the cue was truncated at
**11.6%** of its envelope — matching the symptom exactly. `eventPhase` is now
derived from the same scaled clock that decides the wrap, which restores the
behaviour the pattern's **own comment already claimed**.

**This changes how the pattern looks** — it will animate substantially more
than the version Sina approved, because Sina approved the buggy render. Worth
an eyeball before the show.

### 7.4 `simulation/scenes/titanic/playlists/default.yaml` — not a real change

It shows as modified but is **byte-identical to HEAD** (`cmp` clean; working
copy, index and HEAD all carry 340 CRLF lines). With `core.autocrlf = true`,
git hashes the CRLF working file as LF and disagrees with the CRLF-committed
blob — a pre-existing latent condition merely *revealed* when a worker touched
the file's mtime. Nothing was changed and nothing needs reverting. Two workers
reached this conclusion independently.

---

## 8. S6 — Housekeeping

### Renumber map (4 pure renames, byte-identical — verified)

| Old | New | Kept the number | Basis |
|---|---|---|---|
| `20260817_310_crisp_03_06_cadence_retest.md` | `20260817_330_…` | `310_effects_audit_and_plan` | self-titles `_310` "per the thread-tracker reservation" |
| `20260817_311_live_touch_production_stabilization.md` | `20260817_331_…` | `311_baby_reveal_palette_contract_v2` | self-titles `_311`; tracker `:18893`/`:18942` and the dossier `:345` all cite `_311` = Baby Reveal |
| `20260817_312_timeline_lease_reliability_hardening.md` | `20260817_332_…` | `312_white_only_pattern_wave` | self-titles `_312`; `_313` (UV wave) calls itself its "twin" |
| `20260817_316_audio_configuration_native_fabric_fix.md` | `20260817_333_…` | `316_lt_performance_effects_review` | self-titles `` `_316` ``; tracker `:19107-19109` and report `_320` cite `_316` = the LT Performance review |

The four renamed files carry no self-references (`grep` count 0 each), which is
why they were the ones to move — the retained files weave their numbers through
their own titles and bodies, and downstream chains (notably `_316 → _320`)
depend on them.

Manager independently re-derived all four and agrees. My own first reading of
the tracker suggested the opposite for 311/316; that reading was wrong — two
tracker lines are themselves collision artifacts, and S6 correctly repointed
exactly those two.

**Citations updated (7):** `.agent/context/now.md` ×2,
`.agent/memory/bm_readiness_thread_tracker.md` ×2,
`.agent/projects/bm26_show_readiness.md` ×3 — the seventh found by the manager
on a final sweep, a stale `` `_316` LANDED: native Audio configuration `` at
`bm26_show_readiness.md:2193` that the worker missed while correctly fixing the
same document's table row. Repointed to `_333`.

Final sweep result: only three `_310`/`_311`/`_312`/`_316` citations remain
anywhere outside the reports directory, and all three correctly refer to the
**retained** reports (`_310` Effects review ×2, `_311` Baby Reveal ×1). Zero
dangling references to renamed content.

`_327`'s own collision table was deliberately left alone — it is a historical
diagnostic describing the pre-fix state.

### CI gap backlog card

Appended to `.agent/context/now.md` under `## Hot` (the file has no Backlog
section; Hot is where live open gaps live, and the entry is labelled
"(Backlog, operator ruling)"). Records that `.github/workflows/` holds only
`security_privacy_scan.yml`, so suite-green is honor-system and a red suite can
reach `main` unnoticed. No dates or deadlines — what and why only.

---

## 9. Validation gate

Run by the manager, not by workers. Headline: **29 red tests → 3**, of which
**2 are deliberate art escalations** and **1 is proved pre-existing**.

| Gate | Result |
|---|---|
| `CaptainPad` `npm test` | **156 files, 2699 pass / 0 fail / 6 skipped** (baseline 2695; +4 from S1's new tests) |
| `CaptainPad` `npm run typecheck` | **PASS** — 0 errors |
| `CaptainPad` `npm run lint` | **PASS** — 0 errors, 9 warnings (identical to the `_327` baseline; no new warning) |
| `node --check` on every edited JS | **PASS** — 0 failures (includes the untracked `sim_server_probe.mjs` and the gitignored `dev_test_bench.viewmasks.js`) |
| `simulation` `npm test` | **2554 tests — 2545 pass / 1 fail / 7 skipped / 1 todo** (was 2543 pass / **10 fail** / 0 skipped) |
| `marsin_engine` `npm test` | **3941 tests — 3939 pass / 2 fail / 0 skipped / 0 todo** (was 3920 pass / **19 fail**) |
| `python scripts/security_check.py --all` | **PASS vs baseline** — 6 findings, byte-for-byte the same 6 as `_326`: one controller MAC in six **untracked**, gitignored, deploy-excluded `simulation/.scene_backups/studiodj/*/controllers.yaml` copies. **Zero new findings. Nothing tracked fails the scanner.** |

### Simulation — the one remaining red is pre-existing

`touch_control_take_playback_overlay_browser.test.js:98` ("PLAY must still emit
spatial writes"). **Proved pre-existing**, not caused by this wave: I swapped
in the stock `HEAD` copy of `touch_control_wire.js`, re-ran that suite, saw the
identical failure, then restored the fixed file. It is almost certainly the
10th failure in `_327`'s count that its P0 list never enumerated (`_327` named
only 9: bench_mirror + COLOR HUB + TAKE + six `:6969`).

The six `:6969` tests now **skip with a reason** instead of failing — confirmed
by the skip count going 0 → 7 (S4's six plus one pre-existing) while failures
went 10 → 1, with no show port ever bound.

### Engine — 19 reds → 2, both deliberate

The engine suite went from **3920 pass / 19 fail** to **3939 pass / 2 fail**.
The test count rose 3939 → 3941 because S1 added the wedding-refusal and
titanic-carries-none tests.

**A load-dependent flake, flagged not swept.**
`tests/effects/live_touch_timeline_takeover_api.test.js:40` failed the *first*
full run with *"no sACN sender line in engine output"*, **passes 1/1 in
isolation**, and did **not** recur on the second full run. That is an
engine-startup timing flake under full-suite concurrency, not a regression —
and it was independently hit by a worker's run too. Recording it because a
suite with a load-sensitive flake will eventually cost someone a false alarm,
and the next person to see it should not have to re-derive that it is benign.

The two genuine reds are both `uv_only_contract` and are deliberate — see §7.2:

- `:257` — `uv_only/17_violet_mantas` violet lane peaks at 138 against the 160 bar.
- `:497` — `uv_only/01_blacklight_tide` vs `04_cathedral_uv_ribs`, median class
  separation **0.175**: *"two of the twenty read as the same look"*.

---

## 10. Change inventory (for the commit)

**Engine** — `lib/special_events/special_events_service.js`;
`patterns/ambient_extra/08_quiet_signal.js`;
`patterns/uv_only/05_breathing_violet_horizon.js`;
`tools/playlist_gallery/pattern_goals.json`; tests:
`companion/companion_single_analyzer_contract`, `effects/revert_clears_spatial`,
`patterns/ambient_extra_contract`, `patterns/transition_gallery_tool`,
`patterns/uv_only_contract`, `patterns/white_only_playlist_contract`,
`special_events/wedding_show`.

**CaptainPad** — `live_touch/touch_control.html` (COLOR HUB),
`live_touch/touch_control_wire.js` (lease flag onto `state`),
`utils/special_events_api.ts` (+test), `components/special_events/special_events_view.ts` (+test).

**Simulation** — deleted `scenes/titanic/special_events/wedding_program.yaml`
and `scenes/titanic/playlists/wedding_party.yaml`; tests:
`bench_mirror_state`, `live_touch_ui_layout`, `pixel_map_edit_interaction`,
`pixel_map_edit_lifecycle`, `pixel_map_geometry_regression`; **new**
`tests/helpers/sim_server_probe.mjs` (untracked — needs adding).

**Docs / Agent OS** — `README.md`; `docs/pattern_gallery/index.html`
(regenerated); `.agent/context/now.md`; `.agent/memory/bm_readiness_thread_tracker.md`;
`.agent/projects/bm26_show_readiness.md`; four report renames `310/311/312/316`
→ `330/331/332/333` (the four `_3xx` files are **untracked new** + four
**deleted** old paths — a rename git will detect once staged).

**Deliberately NOT changed:**

- `marsin_engine/states/**` — all five dirty files are the operator's
  pre-existing live tunings, byte-for-byte as this wave found them.
- `simulation/scenes/titanic/playlists/default.yaml` — shows dirty, is
  byte-identical to `HEAD` (§7.4). Nothing to stage, nothing to revert.
- `marsin_engine/models/dev_test_bench.viewmasks.js` — repaired locally, but
  gitignored and unshippable (§7.1).
- `simulation/scenes/test_bench/bench_mirror_state.yaml` — stays tracked per
  ruling; the guard changed instead (§5a).
- `docs/pattern_gallery/**` media — 0 bytes removed (§6).

**Untracked files that still need `git add`:** `simulation/tests/helpers/sim_server_probe.mjs`,
the four renamed `_330`-`_333` reports, and `_326`/`_327`/`_328`/`_329`.

---

*No git write operation was performed. No port in 6966-6972 / 6981 / 5568 was
bound. `marsin_engine/states/**` untouched.*
