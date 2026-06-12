/**
 * floating_panel.js — Reusable floating window for the modern UI.
 *
 * Reproduces the legacy panel contract exactly so existing CSS, the
 * edit-mode hide selectors, readonly-mode CSS, and agent_render's
 * UI_PANEL_IDS keep working: same panel `id`, same `hidden` / `collapsed`
 * classes, drag via the header (buttons excluded), collapse toggle button
 * (`─` / `□`) and header double-click, CSS `resize: both` from style.css.
 */

import { html } from 'htm/preact';
import { useRef, useCallback, useEffect } from 'preact/hooks';

import { TOP_MIN, clampIntoViewport } from '../panel_layout.js';

/**
 * @param {object} props
 * @param {string} props.id            Panel element id (legacy-compatible).
 * @param {string} props.headerClass   e.g. 'sacn-header', 'pe-header'.
 * @param {string} props.titleClass    e.g. 'sacn-title', 'pe-title'.
 * @param {string} props.title         Header label.
 * @param {boolean} props.hidden       Visibility (signal-driven by caller).
 * @param {boolean} props.collapsed    Collapse state (signal-driven).
 * @param {Function} props.onToggleCollapse
 * @param {*} [props.headerExtra]      Extra header nodes (status dot, …).
 * @param {*} props.children           Panel body.
 */
export function FloatingPanel({
  id, headerClass, titleClass, title,
  hidden, collapsed, onToggleCollapse, headerExtra, children,
}) {
  const panelRef = useRef(null);
  const dragState = useRef(null);

  // Expanding a bottom-anchored panel grows it upward/downward depending
  // on anchoring — either way it must stay on-screen and out of the HUD
  // strip (layout policy, panel_layout.js).
  useEffect(() => {
    if (!collapsed && panelRef.current) clampIntoViewport(panelRef.current);
  }, [collapsed]);

  const onHeaderPointerDown = useCallback((e) => {
    if (e.target.tagName === 'BUTTON') return;
    const panel = panelRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    dragState.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    document.body.style.cursor = 'grabbing';
    e.preventDefault();

    const onMove = (ev) => {
      const s = dragState.current;
      if (!s || !panel) return;
      // Stuck-drag guard: a move with no button held means the mouseup
      // was lost (released outside the window) — end the drag.
      if ((ev.buttons & 1) === 0) {
        onUp();
        return;
      }
      panel.style.left = `${Math.max(0, Math.min(window.innerWidth - 100, ev.clientX - s.dx))}px`;
      panel.style.top = `${Math.max(TOP_MIN, Math.min(window.innerHeight - 50, ev.clientY - s.dy))}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };
    const onUp = () => {
      dragState.current = null;
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const className = `${hidden ? 'hidden' : ''} ${collapsed ? 'collapsed' : ''}`.trim();

  return html`
    <div id=${id} class=${className} ref=${panelRef}>
      <div class=${headerClass}
           onMouseDown=${onHeaderPointerDown}
           onDblClick=${onToggleCollapse}>
        <span class=${titleClass}>${title}</span>
        ${headerExtra}
        <button class="pe-btn" title=${collapsed ? 'Expand' : 'Collapse'}
                onClick=${(e) => { e.stopPropagation(); onToggleCollapse(); }}>
          ${collapsed ? '□' : '─'}
        </button>
      </div>
      ${children}
    </div>
  `;
}
