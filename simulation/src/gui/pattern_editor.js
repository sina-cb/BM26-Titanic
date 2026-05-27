/**
 * pattern_editor.js — Pixelblaze pattern engine + editor panel wiring.
 */
import {
  params,
  setEngineReady, setEngineEnabled,
  setLightingEnabled, setLightingMode,
  lightingMode, lightingEnabled,
} from "../core/state.js";
import { MarsinEngine } from "../core/marsin_engine.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";

// ─── Engine Instance ────────────────────────────────────────────────────
const patternEngine = new MarsinEngine();
let engineReady = false;
let engineEnabled = false;

// Pattern preset names → loaded from patterns/ directory
const PATTERN_PRESETS = {};
let selectedPattern = null;

function titleCase(name) {
  return name.replace(/[_-]/g, ' ').replace(/(^|\s)\S/g, c => c.toUpperCase());
}

function renderPresetButtons() {
  const container = document.getElementById('pe-preset-buttons');
  if (!container) return;
  container.innerHTML = '';
  for (const name of Object.keys(PATTERN_PRESETS).sort()) {
    const btn = document.createElement('button');
    btn.dataset.pattern = name;
    btn.textContent = titleCase(name);
    if (name === selectedPattern) btn.classList.add('active');
    container.appendChild(btn);
  }
}

export async function loadPatternPresets() {
  // Single source of truth: the static manifest committed alongside the patterns.
  // Same path in dev and prod (no localhost fallback, no hardcoded preset list) —
  // see .agent/00_gol/00_codex.md P0. The dev save-server regenerates this file
  // after any pattern save / delete so the list stays live during development.
  const manifestUrl = `../marsin_engine/patterns/manifest.json?t=${Date.now()}`;
  const resp = await fetch(manifestUrl);
  if (!resp.ok) {
    console.error(`[PB] Failed to load patterns manifest at ${manifestUrl}: HTTP ${resp.status}`);
    renderPresetButtons();
    return;
  }
  const names = await resp.json();
  await Promise.all(names.map(async name => {
    const url = `../marsin_engine/patterns/${name}.js?t=${Date.now()}`;
    const r = await fetch(url);
    if (r.ok) {
      PATTERN_PRESETS[name] = await r.text();
    } else {
      console.error(`[PB] Failed to load pattern source ${url}: HTTP ${r.status}`);
    }
  }));
  // Set default in editor
  const textarea = document.getElementById('pe-code');
  if (textarea && !textarea.value && PATTERN_PRESETS.rainbow) {
    textarea.value = PATTERN_PRESETS.rainbow;
    selectedPattern = 'rainbow';
  }
  renderPresetButtons();
  console.log(`[PB] Loaded ${Object.keys(PATTERN_PRESETS).length} preset patterns`);
}

export async function initPatternEngine() {
  try {
    await patternEngine.init('../marsin_pb/wasm');
    if (patternEngine.ready) {
      engineReady = true;
      setEngineReady(true);
      console.log('[PB] Pattern engine ready');
      compileEditorCode();
    }
  } catch (err) {
    console.warn('[PB] Pattern engine not available:', err.message);
  }

}

const ExportKind = {
  SLIDER: 1,
  TOGGLE: 2,
  TRIGGER: 3,
  VAR: 4,
  GAUGE: 5,
  HSV: 6,
  RGB: 7,
};

let paramGuiInstance = null;
let paramGuiTrackingInterval = null;
let localFolder = null;

// CPC default values — used when engine is offline
const CPC_DEFAULTS = {
  speed: 0.5,
  direction: 1.0,
  count: 0.5,
  size: 0.5,
  rotate: 0.0,
  colorPalette1: { h: 0.0, s: 1.0, v: 1.0 },
  colorPalette2: { h: 0.5, s: 1.0, v: 1.0 },
};
const CPC_KEYS = new Set(Object.keys(CPC_DEFAULTS));

