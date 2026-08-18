# 75 — COLORS panel live-apply + the TURNS rotating window queue

**Status:** DESIGN (report `_314`, Fable). Implementation reserved as `_315`
(Opus lead + Sonnets). Client-only — **no engine source change, no engine
restart**; CaptainPad rebuild required.
**Operator orders (verbatim intent):**

1. *"selecting a new contrast or split or whatever method or color in the UI
   should update the ongoing program when it's running — right now I have to
   stop the program then start again to take the new changes."* (deck AND
   mixer COLORS panel; TWO COLOUR / PALETTE TURNS / FOLLOW NOTE)
2. *"in the turning style, the colors aren't window turning correctly. We need
   to select two, and the window will move both in a rotating window queue
   style."*

Scope is exactly these two problems. Everything adjacent is deferred (§8).

---

## 1. Where the machinery already is (census)

- **Engine live retune EXISTS and is sufficient.** `PATCH
  /deck/color-autopilot` (`marsin_engine/lib/api_server.js:9797`) →
  `ColorAutopilot.patchState` (`marsin_engine/lib/color_autopilot.js:1114`):
  no generation bump, no tween cancel, holds re-armed phase-preserving.
  Per-field semantics (docs/59 §5.1): `palettes` lands **from the next
  transition, cursor preserved/clamped** (`color_autopilot.js:1139-1151`);
  `followNote.sel`/`method` retween **now**; `delay_s`/`methodHoldS` re-arm
  now; fades from the next fade. The engine cycles `palettes` entries
  sequentially and never inspects their structure (`_runTick` →
  `_applyPalette` → `lerpParams`) — any 5-pair list is a legal ring.
- **Client PATCH plumbing EXISTS on both mounts.**
  `patchDeckColorAutopilot` (`CaptainPad/utils/api.ts:697`);
  `handleColorAutopilotRetune` (deck `app/(tabs)/index.tsx:1044`, passed
  at `:1880`) and `handleColorsAutopilotRetune` (mixer
  `app/(tabs)/mixer.tsx:1789-1854`). The window's `retune()`
  (`colors_window.tsx:373-377`) + `rotationRetunePatch`/`retunableLive`
  (`colors_window_logic.ts:1055-1113`) already gate per kind — and
  **`retunableLive` already says `palettes` is live-tunable on `crossfade`
  and `turns`. No colour gesture ever calls it.** That unused row is the
  whole feature.
- **What uses PATCH today:** FADE/HOLD pills (`onRingFade`/`onRingHold`,
  `colors_window.tsx:398-399`), and every FOLLOW NOTE field —
  `sel` (`onPickFollowSlot:460`), `schemes` (`onToggleMethod:472`),
  `methodHoldS`/`methodFadeS`/`noteFadeMs` (`:479-481`), method override
  (`applyScheme:861`). **What never does:** every colour selection.

## 2. Diagnosis, problem 1 — why colour changes need stop/start, per mode

There is no engine snapshot problem: the daemon reads its config fresh at
every tick. The deafness is 100 % client policy — colour gestures are either
**refused** by `manualWriteGate` (`colors_window_logic.ts:1168`) or **staged
into a local draft the running program never sees**.

**TWO COLOUR (crossfade running)** — no live path exists at all:
- Scheme tap (CONTRAST/SPLIT/…): `schemeTapOutcome` hard-codes `crossfade →
  stage-only on every card` (`colors_window_logic.ts:1223`, rationale "a
  restage would change the kind 2→5" — true for the old full-POST restage,
  moot for a 2-entry PATCH).
- Wheel/dial drag, chip taps, saved-pair loads, A/B slot pick: refused by the
  gate (`colors_window.tsx:360-364, 894, 921-928, 940-961`; wheel
  `readOnly={!gate.canWrite}` at `:1190`). Endpoints `endA/endB` are read
  from the live config's pair 0 (`:618-625`), so nothing the operator does
  can move them while it runs. Stop → edit → RUN is the only path.

