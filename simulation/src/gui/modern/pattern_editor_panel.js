/**
 * pattern_editor_panel.js — Modern (Preact) shell for the Pattern Editor.
 *
 * "Modern shell, legacy brain": Preact renders the panel chrome and the
 * static inner structure EXACTLY as index.html's static markup, then the
 * untouched legacy module (src/gui/pattern_editor.js) runs against it —
 * setupPatternEditor() attaches every event handler and
 * loadPatternPresets()/compile fill #pe-preset-buttons / #pe-code /
 * #pe-status by direct DOM manipulation.
 *
 * HANDLER-OWNERSHIP DECISION: this shell deliberately does NOT use
 * FloatingPanel and owns NO event handlers. setupPatternEditor() already
 * attaches drag (mousedown on #pe-drag-handle), collapse (#pe-collapse-btn
 * click + header dblclick, with height save/restore FloatingPanel lacks),
 * and all button/textarea listeners. Wrapping in FloatingPanel would
 * double-attach drag and make collapse a self-cancelling double toggle.
 * Rendering the exact legacy tree once and letting legacy drive it is the
 * zero-double-handling option and guarantees functional parity.
 *
 * The component is fully static — no signals, no state, rendered exactly
 * once — so Preact never diffs over the legacy-mutated subtrees
 * (#pe-preset-buttons children, #pe-code value, #pe-status innerHTML,
 * inline left/top/width/height set by drag/resize and main.js's
 * _patternEditor restore block).
 */

import { render } from 'preact';
import { html } from 'htm/preact';

function PatternEditorPanel() {
  return html`
    <div id="pattern-editor-panel" class="hidden">
      <div class="pe-header" id="pe-drag-handle">
        <span class="pe-title">🎆 Pattern Editor</span>
        <label style="display:flex;align-items:center;gap:3px;font-size:0.6rem;color:var(--secondary);cursor:pointer;"><input type="checkbox" id="pe-autorun" style="margin:0;accent-color:var(--primary);" /> Auto</label>
        <button class="pe-btn pe-save" id="pe-save-btn" title="Save current code to pattern file">💾</button>
        <button class="pe-btn pe-run" id="pe-compile-btn" title="Compile & Run (Ctrl+Enter)">▶ Run</button>
        <button class="pe-btn" id="pe-collapse-btn" title="Collapse">─</button>
      </div>
      <div class="pe-presets" id="pe-presets">
        <div class="pe-preset-buttons" id="pe-preset-buttons"></div>
        <div class="pe-preset-toolbar">
          <button class="pe-toolbar-btn" id="pe-add-pattern" title="New pattern">+</button>
          <button class="pe-toolbar-btn pe-danger" id="pe-del-pattern" title="Delete selected pattern">−</button>
        </div>
      </div>
      <div class="pe-code-wrap">
        <textarea class="pe-textarea" id="pe-code" spellcheck="false" autocomplete="off"
                  autocorrect="off" autocapitalize="off"></textarea>
      </div>
      <div class="pe-status ok" id="pe-status">
        <span class="pe-status-icon">✓</span> Ready
      </div>
      <div class="pe-docs">
        <div class="pe-docs-title">Quick Reference</div>
        <code>hsv(h,s,v)</code> <code>rgb(r,g,b)</code> <code>time(interval)</code>${' '}
        <code>wave(v)</code> <code>triangle(v)</code><br />
        <code>sin cos abs min max pow sqrt random perlin</code><br />
        <code>pixelCount</code> · <code>PI</code> · <code>PI2</code> · Trig uses <em>turns</em> not radians
      </div>
    </div>
  `;
}

/**
 * Replace the static #pattern-editor-panel with the Preact-rendered shell.
 * Must run BEFORE setupPatternEditor() (and before main.js's
 * _patternEditor state restore), so the legacy code finds the ids.
 * Mounted once into a host appended to document.body — same stacking
 * context as the static markup (the panel itself is position:fixed).
 */
export function initModernPatternEditorShell() {
  const legacyEl = document.getElementById('pattern-editor-panel');
  if (legacyEl) legacyEl.remove();
  const host = document.createElement('div');
  host.id = 'modern-pattern-editor-host';
  document.body.appendChild(host);
  render(html`<${PatternEditorPanel} />`, host);
}
