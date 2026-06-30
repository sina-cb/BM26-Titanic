# 2026-06-30 — Handoff: `feat/optimize_channels` (deck/mixer + tempo overhaul)

**Branch:** `feat/optimize_channels` (durable; pushed to `origin`).
**Base / merge-base with `origin/main`:** `ada12f0`.
**Scope:** a long operator-driven polish pass over the **deck + mixer**
(CaptainPad), the **tempo/BPM** path (engine + Audio Companion), **mixer
groups**, **vis**, **global effects**, and **pattern fidelity**. This report is
the handoff: what changed, where it lives, current state, and open items.

**State at handoff:** engine `node --test tests/*.test.js` green (**1153**);
CaptainPad `npx tsc --noEmit` 0 errors, `npm run lint` baseline (11 warnings /
0 errors, none added). Engine/sim `states/**` + `simulation/scenes/**` runtime
residue is expected and intentionally **not** committed/reverted (codex P0).

---

## 1. Tempo / BPM — the big overhaul (supersedes docs/39 §6.za)

The old model was **"OSC auto-drives, tap overrides for 12 s then OSC
reclaims"** with a 3-BPM stability deadband. Operator feedback drove a full
rework. The new model:

- **Sticky OSC/TAP source switch.** `mixer.tempoSourcePref` ('osc' | 'tap') is
  a PERSISTED, broadcast preference — the selector no longer flaps with arbiter
  timing. `osc` → follow live OSC; `tap` → hold the tapped tempo, OSC ignored.
  A manual tap makes TAP sticky; selecting OSC snaps back. Persisted in
  `mixer_state.yaml`, restored on boot, broadcast so **deck + mixer always
  agree**. (`lib/tempo_arbiter.js`, `lib/pattern_mixer.js`,
  `lib/state_manager.js`, `lib/api_server.js` new `POST /mixer/tempo/source`.)
- **OSC-selected tempo is the RAW OSC value** (deadband removed): when OSC is
  the source, `mixer.tempoBpm` equals the received value verbatim — the readout
  never lags the OSC number.
- **Stability moved to the source.** The Audio Companion now (a) applies a quick
  EMA (`lib/bpm_smoother.js`, τ 250 ms) to `audioBpm` **in place before the UI
  and the OSC emit read it**, and (b) rounds to an integer at emit
  (`bpm_emit.js`). So the Companion UI, the OSC packet, CaptainPad's readout,
  and `mixer.tempoBpm` all show **one identical, de-jittered integer**.
  Configurable: `config.yaml companion.bpmSmoothing {enabled,tauMs}` (default
  on). An optional engine-side replica exists (`config.yaml
  tempo.oscBpmSmoothing`, **default off** — the Companion already smooths).
- **Dual-writer race fixed (the real "jumpy OSC" bug).** When the engine ran
  its OWN local analyzer (`audio/signals/derived_signals.js`, source
  `'derivedSignals'`) alongside the Companion, BOTH wrote the same `audioBpm`
  key — one raw, one smoothed — and the arbiter followed whichever wrote last.
  Fix: `TempoArbiter._onChange` now **ignores `audioBpm` whose ParamCenter
  source is `'derivedSignals'`** and follows only the OSC/Companion value. This
  also stabilizes speed-sync (it maps the arbitrated `mixer.tempoBpm`). Found by
  3 independent adversarial reviews; 2 confirmed with simulation.
- **CaptainPad single-sources OSC BPM** on the Companion's `audioBpm`; dropped
  the LX `/lx/tempo/bpm` → `tempoBpm` CPC fallback from the audio tab + globals
  tile. Tap is HTTP-only (`POST /mixer/tempo`) — no OSC output, no loopback.
- **Tap→BPM smoothing**: `use_tempo_tap.ts` uses the MEDIAN interval over up to
  8 taps (outlier-robust).

Tests: `tests/tempo_arbitration.test.js` (31 — sticky source, raw fidelity,
source-filter), `tests/bpm_smoother.test.js` (10), `tests/companion_bpm_emit.test.js`
(rounding), HIL `hil_tempo_arbitration_test.mjs` updated to the sticky model.

## 2. Mixer groups (gang-faders)

- Collapsible groups; expanded = a bordered/tinted container that **surrounds**
  its member channels (banner header on top); collapsed = a **thin vertical
  bar** to save horizontal space. Real derived group names on the GROUP rail.
- **Grouped-channel inner scroll fix:** `groupMembersRow` now `flex:1 +
  minHeight:0` so a member's playlist / LOCAL PARAMS lists bound and scroll like
  a standalone strip (they previously overflowed with no scroll).
