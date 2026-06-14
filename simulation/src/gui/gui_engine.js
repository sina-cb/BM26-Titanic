/**
 * gui_engine.js — Control-engine handle for the GUI.
 *
 * All GUI construction (gui_builder.js, pattern_editor.js) imports `GUI`
 * from here instead of a widget library directly. The engine is MarsinGui,
 * the CaptainPad-styled control engine in src/gui/modern_gui/.
 *
 * This indirection began life as the strangler seam for the UI rehaul
 * (lil-gui ⇄ MarsinGui behind a `?ui=` toggle). The toggle and the lil-gui
 * vendor build were removed after the 2026-06-12 cutover soak; the seam is
 * kept so the builders never import the engine implementation by name.
 */

import { MarsinGui } from './modern_gui/marsin_gui.js';

export const GUI = MarsinGui;