**PALETTE TURNS (turns running)**:
- Scheme tap from the turns card DOES apply live, but via **full POST**
  (`applyScheme` restage, `colors_window.tsx:868-883` →
  `turnsAutopilotPatch`) — generation bump, cursor reset, hold re-armed from
  zero. Worse, a **latched wheel drag routes through the same restage on
  every drag sample** (`onWheelPick:1042-1051`) — a POST storm that restarts
  the rotation under the finger.
- Per-slot wheel edits without a latch (`setTurnSlot:572`), and chip/pair
  loads in turns mode (`loadIntoArmed:940`, `loadPair:949` — gate-refused):
  draft-only or refused. The running ring keeps its old colours.
- A/B pick: recorded locally but the write is gate-refused while running
  (`onPickPairSlot:918-934`) — and the pick surface only exists on the TWO
  COLOUR card behind a scheme latch (`showSchemeSlots:1109`); on the TURNS
  card the badges are explicitly read-only (`:1266-1270`).

**FOLLOW NOTE (running)** — already live for every field the mode has
(`sel`, `schemes`, `method`, all three timings — §1). The only "deafness" is
by design: a scheme tap from a NON-follow card stages only (docs/61 C3), and
manual colour writes are refused because the note owns the hue. No fix
needed beyond regression pins + refusal surfacing (§6 W3): the mixer mount
currently narrates a rejected PATCH only to `console.error`
(`mixer.tsx:1821-1825`) — a silent failure the operator reads as "it
ignored me".

## 3. Diagnosis, problem 2 — what the turns window actually does

`orbitPairs` (`CaptainPad/shared/color_control_core.js:123-133`) posts
window *k* = staged slots `(selA + k, selA + k + d)` — **the window always
advances by ONE slot per turn**, whatever the operator selected. At the
default adjacent selection (`sel = [0,1]`, d = 1 — also what every scheme
tap resets to) consecutive windows **share a colour**:

Staged R O Y G B, sel T1+T2. Wire: `(T1,T2)(T2,T3)(T3,T4)(T4,T5)(T5,T1)`.

