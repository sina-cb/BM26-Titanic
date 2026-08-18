const assert = require('node:assert/strict');
const test = require('node:test');

const endpoint = require('../../docs/ui/touch_control_endpoint.js');

function panelUrl(engineOrigin = 'http://127.0.0.1:17442', protocol = '2') {
  return 'http://127.0.0.1:18001/docs/ui/touch_control.html'
    + '?captainpad_embed=native'
    + '&captainpad_engine_origin=' + encodeURIComponent(engineOrigin)
    + '&captainpad_live_touch_protocol=' + encodeURIComponent(protocol);
}

test('Live Touch endpoint contract resolves one exact HTTP origin for REST and WS', () => {
  assert.deepEqual(endpoint.resolve(panelUrl()), {
    engineOrigin: 'http://127.0.0.1:17442',
    webSocketOrigin: 'ws://127.0.0.1:17442',
    protocolVersion: 2,
  });
  assert.deepEqual(endpoint.resolve(panelUrl('https://show-host.local:7443')), {
    engineOrigin: 'https://show-host.local:7443',
    webSocketOrigin: 'wss://show-host.local:7443',
    protocolVersion: 2,
  });
});

test('Live Touch endpoint contract refuses missing, duplicate, malformed, or stale declarations', () => {
  const valid = panelUrl();
  const cases = [
    [valid.replace(/&captainpad_engine_origin=[^&]+/, ''), /missing engine origin/],
    [valid + '&captainpad_engine_origin=http%3A%2F%2F127.0.0.1%3A17442', /multiple engine origin/],
    [panelUrl('http://127.0.0.1:17442/api'), /exact canonical origin/],
    [panelUrl('ws://127.0.0.1:17442'), /must use http or https/],
    [panelUrl('http://operator:secret@127.0.0.1:17442'), /must not contain credentials/],
    [valid.replace(/&captainpad_live_touch_protocol=[^&]+/, ''), /missing protocol version/],
    [valid + '&captainpad_live_touch_protocol=2', /multiple protocol version/],
    [panelUrl('http://127.0.0.1:17442', '1'), /protocol mismatch: expected 2, received 1/],
  ];
  for (const [url, expected] of cases) {
    assert.throws(() => endpoint.resolve(url), expected);
  }
});

test('Live Touch protocol status gives actionable missing and mismatch copy', () => {
  assert.deepEqual(endpoint.engineProtocolStatus(2, undefined), {
    compatible: false,
    headline: 'ENGINE UPDATE REQUIRED — restart the engine, then reload Live Touch.',
    diagnostic: 'Live Touch protocol: expected 2; engine did not report a version.',
  });
  assert.deepEqual(endpoint.engineProtocolStatus(2, 1), {
    compatible: false,
    headline: 'LIVE TOUCH VERSION MISMATCH — restart the stack, then reload.',
    diagnostic: 'Live Touch protocol: expected 2; received 1.',
  });
  assert.deepEqual(endpoint.engineProtocolStatus(2, 2), {
    compatible: true,
    headline: '',
    diagnostic: '',
  });
});
