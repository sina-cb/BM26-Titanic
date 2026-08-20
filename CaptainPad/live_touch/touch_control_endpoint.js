/*
 * Live Touch engine endpoint contract.
 *
 * The panel document is served by the simulation HTTP server while its REST
 * and WebSocket traffic belongs to marsin_engine.  The document therefore
 * cannot infer the engine endpoint from location.hostname/port.  CaptainPad
 * supplies the exact resolved origin and protocol version in the panel URL;
 * this module validates that declaration once and exposes the one transport
 * identity used by the wire.
 */
(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root || !root.location) return;

  root.TouchControlEndpointContract = api;
  try {
    root.TouchControlEndpoint = api.resolve(root.location.href);
  } catch (error) {
    root.TouchControlEndpointError = error;
    var renderError = function () {
      var existing = root.document.getElementById('endpointContractError');
      if (existing) return;
      var banner = root.document.createElement('div');
      banner.id = 'endpointContractError';
      banner.setAttribute('role', 'alert');
      banner.style.cssText = [
        'position:fixed',
        'inset:12px 12px auto 12px',
        'z-index:100000',
        'padding:12px 16px',
        'border:2px solid #ff5f6d',
        'border-radius:10px',
        'background:#2b0c13',
        'color:#fff3f4',
        'font:700 14px/1.4 system-ui,sans-serif',
        'box-shadow:0 8px 28px rgba(0,0,0,.5)',
      ].join(';');
      banner.textContent = 'LIVE TOUCH TRANSPORT REFUSED: ' + error.message
        + '. Reopen Live Touch from CaptainPad after checking its engine address.';
      root.document.body.appendChild(banner);
    };
    if (root.document.body) renderError();
    else root.document.addEventListener('DOMContentLoaded', renderError, { once: true });
    if (root.console && typeof root.console.error === 'function') {
      root.console.error('[LiveTouch] ' + error.message);
    }
  }
})(typeof window === 'object' ? window : null, function () {
  'use strict';

  var ENGINE_ORIGIN_PARAM = 'captainpad_engine_origin';
  var PROTOCOL_PARAM = 'captainpad_live_touch_protocol';
  var PROTOCOL_VERSION = 2;

  function requireSingle(params, name, label) {
    var values = params.getAll(name);
    if (values.length === 0 || values[0].length === 0) {
      throw new Error('panel URL is missing ' + label);
    }
    if (values.length !== 1) {
      throw new Error('panel URL has multiple ' + label + ' values');
    }
    return values[0];
  }

  function requireCanonicalHttpOrigin(value) {
    var parsed;
    try {
      parsed = new URL(value);
    } catch (_) {
      throw new Error('engine origin is not a valid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('engine origin must use http or https');
    }
    if (parsed.username || parsed.password) {
      throw new Error('engine origin must not contain credentials');
    }
    if (value !== parsed.origin) {
      throw new Error('engine origin must be an exact canonical origin without a path, query, or fragment');
    }
    return parsed;
  }

  function resolve(panelUrl) {
    var parsedPanel;
    try {
      parsedPanel = new URL(panelUrl);
    } catch (_) {
      throw new Error('panel URL is not valid');
    }
    var engine = requireCanonicalHttpOrigin(requireSingle(
      parsedPanel.searchParams,
      ENGINE_ORIGIN_PARAM,
      'engine origin',
    ));
    var declaredProtocol = requireSingle(
      parsedPanel.searchParams,
      PROTOCOL_PARAM,
      'protocol version',
    );
    if (declaredProtocol !== String(PROTOCOL_VERSION)) {
      throw new Error('panel protocol mismatch: expected '
        + PROTOCOL_VERSION + ', received ' + declaredProtocol);
    }
    var webSocket = new URL(engine.origin);
    webSocket.protocol = engine.protocol === 'https:' ? 'wss:' : 'ws:';
    return Object.freeze({
      engineOrigin: engine.origin,
      webSocketOrigin: webSocket.origin,
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  function engineProtocolStatus(expected, actual) {
    if (actual === expected) {
      return Object.freeze({ compatible: true, headline: '', diagnostic: '' });
    }
    if (actual === undefined || actual === null) {
      return Object.freeze({
        compatible: false,
        headline: 'ENGINE UPDATE REQUIRED — restart the engine, then reload Live Touch.',
        diagnostic: 'Live Touch protocol: expected ' + expected
          + '; engine did not report a version.',
      });
    }
    return Object.freeze({
      compatible: false,
      headline: 'LIVE TOUCH VERSION MISMATCH — restart the stack, then reload.',
      diagnostic: 'Live Touch protocol: expected ' + expected
        + '; received ' + JSON.stringify(actual) + '.',
    });
  }

  return Object.freeze({
    ENGINE_ORIGIN_PARAM: ENGINE_ORIGIN_PARAM,
    PROTOCOL_PARAM: PROTOCOL_PARAM,
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    engineProtocolStatus: engineProtocolStatus,
    resolve: resolve,
  });
});
