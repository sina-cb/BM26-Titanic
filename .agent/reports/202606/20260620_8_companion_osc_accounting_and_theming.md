# Slot 1 — companion OSC-OUT accounting page + CaptainPad theming

- **Branch:** dev/companion_ui
- **Parent branch:** feat/audio_analysis_2
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/companion_ui
- **Slot ports:** companion 31166

> Note: this slice's sub-agent stalled mid-task after writing the
> implementation + a test; the **instigator finished it** (functional
> verification, this report) and verified before merge. The implementation
> (accounting endpoint/page, theming, genre display, the accounting test) is
> the sub-agent's work; this report + the merge verification are the instigator's.

## Scope
1. **OSC-OUT accounting page** (operator: "show ALL signals being sent to the
   marsin engine on ONE page"). A new observability surface enumerating every
   OSC output the Companion sends to the engine.
2. **CaptainPad theming** (operator: "companion doesn't use the CaptainPad theme
   with all the color themes"). Port CaptainPad's 5 themes into the Companion.
3. **Genre display** in the DERIVED panel (reads the sibling slot-0 `audioGenre`).

## What shipped
- **`/osc_accounting`** REST endpoint + a live UI page. GENERIC: it enumerates
  every designed OUTPUT signal (whose chain ends in an `osc_out` tap) PLUS the
  builtin emits (e.g. the derived BPM emit), with a live tally kept by OSC
  ADDRESS — so NEW signals added by sibling agents appear automatically. Each
  row: `{ address, label, cpcKey, kind, count, value, rateHz }`; plus
  `{ target:{host,port}, totalSent }`. Broadcast to the UI on its own slow
  250 ms cadence (the table doesn't need the analyzer frame rate).
- **5 themes** (`companion_app.css` `[data-theme="…"]` blocks: light, dark,
  midnight, sunset, gruvbox) mapping CaptainPad's `Palette` tokens onto the
  Companion's CSS vars. A top-bar **theme picker** persists to `localStorage`
  and sets `data-theme` on `<html>`/`<body>` to restyle live (default dark).
- **Genre** in the DERIVED panel: server frame carries the live `audioGenre`
  index; client maps it to a name via a `GENRE_NAMES` array kept in lock-step
  with the slot-0 detector (`/catalog.genreNames`). Absent → "—" until slot-0
  merges (display mapping, not a forbidden fallback).

## Files changed
```
M  marsin_engine/audio/companion/companion_server.js   (OSC accounting endpoint + tally + genre frame)
M  marsin_engine/audio/companion/ui/companion_app.js    (accounting page, theme picker, genre readout)
M  marsin_engine/audio/companion/ui/companion_app.css    (5 CaptainPad theme palettes)
M  marsin_engine/audio/companion/ui/index.html           (accounting nav + theme-select)
A  marsin_engine/tests/companion_osc_accounting.test.js  (accounting shape + theme-CSS completeness)
```

## Verification proof (commands + output)
- `node --test tests/companion_*.test.js` → **69 pass / 0 fail** (incl. the new
  `companion_osc_accounting.test.js`, which boots the REAL server, asserts
  `/catalog.genreNames` deep-equals the canonical 7-genre list, asserts every
  `/osc_accounting` row carries `{address,label,cpcKey,kind,count,value,rateHz}`
  + `target.host/port` + `totalSent`, and asserts each `[data-theme]` block
  defines the full CSS-var set).
- Live boot (`node audio/companion/companion_server.js --port 31166`):
  - `curl http://localhost:31166/` → **HTTP 200** (UI serves; engine link DOWN
    degrades gracefully as designed).
  - `curl http://localhost:31166/osc_accounting` → structured list:
    `{"target":{"host":"127.0.0.1","port":10000},"totalSent":0,"outputs":[`
    `{"address":"/marsin/mic/low","label":"micLow","cpcKey":"micLow","kind":"intensity","count":0,"value":null,"rateHz":0}, …]}`
    (values null/0 with no audio flowing — structure proven; the test exercises
    live values with a test source).
  - `curl http://localhost:31166/catalog` → `genreNames` = ambient, deep_house,
    melodic_house, tech_house, techno, melodic_techno, downtempo (matches slot-0).
  - CSS: 5 `[data-theme]` blocks present (light/dark/midnight/sunset/gruvbox).
- **No UI screenshot:** this datacenter has no chromium/puppeteer, so headless
  capture of the rendered page/theme switch is impossible. The endpoint captures
  + the committed test (which asserts the accounting shape, genre catalog, and
  per-theme CSS-var completeness) are the durable proof in lieu of an image.

## Process
Instigator took over the stalled slice: confirmed the partial work was coherent
(generic accounting endpoint, 5 theme blocks, genre wiring, a passing test),
booted the server, captured the `/osc_accounting` + `/catalog` responses, and
ran the full companion suite (69 green) before merging.

## Known gaps / follow-ups
- No headless screenshot (no chromium) — verify the rendered page + live theme
  switch visually on a machine with a browser before the playa.
- Accounting `value`/`count` populate once OSC is actually flowing (audio source
  active + engine reachable); proven live by the test, not by the idle curl.

## Operator action requested
Ready for review and merge.
