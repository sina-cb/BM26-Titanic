# 358 — Party / LIVE tab overnight handoff (what was wrong, what changed, how it was proven)

Coordinator handoff for the operator. Chain: Fable plan (`_356`) → Opus engine +
Opus CaptainPad implementation → Sonnet live verification → Opus defect fixes →
coordinator live re-verification. A separate, review-only Fable pass over the
whole Timeline tab is in `_357` (27 findings; nothing from it was changed —
two P0s there are for the operator to triage, see §6).

Everything below is UNCOMMITTED on `feat/bm_readiness` (no git operations were
requested). The stack is running on the final engine (launcher profile `prod`,
scene `titanic`, started by the coordinator; `node launcher.js status` green).

## 1. What was wrong (root causes, from `_356`)

1. **Party never fired with music already playing.** The mood trigger only armed
   after observing `calm` first; a plan activated during music had
   `moodArmed === undefined` and the evaluator skipped it forever — while the
   ARMED chip showed ✓.
2. **Two definitions of "window open".** Status used night-start-day semantics
   (correct), the evaluator used calendar day + clock-only phase — so the
   baseline cue fired and the party could fire while the pad said WINDOW CLOSED.
3. **Default cue clobbered the Party Window baseline.** The 1 s tick ran
   concurrently with activate/resume/RETURN; the "boot" default apply landed one
   second after the baseline fire and took the deck (also produced double
   default applies after RETURN).
4. **NOW card / ribbon ignored phase cues**; the pad preferred the ribbon's
   guess over the engine's owner ("RESOLVED PLAN OWNER · Default (from deck)").
5. **RETURN TO LIVE AUDIO only cancelled forced sessions**; a detected session
   kept playing. The forced flag was lost on save/resume rejoin. Both buttons
   rendered enabled regardless of state.
6. **ARMED "flapping"** was the engine's `triggerArmed=false` for the life of any
   session — a state the chip row could not express.
7. Live verification then found two more: **(A)** every session-end path applied
   the flat default cue instead of the Party Window baseline (and it stuck until
   the next scheduled cue); **(B)** FORCE had no re-entrancy guard (a second
   FORCE silently restarted the session).

## 2. What changed

Engine (`marsin_engine/lib/timeline/`):
- `party_window.js` (new): `partyWindowAt()` — the single window predicate
  (night-start-day, midnight wrap) used by status, evaluator, state, resolver.
- `triggers.js`: mood cue fires when `moodArmed !== false` (undefined ⇒ armed).
- `timeline_service.js`: window-gated runtime cues; dwell re-anchor on window
  open / catch-up (`party-window-opened` lifecycle line); self-heal re-arm;
  RETURN ends ANY live session and 409s when none; forced flag survives rejoin,
  reset on activate/dormant; tick ↔ mutation serialization (`_mutation`,
  `_tickPromise`); `getState()` adds `deckOwner` + `partyWindow`;
  `/party-config` adds `cueError`, `partyWindowOpensAtMs/ClosesAtMs`, distinct
  `readiness.planActive` / `planDriving`; FORCE refuses while a session is live
  (`_livePartySessionCueId`); all session-end paths go through
  `_applyPhaseResolvedDefault`, which now restores an active phase-baseline cue
  for every plan (not only `phaseAware:true`).
- `resolve_deck_state.js`: phase-baseline cues are restore candidates (boot /
  save / resume / overview segments).
- `http_ownership.js`: `/party/force`, `/party/live-audio`,
  `/party/cooldown/reset` listed as timeline authority mutations.
- `api_server.js`: `resetPartyCooldown` is async (same route contract).
- `tools/timeline_dryrun.mjs`: explicit session-end reason set (summary fix).

CaptainPad:
- `utils/timelineApi.ts`, `hooks/useTimeline.ts`: strict parsing of
  `deckOwner` / `partyWindow` (absent allowed, wrong type fails loud).
- `utils/timeline_operator_model.ts`: NOW owner precedence program → manual →
  engine `deckOwner` ("ENGINE OWNER") → segment → baseline; range from the
  segment only when it names the same owner, else "until <next cue> HH:MM";
  banner names the owner, no "autopilot".
- `utils/party_api.ts`: pure `partyReadinessChips()` and `partyButtonRules()`.
- `components/timeline/timeline_party_card.tsx`, `timeline_live_view.tsx`,
  `app/(tabs)/timeline.tsx`: seven chips PLAN · DECK · WINDOW · PARTY ON ·
  SIGNAL · SESSION · COOLDOWN; FORCE ↔ RETURN mutual exclusion; RETURN calls the
  engine first, companion override second with its own error line; cue-error
  and stale-signal alert lines.

## 3. Proof

- Engine timeline suite 572/572; full engine suite 4112/4114 (the 2 failures
  are pre-existing in `tests/playlist/ambient_playlist_derivation.test.mjs`,
  unrelated playlist-sync pins). CaptainPad 2933 passed / 6 skipped (176 files),
  `tsc --noEmit` clean.
