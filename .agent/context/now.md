# now.md — State of Play

> Updated by any agent, any time state changes. Keep it under a screen.
> Absolute dates only.

_Last touched: 2026-07-10 (late — LED integration merged into the party branch)_

## Active branches

- **`main`** — integration branch. Push/merge is operator-gated.
- **`feat/party_integration_20260711`** — party merge wave (studio model +
  LED fixtures + CaptainPad MIDI + autopilot deck) **+ `feat/led_integration`
  merged 2026-07-10**: MarsinLED discovery, per-output DMX push (force +
  confirm, legacy path removed), LED strand sim parity + pixelblaze direct
  paint. Source branch kept per branch policy. `stable` tag still points at
  6a64084 (pre-LED party build) — NOT retagged, per Sina.
- **`feat/led_integration`** — merged into the party branch (kept as
  per-feature history). Plan: `.agent/plans/20260709_0_led_integration_execution.md`;
  reference: `docs/41_led_controller_onboarding.md`.

## Active projects

- **party_20260711** — party on Saturday 2026-07-11. THE current plan lives
  in the private repo:
  `BM26-Firmware-Deployment/.agent/plans/20260707_party_plan_20260711.md`
  (merge wave + testing plan, MarsinLED/Angio4 hardware, MIDI tests, pattern
  tuning, party + ambient playlists, party-detection cue). Source feat
  branches are kept; the integration branch is the working branch.
- **agent_os_rework** — reworking `.agent/` into the Agent OS. See
  [`../projects/agent_os_rework.md`](../projects/agent_os_rework.md).

## Party-prep status (2026-07-09, party is 2026-07-11)

**THE plan: [`../plans/20260709_party_readiness_execution.md`](../plans/20260709_party_readiness_execution.md)**
— Track A effects-controller wrap-up (single-page mode, welcome logo,
CaptainPad→VSN1 auto-deploy proof, UI polish), Track B three playlists
(party_high / party_low / ambient), Track C pattern tuning on the DMX test
bench (separate agent session). Sina's directive: ONE VSN1 page done right;
side buttons must stop switching pages.

DONE + hardware-confirmed:
- **MFT fast-twist FIXED** (Sina: "works perfect"): full-range `value−64`
  decode, linear step, ACCEL_GAIN_MAX 3.0 — do NOT retune the confirmed feel.
  Merged review: `reports/202607/20260709_11_mft_motion_review_merged.md`.
- **VSN1 layout auto-deploy LIVE**: `config.yaml vsn1.deployLayout: true`;
  slot edit → 1.2 s debounce → one-page COM12 flash (SYNCING screen) →
  verified end-to-end `lastResult: ok`. Fixed an unhandled-rejection crash in
  the serial waiters (grid_serial/restore/write/read_config `.catch` guards).
- **APC mini remapped** (docs/midi/apc_mini_mk2.md): shift=deck/mixer, track
  buttons=focus channels, clip_stop=combined autopilot, stop_all=blackout.

DONE + hardware-confirmed (2026-07-10):
- **VSN1 effects UI fully landed** — auto-deploy on layout change +
  deploy-on-load on boot + `POST /global-effects/deploy`; "Loading" reflash
  card; welcome logo first-connect only (host hello-driven); side-button ↔
  CaptainPad page sync; UI-lab tool `tools/vsn1_utils/ui_lab.cjs`.
  Docs: **[docs/42](../../docs/42_vsn1_controller.md)**.
- **2026-07-10 EVENING — freeze hunt + final redesign** (FULL HANDOFF:
  [`../reports/202607/20260710_11_vsn1_freeze_hunt_and_redesign.md`](../reports/202607/20260710_11_vsn1_freeze_hunt_and_redesign.md)):
  three stacked freeze causes found (wedged pad-scan → USB replug; zombie
  tabs double-dispatching; deploy pipeline bugs) and fixed; VSN1 redesigned
  to its party shape — DRUM behavior everywhere, COLOR-ONLY grid default,
  sb map MODE/VIEW/empty/LOGO. 589 CaptainPad tests + 7 device-build tests
  green. Auto-deploy remove+add cycles VERIFIED LIVE on hardware at handoff
  (rev 2+3, both `ok`, page snap-back correct).

OPEN (tracked in session task list):
- **KNOWN ISSUE:** VSN1 view mode resets to DRUM after a reset (hello-resync
  fixed the effect-add re-flash case, not reset). Sina accepts for party.
- **PR prep IN FLIGHT:** two Opus review agents running — (1) adversarial
  correctness review of the VSN1 stack, (2) security + PR-readiness across the
  whole diff (226 files, ~38.5k ins vs main). Party build.
- Verify: mixer focused-channel MFT fix, npm-test state pollution fix (B12 —
  keeps crashing the stack on restart), restart-activated engine fixes.
- Playlists (party_high/low + ambient), pattern tuning on the bench.
- Everything uncommitted on `feat/party_integration_20260711` — commit is
  operator-gated; security check + subsystem auto-checks first.

## Hot notes

- **Effects v2 Track C (CaptainPad) LANDED** on `feat/party_integration_20260711`
  (uncommitted): 4-page effects switcher + per-slot value/mode UI; VSN1 side
  buttons → engine `effectsPage`, encoder press → mode cycle; VSN1 MIDI feedback
  stream (slot active/value/mode + page). 428/428 CaptainPad tests, tsc clean.
  Needs the parallel engine track (`/global-effects/page`, `mode/cycle`,
  `primaryMode` + `mode*` on slot status). Report `20260709_2_effects_v2_captainpad`.

- **gitleaks v8.28.0** on `PATH` confirmed working (gate passed 2026-07-07).
- **marsin_engine tests on the Windows box**: `audio_capture` (no audio
  device configured), `osc_listener` (EACCES instead of EADDRINUSE), and
  `led_dmx_parity` fail identically on `main` — environmental/pre-existing,
  not regressions. Same set fails on the party integration branch.
