# 20260725_23 — Party × Timeline defect fixes: REVALIDATION (final gate)

**Author:** Revalidation agent (Opus, adversarial) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-28
**Under test:** `20260725_22` (the fixes) against `20260725_21` (the plan) and `20260725_20` (defects D1–D11)
**Brief:** try to break the fixes. No source edits, no git operations, temp files in `~/tmp`.
**Semantics in force (operator):** with a time limit sessions **REPEAT** — session → cooldown stamped at
session END → re-arm → next session under continuous music (immediate fire at cooldown expiry, dwell
carried by `moodSince`); follow-the-music untouched; boot re-arms but the persisted cooldown still
gates; takeover-release rejoins the ORIGINAL window or ends.

---

## VERDICT — **PASS. All 11 defects stay dead. Cleared for the operator all-clear.**

| Probe | Verdict | One line |
|---|---|---|
| **1** `cooldownSec: 0` / `cooldownEnabled:false` + duration on | **PASS** | Back-to-back sessions with an ambient blip of **exactly 1 s**; no flapping, no double-fire, re-arm at every boundary |
| **2** Scheduled-cue re-take under the handover re-arm | **PASS** | Party reclaims **once**, at exactly handover + `cooldownSec`, deterministic across replays; **no A/B flap** over 3 600 ticks. One operator-visible consequence — **F1** below |
| **3** Widened `_establishBaselineIfActive` live-owner guard | **PASS** | 9/9 — the ambient fill still happens in every case where it should; no "ambient never fills" regression found |
| **4** D11 on a real engine | **PASS** | Exactly **ONE** `⛔ TIMELINE DID NOT START` naming file + field; zero tick spam; clean boot after restore. Residual gap **F2** |
| **5** Original defect repros stay dead | **PASS** | Probe suite **49/49** on my run; D1/D2/D3/D6 re-driven **live**; D4 rejoin/end verified |
| **6** Cross-checks + suites | **PASS** | R6 8/8, R7 6/6; engine `npm test` **7 fails = exactly the known env 7, zero delta**; CaptainPad tsc clean + vitest **869**; swap-wedge green |
| **7** Live sanity on titanic-ext | **PASS** | Deployed engine files **byte-identical MD5** to the local fixed files; `/party-config` coherent; remote **unchanged** |

**New findings: 3, none blocking.** F1 (MED, operator-visible, predicted by plan §9.5), F2 (LOW,
follow-up), F3 (LOW, pre-existing design assumption). Details in §3.

---

## 1. Per-probe evidence

All probe files, logs and screenshots: `~/tmp/party_revalidation/`.

### Probe 1 — `cooldownSec: 0` / `cooldownEnabled:false` (`r1_cooldown_zero.test.mjs`, 6/6)

The fixer's §7.1 item, measured rather than reasoned. `durationMin: 1`, continuous mood 1, 1 s ticks.

| Config | Sessions in 400 s | Inter-session gap | Notes |
|---|---|---|---|
| `cooldownSec: 0` | **7** | `[1,1,1,1,1,1]` s | party writes = sessions (7 = 7): never a double-fire |
| `cooldownEnabled: false` (`cooldownSec` 120) | **7** | `[1,1,1,1,1,1]` s | and `effectiveState` **never** reads `cooldown` — 0 samples |
| `cooldownSec: 1` | **7** | `[1,1,1,1,1,1]` s | the end stamp is the scheduled window end, so a 1 s cooldown has already elapsed one tick later |
| `cooldownSec: 7200` | **1** in a 3 600 s drive | — | every post-session sample reads `cooldown`, remaining **monotonically decreasing** |

- **The ~1 s ambient blip the plan predicted is exactly 1 s** — one tick of `ambient` between
  `window-elapsed` and the re-fire, at t = 60, 121, 182, 243, 304, 365. Legal per plan §9.3.
- **No tick ever wrote two different looks** (that would be an in-tick A/B fight): zero multi-write ticks.
- Session length is the authored 60 s every time — no drift over 7 cycles.
- The `moodArmed` latch is `false` for **every** in-session sample and `true` for **every**
  between-sessions sample — the re-arm is real and the mid-session re-fire block is intact.
- `moodLastFire` is re-stamped at every session end and is **monotonically non-decreasing** (never rewound).
- Music stopping mid-run: sessions stop (the running fixed session rides the drop out, then ends);
  music returning produces a session again.

### Probe 2 — scheduled-cue re-take (`r2_scheduled_retake.test.mjs`, 6/6)

