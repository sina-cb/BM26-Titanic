# 68 — App-wide text-selection kill: one shell rule, every tab (colors dial drag, iPad web)

**Status:** DESIGN — ready for ONE Opus implementer session (operator
pipeline: Fable designs, Opus implements + validates) ·
**Author:** Fable (design report `_276`) · **Operator:** Sina Solaimanpour

Operator order, verbatim intent, from live iPad testing:

> "the color wheel is great, but there's a lot of conflicts with the text
> selection in the UI — when I drag it selects text which is annoying,
> overall it's annoying everywhere in the app, can we disable it all?"

Two facts in one order: dragging the COLORS dial highlights the captions
around it, and text selection is a nuisance **everywhere**, not just on the
wheel. This contract disables selection **app-wide on the web surfaces**
with a single shell stylesheet, guarantees every text field keeps its caret,
and leaves native (Expo Go) and every gesture-armor pin untouched. Related
canon: `docs/61_colors_interaction_model.md` (the dial),
`docs/66_live_touch_ipad_ergonomics.md` (iPad doctrine),
`components/native_gesture_armor.test.ts` (the armor pins).

---

## 1. Reproduction — mechanism named, fix proven, before the contract was written

Measured tonight on a **scratch copy** of the current dist (copied to
`~/tmp/text_select_design/dist/`, served on :7181, puppeteer with request
interception aborting every non-:7181 request so the live engine on :6968
was never touched; live :6967/:6968 verified untouched; scratch server
killed after). Probe record: `~/tmp/text_select_design/probe_results.json`.

### 1.1 Why the app selects text at all: react-native-web's default

RN `<Text>` is non-selectable **on native** by default. On web, RNW 0.21.2
(`node_modules/react-native-web/dist/exports/Text/index.js:140-190`) applies
**no `userSelect` at all** unless the `selectable` prop is passed — the
rendered `div[dir="auto"]` inherits the browser default. Measured on the
deck header: computed `user-select: auto`. So every caption, chip label,
knob caption, and readout in CaptainPad web is selectable DOM text. That is
the whole "annoying everywhere" mechanism — a react-native-web artifact,
absent on the native iPad app.

**Measured:** one 500 px mouse drag starting on the deck header selected
**157 characters** of UI chrome: `"Marsin Deck OFFLINE FADE MASTER 100
KNOB 1 SPEED BPM 120 60 …"`. That is the operator's screenshot, in numbers.

### 1.2 Why the wheel still selects despite its gesture armor

`components/deck/hue_wheel.tsx` already carries full drag armor: PanResponder
capture on start AND move, termination refusal, native scroll lock, and
web-only inline `touchAction: 'none'` (line 390). None of that stops
selection, because **`touch-action` governs scroll/pan claiming, not text
selection**, and RNW's responder system does not `preventDefault()` the
initiating mousedown/pointerdown (it can't — that would break focus
semantics app-wide). The browser therefore starts a text selection at the
drag origin and extends it across the dense captions surrounding the dial.
The wheel's gesture handling is CORRECT and needs **zero changes** — the
residual annoyance is pure selection, and the global rule below removes it.
Option (c) from the design brief (per-surface preventDefault) is thereby
refuted as the app-wide fix: the wheel already has the strongest possible
per-surface armor and still selects.

### 1.3 The fix, proven end-to-end before writing this contract

The scratch dist's 29 HTML files got the §2.3 style block injected into
`<head>`, then the identical probe re-ran:

| Measurement | baseline | with shell CSS |
|---|---|---|
| computed `user-select` on a deck caption | `auto` | `none` |
| chars selected by the same 500 px drag | **157** | **0** |
| TextInput focus, typing, Ctrl-A in-field selection | works (`selStart 0, selEnd 13`) | works (`selStart 0, selEnd 13`) |
| computed `user-select` on the focused `<input>` | `auto` | `text` |

The mechanism is airtight because of how `user-select` resolves: `auto`
computes from the parent, so one `none` on `html, body` cascades into every
element that never states an opinion — while any **element-level**
declaration (`text` on inputs, RNW's atomic `user-select: text` class on
`selectable` Texts) stops the cascade and wins. Low footprint, no
specificity war.

---

## 2. The ruled mechanism — a shell stylesheet in `app/+html.tsx`

