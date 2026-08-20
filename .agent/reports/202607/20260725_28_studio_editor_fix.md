# Studio tab TEXT EDITOR — fix (R6, executes `20260725_27` A1–A7)

**Date:** 2026-07-28 · **Agent:** Opus fixer · **Status:** SHIPPED on
`feat/bm_readiness` (uncommitted working tree) — all 7 plan steps applied,
re-validated live at 3 viewports on a fresh `expo export` dist on **:7167**
(operator's :6967 Metro never touched). `tsc --noEmit` clean, vitest **886**
(869 baseline + 17 new). **No deploy** (standing order; CaptainPad is
Metro-served — this hot-reloads to the operator's iPad).

Operator problem being fixed: *"Cursor is broken in the text editor — I cannot
go to a position to type or anything"*, bad on iPad AND desktop.

## What changed

| File | Change |
|---|---|
| `CaptainPad/components/studio_editor_logic.ts` | **NEW** — pure helpers: `tokenizeLine`, `classifyToken`, `splitLines` (textarea-identical line-break normalization), `caretScrollTarget`, `TAB_INSERTION`. |
| `CaptainPad/components/studio_editor_logic.test.ts` | **NEW** — 17 vitest cases (lossless tokenizing, no-newline invariant, `/g` statelessness, CRLF normalization, caret-scroll math incl. clamps + jitter guard). |
| `CaptainPad/components/code_highlight.tsx` | **NEW** — one shared `CodeHighlight` (replaces the two verbatim-duplicated inline tokenizers) with `React.memo` per logical line + the trailing-row probe. |
| `CaptainPad/app/(tabs)/studio.tsx` | A1–A7 (below). |

**Untouched, as ordered:** `handleSave` / `runInFlightRef` (64–114),
`loadPatterns` cold-start await, `utils/api.ts` save/compile path, logs pane,
toasts, Modal open/close structure. No new npm deps.

## Per-step diff summary

**A1 — caret visible.** `caretColor: '#00daf3'` added to the TextInput style
(web-only style object, since RN's `TextStyle` doesn't model it and RNW 0.21
drops `selectionColor`). `selectionColor` prop kept for native iOS.
→ computed `caret-color: rgb(0, 218, 243)` at all 3 viewports.

**A2 — geometry lock.** `overflow: 'hidden'` on the input (web) +
`scrollEnabled={false}`; both layers now drive their metrics from ONE set of
constants (`EDITOR_FONT_FAMILY/FONT_SIZE/LINE_HEIGHT/PADDING`) with a
"change these only in pairs" comment. Two extra geometry bugs were found by
asserting the invariants instead of trusting the source:

- **CRLF drift (new finding, not in `_27`).** Pattern files arrive from the
  engine with **CRLF**; a `<textarea>`'s `.value` is line-break normalized by
  spec (CR stripped), but the highlight `<Text>` rendered the raw string —
  measured **17,564 highlight chars vs 17,252 textarea chars** (= +1 per line
  × 312 lines) on `00_golden_hour_wash`. Chrome collapses CRLF to one segment
  break so the row COUNT matched, which is why `_27` didn't see it, but every
  character-level mapping between the layers was off by one per line — taps
  measured **−304 chars** from target before this was fixed. `splitLines` now
  splits on `/\r\n|\r|\n/`, i.e. exactly what the textarea shows. The `code`
  state (and therefore the bytes SAVE writes) is untouched.
- **Trailing-row delta.** A textarea paints an empty final row when the buffer
  ends with `\n`; a pre-wrap block doesn't → the textarea stayed 20px (one row)
  taller and therefore still internally scrollable. `CodeHighlight` now emits a
  zero-width-space probe on a trailing empty last line → `scrollHeight ==
  clientHeight` exactly.

**A3 — per-keystroke cost.** Both inline tokenizers deleted; one shared
`CodeHighlight` renders `splitLines(code)` as `React.memo`'d `HighlightLine`s
joined by literal `'\n'` **inside one pre-wrap `<Text>`** (no per-line boxes —
that would have re-broken the wrap geometry). A keystroke re-tokenizes only the
edited line. The main-pane preview is no longer rendered while the modal is
open (`{!isEditing && …}`). Known accepted tradeoff: multi-line `/* */` comment
bodies are no longer green across line boundaries.

**A4 — keyboard avoidance on web.** While the modal is open on web, a
`visualViewport` `resize`/`scroll` subscription drives the modal root's
`height` (RN `Modal` on web is `position: fixed` against the LAYOUT viewport,
so it never shrinks for the keyboard on its own; RNW's `KeyboardAvoidingView`
is a literal no-op). Listener + state torn down on close. Native keeps
`KeyboardAvoidingView`.

**A5 — caret-follow.** A hidden mirror div (same width + computed font metrics
+ pre-wrap, valid only because of A2) measures the caret's Y from
`value.slice(0, caretIndex)`; the pure `caretScrollTarget()` decides whether to
move the OUTER RN ScrollView (60px comfort margins, clamped to content, null =
no move so it can't jitter or fight the user). rAF-throttled, driven by
`input`/`keyup`/`click`/`select` DOM events plus RN's `onSelectionChange`.

**A6 — Tab.** `keydown` on the textarea: plain Tab → `preventDefault()` +
`document.execCommand('insertText', false, '  ')` (execCommand precisely
because it preserves the native undo stack; a setState splice would destroy
it). Modified Tabs (shift/ctrl/meta/alt) still move focus.

**A7 — UX.** The main-pane preview is wrapped in a `TouchableOpacity` →
`setIsEditing(true)`, disabled when no file is selected.

**D9 (iOS smart punctuation).** Props hardened: `autoCapitalize="none"`,
`autoCorrect={false}`, `spellCheck={false}`, `autoComplete="off"`,
`smartInsertDelete={false}`, `textContentType="none"`,
`keyboardType="ascii-capable"`. **This cannot be proven off-device** — see
"Needs the operator's iPad" below. Per the no-fallback rule nothing normalizes
curly quotes silently, and `handleSave` was left alone as ordered.

## Before / after latency

Same box, same file (`00_golden_hour_wash`, 17,252 chars), same method as the
debug baseline: caret mid-file, `t=performance.now()` around a real
`execCommand('insertText')` (React's discrete-input flush is synchronous, so
the commit is inside the window). 12 samples, median:

| Viewport | Before (`_27`) | After | Gain |
|---|---|---|---|
| 1280×800 desktop | 88.4 ms | **24.8 ms** (20.2–30.1) | 3.6× |
| 820×1180 iPad portrait | 74.6 ms | **23.9 ms** (20.1–27.5) | 3.1× |
| 1180×820 iPad landscape | 53.3 ms | **24.5 ms** (21.8–30.5) | 2.2× |

Honest read: the plan's <16 ms desktop target is **not** met. What remains is
not tokenization (that's now one line per keystroke) — it is Chrome laying out
an 8,808 px pre-wrap block plus React's controlled-value round trip, and the
box was simultaneously running the operator's Metro, the engine and headless
Chrome. Extrapolated iPad Safari cost ≈ 50–100 ms/keystroke, down from an
estimated 150–350 ms. If the operator still finds it mushy, the documented next
lever is `useDeferredValue(code)` for the highlight input only (keeps the
TextInput controlled) — it trades glyph latency for input latency, so it should
be pulled only on his verdict.

## Validation matrix (fresh dist on :7167, live engine on :6968)

Harness: `~/tmp/studio_editor_fix/validate_studio_editor.cjs` (puppeteer;
mouse+keyboard at desktop, `hasTouch` taps at both iPad sizes). Raw results:
`~/tmp/studio_editor_fix/validation.json`, screenshots `*_1..6_*.png`.

| Defect / check | 1280×800 | 820×1180 | 1180×820 |
|---|---|---|---|
| D1 computed `caret-color` = `rgb(0,218,243)` | PASS | PASS | PASS |
| A2 `offsetWidth == clientWidth` (677/788/621) | PASS | PASS | PASS |
| A2 `|ta.scrollHeight − highlightHeight|` | **0 px** | **0 px** | **0 px** |
| A2 metrics byte-identical (family/size/lh/pad/white-space/overflow-wrap) | PASS | PASS | PASS |
| Highlight text == textarea value (modulo the deliberate ZWSP probe) | PASS | PASS | PASS |
| D3 `ta.scrollTop == 0` after caret at EOF | PASS | PASS | PASS |
| D2 tap lands on the exact character — mid-file | 0 off | 0 off | 0 off |
| D2 tap exact — deep token (`rgbwau(` in `render3D`) | 0 off | 0 off | 0 off |
| **D3 trap**: tap exact at EOF *after* a deep-scroll trip to EOF | 0 off | 0 off | 0 off |
| D3 trap: same deep token still exact after that trip | 0 off | 0 off | 0 off |
| D4 keystroke median | 24.8 ms | 23.9 ms | 24.5 ms |
| Undo after 12 inserts restores the buffer exactly | PASS | PASS | PASS |
| D8 Tab inserts 2 spaces, focus stays, caret advances 2 | PASS | PASS | PASS |
| D8 Ctrl+Z undoes the Tab (native undo stack intact) | PASS | PASS | PASS |
| D7 drag-select paints over the right glyphs (`bwau(c` at 17172–17178) | PASS | PASS | PASS |
| D7 double-tap word select | PASS | PASS | PASS |
| Arrows / Home / End behave, textarea never self-scrolls | PASS | PASS | PASS |
| D6 caret-follow: type at 70 % depth → outer scroller moves (0 → 5228 / 3715 / 5488) | PASS | PASS | PASS |
| D5 keyboard emulation (`visualViewport.height` → 58 %) → modal root height follows (464/684/476 px) | PASS | PASS | PASS |
| D5 header (CLOSE / SAVE & COMPILE) stays above the keyboard | PASS | PASS | PASS |
| A7 tapping the read-only preview opens the editor | PASS | PASS | PASS |
| Geometry invariants re-asserted AFTER all editing | PASS | PASS | PASS |
| SAVE & COMPILE / CLOSE controls present + enabled | PASS | PASS | PASS |

Side note (not a defect): RNW's `Dimensions` already derives from
`visualViewport`, so when the keyboard comes up the modal's portrait split
flips to the side-by-side layout — sensible, and visible in
`ipad_portrait_820x1180_6_keyboard.png`.

## Needs the operator's physical iPad

1. **D9 iOS Smart Punctuation** — a system-level iPadOS setting; Safari does
   not reliably honour `autocorrect/autocapitalize/spellcheck`, and it cannot
   be emulated in desktop Chrome. Type `'` `"` and `--` in a comment: if they
   come out curly / em-dashed, the follow-up is a **loud** non-ASCII warning in
   the save path (never silent normalization).
2. **Real touch caret placement + the iPad's overlay scrollbars** — emulated
   touch taps pass here, but tap-and-hold caret dragging (the iOS magnifier) is
   device-only behavior.
3. **Real keyboard geometry** (split/floating keyboard, hardware keyboard with
   the shortcut bar) versus the emulated `visualViewport` shrink.
4. **Felt typing latency** on Safari — the number above is desktop Chrome.
5. **SAVE & COMPILE / RUN roundtrip** — deliberately NOT pressed here: the only
   engine on the network is the operator's live one on :6968 and pressing RUN
   writes a pattern file and switches his deck. The save path is byte-identical
   to before this change (do-not-touch list honoured) and both buttons render
   enabled in the modal.

## Residue / notes

- `code` state still holds the file's CRLF bytes until the first keystroke,
  after which the controlled textarea hands back LF-normalized text — so an
  edited+saved file lands LF. **Pre-existing** behavior of the controlled
  textarea, unchanged by this work; flagged because the logs pane prints the
  CRLF byte count (17,564) while the editor holds 17,252 characters.
- Multi-line `/* */` comments are no longer coloured past the first line
  (accepted A3 tradeoff, per plan — do not "fix" it by going back to
  whole-file tokenizing).
- `CaptainPad/dist` was rebuilt (gitignored build residue). Harness + logs +
  screenshots live in `~/tmp/studio_editor_fix/` (gitignored, outside the source
  tree).
- The operator's :6967 Metro and the :6968 engine were never restarted or
  otherwise touched; nothing was deployed to titanic-ext.
