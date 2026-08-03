# `_100` — Timeline zoom E2E (slice S5) — and the S1–S5 wave closes

**Builds slice S5 of the `_94` design** under the operator ruling of 2026-07-31
(D1–D8 as recommended): the committed end-to-end scenario suite that proves the
zoom wave's WIRING, not just its logic. Specs in authority order: `_94` (design +
exit table), `_95` §3 (the landed engine API), `_97` §7 (what S5 must cover,
especially the two exit paths never exercised live), `_98` (the timeline logic as
it now stands — every assertion here is post-`_98`).

**Nothing in `CaptainPad/`, `simulation/`, `marsin_engine/patterns/**` or any
playlist, plan or scene file was touched.** Zero device HTTP. Zero sACN toward
hardware — and this time that is ASSERTED on every engine boot rather than
believed (§2).

---

## 0. Headline

| Gate | Result |
|---|---|
| **New e2e suite** `tests/e2e/timeline_zoom_e2e.test.js` | **17 / 17 pass, 0 fail** (~2 min) — 3 consecutive clean runs |
| Engine timeline family | **410 / 410 pass, 0 fail** (baseline 407 → +3 new) |
| Full `marsin_engine` suite | 2 478 tests, 2 470 pass, **8 fail — the known baseline set, zero new** |
| CaptainPad vitest | **914 pass / 6 skipped, 0 fail** — exactly baseline (untouched) |
| Security check (`--all`) | 7 findings, **all pre-existing**, none in any file this thread wrote |
| `marsin_engine/config.yaml` | **CLEAN** vs HEAD after every run — nothing to restore |

**Every row of the exit table is covered** — including the two `_97` could not
reach live: **engine restart mid-zoom (both scopes)** and **plan save mid-zoom**.
One row (festival window closing) is UNIT-only for a stated structural reason,
not an omission (§3.2).

**One real bug found and fixed** (B1, in `_95`'s S1 code — the day ribbon
under-sampled and mis-stated hours of the night), plus **two findings reported,
not fixed** (§5).

---

## 1. What landed

| File | Change |
|---|---|
| `marsin_engine/tests/e2e/timeline_e2e_harness.mjs` | **NEW** — the shared e2e rig: black-holed config writer + boot-time safety assertions, run-time fixture plans, REST/WS clients, real restart |
| `marsin_engine/tests/e2e/timeline_zoom_e2e.test.js` | **NEW** — 17 scenarios |
| `marsin_engine/lib/timeline/resolve_deck_state.js` | **FIX B1** — `buildDaySegments` now samples cue HAND-BACK boundaries (`durationMin` window end, program hold end) |
| `marsin_engine/tests/timeline/timeline_resolve_deck_state.test.js` | +3 tests pinning B1 (incl. a full ribbon-vs-resolver equivalence walk) |
| `marsin_engine/lib/state_paths.js` | **NEW** `resolveTimelineDir` + `MARSIN_TIMELINE_DIR` — the show-plan library becomes redirectable |
| `marsin_engine/lib/api_server.js` | the timeline scene dir resolves through `state_paths` instead of an open-coded join |
| `marsin_engine/engine.js` | `loadConfig()` honours `MARSIN_CONFIG_FILE` (fail-loud on a set-but-missing path) — the seam that finally lets a harness neutralise the `controllers:` block |
| `marsin_engine/tests/helpers/setup_config_guard.mjs` | doc block updated for the above |
| `.agent/ops/timeline_e2e_tests.md` | the "wanted: a scripted runner" section becomes the landed engine runner + its safety contract; the DOM half is restated as still wanted |

---

## 2. Safety — three walls, every one asserted

`_97` §4.4 is the reason this section exists. That thread launched an engine
with `--dest 127.0.0.9`, believed sACN was black-holed, and streamed to a real
LED controller for ~30 seconds. **`--dest` overrides `sacn.destinations` only;
the per-controller `controllers:` block carries its own host and wins for the
universes it claims** (`lib/output_dispatch.js` partitions universes by
declaration before any destination is consulted).

