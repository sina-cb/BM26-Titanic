export const EMBEDDED_SURFACE_BLANK_URL = 'about:blank';

// Navigating the native WebView to an empty document runs its unload path,
// closing the sidecar page's streams before React destroys the native view.
export const EMBEDDED_SURFACE_TEARDOWN_SCRIPT = [
  'window.stop();',
  `window.location.replace('${EMBEDDED_SURFACE_BLANK_URL}');`,
  'true;',
].join('\n');

interface EmbeddedIframe {
  src: string;
  removeAttribute(name: string): void;
}

export function shouldMountEmbeddedSurface(
  focused: boolean,
  url: string | null,
  resolveError: string | null,
): boolean {
  return focused && url !== null && resolveError === null;
}

export function teardownEmbeddedIframe(iframe: EmbeddedIframe): void {
  iframe.src = EMBEDDED_SURFACE_BLANK_URL;
  iframe.removeAttribute('src');
}
