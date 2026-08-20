(function installSpatialContactNotice(root) {
  'use strict';

  if (root.SpatialContactNotice !== undefined) {
    throw new Error('window.SpatialContactNotice is already installed');
  }

  var TTL_MS = 3000;
  var MESSAGE = 'SPATIAL contact limit reached; the extra touch was ignored';

  var timer = null;
  var visible = false;
  var lastShownAt = 0;

  function dispatchStatus(message) {
    root.document.dispatchEvent(new root.CustomEvent('panelstatus', {
      detail: {
        message: message,
        role: 'status',
        ttlMs: message ? TTL_MS : 0,
      },
    }));
  }

  function cleanup() {
    if (timer) {
      root.clearTimeout(timer);
      timer = null;
    }
    if (!visible) return;
    visible = false;
    dispatchStatus('');
  }

  function show() {
    var now = Date.now();
    lastShownAt = now;
    visible = true;
    dispatchStatus(MESSAGE);
    if (timer) root.clearTimeout(timer);
    timer = root.setTimeout(function () {
      timer = null;
      if (!visible || Date.now() - lastShownAt < TTL_MS - 1) return;
      visible = false;
      dispatchStatus('');
    }, TTL_MS);
  }

  root.SpatialContactNotice = Object.freeze({
    TTL_MS: TTL_MS,
    MESSAGE: MESSAGE,
    show: show,
    cleanup: cleanup,
    isVisible: function () { return visible; },
    lastShownAt: function () { return lastShownAt; },
  });
})(typeof window !== 'undefined' ? window : globalThis);
