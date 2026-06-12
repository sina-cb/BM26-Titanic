---
description: Drive the engine→sACN→sim chain with known test patterns and verify pixel data byte-for-byte (solid-color fidelity check)
---

# 🎨 Engine → Sim Pixel Fidelity Check

How to start the marsin engine on a known pattern, get its sACN frames
into the simulation, and PROVE the pixel data lands on the right
channels — visually (screenshots) and byte-for-byte (received DMX
frames). Distilled from the solid-color audit of 2026-06-12 that
validated R/G/B/W end-to-end on test_bench. Use this whenever pixel
colors look wrong, after touching the mapping/export/sACN path, or as
a pre-playa sanity sweep.

Related specs/skills: `.agent/00_gol/06` (run sim), `07` (run engine),
`.agent/01_skills/00_see_the_world.md` (screenshots),
`05_full_stack_smoke.md` (whole-stack bring-up). Known open issues that
WILL bite you are flagged inline by repo task id (`010`, `022`, `023`)
— they live as cards on the Notion *Titanic Lighting - Task Tracker*
board (see `.agent/00_gol/14_task_tracking.md`); the card bodies carry
these ids.

---

## 0. The three traps (read first)

1. **UDP 5568 bind contention (task 010, DETERMINISTIC here).** The
   engine's sACN senders and the sim's IN bridge both bind UDP `*:5568`
   with reuseAddr; the LAST binder wins unicast delivery. Engine binds
   last → the bridge receives nothing → the browser gets zero frames
   while everything "looks running". Always VERIFY frames arrive (step
   3) before judging colors. If they don't, see §5 workaround.
2. **`--pattern` drives the deck, the MIXER owns the output (task 023).**
   `node engine.js --pattern X` (and `POST /set-pattern`) load X into
   the deck/PFL preview channel. The live sACN output follows the mixer
   view, and the restored `marsin_engine/states/<model>/mixer_state.yaml`
   may have its faders at 0 → the engine emits pure black (only forced
   ch1 dimmers) regardless of the pattern, silently. Fix per session:
   `curl -X POST http://127.0.0.1:6968/mixer/view -H 'Content-Type: application/json' -d '{"view":"deck"}'`
   Also: the restored playlist autopilot can swap patterns every ~15 s
   mid-test — disable it (engine API/config) for deterministic checks.
3. **The IN bridge currently delivers PERCENT values (task 022).** The
   sacn npm lib hands the bridge 0–100 payloads and the bridge forwards
   them as raw bytes — so until 022 is fixed, a full-on channel reads
   **100, not 255**, in the browser-side frame, and the sim renders at
   ~39% absolute brightness. Hue ratios are correct. Wire-side DMX is
   genuine 0–255 (verify with a UDP sniffer if needed).

## 1. Test patterns (static solid colors)

Engine patterns are PixelBlaze-style files in `marsin_engine/patterns/`
(name without `.js` is the `--pattern` arg). Minimal solid color:

```js
// zz_test_solid_red.js — TEST RESIDUE, delete after the run
export function render(index) {
  rgb(1, 0, 0);
}
```

Make one per color (red `1,0,0`, green `0,1,0`, blue `0,0,1`, white
`1,1,1`). ⚠ Residue: the files themselves AND the engine appends them
to `marsin_engine/patterns/manifest.json` — delete the files and
`git checkout -- marsin_engine/patterns/manifest.json` in teardown.

## 2. Bring-up (order matters)

```bash
cd simulation && npm start            # sim FIRST (:6969-:6972)
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:6969/simulation/index.html  # → 200
cd marsin_engine && node engine.js --model test_bench --pattern zz_test_solid_red   # THEN engine
```

- Model must match the sim scene (`?scene=test_bench`).
- Engine log must show `Rendering "zz_test_solid_red"` and the patch
  coverage line: `Shared DMX mapper: 52/52 pixels patched across 2
  universe(s) [2, 1]` (numbers per scene — note them; unpatched pixels
  render as the bright-red UNDRIVEN indicator in the sim, see §4).
- Then apply the §0.2 deck-view POST.

Open the sim (headless: puppeteer under `xvfb-run -a`, scripts in
`~/tmp/` with `NODE_PATH=<repo>/simulation/node_modules` — see skill
00 for flags/waits) and switch lighting mode to **sacn_in** via the
real UI (the ⚡ Lighting Engine → Mode select; programmatically:
find the `.lil-gui select` whose options include `sacn_in`, set value,
dispatch `change`).

