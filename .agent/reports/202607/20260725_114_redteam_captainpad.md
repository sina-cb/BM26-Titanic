# `_114` — RED TEAM: CaptainPad, the timeline ZOOM LADDER

**Operator order (2026-07-31):** *"adversarial test the system to break it in the
name of bulletproofing and finding quirks."* Surface: **CaptainPad**, especially
today's zoom ladder (`_97`) against its engine contract (`_95` §3), hunting what
`_100`'s committed e2e suite deliberately did **not** cover — `_100` §3.3 states
the pad's own toast/navigation "remains unit-pinned pending the DOM runner". This
thread **is** that DOM runner, pointed the wrong way round.

**FIND AND DOCUMENT, DO NOT FIX.** Zero source edits, zero suite edits, zero git
operations. Everything lives in `~/tmp/redteam_pad/` (gitignored).

---

## 0. Findings

**17 P-ranked findings: 5 × P1, 6 × P2, 6 × P3. No P0.**
Five of the P1s were reproduced **live in a browser**, on a fresh
`npm run web:build` dist, against a scripted hostile engine.

| # | Sev | Finding | Proof | Root cause |
|---|---|---|---|---|
| **F1** | **P1** | **One `resume()` permanently disarms the "zoom ended" alarm.** After pressing RESUME NOW once, an engine restart / lease expiry / autopilot-OFF / maker auto-save mid-zoom leaves the operator standing on a deck they no longer own — **no toast, no navigation back** | LIVE `R2`, `R2m`, control `R2b` | `hooks/useTimeline.ts:171` + `:259` + `:453`, cleared only at `components/timeline/ZoomBanner.tsx:88` |
| **F2** | **P1** | **The zoom banner keeps asserting a live lease after the link dies** — 20 s (and forever) after the socket died AND the engine released the lease, the pad still reads `🕰 TIME TRAVELING … viewing the plan, not tonight` with a green `● ENGINE` dot | LIVE `R1` + shot `r1_b_link_dead_20s.png` | `hooks/useTimeline.ts:112-114` keeps the last state on disconnect; `ZoomBanner.tsx` never reads `connected` |
| **F3** | **P1** | **One unknown `transition.mode` white-screens the WHOLE pad** — every tab, the ZoomBanner and the plan-lock banner vanish together. CaptainPad has **no React error boundary anywhere** | LIVE `R6` (rendered text length **0**) | `components/timeline/timelineTemplate.ts:185` — `DECK_TRANSITION_MODE_LABEL[mode].toLowerCase()`, unguarded |
| **F4** | **P1** | **An EMPTY ribbon passes as a completed review** — `segments: []` suppresses the loud red block and renders a blank "RESOLVED · what actually plays" column | LIVE `R5` + shot `r5_empty_ribbon.png`; probe `B1` | `components/timeline/DayView.tsx:239` — `Array.isArray([])` is `true` |
| **F5** | **P1** | **A stepper press makes pad B claim it entered the zoom**; B's next tab-return then ends pad A's zoom — the exact D1 violation the gate exists to prevent | LIVE `R8` (engine zoom → `null`, A's banner gone) | `hooks/useTimeline.ts:298` sets `_zoomEnteredHere = true` on EVERY travel |
| **F6** | P2 | **An unknown `zoom.scope` silently renders as TIME TRAVELING** with ◀ ▶ steppers that can only 400. `null` / `undefined` / `''` do the same | LIVE `R4`; probe `A1` | `components/timeline/zoom_logic.ts:195` is an `if/else`, not a `switch` |
| **F7** | P2 | **`timelineState` has no parse contract.** A frame containing only `{type, mode}` was accepted and **replaced the entire state** — plan name, deck lock, cue list, zoom | LIVE `R11` | `hooks/useTimeline.ts:90-92` `_isTimelineState` checks one string |
| **F8** | P2 | The zoom-ended announcement is a side effect of ONE mounted component. If the banner is unmounted across the transition (F3 crash, route remount) the claims are never cleared and the notice never fires | code | `ZoomBanner.tsx:79-97` owns `hadZoomRef` + `clearZoomClaims()` |
| **F9** | P2 | **The pending-show guard is coupled by proxy** — the strip hides on `state.zoom` truthy, not on the banner actually carrying the deferred line. With `pendingProgram` armed and `pendingDeferred` null, BOTH surfaces are silent | LIVE `R14` | `PendingProgramOverlay.tsx:85` |
| **F10** | P2 | **A 24 h phase is drawn as nothing**, and a phase that ENDS at midnight is mislabelled `⤵` (wraps into tomorrow) plus a zero-length ghost piece | probe `C1` | `zoom_logic.ts:67-73` |
| **F11** | P2 | **No offline surface after the first state.** `isOffline` can never become true again, and a clean WS close carries no `lastError`, so no banner and no error line either | LIVE `R1` | `app/(tabs)/timeline.tsx:739` |
| **F12** | P3 | Non-tiling ribbon segments are **silently dropped** — 3 of 5 vanished in the probe, leaving 06:00–22:00 blank with no warning | probe `B2` | `zoom_logic.ts:120` |
| **F13** | P3 | Two "HH:MM" parsers with different contracts drive one day chart: `localToMinutes('24:00') = 1440`, `hhmmToMinutes('24:00') = null` | probe `C2` | `zoom_logic.ts:28` vs `timelineTemplate.ts:90` |
| **F14** | P3 | `deferredShowText` renders `Show due: undefined — starts when you exit` for a wrong-typed `pendingDeferred`, and `Show due:  — …` for empty label+cueId | probe `D1` | `zoom_logic.ts:181-185` |
| **F15** | P3 | `planTz` falls back to the **DEVICE** timezone when the overview has no `location` — the NOW playhead and "today" silently leave playa time | code + probe `R16` | `app/(tabs)/timeline.tsx:404-410` |
| **F16** | P3 | A future `CueKind` renders the literal string `undefined` in the day agenda and the event sheet | probe `A4` | `DayView.tsx:342`, `EventSheet.tsx:100`, `DayOverviewStrip.tsx:238` |
| **F17** | P3 | A fetch timeout reaches the operator as **"signal is aborted without reason"** | shot `r1_b_link_dead_20s.png` | raw `AbortError.message` passthrough in the party card's error path |

### What HELD (attacked, did not break)

| Attack | Result |
|---|---|
| EXIT against a 500 on `/timeline/resume` | error surfaced verbatim, EXIT stayed retryable, recovered cleanly (`R12`) |
| 8 rapid ▶ presses at a plan edge (400 every time) | the engine's `no next event on …` printed **verbatim**, never clamped, no crash (`R13`) |
| 4000-char `pendingDeferred` label + 400-char event label + embedded newlines | clipped to one line; `body.scrollWidth === innerWidth`, page never widened (`R9`) |
| A day with **0** cues and a day with **60** | both render, no throw (`R15`) |
| 6 × CONFIG↔TIMELINE round trips while holding an entered zoom | exactly one resume, no storm, no crash (`R17`) |
| Every REST route 500 with an HTML body | pad stayed usable and interactive (`R7`) — though see F11 for what it did *not* say |
| `shouldAnnounceZoomEnd` itself | correct across its whole truth table (probe `E1`). The bug is entirely in **who sets its inputs** |
| `nowPartsInTz` | correct in any real IANA zone and fails to `null` (no today, no playhead) on a malformed one — the playa-time claim holds *when the plan carries a location* (F15) |

---

## 1. Method

Two rigs, both in `~/tmp/redteam_pad/`, both read-only against the repo.

**A. `probe_pure.ts` — the pure derivations, run directly.**
`zoom_logic.ts` and `timelineTemplate.ts` are imported **as they ship** (node 24
`--experimental-transform-types` + a resolve hook that maps `@/…` and stubs the
three RN-flavoured leaves). Nothing under test is re-implemented. Output:
`probe_pure.out`.

**B. `hostile_engine.cjs` + `redteam.cjs` — the DOM runner.**
A scripted adversarial stand-in for the engine's REST + `/ws/control` surface,
driven at runtime through a `/__ctl` channel so a scenario can make it answer
takeover `200` then broadcast a **different** zoom, drop and refuse sockets,
replay stale frames, ship future enum values, 500 everything, or hang. The pad
is a **fresh `npm run web:build` dist** (never Metro —
`metro-stale-watcher`), served on **:7900**, pointed at the hostile engine on
**:7901** via `localStorage.API_BASE` set before boot. Console muted in
`evaluateOnNewDocument` before navigation, per
`captainpad-screenshot-technique`. 17 scenarios, screenshots in
`~/tmp/redteam_pad/shots/`, verdicts in `results.json`.

Where a finding is code-only, the table says `code`; where it was seen on screen,
it names the scenario and the shot.

---

## 2. The five P1s

### F1 — one `resume()` permanently disarms the "zoom ended" alarm

`_zoomExitRequested` (`useTimeline.ts:259`) is a **module-level global**. It is
staked at `:171`, *before* the resume request leaves — correct, and exactly the
race `_97` §3.4 found and fixed. But it is **never cleared on success**. The only
clearer is `clearZoomClaims()` in `ZoomBanner.tsx:88`, which runs **solely** on an
observed `zoom` non-null → null transition (`:81`).

So any `resume()` whose transition this client never observes **leaks the claim**,
and from that moment `shouldAnnounceZoomEnd({ ours: true, … })` answers `false`
for every engine-imposed exit, forever — across tab switches, across zooms, for
the life of the page.

Two production callers do exactly that:

1. **`useOperatorTakeover.resumeNow` is `resume`** (`useTimeline.ts:453`) — the
   deck/mixer PLAN LOCK banner's **RESUME NOW**, the ordinary hand-back after a
   plain touch-takeover. No zoom is held, so there is **no transition to
   observe, ever**. One press poisons the flag.
2. An **EXIT** whose `resume` answers 200 without actually ending the lease
   (a re-takeover racing it, a proxy answering, the engine re-arming on the same
   tick).

**Both reproduced live**, and both against a clean control:

| run | sequence | "ZOOM ENDED" notice |
|---|---|---|
| **`R2b` (control)** | enter a zoom → engine drops it unasked | **shown** ✅ |
| **`R2`** | EXIT with a 200-but-no-clear resume → enter a zoom → engine drops it unasked | **not shown** ❌ |
| **`R2m`** | mixer PLAN LOCK **RESUME NOW** (no zoom) → enter a zoom → engine drops it unasked | **not shown** ❌ |

Shots `r2_c_after_engine_drop.png`, `r2m_d_after_drop.png`, `r2b_b_after_drop.png`.

**Why it matters.** `_100` X6 proves the ENGINE side of an engine-restart-mid-zoom
end to end, and explicitly leaves the pad's toast/navigation "unit-pinned pending
the DOM runner". This is the gap: the unit test pins the pure decision, and the
pure decision is right — the wiring that feeds it is what leaks. The failure mode
is silent, and it is the one the design exists to prevent: the operator stays on a
deck they no longer own, believing they are performing, while the plan is driving
the rig underneath them.

### F2 — the banner keeps asserting a live lease after the link dies

On a disconnect the bus flips `connected` false and `useTimeline` re-emits
`{ ..._cached, connected: false }` — **the whole previous state is retained**
(`:112-114`). `ZoomBanner` reads only `state.zoom`; it never looks at `connected`.
`useZoomPresence` keeps firing `/timeline/activity` into the void.

`R1`: WiFi dies (sockets terminated and refused, every route hung), the engine
releases the 120 s lease and resumes the plan. **20 s later** — and indefinitely
after that — the pad still shows the purple travel banner. Shot
`r1_b_link_dead_20s.png` carries the contradiction on ONE screen:

- `🕰 TIME TRAVELING · 2026-08-30 · 21:00 · Live event · viewing the plan, not tonight` — with `◀ ▶ EXIT`
- header controller pill `MANUAL`, mood `● CALM`, and a **green `● ENGINE`** dot
- and, two rows below, the PARTY MODE card saying **`ENGINE OFFLINE — cannot reach the engine`**

Two cards, one screen, opposite claims about the same link. The party card knows
because it owns its own fetch; every timeline surface renders a frozen document.

### F3 — one unknown transition mode white-screens the pad

`timelineTemplate.ts:185`:

```ts
parts.push(a.transition ? DECK_TRANSITION_MODE_LABEL[a.transition.mode].toLowerCase() : 'default');
```

`DECK_TRANSITION_MODE_LABEL` has 16 entries. A cue action carrying any other
`transition.mode` — a hand-authored plan, a plan written by a newer engine, a
typo — makes this `undefined.toLowerCase()`. `actionSummary` is called from
`DayView.tsx:342`, `EventSheet.tsx:100` and `DayOverviewStrip.tsx:238`, i.e. from
inside render.

`R6` observed: opening the DAY level threw
`TypeError: Cannot read properties of undefined (reading 'toLowerCase')` and the
**rendered text length went to 0** — a white screen.

The amplifier is separate and worse:

```
$ grep -rn "componentDidCatch|ErrorBoundary|getDerivedStateFromError" CaptainPad --include=*.tsx --include=*.ts
(no matches)
```

**There is no error boundary anywhere in CaptainPad.** Any render-time throw takes
down every tab, the ZoomBanner, the PLAN LOCK banner and the pending-show strip
together — the operator's whole surface, at 3 am, from one bad string in a plan.
This is the single highest-leverage hardening available on this surface.

### F4 — an empty ribbon is accepted as a completed review

`DayView.tsx:239`:

```ts
const hasReviewData = Array.isArray(day.segments) && Array.isArray(day.phases);
```

`[]` satisfies `Array.isArray`. The loud red "this engine returned no
`phases`/`segments`" block is therefore suppressed, and the RESOLVED column
renders **blank** — shot `r5_empty_ribbon.png`, a completely empty grey panel
under the heading "RESOLVED · WHAT ACTUALLY PLAYS".

`_95` §3.1 makes the ribbon's contract explicit: the segments **tile
`[00:00, 24:00)` with no gaps and no overlaps**. An empty array is a contract
break, not a valid day. `_97` §2.4 built the red block precisely so the review
surface would never draw an empty ribbon and call it a review (codex P0) — but
the guard tests for *absence*, not for *emptiness*, and those are different
failures with the same on-screen result.

Related, same class (F12): `ribbonRows` (`zoom_logic.ts:120`) **silently drops**
any segment whose window is unparseable, inverted or zero-length. Probe `B2` fed
5 segments and got 2 rows back — 06:00→22:00 rendered as blank column with no
warning of any kind.

The asymmetry with the sibling probe (`B1`, `segments` present + `phases` absent
→ the red block DOES fire while the ribbon renders correctly) shows the guard is
testing the wrong property in both directions.

### F5 — a stepper press makes a second pad an owner

`useTimeline._travel` (`:298`) sets `_zoomEnteredHere = true` on **every**
successful travel. The ZoomBanner's ◀ ▶ steppers call exactly that — and the
banner renders, with its steppers, on **every** client (that is the design:
"nobody can walk up to a pad and not know", `ZoomBanner.tsx` header).

`R8`: pad A holds a travel zoom; pad B (which never entered anything) presses
`▶` once, then browses CONFIG → TIMELINE. Observed: **engine zoom `null`, pad A's
banner gone.**

That is the precise scenario D1 exists to prevent. `_97` §3.4: *"a second pad
merely browsing to its timeline tab must never yank pad A's performance. That
second pad exits through the banner's EXIT instead"* — and `_100` T1 asserts
"B browsing changes nothing", which is true only until B touches a control the
banner deliberately offers it. `_100` T1 tests B *browsing*; nobody tested B
*retargeting and then browsing*.

---

## 3. The enum-additive brick class

The order asked which additive change would brick the pad at boot, given that
`parsePartyConfig` throws on unknown enum values by design. Every enum-bearing
field on the state/broadcast surface was probed with a future value. The answer
is a spectrum, and the strictest field is the least dangerous one:

| Field | Future value | What happens | Sev |
|---|---|---|---|
| `action.transition.mode` (`DeckTransitionMode`) | `trans_zoom_blur` | **TypeError inside render → the whole app white-screens** | **P1 (F3)** |
| `zoom.scope` | `rehearse` | silently becomes a purple **TIME TRAVELING** banner with steppers that can only 400 | P2 (F6) |
| `cue.kind` (`CueKind`) | `party` | renders the literal string `undefined` in the agenda + event sheet | P3 (F16) |
| `segment.source` | `party-session` | prints the raw token — **honest**, `zoom_logic.ts:155` has a real `default:` | ✅ |
| `segment.owner.kind` | `party` | passed through as data; only the accent colour degrades | ✅ |
| `state.controller` | anything | `String(x).toUpperCase()` fallback pill — **honest** | ✅ |
| `trigger.type` / `action.type` | anything | `'cue'` / `'action'` — vague but safe | ✅ |
| `effectiveState` (`PartyEffectiveState`) | `suppressed` | `parsePartyConfig` **throws**, caught by `fetchPartyConfig`, surfaced as a loud error + RETRY. **No boot brick** — the card degrades, the pad lives | ✅ |

So the strict validator is not the hazard: it is the *only* enum on this surface
that fails loudly and survives. The hazards are the **unguarded map lookup**
(a crash) and the **binary `if/else` over a widening union** (a lie). Both are
"no fallback behaviors, ever" violations in the codex's own terms — one fails
catastrophically, the other fails silently, and neither fails *loudly*.

Note also that the far more load-bearing document is the unvalidated one (F7):
`parsePartyConfig` type-checks 15 fields of a settings card, while
`timelineState` — which drives the deck lock, the plan banner, the cue list and
the zoom — is admitted on `typeof mode === 'string'`.

---

## 4. Hostile-server behaviours worth naming

- **Answer takeover 200, broadcast a different zoom** (`R3`). The pad follows the
  broadcast, which is correct (the broadcast is the authority) — but the operator
  who pressed **TIME TRAVEL** is now silently **PERFORMING a different event**,
  with no signal that their scope changed under them. INFO, not a defect; worth a
  ruling on whether a scope change deserves a notice.
- **A single out-of-order `timelineState`** (`R10`) clears the banner while the
  engine still holds the lease. Frames carry no sequence number or timestamp, so
  the pad has no way to reject one. Not producible by today's engine (one writer,
  one socket) — but it is the wire contract's only defence, and it is absent.