The honest problem underneath: **there was no way to neutralise that block.**
`engine.js loadConfig()` read `__dirname/config.yaml` unconditionally —
`MARSIN_CONFIG_FILE` governed only the autopilot write-back — so the only
"neutralisation" available was hand-editing the operator's tracked config, which
is exactly what `_97` did and what `_98` then had to flag as a commit blocker.

**Closed here.** `MARSIN_CONFIG_FILE` now means one coherent thing: *this file is
the engine's config*. It governs the boot read and the write-back, and a
set-but-missing/relative value **throws at boot** rather than silently falling
back to the real config (codex P0 — a silent fallback here is the accident).
`setup_config_guard.mjs` already points it at a byte-identical copy, so the
existing suites are unaffected; a harness that wants different settings writes
them.

On that seam the harness builds:

| Wall | Mechanism | Assertion (runs on EVERY boot and after EVERY restart) |
|---|---|---|
| sACN cannot reach hardware | config copy with `controllers: []` + `sacn.destinations: [127.0.0.9]` (plus `--dest` as belt and braces) | every `[sACN Out] Sender started` line names only the black hole · **no** `[Art-Net Out] Sender started` line at all · `GET /status.outputRouting.controllers` is `[]` · the written config is re-validated before spawn |
| No tracked-tree writes | `MARSIN_STATE_DIR` + `MARSIN_PLAYLISTS_DIR` + **new** `MARSIN_TIMELINE_DIR` | scenario **E0** asserts the plan library resolved outside `simulation/scenes/**` |
| No port collisions | random port 7700-7899; OSC / web client / VSN1 deploy / audio all off | the operator's 6967-6972 + 5568 band and his running sim stack were never approached |

`MARSIN_TIMELINE_DIR` is new because the alternative was unacceptable: every
timeline e2e needs throwaway plans, `POST /timeline/plans` writes into
`simulation/scenes/<scene>/timeline/`, and both `_95` and `_97` had to
hand-restore that tree afterwards. A committed suite that scribbles on the
operator's scene tree on every `npm test` is the incident `state_paths.js` was
written to prevent, so the seam belongs beside its two siblings.

**Fixture hygiene.** The in-window plan is built at RUN TIME with **no festival
block** (always in-window — the `dryrun_bench.yaml` trick), so nothing dated is
committed and nothing goes stale. It also picks its own **fixed-offset
`Etc/GMT±N` timezone** so "now" always lands ~17:00 in plan-local time: the
resolver's day-latch is per calendar day in the PLAN's tz, so a fixture pinned to
a real zone would quietly stop testing anything between local midnight and 03:30.
The zone is frozen at module load so it cannot flip mid-run.

---

## 3. Scenario inventory vs the exit table

### 3.1 The scenarios

