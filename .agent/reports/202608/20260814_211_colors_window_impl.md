# _211 — COLORS window: slices B + C + D (two-colour select, engine E1, PALETTE TURNS)

**Date:** 2026-08-14 · **Agent:** _211 (Opus, implementation) ·
**Branch:** feat/bm_readiness ·
**Contracts:** `docs/53_deck_workspace_windows.md` §4-§5 +
`.agent/reports/202608/20260814_196_deck_workspace_design.md` (architecture),
`.agent/reports/202608/20260814_208_deck_workspace_impl.md` (the mount
interface), `docs/ui/color_palette_prototype.html` +
`.agent/reports/202608/20260814_199_color_prototype_v2.md` (the approved
interaction spec).
**Scope:** slices B (two-colour), C (engine E1), D (TURNS). Slice A untouched.

---

## 1. What shipped

The Deck's fourth window is real. It is still **closed by default** (the
workspace bar's HIDDEN rail) — slice A's default layout is unchanged.

### B — TWO COLOUR

- **Hue ring** (`hue_wheel.tsx`, react-native-svg): the Live Touch read model
  (0° up, clockwise), S=V pinned per docs/36, so the white-core/black-rim
  radius bands are gone and the control is a ring. Two handles labelled A/B ARE
  the engine's `colorPalette1` / `colorPalette2`. A touch that lands on a
  handle grabs it; anywhere else moves the armed one (the prototype's dot
  hit-test, with a finger-sized 26 pt grab radius). Overshooting the ring still
  tracks the angle.
- **Writes** go out as ONE atomic `/param-center` POST of both slots, leading +
  trailing throttled at 33 ms, with an un-throttled flush on release — the
  ColorPickerModal recipe. The engine slews over `colorTransitionMs`, which the
  window shows as a read-only `ENGINE SLEW x.xs` (editing stays in the picker:
  one home per setting).
- **The handles track the rig.** A 700 ms local-settle window lets the finger
  outrank the echo of its own write; after that the `sharedParams` broadcast
  owns the slots again, so the picker modal, QUEUE, Live Touch, a plan cue or
  the daemon all move the handles.
- **Crossfade preview** — the prototype's feel, ported exactly: triangle phase,
  a BLEND POSITION scrubber whose track is a live A→B OKLCH ramp and which
  SEEKS the same single phase variable, and **stop-freezes-in-place**. It is
  labelled `PREVIEW · DOES NOT WRITE THE RIG` (see §3.1), defaults OFF, and its
  ~24 fps loop exists only while it runs.
- **PRESETS pane** (visually distinct surface — recall, not edit): the five
  Live Touch samples at their exact hexes and hues (263/192/29/96/47°, ENGINE/
  ENGINE/LOCAL/LOCAL/LOCAL — _199 §2), with A/B badges **derived** from the
  live slots every render (drag the wheel and the badge leaves); SAVE PAIR /
  EDIT-delete over a two-tone `DualSwatch` gallery, tap loads both slots; and a
  collapsed SHOW PALETTE section for the 23 curated config pairs.

### C — engine E1

`ColorAutopilot.validate` and the api_server palette resolver now accept
**inline `{c1,c2}` hue pairs alongside library ids**, exactly as §5.3 scoped
it: no new endpoint, no new WS type, no new daemon. An object entry must have
finite `c1`/`c2` in [0,1] or it throws with the same loudness as an unknown id;
inline entries are copied (the daemon's state can't mutate under a wire object
someone else holds) and are NOT membership-checked. The resolver maps an inline
entry to the same `{colorPalette1:{h,s:1,v:1}, colorPalette2:{…}}` shape a
library id resolves to, so hard cut, crossfade tween, `seedCurrentParams` and
the timeline path are untouched.

### D — PALETTE TURNS

- Five slots on the same wheel (handles 1-5). The five chosen hues become the
  five adjacent pairs `[(T1,T2)…(T5,T1)]`, posted as ONE colour-autopilot
  config through the deck screen's existing `handleColorAutopilotChange`
  (optimistic + rollback + broadcast reconcile). **The rotation runs
  engine-side** in the existing daemon — it survives an iPad sleep, and it is
  the single hue writer while it runs.
- **One control, TURN EVERY** (5/10/15/30/60/120/180 s); the crossfade is
  derived — `clamp(round(delay*1000*0.25), 500, 3000)` — and stated on the face
  of the card. Fine tuning stays in ColorAutopilotPanel's TRANSITION bar (same
  config field, so the two surfaces cannot disagree).