- **R2.1** `cooldownSec: 0`, a scheduled look cue lands mid-session at t=118: it takes the deck, party
  takes it back at t=119. **Two ownership transitions in 600 ticks, then silence** — the last 200
  ticks write nothing. Exactly the "≤1 legal re-take then settled" rule P7.2 encodes.
- **R2.2** A plan with **four** deck cues, `cooldownSec: 0`, 1 800 ticks: 20 writes total, longest run
  of consecutive write-ticks = **2**, never two looks in one tick. Bounded, not oscillating.
- **R2.3 Determinism:** the same scenario replayed twice produced **byte-identical** write sequences.
- **R2.6** 3 600 ticks: the scheduled cue writes exactly **once** (its clock trigger fires once/day) —
  the re-take is **one-way**, it cannot become an A/B fight.
- **R2.4 — the finding (F1).** With the **shipped** `cooldownSec: 120` and a `kind: ambient` look cue
  carrying `durationMin: 30`, party re-takes the deck at **exactly** handover + 120 s and keeps it for
  the rest of that cue's window. One take, at the predicted instant, then nothing. Documented in plan
  §9.5 and fixes §7.2 — recorded here with the exact timing. See §3/F1.
- **R2.5 — the shipped plan is immune.** Every protective cue in `playa_default`
  (`c_visibility_on`, `c_sunrise`, `c_burn_night`, `c_temple`) is `kind: program` with `hold.min`.
  A held program suppresses the re-take completely: **0 party re-takes over 900 ticks**, and the
  suppressed fire is surfaced as `wouldFire` — never silent.

### Probe 3 — the widened `_establishBaselineIfActive` guard (`r3_baseline_fill.test.mjs`, 9/9)

Regression hunt for "ambient never fills". Every case where the default cue **should** fill, it does:

| Case | Result |
|---|---|
| Boot into a gap (no cues due) | `ambient` applied, `_defaultCueActive` latched ✔ |
| Boot with a caught-up clock cue whose `durationMin` **elapsed** | cue restored **then** `ambient` — `ambient` is the last write ✔ |
| Boot with a caught-up clock cue still **live** | `ambient` correctly **not** written (cue owns the deck) ✔ |
| Boot with a caught-up **open-ended** cue | `ambient` correctly **not** written ✔ (the case the widening exists for) |
| `resume()` / `savePlan` with nothing owning the deck | `ambient` fills ✔ |
| Party window **expired during a takeover** → lease release | `ambient` fills, latch `null`, state `cooldown` ✔ (no limbo) |
| Party cue **deleted** by a savePlan mid-session (D8) | `ambient` is the **last** write — not stranded on the autopilot baseline ✔ |
| All four session-end paths (window elapsed / follow-music release / operator disable / resume with music off) | `ambient` on the deck within 3 ticks in **every** one ✔ |

**Static cross-check.** The only way the guard can block the fill is `_deckWindowCueId !== null`.
Every assignment that nulls `_deckWindowCueId` in `timeline_service.js` also nulls
`_deckWindowUntilMs` (lines 820/821, 1122/1123, 1377/1378, 1529/1530, 1796/1797, 1824/1825,
2372/2373), so the "orphan live window with no owner" shape that would permanently block the fill
cannot arise. `_applyDefaultCue` nulls the latch (it never writes `'__default_cue__'` into it), so a
deck sitting on the default cue always reads as "no live owner" and is re-fillable. **No regression.**

### Probe 4 — D11 on a real (LOCAL) engine

`marsin_engine/states/test_bench/timeline_state.yaml` hand-edited to `partyEnabled: "no"`, engine
started with `--model test_bench`.

```
  ⛔ TIMELINE DID NOT START — the show plan/state is not running: timeline state invalid
     (states\test_bench\timeline_state.yaml): timeline state partyEnabled must be a boolean, got "no"
```

- **Exactly 1** occurrence, at boot. Log stayed at 160 lines over the whole run.
- **Zero** `tick error` lines — the 86 k-lines/day spam class is gone.
- The api_server stayed up (`/party-config` and `/timeline/state` both **200**) and the timeline
  genuinely did **not** half-run: `cues: []`, `recentFires: []`, `planActive: false`.
- **Restored** the file → restart → **0** `⛔` lines, `⏱ Timeline service started (scene "test_bench",
  plan "playa_default")`. Clean.
- Residual gap **F2** (§3): the refusal is console-only.

**Not run on titanic-ext** (per brief) — no state corruption test was performed on the remote.