| # | Scenario | Proves |
|---|---|---|
| **E0** | the spawned engine cannot reach the rig | the three walls above, as a NAMED scenario rather than a harness side effect (`_97` §7 item 8) |
| **E1** | **PERFORM on the active cue** | scoped lease + `zoom` on state AND on the broadcast · the plan moves nothing under the performer · **the full D3 loop as assertions, not a log read** (`_97` §7 item 2): `lease-deferred` logged and `lease-armed`/`lease-expired` NOT · `pendingProgram` still armed 6 s past `programLeaseSec` · controller still `manual` · exit → catchUp FIRES it and it reaches the deck |
| **E1b** | PERFORM ≡ plain takeover | `_95` §3.3's contract, measured across two engines: the scope tag is the only difference the rig sees |
| **E2** | **TIME TRAVEL on an inactive event** | the snapshot reaches the real deck through the normal dispatch · **zero live bookkeeping** (no cue fires in the log, no `activeProgram`; a `travel` lifecycle entry instead) · **static in plan-time** (D4 — the target does not drift) · steppers retarget for real · the edge **400s verbatim**, never clamps |
| **E3** | **dormant-plan rehearsal** | PERFORM arms nothing out of window · travel to an out-of-window target 400s · travel to an in-window target works, **survives the dormancy gate** (`_95` §3.7 — that gate is the earliest in the tick and used to null every lease) · exit returns to dormancy |
| **X2** | lease expiry | presence pings hold a zoom open across more than one lease window; stopping them auto-releases and logs `lease-released` |
| **X3** | autopilot OFF | zoom cleared, lease cleared |
| **X4** | **plan save mid-zoom** ← never live before | the maker's auto-save over the ACTIVE plan hot-reloads, drops the zoom, returns the deck to the plan-at-now, and the pad is **told via the broadcast** (it never asked) |
| **X5** | plan activate | zoom cleared, new plan active |
| **X6** | **engine restart mid-zoom, BOTH scopes** ← never live before | a real `SIGTERM` + reboot: no zoom, no lease, mode `armed`, controller not `manual`, the plan running on the deck again — and **a reconnecting pad sees the truth on its FIRST frame** (the connect replay), which is what stops a stale banner surviving the reboot. Also pins the boot SCRUB of the persisted lease (see F1) |
| **X8** | ENABLE the deferred show | starts it now, hands the deck to the show, and clears the zoom |
| **T1** | **two clients** | B gets the banner on its connect replay · B **browsing changes nothing** (A's zoom survives) · **one writer, one session** — B retargets and A renders the identical zoom · B's EXIT ends it for both |
| **T2** | **the `_97` race, pinned e2e** | the cleared-zoom broadcast genuinely **arrives before** the `resume()` response — so CaptainPad's pre-staked exit claim is answering a real ordering, not a hypothetical one |
| **P1** | **party fire during a PERFORM lease** | suppressed (deck untouched) and **VISIBLE** (`wouldFire`), **edge-only** (one entry per episode, not per tick), and **NOT CONSUMED** — arm latch intact, cooldown unstamped — so the session fires the moment the operator hands back. This is `_98` fix 1 proved on a real engine with a real mood feed |
| **P2** | party session mid-flight when a zoom starts | the human layer takes the deck, the live session does not tear the zoom down, and the exit lands in a COHERENT state (the card and the deck agree either way — the engine decides end-vs-rejoin; the test refuses to invent a rule) |
| **C1** | post-`_98` conformance, fixture | an expired hold owns nothing: `GET /timeline/resolve` says `defaultCue` + `ambient`, and **`source:'hold-expired-baseline'` appears nowhere on the wire** |
| **C2** | post-`_98` conformance, **the operator's own shipped plan** | `playa_default` copied in read-only: ribbon tiles `00:00 → 24:00` with no gaps/overlaps, known `source` union, **every festival day gives `ambient` real time** (`_98`'s headline asserted on the REVIEW SURFACE), and a 90-minute hold is reported as owning 90 minutes (the B1 regression guard) |

### 3.2 The exit table, row by row

`_94` §5 / `_95` §3.5 — every row accounted for:

| Exit-table row | e2e | Where |
|---|---|---|
| `POST /timeline/resume` (TIMELINE-tab gesture / EXIT button) | ✅ | E1, E2, E3, T1 |
| Lease expiry (presence pings stopped) | ✅ | X2 |
| `POST /timeline/autopilot {enabled:false}` | ✅ | X3 |
| `POST /timeline/plans` over the ACTIVE plan (maker auto-save) | ✅ **new** | X4 |
| `POST /timeline/plan/activate` | ✅ | X5 |
| **Engine restart** | ✅ **new**, both scopes | X6 |
| `POST /timeline/program/enable` | ✅ | X8 |
| **Festival window closing** | ⚠️ **UNIT only — explained** | see below |

