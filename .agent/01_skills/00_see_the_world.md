---
description: How to render and visually evaluate the 3D lighting simulation
---

# 🌍 See the World — Simulation Rendering Skill

This skill allows agents to **capture screenshots** from the BM26 Titanic 3D lighting simulation and **visually evaluate** the results. Use this whenever you need to see what the simulation looks like — after making lighting changes, adding fixtures, adjusting config, or validating a design.

---

## Prerequisites

- **Node.js** installed
- **Puppeteer** installed as a devDependency in `simulation/` (already in `package.json`)
- **GPU access** on the host machine (required for WebGL)

---

## Setup

### 1. Install Dependencies (one-time)

```bash
cd simulation
npm install
```

### 2. Start the Simulation Servers

Both servers must be running before rendering:

```bash
cd simulation
npm start
```

This starts:
- **HTTP server** on port `8080` — serves the Three.js frontend and 3D models
- **Save server** on port `8181` — handles config persistence via `POST /save`

Wait for both `Starting up http-server` and `Save server listening on 8181` to appear.

### 3. Run the Render Script

In a **separate terminal** (servers must stay running):

```bash
cd simulation
node agent_render.js
```

**Output:** 5 PNG files saved to `.agent_renders/` in the repo root:

| File | View | Description |
|---|---|---|
| `front.png` | Front | Head-on view of the full structure |
| `side.png` | Side | Profile/side elevation |
| `aerial.png` | Aerial | Bird's eye / top-down overview |
| `dramatic.png` | Dramatic | Cinematic low-angle perspective |
| `night-walk.png` | Night Walk | Close-up immersive walkthrough |

### 4. Stop the Servers

When done, terminate the `npm start` process (Ctrl+C or send terminate signal).

---

## Operations

### Quick Reference

| Command | What It Does |
|---|---|
| `node agent_render.js --open` | Open the sim in a live window (no captures) |
| `node agent_render.js --current` | Capture the current view without moving the camera |
| `node agent_render.js --view front` | Navigate to a specific view and capture |
| `node agent_render.js --view light_leak` | Works with ANY preset key from `scene_preset_cameras.yaml` |
| `node agent_render.js` | Capture all preset views (dynamically loaded from YAML) |
| Add `--keep-alive` to any | Keep browser window open after captures |

> **⚠️ Agent tip:** The `--view` flag now dynamically reads presets from `scene_preset_cameras.yaml`. You can add new camera presets to the YAML file and render from them immediately — no code changes needed.

> **⚠️ Agent tip:** All puppeteer scripts MUST be run from the `simulation/` directory (where `node_modules/` lives). Do NOT create temp scripts in `/tmp/` or other locations — puppeteer won't resolve. If you need a one-off render, use `node agent_render.js --view <key>` instead of writing custom scripts.

---

### 1. Open Live Window (`--open`)

```bash
node agent_render.js --open
```

Opens the simulation in a Puppeteer browser window **without taking any screenshots or changing the camera**. The UI is fully visible and interactive. The window stays open until Ctrl+C.

**Browser reuse:** When `--open` is running, it writes a `.puppeteer-endpoint` lock file. Any subsequent `--current`, `--view`, or default render commands will automatically **connect to the existing browser** instead of launching a new one. After capture, the render command disconnects and restores the UI — the window stays open.

**Use this when:** The user wants to see the simulation live, or you need a persistent window for later screenshots.

> **⚠️ Agent tip:** Before running `--open`, check if one is already running. If it is, the script will warn you. To take screenshots from the running browser, just use `node agent_render.js --current` — it will connect automatically.

---

### 2. Capture Current View (`--current`)

```bash
node agent_render.js --current
```

Takes a screenshot of whatever the camera is currently showing — **no camera movements**. Saves to `.agent_renders/current_{timestamp}.png`.

**Use this when:** You want a snapshot of the default camera angle, or the user has positioned the camera and wants to capture that exact perspective.

> **TIP:** Combine with `--keep-alive` to take the screenshot and keep the window open: `node agent_render.js --current --keep-alive`

---

### 3. Capture Specific View (`--view <name>`)

```bash
node agent_render.js --view dramatic
```

Navigates to one specific view preset and captures it. Available views: `front`, `side`, `aerial`, `dramatic`, `night-walk`.

**Use this when:** You only need one particular angle, not all five.

---

### 4. Capture All Views (default)

```bash
node agent_render.js
```

Cycles through all 5 preset views and captures each one. Takes ~25 seconds total. This is the full render pipeline.

---

### How the Script Works

