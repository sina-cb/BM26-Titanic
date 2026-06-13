---
description: Bring up the full stack (simulation + marsin_engine + CaptainPad), verify every link, and prove it with screenshots
---

# 🔗 Full-Stack Smoke — Sim · Engine · CaptainPad

This skill brings up all three live components on one machine, verifies each
link in the chain, and captures screenshot evidence. Use it to validate the
stack after changes that cross subsystem boundaries, to onboard yourself on
how the pieces talk, or whenever the operator asks "does the whole thing
still work?"

The chain under test:

```text
CaptainPad (web UI :6967)
   │  ws://127.0.0.1:6968/ws/params + /ws/viz   (control + viz)
   ▼
marsin_engine (:6968 REST/WS · OSC :10000)
   │  sACN over WebSocket bridge (:6971)
   ▼
simulation (:6969 HTTP · :6970 save · :6971 sACN in · :6972 sACN out)
```

Verified end-to-end on 2026-06-09 (headless Linux container, SwiftShader).

---

## Port Map

| Port | Owner | What |
|---|---|---|
| 6967 | CaptainPad | Static web build (`npx serve dist`) |
| 6968 | marsin_engine | REST + WebSocket API (CaptainPad talks here) |
| 6969 | simulation | HTTP frontend |
| 6970 | simulation | Save server (config persistence) |
| 6971 | simulation | sACN IN bridge (engine → sim) |
| 6972 | simulation | sACN OUT bridge (sim → real controllers) |
| 10000 | marsin_engine | OSC listener |

## Prerequisites (one-time per machine)

```bash
cd simulation     && npm install     # also provides puppeteer for screenshots
cd marsin_engine  && npm install
cd CaptainPad     && npm install     # only needed for the CaptainPad steps
```

Headless machines also need `xvfb-run` (browsers launch headed) and should
pass `--viewport 1280x720` to sim renders (see
`.agent/01_skills/00_see_the_world.md`).

---

## Step 1 — Simulation up

```bash
cd simulation
npm start          # prestart kills stale listeners on the sim ports
```

Wait for `Available on: http://127.0.0.1:6969`. Health check:
`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:6969/simulation/` → `200`.

## Step 2 — Engine up, running a pattern

```bash
cd marsin_engine
node engine.js --model test_bench --pattern 01_cylon_sweep
```

- Pattern names = filenames in `marsin_engine/patterns/` (no `.js`).
- **Match the model to the sim scene**: `test_bench` model ↔
  `?scene=test_bench` in the sim; `titanic` ↔ `?scene=titanic`.
- Wait for `Reachable on: http://127.0.0.1:6968`.
- A `configured mic … not found` warning is harmless on machines without
  the show mic.

## Step 3 — Verify engine → sim (sACN)

Capture the sim **with the UI visible** so the sACN IN monitor panel is in
frame:

```bash
cd simulation/agent_tools
xvfb-run -a node agent_render.cjs --current --show-ui --viewport 1280x720
```

Inspect the PNG. PASS = the `📡 SACN IN MONITOR (6971)` panel shows
`STATUS Connected`, a non-zero FPS, a growing `FRAMES` count, and activity
log lines like `398 packets/5s from 'MarsinEngine'`.

> The render tool's `SIM_URL` targets `scene=titanic`. For another scene,
> open the page with puppeteer directly or temporarily pass the scene in the
> URL — and say so in your report.

## Step 4 — Verify the engine *controls* the lights

Two options, strongest first:

1. **Pattern animation**: capture the same camera twice a few seconds apart
   while an animated pattern runs (`--current` twice). PASS = the fixture
   colors/positions visibly differ between the two frames.
2. **Pattern swap**: switch patterns via the engine API or CaptainPad, then
   re-capture. PASS = the look changes accordingly.

Always **visually inspect** both frames — identical frames mean the engine
is not actually driving the rig.

## Step 5 — CaptainPad web build + serve

```bash
cd CaptainPad
npm run web:build      # expo export → dist/  (takes several minutes)
npm run web:serve      # serves dist on :6967
```

`web:build` ends with `Exported: dist` and may print
`Something prevented Expo from exiting, forcefully exiting now.` — that is
normal, the export is complete.

## Step 6 — Screenshot CaptainPad + verify engine connection

No dedicated tool yet — drive puppeteer from `simulation/` (where it
resolves). One-off, no script files in the source tree:

```bash
cd simulation
xvfb-run -a node -e "
const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: false,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox','--disable-setuid-sandbox','--use-angle=swiftshader'] });
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:6967/', { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise(r => setTimeout(r, 12000));   // let the WS connect + data stream in
  await p.screenshot({ path: '../.agent_renders/captainpad_home.png' });
  await b.close();
})();
"
```

Inspect the PNG. PASS = header shows **`● CONNECTED`**, the playlist lists
the engine's actual patterns, and live values (BPM, audio-reactivity bars,
parameter sliders) are populated. Early console warnings about
`ws://127.0.0.1:6968/ws/params … closed before the connection is
established` are transient reconnect noise — trust the rendered UI state.

## Step 7 — Tear down + working-tree hygiene

Kill the three processes (sim, engine, serve) when done.

> **⚠️ Running the engine dirties the working tree.** The engine writes
> runtime state into **tracked** files (`marsin_engine/states/**/*.yaml`)
> and hot-regenerates `marsin_engine/models/*.js`. This is expected smoke
> residue — do **not** commit it, and do **not** silently revert it either
> (`.agent/00_gol/01_git.md`). Report the dirty paths to the operator and
> let them decide.

---

## Verdict template (use in your report)

| # | Link | Evidence |
|---|---|---|
| 1 | Sim up | HTTP 200 on :6969 |
| 2 | Engine up + pattern | `Reachable on :6968` log line |
| 3 | Engine → sim sACN | sACN IN monitor screenshot: Connected, frames growing |
| 4 | Engine controls lights | two frames, visibly different |
| 5 | CaptainPad built + served | `Exported: dist`, :6967 listening |
| 6 | CaptainPad screenshot | PNG visually inspected |
| 7 | CaptainPad ↔ engine | `● CONNECTED` + live data in the PNG |

> **Note (2026-06-12 layout pass):** the sACN monitors now boot **collapsed**.
> For the sACN IN "Connected" screenshot, expand the panel first (click its
> collapse button or double-click the header) — collapsed, only the header
> status dot is visible.
