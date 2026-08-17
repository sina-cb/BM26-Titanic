# _242 — The COLORS hue DIAL, preset palettes with generated icons + names, and the baby-palette audit

**Date:** 2026-08-15
**Branch:** `feat/bm_readiness` (the `feat/bm_audio_tuning` in the brief was a
stale snapshot — same correction `_240` recorded)
**Scope:** `CaptainPad/components/deck/{hue_wheel.tsx, colors_window.tsx,
colors_window_logic.ts}`, the `/color-pairs` state surface (client + engine), a
new shared `components/ui/preset_icon.tsx`, and a text-input primitive added to
the `op_dialog` system.
**Engine restart:** **REQUIRED** — the `/color-pairs` route's validator and its
state-file shape moved together.

---

## Operator orders

1. "the color wheel, when i click, it has an unpleasant jump. can you make it a
   dial of some sort that I can consistently control by touch"
2. "add feature to store the colors as preset palettes"
3. "clean up the color palettes for baby please"
4. "when storing generate the icon and ask for a name too - by default accept an
   empty name too for no name on the screen"

---

## 1. THE DIAL (order 1)

### The jump, named

`hue_wheel.tsx` was an **absolute** control. `onPanResponderGrant` ran
`paint(locationX, locationY, isGrant=true)`, which converted the touch point
into a hue through `hueFromPoint` and immediately called `onPick` — i.e. the
value teleported to whatever angle was under the finger, before any drag had
happened. On a 190 pt wheel a fingertip covers ~40 pt, so "put my thumb on the
handle" was never accurate enough to mean "change nothing", and reaching for the
far side of the ring threw the hue up to half a revolution in one frame. That is
the entire reported symptom, and it was structural: **there was no gesture that
touched the ring without writing it.**

### The replacement: a jog-wheel / rotary encoder

Touch-down **anchors**; it does not set. From there the hue follows the
**accumulated angular delta** of the finger around the centre, geared by
`DIAL_GAIN`.

| Property | How it falls out |
|---|---|
| A plain tap changes nothing | Zero accumulated delta is zero change **by construction** — there is no tap-tolerance threshold that could fire by accident |
| The grab point is irrelevant | Only the *change* in angle is read, so ring, rim, hub and the overshoot area outside the wheel all steer identically |
| Fine control | `DIAL_GAIN = 0.5`: one full physical revolution is **half** a hue revolution, so the whole circle takes two laps and a 10° wrist twist is a 5° hue move — twice the resolution the absolute ring could offer at any size |
| Wrapping is free | Every sample is a **short-arc** delta from the *previous sample*, never a difference of two absolutes, so the 0°/360° seam is an ordinary step and a multi-lap drag accumulates instead of folding back |

The maths is pure and lives in `colors_window_logic.ts`: `wrap01`, `turnDelta`,
`beginDial`, `dialSample`, `dialHue`, `dialTicks`. The component owns only the
PanResponder plumbing and the chrome.

**The hub rule.** A sample closer than `DIAL_DEAD_RADIUS_PX` (14) to the centre
has *no angle* — a 2 pt wobble across the exact centre is a 180° swing. Such a
sample sets `lastAngle = null`, and a value change requires **two consecutive
samples that both have a real angle**. That is a hard guarantee that no jump can
ever come out of the hub, and it makes a swipe straight *through* the middle
freeze the dial rather than read as a 180° rotation: a stroke across the centre
is a line, not a turn.

**Nothing fires for a tap.** `onDragStart` / `onDragEnd` are now raised only for
a drag that actually moved something, so a tap does not even reach the parent's
`writeNow` flush. Previously every touch put a frame on the wire.

### `dialValue` — the one place the anchor is not the armed slot

While a scheme is **latched** (`_224`), a wheel drag moves the latch's **base**
and regenerates all five slots from it — the value being steered is the base,
not `hues[armed]`. The two coincide for the default A=T1 selection but diverge
the moment the operator points A at another ring slot, and anchoring on the
wrong one would re-introduce the jump exactly there. So `HueWheel` takes an
explicit `dialValue`, and `colors_window` passes `latched ? latched.base :
undefined`. The pointer and the centre readout follow `dialValue` too, so the
number inside the dial is always the number the dial is turning.

### Kept, verbatim