- **Every route 500 with an HTML body** (`R7`): the pad stays usable and does not
  throw. It also does not say the engine is unreachable (F11).

---

## 5. Recommended order of attention (operator's call — nothing was fixed)

1. **F3 + an error boundary.** One `?.` guard fixes the crash; an error boundary
   around the tab tree fixes the whole class, forever, for every future throw.
2. **F1.** Clear `_zoomExitRequested` on the success path of `_resume()`, not only
   on an observed transition. Two lines, and it restores the alarm `_100` X6
   proves the engine deserves.
3. **F4.** Test the ribbon's contract (non-empty, tiles 00:00→24:00), not the
   array's type — and say so loudly when it fails, including F12's dropped rows.
4. **F2 + F11.** Give the ZoomBanner and the timeline header a `connected` gate.
   The party card already models the honest behaviour on the same screen.
5. **F5.** Stake `_zoomEnteredHere` on *entry* (perform/travel from the event
   sheet), not on every `_travel` success.
6. **F6.** Make `zoomBannerModel` a `switch` with a loud unknown-scope branch.

---

## 6. Hygiene

- **Zero source edits, zero suite edits, zero git operations.** The only files
  this thread wrote are **this report** and **one appended entry** in
  `.agent/memory/bm_readiness_thread_tracker.md`. `git status` on
  `feat/bm_readiness` is large, but every other entry pre-dates this thread: the
  whole S1–S5 zoom wave (`_95`/`_97`/`_98`/`_100`) is still uncommitted, and
  several sibling red-team threads were writing their own reports concurrently
  (`_103`–`_113` are theirs).
