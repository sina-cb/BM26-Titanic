# 2026-06-20 — Companion DERIVED panel: surface the NEW Round-2/Wave-D signals

**Author:** UI/DSP sub-agent (slot 2, worktree `companion_new_signals`,
branch `dev/companion_new_signals` off `feat/audio_analysis_2`).
**Scope:** the engine + companion now compute many new derived signals via
`DerivedSignals`, but the Companion DERIVED readout only showed the OLD ones
(BPM/note/party/genre). This slice reads the new signals out of the companion's
OWN `paramCenter` (its `DerivedSignals` already publishes them) into the
broadcast frame and renders them, grouped + themed, with meters for continuous
keys and flashes for pulse keys.

## What shipped

A new readouts row under the existing live-readouts, three grouped cards — all
painted with the theme CSS vars (no hardcoded hex), so all 5 themes restyle them:

- **BUILD** — riser meter (`audioRiserScore`), ETA seconds readout
  (`audioBuildEta`, "—" when 0/no honest estimate), confidence readout
  (`audioRiserConf`), and a **COUNTDOWN** flash badge pulsed by
  `audioDropCountdown`.
- **STRUCTURE** — an SVG **phrase ring** filling with `audioPhrasePhase`, a
  **PHRASE** boundary flash (`audioPhraseBoundary`), a climax meter
  (`audioClimax`), a **silence pill** that flips `live`→`SILENCE`
  (`audioSilence`), and a **TRACK** change flash (`audioTrackChange`).
- **ONSETS** — three per-band dots (`micOnsetLow/Mid/High`) that light on a
  pulse, plus a **chest-hit thump** glyph (`audioChestHit`) that scales + glows
  on a sub-bass hit.

Pulse keys (`audioDropCountdown`, `audioPhraseBoundary`, `audioTrackChange`,
`micOnset*`, `audioChestHit`) are armed on the rising edge in the frame drain and
decay each render frame, so a single-hop pulse stays visible at 60 fps. Continuous
keys (`audioRiserScore`, `audioClimax`, `audioPhrasePhase`) meter directly.

The new server keys are read with `safeGet` (the existing helper): a key not
registered in a given build returns `null` → the UI shows an honest idle/"—"
(this is "not published", NOT a forbidden value fallback). In this build all 13
keys ARE registered and flow live.

## New keys surfaced in the broadcast frame `derived` block

| Frame key | CPC key | Render |
|---|---|---|
| `riserScore` | `audioRiserScore` | riser meter |
| `buildEta` | `audioBuildEta` (sec) | ETA readout |
| `riserConf` | `audioRiserConf` | conf readout |
| `dropCountdown` | `audioDropCountdown` | COUNTDOWN flash |
| `climax` | `audioClimax` | climax meter |
| `phrasePhase` | `audioPhrasePhase` | phrase ring |
| `phraseBoundary` | `audioPhraseBoundary` | PHRASE flash |
| `silence` | `audioSilence` | live/SILENCE pill |
| `trackChange` | `audioTrackChange` | TRACK flash |
| `onsetLow/Mid/High` | `micOnsetLow/Mid/High` | 3 onset dots |
| `chestHit` | `audioChestHit` | chest thump |

(genre/note/party/bpm were already shown — left untouched.)

## Files changed

```
M  marsin_engine/audio/companion/companion_server.js  (13 new safeGet keys in the derived frame)
M  marsin_engine/audio/companion/ui/index.html         (BUILD/STRUCTURE/ONSETS cards)
M  marsin_engine/audio/companion/ui/companion_app.css   (new derived-row styles, theme-var only)
M  marsin_engine/audio/companion/ui/companion_app.js    (state fields, armPulse/tickFlash/tickLit, renderDerived2)
A  marsin_engine/tests/companion_new_signals.test.js    (frame-key + theme-var assertions)
```

## Verification proof (commands + output)

