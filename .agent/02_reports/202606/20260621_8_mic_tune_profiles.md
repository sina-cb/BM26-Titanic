# 20260621_8 — MIC TUNE calibration profiles

**Branch:** `feat/audio_analysis_2` (PR #39)
**Date:** 2026-06-21

## Ask
Make calibration **profile-based**: calibrate for a named profile (Quiet room,
etc.), let the operator add their own, and calibrate into each.

## Shipped
The hardcoded preset buttons are now editable, persisted **profiles**. A profile
is a named venue/condition state = per-band gates + global gate + input gain.

- **`audio/companion/mic_profiles.js`** (new) — profile schema, validation
  (fail-loud, codex P0), and persistence to `mic_profiles.yaml`. Missing file →
  the 5 built-in defaults (Quiet room / Quiet night / Loud day / Windy /
  Neighbor bleed); present-but-broken → throws.
- **Server** (`companion_server.js`) — loads profiles at boot; tracks the active
  profile; `applyProfile` pushes a profile's gates+gain live AND through to the
  engine; handlers `applyProfile` / `addProfile` / `deleteProfile` /
  `saveActiveProfile`; persists on every change; seeds `hello`.
- **Client** (`companion_app.js`, `index.html`, `companion_app.css`) — a
  PROFILES card on MIC TUNE: chips (click = apply, active highlighted), the
  active profile's values + delete, and "＋ Add (saves current gates & gain)".
  The noise-floor calibration result gains a **"💾 Save to <active profile>"**
  button — that's "calibrate INTO a profile". Themed (default gruvbox).
- `mic_profiles.yaml` is gitignored (per-machine operator state, like
  `audio_config.yaml`); defaults live in code so a fresh checkout has profiles.

## How the workflow maps to the operator's two-phase plan
1. Make a profile for each state ("Art car near", "No art car").
2. At each condition, select that profile → **Calibrate noise floor → Save** →
   the gates (and current gain) are stored in it.
3. Switch profiles with one tap as conditions change on playa.

## Validation
- New unit test `tests/mic_profiles.test.js` (7 cases: slug/id/validate/load/save
  round-trip + fail-loud on malformed). **mic_profiles + companion = 80/80.**
- E2E (headless puppeteer): 5 defaults seed; apply "Loud day" → active; add
  "Art car near" → appears + active; Calibrate noise floor → Save → the profile
  captured the calibrated gates (0.733/0.624/0.617); all written to
  `mic_profiles.yaml`. No page errors. Screenshot in `~/tmp/mic_shots/14`.

## Follow-up (not built)
Profiles are companion-local. CaptainPad parity (shared profiles via the engine)
is a reasonable next step if the operator wants to switch profiles from the iPad.
