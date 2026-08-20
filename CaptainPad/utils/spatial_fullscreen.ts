// spatial_fullscreen — is the Live Touch spatial performance surface currently
// covering the whole pad?
//
// ── WHY A STORE AND NOT A PROP ────────────────────────────────────────────
//
// The panel's spatial pad asks its host to go fullscreen over a versioned
// bridge message (`touch-control-spatial-fullscreen`). On the WEB build the
// host answers by elevating the iframe's DOM ancestors above the navigation
// rail — a browser trick with no native equivalent. On the iPad the honest
// answer is the layout itself: the rail collapses and the scene's left margin
// goes to zero (report _252, docs/60 §4.5).
//
// That makes it a fact the TAB LAYOUT needs, raised by a SCREEN two levels
// below it. A context provider would work, but it would mean restructuring
// `app/(tabs)/_layout.tsx` around a new wrapper component; this module is the
// same imperative-broker idiom `utils/op_dialog.ts` already uses — pure
// TypeScript with no React imports, so the whole thing is node-testable, and
// the layout reads it through one hook.
//
// ── STYLE ONLY, NEVER A REMOUNT ───────────────────────────────────────────
//
// Everything driven from here is a style or a prop. The Live Touch screen and
// its WebView keep their exact position in the React tree while fullscreen
// toggles, because React Native remounts a native view when it is reparented —
// which would reload the page and discard the live performance surface, its
// deadman lease and its bridge state. That is the native analogue of the web
// rule "elevate ancestors, never reparent the iframe".

let _active = false;
const _listeners = new Set<() => void>();

/** The current state. Stable identity — safe as a `useSyncExternalStore`
 *  snapshot. */
export function spatialFullscreenActive(): boolean {
  return _active;
}

/**
 * Set the state and notify. A no-op when nothing changed, so a screen may call
 * this on every bridge message without churning the tab layout.
 */
export function setSpatialFullscreenActive(active: boolean): void {
  if (_active === active) return;
  _active = active;
  _listeners.forEach((listener) => listener());
}

export function subscribeSpatialFullscreen(listener: () => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

/** Test seam. Never called by the app — the Live Touch screen clears the flag
 *  itself on blur and on unmount. */
export function resetSpatialFullscreen(): void {
  _active = false;
  _listeners.clear();
}