### Probe 5 — the original repros

**`_20` probe suite re-run on my machine: 49 tests / 49 pass / 0 fail.** Baseline holds
(`~/tmp/party_revalidation/probes_rerun.log`).

Plus live re-drives against a real engine on `:6968` (`r5_live_d1.mjs`, `p9_fullchain.mjs`, `p11b`):

- **D1 — live, the music never stops.** 240 s of continuously forced `audioPartyStrong = 1`,
  `durationMin 1 / cooldownSec 15 / minDwellSec 5`:

  ```
  sessions = 4: [{6,64},{82,140},{156,214},{232,238}]   inter-session gaps = [18,16,18] s
  ```

  Under the old semantics this was **one** session for the night. **And the crux:** the mood never
  dipped to calm after the first session (0 dips out of 117 samples) — so every re-fire came from the
  new **session-END re-arm**, not from a calm edge that would have re-armed even before the fix.
- **D3 — live.** `effectiveState: 'cooldown'` reachable, 23 samples, remaining counting
  `15,13,…,1`; and `cooldownRemainingSec === 0` for **every single** in-session sample.
- **D2 — live, on the real state file.** The engine was stopped with a live session, leaving
  `moodArmed: { c_mood_to_party: false }` persisted on disk. After restart the same file reads
  `c_mood_to_party: true`. In-process (R6.6/R6.7): a **mid-session** crash keeps the FIRE stamp
  (the end stamp died with the process), boots into `cooldown`, and hands out **exactly one**
  session over the following 700 s; a **mid-cooldown** crash continues the remaining cooldown to the
  second (290 s → 260 s across a 30 s outage) with the END stamp intact.
- **D4.** `p2_recall_takeover` 6/6. R3.7: window expired during the takeover → session ends, latch
  cleared, cooldown anchored at the scheduled end, `ambient` on the deck. R7.5: a takeover held for
  300 s past the window end never writes the deck and reads `manual` throughout.
- **D6 — live, fresh `expo export` dist on `:7167`** (the operator's `:6967` Metro **never touched**;
  the dist was rebuilt from source in this session, not reused). Screenshots copied to
  `~/tmp/party_revalidation/captainpadB_party_*.png`:

  | Shot | Engine | Card |
  |---|---|---|
  | `2_engine_in_session_no_reload` | `in_session`, ends in 295 s | **"IN SESSION · Party session running — ends in 4:56 · mood party"**, **no reload** (was "ARMED" for 24 s in `_20`) |
  | `5_signal_dropped` | `in_session` | "ends in 4:33 · **mood calm**" — honest about a fixed session riding the drop |
  | `6_disabled_from_another_surface` | `disabled` | **DISABLED / DISABLED** — pill and toggle agree |
  | `7_rearmed_from_another_surface` | `armed` | **ARMED / ENABLED** — the permanent contradiction is gone |

  Two `Minified React error #418` page errors, **byte-identical** to `_20`/`_22` (pre-existing
  hydration warning, not new). Note shot 2 is also the answer to the fixer's §7.7: the engine does
  **not** broadcast `partyConfig` on a session transition, so that flip was carried by the
  now-unconditional 5 s HTTP poll **alone** — the card stays honest with the WS contributing nothing.
- **`p9_fullchain` (live, both modes):** `armed → in_session (cd 0) → cooldown 25 s → in_session`
  twice, follow-the-music open/release/re-trigger clean, staleness ends an open-ended session,
  forced-while-disabled does nothing, `cooldown` reported when it outlasts the session.
- **`p8` 32/32 · `p8b` 8/8 `polluted=no` · `p10` 5/5** — all live, all matching `_22`.

### Probe 6 — cross-checks and suites

`r6_crosschecks.test.mjs` **8/8**, `r7_edges.test.mjs` **6/6**:

- **savePlan storm, 25 saves mid fixed session:** `sessionEndsAtMs` Δ = **0** (D5 stays dead), state
  stays `in_session`, ownership stays on the party cue, **no `ambient` anywhere in the storm**, and
  the session still ends at the ORIGINAL window end.
- **savePlan storm mid follow-the-music:** open-ended shape survives (`sessionFollowsMusic: true`,
  `sessionEndsAtMs: null`), **no ambient flash** (D7), and it still releases on the signal drop.
- **Disable during the cooldown:** 20 disable/enable flaps → **1** distinct stamp (never moved), and
  `cooldownRemainingSec` decreases monotonically at all 20 samples.