**Why the window-closing row is not an e2e scenario.** Closing the window under a
live zoom requires either waiting for the plan's real last day to end, or
`savePlan`/`activatePlan` with a narrower festival block — and both of those are
*themselves* exit-table rows (X4/X5) that clear the zoom before the window
change can be observed. There is no route to that transition that does not
short-circuit through another exit, so an e2e scenario would assert X4, not this
row. It stays covered by `tests/timeline/timeline_zoom.test.js` *"EXIT: the
festival window closing ends a PERFORM zoom"*, which injects the clock. Its
observable e2e consequence — **a PERFORM zoom cannot exist out of window at
all** — IS covered, in E3.

Orthogonal axes from `_94` §5: program running when the zoom starts (E1) ·
program due mid-zoom (E1, X8) · party session mid-flight (P2) · plan dormant
(E3) · client disconnect (X2) · engine restart (X6) · two clients (T1) · maker
auto-save (X4). All covered.

### 3.3 `_97` §7's list

| `_97` ask | Status |
|---|---|
| 1. Perform through a phase/cue boundary | ✅ E1 — the boundary crossed is a PROGRAM cue coming due mid-zoom (the sharpest case: it is the one that would otherwise seize control), and the exit lands on the correct owner |
| 2. The full D3 loop as assertions | ✅ E1 + X8 |
| 3. Lease expiry hand-back | ✅ X2 |
| 4. **Engine restart mid-zoom** | ✅ X6 — engine side fully covered incl. the reconnect replay; the pad's toast/navigation remains unit-pinned (`shouldAnnounceZoomEnd`) pending the DOM runner |
| 5. **Plan save mid-zoom** | ✅ X4 — same split |
| 6. Two clients | ✅ T1 (+ T2 for the race) |
| 7. Ribbon parity | ✅ **by contract**, C1/C2 — the suite asserts the exact `_95` §3.1 shape the pad's pure renderer consumes (`00:00` open, literal `24:00` close, contiguity, owner/source/controller unions). A pixel-level parity check needs the DOM runner; a committed fixture captured from a live engine would rot. **This is also where B1 was caught.** |
| 8. The `--dest` trap | ✅ E0 + every boot, and the underlying seam is fixed (§2) |

---

## 4. Bug FIXED — B1: the day ribbon under-sampled and mis-stated the night

**Found by:** C1/C2 — the first time anyone asked the resolved ribbon a question
whose answer changed *between* two cue fire times.

**Root cause.** `buildDaySegments` sampled the pure resolver at the day's start,
every timed cue's FIRE time, and every phase start/end — and nowhere else. But
ownership also ends at instants the resolver itself models: a cue's `durationMin`
window end (`windowUntilMs`) and a program's hold end (`holdUntilMs`). Those were
never sampled, so the merge loop never SAW the hand-back, and a segment ran from
the cue's fire time to the next unrelated boundary.

**What that did to the review surface.** On the shipped `playa_default`,
`c_visibility_on` fires sunset−45 with a 90-minute hold; the next sample point is
the `philharmonic` phase end at sunset+60. The ribbon therefore reported the
program as owning the deck — with `playlist: default` and `controller: program` —
for the 15 minutes after its hold expired, and the same under-sampling hid the
hand-back entirely wherever the next boundary was further away. On the e2e
fixture the mis-statement was **2 h 10 m**: a program whose 30-minute hold ended
at 14:36 was drawn as owning until 16:46.