Design-brief option **(a)** alone. Not (b): `selectable={false}` is already
the native default and RNW deprecates the prop (`Text/index.js:64`) — a
sweep would touch hundreds of Texts to express one sentence. Not (c): §1.2.

### 2.1 The injection point (new file, zero collisions)

CaptainPad has **no** global-CSS seam today: no `app/+html.tsx`, no
`public/`, no `document.head` injection anywhere in source. But
`app.json` sets `web.output: "static"`, and the installed expo-router@6
resolves `app/+html.tsx` as the root HTML component
(`node_modules/expo-router/build/static/getRootComponent.js` — falls back
to its stock `Html` only when the app defines none). The shell renders in
**both** Metro dev and `expo export`, and the file is web-only: native is
structurally untouched. This is the canonical Expo seam, and it is a NEW
file — no collision with any in-flight work.

### 2.2 W1 — `CaptainPad/app/+html.tsx`

Replicate the stock shell **exactly** (`expo-router/build/static/html.js`:
`<html lang="en">`, `charSet utf-8`, `X-UA-Compatible IE=edge`, the
viewport meta, `<ScrollViewStyleReset />` imported from `expo-router/html`)
and add one style block. Replication must be faithful: the stock viewport
meta is `width=device-width, initial-scale=1, shrink-to-fit=no` — do not
"improve" it in this wave.

### 2.3 The style block (exact, proven in §1.3)

```html
<style
  id="captainpad-no-select"
  dangerouslySetInnerHTML={{ __html: `
