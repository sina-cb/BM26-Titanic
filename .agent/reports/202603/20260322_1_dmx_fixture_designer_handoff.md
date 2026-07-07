# Handoff Report: DMX Fixture Designer & Models
**Date:** 2026-03-22
**Context:** This report documents the successful creation of the new DMX Fixture Designer application, the rigorous geometric calibration of three complex light fixture YAML models, and the resolution of `KeyboardInterrupt` crashes in the Control Podium's CLI tool.

---

## 1. DMX Fixture Designer Architecture
We established a dedicated desktop application at `dmx/designer/` to accurately model physical DMX fixtures before eventually importing them into the primary MarsinLED simulation.

- **Stack:** Vite, React, React Three Fiber (R3F), Zustand, Electron.
- **Workflow:** Launched via `npm run desktop` bridging a background Vite dev server to a native Electron shell.
- **Features Completed:**
  - **Dynamic YAML Parsing:** Loading `.yaml` files instantly rebuilds the fixture in the 3D `<Viewport>`.
  - **Interactive Selection:** Clicking dots highlights them in cyan and selects the corresponding row in the `<PixelList>`, alongside its DMX channel mapping in `<PropertiesPanel>`.
  - **DMX Test Stub:** A visual-only testing suite in `<DmxTestPanel>` that proves pixel type rendering (e.g., mapping "amber" color channels to the physical "warm" pixel definitions).
  - **Camera Presets:** Clickable momentary camera buttons (Front, Top, Side, Iso) for rapid geometric alignment checks.
  - **Dev-Experience Hot Reloading:** Added a `Reload` button tapping natively into Electron's `fs` module to continuously map live text-editor edits from disk straight into the 3D viewport without opening file pickers.

## 2. Fixture Models Calibrated
We drastically refined the visual representation of the three core fixtures based on the verified DMX trace behaviors.

1. **Endyshow 240W Strobe Bar (`model_135.yaml`)**
   - Mapped all 64 pixels into a 4-row layout: Top RGB (16), Middle White (16), Bottom Amber (16), Bottom RGB (16).
   - Used rectangular `[35, 15, 10]` blocks to represent the physical linear segments.
   - Pushed the black box housing to an offset (`[281.25, 0, -60]`) so it correctly acts as a solid backplate without clipping the LEDs.

2. **UKing RGBWAU PAR (`model_10.yaml`)**
   - Configured as a single 10-channel pixel but visually represented by 18 oversized (2cm) dots.
   - Painstakingly arranged the 18 dots into three concentric, perfectly spaced, non-overlapping rings (`r=22`, `r=44`, `r=66`).
   - Fixed the "nested mesh bug" natively in `FixtureShell.jsx` where the cylinder geometry was losing its material and glowing pure white. It is now a proper unlit `#111111` solid backdrop.

3. **Vintage LED Stage Light (`model_33.yaml`)**
   - Configured the 6 vertical heads.
   - Wrote and executed a dedicated Node script (`gen_vintage.js`, now stored alongside the model YAML) to programmatically generate 144 dense dots. Each head features a giant rectangular amber `warm` LED in the center, surrounded by a mathematically perfect 7-cm ring of 24 `rgb` dots.

## 3. Control Podium Fixes
- Addressed sudden terminal traceback dumps in `control_podium/companions/control_center.py`.
- Injected `signal.signal(signal.SIGINT, signal.SIG_DFL)` and wrapped `app.exec()` in a `try/except KeyboardInterrupt` block so hitting `Ctrl+C` in the CLI cleanly shuts the PyQt multi-threaded loops down entirely.

## 4. Pending Tasks / Next Steps
For the next agent or session picking up this workspace:

1. **Main Simulation Integration:** The primary user objective next is to *"incorporate the designs that we have into the main simulation"*. You will need to build the bridge between these new `yaml` definitions and the central `C:\Users\sina_\workspace\BM26-Titanic\simulation\` WebGL codebase.
2. **TransformControls Abstraction:** We briefly experimented with Drei's `<TransformControls>` to allow the user to click and drag pixels natively in the Viewport. However, we abandoned this experiment as the abstraction conflicted with our data-driven dot-mapping arrays. Keep the application strongly focused on declarative YAML rendering rather than acting as an unrestricted graphical CAD tool.
