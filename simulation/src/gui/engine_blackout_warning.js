import { engineWsUrl } from "../core/engine_endpoint.js";
import { DismissalLatch, createDismissButton } from "./hud_banner.js";

let warningEl = null;
let titleEl = null;
let messageEl = null;
let clearBtn = null;
let readonlyMode = false;
let clearInFlight = false;
let ws = null;

// Which condition the card is voicing: 'blackout' | 'stale' | null. Dismissable
// (✕ or `H` → hide_all) PER condition: hiding the blackout wording does not hide
// a later stale-model wording, and the card re-arms when the engine clears the
// condition. Hiding never touches the engine — RESUME lives in the sACN OUT panel.
let _condition = null;
const _latch = new DismissalLatch();

function ensureWarningElement() {
  if (warningEl) return warningEl;

  warningEl = document.createElement('div');
  warningEl.id = 'engine-blackout-warning';
  warningEl.className = 'hidden';
  warningEl.setAttribute('role', 'alert');
  warningEl.setAttribute('aria-live', 'assertive');

  titleEl = document.createElement('div');
  titleEl.className = 'engine-blackout-title';
  titleEl.textContent = 'ENGINE GLOBAL BLACKOUT ENABLED';

  messageEl = document.createElement('div');
  messageEl.className = 'engine-blackout-message';
  messageEl.textContent = 'MarsinEngine output is intentionally black. sACN packets may still look healthy.';

  warningEl.append(titleEl, messageEl);
  warningEl.appendChild(createDismissButton(() => {
    _latch.dismiss();
    applyVisibility();
  }, 'Hide this banner — the engine is unchanged (BLACKOUT / RESUME lives in the sACN OUT panel)'));
  document.body.appendChild(warningEl);
  return warningEl;
}

function applyVisibility() {
  const el = ensureWarningElement();
  const visible = _latch.apply({ show: _condition !== null, key: _condition });
  el.classList.toggle('hidden', !visible);
}

function setWarningVisible(visible) {
  ensureWarningElement();
  document.body.classList.toggle('engine-blackout-active', visible);
  
  window._sacnBlackoutActivated = visible;
  // CONTRACT: in modern mode this button is rendered by Preact
  // (modern/sacn_monitor_panel.js) as a fully STATIC subtree — Preact
  // never diffs its label/styles, so these imperative writes are safe.
  // If that button ever becomes dynamic (signal-driven label/style),
  // move the blackout state into the panel's store instead of poking
  // the DOM from here.
  const btn = document.getElementById('sacn-out-blackout-btn');
  if (btn) {
    if (visible) {
      btn.textContent = "RESUME";
      btn.style.background = "var(--tertiary)";
      btn.style.color = "var(--surface-container-lowest)";
      btn.style.borderColor = "var(--tertiary)";
    } else {
      btn.textContent = "BLACKOUT";
      btn.style.background = "var(--error)";
      btn.style.color = "var(--surface-container-lowest)";
      btn.style.borderColor = "var(--error-container-border)";
    }
  }
}

function connectEngineWebSocket() {
  if (ws) {
    ws.close();
  }

  if (window.location.protocol === 'https:') {
    console.warn('[Engine] WebSocket disabled due to HTTPS mixed content restrictions.');
    return;
  }

  try {
    ws = new WebSocket(engineWsUrl());
  } catch (err) {
    console.warn('Failed to construct WebSocket:', err);
    return;
  }

  ws.onopen = () => {
    // Engine automatically sends the mixer state on connection
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'mixer') {
        const blackoutActive = data.blackout === true;
        const modelStale = data.modelStale === true;
        setWarningVisible(blackoutActive);
        if (blackoutActive) {
          _condition = 'blackout';
          titleEl.textContent = 'ENGINE GLOBAL BLACKOUT ENABLED';
          messageEl.textContent = 'MarsinEngine output is intentionally black. sACN packets may still look healthy.';
        } else if (modelStale) {
          // Stale-model warning reuses the banner element. Blackout takes
          // precedence; this branch only runs when blackout is off, and
          // setWarningVisible(false) above keeps the sACN blackout button
          // out of its RESUME state.
          _condition = 'stale';
          titleEl.textContent = 'ENGINE MODEL STALE — RESTART ENGINE';
          messageEl.textContent = data.modelStaleMessage ||
            'Engine refused a model hot reload and is still rendering the old model.';
        } else {
          _condition = null;
        }
        applyVisibility();
      }
    } catch (err) {
      console.warn('Failed to parse engine WS message:', err);
    }
  };

  ws.onclose = () => {
    // Try to reconnect in 2 seconds
    setTimeout(connectEngineWebSocket, 2000);
  };

  ws.onerror = () => {
    // Errors will trigger onclose, which handles reconnect
  };
}


export function setupEngineBlackoutWarning(options = {}) {
  readonlyMode = !!options.readonly;
  ensureWarningElement();
  connectEngineWebSocket();
}