1. Launches a headed Chromium browser with GPU-enabled WebGL
2. Navigates to `http://localhost:8080/simulation/`
3. Waits for the FBX model to load (loading overlay disappears)
4. Waits 5s for the initial render to settle (shadows, bloom, post-processing)
5. Hides all UI elements (info panel, GUI, FPS counter, view buttons)
6. Depending on mode: captures current view, navigates to one view, or cycles all 5
7. Closes browser (or keeps alive with `--keep-alive`)

### Key Chrome Flags (Windows GPU)

```javascript
'--ignore-gpu-blocklist',  // Force GPU even if blocklisted
'--enable-gpu',            // Explicitly enable GPU
'--use-gl=angle',          // Use ANGLE GL backend
'--use-angle=d3d11',       // Use Direct3D 11 (Windows)
```

> **IMPORTANT:** These flags are critical. Without `--ignore-gpu-blocklist`, Chrome will disable WebGL and the simulation will fail to render (blank black screen with no 3D content).

### Script Constants

| Constant | Default | Purpose |
|---|---|---|
| `ALL_VIEWS` | All 5 presets | Array of view names to capture |
| `VIEWPORT` | `{ width: 1920, height: 1080 }` | Screenshot resolution |
| `CAMERA_SETTLE_MS` | `3000` | Wait time after camera animation (ms) |
| `SIM_URL` | `http://localhost:8080/simulation/` | Simulation URL |
| `OUTPUT_DIR` | `../.agent_renders` | Output directory |

---

## Evaluating Renders

After generating renders, you **MUST** visually inspect them before reporting success. Use the `view_file` tool to load each PNG and check the following criteria.

### Step-by-Step Evaluation Process

#### Step 1: Load Each Render

```
view_file(absolutePath: "c:\Users\sina_\workspace\BM26-Titanic\.agent_renders\front.png")
```

Repeat for all 5 views: `front.png`, `side.png`, `aerial.png`, `dramatic.png`, `night-walk.png`.

#### Step 2: Check WebGL Rendered Successfully

| ✅ Pass | ❌ Fail |
|---|---|
| 3D geometry visible (structure, icebergs) | Completely black or white screen |
| Lighting and shadows present | No visible 3D content |
| Stars/moon visible in sky | Only UI elements visible, no canvas |
| Ground plane with light pools | Error text or browser chrome visible |

> If the render is a solid black rectangle with no content, WebGL failed. Check the Chrome flags in `agent_render.js`.

#### Step 3: Verify Clean UI

| ✅ Pass | ❌ Fail |
|---|---|
| No lil-gui panel visible (right side) | GUI controls panel showing |
| No info panel (bottom-left) | "BM26 TITANIC" info panel visible |
| No FPS counter (top-left) | FPS number showing |
| No view preset buttons (bottom-right) | Front/Side/Aerial buttons visible |

> If UI is showing, the `page.evaluate` that hides elements may have run before the DOM was ready. Increase the initial settle time.

#### Step 4: Verify Distinct Camera Angles

Each view should show a **clearly different perspective**:

| View | Expected Perspective |
|---|---|
| **Front** | Eye-level, facing the structure head-on. Full scene width visible. Icebergs flanking the structure on both sides. |
| **Side** | 90° rotated from front. Structure profile visible. Chimney and hull tilt clearly shown. |
| **Aerial** | High overhead looking down. Structure appears foreshortened. Ground light pools visible from above. Icebergs appear as flat shapes. |
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
| **Icebergs** | Blue wireframe geometry with dashed LED wiring patterns |

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
| Port 8080 already in use | Kill the existing process: `npx kill-port 8080` |

---

## Advanced: Remote Debug Mode (Reference)

For future use — if you need to capture a screenshot of the user's **already-open** Chrome browser (e.g., they have a specific scene state you want to capture without resetting), Puppeteer can attach to a running Chrome instance via remote debugging.

### How It Works

1. The user closes Chrome completely
2. The user relaunches Chrome with remote debugging enabled:
   ```bash
   chrome.exe --remote-debugging-port=9222
   ```
3. The user opens the simulation at `http://localhost:8080/simulation/` manually
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

> **NOTE:** This mode is not currently implemented in `agent_render.js`. If needed in the future, add a `--connect` CLI flag that switches from `puppeteer.launch()` to `puppeteer.connect()` and skips server startup.

---

## File Reference

| File | Purpose |
|---|---|
| `simulation/agent_render.js` | Puppeteer render script |
| `simulation/index.html` | View preset buttons (line 60-66) |
| `simulation/main.js` | View camera positions (`animateCamera`, line ~3055) |
| `simulation/scene_config.yaml` | Scene state (fixtures, lights, icebergs) |
| `.agent_renders/` | Output directory (gitignored) |
| `.gitignore` | Excludes `.agent_renders/` from git |
