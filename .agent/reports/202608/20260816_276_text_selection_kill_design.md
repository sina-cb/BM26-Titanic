# _276 — Text-selection kill DESIGNED: one shell rule for every tab, caret guaranteed (Fable) — 2026-08-16

**Deliverable:** `docs/68_app_wide_text_selection_kill.md` — a design
contract ready for ONE Opus implementer session. Design-only: no product
code touched.

Operator order, verbatim: *"the color wheel is great, but there's a lot of
conflicts with the text selection in the UI — when I drag it selects text
which is annoying, overall it's annoying everywhere in the app, can we
disable it all?"*

## The mechanism, named and measured

- react-native-web 0.21.2 gives RN `<Text>` **no `userSelect` on web** —
  computed `user-select: auto`, browser-selectable. RN's non-selectable
  default is native-only, so the annoyance is the web surfaces (iPad
  Safari / home-screen app / desktop), not Expo Go.
- Measured on a scratch dist copy (`~/tmp/text_select_design/`, :7181,
  puppeteer with request interception aborting everything non-:7181 so the
  live engine was never reachable): one 500 px drag from the deck header
  selected **157 characters** of UI chrome.
- The COLORS dial needs **zero changes**: `hue_wheel.tsx` already has full
  gesture armor (capture, termination refusal, `touchAction:'none'`), but
  `touch-action` governs pan claiming, not selection, and RNW never
  preventDefaults the initiating pointerdown. Selection is the residue; the
  shell rule removes it.
- **Fix proven before writing the contract**: injecting the proposed CSS
  into the scratch copy took the same drag from 157 → **0 chars** while a
  TextInput kept focus, typing, and Ctrl-A (`selStart 0, selEnd 13`;
  computed `user-select: text`). Probe record:
  `~/tmp/text_select_design/probe_results.json`. Scratch server killed;
  live :6967/:6968 untouched throughout.

## The ruled design (docs/68)

New **`CaptainPad/app/+html.tsx`** (canonical expo-router@6 shell seam,
verified in the installed `getRootComponent.js`; works in Metro dev AND
`expo export`; web-only): stock shell replica + one style block —
`html,body { user-select:none; -webkit-user-select:none;
-webkit-touch-callout:none }` with an
`input, textarea, [contenteditable="true"]` text/callout counter-rule.
Opt-ins cost nothing new: RNW's element-level `user-select:text` atomic
classes (TextInputs, `selectable` Texts) beat the inherited `none` by
construction.

**Carve-outs enumerated** (full source sweep): all 27 TextInput sites +
`NumberInput`; the Studio transparent code editor (execCommand Tab path,
caret-follow — highest risk, acceptance-tested explicitly); the only
deliberate `selectable` error Texts (`embedded_service_screen.tsx:160,163`
— the app has NO clipboard API, selection is its only copy path). D3 ships
the Studio log pane / toasts losing accidental copyability.

**W2 — Live Touch** (`docs/ui/touch_control.html`, in scope): body already
has `user-select:none`; add `-webkit-touch-callout:none` + fix a latent
caret hazard (`.pc-label[contenteditable="true"]` never re-enables
selection). CSS-only; embed pins untouchable; the two engine contract tests
that parse the file must re-run.

**W1..W5:** shell file → Live Touch CSS → committed guard test (house
`native_gesture_armor` pattern: kill + counter-rule both asserted) → live
probe matrix on a scratch export → full gates. **D1..D7** defaults with
one-line veto each (selector footprint `html,body` not `*`; callout kill
app-wide; native untouched; no cursor polish riding along).

## Collisions

Zero file overlap with `_274`/`_275` (docs/67 shipped mid-design; noted in
the contract): the whole CaptainPad diff is one NEW file + one new test;
W2 is in `docs/ui/`. W4 needs one scratch `expo export` (machine-wide
one-at-a-time rule; never into `CaptainPad/dist`).

## Impeccability notes (logged, not fixed — D6)

Hub-highlight flicker on window-exit re-entry; `GRAB_PX 26` below the
docs/66 44 pt floor for handle grabs; ~8 px caption margin around the dial.
All in docs/68 §8.
