// live_touch_handoff_curtain — the regression guard behind report _261.
//
// THE BUG, on the physical iPad: entering the Live Touch tab showed an opaque,
// touch-swallowing "HANDING BACK TO DECK" panel over the whole pad that never
// went away, so Live Touch could not be used at all.
//
// THE CAUSE, in two halves that only meet on native:
//
//   1. `touch_control.tsx` asks for a Deck release every time the app leaves
//      the foreground (home swipe, auto-lock, app switcher). docs/47 wrote that
//      release for a browser — "while the iframe and WebSocket are still alive"
//      — and in a hidden browser tab both ARE alive, so the panel acknowledges
//      in milliseconds and the curtain drops. iOS suspends the app's JS AND the
//      WebView's on resign, and may reclaim the WebView's content process
//      outright, so the acknowledgement cannot come back until the operator
//      returns — and the pad was curtained the whole time.
//   2. The native transport claimed delivery it could not perform:
//      `injectJavaScript` is fire-and-forget, and a call into a page that has
//      not installed `window.__captainpadDeliver` (never loaded, reloaded, or
//      reclaimed) throws inside the WebView where nobody hears it. The
//      coordinator therefore hung a pending release — and its curtain — on an
//      acknowledgement that could never arrive. The iframe peer answers the
//      same question truthfully for free, via `contentWindow`.
//
// These are source scans rather than component tests on purpose: this repo's
// vitest run is pure-Node (see vitest.config.ts — RN `.tsx` never loads), and
// the invariants below are structural. `no_raw_alerts.test.ts` is the idiom.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const COORDINATOR = join(APP_ROOT, 'components', 'live_touch_coordinator.tsx');
const NATIVE_SURFACE = join(APP_ROOT, 'components', 'live_touch_surface.tsx');
const WEB_SURFACE = join(APP_ROOT, 'components', 'live_touch_surface.web.tsx');

/** Comments describe the rule; only real code may satisfy it. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('Live Touch handoff curtain', () => {
  it('raises the curtain only through the reason-aware decision', () => {
    const source = code(COORDINATOR);

    expect(source).toMatch(/setHandoffTarget\(handoffCurtainTarget\(target,\s*reason\)\)/);
    // The pre-_261 line. A curtain raised straight from the target ignores
    // WHY the release was asked for, which is the entire bug.
    expect(source).not.toMatch(/setHandoffTarget\(target\)/);
    expect(source).toMatch(/handoffCurtainTarget/);
  });

  it('still drops the curtain on acknowledgement, timeout and refusal', () => {
    // Three exits, all unconditional: a release that ends any way at all must
    // never leave the pad covered.
    const source = code(COORDINATOR);
    expect(source.match(/setHandoffTarget\(null\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('names the surface without claiming it is an iframe', () => {
    // The operator reads these words on the iPad, where there is no iframe.
    const source = code(COORDINATOR);
    expect(source).not.toMatch(/iframe/i);
    expect(source).toMatch(/LIVE TOUCH HANDOFF UNAVAILABLE/);
  });
});

describe('Live Touch native transport honesty', () => {
  it('gates every injected delivery on the panel hook existing right now', () => {
    const source = code(NATIVE_SURFACE);

    expect(source).toMatch(/canDeliverToNativePanel\(\s*webView !== null,\s*panelReadyRef\.current\s*\)/);
    // The injection must be downstream of the gate, never before it.
    const gateAt = source.indexOf('canDeliverToNativePanel(');
    const injectAt = source.indexOf('__captainpadDeliver');
    expect(gateAt).toBeGreaterThan(-1);
    expect(injectAt).toBeGreaterThan(gateAt);
  });

  it('raises readiness from either installed-hook signal and clears it on every load start', () => {
    const source = code(NATIVE_SURFACE);

    expect(source).toMatch(/message\.type === 'touch-control-theme-ready'[\s\S]*?message\.type === 'touch-control-pixel-verifier-ready'/);
    expect(source).toMatch(/if \(isPanelReadySignal\) \{[\s\S]*?panelReadyRef\.current = true;[\s\S]*?ready\(\);/);
    // The panel's own RELOAD button, RETRY, and the reload iOS performs after
    // reclaiming a backgrounded WebView all arrive here.
    expect(source).toMatch(
      /onLoadStart=\{\(\)\s*=>\s*\{[\s\S]*?panelReadyRef\.current = false;[\s\S]*?documentLoadedRef\.current = false;[\s\S]*?pendingReadyMessageRef\.current = null;/,
    );
    expect(source).toMatch(/const retry = useCallback\(\(\) => \{\s*panelReadyRef\.current = false;/);
  });

  it('leaves the web iframe transport exactly as it was', () => {
    // Byte-compatibility with the browser build is the standing contract of
    // report _252: the native fix may not touch the iframe's delivery test.
    const source = code(WEB_SURFACE);

    expect(source).toMatch(
      /const targetWindow = iframeRef\.current\?\.contentWindow;\s*if \(!targetWindow \|\| !panelOrigin\) return false;\s*targetWindow\.postMessage\(message, panelOrigin\);\s*return true;/,
    );
    expect(source).not.toMatch(/canDeliverToNativePanel|panelReadyRef/);
  });
});
