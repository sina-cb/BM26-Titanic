# Handoff Report: BM26-Titanic Generator UI & Port-Side Traces
**Date:** 2026-03-04
**Context:** This report documents the completion of the `Generator Focus & Highlighting` initiative, as well as the transition from manual par light placement to procedural array generation for the port (left) side of the Titanic model.

---

## 1. Generators Created & Synchronized
We have successfully shifted the following structural sections from manually defined Par Lights to dynamic, UI-controllable Traces (Generators):

- **Left Front Deck** (Line Generator)
- **Left Front Wall** (Line Generator)
- **Left Chimney** (Circle/Ring Generator)
- **Left Center Auditorium** (Line Generator)
- **Left Back Wall** (Line Generator)

*Note:* Previously, the starboard (right) side was created using UI Generators, but the port (left) side was hardcoded as singular fixture arrays in `scene_config.yaml`. The user has successfully migrated the left-side arrays to the generator pipeline. The user acts as the active "math engine", manually tuning XYZ coordinates in the YAML or the UI to perfectly hug the collision geometry of the ship model.

## 2. Advanced UI Synchronization (Completed!)
The primary feature of this session was linking the 3D WebGL Canvas interaction directly to the DOM-based `lil-gui` state.

- **Bi-Directional Highlighting:** Clicking a 3D generator trace instantly opens its properties folder in the UI, and vice versa. 
- **Auto-Fly Camera:** When `Focus on Select` is checked, selecting any generator animates the `OrbitControls` to frame the object in 3D space perfectly.
- **Active State:** The active trace transitions from a subtle orange (`0xff8800` @ 0.7 opacity) to a glowing solid yellow (`0xffff00` @ 1.0 opacity).

## 3. Critical UI Glitches Resolved (The "Bounce/Lock" Bugs)
During development, we encountered extreme GUI state-locking bugs. The next agent must be aware of these fixes so they do not accidentally revert them:

1. **The Raycaster Invisible Wall Bug:** 
   * *Problem:* `THREE.MeshBasicMaterial({ visible: false })` entirely breaks raycasting for Circle generator hitboxes, making rings un-clickable. 
   * *Fix:* We use `MeshBasicMaterial({ colorWrite: false, depthWrite: false, opacity: 0 })` instead. This renders the material invisible but preserves raycast collisions. We also tagged the structural wireframes and dots with `isTraceVisual` so they are fully clickable.
2. **The "Bounce" Bug (Clicking UI rapidly opens/closes):**
   * *Problem:* When a user explicitly clicked a UI folder title to close it, `lil-gui` naturally toggled it. However, our custom `titleEl.addEventListener('click')` instantly fired a `.open()` command, fighting `lil-gui` and creating an infinite bounce.
   * *Fix:* The UI click handler now uses a "soft-select" (`window.clickTraceFolder`), which assigns the yellow target highlighting and camera flyways but **does not** enforce `.open()`. It trusts the native `lil-gui` state.
3. **The Duplication/Merge Lock Bug:**
   * *Problem:* `lil-gui` caches folders by their string Name. If the user generates two traces both named `Left Center Auditorium Generator`, `lil-gui` attempts to merge them into the exact same folder DOM element, corrupting their internal click listeners and causing the UI to freeze.
   * *Fix:* We implemented a mathematical label padding fix. We append hidden Zero-Width Spaces (`\u200B`) mapped to the trace array `index` uniquely to every label string before passing it to `genFolder.addFolder(label)`. *Do not remove this padding!*

## 4. Pending Tasks / Left to Debug
For the next agent picking up this workspace:

1. **Light Alignment Tuning:** While the generators are functional, you may notice extreme clipping or "Light Leaks" as seen in `_tmp_render_light_leak.js`. The user is actively tuning the angles and positions of the lights. Expect to coordinate Puppeteer scripts to push new mathematical trace vectors.
2. **Puppeteer Resizing Canvas:** In `01_lighting_arrangement.md`, we patched the Puppeteer boilerplate to include `defaultViewport: null`. If you write new automation scripts connecting to `:8080`, ensure you use this. Missing it will cause the headless Chromium instance to abruptly resize the user's live WebGL canvas, breaking their layout.
3. **Diff Tracking:** If the user updates `scene_config.yaml` manually while an agent is thinking, use `node agent_render.js --current` rather than overwriting their changes blindly. Rely on their source-of-truth configuration.
