---
description: How to render and visually evaluate the 3D lighting simulation
---

# 🌍 See the World — Simulation Rendering Skill

This skill allows agents to **capture screenshots** from the BM26 Titanic 3D lighting simulation and **visually evaluate** the results. Use this whenever you need to see what the simulation looks like — after making lighting changes, adding fixtures, adjusting config, or validating a design.

---

## Prerequisites

- **Node.js** installed
- **Puppeteer** installed as a devDependency in `simulation/` (already in `package.json`)
- **GPU access** preferred; machines without one fall back to SwiftShader software rendering (use `--viewport 1280x720` there)
- **Headless machines** additionally need `xvfb-run` (the browser launches headed)

---

## Setup

### 1. Install Dependencies (one-time)

```bash
cd simulation
npm install
```

### 2. Start the Simulation Servers

The servers must be running before rendering:

```bash
cd simulation
npm start
```

This starts (see `.agent/00_gol/06_run_sim.md`):
- **HTTP server** on port `6969` — serves the Three.js frontend and 3D models
- **Save server** on port `6970` — config persistence
- **sACN bridges** on ports `6971` (in) and `6972` (out)

### 3. Run the Render Script

In a **separate terminal** (servers must stay running):

```bash
cd simulation/agent_tools
node agent_render.cjs
```

> **Headless machines (CI, remote agent containers):** the script launches a
> headed Chromium, so wrap it in a virtual display:
> `xvfb-run -a node agent_render.cjs --viewport 1280x720`

**Output:** one PNG per preset view saved to `.agent_renders/` in the repo root, named `{unix_seconds}_{view}.png`:

| View key | Description |
|---|---|
| `front` | Head-on view of the full structure |
| `side` | Profile/side elevation |
| `aerial` | Bird's eye / top-down overview |
| `dramatic` | Cinematic low-angle perspective |
| `night-walk` | Close-up immersive walkthrough |

### 4. Stop the Servers

When done, terminate the `npm start` process (Ctrl+C or send terminate signal).

---

## Operations

### Quick Reference

All commands run from `simulation/agent_tools/`:

| Command | What It Does |
|---|---|
| `node agent_render.cjs --open` | Open the sim in a live window (no captures) |
| `node agent_render.cjs --current` | Capture the current view without moving the camera |
| `node agent_render.cjs --view front` | Navigate to a specific view and capture |
| `node agent_render.cjs --view <key>` | Works with ANY preset key from `scenes/titanic/cameras.yaml` |
| `node agent_render.cjs` | Capture all preset views (dynamically loaded from YAML) |
| Add `--show-ui` to any | Keep the menus/panels (Pattern Editor, Lighting Controls, view buttons, …) visible in the capture; by default they are hidden |
| Add `--viewport WxH` to any | Override screenshot resolution (default `1920x1080`) |
| Add `--keep-alive` to any | Keep browser window open after captures |

> **⚠️ Agent tip:** The `--view` flag dynamically reads presets from `simulation/scenes/titanic/cameras.yaml`. You can add new camera presets to the YAML file (or save them from the live UI) and render from them immediately — no code changes needed.

> **⚠️ Agent tip:** Run the script from `simulation/agent_tools/` (it resolves `node_modules/` from `simulation/`). Do NOT create temp puppeteer scripts in `/tmp/` or other locations — puppeteer won't resolve. If you need a one-off render, use `node agent_render.cjs --view <key>` instead of writing custom scripts.

> **⚠️ Agent tip (software rendering):** On machines without a real GPU (SwiftShader), use `--viewport 1280x720`. At 1920×1080 the WebGL context can be lost on geometry-heavy close-up views (e.g. `night-walk`), which produces an all-black canvas.

---

### 1. Open Live Window (`--open`)

```bash
node agent_render.cjs --open
```

Opens the simulation in a Puppeteer browser window **without taking any screenshots or changing the camera**. The UI is fully visible and interactive. The window stays open until Ctrl+C.

**Browser reuse:** When `--open` is running, it writes a `.puppeteer-endpoint` lock file. Any subsequent `--current`, `--view`, or default render commands will automatically **connect to the existing browser** instead of launching a new one. After capture, the render command disconnects and restores the UI — the window stays open.

**Use this when:** The user wants to see the simulation live, or you need a persistent window for later screenshots.

> **⚠️ Agent tip:** Before running `--open`, check if one is already running. If it is, the script will warn you. To take screenshots from the running browser, just use `node agent_render.cjs --current` — it will connect automatically.

---

### 2. Capture Current View (`--current`)

```bash
node agent_render.cjs --current
```

