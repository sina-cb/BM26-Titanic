/**
 * op_alert — web-safe operator alert (title + message, no buttons).
 *
 * react-native-web's Alert export is an EMPTY STUB (`class Alert { static
 * alert() {} }` — see node_modules/react-native-web/dist/exports/Alert), so on
 * the CaptainPad WEB build (:6967) every `Alert.alert('Load failed', …)` error
 * surface is a silent no-op: the engine rejects a request with a specific 400
 * (e.g. "secondary cannot equal the primary playlist 'default'"), the panel
 * rolls back its optimistic state, and the operator sees the UI silently snap
 * back with NO message (operator report 2026-07-10: "the 2nd playlist view
 * misbehaves"). Codex P0 — fail loudly, never silently.
 *
 * Native (iPad) keeps the real Alert.alert. Web uses window.alert — blocking
 * and plain, but LOUD, zero-dep, and offline-safe.
 *
 * Scope: ONLY for 2-arg informational alerts. Anything needing button
 * callbacks must use an in-app modal/ConfirmSheet instead — RN-web drops
 * Alert button callbacks entirely (see the LibraryModal comments in
 * components/PlaylistPanel.tsx).
 */
import { Alert, Platform } from 'react-native';

export function opAlert(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}
