# Code Review: Marsin Mixer & Simulation Overhaul Branch
Date: May 7, 2026

## Overview
This branch introduces a massive overhaul of the Marsin Engine architecture, transitioning it from a single-pattern executor to a multi-channel transition mixer using the WASM-based VM. It also brings sweeping improvements to the `CaptainPad` remote control app and the `BM26-Titanic` simulation environment, unifying parameter control and pixel-perfect fixture scaling.

### 1. Marsin Engine: Multi-Channel WASM Mixer
The most significant architectural shift lies in `marsin_engine`. The engine has been refactored to support multi-channel rendering with blend modes and scriptable transitions.

**Key Changes:**
*   **WasmHost & PatternMixer (`marsin_engine/lib/wasm_host.js`, `pattern_mixer.js`):** The engine now spins up isolated instances of the WASM VM for different channels (`pattern_channel.js`), allowing patterns to render simultaneously. The `PatternMixer` combines these streams using newly added blend scripts (`blend_add`, `blend_over`, `blend_screen`).
*   **Central Parameter Center (CPC) (`marsin_engine/lib/param_center.js`):** `param_center.js` formally introduces the CPC pattern, taking over from the legacy parameter state. This handles the decoupling of parameters from individual patterns, allowing for rig-wide global adjustments and parameter overrides.
*   **Transitions (`marsin_engine/patterns/transitions/`):** Added a suite of procedural transition scripts (e.g., `trans_wipe_left`, `trans_crossfade`, `trans_iris`) to manage the cross-fading and spatial wiping between channels.
*   **State Management:** Extracted configuration states into cleanly defined YAML files (`deck_state.yaml`, `globals_state.yaml`, `mixer_state.yaml`). This ensures hot-reloadability and easy configuration management via the REST API.

**Review Notes:**
*   *Architecture:* Excellent use of WASM isolation to prevent pattern context pollution during crossfades.
*   *Testing:* The inclusion of `hil_transition_test.mjs` is highly commendable. Verifying the WASM outputs over WebSockets ensures the visual engine behaves exactly as the physical hardware will.

### 2. CaptainPad: Mixer & CPC Interfaces
The mobile remote interface has been drastically upgraded to act as the primary control surface for the new mixer engine.

**Key Changes:**
*   **New Views (`mixer.tsx`, `dimmer_rack.tsx`):** Added dedicated views for the multi-channel mixer, fader controls, and hardware dimmer racks.
*   **CPC Controls (`CPCControls.tsx`, `RigGlobals.tsx`):** Built out the UI for the Central Parameter Center, allowing users to override speed, direction, and color palettes globally.
*   **UI Components:** Added specific UI components for tactical control, including `HorizontalFader`, `MiniFader`, and `PixelStrip` for live DMX previews.

**Review Notes:**
*   *UI/UX:* The separation of Rig Globals and individual Channel controls follows professional lighting desk paradigms (like GrandMA or Avolites). 
*   *Maintainability:* Componentizing the faders and pixel strips will make it much easier to port this UI to other surfaces or add more channels in the future.

### 3. Simulation & Rendering Overhauls
The 3D simulation environment has been optimized for performance and visual accuracy, specifically addressing fixture representation and scale.

**Key Changes:**
*   **InstancedMesh Scaling (`animate.js`, `dmx_fixture_runtime.js`):** The V2 rendering pipeline has been updated to support per-pixel sizing and global scale multipliers (`globalPixelScale`, `globalHaloScale`). This fixes the long-standing issue where pixels were rendered uniformly, occluding their fixture shells.
*   **Model Simplification (`vintage_led_stage_light/model_33.yaml`):** Reduced the vertex/pixel count of complex fixtures like the Vintage LED, significantly optimizing the `generatePixelMap` export step without sacrificing visual fidelity.
*   **Fog & Special Effects (`fog_machine.js`):** Separated global effects from standard pixel mapping, ensuring foggers and hazers receive sACN data even when standard pixel mapping is disabled.
*   **UI Improvements (`pattern_editor.js`, `engine_blackout_warning.js`):** Enhanced the simulation GUI to provide warnings when the engine triggers a blackout, preventing confusion during testing.

**Review Notes:**
*   *Performance:* Shifting pixel rendering to an `InstancedMesh` with dynamic matrix scaling is a major win for framerate, especially with the high pixel density of the Shehds bars.
*   *Usability:* The new global sliders for pixel and halo sizes, coupled with the loosened `minDistance` camera constraints, make the simulation significantly more useful for low-level visual debugging.

## Conclusion
This branch represents a massive leap forward in both rendering capability and architectural maturity. The decoupling of the WASM rendering pipeline into a multi-channel mixer is the foundation needed for complex, live-performance light shows.

**Status: Approved.** The code is modular, well-tested (HIL), and fully integrates across the Engine, Simulation, and Control surface. Ready for merge to `main`.