- **Single-writer gate:** while the daemon is active the two-colour surface is
  read-only (dimmed ring, handles still tracking) with ONE affordance —
  `ROTATION IS DRIVING — TAP TO PAUSE`. A refused manual touch says why; it is
  never a silent no-op and never a silent auto-pause.
- **State display:** when the live config IS a turns ring (all inline pairs
  that chain), the window adopts it and highlights the pair on the rig,
  derived from the broadcast palettes + the reconciled `colorPalette1/2`.
- `utils/api.ts` `DeckColorAutopilotConfig.palettes` widened to
  `(string | {c1,c2})[]`, and **ColorAutopilotPanel renders an inline entry as
  a `DualSwatch` CUSTOM chip** — its old `byId.get(id)` skip would have made a
  live TURNS rotation look like an empty palette set.

---

## 2. The pair-store decision (the one that needed a call)

**Saved pairs live engine/scene-side, in `states/<scene>/color_pairs_state.yaml`
behind a new `GET/POST /color-pairs`.**

The operator ruled pairs are SHARED across iPads and _196/_199 rule out
localStorage as authority. I looked for an existing scene-owned store to reuse
and there isn't a fitting one: `param_presets` is per-channel pattern params,
`colorPalettes` is the tracked comment-bearing config.yaml (the file
`color_autopilot.js` learned not to rewrite), `/mixer/snapshots` is mixer
state, and the CPC has no list-shaped param. Folding the gallery into the
colour-autopilot `palettes` array would conflate "what I saved" with "what is
rotating".

So: two small handlers next to `/color-palettes`, using the StateManager's
generic crash-safe `load`/`save`. Whole-list writes (two iPads patching by
index would interleave into a list neither asked for), max 24, strict
validation with a 400 on junk, malformed persisted entries dropped on read with
a loud warn. **No new WS type** — that would have meant editing the shared
`ws_topic_routing.js` + its exhaustiveness test for a gallery that changes
about once a night; a second iPad picks up a save on its next window open or
app reload. This is *additional* to E1; E1 itself stayed exactly the validator
+ resolver widening the design scoped.

Client side: `fetchColorPairs` / `saveColorPairs` in `utils/api.ts`, a total
`normalizeColorPairs`, and a **standing** error line (not the auto-clearing
flash) when the load fails — an empty gallery must never be able to mean "we
could not ask".

---

## 3. Deviations from the contract (4, all recorded in docs/53 §8 "AS BUILT")

1. **The crossfade is a PREVIEW.** There is no engine mechanism for a
   continuous A↔B crossfade of the two slots, and a `setInterval` in the tab
   pushing `/param-center` is the deadman-gap failure §5.2 rejects. The
   transport animates a local wash + par picture, labelled on its face. Its
   *feel* is the prototype's, byte-for-byte in the maths.
2. **One new REST pair** (`/color-pairs`) beyond E1 — §2 above.
3. **The five TURNS slots are always filled** (seeded from the window's own
   Live Touch samples; re-seeded from a live ring). §5.4's "T3-T5 empty, START
   refuses fewer than 5" would have needed an "unset colour" to invent; a total
   ring makes the refusal unnecessary instead of making it silent.
4. **`ActionColorAutopilot.palettes` in `utils/timelineApi.ts` widened too** —
   forced by the api.ts widening, and correct: a cue that CAPTURES the live
   deck config can capture a TURNS ring, and the engine's timeline path runs
   the same validator. One type line + one type import.

---

## 4. The gesture question _208 flagged

In wide mode the window body sits inside the column's vertical `SectionHost`
ScrollView, so a mostly-vertical drag on the wheel is exactly what the
ScrollView wants. Resolved by making the wheel own it properly, the same way
`HorizontalFader` already does: responder on start AND move, **capture** ahead
of any ancestor, `onPanResponderTerminationRequest: () => false`, and — web
only — `touchAction:'none'` on the container, because a browser pans from a
touch that starts on a scrollable ancestor before React's responder system
hears about it. The SVG is `pointerEvents="none"` so every touch lands on the
container and `locationX/Y` are always in wheel space.

