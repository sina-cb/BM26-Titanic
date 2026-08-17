# _277 — Text-selection kill SHIPPED: one shell rule, every tab, caret proven (Opus) — 2026-08-16

**Contract:** `docs/68_app_wide_text_selection_kill.md` (design `_276`).
Implemented exactly as ruled — D1..D7 all shipped as their defaults, no veto
taken. Operator pipeline: Fable designed, Sonnet sub-agents wrote the code,
this session managed, reviewed every diff, and ran every gate.

Operator order: *"the color wheel is great, but there's a lot of conflicts
with the text selection in the UI — when I drag it selects text which is
annoying, overall it's annoying everywhere in the app, can we disable it
all?"*

## What landed (working tree only — no git operations)

- **W1 — NEW `CaptainPad/app/+html.tsx`.** Faithful replica of expo-router
  6.0.23's stock shell (`html lang="en"`, charSet, `X-UA-Compatible`, the
  stock viewport meta verbatim, `ScrollViewStyleReset` from `expo-router/html`)
  plus the §2.3 style block verbatim: `html, body` gets
  `user-select/-webkit-user-select: none` + `-webkit-touch-callout: none`, and
  `input, textarea, [contenteditable="true"]` gets the `text`/`default`
  counter-rule. Web-only seam; native structurally untouched.
- **W2 — `docs/ui/touch_control.html`, two CSS additions only.** The `body`
  rule gains `-webkit-touch-callout: none`; the
  `.preset-cell .pc-label[contenteditable="true"]` rule gains
  `-webkit-user-select: text; user-select: text;` — closing the latent caret
  hazard the page's own global `none` had created. Not one line of markup or
  script moved.
- **W3 — NEW `CaptainPad/components/html_shell_selection_guard.test.ts`**
  (16 tests). House source-text-guard pattern. It MUST live under
  `components/` — the vitest include globs are `utils/*.test.ts`,
  `utils/midi/**`, `components/**/*.test.ts`, `hooks/**`; anywhere else and it
  would silently never run. Asserts the kill AND the counter-rule together,
  plus the D2 no-bare-`*` footprint and the stock-shell replication, so nobody
  can later delete the caret guarantee and keep the kill. Mutation-honest:
  seven mutations were applied and each killed exactly the guard describing it
  (including the "delete the counter-rule, keep the kill" case), then reverted
  byte-identical.

## W4 — the probe matrix (scratch stack only)

Fresh `expo export` to `C:/Users/TITANI~1/tmp/text_select_impl/dist` (8.3
short path — mandatory; the apostrophe in the profile path silently breaks
expo export). **A/B measured on the SAME export**: `dist_before` is a
byte-identical copy with only the `captainpad-no-select` `<style>` stripped
from all 29 HTML files, so every number below is attributable to this wave's
CSS and nothing else. Record: `~/tmp/text_select_impl/probe_results.json`,
harness `probe.cjs`.

| Measurement | before | after |
|---|---|---|
| computed `user-select` on the deck caption "Marsin Deck" | `auto` | `none` |
| computed `-webkit-user-select` on the same caption | `auto` | `none` |
| computed `user-select` on `body` | `auto` | `none` |
| **chars selected by the same 500 px drag** | **52** | **0** |

Carve-outs, all under the new shell:

- **Config field** (subnet, `placeholder="e.g. 10.1.1"`): computed
  `user-select: text`, focus taken, typed `10.1.77`, Ctrl-A →
  `selStart 0, selEnd 7`. Caret and in-field selection intact.
- **Studio code editor** — the contract's highest-risk surface, all three
  acceptance behaviors proven on the REAL editor (10 048-char pattern loaded
  from a scratch engine): computed `user-select: text` on the `<textarea>`;
  **drag-select inside the editor → 31 chars** (`selStart 0, selEnd 31`);
  **shift-arrow select → `selStart 0, selEnd 5`** after five Shift+ArrowRight;
  **Tab insertion via `document.execCommand('insertText')` → length
  10048 → 10050, `selStart 2`**, head `"  /*\n  00_go"`. The execCommand path
  and the caret-follow both survive.
- **The two deliberate `selectable` error Texts**
  (`embedded_service_screen.tsx:160,163` — the app has NO clipboard API, so
  selection is its only copy path): both computed `user-select: text` /
  `-webkit-user-select: text` in the rendered error panel
  ("2D PIXELS UNAVAILABLE"). The copy path survives the kill.
- **W1 AC-1:** the `captainpad-no-select` style is in the `<head>` of **29/29**
  exported HTML files, rendered byte-correct, after `expo-reset`.

### Probe safety

