# Studio tab TEXT EDITOR — debug + fix plan (R6)

**Date:** 2026-07-28 · **Agent:** Fable debug/plan (read-only) · **Status:** root causes proven with live measurements; verbatim fix plan below for the Opus fixer.

**Operator problem (verbatim intent):** the STUDIO tab's text editor is "currently bad" for typing/interaction on BOTH iPad and computer. Headline: "Cursor is broken in the text editor — I cannot go to a position to type or anything."

**Reproduced on:** fresh `npx expo export` dist served on **:7167** (operator's :6967 Metro untouched), engine on :6968, file `00_golden_hour_wash.js` (17,252 bytes — a real pattern), viewports 1280x800 / 820x1180 / 1180x820. All numbers below are measured in the live DOM, not guessed.

## Architecture found

`CaptainPad/app/(tabs)/studio.tsx`. Main pane = read-only syntax-highlighted preview (lines 176–192). Editing happens in a fullscreen Modal (197–313) built as the classic **transparent-textarea-over-highlight overlay**:

- Sub-layer: one giant RN `<Text>` with a regex tokenizer producing ~2,000 nested colored `<Text>` spans (241–251). Provides the height.
- Top layer: a controlled multiline `TextInput` absolutely positioned inset-0, `color: 'rgba(255,255,255,0)'`, zIndex 10 (255–275). On web (react-native-web 0.21) this renders as a real `<textarea>`.
- Both sit inside a RN `ScrollView` (229) that scrolls the sandwich together.
- State: `code` is plain `useState`; the ONLY writers are `handleSelectFile` and `onChangeText`. **No live engine subscriptions push into the editor** — no 5 Hz re-render problem here (unlike the deck viz strip).

This is the same architecture as the well-proven `react-simple-code-editor` — the pattern is sound. The implementation gets four load-bearing details wrong.

## Defects, each with root cause + measurement

**D1 — The caret is INVISIBLE (both platforms; this is the headline "cursor is broken").**
`caret-color` defaults to `currentColor`; the input's color is `rgba(255,255,255,0)` (studio.tsx:264). The `selectionColor="#00daf3"` prop (274) is **dropped by react-native-web 0.21** — its TextInput has no selectionColor handling at all (only `caretHidden` → `caretColor: 'transparent'`; see `node_modules/react-native-web/dist/exports/TextInput/index.js:414-416`). Measured computed style: `caretColor: rgba(255, 255, 255, 0)`. You literally cannot see where you are or where a tap landed. Same math applies in iPad Safari (web build is what the iPad runs).

**D2 — Click/tap-to-position lands on the WRONG LINE, worse the deeper in the file.**
Mechanism proven in three steps:
1. The textarea reserves ~15px for its internal vertical scrollbar: `ta.offsetWidth 402 / clientWidth 387` (portrait). The highlight div does not: wrap width **339px vs 354px**.
2. Narrower wrap width ⇒ different soft-wrap points ⇒ the invisible textarea content is TALLER than the visible highlight: **+6 rows @1280x800 (8968 vs 8848px), +7 rows @1180x820, +41 rows @820x1180**.
3. Token spans exonerated: a plain-text div vs a tokenized-span div at the SAME width wrap **identically** (613 = 613 rows). It is purely the scrollbar width theft.
So the glyphs you see and the characters the browser hit-tests diverge by up to 41 lines on iPad-portrait dimensions. (On a real iPad with overlay scrollbars the theft may be 0 — but the operator also uses desktop, where it always happens, and D3 below breaks iPad regardless.)

**D3 — One trip to the end of file breaks the editor PERMANENTLY (until reopen).**
Because the textarea's content is taller than its pinned height (absolute inset-0 = highlight height), it is internally scrollable. Putting the caret near EOF makes the browser scroll the *invisible* textarea internally — measured `ta.scrollTop: 120` — while the visible highlight doesn't move. From then on **every** click and every glyph is offset by that amount across the whole file; mouse-wheel over the editor also feeds this invisible scroll first. This compounds D2 and matches "cannot go to a position to type or anything."

**D4 — Typing latency ~53–88ms per keystroke on a desktop Chrome dev box.**
Every keystroke re-runs the whole-file regex tokenizer and re-renders ~2,000 spans **twice** — the modal layer (241–251) AND the covered main-pane preview (179–189) share the `code` state. Measured synchronous cost of one real `insertText` keystroke: **88.4ms @1280x800, 74.6ms @820x1180, 53.3ms @1180x820**. Expect 2–4× on iPad Safari → 150–350ms/keystroke; typing feels mushy and drops ahead-of-render input.

**D5 — Zero keyboard avoidance on iPad.**
The operator runs the WEB build on the iPad; `KeyboardAvoidingView` in react-native-web is a literal no-op (`onKeyboardChange(event) {}` — `node_modules/react-native-web/dist/exports/KeyboardAvoidingView/index.js:34`). The on-screen keyboard overlays ~40% (portrait) / ~60% (landscape) of the modal with no relayout, hiding the editor bottom, the logs, and often the caret.

**D6 — No caret-follow while typing.**
The browser auto-scrolls only the textarea itself (pinned; after A2 fix it can't and shouldn't) — it never scrolls the outer RN ScrollView. Typing below the fold = blind typing off-screen. Combined with D5 this is most of the iPad misery.

**D7 — Selection visuals are wrong (consequence of D1/D2/D3).**
Drag-select and double-tap word-select work *logically* (native textarea behavior) but the painted ::selection boxes sit over glyphs offset per D2/D3, and there's no visible caret anchoring the selection.

**D8 — Tab key throws focus out of the editor** (no keydown handling; standard textarea behavior). Fatal for code editing ergonomics.

**D9 — RISK (verify on device): iOS Smart Punctuation.**
RNW does emit `autocorrect="off" autocapitalize="none" spellcheck="false"` (verified in DOM), but iPadOS Smart Punctuation (curly quotes ’ “ ” and em-dash) is a system-level setting Safari does not reliably suppress via those attributes. A curly quote in pattern code = compile error. Needs an on-device check; if it mangles, add a **loud** non-ASCII-quote warning in the save path (no silent normalization — P0 no-fallback rule).

**Verified NOT broken (don't spend fixer time here):** caret position is preserved through the controlled re-render on the real input path (measured `caretPreserved: true` after React commit); native undo (Ctrl+Z) works and syncs back through onChange; copy/paste, arrows, home/end are native-good; no focus loss on re-render; no external state pushes into `code`. Also: the save/RUN path incl. the in-flight guard (64–114) is recent operator-bug-fix territory and works.

**UX papercut:** the big main-pane code view is read-only and not tappable — you must find the EDIT button. Tapping the preview should open the editor.

## Recommendation: PATCH, not rebuild

The overlay architecture is the industry-standard lightweight code editor (react-simple-code-editor does exactly this) and everything else around it (save pipeline, modal, logs) is healthy. The defects are four fixable implementation details: invisible caret, scrollbar width-theft, unbounded whole-file re-render, and missing web keyboard/caret-follow handling. A third-party editor (CodeMirror/Monaco) means offline vendoring + RN-web integration churn this close to the burn — not justified. **Patch it.**

## Fix plan (verbatim-executable, for the Opus fixer)

All in `CaptainPad/app/(tabs)/studio.tsx` unless noted.

**A1 — Make the caret visible.** Add `caretColor: '#00daf3'` to the TextInput style object (255–275). Keep `selectionColor` prop (it works on native iOS). Keep text transparent (highlight provides glyphs). Acceptance: computed `caret-color` = `rgb(0, 218, 243)`.

**A2 — Lock the geometry (the load-bearing fix for D2+D3).**
- Add `overflow: 'hidden'` to the TextInput style (kills the scrollbar → wrap widths equal → row counts equal → internal scroll impossible) and `scrollEnabled={false}` for native.
- Both layers must have byte-identical: `fontFamily` (keep `'Courier'` on both or change both together), `fontSize: 14`, `lineHeight: 20`, `padding: 24`, `whiteSpace: 'pre-wrap'`, `overflowWrap/wordWrap: 'break-word'`. Assert computed-style equality in the validation step, don't trust the source.
- Invariants that must hold at all 3 viewports with `00_golden_hour_wash`: `ta.offsetWidth === ta.clientWidth`, `|ta.scrollHeight − highlightHeight| < 20px`, `ta.scrollTop === 0` after Ctrl+End.

**A3 — Kill the per-keystroke whole-file re-render (D4).**
- Extract ONE shared highlight component (the tokenizer is duplicated verbatim at 179–189 and 241–251). Render per logical line: `code.split('\n')` → memoized `<HighlightLine text={line}/>` (`React.memo`), so a keystroke re-tokenizes only changed lines.
- Don't render the main-pane preview while the modal is open (`{!isEditing && …}`) — it's fully covered anyway.
- GEOMETRY WARNING: per-line rendering must reproduce the exact same total height as the single pre-wrap block (empty lines exactly one 20px row; no margins). Re-assert the A2 invariants after this change.
- Known cosmetic tradeoff: multi-line `/* */` comments won't color across lines with a per-line tokenizer — acceptable; do NOT reintroduce whole-file rendering for it.
- Target <16ms/keystroke desktop (measurement snippet in validation). If iPad still laggy, wrap the highlight's input in `useDeferredValue(code)` — keep the TextInput CONTROLLED (caret preservation is proven fine).

**A4 — Keyboard avoidance on web (D5).** In the Modal, on `Platform.OS === 'web'`, subscribe to `window.visualViewport` `resize`/`scroll` and set the modal root's height to `visualViewport.height` (unsubscribe on close). Header (CLOSE / SAVE & COMPILE) and the editor then stay above the keyboard. Keep `KeyboardAvoidingView` for native.

**A5 — Caret-follow while typing (D6).** On selection/input change (RNW `onSelectionChange`, or `keyup`+`input` listeners via the ref), compute caret Y with a hidden mirror div (`value.slice(0, selectionStart)`, same width + text styles — valid because of A2), then `scrollTo` the outer ScrollView so caret Y sits within the visible band (±40–60px margins). Throttle with rAF. (Alternative if this fights: make the textarea itself the fixed-height scroller with the highlight synced via `translateY(-scrollTop)` and scrollbar hidden — native caret-follow for free — but try mirror+scrollTo first, it's less invasive.)

**A6 — Tab key (D8).** Web keydown on the textarea ref: Tab (no shift) → `preventDefault()` + `document.execCommand('insertText', false, '  ')` (preserves the native undo stack — do NOT setState-splice the value).

**A7 — UX.** Wrap the main-pane preview in a `TouchableOpacity` → `setIsEditing(true)` (disabled when `!activeFile`).

**Do NOT touch:** `handleSave`/`runInFlightRef` (64–114, recent operator bug fixes), `loadPatterns` cold-start await (30–50), the save/compile API path (`utils/api.ts` savePatternCode/setActivePattern), logs pane, toasts, Modal open/close structure. No new npm deps.

## Validation recipe (fixer must run all of it)

Fresh `npx expo export --platform web -c`, serve dist on **:7167** (never the operator's :6967 Metro), engine on :6968, open `/studio`, file `00_golden_hour_wash`, at **1280x800, 820x1180, 1180x820**:
1. Computed `caret-color` = `rgb(0, 218, 243)`.
2. A2 invariants (offsetWidth==clientWidth; scrollHeight ≈ highlight height; scrollTop 0 after caret at EOF).
3. Click a known deep token (e.g. the `rgbwau(` call in `render3D`) → `ta.selectionStart` falls inside that token's `value.indexOf` range.
4. Keystroke timing < 16ms desktop: `t0=performance.now(); execCommand('insertText',false,'Q'); t1=performance.now()` at a mid-file caret; then Ctrl+Z restores and caret stays put.
5. Tab inserts 2 spaces; undo undoes it; focus never leaves the editor.
6. Type on the last visible line → outer scroller follows the caret.
7. On-device iPad, both orientations: keyboard up → header + caret visible; tap-to-position exact; drag-select/double-tap-word visually correct; type `'` `"` in a comment → no curly quotes (D9).
8. RUN / SAVE & COMPILE roundtrip still switches the deck (no save-path regression).
9. `npm run typecheck` clean, `npm test` (vitest) passing.

## Session notes / residue

- Measurements were taken with DOM-level insert/undo pairs; the pattern file on the engine was **not** saved or modified (SAVE/RUN never pressed).
- The local test engine (started for this session on :6968) crashed on an **unrelated pre-existing** fault while idle: VSN1 page-0 layout deploy overflow ("Action string is 5960 chars; device limit is 909") followed by a libuv `!(handle->flags & UV_HANDLE_CLOSING)` assertion (`src\win\async.c:94`) — feat/bm_readiness VSN1 thread, not a Studio issue.
- Serve process on :7167 stopped at session end; `CaptainPad/dist` build residue is gitignored.