- **Security check (`--all`): 6 findings, all pre-existing MACs in the gitignored
  `simulation/.scene_backups/studiodj/**` snapshots** — the same set `_100` §6.1
  reports. **None in any file this thread wrote.**
- **Report-number collision, noted not resolved:** a sibling thread also landed a
  `20260725_107_*` report (`_107_redteam_fixtures.md`). This thread kept the
  filename its order specified. Whoever curates the ledger may want to renumber
  one of them.
- **CaptainPad vitest re-run at the end: `42 files, 914 passed, 6 skipped, 0
  failed`, exit 0 — exactly the `_97`/`_100` baseline.** The tree is unchanged.
- **Ports:** dist server **:7900**, hostile engine **:7901**. Nothing else was
  bound. The operator's `:6967` was never touched; the pinned `6967-6972` band
  and UDP 5568 were never approached; no engine was spawned at all, so the
  `MARSIN_CONFIG_FILE` black-hole recipe was not needed and **zero sACN,
  zero device HTTP and zero packets of any kind went toward the rig**.
- No scene, plan, playlist, pattern or state file was read for writing or
  written. The hostile engine serves synthetic JSON only.
- All scratch in `~/tmp/redteam_pad/` (gitignored): `hostile_engine.cjs`,
  `redteam.cjs`, `r2m.cjs`, `probe_pure.ts`, `alias_loader.mjs`, `stubs/`,
  `probe_pure.out`, `results.json`, `shots/`.
