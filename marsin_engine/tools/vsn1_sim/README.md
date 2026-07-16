# vsn1_sim — VSN1 effects-surface mock (browser)

A standalone, self-contained HTML mock of the Intech **VSN1L** running our
deployed `effects_layout` config: MarsinLED welcome, 2×4 LCD grid, jog-wheel
value edits, mode cycling, page flashes, sticky toggle LEDs, and the 5-LED
encoder bar — **without the hardware**.

## Open it

**Double-click `vsn1_sim.html`** (or drag it into a browser). Zero
dependencies, zero build, no CDNs, no external fonts — works from `file://`
and fully offline. If you want it on a phone over the LAN, run
`python -m http.server` from this dir; nothing needs building.

## What it is

The LCD is a **1:1 transliteration** of the deployed Lua, not a re-design:
the Grid draw API (`draw_area_filled`, fixed-advance `draw_text_fast`, the
5-LED encoder formula) is implemented in JS and `wdw`/`fdw`/`gdw` +
`lcd_draw.lua`'s body are ported verbatim from
`../vsn1_config/templates/effects_layout/*.lua`. Those templates win over
any doc on discrepancy.

Interactions mirror the verified hardware loop
(`.agent/reports/202607/20260709_4_e2e_vsn1_verify.md`): press always
selects; toggles need a 2nd press (ON and OFF); triggers fire every press;
jog drag/scroll edits the selected value 0–127; jog press cycles mode with
wrap; sb0–3 switch pages with a 0.5 s flash and selection reset. The MIDI
event-log strip prints what the real device would emit.

## Live mode (optional)

Toggle **● LIVE** to mirror the running engine. Prerequisite: the marsin
engine on `http://127.0.0.1:6968` (CORS `ACAO:*` is already open, so this
works from `file://`). It polls status+page every 500 ms and re-fetches the
layout every 5 s; gestures optimistically POST like CaptainPad does. On any
fetch failure it **halts with a red banner** — no silent fallback (P0).
Toggle off to return to the offline demo layout.

Pure viewer: it never mutates anything unless you explicitly enable live
mode. Nothing to roll back.

## See also

- Design + full spec: `.agent/projects/vsn1_mock_ui_design.md`
- Lua source of truth: `../vsn1_config/templates/effects_layout/*.lua`
- Hardware controller facts: `docs/42_vsn1_controller.md`
