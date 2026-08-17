# _248 — FOLLOW NOTE + method autopilot + LIVE RETUNE (IMPLEMENTATION)

**Date:** 2026-08-15 · **Role:** developer (Opus) · **Contract:**
`docs/59_follow_note_color_autopilot.md` (the `_244` Fable design) · **All nine
W-items shipped, W9 included.**

**Operator orders:** (1) *"can you add a new option in the color to use the note
as the main color … follow note, and have the method cycling smoothly on a
timer is what I want for the colors as a new feature."* (2) *"also make sure the
changing of the parameters for those existing ones too doesn't need a full stop
and start again."*

---

## What shipped

### W1 — the generator port, parity-pinned

`marsin_engine/lib/color_schemes.js`: the nine generators, byte-equivalent to
`colors_window_logic.ts`, with **zero imports of any kind** (asserted by test —
the module is pure arithmetic over numbers, so "no CaptainPad import" is
strengthened to "no import at all"). FOLLOW NOTE needs this because the base hue
moves with the music: a precomputed client ring cannot express a hue nobody has
played yet, so the engine must re-derive on every committed note.

**The parity table is the whole safety argument** and it is the `_217` `lerpHue`
idiom: ONE literal of 9 scheme ids × 3 base hues → the full five `{h,s,v}`
triples, asserted **EXACT (no epsilon)** in BOTH
`marsin_engine/tests/effects/color_schemes.test.js` and
`CaptainPad/components/deck/colors_window_logic.test.ts`. 27 exact assertions on
each side. Both sides run identical arithmetic in identical order, so a
tolerance would only hide the day one of them stops doing that.

**One deliberate divergence from a naive port, and it is the interesting one.**
My first draft "normalized" the base hue with `((h % 1) + 1) % 1`. That is not
the identity on an in-range hue — it turns `0.1` into `0.10000000000000009` —
so it would have put the engine's ring a float off the client's for exactly the
hues that look safest, and the parity table would have been a lie. The engine
now **THROWS** on a base hue outside `[0,1]` instead: a boundary check, not a
wrap, pinned by its own test.

### W2 — wire + validate

