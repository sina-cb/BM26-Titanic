# Slot 6 — captainpad_audio_ui

- **Branch:** dev/captainpad_audio_ui
- **Parent branch:** feat/audio_analysis_2
- **Worktree:** /root/workspace/BM26-Titanic-worktrees/captainpad_audio_ui
- **Slot ports:** CaptainPad web 31467 / Metro 31481 (mock engine ran on 31468 for proof)

## Scope

CaptainPad audio-UI improvements from the companion signal-designer contract
(`.agent/02_reports/202606/20260617_0_companion_signal_designer_contract.md`):
the rich modulation popup, a scrollable audio-signal grid, and fully dynamic
audio signals (incl. genre index→name). On inspection, the rich popup, the
shared `AudioTraceCanvas`, `utils/audioSignals.ts`, and the dynamic
`useAudioSignals`/`deriveAudioSignals` plumbing were ALREADY committed on the
parent branch (`feat/audio_analysis_2`) — so this slice shipped the remaining
gaps and a popup polish:

1. **Genre index→name (dynamic signals, item 3).** Added the canonical
   index-aligned genre list + `audioGenreName()` + `isGenreKey()` to
   `utils/audioSignals.ts`, and made the AUDIO-tab signal column render the
   genre NAME (e.g. "TECH HOUSE") instead of a meaningless numeric index.
   Out-of-range/no-genre → "—" (no fabricated label, Codex P0). Dynamic
   rendering already surfaces NEW Companion keys automatically (audioGenre,
   micOnsetLow/Mid/High, audioChestHit) — verified live.
2. **Scrollable signal grid (item 2).** Wrapped the 3-col AUDIO SIGNALS grid in
   a height-capped (`SIGNAL_GRID_MAX_HEIGHT=340`) `ScrollView` so the lower
   rows (dom/energy/note/genre/onsets/chest-hit) are reachable without pushing
   the BPM-sync / SETTINGS cards off-screen. Cap only engages when the set is
   tall; a short set keeps its natural height. Kept the 3-col layout.
3. **Rich modulation popup polish (item 1).** Added `SourceChip` — each
   candidate source signal now shows a live-level accent underline (its current
   normalised value) so the operator can see WHICH signals are hot before
   selecting, without N animated trails crowding the picker. The selected
   source still gets the full `AudioTraceCanvas` trail, and the transfer-curve
   plot (with live marker) + TARGET preview were already present.

## Files changed

```
 CaptainPad/app/(tabs)/audio.tsx      | 50 +++++-   (genre readout, scroll cap, grid ScrollView)
 CaptainPad/components/Modulation.tsx | 79 ++++++-   (SourceChip live-underline picker)
 CaptainPad/utils/audioSignals.ts     | 42 ++++     (genre name list + resolvers)
 3 files changed, 159 insertions(+), 12 deletions(-)
```

## Tests run

- **CaptainPad auto-checks (`.agent/00_gol/03_captain_pad_auto_checks.md`):**
  - `npx tsc --noEmit` → **EXIT 0** (clean).
  - `npm run lint` → **EXIT 0**, 12 problems (0 errors, 12 warnings) — all 12
    are PRE-EXISTING (baseline identical before my edits); none in my 3 files.
  - `npm run web:build` (web-visible UI changed) → **Exported: dist**, EXIT 0,
    `/audio` route built. Confirmed clean (no scratch route) on final build.
- **Live web smoke (Playwright + chromium, headless via xvfb):** built + served
  `dist` on :31467, drove it against a dependency-free mock engine on :31468
  (`~/tmp/mock_engine.cjs` — faithful /param-center(/schema), /audio/config,
  /ws/signals + /ws/params frames; routes 17 audio signals incl. the NEW
  dynamic keys). Captured:
  - `~/tmp/audio_tab_viewport.png` / `audio_tab_full.png` — live colored trails
    per signal; **GENRE → "TECH HOUSE"** (index 3 resolved); BPM 124; OSC LIVE.
  - `~/tmp/audio_tab_grid_scrolled.png` — after scrolling the inner grid, the
    lower rows are reachable: ONSET LOW/MID/HIGH + CHEST HIT (the NEW dynamic
    signals) appear, and BPM-sync + SETTINGS cards stay visible below.
  - `~/tmp/modulation_popup.png` — the rich popup: SOURCE picker (SourceChips
    with live underlines, incl. ONSET/CHEST HIT/GENRE), selected-source live
    trail (LOW · 41%), MAPPING transfer curve with live marker, MODE/POLARITY/
    RANGE/CURVE, TARGET preview "SPEED 0.50 → 0.64 +0.14".
  Visually inspected every PNG.

## Verification proof

- `npx tsc --noEmit`: **pass (exit 0)**.
- `npm run lint`: **pass (exit 0)** — 0 errors, 12 pre-existing warnings
  (none in audio.tsx / Modulation.tsx / audioSignals.ts).
- `npm run web:build`: **pass (exit 0)**, `/audio` exported, clean tree.
- Screenshots (headless chromium against mock engine):
  - `~/tmp/audio_tab_viewport.png`, `~/tmp/audio_tab_full.png`
  - `~/tmp/audio_tab_grid_scrolled.png`
  - `~/tmp/modulation_popup.png`
- What I clicked / observed: loaded `/audio` → confirmed AUDIO SIGNALS grid
  renders the dynamic set incl. NEW keys, genre column shows "TECH HOUSE",
  scrolled the inner grid to reveal the onset/chest-hit rows while sync/settings
  stayed on screen; loaded the popup harness → confirmed source picker underlines,
  source trail, transfer curve + live marker, and live TARGET delta.
- `git status` clean (only the 3 intended files + node_modules); scratch route
  + mock + capture scripts live in `~/tmp` (gitignored); servers killed,
  ports 31467/31468 freed.

## Known gaps / follow-ups

- "Each candidate source's LIVE TRAIL plot" (contract wording) is rendered as a
  per-candidate live-LEVEL underline rather than N full animated trails — a
  deliberate UI call (N self-animating rAF canvases in a 440 px picker would be
  heavy/noisy); the full trail is shown for the SELECTED source. Revisit if the
  operator wants per-candidate sparklines.
- The genre column's bar/trace still normalises the index by range max (a valid
  "which genre slot" position indicator); the authoritative readout is the NAME.
- Could not exercise the popup from real deck state (needs a loaded
  pattern/playlist entry); proved it via an isolated harness route that was
  removed before commit.

## Operator action requested

Ready for review and merge.
