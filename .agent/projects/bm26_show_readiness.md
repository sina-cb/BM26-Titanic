---
name: bm26_show_readiness
status: active
owner: Sina (lead artist) — coordinator agent acts as readiness manager
created: 2026-07-27
updated: 2026-08-16
---

# BM26 Show Readiness — Master Program

**This is the make-or-break doc.** Sina is the lead artist; the interface
agent is the readiness manager reporting to him. Goal: a **successful,
somewhat-autonomous art fixture** on playa — ambient by default, alive at
party moments, never stuck.

> **RULE (operator, 2026-07-27): this is THE master doc, and every agent
> maintains it.** Any agent that lands, parks, blocks, or reverses work
> touching a workstream below MUST update the affected row, the Open
> decisions, and the Log in the SAME session — before reporting done.
> Coordinator enforces; a completion message without the doc update is
> not done. Keep rows tight (state + next action + owner); evidence and
> detail belong in the linked reports, not here.

Sub-project dossiers link from here; this doc tracks the PROGRAM. Ops
detail per thread lives in `../memory/bm_readiness_thread_tracker.md`
(**canonical, most-current state**).

## Current curator campaign — pattern and playlist blessing (2026-08-11)

The operator + curator are finishing the 34-entry Titanic Ambient pilot, then
expanding it into 17 proposed themed ambient playlists of 16-18 entries each. A
playlist is not show-ready until its exact saved values pass automated gates,
gallery review, a full physical test-bench mirror run, and explicit operator
blessing. The simulator/gallery smoke-stack representation and gallery rebuild
are complete; operator gallery review and the 34-pattern bench-mirror blessing
are next. After blessing, Claude/operator should checkpoint the pilot before
the large playlist expansion. Party tuning follows the separate audio-analysis
campaign.

Focused dossier and live blessing ledger:
[`pattern_curation_and_playlist_blessing.md`](pattern_curation_and_playlist_blessing.md).

**Compacted end-of-day 2026-07-30 on operator order.** Everything removed —
the long workstream row bodies, the slice-by-slice `_58` wave narrative, the
resolved waiting items, the mapping-support wave block, the full dated Log —
moved **verbatim** to the archive report
[`../reports/202607/20260725_88_master_doc_archive.md`](../reports/202607/20260725_88_master_doc_archive.md)
(`_88`). Section pointers below name the archive section.

## Threads — what's going on right now (2026-08-16)

> **COORDINATOR CHECKPOINT 2 (2026-08-16 evening).** The daytime storm is
> LANDED: `_274`/`_281` deck reshow (share arithmetic removed, shipped-split
> restore), `_275` mixer polish, `_276`/`_277` app-wide text-selection kill,
> `_279` params-hide → pattern rows, `_280` docs/69 design (portrait-rail
> root cause = Yoga discards `flexBasis:'auto'` under co-flattened `flex:1`),
> `_282` PALETTE TURNS render cost −37%, `_283` perf-mode (CONFIG out of the
> perf rail, offline exit proven 329 ms, mid-show playlist switching —
> ENGINE-GATED), `_284`+`_288`+`_289` Live Touch production overhaul (shell +
> engine slices + panel sides; proof matrix 1/14 → 22/22, F2 closed),
> `_285` landscape crush = card-budget defect (absorbed into docs/69 W3),
> `_286`/`_287` mixer three-defect wave (landing as of this note), `_290`
> effects PLAY/EDIT grammar, `_293` hide/show deck-grammar port design,
> `_296` two-tone palette preset design (docs/71 — expose the existing
> /color-pairs store; no new machinery). **Report numbers are now
> COORDINATOR-RESERVED** (tracker tail note; four collisions on 08-16).
> **Queued serially (token economy, operator order):** `_291` effects impl,
> `_292` handoff-failure debug (stopped mid-run, restart as one Opus),
> `_294`/`_295` app-wide scroll arbitration (stopped mid-run, same),
> `_297` two-tone impl (gated on the authorized git checkpoint + `_295`),
> `_298` hide/show W7 impl. **Ops notes:** one live-rig incident (a probe's
> unpinned scratch dist POSTed /layers/activate → active layer flipped to
> mixer; operator informed, remedy = one DECK tap; probe API_BASE rule now in
> captain_pad_debugging.md), non-standard loopback probes banned (operator
> order — sandbox prompts block), ChatGPT (Codex) delivered the NATIVE deck
> reshow fix + Baby Reveal feature into the tree (tsc-clean at refresh time),
> and the operator-ordered launcher refresh (rebuild-pad + fresh
> `prod --with-native-pad` boot) is executing — the restart activates the
> `_283` playlist gates and the `_288` ambient/colour/preset engine slices,
> and clears the panel's expected "Presets store error".
>
> **COORDINATOR COMPACTION CHECKPOINT (2026-08-16 morning).** The 2026-08-15
> overnight batch is FULLY SHIPPED — reports `_253`–`_272`, ~1,000 new tests,
> CaptainPad suite 2,214+/0-fail at close. Landed: two engine-fatal fixes
> (`_253` deck-cancel, `_254` blend-mode gate), follow-note + live retune
> (`_248`), COLORS interaction model (`_259`, FOLLOW NOTE yields on leave),
> TURNS A/B orbit (`_264`), native-first port (`_252`) + Live Touch curtain
> fix (`_261`) + native dial/fader scroll-lock (`_263`), deck declutter +
> view optimizer (`_267`), mixer relayout — channels as windows, aspect-honest
> bands, COLORS citizen (`_270`), Live Touch declutter (`_268`) + iPad
> ergonomics 44pt wave (`_272`), pixel-artifact self-heal (`_271`), sim
> 2d_pixels ghost + empty-menu fixes (`_265`), launcher lifecycle docs/62
> COMPLETE (`_260` W-A + `_266` W-B/W-C: shell:false spawns, sentinel reaper,
> ARM-interlocked kills, `--with-native-pad`, `rebuild-pad`, :7175 retired)
> + coordinator-added launcher session-wide CI removal (no more `env -u CI`).
> **Stack**: operator runs their OWN gen-8 launcher now (prod; started
> 2026-08-16 ~17:11Z per status); coordinator no longer babysits a stack;
> `rebuild-pad` + pad reload is the web update path, `--with-native-pad`
> hosts Expo Go on :6981. **IN FLIGHT (operator orders, 2026-08-16 morning):**
> (a) Opus — deck reopen-from-all-hidden **LANDED (`_274`), REVISED by the
> operator's second ruling (`_281`, Fable debug+fix)**: post-rebuild he
> reported "reshow overlays the patterns panel … the pattern panel is not
> resizing from full screen", portrait-only. `_281` hunted the literal
> overlay across Chromium AND WebKit (~90 states: bars-included hide-all,
> hydration, throttle, rapid taps, rotation, paint-sampling inside the
> PATTERNS box) — it does not exist on this tree; the defect IS `_274`'s
> per-occupant share (reshow-one left PATTERNS at 75 % of the stack = reads
> full-screen, restored window a 220 pt chopped strip = reads overlaid;
> wide hands the window its full default column, hence "vertical only").
> Share removed: reshow now lands the SHIPPED split (834×1194 908→460 +
> region 448; 1024×1366 1080→544 + 536); default/populated portrait,
> landscape (18/18 diffed), and short stacks all byte-identical to `_274`;
> `_274` bend #1 (patterns grows past the pin) REVERSED on the ruling,
> short-stack yield + fill mode + all other pins intact. Suite 2323/0,
> WebKit agrees to the pixel. **Rebuild-pad required (web); if the
> operator still sees true paint-over, ask WHICH surface — the :6981
> native Expo Go pad is NOT updated by rebuild-pad and native could not
> be run here (`_281` §7)**;
> (b) mixer polish wave — **LANDED (`_275`, docs/67 W1→W5 with the D1–D7
> defaults; Fable design `_273`)**: masterBand defaults CLOSED, fresh
> stores only (the known-set `wasKnown` gate provably exempts every
> existing store — no migration; fresh rail reads MASTER VIEW, COLORS;
> perf on a fresh store shows NO band, D2 accepted); the portrait rail's
> native-only Yoga zero-height collapse fixed by a `flexBasis:'auto'`
> portrait override (landscape byte-identical); chip diet — the long-title
> chip **349 → 220 pt** (label 296 → 168, ellipsized, index prefix intact),
> the fresh landscape bar **904-in-831 overflow → 1068-in-1068 none**, the
> COLORS chip from a **38 pt sliver at rightEdge 1423** to **95×28 at
> 1079**, the perf caption from hard-clipped (`…MID…`) to **262 pt whole,
> pinned outside the scroller**, plus the `›` hint, C4 gap 12 and C5
> padding 4/4; `_263` lock → exactly three mixer hosts with **zero new
> acquire sites (verified by grep, not trusted)**. Deck parity proven
> (8 chips, labels 25–75 pt, none truncated). Gates: 104 files / 2265
> passed / 0 failed, tsc + lint clean on every touched file. Two
> **DEVIATIONS reported**: the caption cap shipped at 280 because §4.3's
> literal 260 is 2 pt under the measured 262.36 pt intrinsic width (it
> would have ellipsized at every viewport), and **C3 was NOT implemented**
> — the card-header title is an editable `TextInput`, on which RN's
> `numberOfLines` does nothing, so the rider as scripted would have been an
> inert line; backlogged with C6. **NEEDS the operator's device round:** the
> portrait rail render and the lock feel are native-only (3-step checklist
> at the tail of `_275`); CaptainPad rebuild required, no engine restart.
> **OPERATOR DECISION LIST (open):** landscape-11"
> one-up stacking (all residual sub-44pt traces to it); mixer COLORS-chip
> never-yields ruling (confirm); split-playlist chrome dedup for the 11"
> bound 3-row gap; `light.tertiary → #0d5c44`; two stray test channels in
> `states/titanic/mixer_state.yaml` (`ch_1786733914718_0`,
> `ch_1786846862499_0` — real one is `ch_1785801995942_0`); ⓘ-help 18px
> landscape reclip; docs/59 §10 + docs/61 D1-D7 + docs/64 D1-D10 + docs/66
> D1-D5 defaults all shipped as one-line vetoes. Ops docs current:
> `.agent/ops/stack_lifecycle.md`, `captain_pad_debugging.md`,
> `.agent/skills/expo_go_qr.md`;
> (c) app-wide text-selection kill — **LANDED (`_277`; Fable design `_276`,
> `docs/68_app_wide_text_selection_kill.md`, all of W1–W5 at the D1–D7
> defaults, no veto taken)**. Operator: dragging the colors wheel selects
> surrounding text, "annoying everywhere — disable it all". Mechanism was
> RNW `<Text>` carrying no `userSelect` on web (computed `auto`); the dial's
> gesture armor was correct and got zero changes. Shipped: NEW
> `CaptainPad/app/+html.tsx` — a faithful expo-router stock-shell replica
> plus `html,body` user-select/`-webkit-touch-callout` kill and the
> `input,textarea,[contenteditable="true"]` caret counter-rule (web-only;
> native structurally untouched); two CSS lines in
> `docs/ui/touch_control.html` (callout kill + the contenteditable caret
> hazard its own `none` created); and a committed guard
> (`components/html_shell_selection_guard.test.ts`, 16 tests, mutation-honest)
> asserting the kill AND the counter-rule **together**, so the caret
> guarantee cannot be deleted while the kill stays. **A/B measured on one
> export** (a copy with only the style block stripped): deck caption
> `user-select` auto → none and the same 500 px drag **52 → 0 chars**; all
> carve-outs proven — config field Ctrl-A `selStart 0, selEnd 7`, the Studio
> editor's three acceptance behaviors on the REAL editor (drag-select 31
> chars, shift-arrow `selEnd 5`, Tab `execCommand` insert 10048 → 10050), and
> both deliberate `selectable` error Texts computed `text` (the app has no
> clipboard API, so selection is its only copy path). Style present in
> **29/29** exported HTML files. Gates: CaptainPad **2281 pass / 0 fail**
> (+16, the new guard), `native_gesture_armor` 37/37, tsc + lint clean, the
> two engine `touch_control` contract tests 29/29, zero security findings on
> the touched files. Scratch stack only; live :6966-:6972/:6981 untouched and
> verified answering before and after. **CaptainPad rebuild required**, no
> engine restart. **ONE OPERATOR CHECK OPEN:** `-webkit-touch-callout` is
> WebKit-only and unobservable in headless Chrome, so D5 needs the iPad —
> long-press a caption (should do nothing) vs long-press in a text field
> (should still offer paste). **Observation, not in scope:**
> `SIMULATION_PORT` is hard-pinned to 6969 (`utils/simulation_url.ts:10`), so
> the 2D Simulator embed derives the LIVE sim port regardless of api_base — a
> trap for any scratch harness;
> (d) mixer "hiding params must make room for the pattern list" — **LANDED
> (`_279`)**. Operator: *"when hiding params, make room for the pattern list so
> we show more patterns — that was the whole purpose of hiding the params"*.
> He was right and the defect was total: hiding params freed **nothing**. The
> playlist viewport measured **byte-identical** shown vs hidden (portrait
> 292×158 = 2 rows either way; landscape 176×24 = one partial row either way)
> because the body's children never stop claiming — portrait's params panel
> keeps `flexGrow: 1`, landscape's keeps `width: '40%'` — while rendering only
> the 28 pt stub. **PIXELS never had the bug and is the control** (a full-width
> block in the vertical stack returns its height to `channelBody` for free:
> landscape 0 → 2 rows, portrait 2 → 4). Fixed with a pure
> `mixerParamsColumnMode` (`full`/`stub`/`empty`) + four panel constants in
> `mixer_scroll_layout.ts`, applied last in `mixer.tsx`'s two style arrays;
> view-only, zero engine calls, no new scroll-acquire sites, floor-of-one
> untouched. **Portrait 2 → 4 rows** (same at 2 and 3 visible channels);
> landscape gains WIDTH only — 176 → 196 pt at 3 channels, **283 → 374 pt at
> 2**, names stop truncating — because the params column is BESIDE the list
> there and no flex rule turns width into rows. Params-SHOWN is geometrically
> identical before and after everywhere measured. Gates: **2291 pass / 0 fail**
> (`mixer_scroll_layout.test.ts` 5 → 14, so +9 is this change; a concurrent
> thread's `special_events` test edits own the rest), tsc + lint clean, touched files
> scan clean, live stack never touched. **CaptainPad rebuild required**, no
> engine restart. **TWO THINGS FOR SINA:** (1) with the pixel band open in
> landscape the pattern list is only ~24 pt tall — one partial row, params or
> no params; relocating the band into the vacated column (what perf mode
> already does) would buy ~5 rows but shrink the band from ~330×122 to ~135×50
> at 3 channels — **his call, ~10 lines**; (2) a **pre-existing** bug found and
> filed: landscape + MASTER VIEW open crushes the card body to zero (playlist
> 283×**0**, painting under the MUTE/SOLO and TRANSITION rows) — **`_285`
> reproduced this exactly and DISPROVED the "landscape twin of the W0 fix"
> diagnosis; see (f)**;
> (e) mixer three-defect triage (glitchy lock start / portrait rail STILL
> missing / landscape patterns invisible) — **ALL THREE LANDED: W1+W2 (`_286`)
> + W3&R1 (`_287`).** Design `_280` / `docs/69`. **W3:** the landscape edit
> card SHEDS the 208 pt pixel band into the media column beside LOCAL PARAMS
> (perf's grammar, now the ONE landscape body shape) — patterns get the full
> body height. **The `_285` MASTER-VIEW crush is FIXED by that shed, not
> worked around**: `channelBody` 515×**0 → 515×180**, playlist 283×**0 →
> 283×102**, MUTE/SOLO + TRANSITION back inside the card. Rows at 1366×1024
> 4 → **7** (target ≥7 ✔); at 1194×834 0 → 3, so **R1** (44 pt compact rows,
> docs/66 floor exact, mixer-mount-only, deck pinned identical) was taken to
> close the last row — **R1 is one line to reverse**. Two defects found+fixed
> inside the wave (both-hidden column INVERSION from a collapsed column hugging
> the band header's full 248 pt width; band canvas 2 pt under its floor from
> RNW `boxSizing:border-box` eating a 1 px border). `CHANNEL_EDIT_CAP_HEIGHT`
> NOT lowered — still Sina's call. **CAVEAT: the final measurement pass was
> destroyed by a live-stack incident, so those last fixes + R1 + the
> 2-layers-no-scroll order are unit-tested but NOT browser-measured, and W3 has
> ZERO screenshots** — `_287` §5 lists exactly what is unproven and §10 orders
> the operator checklist by confidence. Rebuild required. **Landed:** the portrait seat is now SELECTED not composed
> (`MASTER_BAR_SEAT_PORTRAIT` carries no flex-family key), proven by a
> **Yoga-EXECUTED** vitest on devDep `yoga-layout@3.2.1` — pre-`_275` 0 pt,
> shipped `_275` 0 pt, shipped seat **36 pt**, mutation-verified red on both
> historical compositions; and the scroll lock gained a synchronous
> native-only `getNativeScrollRef().setNativeProps` fast path with the render
> path byte-identical and zero acquire-site changes (`scrollEnabled` confirmed
> present in ScrollView's `validAttributes`, or the payload would have dropped
> it and the fast path would have been inert exactly as `_275` was). Gates
> 2328/0, tsc clean, lint 0 errors, web seat 912×36 = unchanged (the defect
> was native-only, so web MUST not move). **Rebuild required; two operator
> device checks pending** (portrait chip rail visible + screenshot; 5 fast
> drags move the pane zero pixels). Headline of the original diagnosis: the `_275`
> portrait-rail fix is **provably inert on native Yoga** — vendored
> `yoga/node/Node.cpp:329` ignores an explicit `flexBasis:'auto'` whenever a
> positive `flex` shorthand co-flattens (basis resolves to **0**; the
> explicit `flexGrow:0` DOES win) → grow 0 · shrink 0 · basis 0 = the same
> 0 pt bar as the original bug, while CSS longhands win on web — which is
> why web screenshots passed twice and the iPad failed twice, and the `_275`
> source guard pins the exact property Yoga can't honor. Proof EXECUTED on
> the real algorithm (yoga-layout WASM): pre-fix 0, shipped 0, keyless seat
> 36, flex:0 seat 36. Fix = style SELECTION (portrait seat carries NO
> flex-family keys) + a Yoga-executed vitest that fails on both historical
> compositions (new devDep `yoga-layout@^3`, dev-only). Item 1: the lock's
> acquire timing is already touch-down; the glitch is the
> useSyncExternalStore → render → commit round-trip (~1-2 frames) losing to
> UIScrollView's ~10 pt slop on fast drags — fix is a synchronous
> `getNativeScrollRef().setNativeProps` fast path in `LockableScrollView`
> (Fabric setNativeProps verified real + synchronous in this RN), render
> path stays truth, web byte-identical, zero acquire-site changes. Item 3:
> measured — landscape playlist viewport **56 pt = 0 full rows at 1194×834**
> (208 pt band block + 203 pt fixed rows), 4 rows at 1366×1024; design moves
> the edit-mode band into the params column (perf's proven grammar, `_279`
> §5's sized option, now operator-ordered) → **≥4 rows at 834 / ≥7 at 1024
> with everything default-shown**, composes with `_279` (never reverts it),
> portrait + deck untouched. **The crush-fix agent reported back as `_285` (renumbered from `_284`)
> WITHOUT landing code, and its measurements say W3 must now ABSORB the
> crush rather than rebase on it — W3's own "move the band out of the card's
> vertical stack" IS the crush fix, because that 208 pt block is exactly what
> zeroes the body. W3 must NOT block waiting for a separate crush landing;
> D7's "assert non-regression only" is superseded — W3 owns the fix and must
> assert the crush states directly.** D1–D8 one-line vetoables in docs/69 §6. Probe hygiene: scratch
> dist :7189 with an API_BASE bootstrap (live engine never contacted),
> black-holed engine :17989, live stack 200 before/after, ports freed.

> **WORKING ARRANGEMENT (operator, 2026-08-14): infra/pattern separation.**
> The operator + the curator assistant own PATTERN work (patterns, playlists,
> tuning, calibration content). The Claude coordinator + its agents own INFRA
> (engine/sim/CaptainPad code health, the running dev stack, timeline
> authority, audio plumbing, UI features). Both edit the SAME tree on
> `feat/bm_readiness` concurrently — every agent works under the shared-tree
> protocol (re-read before edit, surgical edits, never revert foreign work,
> stop-and-report on conflict). The coordinator keeps the full dev stack
> (launcher: engine :6968, sim :6969, CaptainPad :6967, companion :6966)
> RUNNING and babysat while pattern work happens on top of it.
>
> **TREE STATE:** local `feat/bm_readiness` @ `3a4d559d` ("converge BM
> readiness local integration" — the Live Touch campaign + `_174`–`_192`
> merged); origin still at `9e8b23b8`; nothing pushed since. `_193`–`_204`
> landed on top, uncommitted. Prior `feat/bm_audio_tuning` work preserved in
> the named stash `codex-preserve-feat-bm-audio-tuning-before-main-path-transfer-20260814`.

| Thread (operator name) | State + next action | Owner |
|---|---|---|
| **Audio** — closure campaign | **Hermeticity sub-thread CLOSED**: `_207` (audit) → `_214` (bpm-eval gate + `isolatedCompanionEnv` state root) → `_220` (the last 3 companion suites + 2 tests `_214` missed adopt it; new `isolatedStateRoot` for the tests whose subject IS the tracked config; tracked-config witnesses added so a dropped isolation env can no longer pass green). No test scores the operator's live `audio_state.yaml` overlay any more — measured inputGain 8.83 → tracked 1. Companion 214/214, tests/audio 641/641, failing lists empty both sides. Earlier: `_203` (PARTY SIGNAL honest-on-disconnect) + `_204` (companion PATCH retry w/o reconnect; note-evidence doc rerun + parity test); `_188` signal census (4 dead onset/chest signals, event-pulse hardening, dataset plan) AWAITS stage go. Open: the 3 eval tools still read the effective config (`_207` f/u 2). Hard scope: no retuning of the detectors the operator likes. | coordinator + Opus |
| **Misha UI** — Special Events tab | **ENGINE SLICE SHIPPED** (`_205`): `lib/special_events/` stage-machine runner + 9 routes + WS `specialEvents` + `SPECIAL_EVENT` deck-write 409 + PANIC hooks; shows are scene YAML data; ARM = a timeline takeover on the plan's own lease (RESUME/lease-loss ABORTS the show with restore, never re-seizes; `_200` passcode gate on ARM in performance mode); restart mid-show = abort+restore on boot. Baby Reveal re-authored to the operator's PLAYLIST-driven flow: TEASE (`baby_tease` + strobe / vintage-white / flash-all-white / UV pulses) → GO DARK (master→0) → ceremonial GIRL/BOY (white flash, playlist swapped under it at t=700 ms) → PHOTO GLOW. Engine tests 1294/1294. UI slice `_206` in flight against the contract in the `_205` report §1. **PLAYLIST INTEGRATION CLOSED (`_222`):** the ARM-refused-by-name blocker is GONE. Canonical playlists are now exactly `baby_tease` / `baby_girl` / `baby_boy` — 15 entries each, byte-identical across `titanic` and `test_bench`, built from the 45 patterns in `marsin_engine/patterns/baby/` under qualified `baby/NN_…` ids; `baby_reveal` survives ONLY as the special-event show id, and `baby_pink`/`baby_blue`/`baby_reveal_celebration` are retired as playlists (`baby_pink`/`baby_blue`/`baby_reveal_duet` remain COLOUR PALETTE ids — different namespace). Offline ARM validation passes in both scenes (15/15 loadable). Along the way: `save-server.js` was **silently deleting every qualified pattern id from `patterns/manifest.json` on boot** (top-level-only scan, rewritten at startup), so `baby/…` would have survived a commit but not the next `npm start` — extracted into `simulation/server/pattern_manifest.cjs` with an explicit registered/excluded directory registry that THROWS on an unclassified subdirectory, manifest 97 → 134 ids, guarded by a new test that the generator round-trips the tracked file. `playa_default.yaml`'s two Baby cues (broken at fire time — three deleted playlists + an entry id nothing defines) repointed, feature kept. Baby contract test rewritten to 10 tests over all 45 (compile on both rigs, tease pink+blue only, girl/boy single-family, W=A=U=0, 15/15 boy-girl pairs structurally identical bar their colour constants). Galleries regenerated for the three; `baby_reveal` gallery deleted. Engine patterns+timeline+special_events+playlist **721/721**, CaptainPad **119/119**, simulation failing list unchanged from the `_227` baseline. **NEXT (coordinator):** reload the engine/sim, then ARM `baby_reveal` live and confirm the manifest still carries all 45 `baby/…` ids after the restart. Open: tab name, reveal wording, photo stage, undo snapshot. **SHOW AUTOPILOT SHIPPED (`_230`):** a stage may author `autopilot:` {active, everySec, shuffle, group*, transition{enabled,mode,durationMs,shuffle}} and the runner drives **the deck's OWN pattern-autopilot daemon** with it (not a second timer racing it for the deck channel) — so the tease rotates its playlist on a timer with a crossfade, engine-side, and an iPad that sleeps changes nothing. The tab renders the deck's `<PatternAutopilotPanel>` **verbatim** (cadence pills, SHUFFLE, GROUP+SIZE/DWELL, DECK TX style + crossfade time, live next-swap countdown off the deck's own clock) — **colour absent by construction**, no field on the wire, colour autopilot stays disarmed all show. `POST /special-events/autopilot` retunes live (sparse patch, `{status:'ok',state}`, existing WS frame, no new type) and is **remembered per show+stage across runs**; `{reset:true}` + a SHOW DEFAULT button return to the YAML. Safety: a stage with no `autopilot:` key draws no card and forces rotation OFF (the blackout must not swap behind a dark ship); handover stops the old rotation *before* any new-stage action and arms the new cadence only after the stage's last action (the reveal swaps at +700 ms under the flash); ARM now snapshots the WHOLE deck autopilot block + transition config and FINISH restores all of it. Baby tease defaults: every 20 s, `trans_crossfade` 2000 ms. New offline suite **13/13** proves the deck pattern advances on its own, live retunes land on the deck's own endpoints, and FINISH restores exactly. Also `_230`: the Baby contract suite is now **derived from the filename** (`<NN>_<family>_<concept>`) with twins paired by concept and every count read from disk/playlist, so tease patterns past 20 need **no test edit** — recipe in `marsin_engine/patterns/baby/README.md`. **BLOCKER for the tease expansion:** `baby_tease.yaml` still lists 15 while 20 tease patterns are on disk (46-50 never added), plus 3 contract reds in the author's new 46-80 set. **RELOAD THE ENGINE:** the running :6968 process has the old schema and would refuse the new `autopilot:` key on any library re-scan. **SHOW #2 — WEDDING SHIPPED (`_231`), pure data:** `wedding_program.yaml` in **both** scenes' `special_events/` (`test_bench/special_events/` did not exist — the bench had no shows at all), six stages `GATHERING → PROCESSION → CEREMONY → THE KISS → CELEBRATION → PHOTO GLOW`, plus five `wedding_*` playlists (10/8/6/15/6 entries, byte-identical across scenes) built **entirely from existing patterns — none authored**. No engine, route, schema or UI change; it inherits `_230`'s stage autopilot for free (75/40/120/45/90 s, all `shuffle:false` because each list is ordered as an arc). CEREMONY rides master to 0.55 over 6 s and authors **zero quick effects** on purpose; THE KISS is a ceremonial CHOICE (`KISS → PARTY` / `KISS → GLOW`) sharing one 900 ms white flash. **Found and fixed in data: THE KISS was DISSOLVING, not cutting** — a stage with no `autopilot:` block inherits the previous stage's deck transition, so the swap landed **+5.7 s** after the flash instead of under it; `kiss` now authors `{active:false, transition:{enabled:false}}` and lands at **+719 ms** (measured both ways on the bench). **Two runner gaps left for `_230`:** the `globals` verb is **not restore-covered** (the pre-show snapshot uses `captureLook()` and never calls `captureGlobalsForSnapshot()`, so pinning SPEED for the vows would outlive FINISH — the wedding uses only `playlist`/`masterFade`/`effect`), and a stage authoring no `autopilot:` arguably ought to RESET the deck transition rather than inherit it. Colour caveat: the schema has no palette verb (`globals` takes numbers, `colorPalette1/2` are `hsv`), so the calm stages lean on the palette-immune WHITE ONLY family (60-64) and the rest take whatever palette is armed — **set a warm palette before ARM** (`phoenix` is closest; no champagne/gold pair exists, and `colorPalettes` is `_224`'s domain). New `wedding_show.test.js` **16/16** (both scenes byte-identical, the offline ARM playlist contract, flash-before-swap on both variants, the cut, all **34 patterns compiling and rendering LIT on both models**); `show_schema` 27/27, `special_events_api` 28/28, `special_events_timeline_api` 3/3 all still green. **`special_events_autopilot_api` 0/13 is a PORT COLLISION, not a code red:** its harness is `portBase 17230, portSpan 3` and **:17230 is bound by another agent's CaptainPad web serve**, which answers `<!DOCTYPE html>` — exactly the `waitForReady` error. **POLISH WAVE SHIPPED (`_240`, the full W1-W8 of `docs/57_baby_show_polish_infra.md`):** **(1) FLASH SOFT RELEASE** — the shipped `vintageWhite` ramp generalized into a per-effect envelope over vintageWhite/blastWhite/uvBlast, authorable as `releaseMs` (1..5000) + `releaseTo: show|dark` on any effect action and `fadeOutMs` on a strobe burst. `show` = `max(pattern, env)` so the running show RISES THROUGH the decaying flash; `dark` = replace-decay to black (pair it with a `masterFade` to 0). Defaults `0`/`'show'`/`0` are today's hard cut, so every pre-existing show file still means exactly what it said, and **vintageWhite is byte-identical** (all 7 fire-sync tests pass unmodified). The reveal and THE KISS now end as a **700 ms bloom**: proven at 40 fps against the real controller and the real authored numbers on all 4 choice paths — pure 1.0 white across the whole `[swap 700 ms, hold-end 900 ms]` window (**the swap is uncoverable by eye**), envelope 1.0 → .75 → .50 → .25 → 0 by 1600 ms, and **max dimming of the new look = `0.000000`**. Terminal teardown (`_releaseAllEffects`, PANIC) stays instant on purpose. **(2) FLASH ALL WHITE IS OFF THE OPERATOR SURFACE** — 7 chips stripped from both shows in both scenes AND `validateQuickEffects` now **refuses** `blastWhite` inside any quick effect (it stays legal, and stays used, as a stage/choice action). **(3) THE SHOW AUTOPILOT CARD IS THE OPERATOR'S THREE CONTROLS** — NOW PLAYING (the deck's live entry name, off a new `getDeckNowPlaying()` dep on the existing `specialEvents` frame — no new WS type, no new timer) + PLAY/PAUSE + pills **1/5/10/15 MINUTES**; a cadence matching no pill lights none and prints itself rather than rounding. Everything removed stays YAML-authorable and reachable over the unchanged wire; **the DECK tab's own panel and the cue editor are untouched**. **(4) BOTH `_231` RUNNER GAPS CLOSED** — the `globals` verb is now restore-covered (ARM captures ParamCenter, FINISH/ABORT put back exactly the keys a stage wrote), and a stage with no `autopilot:` block now **forces the deck transition to `{enabled:false}` before its actions**, killing the KISS-dissolve bug class at the source (the wedding's explicit `transition:{enabled:false}` stays as belt-and-braces). **(5) THE BENCH CAN NOW REHEARSE THE BABY SHOW** — `test_bench/special_events/baby_reveal.yaml` created as a byte-identical mirror (it existed only in `titanic`); validated by an offline ARM + full stage walk. Tease cadence retuned `everySec 20 → 60` to sit on a pill (**operator-vetoable**, one line). Engine `--test-concurrency=1`: special_events **108/109**, effects **631/631**, timeline **445/445**; CaptainPad **1598/1598**, tsc + lint clean. The single red is **foreign and pre-existing** — `'wedding_ceremony' has drifted between the titanic and test_bench scenes` (playlist content, curation-session territory; `baby_tease`/`baby_boy` also differ but only in YAML serialization). **ENGINE RESTART REQUIRED:** schema + service + show YAML move together — an old process re-scanning the new YAML turns both shows into red WILL-NOT-LOAD cards. **SHOW-CRITICAL CRASH FIXED (`_253`):** `_248`'s 18 special-events reds were **one engine process dying**, not 18 assertion failures — ABORT/FINISH a show while a deck crossfade animates and `_endRun` → `recallSnapshotFade` → `morphToLook` → `cancelDeckPatternSwap()` rejected the swap's `done` with `ECANCELED`, which escaped as an unhandled rejection and took the whole rig down via `engine.js`'s fatal handler. Cause: `timelineLoadPlaylistOnDeck` (synchronous at `HEAD`, with an explicit "the returned `done` is intentionally NOT awaited" comment) was rewritten `async` + awaiting so Timeline could serialize behind an active swap — which changed the failure surface for its two FIRE-AND-FORGET callers, `_applyAction` case `'playlist'` (a show may never wait out a fade) and the deadman revert's synchronous `step()`. Fix: a `settleDeckTransition()` helper makes ECANCELED — and **only** ECANCELED — an expected settled outcome (every other rejection still propagates, nothing masked); the unawaited baseline `.catch` stops calling a supersession a "failure" (no red line at every show handover); both fire-and-forget callers get their handling back, the runner's into its existing `lastError` + `console.error` + broadcast contract. **special_events 109/109** (was 91/109), timeline 445/445, the deck-transition contract test 6/6 (updated + 2 new). The 11 mixer/bump reds stay red — foreign to `_243`'s `pattern_mixer.js`, untouched. | `_205` engine + `_222` playlists + `_230` show autopilot + `_231` Wedding show + **`_240` flash release / chip removal / simplified SHOW card** + **`_253` cancelled-transition crash fix** shipped; `_206` UI in flight; **engine restart pending (now mandatory — new schema + YAML, and the live process still carries the `_253` crash)**; tease playlist expansion open; `_230` harness port 17230 occupied; 4 `_240` operator vetoes open (pill unit, tease 60 s, no countdown, 700 ms release) |
| **Color deck** — COLORS window + prototype | **SHIPPED (`_211`, slices B+C+D)** on the `_199` prototype the operator approved. TWO COLOUR: RN/SVG hue ring (S=V pinned) whose two handles ARE `colorPalette1/2`, atomic throttled `/param-center` writes + engine slew, handles track the rig; the prototype's crossfade ported exactly (triangle phase, blend scrubber seeking the SAME phase variable, stop-freezes) as a labelled local PREVIEW — no engine mechanism exists for a continuous two-slot crossfade and a tab-side interval is the deadman-gap failure. PRESETS: 5 Live Touch swatches at their exact hexes, A/B badges DERIVED, SAVE PAIR gallery. Engine **E1** landed: `ColorAutopilot.validate` + the api_server resolver take inline `{c1,c2}` pairs beside library ids (no new endpoint/WS/daemon). **PALETTE TURNS**: 5 hues → 5 adjacent pairs → one colour-autopilot config, rotation runs ENGINE-side (survives iPad sleep), one TURN EVERY control with a derived 25%/0.5-3 s fade, single-writer gate (`ROTATION IS DRIVING — TAP TO PAUSE`, refusals visible), CUSTOM chips in ColorAutopilotPanel. **Saved pairs are SCENE-OWNED** — new `GET/POST /color-pairs` → `states/<scene>/color_pairs_state.yaml`, shared by every iPad, no localStorage authority. 64 new pure vitest + 16 engine tests; full CaptainPad suite 1318/0 fail; tsc + eslint + web:build clean; e2e proven on a fresh dist against an isolated engine (drag paints without scrolling the column; TURNS posts the 5 pairs; the locked wheel refuses visibly). **NEXT (operator):** open the window from the HIDDEN rail and try §7 of the `_211` report; E1 + the pair store need the engine on the new build (it appeared already restarted). Open: should a saved pair also carry its fade time? **NEXT WAVE DESIGNED (`_216`, Fable → `docs/55_colors_schemes_and_perf_overlay.md`):** Live Touch scheme generators (MASTER/HUE/COMPLEMENT/CONTRAST, verbatim from `touch_control.html`) in the COLORS window; the crossfade becomes ENGINE-driven (a 2-pair ring on the existing daemon + new guarded `delay_s: 0` continuous mode — the `_211` local preview retires, the card animates from broadcast only); a scheme's 5 colours feed TURNS; PATTERNS goes fullscreen (narrow) when it is the only effective open window; performance mode overlays PARAMETERS+AUTOPILOT hidden (derived, chips suppressed + caption, AsyncStorage untouched). Three calls: engine gets shortest-arc `lerpHue`; inline pairs widen to FULL HSV (number OR {h,s,v} channels, back-compatible) so MASTER/HUE are expressible; perf-mode chips suppressed, COLORS chip stays live. 11-item implementation contract + 6-row screenshot matrix in docs/55 §5. **ALL 11 ITEMS SHIPPED (`_217`).** SCHEMES row live (four generators, verbatim constants, five-swatch button faces, 260 ms flash + a VISIBLE `accentWash` latch — the one stated deviation from Live Touch, because on the Deck the latch re-themes five slots and an invisible mode that repaints things is a trap); wheel-drag re-themes while latched; a scheme tap during a live ring is a ONE-TAP RESTAGE through the daemon's own front door (`active` stays true, cadence kept, narrated) and never an auto-pause. The crossfade DRIVES THE RIG: the `_211` preview loop is deleted (no `setInterval`/rAF/`phase` left in the file), the card animates purely from the broadcast `colorPalette1/2`, STOP freezes natively via `_cancelTween`, and the BLEND scrubber writes with the SAME `lerpHue` the engine tweens with so a frozen fade round-trips exactly. Engine: `lerpHue` + colour-aware `lerpParams`; `delay_s: 0` CONTINUOUS with a loud zero+zero guard AND the `_scheduleNext` `>0 ? : DEFAULT` fallback REMOVED (it would have turned CONT into a silent 30 s hold — a codex P0 violation); full-HSV pair channels through one shared `validatePaletteChannel` used by the daemon and the api_server resolver alike; REST activation seeds the fade start from the live CPC so a deck-started rotation fades instead of snapping. MEASURED on the OPERATOR'S rig: the crossfade walked `colorPalette1` 0.4312 → 0.1713 → 0.0000 → 0.1135 and froze on STOP; rig restored byte-for-byte. Suite 1372/6 skip/0 fail (+44), colour suites 56/56, tsc + eslint clean, 24 inspected screenshots in `~/tmp/fix_217/`. **NEXT (operator): the engine needs a RESTART** — it predates this wave, so CONT and full-HSV scheme rings 400 against it (everything else works today). Open: HUE's darkest turn runs `v = 0.25` by definition (docs/55 §8.1 — say the word and the floor rises); should a saved pair carry its fade time? **ROTATION POLISH SHIPPED (`_224`, four more operator orders — client only, zero engine source touched).** (1) **ONE TRANSPORT**: TURNS and the crossfade now share one FADE row, one HOLD row, one pair of values and one builder — both cards render the SAME `<TransportTiming>`, and both patches are one-liners over `rotationAutopilotPatch(colours, holdS, fadeS)`. `derivedTransitionMs` (the 25 %/0.5–3 s heuristic) is DELETED: a derived fade is a second opinion the surface cannot show. The crossfade is now *literally* the same function at ring length 2, wire byte-identical to `_217`. docs/55 §2.3's “TURNS keeps its cadence floor” is SUPERSEDED — CONT (`delay_s: 0`) is reachable from TURNS, so a five-colour ring slides continuously; the engine's zero+zero guard is untouched and the client mirrors the refusal so the operator sees a sentence, not a rejected POST. Shared HOLD row is a SUPERSET (`0/1/2/5/10/30/60 s`); 120/180 s are gone and the shared default is CONT + 0.8 s rather than TURNS' old 30 s. (2) **THE SLIDING WINDOW, INVERTED FROM THE RIG**: `litPairIndex` only matches during the HOLD, so in CONT the highlight would never light at all. New `rotationCursor` inverts the daemon's own tween (`h` short-arc, `s`/`v` linear — six components, one unknown) as a least-squares projection onto the from→to segment plus a residual check that REJECTS a palette another writer set rather than mapping it onto a plausible-looking progress; returns the window being ARRIVED AT and how far through, or `null`. DERIVED, never clocked — it moves only as broadcast tween frames arrive and stops dead when the rig does; still zero `setInterval`/rAF in the file. BOTH slots of the live window light, and a new `WindowRail` parks a two-cell highlight at `cursorRailOffset`, drawn twice inside a clip so the T5→T1 turn slides THROUGH the seam instead of teleporting. (3) **PICK WHICH TWO FEED A/B**: with a scheme latched the five staged colours show with the active two badged, picked by the window's EXISTING arm-then-tap grammar and stored as RING INDICES so a wheel re-theme carries the choice forward; both channels on one slot is REFUSED by name. Caught a real bug doing it — A and B collapsed onto one hue because `latched` was a bare `SchemeId` with the base re-derived from the ARMED slot, which is circular once A/B are themselves scheme slots; the latch is now `{ scheme, base }` and only a WHEEL DRAG re-bases. (4) **FIVE MORE GENERATORS** (operator: “add a few more technique to sample nice looking color duos or 5 samples”): ANALOGOUS, TRIADIC, SPLIT, TETRAD, GOLDEN — ordered so every adjacent pair including the T5→T1 wrap is a duo picked on purpose, with repeats DIMMED so no turn is a dead beat, under a `v ≥ 0.25` night-visibility floor (the ports keep their own verbatim 0.1). CaptainPad 1446/6 skip/0 fail with an EMPTY failing list (`colors_window_logic.test.ts` 94→125); engine colour suites 48/48 + 14/14. Offline proof on an isolated engine (port 17224, sACN black-holed on TEST-NET-1) driven through the REAL client `rotationCursor`: the window sequence `0→1→2→3→4→0` advanced ONE slot per turn with the wrap observed, 15 mid-fade samples resolved to window + progress, and CONT ran 6 turns in 2.6 s with the ring never parking. 13 inspected screenshots in `~/tmp/fix_224/`. **`_224` needs NO engine restart** — but `_217`'s restart is still pending, and until it happens CONT and full-HSV rings 400 on the live rig, which makes TURNS-in-CONT unavailable there. **THE WHEEL IS NOW A DIAL, AND COLOURS SAVE AS NAMED PALETTES (`_242`).** (1) **The jump is gone, structurally.** `onPanResponderGrant` used to run `hueFromPoint(touch)` straight into `onPick`, so the ring was an ABSOLUTE control and there was NO gesture that touched it without writing it — a ~40 pt fingertip on a 190 pt wheel could never mean “change nothing”, and reaching for the far side threw the hue up to half a revolution in one frame. Replaced by the jog-wheel model: touch-down ANCHORS, the hue follows the ACCUMULATED angular delta geared by `DIAL_GAIN = 0.5` (one physical revolution = half a hue revolution — twice the resolution the absolute ring could offer). A tap moves nothing BY CONSTRUCTION (zero delta — no tolerance threshold exists to misfire), the grab point is irrelevant, the 0/360 seam is an ordinary step because every sample is a SHORT-ARC delta from the PREVIOUS sample, and multi-lap drags accumulate. Inside `DIAL_DEAD_RADIUS_PX` there is no angle, so a change needs two consecutive samples that both have one — no jump can come out of the hub and a swipe THROUGH the centre freezes (a stroke across the middle is a line, not a turn). `onDragStart`/`onDragEnd` fire only for a drag that MOVED, so a tap no longer puts a frame on the wire. New `dialValue` prop: with a scheme latched the dial steers the LATCH'S BASE, not `hues[armed]` — the two diverge the moment A points at a slot other than T1, which is exactly where the jump would have returned. `_211` gesture armor, the S=V pin, the throttled atomic write and `_224`'s `{scheme, base}` latch are untouched; the chrome is a real docs/54 rotary (knurled hub, 36-mark tick scale, pointer on the value, both lit while gripped). Measured in the app: a ring click logged `40° → 40° UNMOVED`, a 0.45-turn rotation `40° → 122°` against the 81° the gain predicts. (2) **SAVE PAIR became SAVE PALETTE** — the same `/color-pairs` store widened rather than a sibling one (a pair IS the degenerate palette; two galleries would make “where did I save that” a question with two answers). `c1`/`c2` stay REQUIRED and unchanged, which IS the migration — a v1 file's rows are already valid v2 rows — and `schemaVersion: 2` adds optional `name`, `ring`+`sel`, `scheme`+`base`, validated as ALL-OR-NOTHING GROUPS on both sides and refused loudly (ring⇔sel, scheme⇔base, scheme⇒ring, distinct sel, known scheme id). The ring is stored ALONGSIDE the scheme, never derived: the ring is what the operator saw, the latch is how it re-generates. ABSENCE is the ONE encoding of “unnamed”, so the operator's “accept an empty name” needs no second code path. A future `schemaVersion` THROWS (GET 500, shown standing in the gallery); one malformed ROW in the hand-editable file is dropped with a warn; a malformed row POSTed is a 400. The ICON is GENERATED from the colours — a disc of one wedge per colour, clockwise from the top like the dial, drawn from data with no asset to go stale, and the naming card and the gallery chip call the SAME `components/ui/preset_icon.tsx` with the SAME list so the preview IS the result. The NAME comes from a new `opPrompt` added in `op_dialog`'s own idiom (never `Alert`): `opDialog()` keeps its exact signature and every existing call site, while `''` and `null` stay DISTINCT — `''` saves unnamed, `null` saves nothing, or CANCEL would be indistinguishable from SAVE-with-no-name. Recall restores the whole staged state (ring + A/B selection + latch) or behaves exactly as before for a bare pair. **This answers the long-open “should a saved pair carry more than its two colours?” question with YES — a ring, a selection, a latch and a name — though the fade time is still deliberately NOT stored (it is the shared `_224` transport, not a property of a colour).** CaptainPad 1676/6 skip/0 fail (EMPTY failing list, ~45 new), tsc + lint clean; engine `color_window_engine_api` 20/20 (was 14). 5 inspected screenshots in `~/tmp/fix_242/` from a fresh :7173 dist against an OFFLINE engine on :17242. **`_242` NEEDS AN ENGINE RESTART** (the `/color-pairs` validator and its state-file shape moved together) — as does `_217`'s, still pending. Debt: docs/53 §4.2 + docs/55 still describe the wheel as absolute. **FOLLOW NOTE + METHOD AUTOPILOT + LIVE RETUNE SHIPPED (`_248`, all nine W-items of `docs/59` = the `_244` design, W9 included).** FOLLOW NOTE is a **MODE of the ONE colour daemon**, not a sibling: `mode: 'palettes' | 'followNote'` on the existing wire with **absent ≡ palettes**, so every config written before this is byte-unchanged AND byte-understood, and mutual exclusion with TURNS / crossfade / palette-set is **by construction** — one daemon, one mode, one broadcast, one front door — rather than a second active flag every surface must remember to check. The note loop lives INSIDE `color_autopilot.js` as a `paramCenter.subscribe` on `audioNote`/`audioNoteHue` (the companion already publishes both at 10 Hz and already holds the committed pitch through silence), so it survives an iPad sleep and satisfies the deadman rule; the METHOD cycle is the daemon's existing generation-guard timer and hold+fade stay ADDITIVE. **The generators are now ported engine-side** (`lib/color_schemes.js`, **zero imports of any kind**) because the base hue moves with the music and a precomputed client ring cannot express a hue nobody has played yet; parity is the `_217` `lerpHue` idiom — ONE literal of **9 ids × 3 base hues → five `{h,s,v}` triples asserted EXACT (no epsilon) in BOTH suites**, 27 assertions a side. A first draft that “normalized” the base hue with `((h%1)+1)%1` was caught and REMOVED: that is not the identity on an in-range hue (0.1 → 0.10000000000000009) and would have put the engine's ring a float off the client's for exactly the hues that look safest — the engine now THROWS on a base outside `[0,1]`, a boundary check rather than a wrap. **LIVE RETUNE** (`patchState` + `PATCH /deck/color-autopilot`) answers the follow-up order for ALL THREE families: **the patch never bumps `generation` and never cancels the tween**, which is safe because the reset was never in the TICK (it reads state, ring and durations fresh at fire time) — it was in the bump and the cursor reset. Holds re-arm phase-preserving, fades land from the next fade, ring restages adopt at the next transition fading from live params, `sel`/`method` retween now, `active`/`mode` are REFUSED by name (takeovers stay on POST). One stated deviation from docs/59 §5.1: the re-arm measures from when the HOLD began, not from the tick — with a real fade those differ and measuring from the tick would silently eat the fade out of the cycle; with a hard cut they coincide, so §5.3's identity holds exactly and is tested as written. **THREE REAL BUGS found by test/walk rather than by eye:** the first method advance repeated the starting method (the prime left the cursor at −1, so the first “advance” was a three-second crossfade to itself); the card's note letter was a whole method hold stale (nothing re-broadcast between advances — new `onNoteChange`, committed changes only); and loading the deck while follow-note ran **white-screened the whole screen** (the focus seed put the mode-scoped payload straight into state, `palettes` became `undefined`, `ColorAutopilotPanel` read `.length` off it) — fixed at both doors, and that panel now SAYS “FOLLOW NOTE is driving the colours” instead of drawing an empty chip row as though nothing were selected. A **fourth** was caught by the engine-API suite against a rig whose persisted block had been left in follow-note mode: a `mode`-less palettes POST (the timeline cue path, older builds, scripts) inherited the LIVE mode and came back 400 — the merge now INFERS the mode from the body's own fields, and a body carrying both is refused rather than guessed. UI: a third transport card with the state line, the live ring with A/B arm-then-tap (stored as INDICES, so the pick survives every re-theme the music causes), method chips in three states (off / in the cycle / **on the rig now**), METHOD HOLD `[CONT,10,30,60,120,300]` default 60 and METHOD FADE `[1.5,3,6,10]` default 3 in their OWN rows (a MOOD cadence — folding them into the `_224` seconds-scale PAIR transport would put 1 s method thrash one tap away), NOTE FADE `[SNAP,0.4,1,2]` default 0.4, and **live-retune microcopy on all three cards** (“HOLD applies now · FADE from the next fade — no stop and start”) worded from the same table the patch builder obeys. **Zero timers added** (grep-clean for `setInterval`/rAF; the countdown is the existing self-ticking `<SwapCountdown>`). `manualWriteGate` UNCHANGED — kind-agnostic, its sentence still true; a scheme tap while following is a METHOD OVERRIDE through the daemon's own front door (the `_224` restage idiom on the method axis); `colorAutopilotWritable` learns the mode, or the APC clip_stop would have silently dropped the colour half of every press against a follow-note config. **W9 SCRIABIN INCLUDED** — a one-tap preset for the companion's `noteColors` wheel sent as a single 12-field patch through the ORDINARY `setDerivedConfig` door (no preset-shaped side channel), HUE ONLY by stated design. Engine colour suites 39+48+54+20+7 = **168/168**; CaptainPad **89 files / 1830 pass / 0 fail** (`colors_window_logic` 125 → 228); tsc + lint clean on every touched file. **Offline walk 29/29** on a real engine (:17248, `--dest 192.0.2.x`, note injected via `POST /param-center` — mic never opened, live companion never contacted): the rig landed on `complement@0.25` exactly, **20 republishes of the same note wrote nothing**, and the two headline retunes wrote **no colour** while moving the countdown by **exactly 20000 ms** (follow-note 10→30 s) and **exactly 8000 ms** (crossfade 2→10 s). 7 inspected screenshots in `~/tmp/fix_248/` from a fresh :7177 dist (bundle hash verified) — including the two-frame proof that a FADE pill moved MID-FADE leaves the fade walking (`0.714587 → 0.960342`, landing on neither endpoint). New tool `simulation/agent_tools/colors_follow_note_capture.cjs`, which caught a measurement error in itself (a bare `[aria-label]` lookup pressed the deck TRANSITION row's “3s” pill and reported success) and now fails loudly if the pill did not land. **`_248` NEEDS AN ENGINE RESTART** (daemon + generator module + routes moved together — until the bounce FOLLOW NOTE and every PATCH 400 on the live rig), a CaptainPad web rebuild, and a Companion restart for the SCRIABIN button. Vetoes open (docs/59 §10): the 7-of-9 default subset, 400 ms note fade, 60 s method hold, scheme-tap-as-override, and whether to keep W9. **NATIVE STATUS (`_252` audit, docs/60 §1 row 9)**: this window needs NO port — the hue ring is react-native-svg and the whole COLORS surface is RN, so it already renders on the iPad; its `touchAction:'none'` armor is a cosmetic web-only no-op there. **INTERACTION-MODEL DESIGN READY (`_255`, Fable → `docs/61_colors_interaction_model.md`)** — the operator hit a FOLLOW NOTE conflict ("going from follow note to another tab should safely disable it"). Diagnosis: the mode cards are LOCAL state, the daemon family is ENGINE state, nothing links or names them — worst trap: a scheme tap on the TWO COLOUR card while following silently PATCHes `followNote.method` (the outcome table keys on engine kind only); plus no follow-note footnote/STOP off its own card, a kind-agnostic gate sentence, a meaningless moving BLEND scrubber under follow-note, zero visibility outside the Deck, and pre-`_248` engine skew mixed into what he saw. Design: **intent gestures yield, disappearance never does** — leaving the follow card (card tap / window hide / app tab, each one-line vetoable) posts a bare `{active:false}` (mode+tuning survive via inferMode, freeze native, narrated both ways, works pre- and post-bounce); NO engine lease/deadman ever; TURNS/crossfade PERSIST behind new visibility (DRIVING STRIP with inline STOP on every card, kind-NAMED refusal sentences, card auto-select on entry, app-wide `COLORS · FOLLOW G` header chip); `schemeTapOutcome` gains a `surface` arg so method-override is follow-card-only; manual gestures still refuse, never auto-stop. Client-only (no engine restart), sliced W1-W5 for parallel Sonnets + an Opus validation walk; 7 operator decisions (D1-D7) open with defaults. **`_259` SHIPPED the `_255` design** (client-only, zero engine files): FOLLOW NOTE now YIELDS on leaving its card / hiding COLORS / leaving the Deck tab — bare `{active:false}`, narrated, mode+tuning survive via `inferMode`, freeze-in-place native, navigation never blocks. TURNS/crossfade/palette-set persist (D2) behind the DRIVING STRIP with inline STOP, kind-named refusal sentences, entry card auto-select, and an app-wide `◉ COLORS · FOLLOW G / TURNS / XFADE / SET` chip on every tab (read-only). **C3 closed** — a scheme tap on the TWO card under follow-note no longer PATCHes `followNote.method` (proved by GET); blend scrubber inert under follow-note (C4); takeover messages name the loser. Opus W5 walk on an isolated engine (:17968, `--dest 192.0.2.x`, OSC/fire-sync off) caught + fixed 2 defects the slice gates missed (cold-open auto-select never fired; a parked operator's card could be yanked). All 10 contract screenshots pass; wave suites 322/322; lint clean in every touched file; one FOREIGN `_257` `audioBar` failure reported not fixed. D1-D7 shipped at Fable's defaults, each still a one-line veto. **`_263` fixed the dial's iPad drag** — the operator reported that dragging the `_242` hue dial ALSO scrolled the pane. Root cause: the `_211` gesture armor is **web** armor and native never saw it — capture handlers and `onPanResponderTerminationRequest: () => false` are React responder-system moves, while a native `ScrollView` is a `UIScrollView` whose pan recognizer never consults that system, and on the New Architecture RN drops `blockNativeResponder` (`RCTMountingManager`) while `RCTScrollViewComponentView.touchesShouldCancelInContentView:` only looks for a JS responder among its **ancestors** — never inside itself. So the scroll view cancelled the touches, the pane panned, and the drag died as a TERMINATE. Fix: an **opt-in scroll lock** (new `components/ui/scroll_lock.ts` + `lockable_scroll_view.tsx`, generalising the seam `dimmer_rack.tsx` already hand-wired) — the dial and `HorizontalFader` take it on GRANT (touch-down; the scroll view decides within a few points of travel) and release it on Release/Terminate/unmount, and the deck's two vertical hosts (`SectionHost`, `ColumnsScrollRest`) became `LockableScrollView`. Fixing the shared fader repaired the **BLEND scrubber** with **zero edits to `colors_window.tsx`**, so `_211` throttling and `_259` yield/gate logic are untouched by construction; web is byte-identical (every acquire is `Platform.OS !== 'web'`-gated) and `_242` semantics — anchor-on-touch, `DIAL_GAIN`, latch steering, **tap writes nothing** — are pinned by guard. Sibling audit: all COLORS ring/scheme/gallery surfaces are `TouchableOpacity` taps and were already fine; `live_touch_surface` and `dimmer_rack` already had their own seams; the `split_playlist_panes` divider has no scroll owner today but **needs the same three-line seam if docs/63 ever puts PATTERNS inside a scroller**; `timeline/DayView.tsx` flagged (same class, timeline owner's call). 39 new tests, **19/19 mutation probes flip a guard**; suite 100 files / 2132 pass / 0 fail; lint clean; one FOREIGN tsc red in `colors_window.tsx` (`badge` prop, concurrent wave) reported not fixed. **THE SELECTED PAIR NOW ORBITS THE RING (`_264`, client-only, zero engine files).** Operator: *'for the PALETTE TURNS we have 2 selected colors — keep their distance, and rotate them in a window to the right, and then loop back when going over the end.'* `_224` had shipped two features that never met — the sliding window built the ring as five ADJACENT pairs starting at T1, while the A/B pick (arm-then-tap, stored as ring INDICES) decided only what the TWO COLOUR card put on the rig; picking T3+T5 and pressing START TURNS gave a rotation that ignored both the chosen spacing and the pair currently lit. The ring is now built FROM the pair: with `d = (selB − selA) mod n`, turn `i` is slots `selA+i` and `selA+i+d`, so both ends step one slot right per turn, the spacing never changes, the lap closes after `n`, and every staged colour still reaches the rig twice — blended with the colour `d` slots along instead of always its neighbour. New `orbitPairs`/`orbitDistance`; `turnsPairs(colours)` survives as EXACTLY `orbitPairs(colours,[0,1])`, which is what keeps the crossfade (a two-entry ring with no selection of its own) byte-unchanged, and the patch builders take an OPTIONAL trailing `sel`. **D1: the orbit STARTS on the operator's pair** — posted beginning at COLOUR A's slot, not T1, because a restage is a full `setState` that resets the daemon's cursor to −1 and entry 0 is what plays first; starting at A is what makes START TURNS and a mid-rotation A/B pick land on the pair ALREADY LIT instead of jumping, generalising a property the default selection had by accident. Cost paid by new `orbitPhase(staged, wire)`: a live ring is adopted into the draft ONLY when it is not a rotation of the staged one, so the operator's T1..T5 numbering stays put while the rail and state line read the wire. **D2: pure superset** — no pick made means `d = 1` and today's behaviour exactly. **D3 (flagged):** the picker stays on the TWO COLOUR card (TURNS has no A/B arm control to hang it from); TURNS gained read-only A/B badges on its five slots plus a spacing caption. The READER had to generalise too — `isTurnsConfig` tested that pairs CHAIN (each `c2` is the NEXT entry's `c1`), true only at `d = 1`, so a `d = 2` ring the window itself posted would have read back as `'palette-set'` and the card would have shown a ring the engine was not rotating; replaced by `turnsOrbit` (find the one `d` with `pairs[i].c2 === pairs[(i+d)%n].c1`, SMALLEST `d` wins so a MASTER ring still reports 1 unchanged). `rotationCursor` needed NO change — it projects onto the posted ring's from→to segments and never assumed adjacency (verified against all 20 selections rather than assumed); `cursorRailSegments` returns the SINGLE 2-cell capsule at `d = 1` (splitting it would notch a highlight that never had one) and two 1-cell segments past that, the existing `left`/`left − n` clip trick carrying the T5→T1 seam unchanged. **Engine unchanged and unaware, verified first**: `color_autopilot.js` validates `palettes` entry by entry, cycles them sequentially and tweens between consecutive resolved param sets — nothing in the daemon ever asks whether two pairs share a colour, so the orbit is a client-side construction of the SAME wire. Back-compat proved BYTE-IDENTICAL three ways (unit deep-equal across all nine generators; `JSON.stringify` of the selected vs unselected patch; and through a REAL engine, where the default patch comes back from `GET /deck/color-autopilot` identical to the pre-orbit wire at 343 bytes) — plus the negative signal that **all 263 pre-existing `colors_window_logic` tests and all 28 wiring tests passed unmodified** before a single new test was written. Offline walk on an isolated engine (:17262, sACN black-holed on TEST-NET-1, readout computed by the REAL client `rotationCursor` + `orbitWindowSlots` esbuild-bundled from the UI's own TypeScript): with A=T3/B=T5 the observed sequence was `T3+T5 → T4+T1 → T5+T2 → T1+T3 → T2+T4 → T3+T5` — all 6 windows exactly 2 slots apart, one slot right on each of 5 transitions, the T5→T1 wrap observed, 56 settled + 18 mid-fade samples resolved; `d = 1..4` all accepted and round-tripped verbatim. 22 new tests (263 → 285) covering all 20 selections × all 4 distances, wrap, the smallest-`d` rule, `orbitPhase` round-trip, cursor inversion on non-adjacent windows, and rail seams; suite **101 files / 2174 pass / 6 skipped / 0 fail** with an EMPTY failing list and **no foreign reds**; tsc + eslint clean. (The transient `badge`-prop tsc red `_263` reported as foreign was MINE, caught mid-edit — resolved.) | `_211` + `_217` + `_224` + `_242` + `_248` + `_259` + `_263` + **`_264`** shipped; `_217` + `_242` + `_248` engine restart pending (rides gen-7); `_259` + `_263` + `_264` are client-only so they need **no** restart (the iPad needs a fresh Metro reload); D1-D7 nods still open; **`_263` awaits the operator's 2-step on-device check** (drag the dial → pane must not move; tap the dial → hue unchanged); **`_264` awaits the operator's 4-step orbit check** (pick A=T3/B=T5 on TWO COLOUR → badges + `2 slot(s) apart` on TURNS → START begins on T3+T5 with no jump and the rail shows two separated cells travelling together → an unpicked default behaves exactly as before), with D1 (orbit starts at A) and D3 (picker stays on the TWO COLOUR card) each a one-line veto. **RENDER COST CUT (`_282`, client-only, no engine restart)** — operator: *"in the palette turn mode, there's a bit of lag in the UI elements when showing the turning window"*. The engine tweens `colorPalette1/2` every 40 ms and this window both subscribes to them AND mirrors them into `h1`/`h2`, so the whole ~2000-line body re-runs at broadcast rate — that part is by design (the dial follows the rig), but it was doing operator-speed work there: `generateScheme` **nine times inside the JSX** (45 swatches a frame), the 90-arc `HueWheel` re-reconciling on fresh array + closure props even though TURNS draws it from the STAGED draft a broadcast never moves, `parColours`/`rampStops` (27 mixes) derived while their TWO COLOUR card was not mounted, every saved-palette SVG icon redrawn, the live-touch badge array rebuilt once per chip. The hidden multiplier that would have made a naive memo pass useless: **`setSlot` closed over `h1`/`h2`**, so it and `loadIntoArmed`/`loadPair`/`loadPreset` — props of the very chips being memoized — got new identities every frame. Fixed with `schemeFaces`/`pairHues`/`turnHues`/`litWindow`/`turnPins` memos, module-constant labels, `React.memo` on `HueWheel` + `SlotButton` + `SchemeButton` + two extracted chips (`SwatchChip`/`PresetChip`, each taking its id/index back so call sites pass stable handlers), stable dial handlers, `setSlot` reading a ref, and the TWO COLOUR strips deriving only for the card that draws them; `WindowRail` deliberately NOT memoized because it is the thing that must move. **Measurement corrected the brief's hypothesis:** React commits are ~58/s **whether the window is open or closed** (`display:'none'`, never unmounts; `ControlDeckScreen` re-renders wholesale above it) — COLORS is a subtree caught in a deck-wide re-render, not its cause; the open window's unique cost is LAYOUT (261 passes per 10 s vs 13 closed). So this cuts cost-per-render, not render count: main-thread scripting over 10 s with the window open on a live TURNS **3857 ms → 2433 ms (−37 %, i.e. 38.6 % → 24.3 % of wall clock)**, closed 3652 → 2444 ms (−33 %), commits unchanged 589 → 575. 9 new source-text guards (vitest cannot render this file). **iPad gain is INFERRED, not measured** — headless-Chrome web numbers, platform-neutral fix. Remaining ~58 commits/s is deck-wide and untouched (needs leaf-level palette subscriptions or gating the `h1`/`h2` mirror on `visible`, which risks a stale frame on reopen) — deliberately not attempted. **Rebuild-pad required** **NEXT WAVE DESIGNED (`_296`, Fable → `docs/71_two_tone_palette_presets.md`): two-tone palette presets — one store, every menu.** Census: the global line's COLORS + QUEUE tiles (`CPCControls.tsx` → `ColorPickerModal`/`ColorQueueModal`, one component on deck AND mixer) render only the read-only 23-entry `/color-palettes` library, while the wheel's SAVE PALETTE has written named schemaV2 pairs into scene-owned `/color-pairs` since `_242` — the two stores never meet. Ruling: NO new model/store/capture; R1 the modals gain a SAVED PALETTES section (QUEUE arms saved pairs), R2 EDIT-mode RENAME/MOVE/DELETE via the existing whole-list POST (zero new endpoints, no schema bump), R3 a `colorPairs` WS topic + connect replay (the one engine slice; restart batches with `_283`/`_288`). Dead-code census: nothing to remove. D1-D10 vetoable; implementation reserved `_297` — hard-gated on the coordinator checkpoint + after `_295` (same-file risk on colors_window/hue_wheel), soft after `_287`/`_289`/`_291`/`_293` |
| **Deck rehaul** — windowed workspace | **SLICE A SHIPPED** (`_208`): four windows live — PATTERNS (protected floor), PARAMETERS, AUTOPILOT, COLORS (shell, closed by default). Hidden = `display:'none'`, never unmounted (state/scroll/WS survive); survivors reflow on the unchanged 4/3/3 weights; pure reducer + total normalizer (`deck_workspace_layout.ts`, 27 vitest); closed-set-only AsyncStorage `deck_workspace_layout_v1`; narrow PATTERNS-pin preserved; layout ops emit zero engine traffic. Deviation: minimize chips merged into the one rail row (no per-window header) — docs/53 §3.3 "AS BUILT". **Slices B/C/D landed in `_211`** — the COLORS shell is now the real two-colour + TURNS window (see the Color deck row). **RESTYLE R0+R1+R2 SHIPPED** (`_210` tokens, `_213` the visible reskin, contract `docs/54_deck_ui_restyle.md`): all four window tracks now sit on the SAME `panel` surface (before, PATTERNS was a pane and the other three were bare transparent columns with floating cards — the design's predicted biggest delta); window identity dots as §3 proposed (PATTERNS `primary` / PARAMETERS MIDI violet / AUTOPILOT `tertiary` / COLORS a live C1/C2 DualSwatch), identical open vs hidden so closed→open reads as one object moving; `HIDDEN` divider on `borderStrong`; chip grounds corrected (open chips wear their window's own surface, hidden chips the quiet rail paint). R1 retired the scattered literals across 19 files — `#00a86b` → `tertiary`, the ambers → the `warning` family (PlanLockBanner repainted from ONE `warning`+`readableInk()` pair, ten `#1a1a1a` inks gone), OfflineBanner → the `errorContainer` pair, ad-hoc radii → the `Radius` scale, on-states → `accentWash`, modals → the `panel` recipe; **PANIC keeps its frozen hex** (now `PANIC_AMBER` by name) and **GlobalParams is a no-op**. Behaviour frozen; tsc/eslint clean; suite 1328/0 fail (+9 new contrast tests); 12 before/after screenshot pairs in `~/tmp/fix_213/`. **FINDING for the operator:** `light.tertiary` (`#1b9e77`) measures 2.42–3.39:1 as text, so the daylight theme's CONNECTED / ◎ ALL / live-wash labels are still under AA — R1 improved them (the old literal was 2.20–3.08) but the fix is a one-line `theme.ts` value change (`#0d5c44` clears both bars); pinned by a test that fails the day it is fixed. **FULLSCREEN + PERFORMANCE OVERLAY SHIPPED (`_217`, docs/55 §2.4-2.5).** Narrow-mode PATTERNS now FILLS the stack when it is the only window on screen — the fixed pin left it sitting above a dead scroll region, so `patternsFillsNarrow` swaps it for a flex fill and `ColumnsScrollRest` collapses while STAYING MOUNTED (the no-remount contract holds). Strictly conditional: the party 2026-07-11 pin — floors, 38.5 %, `narrowScrollOwner` — is byte-identical the moment any second window is open, proved by a screenshot pair from the same build. Performance mode hides PARAMETERS + AUTOPILOT as a DERIVED view at the `isOpen`/`flexFor`/rail boundary inside `useDeckWorkspace()`: the overlay has no reducer action to dispatch, so the reducer, the normalizer and `deck_workspace_layout_v1` are unreachable from it — MEASURED byte-identical BEFORE/DURING/AFTER a round trip in both orientations. Chips SUPPRESSED per D3 (neither open nor on the rail — an affordance that always refuses should not exist) with one static `PERFORMANCE — PARAMS & AUTOPILOT HIDDEN` caption; COLORS stays exactly as the operator left it, and their own chip taps still persist normally. Reads `usePerformanceMode().active` RAW, not `usePerfLock()` — the captain bypass is edit rights, not screen composition — and unresolved state defaults to everything SHOWN. +12 layout tests. NEXT: operator eyeballs the reskin on the iPad; R3 paints the shared/gesture surfaces (fader, CPCControls, split divider, PlaylistPanel, GEM strip) one at a time with mixer screenshots. **FIFTH WINDOW — PIXELS — SHIPPED (`_225`), plus the second playlist now follows the app's layout mode.** PIXELS renders the **SIMULATION's own 2D pixel map** (operator: "simulation 2d pixels are the source of truth please") — geometry consumed VERBATIM from the sim resolver's export `docs/ui/touch_control_pixel_views.json`, fetched read-only from the sim's own server (`GET :6969/docs/ui/…`, the sim serves the repo root), so his Top-Down `compress`, VintageLed `expandPitch`, per-panel `rotate` and saved `offsets` are already baked in and there stays exactly ONE layout implementation, in the sim. His four authored views (`TOP-DOWN/FRONT/LED STRANDS/TE SIGN`) are the picker. Colour rides the EXISTING `/ws/viz` bus — no new WS type, no new socket, no writes — with a labelled `SHOW`(`preDimmer`, default)/`RIG` toggle between two REAL buffers; SHOW is default on the engine's own note that dimmers "wash the UI preview out to near-black" (measured: `rig` 50/1530 vs `preDimmer` 173). **The engine's vis subsampling is DECLARED, not hidden**: `vis.maxPixels: 100` means 100 measured samples for 964 pixels at 5.2 Hz, so the window draws every mapped pixel at its true sim position, colours each from the nearest transmitted sample (a ~10-px band along a strand — the tested exact inverse of the engine's index table, monotonic, IDENTITY once the cap stops binding), and PRINTS `720 PX · 100/964 COLOUR SAMPLES` on screen. Looks like the sim because it borrows the sim's own `PREVIEW_GAMMA 0.6` and `#0b0d12` ground — the ground FIXED on every theme as an `identity.ts`-class colour, because light only reads on dark and light-theme `surfaceContainerLowest` is literally `#ffffff`. Raw canvas, **ZERO React on the frame path**: measured **1000–1430 fills/frame, 1.1–7.1 ms (median ~2–4 ms) → ~1–2 % duty at 5 Hz**; hidden = mounted but idle. Weight 4, chip dot `C.secondary` (the NEUTRAL — this window's content IS colour), contrast-guarded on all five themes; **performance overlay UNTOUCHED like COLORS** (the order said params & autopilot *settings*; this window has none — verified with the engine genuinely in performance mode), and `_217`'s `patternsFillsNarrow` still holds. **⚠ UPGRADE HAZARD FOUND AND FIXED:** "default closed" does NOT by itself protect stored layouts — only the CLOSED set is persisted, so "open" is the absence of a name and a pre-existing store cannot name a new window, which would spring it OPEN on everyone. The store now also records **`known`**; anything current and outside it is appended to `closed`, and a store with no `known` is a pre-`_225` build treated as knowing the original four. Key stays `deck_workspace_layout_v1` (bumping it would discard real preferences). Case matrix 8 → 16 reachable layouts. **SECOND ORDER:** `SplitPlaylistPanes` gains `sideBySide={!isWide}` — WIDE keeps DECK B **under** DECK A byte-identically; NARROW puts it in a **column to the RIGHT** (stacking a full-width short band gave two ~140pt panes; splitting sideways gives two full-height columns). Same stored ratio, same `[0.15,0.85]` clamp, same divider and PanResponder — the axis only picks the layout property, the gesture delta, the container extent and the minimum; **DECK B's ✕ unbind lifecycle untouched, placement only**. My four touched test files 109/109; full suite 1468/6 skip with an EMPTY failing list of mine (the 6 failures are concurrent agents' `performance_mode_logic.test.ts` + `special_events_api.test.ts`). 7 inspected screenshots in `~/tmp/fix_225/`. No engine/sim restart needed — client-side only, but the deck needs a fresh CaptainPad web build. Open for the operator: should the monitor default to `RIG` instead of `SHOW`; and the 100/964 colour cap is the one real fidelity limit — the clean fix is a **per-key** vis cap in the engine (full-rate `rig`/`preDimmer`, capped channels), deliberately NOT taken here. **THE PIXEL VIEW REACHES THE MIXER (`_243`, contract `docs/58_mixer_pixel_views.md` = the `_241` design).** Every expanded mixer strip and the MASTER OUTPUT block now carry a **PIXELS band** — the same sim-resolved 2D ship the deck window draws, lit from the same `/ws/viz` bus, with a `TOP-DOWN ▾` chip opening the mixer's own modal picker (rows = `artifact.views` VERBATIM, honesty sentence in the footer) and the compact ratio always on the header (`100/964` per channel, `964/964 FULL` on the master, whose SHOW/RIG chips sit inline). **No forks:** the deck window's imperative paint was EXTRACTED to `components/deck/pixel_view_paint.ts` and both surfaces share it, and the per-mount artifact fetch became a module cache (`hooks/use_pixel_view_artifact.ts` — nine bands ⇒ ONE fetch, proven by test; the deck window migrated onto it). **`pixel_paint_scheduler.ts`** is the new safety: one shared rAF drain, **8 ms budget**, round-robin, latest-buffer-wins (the scheduler holds no pixels, only the debt), drain-time visibility gating; clock injected, real instance THROWS rather than substitute a timer. Frames still never touch React, canvases are `pointerEvents:none`, one shared ResizeObserver + IntersectionObserver. **MEASURED in-page (upper bound):** 5 bands visible → median **5.3 ms**/drain (p95 7.2); 9 bands → median **7.7 ms** (p95 8.4, max 13.6 = the budget plus the one canvas it is checked after); strips scrolled out of the row never painted at all. The feared 20 ms burst does not occur (a 316x110 band is ~0.85 ms, not `_239`'s 2.2 ms) — the scheduler is what GUARANTEES that. **Performance mode** reuses `_217`'s derived-overlay contract on RAW `usePerformanceMode().active`: LOCAL PARAMS column not rendered, band into that slot forced open, static `PARAMS HIDDEN · SHOW MODE · MIDI STILL LIVE`, master forced to 160 px, playlist stays, **zero persistence writes** — an enter/exit round trip in one page is layout-identical. **D5 TAKEN:** three lines in `pattern_mixer.js`'s mixer vis pre-pass apply `applyPreviewMaskBlackout`, the call deck PFL and Live Touch already make (docs/27) — a view-selected channel's preview is now black outside its selection (+3 engine tests; the composite is provably untouched). **⚠ As-built: this darkens the thin per-channel strips for view-selected channels** — operator veto point, the alternative is an explicit caption. **ONE MEASURED DEVIATION:** docs/58 §2.3's 260-380 px perf column is 141x148 as written (157x203 on a 1366x1024 iPad) — a strip card is `alignSelf:'stretch'`/`overflow:hidden` so it CANNOT grow (a full-width 176 px band pushed the playlist and MUTE/SOLO/BUMP off the card), and the top-down ship is capped by the 316 px CARD WIDTH in EVERY layout. Shipped the doc's placement with the body split flipped to 55/45 in the view's favour; real perf dominance lands on the master band (1294x158). **NATIVE (the mid-flight native-first order, disclosure for docs/60):** on native the band is an EXPLICIT named refusal — `Platform.OS==='web'` gates render, fetch, scheduler, vis subscription and observers, so no crash and no bus traffic, just the real header over `NEEDS A BROWSER`; but `mixer.tsx` renders it unconditionally, so a native build would show nine such boxes (~140 px/strip) until the call site is gated or a renderer exists. **Portable as-is** (and all node-tested): the scheduler, `pixel_view_band_logic`, the whole `pixel_view_logic` geometry/colour core, the artifact hook. **Web-bound: exactly three things** — `pixel_view_paint.ts` (the one renderer file, which IS the Skia seam), the inline `<canvas>`, and the Resize/Intersection/`documentVisible` helpers. Suites: CaptainPad 85/1706/0-fail (mine +34, failing list EMPTY); engine 3498/3490 with 8 FOREIGN failures in untouched files. **Engine restart required for the D5 mask**; CaptainPad web rebuild for the rest. 10-shot matrix in `~/tmp/fix_243/`, harness `simulation/agent_tools/mixer_pixel_views_capture.cjs`. **NATIVE FIRST (`_252`, plan docs/60)**: the PIXELS window and all nine mixer bands now DRAW on the iPad — the `_243` seam was cashed in. `pixel_view_paint.ts` became a platform-neutral pass order over a `PixelPaintTarget`; a canvas-2d adapter keeps the web byte-identical (pinned by `pixel_view_paint_parity.test.ts`, which holds the PRE-refactor painter verbatim and diffs every 2D-context call across 4 sizes x 5 frame states) and a Skia adapter (`@shopify/react-native-skia 2.2.12`, `npx expo install`) records an `SkPicture` into a Reanimated shared value — zero React commits per vis frame, the `_243` scheduler reused UNCHANGED. New `PixelSurface` platform pair owns the element, the shared ResizeObserver/IntersectionObserver (moved verbatim out of the band) and, on native, `onLayout` + screen focus; `pixel_surface_visibility` answers `document.visibilityState` on web and `AppState` on the iPad. BOTH refusal cards and the `usePixelViewArtifact(isWeb)` gate are gone because the refusal stopped being true. Web re-verified on a fresh :7179 dist: deck ship + 3 bands lit, honesty ratios `964/964 FULL` / `100/964`, perf-mode round trip identical, scheduler median 3.6-8 ms. **MIXER REDS CLOSED (`_254`)**: the 11 persistent `blend_screen` failures `_248` blamed on `_243` are GREEN — they were fixtures leaning on the host-side lerp fallback that the (uncommitted) `_245` deck rehaul correctly deleted in favour of a `throw`, NOT a live defect (real-WASM dry-run compiles 18/18 blends). Auditing that verdict found the real one: **`POST /mixer/channels` accepted an unvalidated `mode`**, and under the no-fallback contract one typo'd POST throws inside the 40 Hz tick → `⛔ ENGINE FATAL` + `exit(1)` (the `_253` shape again, one missed caller of a hardened contract). Gate added + 6-test e2e suite; snapshot-restore path flagged, not gated. Mixer 625/620 (5 foreign model-lint), effects 732/732, timeline 445/445, special_events 109/109, e2e 87/87. **Needs the engine restart** (composes with `_253`'s). **DECLUTTER WAVE DESIGNED (`_257`, contract `docs/63_deck_declutter_view_optimizer.md`)**: the audio-signals row and the classic 1D LIVE OUTPUT strip become hideable **bars** in the SAME workspace reducer/store/chip row (surface tiers — `DeckSurfaceId = DeckWindowId | DeckBarId`; bars never get tracks/weights or a `patternsFillsNarrow` vote); the `_225` `known` rule generalizes to "unknown id → its shipped default" so bars arrive OPEN and every stored layout hydrates byte-identical (key stays `_v1`, future windows still default closed); PIXELS-open suppresses the 1D strip as a `_217`-style DERIVED overlay (zero writes, static caption); the workspace bar moves UNDER GLOBALS via new deck-only `CPCControls` props (mixer byte-identical) with the plan-status cluster hoisted to the bar's never-scrolling right end (safety chips never hideable); landscape playlist floors ≥4 rows default / ≥6 simplified pinned for the validation walk, with a W0 repro of the "1 visible pattern" report (suspects: wide-mode DECK B vertical stack × perf row boost). W1 (pure layout logic) can start now; W2/W3 (chips, index.tsx+CPC wiring) WAIT for the docs/61 COLORS wave to land — `index.tsx`/`deck_workspace.tsx` overlap noted in docs/63 §8. **MIXER RELAYOUT DESIGNED (`_258`, contract `docs/64_mixer_relayout.md`)** after the operator's live-iPad verdict ("Mixer is fugged up bad! Especially the 2d pixels") + addendum (channels as hideable windows; deck COLORS picker back in the mixer): screenshots measured the mess against the artifact's own 1.91:1 top-down aspect — the master band is ~75 % black void, the perf column stretches the canvas while SHRINKING the ship, the edit band crushes the body to a 1-row playlist, and **portrait has a straight overlap DEFECT** (action rows painted over the playlist — W0, fixable immediately). Contract: mixer workspace store over namespaced RUNTIME ids (`ch/<id>`, `sec/<id>/params|pixels`, `citizen/masterBand|colors`; unknown CHANNEL ids default VISIBLE — content, not chrome; citizens keep the `_225` closed rule), chip rail hosted in the master band's reclaimed void, aspect-honest canvas sizing (no painted letterbox), per-channel PARAMS/PIXELS hiding with 28 px stubs, card caps from VISIBLE count (2 → ~640 pt), COLORS as ONE rig-global citizen mounting the real `ColorsWindow` (W6 strictly after the docs/61 wave; closes its C5 for the mixer), groups de-emphasized by building nothing. `_243` machinery + perf zero-write contract pinned; zero engine changes. Convergence duty with docs/63: shared `WindowChip` extraction by whichever lands second; no file overlap by construction (mixer bar NOT in CPCControls). **DECLUTTER SHIPPED (`_267`, contract docs/63)**: the AUDIO row and the 1D LIVE OUTPUT strip are now workspace citizens — `DeckSurfaceId = DeckWindowId | DeckBarId` in the SAME reducer/store/chip row, bars never getting tracks, weights or a `patternsFillsNarrow` vote; the `_225` `known` rule generalized to "unknown id → its SHIPPED DEFAULT membership", so future windows still arrive closed while the two bars arrive OPEN and every pre-existing store hydrates byte-identical (key stays `_v1`, and hydration writes NOTHING — proved on the running app). PIXELS-open suppresses the 1D strip as a `_217`-style DERIVED overlay (zero writes, static caption, a manual OUTPUT hide survives PIXELS cycles). The optimizer moved UNDER GLOBALS via deck-only `CPCControls` props (**mixer parity pinned by test**, not eyeball) and the plan-status cluster HOISTED to the bar's never-scrolling `trailing` slot. `onViz` gates its 200 ms `setVisVersion` bump through a REF so the zero-dep callback identity — and the bus subscription — survive. **The operator's "enable one view and it takes over the screen" order was folded in mid-wave**: `wideFlexFor` was renormalizing over the OPEN set only, fixed with a denominator floor absorbed by PATTERNS (`WIDE_FLEX_FLOOR`, derived from `DEFAULT_LAYOUT`) that changes EXACTLY 5 of 16 reachable compositions and leaves the operator-locked 40/30/30 and all-five-open byte-identical; MEASURED 41.8 %→28.8 % (secondaries) and 50.2 %→39.9 % (PIXELS). **Portrait was ruled NOT the same defect and then PROVED so** — narrow tracks are content-sized regardless of sparsity (COLORS 1010 px / PATTERNS 460 px identical whether reopened from all-hidden or open alongside others), and capping it would need a nested same-axis ScrollView that `narrowScrollOwner` forbids → operator decision, not a silent pin break. **W0 verdict:** the "1 pattern" report is **DECK B BOUND** (not chrome, not perf — perf rows are smaller since the 2026-07-27 cut). **FLOORS, measured at the real 66 px row pitch (§4.2 assumed ~51):** 1366×1024 **MET with margin (7 default / 8 simplified)**; 1194×834 ≥4 default met at capacity but **≥6 simplified MISSED by 16 px (5 seatable)**, and DECK-B-bound is 2/pane vs ≥3. D4 padding trim taken (non-compact ONLY — compact IS the mixer sizing) and now spent. Suite 100 files/2132 pass/0 fail with an EMPTY failing list; tsc clean; 2 FOREIGN lint warnings reported not fixed. As-built: `outputBar` dot is `C.text` not `C.icon` (icon measures 1.549:1 on light; secondary collides with PIXELS), and a REAL light-theme collision is surfaced not patched — `ACCENT_AUTO` and `light.tertiary` are both `#1b9e77`, so AUDIO and AUTOPILOT share a dot on the daylight palette until the already-pinned `light.tertiary → #0d5c44` fix lands. **This is the LAST deck-file wave — the shared `WindowChip` extraction convergence duty now passes to the mixer relayout lead per docs/64.** No engine restart; CaptainPad web rebuild required. **MIXER RELAYOUT SHIPPED (`_270`, contract `docs/64`)** — the operator's "Mixer is fugged up bad" answered and MEASURED: master band **1220×158 @ ~75 % void → 223×118 edit / 327×174 perf, ZERO void**; channel band at 2 visible **316×112 (~24 067 lit px²) → 327×174 = 56 977 px² = 2.37×**; perf column **313×245 stretched → 313×166 aspect-fit**; portrait cards **320 pt + dead gutter → ~470 pt**; PARAMS-HIDDEN caption **per-channel → exactly once on the bar**. W0 was a real DEFECT: the bounded flex chain was gated to cards under 560 pt, so a ~1100 pt iPad portrait card always fell through to an unshrinkable `minHeight:220`, its children never joined the shrink negotiation, overflowed `channelBody` and were clipped only at the CARD's `overflow:hidden` — action rows over playlist text, LOCAL PARAMS/perf view off-card but in the DOM. Channels are now workspace windows over **namespaced runtime ids** (`mixer_workspace_layout_v1`; floor refuses to hide the last visible channel, hiding is VIEW-ONLY with zero engine calls, hidden channels stay mounted); per-channel PARAMS/PIXELS hiding with 28 px stubs; thin 1D strips only when the 2D band is hidden; COLORS mounts the REAL `ColorsWindow` as a rig-global citizen (`colors_window.tsx` untouched — `visible` covered it). Groups de-emphasized by BUILDING NOTHING. **The contract itself was WRONG and is amended** (`docs/64` §1 AS-BUILT CORRECTION): top-down is **1.872** not 1.91 (corner-vs-centre — `flattenView` uses glyph CENTRES), multi-panel aspect is **not** the sum of panel aspects (front columns **2.9227** not 2.713; te_sign **1.4197** not 1.353 — the wrong formula left ~8 % residual letterbox on FRONT/TE SIGN, invisible on the single-panel DEFAULT view), and `panelGap` makes the fixed point scale-dependent so sizing refines against the REAL `arrangePanels` at the REAL slot/cap (worst-case void **0.38 %**). **CONVERGENCE DUTY DISCHARGED**: `components/ui/workspace_chip.tsx` extracted and consumed by BOTH bars (public props byte-unchanged), and the two `known`-set tables now share one exported `WORKSPACE_KNOWN_SET_RULE` pinned by a same-object-reference test. **OPERATOR VETO POINT: the mixer's COLORS chip never yields** — `docs/61` §3 L2 stops FOLLOW NOTE on hide, but with COLORS on two surfaces "hidden" no longer implies "left the follow card", and this wave's invariant is zero engine calls on hide; deck L1/L2/L3 untouched, proven engine-silent (zero POSTs over a live rotation). Gates: **103 files / 2214 pass / 0 fail**, owned failing list EMPTY, tsc clean, lint 0 errors; W7 walk on a fully isolated scratch stack (OSC 10000 + fire-sync 7703 disabled, sACN to TEST-NET-1, `MARSIN_STATE_DIR` redirected) with live :6967/:6968/:6981 verified untouched. **⚠ TWO stray test channels sit in `states/titanic/mixer_state.yaml`** (`ch_1786733914718_0` pre-existing from an earlier session; `ch_1786846862499_0` from this wave's W5 scratch run) — clean before the gen-8 restart or they appear in the live mixer. No engine restart; CaptainPad rebuild needed.  **NARROW MINIMIZE/MAXIMIZE CORNER CASE FIXED (`_274`)** — operator RULED the reopen-from-all-hidden transition a DEFECT, superseding decision 14. Mechanism: the narrow columns host's two children were sized by TWO INDEPENDENT RULES that never looked at each other or at the host — a rigid, NON-SHRINKABLE PATTERNS pin derived from the DEVICE WINDOW (`flexBasis`+`height`, `flexShrink:0`) beside a `flex:1` region whose windows are content-sized. Two failures, both reproduced and measured on a scratch dist: (1) 834×1194 PATTERNS **835 → 460 px, 12 visible rows → 4** the instant one window is restored, while the newcomer claims **1010 px in a 383 px viewport** (1024×1366: 1007 → 526, 15 → 6); (2) when the pin EXCEEDS the host (880×620, host 309, pin 400) PATTERNS **overflows by 95 px** under the bottom PANIC bar and the region is starved to **ZERO — the restored window never appears at all**. Fix = the NARROW analogue of `WIDE_FLEX_FLOOR`: one pure `narrowStackSizing()` returns **the shares of the SHIPPED DEFAULT deck with the protected window absorbing the slack** (`share = min(1, restCount / DEFAULT_NARROW_REST_COUNT)`, the count DERIVED from `DEFAULT_LAYOUT`), plus a preferred 220 pt region floor capped by the slack (so it can never cost PATTERNS the pin), a HARD 72 pt region floor (the one clamp allowed to cut in, and only on a stack too short to seat the pin) and a 0.5 PATTERNS share floor. `index.tsx` now MEASURES the columns host (`onLayout`, `!==`-guarded, no feedback loop) and the PATTERNS track goes `flexShrink` **0 → 1** with the redundant `height` dropped — it can no longer spill past the host and be painted over by the region that follows it. MEASURED: reopen-one gives 834×1194 **460 → 623 (4 → 8 visible rows)** and 1024×1366 **526 → 770 (6 → 10)** with the newcomer bounded to the 220–245 px scroll viewport, while the default and every richer composition, PATTERNS-alone, and **all of wide mode at both landscape viewports are byte-identical**; the full minimize/maximize cycle at 4 viewports shows no overflow, no zero region and no box intersection at any step. **PIN BENT (documented in code + report):** the party 2026-07-11 pin is now a FLOOR when one window is open below it and a TARGET that yields on a too-short stack; `narrowScrollOwner` (still exactly ONE scroll region, nothing nested), `patternsFillsNarrow`, no-remount, the perf zero-write contract and `wideFlexFor` all kept intact. **HONEST GAP: a literal box overlap could NOT be reproduced on the web dist** (36 states + a 12-state tight sweep, zero intersections) — if paint-over persists on the NATIVE pad the remaining suspect is native-only overflow, which this fix makes structurally impossible. Suite 104 files / 2265 pass / 0 fail, +9 tests including a 720-case invariant sweep; tsc clean; lint 0 errors. No engine restart; **CaptainPad rebuild required**.  **MIXER POLISH SHIPPED (`_275`, contract `docs/67` = the `_273` design, W1→W5 with defaults D1–D7)** — the operator's four live-iPad orders, answered and MEASURED. **(1) `citizen/masterBand` defaults CLOSED**: `SHIPPED_DEFAULT_CLOSED_CITIZENS = ['colors','masterBand']`, its two consumers (normalize's silent-id fallback, reducer `reset`) then correct by construction. **Fresh stores ONLY, proven not asserted** — every mixer store ever written serializes `known ⊇ citizen/masterBand`, so `normalizeLayout`'s `wasKnown` gate exempts all of them; the migration stayed REJECTED (D1) because the store records MEMBERSHIP, not INTENT, and "known and open" cannot tell *deliberately reopened* from *never touched*. The shared `WORKSPACE_KNOWN_SET_RULE` row flipped while staying the SAME OBJECT both layout modules re-export (`_270` §5 same-reference test green). Pinned as the contract's §2.4 list 1–5 verbatim, +2: upgrade store keeps the band OPEN, an already-hidden store is not double-appended, no key → `closed === ['citizen/masterBand','citizen/colors']` so the fresh rail reads MASTER VIEW then COLORS, synthetic `known` without it → closed, RESET closes both citizens and provably never a channel, **perf on a fresh store shows NO band** (D2 accepted) while an upgraded store still gets it, serialize→normalize a fixpoint. `docs/64` §2.3 gained an as-built addendum and §7 a `D8b` row. **(2) the portrait rail's NATIVE-ONLY zero-height collapse** — `masterRowPortrait` flips the master row to a column, so `masterBarFill`'s `flex:1` becomes `flexBasis:0%`+grow on the HEIGHT axis inside an auto-height parent: Yoga has no definite main size to distribute, the bar measures **0 pt**, the iPad shows no rail, while react-native-web keeps the intrinsic 34 px (which is why every web screenshot passed). Fixed by `masterBarFillPortrait: {flexGrow:0, flexShrink:0, flexBasis:'auto'}` applied ONLY under `isPortrait`; landscape byte-identical, and the guard pins `flexBasis:'auto'` BY NAME because `flexGrow:0` alone would leave the 0 % basis and fix nothing. **(3) chip diet**: `WORKSPACE_CHIP_LABEL_MAX_WIDTH = 168` + `numberOfLines={1}` on the shared chip (own `chipLabelCap` style, no `flexShrink` on the label so the 44 pt effective target holds), a pinned `›` overflow hint whose ONE decision was extracted to the PURE module as `shouldShowBarOverflowHint` (6 vitest cases — unmeasured, fits, the measured 904-in-831, at-end, rubber-band overscroll, sub-pixel epsilon) rather than left as an untestable `.tsx` predicate, the perf caption moved OUT of the scroll content to a pinned ellipsizing slot (still exactly ONE, still `PERF_PARAMS_CAPTION`, full sentence in a11y), C4 gap 8→12 and C5 padding 4/2→4/4. No new dependency. **(4) the `_263` lock reaches the mixer with ZERO new acquire sites — VERIFIED BY GREP, not trusted**: `PanResponder.create` exists in 7 files repo-wide and the only mixer-reachable ones are `HorizontalFader` (all four mixer render sites, incl. LOCAL PARAMS via the shared `ParamRow`) and `hue_wheel`, both locking since `_263`; `NauticalFader` is dimmer-rack-only, `split_playlist_panes` deck-only, `TimerWheel` a FlatList. Exactly three hosts became `LockableScrollView` — the channel-strip row (count-based `scrollEnabled` preserved VERBATIM), LOCAL PARAMS (`nestedScrollEnabled` kept), the COLORS card — with guards counting open AND close tags (3 each) and asserting mixer.tsx never touches the lock itself. **MEASURED (before → after):** long-title chip **349 → 220 pt** total and its label **296 → 168** ellipsized with the index prefix intact (`2 · AMBIENT GOLDEN HOUR C…`); fresh landscape bar **904-in-831 overflow → 1068-in-1068, none**; the COLORS chip from a **38 pt sliver at rightEdge 1423 on a 1366 screen** to **95×28 pt at rightEdge 1079**; the perf caption from **hard-clipped at the fold (`…MID…`)** to **262 pt whole, right 1350 < 1366, pinned OUTSIDE the scroller**, ellipsizing (223 of 262) only at a forced 380 px viewport; the `›` hint present at 777-in-799 and 465-in-799, absent at 1068-in-1068; every chip 28 pt tall. **Deck parity proven**: 8 deck chips, labels 25–75 pt (longest `PARAMETERS`), **none truncated**, scroller 1112-in-1112 — the cap is more than double the widest deck label. Web host parity: strip 1254-in-1420 with `scrollLeft` 0→120, LOCAL PARAMS 112-in-288, COLORS 605-in-1087 with `scrollTop` 0→60; the only console noise is the pre-existing React **#418** hydration warning, reproduced identically on untouched routes. **TWO DEVIATIONS, reported not hidden:** the caption cap shipped at **280** because §4.3's literal 260 is 2 pt UNDER the caption's measured **262.36 pt** intrinsic width and would have ellipsized it at EVERY viewport (the guard pins the property as *>263 and ≤320*, not a bare number); and **C3 was NOT implemented** — the card-header title is an editable `TextInput`, on which RN's `numberOfLines` is a multiline/Android prop that does nothing to a single-line field on either platform, so the rider as scripted would have been an inert line that merely looked like a fix (backlogged with C6). Matrix row 6 (RESET) has no mixer UI affordance — `useMixerWorkspace.reset` is unwired — so it is pinned at the reducer level instead of screenshotted. Suite **104 files / 2265 pass / 0 fail** (+1 file, +41 tests over the 103/2224 baseline), owned failing list EMPTY; tsc clean; **0 lint errors in every touched file** (the repo's 10 standing errors are all in the untouched `scripts/osc_synth.mjs`). Scratch stack only — dist :7184 (fresh 8.3-short-path export, mtime verified), engine :17984 from a config copy with sACN to 192.0.2.x, OSC/fire-sync/web_client off, `MARSIN_STATE_DIR` redirected; live 6966-6972/:6981 never bound, :6967/:6968 answered 200 before and after, both scratch ports FREE after teardown, `marsin_engine/states/` mtimes unmoved, nothing exported into `CaptainPad/dist`. **NEEDS the operator's device round — two acceptance items are NATIVE-ONLY** (the portrait rail actually rendering and the lock's feel; web can prove neither): 3-step checklist at the tail of `_275`. No engine restart; **CaptainPad rebuild required**. | Opus `_208`+`_211`+`_213`+`_217`+`_225`+`_243`+`_252`+`_254`+`_267`+`_270`+`_274`+`_275` shipped; R3 next; docs/63 CLOSED (decision 14 CLOSED by `_274`) except the operator's two open levers (drop the entry sub-label → 7 rows at 11", or dedup the 78 px per-pane chrome); **docs/64 CLOSED** — open for the operator: confirm the COLORS-never-yields ruling, and clear the two stray test channels; **docs/67 CLOSED** pending the operator's native round (portrait rail + lock feel), with C3 + C6 backlogged |
| **Timeline authority + passcode** | `_200` LANDED: resume/lease-expiry force-disarm Live Touch (even mid-ARM), every disarm auto-resumes the plan, plan-disable is total (cues die instantly, no auto-restart, restart-safe, invariant comments in code). `_201` LANDED: CaptainPad per-attempt passcode prompts (all 4 takeover affordances). `_202` IN FLIGHT: same prompt on the sim-served Live Touch ARM surface. Live behavior ACTIVE since the 2026-08-14 launcher restart. `_226` DESIGN READY (`docs/56_principal_scoped_persistence.md`): principal-scoped persistence — auth-on engine boots INTO perf mode; perf exit takes a per-attempt passcode whose principal becomes the ONE engine-global edit session; only `owner` opens auto-saves; sailor sessions edit live with playlist/settings file-writers 403'd and the deck-flush backlog skipped; exit `keep-save` owner-only. **`_228` SHIPPED (W1-W8):** all of the above is live — `editSession.principal` + `principalMaySave()` in `effectiveAutoSave()`, boot-lock with a post-restore pre-show snapshot (capture failure = fatal), the session check replaced by per-attempt `verifyPrincipalPasscode`, the D7 exit matrix, the sailor backlog skip (perf mode deliberately excluded so the owner exit-ask survives), 403 `EDIT_PRINCIPAL_READONLY` at all eight explicit writers, `POST /edit-session` for escalation/handover, and on the pad: `editPrincipal` + a new engine-stated `authRequired`, the passcode exit sheet, the amber `SAILOR SESSION — LIVE, NOT SAVING` chip, and the locked idiom on playlist CRUD. Three defects found while validating and fixed: the exit sheet was unreachable on a fresh boot-locked engine (it demanded a session no pad has yet), `_emit()` silently swallowed every escalation broadcast (principal-only change), and the chip clipped "NOT SAVING". Engine failing list = the `_226` baseline exactly + new `principal_scoped_persistence.test.js` 9/9; CaptainPad 1498/1498 + `tsc` clean; disk hash unchanged across a sailor session and changed under an owner one; S1-S10 captured. **The operator's :6968 engine has already picked this up and is boot-locked.** Open (one-liners, operator nod): named-artifact authoring stays sailor-open; edit sessions have no timeout. **`_250` SHIPPED — offline escape hatch:** the perf⇄edit switch now works with the engine DOWN (`resolveLocalViewOverride()` local override, refused-by-throw while connected so the engine stays authoritative live), and CONFIG is visible in performance mode (`config.showInPerformance: true`, with STUDIO/MIDI/OSC cards flipping alongside it per the `_232` invariant); `settings_state.yaml → bootMode` toggle picks edit-vs-performance boot. Follow-up open: EditSessionChip can show a stale session offline with a dead tap-target. **`_283` SHIPPED — the escape hatch MOVES to the exit, and playlist switching opens (operator, 2026-08-16):** REVERSES `_250`'s CONFIG-in-perf — `config`/`studio`/`midi`/`osc` go `showInPerformance: false` (CONFIG is a setup surface; the perf rail is now DECK · MIXER · LIVE TOUCH · EVENTS), which is only safe because the EXIT now works with the engine dead. The offline exit MECHANISM was already there (`_250`); the break was that BOTH the rail and `performance_route_guard` computed `!ready || active`, and offline `ready` never arrives on its own — so a pad booting against a dead engine was LOCKED with no CONFIG, its chip read idle “PERF” so the first tap went the WRONG WAY, and the guard's `!ready ⇒ null` made a `/config` deep link a PERMANENTLY BLANK screen (a latent `_250` gap). Severed with one shared `performanceNavigationLocked()` (`if (engineOffline) return active` — online byte-identical and still fail-closed) plus an offline exemption in the guard: engine dies mid-show → ONE tap to CONFIG; cold boot against a dead address → ZERO taps. PROVEN by killing the engine mid-show: noticed in 26 ms, **UI exit 329 ms**, no hang, CONFIG screen actually MOUNTS. Second ask in the same wave: playlist CHANGING is open during a show on deck + mixer — `POST /deck/playlist` and `POST /mixer/channels/:id/playlist` left the 409 table (safe: `saveAllState()` is already a no-op while live so it writes ZERO bytes, nothing is structural, and `captureLook()` carries the binding so RESTORE returns the pre-show playlist); playlist CRUD, `/secondary` binding, both captures and overlay playlist stay gated, and the library modal hides duplicate/delete/NEW behind a `SWITCH ONLY` caption. New pure `playlist_access_logic.ts` splits `selectable` from `editable` — `persistLocked` deliberately OUT of `selectable`, or the feature would have worked on the bench and failed on the playa. **CaptainPad rebuild + ENGINE RESTART required.** | Fable (design) → **Opus SHIPPED (`_228`, `_250`, `_283`)** |
| **Native-first CaptainPad** — iPad native app first, web second | **Operator order 2026-08-15** ("make sure captainpad is a ipad native app, then web browser!" — drive until verified on the physical iPad, minimal feature/UI drift). `_251` (Fable, explicit operator ask) audited the whole app and wrote the contract `docs/60_captainpad_native_first.md`: exactly TWO web-bound renderers exist — the extracted `pixel_view_paint.ts` painter (PIXELS window + 9 mixer bands) and its `<canvas>` host — plus Live Touch's iframe embed; everything else (2D Simulator, Audio tabs, the whole data plane after `_246`) is already native-clean. Port path: @shopify/react-native-skia 2.2.12 (pinned for Expo SDK 54, runs in Expo Go), SkPicture via Reanimated shared value with zero React on the frame path; Live Touch via react-native-webview 13.15.0 (already installed) with a transport object in `touch_control_theme.js` (four embed touchpoints keyed on `window.parent !== window`). **`_252` (Opus) IN FLIGHT** implementing it, web pixel-parity gated; ends with the docs/60 §8 10-item physical-iPad checklist = the operator's round-2 test gate. **`_252` SHIPPED:** Skia paint target beside the canvas one (parity test replays the pre-port painter call-for-call — 21/21 identical), Live Touch native WebView transport in `touch_control_theme.js` (iframe path byte-compatible, native path installs `__captainpadDeliver` before theme-ready), refusal cards deleted in the same change that makes native draw; suite 1861/0, tsc+lint clean; web regression proven on a fresh dist (PIXELS, 9 mixer bands in the `_243` perf envelope, themed Live Touch embed). One device-only risk flagged: Hermes may lack global `atob` (~15-line decoder fix if pixel surfaces come up dark). Needs Metro restart + fresh Expo Go load (new native module resolution) — rides the gen-7 bounce. **2026-08-15 late: COORDINATOR IS HANDS-ON** — operator hit a launch error on the physical iPad; coordinator switched from pure-manager to direct tech support for iPad bring-up (operator order), other agents continue in parallel; compaction back to manager mode afterward. **`_261` (Opus) — FIRST ON-DEVICE DEFECT OF THE PORT, FIXED:** the operator could not use Live Touch at all — an opaque, touch-swallowing "HANDING BACK TO DECK" curtain covered the whole pad on entry. Two native-only halves: the AppState background release (a rule docs/47 wrote for a browser, "while the iframe and WebSocket are still alive" — iOS suspends both on resign) raised the full-pad NAVIGATION curtain unconditionally and then waited 30 s for an acknowledgement that cannot arrive until the app is active again; and the WebView transport reported `true` for `injectJavaScript` calls into a page that had not installed `__captainpadDeliver`, so the pending release hung instead of failing fast. Fix: `handoffCurtainTarget` (curtain is navigation-only; background releases run headless, still acknowledged, still loudly timed out) + `canDeliverToNativePanel` (readiness raised by theme-ready, cleared by every `onLoadStart`/RETRY). Guard test fails 3/6 on pre-fix sources; suite 1963 pass with an empty owned failing list; web parity re-walked on a fresh dist (:7157) — A3 identical to `_252`, plus a real background release round trip with the panel acknowledging and the curtain in 0 of 80 samples. Client-only, no restart. **`_262` (Fable) — Live Touch DECLUTTER DESIGNED** from the operator's live-iPad orders → `docs/65_live_touch_declutter.md`: measured baseline (audio strip 134 px, 8 of 11 spatial controls inert-but-full-height, XY pad CLIPPED 130 px in landscape, portrait pattern picker crushed to 34 px, portrait wheel an ellipse); design = mode-scoped spatial rows with deck-style suppression captions, drawHelp behind ⓘ, VIEW toolbar → one chip, palette slots → 32 px chip row, single-line scheme buttons, round wheel, audio strip 134→~52 px + hideable as a no-floor `AUDIO` rail citizen (additive `bm26_touch_layout_v2`, docs/63 grammar parity), portrait 2-row topbar; W0–W5 for Sonnet×3 + Opus walk with transport grep gate; 6 D-points at defaults. **`_268` (Opus lead + Sonnet×3) — DECLUTTER SHIPPED:** all of docs/65 W0–W5 at the six D-defaults, touching only `touch_control.html` (499 lines) + `touch_control_wire.js` (11) — theme.js zero, verified against a frozen wave-start snapshot. Measured embedded (real gruvbox tokens over the theme bridge), both iPad viewports: audio strip **134→54 px**, **the XY pad stops being clipped** (landscape frame 170→319 px, `Y−` label moving from off-frame to inside it), sp-controls 134/148→61, drawHelp →0 behind ⓘ, wheel **185×320 ellipse → 320×320 round** in portrait, slot column→chip row, scheme buttons 2 rows→1, portrait topbar 2 rows with the **pattern select 20 px→438 px**, landscape topbar **byte-identical**. Transport gate 4/4, acceptance 14/14, persistence 4/4 (old v2 store hydrates byte-identical; the bar never counts toward `MIN_OPEN`), docs/61 narration intact; panel suites 59/1 unchanged from the pre-wave verdict, wider sim sweep 2086/7 with all reds foreign. The walk caught two defects the implementer's own green gates missed — the dock chevron overlapping the 9th card's value, and deleting `.sig-sub` collapsing the name track it had silently propped open (**all nine signal names truncated to `mic…` in portrait**) — both fixed and re-verified. Open, operator's call: opening ⓘ help re-clips the landscape pad 18 px; overlay it like the VIEW toolbar (zero flow height) if unwanted. No engine restart, no live service touched. **`_271` (Fable) — RECURRING "PIXEL VIEW UNAVAILABLE … stale against cameras.yaml" KILLED AT THE SOURCE + iPad ERGONOMICS CONTRACT:** root cause = every camera-preset save staled a fingerprinted input of the Live Touch artifact and only `/save-pixel-map-views` (`_223`) re-exported; the save server now OWNS the derived artifact (`refreshTouchPixelViews`: boot + `/save-cameras` + `/save` + `/save-model` + `/save-pixel-map-views`), exporter idempotent-by-content with a `--out` test seam, gate unweakened (export failure ⇒ old artifact stays, refusal copy now names the remedy), 9/9 new regressions + browser proof both directions on scratch :17969; artifact regenerated on disk so the operator's current red screen heals on reload, save-server triggers activate on the next sim restart. Then `docs/66_live_touch_ipad_ergonomics.md`: measured 151-control audit of the post-`_268` panel at the 11" viewports — **150/151 controls under 44 pt** (ARM 32 pt, ON TIME pills 10 px wide portrait), two 11"-only P1 defects 12.9 validation never saw (portrait meter strip balloons to 420 px dead space; groups clip mid-column), W0–W5 + 5 D-points for the standing pipeline. **`_272` (Opus lead + Sonnet×3) — iPad ERGONOMICS SHIPPED, docs/66 W0–W5 at all five D-defaults, ONE file (`touch_control.html`; every other `docs/ui` file byte-identical to wave start):** the acceptance instrument had to change first — docs/66 §1 measured *boxes*, but the doctrine is hit-region≠visual-size, so W0 built an embedded harness that ray-casts `elementFromPoint` outward from each control at 4 viewports × BOTH spatial modes (DRAW/INK are inert in XY by design), making the true baseline **240 gated / 30 passing**, not 151/1. **44 pt PASS: landscape 1194×834 30→84, portrait 834×1194 30→134, both 12.9" 39→105.** Both P1 defects fixed at their one-line causes (a `.panel{min-height:420px}` floor catching the bar-tier strip → portrait strip **420→54**, dead 374→8; `touch-action:none` beside `overflow-x:auto` on the groups bank → `pan-x` with zero gesture change + fade and live "N more ▸"). One-up stacking (D2) won portrait pad **230→618/clip 0**, wheel **124→312**, FOLLOW NOTE 354→742; landscape wheel 153→**243**, pattern select 71→**161**, ARM/TAP/scheme all to **44**. Transport 4/4, state walk 12/12, persistence 4/4 run by the lead, panel 93/94, sim 2039/2047 (reds all foreign). Six corrections the walk sent back, four found after "done" — incl. BPM −/+ hit regions OVERLAPPING (boundary tap did the opposite action), `.fader-lock` going off-fold inside an `overflow-y:hidden` bank (now visible at BOTH 11" viewports; ruling: **visibility beats the floor**), and the lead's OWN misdiagnosis — an 80 px strip was the correct audio-dead height ("waiting for audio…"), and the defensive `max-height:56px` added in response was clipping that message; clamp removed, caption re-homed as an overlay. **Residuals share one cause: 1194×834 is height-starved because D2 kept landscape two-up** (groups column 64×~240 px cannot stack 4 controls at 44 plus a fader — ON shipped a true 44 on all 24; effects cell 43.75 px so LVL is ONE pixel short; INK 38; pad clip 47 — the other three viewports clip 0). **NEXT ACTION — OPERATOR DECISION: should landscape 11" also go one-up?** Portrait took it and went 30→134; landscape reached 84 and still clips. Every defect this wave found was invisible at 12.9", so the 11" viewports belong in every future UI wave's matrix. | Fable design (`_251`) → Opus **SHIPPED (`_252`)** → coordinator hands-on device bring-up → Opus **`_261` on-device fix** → Fable **`_262` declutter design** → Fable **`_262` declutter design** → Opus lead + Sonnet×3 **`_268` DECLUTTER SHIPPED** → Fable **`_271` artifact self-heal fix + docs/66 ergonomics contract** → Opus lead + Sonnet×3 **`_272` iPad ERGONOMICS SHIPPED** — awaiting one operator call (landscape one-up?) |
| **Live Touch production overhaul** — spatial-first, ambient backgrounds, deck colours, per-scene presets | **W1-W4 SHIPPED (`_288` shell+engine, `_289` panel). F2 CLOSED. Only F6 remains.** Design `_284` = `docs/70`. **Proof 1/14 -> 22/22** both docs/66 viewports. F2, the operator's central clutter complaint: portrait pad moved from starting **68% down (below the fold) to 26%**, legacy wheel **160,728px2 -> 0** (docked), landscape pad **81k -> 163k**. 44pt hit-region failures **40/81 -> 0/0**, still 0 after 22 controls were added (0/168), box census FLAT — `::after` overlays only, `_268` pad budget intact. After-shots `~/tmp/live_touch_impl/shots/after_289/`. **`_288`:** W1 shell (SPATIAL boots via `data-mode` — ordinal in FIVE places, not the two docs/70 named; POOL->INVERT label-only; residue deleted; F1 header fixed; DRAW/INK/TAKE real pill chrome; BRUSH cluster; audio rail `LOW`/`DOM1 FREQ`+Hz) + all three engine slices (W2 `{playlist,entryId}`+`applyEntryDefaults`; W3 the colour fan-out — armed Live literally could not see the daemon; W4 `live_touch_preset_manager.js`, atomic, autoSave-independent). **`_289`:** W2 picker 3 -> 37 options (BACKGROUNDS + INSTRUMENTS; `label:null` on all 34 so names are humanized; params never fetched); W3 three `data-color-card` daemon cards, client Scriabin DELETED (one note->colour authority), LEGACY COLOR docked via markup only (no version bump, no force-dock); W4 engine-backed preset playlist + D10 migration proven exactly-once. **THREE CONTRACT CORRECTIONS:** F1 is NOT in CaptainPad (no header chrome there) so W1 needed no rebuild; `PUT /layers/live_touch/pattern` has NO 409 precondition to preserve; all 34 `ambient.yaml` entries have `label: null`. **HAZARDS CAUGHT:** a ~10-min LIVE INVERSION (`docs/ui/` is served live to the iPad); the acceptance gate itself measured the wrong thing (`getBoundingClientRect()` cannot see `::after`, would have forced the exact `_268` regression) — now `union(box, ::after)`; and both colour panels initially shipped docked, leaving NO colour surface. **Gates:** engine contract 33/33; simulation panel 68/1 (pre-existing); CaptainPad 2336/0 + tsc 0; live_touch 21/21; state 128/128; colour-autopilot 122/122; ws_connect_replay 5/5; security PASS; all pins byte-identical. **ENGINE RESTART REQUIRED** (the `_288` slices; `_289` adds no engine code). **NO CaptainPad rebuild.** A panel reading "Presets store error" is CORRECT until that restart — fail-loud, not a bug. **ONE DEFERRED CHECK:** the live preset create->rename->reorder->delete->reload round-trip needs the restarted engine (~2 min); refused mid-arm because a bench-mirror was relaying real sACN. **NEXT: F6 only** — contracted as `docs/70` §10 by `_290`, implements as `_291` (PLAY/EDIT grammar; D17 curation is a separate operator-blessed data pass). | Opus lead (`_288`, `_289`) → `_291` for F6 |
| **App-wide text selection** — the drag-selects-everything annoyance | **SHIPPED (`_277`; Fable design `_276`, contract `docs/68_app_wide_text_selection_kill.md`, W1–W5 at the D1–D7 defaults, no veto taken).** Cause was react-native-web giving RN `<Text>` no `userSelect` on web (computed `auto`), so every caption was selectable DOM text — the COLORS dial's gesture armor was already correct and got **zero** changes (`touch-action` governs pan claiming, never selection). Fix is one web-only seam: NEW `CaptainPad/app/+html.tsx`, a faithful expo-router stock-shell replica carrying `html,body { user-select/-webkit-user-select: none; -webkit-touch-callout: none }` plus the `input,textarea,[contenteditable="true"]` text/callout counter-rule; `html,body` NOT `*` (D2) so every element-level opt-in keeps winning with no specificity fight. `docs/ui/touch_control.html` took two CSS lines (callout kill on `body`; `user-select:text` on `.pc-label[contenteditable="true"]`, closing the latent caret hazard the page's own global `none` had created) — no markup or script moved, embed transport pins untouched. A committed guard (`components/html_shell_selection_guard.test.ts`, 16 tests, mutation-honest across 7 mutations) asserts the kill AND the counter-rule **together** so nobody can delete the caret guarantee and keep the kill; it must live under `components/` or the vitest globs never run it. **Proof — A/B on ONE export** (baseline copy with only the style block stripped): deck caption `user-select` auto → none, body auto → none, same 500 px drag **52 → 0 chars**; config field caret + Ctrl-A `selStart 0, selEnd 7`; the Studio editor's three acceptance behaviors on the REAL editor (drag-select 31 chars, shift-arrow `selEnd 5`, Tab via `execCommand('insertText')` 10048 → 10050, `selStart 2`); both deliberate `selectable` error Texts computed `text` — the app has NO clipboard API, so selection is its only copy path. Style in **29/29** exported HTML files. Gates: CaptainPad **105 files / 2281 pass / 6 skip / 0 fail** (+1 file, +16 tests = the guard), `native_gesture_armor` **37/37** (proves the dial was never touched), tsc + eslint clean, engine `touch_control` contract tests **29/29**, zero security findings on the three touched files. Scratch stack only (dist :7186/:7187, engine :17968 black-holed to TEST-NET-1 192.0.2.x); live :6966-:6972/:6981 verified answering before and after, `CaptainPad/dist` never written, all scratch ports free after teardown. **NEXT ACTION — CaptainPad rebuild required** (the shell exists only in a fresh export); no engine restart. **ONE OPERATOR CHECK:** `-webkit-touch-callout` is WebKit-only and invisible to headless Chrome, so D5 needs the iPad — long-press a caption (nothing) vs long-press in a field (paste menu survives). **Observation, not in scope:** `SIMULATION_PORT` is hard-pinned to 6969 (`utils/simulation_url.ts:10`), so the 2D Simulator embed derives the LIVE sim port regardless of api_base — a real trap for scratch harnesses. | Fable design (`_276`) → **Opus lead + Sonnet×2 SHIPPED (`_277`)** |
| **Deck transitions** — deterministic playback + gallery oracle | **CLOSED / OPERATOR-APPROVED (`_245`).** Root failure was a Deck “crossfade” implemented as non-convergent `blend_screen`, then hidden by a universal 97% full-buffer cut that could pop every transition. The repaired path has one authoritative 15-mode catalog; Morse Blink is retired; every retained script owns its complete exact A→B curve; `trans_crossfade` is real; incoming B is zero-seeded and parked; handle+phase promote atomically; stale handles are refreshed; invalid modes/blends/durations/state and manual overlap fail loudly with no visual substitute. Manual overlap returns `EBUSY`, autopilot skips the beat visibly in logs, and Timeline serializes swaps. Real-WASM Titanic oracle: 964 pixels, non-binary RGBWAU, blue Baby Keel → pink Baby Keel; strict gallery 15/15, `p0OpenCount=0`, A/B residual 0, max completion excess 0.311184 RMS, `tailCut=false`; focused 54/54 and extended deterministic 221/221 green. Operator reviewed the gallery and says transitions look good. Durable evidence: [`../reports/202608/20260815_245_deck_transition_debug_audit.md`](../reports/202608/20260815_245_deck_transition_debug_audit.md) and `docs/pattern_gallery/transitions/index.html`. **Open only:** live/HIL playback was intentionally not exercised; `trans_ripple_in` and `trans_wave_sweep` retain artistic parameter-tuning debt, not mechanics/continuity debt. | Transition Debug — archived after debrief |
| **Infra/stack babysitting** | Coordinator runs `node launcher.js dev --scene titanic --no-launch` + persistent crash monitor (benign lines filtered: mood-stale, mirror-stuck). Restarted 2026-08-14 on operator order (new playlist pickup + bench sequence realign + `_200` activation). Known live behaviors: bench mirror sticks on model reload while armed (watchdog names it; restart+re-arm is the cure); pixel-view edits require the Live Touch export rerun (done 2026-08-14). **2026-08-15:** launcher rebuilt with real prod/dev profiles (`_245` + addendum: prod = static CaptainPad dist via `tools/static_web_server.cjs`, sim 2d_pixels profile, sACN priority 150; dev = Metro hot-reload, priority 120; `CI` deleted from child envs; runtime LAN-host detection for Expo Go with `--lan-host`/`BM26_LAN_HOST` override — plus a coordinator hot-fix where the `{host,source}` detection object was passed whole into `REACT_NATIVE_PACKAGER_HOSTNAME` and killed Metro). Stack now **gen-6** (engine/sim/CaptainPad/companion all verified 200; Expo Go manifest serves the LAN host). `_246`: CaptainPad `apiBase` auto-derivation (AsyncStorage override > served-host/metro-host-derived :6968 > `config.yaml`, CONFIG names the winning source) — kills the loopback-default iPad trap. `_247`: README rewritten as the on-playa ops guide (install, per-service launch, prod/dev diff table, `--no-launch`). Coordinator also serves a **:7175 static dist mirror** for stable iPad testing beside hot-reloading Metro :6967. **Gen-7 bounce queued** for `_248`'s engine changes (picks up `_243`'s D5 mask too); bench-mirror arm-marker check first per standing order. Open mystery: iPad Expo Go derived the correct engine address yet showed engine-offline + streaming aborts (firewall ruled out) — discriminator pending: Safari-on-iPad against the engine `/status`. **GEN-7 IS LIVE IN PROD PROFILE (2026-08-15 late, operator order "test the prod env"):** static dist on :6967 (freshly rebuilt with `_252`), sACN priority 150, 2d_pixels sim, engine carries `_248` follow-note + `_253`/`_254` crash fixes (follow-note PATCH probed 200). Native iPad path = interim Metro on **:6981** (cache-cleared; iOS bundle build proven 200 after the stale-Metro `TypefaceFontProvider` failure — file existed, Metro's map predated the Skia install). **Second real `_245`-era bug found + coordinator hot-fixed in `launcher.js` `startChild`:** with `shell:true` on Windows, spawn args are joined UNQUOTED, so the prod static server's absolute paths (user dir contains a space+apostrophe) shattered into tokens and the first prod boot crashed at the captainpad child; args containing whitespace are now quoted (needs a regression test — follow-up). Also surfaced at boot: engine resumed a stale Performance lock (preserved by design), and 3 `playa_default` timeline authoring warnings (`c_sunrise`/`c_burn_night`/`c_temple` are kind:program with no `autopilot` block — deck would freeze for the hold; pattern-side, operator/curator domain). Teardown lesson recorded: stopping the launcher's shell task orphans all four children on Windows — they were killed by exact PID; port_cleanup/runbook should absorb this. **LIFECYCLE DESIGN READY (`_256`, Fable → `docs/62_service_lifecycle_and_upkeep.md`, operator order):** launcher becomes the ONE way services run — `shell:false` for node children (kills the unquoted-spawn class structurally; hot-fix verdict: right direction, quote helper survives only for the expo child, hardened + mutation-tested), sentinel reaper `tools/launcher_reaper.cjs` for abnormal launcher death (stragglers structurally impossible), `stop`/boot reap = lock ∪ port holders through the ARM-interlocked `killPid` — **review found launcher's own `killStaleListeners` currently BYPASSES the F7 bench-mirror interlock** (priority fix), `--with-native-pad` makes the :6981 Expo Go Metro a supervised child with a dependency-fingerprint auto-`--clear` (stale-Metro class self-announcing), **:7175 mirror RETIRE**, new `rebuild-pad` subcommand + prod-boot stale-dist warning, cadence table W-C3. Awaits operator nods D1-D6 (defaults recommended) + Opus implementation (W-A, W-B parallelizable; W-C after W-A). **W-A LANDED (`_260`, Opus, on defaults D1+D2):** node children spawn `shell:false` (real pids in the lock — the live gen-7 lock was proven to hold four cmd.exe WRAPPER pids, none of the processes actually on 6966-6969), `windowsShellQuote` survives only for the expo/npm shims (throws on `"`/`%`), lock gains `stackPorts`/`resolvedChildren`/`reaperPid`, one shared `reapStaleStack` (lock ∪ ARM-interlocked port sweep) behind both `stop` paths and the new detached `tools/launcher_reaper.cjs` sentinel, **the F7 interlock bypass is closed** (all launcher port-kills through `portCleanup.killPid`; `-f`/prod force NOT forwarded as an interlock override; duplicate helpers deleted; `-f` takeover tree-kill now refuses over an armed mirror), runbook `.agent/ops/stack_lifecycle.md` (three sanctioned stops). Suite 50/50 with 3 mutation checks verified; 7 foreign scene/pixel-order reds reported not fixed. **Needs the next launcher bounce to activate** — rides the pending gen-7/engine restart. **W-B + W-C IMPLEMENTED (`_266`, Opus):** the Expo Go Metro is a launcher child — `--with-native-pad` on a static profile adds `captainpad-native` on the new `captainpad_native_port: 6981` (in `stackPorts`, in the lock, a `status` row, torn down with everything else, `exp://<lanHost>:6981` printed at boot), REFUSED BY NAME with exit 2 on an expo profile (one Metro per project), both Metros sharing one env contract (CI genuinely deleted, bundle host a plain string). The stale-Metro class is dead at the root: a dependency fingerprint (package-lock + npm's installed-tree marker) drives `expo start --clear` when it changed, keeps the cache when it did not, and REFUSES the boot when the lock is newer than the installed tree (tonight's phantom Unable-to-resolve), naming `npm install`. `node launcher.js rebuild-pad` is now the ONE dist-refresh path — expo's own web:build with CI deleted, in place, success proven structurally (index rewritten this run + entry-bundle name printed), no restart needed (static server reads from disk, HTML no-store), and SERIALIZED against another rebuild / any expo export on the box / a warming Metro, because parallel exports corrupt the metro cache (`_259`). Prod boot WARNS (never refuses, D6) on a dist older than CaptainPad sources. Cadence table + :7175 retirement landed in `.agent/ops/stack_lifecycle.md`, README and `captain_pad_debugging.md`: engine/sim/companion ⇒ bounce (arm-marker first); **prod CaptainPad-web ⇒ rebuild-pad + iPad reload, NO bounce**. 76/76 pass (+26; all 50 W-A green — a mid-session red was a FOREIGN session squatting the 78xx scratch map and cleared on its own, proven meanwhile by a clean run on free ports), 3 mutation checks RED-then-restored. **docs/62 is now fully implemented; every D1-D6 default taken. Activates at the next launcher bounce.** **2D PIXELS PROD SURFACE — BOTH iPad DEFECTS FIXED (`_265`, Opus):** the "dark ghost ship" behind the 2D pixel map was an EDGE-triggered headless latch (`animate.js`) losing to an UNCONDITIONAL `canvas.style.display = ''` in `split_layout.js` `placeCanvas`, which `applyLayout()` runs on every window resize — so any iPad rotation/layout settle re-showed the full-window 3D canvas still holding the last unlit frame, and the latch never took it back. New `src/core/canvas_visibility.js` is now the single authority (the layout ASKS, the profile VETOES) and clears the framebuffer on hide; both callers go through it, and leaving `2d_pixels` still restores the 3D view. The "empty Lighting Controls menu" was NOT profile design: `gui_builder`'s `innerWidth <= 768` `gui.close()` closed the lil-gui ROOT whose `.title` this panel hides, leaving a 330×848 panel with 1103 controls in the DOM and 0 rendered and no way to reopen — removed (the drawer already auto-collapses below 800 px), plus a new `profile_capability_notice.js` so a contentless panel NAMES the profile instead of going mute. Sim suite 2409/2399 pass, 9 foreign reds reported. **Reaches the live surface at the next sim restart / hard reload.** | coordinator + Fable design (`_256`) → Opus W-A (`_260`) + W-B/W-C (`_266`) — docs/62 COMPLETE |
| **Pattern/playlist work** | Operator + curator assistant, on top of the running stack. Coordinator keeps hands off pattern files, playlists, scene state. | operator + curator |

## Threads — previous wave (2026-08-05)

> **CURRENT STATE (2026-08-05):** the `_121`–`_148` waves are COMMITTED and
> pushed (`70bc617b`, `d6234cf9`, `948447e9` on `feat/bm_readiness`). The
> `_149`–`_173` wave is LANDED IN THE WORKING TREE, **uncommitted** — held for
> the operator's physical smoke + separate commit authorization. Operator
> actions open: restart launcher+engine+CaptainPad dist; **retune brightness**
> (raw-DMX fix makes the ship read darker at the same sliders — MASTER slider
> is the tool); bench-mirror re-smoke (`_156` §9); ×2.55 A/B (`_170` §6); fog
> button on a fog-equipped scene; pick the mic once in CaptainPad AUDIO.
> Full leftover/backlog table: `_172` §b. Ops detail: the tracker (canonical).

**✅ LANDED 2026-08-04/05 (working tree, uncommitted):**

| # | Thread | State |
|---|---|---|
| `_149` | **Golden Hour read-only pilot dossier** — full control/instrument audit; 3 of 10 controls dead, 46 s loop, proposal + 4 open artistic decisions | Artifacts in `~/tmp/golden_hour_dossier/` only (read-only constraint; no repo report). Control cleanup policy-authorized, implementation NOT yet |
| `_150`–`_152` | **Bench mirror runtime mode (v2)** — audit → implement → adversarial review ×2 cycles; process-memory arm, socket-scoped auto-disarm, blackout-hold invariant | Superseded by v3 below; the falsification-hardened regressions carry forward |
| `_153`/`_154` | **Physical-failure root cause** (bench showed random colors): the sACN-IN sim tab was a priority-150 second writer through the separate :6972 output bridge; fixture profiles verified compatible 344/344 — mapping was never wrong. Flicker addendum: per-poll-phase compose tearing + same-CID sequence beats | Both CONFIRMED-OFFLINE with byte evidence; fixes landed in `_156`/`_170`/`_171` |
| `_155` | **Selectable-mapping design (Fable)** — v3 sidecar = slots only; all plumbing resolved from scene data at ARM; same-fixtureType compatibility; armed = bench-only (operator ruling) | Design + amendments implemented by `_156` |
| `_156`/`_158` | **Bench mirror v3** — ARM/DISARM + fixture picker in the Controllers-view header; armed = ship dark, bench is the ONLY physical output; per-slot "none" = held dark; cadence fix (1 whole frame per engine frame, no tearing); loud STUCK/sequence-offset diagnosis; adversarial review cycles closed (gate proof → later retired by `_171`) | READY FOR PHYSICAL SMOKE — **operator re-smoke required** (first pass was pre-fix build) |
| `_157` | **sACN stack review (Fable)** — 12 defects ranked: ×2.55 percent clip (fixed `_170`), shared CID 98/100 drop, dead arbitration, silent receiver drops, unauthenticated surfaces | Fix plan §11; S-D5/S-D3/S-D4/S-D8/D10 still unpicked (backlog) |
| `_159` | **Disarmed-path inertness review** — mirror OFF = routing byte-identical to pre-mirror code; 16 hostile sidecars can't perturb relay; no arm/gate survives restart; 2am recovery ladder proven | **INERT-CONFIRMED, zero defects** — the operator's core worry does not reproduce |
| `_160` | **Titanic scene playa review** — scene data + route table CLEAN (38 universes → 18 controllers, 0 anomalies, parity strict PASS, headless-proven); 3 operational blockers found | stop-freeze FIXED (`_169`); dim boot state = operator-ruled intentional (retune via MASTER after `_170`); ×2.55 FIXED (`_170`); sim-tab writer FIXED (`_171`). Open: 45/72 dead playlist entries, `capture.device` (fix `_173` + one operator pick), LED board pushes, live checks list |
| `_161`–`_166` | **Test-coverage campaign** — 2 Fable gap catalogs (32 specs) → 2 Sonnet implementers (+258 tests, sim 2007 / engine ~2796, zero new failures) → 2 Opus reviews with mutation testing (57 mutations, 54 kills) | Both ACCEPT-WITH-FIXES; small test-debt list in `_172` §b. Sonnet distrust NOT borne out (1 vacuous test in 258) |
| `_167` | **Engine HTTP crash fix** — one bad GET killed the whole engine (unauthenticated LAN); same-shape audit fixed **19 routes** incl. `/mixer/param-presets` | Fixed + 16 regressions; applies at engine restart |
| `_168` | **CaptainPad MASTER dimmer slider** — one slider drives all 24 groups (absolute; readout = mean); same per-section POST path; loud on failure | Landed, screenshot-verified on :7167 dist; is THE retune tool post-`_170` |
| `_169` | **`stop` blacks out before killing** — engine `/shutdown` route + launcher bounded-wait; loud `BLACKOUT NOT CONFIRMED` if unprovable | Landed; applies at next stack start |
| `_170` | **Raw-DMX wire fix** — the ×2.55 percent-payload clip is gone on every lane (engine/relay/mirror), 256/256 identity proven ×3 | **SHIP READS DARKER at the same sliders — retune required.** Bench A/B recipe in §6 |
| `_171` | **Browser out of the routing path** (operator architecture ruling) — sACN-IN tab transmit deleted (kills the tab-switch freeze + second-writer collision); fog rehoused to engine `POST /fog` deadman; :6972 forward path + gate machinery deleted (one-writer now structural) | Landed; fog needs one physical test on a fog-equipped scene (titanic patches none) |
| `_172` | **Wave oversight sweep (Fable)** — cross-report contradictions, unclosed loops, final numbers | **No issues in landed code**; leftover table §b is the backlog of record; `dirty_probe.yaml` residue deleted by coordinator |
| `_173` | **Audio companion state fix** — test-spawned companions were connecting to the LIVE engine and persisting `device: test` (hardcoded config path ignored the isolation seam); fixed + tests isolated to a never-routed address | Landed. **Operator: pick the USB mic once in CaptainPad → AUDIO → SETTINGS; it sticks from then on** |

## Threads — previous wave (2026-07-31)

> Operator-requested quick-glance board. The coordinator maintains it
> on every launch/landing/ruling; one line per thread, detail in the
> Status snapshot below + the tracker + the linked reports.

> **MILESTONE (operator, 2026-07-31): the titanic is FULLY MAPPED, the
> sim works, and the 2D vis is pattern-check ready.** 🎉
> **And the ChatGPT pattern-tuning loop is LIVE** — the operator has
> started ChatGPT with the `_90` prompt, creating views and tuning
> patterns himself. Agents keep hands off `marsin_engine/patterns/**`
> unless he hands a specific pattern over.

**🔄 IN FLIGHT:**

| # | Thread | Agent | State |
|---|---|---|---|
| — | **Timeline & show planning** — the night arc, phase looks, playlist curation across the 78 patterns / 13 playlists / `playa_default` timeline | Coordinator + operator (interactive) | STARTED 2026-07-31 — operator's declared focus: "let's you and me focus on timeline and planning and having fun with that" |

**✅ LANDED 2026-07-31:**

| # | Thread | Agent | State |
|---|---|---|---|
| `_120` | **WAVE 1 W1-1 follow-up — L5 strict save-now** (the `_116` fix-7 handoff, in the shared engine core outside W1-1's 3-file lane). Owns ONLY `lib/state_manager.js` `save`/strict-path + the `saveMixerState`/`saveDeckState`/`saveGlobalsState` signatures + the save-now call site in `api_server.js` | Opus | **LANDED** — `20260725_120_wave1_strict_save_now.md`. **Root confirmed:** `StateManager.save()` swallowed the atomic-write error (warn-only), so `POST /settings/save-now`'s deck/mixer/globals branch reported a lying 200 `{saved:true}` on a failed write (CaptainPad "✓ SAVED" badge, `_115` L5). **Fix — STRICT/BEST-EFFORT split:** `save()` gains `{ strict=false }` (default warn-only unchanged; `strict:true` re-throws); the three save methods thread it; `saveAllState(strict=false)`/`saveGlobals(withParams,strict=false)` thread it; save-now calls `saveAllState(true)`+`saveGlobals(true,true)` so its (W1-1) try/catch catches a real throw → honest 500 `{saved:false,error}`. **The ~80 AUTO-SAVE triggers pass nothing → best-effort, byte-UNCHANGED** (a transient disk blip never reaches W1-1's `exit(1)` backstop → no dark ship). **The L5 lie is now an honest non-200.** **GATES:** full engine **2524/8** = the SAME known environmental baseline (audio-capture framing, OSC lifecycle/EADDRINUSE, effects_v2 layout, specialty-playlist parity — **none touch `state_manager.js`/save paths; zero new failures**). +8 new tests all GREEN: `tests/state/strict_save.test.js` (7, strict/best-effort seam) + `tests/e2e/save_now_honesty_e2e.test.js` (1, real engine: save-now→non-200 on a broken dir while a `/global-blackout` auto-save over the SAME dir stays 200 + engine survives; timeline disabled to isolate; imports `setup_config_guard.mjs`). `config.yaml` CLEAN vs HEAD; spawned engine black-holed via `MARSIN_CONFIG_FILE`, state via `MARSIN_STATE_DIR`; zero device HTTP, zero sACN, operator stack untouched; no git ops |
| `_116` | **WAVE 1 W1-1 — engine HTTP/WS/timeline crash-proofing** (Family A CRITICAL `_108` + `_109`; J1/J2 `_113`; I3 `_112`; L2/L5 `_115`). Owns ONLY `engine.js` + `lib/api_server.js` + `lib/timeline/*.js` (+ `lib/autopilot_pick.js` for I3) | Opus | **LANDED** — `20260725_116_wave1_engine_hardening.md`. **7 fixes, each a red-team repro flipped to a GREEN committed test.** **CRITICAL (`_108`) — malformed WS frame kills the engine:** classified non-fatal per-CONNECTION `ws.on('error')` in the upgrade router covers all four `/ws/*` topics + the `/` alias (the `_99` shape). **Process backstops (`_108`/`_109`):** module-scope `uncaughtException`/`unhandledRejection` in `engine.js` → log NAMED + `exit(1)` (never half-alive; W1-2 watchdog restarts the clean non-75 exit). **J1 (`_113`, P0) — `/timeline/overview` 296 s freeze:** Intl formatters cached per tz, per-day `dayTimes` injected into the per-sample resolver, + a per-(plan,day) memo on `getOverview` → 500 cues × 8 days now **~347 ms (~850×)**. **J2/L3 (`_113`+`_115`, P0, 2×-confirmed) — corrupt state silently dead:** `loadTimelineState` validates the ENTIRE persisted shape (maps+values, numerics, `mode` enum, non-object doc), THROWS naming file+field → `start()` refuses to half-run. **I3 (`_112`, P1) — non-compiling entry wedges the sequential autopilot:** picker excludes `_broken` + de-dupes ids; all three advance sites flag a deterministic compile failure + skip it (loud, cleared on clean load). **L2 (`_115`, P1) — backward wall-clock step strands the party cue:** clamp future-dated `moodSince`/`moodLastFire` to `now` → self-healing re-arm. **L5 (`_115`, P1) — failed write returns 200 {saved:true}:** timeline-state writes already throw (honest); `POST /settings/save-now` wrapped → honest 500. **HANDOFF/spawn_task:** `StateManager.save()` (`lib/state_manager.js`, shared core OUTSIDE the lane) swallows the atomic-write error → deck/mixer/globals save-now can still lie; a STRICT explicit-save path is the follow-up. **W1-3 handoff WIRED:** `/timeline/state` now carries `renderHealth` (`mixer.getNeverBlackHealth()`, guarded/additive). **W1-2 handoff:** `/status`+`/timeline/state` now report HONEST health (a corrupt-state timeline refuses to start; a clean `exit(1)` is the restart signal). **GATES:** timeline family **410/410**; full engine **2520/8** = the known environmental baseline (audio no-device, osc EADDRINUSE, mixer view-fader, pattern/scene parity, effects layout — **none import a W1-1 module; zero new failures**). New tests: `tests/e2e/ws_frame_crashproof.test.js` + 5 `tests/timeline/*` (clock_backstep_clamp, timeline_state_validation, autopilot_broken_entry, overview_perf, save_write_honesty). `config.yaml` CLEAN vs HEAD; every spawned engine black-holed via `MARSIN_CONFIG_FILE`; zero device HTTP, zero sACN, operator stack untouched; no git ops |
| `_118` | **WAVE 1 W1-3 — pattern-VM "never black" enforcement + `_90` audit-harness hardening** (Family I `_112` I1/I2/I4). Owns ONLY `lib/pattern_mixer.js` + `tools/pattern_audio_harness.mjs` | Opus | **LANDED** — `20260725_118_wave1_pattern_never_black.md`. Protects the LIVE ChatGPT loop. **The never-black model:** the vendored WASM absorbs a NaN (I1: any one arg to `rgbwau()`/`hsv()` blacks the whole pixel, absorbing in persistent state) or a `beforeRender` budget overrun (I2: truncates silently, palette never resolves → black ship) into a black composite with no signal, and the NaN is already `0` by the time JS sees a byte — so enforcement is on the CONSEQUENCE. **New runtime R4 enforcer in `renderAll6ch()`** (the exact buffer engine.js emits): counts consecutive fully-black-while-lit frames — gated by `_isExpectingLight()` so a legit operator blackout (master 0 / faders down / muted) is never flagged — and at 8 frames (0.2 s) LOUDLY trips `renderHealth` (naming the deck pattern) AND writes a dim last-resort floor (10/255) so the ship is never shipped dark without `/status.renderHealth.ok=false`; auto-recovers when light returns. Also a solid-red detector (`_112` F9 VM over-budget). **VERIFIED end-to-end through the REAL WASM** (`never_black_vm_e2e.test.mjs`): NaN-arg, absorbing-NaN, and beforeRender-overrun all compile CLEAN and trip; healthy stays green. **I2 finding (honest):** `marsin_begin_frame` is compiled `void` (confirmed: `number` binding → `undefined`; no error set) and there's no C source to re-vendor, so a truncation return channel is impossible — the mission-critical black outcome is caught by the enforcer; a wrong-but-non-black truncation is caught only offline by the harness. **I4 — the harness can now FAIL:** `--gate` mode exits 3 with a NAMED reason on DARK (fully/mostly black — fails `evil_black`), BLACK_LATCH (renders a 600-frame window past the clip — fails the `evil_sleeper` post-window latch), and OVER_BUDGET (MEAN VM frame time > budget/mix-channels, default 25/4=6.25 ms). Verdict always PRINTS; only `--gate` changes the exit code (clip/gif tooling unaffected). **Shipped patterns stay green** on titanic (worst `26_dom_dancers_chevron` mean 4.56 ms → GATE_PASS). **Operator: add `--gate` to the `_90` recipe's two harness runs.** **Suite:** +16 new green tests (7 enforcer + 4 real-VM e2e + 5 harness-gate); **zero new failures from this thread** (full run 2520/2510/10 = the 8 known baseline + 2 sibling `tests/timeline/overview_perf.test.js` J1 perf tests that PASS in isolation and are uncoupled to this work). `config.yaml` + `patterns/` CLEAN; no `engine.js`/`api_server.js`/`timeline/*`/`simulation/`/`scenes/**` touched; zero device HTTP, zero sACN. **HANDOFF to W1-1:** never-black is ALREADY on `/status` (getRenderHealth folds `darkness` into `ok`, no engine edit needed); a standalone `mixer.getNeverBlackHealth()` `{lit,black,blackStreak,tripped,floorActive,solidRed,pattern,sinceFrame,message}` is provided for `/timeline/state` + the launcher watchdog |
| `_117` | **WAVE 1 W1-2 — launcher supervision & watchdog** (Family A capstone `_115` L1/P0 + L4/L6/P2-6). Owns ONLY `simulation/start.js` + `launcher.js` | Opus | **LANDED** — `20260725_117_wave1_launcher_watchdog.md`. **The `_115` L1 dark-ship-green-dashboard gap is CLOSED.** `start.js` is now a real SUPERVISOR: every child's DEATH (crash/`kill -9`) and FREEZE (alive-but-unresponsive, 3 missed health probes) is detected → bounded restart (5/60 s) → **loud escalation** (`exit(1)` so the launcher tears down + the show-server supervisor relaunches) rather than an endless restart-loop fallback. `launcher.js status` now health-probes **EVERY child** (save :6970, sACN-in :6971, sACN-out :6972 — the two `ws` bridges via a 426-aware, census-neutral GET — not just :6969/:6968) and reads the input bridge's `packets/5s` surface for **frame-flow**, so a dark/wedged server turns the dashboard **RED** and "green" means frames are actually flowing. **L4:** `checkPortFree` now bind-probes BOTH families (IPv4 `0.0.0.0` + IPv6 `::`) — the IPv4-only-squatter shadowing is caught (repro'd, then fixed). **L6:** `validate()` now runs BEFORE the destructive `assertSingleInstance()`/`-f` takeover, so a scene typo no longer kills the show first. **P2-6:** new **`BM26_SIM_CONFIG`** override (fail-loud, same contract as `MARSIN_CONFIG_FILE`) points the whole constellation — launcher + start.js + save-server + both bridges (via `load_ports.cjs`) — at throwaway ports; `main()`/boot guarded behind `require.main` + pure helpers exported for tests. **Suite: baseline 1645/8 fail → 1663/8 fail — +6 new W1-2 tests, ZERO new failures** (same 8 known stale-model/scene-drift/compression). Live-proven: killed a child under the watchdog → detected+restarted (fresh pid); killed sACN-out → `status` line went **❌ not green**; frame-flow warned of a dark rig. Ran entirely on 786x/787x + UDP 7568; operator :6969-:6972 byte-identical (same PIDs), throwaway orphans swept, `config.yaml`/`scenes/**`/engine untouched. **Wants (flagged, not built): a census-neutral `/health` on both bridges + a frame/output indicator on W1-1's engine `/status` for continuous frame-flow supervision** |
| `_119` | **WAVE 1 W1-4 — sim save-server & controller-probe crash-proofing + save honesty** (Family A `_109` P1-1/P1-3, Family F `_115` L5). Owns ONLY `simulation/server/save-server.js` + `controller_probe_service.cjs` | Opus | **LANDED** — `20260725_119_wave1_saveserver_hardening.md`. **The `_109` P1-1 process-kill is CLOSED and the crash is now SURVIVED** (proven end-to-end: real save-server on a random high port, the exact `timeoutMs:-1` request answers a loud **400** and the process stays alive + fully functional). **Four fixes:** (1) P1-1 — probe route now VALIDATES `timeoutMs` (finite, `>0`, `≤60 s`) → 400, and `tcpProbe` registers `socket.on('error')` BEFORE `setTimeout` (the throw that used to escape a listener-less connecting socket is caught → honest UNKNOWN); plus process-level `uncaughtException`/`unhandledRejection` backstops that log NAMED and exit (no half-alive run — supervision is W1-2's job). (2) P1-3 — the "1.2 s ceiling" was an IDLE timeout a slow-drip host held 10.4 s; added an ABSOLUTE per-probe deadline (TCP + HTTP) so one slow host can't wedge the pool, plus a 256 KB response cap. (3) L5 save-honesty — every save-server write path now surfaces a NAMED non-200 on failure (was bare `Error`); proven a failed disk write answers `500 Error: …`, never `200 Saved`. (4) endpoint hardening — 1 MB body cap (413), non-object body (incl. the `null`→TypeError→kill vector) rejected 400, garbage body 400. **Suite: baseline 1645/8 fail → 1657/8 fail — +12 new green tests, ZERO new failures** (`save_server_hardening.test.js` spawns the real server on a throwaway `~/tmp` root; probe module tests for the crash-proofing, absolute deadline, overflow cap). Repro `~/tmp/redteam_controller/04_probe_crash_repro.mjs` (all green). **Test-only env hooks `SIM_SAVE_SERVER_PORT`/`SIM_SAVE_SERVER_ROOT` default to production paths when unset** (explicit config, not a fallback). Zero device HTTP (loopback + RFC 5737 `192.0.2.x` only), zero sACN, operator :6970/:6967/:6969-72 never touched; `marsin_engine/config.yaml` CLEAN |
| `_113` | **Red-team: timeline REVIEW/ZOOM machinery** — the day ribbon + `/timeline/overview`, `resolveDeckStateAt`, travel/resolve targeting, `validateShowPlan`/`lintShowPlan`, and `loadTimelineState`; adversarial hunt for stuck shows, silent coercion and review-surface lies | Opus (red-team) | **LANDED (report-only)** — `20260725_113_redteam_timeline_ribbon_state.md`. **2 P0, 2 P1, 3 P2, 5 P3. Zero source edits, zero suite edits, zero `scenes/**` writes; every spawned engine black-holed and ASSERTED (3 walls), port 7717 only, zero device HTTP; `config.yaml` CLEAN vs HEAD; timeline family 410/410 before AND after.** Deliberately complementary to `_103` (triggers/arbiter/party) and `_104` (pad zoom state machine) — it attacks the ribbon/overview cost, the state-file loader, the resolver-vs-tick divergence and target/plan input validation, and it **narrows two of `_103`'s "safe" verdicts**. **P0-F1 (stuck/DARK show): `GET`+`POST /timeline/overview` build the day ribbon SYNCHRONOUSLY on the HTTP thread in O(days × cues²)** — `buildDaySegments` calls `resolveDeckStateAt` per sample point and each call re-runs `resolveDayTimes` over the WHOLE cue list, constructing 2 `Intl.DateTimeFormat` per clock cue. Measured on a real engine: 64 cues × 8 days = **2.8 s frozen**, 128 = **11.4 s** (concurrent `GET /status` ECONNRESET), 256 = **58 s**, **512 (the schema's own cap) = 296 s** — render loop, sACN out and the timeline tick all dead, process still "alive" so no supervisor restart. One unauthenticated POST of an UNSAVED draft is enough. The 512 cap predates the ribbon (`show_plan.js:799` cites "a 10k-cue POST froze /status ~32s" — the ribbon makes 512 cost 9× that). **P0-F2 (silent dead timeline): `loadTimelineState` validates ONLY the 5 party fields** — a corrupted `firedToday: yes` / `moodArmed: 5` / a scalar document loads clean and then throws at boot or on EVERY tick (`Cannot create property 'c_x' on string 'yes'`), so the whole plan drives nothing all night while the engine looks healthy: the exact D11 failure mode the party guard exists to stop, on the fields it doesn't cover. **P1-F3: two cues at the SAME fire time — the resolver (ribbon, `/resolve`, `/travel`, boot `_catchUp`) picks the FIRST in plan order (`resolve_deck_state.js:152`, strict `>`), the live tick applies in order so the deck ends on the LAST** → the review surface built to be honest and a running engine disagree about the same instant, and rebooting flips the deck. Sharpens `_103` L3. **P1-F4: `hold.min` has no upper bound** — `{min: 1e12}` (or a fat-fingered `9000` = 6¼ days) passes validation and the program owns the deck for the rest of the festival, suppressing every later cue; `{min: .inf}` also passes and serialises to `untilMs: null`, indistinguishable on the wire from an open hold. **P2: `/timeline/travel` + `/timeline/resolve` shape-check the target date with a bare regex and never round-trip it — `2026-07-00` → 200, silently resolved as `2026-06-30`, impossible date echoed back (`assertDate` does this right 30 lines away); `validateNoOverlap` keys windows by festival-day INDEX so a `durationMin` window that CROSSES MIDNIGHT is never compared to the next day's cues (narrows `_103`'s "overlaps rejected at load"); nothing validates that a look's playlist/palette EXISTS — save 200, activate 200, `planWarnings: []`, and it only surfaces as a `cueErrors` entry at fire time (narrows `_103`'s "missing playlists fail loud").** **P3: the ribbon draws a 23 h/25 h DST day as `00:00→24:00` (tiling correct, scale ~4 % off); `sun.offsetMin` unbounded (a cue can fire on a different calendar day than the ribbon draws it); `_assertPlanName` accepts a 500-char name; `resume()` loses a same-instant race with `takeover` (self-heals at lease expiry); `mode` in the state file is never checked against {armed, overridden} (`mode: banana` and a truncated `mode: arm` both run and go out on the wire).** **What HELD:** no prototype pollution (`__proto__`/`constructor` rejected by `assertSlug`); the 512-cue cap and the 1 MB body cap enforced; a real `SIGTERM` mid-zoom at BOTH scopes wakes `armed`/`zoom:null` (boot scrub works — and re-confirms `_100` F1 / `_104` A2 that the lease bytes ARE on disk); stepping past the plan edges 400s and never clamps; polar sun safe; 33 of 43 hostile plan mutants produced a NAMED error; a 12× concurrent travel‖perform‖savePlan‖activity storm left `mode: armed`, `zoom: null`, `lastError: null`. Coordinator: F1 first (memoise `dayTimes` per day + cache the `Intl` objects in `clockToEpochMs` — either alone is ~100×; then a perf regression test with a stated budget), then F2 (extend the D11 guard to the whole persisted shape) |
| `_111` | **Red-team sweep SYNTHESIS** — consolidates the 8 adversary reports (`_103`–`_110`) | Coordinator | **LANDED** — `20260725_111_redteam_synthesis.md`. **1 CRITICAL** (malformed WS frame → dark ship, no restart), ~15 HIGH/P1, clustered into **7 families**. Engine cores HELD. **Fix plan: 3 waves, all operator-gated, none launched.** W1 = dark-ship hardening (launch first). `_109`/`_110` were UNCOMMISSIONED adversaries (verified safe, flagged). Coordinator cleared the `_105` report-IP commit blocker |
| `_107` | **Red-team: fixture / model / patch layer** — adversarial hunt across LED-vs-DMX classification, the exporter, `scene_model_parity`, orphan detection, the TE-sign RGBW generator, and the 2D pixel-map view defaults | Opus (red-team) | **LANDED (report-only)** — `20260725_107_redteam_fixtures.md`. **2 HIGH, 2 MED, 2 LOW; no CRITICAL. Zero source edits; zero writes to `scenes/**`/`models/**`/`dmx/fixtures/**`** (generator run `--dry-run` only, parity gate read-only, mutate-and-check used fabricated inputs to the pure parity lib; harnesses in `~/tmp/redteam_fixtures/`). **Both HIGHs live in the parity gate's LED lane, blind to two silent classes its DMX lane already catches. HIGH-1 (silent-mispatch, the `_92` RGB↔RGBW class RE-OPENED): an RGBW TE sign chained on a MarsinLED output configured `order: RGB` exports stride-3, white-less pixels and passes `--strict` CLEAN** — parity discards the LED-bus fixture definition's declared physical format (`channels: ledBus ? undefined`, no `channel_mode` cross-check) and trusts the controller order as sole truth, so it only fires when model & controller DISAGREE (control run: RGBW→0 err, RGB self-consistent→0 err, RGB-vs-stride4-model→2 err). **HIGH-2 (silent-DARK, `_92` patched-but-unroutable): a strand/LED-bus fixture chained on an UNBOUND LED controller (no `device:` block) with a stale patched record+model passes `--strict` clean** — parity never reads `controller.device`, has no LED analogue of DMX's `patch_record_disagrees_with_chains`, and a fresh export would drop the record and render the rope DARK. **MED-1: `checkAddressHygiene` models an LED-bus fixture as one `def.footprint` DMX block (ignores `record.segments`)** — a spilling LED-bus fixture false-positives `patch_address_out_of_range` while `checkLedStrandPatch` validates the same walk as correct, and its spill-universe occupancy is never claimed (real collision there missed); harmless for the 160/136-ch single-universe signs, latent for the extensible LED-bus kind. **MED-2: parity `ledStride()` accepts a sub-minimum stride the sim's `normalizeLedConfig` hard-throws on** → misleading `strand_stride_mismatch` on a config that never boots. LOW: te_sign `SHARED_PANEL` msg repeats per occurrence + panel-reappearance role mislabel (comment-only); LED-bus footprint never cross-checked (root hook for HIGH-1). **What HELD:** `gen_te_sign_fixture.js` (every malformed CSV fails loud; all-same-coord caught before the NaN normalization path → divide-by-zero unreachable); `orphan_fixtures.js` (strict `=== true`, ownership `groupName\|\|name`, throws on unreadable lists, no guessing); parity's DMX lane + pure re-statement; the `_48` name-drift + `TE Sign 2` swallow (covered by `pixel_map_view_defaults.test.js`, but only for SHIPPED defaults, not a persisted `pixel_map_views.yaml`). Coordinator: HIGH-2 first (one fix — re-derive LED binding grade + an LED `patch_record_disagrees_with_chains` — closes the silent-dark rope class the gate exists to prevent) |
| `_108` | **Red-team: engine HTTP/WS API contract + CaptainPad client** — adversarial hunt for engine-wedging crashes, unhandled rejections, contract lies, enum drift, write races, reconnection storms | Opus (red-team) | **LANDED (report-only)** — `20260725_108_redteam_api.md`. **1 CRITICAL, 1 MED, 4 LOW. No source touched; every engine black-holed (asserted); zero device HTTP, zero sACN to hardware; operator stack untouched; `config.yaml` CLEAN.** **CRITICAL (engine-crash, the `_99` sibling): a single malformed WebSocket frame kills the whole engine.** None of the four `/ws/*` servers (nor the `/` alias) attaches a per-connection `ws.on('error')`, so an invalid-UTF-8 text frame (or reserved opcode / oversize control frame / bad close code) makes `ws` emit `'error'` on the socket instance with no listener → uncaught throw → `process.exit`. Proven live on `/ws/control` AND `/ws/params`; no malice needed (a flaky WiFi-corrupted frame does it). **Blast radius = dark ship with no self-heal:** `launcher.js:623` does NOT restart a crashed engine — it logs "exited unexpectedly … Tearing down" and `teardown(1)`s the whole stack. **MED (enum-drift): the `effectiveState` enum is a hard engine↔pad coupling** — `parsePartyConfig` throws on any value outside the 6 known; no live drift today (producer closed to 6; all 3 pad consumers wrap the throw so no crash) but a future 7th engine state puts every older pad's PARTY card into a permanent error banner on a healthy engine. **LOW: `POST /timeline/takeover` coerces a non-object body (null/number/string/array/bool) into a silent plain takeover (200) not 400** (fallback shape); concurrent `takeover(perform)`+`travel` both return 200 (last-writer, momentary response lie, broadcast reconciles); `/timeline/resolve` over-long query → 431 empty body (non-JSON); `/timeline/resolve` matches by `startsWith`. **What HELD (the hardening works):** the entire REST surface — hundreds of malformed/OOR/unicode/traversal/`__proto__`/huge payloads → clean verbatim 400s, no 500 on input, no unhandled rejection, no silent clamp; `festival.days` bounded [1,31]; WS message handler try/caught; reconnection storm survived. Coordinator: fix #1 is the per-socket `ws.on('error')` (+ a per-topic frame-violation regression test). |
| `_106` | **Red-team: controller lifecycle / provisional / status / push** — adversarial hunt for promotion corruption, reconcile side-picks, status lies, push half-states | Opus (red-team) | **LANDED (report-only)** — `20260725_106_redteam_controller.md`. **2 HIGH, 3 MED, 3 LOW; no CRITICAL. No source touched; NO device HTTP, NO sACN to hardware, NO scene writes** (pure repros in `~/tmp/redteam_controller/` against the real modules with injected transports; operator stack untouched). **HIGH-1 (promotion-corruption): the `ip_mismatch` reconcile guard is DEAD CODE on the provisional lifecycle** — provisional cards match by IP only, and every promote path builds `device.ip` FROM `controller.ip`, so the guard its own doc says protects against "a board found at a different IP than typed" can never fire. A one-digit IP typo (or a DHCP reshuffle) makes the card AUTO-VERIFY against whatever MarsinLED answers at that address; the only catch is an OPTIONAL boardId/deviceName expectation. **HIGH-2 (quirk→corruption): the default-ON auto status-sweep re-raises the reconcile dialog every ~20 s** for an online-but-contradicted provisional card (no "dialog already open" de-dup) → dialogs stack unbounded, and once the operator resolves one the stale dialogs' "Promote anyway" calls `promoteProvisionalBinding` on a now-verified card and THROWS uncaught inside `ctx.mutate`. **MED-1 (status-lie / push-half-state): a push whose scene-SAVE fails/cancels settles the DURABLE sync chip to a GREEN "In sync"** (stale-feed warning tooltip-only), and the next `refreshSyncChips` recompute (device≡plan → bare `{state:'in-sync'}`) drops even that — disk stale, LEDs dark, every surface green (the exact _58/_60 shape). **MED-2: first contact promotes off a CACHED fingerprint** (probe cache key `type:ip`, 5 s TTL, stores `device`; auto-sweep is `force:false`) → a same-IP hot-swap binds the card to the PREVIOUS board. **MED-3: ECONNREFUSED/RST is always ONLINE** — a reject-firewall, any other host, or a DHCP squatter reads green ONLINE while a drop-firewall on the identical dead box reads OFFLINE; LED partial-200 + `unrecognized` hosts share the same green dot. **LOW: `reconcileProvisionalContact` silently skips the `controller_id_claimed` hard blocker when `registry` is omitted** (`checkedClaims:false`); the push notifies the bridge TWICE (exportConfig loud + push quiet); the 1.2 s status deadline flaps cold boards (discovery budget is 6.5-8 s). **What HELD:** two provisionals at one IP (2nd correctly hard-blocks `controller_id_claimed`), partial-answer refusal (no promote off a half `/api/status`), lost-write reply arbitration (read-back decides, never the timeout), and the G8 delete/undo-during-reboot liveness guard. Coordinator: triage HIGH-1 (gate unattended promote on a stated expectation OR a confirm) + HIGH-2 (per-card dialog de-dup + stale-dialog no-op) into fix threads |
| `_105` | **Red-team: sACN bridge / routing / subscription / bench mirror / same-address merge** — adversarial hunt for route flaps, double-writes, dropped universes, boot crashes, merge miscomposition | Opus (red-team) | **LANDED (report-only)** — `20260725_105_redteam_bridge.md`. **1 HIGH, 3 MED, 3 LOW; no CRITICAL. No source touched; no sACN frame toward hardware** (pure-module harness `~/tmp/redteam_bridge/harness.mjs`, 41/41). **HIGH (boot-crash): an out-of-range universe (>63999) in the LIVE hand-edited `📡 Subscribed Universes` field — `common.yaml` currently `1..37` — or a bad `patches.yaml dmxUniverse` bypasses the boot-list builders** (`parseSubscribedUniversesField` and `patchRecordUniverses` have NO upper-bound guard), reaches `new Receiver({universes})`, where `multicastGroup()` throws `RangeError`, which `classifyReceiverError` calls FATAL → `process.exit(1)`. **The runtime diff path buckets the same value as invalid and survives — boot and runtime disagree**, so a bad save is fine until the NEXT restart, which is dead-on-arrival with a misleading "socket FAILED" message. **MED1 (dropped-universe): a present-but-truncated `segments[]` silently drops the spill universe with NO anomaly** — the interpolation guard only exists on the empty-segments branch; the `_87` dark-pixel class one field deeper. **MED2 (double-write): bench-mirror `mirrorTargets` is built without subtracting `engineState.owned`, and `dest_host` is validated only against placeholder/broadcast/loopback, never the real controller registry** — a mirror can be pointed at an engine/sim-owned controller and become a second writer, unwarned. **MED3 (merge-miscompose): `composeUnifiedFrame` does not self-guard same-IP contested channels** (only throws on unrankable IP) and sorts before filtering by universe. **LOW: leading-zero octet folds decimal in the merge but passes raw to the socket (octal-interpretation divergence); boot gate replays only the last deferred reason; multi-NIC selection is an OS coin-flip by design (pin `sacn_interface` on the show box).** **What HELD:** the `_99` boot gate + double-join invariant (tried 3+ universes, interleaved), route-diff flap-freedom, merge intersection off-by-one at both edges, runtime subscription range + per-universe isolation, bench-mirror spec validation + activation gating, field-parser server/browser parity |
| `_104` | **Red-team: timeline ZOOM** — day/event zoom, time travel, the operator lease + scopes, the exit state machine; adversarial hunt for races, stuck states, lease leaks, ghost zooms, orphaned decks, a lying pad | Opus (red-team) | **LANDED (report-only)** — `20260725_104_redteam_zoom.md`. **1 HIGH, 2 MED, 2 LOW; no CRITICAL. No source touched; no engine spawned → `config.yaml` CLEAN vs HEAD; no `:6967`/`:6969-:6972`/device touched** (static code-path analysis + the four build reports; scratch `~/tmp/redteam_zoom/`). **The engine "never stuck" invariant HELD** — no zoom the rig can't leave (resume nulls the lease before catchUp & catches throws; the tick releases expired + self-heals orphaned leases; the boot scrub is synchronous before the first broadcast; `_goDormant` drops an expired travel lease; malformed `/timeline/travel` all 400 pre-mutation). **A1 (HIGH, silent-fallback / pad-lying): `_zoomExitRequested` leaks.** `_resume()` sets that module-level exit-claim UNCONDITIONALLY (`useTimeline.ts:171`), and it is ALSO the plain-takeover RESUME NOW (`resumeNow: resume` — deck + PlanLockBanner); it is only ever cleared by `clearZoomClaims()` on a zoom→null transition (`ZoomBanner.tsx:88`). A plain takeover has no zoom → the flag stays true → the next real PERFORM/TRAVEL zoom the ENGINE ends (lease expiry / restart / AUTO OFF / maker save) reads `ours:true` → the "Zoom ended — the plan resumed" toast + auto-nav is SUPPRESSED and the operator is silently stranded on a deck they no longer own. Inverts the exact `_97` §3.4 fix; the unit test only covers the pure `shouldAnnounceZoomEnd`, not the leaky latch. **A2 (MED): confirms `_100` F1** — the scoped lease IS persisted to `timeline_state.yaml`; only the one-line boot scrub prevents a ghost PERFORM banner on reboot (scrub ordering independently verified → latent, not live). **A3 (MED, pad-lying): the D3 "Show due: X — starts when you exit" banner keeps promising a show `_catchUp` will SILENTLY SKIP if you linger past the cue's hold**, and then EXIT (skips) vs ENABLE (fresh hold, plays) diverge. **A4/A5 (LOW): engine doesn't verify a PERFORM `cueId` is the live cue (spoofable banner); travel steppers' strict `>`/`<` make co-timed cues unreachable.** Coordinator: A1 first (it will mislead the operator on a show night), then A2/A3 honesty fixes |
| `_103` | **Red-team: timeline / arbiter / party-session** — adversarial hunt across triggers, arbiter precedence, festival/sun/tz math, cue/look/phase resolution, plan lint, and the party sustain/session/cooldown/arm-latch lifecycle | Opus (red-team) | **LANDED (report-only)** — `20260725_103_redteam_timeline.md`. **1 HIGH, 1 MED, 5 LOW; no CRITICAL. No source touched; no engine spawned (the `_93` dry-run harness runs offline, writing only to `~/tmp/timeline_dryrun/`) → `config.yaml` CLEAN vs HEAD; no `:6967`/`:6969-:6972`/device/sACN touched.** Repros in `~/tmp/redteam_timeline/`. **The trigger/arbiter/festival/sun cores HELD** — DST fall-back de-dupes, polar/degenerate sun fails safe to the defaultCue, overlapping `durationMin` windows rejected at load, festival day-gating exact + out-of-window refuses loud, missing playlists fail loud (non-fatal), zero-cue/identical-time plans deterministic, the edge-storm dwell defence works at default dwell, and the `_98` arm-latch fix is confirmed on burn night (27 sessions after the 2 h hold). **H1 (HIGH — deck-thrash): the mood→party cue has NO "I already own the deck" idempotency guard.** A detector that dips-and-returns (any music with quiet gaps ≥ the audio companion's `offConfirmMs`, default 30 s) RE-ARMS the cue on the calm dip (`triggers.js:284`), and with the SHIPPED dwell (20 s) the next loud return re-fires it while its own session is still live — the arbiter passes it (`controller==='autopilot'`, no ownership check), and `_applyAction` re-runs the whole look. `timelineLoadPlaylistOnDeck` (`api_server.js:4372`) ALWAYS loads the playlist's FIRST entry with a transition swap (no "already loaded" short-circuit), so **the exterior snaps back to party-pattern-1 with a transition on every music gap, all party night** (harness: realistic 3-on/2-off flap → 60 re-fires, 1 honest window-elapse in 5 h). **M1 (MED — silent cadence loss, same root): each re-fire re-stamps `_deckWindowUntilMs = now + durationMin`** (`timeline_service.js:845`; the :824 guard only protects the session-END bookkeeping), so a "12-min session + 2-min cooldown" collapses into ONE endless session whenever the music keeps returning — the operator's configured cadence + cooldown never run, and `sessionEndsAtMs` slides forever. **LOW: `mood` cue `from===to` validates but is a silent dead cue (never fires); a program `hold.until` an already-past anchor gives a ~zero hold (logged revert, intent silently lost); two same-time PROGRAMS both dispatch (deck double-write) and the earlier one's HOLD is silently discarded — `validateNoOverlap` only checks `durationMin`, never `hold`; DST spring-forward fires a gap-hour cue an hour late (N/A to BM dates); the dry-run harness mis-counts the `party-config` lifecycle line as a session end.** Coordinator: H1 first (idempotent re-fire no-op while the party cue already owns the live window + a `timelineLoadPlaylistOnDeck` same-playlist short-circuit) — it will visibly reset the exterior on the mission-critical party night; M1 rides the same fix (don't re-stamp the window on a re-fire) |
| `_102` | **Same-address merge with warning** — overlapping (universe, channel) claims: allowed with a PERSISTENT ⚠ warning in the mapping pane, packets unified into one per destination, conflicts resolved higher-IP-wins; IP-less/tied conflicts stay hard errors | Opus | **LANDED** — `20260725_102_same_address_merge.md`. **There was exactly ONE hard refusal** and it is now a warning: `derivePerOutputPlan`'s `universe_owned` collision, which used to refuse the push in all three consumers (single push, fleet push, sync chip). New pure module `simulation/src/dmx/address_merge.js` owns the whole rule. **Merge one-liner: overlapping claims are allowed; each (universe, destination IP) gets exactly ONE packet, and on any contested channel the numerically higher controller IP overrides.** The IP comparison is **octet-wise numeric, never string** — the pair `.9` vs `.10` is the case string ordering gets backwards, and it is `a*2**24` not `a<<24` because a signed shift makes every ≥128.x address negative. The contested region is the **intersection only** (a par at ch10–13 vs a strand at ch12–20 contest ch12–13; the strand keeps ch14–20). **Four warning surfaces:** a PERSISTENT amber card banner in the mapping pane (not a toast — the operator maps for an hour), the push/save dialog's `⚠ N SHARED ADDRESSES` block placed FIRST, the sync-chip detail/tooltip (chip stays in-sync — a share does not make the device differ from the plan), and console/fleet-push logs naming the winner. **Runtime override does not depend on render order:** the loser is told which absolute channels it must not write (index built once per projection, resolved once per pixel), including the par master-dimmer force-write. **Deliberate asymmetry kept:** an EXPLICIT operator universe may be shared, but auto-assign (repair, park) still skips every claimed universe — the sim never chooses to create a shared address. **Composes WITH the `_89` bench mirror rather than fighting it** (mirror unifies at the bridge, this unifies at the sim; `server/sacn_bridge.js` untouched, `git status` confirms). Sim suite 1592 → **1645, fail 8 → 8** (the known baseline, byte-identical list), +53 tests incl. byte-level frame composition. Security PASS (one self-inflicted finding found + fixed: a real routable IP in a test, swapped for RFC 5737). **LIVE-PROVEN with 13/13 checks + screenshots** on the operator's own sim, sACN OUT socket blocked and asserted, zero device HTTP, zero scene writes. **TWO OPERATOR DECISIONS handed back** (§4 of the report): a same-IP overlap and a no-IP overlap are still HARD ERRORS — the operator's rule ranks IP-bearing claimants only, and inventing a tie-break would be a fallback he did not ask for. **Memory amendment proposed** (§7): `sacn-route-ownership`'s flat "one writer per (universe, controller) is the law" now needs two enforcers — the bridge's suppression AND the sim's merge |
| `_100` | **Timeline zoom e2e (S5) — THE WAVE CLOSER** — a committed engine e2e suite: every exit-table row, two-client scenarios, party-vs-zoom, post-`_98` conformance | Opus | **LANDED** — `20260725_100_timeline_zoom_e2e.md`. **17/17 scenarios green**, driving a REAL engine subprocess over REST + `/ws/control`, restarted by really killing it. **The two exit paths nobody had ever exercised live are now covered: ENGINE RESTART mid-zoom (both scopes — a reconnecting pad sees the truth on its FIRST frame) and PLAN SAVE mid-zoom (the maker auto-saves; the pad is TOLD, it never asked).** Every other exit-table row too — resume, lease expiry, AUTO OFF, activate, ENABLE; the one remaining row (festival window closing) is UNIT-only for a stated structural reason: every e2e route to it short-circuits through another exit. **`_97`'s exit-race pinned e2e** — the cleared-zoom broadcast really does beat the `resume()` response, so the pad's pre-staked claim answers a real ordering. **`_98` fix 1 proved on a real engine with a real mood feed**: a party fire during a PERFORM lease is suppressed, visible, edge-only, and consumes NOTHING — it fires the instant the operator hands back. **THE `--dest` TRAP IS CLOSED AT THE SOURCE:** `MARSIN_CONFIG_FILE` now governs the engine's BOOT read as well as the autopilot write-back, so a harness can finally neutralise the per-controller `controllers:` block instead of hand-editing your tracked config (which is what `_97` had to do, and what `_98` then flagged as a commit blocker). Plus new `MARSIN_TIMELINE_DIR` — a test engine can no longer write plans into `scenes/**`. **One real bug found + fixed (B1):** the day ribbon only sampled where cues START, so a cue was drawn owning the deck for hours after it handed back — on the shipped plan it mis-stated exactly the stretch `_98` FIX 7 gives ambient. The review surface built to make the plan honest was lying about the biggest thing `_98` changed. Timeline suite 407 → **410/410**; full engine 2470/2478 (the 8 baseline, zero new); CaptainPad **914 = baseline**; security PASS; **`config.yaml` clean — nothing to restore.** Two findings reported not fixed: the "runtime-only" lease IS written to disk (only the boot scrub saves it), and entering ANY takeover stands the deck's pattern autopilot down |
| `_97` | **Zoom pad slices S3+S4** — day zoom (phase bands + resolved ribbon) and event zoom (PERFORM / TIME TRAVEL banners, snapshot steppers, D3 deferred banner) in CaptainPad, against the `_95` §3 API | Opus | **LANDED** — `20260725_97_timeline_zoom_pad.md`. The ladder is real: **FESTIVAL → DAY → EVENT**, where the two browse rungs make ZERO engine calls and only the event rung touches the rig. Day cards now ZOOM IN on tap (the old select-vs-EDIT-DAY split is gone; `DayEditor` was promoted into the new full-screen `DayView`). DAY carries **phase bands** — with `party_night` correctly drawn as TWO pieces across midnight, the one thing that would have silently blanked a night — and the **resolved ribbon** with a plain-language reason per segment. EVENT is one sheet with one action, the branch chosen by the engine (`activeCue`) **and scoped to TODAY's card** (a cue-id-only test offered "perform tomorrow's show" — caught live). Global `ZoomBanner` on every tab: green PERFORMING / purple TIME TRAVELING with `◀ ▶` steppers, EXIT everywhere, and the D3 line **"Show due: … — starts when you exit"** + ENABLE. `PendingProgramOverlay` now stands down under a zoom instead of counting down to an auto-start the engine has deferred. GATES: tsc clean, CaptainPad **914/914 (+22 new, 0 fail)**, lint clean on touched files, security PASS. **LIVE-PROVEN on a fresh :7167 dist against a real engine** (operator's :6967 never touched): day zoom on the dormant real plan, PERFORM over the deck, TIME TRAVEL over the deck, the deferred banner 4 min into a hands-off performance, stepper retargets, the boundary 400 printed verbatim (`no prev event on …`), a second client rendering the banner without auto-exiting, and the full D3 loop end to end — the deferred show was **not** dismissed, it fired via catchUp on lease release. **One real bug found live + fixed + pinned:** the engine's 1 s broadcast beats our own `resume()` response, so the operator's own tab-return exit raised a "zoom ended" alarm at the person who just asked to leave |
| `_99` | **sACN input-bridge boot crash** — `addMembership EINVAL` from the `sacn` package kills the input bridge at stack boot | Opus | **LANDED** — `20260725_99_sacn_bridge_einval_fix.md`. **Not the NIC** (joins succeed three ways on this box) — a **boot-ordering race in our own code**: `recomputeRoutes('boot')` subscribed synchronously while the `sacn` Receiver's join loop is deferred to the socket's `listening` callback **over the same array** `addUniverse` pushes into, so the universe was joined **twice on one socket** = `EINVAL` on Windows; and `sacn_bridge.js` had **no `receiver.on('error')`**, so the package's re-emit threw and killed the bridge. **Trigger: any scene patched to a universe the `📡 Subscribed Universes` field does not name** — which `_92` passed through on U38/U39, and which the pending TE-sign attach re-creates. Fixed with a **boot gate** (work held + replayed at `listening`, every deferral logged), a **classified error handler** (join failure = loud + isolated, exactly like the runtime path; any other socket error = FATAL exit), a **self-policing invariant** that hard-exits naming the racing universes, and **deterministic + logged interface selection** (optional `sacn_interface` pin; a mismatch throws with an inventory, never a silent NIC switch). Proven end-to-end by re-creating the divergence against the real bridge (`common.yaml` restored byte-clean). Sim **1590/8 fail = the baseline 8, zero new** (+19 tests, incl. 2 LIVE receivers pinning both orderings). **Stack left UP** — sim servers on :6969-:6972 + UDP 5568, pinned `titanic` (input bridge verified receiving 1168 pkt/5 s from `MarsinEngine` while the engine was still up). **`launcher.js prod` was REFUSED by the permission gate** (blocked-by-classifier) and not worked around; it had also been held off earlier because `prod` force-claims `:6968` and would have killed `_97`/`_98`'s engine. :6966/:6967/:6968/:7167 are all down now, so **`node launcher.js prod --scene titanic` completes the prod shape in one command** — it absorbs the running sim servers, nothing to stop first. Note `marsin_engine/config.yaml` is clean vs HEAD with a real `10.x.x.NN` Titanic host, so that start puts engine frames on the wire |
| `_98` | **Timeline bug-fix wave** — `_93` bugs 1–5 + `_95` F1 + G1 conformance (hold expiry → ambient) | Opus | **LANDED** — `20260725_98_timeline_bugfix_wave.md`. Engine-side only; **zero `scenes/**` writes**. **Burn night + 8 h of music: 0 sessions → 27** (a suppressed fire now consumes NOTHING — no arm latch, no cooldown; `wouldFire` went edge-only). **Quiet night: `ambient` 0 h → 12 h 20 m (51 %)** — a hold expiring naturally hands the deck to the ambient `defaultCue`, palette reset included (G1 fixed at runtime AND at boot AND in the ribbon; `source:'hold-expired-baseline'` is gone). A restart mid-hold now cycles (`ap OFF` → `ap 90s seq`). An ambient cue can no longer wipe a live program's look — the burn show keeps all 120 of its minutes. The background phase look **returns after every session** instead of being evicted for the night (0 h 40 m → 7 h 04 m). `_95`'s `clobberedByBootBaseline` pin **flipped to assert-the-fix**. Timeline suite 387 → **407/407**; full engine 2449/2459 (8 pre-existing + 1 flake + 1 from a concurrent thread's `config.yaml` edit — since RESOLVED: it was `_97`'s deliberate black-hole, restored at its landing and coordinator-verified byte-clean vs HEAD). **Fix 4 verdict:** program looks with no `autopilot` block are now a LOUD authoring lint (`planWarnings` on `/timeline/state`), not a throw — the shipped plan **trips it 3×** (`sunrise`, `burn_night`, `temple`) and still loads: **your plan edit**. **`whenPhase` restoration remains operator-gated** |
| `_94` | **Timeline zoom DESIGN** — day zoom + event zoom (perform / time travel) | Fable (operator-named) | LANDED + ACCEPTED (D1–D8 as recommended, "do them") — `20260725_94_timeline_zoom_design.md`; build wave running as `_95` (landed) / `_97` / `_98` |
| `_96` | **Optional-discovery lifecycle + controller status** — typed-IP provisional binding patches everything with the board OFFLINE; first contact fetches the board's data + promotes (loud reconcile on mismatch); plus per-controller ONLINE/OFFLINE/UNKNOWN dots (parallel server-side probes, MarsinLED = HTTP never ICMP) | Opus | **LANDED** — `20260725_96_optional_discovery_lifecycle.md`. Lifecycle `unbound → PROVISIONAL → VERIFIED`; a provisional card patches **byte-identically to a verified one** (patches.yaml + model lanes + bridge routes + subscribed universes) and **promotion moves nothing** — both pinned. Contradiction → loud reconcile dialog, **nothing changed on either side**, two explicit choices, hard-blocked on an unidentifiable box or a fingerprint another card owns. `0.0.0.0` refuses a provisional binding (type the real IP first) and the two compose. Status: three honest states, `unknown` never rendered as offline, per-type probes (LED = HTTP `/api/status`; DMX = TCP connect where a **refused** connection proves the box is up), bounded pool + box-keyed cache, pane never blocks. **76 new tests; sim 1482→1559, fail 9 = the 8 baseline + `_92`'s in-flight parity finding (proof in §7.2); zero new.** 18/18 live checks + 7 inspected screenshots, **1 off-host request attempted and REFUSED** (the pane's own pre-existing sync-chip read). Fixed in passing: `bench_section.cjs` dropped `provisional` from the mirrored block, which would have written a file the loader refuses. **You: restart the stack once (page + save-server route), then type the three rope IPs → ⚑ Patch without the board → Save** |
| `_89` | **Test bench = titanic stand-in** — bench pars/vintage/bars/LED strings show the ship's LEFT FRONT while the engine runs titanic | Opus | LANDED — bridge-side **bench mirror** (`20260725_89_test_bench_titanic_standin.md`). **ZERO device pushes, zero gateway edits.** You: restart the launcher, then run the sim pinned `--scene test_bench` with the engine on titanic |
| `_90` | **ChatGPT pattern-tuning prompt pack** — paste-ready self-contained prompt (pattern API, MFT/param-order hard rules, geometry + `FIX_*` targeting, style doctrine, response contract, harness-verified example) | Opus | LANDED — doc-only, `20260725_90_chatgpt_pattern_tuning_prompt.md` |
| `_92`+ | **TE signs → LED correction (URGENT)** — remove the DMX placeholder; signs become mappable **LED** fixtures on MarsinLED outputs | Opus | **LANDED** — ADDENDUM in `20260725_92_te_sign_patch_model_fix.md`. `TeSigns-PLACEHOLDER` **deleted** (controllers 17→16), all four sign patch records dropped, U38/U39 unsubscribed. New **LED PIXEL FIXTURE** kind: a `parLights` fixture whose definition says `bus: led` is now LED end-to-end — LED tray (not DMX), LED per-output addressing, `type: 'led'` model pixels, strand-shaped patch record. Data-driven (`bus`), so **`fixtureType` strings never changed** → every `te_sign` selector and the `_48` add-2 one-panel-per-sign guarantee are intact. **LIVE PROOF:** pane reads `UNMAPPED — 0 FIXTURE(S), 4 STRAND(S)` with the four 💡 sign chips, no PLACEHOLDER. Caught 2 latent bugs (identity lost on unmap; split LED output gate). Sim **1571/8 fail = the baseline 8, zero new** (+12 tests). **Parity now 4 errors — the 4 unmapped signs, ON PURPOSE:** you attach them to a MarsinLED output running **RGBW / stride 4 — the same setting the rope outputs already use** — and it goes green (side A 160 ch + side B 136 ch = 296 ch, one sign fits one universe). ⚠ **CORRECTED 2026-07-31** — this row first said *RGB order*; the operator: *"sign is also RGBW, same lights as the ropes."* Definitions regenerated RGBW and renamed `model_a_160.yaml` / `model_b_136.yaml`; no byte-level bug (stride always came from the controller), suite 1590/8 = baseline, parity unchanged at 4. Sim servers only, engine never started; `_96` files untouched |
| `_92` | **TE sign patch + model rebuild (URGENT)** — 4 reported defects; rebuild the sign pixel model from the fresh Fusion CSVs | Opus | **LANDED** — `20260725_92_te_sign_patch_model_fix.md`. All 4 confirmed + fixed. **`scene_model_parity titanic`: 21 errors → 0, RESULT PASS** — the titanic scene is now fully patched. Sim suite fail **10 → 8** (zero new; both titanic scene-drift pins went green). Signs on a `0.0.0.0` PLACEHOLDER controller, U38 (sign 1) / U39 (sign 2); sign 2 renamed `TE Sign 2 V3 A/B` → distinct sId 415 / fId 2204-2205. Model regenerated by the new `simulation/tools/gen_te_sign_fixture.js` (points identical, **wire order** changed). **Zero device traffic; no engine restart needed** (pixelCount unchanged, hot-reloaded) |
| `_91` | **Show infrastructure audit** — timeline mechanics, theme-night support, party-trigger chain, playa time + postpone, 68×13 coverage matrix, testability; GAP LIST + proposed test plan | Opus | LANDED — read-only, `20260725_91_show_infra_audit.md`. **Machinery strong (317/317 tests), the SHOW is not**: 6 of 8 reachable looks load `default`, which is 62% dead entries + 92% untuned; 9 of 13 playlists unreachable. "Ambient only" PARTIAL, "VJ stand-down" + "postpone" MISSING. **First build: a timeline dry-run harness** |
| `_93` | **Timeline dry-run harness** — `timeline_dryrun.mjs`: real plan + real TimelineService on an injected fast clock + scripted mood; minute-by-minute night narrative, suppressed-fire log, session lifecycle; works while the plan is dormant | Opus | **LANDED** — `20260725_93_timeline_dryrun_harness.md`. `node tools/timeline_dryrun.mjs --fixture` (or `--date <in-window>` for the real plan) prints a whole playa night in seconds, offline. Confirmed G1/G2 + the daylight party fire; **5 NEW bugs, report-only** — worst: a *suppressed* party fire burns the arm latch, so 8 h of music on burn night gave **0 sessions** (35 on a normal night). Engine timeline suite 317 → **340/340**; both `_91` fix-on-sight items done |
| `_95` | **Zoom build S1+S2 (ENGINE)** — pure `resolveDeckStateAt` + `GET /timeline/resolve` + overview `phases`/`segments`; lease scopes perform/travel + `POST /timeline/travel` + `zoom` broadcast + D3 cue-deferral | Opus | **LANDED** — `20260725_95_timeline_zoom_engine.md`. **`_catchUp` refactor proved BYTE-IDENTICAL: 1116 boot+resume+savePlan scenarios vs `HEAD`, 0 diffs.** Timeline suite 340 → **387/387**; full engine suite 2434/2442 (8 pre-existing/environmental, zero new); **19/19 REST checks** against a real engine + the real `playa_default`. **S3/S4 build from `_95` §3 (the API surface).** Day-zoom ribbon now shows the shipped plan's truth on the wire (`c_sunrise` owns 07:53→18:49, `c_visibility_on` owns 20:34→midnight). D3 deferral is scoped strictly to zoom leases — a plain takeover keeps the I2 30 s auto-start byte-identical. Travel works while the plan is **dormant** (the rehearsal case, `_91` #16). **2 pre-existing engine truths surfaced + pinned, NOT fixed: F1** boot-baseline clobber (catchUp restores a non-program cue, then the baseline reloads over it — invisible today only because every look points at `default`), **F2** `_91` G1 now visible as `source:'hold-expired-baseline'` |

## Operator test checklist (2026-07-31 wave — tick as you verify)

> Operator-requested: "keep track of a set of things for me to learn
> what you did and test as much as I can." Each item: what to do → what
> you should see. Deep detail in the linked report.

**Controller pane (reload the sim page first):**
- [ ] **Status dots** (`_96`): every controller card shows ● ONLINE / ○ OFFLINE / ◌ UNKNOWN; pane never freezes waiting on a probe.
- [ ] **TE signs → LED** (`_92`+): four 💡 sign chips in the UNMAPPED LED tray; DMX list has no PLACEHOLDER. Map them: attach to a MarsinLED output, **output color order = RGBW — operator correction 2026-07-31: the sign pucks are the SAME RGBW lights as the ropes** (the `_92` report's RGB claim was wrong; verification thread running), Save → `scene_model_parity titanic` goes 4 errors → 0.
- [ ] **Provisional binding** (`_96`): on each rope controller (the 3 unbound ones) type the real IP → **⚑ Patch without the board** → Save. Expect: patches/routes exist immediately, card shows PROVISIONAL, flips ✓ VERIFIED on its own when the board first answers.
- [ ] **Reconcile dialog** (`_96`): if a board disagrees at first contact you get a two-choice dialog, nothing auto-picked.

**Timeline (engine running):**
- [ ] **Dry-run a night** (`_93`): `cd marsin_engine && node tools/timeline_dryrun.mjs --fixture` — whole night, minute by minute, party sessions + suppressions explained. Try `--list-moods`.
- [ ] **Burn-night fix** (`_98`): same harness, `--mood all_night` on a festival day — sessions fire again after the burn hold (was 0 all night).
- [ ] **Ambient-dominant** (`_98`): quiet-night run — ambient playlist owns ~half the day; no `hold-expired-baseline` source anywhere.
- [ ] **Plan lint** (`_98`): `/timeline/state` → `planWarnings` names 3 looks needing autopilot blocks (`sunrise`, `burn_night`, `temple`) — your yaml edit.
- [ ] **Zoom e2e, one command** (`_100`): `cd marsin_engine && npm test` (or `node --import ./tests/helpers/setup_config_guard.mjs --test "tests/e2e/*.test.js"`) — 17/17, ~2 min, real engines on throwaway ports with sACN black-holed and asserted. Run it after ANY timeline change.
- [ ] **Ribbon hand-back fix** (`_100`): in DAY zoom, a program cue's ribbon row now **stops at its hold end** and the ambient default cue takes the rest — it used to be drawn owning hours it had already handed back.

**CaptainPad (fresh dist or your Expo):**
- [ ] **Day zoom** (`_97`): tap a day card → OPEN DAY ▸ — phase bands (party_night wraps midnight as two pieces) + "what actually plays" ribbon with a reason per segment.
- [ ] **Event zoom LIVE** (`_97`): tap today's active cue → green PERFORMING banner; drive the deck; a due show says "starts when you exit" and fires on exit — never steals mid-performance.
- [ ] **Time travel** (`_97`): tap an inactive event → purple TIME TRAVELING banner, ◀ ▶ steppers; back to the timeline tab exits and resumes truth.
- [ ] **Two pads** (`_97`): second client shows the banner, doesn't get kicked, can't fight the writer.

**Stack & bench:**
- [ ] **Prod bring-up** (`_99`): `cd simulation && node launcher.js prod --scene titanic` — boot log shows the interface inventory + subscriptions held until the socket listens; no EINVAL death.
- [ ] **Bench mirror** (`_89`): sim window pinned `--scene test_bench` while engine runs titanic → `🪞 BENCH MIRROR ACTIVE` in the bridge log; bench plays the ship's LEFT FRONT (Auditorium pars, Front Rails, Front Wall bars, port-rope heads). If strands stay dark: one Push on the Titanic_202 card in test_bench (revert push, the only one).

**Your config edits owed:** `whenPhase: party_night` back on the party cue · 3-line autopilot blocks ×3 (lint above) · roof-edge par row patching · `.60` one-push · smokestack margin (27).

**⏸ WAITING ON YOU (full list in "Waiting on the operator" below)**

| # | Action | Why |
|---|---|---|
| 23 | **Hard-reload the sim tab** | One reload picks up the whole day: dot scale (`_74`), live halo knob (`_75`), per-fixture Halo × (`_77`), knob relabels (`_78`), sorted menus (`_80`), red gating (`_81`), the halo-pool leak fix (`_82`) |
| — | **Check the roof-edge par row's patching** | `_78` measured only 8 of 40 pars patched — you believed that row was mapped. Since `_81` they render DARK rather than red, so the gap is quiet instead of loud: it is still real and still yours to close |
| 15 · 18 · 22 | **`.60` card: expect ▲ Drift (normal), ⬆ Push ONCE** | One push re-parks output 3 off U23, completes the timed-out write's save+notify, and doubles as acceptance step 1 (`_71` §6) |
| 3 | **Titanic re-export + engine restart** | Clears the standing 8 stale-model suite failures AND the 2 operator-scene drift pins in one sim-save + reload |
| 17 · 19 | Live acceptance run (`_63` §3) · gamma W-preset veto (`_65`) | The `_58` wave is unit-proven only until 17 runs once on hardware |
| 27 | Top-Down compression margin (`_84`) | Nudge the Left Small SmokeStack generator x outward, or retune the pin — one more inward nudge tears a side of the view |

**✅ LANDED TODAY (2026-07-30):** the `_58` push/save wave S1–S5 complete in
code; port→output mapping (`_70`/`_71`); reboot-aware push timeout (`_69`);
LED gamma sliders + live curve (`_64`/`_65`); 2D edit-tab persistence
(`_66`, layout committed `b8b8bca5`); the halo family — fixture scale-up
(`_68`/`_73`), the dot-scale bug (`_74`), one global knob for every bus
(`_75`), per-fixture `Halo ×` (`_77`), the not-a-colour-bug verdict (`_78`),
the independent double-check (`_79`), red gating (`_81`) and the
60-slot SpotLight leak (`_82`); orphan badges + one-click removal (`_76`);
generator move carries its fixtures (`_83`) + Fable sanity PASS (`_84`);
tray layout (`_85`); `📡 Subscribed Universes` auto-sync (`_86`); and
**`_87` — zero restarts for mapping changes**. Security sweep `_67` cleared
the commit path; the whole wave was committed and pushed as **`3246deb2`**.
Suite ends the day at **1452/1442/10** (8 known stale-model + the compression
tripwire + operator-side scene drift — zero new all day).
Full detail: reports `_47`–`_87` and archive `_88` §1–§2.

## Status snapshot (read this first)

**Orientation for any reader:** reports live in
`../reports/202607/20260725_N_*.md` (N assigned centrally; the ledger and the
most-current campaign state are in `.agent/memory/bm_readiness_thread_tracker.md`
— that tracker is canonical, this doc is the program board). **Next free
report: `_95`** (`_89`–`_94` are taken). Everything this doc used to carry in long form is in
archive `_88`; each section below names the archive section that holds its
history.

**Scheduling (operator rule, 2026-07-28):** dated deadline/schedule planning
lives ONLY in `.agent/reports_local/` — gitignored AND deploy-excluded.
Tracked docs record what and why, never when-by.

**Standing orders in force:**
- **NO deploys to titanic-ext** — operator develops locally and deploys
  himself. (Remote is one deploy ahead-and-consistent with local through
  `_26`.)
- Operator runs his own Expo/Metro on :6967 — agents never touch it;
  CaptainPad verification happens on `:7167` dist builds.
- **Controller firmware work PAUSED** (flash requires USB per unit); the HTTP
  config API is the supported path for controller settings.
- **White-pattern residual work PAUSED** ("colored patterns look good") —
  diagnosis + ready-to-go fix plans on file in `~/tmp`; resume only on an
  explicit ask. The RGBWAU→LED colour path is operator-ACCEPTED.
- **Commits are operator-gated.** The readiness wave WAS committed and pushed
  on operator order 2026-07-30 — **`3246deb2` on `feat/bm_readiness`** (441
  files, reports `_47`–`_87` included), plus a follow-up removing a stray
  0-byte tool-residue file. The tree is clean apart from the ledger files
  (this doc, the tracker, and today's reports). Next commit still needs his
  word, and a passing `python scripts/security_check.py --staged` first.
- **Operator is LIVE-MAPPING real DMX/LED controllers** (since 2026-07-29):
  all agent browser work runs readonly-guarded (no saves, no output-enable
  touches, sACN OUT socket blocked, short sessions); `simulation/scenes/**`
  and the models are operator-owned. The one exception on record is the
  operator-ordered coordinator scene fix of 2026-07-30 (Decisions log).
- **Scene configs may carry controller IPs** (operator ruling 2026-07-30):
  the security checker already tolerates them, and the redaction convention
  applies to `.agent/` prose, not scene data. `.agent/` files stay redacted
  (`10.x.x.60` style) — the `_67` sweep's convention holds.
- **Doc standing order (2026-07-30):** a doc contradicting verified
  code/hardware behavior gets fixed and cleaned up on sight
  (`.agent/memory/doc_inconsistency_standing_fix.md`).
- Some LED evidence deliberately lives OUTSIDE this public repo in `~/tmp`
  (colour/white reviews, controller debug transcripts) — an operator privacy
  rule for external-hardware detail; this doc carries only BM-side facts.

## Operator requirements (verbatim intent, 2026-07-27)

Headlines only — the full verbatim section, including the settled party
session model, is archive `_88` §4.

- Somewhat autonomous fixture; "we have a freaking strong base."
- **Party detection** must be calibrated and proven ON PLAYA; default
  operation is a preplanned program of playlists. Sustained party audio
  (~2 min) starts a ~10–15 min session. Must NOT catch music from across the
  playa. **Party only fires while a timeline plan is active and NEVER
  overrides a human operator** (human > operator disable > automation).
  Division of concerns: the companion configures DETECTION, the CaptainPad
  TIMELINE tab owns HANDLING, the engine owns the persisted `/party-config`.
  Session model shipped as specified (sustain always on; duration toggle,
  OFF = follow-the-music with the companion's `offConfirmMs` as the single
  release sustain; cooldown default 2 min, clock from session END).
- **Pattern pass:** manually test ALL patterns, tune speeds + defaults, record
  the tuned results as playlists.
- **Show program:** a couple of planned party moments; the rest ambient, with
  a party playlist triggered by detection.
- **Hardware:** test the smokestack rope LEDs; test the TE sign.

**Show-behavior refinements (operator, thinking out loud, 2026-07-31):**
- **Party auto-trigger fires from AMBIENT only** — an automatic party can
  only interrupt ambient operation, nothing else.
- **Parties are gated to SHORT sessions** (consistent with the settled
  10–15 min session model above); **ambient is the most important aspect
  most of the time — occasional party**.
- **Party night is VJed** — a separate human-driven setup; probably **no
  trigger cue at all** on those nights (automation stands down).
- **Playa time in the app** — the timeline should reason in playa-local
  time, and the operator wants the ability to **postpone/shift** planned
  phases ("allow postponing and shit maybe").
- These are stated as things "to test and figure out" WITH the coordinator
  — infra + system testing is the current focus. **Filling and tuning
  unassigned playlists is a ChatGPT task now, not an agent task.**

## Waiting on the operator (no agent action until he moves)

Numbers are the ORIGINALS — they are referenced across the reports, so they
are never renumbered. Resolved-and-retired items **1, 4, 16, 20, 24, 26** are
archived with their full text and a one-line verdict in `_88` §3.

2. **⟳ Restart-device button** on the LED controller cards — yes/no (`_56`;
   `rebootDevice()` is dead code today and the reboot endpoint is verified).
3. **Titanic re-export + engine restart.** One sim-save + re-export clears the
   standing 8 stale-model suite failures, the 2 operator-scene drift pins
   (`_84`'s compression tripwire, `_87`'s test_bench mapping pin) and the
   parity errors. Runbook: `.agent/ops/engine_model_refresh.md`.
4. *(resolved — `_88` §3)*
5. **TE Sign duplicate fixture names** (both groups carry `TE Sign V3 A/B`) —
   pick an option from `_52` §3. It also surfaces as the push dialog's save
   step failing during the item-17 acceptance run.
6. **Clear-All test-controller checkbox** (~3 h, design in `_50`) — go?
7. **Per-selector stale-name sweep** (~2–4 h, design in `_48` Add.2) — go?
8. **Membership editing** for 2D views (~0.5 d, design in `_54`) — go?
9. **Free-placement layout mode** for edit-mode moves (`_55` offer) — go?
10. **Migrate-addresses opt-in (11b)** y/n, and ratification of the step-11
    loud refusal on individually renaming a generated fixture (`_47`).
11. **Global Pixel Size can't reach LED strands** — fold strands in, or
    relabel the knob (`_53`; this is why it crept to 5).
12. **Top-Down bar-width narrowing (17→14)** partially walks back the `_40`
    ruling on that view — veto available (`_48` Add.4).
13. **Relay to the external WiFi/Ethernet agent:** the `.60` reports **no
    Ethernet interface at all** (`_56`) — Ethernet-only may be impossible on
    that hardware.
14. **`_58` push-save scope — SHIPPED AS OPTION A (`_61`), veto still open.**
    ⬆ Push runs the FULL scene save and the confirm dialog says so up front.
    If "saves everything dirty, not just the mapping" is unacceptable, S1 gets
    re-pointed at Option B (a scoped `/save-mapping` endpoint).
15. **(with 18 and 22) — ONE push settles all three.** The `.60`'s output 3 is
    enabled on-device at U23 (LeftFrontDeck's DMX universe — a cross-controller
    collision minted by the old auto-extender; inert but armed). Expect the
    card to read **▲ Drift** the moment you open the pane: that is the landmine
    becoming visible, not a new fault. One ⬆ Push re-parks output 3 onto a
    claims-approved free universe (nothing is disabled — output 3 stays
    enabled, subscribed and dark), completes the timed-out write's save+notify
    (`_69` fixed the 5 s abort), and is step 1 of the `_71` §6 live
    acceptance: cross P1→out2 / P2→out1 and back, GET-verify no output changed
    `enabled`, then the output-4 case and the duplicate refusal. Costs one
    ~11 s device reboot and one real scene save per push.
16. *(resolved — `_88` §3)*
17. **Live acceptance run for the WHOLE `_58` wave.** Every slice is proven by
    unit tests only until this runs once on hardware. Three tests, full
    checklist + pre-flight in **`_63` §3**: (a) change one port universe on the
    `.60` card, press ⬆ Push and nothing else — expect device✓/save✓/notify✓,
    a route transition in the bridge log, LEDs following with no manual save;
    (b) a mapping-only change + 💾 Save Configuration — LEDs follow;
    (c) with the bridge WS down, a save → red toast + red sACN-IN monitor line,
    then self-heal on reconnect. Interacts with item 15 and with the TE Sign
    duplicate-name save-abort (item 5).
18. *(merged into 15)*
19. **Gamma preset W-doctrine veto (`_65`):** the sim's `2.2 sRGB` / `Punchy`
    presets hold **W at 1.0** per docs/41 §4.1(d); the firmware's own presets
    put the exponent on W too. Test-guarded as shipped — say the word for
    firmware parity instead. Related unnumbered follow-up: a verified gamma
    push still mirrors in memory only, so save the scene once after a gamma
    push until the persist slice lands.
20. *(resolved — `_88` §3)*
21. **Left Front Deck — the two taste calls that survived `_72`'s
    cancellation.** The size half is fixed (`_74`) and the unpatched-red
    rendering is now toggle-gated (`_81`), so what remains is the **U23 feed
    level**: what the engine actually sends on that universe, not how big it
    draws.
22. *(merged into 15)*
23. **Hard-reload the sim tab** — the Threads board's top row. It is the
    "regenerate the instances" you asked for: it rebuilds the pixel map and
    every instance, no runtime cache survives it, no server restart needed.
    Check the Left Front Rails heads fill their housings (`_74`) and that
    Global Halo Size moves every bus live (`_75`).
24. *(resolved — `_88` §3)*
25. **Per-fixture `Halo ×` (`_77`) — two one-liners if you want them:**
    (a) fog/haze machines show the field but have no halo to scale — hide it
    there? (b) LED-bus halos still have NO pitch ceiling (deliberate — a
    sign's halos are meant to merge); say the word if you want one.
26. *(resolved — `_88` §3)*
27. **Top-Down compression margin (`_84`, NEW 2026-07-30).** Your Left Small
    SmokeStack x-move left the smallest Top-Down collapsed band at **5.20**
    against the 5-unit compressor threshold (the guard wants ≥ 7.5) — that is
    the 9th suite failure, and it is scene drift, not code. Nudge the
    generator's x outward, or retune the pin. One more inward nudge could tear
    a side of the Top-Down view.

28. **Patch the six rope strands without powering a board (`_96`, NEW).**
    Restart the stack once (the page needs the new pane; the save server needs
    the new `/controllers/probe` route), then open 🎛 Controller Mapping, and on
    `LeftRightRopes` / `RightLeftRopes` / `RightRightRopes` press
    **⚑ Patch without the board** and Save. That writes all six `patches.yaml`
    records, the six model addresses and the six bridge routes — the `_92` §4
    darkness — with the boards still boxed. They promote themselves to
    ✓ VERIFIED the first time they answer. Same move converts the TE sign
    controller once its box has a real IP (type it over `0.0.0.0` first — the
    button refuses the sentinel on purpose).

Plus the older parked items: party `ambientFloor` calibration; the R2
pattern-tuning session; theme culling + the party-moment schedule; R4 hardware
tests; the 20-vs-40 px/strand test_bench question.

## Open decisions (Sina)

Numbers preserved. Settled items 1–4, 8 and 11 are archived in `_88` §6.

5. Pick a playa (or driveway) night for the ambient-vs-party baseline capture
   (threshold calibration).
6. TE sign test_bench mapping (`20260725_4`): agent applies via the live UI, or
   Sina maps it himself?
7. Scheduled party moments: how many / what times (rough is fine).
8. *(resolved 2026-07-27 by delegation — `_88` §6)*
9. Themed playlists: which of the proposed themes (`_88` §7) to adopt, and
   which nights get them.
10. UV spike: go/no-go after the on-fixture test (also confirm UV channel
    presence in the par inventory).
11. *(resolved — the orphans were deleted after `_76`; `_88` §6)*
12. **Live-derived 2D default views** (`_44` §5 Q2, third recurrence via
    `_51` §6): every group rename re-breaks the hardcoded names in
    `pixel_map_view_defaults.js`. Keep patching names, or derive the defaults
    from live groups?
13. **Deck playlist density at the 11" viewport** (`_267`, docs/63 §4.2 D4).
    Padding trim is spent and the ≥6-simplified floor is still 16 px short at
    1194×834 (2 rows/pane when DECK B is bound). Two structural levers, both
    yours: (a) **drop the entry sub-label** ("7 params") from the deck list —
    row pitch 66→52, which buys 7 rows simplified and lifts the bound case; or
    (b) **dedup the 78 px per-pane `PlaylistPanel` chrome** paid twice in split
    mode, the dominant term. **Your 12.9" iPad already clears every floor** —
    so this only matters if an 11" pad is in the show kit.
14. ~~**Portrait narrow-window content sizing** (`_267`).~~ **CLOSED — you
    ruled it a DEFECT and it is FIXED (`_274`).** For the record, `_267`'s
    analysis was right about the windows and wrong about the split: narrow
    secondary windows are still content-sized and still scroll inside the ONE
    region (no ScrollView was nested — that contract stands). What was broken
    is that the PATTERNS pin and that region were sized by two independent
    rules that never looked at each other or at the host. `narrowStackSizing`
    now arbitrates them, so restoring one window from all-hidden costs far
    less list (834×1194 4 → 8 visible rows, 1024×1366 6 → 10), and the
    short-stack case where PATTERNS overflowed the host and the restored
    window never appeared at all is gone. ONE thing may still want your eye
    on the NATIVE pad: the literal paint-over in your screenshot was not
    reproducible on the web dist.
15. **`light.tertiary` collision now has a second victim** (`_267`).
    `ACCENT_AUTO` and `light.tertiary` are both `#1b9e77`, so on the daylight
    palette the new AUDIO chip dot and the AUTOPILOT dot are the same colour in
    the same row. The already-identified one-line `light.tertiary → #0d5c44`
    change fixes this and the older AA finding together — worth doing now that
    two surfaces depend on it.
16. **Should SPLIT PANE 2 and DECK OVERLAYS also allow a playlist change during
    a show?** (`_283`). The operator asked for playlist changing "in the deck
    and mixer"; that shipped for the deck's primary playlist and every mixer
    channel. Pane 2 and overlays were deliberately left gated because their
    routes *bind* a pane / an overlay, which is structural. If the intent was
    "anywhere I can see a playlist", it is a small follow-up: ungate
    `POST /deck/playlist/secondary` for the re-bind case (keeping clear-to-null
    gated) and flip the two matching client gates.
17. **May the per-channel PIXELS band get SMALLER when a landscape card cannot
    afford it?** (`_285`, and the third time this has been routed to you —
    `_279` §5 and `_243` are the first two). At 1194×834 with MASTER VIEW open
    a channel card is **417 pt** and its unshrinkable controls + band need
    **411**, so the pattern list is entitled to exactly **0**. Measured: every
    other assignment makes a control unreachable (clipping the body hides the
    LOCAL PARAMS chevron; any list floor pushes MUTE/SOLO **and** TRANSITION
    off the card). The band is the only non-control surface, so either it
    shrinks or the landscape card sheds a block entirely. **docs/69 W3 takes
    the latter route** (move the edit band into the params column) and is
    expected to SIDESTEP this question rather than answer it — W3's acceptance
    now proves crush relief directly (before `283×0` with MASTER VIEW open →
    after a stated px/row number). **This decision therefore stays OPEN for
    you** (coordinator ruling 2026-08-16: no agent lowers
    `CHANNEL_EDIT_CAP_HEIGHT` without you): it is the fallback if W3's
    relocation turns out not to buy enough room, and it is the standing answer
    to "why is the landscape band this size".

## Workstreams

State + next action + owner only. **Full history for every row: archive `_88`
§5.**

| # | Workstream | State | Next action | Owner |
|---|---|---|---|---|
| R1 | **Party-mode detection + session logic** | BUILT + DEPLOYED (`_12`, `_19`); all 11 validation defects fixed and independently revalidated (`_20`→`_22`→`_23`) — sessions repeat, cooldown clocks from session END, restart-safe in every mode | Sina calibrates `ambientFloor` on playa via the companion PARTY tab capture flow. Standing rule from `_23`: use `hold`, not `durationMin`, for a moment that must not be interrupted | Sina (calibration) |
| R2 | **Pattern tuning + playlist capture**; specialty patterns (WHITE ONLY, UV spike) | PARKED for Sina's presence. Specialty patterns 60–65 sit on disk unvalidated; WHITE=AMBER lane match landed (`_26`); param-truth sweep (`_32`) measured 817 params across 125 patterns — real punch-list 73, while 137 "dead" params are dead only because titanic reports `sectionId 0` and clear when R8 lands sections. **NEW TOOL (`_90`): a paste-ready ChatGPT prompt** turns Sina's own copy-paste loop (pattern + 2D-map screenshot + ask → complete edited file) into a working tuning path that needs no agent in the room | Resume the parked agent (validation → rosters) when Sina schedules the tuning session; eyeball the 7 patterns whose amber did real work; run ChatGPT-returned files through `pattern_audio_harness.mjs` before trusting them | Sina (art) + parked agent |
| R3 | **Show program** — ambient default, scheduled party moments, detection-triggered party playlist, themed nights | Machinery DONE and now AUDITED (`_91`): sun/tz/festival math pure and DST-correct, precedence holds, 317/317 timeline tests green. **The CONTENT is the gap** — the on-disk `playa_default` is still template-shaped: 6 of 8 reachable looks load `default` (45/72 entries unreachable `summer_camp` names, 66/72 untuned), 9 of 13 playlists referenced by nothing incl. both tuned ones, `burn_night`/`temple` looks point at `default`, `daytime`+`party_low` are dead looks. Arc findings: a hold expiring lands on the autopilot baseline not the `ambient` defaultCue, and `c_party_start` owns the deck with no expiry sunset+120 → sunrise−15 (party ≈ 8 h, ambient the exception). Proposed theme table: `_88` §7 | **Dry-run harness LANDED (`_93`)** — `node tools/timeline_dryrun.mjs` reads a whole playa night back in seconds, offline, on the real (dormant) plan. It already answered §Phase 1.1 on the record and measured the arc: quiet night = `party` look 8 h 40 m and `ambient` **0 minutes**; night with music = `ambient` returns but the `party` look never comes back after the first session. **Next: Sina's arc review (§8 Phase 1.2)** with those printouts in hand, then look→playlist re-pointing (1.3), party-moment schedule (§Open 7) + theme culling (§Open 9). Also queued from `_93` §5: five report-only bugs, worst being a *suppressed* party fire consuming the arm latch | agent tooling → Sina curates |
| R4a | **Smokestack rope LEDs** — physical test | BLOCKED ON HARDWARE ACCESS | Sina schedules bench time; agent preps the test checklist (mapping, universes, patterns) | Sina + agent checklist |
| R4b | **TE sign** — physical test | BLOCKED ON ASSEMBLY | Same checklist treatment; test_bench mapping fix diagnosed (`20260725_4`), awaiting the §Open 6 mapping decision | Sina + agent checklist |
| R5 | **Autonomy & robustness** — boot, supervision, recovery, offline | STRONG BASE (deploy pipeline + supervisor + schtasks). Log disk-fill CLOSED (`_17`); VSN1 CRLF deploy-overflow fixed and MIDI attach state made first-class (`_31`) — the libuv abort's trigger environment is gone but the race itself is unpinned | **Sina, one git command:** `git add --renormalize .` (the 9 `.lua` templates are still CRLF in the tree). **Sina, step-11 sign-off** (`_30` §7 Q4): bounded launcher auto-restart on abort-class engine exits | Sina (renormalize + sign-off) |
| R6 | **Operator surface** — CaptainPad live-performance UI | SHIPPED and validated end to end: rounds 1+2 (`_11`), swap-wedge fix + hardening (`_14`–`_17`), surface trim + PARTY handling card (`_18`), adversarial validation and the D6 fix (`_20`/`_22`/`_23`), Studio-tab editor debug + fix (`_27`/`_28`) | Nothing agent-side. Needs his physical iPad for the Studio editor's remaining checks: smart punctuation, touch/magnifier caret drag, real keyboard geometry, felt Safari latency, one SAVE round-trip | done / Sina eyes |
| R7 | **LED strand tuning & mapping** — colour/white fidelity, controller onboarding | Colour path operator-ACCEPTED; white residual and firmware work PAUSED. Gamma is an operator control with sliders + a live curve and per-card / fleet push (`_25`/`_29`/`_64`/`_65`). The `_58` wave, `_71` port→output and `_87` no-restart subscription together make "map a universe → save → LEDs work" true with zero restarts | Waiting items **15·18·22** (one push), **17** (acceptance), **19** (gamma W veto). Open follow-ups: measure the strands' white-emitter colour temperature, reconcile the engine's LED controller host with the scene's, PSU/power-cap audit for the long RGB runs | Sina (eyes) + agents |
| R8 | **Titanic scene output mapping + bench section** | Phase A COMPLETE (`_34` sId/fId fix, `_35` parity validator, `_36` same-scene reload, `_37` bench-sync tool); chain-order splits + ⇄ Swap (`_42`) with the 3D chain visualisation (`_43`); the renumbering semantic was ratified by his own informed use 2026-07-29. **Phase B = his live mapping session, in progress since 2026-07-29** | Answer O1–O9 from `_33` §2 (especially the universe plan O3); do the one sim-save + re-export (waiting item 3); decide the deferred `_42` §6 items (esp. group-level "+ gen" bulk-add, which needs a yes against the 2026-06-11 no-group-add ruling); then Phase C = full-stack E2E + placeholder retirement | agents + Sina |
| R9 | **Sim render performance on the operator's box** | DIAGNOSED — NOT a code regression (`_38`): the sim was rendering on the Intel UHD iGPU (10 FPS) instead of the RTX 4090 (59.9 FPS). Visibility layer shipped (`_39`: adapter probe, red integrated-GPU banner, fire-once low-FPS error) with no auto-fallback; 2D Top-Down layout tweaks rode along (`_40`) | **The only thing still open:** Windows Settings → System → Display → Graphics → add `chrome.exe` → High performance → restart Chrome → confirm `chrome://gpu` shows the NVIDIA GPU ACTIVE. Avoid battery-saver while running the sim | Sina (setting) |
| R10 | **Generator editor UX** — select freeze, laggy move, name↔chain parity, rename hygiene | All three planned slices LANDED (`_45` select freeze 2,719 ms → ≤133 ms + cold move, `_46` parity surfaces + chimney-ring restore, `_47` rename hygiene = check-then-invalidate loudly), plus the mapping-pane and LED-menu ergonomics (`_50`/`_52`/`_55`), the Left Back Wall diagnosis (`_51`) and generator-move fixture sync with its Fable sanity PASS (`_83`/`_84`) | Operator gates only: waiting item 10 (migrate-addresses + step-11 refusal), §Open 12 (live-derived 2D defaults), and the `_44` step-17 chain-sort button + numeric bulk-add | agents + Sina |

## Existing base (don't rebuild)

- Audio companion (`marsin_engine/audio/companion/`): live capture, BPM,
  genre — sole OSC analyzer; mic recovery fixed (`20260725_7`/`_8`).
- Playlists: engine `config.yaml playlist:`, per-channel playlists in
  mixer/deck state, CaptainPad deck playlist UI.
- Autopilot + audio-reactive profiles: `autopilot_profiles_audio_reactive.md`,
  `autopilot_deck_improvement.md`, `deck_split_playlists.md` dossiers.
- Mapping/views program: `bm_readiness_mapping.md` (sub-project).
- Deploy + supervision: `deploy/deploy.py` → titanic-ext, schtasks
  `BM26TitanicStack`, verified restart-stable.

## Links

- **Archive of everything compacted out of this doc (2026-07-30):**
  `../reports/202607/20260725_88_master_doc_archive.md`
- Thread tracker (canonical state): `../memory/bm_readiness_thread_tracker.md`
- Sub-projects: `bm_readiness_mapping.md`, `autopilot_profiles_audio_reactive.md`,
  `deck_split_playlists.md`, `effect_tuning.md`
- Plans: `../plans/20260709_party_readiness_execution.md`
- Ops: `../ops/engine_model_refresh.md`, `../ops/sim_auto_checks.md`,
  `../ops/marsin_engine_auto_checks.md`
- Branch: `feat/bm_readiness` (pushed; last wave `3246deb2`)

## Decisions log

Most recent only — the full list is archive `_88` §8.

- **2026-07-29** — Standing model policy: **all sub-agents run on Opus unless
  the operator directly names another model** for a task.
- **2026-07-30** — Operator-ordered EXCEPTION to scenes-are-operator-owned:
  the coordinator manually fixed `simulation/scenes/titanic/` (5 ghost
  fixtures deleted, `Left Back Wall Generator*` → `Left Back Wall*` across
  scene/patches/views, 0 stale refs). Sticky-by-name held on his next save.
- **2026-07-30** — Standing order: doc inconsistency vs verified behavior →
  **fix and clean up on sight** (`doc_inconsistency_standing_fix.md`); first
  application `_57`.
- **2026-07-30** — Operator confirmed 2D-view framing persists to the SCENE
  (rides his save/autosave) — approved as-is, no localStorage.
- **2026-07-30** — **Commit + push authorized and done:** `3246deb2` on
  `feat/bm_readiness`, 441 files including reports `_47`–`_87`. Security check
  failed first on two full IPs in the fresh `_87` report, which were redacted
  to `10.x.x.60` before it passed.
- **2026-07-30** — **Operator ruling: scene config files (`scenes/**`) may
  carry controller IPs.** The checker already tolerates them; the redaction
  convention applies to `.agent/` prose, not scene data.
- **2026-07-30** — Operator ordered this doc compacted end-of-day, Threads
  board kept, the detail moved verbatim to a report — archive `_88`.

## Log

Every dated entry from 2026-07-27 through 2026-07-30 is archived verbatim in
`_88` §9. **New entries append here, newest first.**

- **2026-08-16 — `_287` THE LANDSCAPE MIXER CARD SHEDS ITS PIXEL BAND;
  PATTERNS BECOME FIRST CITIZEN; THE MASTER-VIEW CRUSH IS FIXED (docs/69 W3 +
  R1, Opus lead + Sonnets).** In landscape EDIT the 208 pt per-channel 2D band
  leaves the card's vertical stack for the media column above LOCAL PARAMS —
  perf's proven grammar, now the ONE landscape body shape — so the pattern list
  gets the full body height. **`_285` landed NO code and handed its crush fix
  back to W3 while disproving D7's premise** (landscape's `channelBody` is a
  ROW sized by `align-items:stretch`; the real defect is an over-subscribed card
  whose band is half of it), so shedding the block IS the remedy: `channelBody`
  515×**0 → 515×180**, playlist 283×**0 → 283×102**, MUTE/SOLO and TRANSITION
  back inside the card. Rows 1366×1024 **4 → 7** (target ≥7 ✔); 1194×834
  **0 → 3**, missing ≥4 by 3-5 pt, so **R1** was taken (44 pt rows, docs/66
  floor EXACTLY, a new `compactRows` prop threaded only from mixer.tsx so the
  deck stays identical — **one line to reverse**). Two defects found and fixed
  in-wave: the both-hidden case INVERTED (column 248 pt / playlist 90 pt)
  because the collapsed column hugged `PixelViewBand`'s header at full
  intrinsic width — fixed by hiding the view-picker + ratio while collapsed
  (**chevron never gated**) plus a shrinkable column with a 44 pt floor; and the
  band canvas sat 2 pt under its own floor because react-native-web's
  `boxSizing:border-box` let a 1 px border eat the picture box (fixed by
  compensating the border; the pinned sizing math untouched).
  `CHANNEL_EDIT_CAP_HEIGHT` NOT lowered — sidestepped by moving the band, still
  escalated to Sina. **CAVEAT: the final measurement was destroyed by a
  live-stack incident** — those two fixes, R1, the operator's
  2-layers-no-scroll order and master/perf non-regression are unit-tested but
  NOT browser-measured, and W3 has **zero screenshots**; `_287` §5 lists the
  unproven set and §10 orders the operator checklist by confidence. The
  operator's separate "3 layers, scrolling isn't working" was investigated with
  NO code change — the count-heuristic theory is disproven (`scrollEnabled`
  tracked real overflow at every boundary); a **stale build** is the likely
  cause, plausible but unproven, and his next test on a rebuilt pad is the
  confirmation. Release-safety net added (+13 tests; audit found no real gap and
  pinned the previously-unpinned guard that stops a second grant orphaning a
  held lock; no timeout/watchdog — that would be the fallback P0 forbids).
  **Two incidents, both mine, both disclosed:** a probe wrote to the LIVE rig
  (`apiBase.ts` hard-pins port 6968, so any scratch page still resolves to the
  live engine and the mixer's mount effect fired a real `POST /layers/activate`)
  — no counter-write was issued, the operator got a one-tap remedy, and the
  non-app-path-first probe rule is now in `ops/captain_pad_debugging.md`; and a
  probe passed `--config` to `engine.js`, **which has no such flag**, so the
  silently-ignored flag booted a real engine on port 6968 and **took the stack
  down** (contained in ~a minute; `config.yaml` and all show state verified
  intact; the operator's already-ordered refresh restored it). **FOLLOW-UP:
  `engine.js` must REFUSE TO BOOT on an unrecognized flag — silent-ignore is a
  P0 fallback violation that lets one typo down the show.** Gates: vitest
  **2370/0/6 skipped**, tsc clean, lint 0 errors. **CaptainPad rebuild
  REQUIRED**; no engine restart.

- **2026-08-16 — `_296` TWO-TONE PALETTE PRESETS DESIGNED (Fable →
  `docs/71`).** "That menu" = the global line's COLORS/QUEUE modals
  (`CPCControls.tsx`, one component, deck + mixer) — today they show only
  the read-only `/color-palettes` library while the wheel's saved schemaV2
  pairs live unseen in scene-owned `/color-pairs`. Ruled: expose the
  existing store (SAVED PALETTES section in both modals, QUEUE arms saved
  pairs), manage it in the COLORS window (rename/reorder/delete = client
  list surgery + the existing atomic whole-list POST, zero new endpoints),
  and close the sync gap with a `colorPairs` WS topic + connect replay (the
  one engine slice; restart batches with the pending `_283`/`_288` bounce).
  No new model, no schema bump, nothing dead to remove; apply stays
  as-if-hand-dialed on both surfaces. D1-D10 vetoable. Implementation =
  `_297` (Opus lead + 4 Sonnets), hard-gated on the coordinator git
  checkpoint + `_295`; soft after `_287`/`_289`/`_291`/`_293`. Docs only —
  no product code, no servers, live stack untouched.

- **2026-08-16 — `_286` THE PORTRAIT RAIL IS FIXED FOR REAL, AND THE LOCK NOW
  LANDS IN THE SAME FRAME AS THE GRANT (docs/69 W1+W2, Opus lead + Sonnet
  implementers). PARTIAL — W3 follows as `_287`.** W1: `_275`'s override was
  **inert** — flattening never drops a `flex:1` base, and Yoga ignores an
  explicit `flexBasis:'auto'` whenever a positive `flex` shorthand
  co-flattens, so the portrait seat resolved grow 0 · shrink 0 · basis 0 =
  **0 pt**, the same zero as `_273`, while CSS resolved it the other way (web
  passed twice, iPad failed twice) and the `_275` guard pinned the exact
  property Yoga cannot honor — **the guard enforced the bug**. Fix is style
  **SELECTION**: `MASTER_BAR_SEAT_LANDSCAPE {flex:1,minWidth:0}` (byte-equal)
  and `MASTER_BAR_SEAT_PORTRAIT {minWidth:0}` with **no flex-family key at
  all**, exported pure and selected by `isPortrait`; the trap is now
  structurally unreachable. **Rule banked: never override a `flex:N` base with
  longhands on native — select, don't fight.** The missing net: devDep
  `yoga-layout@3.2.1` (WASM of the same C++ Yoga RN vendors, dev-only) running
  the REAL algorithm in vitest — pre-`_275` **0**, shipped `_275` **0**,
  shipped seat **36**, landscape 250 of a 400 pt row; mutation-verified RED on
  both historical compositions. W2: the glitch was propagation, not
  acquisition — `LockableScrollView` gained a synchronous native-only
  `getNativeScrollRef().setNativeProps` fast path (render path byte-identical
  and still the truth, unlock restores `callerProp ?? true` via a pure pinned
  resolver, **zero acquire-site changes**); verified against RN 0.81.5 that
  `scrollEnabled` is in ScrollView's `validAttributes`, without which the
  payload would drop it and the fast path would be silently inert — the `_275`
  failure mode one layer down. Gates: vitest **2328/0** (re-baselined 2312/0
  same session), tsc clean, lint 0 errors, security clean on touched files;
  web portrait seat **912×36 = byte-identical to `_280`'s baseline**, which is
  the required result since the defect was native-only. **Deviation: the
  crush-fix substrate never existed** — that agent landed no code and handed
  the fix to W3, so W3 now absorbs the crush and will PROVE it with
  before/after numbers. `CHANNEL_EDIT_CAP_HEIGHT` untouched (still Sina's
  call). **CaptainPad rebuild REQUIRED**; two operator device checks pending
  (report §6). Also found, not touched: `components/deck/*skia*` import
  `@shopify/react-native-skia` with the dep declared in no package.json.

- **2026-08-16 — `_285` THE LANDSCAPE MASTER-VIEW CRUSH IS A CARD *BUDGET*
  DEFECT, and docs/69 W3 already contains its fix (Opus debug).** Reproduced
  to the pixel without touching the live engine (scratch dist `:7194` + a
  black-holed engine `:17123`; `:6968` still 200 at teardown): landscape
  1194×834, MASTER VIEW open, `channelBody` **515×0**, playlist scroller
  **283×0**, LOCAL PARAMS **206×16**. Also newly measured: the list paints
  **20 pt** past the body over MUTE/SOLO, and the TRANSITION row is *already*
  ejected from the card on the shipped build. **The filed "landscape twin of
  the portrait W0 fix" diagnosis is DISPROVED** — portrait's body is a COLUMN
  (so `flexBasis:0+grow+shrink` governs height); landscape's is a ROW where
  height comes from `align-items:stretch`, and the landscape panels already
  resolve correctly. Real cause: the card is `alignSelf:'stretch'` so its
  height is exogenous, and `channelBody` (`flex:1`) is its ONLY shrinkable
  child — opening the citizen costs **136 pt**, chrome stays **411** (the
  per-channel PIXELS band is **208** of it), so the body is entitled to 0.
  **No code landed, deliberately:** every candidate that fits inside
  `mixer.tsx` + `mixer_scroll_layout.ts` was measured and each breaks
  something else (containment clips the LOCAL PARAMS stub away ⇒ section
  unreachable; any body floor ejects MUTE/SOLO *and* TRANSITION). The
  one-line escape — narrowing the band's slot — was tried and **fails**: the
  picture shrinks aspect-honestly (327×174 → 142×75, never clipped) but the
  band's OUTER height stays pinned at 208, because it is cap-driven and the
  surplus is reserved as centred card ground. **Consequence for planning:
  W3 must ABSORB the crush, not rebase on it** — W3's own "move the edit band
  out of the card's vertical stack" removes exactly the 208 pt that zeroes the
  body, so the two are one fix. Max legal reallocation is ~108 pt against a
  60 pt row height = **one row**, which is why trimming cannot work and
  shedding the block is right. Report:
  `20260816_285_mixer_landscape_master_band_crush.md`.

- **2026-08-16 — `_283` CONFIG LEAVES THE PERFORMANCE UI; the offline exit
  becomes the escape hatch; playlist switching opens on deck + mixer (Opus
  implement+validate).** Two operator asks in one wave. (1) *"please hide the
  config from the performance UI — just make sure the EXIT PERFORMANCE MODE is
  possible using the UI even if the engine is not connected, so I can go into
  edit and go to config to select a new server or sth"*; (2) *"in the
  performance mode, allow playlist changing in the deck and mixer too."*
  **This REVERSES `_250`**, which had put CONFIG on the performance rail as an
  offline escape hatch — right fix, wrong door: it parked a setup surface on the
  live-show rail permanently for a failure mode that only happens with the engine
  unreachable. The hatch moves to the EXIT. The offline exit mechanism already
  existed; the break was that both the rail and the deep-link guard treated
  "not ready" as locked, and offline readiness NEVER arrives on its own — so a pad
  booting against a dead engine froze with no CONFIG, its chip read idle "PERF"
  so the first tap went deeper into the lock, and the guard's `!ready ⇒ null`
  made a `/config` deep link a permanently blank screen (a latent `_250` gap).
  One shared `performanceNavigationLocked()` severs it; online is byte-identical
  and still fail-closed. Not a forbidden fallback: the operator specified it,
  nothing is masked (standing `ENGINE OFFLINE`/`LOCAL VIEW` captions), and no gate
  moves — presentation only, all real gates are engine-side per request.
  Playlist half: exactly two routes left the 409 table (`POST /deck/playlist`,
  `POST /mixer/channels/:id/playlist`) — no disk write while live, nothing
  structural, RESTORE still returns the pre-show playlist; CRUD, `/secondary`
  binding, captures and overlay playlist stay gated. **Proof:** engine KILLED
  mid-show → noticed 26 ms, **UI exit 329 ms**, no hang, CONFIG actually mounts;
  cold boot against a black hole reaches CONFIG in ZERO taps. Gates: vitest
  106 files / **2323 pass / 0 fail**, tsc clean, eslint 0 errors, engine
  `performance_mode.test.js` 12/12, security scan clean on touched files; the 6
  engine full-suite reds are foreign (another agent's `all_models_load_lint` +
  timeline e2e harness). No no-touch file edited — the gate lived entirely in
  shared `PlaylistPanel.tsx`. **CaptainPad rebuild + ENGINE RESTART required.**
  Report: `20260816_283_perf_config_hide_and_playlist_switching.md`.

- **2026-08-16 — `_282` PALETTE TURNS render cost cut 37 % (Opus
  debug+fix).** Operator: *"the color wheel is amazing! magic! in the palette
  turn mode, there's a bit of lag in the UI elements when showing the turning
  window"*. The engine tweens `colorPalette1/2` every 40 ms and the COLORS
  window both subscribes to them and mirrors them into `h1`/`h2`, so its whole
  ~2000-line body re-runs at broadcast rate — by design (the dial follows the
  rig), but it was doing **operator-speed work at broadcast speed**:
  `generateScheme` nine times inside the JSX, the 90-arc `HueWheel`
  re-reconciling on fresh array/closure props though TURNS draws it from a
  draft no broadcast moves, `parColours`/`rampStops` derived for a card that
  was not mounted, every saved-palette SVG icon redrawn, the badge array
  rebuilt per chip. Hidden multiplier: **`setSlot` closed over `h1`/`h2`**, so
  it and `loadIntoArmed`/`loadPair`/`loadPreset` — props of the chips being
  memoized — churned every frame; a naive memo pass would have bought nothing.
  Fixed with memos + `React.memo` on the dial and the four list children (two
  newly extracted so they can take stable handlers), a ref-read `setSlot`, and
  card-gated strip derivation; `WindowRail` left unmemoized because it is what
  must move. **Three independent rigs agreed on the mechanism and corrected
  the brief's hypothesis:** React commits are ~56–58/s **whether COLORS is
  open or closed** (it is `display:'none'` and never unmounts; the deck screen
  re-renders wholesale above it), so this window is a subtree caught in a
  deck-wide re-render, not its cause — its unique cost is **layout**, ~+240
  forced layouts and ~+95 ms per 10 s, one per tween frame. Hence the fix cuts
  cost-per-render, not render count: scripting over 10 s of live TURNS with
  the window open **3857 → 2433 ms (−37 %)**, closed 3652 → 2444 ms (−33 %),
  commits unchanged. iPad gain is **inferred** (headless-Chrome numbers;
  platform-neutral fix). Remaining ~58 commits/s is deck-wide, untouched, and
  is the next lever. Client-only: **rebuild-pad, no engine restart**.
  Report: `20260816_282_palette_turns_render_cost.md`.

- **2026-08-16 — `_281` deck reshow returns the SHIPPED split (Fable
  debug+fix).** Operator's post-`_274` report ("reshow overlays the patterns
  panel … not resizing from full screen", portrait-only) root-caused: no
  literal overlay exists on this tree (Chromium + WebKit, ~90 states, paint
  sampling); the defect is `_274`'s per-occupant share — PATTERNS kept 75 %
  after a reshow (reads full-screen) and the restored window got a 220 pt
  chopped strip (reads pasted over it). Share removed from
  `narrowStackSizing`: any open secondary now gets the region's FULL
  default-deck viewport, PATTERNS returns to the party pin — reshow =
  default split, wide-mode parity. Default/populated/landscape/short-stack
  compositions byte-identical (landscape 18/18 diffed vs `_274`'s JSON).
  Suite 2323/0. `_274` bend #1 reversed on the ruling; everything else
  stands. Rebuild-pad required; the :6981 native pad is NOT on the
  rebuild-pad path — if paint-over persists on the device, the surface is
  the question. Report `20260816_281_deck_reshow_returns_shipped_split.md`.
- **2026-08-16 — `_280` mixer three-defect DESIGN ready (`docs/69`).** Root
  cause of the still-missing portrait rail found and EXECUTED-proven: Yoga's
  `processFlexBasis` ignores explicit `flexBasis:'auto'` when a positive
  `flex` shorthand co-flattens, so the `_275` override resolves to
  grow 0 · shrink 0 · basis 0 = 0 pt on native while CSS honors it on web
  (yoga-layout WASM differential: pre-fix 0 / shipped 0 / keyless 36).
  Drag-start scroll glitch = the lock's render round-trip vs UIScrollView
  slop; fix = synchronous setNativeProps fast path in LockableScrollView.
  Landscape patterns: 0 full rows at 1194×834 measured; design moves the
  edit band into the params column (`_279` §5's sized option, now
  operator-ordered) for ≥4/≥7 rows, rebasing on the dedicated crush-fix
  agent's `_279`-§6 substrate (coordinator re-ruling — W3 blocks on that
  landing, never double-fixes). W1–W4 + D1–D8 in docs/69; one Opus session
  next, inheriting mixer.tsx with `_279` + the crush fix in it.

- **2026-08-16 — `_245` TRANSITION DEBUG CLOSED + OPERATOR-APPROVED.**
  The operator reviewed the permanent Titanic transition gallery and says the
  transitions look good. Debrief confirmed the original visual glitch was a
  non-convergent screen blend followed by a universal 97% full-buffer cut,
  compounded by fragmented prefix-based validity, path-dependent incoming
  phase, and inconsistent overlap policies; binary-friendly endpoint tests
  and a vacuous OR assertion had hidden it. The repaired system has one
  15-mode catalog, exact script-owned endpoints, real `trans_crossfade`, atomic
  handle+phase promotion, parked zero-seed incoming patterns, explicit
  manual/autopilot/Timeline overlap behavior, reusable WASM scratch, and no
  hidden visual fallback. Titanic real-WASM strict oracle: 964 pixels,
  non-binary RGBWAU, 15/15 rows, `p0OpenCount=0`, A/B residual 0, maximum
  completion excess 0.311184 RMS, `tailCut=false`; focused 54/54 and extended
  deterministic 221/221 green. Gallery:
  `docs/pattern_gallery/transitions/index.html`; full evidence `_245` report.
  Remaining debt is bounded: no live/HIL playback was run, and
  `trans_ripple_in` / `trans_wave_sweep` still need artistic slider tuning.
  Transition Debug task archived after final debrief; no additional code,
  service, runtime-state, or git action was taken during closure.

- **2026-08-16 — `_276` DESIGNED: app-wide text-selection kill
  (docs/68).** Operator: colors-wheel drags select surrounding text, and
  selection is "annoying everywhere — disable it all". Mechanism measured on
  a scratch dist (never the live stack): RNW `<Text>` carries no `userSelect`
  on web, one drag selected 157 chars of chrome; the dial's gesture armor is
  correct and untouched. Ruled: a new `app/+html.tsx` shell stylesheet —
  `html,body` selection+callout kill with an `input/textarea/contenteditable`
  caret counter-rule — proven before writing (157 → 0 chars, caret and Ctrl-A
  intact), plus two CSS lines in `docs/ui/touch_control.html`. Carve-outs
  enumerated (27 TextInputs, the Studio transparent editor, the two
  `selectable` error Texts — the app has no clipboard API, selection is its
  only copy path). Zero overlap with `_274`/`_275`. Awaiting ONE Opus
  implementer session; D1–D7 defaults vetoable by one line each.

- **2026-08-15 — `_267` LANDED: deck declutter (docs/63), the LAST deck-file
  wave.** The AUDIO row and the 1D LIVE OUTPUT strip became workspace citizens
  in the SAME reducer/store/chip row as the windows (surface tiers), the
  optimizer moved under GLOBALS, and the plan-status cluster hoisted to the
  bar's never-scrolling trailing slot. The `_225` `known` rule generalized to
  "unknown id → its shipped default", so every stored layout hydrates
  byte-identical plus two open chips — and hydration writes nothing, proved on
  the running app. The operator's second order ("enable one view and it takes
  over the screen") was traced mid-wave to `wideFlexFor` renormalizing over the
  open set only and fixed with a denominator floor absorbed by PATTERNS,
  changing exactly 5 of 16 compositions and leaving 40/30/30 byte-identical
  (measured 41.8 %→28.8 %). The portrait version of that complaint was ruled a
  NON-defect and then proved so by A/B measurement, rather than breaking two
  pinned contracts to "fix" it. W0 settled the "1 pattern" report: it is DECK B
  BOUND, not chrome and not perf. Floors: the 12.9" iPad clears everything
  (7 default / 8 simplified); the 11" viewport misses ≥6-simplified by 16 px,
  which is now open decision 13. Suite 100 files/2132 pass/0 fail, failing list
  empty; mixer parity pinned by test. **CaptainPad web rebuild required; no
  engine restart.** The shared `WindowChip` extraction duty passes to the mixer
  relayout lead per docs/64.

- **2026-08-15 — `_260` LANDED: launcher teardown integrity (docs/62 W-A).**
  The W-A slice implemented on Fable's recommended defaults (**D1** sentinel
  reaps in all profiles, **D2** `shell:false` for `node` children). The
  coordinator's whitespace-quoting hot-fix is replaced by a structural spawn
  contract: `spawnNeedsShell` gives `node` children a shell-free spawn (so
  `child.pid` IS node — the live gen-7 lock was measured holding four cmd.exe
  WRAPPER pids while the processes actually on 6966-6969 were four different
  ones), and the exported `windowsShellQuote` survives only for the
  `npx expo` / `npm` shims, quoting the full cmd.exe metachar class and
  **throwing** on an embedded `"` or `%`. The lock now records `stackPorts`,
  `resolvedChildren` (port-resolved pid for the shell-wrapped Metro) and
  `reaperPid`; one shared `reapStaleStack` (blackout → lock children → ARM-
  interlocked port sweep → lock removal) serves both `stop` paths and the new
  detached zero-dep `tools/launcher_reaper.cjs`, which reaps the stack when the
  launcher dies abnormally and stands down on a clean stop or a takeover.
  `stop` now exits **non-zero** naming any of our own processes still holding a
  stack port. **The priority defect is closed:** `killStaleListeners` no longer
  force-kills port holders directly — every launcher port-kill goes through the
  F7-interlocked `portCleanup.killPid`, the `-f`/prod port-claim force is
  deliberately NOT forwarded as an interlock override, the launcher's duplicate
  `listenersOnPort`/`commandlineOf`/signature-list copies are deleted, and a
  `-f` takeover (whose tree kill would take an armed bridge grandchild with it)
  now refuses over an armed mirror. Runbook `.agent/ops/stack_lifecycle.md`
  states the three sanctioned stops. Suite `launcher_supervision` **50/50**
  with three mutation checks verified red-then-reverted; the live stack was
  never touched (scratch ports 17xxx, scratch lock, scratch arm marker).
  **Needs the next launcher bounce to activate.** W-B and W-C remain open.

- **2026-08-15 — the 11 `blend_screen` mixer reds: a TEST artifact hiding a
  REAL engine-killer (`_254`).** The failures `_248` blamed on `_243` and
  `_253` re-confirmed are **all green**. They were never a live defect: a
  real-WASM dry-run compiles **18/18** blends, and the fixtures simply built a
  `PatternMixer` on a fake host with no `patternsDir`. The cause was the
  **uncommitted `_245` deck rehaul** deleting the host-side lerp fallback in
  three places in favour of a `throw` (working-tree-only, invisible to bisect),
  plus `triggerMixerTransition` now refusing a handle-less transition — which
  is where the two `1 !== 0` reds came from. Fixtures re-primed the way their
  green siblings already were; `blend_precompile`'s hot-path test re-pinned
  from *should NOT throw* to `assert.throws` + the `renderHealth` record.
  **Then the audit of that verdict found the real bug:** `POST /mixer/channels`
  — the only channel-creating route — passed `mode` through **unvalidated**
  while all five sibling writers gated on `isValidBlendMode`, so one typo'd
  POST throws inside the 40 Hz tick and `engine.js:1369` turns it into
  `⛔ ENGINE FATAL` + `exit(1)`. Second session running (`_253` was the first)
  where a fatal-exit path existed because ONE caller of a hardened contract was
  missed — worth a habit, not just a fix. Gate closed, 6-test e2e suite added,
  snapshot-restore path flagged not gated, two lying comments corrected.
  **Engine restart required; composes with `_253`'s.**

- **2026-08-15 — the cancelled deck transition that was killing the engine
  mid-show (`_253`).** `_248`'s 18 special-events reds were **one engine
  process dying**, not 18 assertion failures: ABORT/FINISH a special event
  while a deck crossfade animates, and the restore's `cancelDeckPatternSwap()`
  rejected the swap's `done` with `ECANCELED` into a caller that could not
  catch it — `engine.js`'s fatal `unhandledRejection` handler then took the
  whole rig down. Cause was a **sync→async conversion of
  `timelineLoadPlaylistOnDeck`** (needed so Timeline could serialize behind an
  active swap) that changed the failure surface for its two fire-and-forget
  callers — the special-events runner and the panel-deadman revert — without
  updating either. Fixed by making cancellation an expected settled outcome
  (`settleDeckTransition`; ECANCELED and **only** ECANCELED, everything else
  still propagates) and by restoring both callers' error handling. Special
  events **91/109 → 109/109**, timeline 445/445. **Engine restart required** —
  the live process still carries the crash. Standing lesson recorded in the
  report: in `api_server.js`, making a function async silently deletes its
  callers' synchronous try/catch, and the failure mode here is a fatal engine
  exit rather than a visible error.

- **2026-08-05 — the `_149`–`_173` wave LANDED (uncommitted), the bench-mirror
  arc closed, and the wire became honest.** Chronicle: bench mirror rebuilt as a
  runtime mode with a fixture picker in the Controllers header (`_150`–`_158`);
  its first physical test FAILED (random colors) → root cause was the sACN-IN
  sim tab itself transmitting at priority 150 (`_153`/`_154`), which also
  explained the operator's long-standing tab-switch freeze → operator ruled the
  browser OUT of the routing path entirely (`_171`: transmit deleted, fog moved
  to an engine deadman endpoint, gate machinery retired as structurally
  unnecessary) and armed = bench-only (ship dark). Collaterally: the ×2.55
  percent-payload clip fixed on every sACN lane (`_170` — **the ship now reads
  darker at the same sliders; retune via `_168`'s new CaptainPad MASTER
  slider**), `stop` now blacks out before killing (`_169`), one bad HTTP GET
  can no longer kill the engine — 19 routes fixed (`_167`), the audio
  companion's test-signal reversion traced to test-spawned companions talking
  to the LIVE engine and fixed (`_173`), and the engine's direct-unicast
  exception (`Titanic-202`) was removed mechanism-and-all with a loud boot
  refusal (`_156`, operator: "no breadcrumbs"). Safety reviews: disarmed-path
  INERT-CONFIRMED (`_159`), titanic scene data + route table clean (`_160`),
  +258 tests via the Fable-catalog → Sonnet-implement → Opus-mutation-review
  pipeline (`_161`–`_166`), Fable oversight sweep found no code issues and owns
  the backlog table (`_172` §b). Commits this period: `70bc617b`, `d6234cf9`,
  `948447e9` (the `_121`–`_148` waves). **Everything since is uncommitted,
  held for the operator's physical smoke + separate commit authorization.**
  Operator checklist: restart stack → retune → bench re-smoke (`_156` §9) →
  A/B (`_170` §6) → fog test → mic pick. Detail: tracker blocks `_149`–`_173`.
- **2026-07-31 — `_120` WAVE 1 W1-1 follow-up LANDED (fix): L5 strict
  save-now.** Report `20260725_120_wave1_strict_save_now.md`. Closes the `_116`
  fix-7 handoff — the last piece of red-team `_115` L5. Scope owned exclusively:
  `lib/state_manager.js` (`save`/strict path + the three save-method signatures)
  + the `POST /settings/save-now` call site in `api_server.js` (no `engine.js`,
  `timeline/*`, `scenes/**`, `simulation/`, or the W1-1 WS/backstop code — that
  was left intact and built on). **Root confirmed:** `StateManager.save()`
  swallowed the atomic-write error with only a `console.warn`, so the
  deck/mixer/globals branch of save-now still reported a lying 200 `{saved:true}`
  on a disk-full/EBUSY write (the CaptainPad "✓ SAVED" badge reads that
  response). **Fix — a STRICT / BEST-EFFORT split at the save seam:** `save()`
  grows an options `{ strict = false }` (default warn-only, UNCHANGED;
  `strict:true` re-throws); `saveMixerState`/`saveDeckState`/`saveGlobalsState`
  thread the flag; in `api_server.js` `saveAllState(strict=false)` +
  `saveGlobals(withParams, strict=false)` thread it, and save-now calls
  `saveAllState(true)` + `saveGlobals(true, true)` so its existing (W1-1)
  try/catch now catches a real throw → honest 500 `{saved:false,error}`. **The
  ~80 AUTO-SAVE triggers pass nothing → best-effort, byte-UNCHANGED** — a
  transient disk blip during auto-save is still swallowed and can never reach
  W1-1's `exit(1)` backstop (no dark ship); the existing
  `state_atomicity.test.js` "failed write is swallowed" invariant still passes.
  **The L5 lie is now an honest non-200.** **Suite:** full engine **2524/8** =
  the SAME 8 known environmental baseline (audio-capture framing ×2, OSC
  lifecycle/EADDRINUSE ×4, effects_v2 layout ×1, specialty-playlist parity ×1 —
  none touch `state_manager.js` / the save paths; **zero new failures**). +8 new
  green tests: `tests/state/strict_save.test.js` (7, deterministic strict/
  best-effort seam over a dir-replaced-by-a-file) + `tests/e2e/
  save_now_honesty_e2e.test.js` (1, real engine subprocess: save-now → non-200
  on the broken dir while a `/global-blackout` auto-save over the SAME dir stays
  200 and the engine survives; timeline DISABLED to isolate the deck/mixer/
  globals path; imports `setup_config_guard.mjs`). `config.yaml` CLEAN vs HEAD;
  spawned engine black-holed via `MARSIN_CONFIG_FILE`, state redirected via
  `MARSIN_STATE_DIR`; zero device HTTP, zero sACN, operator stack untouched; no
  git ops.
- **2026-07-31 — `_118` WAVE 1 W1-3 LANDED (fix): pattern-VM "never black"
  enforcement + `_90` audit-harness hardening.** Report
  `20260725_118_wave1_pattern_never_black.md`. Family I of the red-team campaign
  — sits on the LIVE ChatGPT pattern loop. Scope owned exclusively:
  `lib/pattern_mixer.js` + `tools/pattern_audio_harness.mjs` (no `engine.js`,
  `api_server.js`, `timeline/*`, `simulation/`, `scenes/**`, `patterns/**`).
  **I1 (P0) + I2 (P0) — runtime R4 enforcer.** The vendored WASM absorbs a NaN
  (any one arg to `rgbwau()`/`hsv()` blacks the whole pixel and is absorbing in
  persistent state) or a `beforeRender` budget overrun (truncates silently, the
  palette resolve never runs → black ship) into a black composite with no
  signal; and the NaN is already `0` before JS sees a byte, so per-channel
  sanitising is unreachable — enforcement is on the CONSEQUENCE. New
  `_enforceNeverBlack()` in `renderAll6ch()` (the exact buffer engine.js emits):
  counts consecutive fully-black-while-lit frames — gated by `_isExpectingLight()`
  so a legit operator blackout is never flagged — and at 8 frames (0.2 s) LOUDLY
  trips `renderHealth` (naming the deck pattern) AND writes a dim last-resort
  floor (10/255) so the ship is never shipped dark without
  `/status.renderHealth.ok=false`; auto-recovers when light returns. Plus a
  solid-red detector (`_112` F9). **Proven end-to-end through the REAL WASM** —
  NaN-arg, absorbing-NaN, and beforeRender-overrun all compile clean and trip.
  **I2 honest finding:** `marsin_begin_frame` is compiled `void` (verified) with
  no error set on truncation and no C source to re-vendor, so a direct ABI
  truncation channel is impossible; the black outcome is caught by the enforcer,
  a wrong-but-non-black truncation only offline by the harness. **I4 (P1) — the
  `_90` harness can now FAIL:** `--gate` exits 3 with a NAMED reason on DARK
  (fails `evil_black`), BLACK_LATCH (renders 600 frames past the clip — fails the
  `evil_sleeper` post-window latch), OVER_BUDGET (MEAN VM frame time >
  budget/mix-channels, default 25/4=6.25 ms). Verdict always PRINTS; only
  `--gate` changes the exit code (clip/gif tooling unaffected). Shipped patterns
  stay green on titanic (worst `26_dom_dancers_chevron` mean 4.56 ms → PASS).
  **Operator: add `--gate` to the `_90` recipe's two harness runs.** **Suite:**
  +16 new green tests (7 enforcer + 4 real-VM e2e + 5 harness-gate); zero new
  failures from this thread (full run 2520/2510/10 = the 8 known baseline + 2
  sibling `tests/timeline/overview_perf.test.js` J1 perf tests that PASS in
  isolation, uncoupled to this work). `config.yaml` + `patterns/` CLEAN; zero
  device HTTP, zero sACN, no git ops. **Handoff to W1-1:** never-black is ALREADY
  on `/status` (`getRenderHealth()` folds `darkness` into `ok`); standalone
  `mixer.getNeverBlackHealth()` provided for `/timeline/state` + the launcher
  watchdog.
- **2026-07-31 — `_117` WAVE 1 W1-2 LANDED (fix): launcher supervision &
  watchdog — the `_115` L1/P0 capstone.** Report
  `20260725_117_wave1_launcher_watchdog.md`. Scope owned exclusively:
  `simulation/start.js` + `launcher.js` (+ one additive fail-loud line in
  `simulation/lib/load_ports.cjs` for the override — the only path the port map
  reaches the child servers). **L1 CLOSED — dark ship / green dashboard is
  over.** `start.js` was blind to its children's death (it only `console.log`'d
  an exit) and `launcher status` probed only :6969/:6968, so `kill -9` on the
  save server or either sACN bridge left the rig dark with every surface green.
  Now `start.js` is a real supervisor: DEATH and FREEZE (3 missed 10 s health
  probes on a live child) are detected → bounded restart (5/60 s) →, past
  budget, **loud escalation** (`exit(1)` → launcher teardown → show-server
  supervisor relaunch) instead of a crash-loop fallback. `launcher status` now
  probes EVERY child (save/sacn-in/sacn-out via a 426-aware, census-neutral GET
  — a `ws` bridge answers a plain GET 426, and a bare GET fires no `connection`
  event so it never pollutes the input bridge's sim-window census) AND reads the
  bridge's `packets/5s` for frame-flow, so a dark/wedged server reads **RED** and
  green means frames flow. **L4:** `checkPortFree` bind-probes BOTH families
  (IPv4 `0.0.0.0` + IPv6 `::`) — the IPv4-only-squatter shadowing is caught
  (repro'd then fixed). **L6:** `validate()` moved BEFORE the destructive
  `assertSingleInstance`/`-f` takeover — a scene typo no longer kills the show
  first. **P2-6:** new **`BM26_SIM_CONFIG`** override (fail-loud, `MARSIN_CONFIG_
  FILE`-style) points launcher + start.js + save-server + both bridges at
  throwaway ports; `main()`/boot guarded behind `require.main`, pure helpers
  exported. **Suite 1645/8 → 1663/8: +6 green, ZERO new failures** (the 8 are
  the known baseline, byte-identical set). Live-proven: watchdog restart on a
  real `kill -9` (fresh pid, `exited unexpectedly` logged); sACN-out kill →
  `status` line **❌ not green**; frame-flow warned of a dark rig. Ran entirely on
  786x/787x + UDP 7568; operator :6969-:6972 byte-identical (same PIDs 35692/
  17308/38388/50272), throwaway orphans swept, `config.yaml`/`scenes/**`/engine
  untouched. **No git ops** — landed on the uncommitted `feat/bm_readiness` tree.
  **Flagged for later (out of these two files): a census-neutral `/health` on
  both sACN bridges + a frame/output indicator on W1-1's engine `/status`** would
  let the watchdog verify frames continuously (today freeze/death is continuous,
  frame-flow is an on-demand `status` advisory); and `_115` P2-3 (status/stop
  refuse on a corrupt lock) is unowned.
- **2026-07-31 — `_119` WAVE 1 W1-4 LANDED (fix): sim save-server &
  controller-probe crash-proofing + save honesty.** Report
  `20260725_119_wave1_saveserver_hardening.md`. First Wave-1 fix thread of the
  operator-greenlit ("go") red-team campaign. Scope owned exclusively:
  `simulation/server/save-server.js` + `controller_probe_service.cjs`.
  **`_109` P1-1 (Family A) CLOSED and the process-kill is now SURVIVED** — the
  malformed `POST /controllers/probe` with `timeoutMs:-1` used to reach
  `socket.setTimeout(-1)` on a still-connecting socket BEFORE its `error`
  listener existed, so the later socket error was unhandled → whole save-server
  exited (saves/backups/gamma/probe all die). Fix: the route now validates
  `timeoutMs` (finite, `>0`, `≤60 s`) → 400; `tcpProbe` attaches `on('error')`
  before `setTimeout` and catches the throw → honest UNKNOWN; process-level
  `uncaughtException`/`unhandledRejection` backstops log NAMED and exit (no
  half-alive run; auto-restart is W1-2). **P1-3:** the "1.2 s ceiling" was an
  IDLE timeout a slow-drip host held 10.4 s and wedged every later sweep — added
  an ABSOLUTE per-probe deadline (TCP + HTTP) + a 256 KB response cap. **`_115`
  L5 save-honesty:** every save-server write path now returns a NAMED non-200 on
  failure (was bare `Error`) — proven a failed disk write answers
  `500 Error: …`, never `200 Saved`. **Endpoint hardening:** 1 MB body cap (413),
  non-object body (incl. the `null`→TypeError→kill vector) → 400, garbage → 400.
  **Suite 1645/8 → 1657/8: +12 green, ZERO new failures** (the 8 are the known
  baseline, byte-identical). New tracked tests: `save_server_hardening.test.js`
  (spawns the real server on a random port + throwaway `~/tmp` root) and probe
  module tests. Repro `~/tmp/redteam_controller/04_probe_crash_repro.mjs` all
  green. Test-only env hooks `SIM_SAVE_SERVER_PORT`/`SIM_SAVE_SERVER_ROOT`
  default to production paths when unset. Zero device HTTP (loopback + RFC 5737
  `192.0.2.x`), zero sACN, operator ports never touched, `marsin_engine/
  config.yaml` CLEAN. **No git ops** — landed on the uncommitted
  `feat/bm_readiness` tree for the operator to review.
- **2026-07-31 — `_103` RED-TEAM (report-only): the timeline / arbiter /
  party-session subsystem was hammered with the `_93` dry-run harness; 1 HIGH,
  1 MED, 5 LOW, no CRITICAL.** Report `20260725_103_redteam_timeline.md`, repros
  `~/tmp/redteam_timeline/`. No engine spawned (harness is offline, writes only
  `~/tmp/timeline_dryrun/`); `config.yaml` CLEAN vs HEAD, no device/sACN/stack
  touched. **The trigger/arbiter/festival/sun cores HELD** (DST fall-back
  de-dupe, polar-safe defaultCue, overlap rejected at load, exact festival
  day-gating + loud out-of-window, missing playlists fail loud, edge-storm dwell
  defence, `_98` arm-latch confirmed on burn night). **H1 (HIGH — deck-thrash):
  the mood→party cue has NO "I already own the deck" idempotency guard — a
  detector that dips-and-returns re-arms it (`triggers.js:284`) and at the
  shipped dwell (20 s) it re-fires while its own session is live; each re-fire
  re-runs the look and `timelineLoadPlaylistOnDeck` (`api_server.js:4372`) always
  reloads pattern-1 with a transition swap → the exterior resets on every music
  gap all party night** (harness: 60 re-fires / 1 window-elapse in 5 h on a
  realistic 3-on/2-off flap). **M1 (MED, same root): the re-fire re-stamps
  `_deckWindowUntilMs` (`timeline_service.js:845`) so a 12-min-session +
  2-min-cooldown becomes one endless session — cadence + cooldown silently never
  run.** LOW: `mood` `from===to` silent dead cue; `hold.until` a past anchor →
  ~zero hold; two same-time PROGRAMS double-dispatch + the earlier hold silently
  discarded (overlap validator ignores `hold`); DST spring quirk (off-playa);
  harness mis-counts `party-config` as a session end. Coordinator: H1 first
  (idempotent re-fire no-op + same-playlist load short-circuit); M1 rides it.
- **2026-07-31 — `_107` RED-TEAM (report-only): the fixture / model / patch layer
  was hammered; 2 HIGH, 2 MED, 2 LOW, no CRITICAL.** Report
  `20260725_107_redteam_fixtures.md`, harnesses `~/tmp/redteam_fixtures/` (pure
  parity-lib inputs + `gen_te_sign_fixture.js --dry-run`; **zero source edits,
  zero writes to `scenes/**`/`models/**`/`dmx/fixtures/**`**, no stack run).
  **Both HIGHs are in `scene_model_parity`'s LED lane — the gate is blind to two
  silent classes its DMX lane already catches. HIGH-1 (silent-mispatch, the `_92`
  RGB↔RGBW class re-opened): chain an RGBW TE sign on a MarsinLED output set
  `order: RGB` and the exporter emits stride-3, white-less pixels that pass
  `--strict` CLEAN** — parity discards the LED-bus fixture DEFINITION's declared
  physical format (`channels: ledBus ? undefined`; no `channel_mode` cross-check)
  and takes the controller order as sole truth, firing only when model &
  controller disagree. **HIGH-2 (silent-dark, patched-but-unroutable): a
  strand/LED-bus fixture chained on an UNBOUND LED controller (no `device:`
  block) with a stale patched record+model passes clean** — parity never reads
  `controller.device` and has no LED analogue of DMX's
  `patch_record_disagrees_with_chains`, so a rope a fresh export would render DARK
  reads green. MED: address-hygiene models an LED-bus fixture as one
  `def.footprint` DMX block (ignores `record.segments`) → false out-of-range +
  missed spill-universe collisions on larger LED-bus fixtures; `ledStride()`
  accepts a sub-minimum stride the sim refuses to boot on (misleading diagnosis).
  LOW: te_sign `SHARED_PANEL` message spam + role-annotation mislabel;
  LED-bus footprint never cross-checked (root hook for HIGH-1). **What HELD:** the
  te_sign generator (every malformed CSV fails loud; the degenerate all-same-coord
  case is caught before the divide-by-zero normalization path), `orphan_fixtures`
  (strict `=== true`, rename-safe ownership, no guessing), parity's DMX lane, and
  the `_48`/`TE Sign 2` name-drift protections (via `pixel_map_view_defaults.test.js`,
  shipped-defaults only). Recommended fix order: HIGH-2, then HIGH-1, then MED-1.
- **2026-07-31 — `_108` RED-TEAM (report-only): the engine HTTP/WS API contract +
  CaptainPad client — malformed requests, protocol races, enum drift, concurrent
  writers, reconnection storms — was attacked; 1 CRITICAL, 1 MED, 4 LOW.** Report
  `20260725_108_redteam_api.md`, repros in `~/tmp/redteam_api/` (`probe.mjs`,
  `ws_crash.mjs`). Every engine black-holed via the `_100` harness and asserted so;
  **no source touched, zero device HTTP, zero sACN to hardware, operator stack
  untouched, `config.yaml` CLEAN vs HEAD.** **CRITICAL (engine-crash, the `_99`
  sibling): one malformed WebSocket frame crashes the whole engine.** None of the
  four `/ws/*` `WebSocketServer`s (nor the transitional `/` alias) attach a
  per-connection `ws.on('error')` — only `wssInst.on('error')` + `server.on('error')`.
  An invalid-UTF-8 text frame (also: reserved opcode, oversize control frame, bad
  close code, RSV1) makes `ws` emit `'error'` on the socket instance with no
  listener → uncaught throw → `process.exit`, and there is no
  `uncaughtException`/`unhandledRejection` handler anywhere in engine.js/api_server.js.
  Proven live on `/ws/control` AND `/ws/params`. **Ship-dark with no self-heal:**
  `launcher.js:623`'s child-exit handler does NOT restart a crashed engine — it
  `teardown(1)`s the entire stack. No malice required (a WiFi-corrupted frame
  suffices). Fix: classified non-fatal per-socket `ws.on('error')` on all four
  servers (the `_99` shape) + a per-topic frame-violation regression test.
  **MED (enum-drift): the `effectiveState` enum is a hard engine↔pad coupling** —
  `parsePartyConfig` throws on any value outside the 6 known. No live drift today
  (producer closed to 6; all 3 pad consumers wrap the throw → no crash, degrades to
  a loadError) but a future 7th engine state puts every older pad's PARTY card into
  a permanent error banner on a healthy engine — the exact fragility `_98` §8.3
  worked around. Fix: pass an unknown `effectiveState` through and let
  `describePartyStatus`'s `default:` branch derive; keep the throw for type
  violations only. **LOW: `POST /timeline/takeover` silently coerces a non-object
  body into a plain takeover (200 not 400)** (fallback shape); concurrent
  `takeover(perform)`+`travel` both 200 (last-writer, momentary response lie,
  broadcast reconciles ≤1 s); `/timeline/resolve` over-long query → 431 empty
  (non-JSON) body; `/timeline/resolve` routes by `startsWith`. **What HELD:** the
  REST surface is genuinely hard — hundreds of malformed/OOR/unicode/traversal/
  `__proto__`/huge payloads across takeover/travel/resolve/party-config/plans →
  clean verbatim 400s, no 500 on input, no unhandled rejection, no silent clamp;
  `festival.days` bounded [1,31] (no `buildOverview` wedge); WS `message` handler
  try/caught; 60× reconnection storm + garbage/oversize *text* frames survived.
- **2026-07-31 — `_106` RED-TEAM (report-only): the LED controller lifecycle —
  provisional binding, promotion/reconcile, ONLINE/OFFLINE status probes, and the
  six-layer push/save chain — was attacked; 2 HIGH, 3 MED, 3 LOW, no CRITICAL.**
  Report `20260725_106_redteam_controller.md`. All repros pure Node against the
  real modules with injected transports; **no device HTTP, no sACN to hardware,
  no scene writes, operator stack untouched.** **HIGH-1:** `provisional_binding.js`
  documents `ip_mismatch` as a first-contact contradiction, but on the provisional
  path it is DEAD CODE — provisional cards match by IP only and every promote path
  sets `device.ip = controller.ip`, so a mistyped/DHCP-shuffled IP AUTO-VERIFIES a
  card against whatever board answers there, catchable only by the OPTIONAL
  boardId/deviceName expectation. **HIGH-2:** the default-ON auto-sweep
  (`applyControllerProbeResults`) re-raises the reconcile dialog every ~20 s for an
  online-but-contradicted provisional card with no de-dup → unbounded modal
  stacking, and a stale stacked dialog's "Promote anyway" throws uncaught inside
  `ctx.mutate` once the card is verified. **MED-1:** a push whose scene-save fails
  leaves a GREEN "In sync" chip and the next recompute drops even the tooltip
  warning (disk stale, LEDs dark, surface green — the _58/_60 shape the loud push
  path otherwise closes). **MED-2:** promotion consumes a possibly-CACHED
  fingerprint (probe cache `type:ip`, 5 s TTL) so a same-IP hot-swap binds to the
  previous board. **MED-3:** ECONNREFUSED/RST is always ONLINE (reject-firewall /
  DHCP squatter reads green; drop-firewall on the same dead box reads OFFLINE).
  LOW: registry-omit skips the `controller_id_claimed` blocker; the push
  double-notifies the bridge; the 1.2 s status deadline flaps cold boards.
  Recommended first fixes: gate unattended provisional promote on a stated
  expectation or a confirm (HIGH-1); per-card dialog de-dup + stale-dialog no-op
  (HIGH-2).
- **2026-07-31 — `_104` RED-TEAM (report-only): the timeline ZOOM surface —
  day/event zoom, time travel, the lease + exit machine — was attacked; 1 HIGH,
  2 MED, 2 LOW, no CRITICAL.** Report `20260725_104_redteam_zoom.md`. **The
  engine's "never stuck" invariant HELD** — I could not build a zoom the rig
  can't leave (resume nulls the lease before catchUp and catches its throws; the
  tick releases expired + self-heals orphaned leases; the boot scrub runs
  synchronously before the first broadcast; `_goDormant` drops an expired travel
  lease; malformed `/timeline/travel` all 400 pre-mutation). **The break is on
  the PAD (A1, HIGH):** `_zoomExitRequested` is a module-level exit-claim latch
  set UNCONDITIONALLY by `_resume()` (`useTimeline.ts:171`) — which is ALSO the
  plain-takeover RESUME NOW (`resumeNow: resume`, used by deck + PlanLockBanner)
  — and it is only ever cleared by `clearZoomClaims()` on a zoom→null transition
  in `ZoomBanner.tsx:88`. A plain takeover has no zoom, so the flag leaks true;
  the next real PERFORM/TRAVEL zoom that the ENGINE ends (lease expiry / restart
  / AUTO OFF / maker save) is then read as `ours:true` → the "Zoom ended — the
  plan resumed" toast + auto-nav is SUPPRESSED and the operator is stranded on a
  deck they no longer own. Inverts the exact `_97` §3.4 protection; the unit
  test only covers the pure `shouldAnnounceZoomEnd`, not the leaky latch feeding
  it. **A2 (MED):** confirms `_100` F1 — the scoped lease IS written to
  `timeline_state.yaml`; only the one-line boot scrub prevents a ghost PERFORM
  banner on reboot (I verified the scrub's synchronous ordering, so latent not
  live). **A3 (MED):** the D3 "Show due: X — starts when you exit" banner keeps
  promising a show that `_catchUp` SILENTLY SKIPS if you linger past the cue's
  hold — and then EXIT (skips) and ENABLE (fresh hold, plays) diverge. **A4/A5
  (LOW):** engine doesn't check a PERFORM `cueId` is the live cue (spoofable
  banner label); travel steppers' strict `>`/`<` make co-timed cues
  unreachable. Report-only; **`config.yaml` CLEAN vs HEAD** (no engine spawned —
  static code-path analysis), no `:6967`/`:6969-:6972` or device touched, no git
  ops.
- **2026-07-31 — `_105` RED-TEAM (report-only): the sACN bridge surface was
  hammered with pure-module harnesses; 1 HIGH, 3 MED, 3 LOW, no CRITICAL.**
  Report `20260725_105_redteam_bridge.md`, repro `~/tmp/redteam_bridge/harness.mjs`
  (41/41, no sockets, no Sender, **no sACN frame toward hardware**, zero device
  HTTP). **The one that can bite the show: a universe > 63999 in the LIVE
  hand-edited `📡 Subscribed Universes` field (`common.yaml` is `1..37` today)
  or a corrupt `patches.yaml dmxUniverse` bypasses the boot accept-list — neither
  `parseSubscribedUniversesField` nor `patchRecordUniverses` enforces the E1.31
  ceiling — reaches `new Receiver`, `multicastGroup()` throws `RangeError`, and
  `classifyReceiverError` calls it FATAL → the whole input bridge
  `process.exit(1)` at boot.** The runtime diff path (`computeUniverseSubscriptionDiff`)
  buckets the identical value as invalid and survives, so the two paths disagree:
  a bad save looks fine at runtime and kills the NEXT boot with a misleading
  "socket FAILED" line. MED findings: a truncated `segments[]` silently drops a
  spill universe (no anomaly — the `_87` dark class one field deeper); the bench
  mirror never subtracts its `dest_host`/dest-universe from the engine-owned set
  and doesn't validate `dest_host` against real controllers (latent double-write
  vs the one-writer law); and `composeUnifiedFrame` doesn't self-guard same-IP
  contests. LOW: leading-zero-octet decimal/octal divergence, boot gate replays
  only the last deferred reason, multi-NIC = OS coin-flip by design (pin
  `sacn_interface`). **What held:** the `_99` boot gate + double-join invariant,
  route-diff flap-freedom, merge intersection off-by-one at both edges, runtime
  range enforcement + per-universe isolation, bench-mirror validation/gating,
  field-parser parity. All findings are report-only; the operator/coordinator
  decides which to fix (H1 is the recommended first — a one-line ceiling guard
  in the two boot-list builders closes it).

- **2026-07-31 — `_102` LANDED: sending to the same address is a WARNING now,
  and the wire decides it deterministically.** Report
  `20260725_102_same_address_merge.md`. Operator order: *"make controllers allow
  sending to the same address with a warning instead of an error — and for those,
  make sure you unify the packets and then send; if conflicting, prioritize
  higher IPs and override"*, plus the emphasis *"but the UI must show that
  that's a warning."* **The sweep found exactly ONE hard refusal** —
  `derivePerOutputPlan`'s `universe_owned` collision, which blocked the single
  push, the fleet push and the sync chip alike (three other overlap sites —
  `validateLedManualUniverses`, the registry's per-universe overlap sweep, the
  bridge's cross-scene conflict — were already warnings and are unchanged).
  New pure module `simulation/src/dmx/address_merge.js` owns the rule end to
  end. **The merge:** an overlap is same-universe-and-intersecting-range, the
  contested region is the **intersection only**, each `(universe, destination
  IP)` gets **exactly one packet**, and on a contested channel the **numerically
  higher controller IP overrides**. The comparison is **octet-wise numeric and
  the distinction matters here**: two boxes in one `/24` ending `.9` and `.10` sort
  the WRONG way as strings (the `.9` one comes out higher), which is
  backwards, and `a*2**24` is used rather than `a<<24` because JS's signed shift
  would rank every ≥`128.x` address below every `10.x`. Global-effect pins stay
  exempt — gang-firing foggers on one address is the operator's own 2026-06-12
  ruling, not a contest. **The UI requirement is met as a standing state, not a
  toast:** a PERSISTENT amber banner on the affected controller card naming both
  claimants, the exact `(universe, ch a–b)` and who wins; the push dialog carries
  a `⚠ N SHARED ADDRESSES` block placed **first**, above even the saves-the-scene
  notice, because it is the one line on that plan that changes what OTHER
  hardware sees; the sync chip stays `in-sync` (a share does not make the device
  differ from the plan — that is what the chip measures) but carries the warning
  in its tooltip; and `[AddressMerge]` logs fire on every transition so an
  operator who never opens the pane still learns of it. **The override cannot be
  decided by render order:** the loser is handed the absolute channels it must
  not write (index built once per projection, resolved once per pixel, keyed by
  IP because a pixel knows its controller IP and its channel but not which
  projection record it came from) — including the par master-dimmer force-write,
  which would otherwise blast the winner's fixture to full. **Deliberate
  asymmetry kept:** an EXPLICIT operator-declared universe may be shared, but the
  auto-assign paths (universe repair, park allocation) still skip every claimed
  universe — the sim never *chooses* to create a shared address, it only honours
  one he declared. **It composes WITH `_89` rather than against it:** the bench
  mirror unifies at the bridge (owning its destination pairs, suppressing the raw
  relay), this unifies at the sim (one packet per destination, one winner per
  channel) — same doctrine at two layers; `server/sacn_bridge.js`,
  `bench_mirror.cjs` and `bridge_routing.cjs` are untouched and `git status`
  confirms the uncommitted `_89`/`_99` work is intact. Sim suite 1592 →
  **1645 (+53), fail 8 → 8**, the known baseline with a byte-identical list;
  the new tests include **byte-level frame composition** and a control case
  proving that *without* the merge the render order decides — the defect this
  closes. Security PASS; one self-inflicted finding was caught and fixed en route
  (a real routable address, first octet 128, in an IP test — swapped for an
  RFC 5737 TEST-NET-2 address, which still proves the unsigned-above-127 point).
  **LIVE-PROVEN, 13/13 checks + four screenshots**, on the operator's own sim
  via a new `agent_tools/shared_address_verify.cjs`: the sACN OUT socket blocked
  before the first page script and *asserted* at `framesSent = 0`, zero device
  HTTP, zero scene writes (the overlap is injected into the in-memory registry
  with RFC 5737 TEST-NET IPs and removed again — the last screenshot shows the
  pane back exactly as it was). On the wire, both render orders composed to the
  identical frame with the `.10` box owning the contested channels, and each of
  the two controllers got exactly one destination — no racing packets.
  **RESIDUE REPORTED, NOT HIDDEN (report §9):** the probe's first runs — before
  I added the save-server guard — re-exported `marsin_engine/models/test_bench.js`,
  because `main.js` calls `saveModelJS()` on page boot. Not a regression: the diff
  is the timestamp plus the 76 TE-sign pixels flipping `dmx` → `led`/`unpatched`,
  which is the `_92` correction landing in the export, and the suite is
  byte-identical either side of it. Left in place (never `git checkout` to hide a
  test side effect); the probe now aborts every non-GET to :6970 per the `_89`
  GUARD-3 recipe, re-verified at 4 writes aborted / 14-of-14 checks / model
  byte-identical. Separately flagged and **not mine**: `scenes/common.yaml` has
  `lightingMode: sacn_in → pixelblaze` sitting uncommitted, mtime three quarters
  of an hour before my first page load.
  **TWO OPERATOR DECISIONS handed back:** a **same-IP** overlap and a **no-IP /
  placeholder-IP** overlap are still HARD ERRORS with the reason named, because
  his rule ranks IP-BEARING claimants and inventing a tie-break for the rest
  would be precisely the fallback the codex forbids. If either should resolve
  automatically, the rule has to come from him. **Memory amendment proposed
  (report §7):** `sacn-route-ownership`'s flat *"one writer per (universe,
  controller) is the law"* is no longer the whole truth — it is still the law on
  the wire, but it now has TWO enforcers (the bridge's suppression, and the sim's
  merge), and the sim preserves it by MERGING rather than by refusing.

- **2026-07-31 — `_100` LANDED: the timeline-zoom e2e suite (S5). The S1–S5
  wave is CLOSED.** Report `20260725_100_timeline_zoom_e2e.md`. 17 scenarios,
  17 green, driving a **real `engine.js` subprocess** over real HTTP and real
  `/ws/control` sockets, restarted by really killing it — the
  `tests/timeline/*` family pins the LOGIC, this pins the WIRING. **The two
  exit paths `_97` could never reach live are now covered.** *Engine restart
  mid-zoom, both scopes:* the process dies, and the rebooted ship has no zoom,
  no lease, mode `armed`, the plan back on the deck — and a **reconnecting pad
  sees the truth on its very first frame** (the connect replay), which is what
  stops a stale PERFORM banner surviving a reboot. *Plan save mid-zoom:* the
  maker's auto-save over the active plan hot-reloads, drops the zoom, returns
  the deck to the plan-at-now, and the pad learns it **from the broadcast** —
  it never asked for that exit. Every other exit-table row is covered too;
  the single remaining row (festival window closing) is UNIT-only for a stated
  structural reason — every e2e route to it goes through `savePlan`/`activate`,
  which are themselves exits, so the scenario would assert the wrong row. Its
  observable consequence (a PERFORM cannot exist out of window) IS covered.
  **Two clients:** B gets the banner on its replay, B *browsing* changes
  nothing, B retargets the ONE session and A renders the identical zoom, B's
  EXIT ends it for both. **`_97`'s exit race pinned e2e** — the cleared-zoom
  broadcast genuinely beats the `resume()` response, so the pad's pre-staked
  exit claim answers a real ordering rather than a hypothesis. **`_98` fix 1
  proved on a real engine with a real mood feed:** a party fire during a
  PERFORM lease is suppressed, *visible* (`wouldFire`, edge-only — one entry
  per episode), and consumes NOTHING — latch intact, cooldown unstamped — so
  the session fires the instant the operator hands back. **The `--dest` trap
  is closed at the source.** `_97` streamed 30 s of live sACN to the real rig
  believing `--dest` black-holed it; the honest problem was that
  **there was no way to neutralise the per-controller `controllers:` block** —
  `engine.js` read the tracked `config.yaml` unconditionally. `MARSIN_CONFIG_FILE`
  now governs the BOOT read as well as the autopilot write-back (fail-loud on a
  set-but-missing path), so a harness writes a black-holed config instead of
  editing his file — the exact edit `_98` had to flag as a commit blocker. New
  `MARSIN_TIMELINE_DIR` likewise means a test engine can no longer write show
  plans into `scenes/**`. Both walls are **asserted on every boot**, not
  assumed. **One real bug found + fixed (B1, in `_95`'s S1 code):** the day
  ribbon sampled only where cues START — never where they HAND BACK — so a
  segment ran from a cue's fire time to the next unrelated boundary. On the
  shipped plan that reported a 90-minute program hold as owning past its end;
  on the fixture it mis-stated **2 h 10 m**. That is exactly the stretch `_98`
  FIX 7 gives the ambient `defaultCue` — **the surface built to make the plan
  honest was lying about the biggest thing `_98` changed.** Fixed in
  `buildDaySegments` (sample `windowUntilMs` + `holdUntilMs`), pinned by three
  tests including a full ribbon-vs-resolver equivalence walk, and guarded e2e on
  his real `playa_default`. GATES: timeline 407 → **410/410**, full engine
  2470/2478 (the 8 baseline, zero new), CaptainPad **914 = baseline**, security
  PASS, **`config.yaml` clean — nothing to restore**, his sim stack on
  :6969-:6972 never approached. **Two findings reported, not fixed:** (F1) the
  "runtime-only" zoom lease IS written to `timeline_state.yaml`, scope and all —
  only the boot `_catchUp` scrub stands between it and a ship that wakes up
  thinking a human has the deck (the scrub works, and is now the thing pinned);
  (F2) entering ANY takeover — plain or PERFORM — stands the deck's pattern
  autopilot down, so a look stops cycling while you perform under it. Worth his
  ruling; not a zoom-path defect.

- **2026-07-31 — `_92` CORRECTION: the TE sign pucks are RGBW, not RGB — "same
  lights as the ropes".** Operator: *"sign is also RGBW, same lights as the
  ropes."* The addendum entry below told him to set the MarsinLED output's
  channel order to **RGB**; that was wrong and is retracted — the corrected
  instruction is **RGBW / stride 4, the same setting the rope outputs already
  use**. Audit result: **no byte-level bug existed.** For an LED-bus fixture the
  stride and channel map come from the owning controller's `led.order` (for a
  sign exactly as for a strand), so the wire would have been right either way —
  `led_fixture_kind.js` counts PIXELS not bytes, the exporter takes
  `footprint: ledProj.stride`, and the parity gate cross-checks stride against
  `ledStride(controller)`. What was wrong was every number a HUMAN reads: the
  definitions' `channel_mode` (120/102), their per-pixel `{red,green,blue}` map
  and `type: "rgb"`, the channel count baked into the FILE NAMES, the
  `20260725_13` pattern-catalog row, and my mapping instruction. Fixed: the
  generator gained `BYTES_PER_PIXEL = 4` / `PIXEL_FORMAT = 'rgbw'` threaded
  through footprint, the per-pixel quad, the controls block and its summary
  line; definitions regenerated and renamed **`model_a_160.yaml`** (40 px × 4 =
  160 ch) and **`model_b_136.yaml`** (34 px × 4 = 136 ch) with `type: "rgbw"`
  and `channels: {red: 4i+1, green: 4i+2, blue: 4i+3, white: 4i+4}`; `main.js`'s
  4 registration refs repointed (sequenced new → repoint → delete-old so no page
  load could ever fetch a missing file while he was testing); catalog row
  corrected. **Geometry byte-identical** — same 148 points, same wire order,
  same shared normalisation. Corrected arithmetic: one whole sign is **296 ch**
  (not 222) and still fits one universe, with 216 ch of headroom. Two new
  regression tests pin RGBW at 4 bytes/px and tie it to the stride every titanic
  LED controller runs, so the generator cannot quietly fall back to 3. Sim suite
  **1590 tests, 8 fail = the baseline 8, zero new**; parity **unchanged at 4
  `unmapped_fixture`**. No server started/stopped/reloaded, no scene file
  written, zero device HTTP — his next hard reload picks up the RGBW
  definitions. Correction section appended to
  `20260725_92_te_sign_patch_model_fix.md`.

- **2026-07-31 — `_97` LANDED: the timeline zoom ladder is on the pad (slices
  S3 + S4).** Report `20260725_97_timeline_zoom_pad.md`, built against `_95` §3;
  **zero engine changes**. **S3 — DAY ZOOM.** The 8-day strip's day cards now
  ZOOM IN on tap (`OPEN DAY ▸`), replacing the old select-vs-`EDIT DAY` split —
  two gestures with two invisible meanings was exactly the 3 a.m. problem the
  operator flagged. The `DayEditor` modal was **promoted into a full-screen
  `DayView`** carrying everything it had (agenda, ＋ CUE, per-row edit/delete
  into the existing `CueEditorSheet` — *no new edit semantics*) plus the two
  things a REVIEW needs: **phase bands**, where a band whose end precedes its
  start is drawn as TWO pieces across midnight (`party_night ⤵` — drawing it as
  one inverted rectangle renders *nothing*, and a whole night would have read as
  empty), and the **resolved ribbon** with a plain-language reason per segment
  (`the cue owns the deck` / `gap — the plan default cue` / the amber
  `⚠ hold expired — the autopilot baseline plays under the cue`). The engine's
  calendar-day limit is **stated on screen**, not faked: "the ribbon resolves
  this CALENDAR DAY only". Missing `phases`/`segments` produce a loud red block,
  never an empty ribbon passed off as a review. Theme badges ride on the day
  cards; the `SHIFT TONIGHT` slot is reserved, dashed and labelled inert (D8).
  **S4 — EVENT ZOOM.** One sheet, one primary action, branch chosen by the
  ENGINE (`activeCue`) **and scoped to TODAY's card** — a cue-id-only comparison
  offered "perform tomorrow's show" and was caught by the live pass. PERFORM is
  withheld out of window (takeover refuses to arm there; a button that can only
  400 is a lie), while TRAVEL stays available while the plan is **dormant** —
  the rehearsal case, and the rig's state today. A global `ZoomBanner` mounted
  outside `<Tabs>` floats over EVERY surface: green `🎚 PERFORMING`, purple
  `🕰 TIME TRAVELING` with `◀ ▶` steppers, EXIT on every client, and the D3 line
  **"Show due: … — starts when you exit"** with ENABLE. Presence pings (30 s,
  banner-scoped) keep a hands-off performance alive and die with the banner, so
  the never-stuck invariant survives. `PendingProgramOverlay` now **stands down
  under a zoom** — it would otherwise count down to an auto-start the engine has
  deferred, two surfaces contradicting each other mid-show. GATES: tsc clean,
  CaptainPad **914 pass / 6 skipped / 0 fail** (+22 new pinned tests), lint clean
  on touched files, security PASS. **LIVE-PROVEN on a fresh `:7167` dist against
  a real engine** — the operator's `:6967` Expo was never touched: day zoom on
  the dormant shipped plan, PERFORM over the deck, TIME TRAVEL over the deck,
  the deferred banner four minutes into a hands-off performance with the deck
  fully live underneath, stepper retargets (23:50 → 12:51 → 00:30), the boundary
  400 printed **verbatim** (`no prev event on …`, never clamped), a second client
  rendering the banner without auto-exiting, and the whole D3 loop end to end —
  the deferred show was **not dismissed**: on lease release `_catchUp` fired it.
  **One real bug found by the live run, fixed and pinned:** the engine clears the
  zoom and broadcasts on its own 1 s tick, which beats our `resume()` response
  back, so the operator's own tab-return exit raised a *"zoom ended"* alarm at
  the person who had just asked to leave — the exit claim is now staked before
  the request leaves. **Honest slip reported (`_97` §4.4):** the first
  verification engine streamed sACN to a real LED controller for ~30 s, because
  `--dest` does **not** override `config.yaml`'s per-controller `controllers:`
  block. Killed on sight, host black-holed for every later run, `config.yaml`
  snapshotted and **restored** — which also clears `_98`'s loopback-host commit
  blocker. The throwaway in-window probe plan was deleted and the test_bench
  timeline dir `diff -r`s IDENTICAL to its pre-run snapshot. Engine and dist
  server shut down at the end, so `_99`'s deferred `launcher.js prod` is
  unblocked. **S5 (e2e) is what remains of the zoom wave** — `_97` §7 lists the
  eight scenarios, the two exit paths never exercised live (engine restart
  mid-zoom, plan-save mid-zoom), and the `--dest` trap the runner must assert.

- **2026-07-31 — `_99`: the sACN input bridge's `addMembership EINVAL` boot
  crash, root-caused and killed.** The brief's hypothesis was a NIC/multicast
  condition; it is **not** — a direct probe joins five groups successfully with
  the interface unset, `0.0.0.0`, and the adapter's own address. The bug is
  **ours, and it is an ordering race**. `new Receiver({universes})` keeps *our*
  array (`this.universes = universes`) and joins each entry from inside the
  socket's `listening` callback, i.e. a tick later, **iterating that live
  array**. `sacn_bridge.js` then called `recomputeRoutes('boot')`
  synchronously, and `addUniverse(u)` joins `u` **now** and pushes it into that
  same array — so the deferred loop joined it a **second time**, and a duplicate
  `IP_ADD_MEMBERSHIP` is `EINVAL` on Windows. The package reports that as
  `receiver.emit('error')`, the bridge had **only** a `packet` listener, and an
  EventEmitter `'error'` with no handler **throws** — the input bridge died
  before relaying a frame, with a bare stack trace naming no interface and no
  universe. The reproduction is damning: the bridge's own subscription log
  printed `added:[38], failed:[]` — *success* — and the process was dead a tick
  later. **What changed was DATA, not the box**: the trigger is any universe in
  the boot union that is absent from the boot subscription list, and when the
  `📡 Subscribed Universes` field is set it **replaces** the patch-derived list
  outright — so a scene patched to a universe the field does not name crashes
  the bridge at boot. `_92` passed through exactly that state on U38/U39, and
  `_92` §A8 step 1 (attach the TE signs to a MarsinLED output) re-creates it.
  **The fix is four things, none of them a fallback:** a **boot gate** — nothing
  subscribes until the receive socket is listening, the held reason is replayed
  in full one tick later, and every deferral prints a line (ordering, not
  suppression); a **classified `receiver.on('error')`** — an `addMembership`
  failure is loud and isolated, naming the interface, stating that UNICAST still
  arrives while MULTICAST does not, and pointing at the config lever, exactly
  the contract `applyUniverseSubscriptions` already documents for the runtime
  path, while **every other socket error is FATAL** (`exit 1`, "refusing to run
  half-alive"); a **self-policing invariant** at `listening` that hard-exits
  naming the racing universes and saying *fix the ordering, do not retry*, so a
  future refactor fails at startup with the diagnosis pre-written; and
  **deterministic, logged interface selection** — the boot log now always says
  which interface the joins go to plus the full IPv4 inventory, warns when
  several NICs are up (the OS choice is a coin flip) or none is (the brief's
  original hypothesis, now a named diagnosis), and an optional `sacn_interface`
  in `simulation/config.yaml` pins it, **throwing with an inventory** on a
  mismatch and on an ambiguous adapter — never a silent switch to another NIC.
  Proven end-to-end by re-creating the divergence against the real bridge
  (field narrowed to 1-27 while titanic patches U30/U31): held → listening →
  `runtime-subscribed U30/U31`, no EINVAL, no exit; `common.yaml` restored
  **byte-clean**. Sim **1590 tests / 8 fail = the documented baseline 8, zero
  new** (+19, including two LIVE receivers that pin both orderings). Two
  follow-ups filed: the field still **replaces** rather than widens the boot
  list, and `launcher.js prod` has **no `--no-force`** — it can only start by
  killing whatever holds its ports, which is why the prod profile was held off
  while `:6968` belonged to `_97`/`_98`. **The prod bring-up was ultimately
  REFUSED by the permission gate** (blocked-by-classifier) and not worked
  around, so the sim servers are up on :6969-:6972 + UDP 5568 pinned `titanic`
  and the engine is not — `node launcher.js prod --scene titanic` finishes it
  in one command now that :6966/:6967/:6968/:7167 are all free.

- **2026-07-31 — `_98`: the timeline bugfix wave. Seven findings from `_93` and
  `_95`, fixed engine-side, each with a before/after dry-run transcript on the
  REAL `playa_default`.** (1) **A suppressed party fire now consumes NOTHING.**
  `triggers.js` is pure and stamps the cooldown + burns the one-fire-per-arrival
  arm latch at evaluation time; the arbiter then dropped the fire, and
  `moodArmed` only re-arms on a return to CALM — so one suppression inside the
  burn-night hold killed party for the whole night. The SERVICE now snapshots
  both maps and rolls them back for every dropped mood fire (the same invariant
  the `partyEnabled` gate already states: *suppression suppresses the SHOW, it
  does not consume the trigger*). **Burn night + continuous music: 0 sessions →
  27**, the first landing on the exact tick the hold ends. `wouldFire` went
  edge-only (the trigger now legitimately re-asks every tick). `getPartyStatus`
  gained `triggerArmed`; **no new `effectiveState` value** — CaptainPad throws on
  unknown ones. (2) **catchUp disarms the baseline BEFORE applying a caught-up
  program**, matching the live path: a restart/resume/savePlan/lease-release
  inside any hold used to freeze the deck (`ap OFF`, one pattern for 90 min) and
  now cycles (`ap 90s seq`). (3) **An ambient cue can no longer overwrite a live
  program's look** — it obeys the mood layer's gate (`controller === 'autopilot'`)
  and is surfaced as a suppression instead; the burn show keeps all 120 of its
  minutes (was 30). (4) **Program looks with no `autopilot` block** are now a
  LOUD authoring lint (`lintShowPlan` → `console.error` + additive
  `planWarnings` on `/timeline/state`) rather than a silent 2am freeze —
  deliberately NOT a load-time throw, because that would refuse to load the
  operator's running show. **His plan trips it 3× and still loads:** `sunrise`,
  `burn_night`, `temple` each need a three-line autopilot block — **his edit**.
  (5) **The background phase look survives multiple sessions.** `kind: ambient`
  is the plan's background layer; a timed session is a temporary punch-through,
  so the displaced owner is remembered and re-applied when the window elapses
  (fails closed: still enabled, still ambient, and for a phase trigger only while
  the phase is still active). 0 h 40 m → 7 h 04 m on a two-DJ-set night. The day
  `c_party_start` is re-pointed at the `ambient` look, this same mechanism gives
  exactly "ambient → session → ambient". (6) **`_95` F1 fixed** — the boot
  baseline no longer reloads `plan.autopilot.playlist` over a restored
  non-program cue; the `clobberedByBootBaseline` pin flipped to assert-the-fix.
  (7) **G1 conformance** — a hold expiring naturally hands the deck to the
  ambient `defaultCue` (runtime, boot AND ribbon), palette reset included;
  `source:'hold-expired-baseline'` is never emitted again. **Quiet night:
  `ambient` 0 h → 12 h 20 m (51 %)**. Timeline suite 387 → **407/407**; full
  engine 2449/2459 (8 pre-existing/environmental + 1 parallel-load flake + 1
  caused by a concurrent thread's `config.yaml` edit). **`whenPhase` restoration
  on the party cue remains operator-gated — his scene file, untouched.**
  ⚠ **`marsin_engine/config.yaml`'s declared controller host is currently a
  loopback black-hole (a concurrent thread's edit, not `_98`'s) — restore it
  before any commit.** Report: `20260725_98_timeline_bugfix_wave.md`.

- **2026-07-31 — `_92` ADDENDUM: the TE signs are LED, not DMX. The DMX
  placeholder is gone and both signs are mappable MarsinLED fixtures.** Operator
  correction: *"the TE signs must be associated with MarsinLED controllers …
  I saw DMX ones, that's wrong! … make sure the TE sign fixtures are clearly of
  type LED not DMX."* He is right — the earlier fix parked them on a DMX
  placeholder gateway because that was the only thing the mapping chain would
  let a `parLights` fixture attach to. **REMOVED:** the whole
  `TeSigns-PLACEHOLDER` controller (17 → 16 controllers), all four sign patch
  records, universes 38/39 from the subscribed field, and the DMX whole-fixture
  patch on all 148 sign pixels. **ADDED — a new first-class kind, the LED PIXEL
  FIXTURE:** a `parLights` fixture whose DEFINITION declares `bus: led` (the TE
  Sign V3 halves have said so since they landed). It keeps its baked per-pixel
  logo geometry but is wired exactly like a strand — one MarsinLED output,
  cursor at (port universe, ch 1), stride bytes per pixel — so it takes the
  strand's per-pixel patch, the strand's record shape, and `type: 'led'` model
  pixels. The hinge is one new pure module `src/dmx/led/led_fixture_kind.js`
  whose `ledMappableCounts()` is the UNION of strands and LED fixtures: both LED
  projections already key purely off that map, so **neither projection changed
  at all**. Threaded one call site each through `main.js`, `controller_registry`
  (`projectOntoConfigs` gained `ledBusNames` — LED fixtures are still NUMBERED
  but their addresses belong to the LED pass), the exporter, the mapping pane,
  the save-server and the parity validator. Classification is DATA, never a name
  list, so **the `fixtureType` strings never changed** — every `te_sign`
  selector still resolves and the `_48` addendum-2 one-panel-per-sign guarantee
  is intact (the 2D layer had already been calling them `kind: 'led'` via a
  hardcoded workaround, now redundant but left in place for old models).
  **Two latent bugs caught on the way:** (1) an LED thing only has a patch
  record while patched, so parking `sectionId`/`fixtureId` there would have lost
  the signs' identity the moment they were unmapped and re-minted different ids
  every boot — identity now lives structurally in `scene_config.yaml` like a
  strand's, seeded with the existing ids so nothing renumbered; (2) a `type:
  'led'` pixel is scaled by the LED last-layer gate keyed on `displayGroup`,
  which the signs lacked — the LED Fixtures panel's On/Brightness would have
  moved their meshes while the raw entry, the 2D tap and the sACN map stayed
  bright (the split `_40` closed for DMX). **LIVE PROOF** (sim servers only,
  engine never started, every `:6970` write aborted): the Controller Mapping
  pane reads `CONTROLLERS (16)`, `DMX CONTROLLERS (12)`, no PLACEHOLDER, and
  `UNMAPPED — 0 FIXTURE(S), 4 STRAND(S)` with the four 💡 TE Sign chips in the
  LED half; both signs still render and light correctly. Sim suite **1571
  tests, 8 fail = the documented baseline 8, zero new** (+12 new tests);
  security check PASS. **Parity is deliberately RED at 4 errors** — the four
  unmapped sign halves. Removing the controller without a replacement (per the
  brief) necessarily re-opens them, and softening `unmapped_fixture` to INFO
  would blind the gate to a genuinely dark fixture. **One operator action closes
  it:** attach the four halves to a MarsinLED output — set that output's order
  to **RGB** (the pucks are RGB; the ropes are RGBW) — and save. `_96`'s
  provisional typed-IP binding, landed in parallel, means the boards can stay
  boxed. Report: the ADDENDUM in `20260725_92_te_sign_patch_model_fix.md`.

- **2026-07-31 — `_95` LANDED: the timeline-zoom ENGINE (slices S1 + S2). The
  `_catchUp` refactor is provably byte-identical — 1 116 scenarios, 0 diffs.**
  Report `20260725_95_timeline_zoom_engine.md`. **S1:** the selection core of
  `_catchUp` is now ONE pure function, `resolveDeckStateAt` in the new
  `marsin_engine/lib/timeline/resolve_deck_state.js` (operator ruling D5) —
  no IO, no `Date.now()`, plan never mutated. It returns two deliberately
  distinct answers: `restored` (what catchUp re-applies, present even when the
  cue's window has elapsed) and `owner`/`playlist`/`palette`/`controller`/
  `source` (what actually drives the deck at T — a live hold owns outright, an
  elapsed `durationMin` window yields to the `defaultCue`). Consumers: catchUp,
  travel, `GET /timeline/resolve`, and the day ribbon. `buildOverview` gained
  additive per-day `phases` (plan-ordered bands, midnight-wrapping) and
  `segments` — the **resolved ribbon**, tiling `00:00 → 24:00` with no gaps,
  built by sampling the resolver at that day's own boundaries. On the shipped
  `playa_default` it puts `_91`'s findings on the wire at a glance:
  `defaultCue/ambient` until 06:08, `c_sunrise` owning **07:53 → 18:49**,
  `c_visibility_on` owning **20:34 → midnight**. **S2:** the operator lease
  gained a `scope` (`perform` | `travel`) — the zoom rides ON the lease, so
  every path that already cleared the lease clears the zoom and a zoom is
  structurally un-strandable (8 exit paths unit-tested, incl. engine restart,
  maker auto-save and lease expiry). New `POST /timeline/travel`
  (`{date,time}` | `{cueId,date?}` | `{step:'prev'|'next'}`) enters a scoped
  takeover and applies the resolved snapshot through the NORMAL dispatch path —
  a **static snapshot** (D4), never a live clock warp, and it writes none of the
  live plan's bookkeeping (no `firedToday`, no cooldown, no `activeProgram`, no
  deck window, no party session). New additive `zoom` field on
  `/timeline/state` + the `timelineState` broadcast. **D3 deferral:** while a
  zoom lease is alive the service pushes `pendingProgram.expiresAtMs` out to the
  zoom lease's expiry — a service-level nudge BEFORE `arbitrate()`, so the
  arbiter module stays pure and untouched. Deferred, never dismissed: ENABLE
  still starts it now, and the zoom exit fires it via catchUp. **A plain
  (bodyless) takeover keeps today's I2 30 s auto-start byte-identical** — pinned
  in both directions. One design gap closed on the way: the dormancy gate would
  have torn down a travel zoom within a second, so `_goDormant` now preserves an
  unexpired travel lease (and only that) — **time travel works while the plan is
  asleep**, which is exactly the bench/rehearsal state the rig is in today
  (`_91` #16). GATES: timeline family **387/387** (was 340), full engine suite
  2434/2442 (the 8 are audio-device/EACCES/playlist-drift, all pre-existing —
  three more files that failed under parallel load pass 47/47, 4/4 and 11/11 in
  isolation), **19/19** REST checks against a real engine with sACN
  black-holed, security check PASS, sim suite not run (zero shared files
  touched). **2 pre-existing engine truths found, pinned by tests, NOT fixed**
  (fixing either would break the byte-identical mandate): **F1** — `_catchUp`
  dispatches the restored cue and THEN lets `_establishBaselineIfActive` reload
  `plan.autopilot.playlist` over it, so a boot inside a non-program cue's live
  window lands on the BASELINE playlist; invisible on the shipped plan only
  because every look already points at `default`, and it will bite the moment
  `_91`'s T1 re-pointing lands. **F2** — `_91`'s G1 is now VISIBLE as
  `source:'hold-expired-baseline'` (the cue keeps the ownership latch while the
  baseline playlist plays under it and the palette is never reset).
  **S3/S4 pad slices build from `_95` §3.**

- **2026-07-31 — `_92` LANDED: the TE signs are patched and the sign model is
  rebuilt from CAD — `scene_model_parity titanic` goes 21 errors → 0, PASS.**
  All four reported defects confirmed from the repo and closed. (1) Both signs
  were unpatched — 148 px with `patch: null`, no controller carrying them at
  all — now chained on a new `TeSigns-PLACEHOLDER` controller (`0.0.0.0`
  sentinel + `PLACEHOLDER` marker, per plan `_33` §O5), U38 for sign 1 and U39
  for sign 2, A@1 + B@121 (222 ch fits one universe); `📡 Subscribed Universes`
  widened by 38, 39 so the IN bridge cannot silently drop them. (2) The A/B
  module names were duplicated across both signs — sign 2's halves are now
  `TE Sign 2 V3 A/B`, which also retires the `~2` dedupe keys the 2D pixel map
  had been inventing. (3) The shared `sectionId 3` + `fixtureId 13/14`
  collisions were a *symptom* of (2): `projectOntoConfigs` keys its config map
  by NAME, so the second sign never entered it. The rename alone let the
  projection mint `TE Sign 2` fresh (sId **415**, fId **2204/2205**) — no id
  surgery. (4) The six disagreeing strands are named:
  `Left_Front_Right`, `Left_Back_Right`, `Right_Front_Left`, `Right_Back_Left`,
  `Right_Front_Right`, `Right_Back_Right` — every strand on the three rope
  controllers with **no `device:` binding**. `main.js` writes `patches.yaml`
  from the device-bound projection only (no binding → no record → no bridge
  route), while the exporter seeded its lanes from the GENERIC projection and
  handed them addresses anyway: the engine rendered onto U32–U37, the bridge
  forwarded nothing, six ropes dark with every surface green. **patches.yaml
  wins** (operator's ruling): the exporter now builds its lane table from the
  bound projection alone, so an unbound strand exports `patch: null` +
  `unpatched: true`, loudly. The other direction would have created relay
  routes to three real rope controllers — device traffic this order forbade.
  Blast radius is exactly those six: every LED controller in every other scene
  is device-bound. **Model rebuild:** the sign's geometry lives only in
  `simulation/dmx/fixtures/te_sign_v3/model_{a_120,b_102}.yaml`; both were
  regenerated by the new reusable `simulation/tools/gen_te_sign_fixture.js`
  from the CAD CSVs. The point sets are IDENTICAL old→new — the delta is
  **wire order** (A: P9→P10→P1→P2→P3→P4→P11; B: P8→P7→P6→P5), i.e. which LED
  takes which DMX channel. Normalization is ONE shared factor over A ∪ B —
  `k = 1/2165.1 mm`, giving A `u 0…0.539, v 0.333…1.0` and B `u 0.269…0.731,
  v 0…0.800` — deliberately NOT 0…1 per side, which is what keeps the two
  halves interlocking instead of stacking. Y is not inverted vs the CSV.
  Verified: parity PASS (8 honest INFO, all promoted by `--strict`), sim suite
  1482/**8 fail** (10 → 8, zero new — every delta explained in the report §6.2),
  engine suite unchanged, security check PASS, and eyes-on renders of both signs
  lit with a wire-order chase plus the 2D `te_sign` view resolving one panel per
  sign (the `_48` addendum-2 regression is not back). Re-export ran through the
  sim's own save path — **no interactive operator step left**, no engine restart
  (pixelCount unchanged at 964, hot-reloaded, `modelStale: false`). Two hardware
  items remain yours: the sign controller's real IP, and binding the three rope
  controllers (both need device conversations). Report:
  `20260725_92_te_sign_patch_model_fix.md`.

- **2026-07-31 — `_93` LANDED: the timeline dry-run harness — a whole playa
  night in seconds, offline.** `_91`'s recommended first build, shipped as
  `marsin_engine/tools/timeline_dryrun.mjs`. It drives the **real** show code
  — `loadShowPlan`, `TimelineService._tick()` with an injected `nowFn` and
  `getMood()`, the real `triggers.js` evaluator, the real `arbiter.js`
  precedence, the real sun/tz/festival math, the real `PlaylistManager` and the
  real autopilot picker — against recording fakes that mirror the engine's own
  contracts, including the fail-loud "a playlist with no loadable entries
  throws". Zero sACN, zero network, no engine, and the plan is COPIED to
  `~/tmp` before the service sees a directory, so it physically cannot write
  into `simulation/scenes/**`. The dormancy problem is solved two ways: an
  out-of-window `--date` is a **loud refusal** naming the window, and
  `--fixture` runs a committed, date-free bench plan
  (`tests/fixtures/timeline/dryrun_bench.yaml`) that carries **no `festival`
  block** — the engine's own always-in-window escape hatch, mirroring the
  shipped show's shape and pointing at real titanic playlists. Flags cover the
  clock (`--date/--from/--days/--to/--step`, all independent of today), the
  mood track (four built-ins incl. `quiet` and `loud_stereo_1500`, plus
  `--mood-file`), reproducibility (`--seed`), what-ifs through the REAL
  `setPartyConfig` (`--party-config`), and output shaping
  (`--events-only`, `--engine-log`, `--out`). Each step prints playa-local
  time, phase, controller, deck OWNER, playlist ▸ pattern, autopilot, palette
  and party state, with cue fires (and WHY), lifecycle rows, **suppressed
  `wouldFire`s with the arbiter rule that dropped them**, and party-session
  transitions; the run closes with deck minutes by playlist / owner /
  controller / palette, fire + suppression counts, session outcomes, and
  playlist health as the engine actually resolved it.
  **Four 24 h nights at 1-minute resolution were run for the record.** They
  confirm `_91` on the shipped plan: the 90 min hold expires onto the autopilot
  **baseline**, not the `ambient` defaultCue (G1); `c_party_start` owns the
  deck **8 h 40 m** unbroken (G2); and a 40-minute daylight stereo fires
  **three** full party sessions at 15:02 / 15:16 / 15:30, exactly the missing
  `whenPhase` gap. Two measurements sharpen the arc picture: on a QUIET night
  the `ambient` playlist gets **zero minutes** (every deck cue is a
  no-`durationMin` cue, so the defaultCue never gets the deck back), and
  `c_sunrise` — not `party` — is the single biggest owner at 12 h 35 m because
  it holds the deck all day.
  **Five NEW bugs, all report-only (`_93` §5), nothing in the timeline logic
  was touched.** Worst: a **suppressed** party fire still consumes the
  arm latch and stamps the cooldown (`triggers.js:256-259` bookkeeps before
  `arbiter.js:174-180` drops the fire; `moodArmed` only re-arms on a return to
  CALM) — so on burn night **8 hours of continuous music produced 0 party
  sessions** after one suppression under the burn program's hold, where the
  same script on a normal day gave **35**; and the PARTY card would read
  "armed" the whole time. Also: `_catchUp` disarms the deck autopilot AFTER
  applying a caught-up program's look, so any restart/resume inside a hold
  freezes the deck on entry 1 (the live fire path does it in the opposite
  order); an `ambient` cue overwrites a running program's look while the
  program keeps precedence (harmless today, wipes the burn-night show the
  moment `_91`'s T1 re-pointing lands); program looks with no `autopilot`
  block freeze the deck for the whole 90–120 min hold (authoring); and the
  first party session permanently evicts the `party` look for the night.
  **Both `_91` fix-on-sight items done:** `.agent/ops/timeline_e2e_tests.md`
  S5 rewritten (it asserted a `mode='paused'` deleted in the 2026-07-03
  simplification, and drove a DISABLE PLAN button that no longer exists), with
  S1, S10 and the level table cleaned up in the same pass per the doc standing
  order; and `timeline_deck_release_default_cue.test.js` now mutes
  `console.log`, so it passes 9/9 run alone instead of tripping the Windows
  `node:test` IPC flake. Gates: engine timeline suite **317 → 340/340** (+23
  harness tests), full `npm test` 2387/2395 with **zero new failures** (the 8
  are the documented environmental + full-run-pollution + operator
  playlist-drift set), security check clean on every touched file, sim
  untouched. No git operations.

- **2026-07-31 — `_94` DESIGN LANDED: timeline zoom (day zoom + event
  zoom).** Design-only thread for the operator's two verbatim features.
  Delivered `20260725_94_timeline_zoom_design.md`: one navigation ladder
  (FESTIVAL week strip → DAY calendar view → EVENT = the deck itself), where
  the two browse levels are pure client UI and only the event level touches
  the rig. **Day zoom** promotes the existing 8-day strip + DayEditor and
  adds the two things review needs: per-day phase bands and a RESOLVED
  "what actually plays" ribbon (which renders `_91`'s G1/G2 findings visibly
  instead of hiding them), plus a reserved day-header slot where the
  postpone/shift build (`_91` §3.1a) would live. **Event zoom** maps onto the
  EXISTING arbiter human layer — a scoped takeover (`operatorLease.scope
  'perform'|'travel'`), no new controller, no parallel ownership: PERFORM =
  takeover whose only new semantics is deferring (never dismissing) a due
  program's 30 s auto-start while zoomed; TIME TRAVEL applies a snapshot from
  a new pure `resolveDeckStateAt` (extracted from `_catchUp`, cross-checked
  against the `_93` harness's throwaway-service recipe) to the real deck
  under the takeover — a live clock warp was explicitly rejected because
  catchUp's `firedToday` latches would cancel the real night. Every exit
  path (timeline-tab return, EXIT, lease expiry via presence pings, engine
  restart, autopilot off, plan save) funnels through resume/catchUp, so the
  PAUSE/HOLD-removal "never stuck" invariant is preserved. Engine surface:
  additive overview `phases`+`segments`, `GET /timeline/resolve`, takeover
  body `{scope}`, `POST /timeline/travel`, `zoom` field on `timelineState`
  (runtime-only). 8 open decisions (D1–D8, each with a recommendation) and 5
  independently-landable slices (S1 resolver, S2 zoom scopes, S3 day zoom
  UI, S4 event zoom UI, S5 e2e) await the operator's go. Zero code/scene
  writes; design report + ledgers only.
- **2026-07-31 — `_91` LANDED: show-infrastructure audit + test plan.**
  Read-only sweep of the whole show stack against the operator's requirements
  (incl. the new 2026-07-31 refinements): timeline mechanics, theme nights,
  the party-trigger chain, playa time + postpone, a 68-pattern × 13-playlist
  coverage matrix, and testability. **The verdict splits cleanly: the
  MACHINERY is strong, the SHOW is not.** The engine is the sole consumer of
  `scenes/<scene>/timeline/*.yaml` (sim/launcher read nothing); sun anchors,
  tz math and the festival span are pure, DST-correct and clock-injected;
  precedence (human > program > autopilot) holds; **317/317 timeline unit
  tests pass**; every failure path is loud. But the plan on disk is a lightly
  edited copy of the built-in template — **6 of its 8 reachable looks load the
  `default` playlist, and that playlist is 45/72 unreachable entries (all
  `summer_camp` names, silently skipped by autopilot) and 66/72 untuned**.
  Nine of thirteen playlists are referenced by NOTHING, including both fully
  tuned ones (`temple_white`, `white_wednesday`); the `burn_night` and
  `temple` looks point at `default` instead of their own playlists; `daytime`
  and `party_low` are dead looks. Two structural findings on the night arc:
  a program's hold expiring naturally lands on the autopilot **baseline**, not
  the `ambient` defaultCue (only boot / durationMin-elapse / END SHOW reach
  it), and `c_party_start` owns the deck with **no expiry** from sunset+120 to
  sunrise−15 — so "look: party" runs ~8 h and ambient is the exception, the
  inverse of the requirement. Against the refinements: **"fires from ambient
  only" is PARTIAL** — the only gate is `controller === 'autopilot'`, which
  blocks takeovers and program holds but not the `kind: ambient` party look,
  and the on-disk cue **dropped the `whenPhase: party_night`** the template
  ships, so party can fire in daylight. **"VJ night stands down" is MISSING**
  as a mode (manual `partyEnabled` toggle or a hand-authored `days:`
  exclusion only). **Playa time is fully SUPPORTED** (engine + CaptainPad both
  reason in the plan tz, explicitly so the tab is right off-playa);
  **POSTPONE is MISSING** — PAUSE/HOLD were removed in the 2026-07-03
  simplification, leaving only takeover (auto-resumes), AUTO OFF, DISMISS and
  hand-editing the plan. Short sessions, END-anchored cooldown, always-on
  dwell and human-wins are all SUPPORTED and test-proven. Testability: the
  cores are clock-injectable and the tests exploit it, but the rig is
  copy-pasted per file with fake deps — **there is no way to fast-forward a
  playa night**, no dry-run tool, and the committed e2e runner the ops spec
  asks for still does not exist. Blocking everything: today is outside the
  festival span, so the plan is **dormant** (`controller: manual`) and nothing
  can be observed without a run-time in-window fixture plan.
  **Recommended first build: `tools/timeline_dryrun.mjs`** — load the real
  plan, inject the clock, print a minute-by-minute playa night (phase,
  controller, cue fires, deck playlist, suppressions) with zero device
  traffic; 4–6 h, and it turns every open show question into a 5-second
  answer. Full findings, GAP LIST (16 rows) and the ordered 4-phase test plan:
  `20260725_91_show_infra_audit.md`. Zero code/scene writes; playlists and
  `patterns/**` measured only (ChatGPT+operator territory). Also flagged:
  `.agent/ops/timeline_e2e_tests.md` S5 asserts a `mode='paused'` that no
  longer exists.

- **2026-07-31 — MILESTONE + focus shift to the SHOW.** Operator declares
  the titanic **fully mapped**, sim working, 2D vis pattern-check ready; he
  has started the ChatGPT tuning loop live off the `_90` prompt ("creating
  views and then slowly tuning patterns"). New declared focus, his words:
  "let's you and me focus on timeline and planning and having fun with
  that!" — coordinator engages directly on the show timeline
  (`scenes/titanic/timeline/playa_default.yaml`, sun-phase looks), playlist
  curation (13 playlists over 78 patterns), and the ambient-by-default /
  alive-at-party-moments arc. Pattern files are now operator+ChatGPT
  territory — agents touch them only on explicit hand-over.

- **2026-07-31 — `_89` LANDED: the test bench became a window onto the ship.**
  Operator order "set up test bench to show part of the titanic scene for me —
  led bars, par lights and vintage lights! LED strings too." The measurement came
  first and decided the design: only the **pars** line up (titanic pars sit at
  1/11/21/31 in seven universes, exactly where the bench's are), while **no**
  titanic bar starts at 107/226 and **no** vintage at 41/74 in any universe — and
  a DMX start address lives in the physical fixture. So pure config solves one
  third and the rest of the bytes have to move. Built the minimal bridge-side
  option: a **bench mirror**, a per-destination list of slices
  (`source universe/addr/length → dest addr`) composed into the universes the
  bench boxes ALREADY listen on, which is why the change needs **zero controller
  pushes and zero gateway edits**. The slice is the ship's **left front**, one
  contiguous neighbourhood so spatial patterns read correctly: Left Auditorium
  5-8 → Par 1-4 (a byte-for-byte identity copy, the alignment finding put to
  work), Left Front Rails 1/2 → Vintage Left/Right, Left Front Wall 1/2 → Bar
  Left/Right, and the two port ropes' first 20 pixels → LED_0/LED_1. Every source
  is a fixture with a real `patches.yaml` record, so a re-export cannot silently
  darken it. Activation needs **three** preconditions, none of them a fallback:
  `enabled: true`, the ENGINE on the declared source scene (the wrong model would
  splice par bytes into a bar's control channels), and the spec's own scene
  active — the last being the deployment guard, so the file can ride a
  `robocopy /MIR` onto the show server and stay inert while the ship's real
  gateway keeps its ordinary relay. While active the mirror OWNS its destination
  pairs and the raw relay for exactly those is suppressed with a named log line
  (one-writer law, `_15`). Proven by loading the REAL bridge with fake
  `sacn`/`ws` — his stack on 6967-6972/5568 was never approached — with the
  composed bytes exact at every fixture boundary and both inert scenarios
  restoring normal bench behaviour. Sim suite 1452 → 1482 (+30), fail 10 → 10,
  byte-identical list; the new file is 30/30 and six of those are **live-map**
  tests that read the committed spec against the real scenes and models, so the
  map cannot rot in silence. Visual check ran under four guards including
  aborting every non-GET to the save server, because `saveModelJS()` on page boot
  would otherwise rewrite the operator-owned titanic export; `git status`
  confirms zero writes to `scenes/titanic/**` or `marsin_engine/models/**`. His
  only possible push is a **revert**: if the strands stay dark, the `.60` box is
  still on the ship's rope universes from the titanic-scene push whose receipt
  reads `needs-reboot`, and one Push on the `Titanic_202` card in the
  **test_bench** scene puts it back.

- **2026-07-31 — `_90` LANDED: ChatGPT pattern-tuning prompt pack.** Operator
  order "let ChatGPT fine tune our patterns", his chosen loop being manual
  copy-paste (he passes the prompt himself; ChatGPT has no repo or network).
  Delivered `20260725_90_chatgpt_pattern_tuning_prompt.md`: a how-to-use header
  plus a 482-line self-contained prompt covering the pattern file format, the
  complete MarsinScript API (nothing outside it exists), nine hard rules
  (slider declaration order = MFT knob order, `localSpeed` 1st / `direction`
  2nd, ≤12 sliders, guarded direction dead-zone, `w == a`, RGB-space palette
  blending, coords arrive 0..1, no fallbacks, no invented API), the titanic
  coordinate space and `FIX_*` fixture targeting, ambient-vs-party style
  doctrine, a strict response contract (COMPLETE file in one block, never
  reorder/rename an existing slider, short Changes list, ask rather than
  guess), and a full worked example. The example was **compiled and measured
  on the real offline harness** from a scratch path — `COMPILE_OK`,
  hueSpread 0.79/0.97, peakMaxChan 247/255, silence-safe, PRIMARY corr 0.52
  REACTIVE — so the `FIX_*` targeting, the guarded-direction idiom and the
  `w == a` emit are proven against the live compiler, not transcribed. Doc-only:
  zero engine/sim changes, nothing added to `patterns/`, no git ops. Open note
  carried in the report: on the ship `sectionId` is NOT 1/2/3, so legacy
  `sectionId == 2` blinder branches do not select the vintage heads there —
  the prompt steers new logic to `fixtureType` and forbids touching the legacy
  branches unasked.