Takes a screenshot of whatever the camera is currently showing — **no camera movements**. Saves to `.agent_renders/{unix_seconds}_current.png`.

**Use this when:** You want a snapshot of the default camera angle, or the user has positioned the camera and wants to capture that exact perspective.

> **TIP:** Combine with `--keep-alive` to take the screenshot and keep the window open: `node agent_render.cjs --current --keep-alive`

---

### 3. Capture Specific View (`--view <name>`)

```bash
node agent_render.cjs --view dramatic
```

Navigates to one specific view preset and captures it. Available views: `front`, `side`, `aerial`, `dramatic`, `night-walk`.

**Use this when:** You only need one particular angle, not all five.

---

### 4. Capture All Views (default)

```bash
node agent_render.cjs
```

Cycles through all 5 preset views and captures each one. Takes ~25 seconds total. This is the full render pipeline.

---

### How the Script Works

1. Launches a headed Chromium browser with GPU-enabled WebGL
2. Navigates to `http://localhost:6969/simulation/`
3. Waits for the FBX model to load (loading overlay disappears)
4. Waits 5s for the initial render to settle (shadows, bloom, post-processing)
5. Hides all UI elements (info panel, GUI, FPS counter, view buttons) — skipped when `--show-ui` is passed
6. Depending on mode: captures current view, navigates to one view, or cycles all 5
7. Closes browser (or keeps alive with `--keep-alive`)

### Key Chrome Flags

```javascript
'--ignore-gpu-blocklist',  // Force GPU even if blocklisted
'--enable-gpu',            // Explicitly enable GPU
'--enable-webgl',          // Ensure WebGL is available
'--enable-webgl2',         // Ensure WebGL2 is available
'--enable-unsafe-webgpu',  // Allow WebGPU in Chromium
'--enable-features=Vulkan',// Enable Vulkan backend
'--use-angle=swiftshader', // SwiftShader (CPU-based GL) via ANGLE
```

> **IMPORTANT:** `--use-angle=swiftshader` allows CPU-based rendering via Google's SwiftShader (the older `--use-gl=swiftshader` flag was removed from modern Chrome and silently does nothing). This ensures agent renders succeed on headless machines and CI servers without a real GPU. The tradeoff is that screenshots are **software-rendered** — bloom, tonemapping, and shader behavior may differ slightly from what you see on a real GPU at publish time. This is intentional and acceptable for layout/regression checks, but do not treat SwiftShader output as pixel-accurate to the live show.

### Script Constants

| Constant | Default | Purpose |
|---|---|---|
| `ALL_VIEWS` | All presets from `scenes/titanic/cameras.yaml` | Array of view keys to capture |
| `VIEWPORT` | `1920x1080` (override with `--viewport WxH`) | Screenshot resolution |
| `CAMERA_SETTLE_MS` | `3000` | Wait time after camera animation (ms) |
| `SIM_URL` | `http://127.0.0.1:6969/simulation/?scene=titanic&profile=full&renderer=webgl` | Simulation URL (`renderer=webgl` because the WebGPU backend loses its device under SwiftShader) |
| `OUTPUT_DIR` | `../../.agent_renders` | Output directory (repo root) |

---

## Evaluating Renders

After generating renders, you **MUST** visually inspect them before reporting success. Use the `view_file` tool to load each PNG and check the following criteria.

### Step-by-Step Evaluation Process

#### Step 1: Load Each Render

Read each PNG with your image-capable file viewer (e.g. `view_file` / `Read`):

```
view_file(absolutePath: "<repo>/.agent_renders/{unix_seconds}_front.png")
```

Repeat for all 5 views: `*_front.png`, `*_side.png`, `*_aerial.png`, `*_dramatic.png`, `*_night-walk.png`.

#### Step 2: Check WebGL Rendered Successfully

| ✅ Pass | ❌ Fail |
|---|---|
| 3D geometry visible (structure) | Completely black or white screen |
| Lighting and shadows present | No visible 3D content |
| Stars/moon visible in sky | Only UI elements visible, no canvas |
| Ground plane with light pools | Error text or browser chrome visible |

> If the render is a solid black rectangle with no content, WebGL failed. Check the Chrome flags in `agent_render.cjs`.

#### Step 3: Verify Clean UI

(Skip this step if you passed `--show-ui` on purpose.)

| ✅ Pass | ❌ Fail |
|---|---|
| No Lighting Controls panel visible (right side) | GUI controls panel showing |
| No info panel (bottom-left) | "BM26 TITANIC" info panel visible |
| No Pattern Editor (top-left) | Pattern Editor panel showing |
| No "UNPATCHED — SIM-ONLY MODE" badge | Warning badge visible |
| No view preset buttons (bottom-right) | Front/Side/Aerial buttons visible |

