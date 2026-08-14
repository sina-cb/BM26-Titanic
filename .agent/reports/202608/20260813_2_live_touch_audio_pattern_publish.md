# Live Touch + audio + pattern publish handoff

Date: 2026-08-13
Integration worktree: `live_touch_bm_readiness_rebase`
Publish branch: `feat/mishas_live_control_panel_sina_changes_some`

## Outcome

Misha's Live Touch work is rebased onto BM readiness and hardened as a third
independent Layers setting. Deck, Mixer, and Live Touch share the same 100 ms
linear transition. Live is ARM-owned and private; Dimmer Rack remains the final
brightness authority. Canonical simulator views, multitouch Spatial XY,
fullscreen, bounded brush work, exact 0.1/0.5/1.0/1.5 second fades, and
iPad-oriented group/fader handling are integrated without redesigning Misha's
control surface.

The latest audio/Companion handoff and Baby Reveal handoff are also integrated.
Live Touch retains pattern IDs 128-130. Baby Reveal was atomically renumbered to
131-133 while preserving stable playlist and entry IDs. All four affected
Titanic galleries were regenerated and contain no obsolete Baby 128-130 names.

## Timeline authority

ARM heartbeats renew only the Live desk's liveness lease. They do not renew the
Timeline operator takeover lease. Only a real owner-tagged Live mutation counts
as operator activity. After the configured inactivity interval, Timeline
returns output to Deck while preserving ARM and the private staged Live session.
The next real Live mutation reacquires takeover and returns to Live through the
canonical blend. Continued mutations renew the ordinary Timeline lease.

The healthy takeover notice is compact and dismissible so it does not cover the
performance surface. A true plan-lock warning remains visible and
non-dismissible. Backgrounding remains a global fail-safe.

## Verification

- Final Baby + Live/Timeline + audio registry gate: 108/108 passed.
- Baby pattern timeline/split and gallery contracts passed after renumber.
- No obsolete Baby 128-130 references or gallery filenames remain.
- Engine list exposes 93 patterns: Live 128-130 and Baby 131-133.
- Audio/Companion suite: 813 passed in the integration validation run.
- CaptainPad full Vitest: 978 passed, 6 skipped; TypeScript and web export pass.
- Pixel/simulator focused gate: 110/110; generated artifact and scene/model
  parity pass.
- Brush/DOM performance gate passed with bounded rAF work and zero residual
  trail work after the maximum fade.
- Full simulation baseline: 2164 passed, 6 known unrelated failures, 1 known
  TODO. The failures are bench-section expectations and tracked scene residue,
  not this feature.
- Full CaptainPad lint remains baseline-red only for four untouched conditional
  hook errors in `GlobalEffectMacros.tsx`; scoped changed-file lint has no errors.

## Publish hygiene

The following tracked runtime/test residue is excluded from the publish commit
and is not silently reverted:

- `marsin_engine/states/titanic/audio_state.yaml`
- `marsin_engine/states/titanic/deck_state.yaml`
- `marsin_engine/states/titanic/globals_state.yaml`
- `marsin_engine/states/titanic/mixer_state.yaml`
- `marsin_engine/states/titanic/vsn1_layout.yaml`
- `simulation/scenes/test_bench/bench_mirror_state.yaml`

`marsin_engine/states/test_bench/audio_state.yaml` is intentional audio source
configuration/documentation and is included.

All project test servers are stopped after publish so the operator can start a
clean stack from this worktree.
