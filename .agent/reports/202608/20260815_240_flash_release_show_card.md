# _240 — Flash soft release, FLASH ALL WHITE off the chip row, and the simplified SHOW autopilot card

**Date:** 2026-08-15 · **Branch:** `feat/bm_readiness` · **Agent:** _240 (Opus implementer)
**Plan:** `docs/57_baby_show_polish_infra.md` (W1-W8, authored by `_238`) ·
**Rationale:** `.agent/reports/202608/20260815_238_baby_show_infra_plan.md`
**Operator orders (verbatim):** *"make the flashes do a soft release into a dark or
soft release back to the show"* · *"remove the all white blast from the UI"* ·
*"show the current pattern name on the auto pilot, and simplify the auto pilot,
play, and time, 1, 5, 10, 15 that's it"*.

> **THE ENGINE MUST RESTART.** Schema, service and show YAML move together
> (docs/57 §5): a `reloadLibrary()` on the old process with the new YAML turns
> both shows into red WILL-NOT-LOAD cards. Land engine + schema + YAML in one
> deploy and bounce the launcher once.

**Branch note.** The session brief flagged a possible mismatch. Verified at start:
the shared tree is on **`feat/bm_readiness`** (not `feat/bm_audio_tuning`, which
was a stale status snapshot). Recorded, not switched.

---

## 1. What landed, per W-item

| W | Item | Status |
|---|---|---|
| W1 | Controller release envelope (`setEffect` 3rd arg, per-effect map, `show`/`dark`, strobe `fadeOutMs`) | **done** — 15 new unit tests |
| W2 | Schema: `releaseMs` / `releaseTo` / `fadeOutMs`, quick-effect `blastWhite` refusal | **done** — 8 new schema tests |
| W3 | Runner passthrough + api_server deps | **done** — 6 new passthrough tests |
| W4 | Show data wave (both shows, both scenes) + `everySec` retune | **done** — plus the test_bench `baby_reveal` mirror (coordinator add-on) |
| W5 | G1 globals restore, G2 no-autopilot hard cut | **done** — 3 new API tests |
| W6 | `nowPlaying` on the wire | **done** — 3 new API tests |
| W7 | CaptainPad SHOW AUTOPILOT card | **done** — tsc + lint clean, 14 new vitest |
| W8 | Verification (offline walk, envelope proof, screenshots) | **done** — all clean |

---

## 2. W1 — the release envelope (`marsin_engine/lib/global_effects_controller.js`)

**Generalized the shipped `vintageWhite` ramp; did not invent a second one.**
The `_vwFade*` fields became a per-effect map `_fxRelease` covering
`vintageWhite`, `blastWhite`, `uvBlast`:

```js
setEffect(effectName, state, opts)   // opts = { releaseMs 0..5000, releaseTo, nowMs }
```

- **Falling edge only.** A rising edge always clears the entry (retrigger snaps
  to full) — the shipped contract, unchanged.
- **Two targets.** `show` → `px.c = max(px.c, env)` (the running pattern rises
  through the flash); `dark` → `px.c = env` (replace-decay to black).
- **Every channel the slam owned.** `blastWhite` decays r,g,b **and** w/a where
  present — a partial decay would fall apart into a colour cast on the way out.
- **Bypass-dimmer flags held through the release**, exactly as during the hold,
  so the exit cannot jump brightness.
- **Computed once per frame**, retires itself at zero; an idle rig pays one map
  lookup per releasable effect.

**Backwards compatibility is exact.** `_vwFadeActive` / `_vwFadeStartMs` are now
accessors onto the shared map, so `getStatus()`, the Stoker path and the
fire-sync suite are untouched — **all 7 pre-existing vintageWhite tests pass
unmodified**. An entry created from vintageWhite's *configured* value carries
`fromConfig` and keeps reading `vintageWhiteReleaseMs` **live**, so retuning or
zeroing it mid-ramp behaves bit-for-bit as before.

**Refusals (codex P0 — never clamp, never ignore):** out-of-range/non-numeric
`releaseMs`; unknown `releaseTo`; a release named on an effect that has none
(`fogger`, `horn`, `fire`, and `invert` at the api_server dep).