- No IPs, hostnames, MACs, credentials or personal data in this report; no future
  dates or deadlines. `127.0.0.1` is loopback; the festival dates in the
  screenshots are the synthetic fixture plan's own.
- **Notion:** no Notion MCP tool was available in this session, so the board row
  could not be filed. It is written out in §7 for whoever has the connection.

## 7. The board row that could not be filed

> **Title:** CaptainPad zoom-ladder red team — 5 P1 (`_114`)
> **Status:** Backlog · **Area:** CaptainPad
> **Body:** Report `.agent/reports/202607/20260725_114_redteam_captainpad.md`.
> 17 findings (5 P1 / 6 P2 / 6 P3), five reproduced live in a browser against a
> hostile engine on a fresh dist. Headline: (F3) an unknown deck-transition mode
> white-screens the entire pad and there is **no React error boundary anywhere**;
> (F1) one press of RESUME NOW permanently disarms the "zoom ended" alarm, so an
> engine restart mid-zoom leaves the operator silently on a deck they no longer
> own; (F2) the zoom banner keeps asserting a live lease after the link dies, on
> the same screen as a card correctly saying ENGINE OFFLINE; (F4) an empty ribbon
> passes as a completed review; (F5) a stepper press lets a second pad end the
> first pad's zoom. Nothing was fixed — this card is the fix request. Suggested
> order: F3 + error boundary, F1, F4, F2/F11, F5, F6.