// Live binding: maps CPC key → { id, kind } for current pattern
let globalExportMap = {};
// ─── Hue Slider Color System ──────────────────────────────────────────────
//
// ARCHITECTURE:
//   The hue slider maps a 0-1 float to a color. There are two independent
//   concerns that must stay in sync:
//
//   1. GRADIENT (visual) — the CSS background on the slider track that shows
//      the user a rainbow preview of what each position means.
//
//   2. DATA PATH (functional) — the actual value sent to the pattern engine
//      when the user drags the slider. This goes through setControl().
//
// HOW IT WORKS:
//   All CPC color params (colorPalette1, colorPalette2) are typed as 'hsv'
//   in the ParamCenter registry. The Pixelblaze WASM engine's built-in
//   hsv(h, s, v) function uses standard HSV-to-RGB conversion — the same
//   algorithm used by CSS hsl(). Therefore:
//
//   • The slider gradient uses native CSS hsl() stops, which produces the
//     standard color wheel: Red → Yellow → Green → Cyan → Blue → Magenta → Red.
//
//   • HSV exports (ExportKind.HSV): we send raw (h, s, v) to setControl().
//     The WASM engine's hsv() converts internally.
//
//   • RGB exports (ExportKind.RGB): we convert h → RGB ourselves using
//     hsvToRgb() before sending, since the pattern expects raw (r, g, b).
//
// IMPORTANT — KNOWN LIMITATION:
//   Some patterns (e.g., 08_ocean_liner.js) use manual wave()-based color
//   conversion internally:
//     r = wave(hue); g = wave(hue + 0.333); b = wave(hue + 0.666);
//   where wave() is a sine function. This produces a DIFFERENT color wheel
//   than standard HSV. For these patterns, the slider gradient won't be an
//   exact visual match — the hue value IS passed correctly, but the pattern
//   interprets it through its own color math. The slider shows the HSV
//   interpretation, while the pattern renders the wave() interpretation.
//   This is acceptable because:
//     a) The CPC schema defines these params as 'hsv' type
//     b) The iPad CaptainPad uses the same standard HSV representation
//     c) A single slider can't represent two different color wheels
//
// ──────────────────────────────────────────────────────────────────────────

// Standard HSV to RGB conversion (h, s, v all 0-1)
function hsvToRgb(h, s, v) {
  h = h - Math.floor(h); // wrap
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return { r, g, b };
}

// Style a slider as a hue rainbow picker using the standard HSV color wheel
function styleAsHueSlider(controller) {
  if (!controller || !controller.domElement) return;
  const slider = controller.domElement.querySelector('.slider');
  const fill = controller.domElement.querySelector('.fill');
  if (slider) {
    // Standard HSV hue wheel: 0=Red, 0.17=Yellow, 0.33=Green, 0.5=Cyan, 0.67=Blue, 0.83=Magenta
    slider.style.background = 'linear-gradient(to right, ' +
      'hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), ' +
      'hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))';
    slider.style.borderRadius = '3px';
  }
  if (fill) {
    fill.style.backgroundColor = 'transparent';
    fill.style.borderRight = '2px solid white';
    fill.style.boxShadow = '1px 0 3px rgba(0,0,0,0.6)';
  }
}

// Post global parameter updates to the engine API
function postGlobal(key, value) {
  fetch(`http://${window.location.hostname}:6968/param-center`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: value })
  }).catch(() => {});
}

// Push a CPC global value into the local pattern engine (if export exists).
// CPC color params are always type 'hsv' in the ParamCenter registry,
// so we always send raw (h, s, v) — regardless of what ExportKind the
// Pixelblaze compiler assigned (it may classify `colorPalette1(h,s,v)`
// as a generic function rather than ExportKind.HSV because it lacks
// the `hsvPicker` prefix).
function pushGlobalToPattern(key, value) {
  const mapping = globalExportMap[key];
  if (!mapping) return;
  if (typeof value === 'object' && value !== null && 'h' in value) {
    // Always send as HSV — the pattern function expects (h, s, v) args
    patternEngine.setControl(mapping.id, value.h, value.s ?? 1, value.v ?? 1);
  } else if (typeof value === 'number') {
    patternEngine.setControl(mapping.id, value);
  }
}

