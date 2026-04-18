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
  // Discover patterns from server
  try {
    const resp = await fetch(`http://localhost:6970/list-patterns`);
    if (resp.ok) {
      const names = await resp.json();
      await Promise.all(names.map(async name => {
        try {
          const r = await fetch(`../marsin_engine/patterns/${name}.js?t=${Date.now()}`);
          if (r.ok) PATTERN_PRESETS[name] = await r.text();
        } catch (e) { console.warn(`[PB] Failed to load ../marsin_engine/patterns/${name}.js`); }
      }));
    }
  } catch (e) {
    console.warn('[PB] list-patterns endpoint not available, trying static list');
    const fallbackNames = ['rainbow', 'breathing', 'sparkle', 'fire', 'plasma', 'wipe'];
    await Promise.all(fallbackNames.map(async name => {
      try {
        const r = await fetch(`../marsin_engine/patterns/${name}.js?t=${Date.now()}`);
        if (r.ok) PATTERN_PRESETS[name] = await r.text();
      } catch (e) { /* skip */ }
    }));
  }
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

function updateParameterUI(ok) {
  if (paramGuiInstance) {
    paramGuiInstance.destroy();
    paramGuiInstance = null;
    if (paramGuiTrackingInterval) {
      clearInterval(paramGuiTrackingInterval);
      paramGuiTrackingInterval = null;
    }
  }
  if (!ok) return;

  const exportsData = patternEngine.getExports();
  if (!exportsData || exportsData.length === 0) return;

  paramGuiInstance = new GUI({ title: '🎛️ Engine Parameters' });
  const dom = paramGuiInstance.domElement;
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
  paramGuiTrackingInterval = setInterval(updatePosition, 50); // fast track for dragging

  const paramState = {};

  exportsData.forEach(exp => {
    if (exp.kind === ExportKind.SLIDER) {
      paramState[exp.name] = 0.5;
      paramGuiInstance.add(paramState, exp.name, 0, 1)
        .onChange(v => patternEngine.setControl(exp.id, v));
    } else if (exp.kind === ExportKind.TOGGLE) {
      paramState[exp.name] = false;
      paramGuiInstance.add(paramState, exp.name)
        .onChange(v => patternEngine.setControl(exp.id, v ? 1 : 0));
    } else if (exp.kind === ExportKind.TRIGGER) {
      paramState[exp.name] = () => {
        patternEngine.setControl(exp.id, 1);
        setTimeout(() => patternEngine.setControl(exp.id, 0), 100);
      };
      paramGuiInstance.add(paramState, exp.name);
    } else if (exp.kind === ExportKind.VAR) {
      paramState[exp.name] = 0;
      paramGuiInstance.add(paramState, exp.name)
        .onChange(v => patternEngine.setControl(exp.id, v));
    } else if (exp.kind === ExportKind.GAUGE) {
      paramState[exp.name] = 0;
      paramGuiInstance.add(paramState, exp.name).disable();
    } else if (exp.kind === ExportKind.HSV || exp.kind === ExportKind.RGB) {
      paramState[exp.name] = '#ff0000';
      paramGuiInstance.addColor(paramState, exp.name)
        .onChange(hex => {
          const rStr = hex.slice(1,3), gStr = hex.slice(3,5), bStr = hex.slice(5,7);
          const r = parseInt(rStr, 16) / 255;
          const g = parseInt(gStr, 16) / 255;
          const b = parseInt(bStr, 16) / 255;
          if (exp.kind === ExportKind.HSV) {
            const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
            let h = 0, s = max === 0 ? 0 : d / max, v = max;
            if (max !== min) {
              if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
              else if (max === g) h = (b - r) / d + 2;
              else h = (r - g) / d + 4;
              h /= 6;
            }
            patternEngine.setControl(exp.id, h, s, v);
          } else {
            patternEngine.setControl(exp.id, r, g, b);
          }
        });
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

  // Show pattern editor only in pixelblaze mode
  if (window.showPatternEditor) window.showPatternEditor(newMode === 'pixelblaze' && isEnabled);

  // Show sACN monitor only in sacn_in mode
  if (window.showSacnMonitor) window.showSacnMonitor(newMode === 'sacn_in' && isEnabled);

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