**Measured** (fresh dist :7167 against an isolated engine): a deliberately
vertical sweep down the right of the ring moved `colorPalette1` from 0° to 90°
while the column's `scrollTop` stayed at 0. No same-axis nested scroll was
introduced — the SHOW PALETTE list is a wrapping View, and TURN EVERY / FADE
use the existing `TimerPillBar` (horizontal, a different axis).

---

## 5. Files

**New**
- `CaptainPad/components/deck/colors_window_logic.ts` — the pure brain (pin
  policy, OKLCH mix ported from `color_transition.js`, Live Touch swatch
  provenance, wheel geometry, derived badges, phase maths, TURNS pair
  derivation + the exact autopilot patch, the single-writer gate, the pair-list
  normalizer/mutators).
- `CaptainPad/components/deck/colors_window_logic.test.ts` — 64 vitest cases.
- `CaptainPad/components/deck/hue_wheel.tsx` — the SVG ring + gesture.
- `marsin_engine/tests/effects/color_window_engine_api.test.js` — 8 HTTP cases.

**Modified**
- `CaptainPad/components/deck/colors_window.tsx` — the body (was the slice-A
  placeholder). Mount path, export name and `disabled` prop unchanged.
- `CaptainPad/app/(tabs)/index.tsx` — the ONE WINDOW-4 call-site touch:
  `colorAutopilot` + `onColorAutopilotChange`, exactly _208's interface.
- `CaptainPad/utils/api.ts` — palettes type widened; `InlineColorPair` /
  `ColorPaletteEntry`; `fetchColorPairs` / `saveColorPairs`.
- `CaptainPad/utils/timelineApi.ts` — the cue action's palettes type (§3.4).
- `CaptainPad/components/deck/ColorAutopilotPanel.tsx` — CUSTOM chip for inline
  entries; removal by index; the library-empty branch no longer hides live
  inline chips.
- `marsin_engine/lib/color_autopilot.js` — E1 validate.
- `marsin_engine/lib/api_server.js` — E1 resolver + `/color-pairs` GET/POST +
  `readColorPairs`.
- `marsin_engine/tests/effects/color_autopilot.test.js` — +8 E1 cases.
- `docs/53_deck_workspace_windows.md` — the AS BUILT block.

Untouched by design: `_layout.tsx`, `special_events*`, `theme.ts`,
`deck_workspace*.tsx`, `split_playlist_panes.tsx`.

---

## 6. Tests + results

| Suite | Result |
|---|---|
| `components/deck/colors_window_logic.test.ts` | **64 pass** |
| CaptainPad full `npx vitest run` | **71 files · 1318 pass · 6 skip · 0 fail** (_206's file is green now too) |
| `npx tsc --noEmit` | clean |
| `npx eslint` on every touched file | 0 errors, 0 new warnings |
| `npm run web:build` | `Exported: dist` |
| `marsin_engine/tests/effects/color_autopilot.test.js` | **29 pass** (was 21) |
| `marsin_engine/tests/effects/color_window_engine_api.test.js` | **8 pass** |

Pure coverage: pin policy + idempotence; rgbToHsv⇄hsvToRgb exactness and the
grey-has-no-hue rule; the five swatches' hex/hue/tag provenance derived (not
retyped); OKLCH endpoints exact; wheel angle↔hue inverses, overshoot, and
nearest-handle across the 0/1 seam; badge derivation including "the drag drops
it" and the S/V-differ case; the phase trio — triangle shape, seek/blend
inverses, the MEASURED prototype case (park 50%, run 300 ms at 0.8 s → 87.5%),
stop-freezes, "one cycle = two fade times", and no run-away on a zero fade;
turnsPairs incl. wrap + the every-colour-twice invariant + the refusal below
two hues + round-trip; the derived-transition clamp table; the exact TURNS
autopilot patch (keys, pairs, derived fade, positive-cadence refusal); the
single-writer gate's four states and "every refusal carries a sentence"; the
atomic write payload; the leading+trailing throttle policy over a synthetic
60 fps drag; the pair store round trip through a **fake scene store** (never a
real scene write) incl. failed-save rollback and failed-load honesty; the
gallery's duplicate / cap / reversed-pair / out-of-range rules; and a 15-entry
junk table proving the normalizer is total.