// ─── Persistent Global Params GUI ─────────────────────────────────────────
// Created once when pixelblaze mode activates. Never destroyed between
// pattern switches — only destroyed when leaving pixelblaze mode.

async function ensureGlobalParamsGui() {
  // Already exists — don't recreate
  if (paramGuiInstance) return;

  let globalParams = {};
  try {
    const res = await fetch(`http://${window.location.hostname}:6968/param-center`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.params) {
        for (const k in data.params) {
          globalParams[k] = data.params[k].value;
        }
      }
    }
  } catch (err) {
    console.warn("[CPC] Engine offline — using default global params");
  }
  for (const k in CPC_DEFAULTS) {
    if (!(k in globalParams)) globalParams[k] = CPC_DEFAULTS[k];
  }

  paramGuiInstance = new GUI({ title: '🎛️ Engine Parameters' });
  const dom = paramGuiInstance.domElement;
  dom.id = 'engine-params-panel';
  dom.style.position = 'fixed';
  dom.style.zIndex = '9999';

  const editorPanel = document.getElementById('pattern-editor-panel');
  function updatePosition() {
    if (!editorPanel) return;
    const isHidden = editorPanel.classList.contains('hidden') || editorPanel.style.display === 'none';
    if (isHidden) {
      dom.style.display = 'none';
    } else {
      dom.style.display = 'block';
      const rect = editorPanel.getBoundingClientRect();
      dom.style.top = rect.top + 'px';
      dom.style.left = (rect.right + 10) + 'px';
    }
  }
  updatePosition();
  paramGuiTrackingInterval = setInterval(updatePosition, 50);

  const globalFolder = paramGuiInstance.addFolder('🌐 Global Parameters');
  const paramState = {};
  // Store paramState on the GUI so we can read current values later
  paramGuiInstance._globalParamState = paramState;

  const globalKeys = Object.keys(globalParams);
  globalKeys.forEach(key => {
    const val = globalParams[key];
    if (typeof val === 'number') {
      paramState[key] = val;
      globalFolder.add(paramState, key, 0, 1)
        .onChange(v => {
          postGlobal(key, v);
          pushGlobalToPattern(key, v);
        });
    } else if (typeof val === 'object' && val !== null && 'h' in val) {
      paramState[key] = val.h;
      const ctrl = globalFolder.add(paramState, key, 0, 1).name(key + ' (Hue)');
      ctrl.onChange(h => {
        const s = val.s !== undefined ? val.s : 1;
        const v = val.v !== undefined ? val.v : 1;
        postGlobal(key, { h, s, v });
        pushGlobalToPattern(key, { h, s, v });
      });
      styleAsHueSlider(ctrl);
    }
  });
}

function destroyParamGui() {
  if (paramGuiInstance) {
    paramGuiInstance.destroy();
    paramGuiInstance = null;
    localFolder = null;
    if (paramGuiTrackingInterval) {
      clearInterval(paramGuiTrackingInterval);
      paramGuiTrackingInterval = null;
    }
  }
  globalExportMap = {};
}

