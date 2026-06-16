import { engineWsUrl } from "../core/engine_endpoint.js";

let warningEl = null;
let titleEl = null;
let messageEl = null;
let clearBtn = null;
let readonlyMode = false;
let clearInFlight = false;
let ws = null;

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
  document.body.appendChild(warningEl);
  return warningEl;
}

function setWarningVisible(visible) {
  const el = ensureWarningElement();
  el.classList.toggle('hidden', !visible);
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
          titleEl.textContent = 'ENGINE GLOBAL BLACKOUT ENABLED';
          messageEl.textContent = 'MarsinEngine output is intentionally black. sACN packets may still look healthy.';
        } else if (modelStale) {
          // Stale-model warning reuses the banner element. Blackout takes
          // precedence; this branch only runs when blackout is off, and it
          // deliberately skips setWarningVisible so the sACN blackout
          // button is not repainted into its RESUME state.
          warningEl.classList.remove('hidden');
          titleEl.textContent = 'ENGINE MODEL STALE — RESTART ENGINE';
          messageEl.textContent = data.modelStaleMessage ||
            'Engine refused a model hot reload and is still rendering the old model.';
        }
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