- **Snapshot persistence fix:** `SnapshotManager.save` dropped the `mixGroups`
  field, so a recalled view lost its groups. Now persisted — groups (faders +
  membership) survive capture → save → recall (instant + crossfade).
- Up to **8 channels** (`config.yaml mixer.maxChannels: 8`); the channel
  ScrollView scrolls **only on overflow**, and `HorizontalFader` capture-claims
  its own drag so a fader never scrolls the row instead of moving.

## 3. UI polish (deck + mixer)

- Single-row channel header, with a **2-row fallback only when the strip is too
  narrow** (measured width < 340 pt — e.g. group members) so the name + control
  cluster stop colliding.
- Master **TO BLACK / UP** fade now offers **0s (instant)** alongside 1/3/5/10 s
  (`MasterFadeGroup`; 0s routes to the instant `PATCH /mixer {master}` since the
  timed-fade route requires duration > 0).
- Overlay ✕ button fixed (unmapped icons on web); default overlay blend = OVER;
  CUE feature removed; global tap-tempo + master-fade shared across deck/mixer;
  invert is an assignable global-effect slot (9 slots, 7/8/9 add bug fixed);
  OSC status pill green/yellow/gray; playlist load-dir cancels on outside click;
  overlay patterns share params with the main playlist pattern.

## 4. Vis

- Deck-main + mixer-master strips show hue/global-FX but **ignore the dimmer
  rack** (engine `preDimmer` frame); per-channel strips stay full-active (not
  dimmed by the channel fader) for live tuning.

## 5. Pattern fidelity + discontinuity sweep (00–25)

- Audited og_patterns vs patterns/, restored original motion/contrast/palettes
  while keeping new knobs (see `20260629_0_pattern_fidelity_audit.md`). Built a
  reusable discontinuity detector (`~/tmp/disc/`) and fixed real seams/freezes
  across 00–25 while preserving identity.

---

## 6. Removals (2026-06-30) — dead features dropped after their UI was cut

- **Playlist `tags`** — the CaptainPad UI was gone, leaving an unused engine
  field. Removed the coercion from `PlaylistManager.load()/save()`, the `tags`
  arg on `POST /playlists`, the unit test, and docs/19 §2.5. Old files with a
  `tags` key load fine (ignored, stripped on next save).
- **Playlist hot-swap** (timeline_support) — the SWAP UI was gone and the load
  flow uses `POST /deck/playlist` (`setChannelPlaylist`); nothing called the
  hot-swap endpoints. Removed `POST /deck/playlist/swap`, `/deck/playlist/queue`
  (warm-on-anchor), the mixer-overlay swap twin, `validateSwapTransitionOverride`,
  the 4 hot-swap HIL tests, the `validateSwapTransitionOverride` unit block, and
  all docs/39 hot-swap content (§2 flagship, §5 timeline, map rows, retitle).
  **Preserved** (shared/core): `loadPlaylistEntryWithTransition`, the
  warm/precompile-next-entry machinery (autopilot pre-warm), `triggerDeckPatternSwap`
  + the deck transition-config routes, the live load path, and the core
  soft-transition tests. Verified `node --test` 1140 pass.
- **`.agent/plans` → `.agent/04_plans`** — numbered to match the other dirs.

## Open items / follow-ups

- **Sweep remaining `onEndEditing`-only TextInputs.** react-native-web drops
  `onEndEditing`; the channel rename was fixed (onBlur+onSubmitEditing+optimistic
  parent update) but other fields (e.g. group rename in the GROUP rail) likely
  share the bug — not yet swept.
- **Engine-side BPM smoothing** (`tempo.oscBpmSmoothing`) ships default-off; only
  enable for a jumpy NON-Companion OSC sender (stacking it on the Companion's
  filter adds lag).
- **Visual verification** of the grouped-channel scroll + 2-row header was done
  via tsc/lint, not a live screenshot — worth a real-device pass.
- **Pre-PR review** (2 adversarial reviewers, engine + client) was run on
  2026-06-30; any confirmed findings fixed before opening the PR.

## How to verify

- Engine: `cd marsin_engine && node --test tests/*.test.js` (1153 pass).
- Client: `cd CaptainPad && npx tsc --noEmit && npm run lint` (0 errors / 11
  baseline warnings).
- Full-stack smoke: `.agent/01_skills/05_full_stack_smoke.md` — sim → engine
  (model must match scene) → CaptainPad web; with the Audio Companion running,
  the OSC BPM (Companion UI), the audio-tab OSC BPM, and the globals BPM tile
  should all read the **same** integer and be stable; flip the OSC/TAP switch
  and confirm it sticks (no flapping).
