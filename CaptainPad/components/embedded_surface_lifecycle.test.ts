import { describe, expect, it, vi } from 'vitest';

import {
  EMBEDDED_SURFACE_BLANK_URL,
  EMBEDDED_SURFACE_TEARDOWN_SCRIPT,
  shouldMountEmbeddedSurface,
  teardownEmbeddedIframe,
} from './embedded_surface_lifecycle';

describe('embedded service lifecycle', () => {
  it('mounts a surface only while its containing tab is focused', () => {
    expect(shouldMountEmbeddedSurface(true, 'http://show.local:6969', null)).toBe(true);
    expect(shouldMountEmbeddedSurface(false, 'http://show.local:6969', null)).toBe(false);
  });

  it('keeps an unresolved or invalid address from mounting a hidden sidecar', () => {
    expect(shouldMountEmbeddedSurface(true, null, null)).toBe(false);
    expect(shouldMountEmbeddedSurface(true, 'http://show.local:6969', 'invalid base')).toBe(false);
  });

  it('navigates browser and native surfaces to an empty document before teardown', () => {
    const iframe = { src: 'http://show.local:6969', removeAttribute: vi.fn() };
    teardownEmbeddedIframe(iframe);
    expect(iframe.src).toBe(EMBEDDED_SURFACE_BLANK_URL);
    expect(iframe.removeAttribute).toHaveBeenCalledWith('src');
    expect(EMBEDDED_SURFACE_TEARDOWN_SCRIPT).toContain('window.stop()');
    expect(EMBEDDED_SURFACE_TEARDOWN_SCRIPT).toContain("window.location.replace('about:blank')");
  });
});