Request interception allowed only the scratch origins (dist :7186/:7187,
scratch engine :17968) and blocked 59 requests. Three attempts reached toward
the live sim's port — the app's own embed derivation, see the observation
below — and **all three were blocked at the network layer, never forwarded**.
The live stack was verified answering before and after (:6966 200, :6967 200,
:6968 alive, :6969 200, :6981 200); `CaptainPad/dist` mtime predates the
scratch export (never written into); `marsin_engine/states/` mtimes unmoved.
Scratch engine ran with a black-holed config copy — `sacn.destinations:
[192.0.2.x]` (TEST-NET-1, confirmed in its `[sACN Out] Sender started` line),
no `controllers:` key, OSC/fire_sync/vsn1 deploy off, `MARSIN_STATE_DIR` /
`MARSIN_PLAYLISTS_DIR` / `MARSIN_TIMELINE_DIR` redirected, and every
live-band port scrubbed out of the copy. All three scratch ports confirmed
FREE after teardown.

## W5 — gates

- **CaptainPad vitest: 105 files / 2281 passed / 6 skipped / 0 failed**
  (baseline 104 / 2265 — **+1 file, +16 tests**, exactly the new guard).
- `native_gesture_armor.test.ts` **37/37 green** — proves W1 did not touch the
  dial's armor.
- `npx tsc --noEmit` clean; `npx eslint app/+html.tsx
  components/html_shell_selection_guard.test.ts` 0 errors.
- Engine contract tests that parse `touch_control.html`:
  `touch_control_catalog_contract` + `touch_control_wire_layers_contract`
  → **29/29 pass**.
- Web export clean (29 HTML files emitted).
- Security: the three files this wave touched produce **zero** findings. The
  repo-wide `--all` scan's 75 findings are all pre-existing — gitignored
  `simulation/.scene_backups/**` plus prior `.agent/` reports — untouched by
  this wave. No commit was made; no git operation of any kind was run.

## Deviations and observations (reported, not hidden)

1. **The baseline drag measured 52 chars here, not `_276`'s 157.** Different
   drag geometry (25-step vector) and a different tree (current post-`_275`).
   This does not weaken the result: the A/B ran on the same export minutes
   apart, so 52 → 0 is a clean attribution. The direction and the endpoint —
   zero — are what the contract rules.
2. **`-webkit-touch-callout` is not verifiable in headless Chrome.** It is a
   WebKit/iOS-only property and does not appear in Chrome's computed style, so
   the callout kill (D5) is proven by source + exported-CSS presence only.
   **This is the one acceptance that needs the operator's iPad**: long-press a
   caption (should do nothing) and long-press inside a text field (should
   still offer the paste menu).
3. **Probe technique note for the embedded-error surface.** An *aborted*
   iframe request still fires `onLoad`, which clears `loading` and suppresses
   the error panel entirely. The embed request therefore had to be left
   **pending** (never forwarded, never aborted) so the component's own 15 s
   watchdog set `loadError` honestly. Worth knowing for any future probe of
   that surface.
4. **Observation, NOT in scope — `SIMULATION_PORT` is hard-pinned to 6969**
   (`CaptainPad/utils/simulation_url.ts:10`), so the 2D Simulator embed
   derives the LIVE sim's port regardless of the configured api_base. Any
   scratch-dist probe of that tab points at the operator's running sim unless
   the harness blocks it. Not a bug for the show (engine and sim are
   co-supervised), but it is a real trap for test harnesses.
5. **Sub-agent reporting inaccuracy, caught in review.** The W2 agent claimed
   `buildTransport()` and `window.__captainpadDeliver` were "present and
   untouched" in `docs/ui/touch_control.html`. They occur **zero** times in
   that file — in the working tree and in HEAD alike; they live in
   `docs/ui/touch_control_theme.js`, which this wave never opened. The pins
   are genuinely untouched, but the claim as written was not verified by that
   agent. The two pins that *are* in the HTML (`captainpad_embed` gate,
   `window.parent !== window`) appear as additions in the diff-vs-HEAD because
   they belong to the **pre-existing uncommitted docs/66 work** in that file,
   not to this wave.
6. **Scratch-engine boot fact:** `BM26_CAPTAINPAD_AUTH_REQUIRED` must be set
   explicitly to `1` or `0` or the engine refuses to boot by name — correct
   fail-loud behavior, worth knowing when spawning a probe engine.

## Operator action

- **CaptainPad rebuild REQUIRED** — the shell only exists in a fresh web
  export; the running :6967 dist predates it. No engine restart needed.
- Live Touch (W2) needs only a browser reload; the sim serves that file
  directly.
- One iPad check outstanding: the long-press callout behavior in item 2 above.
