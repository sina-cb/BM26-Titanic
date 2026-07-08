# 2026-07-07 — Party merge wave: 4 branches → `feat/party_integration_20260711`

**Role:** coordinator. **Goal:** integrate everything needed for the
Saturday 2026-07-11 party. Full task tracker (with hardware/secrets context)
lives in the private repo: `BM26-Firmware-Deployment/PARTY_PLAN_20260711.md`.

## What happened

Merged, in order, onto the integration branch (renamed from the auto-named
session branch `feat/cool-herschel-fabd90` per `os/git.md`):

1. **`feat/studio_model_and_pattern`** — clean (1 commit: studio_top_loft
   model + scene configs + test_bench views).
2. **`origin/feat/led_fixtures_support`** — LED fixture family (grid/line/
   pixel-map, diffusion glow, `gen_led_fixture.js`, `te_led_grid` model).
   Conflicts:
   - Two `.agent` reports: directory-rename fallout (`02_reports` →
     `reports`), staged at the new path.
   - `simulation/src/dmx/controller_registry.js`: the branch predates Views
     Rehaul (#36). Its `kind: 'led'|'dmx'` controller field was **dropped in
     favor of main's `type` + `protocol` model** (a strict superset,
     including `CONTROLLER_TYPE_LED` + `normalizeLedConfig`). Verified no
     other file references controller `kind`; all `addController` call sites
     use `type`.
3. **`feat/captainpad-midi-control`** — MFT MIDI control surface. Conflicts:
   - `scripts/security_check.py`: both sides carried the same WinError-206
     `--stdin` fix; kept main's wording.
   - `CaptainPad/package-lock.json`: both sides changed deps;
     **regenerated** via `npm install --package-lock-only` from the cleanly
     merged `package.json` (npm auto-resolved; valid JSON, no markers).
4. **`feat/autopilot_deck_improvement`** — deck/autopilot + audio-reactive
   fixes. Conflict: `tools/port_cleanup.cjs` — took the branch side
   (`PORT_SCAN_MAX_BUFFER` constant); main's hunk had a duplicated
   `maxBuffer` key. The 4 CaptainPad/engine files shared with the MIDI
   branch merged **clean**.

## Verification

- `node --check` on touched engine/sim/tools files: **pass**.
- CaptainPad `npm run typecheck` (tsc): **pass** — MIDI + autopilot overlap
  is type-clean.
- `marsin_engine npm run check` (syntax + dry-run compile, 52/52 pixels
  patched): **pass**.
- `marsin_engine npm test`: failures in `audio_capture`, `osc_listener`
  (EACCES-vs-EADDRINUSE), `led_dmx_parity` — ran the same files on a temp
  `main` worktree: **identical failure set** ⇒ pre-existing/environmental on
  this Windows box, **no merge regressions**.
- Full-stack smoke (`skills/full_stack_smoke.md`) on the integration branch:
  delegated to a validator agent (in flight at time of writing) — results to
  be appended/reported before the operator merge.

## Open / next

- **Operator gate:** merge `feat/party_integration_20260711` → `main` +
  push after the smoke passes; then delete the merged feat branches
  (verify landed first).
- MarsinLED repo: `feat/config_bulletproof_impl` → local `main` (Sina's
  timing call — Angio4 bypass is live).
- Follow-ups (pattern tuning, party/ambient playlists, party-detection cue)
  are tracked in the private party plan, not here, because they carry
  hardware/network context.
