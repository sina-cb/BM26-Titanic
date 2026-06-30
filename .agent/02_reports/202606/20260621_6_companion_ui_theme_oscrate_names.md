# 20260621_6 — Audio Companion UI: gruvbox default, OSC output rate, full signal names

**Branch:** `feat/audio_analysis_2` (PR #39)
**Date:** 2026-06-21

Three operator-requested companion UI changes.

## 1. Gruvbox is the default theme
- `companion_app.js`: `DEFAULT_THEME = 'gruvbox'` (was `'dark'`); `currentTheme()`
  / `applyTheme()` fall back to it. A returning operator's saved choice still
  wins (localStorage) — only the unset default changed.
- `companion_app.css`: `:root` now carries the gruvbox palette (moved off the
  dark block) so the very first paint — before the JS picker runs — is gruvbox,
  no flash. Header comment updated.

## 2. OSC OUTPUT RATE control (OSC OUT page)
The analyzer runs ~86 hops/s and the companion was sending every output on every
hop (~774 packets/s aggregate for 9 outputs) — too fast for the wire/engine.
Added a configurable send rate (a frame rate), **default 60 fps**.
- `companion_config.js`: optional `osc.rateHz` (default 60, validated int [1,120]);
  serialized so "Export config" persists it. Absent ⇒ 60 (back-compatible).
- `companion_server.js`: `oscRateHz` state + a **phase-accumulator throttle**
  (adds `oscRateHz / hopRate` each hop, emits when it crosses 1.0) so the actual
  average send rate matches the target — a time-threshold gate would quantize 60
  down to 43 (every other 11.6 ms hop); the accumulator hits ~60 and caps at the
  hop rate. `sendOsc` drops non-frame hops; `setOscRate` WS handler (live +
  persisted); `rateHz` added to the accounting snapshot.
- UI (`index.html`, `companion_app.js`, `companion_app.css`): slider + number +
  `30 / 60 / MAX` presets under the OSC header, themed. Verified: per-output rate
  tracks the target (@60→~57/s, @30→29/s, @MAX→~81/s ≈ hop rate).

## 3. Full signal names in the left list (no more "micL…")
The sidebar row pinned the name to a fixed 40 px column while the mini-scope
hogged the flexible space, truncating every name. Restructured `.sig-row` into a
**2-row grid**: row 1 = the full name on ONE line (single line, no wrap) + value
+ remove button; row 2 = the mini-scope plot spanning the full width (also bigger
and clearer). All names — micLow … micDomEnergy2 — now show in full.

## Validation
- Full unit suite **1307/1307**; companion + audio_config **97/97**.
- Booted on :6966, driven headless (puppeteer + Chrome): gruvbox is the default
  on a fresh load; OSC rate slider/presets throttle correctly; sidebar shows full
  names on one line with the plot below. No page errors. Screenshots in
  `~/tmp/mic_shots/` (gitignored), visually inspected.
