/**
 * Native Pressable needs an explicit button role for assistive technology.
 * React Native Web turns that role into a literal `<button>`, however, and a
 * playlist row contains independent reorder/remove buttons. Omitting the web
 * role keeps the Pressable as its default focusable `<div>` and prevents
 * invalid nested-button markup without changing row press behaviour.
 */
export function playlistRowAccessibilityRole(
  platform: string,
): 'button' | undefined {
  return platform === 'web' ? undefined : 'button';
}
