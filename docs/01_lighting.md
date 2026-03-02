# BM26 TITANIC: Lighting Intent & Design Plan

This document serves as the narrative framework and technical blueprint for the illumination of the **TITANIC** installation at Burning Man 2026. The lighting design is not merely for visibility or safety; it is an intrinsic part of the art piece, designed to convey the immense scale of the sculpture, the tragic hubris of its sinking, and the vibrant life that now reclaims it on the open desert playa.

---

## 1. The Narrative Philosophy

The lighting of TITANIC represents the tension between the cold, indifferent reality of the sinking and the warm, interactive energy of the citizens of Black Rock City. 

The original Titanic was a monument to human ego and faith in technology—brightly lit, steaming forward into the dark, ignoring the elements. As it sinks into the dust of the playa, our lighting narrative focuses on dramatic shadows, surreal glows, and fractured geometry. The structure serves as both a tomb of the past and a lively amphitheater for the present. By employing highly directional, saturated light, we highlight the brutal break of the ship's hull while simultaneously creating warm, inviting spaces for participants to gather and explore.

---

## 2. Current Lighting Layout

Our lighting environment is organized into a strict, highly configurable hierarchy, designed to be completely modular and controllable via our overarching scene configuration tools (the YAML configuration engine). 

The layout is divided into three core categories:

### A. The Atmosphere (Global Environment)
The atmosphere anchors the piece in its harsh, beautiful reality.
* **Moonlight (Directional Casting):** A single, powerful, cool-blue directional light (`#8899cc`). This mimics the stark, unyielding moonlight of the deep playa, casting long, dramatic, hard-edged shadows across the wreckage. It reminds the viewer of the cold isolation of the event.
* **Hemisphere Ambient (Playa Bounce):** A subtle fill light that simulates the ambient bounce of the desert floor. It is tuned to a dusty, warm tan/gold (`#c2b280`), illuminating the underside of the structure and preventing pure black shadows, ensuring the wood cladding remains legible at all times.
* **Global Bloom:** A surreal, hazy glow applied globally, giving the entire installation that iconic, dusty "Burning Man halo." It softens the harshest edges and makes the light sources themselves feel almost ethereal.

### B. Tower Floods (The Failing Giants)
* **High-Angle Wash:** The two massive smokestacks of the ship are flanked by high-intensity, wide-angle floodlights. 
* **Global Illumination:** These lights wash down over the entire ground and the tops of the decks. By illuminating the structure from above, they emphasize the massive vertical scale of the ship. They represent the ship's powerful but failing infrastructure—bright, intense, and dramatic.

### C. Par Lights (The Interactive Uplight Array)
* **Theatrical Uplighting:** The ground surrounding the ship is ringed by a dynamic array of highly saturated theatrical Par lights (SpotLights).
* **Accentuating Form:** These lights are tightly focused to graze the exterior wood cladding of the hull. By bouncing vibrant colors (umbers, golds, and deep oranges) off the geometric facets of the wreckage, they artificially enhance the texture and sheer height of the sculpture.
* **Participant Control:** The Par Light array is the heart of the interactive lighting experience. The array is fully dynamic—fixtures can be translated, rotated to aim at specific architectural focal points, and scaled to adjust their beam angles. Participants will eventually be able to drive these colors and intensities in real-time, bringing the dead ship to life with vibrant, pulsing energy.

---

## 3. Configuration & Tuning

The entire lighting layout—from the exact angle of the moonlight to the position and cone angle of every individual par light—is driven by a flexible `yaml` configuration infrastructure.

This guarantees that as the piece evolves from concept to reality, the lighting design can be quickly saved to file, reloaded, and iterated upon directly on-site when the art car crew and lighting designers begin focusing the real-world fixtures.