// ─── Local Pattern Parameters (rebuilt on each compile) ───────────────────
async function updateParameterUI(ok) {
  // Ensure the persistent global GUI exists
  await ensureGlobalParamsGui();

  // Destroy previous local folder (but keep the global folder!)
  if (localFolder) {
    try { localFolder.destroy(); } catch (e) {}
    localFolder = null;
  }

  // Clear previous export mappings
  globalExportMap = {};

  if (!ok) return;

  const exportsData = patternEngine.getExports();
  if (!exportsData || exportsData.length === 0) return;

  // Build global→pattern export binding map
  for (const exp of exportsData) {
    if (CPC_KEYS.has(exp.name)) {
      globalExportMap[exp.name] = { id: exp.id, kind: exp.kind };
    }
  }

  // Apply current global values to the pattern immediately
  if (paramGuiInstance && paramGuiInstance._globalParamState) {
    const ps = paramGuiInstance._globalParamState;
    for (const key in globalExportMap) {
      const val = CPC_DEFAULTS[key];
      if (typeof val === 'object' && 'h' in val) {
        // Use the current slider hue value
        const h = ps[key] !== undefined ? ps[key] : val.h;
        pushGlobalToPattern(key, { h, s: val.s ?? 1, v: val.v ?? 1 });
      } else {
        const v = ps[key] !== undefined ? ps[key] : val;
        pushGlobalToPattern(key, v);
      }
    }
  }

  // Build local params folder — skip any exports matching CPC keys
  const localExports = exportsData.filter(exp => !CPC_KEYS.has(exp.name));
  if (localExports.length === 0) return;

  localFolder = paramGuiInstance.addFolder('Pattern Parameters');
  const paramState = {};

  localExports.forEach(exp => {
    if (exp.kind === ExportKind.SLIDER) {
      paramState[exp.name] = 0.5;
      localFolder.add(paramState, exp.name, 0, 1)
        .onChange(v => patternEngine.setControl(exp.id, v));
    } else if (exp.kind === ExportKind.TOGGLE) {
      paramState[exp.name] = false;
      localFolder.add(paramState, exp.name)
        .onChange(v => patternEngine.setControl(exp.id, v ? 1 : 0));
    } else if (exp.kind === ExportKind.TRIGGER) {
      paramState[exp.name] = () => {
        patternEngine.setControl(exp.id, 1);
        setTimeout(() => patternEngine.setControl(exp.id, 0), 100);
      };
      localFolder.add(paramState, exp.name);
    } else if (exp.kind === ExportKind.VAR) {
      paramState[exp.name] = 0;
      localFolder.add(paramState, exp.name)
        .onChange(v => patternEngine.setControl(exp.id, v));
    } else if (exp.kind === ExportKind.GAUGE) {
      paramState[exp.name] = 0;
      localFolder.add(paramState, exp.name).disable();
    } else if (exp.kind === ExportKind.HSV || exp.kind === ExportKind.RGB) {
      paramState[exp.name] = 0;
      const ctrl = localFolder.add(paramState, exp.name, 0, 1).name(exp.name + ' (Hue)');
      ctrl.onChange(h => {
        if (exp.kind === ExportKind.HSV) {
          patternEngine.setControl(exp.id, h, 1, 1);
        } else {
          const rgb = hsvToRgb(h, 1, 1);
          patternEngine.setControl(exp.id, rgb.r, rgb.g, rgb.b);
        }
      });
      styleAsHueSlider(ctrl);
    }
  });
}

function compileEditorCode() {
  const textarea = document.getElementById('pe-code');
  const statusEl = document.getElementById('pe-status');
  if (!textarea || !statusEl) return;
  const code = textarea.value;
  if (!engineReady) {
    statusEl.className = 'pe-status error';
    statusEl.innerHTML = '<span class="pe-status-icon">✗</span> Engine not loaded';
    return;
  }
  const ok = patternEngine.compile(code);
  if (ok) {
    statusEl.className = 'pe-status ok';
    statusEl.innerHTML = '<span class="pe-status-icon">✓</span> Compiled OK';
  } else {
    const errMsg = patternEngine.getError();
    statusEl.className = 'pe-status error';
    statusEl.innerHTML = '<span class="pe-status-icon">✗</span> ' + errMsg;
  }
  updateParameterUI(ok);
}