That is precisely the stretch `_98` FIX 7 exists to give the ambient
`defaultCue`. **The one surface built to make the plan honest (design D7: "the
ribbon IS the review honesty day zoom exists for") was lying about the single
biggest thing `_98` changed.** `_95`'s own real-plan sample in §3.1 shows the
symptom — its `18:49-20:34 … ctl=program` row spans past a hold that ended at
20:19; the split visible there came from a phase edge that happened to land
nearby, not from the hold.

**Fix.** `buildDaySegments` adds each applicable, enabled timed cue's
`fireMs + durationMin` and (for `kind: program`) `resolveHold(cue.hold, fireMs,
dayTimes)` to the sample set, when strictly inside the day. Resolver unchanged —
this is purely the sampler learning where the resolver's own answer changes.

**After** (e2e fixture, same day):

```
04:00-05:00  cue         c_morning    slow        autopilot
05:00-14:06  defaultCue  Ambient      ambient     autopilot   ← was hidden
14:06-14:36  cue         c_expired    burn_night  program
14:36-16:46  defaultCue  Ambient      ambient     autopilot   ← was mis-stated as c_expired/program
```

**Pinned three ways:** two named unit tests (`B1: an elapsed durationMin window
ENDS its ribbon segment`, `B1: a program hold END closes its ribbon segment`) and
a third that is the general statement — **every ribbon segment must agree with a
direct resolver probe at its start, middle and end, over three festival days**.
The ribbon is a lossless merge of the resolver or it is a lie; that test says so.
Plus the e2e guards C1/C2 on both the fixture and the operator's real plan.

**Blast radius:** `buildDaySegments` only. `resolveDeckStateAt`, `_catchUp`,
travel and `/timeline/resolve` are untouched, so `_95`'s byte-identity mandate is
intact. No wire-shape change — the pad renders the same segment objects, just
correctly split. `_97`'s renderer needs no change.

---

## 5. Findings — reported, NOT fixed

**F1 — the "runtime-only" zoom lease is written to disk.** `_94` §4.3 and `_95`
§3.5 describe the zoom as runtime-only. That is true of its SEMANTICS (a restart
never resumes it) but not of the bytes: `timeline_state.yaml` carries the whole
`operatorLease` object, `scope: 'perform'` / `cueId` / `label` and all. The only
thing between a persisted scoped lease and a rig that wakes up believing a human
holds the deck is the boot `_catchUp` scrub. That scrub works — X6 proves it end
to end on a real restart, for both scopes — so this is not a live defect, and the
suite now pins the SCRUB rather than an absence of writes. Reported because the
design's language implies a structural guarantee the persistence layer does not
provide: if the scrub ever regressed, the failure would be a stale PERFORM banner
on a rebooted ship, which is the exact "never stuck" invariant the 2026-07-03
simplification was built to protect. A one-line omission of `operatorLease` from
the persisted shape would make the guarantee structural. **Not touched here** —
it is `timeline_state.js`'s serialization contract, outside the S5 scope.

**F2 — entering ANY takeover stands the deck's pattern autopilot down.** When
the operator takes over while a non-program cue owns the deck, the next tick
disarms the baseline autopilot and the look's own pattern cycling stops (the deck
holds one pattern until the hand-back re-arms it). This is **not zoom-specific**
— E1b measures a plain bodyless takeover and a PERFORM zoom leaving the rig in an
identical state — and it follows from `_98` FIX 6 marking the restored
non-program cue's deck as baseline-driven (`_baselineArmed = true`), which the
manual path then disarms. Arguably correct (the human has the deck), but worth an
operator ruling: during a PERFORM the performer may well want the look to keep
cycling under them while they work the faders. **Report-only per the S5 scope
rule** — the mechanism is `_98`/takeover, not `_95`/`_97` zoom code.

**Pre-existing, unchanged:** the 8 full-suite failures (5 × audio_capture and
1 × osc_listener = environmental/no device; 1 × `effects_v2_mode_page_layout` =
the known full-run state pollution; 1 × `specialty_white_uv` = pre-existing
playlist-content drift between the two scenes, and `git status` confirms no
playlist file was touched). `_98`'s ninth failure
(`tests/io/status_output_routing.test.js`) is **GONE** — it was caused by the
loopback controller host `_97` restored at its landing.

---

## 6. Verification

```
cd marsin_engine
node --import ./tests/helpers/setup_config_guard.mjs --test "tests/e2e/*.test.js"
ℹ tests 17 · pass 17 · fail 0        (×3 consecutive runs, ~2 min each)

node --import ./tests/helpers/setup_config_guard.mjs --test "tests/timeline/*.test.js"
ℹ tests 410 · pass 410 · fail 0      (baseline 407 + 3 new B1 pins)

npm test
ℹ tests 2478 · pass 2470 · fail 8    (the known baseline set — zero new)

cd CaptainPad && npx vitest run
Test Files 42 passed · Tests 914 passed | 6 skipped   (exactly baseline)
```