The `_211` gesture armor is untouched — capture-phase responder on start *and*
move, `onPanResponderTerminationRequest: () => false`, and web
`touchAction: 'none'` on the container (the ScrollView-steals-the-drag class of
bug). So is the S=V=1 pin, the throttled atomic `/param-center` write, the
`{scheme, base}` scheme latch re-theming on drag, and A/B slot targeting via
`GRAB_PX` proximity — with the difference that grabbing a handle now only
**arms** it, which changes no value at all.

### The chrome (docs/54 vocabulary)

The control now *looks* like the thing it is: a knurled **hub** you grab, a
**tick ring** (36 marks, every 3rd major — `dialTicks`, so the scale is asserted
rather than counted by eye) and a **pointer** running from the hub's edge to the
ring at the steered value. The hub's rim and the pointer light in `armedStroke`
while a finger is down — the only feedback a touch produces, and the only
animation in the component. No hex literals; every colour is a passed theme
token.

---

## 2 + 4. PRESET PALETTES, with generated icons and names

### Shape: the SAVE PAIR store widened, not a sibling store

Two galleries of saved colours — one for pairs, one for palettes — would make
"where did I save that" an operator question with two answers, and a pair *is*
the degenerate palette. So the existing `/color-pairs` store holds both.

`c1` / `c2` stay **required and unchanged**. That is the whole migration: a v1
file's entries are already valid v2 entries, and the load path that turns an
entry into `colorPalette1/2` never moved. Everything added is optional:

```yaml
schemaVersion: 2
pairs:
  - {c1: 0.73, c2: 0.53}                      # a v1 row, still exactly this
  - c1: 0.1
    c2: 0.3
    name: Reef                                 # ABSENT means unnamed
    ring:  [{h: .., s: .., v: ..}, ...]        # the staged TURNS colours
    sel:   [0, 1]                              # which two feed A and B
    scheme: analogous                          # the latch, so a recall
    base:   0.1                                #   still re-themes on a turn
```

**Grouping rules, validated loudly on both sides** (`presetExtras` in
`colors_window_logic.ts`, `validateColorPreset` in `api_server.js`):

- `ring` and `sel` are all-or-nothing — a ring with no selection cannot say
  which colours are live; a selection with no ring indexes nothing.
- `scheme` and `base` are all-or-nothing, and both require a `ring`.
- `sel[0] === sel[1]` is refused: A and B would be the same colour.
- An unknown `scheme`, a ring longer than the five staged slots, an
  out-of-range index, a non-string `name` → refused.

The ring is stored **alongside** the scheme, not derived from it: the ring is
what the operator saw (they may have hand-edited a slot), the latch is how it
re-generates. Deriving either from the other would let the two disagree.

**One encoding of "unnamed".** An empty or whitespace name is never stored —
absence is the single representation, so nothing downstream has to test for
both. This is enforced in `buildPalettePreset`, in the client normalizer and in
the engine validator.

### Migration + failure behaviour

| Situation | Behaviour |
|---|---|
| v1 file, no `schemaVersion` | Read as-is. Nothing to convert. |
| `schemaVersion` from a newer build | **THROWS.** Engine `GET` → 500 with the reason; the gallery shows it as a standing error. A newer file may carry fields whose meaning this build does not know, and serving it as if it did would put colours on the rig nobody chose. |
| One malformed **row** in the hand-editable file | Dropped with a `console.warn`, gallery survives. The file is hand-editable; one bad row must not blank 23 good ones. Never silent. |
| A malformed row **POSTed** by a client | 400, whole write refused. A client sending a shape the engine does not understand is a bug to surface now. |
| Bad `c1`/`c2` | Skipped, exactly as v1 — the pair is the field the rig consumes and the engine already warns about these. |

### The generated icon (order 4)

`presetIconColours(preset)` returns the colour list; `components/ui/preset_icon.tsx`
draws it as a **disc cut into one wedge per colour**, in ring order, starting at
the top and going clockwise — the same reading direction as the dial, so a
palette's icon and its position on the dial rhyme. A ring shows its five true
colours (brightness included, so a HUE ramp reads as a ramp); a bare pair shows
its two hues at the pin.

No image file, no data URI, no stored asset: it is a pure function of the
entry's colours, so it cannot go stale, and **the preview the operator approves
in the naming dialog is byte-identical to the chip that lands in the gallery** —
both call the same component with the same list. `PresetIcon` lives in
`components/ui/` and takes CSS strings, which is what lets `op_dialog_sheet`
render one without the dialog system growing a dependency on the deck.