- Dry-run: plan activated at 22:00 with music already playing → baseline fires,
  `party-window-opened`, Party 1 fires by mood at 22:01; sessions repeat across
  midnight into festival day 1; 09:00 closer takes the deck.
- Live (operator's engine, real music, all-days copy of the operator plan):
  party fires 16.9 s after activation (minDwell 15 s, not instant); engine and
  pad agree on window open/closed (5 samples); restart mid-window comes back on
  the Party Window baseline with no double fire; overview shows baseline
  segments 21:00→24:00 / 00:00→09:00; RETURN on a detected session → one apply,
  deck back on the baseline, second RETURN 409; FORCE → 200, second FORCE → 409
  with `sessionEndsAtMs` unchanged, RETURN → baseline, FORCE after reset → 200.
  Screenshot of the LIVE tab (in-session): `NOW · CUE — PARTY 1 — ENGINE OWNER
  — until Default after Party Window 09:00`, banner names the owner, chips with
  `· SESSION LIVE`.

## 4. Chip / button contract (what each thing means now)

| Chip | Driven by | ✓ | ✗ / other |
|---|---|---|---|
| PLAN | `readiness.planActive` | plan on + in festival days | off / dormant |
| DECK | `readiness.planDriving` | Timeline owns the deck | takeover / lease |
| WINDOW | `readiness.partyWindowOpen` | open tonight | `× WINDOW · opens HH:MM`; `· WINDOW BYPASSED` while forced |
| PARTY ON | `readiness.enabled` | policy enabled | disabled |
| SIGNAL | `strongSignal` / `moodStale` | music qualifies | calm (neutral); `SIGNAL STALE` red |
| SESSION | `triggerArmed` + `effectiveState` + `cueError` | `ARMED` | `· SESSION LIVE` (neutral) during a session; red only on a cue error |
| COOLDOWN | `cooldownRemainingSec` | clear | `m:ss` left |

FORCE PARTY: enabled when the plan is active and no session is live (label
`PARTY FORCED` while forced). RETURN TO LIVE AUDIO / END PARTY SESSION: enabled
only while a session is live. RESET COOLDOWN: only while a cooldown counts.

## 5. What to try in the pad (Timeline → LIVE)

1. Your `test_week` window is authored on **day 0 only** → early morning reads
   `× WINDOW · opens 21:00` and that is correct. For every-night behaviour set
   the Party Window DAYS to "All days" in EDIT PLAN (or test after 21:00).
2. With the window open and music playing: within ~17 s the PARTY card goes
   `IN SESSION`, NOW card shows `PARTY 1 · ENGINE OWNER`, SESSION chip `LIVE`.
3. Tap END PARTY SESSION → deck returns to `Party Window baseline` (not
   "Default (from deck)"), COOLDOWN counts 1:00, button greys out.
4. FORCE PARTY → `PARTY FORCED` greys, RETURN TO LIVE AUDIO lights; tap it →
   back to the baseline.
5. **Performance mode**: while it is on, the pad greys FORCE / END PARTY SESSION
   with a "VIEW ONLY" banner (pre-existing design; see §6 item 1). Turn it off
   to use those buttons from the pad.
6. CALENDAR → DAY: the ribbon now shows the Party Window baseline owning
   21:00→09:00 instead of a flat default band.

## 6. Open items for the operator

1. **Passcode gate asymmetry (design call).** `/timeline/takeover` is
   passcode-gated in performance mode; `/party/force`, `/party/live-audio`,
   `/party/cooldown/reset` are not (the pad discloses this and greys the
   buttons). Either gate the party routes the same way and let the pad use them
   with the passcode, or accept that they stay pad-locked in performance mode.
2. **Behaviour change to look at on `playa_default`:** a `kind:ambient` phase
   cue now returns when a *program hold* expires while its phase is still
   active (boot and runtime agree now; before, runtime fell to the default
   cue). Check burn/temple hold endings land on the layer you expect.
3. `_357` P0s before editing the real plan from the pad: T-01 (cue editor
   stamps a 30 s `durationMin` on every saved cue) and T-02 (opening the real
   plan's sunrise-anchored party cue rewrites it as a clock window). Do not edit
   `playa_default` cues from the pad until those are fixed.
4. Runtime residue in the tree (report, don't commit):
   `marsin_engine/states/**`, `marsin_engine/audio/companion/party_profiles.yaml`
   (companion writes), `simulation/scenes/test_bench/bench_mirror_state.yaml`,
   `.tmp`; untracked `simulation/scenes/titanic/timeline/test_week.yaml` is the
   operator's local plan. Also still uncommitted from the previous wave: the
   seven sim smokestack files (mode-aware classification) — not touched tonight.
5. Nothing was committed. Suggested commit split: engine timeline (+tests,
   dryrun tool), CaptainPad timeline/party (+tests), reports `_356`–`_358`.