Simulation suite **not run** — nothing under `simulation/` was touched (same
posture as `_95`/`_98`).

### 6.1 Hygiene

- Security check `--all`: 7 findings, **all pre-existing** — 6 MACs in
  gitignored `simulation/.scene_backups/studiodj/**` and one public-IP literal
  in `simulation/tests/address_merge.test.js`. **None in any file this thread
  wrote or edited.**
- **`marsin_engine/config.yaml` is CLEAN vs HEAD** after every run — nothing to
  restore. That is the point of §2: the suite never had a reason to touch it.
- `simulation/scenes/**` — no writes. `git status` shows the test_bench
  timeline and playlist dirs unmodified; the plan library the engines used was a
  temp dir.
- The operator's sim stack on :6969-:6972 / 5568 was never approached, never
  restarted, never connected to. :6967 never touched. Every spawned engine took
  a random port in 7700-7899.
- Scratch under `~/tmp/bm26_100/` (gitignored). No temp files in the source tree.
- No git operations beyond reads (`git status`, `git diff --stat`).
- No IPs, hostnames, MACs, credentials or personal data in this report; no
  future dates, deadlines or schedule planning. `127.0.0.9` is a loopback black
  hole, not an address of anything.

---

## 7. The S1–S5 wave — CLOSED

| Slice | What it delivered | Report | Status |
|---|---|---|---|
| **—** | **DESIGN** — the FESTIVAL → DAY → EVENT ladder, event zoom as a *scoped takeover*, the exit table, D1–D8 | `_94` | **ACCEPTED** (D1–D8 as recommended) |
| **S1** | ENGINE: the pure `resolveDeckStateAt` extracted from `_catchUp` (byte-identical, 1116/1116), `GET /timeline/resolve`, overview `phases` + `segments` | `_95` | **LANDED** |
| **S2** | ENGINE: lease `scope` (`perform`/`travel`), `POST /timeline/travel`, the `zoom` broadcast field, the D3 pending-program deferral | `_95` | **LANDED** |
| **S3** | PAD: day zoom — full-screen `DayView`, phase bands (incl. the midnight wrap), the resolved ribbon, theme badges, the reserved SHIFT slot | `_97` | **LANDED** |
| **S4** | PAD: event zoom — `EventSheet`, global `ZoomBanner` (green PERFORM / purple TRAVEL), presence pings, steppers, every exit rule; found + fixed the exit-alarm race | `_97` | **LANDED** |
| **(interleaved)** | BUGFIX WAVE: the seven `_93`/`_95` findings — suppressed party fires consume nothing, catchUp disarm order, ambient-under-program suppression, the plan lint, displaced-owner restore, F1, and **G1 fixed at the source** | `_98` | **LANDED** |
| **S5** | **VERIFICATION: the committed e2e suite** — 17 scenarios, every exit-table row, two clients, party-vs-zoom, post-`_98` conformance; the sACN black-hole seam; **B1 fixed** | `_100` | **LANDED — the wave is closed** |

**What the wave leaves open, deliberately, for the operator:**

- The **DOM half** of the e2e story (the pad announcing a restart/save-driven
  exit) still wants a puppeteer runner — `.agent/ops/timeline_e2e_tests.md`
  carries the spec and the engine harness is its model.
- **F1** (persist the lease or don't) and **F2** (should a PERFORM keep the
  look's pattern cycling?) are rulings, not defects.
- Unchanged from `_98`: the three shipped program looks with no `autopilot`
  block (`sunrise`, `burn_night`, `temple`), the suppressed-phase-edge
  non-refire, and the operator-gated `whenPhase: 'party_night'` restoration —
  all edits to `scenes/**`, all his.