- **`durationEnabled` flapped 20× across the cooldown boundary:** exactly **2** party fires total
  (the original + one post-cooldown), the new session's shape is internally consistent with the
  config at fire time.
- **Staleness (forced CALM) during the cooldown:** the cooldown keeps running through it; on recovery
  a fresh `calm→party` edge serves out its **full** `minDwellSec` (nothing at +20 s, fires at +40 s
  with `minDwellSec 30`) — no free session.
- **savePlan storm during the cooldown:** stamp survives, nothing fires during, exactly one after.
- **Edges (R7):** `_goDormant` (festival window closing mid-session) runs the end bookkeeping —
  `moodArmed` back to `true`, latch torn down, no orphaned follows-music flag, so the next in-window
  day starts alive. Disabling the party cue in the plan mid-session tears the session down and lands
  the deck on `ambient`. Disabling party while merely **ARMED** still stamps nothing and consumes
  nothing. **Leak hunt:** 13 consecutive sessions over 800 s → persisted state **594 bytes**,
  `recentFires` capped at 40, no key growth.

**Suites:**

| Suite | Result | Delta |
|---|---|---|
| Engine `npm test` | **2 281 / 2 274 pass / 7 fail** | **ZERO delta in failures.** The 7 are exactly the known env set: 5 × `audio_capture` (`device_not_configured`), `effects_v2_mode_page_layout` (worker-IPC deserialize), `osc_listener` (`EACCES` not `EADDRINUSE`). Test **count** is +3 vs `_22`'s 2 278 — collection drift, not a new failure |
| `node --test tests/timeline/*.test.js` | **317 / 317** | better than `_22`'s 297/296 — the `timeline_deck_release_default_cue` worker-IPC flake did not reproduce |
| CaptainPad `npx tsc --noEmit` | **clean, exit 0, no output** | — |
| CaptainPad `npx vitest run` | **40 files, 869 pass / 6 skipped / 0 fail** | matches `_22` exactly |
| Swap-wedge (`_16`/`_17`) | engine `deck_swap_cancel_notify` **9/9**; CaptainPad `deck_swap_watchdog` **11/11** | **GREEN** |
| `marsin_engine/states/` after the suite | **0 changed / 0 added / 0 removed** (38 files MD5'd) | clean |

### Probe 7 — titanic-ext (read-mostly)

- **The deployed engine is byte-identical to the fixed local tree.** MD5 over SSH:

  ```
  81e7e480dee20d273b3f6d61391d003b  lib/timeline/timeline_service.js
  73b0a8d3de02b7860c680b360ad55b37  lib/timeline/timeline_state.js
  c917da572e082f3d08ff13bea8ed2ffc  lib/api_server.js
  ```

  identical local and remote. Marker counts on the remote: `_notePartySessionEnd` ×7 (definition +
  6 call sites), `BOOT RE-ARM` ×1, the D4 resume block ×1, `liveOwner` ×2, the D11 validation ×1,
  `TIMELINE DID NOT START` ×1.
- `GET /party-config` → shipped values intact (`enabled true`, `party_high`, `120/12/120`, both
  toggles true), `effectiveState: 'no_plan'` **coherent** with `planActive false` /
  `inFestivalWindow false` (33 days out), 14 playlists.
- `GET /timeline/state` → `activePlan playa_default`, `mode armed`, `controller manual`,
  `currentMood calm`, `moodStale false`, `lastError null`, one `boot` lifecycle entry.
- **D10 verified live and non-destructively:** both an **empty body** and a literal `{}` return
  **400** naming the requirement. `GET` before and after is **byte-identical** — nothing applied.
- **No restart, no deploy, no PUT that changed anything, no state-corruption test on the remote.**

## 2. What I could not break

The adversarial angles that found nothing, recorded so the next pass does not repeat them: in-tick
A/B fights under `cooldownSec 0` (none — no tick ever writes two looks); ownership oscillation with
four deck cues over 30 minutes (bounded at 2 consecutive write-ticks); non-determinism in the
arbiter (byte-identical replays); the ambient fill being permanently suppressed by the widened guard
(9 shapes, all fill correctly; and the orphan-latch shape is unreachable by construction); cooldown
stamp drift under save storms, disable flaps, toggle flaps, staleness and crashes (the stamp moves
exactly once per session end, never backwards); a free session after any crash (never — the persisted
stamp always gates); state growth over 13 cycles (594 bytes, `recentFires` capped).

## 3. Findings (3, none blocking)

### F1 — MED, operator-visible: a `kind: ambient|look` cue with `durationMin` does not protect its window

**Predicted** by plan §9.5 and fixes §7.2; measured here. Under continuous music, a scheduled deck
cue that takes the deck mid-party-session ends that session (correct — that is the handover re-arm),
and then **party takes the deck back at exactly handover + `cooldownSec`** and keeps it for the rest
of that cue's authored window. It is one deterministic take, not a flap.

**The shipped `playa_default` is immune** — every cue that must own the rig
(`c_visibility_on`, `c_sunrise`, `c_burn_night`, `c_temple`) is `kind: program` with `hold.min`, and
a held program suppresses the party fire into `wouldFire` (R2.5: 0 re-takes over 900 ticks). The one
non-program deck cue, `c_party_start`, is a `party` look with no window — losing it to `party_high`
is the intended behavior.

**Operator note:** when authoring a future look that must not be interrupted (a reverent moment, a
photo call), give it `kind: program` + `hold`, **not** `durationMin`. `durationMin` governs how long
the deck fill lasts; only `hold` outranks party.

### F2 — LOW: the D11 boot refusal is console-only

With a corrupt persisted party field the timeline correctly refuses to start and says so **once**,
loudly, on the console. But `/timeline/state` still returns **200** with `lastError: null`,
`cues: []`, `planActive: false` — so CaptainPad renders an empty, error-free timeline and the
operator has no on-iPad signal that the show plan is not running. This is the **pre-existing** shape
(a corrupt YAML state file behaves identically) and is outside what `_21` specified, so it is not a
regression — but on playa the console is not where the operator is looking. **Backlog candidate:**
surface `timelineService` start failure into `/timeline/state.lastError` (or a `bootError` field) so
the card can show a banner.

### F3 — LOW: `_notePartySessionEnd` inherits the single-party-cue assumption

`_partyCue()` returns the **first enabled** `mood→party` cue, and the whole party subsystem
(`getPartyConfig`, `getPartyStatus`, session start) already resolves through it. The new end helper
does too. Consequence, measured (R7.3): in a plan with **two** `mood→party` cues, the second one gets
the evaluator's fire stamp but never an END stamp or a re-arm — i.e. the old D1 behavior, for that
cue only. **`playa_default` has exactly one mood cue**, so this is not a live risk; recorded so
nobody authors a second one expecting it to repeat.

## 4. End state / disclosure

- **titanic-ext: effectively UNTOUCHED and healthy.** The only writes attempted were the two D10
  probes, both **rejected with 400**; `GET /party-config` before and after is byte-identical. No
  restart, no deploy, no plan change, no corruption test. SSH was used read-only (directory listing,
  `Select-String` counts, `Get-FileHash`).
- **The operator's Metro on `:6967` was never touched.** CaptainPad was checked on a **freshly built**
  `expo export` dist served on `:7167` only. Both the local engine (`:6968`) and the `:7167` static
  server were **stopped**; nothing is left listening on 6967–6972/7167/5568.
- **`marsin_engine/states/` — reported, not hidden.** The local engine run rewrote
  `test_bench/{deck,globals,mixer}_state.yaml` (the plan's `defaultCue` loaded ambient over the
  branch's in-progress `slow` deck state). I **restored all three** from a session-start backup
  (`~/tmp/party_revalidation/states_backup/`) so the branch's own WIP residue is preserved — stating
  it rather than doing it silently. The only remaining difference from the session-start MD5 snapshot
  is `test_bench/timeline_state.yaml`, which is **gitignored** (`.gitignore:184`) and carries probe
  values; not repo residue. The full `npm test` run left **zero** state residue.
- The temp plans `validation_party_tmp` / `revalidation_party_tmp` were created and **deleted**
  through the API; `simulation/scenes/*/timeline/` contains only `playa_default.yaml` and
  `test.yaml`. No `festival.startDate` was edited on disk.
- **No source file was edited. No git command that writes was run.** The working tree's tracked-file
  list is identical to the session-start snapshot.
- Probe files, logs and screenshots: `~/tmp/party_revalidation/`
  (`r1_cooldown_zero.test.mjs`, `r2_scheduled_retake.test.mjs`, `r3_baseline_fill.test.mjs`,
  `r5_live_d1.mjs`, `r6_crosschecks.test.mjs`, `r7_edges.test.mjs`, `probes_rerun.log`,
  `engine_full_test.log`, `engine_d11.log`, `p8/p8b/p10/p9/p11b` logs, `captainpadB_party_*.png`,
  `states_md5_{before,after_suite,restored}.txt`).