| turn | ch A (`colorPalette1`) | ch B (`colorPalette2`) | fresh colours |
|---|---|---|---|
| 0 | T1 R | T2 O | — |
| 1 | T2 **O** (B's old colour) | T3 Y | 1 |
| 2 | T3 **Y** (B's old colour) | T4 G | 1 |

Every turn, channel A merely inherits what channel B just showed: on the rig
the pair looks like a one-colour shift-register, not "both colours turning".
That is the defect the operator is naming. **Intended:** the selected
two-colour window rotates through the queue with **both channels landing on
fresh colours every turn**:

| turn | ch A | ch B | window |
|---|---|---|---|
| 0 | T1 R | T2 O | (T1,T2) |
| 1 | T3 Y | T4 G | (T3,T4) |
| 2 | T5 B | T1 R | (T5,T1) |
| 3 | T2 O | T3 Y | (T2,T3) |
| 4 | T4 G | T5 B | (T4,T5) → wraps to (T1,T2) |

One lap = 5 turns; each staged colour visits BOTH channels exactly once per
lap; spacing d is kept the whole way.

## 4. The fix — problem 2: the rotating window queue (client-only)

**Algorithm.** Add a **step `s`** to the orbit: window *k* = slots
`((selA + k·s) mod n, (selA + k·s + d) mod n)`, wire entry *k* =
`{c1: ring[selA+k·s], c2: ring[selA+k·s+d]}`. Rule for `s` (n = 5):
**the smallest s ≥ 1 for which consecutive windows are disjoint** —
`{0,d} ∩ {s, s+d} = ∅ (mod n)`:

- d = 1 or 4 (adjacent pair, incl. default): **s = 2** — the table above.
- d = 2 or 3 (spaced pair): **s = 1** — already disjoint; today's behaviour
  for a spaced pick is byte-identical and stays.
- n = 2 (the crossfade's 2-entry ring): s = 1 always — no disjoint step
  exists; **the crossfade wire stays byte-identical** (pinned).
- gcd(s, 5) = 1 for both values, so every lap still visits all n windows
  and wraps cleanly. Rotation-step timing is untouched: one window per
  daemon tick, on the `_224` shared FADE/HOLD transport (crossfader
  timescale) — the queue changes WHICH pair each tick plays, never when.

**The engine is unchanged and unaware** — it cycles whatever pair list it is
handed. All work is in the client's builder + reader family:

- `shared/color_control_core.js` (+ `.d.ts`): `orbitPairs(colours, sel)`
  emits the stepped list; export `orbitStep(d, n)`; `turnsPairs` stays
  `orbitPairs(_, [0,1])` (now stepped); `crossfadeAutopilotPatch` pinned
  byte-identical.
- `colors_window_logic.ts`: `TurnsOrbit` becomes `{ring, distance, step}`;
  `turnsOrbit()` recovers `(s, d, phase)` by trying **s = 1 first, then
  s = 2** (deterministic; s and n coprime so the staged order is recovered
  by de-stepping the wire's `c1` sequence). MASTER's degenerate ring keeps
  reporting `(1, 1)` (smallest wins — readout unchanged).
  `orbitWindowSlots` → `a = (phase + index·s) mod n`; `cursorRailOffset` →
  `raw = (index − 1 + t)·s + phase` (leading edge travels s cells per turn;
  s = 1 identity); `cursorRailSegments` unchanged beyond the offset.
  `rotationCursor`/`litPairIndex` need nothing — the segment fit is
  structure-agnostic.
- `colors_window.tsx`: `WindowRail` (`:2052`) gains the `step` prop;
  `litWindow` uses the generalized `orbitWindowSlots`.
- **Adoption hazard (must-fix):** the draft-adopt effect
  (`colors_window.tsx:545-552`) overwrites `turnDraft` whenever
  `orbitPhase` is null. An s = 2 wire read by the OLD recognizer looks like
  a d = 3 orbit of a **reordered** ring → phase null → the operator's T1..T5
  get silently renumbered. The generalized recognizer closes this on new
  builds; a mixed-version iPad still shows the cosmetic renumbering (same
  skew family as `_248` C6 — disclosed, not prevented).

## 5. The fix — problem 1: colour gestures retune the running program

**One rule: while the matching family is running, a colour selection is a
sparse `PATCH {palettes: <new ring>}` through the daemon's front door —
never a refusal, never a full POST.** Generation, cursor, phase and the
in-flight fade all survive (engine `patchState`, already shipped). The
single-writer model is intact: the daemon stays the only palette writer;
the client only edits its config. This is the same pattern as the `_288` W3
Live Touch colour fan-out (`api_server.js:6316-6356`), which retunes the
running daemon's config live instead of fighting its output.

Per mode:

- **crossfade running** (TWO COLOUR card): wheel/dial drag on A or B, chip
  tap, saved-pair load, scheme tap, A/B endpoint change → build the new
  2-entry ring from the new endpoints and `retune('palettes',
  orbitPairs([A', B'], [0,1]))`. `schemeTapOutcome`'s `crossfade` row
  changes from `stage-only` to a new **`retarget`** action (message:
  `"<SCHEME> retunes the running crossfade — from the next fade."`). The
  kind can never change: a PATCH cannot alter `active`/`mode`, and the ring
  stays length 2. Blend SCRUB stays refused (it writes a fade *position*,
  not a config — D3).
- **turns running**: every draft edit rebuilds the ring and PATCHes it —
  scheme tap (restage switches from POST `turnsAutopilotPatch` to
  `retune('palettes', orbitPairs(colours, sel))`; cadence/phase now truly
  survive, closing the restart the old comment apologized for), latched
  wheel drag (same, throttled — kills the POST storm), un-latched per-slot
  wheel edit, chip/pair loads in turns mode (gate refusal removed for this
  kind), A/B pick (`onPickPairSlot` PATCHes the re-ordered ring instead of
  refusing the write).
- **follow-note running**: already live (§2); no change beyond W3 narration
  and regression pins. Manual colour writes stay refused — the note owns
  the hue; the live levers are `sel`/`method`/`schemes`, all already wired.
- **palette-set running**: unchanged — refused with the existing sentence
  (the AUTOPILOT window owns that config; docs/61 §5).

Mechanics:

- **Gate becomes a router, not a wall.** `manualWriteGate` keeps its
  signature and its refusal rows for `palette-set`/`follow-note`/offline;
  for `crossfade`/`turns` the colour handlers consult a new pure
  `colourGestureOutcome(kind, surface)` → `'write' | 'retarget' |
  'refuse'` in `colors_window_logic.ts`, so the table is tested, not
  eyeballed. Direct `/param-center` writes (`setSlot`/`writeNow`) still
  never fire while any family runs.
- **Throttle**: drag-driven retargets reuse the window's existing write
  throttle cadence (the `writeThrottled` constant) with a trailing PATCH on
  release (`onWheelDragEnd`), so the engine sees at most the same rate the
  manual path always produced. No new timers (the `_217` grep gate stays).
- **Landing time** (docs/59 §5.1, unchanged): `palettes` lands at the next
  transition. At the shipped default (CONT + 0.8 s) that is within one fade;
  at HOLD 30/60 s it is the next turn. Message lines carry the existing
  `RETUNE_TIMING_TAGS['next-transition']` tag. No engine change (D4).
- **Fail-loud**: every refused/failed PATCH surfaces on the message line
  (deck path already narrates; mixer's `console.error`-only handler
  (`mixer.tsx:1821-1825`) must `say()` too). No silent fallback to POST, no
  optimistic state kept on rejection — the broadcast remains truth.
- **A/B pick on the TURNS card** (D5): the T1..T5 slot row
  (`colors_window.tsx:1253-1275`) gains the arm-then-tap grammar (COLOUR
  A/B arm chips + tap-a-slot), replacing today's read-only badges, so
  "select two" is doable on the card that plays them. Same
  `selectSchemePair` refusals.

## 6. `_315` wave breakdown

W1 → (W2 ∥ W3) → W4. File ownership is disjoint per wave.

- **W1 — logic core (Sonnet A).** `shared/color_control_core.js` + `.d.ts`,
  `colors_window_logic.ts`, `colors_window_logic.test.ts`,
  `color_control_core_browser.test.ts`. Stepped orbit + recognizer
  generalization (§4), `colourGestureOutcome`, `schemeTapOutcome` new
  `retarget` row, retarget builders. Accept: new queue tables (§3 both
  tables verbatim as tests), crossfade byte-identity pin, MASTER `(1,1)`
  pin, spaced-pair (d = 2,3) byte-identity pin, s↔phase round-trip
  (`turnsOrbit(orbitPairs(ring, sel))` recovers `(ring, d, s)` for every
  legal sel), suite green, tsc clean.
- **W2 — COLORS window (Sonnet B).** `colors_window.tsx` only. Route every
  colour gesture per §5; restage POST → PATCH; drag throttle; TURNS-card
  A/B pick; `WindowRail` step prop; adopt-effect uses the generalized
  recognizer. Accept: **all 37 `colors_window_wiring.test.ts` pins green
  unmodified** (no-timer, memo/identity discipline, yield/strip/bare-stop
  scanners — every new handler reads live values via `liveRef`, id/index
  props, stable identities); mock-POST/PATCH shape tests: a scheme tap
  while crossfade runs issues exactly one PATCH `{palettes:[…2]}` and zero
  POSTs; a turns A/B pick issues one PATCH and no `{active}` write.
- **W3 — mounts (Sonnet C).** `app/(tabs)/index.tsx`, `app/(tabs)/mixer.tsx`.
  Surface rejected retunes on both mounts (mixer `say`-path); nothing else.
  Accept: rejection narration test or extracted helper test; zero other
  behavioural diffs.
- **W4 — validation (Opus lead).** No product files. Offline scratch engine
  (HIGH port 17xxx, sACN → TEST-NET-1, redirected state dirs; live
  :6966-:6972/:6981/5568 never bound, no live writes): ① start TURNS
  R O Y G B sel T1+T2, capture 2 laps of WS `sharedParams` → assert the §3
  intended window sequence and that consecutive windows never share a
  colour; ② mid-run scheme tap → GET before/after shows same
  `nextSwapAtMs` cadence (no re-arm), new colours on the wire, output
  moving to them within one transition; ③ same for a crossfade endpoint
  drag and a follow-note `sel` flip (retween within `noteFadeMs`); ④
  mixed-build note verified read-only. Screenshot matrix (fresh dist on
  :7167, API_BASE pinned per `.agent/ops/captain_pad_debugging.md`, one
  tab): turns queue rail sliding s = 2, TURNS-card A/B pick, retarget
  message lines, mixer narration. Full CaptainPad vitest + engine suite
  (baseline-relative, empty failing list) + `python
  scripts/security_check.py --staged`.

## 7. Regression specs (the contract W4 proves)

1. **Live re-apply, per mode:** with the family running, change (a) a colour
   (wheel/chip/pair), (b) the scheme method, (c) the A/B selection → the
   engine config changes on the wire via PATCH, `nextSwapAtMs` cadence and
   generation survive (no restart), and the rig's output reaches the new
   colours within one transition (crossfade/turns) / within `noteFadeMs`
   (follow-note sel) — **zero `{active:…}` POSTs in the exchange**.
2. **Turns queue:** sel T1+T2 over R O Y G B plays exactly
   `(T1,T2)(T3,T4)(T5,T1)(T2,T3)(T4,T5)` and wraps; both channels change
   every turn; each colour visits each channel once per lap; rail/lit slots
   match the wire at every step. Spaced sel (T1,T3) byte-identical to
   today. Crossfade wire byte-identical to `_217`.
3. **Pins:** all 37 wiring pins green unmodified; no new timers; `_224`
   shared transport untouched; docs/61 yield/strip/takeover rows untouched;
   follow-note manual-write refusal + palette-set refusal sentences intact.
4. **Fail-loud:** a PATCH rejected by the engine surfaces a sentence on both
   mounts; no optimistic ring is kept.

## 8. docs/71 compatibility + deferred

`_297` (two-tone presets) is untouched by this design: it adds
exposure/management/sync around the SAME `/color-pairs` store and its W4
edits `colors_window.tsx` — so **`_315` and `_297` must not run
concurrently on that file** (same-file rule; sequence either way). One
interaction to flag: docs/71 R1's global-line saved-palette tap stays a raw
`writeColors` that a running daemon eats (docs/61 C5 status quo) — routing
THAT tap through this wave's retarget is deferred. Deferred list (one line):
global-line/QUEUE/MIDI writes retargeting a running family; immediate-retween
engine option (D4); C5 engine write gate.

## 9. Decisions (D1..D7 — `_315` implements defaults unless Sina overrides)

| # | Decision | Default |
|---|---|---|
| D1 | Queue step rule: s = 2 for adjacent pairs (d 1/4), s = 1 for spaced (d 2/3) — "both colours fresh every turn" | **Yes** |
| D2 | Stepped queue applies to the DEFAULT sel [0,1] too (changes the long-standing `_224` adjacent slide for everyone, which is what the complaint is about) | **Yes** |
| D3 | Blend SCRUB stays refused while a family runs (position, not config) | **Yes (refuse)** |
| D4 | Retarget lands at next transition (no engine change); no immediate mid-hold retween | **Yes** — revisit only if long-HOLD latency annoys |
| D5 | A/B pick gains an arm-then-tap surface on the TURNS card | **Yes** |
| D6 | Latched wheel drag while TURNS runs = throttled PATCH retarget (replaces POST-per-sample restage) | **Yes** |
| D7 | Follow-note colour writes stay refused (note owns hue); no new follow-note lever | **Yes** |