Engine coverage: inline pairs validate and are not membership-checked; mixed
id + inline sets; validate COPIES inline pairs; out-of-range / missing /
non-numeric / NaN hues and non-pair junk all throw; inline pairs cycle and
persist through the runtime YAML; over HTTP — five pairs round-trip on
GET/POST, library ids and mixed sets still work, a malformed pair / unknown id
400s and **leaves the live config untouched**, an ACTIVE inline rotation
actually paints (`colorPalette1/2` take the pair's hues at S=V=1), and the
`/color-pairs` store round-trips to the scene dir, refuses junk and the 25th
pair, and accepts an empty list. All on **high ports** with sACN black-holed at
`127.0.0.9`.

**End-to-end on a fresh dist (:7167 → an isolated engine on :7601, never the
operator's stack):**

- wheel drag → `colorPalette1` 0° → 90°, column `scrollTop` unchanged (§4);
- SAVE PAIR → `/color-pairs` holds `{c1:0.25, c2:0.5}`;
- START TURNS → the engine takes five inline pairs (263→192→29→96→47→263),
  `delay_s 30`, `transitionMs 3000` (the derived value);
- with the rotation live, a wheel drag is REFUSED — the palette does not move
  and "pause it to edit" is on screen;
- TAP TO PAUSE → engine `active:false`.

Screenshots in `~/tmp/fix_211/` (deck wide + narrow, presets pane, TURNS mode,
the locked/dimmed wheel). The only console error is the pre-existing minified
React #418 hydration warning — it reproduces with COLORS closed.

### Disclosure — `--dest 127.0.0.9` is not actually a black hole

My spawned test engines used `--dest 127.0.0.9`, which is what the shared
`tests/helpers/spawn_engine.mjs` harness documents and what seven existing
suites already do. It is **not** isolation: `.agent/memory/spawning_a_test_engine.md`
records that all of `127/8` is local and the sim's sACN receiver binds
`0.0.0.0:5568`, so a spawned engine's frames still reach the operator's live
input bridge. I confirmed the bridge (pid on :6971) is holding UDP `0.0.0.0:5568`
right now, and my engine logged `[sACN Out] Sender started — 4 universe(s),
priority 100, destinations [127.0.0.9]`.

So: the two node:test runs (~2 s of engine life each) and the manual `:7601`
engine used for the browser e2e (~5 minutes, `test_bench` / `01_cylon_sweep`,
4 universes at priority 100) **may have relayed onto the rig** for that window,
depending on the bridge's live route table. No Art-Net sender started and
`controllers` is empty, so there was no direct engine→hardware path. Nothing
was written to the operator's engine, config, or scene state — the browser e2e
pointed CaptainPad's `API_BASE` at `:7601`, and the read-only captures against
`:6968` only issued GETs.

The real fix is harness-wide (`MARSIN_CONFIG_FILE` pointing at a black-holed
config, plus `assertBlackHoled`) and is already logged as follow-up (1) in that
memory file; changing the shared harness was outside this slice.

---

## 7. Operator try-steps

Reload CaptainPad. **The engine must be running the new build** for the pair
gallery and TURNS: `/color-pairs` answered on the live engine while I was
testing, so it looks like it has already been restarted since the change — if
the gallery says "Saved pairs unavailable", restart the engine.

1. Deck → the workspace bar → tap the **COLORS** chip on the HIDDEN rail.
2. **Drag the ring.** The rig paints live and fades over the engine slew. Tap a
   slot to arm it; grab a handle directly to move that one.
3. Tap a **Live Touch swatch** — it loads the armed slot and takes that slot's
   badge. Drag the wheel and watch the badge leave.
4. Set A and B, tap **SAVE PAIR**, then reload the other iPad — the pair is
   there. Tap the pair to recall both colours; **EDIT** to delete.
5. **CROSSFADE**: hit RUN, scrub BLEND POSITION, hit STOP — it holds the blend
   it was on. (This is the PREVIEW strip; the rig is not crossfading.)
6. **PALETTE TURNS**: pick five colours (wheel or chips into slots 1-5), set
   TURN EVERY, tap **START TURNS**. The AUTOPILOT window's palette chips become
   five CUSTOM two-tone chips and its countdown ticks. Now **lock this iPad or
   kill the app** — the rig keeps rotating. Come back: the two-colour wheel is
   dimmed with `ROTATION IS DRIVING — TAP TO PAUSE`; tapping the wheel says why
   it refuses. Tap the banner to take the colours back.

Open question for you: pairs currently store **colours only** (the confirmed
default). If you want a pair to carry its fade time too, that is a small
follow-up.