### 1. Broadcast frame carries the new keys — live, TEST source, port 31266
Booted `node audio/companion/companion_server.js --port 31266` in TEST/synth
source mode (no mic), connected over WS, forced `setMode: test`, captured the
analysis `frame.derived` block:

```
derived frame keys: beat, bpm, buildEta, chestHit, climax, dropCountdown, genre,
  genreConf, hue, note, onsetHigh, onsetLow, onsetMid, party, phraseBoundary,
  phrasePhase, riserConf, riserScore, sc, silence, sp, trackChange
NEW keys present: 13/13
missing: (none)
```

Server stayed green throughout (`THIN→BUILD` structure transitions logged;
`engine config link DOWN` is the expected graceful-degrade with no engine up).
No leaked server processes after teardown (`ps … | grep node.*companion_server`
→ none).

Over a 12 s run (985 frames) the new keys go non-zero on the default test synth:

```
riserScore     0.3874     phrasePhase    0.9997
buildEta      31.9645s    phraseBoundary 1.0000 (pulse fired)
riserConf      0.3137     climax         1.0000
```

`dropCountdown / silence / trackChange / onset* / chestHit` stayed 0 on this
steady test tone (no transients/gaps to trigger them) — they are present in
every frame as finite scalars and the render path handles them; they simply
weren't triggered by this synth source (honest, not a bug).

### 2. Tests
- `node --test tests/companion_new_signals.test.js` → **2 pass / 0 fail**
  (boots the real server in test mode, asserts EVERY derived frame carries all
  13 new keys as finite numeric scalars + the old keys still present; asserts
  every `[data-theme]` block and `:root` define the full var set the new UI
  reads, and the new derived-row CSS contains **zero hardcoded hex**).
- `node --test tests/companion_*.test.js` → **72 pass / 0 fail** (was 69; +2 new
  here, suite total reflects all companion tests).
- `node --test tests/audio_signals.test.js tests/new_derived_signals.test.js`
  → **28 pass / 0 fail** (registry + derived-signal regression check).
- `node --check` clean on `companion_server.js` + `companion_app.js`.

### 3. Theme completeness
All 5 `[data-theme]` blocks (light/dark/midnight/sunset/gruvbox) + `:root` define
every var the new components use (`--bg --panel --panel2 --raised --border --text
--muted --accent --ok --err --on-accent`) — asserted by the test. The new UI uses
ONLY these vars (test asserts no hex in the new CSS section); `grep` confirms no
hardcoded color in the new HTML or `renderDerived2`.

**No UI screenshot:** this worktree has no chromium/puppeteer, so a rendered-page
capture is impossible (consistent with `20260620_8`). The live WS frame-key
capture + the committed test (frame shape + per-theme CSS-var completeness +
no-hex assertion) are the durable proof in lieu of an image. Visually inspect the
rendered cards + theme switch on a machine with a browser before the playa.

## Process
Read codex / node style / UI-design / plan `20260620_0` + `_1` + reports `_8`,
`_15`. Confirmed the new CPC keys are registered in this tree
(`audio/postproc/audio_signals.js` `DERIVED[]` + `ONSET_PULSE[]`) and published
by the companion's own `DerivedSignals.tick`. Added the 13 keys to the server's
`derived` frame via `safeGet`; added grouped HTML cards, theme-var-only CSS, and
the render/flash logic; wrote a test that boots the real server and proves the
frame + theme. Booted on 31266, captured the frame, ran the suites, killed the
server, confirmed clean `git status` (only intended changes + the new test).

## Known gaps / follow-ups
- No headless screenshot (no chromium) — verify the rendered cards + live theme
  switch visually before the playa.
- The phrase ring + flashes were validated by the live frame + the synth that
  fires phrase boundaries; `dropCountdown` / `trackChange` / onsets need a
  transient-rich source (real EDM / mic) to see them flash end-to-end — the
  wiring is proven by the frame keys, the visual pulse is the follow-up viz check.