**Strobe needed no controller change** — `setStrobe` already threaded
`meta.fadeOutMs` into the existing `strobeFadingOut` blend, and
`global_effect_library.js` already validates it. Only the api_server dep was
missing the parameter. New in `getStatus()`: `effectReleases` (live `env`,
`releaseTo`, `remainingMs`, or null), which is what makes a soft exit provable
from outside.

## 3. W2 — schema (`show_schema.js`)

`releaseMs` (integer 0..5000, default **0 = today's hard cut**), `releaseTo`
(`show`|`dark`, default `show`), strobe `fadeOutMs` (0..5000, default 0).
Refusals, each with a message naming the fix:

- `releaseTo` present with `releaseMs: 0` — a target with no mechanism.
- `state: true` + a release — a latch ON has no falling edge.
- `releaseMs` on `invert` — a whole-frame filter with no boost to decay
  (`EVENT_RELEASABLE_EFFECT_IDS`, added beyond the plan to keep the schema and
  the controller's `RELEASABLE_EFFECTS` honest with each other).
- **`blastWhite` anywhere inside `quickEffects`** — refused wherever it hides in
  the action list, with the message directing the author to a stage/choice
  action. `blastWhite` **stays in `EVENT_EFFECT_IDS`**.

## 4. W3 — runner + deps

`_applyEffectAction` passes `{ releaseMs, releaseTo }` on the hold-expiry timer
and on `state: false`. An action authoring **no** release makes a genuine
**two-argument** call (`_setEffectOff`) — not a third `undefined` — so an
unauthored falling edge is indistinguishable from every pre-`_240` call site
down to arity. `_releaseAllEffects()` stays **instant**, with a comment saying
so out loud: a teardown must not linger in a decay tail (panic precedence,
docs/52 §4.2). `fireStrobeBurst(hz, durationMs, fadeOutMs)`; the runner's own
cleanup now waits `durationMs + fadeOutMs + 250` so it cannot cut the fade.

## 5. W4 — show data

Both shows, both scenes, byte-identical:

| Moment | Release |
|---|---|
| Reveal + KISS `blastWhite` (4 choice paths) | `releaseMs: 700, releaseTo: show` |
| VINTAGE WHITE chips (×4 stages) | `releaseMs: 800` |
| UV BLAST chips | `releaseMs: 800` |
| STROBE bursts | `fadeOutMs: 400` |

**7 FLASH ALL WHITE chips stripped** (baby tease ×1; wedding gathering /
celebration / photos ×2 scenes). Tease cadence `everySec: 20 → 60`
(**operator-vetoable**, one line). Comments updated: the reveal/KISS timing
blocks gained the release line and the invariant; the KISS's `autopilot:` block
comment now records that G2 makes it redundant-but-explicit.

**One catch by my own new test:** the wedding PROCESSION stage's `vintage_white`
chip was missed on the first pass and the "every quick effect ends on a soft
release" test failed on it. Fixed.

**Coordinator add-on — `simulation/scenes/test_bench/special_events/baby_reveal.yaml`
created** as a byte-identical mirror of the titanic copy (post-`_240` shape), so
the baby show is rehearsable on the bench. Validated in the offline walk: loads
with zero errors, ARMs, walks clean. The `baby_*` playlists already exist in
both scenes.

## 6. W5 — the two folded-in runner gaps

- **G1 (`_231` §7.1) — `globals` is now restore-covered.** New `captureGlobals`
  dep built on the existing `captureGlobalsForSnapshot()`, flattened to the
  `{ key: value }` shape `setGlobals` consumes so capture and restore speak one
  shape. ARM stores it; FINISH/ABORT restore **only the keys a `globals` action
  actually wrote** (`_globalsWritten`) — restoring the whole ParamCenter would
  stomp state no stage touched and could trip size/source-lock refusals.
  Skipped for PANIC alongside the look restore.
- **G2 (`_231` §5) — a no-`autopilot:` stage is a HARD CUT stage.** The runner
  sets `setDeckTransition({ enabled: false })` before dispatching such a stage's
  actions. This is the bug class that made THE KISS land its answer playlist as
  a ~5.7 s dissolve under a 900 ms flash.

## 7. W6/W7 — NOW PLAYING and the card

`getDeckNowPlaying()` dep (same read as `pushActiveEntryToModulation`) →
`nowPlaying: { pattern, label } | null` on `_autopilotWire()`, read through the
same guard as `nextSwapAtMs`. **No new timer and no broadcast-on-change logic
was needed**: the runner's 1 s `_tick()` already broadcasts unconditionally
while a run is live, so a rotation swap reaches the tab within a second on a
minutes-scale cadence. (The plan budgeted for change-tracking; it would have
been dead code, so it was left out.)

**The card as built** — `components/special_events/show_autopilot_card.tsx`,
with pill logic split into `show_autopilot_logic.ts` for unit testing:

1. `SHOW AUTOPILOT` title + identity dot (live-green when active)
2. **NOW PLAYING** — `label` else pattern id (`nowPlayingTitle`), `—` when null
3. **PLAY / PAUSE** — live-green state-tinted, 56 pt
4. **Pills 1 · 5 · 10 · 15 MINUTES** → `everySec` 60/300/600/900
5. the `overridden` "SHOW DEFAULT" strip, unchanged, still gated on `overridden`

**A cadence matching no pill lights no pill** and prints itself ("Show file says
20 SEC — tap a pill to change it"), so a hand-authored value is never rounded on
screen. Countdown omitted per "that's it". **No edits under `components/deck/`** —
the deck panel and cue editor are untouched; `PatternAutopilotPanel` is simply no
longer imported by the Events tab.

---

## 8. Verification

### Envelope proof (the acceptance criterion)

Real `GlobalEffectsController`, real authored numbers read out of the shipped
YAMLs, 40 fps, injected clock, over an old look `rgb(0.10,0.10,0.10)` swapped to
a new look `rgb(0.85,0.20,0.55)`. **All 4 choice paths** (reveal girl/boy, kiss
party/glow) identical:

```
  t (ms)      r        g        b     env    phase
      0  1.0000  1.0000  1.0000  1.000  HOLD
    675  1.0000  1.0000  1.0000  1.000  HOLD
    700  1.0000  1.0000  1.0000  1.000  HOLD   ← the playlist SWAP lands here
    800  1.0000  1.0000  1.0000  1.000  HOLD
    875  1.0000  1.0000  1.0000  1.000  HOLD
    900  1.0000  1.0000  1.0000  1.000  RELEASE starts
   1075  0.8500  0.7500  0.7500  0.750  RELEASE
   1250  0.8500  0.5000  0.5500  0.500  RELEASE
   1425  0.8500  0.2500  0.5500  0.250  RELEASE
   1575  0.8500  0.2000  0.5500  0.036  RELEASE
   1600  0.8500  0.2000  0.5500  0.000  CLEAR
```

- **Swap hidden: YES** — pure 1.0 white on every channel for the whole
  `[700, 900]` window, so the content change is uncoverable by eye.
- **Max dimming of the new look during the release: `0.000000`** — `show`
  never pulls a pixel below what the pattern wrote. `r` is already at its
  pattern value 0.85 by t=1075 (the show has risen through); the dim channels
  trace the envelope down until the pattern overtakes them. That *is* the bloom.
- **Invariant `playlist.delayMs (700) ≤ flash end (900)`: HOLDS** on all four.

### Offline engine walk — port **17239**, `--dest 192.0.2.x` (TEST-NET-1)

`test_bench` model, temp state dir. **CLEAN.** Zero load errors; `baby_reveal`
listed on the bench (the new mirror); ARM accepted; tease → blackout → reveal
(girl) → photos all fired; FINISH restored with `lastError: null`. Every stage
of both shows confirmed free of a `blast_white` chip. Tease `everySec: 60`.
`nowPlaying = {"pattern":"baby/01_tease_orbit_question","label":"Baby Tease - Orbit Question"}`.

> **A false alarm worth recording:** `nowPlaying` first read `null` on the tease.
> Not a bug — the probe was racing the tease's authored **2000 ms crossfade**;
> the deck's `activeEntryId` is only committed when the animated swap lands.
> With a proper settle it resolves correctly. Anything timing the deck after a
> stage fires must wait out that stage's transition.

### Test results

**Engine — `--test-concurrency=1`** (see the flake note below):

| Suite | Result |
|---|---|
| `tests/special_events/*` (6 files) | **108/109**, 1 foreign |
| `tests/effects/*` (48 files) | **631/631** |
| `tests/timeline/*` | **445/445** |

**Failing list — engine: 1, and it is FOREIGN and pre-existing.**
`wedding_show.test.js` › *every referenced playlist exists in BOTH scenes,
byte-identical, and is loadable* — `'wedding_ceremony' has drifted between the
titanic and test_bench scenes`. Present in my baseline before any edit; it is
playlist content, owned by the operator's curation session. **Baseline was
94 tests / 93 pass / 1 fail; now 131 / 130 / 1 in the same file set** — +37
tests, all green, same single foreign red.

Related, not touched: the `baby_tease` / `baby_boy` playlists also differ
between scenes, but **only in YAML serialization** (`0.5` vs `0.50`, folded vs
inline `notes:`) — semantically identical, same curation-session territory.
Flagged, not edited.

**CaptainPad:** `vitest run` **1598 passed / 0 failed** (81 files, 6 skipped);
baseline was ~1584 with an empty failing list. `tsc --noEmit` clean.
`expo lint`: **0 errors**, 14 warnings all pre-existing in foreign files, none
in any file I touched.

> **Harness flake, not a regression.** Running all 48 `tests/effects/*.test.js`
> in parallel produced a *different* set of 1-6 reds on each run (engine
> subprocesses contending). Serially: **631/631**. Worth knowing before someone
> chases one of those reds.

### Screenshots — `~/tmp/fix_240/`

Fresh dist on **:7172**, served-bundle hash verified against disk
(`entry-9d744d9708a0bbeb41c3f413f0ec8798.js`) so a squatter on a lower 71xx port
could not be mistaken for it; console muted before boot.

- `240_show_autopilot_card.png` — the card: `SHOW AUTOPILOT` · NOW PLAYING
  **"Baby Tease - Orbit Question"** · **PAUSE** in live-green · pills **1**(lit)
  5 10 15 MINUTES. No countdown, no shuffle/group/deck-tx chrome.
- `240_quick_effects_no_flash_all_white.png` — `QUICK EFFECTS  STROBE ·
  VINTAGE WHITE · UV BLAST`.

Both captures self-verify by reading the rendered text back: `FLASH ALL WHITE`
**gone**, deck-panel chrome (`AUTOPILOT PATTERNS` / `DECK TX` / `SHUFFLE STYLE`
/ `GROUP`) **gone**.

**LIVE STACK UNTOUCHED.** 6966-6972 were never bound, killed or restarted;
17239 and 7172 were mine and are released.

---

## 9. Open operator vetoes (all one-liners)

1. **Pill unit = MINUTES** (60/300/600/900) — `PILL_MINUTES` in
   `show_autopilot_logic.ts`.
2. **Tease cadence 20 s → 60 s** — one line in `baby_reveal.yaml` (both scenes).
   Reverting it lights no pill and the card prints "20 SEC", which is honest.
3. **Countdown omitted** from the SHOW card.
4. **Reveal/KISS release 700 ms** — any 1..5000 is authorable.

## 10. Files

**Engine:** `lib/global_effects_controller.js`, `lib/special_events/show_schema.js`,
`lib/special_events/special_events_service.js`, `lib/api_server.js`
**Show data:** `simulation/scenes/titanic/special_events/{baby_reveal,wedding_program}.yaml`,
`simulation/scenes/test_bench/special_events/{baby_reveal,wedding_program}.yaml` (baby = NEW)
**CaptainPad:** `components/special_events/show_autopilot_card.tsx` (new),
`components/special_events/show_autopilot_logic.ts` (new),
`app/(tabs)/special_events.tsx`, `utils/special_events_api.ts`
**Tests:** `tests/effects/effect_release_envelope.test.js` (new),
`tests/special_events/effect_release_passthrough.test.js` (new),
`tests/special_events/{show_schema,wedding_show,special_events_autopilot_api}.test.js`,
`CaptainPad/components/special_events/show_autopilot_logic.test.ts` (new),
`CaptainPad/utils/special_events_api.test.ts`,
`CaptainPad/components/special_events/special_events_view.test.ts`
**Tooling:** `simulation/agent_tools/show_autopilot_card_capture.cjs` (new)

**Deliberate edits to another agent's suite:** `wedding_show.test.js` (celebration
chip set 4 → 3, plus release/invariant assertions) and `show_schema.test.js`
(tease chip set 4 → 3, plus release/invariant assertions) — both are `_231`/`_230`
territory and both changes are the point of W2/W3/W4, named here as required.
