/**
 * gui_engine.js — Control-engine indirection for the UI rehaul.
 *
 * All GUI construction (gui_builder.js, pattern_editor.js) imports `GUI`
 * from here instead of lil-gui directly. Legacy mode re-exports lil-gui
 * unchanged; modern mode substitutes MarsinGui, the lil-gui-API-compatible
 * engine that renders CaptainPad-styled widgets (src/gui/modern_gui/).
 *
 * Because the builders run UNCHANGED against either engine, control-level
 * functional parity is structural, and the schema oracle
 * (control_schema.js) can diff the two trees to prove it.
 */

import { GUI as LilGui } from 'three/addons/libs/lil-gui.module.min.js';

import { IS_MODERN_UI } from './ui_mode.js';
import { MarsinGui } from './modern_gui/marsin_gui.js';

export const GUI = IS_MODERN_UI ? MarsinGui : LilGui;