`mode: 'palettes' | 'followNote'`, **absent ≡ palettes** so every pre-existing
config is byte-unchanged and byte-understood. Follow-note mode **forbids**
`palettes`/`delay_s`/`transitionMs`/`shuffle`, naming the offending field;
palettes mode **carries a followNote block inert** (validated on the way in, so
a mode toggle cannot fail a week later on a block that was stored broken).
Refusals for: unknown mode, missing block, unknown scheme id (named), empty
subset, repeated method, `methodFadeS <= 0`, negative hold, the CONT spin loop
(`methodHoldS 0` requires `methodFadeS >= 0.1` — the existing
`MIN_CONTINUOUS_TRANSITION_MS` rule in the method cycle's own units), bad `sel`,
negative/NaN `noteFadeMs`.

**`ColorAutopilot.mergeWire` is new and load-bearing.** The route's old
`{ ...state, ...body }` merge cannot survive a mode discriminator: the live
state always carries `palettes`, so a body saying `mode:'followNote'` would
merge into a config carrying BOTH modes' fields and be refused — **START FOLLOW
NOTE would have 400'd on a perfectly good request, every time.** The merge is
now scoped to the TARGET mode, and the inert block rides along so a
there-and-back toggle restores the operator's tuning instead of erasing it.

**And the mirror of that bug, which the engine-API suite caught late.** A body
with NO `mode` was inheriting the LIVE mode. Every caller written before this
feature POSTs `{active, palettes, delay_s, …}` with no mode at all — the
timeline cue path, older CaptainPad builds, hand-rolled scripts — so **once
FOLLOW NOTE had been used once, every one of those came back 400** with "does
not take 'palettes'". `color_window_engine_api` went 20/20 → 10/20 the moment
the persisted runtime block was left in follow-note mode, which is exactly the
state the operator's engine is in after trying the feature. New
`ColorAutopilot.inferMode`: a body naming a palettes-mode field IS a
palettes-mode config, a body carrying a `followNote` block IS a follow-note one,
a body carrying neither keeps the live mode (a bare `{active:false}` stop must
not change it), and a body carrying BOTH is genuinely ambiguous — it keeps the
live mode and lets `validate` refuse it by name, because the one thing that must
never happen is quietly picking one half of the body. Four regression tests.

### W3 — the two loops

**Method timer**: the existing generation-guard model, with `_scheduleNext` /
`_holdMs` / `_rotationLength` made mode-aware and `_pickIndex` shared by both
rotations (so "shuffle never repeats" is one rule, not two). Hold and fade stay
**additive** — asserted directly: hold 10 s + fade 2 s arms the next tick at
`tick + 2000 + 10000`.

**Note listener**: `paramCenter.subscribe`, not a poll. The first thing the
subscriber does is a two-number compare and a bail, so a held note costs two
reads and a branch — **50 CPC events on a held note write nothing at all**
(tested). The new pair is recorded BEFORE the apply, which bounds a broken feed
to one loud log per distinct bad value instead of one per hop. Subscription
taken on activate, released in `stop()` / `deactivate()` / on a mode change
back to palettes (all tested) — a stopped daemon that kept listening would keep
writing the palette, the exact "STOP did nothing" failure the gate exists to
prevent. **A follow-note config with no CPC hooks THROWS** rather than quietly
cycling methods on a frozen hue.

**Two real bugs the tests caught here (two more below and in W7):**

1. **The first method advance repeated the starting method.** `_primeFollowNote`
   applied `schemes[0]` but left the cursor at −1, so `_pickIndex` handed back 0
   again and the first "advance" was a three-second crossfade to itself. The
   prime now CONSUMES a cycle position (and deliberately does not when a
   scheme-tap override is pending — that is what makes `currentScheme` read the
   override).
2. **The card's note letter was a whole method hold stale.** Measured on the
   offline walk: the rig had moved to G while the card still said E, because
   nothing re-broadcast between method advances (up to 60 s by default). New
   `onNoteChange` hook, fired on a COMMITTED note change only — the hop-rate
   republishes never reach it.

### W4 — front door + broadcast

`colorAutopilotState()` is now **MODE-SCOPED**: exactly one mode's fields, plus
`mode` always, plus the runtime facts follow-note renders from
(`currentScheme`, `notePc`, `noteHue`, `nextMethodAtMs`). The seed-from-live-rig
call moved **before** `setState`, because follow-note puts its first ring on the
rig DURING `setState` (a start must not leave the card claiming "NOTE IS
DRIVING" through a 60 s hold while nothing is) — nothing in `setState` touches
`_currentParams`, so the palettes path is byte-identical either way.

### W5 — LIVE RETUNE

`ColorAutopilot.patchState(sparse, knownIds)` + `PATCH /deck/color-autopilot`.
**The load-bearing rule: patch never bumps `generation` and never cancels the
tween** — asserted directly across six consecutive patches. The reset behaviour
of `setState` was never in the tick (which reads state, ring and durations
fresh at fire time); it was in the bump and the cursor reset, which patch simply
does not do. `active` and `mode` are REFUSED by name; a field belonging to the
other mode is refused naming both; the CONT spin-loop rule is re-checked against
the MERGED pair so a patch cannot be a side door into a config a POST refuses.

**One honest deviation from docs/59 §5.1, stated.** The design says re-arm to
`lastTickAtMs + newHold`. That is only phase-preserving when the fade is zero:
with a real fade the hold begins AFTER the fade lands, so measuring from the
tick would silently eat the fade out of the cycle and break the additive
scheduling contract. I record BOTH `_lastTickAtMs` (on fire, as specified) and
`_holdStartedAtMs` (when the pending hold was armed) and re-arm off the latter.
With a hard cut the two instants coincide, so **docs/59 §5.3's stated identity
`nextSwapAtMs === lastTickAtMs + 10000` holds exactly** and is tested as
written; the fade case is tested as `holdStartedAt + newHold`.

### W6 — client logic

`rotationKind` gains `'follow-note'`, decided by the broadcast `mode` and never
inferred from palette shapes (a follow-note config HAS no palettes).
`schemeTapOutcome` gains the `method-override` row. New:
`followNoteAutopilotPatch` (mirrors the engine validator refusal for refusal),
`toggleSchemeSubset`, `followNoteStateLine`, `nextMethodOf`, `noteName`,
`assertMethodTiming`, `retunableLive` / `retuneTiming` / `rotationRetunePatch`
(the §5.1 table as code). `manualWriteGate` is **unchanged** — deliberately
kind-agnostic, and its sentence stays true while following.

**`colorAutopilotWritable` learns the mode.** The palettes-only test would have
called every follow-note config un-toggleable and quietly dropped the colour
half of the APC clip_stop press. New `colorAutopilotConfigWritable(cfg)` reads
mode + block off a broadcast frame; the hook's three call sites now use it.

### W7 — UI

A third transport card in the COLORS window, reached by a third mode button.
State line, live ring swatches with A/B arm-then-tap (indices, so the pick
survives every re-theme the music causes — the exact property `_224` built it
for), method chips with three distinct states (off / in the cycle / **on the rig
now**, the last derived from `currentScheme`), METHOD HOLD `[CONT,10,30,60,120,
300]` default 60, METHOD FADE `[1.5,3,6,10]` default 3, NOTE FADE
`[SNAP,0.4,1,2]` default 0.4, START/STOP. The method rows are deliberately NOT
the `_224` shared transport: that is the PAIR cadence (seconds-scale), this is a
MOOD cadence (minutes-scale).

**Live-retune honesty microcopy on all three cards** (`RetuneLine`): while a
family is running, its rows say *"HOLD applies now · FADE from the next fade —
no stop and start."* Live retune is otherwise invisibly partial, and a surface
that showed both as instant would tell a small lie every time the operator moved
the FADE pill mid-fade and saw nothing happen. The wording comes from
`RETUNE_TIMING_TAGS`, i.e. the same table the patch builder obeys.

**Zero timers added**: grep-clean for `setInterval`/`requestAnimationFrame` in
`colors_window.tsx`. The countdown is the existing self-ticking
`<SwapCountdown>` (the `_211` idiom), so the one node that re-renders each
second is a chip, not the window.

**A third real bug, and it was a white-screen.** Loading the deck while
follow-note was running crashed the whole screen: the focus seed put the
mode-scoped payload straight into state, `palettes` became `undefined`, and
`ColorAutopilotPanel` read `.length` off it. Fixed at both doors — the seed now
normalizes exactly as the WS reconcile already did — and the AUTOPILOT window's
colour panel is now mode-aware: it says *"FOLLOW NOTE is driving the colours …
its controls are in the COLORS window"* rather than drawing an empty chip row as
though the operator had selected nothing.

### W8 — offline walk + screenshots

29/29 PASS against a REAL engine on **:17248, `--dest 192.0.2.x`** (TEST-NET-1),
note injected through `POST /param-center` (the `hil_audio_reactive_profile`
trick — the mic is never opened, the live companion never contacted).

### W9 — the Scriabin preset (INCLUDED)

`NOTE_COLOR_SCRIABIN` in `audio/config/derived_signals_config.js` + a **SCRIABIN**
button beside RESET ALL in the Companion note-colour editor. It goes through the
ORDINARY `setDerivedConfig` door as a single 12-field patch — validated,
persisted and broadcast exactly like a hand turn of the hue slider, with no
preset-shaped side channel that could write a hue the editor would refuse.
HUE ONLY: Scriabin's table also varies S/V, but this wheel is hue-only by design
and `generateScheme` takes a bare hue, so the S/V could not ride through the
generators anyway — dropped explicitly rather than discovered later. Not
two-tap-armed like RESET ALL, because it is reversible; RESET ALL is the thing
that wipes twelve hand-tuned values. The UI bundle's copy of the twelve hues is
pinned byte-for-byte against the engine constant by test (the bundle is static
and cannot import the config module).

---

## Verification

| Suite | Result |
|---|---|
| `tests/effects/color_schemes.test.js` (W1) | **39/39** |
| `tests/effects/color_autopilot_follow_note.test.js` (W2/W3/W5) | **54/54** |
| `tests/effects/color_autopilot.test.js` | **48/48** |
| `tests/effects/color_window_engine_api.test.js` | **20/20** |
| `tests/audio/note_color_scriabin.test.js` (W9) | **7/7** |
| Engine full suite | see below — **my failing list EMPTY** |
| CaptainPad vitest | **89 files / 1830 pass / 0 fail / 6 skip** (`colors_window_logic.test.ts` 125 → 228) |
| `tsc` | clean on every file I touched |
| `expo lint` | 0 errors, 0 warnings on every file I touched |

**Foreign failures, named and diagnosed.** My five colour/audio suites are
**168/168** run one file at a time. The full engine run finished at 3613 tests
with 35 failures, and every one is in a file I never touched, with a cause I
traced:

- `tests/special_events/*` (18) — the spawned engine dies with
  `ENGINE FATAL — unhandledRejection: Error: Deck transition 'deck_1_…' was
  cancelled`, after which every fetch is `ECONNREFUSED 127.0.0.1:17230`. That is
  the deck-transition path `_245` is auditing. Reproduces in isolation with
  nothing else running, so it is not contention.
- `tests/mixer/{follow_link,groups_solo_state,blend_precompile}` +
  `tests/effects/bump_flash` (11) — `No compiled blend handle for mode
  'blend_screen'`. That is `pattern_mixer.js`, `_243`'s file, whose mtime is
  15:32 — i.e. it was rewritten *during* my run.
- `tests/mixer/all_models_load_lint.test.js` (5 × `dev_test_bench` sidecar) and
  `tests/playlist/ambient_playlist_campaign.test.mjs` (1) — present in an
  earlier mid-wave run too, unchanged by anything of mine.

`tsc` likewise reports errors only in
`components/deck/pixel_paint_target_{canvas,skia}.ts` — `_243`'s brand-new
files, which did not exist when my first clean `tsc` ran.

**The offline walk (29/29), with the numbers that matter:**

- START FOLLOW NOTE **over a running palettes config** → accepted, payload
  mode-scoped (no palettes leak), `currentScheme=complement`.
- The rig landed on the ring the note derives: `c1.h=0.25`,
  `c2.h=0.41666666666666663` — the parity table's `complement@0.25`, at the
  generators' `s=0.95` rather than the hue-only pin.
- A note change to `0.61803` re-derived and slewed; broadcast carried
  `notePc=7 noteHue=0.61803`.
- **20 republishes of the SAME note left the rig byte-identical.**
- **LIVE RETUNE, follow-note:** `methodHoldS` 10 → 30 mid-hold — **no colour
  written**, method unchanged, **`Δ nextMethodAtMs = 20000 ms` exactly** (want
  20000).
- **LIVE RETUNE, crossfade:** `delay_s` 2 → 10 mid-hold — **no colour written**,
  **`Δ nextSwapAtMs = 8000 ms` exactly** (want 8000).
- Method override: `PATCH followNote.method: tetrad` → `currentScheme=tetrad`,
  rig crossfaded to `c2.h=0.86803` (`tetrad@0.61803` slot 1).
- Refusals all 400 with the naming sentence: PATCH `active`, PATCH `mode`, PATCH
  a cross-mode field, PATCH emptying the cycle, POST mixing both modes' fields,
  POST with an unknown generator.
- **20/20 on `color_window_engine_api` against a runtime block left in
  follow-note mode** — the regression above, now the pinned proof that a
  legacy `mode`-less palettes POST still works after the feature has been used.
- Mode toggle round-trips the tuning: palettes ← followNote ← palettes kept
  `methodHoldS: 30` without re-sending it.

**Screenshots** — `~/tmp/fix_248/`, all seven inspected. Fresh dist on **:7177**
(served bundle hash `entry-6c709cf7324607e0eb74cc70a18f31a9.js`, verified against
the export), console-muted, against the OFFLINE engine on :17248. The live
6966-6972 stack and :6981 Metro got **read-only GETs only** — never bound,
killed or restarted.

| File | What it proves |
|---|---|
| `248_follow_note_parked.png` | `FOLLOW NOTE — parked`, chips + pills at their defaults (7/9 lit, MASTER/HUE off) |
| `248_follow_note_running.png` | `NOTE IS DRIVING — G · COMPLEMENT → CONTRAST`, countdown chip `0:27`, live ring with A/B badges, COMPLEMENT chip lit as ON THE RIG |
| `248_follow_note_method_changed.png` | the method cycled: `… G · TETRAD → GOLDEN`, rig `c2.h=0.86803` |
| `248_follow_note_silence_hold.png` | `… · HOLDING LAST NOTE (audio silent)`, rig **UNMOVED** `{h:0.61803,s:0.95,v:1}` across the silence |
| `248_retune_before.png` / `248_retune_after.png` | the two-frame retune proof: `ENGINE: FADE 8s` → `3s` **mid-fade**, live hue walked `0.714587 → 0.960342` and **did not land on either endpoint** — the fade kept running through the pill change |
| `248_follow_note_narrow.png` | 820 px: chips wrap to two rows, nothing clipped |

New tool: `simulation/agent_tools/colors_follow_note_capture.cjs`. It caught a
real measurement error in itself — a bare `[aria-label]` lookup pressed the deck
TRANSITION row's "3s" pill instead of the crossfade card's and reported success
with `transitionMs` still 8000. `pressInRow` now anchors on the row's own label,
and the run **fails loudly** if the pill did not land.

---

## Operator gates

- **THE ENGINE MUST RESTART.** `color_autopilot.js`, `color_schemes.js` and the
  `api_server.js` routes all moved together; until the bounce, FOLLOW NOTE and
  every PATCH 400 on the live rig. The coordinator's gen-7 bounce covers it, and
  `_217` + `_242`'s restarts are still riding the same bounce.
- CaptainPad needs a fresh web build for the card.
- The Companion needs a restart for the SCRIABIN button (its UI bundle and
  config module both changed).

## Vetoes still open (docs/59 §10)

1. **Default method subset** — shipped as the seven multi-hue generators,
   MASTER/HUE opt-in. Veto: ship all nine on.
2. **Note fade 400 ms** — shipped. `SNAP` is the first pill for Live Touch
   parity; longer for a dreamier follow.
3. **Method hold 60 s** — shipped, row `[CONT,10,30,60,120,300]`.
4. **Scheme tap while following = method override now** — shipped (the `_224`
   restage idiom on the method axis). Alternative: a stage-only refusal.
5. **W9 Scriabin preset** — **INCLUDED**. It is inert until tapped; RESET ALL
   brings the reference wheel back.

## Residue

Engine runtime state files under `marsin_engine/states/` and
`marsin_engine/config.color_autopilot_runtime.yaml` may carry show residue from
the suite runs — expected, reported, not reverted. `CaptainPad/dist_248/` was
removed after the capture. No git operations were performed.
