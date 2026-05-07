const ENGINE_WS = `ws://${window.location.hostname}:6968`;

let warningEl = null;
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

  const title = document.createElement('div');
  title.className = 'engine-blackout-title';
  title.textContent = 'ENGINE GLOBAL BLACKOUT ENABLED';

  messageEl = document.createElement('div');
  messageEl.className = 'engine-blackout-message';
  messageEl.textContent = 'MarsinEngine output is intentionally black. sACN packets may still look healthy.';

  warningEl.append(title, messageEl);
  document.body.appendChild(warningEl);
  return warningEl;
}

function setWarningVisible(visible) {
  const el = ensureWarningElement();
  el.classList.toggle('hidden', !visible);
  document.body.classList.toggle('engine-blackout-active', visible);
  
  window._sacnBlackoutActivated = visible;
  const btn = document.getElementById('sacn-out-blackout-btn');
  if (btn) {
    if (visible) {
      btn.textContent = "RESUME";
      btn.style.background = "#080";
      btn.style.color = "#fff";
      btn.style.borderColor = "#0f0";
    } else {
      btn.textContent = "BLACKOUT";
      btn.style.background = "rgb(136, 0, 0)";
      btn.style.color = "rgb(255, 255, 255)";
      btn.style.borderColor = "rgb(255, 0, 0)";
    }
  }
}

function connectEngineWebSocket() {
  if (ws) {
    ws.close();
  }

  ws = new WebSocket(ENGINE_WS);

  ws.onopen = () => {
    // Engine automatically sends the mixer state on connection
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'mixer') {
        const blackoutActive = data.blackout === true;
        setWarningVisible(blackoutActive);
        if (blackoutActive && messageEl) {
          messageEl.textContent = 'MarsinEngine output is intentionally black. sACN packets may still look healthy.';
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