### The name prompt (order 4) — a new op_dialog primitive

`utils/op_dialog.ts` had no text-input primitive, so one was added **in its
idiom** rather than beside it:

- `OpDialogRequest` gains optional `input?: OpDialogInput` and
  `swatches?: string[]`.
- `OpDialog.resolve` gains an optional second argument carrying the field value.
  **Every existing call site is untouched** — `opDialog()` still returns
  `Promise<string | null>` of the action id; it is now a thin wrapper over a new
  `openOpDialog()` that also returns the value.
- `opPrompt(request)` resolves the **literal text**, including `''`, or `null`
  when the operator cancelled or dismissed. Those two are distinct on purpose:
  `''` saves an unnamed preset, `null` saves nothing. Collapsing them would make
  CANCEL indistinguishable from SAVE-with-no-name, which is precisely order 4.
- Codex P0: a submit that arrives with no value **throws**. A host that rendered
  the field but forgot to wire it would otherwise ship a naming dialog that
  quietly refuses to name anything.

`Alert.alert` is nowhere near this (the eslint ban is active and lint is clean);
`OpDialogSheet` renders the field with the same 44 pt target, hairline and
surface vocabulary as its buttons.

### The save/recall flow

- **SAVE PALETTE** captures the A/B pair always, plus the ring + selection
  whenever there *is* one (TURNS mode, or a latched scheme in two-colour mode),
  plus the latch itself. What gets captured is decided by the pure
  `buildPalettePreset`, not by the handler.
- The gallery is checked **before** the name is asked for — making the operator
  type a label for a save that was never going to land is the rudest possible
  ordering.
- Recall: a bare pair behaves exactly as it always did; a palette with a ring
  restores the whole staged state in one go (five colours, A/B selection, latch),
  because restoring only the pair would leave the scheme row describing
  something that is not on the rig.
- Duplicate identity is by **colours, not name** — re-saving the identical
  palette under a second name would give the gallery two chips that light
  together and delete separately.

---

## 3. BABY PALETTES — audited, **NOTHING REMOVED**, and here is why

An exhaustive reference sweep (config.yaml, every scene's show YAMLs and
timelines, patterns, playlists, CaptainPad source and the built bundle, docs,
tools, tests) found **three** baby palette entries, all defined in
`marsin_engine/config.yaml` under `colorPalettes:` — and **all three are live
and load-bearing**. Per the brief's rule (remove only what nothing references;
otherwise keep and list), **`config.yaml` was not touched.**

| Palette id | Name | Defined | Referenced by |
|---|---|---|---|
| `baby_reveal_duet` | Baby Reveal - Pink + Blue | `marsin_engine/config.yaml:357-360` | `simulation/scenes/titanic/timeline/playa_default.yaml:234, 251, 306, 323` — cues `c_baby_reveal_pink` (step 0 `palette:` + its `colorAutopilot.palettes[0]`) and `c_baby_reveal_blue` (same) |
| `baby_pink` | Baby Pink | `config.yaml:361-364` | `playa_default.yaml:263, 280` — `c_baby_reveal_pink` step 1 |
| `baby_blue` | Baby Blue | `config.yaml:365-368` | `playa_default.yaml:335, 352` — `c_baby_reveal_blue` step 1 |

Additional pins that would break on deletion:
`marsin_engine/tests/timeline/baby_reveal_sequence.test.js:182-184` reads the
**real** `config.yaml` and asserts all three ids are present; timeline
validation checks palette membership (docs/38:1128), so removing any of them
turns the two titanic cues into load errors.

