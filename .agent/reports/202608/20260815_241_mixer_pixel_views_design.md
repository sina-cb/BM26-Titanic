# _241 — Mixer pixel views: design (per-channel + master 2D ship, perf-mode dominance)

**Role:** designer (Fable). **Deliverable:** `docs/58_mixer_pixel_views.md` —
a complete implementation contract for an Opus implementer. **No product code
touched; no git ops.** Concurrent sessions respected: `_240` (special
events / show YAML) untouched; patterns/playlists untouched.

Operator orders (verbatim): *"mixer change, in the mixer, please add the top
down view on the channels and add one for the master. make it a nice design by
fable to show the top down (or possibly other views too based on a drop down
or sth)"* and *"keep in mind we can hide parameters during performance and
show viz more dominantly with patterns. use the idea from the deck hiding and
shit. also, optimize for touch performance please in the design"*.

---

## The four ruling calls

### 1. Data path — capped channel buffers, zero engine change (D1)

The channel views render from the existing 100-sample per-channel `/ws/viz`
buffers through the deck window's already-shipped nearest-sample path
(`buildSampleLookup`), with the honesty ratio (`100/964`) printed on the band.
The master view reads `preDimmer`, which is already `full`.

Grounds, from `_239`'s own measurements: the canvas costs per glyph **drawn**
(1.8–2.6 ms for 720-glyph top-down at 100 *and* at 964 samples — identical),
so full-rate channels buy only colour fidelity; at mixer scale (~112 px band,
glyphs at ~1.6–2 px) a ~10-model-px band is visually a gradient; and full-rate
channel keys cost **+272 kbit/s each** (8 ch ⇒ +2.18 Mbit/s ⇒ ~2.9 Mbit/s
total, always-on, per client) — the wrong spend before `_239`'s demand-driven
subscription exists.

Explicitly rejected: extending `keyMaxPixels` to channel ids — `_239`'s
validation argument (runtime ids in config bind to channels that may not exist
next boot) stands. If full-rate channels are ever ordered, the spec'd path is
a **class budget** `vis.channelMaxPixels` landed *together with* demand-driven
`/ws/viz` (doc §1.2, W8 — deferred, not built).

Offered knob (W7, config-only): `vis.maxPixels 100 → 240`. Free for the RN
strips since `_239` (they resample to their own 100 segments); +44 kbit/s per
channel; bands ~10 px → ~4 px. Operator's call; design is correct at 100.

### 2. Switcher UX — dropdown chip + the mixer's own modal idiom

A `TOP-DOWN ▾` quiet chip in the band header opens the existing
`modalOverlay`/`modalContent` picker (the SCREEN ▾ / TRANSITION ▾ pattern),
one ≥44 pt row per **authored artifact view** (never a hardcoded list),
honesty sentence in the footer. Chip-row (no room in a 320 px card) and
press-hold (invisible affordance) rejected. Master band adds the deck
window's SHOW/RIG source chips inline; channel bands have one real buffer and
no source toggle. View choice + collapse are session-local module state
keyed by vis key — never persisted, docs/56 not in play.

### 3. Perf-mode layout — the `_217` derived overlay, applied to the mixer

Gate on raw `usePerformanceMode().active` (not `usePerfLock` — the
`deck_workspace.tsx:227-233` reasoning, screen composition follows the mode).
Derived in render, zero persistence writes, round-trip byte-identical:
LOCAL PARAMS column hidden (the mixer's twin of docs/55 D3), the pixel view
takes that column slot at ~260-380 px (dominant), playlist column **stays**
("with patterns" — activation is live-performance work, not structure, per
_228), thin strips stay, edit-mode band suppressed (one canvas per channel),
master forced open at 160 px, and a static `PARAMS HIDDEN · SHOW MODE · MIDI
STILL LIVE` caption answers "where did my params go" on the spot.

### 4. Touch budget — gesture-dead canvases + a measured paint scheduler

Canvas wrappers are `pointerEvents:"none"` — all interaction on ≥44 pt header
chips, so fader capture-claims and the strip row's horizontal scroll never
meet a competing responder, and no same-axis scroll is introduced. Vis frames
never touch React (self-subscribe → ref → imperative paint, the `_225` law;
`MixerScreen` keeps its no-viz-subscription invariant). Measured burst: 3
canvases ≈ 6.6 ms/tick (fine); **9 canvases ≈ 20 ms — a stolen fader frame**,
so W1 adds a shared round-robin scheduler: 8 ms budget per rAF, latest-buffer-
wins, visibility gating (collapsed / off-viewport / hidden-tab bands paint
0 ms). Worst case spreads over ~3 frames, still well inside one 200 ms vis
period. One shared artifact fetch (module cache) replaces per-mount fetches.

---

## Also flagged

**D5 (operator veto point):** per-channel vis buffers are **unmasked** —
a view-selected channel broadcasts its pattern across the whole model
(`pattern_mixer.js:3383-3395`), unlike deck PFL and Live Touch which black out
unselected pixels (docs/27). On a top-down view that answers "where does this
layer land" wrongly. Recommended: the 3-line engine masking, matching
precedent — but it visibly darkens existing thin strips for masked channels,
so it is his ruling; the fallback is an explicit `FULL PATTERN · MASKED TO …
AT MIX` caption. Either way, never silent.

## Deliverables

- **`docs/58_mixer_pixel_views.md`** — layout specs (edit + perf, band
  anatomy, dense/narrow cases, non-web refusal), the D1 arithmetic, switcher
  UX, touch/paint budget, W1-W8 with acceptance criteria, 10-shot screenshot
  matrix, operator questions.
- This report; tracker block appended.

## Operator questions (doc §8)

1. D5 masking — recommended yes.
2. W7 `maxPixels 240` — optional sharpening, +44 kbit/s per channel.
3. Persist view/collapse across reloads? (Spec'd session-only.)
4. Perf mode: playlist column kept — hide it too if "viz full-card" is the
   intent.
