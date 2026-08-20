# 61 — COLORS interaction model: leaving a mode, mode visibility, one arbitration table

**Status:** DESIGN (report `_255`, Fable). Awaits Sonnet implementers under an
Opus lead/validator.
**Operator order (verbatim intent):** *"check the color live control in the
deck tab please. I just got a conflict with follow note. when going from
follow note to another tab for example, it should safely disable the follow
note so it's not confusing. for the others too — plan interaction and
mechanism of the color."*

Builds on docs/53 §4-5, docs/55, docs/59 and reports `_211`/`_217`/`_224`/
`_242`/`_248`. **Zero engine changes** — every W-item below is CaptainPad
client work, which means this wave needs no engine restart and does not ride
the pending gen-7 bounce (but see §1.8: it must be *validated* against a
post-`_248` engine).

---

## 1. Diagnosis — where the confusion actually comes from

The COLORS window has three internal mode cards — TWO COLOUR / PALETTE TURNS /
FOLLOW NOTE (`colors_window.tsx` `Mode = 'two' | 'turns' | 'follow'`, the
"tabs" of the operator's sentence). The card selection is **local UI state**;
the daemon's running family (`rotationKind` off the broadcast) is **engine
state**. Nothing links them. Every concrete confusion below falls out of that
gap plus the fact that FOLLOW NOTE's writes are driven by something invisible
(the music) rather than a ring the operator staged.

1. **C1 — the cause is off-screen and nothing says so.** With follow-note
   running, the TWO COLOUR card shows A/B handles wandering on their own
   (every committed note re-derives the ring and slews the pair). The only
   footnote lines that exist (`colors_window.tsx:1119-1125`, `:1171-1175`)
   cover "turns while on the crossfade card" and "palette-set" — **there is no
   line anywhere for follow-note**, and no STOP reachable from the card the
   operator is looking at. The daemon's STOP lives only on its own card.
2. **C2 — the refusal sentence names nobody.** `manualWriteGate` is
   deliberately kind-agnostic ("A colour rotation is driving the colours —
   pause it to edit.", `colors_window_logic.ts:1171`). That was honest when
   `active` alone couldn't distinguish families; since `_224`/`_248`
   `rotationKind` distinguishes all four reliably, the vagueness is now just
   missing information: the operator gets told *something* is driving without
   being told *what* or *where its STOP is*.
3. **C3 — the scheme buttons are silently re-purposed across cards.**
   `applyScheme` routes a scheme tap through `schemeTapOutcome(kind, …)`
   keyed on the **engine** kind only (`colors_window.tsx:621-671`). So while
   follow-note runs, tapping COMPLEMENT on the *TWO COLOUR* card — where the
   operator means "stage me a complement pair" — instead PATCHes
   `followNote.method` and re-themes the whole rig ("Method set to
   COMPLEMENT — cycle continues from here."). Correct grammar on the FOLLOW
   NOTE card; a trap on every other card.
4. **C4 — the crossfade card's furniture goes nonsensical under follow-note.**
   `endA/endB` fall back to the live `h1/h2` when there is no 2-entry ring
   (`colors_window.tsx:438-445`) — under follow-note those are the daemon's
   own moving outputs, so the BLEND ramp re-paints itself, the scrubber thumb
   chases a moving target, and a scrub attempt is refused by C2's anonymous
   sentence. A control drawn live but structurally meaningless.
5. **C5 — outside the Deck tab, nothing anywhere says a colour mode is
   driving.** Mixer/dimmer/CPC surfaces (`CPCControls.tsx`,
   `ColorPickerModal` call sites) write `colorPalette1/2` straight through
   `/param-center` with **no client gate and no engine gate** — the engine
   accepts any writer; the daemon simply overwrites at the next note change or
   tick. From the Mixer, the operator sees his colour pick flash and get eaten
   with no visible cause. Same for the MIDI hue path
   (`useMidiControl`/resolver): a physical knob fights an invisible daemon.
6. **C6 — mode-inheritance skew (the `_248` bug-4 family).** Any pre-`_248`
   surface or script that POSTs a palettes-shaped body flips the daemon out of
   follow-note **by inference** (`ColorAutopilot.inferMode`). That is the
   designed back-compat contract, but it means a second iPad on an older
   build, or a timeline cue, can end follow-note with no narration on this
   iPad — the card just goes parked. Visibility (not prevention) is the fix;
   prevention would break the legacy wire on purpose.
7. **C7 — stale cards on entry.** The window always mounts on the TWO COLOUR
   card. If follow-note (or TURNS) is already running — earlier session,
   second iPad, timeline cue — the operator lands on a card full of refusing
   controls with the cause two taps away.
8. **C8 — version skew (transient, disclose to the operator).** The live
   :6968 engine is **pre-`_248`** until the gen-7 bounce: START FOLLOW NOTE
   400s ("colorAutopilot.palettes must be a non-empty array…"), every PATCH
   404s, and the CaptainPad rollback path narrates them as generic refusals.
   Part of what the operator just experienced is this skew, not the
   post-bounce design. Everything in this doc targets the post-bounce world;
   the one yield mechanism specified here (`POST {active:false}`) is
   deliberately a legacy-shape stop that works on **both** engine versions.

## 2. The model — intent gestures yield; disappearance never does

The central tension, resolved honestly: TURNS and the crossfade were put
engine-side **so rotation survives iPad sleep** (operator goal, `_211`/`_217`),
and follow-note inherited that placement deliberately (docs/59 §2). A blanket
disable-on-navigate would re-couple the rig to the UI and has unreachable
cases (app killed, iPad sleep, WS drop — no goodbye event fires).

So the contract splits every "leaving" into exactly two classes:

- **An intent gesture** — a tap on a live, connected surface that carries the
  operator somewhere else: switching the COLORS mode card, hiding the COLORS
  window, switching the app tab. These are detectable, attributable to *this*
  operator, and reversible. **These may yield** (stop a mode), narrated.
- **Disappearance** — sleep, background, app kill, WS drop, crash. Not
  detectable at the moment it matters, not attributable, and exactly the case
  engine-side placement exists for. **Disappearance never stops anything.**
  There is **no engine-side lease or deadman for any colour mode** — a
  deadman would strobe the mode on every WS blip and would strand a
  mid-set look the moment the operator's iPad died, inverting the design
  goal. (Operator decision D5 if he wants this anyway.)

And it splits the modes by what makes them confusing:

- **FOLLOW NOTE** is driven by an invisible external signal. When its card is
  out of sight, its writes have no visible cause. **It yields on intent
  gestures** (the operator's order, applied literally).
- **TURNS / crossfade / palette-set** rotate a ring the operator staged, at a
  cadence he set. They are set-and-forget ambience by design and have behaved
  this way since `_211` without complaint. **They persist everywhere**; the
  confusion they can cause is closed by visibility (§4), not by killing them.
  (Operator decision D2 if he wants the uniform yield instead.)
- **The scheme latch** (`{scheme, base}` in `colors_window.tsx`) is client
  staging state, not a running mode. It never touches the engine by existing,
  so "leaving" costs nothing: it survives card switches and window hides
  (windows are `display:'none'`, never unmounted — `_208`) and dies with the
  app, which is correct for a draft.

### 2.1 The YIELD rule (normative)

> **When an intent gesture takes the operator away from the FOLLOW NOTE card
> while follow-note is driving, the client stops it: `POST
> /deck/color-autopilot {active:false}` — narrated, freeze-in-place.**

Precisely, yield fires iff **all four** hold:

1. **Gesture** — one of: (L1) a ModeButton tap that changes the COLORS card
   away from `'follow'`; (L2) the workspace bar's hide-COLORS chip tap while
   the visible card is `'follow'`; (L3) an app-tab navigation away from the
   Deck tab while the COLORS window is open on the `'follow'` card. Never on
   mount, never on hydration, never on a broadcast change, never on
   AppState/background, never on WS events.
2. **The card being left is `'follow'`.** Tapping TURNS→TWO while follow-note
   runs (armed elsewhere, C7) does NOT yield — the operator never *left*
   follow-note; the driving strip (§4.1) covers that case.
3. **`rotationKind(...) === 'follow-note'` at gesture time**, read from the
   broadcast — never from optimistic state.
4. **`!disabled`** — offline and the soft PLAN lock suppress yield exactly as
   they suppress every other control (a plan-armed follow-note cue is the
   plan's to end; the PlanLockScrim already blankets the window).

Mechanics of the stop:

- The body is **exactly `{active:false}`** — a bare stop. Load-bearing:
  `inferMode` keeps the live mode on a field-less body and the inert
  `followNote` block rides the runtime file, so the operator's tuning
  round-trips and a later START resumes his cycle. Never send `mode`, never
  send a `followNote` block from the yield path.
- Freeze-in-place is native (`_cancelTween` abandons without writing) — the
  look the music last chose stays on the rig. Yield never writes a colour.
- **Narrated, both ways.** Success: `FOLLOW NOTE stopped — colours frozen in
  place.` on the window's message line (L1) or via the existing
  `opError`-family toast when the window is going out of sight (L2/L3).
  Failure (POST rejected/unreachable): `Couldn't stop FOLLOW NOTE — it is
  still driving.` and the driving strip/chip keeps showing the broadcast
  truth. No optimistic "stopped" state ever — the strip clears only when the
  broadcast says `active:false`.
- The navigation itself **always completes**, immediately, regardless of the
  POST outcome. Yield is fire-with-narration, not a navigation gate.
- **Idempotent and race-safe**: if the broadcast flips to parked (or to a
  palettes takeover, C6) between gesture and POST, the stop is still just a
  bare `{active:false}` — a no-op on a parked daemon, and on a
  freshly-started palettes rotation it stops *that*, which is why condition 3
  is checked at gesture time and the POST is sent in the same tick.

### 2.2 What never yields

- Manual **gestures on colour controls** (wheel/dial drag, blend scrub, chip
  tap, saved-pair load, MIDI hue turn) — refused with the kind-named sentence
  (§4.2), never converted into an auto-stop. `_211` §D still governs
  gestures: an accidental brush must not be able to kill a show mode. The
  yield rule is navigation-scoped precisely so §D survives.
- **Broadcast arrivals** — a mode becoming active while the operator is
  elsewhere never triggers anything but visibility.
- **Reconnect / app foreground / boot** — the client adopts whatever the
  engine says and shows it; it never "cleans up" a mode it finds running
  (another iPad or a cue may own it).
- **TURNS / crossfade / palette-set** on any navigation (default; D2).

## 3. Surface-by-surface definition of "leaving" (the (a) table)

| # | Surface event | follow-note | TURNS / crossfade | palette-set | scheme latch |
|---|---|---|---|---|---|
| L1 | COLORS mode-card tap away | **YIELD** (ordered) | persist + strip | persist + strip | kept |
| L2 | Hide COLORS window (chip) | **YIELD** if card was `'follow'` (D1) | persist | persist | kept (no unmount) |
| L3 | App-tab switch off the Deck | **YIELD** if COLORS open on `'follow'` (D1) | persist | persist | kept |
| L4 | App background / iPad sleep | **persist** (D5) | persist (design goal) | persist | client state |
| L5 | App kill / crash / WS drop | persist — unreachable, no deadman | persist | persist | lost (a draft) |
| L6 | Reconnect / boot / foreground | show truth, never auto-stop | same | same | — |

## 4. What the operator SEES (the (c) rules)

### 4.1 The DRIVING STRIP (COLORS window)

One strip, directly above the mode-transport region, rendered whenever
`rotationKind !== 'none'` **and** the running family's own card is not the
visible one:

```
◉ FOLLOW NOTE IS DRIVING — G · TRIADIC        [ STOP ]
◉ PALETTE TURNS IS DRIVING — T2+T3, 5s/0.8s   [ STOP ]
◉ CROSSFADE IS DRIVING — 120° ↔ 300°          [ STOP ]
◉ AUTOPILOT PALETTE SET IS DRIVING            [ STOP ]   (controls: AUTOPILOT window)
```

- Content 100 % broadcast-derived (deadman rule; zero new timers — the
  `_217` grep gate stays in force). Detail text comes from a pure
  `drivingStripModel(kind, broadcast)` in `colors_window_logic.ts`.
- The inline **STOP** posts the same bare `{active:false}` and narrates. It
  replaces today's tab-hunt for the family's own card. It obeys `disabled`.
- The strip **absorbs** the three scattered footnote sentences
  (`colors_window.tsx:1119-1125`, `:1162-1175` "replaces it" lines may stay,
  but the "X is running" halves move into the strip so there is exactly one
  place that says what is driving).
- With the yield rule live, the follow-note row of this strip appears only in
  the remote-armed case (C7/C6) — which is exactly when it is needed.

### 4.2 The gate sentence names the driver

`manualWriteGate` gains the kind:
`manualWriteGate(disabled, kind)` →
`FOLLOW NOTE is driving the colours — STOP it to edit.` /
`PALETTE TURNS is driving…` / `The crossfade is driving…` /
`An AUTOPILOT palette set is driving…`. The `_248` rationale for
kind-agnosticism ("naming the wrong one would be a lie") is retired because
`rotationKind` now decides from the broadcast `mode` + ring shape and cannot
name the wrong one. Every refusal surface that shows the sentence (wheel,
scrub, chips, pair loads) inherits the fix for free. (D4.)

### 4.3 Card auto-select on entry

When the COLORS window **becomes visible** (mount, or restore from the HIDDEN
rail) and a family is running, the window selects that family's card
(`follow-note → 'follow'`, `turns → 'turns'`, `crossfade → 'two'`,
`palette-set → keep current + strip`). Once visible, the selection never
auto-moves again — broadcast changes only ever touch the strip. Fixes C7
without fighting the operator's browsing. (D6.)

### 4.4 The app-wide COLOR chip

A compact chip in the shared header (HealthChip family idiom), on every tab,
whenever `colorAutopilot.active`:

```
◉ COLORS · FOLLOW G     ◉ COLORS · TURNS     ◉ COLORS · XFADE     ◉ COLORS · SET
```

- Tap → navigate to the Deck tab (and open/restore the COLORS window). The
  chip itself never stops anything — stopping from a surface that cannot show
  what freezes would be a blind write.
- Requires surfacing the `colorAutopilot` control frame app-wide through the
  existing engine-state store (`hooks/useEngineState.ts`) — today only the
  deck screen consumes it. Read-only, no new socket, no new WS type.
- This is the answer for C5's "colours changed under me on the Mixer": the
  cause is now named in the header of every tab. The Mixer/CPC colour
  controls themselves stay ungated in this wave (an engine-side write gate on
  `/param-center` would be a new refusal surface across every writer,
  including patterns — out of scope, noted as D7).

## 5. Arbitration — one writer, and what each act does (the (d) rules)

Unchanged foundations: **one daemon, one mode, mutual exclusion by
construction** (docs/59 §1); `active`/`mode` are POST-only takeovers; PATCH
retunes never bump generation. On top of that:

| Act, while `kind` is running | Outcome |
|---|---|
| START FOLLOW NOTE / START TURNS / RUN CROSSFADE | Explicit takeover via full POST (unchanged), **message now names the loser**: `PALETTE TURNS replaced FOLLOW NOTE.` |
| Manual wheel / dial / scrub / chip / pair / MIDI hue | Refused, kind-named sentence (§4.2) + STOP one tap away in the strip. Never auto-stops. |
| Scheme-generator tap, visible card == running family's card | Family grammar unchanged: `turns → restage`, `follow-note → method-override` (`_248`, veto 4 still open on the override itself). |
| Scheme-generator tap, any OTHER card | **stage-only**, sentence names the driver: `FOLLOW NOTE is driving — this stages only. STOP it (strip above) to write A/B.` Fixes C3: `schemeTapOutcome(kind, title, surface)` gains the surface argument; `method-override` is only reachable from the `'follow'` card. |
| Blend scrubber / ramp under `follow-note` | Rendered **inert with the strip as the explanation** (no moving pseudo-track): endpoints are only meaningful for a 2-entry ring. Fixes C4. |
| Navigation gestures | §2.1 / §3. |
| A palettes-shaped POST from an old surface (C6) | Accepted by design (`inferMode` back-compat). This iPad's strip/chip flip to the new truth on the next broadcast — visibility is the mitigation, the wire is not changed. |

> **SUPERSEDED by docs/75 §5 (`_315`), for `crossfade` and `turns` only.** Two
> rows above described the world before the retarget rule existed. While a
> **crossfade** or **TURNS** ring is running, a colour selection is no longer
> refused or staged — it is a sparse `PATCH {palettes: <new ring>}` through the
> daemon's own front door, landing from the next transition (docs/59 §5.1), with
> generation, cursor, phase and the in-flight fade all preserved. Concretely:
> row 2 ("Manual wheel / dial / scrub / chip / pair") now **retargets** for those
> two kinds — the blend SCRUB alone stays refused (it writes a fade *position*,
> not a config; docs/75 D3) — and `schemeTapOutcome`'s `crossfade` row is
> `retarget`, not `stage-only`, on every card. The refusals for **follow-note**
> (the note owns the hue; D7), **palette-set** (the AUTOPILOT window owns that
> config) and the offline / plan-locked case are **unchanged**, and `active` /
> `mode` remain POST-only takeovers. The gesture table is now decided by the pure
> `colourGestureOutcome(kind, surface)` in `colors_window_logic.ts`, so it is
> checked by the suite rather than eyeballed here.

## 6. What must NOT change

- **The `_242` dial** — jog model, `DIAL_GAIN`, dead radius, anchor-not-set.
- **The `_224` shared transport** — one HOLD/FADE pair, `rotationAutopilotPatch`, superset pill rows.
- **The `_217` no-timer rule** — zero `setInterval`/`requestAnimationFrame` added to `colors_window.tsx` (grep-gated in acceptance).
- **The single-writer gate's strength** — yield is navigation-only; no gesture path may auto-pause the daemon (docs/53 §4.4, `_211` §D as re-scoped in §2.2).
- **The engine wire** — no new routes, no lease, no deadman, no schema change; `{active:false}` bare-stop semantics (mode kept, tuning kept) are already pinned by `_248` engine tests and this design depends on them.
- **`ColorAutopilotPanel`'s `_248` follow-note banner**, the timeline `setColorAutopilot` cue path, and the plan-lock gating (`disabled` suppresses yields and STOP alike).
- **Live retune (`PATCH`) behaviour** and the `RetuneLine` microcopy.

## 7. Operator decision points

| # | Decision | Recommendation / shipped default |
|---|---|---|
| D1 | Yield scope for follow-note: L1 only, or L1+L2+L3? | **All three** (the order says "another tab, for example"); each trigger behind one constant so a veto is a one-liner. |
| D2 | Do TURNS/crossfade also yield on L1? | **No — persist + strip.** They are staged, cadenced ambience; uniform yield would make browsing destructive. Veto = flip one table row. |
| D3 | App-wide chip: all tabs, and for every family? | **All tabs, every active family.** Alternative: follow-note only. |
| D4 | Kind-named gate sentence replaces the kind-agnostic one? | **Yes.** |
| D5 | Engine-side deadman/lease on follow-note (stop on WS silence)? | **No.** Disappearance never stops a mode; sleep-survival is the placement's whole point. If ordered anyway, it must be a new engine slice — not in this wave. |
| D6 | Card auto-select on window entry (§4.3)? | **Yes**, entry-only. |
| D7 | Engine-side write gate on `colorPalette1/2` while the daemon runs (C5 hard fix)? | **Not in this wave** — cross-cutting refusal surface; visibility chip covers the confusion. File separately if wanted. |

## 8. Implementation contract (W-items, sized for parallel Sonnets)

Ownership is per-file so the slices cannot collide. W1 lands first (it is
signatures + pure logic the others compile against); W2/W3/W4 then run in
parallel; W5 validates.

**W1 — pure logic (Sonnet A). Files: `CaptainPad/components/deck/colors_window_logic.ts`, `colors_window_logic.test.ts` only.**
- `manualWriteGate(disabled, kind)` — kind-named sentences (§4.2); the old
  2-arg form deleted, all call sites updated by W2 (signature agreed here).
- `schemeTapOutcome(kind, schemeTitle, surface: 'two'|'turns'|'follow')` —
  method-override only when `kind==='follow-note' && surface==='follow'`;
  otherwise the §5 stage-only sentence; existing rows byte-identical for
  `surface === kind`'s own card.
- New `yieldDecision(args: {gesture:'card'|'hide'|'tab'; leavingCard:Mode;
  kind:RotationKind; disabled:boolean})` → `{yield:boolean; post?:{active:false};
  say:string}` — the §2.1 rule as one total function; refusal/no-op cases
  return `yield:false` with an empty `say`.
- New `drivingStripModel(kind, broadcast)` → `{show:boolean; title:string;
  detail:string}` (§4.1), and `colorChipLabel(kind, notePc)` (§4.4 labels,
  reusing `noteName`).
- *Accept:* vitest covers every row of the §3 and §5 tables by name (a test
  per cell, table-driven); `yieldDecision` proven to never fire on
  `disabled`, on `kind!=='follow-note'`, or on `leavingCard!=='follow'`;
  sentences snapshot-pinned; suite green, `tsc` clean.

**W2 — COLORS window (Sonnet B). File: `CaptainPad/components/deck/colors_window.tsx` (+ a new `driving_strip.tsx` if extracted).**
- Render the driving strip from `drivingStripModel`; inline STOP →
  `onColorAutopilotChange({active:false})`, disabled-gated.
- L1 yield: ModeButton `onPress` runs `yieldDecision({gesture:'card', …})`
  before `setMode`; POST via `onColorAutopilotChange`, narration via `say`.
- Card auto-select on window-visible transition (§4.3) — entry only; add a
  `visible` prop if the workspace does not already provide one.
- Scheme taps pass `surface` (the current card) into the W1 outcome; blend
  scrubber + ramp render inert under `kind==='follow-note'`.
- Report the visible card upward via a new `onCardChange?(card: Mode)` prop
  (consumed by W3).
- *Accept:* component tests for strip show/hide per kind×card; a ModeButton
  tap away from a running follow card issues exactly one POST with body
  `{active:false}` (mock asserts byte shape) and switches the card even when
  the POST rejects; **grep gate**: no `setInterval`/`requestAnimationFrame`
  in the diff; `tsc` + lint clean.

**W3 — deck screen + workspace wiring (Sonnet C). Files: `CaptainPad/app/(tabs)/index.tsx` (+ minimal `deck_workspace.tsx` glue if needed).**
- Track the COLORS card via W2's `onCardChange`; wire L2 (the workspace
  `closeWindow('colors')` path) and L3 (deck-screen blur via
  `useFocusEffect` cleanup / navigation listener) through `yieldDecision`
  with the tracked card; POST through the existing
  `handleColorAutopilotChange` (its rollback/opError narration covers the
  failure sentence).
- Takeover messages name the loser (§5 row 1): derive the previous kind at
  POST time in the two start paths' success narration.
- *Accept:* tests (or a pure extracted helper with tests) proving: hide while
  card=`'follow'`+driving → one stop POST; hide while card=`'two'` → zero
  POSTs; tab blur behaves identically; plan-lock (`disabled`) suppresses
  both; no POST on mount/focus/reconnect ever (assert zero calls across a
  simulated reconnect).

**W4 — app-wide chip (Sonnet D). Files: `CaptainPad/hooks/useEngineState.ts`, new `CaptainPad/components/ui/color_mode_chip.tsx`, the shared header integration point.**
- Surface the `colorAutopilot` control frame `{active, mode, palettes?,
  notePc?}` in the shared engine-state store (read-only; the deck screen's
  existing consumer is untouched).
- Chip per §4.4; tap navigates to the Deck tab. No stop affordance.
- *Accept:* store test (frame in → chip model out, absent/parked → hidden);
  chip renders on a non-Deck tab in the web build; zero writes from any code
  in this slice (grep: no `setDeckColorAutopilot`/`updateParamCenter`
  imports).

**W5 — validation (Opus). No product files.**
- Offline walk against a **post-`_248`** scratch engine (HIGH port 17xxx,
  `--dest 192.0.2.9`): arm follow-note by POST; drive L1/L2/L3 in a fresh
  dist; assert the engine's runtime block after each yield is
  `active:false, mode:followNote` with the tuning intact; assert a follow-up
  START restores the same cycle without re-sending it; assert a yield POST
  against a *pre-`_248`* engine build still stops a palettes rotation (the
  legacy-shape property, §1.8).
- Two-tab race: tab A on the follow card, tab B posts a palettes takeover →
  tab A's gesture a beat later must not 400 or revive anything (bare stop
  lands on the palettes rotation only if the gesture pre-dated the broadcast;
  document the observed sequence — the invariant is *no error surfaced, no
  mode resurrected*).
- **Screenshot matrix** (all inspected, `~/tmp/fix_<n>/`): ① follow running,
  follow card (baseline) · ② tap TWO COLOUR → card switched, message line
  `FOLLOW NOTE stopped…`, strip absent, rig frozen (two frames byte-equal)
  · ③ remote-armed follow, window opens → follow card auto-selected · ④
  remote-armed follow, operator on TURNS card → driving strip with STOP · ⑤
  wheel-drag refusal showing the kind-named sentence · ⑥ scheme tap on the
  two card under remote follow → stage-only sentence, engine `method`
  unchanged (asserted via GET) · ⑦ Mixer tab with the `COLORS · FOLLOW G`
  header chip · ⑧ engine unreachable mid-yield → failure sentence + strip
  still shows driving · ⑨ blend scrubber inert under follow-note · ⑩ TURNS
  running through an L1/L2/L3 round trip → still running (GET before/after
  identical `nextSwapAtMs` cadence).

## 9. Test-plan summary

W1 table-driven vitest (every §3/§5 cell) · W2 component tests + POST-shape
mocks + timer grep · W3 navigation-trigger tests incl. the zero-POST
reconnect assertion · W4 store/chip tests + no-write grep · W5 offline walk +
race + 10-shot matrix. CaptainPad suite must end with an empty failing list
against the session-start baseline (`_239` discipline); no engine suite is
touched because no engine file is.