**What is *not* referenced:** no show YAML references any of them (the
special-event show schema has no palette verb at all — stated explicitly at
`wedding_program.yaml:50`), the house `colorAutopilot.palettes` rotation
(`config.yaml:451-460`) lists nine ids and **none is a baby palette**, no
CaptainPad source names any of them, and the `baby_*` playlists bind no
palettes (their notes say "Hard-coded baby-blue family only… no palette
binding"). `docs/ui/color_palette_prototype.html:956-958` carries a static
mirror of all 23 pairs — a design-prototype copy, not a consumer.

**The finding worth the operator's ruling.** The three baby entries are the
**first three of the 23** in `colorPalettes:`, and `/color-palettes` serves that
list verbatim, so they sit at the head of the SHOW PALETTE gallery on every
iPad, every night, for a cue used twice. If "clean up" meant *get them out of my
picker* rather than *delete them*, the honest fix is a `hidden: true` flag on a
palette entry (or moving them to the tail) — but both are guesses about intent
against a shared, hot `config.yaml`, and the brief's rule is reference-based
decisions only. **Flagged, not acted on.** One word from the operator and it is
a two-line change.

---

## Verification

**CaptainPad** — `npx tsc --noEmit` clean. `npx expo lint`: **0 errors**, and
none of the touched files carries a warning (the two my first pass introduced,
both unused imports, are fixed). `npx vitest run`: **84 files, 1676 passed, 6
skipped, 0 failed** — the failing list is EMPTY. ~45 of those are new here:

- dial: the reported bug as an assertion (a grab on the far side of the ring
  leaves the value untouched), tap-is-a-no-op across a start×grab matrix,
  delta×gain, grab-point independence, the seam in both directions, two-lap
  accumulation returning to the start at gain 0.5, the through-the-hub freeze,
  a grab that starts *in* the hub, the non-positive-gain throw, `turnDelta`,
  `wrap01`, and the tick scale.
- presets: the v1→v2 migration in both directions, the future-`schemaVersion`
  refusal, all nine broken groupings, `buildPalettePreset` capture rules, ring
  copy-on-write, identity-by-colours, icon determinism, named/unnamed labels.
- `op_dialog`: prompt wiring, literal-text resolution, `''` vs `null`, and the
  submit-without-value throw.

**Engine** — `node --test tests/effects/color_window_engine_api.test.js`:
**20/20 pass**, up from 14, with the harness on its own scratch port and
`--dest 192.0.2.x` (TEST-NET-1). New: a named palette with ring/sel/latch
round-tripping through the scene state dir, a hand-written v1 file read
unchanged, a future `schemaVersion` refused with 500, one malformed row dropped
while the rest survive, every broken grouping 400ing, and the empty-name rule.
`SCHEMA_V` is pinned in the suite so a bump has to be a deliberate edit on both
sides.

**Screenshots** — fresh export served on **:7173**, bundle hash verified
(`entry-19975b92da5cfd6e9d4e08142307f35b.js`) against the served HTML,
console muted before boot, driven against an **offline** engine on **:17242**
(`--dest 192.0.2.x`). The live 6966-6972 stack was never written to. New tool:
`simulation/agent_tools/colors_dial_capture.cjs` (same conventions as
`deck_pixels_capture.cjs`). Output in `~/tmp/fix_242/`:

| File | What it proves |
|---|---|
| `242_dial_idle.png` | The dial at rest — hue ring, tick scale, knurled hub, pointer at the armed value, centre readout |
| `242_dial_mid_drag.png` | Mid-rotation with the hub rim and pointer lit |
| `242_preset_gallery.png` | `SAVED PALETTES · 5/24` with named (Reef, Dusk, Sunset Deck) and unnamed (`263° / 192°`, `119° / 299°`) entries, each wearing its generated wedge icon — 5 wedges for a palette, 2 for a pair |
| `242_save_name_dialog.png` | The in-app naming card: generated icon, `unnamed` placeholder, CANCEL / SAVE |
| `242_narrow.png` | 820 pt one-column layout — no overflow |

**The jump, measured in the real app** (logged by the tool, not asserted in a
unit test): a click on the ring reported `40° → 40°  UNMOVED ✓`, and a 0.45-turn
rotation of the pointer moved the hue `40° → 122°` — 82°, against the 81°
`0.45 × 0.5 × 360` the gain predicts.

---

## Residue

- `marsin_engine/states/test_bench/color_pairs_state.yaml` was created by the
  screenshot engine and **has been removed** (it was untracked).
- `marsin_engine/states/test_bench/{audio,deck,globals}_state.yaml` show as
  modified. These are the ordinary engine-run residue AGENTS.md describes;
  they were already modified in this shared tree before this session's engine
  run and have not been reverted.
- The offline engine (:17242) and the scratch `serve` (:7173) were both stopped.

## Follow-ups (not done here, on purpose)

- **docs/53 §4.2 and docs/55 still describe the wheel as an absolute control.**
  The contract moved; the prose has not. Left alone because `_241` is holding
  the docs surface this session — a small, real debt.
- The baby-palette **ordering/visibility** question above, pending the
  operator's word.
