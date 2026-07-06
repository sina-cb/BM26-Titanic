# Slot 21 — channel_metering

- **Branch:** dev/channel_metering
- **Parent branch:** deliverable tip (channels/groups-solo wave)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/channel_metering
- **Slot ports:** engine 31268 (HIL — not needed; unit tests covered it)

## Scope

Build per-channel output METERING: a cheap effective-output `level` (0..1) per
channel, computed allocation-free in the engine each vis frame and surfaced as
a bar + percent meter in the self-subscribing `ChannelVizStrip` (beyond the
existing pixel viz). The level reflects what actually reaches the mix — the
channel's intrinsic mean brightness scaled by the SAME `effFader`
(fader / `faderMax` clamp / group scale / solo gate / enabled) used by the
composite gate — so a layer that is faded out, muted-group, solo-gated, or
made invisible by a blend mode reads ~0 even when its pattern is bright.
Documents the feature in `docs/39` §11.

## Files changed

```
M  marsin_engine/lib/pattern_mixer.js   (_visLevels field; _bufferMeanLevel;
                                          getVisLevels(); group-scale/soloActive
                                          precompute hoisted before the vis
                                          pre-pass; per-channel/deck/master/
                                          inactive level fill in renderAll6ch)
M  marsin_engine/engine.js              (levels sidecar on the type:'vis' broadcast)
M  CaptainPad/components/ChannelVizStrip.tsx  (meter bar + percent from msg.levels;
                                               showMeter prop; null-when-absent)
A  marsin_engine/tests/channel_metering.test.js  (13 unit tests)
M  docs/39_channels_deck_mixer.md       (§11 metering note)
A  .agent/02_reports/202606/20260620_21_channel_metering.md
```

**Broadcast file touched: `engine.js`** — that is where the per-channel vis
payload is serialized for the `/ws/viz` broadcast (`statsCallback({ type:'vis',
vis, pixelCount })`). Added `levels` alongside `vis`. `api_server.js`'s viz
publish hook forwards the whole `type:'vis'` object verbatim to `/ws/viz`, so
no api_server route edit was required (verified at `publishStatsRef.publish`,
the `data.type === 'vis' ⇒ payload = data` branch). No edits to mixer.tsx,
PlaylistPanel.tsx, DeckTopBar.tsx, index.tsx, api.ts, pattern_channel.js,
state_manager.js, or any api_server route.

## Implementation notes

- **Allocation-free hot path (Codex P0):** the level is folded into the
  existing vis-extraction pre-pass — one extra summation pass over the
  already-rendered `channelBuffer` (`_bufferMeanLevel`), no new per-frame
  `Uint8Array`, no extra pattern render. The WAVE 15 group-scale cache +
  `soloActive` flag were hoisted up from the composite loop to run ONCE before
  the pre-pass and are reused by both, so `_effFader` stays pure O(1).
- **Mean (not peak) brightness** so a mostly-dark pattern with one hot pixel
  doesn't read as fully lit; it tracks perceived contribution.
- **Deck** meters its own clamped fader + enabled gate only (PFL, never in
  groups/solos). **master** meters the final composed output. The deck-swap
  inactive sibling meters its incoming pattern × swap fader.
- **Fail-loud / no silent fallback:** absent `levels` (older engine) or
  absent/non-finite key ⇒ client `level` stays `null` ⇒ NO meter renders, no
  layout shift. A documented schema default, never a fabricated 0.
- **Self-subscribing preserved:** `ChannelVizStrip` reads its level off the
  same viz-bus `msg.levels`; no new prop from mixer.tsx (coordinate-free with
  the parallel groups_solo_ui agent that owns mixer.tsx).

## Tests run

- **Unit (engine):** `tests/channel_metering.test.js` — 13 tests, all pass.
  Covers: fader→level (0 / 0.5 / 1), half-bright pattern → half level,
  faderMax clamp caps level, disabled → 0, solo gate (non-soloed → 0, soloed
  stays lit), muted group → 0 + un-mute restores, group fader scales
  proportionally, deck PFL meters own fader, master reflects composed output,
  levels NOT populated on non-vis frames, getVisLevels keys == getVisData keys.
- **Engine syntax:** `node --check lib/pattern_mixer.js` + `node --check
  engine.js` → OK.
- **Engine full suite:** `node --test tests/*.test.js` →
  **923 pass / 0 fail** (baseline 910 + 13 new).
- **Engine list/dry-run:** `node engine.js --list` → 60 patterns;
  `node engine.js --model test_bench --pattern 01_cylon_sweep --dry-run` →
  exit 0, all blends compiled, no missing-blend errors.
- **git diff --check:** clean for both `marsin_engine` and `CaptainPad`.
- **CaptainPad:** `npx tsc --noEmit` → 0 errors;
  `npm run lint` → 0 errors / 12 warnings (baseline, no new — ChannelVizStrip
  not flagged); `npm run web:build` → exit 0, 21 routes exported.
- **Sim smoke:** not run (no sim/render change; engine + CaptainPad only).
- **HIL:** not run; unit tests + the existing fake-WASM-host harness cover the
  level math deterministically. Engine port 31268 not used.

## Known gaps / follow-ups

- The meter renders under EVERY `ChannelVizStrip` that opts in (default on),
  including the deck/master strips. If a screen wants pixels-only it can pass
  `showMeter={false}`. Wiring per-screen `showMeter` choices is the consuming
  screens' call (mixer.tsx owned by another agent this wave); the default-on
  behavior is additive and safe.
- Level is mean brightness; a future peak/RMS toggle could be added if an
  operator wants headroom metering. Deferred — out of scope.

## Operator action requested

Ready for review and merge.
