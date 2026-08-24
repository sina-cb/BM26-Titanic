# 2026-07-07 — Full-stack smoke on `feat/party_integration_20260711`: ALL LINKS PASS

**Role:** validator (delegated agent). **Spec:** `skills/full_stack_smoke.md`.
Plan row: T1.1 in the private party plan
(the party plan in the external/private deployment source).

## Verdicts

| Link | Verdict | Evidence |
|---|---|---|
| Sim up :6969–:6972 | PASS | HTTP 200, all four servers up |
| Engine up + pattern | PASS | :6968 reachable, `test_bench` 52/52 pixels, 40 fps, renderHealth ok |
| Engine → sim sACN | PASS | sACN IN monitor: **Connected**, FPS 79, frames growing, universes [1,2], `394 packets/5s from 'MarsinEngine'` |
| Lights animate | PASS | Two front-view frames ~30 s apart visibly different (fixtures + ground pool change) |
| CaptainPad build + serve | PASS | Exported + served (on :6977 — see anomaly 1) |
| CaptainPad ↔ engine | PASS | Header **● CONNECTED**, model `test_bench`, live BPM 96, live audio bars, populated playlist, live deck strip |

Screenshots (visually inspected) in `.agent_renders/`:
`1783478430_current.png`, `sacn_in_expanded.png`,
`1783478604_front.png` + `1783478635_front.png` (animation pair),
`captainpad_home.png`.

## Anomalies (follow-ups)

1. **Foreign stale `serve` on :6967** (pid 40608, serving an OLD CaptainPad
   build from the main checkout's earlier stack) — not matched by
   `tools/port_cleanup.cjs` signatures, so identity-checked cleanup left it.
   Fresh build was verified on :6977 instead (engine target is hard-set to
   `127.0.0.1:6968` in `CaptainPad/config.yaml`, so the port swap doesn't
   affect the connectivity verdict). **Operator:** kill pid 40608; consider
   adding `serve` to `STACK_PROCESS_SIGNATURES`.
2. **`--pattern` CLI flag is overridden by restored autopilot state**: the
   pattern loads and pins to DECK, then restored autopilot (RANDOM profile,
   DECK TX ON, 10 s) immediately cycles onward. Chain verification is
   unaffected, but given `feat/autopilot_deck_improvement` just merged this
   deserves a look — is boot `--pattern` supposed to suspend autopilot?
3. Corrupt puppeteer cache for `chrome-headless-shell` win64-145.0.7632.77
   (folder exists, exe missing, delete permission-denied). Worked around
   with `PUPPETEER_SKIP_DOWNLOAD=true` (full Chrome 145 already cached).
4. Minor: engine playlist skipped stale default sliders for
   `19_swaying_lattice_ballet`; sACN bridge loaded 0 routes for scene
   `titanic` (default bridge scene) — no impact, universes forwarded.

## Residue (expected, left in place)

`marsin_engine/models/test_bench{,.effects,.viewmasks}.js`,
`marsin_engine/patterns/manifest.json`,
`marsin_engine/states/{test_bench,summer_camp_dome}/*.yaml`,
`simulation/scenes/manifest.json`,
`simulation/scenes/summer_camp_dome/playlists/default.yaml`.
Tree was clean before the run. All started servers torn down; only the
pre-existing foreign :6967 serve remains.

## Conclusion

The merge wave is **runtime-verified end to end**. Gate M5: **PASS**.
M6 (merge to `main`) is unblocked pending Sina.