> If UI is showing without `--show-ui`, a panel's element ID may have changed — keep `UI_PANEL_IDS` in `agent_render.cjs` in sync with `index.html` and dynamically created panels (`gui-panel`, `unpatched-warning`).

#### Step 4: Verify Distinct Camera Angles

Each view should show a **clearly different perspective**:

| View | Expected Perspective |
|---|---|
| **Front** | Eye-level, facing the structure head-on. Full scene width visible. |
| **Side** | 90° rotated from front. Structure profile visible. Chimney and hull tilt clearly shown. |
| **Aerial** | High overhead looking down. Structure appears foreshortened. Ground light pools visible from above. |
| **Dramatic** | Low angle, slightly off-center. Moon often visible. More sky than ground. Cinematic composition. |
| **Night Walk** | Very close to ground level between hull sections. Structure fills both sides of frame. Detailed geometry visible (individual blocks, porthole lights). Most immersive view. |

> If two views look identical, the button click may have failed. Check that the `#view-presets` element exists in the DOM.

#### Step 5: Verify Lighting Quality

| Element | What to Look For |
|---|---|
| **Par lights** | Warm amber light pools on the ground beneath the structure |
| **LED strands** | Teal/colored dots along the hull edges |
| **Moonlight** | Soft directional light from above, creating subtle shadows |
| **Bloom** | Soft glow halos around bright light sources |
| **Shadows** | Ground shadows beneath the structure (PCF soft shadows) |
| **Stars** | Tiny white dots in the dark sky |

#### Step 6: Report to User (if via ZeroG)

After evaluation, send renders to the user:

```
zerog_send_image(imagePath: ".agent_renders/front.png", caption: "Front View")
zerog_send_image(imagePath: ".agent_renders/dramatic.png", caption: "Dramatic View")
// ... etc
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `WebGL status: ❌ Failed` | Ensure `--ignore-gpu-blocklist` flag is set. Check GPU drivers. |
| Blank/black image with no 3D content | WebGL failed silently. Add `page.on('console')` logging to debug. |
| UI panels visible in render | Increase settle time before hiding UI, or verify element IDs haven't changed. |
| Script hangs on "Waiting for simulation to finish loading" | The FBX model may be very large. Increase the timeout in `waitForFunction`. |
| `Navigation failed` error | Servers not running. Start with `npm start` first. |
| All views look the same | View preset buttons not found. Check `index.html` for the `data-view` attributes. |
| Port 6969 already in use | Kill the existing process: `npx kill-port 6969` |

---

## Advanced: Remote Debug Mode (Reference)

For future use — if you need to capture a screenshot of the user's **already-open** Chrome browser (e.g., they have a specific scene state you want to capture without resetting), Puppeteer can attach to a running Chrome instance via remote debugging.

### How It Works

1. The user closes Chrome completely
2. The user relaunches Chrome with remote debugging enabled:
   ```bash
   chrome.exe --remote-debugging-port=9222
   ```
3. The user opens the simulation at `http://localhost:6969/simulation/` manually
4. Instead of `puppeteer.launch()`, the script uses `puppeteer.connect()`:
   ```javascript
   const browser = await puppeteer.connect({
     browserURL: 'http://localhost:9222'
   });
   ```
5. The script can then find the simulation tab and take screenshots of exactly what the user sees

### When to Use

- The user has manually positioned the camera and wants a screenshot of that exact angle
- The user has a specific scene configuration open and doesn't want it reset
- You need to inspect or interact with the user's live browser state

> **NOTE:** This mode is not currently implemented in `agent_render.cjs`. If needed in the future, add a `--connect` CLI flag that switches from `puppeteer.launch()` to `puppeteer.connect()` and skips server startup.

---

## File Reference

| File | Purpose |
|---|---|
| `simulation/agent_tools/agent_render.cjs` | Puppeteer render script |
| `simulation/index.html` | UI panels + local import map (vendored, no CDN) |
| `simulation/vendor/` | Vendored browser deps (three.js, js-yaml, chroma-js, Inter font) |
| `simulation/src/gui/view_presets.js` | Camera preset animation (`window.animateCamera`) |
| `simulation/scenes/titanic/cameras.yaml` | Camera presets (keys used by `--view`) |
| `simulation/scenes/titanic/scene_config.yaml` | Scene state (fixtures, lights) |
| `.agent_renders/` | Output directory (gitignored) |
| `.gitignore` | Excludes `.agent_renders/` from git |
