# 2026-07-10 · #12 — feat/led_integration merged into the party branch

**Author:** integration session (Fable main loop + Opus subagents)
**Branch:** `feat/party_integration_20260711` ← `feat/led_integration` (28e30ab)
**Merge commit:** 7b7dbf0. Source branch KEPT per branch policy.
**`stable` tag NOT moved** (still 6a64084, the hardware-verified party build) —
per Sina: do not tag the new changes stable yet.

## What landed

The full MarsinLED integration (see the 28e30ab commit body for the complete
list). Operator-facing highlights:

- Controller Mapping panel: MarsinLED cards with discovery (6.5s cold-probe
  window — device takes ~5s to first HTTP byte from cold), per-output
  universes on every port row, push ALWAYS available (force + confirm,
  auto-binds unbound cards), per-output Push-all. Legacy single-base push
  REMOVED — old firmware gets a loud "update firmware" refusal.
- Sim: LED strands paint directly under the local pixelblaze engine (they
  have no DMX wire read-back — the old patches-active gate froze them),
  sleek bulb+halo look with global Pixel/Halo size sliders.
- Engine: `controllers:` block in config.yaml unicasts U10+U12 →
  10.x.x.202 with `alsoFlat: true` (sim parity). MARSIN_CONFIG_FILE guard
  keeps spawned-engine tests from clobbering config.yaml.
- `save_endpoint.js`: save-server port resolved from config.yaml — a
  hardcoded :6970 was silently writing saves into whichever checkout owned
  that port (root cause of the phantom scenes/models found in the main
  checkout on 2026-07-10).

## Conflict resolutions (operator policy: state → party side; controller
## settings → LED side; generated models → regenerable)

- `scenes/test_bench/{controllers,scene_config,views}.yaml` → LED side (a
  strict superset: complete Titanic_202 card P1·U10→LED_0 + P2·U12→LED_1,
  LED_1 strand + view bit; the party tip had only a stale partial card).
- `marsin_engine/models/test_bench.{js,effects.js,viewmasks.js}` → LED side
  (generated files; match the merged scene: 72 DMX + 60 LED px).
- `marsin_engine/config.yaml` → three-way: controllers block from LED side;
  playlist (delay 5, no shuffle) + colorAutopilot (plasma_core/phoenix,
  5s, 1s fade) from the PARTY side. `vsn1:` block kept. YAML validated.
- `states/**`, `scenes/common.yaml`, test_bench playlist defaults: NOT
  committed (runtime residue; the party-8 layout in
  `states/test_bench/global_effect_slots.yaml` is untouched).

## Test evidence (merged tree)

- simulation: **278 pass / 0 fail**
- CaptainPad: **589 pass / 0 fail** + `tsc --noEmit` clean (exact party baseline)
- marsin_engine: 1920 pass / 8 fail — ALL pre-existing:
  5× audio_capture + 1× osc_listener (environmental on this box, fail on
  main too, per now.md) and 3× effects_v2_mode_page_layout, verified
  failing IDENTICALLY at the party-stable tip 6a64084 via a throwaway
  worktree. Zero new failures from this merge.
- Security check PASSED on both commits (real device MACs replaced with
  AA:BB:CC:DD:02:0x placeholders; device IPs in plans/reports redacted to
  10.x.x.NNN per bm26-report-ip).

## Hardware verification still needed (next session / party morning)

1. **202 output 2 (LED_1)**: device confirmed `sacn.perOutput`
   [out0→U10@1, out1→U12@1]; engine now unicasts U10+U12. Verify BOTH
   strands animate from the engine after `node launcher.js dev --scene
   test_bench` (single stack, standard ports). Output 2 was dark earlier
   because the engine only unicast U6 and the bridge relay predated LED_1.
2. **APC mini / MIDI**: reported not working late 2026-07-10 — debug
   AFTER this merge (the MIDI stack lives on the party side; the engine
   port had temporarily moved to 6988 which broke discovery-by-port —
   reverted to 6968, may already be fixed).
3. VSN1 known issue unchanged (view mode resets to DRUM after reset —
   accepted for party).

## Notes

- MarsinLED firmware repo (`~/workspace/MarsinLED`, installation
  `bm26-titanic`) carries the most recent controller configs — consult it
  before any device firmware/config work.
- Party plan (THE living tracker):
  the party plan in the external/private deployment source.