export function setupPatternEditor() {
  const panel = document.getElementById('pattern-editor-panel');
  const header = document.getElementById('pe-drag-handle');
  const textarea = document.getElementById('pe-code');
  const compileBtn = document.getElementById('pe-compile-btn');
  const collapseBtn = document.getElementById('pe-collapse-btn');
  const saveBtn = document.getElementById('pe-save-btn');
  const addBtn = document.getElementById('pe-add-pattern');
  const delBtn = document.getElementById('pe-del-pattern');
  const presetsEl = document.getElementById('pe-presets');
  if (!panel || !textarea) return;

  // Compile button
  compileBtn.addEventListener('click', compileEditorCode);

  // Auto-run: debounced compile on input
  const autoRunCheckbox = document.getElementById('pe-autorun');
  let autoRunTimer = null;
  textarea.addEventListener('input', () => {
    if (autoRunCheckbox && autoRunCheckbox.checked) {
      clearTimeout(autoRunTimer);
      autoRunTimer = setTimeout(compileEditorCode, 300);
    }
  });

  // Ctrl+Enter to compile, Tab inserts spaces
  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      compileEditorCode();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = textarea.selectionStart;
      const en = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, s) + '  ' + textarea.value.substring(en);
      textarea.selectionStart = textarea.selectionEnd = s + 2;
    }
  });

  // Preset buttons (click to load)
  presetsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pattern]');
    if (!btn) return;
    const key = btn.dataset.pattern;
    if (PATTERN_PRESETS[key]) {
      textarea.value = PATTERN_PRESETS[key];
      selectedPattern = key;
      renderPresetButtons();
      compileEditorCode();
    }
  });

  // Save: write editor code back to the selected pattern file
  saveBtn.addEventListener('click', async () => {
    const code = textarea.value;
    if (!selectedPattern) {
      const name = prompt('Pattern name (lowercase, e.g. "my_pattern"):');
      if (!name) return;
      selectedPattern = name.toLowerCase().replace(/\s+/g, '_');
    }
    try {
      const resp = await fetch('http://localhost:6970/save-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selectedPattern, code }),
      });
      if (resp.ok) {
        PATTERN_PRESETS[selectedPattern] = code;
        renderPresetButtons();
        const statusEl = document.getElementById('pe-status');
        if (statusEl) {
          statusEl.className = 'pe-status ok';
          statusEl.innerHTML = '<span class="pe-status-icon">💾</span> Saved: ' + selectedPattern + '.js';
        }
      }
    } catch (e) {
      console.error('[PB] Save failed:', e);
    }
  });

  // Add: create a new pattern
  addBtn.addEventListener('click', async () => {
    const name = prompt('New pattern name (lowercase, e.g. "strobe"):');
    if (!name) return;
    const key = name.toLowerCase().replace(/\s+/g, '_');
    const template = '// ' + titleCase(key) + '\nexport function beforeRender(delta) {\n  t1 = time(0.1)\n}\nexport function render(index) {\n  hsv(t1 + index / pixelCount, 1, 1)\n}\n';
    try {
      const resp = await fetch('http://localhost:6970/save-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: key, code: template }),
      });
      if (resp.ok) {
        PATTERN_PRESETS[key] = template;
        selectedPattern = key;
        textarea.value = template;
        renderPresetButtons();
        compileEditorCode();
      }
    } catch (e) {
      console.error('[PB] Add pattern failed:', e);
    }
  });

  // Delete: remove the selected pattern
  delBtn.addEventListener('click', async () => {
    if (!selectedPattern) return;
    if (!confirm(`Delete pattern "${selectedPattern}"?`)) return;
    try {
      const resp = await fetch('http://localhost:6970/delete-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selectedPattern }),
      });
      if (resp.ok) {
        delete PATTERN_PRESETS[selectedPattern];
        selectedPattern = null;
        textarea.value = '';
        renderPresetButtons();
        const statusEl = document.getElementById('pe-status');
        if (statusEl) {
          statusEl.className = 'pe-status ok';
          statusEl.innerHTML = '<span class="pe-status-icon">🗑️</span> Deleted';
        }
      }
    } catch (e) {
      console.error('[PB] Delete failed:', e);
    }
  });

  // ─── Small Screen: Selector-Only Mode ───
  // On phones/tablets, strip the editor down to just a pattern picker.
  // Hide code editor, status, docs, save/run/auto controls, and pattern management toolbar.
  const _isSmallScreen = window.innerWidth <= 768;
  if (_isSmallScreen) {
    panel.classList.add('pe-selector-only');
    // Hide editor-only elements
    const codeWrap = panel.querySelector('.pe-code-wrap');
    const statusBar = panel.querySelector('.pe-status');
    const docsBar = panel.querySelector('.pe-docs');
    const autoLabel = header.querySelector('label');       // Auto checkbox + label
    const saveHeaderBtn = document.getElementById('pe-save-btn');
    const runHeaderBtn = document.getElementById('pe-compile-btn');
    const toolbar = panel.querySelector('.pe-preset-toolbar');

    if (codeWrap) codeWrap.style.display = 'none';
    if (statusBar) statusBar.style.display = 'none';
    if (docsBar) docsBar.style.display = 'none';
    if (autoLabel) autoLabel.style.display = 'none';
    if (saveHeaderBtn) saveHeaderBtn.style.display = 'none';
    if (runHeaderBtn) runHeaderBtn.style.display = 'none';
    if (toolbar) toolbar.style.display = 'none';
  }

  // Collapse / expand
  let isCollapsed = false;
  let _savedHeight = '';
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isCollapsed = !isCollapsed;
    if (isCollapsed) {
      _savedHeight = panel.style.height;
      panel.style.height = '';
    } else if (_savedHeight) {
      panel.style.height = _savedHeight;
    }
    panel.classList.toggle('collapsed', isCollapsed);
    collapseBtn.textContent = isCollapsed ? '□' : '─';
  });
  header.addEventListener('dblclick', () => {
    isCollapsed = !isCollapsed;
    if (isCollapsed) {
      _savedHeight = panel.style.height;
      panel.style.height = '';
    } else if (_savedHeight) {
      panel.style.height = _savedHeight;
    }
    panel.classList.toggle('collapsed', isCollapsed);
    collapseBtn.textContent = isCollapsed ? '□' : '─';
  });

  // Dragging
  let isDragging = false, dragOX = 0, dragOY = 0;
  header.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    const r = panel.getBoundingClientRect();
    dragOX = e.clientX - r.left;
    dragOY = e.clientY - r.top;
    document.body.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOX)) + 'px';
    panel.style.top = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOY)) + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (isDragging) { isDragging = false; document.body.style.cursor = ''; }
  });

  // Show/hide
  window.showPatternEditor = (show) => {
    panel.classList.toggle('hidden', !show);
  };
}