## 3. Verify frames actually flow (never skip)

The sACN IN monitor panel (`📡 SACN IN MONITOR (6971)`) is the source
of truth, instrumented for exactly this:

- `STATUS Connected`, `LAST FRAME` a few ms and ticking — healthy.
- `⚠ STALLED` (red) = socket alive but frames stopped >2 s; log shows
  the stall/recovery lines.
- Programmatic equivalent: `window.sacnInput.stats.framesReceived`
  increasing and `stats.lastFrameAt` recent.

No frames within ~10 s of engine start → you hit trap §0.1; go to §5.

## 4. Byte-level verification (the actual proof)

In the sim page, read the received frame per universe:

```js
[...window.dmxRouter.getFullFrame(2).slice(0, 41)]
```

Compare against the scene's patch layout (fixture start addresses from
`simulation/scenes/<scene>/patches.yaml`; footprints/channel maps from
the model file `marsin_engine/models/<scene>.js`). Channel maps that
matter on test_bench:

- **UkingPar (10 ch)**: ch1 = master dimmer (the mapper FORCES it full
  every frame), ch2/3/4 = R/G/B, ch5 = W. So a par at addr 1 under
  solid red reads `[100, 100, 0, 0, 0, ...]` at offsets 0–4 (100 = full
  until task 022 lands; then 255).
- Pars pack at 1/11/21/31/… — the same 10-byte group must repeat
  IDENTICALLY per fixture. Any rotation/shift between groups = address
  misalignment; one wrong channel inside a group = channel-map bug.
- Universe 1 carries only the pinned effects (haze @510, fog @512) —
  all-zero when effects are off is CORRECT.

Expected per color (par group, offsets 0–4): red `[F,F,0,0,0]`,
green `[F,0,F,0,0]`, blue `[F,0,0,F,0]`, white `[F,F,F,F,0]`
(W stays 0 for rgb-only patterns; F = full, see §0.3).

## 5. If frames never arrive (task 010 workaround)

The 010 contention has a session workaround the 2026-06-12 audit
proved over 60k+ frames — it MUTATES tracked scene state, so it is for
test sessions only and must be reverted:

1. Neutralize the relay senders so nothing else binds 5568:
   temporarily set the scene's `controllerIp` values to `0.0.0.0`
   (kills both bridge relay senders and the sacn_in-mode loopback).
2. Restart ONLY the bridge receiver (`simulation/server/sacn_bridge.js`)
   AFTER the engine is up, so the receiver binds 5568 last.
3. Revert the scene edit in teardown.

## 6. Visual verification

Per color: screenshot the full page (skill 00 conventions), then
**actually look at it** (Read tool). PASS = every pixel dot uniform in
the expected color across all fixture types, plus matching ground
wash. Account for:

- **Bright-red dots = the UNDRIVEN indicator** (unpatched fixture or
  universe not received) — a feature, not data corruption. They must
  be the SAME fixtures in the same spots across all four colors; a red
  dot that moves or appears only in some passes is a real bug.
- White renders warm-ish on RGBWAU fixtures — acceptable; a wrong hue
  is not.
- Capture the IN monitor in at least one shot as flow evidence.

## 7. Teardown checklist

- Kill engine + sim (`npx --prefix simulation kill-port 6969 6970 6971 6972`, kill the engine PID).
- Delete `marsin_engine/patterns/zz_test_solid_*.js`.
- Revert engine/sim residue:
  `git checkout -- marsin_engine/states/ marsin_engine/models/ marsin_engine/patterns/manifest.json marsin_engine/config.yaml simulation/scenes/`
  (engine runtime state, hot-regenerated models, manifest, any
  autopilot/config change, any §5 scene edit).
- `git status --short` must be clean — report it, don't hide it.

## Reference run (2026-06-12)

All four colors PASSED on test_bench: byte groups identical per
fixture at addrs 1/11/21/31/41, U1 zeros (effects off), no undriven
dots (52/52 patched), IN monitor `Connected / LAST FRAME ~20 ms`
throughout. Evidence pattern: `.agent_renders/solid_<color>.png`.
Findings tracked on the Notion board: tasks 022 (percent scaling),
023 (deck/mixer trap), 010 (contention confirmed deterministic).
