# _168 — CaptainPad Dimmer Rack: MASTER fader (all groups at once)

**Operator request (verbatim):** "can you add a single slider in the dimmer
rack on captain pad to controll allllll sliders at the same time as
convenience so I can control them all if needed"

## What shipped

One **MASTER** slider pinned at the top of the Dimmer Rack card, above the
row of group faders it commands. Moving it sets **every** dimmer group to the
same value; the group faders follow it live (knob *and* readout).

Deliberately unlike the group faders so it can never be mistaken for one: a
full-width **horizontal** bar in the accent colour with a `MASTER` pill, an
`ALL <n> GROUPS` caption and a big `%` readout — versus the vertical
"nautical" knobs below it.

## Design choices

**Absolute, not proportional.** The master writes its value verbatim to every
section. No ratio/scaling mode — the rack has no such concept anywhere else,
and a hidden multiplier is exactly the kind of surprise the operator does not
want at 3am on the playa.

**Readout = MEAN of the group levels.** After a master move every section
holds the same value, so the bar reads back the commanded number. Once the
operator moves an individual fader the bar shows the true average instead of a
stale "last commanded" number it can no longer honour. The alternative
("remember what I was last set to") was rejected: it needs extra state that
goes wrong the moment anything else touches a dimmer, and the rack already
owns every level, so the mean is free and always honest.

**Same command path as an individual fader — no new engine API.** A master
move fans out one `POST /section-brightness` per section, byte-identical to
what a group fader sends. So it persists exactly the same way
(`globals_state.yaml`, keyed by stable group name) and needs zero engine-side
change. `marsin_engine` was **not touched**.

**Section-id space, not group-name space.** Several group names can resolve to
one physical section (`GET /dimmer-groups` dedupes by name, not by section).
The master dedupes to unique section ids, so an aliased group is written once
and weighted once in the mean.

**Backpressure instead of a fixed throttle.** 24 groups × a drag's worth of
values would queue hundreds of POSTs behind the browser's 6-per-host limit and
land the *stale* ones last. Instead the sender keeps only the **latest**
requested level while a batch is in flight — measured: a 12-step drag produced
**8 batches of exactly 24 writes**, ending on the release value.

**Fail loudly.** Any failed write in a batch paints a red line under the bar
(`24/24 groups failed — Failed to fetch`). Engine-down at load still shows the
rack's existing "Engine offline / RETRY" state, with no master rendered. The
faders do move optimistically during a failed batch — same as the pre-existing
individual faders, which also keep their moved position when a POST fails —
but the failure is never silent.

## Files changed

- `CaptainPad/utils/master_dimmer_logic.ts` **(new)** — pure, RN-free logic:
  `uniqueSectionIds`, `masterLevel` (mean), `applyMasterLevel` (absolute),
  `createCoalescedSender` (latest-wins backpressure).
- `CaptainPad/utils/master_dimmer_logic.test.ts` **(new)** — 17 vitest cases
  over the above.
- `CaptainPad/app/(tabs)/dimmer_rack.tsx` — master strip UI + handlers; the
  rack now **owns** every section level in `dimmerStates` (it previously
  fire-and-forgot the POST and let each fader keep a private value), which is
  what lets the master both read the rig's true state and push a new one down.
- `CaptainPad/components/NauticalFader.tsx` — external-value sync now moves the
  **knob**, not just the number (it was positioned once on mount, so a pushed
  value left the handle behind); `draggingRef` guard so a sync can never yank
  the knob out from under a finger; `onPanResponderTerminate` mirrors release
  (a cancelled gesture used to leave the drag flag stuck ON, which would have
  frozen master→fader sync and the rack's scroll gate); callbacks read through
  live refs (HorizontalFader's documented stale-closure fix); `React.memo` so a
  master sweep re-renders only the faders whose value changed.

Not touched: `marsin_engine/**`, any scene/pattern/playlist, the operator's
`:6967` Metro instance and every other operator port.

## Verification

Engine-side verification used a **throwaway mock engine on :6990** (`~/tmp/
feat_168/mock_engine.cjs`, 24 groups) and a fresh `expo export` dist served on
**:7167** by a local static server — never Metro (stale-bundle memory), never
the operator's `:6968`/`:6967`.

| Check | Result |
|---|---|
| `npx vitest run` | **45 files / 960 passed / 6 skipped**, 0 failures (baseline 44 / 943 / 6 → **+1 file, +17 tests, zero new failures**) |
| `npx tsc --noEmit` | clean, no output |
| `npx expo lint` | 21 problems (4 errors, 17 warnings) — **all pre-existing**, none in any file touched here |
| `python scripts/security_check.py --all` | **6 findings = baseline** (gitignored `.scene_backups/studiodj/**` MACs); zero new |

**Behavioural evidence** (`~/tmp/feat_168/shots_clean/`, capture script
`~/tmp/feat_168/master_fader_capture.cjs`):

1. `01_master_at_load.png` — mock groups load at 1.00/0.80/0.60/0.40 repeating;
   master reads **70%** (the exact mean). `ALL 24 GROUPS`.
2. `02_master_pulled_down.png` — master dragged to 25%: **all 24** group
   faders read `0.25` with their knobs at the matching height; mock engine's
   `GET /dimmers` confirms sections 1–24 all at `0.25`.
3. `03_one_group_diverged.png` — one group fader dragged to `0.82`
   afterwards: it holds `0.82`, the rest stay `0.25`, master now reads
   **27%** — i.e. the mean, not a stale 25%.
4. `04_engine_down_master.png` — `POST /section-brightness` blackholed after
   load, master dragged: red `24/24 groups failed — Failed to fetch` under the
   bar.
5. `05_portrait.png` — iPad portrait: master strip on top, the two-high fader
   stack below it unchanged.

Wire journal (`~/tmp/feat_168/writes_clean.json`): **197** writes — 8 master
batches × 24 (levels 0.90, 0.85, 0.74, 0.63, 0.52, 0.41, 0.30, **0.25**
last = the release value) + 5 single-section writes from the individual drag.

The only page error observed is `Minified React error #418` (hydration text
mismatch); it reproduces identically on untouched routes `/config` and
`/audio`, so it is pre-existing and app-wide, not from this change.

## Notes / follow-ups

- `CaptainPad/dist/` was rebuilt for verification (gitignored, untracked).
- The mean readout does not live-track changes made from **outside** the rack
  (MIDI, another CaptainPad) until the screen refetches on foreground — the
  rack has never had a dimmer WS mirror. A `dimmers` broadcast on
  `/ws/control` would close that gap; filed as a possible follow-up, not
  needed for the operator's request.