// ─── Lighting Engine State Hook ──────────────────────────────────────────
export function onLightingChange() {
  setLightingEnabled(!!params.lightingEnabled);
  const newMode = params.lightingMode || 'gradient';
  setLightingMode(newMode);

  const isEnabled = !!params.lightingEnabled;

  // Destroy param GUI when leaving pixelblaze mode
  if (!(newMode === 'pixelblaze' && isEnabled)) {
    destroyParamGui();
  }

  // Show pattern editor only in pixelblaze mode
  if (window.showPatternEditor) window.showPatternEditor(newMode === 'pixelblaze' && isEnabled);

  // Show sACN monitors only in sacn_in mode
  if (window.showSacnInMonitor) window.showSacnInMonitor(newMode === 'sacn_in' && isEnabled);
  // (sACN Out monitor remains persistently visible)

  // Pixelblaze engine
  const pbEnabled = newMode === 'pixelblaze' && isEnabled;
  engineEnabled = pbEnabled;
  setEngineEnabled(pbEnabled);

  // sACN input source — enable/disable based on mode
  if (newMode === 'sacn_in' && isEnabled) {
    if (!window._sacnInputLoaded) {
      import('../dmx/sacn_input_source.js').then(({ getSacnInput }) => {
        const sacn = getSacnInput();
        sacn.enable();
        window._sacnInputLoaded = true;
        if (window.sacnLog) window.sacnLog('sACN input enabled', 'source');
      }).catch(err => {
        if (window.sacnLog) window.sacnLog('Failed to load sACN: ' + err.message, 'error');
      });
    } else if (window.sacnInput) {
      window.sacnInput.enable();
      if (window.sacnLog) window.sacnLog('sACN input resumed', 'source');
    }
  } else {
    if (window.sacnInput) {
      window.sacnInput.disable();
      if (window.sacnLog) window.sacnLog('sACN input disabled', 'warn');
    }
  }
}

// Expose on window for cross-module access
window.patternEngine = patternEngine;
window.initPatternEngine = initPatternEngine;
window.setupPatternEditor = setupPatternEditor;
window.onLightingChange = onLightingChange;
window.toggleColorWave = (v) => { setLightingEnabled(v); };

