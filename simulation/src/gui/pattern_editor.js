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
          const r = await fetch(`patterns/${name}.js?t=${Date.now()}`);
          if (r.ok) PATTERN_PRESETS[name] = await r.text();
        } catch (e) { console.warn(`[PB] Failed to load patterns/${name}.js`); }
      }));
    }
  } catch (e) {
    console.warn('[PB] list-patterns endpoint not available, trying static list');
    const fallbackNames = ['rainbow', 'breathing', 'sparkle', 'fire', 'plasma', 'wipe'];
    await Promise.all(fallbackNames.map(async name => {
      try {
        const r = await fetch(`patterns/${name}.js?t=${Date.now()}`);
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
    await patternEngine.init('./lib/marsin-engine');
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

  // Show pattern editor only in pixelblaze mode
  if (window.showPatternEditor) window.showPatternEditor(newMode === 'pixelblaze' && !!params.lightingEnabled);

  // Pixelblaze engine
  const pbEnabled = newMode === 'pixelblaze' && !!params.lightingEnabled;
  engineEnabled = pbEnabled;
  setEngineEnabled(pbEnabled);

  // sACN input source — enable/disable based on mode
  if (newMode === 'sacn_in' && !!params.lightingEnabled) {
    // Lazy-load the sACN input module
    if (!window._sacnInputLoaded) {
      import('../dmx/sacn_input_source.js').then(({ getSacnInput }) => {
        const sacn = getSacnInput();
        sacn.enable();
        window._sacnInputLoaded = true;
        console.log('[Lighting] sACN input source enabled');
      }).catch(err => {
        console.error('[Lighting] Failed to load sACN input:', err);
      });
    } else if (window.sacnInput) {
      window.sacnInput.enable();
    }
  } else {
    // Disable sACN when not in sacn_in mode
    if (window.sacnInput) {
      window.sacnInput.disable();
    }
  }
}

// Expose on window for cross-module access
window.patternEngine = patternEngine;
window.initPatternEngine = initPatternEngine;
window.setupPatternEditor = setupPatternEditor;
window.onLightingChange = onLightingChange;
window.toggleColorWave = (v) => { setLightingEnabled(v); };

