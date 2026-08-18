import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOUCH_HTML = readFileSync(join(HERE, '..', '..', 'docs', 'ui', 'touch_control.html'), 'utf8');
const TOUCH_WIRE = readFileSync(join(HERE, '..', '..', 'docs', 'ui', 'touch_control_wire.js'), 'utf8');
const TOUCH_PIXEL_VIEWS = readFileSync(join(HERE, '..', '..', 'docs', 'ui', 'touch_control_pixel_views.js'), 'utf8');
const NATIVE_SURFACE = readFileSync(join(HERE, 'live_touch_surface.tsx'), 'utf8');
const TOUCH_SCREEN = readFileSync(join(HERE, '..', 'app', '(tabs)', 'touch_control.tsx'), 'utf8');
const CPC = readFileSync(join(HERE, 'CPCControls.tsx'), 'utf8');
const DECK = readFileSync(join(HERE, '..', 'app', '(tabs)', 'index.tsx'), 'utf8');
const MIXER = readFileSync(join(HERE, '..', 'app', '(tabs)', 'mixer.tsx'), 'utf8');

const markup = TOUCH_HTML.match(/<body[\s\S]*?<script>/)?.[0] ?? '';

describe('Live Touch professional workspace contract', () => {
  it('removes local utility, tempo, and per-panel chrome from the shipped markup', () => {
    expect(markup).not.toBe('');
    for (const id of [
      'settingsBtn',
      'reloadPanel',
      'helpToggle',
      'statusBtn',
      'bpmSync',
      'bpmVal',
      'bpmMinus',
      'bpmPlus',
      'patternCaps',
      'panelRail',
    ]) {
      expect(markup).not.toMatch(new RegExp(`id=["']${id}["']`));
    }
    expect(markup).not.toMatch(/\sdata-lock(?:=|\s|>)/);
    expect(markup).not.toMatch(/\sdata-collapse(?:=|\s|>)/);
    expect(markup).not.toContain('data-caps');
    expect(TOUCH_WIRE).not.toContain('dataset.caps');
  });

  it('keeps ARM and the pattern chooser, then puts workspace visibility above the mounted panels', () => {
    expect(markup).toMatch(/id="arm"[^>]*role="switch"/);
    expect(markup).toMatch(/id="patternSel"/);
    expect(markup).toMatch(/<nav class="workspace-bar"/);
    expect(markup.indexOf('id="workspaceBar"')).toBeLessThan(markup.indexOf('<div class="workspace"'));
    expect(TOUCH_HTML).toContain("var LAYOUT_KEY = 'bm26_touch_layout_v2'");
    expect(TOUCH_HTML).toContain("chip.className = 'workspace-chip '");
    expect(TOUCH_HTML).toContain("var isFloor = open && !isBar && openCount() === MIN_OPEN");
  });

  it('renders effect actions as real stateful buttons with a separate edit hatch', () => {
    expect(markup).toMatch(/id="fxEditToggle"[^>]*>EDIT<\/button>/);
    expect(TOUCH_HTML).toMatch(/<button type="button" class="fx-face"[^>]*aria-pressed="false"/);
    expect(TOUCH_HTML).toContain("fxEditToggle.textContent = editing ? 'DONE' : 'EDIT'");
    expect(TOUCH_HTML).toContain("face.setAttribute('aria-pressed', String(on))");
  });

  it('makes native pixel verification fresh, retryable, and awaited by ARM', () => {
    expect(TOUCH_HTML).toMatch(/touch_control_pixel_views\.js\?v=' \+ Date\.now\(\)/);
    expect(NATIVE_SURFACE).toContain('cacheEnabled={false}');
    expect(NATIVE_SURFACE).toContain('cacheMode="LOAD_NO_CACHE"');
    expect(NATIVE_SURFACE).toContain('nativePanelDocumentUrl(url, `${mountToken}-${reloadToken}`)');
    expect(TOUCH_PIXEL_VIEWS).toContain("readyStatus: 'idle'");
    expect(TOUCH_PIXEL_VIEWS).toContain("state.readyStatus === 'rejected'");
    expect(TOUCH_WIRE).toContain('return verifyPixelViewArmReadiness();');
    expect(TOUCH_WIRE).toContain('if (chartDriftInFlight) return chartDriftInFlight;');
  });

  it('does not announce a slow or remounted native document before its bridge is ready', () => {
    expect(NATIVE_SURFACE).toContain("message.type === 'touch-control-pixel-verifier-ready'");
    expect(NATIVE_SURFACE).toContain('pendingReadyMessageRef.current = message;');
    expect(NATIVE_SURFACE).toMatch(
      /onLoadStart=\{\(\) => \{[\s\S]*?panelReadyRef\.current = false;[\s\S]*?documentLoadedRef\.current = false;[\s\S]*?pendingReadyMessageRef\.current = null;/,
    );
    expect(NATIVE_SURFACE).toMatch(
      /onLoadEnd=\{\(\) => \{[\s\S]*?documentLoadedRef\.current = true;[\s\S]*?if \(!pendingReady\) return;[\s\S]*?panelReadyRef\.current = true;[\s\S]*?callbacksRef\.current\.onReady\(\);[\s\S]*?callbacksRef\.current\.onMessage\(pendingReady\);/,
    );
    const nativeReadyAt = NATIVE_SURFACE.indexOf('panelReadyRef.current = true;');
    expect(nativeReadyAt).toBeGreaterThan(-1);
    expect(nativeReadyAt).toBeLessThan(NATIVE_SURFACE.indexOf('ready();', nativeReadyAt));
  });

  it('handshakes and surfaces the exact document-scoped native pixel-verification lifecycle', () => {
    expect(TOUCH_WIRE).toContain("type: 'touch-control-pixel-verifier-ready'");
    expect(TOUCH_WIRE).toContain('nativePixelDocumentId');
    expect(TOUCH_WIRE).toContain('setInterval(announceNativePixelVerifierReady, 250)');
    expect(TOUCH_WIRE).toContain("document.addEventListener('captainpad:pixel-verification-start'");
    expect(TOUCH_WIRE).toContain("type: 'touch-control-pixel-verification'");
    expect(TOUCH_WIRE).toContain("publishPixelVerification('checking', null)");
    expect(TOUCH_WIRE).toContain("publishPixelVerification('ready', null)");
    expect(TOUCH_WIRE).toContain("publishPixelVerification('failed', error)");
    expect(TOUCH_SCREEN).toContain("message.type === 'touch-control-pixel-verifier-ready'");
    expect(TOUCH_SCREEN).toContain("type: 'captainpad-pixel-verification-start'");
    expect(TOUCH_SCREEN).toContain('pixelVerificationAcknowledgedRef.current');
    expect(TOUCH_SCREEN).toContain('message.documentId !== verifierDocumentRef.current');
    expect(TOUCH_SCREEN).toContain("message.type === 'touch-control-pixel-verification'");
    expect(TOUCH_SCREEN).toContain('source=${message.staticVerified}');
    expect(TOUCH_SCREEN).toContain('engine=${message.engineVerified}');
    expect(TOUCH_SCREEN).toContain('load=${message.readyStatus}');
    expect(TOUCH_SCREEN).toContain('phase=${message.phase}');
  });
});

describe('shared BPM authority', () => {
  it('leaves all tempo ownership in the shared Deck/Mixer control contract', () => {
    expect(TOUCH_WIRE).not.toContain('/mixer/tempo');
    expect(TOUCH_WIRE).not.toContain('/mixer/tempo/source');
    expect(CPC).toContain('useTempoState');
    expect(CPC).toContain('useTempoTap');
    expect(DECK).toMatch(/<CPCControls\b/);
    expect(MIXER).toMatch(/<CPCControls\b/);
  });
});