html, body {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
input, textarea, [contenteditable="true"] {
  -webkit-user-select: text;
  user-select: text;
  -webkit-touch-callout: default;
}
` }}
/>
```

Line by line:

- `html, body { user-select: none }` — the kill. Deliberately NOT `*`:
  the `auto` cascade already reaches every silent element, and the narrow
  selector guarantees any element-level opt-in (RNW's own classes, the
  input rule) wins without a specificity fight.
- `-webkit-user-select` — WebKit's inherited variant; this is the line that
  matters on the operator's iPad (Safari / home-screen web app).
- `-webkit-touch-callout: none` — kills the iOS long-press callout
  (magnifier / Copy bubble) on captions, the second half of the iPad
  annoyance.
- The `input, textarea, [contenteditable="true"]` counter-rule — the caret
  guarantee. RNW already stamps `user-select: text` on TextInputs via an
  atomic class, so this is DOUBLE coverage, kept deliberately: WebKit's
  inherited `-webkit-user-select: none` reaching a field through any future
  DOM path is a known iOS caret-killer, and this rule fails safe.

### 2.4 The opt-in mechanism costs nothing new

Anything that must stay selectable uses the existing RN idiom —
`selectable` on Text (or `userSelect: 'text'` style). RNW renders it as an
element-level `user-select: text` atomic class, which beats the inherited
`none` by construction (§1.3). No new prop, no new class, no wrapper.

---

## 3. What must remain selectable — the enumerated carve-outs

Full sweep of `app/`, `components/`, `hooks/`, `styles/`, `utils/`:

- **All 27 TextInput sites + the `NumberInput` wrapper**
  (`components/ui/PopoverKit.tsx:59`): config subnet + API base
  (`config.tsx:288,480`), OSC host/port/sender fields (`osc.tsx:500-593`),
  mixer channel rename (`mixer.tsx:740`), group rename
  (`GroupRail.tsx:290`), entry label editor (`EntryLabelEditor.tsx:278`),
  snapshot / param-preset / playlist / cue / plan naming, the generic
  `opPrompt()` field (`components/ui/op_dialog_sheet.tsx:110`), search
  filters, three passcode fields, the colour transition-time field
  (`ColorPickerModal.tsx:467`), and MIDI/modulation range boxes. All are
  `<input>`/`<textarea>` on web → covered twice (§2.3). **Acceptance:
  caret + in-field selection proven on at least one field per group.**
- **The Studio code editor** (`app/(tabs)/studio.tsx:431`) — the
  highest-risk surface: a transparent multiline TextInput overlaid on a
  `CodeHighlight` layer, whose Tab-insert uses
  `document.execCommand('insertText')` (line 157-159) and whose
  caret-follow reads `selectionStart/End/Direction` (lines 95-135). It is a
  real `<textarea>` → covered by the counter-rule. **Acceptance: drag-select
  inside the editor, shift-arrow select, and Tab insertion all work under
  the new shell.**
- **The only deliberate `selectable` Texts on web** — the embedded-service
  error body + URL (`components/embedded_service_screen.tsx:160,163`).
  There is **no clipboard API anywhere in CaptainPad** (no expo-clipboard,
  no navigator.clipboard), so selection is the app's only copy path; these
  two must survive. They ride RNW's element-level `user-select: text`
  class. **Acceptance: computed `user-select` on those nodes is `text`.**
  (`live_touch_surface.tsx:230-231` has the same pattern but is the
  native-only file — unaffected either way.)
- **Iframe embeds are out of CSS reach, both ways** — Live Touch web
  (`live_touch_surface.web.tsx:156`) and the simulation/audio local
  surfaces (`embedded_local_surface.web.tsx:20`) are separate documents:
  the host rule cannot break them and cannot fix them. Live Touch's own
  document is W2; the sim/companion pages already manage themselves and
  are out of scope.

**What knowingly loses accidental selectability:** the Studio compiler log
pane (`studio.tsx:470`) and toast bodies (`:490,:507`) — see D3.

---

## 4. W2 — the Live Touch document (in scope, two CSS lines)

Same annoyance class, same session, own document:
`docs/ui/touch_control.html` (served verbatim by the sim HTTP server —
`app/(tabs)/touch_control.tsx:50` pins `/docs/ui/touch_control.html`).
Its `body` already carries `-webkit-user-select: none; user-select: none`
(line ~130). Two gaps:

1. **No `-webkit-touch-callout: none`** anywhere in the file — iOS
   long-press callout can still surface in the WKWebView. Add it to the
   existing `body` rule.
2. **A latent caret hazard the global `none` already created:** the preset
   rename affordance (`.pc-label[contenteditable="true"]`, CSS line ~434,
   armed at runtime by `touch_control_wire.js`) never re-enables selection,
   so it inherits WebKit's `-webkit-user-select: none` — the exact
   caret-breaking pattern §2.3's counter-rule exists to prevent. Add to its
   rule: `-webkit-user-select: text; user-select: text;`.

CSS-only; not one line of markup or script moves. The **embed pins are
untouchable**: `buildTransport()`, `window.__captainpadDeliver`, the
`captainpad_embed=native` gate, the `window.parent !== window` checks. Two
engine contract tests parse this file
(`marsin_engine/tests/effects/touch_control_catalog_contract.test.js`,
`touch_control_wire_layers_contract.test.js`) — run both after the edit.

---

## 5. Must-not-change pins

- **The dial's and split-divider's inline `touchAction` armor** —
  `hue_wheel.tsx:390`, `split_playlist_panes.tsx:333`. They solve a
  DIFFERENT problem (browser pan claiming) and
  `components/native_gesture_armor.test.ts:231` asserts the dial's exact
  source text. Do not "consolidate" them into the shell CSS.
- **No inline styles on `html`/`body`/ancestors** — the Live Touch
  fullscreen path (`live_touch_surface.web.tsx:87-129`) saves and restores
  inline styles on those elements; the shell rule is a stylesheet and
  coexists, but any implementation that WRITES inline `user-select` on
  body/ancestors would corrupt that save/restore. Stylesheet only.
- **The stock shell semantics** — `+html.tsx` replicates the default
  exactly (§2.2); no other meta/link/script additions ride along.
- **The WebView/iframe embed pins** (§4) and `components/ui/scroll_lock.ts`.
- **Native behavior** — no `selectable` sweeps, no RN-side changes at all.

---

## 6. Decision list (shipped defaults — one-line veto each)

- **D1 — Mechanism = shell stylesheet in a new `app/+html.tsx`**, not
  runtime `document.head` injection, not per-component styles. It is the
  canonical Expo seam and survives Metro dev + `expo export` identically.
- **D2 — Selector footprint is `html, body`, not `*`.** The auto cascade
  covers everything silent; the narrow selector guarantees every
  element-level opt-in keeps winning with zero specificity games.
- **D3 — The Studio compile log and toasts lose accidental
  copyability.** Shipped as-is: the app has no clipboard affordance today,
  the deliberate error surfaces (§3) keep working, and re-enabling is a
  one-line `userSelect: 'text'` style on ask.
- **D4 — The Live Touch document is in scope** (two CSS lines, §4); its
  WebView/iframe shell and transport are not.
- **D5 — `-webkit-touch-callout: none` ships app-wide on web**, with
  `default` restored on fields. Long-press on captions does nothing;
  long-press in a text field keeps the paste menu.
- **D6 — No cursor/grab styling, no other gesture polish** rides this wave
  (the §8 observations are logged, not fixed).
- **D7 — Native (Expo Go) is untouched**, including the two native-only
  `selectable` error Texts.

---

## 7. W-items (ONE Opus session; sequence as listed)

- **W1 — `CaptainPad/app/+html.tsx`** (new file): stock shell replica +
  the §2.3 block verbatim. AC: (1) `npx expo export --platform web` emits
  the `captainpad-no-select` style in the `<head>` of **every** dist HTML
  file; (2) Metro dev serves it too; (3) native bundles unchanged.
- **W2 — `docs/ui/touch_control.html`**: the two CSS additions of §4,
  nothing else. AC: body rule gains the callout kill; the contenteditable
  label rule gains the text opt-in; both engine contract tests (§4) pass.
- **W3 — the committed guard** (house pattern of
  `native_gesture_armor.test.ts`): a CaptainPad vitest asserting
  `app/+html.tsx` exists, contains `captainpad-no-select`, the
  `html, body` kill, AND the `input, textarea, [contenteditable`
  counter-rule — so nobody can later delete the caret guarantee and keep
  the kill. AC: test red if any of the three pieces is removed.
- **W4 — the live probe matrix** (scratch stack; NEVER the live
  :6966-:6972/:6981): re-run the §1.3 probe against a fresh scratch export —
  drag over deck captions = 0 chars; caret + Ctrl-A on a config field; the
  three Studio editor behaviors (§3); computed `text` on the
  embedded-service error Text (force the error state by pointing the embed
  at a dead port). Artifacts to `~/tmp/text_select_design/`. Probe to adapt:
  `~/tmp/text_select_design/` design-session scripts (request-interception
  pattern mandatory — the page must never reach the live engine).
- **W5 — full gates**: CaptainPad vitest suite + `tsc` + lint;
  `native_gesture_armor.test.ts` specifically green (proves W1 didn't touch
  the armor); the two engine contract tests of §4; web export clean.

## 7.1 Collision notes (for sequencing)

- The docs/67 wave SHIPPED while this contract was being designed (`_275`:
  `app/(tabs)/mixer.tsx`, `components/ui/workspace_chip.tsx`,
  `components/mixer/*`, `hooks/use_mixer_workspace.ts`); `_274` finished in
  `components/deck/deck_workspace_layout.ts` + `app/(tabs)/index.tsx`.
  **This contract touches NONE of those files** — its entire CaptainPad
  diff is one NEW file (`app/+html.tsx`) + one new test file; W2 lives in
  `docs/ui/`. Zero file overlap; the implementer starts from the current
  post-`_275` tree and the W4 probe measures that tree.
- W4 requires a fresh `expo export` — machine-wide one-export-at-a-time
  rule applies; export to a scratch dir, never `CaptainPad/dist`, and the
  operator's :6967 dist is refreshed only through the normal landing flow.

---

## 8. Impeccability observations (logged, NOT in scope — D6)

Noted while on the wheel's drag path, for a future polish wave:

- On web, a drag that starts on the dial and leaves the window keeps the
  PanResponder alive but the browser can fire `pointercancel` →
  `onPanResponderTerminate`; the dial handles it correctly, but the hub
  highlight (`gripped`) drops mid-gesture if the finger re-enters — a
  cosmetic flicker only.
- The dial's `GRAB_PX = 26` handle-grab radius is below the docs/66 44 pt
  floor; arming a specific handle on the iPad takes a precise touch (a tap
  elsewhere arms nothing — safe, just occasionally two attempts).
- The deck captions around the wheel sit within ~8 px of the dial's
  bounding box; even with selection dead, a drag that starts 1 px outside
  the dial scrolls the column — correct behavior, but the margin is tight.
