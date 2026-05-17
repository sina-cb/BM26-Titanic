// SecretEntrySheet — operator-facing key entry for production builds.
//
// Shown on first launch (or after "Forget key") in production builds
// where the AES-128 PSK was deliberately not baked in. The operator
// types or pastes the camp's shared secret, the app validates it,
// stores it in iOS Keychain via expo-secure-store, and proceeds to
// the scan screen.
//
// UX rules:
//   * `secureTextEntry` so the key never appears as plaintext.
//   * Toggle to reveal — many operators want to verify before saving.
//   * Auto-correct / auto-cap OFF — those mangle hex strings.
//   * Paste-from-clipboard friendly (no character filtering).
//   * Show a fingerprint preview as the operator types, so they can
//     confirm against the rest of the camp before committing.
//
// Logging policy: this component never logs the key, the fingerprint,
// or any error message that includes user input. Even at debug level.

import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  fingerprintFor,
  maskFingerprint,
  parseSecretInput,
  saveRuntimeSecret,
} from "../security/secretStore";
import { useFormFactor, MAX_CONTENT_WIDTH } from "./layout";
import { C, F, R, S } from "./theme";

interface Props {
  /** Called once a key has been validated and persisted. */
  onSecretReady: (bytes: Uint8Array, fingerprint: string) => void;
  /**
   * Optional cancel hook. When supplied (i.e. the sheet was opened
   * from "CHANGE KEY" with an existing key already loaded), a Cancel
   * action appears and dismisses the sheet without touching state.
   * When omitted, this is the first-launch entry and there's no
   * "back" — the operator MUST commit a key to use the app.
   */
  onCancel?: () => void;
  /**
   * Fingerprint of the currently-active key (if any). Surfaces in the
   * "REPLACE CURRENT KEY" header so the operator can confirm what
   * they're about to overwrite. Always shown masked by default — the
   * fingerprint is itself a hash, but it still uniquely identifies a
   * key, which an over-the-shoulder snoop could correlate.
   */
  currentFingerprint?: string;
}

export function SecretEntrySheet({
  onSecretReady,
  onCancel,
  currentFingerprint,
}: Props) {
  const ff = useFormFactor();
  const padding = ff === "compact" ? S.md : S.lg;

  const [input, setInput] = useState("");
  const [reveal, setReveal] = useState(false);
  const [revealCurrent, setRevealCurrent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReplacing = !!currentFingerprint && !!onCancel;

  // Live fingerprint preview — only computed when input parses, so a
  // half-typed hex string doesn't create misleading hashes.
  // Shown only when the operator REVEALs to avoid splashing it on
  // screen for over-the-shoulder snoops.
  const previewFingerprint = useMemo(() => {
    if (!input.trim()) return null;
    const parsed = parseSecretInput(input);
    if (!parsed.ok) return null;
    return fingerprintFor(parsed.bytes);
  }, [input]);

  const onSave = async () => {
    if (busy) return;
    setError(null);
    const parsed = parseSecretInput(input);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    try {
      const { bytes, fingerprint } = await saveRuntimeSecret(parsed.bytes);
      onSecretReady(bytes, fingerprint);
    } catch (err: unknown) {
      // Generic message; never leak the underlying SecureStore error
      // verbatim (could include implementation paths or platform IDs).
      setError(
        "Could not save the key to Keychain. " +
          "Make sure your device has a passcode and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingHorizontal: padding, paddingBottom: padding * 2 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.column,
            {
              maxWidth: MAX_CONTENT_WIDTH,
              alignSelf: "center",
              width: "100%",
            },
          ]}
        >
          <View style={styles.heroBox}>
            <Text style={styles.title}>
              {isReplacing ? "REPLACE KEY" : "SHARED KEY"}
            </Text>
            <Text style={styles.sub}>
              {isReplacing
                ? "Enter a new shared key. The new one will replace " +
                  "the existing one in this device's Keychain — the " +
                  "rig itself is unaffected."
                : "PortWatch (App Store builds) doesn't ship with the " +
                  "camp's secret baked in. Paste the shared key the " +
                  "engine, bridge, and the rest of the rig use, and " +
                  "we'll keep it in this device's Keychain — never on " +
                  "disk in clear, never synced to iCloud."}
            </Text>
            <Text style={styles.subFineprint}>
              Accepts a hex key (32 chars) or any string the rest of
              the camp also uses with `key:` in marsin_engine/secret.yaml.
            </Text>

            {currentFingerprint ? (
              <View style={styles.currentRow}>
                <Text style={styles.currentLabel}>CURRENT</Text>
                <Text style={styles.currentValue}>
                  {revealCurrent
                    ? maskFingerprint(currentFingerprint, "full")
                    : maskFingerprint(currentFingerprint, "tail")}
                </Text>
                <Pressable
                  onPress={() => setRevealCurrent((r) => !r)}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.smallBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={styles.smallBtnText}>
                    {revealCurrent ? "HIDE" : "REVEAL"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={styles.inputCard}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>SECRET</Text>
              <Pressable
                onPress={() => setReveal((r) => !r)}
                style={({ pressed }) => [
                  styles.smallBtn,
                  pressed && { opacity: 0.7 },
                ]}
                hitSlop={6}
              >
                <Text style={styles.smallBtnText}>
                  {reveal ? "HIDE" : "REVEAL"}
                </Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={(v) => {
                setInput(v);
                setError(null);
              }}
              placeholder="paste hex key or shared phrase"
              placeholderTextColor={C.textMuted}
              secureTextEntry={!reveal}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              spellCheck={false}
              editable={!busy}
              // The keyboard appears for hex and ASCII alike; default
              // is fine, no need to constrain to numeric.
            />
            {previewFingerprint && (
              <Text style={styles.fingerprint}>
                fingerprint:{" "}
                {reveal
                  ? maskFingerprint(previewFingerprint, "full")
                  : maskFingerprint(previewFingerprint, "tail")}
              </Text>
            )}
            {error && <Text style={styles.error}>{error}</Text>}
          </View>

          <Pressable
            onPress={onSave}
            disabled={busy || input.trim().length === 0}
            style={({ pressed }) => [
              styles.saveBtn,
              pressed && { opacity: 0.85 },
              (busy || input.trim().length === 0) && { opacity: 0.5 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={C.bg} />
            ) : (
              <Text style={styles.saveBtnText}>
                {isReplacing ? "REPLACE KEY" : "SAVE & CONTINUE"}
              </Text>
            )}
          </Pressable>

          {onCancel && (
            <Pressable
              onPress={onCancel}
              disabled={busy}
              style={({ pressed }) => [
                styles.cancelBtn,
                pressed && { opacity: 0.7 },
                busy && { opacity: 0.5 },
              ]}
            >
              <Text style={styles.cancelBtnText}>CANCEL</Text>
            </Pressable>
          )}

          <View style={styles.helpBox}>
            <Text style={styles.helpTitle}>WHERE DO I FIND THE KEY?</Text>
            <Text style={styles.helpBody}>
              Ask whoever manages the engine — they have it in
              marsin_engine/secret.yaml. The fingerprint shown above
              should match the fingerprint printed by `npm run sync-secret`
              on every other machine in the camp.
            </Text>
            <Text style={styles.helpBody}>
              The key is stored only on this device&apos;s Keychain
              (WHEN_UNLOCKED_THIS_DEVICE_ONLY). Reinstalling PortWatch
              clears it; you&apos;ll re-enter once.
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: S.lg,
    paddingBottom: S.xxl,
  },
  column: {
    gap: S.md,
  },
  heroBox: {
    paddingHorizontal: S.md,
    paddingTop: S.sm,
    gap: S.sm,
  },
  title: {
    color: C.text,
    fontSize: F.display,
    fontWeight: "900",
    letterSpacing: 1,
  },
  sub: {
    color: C.textDim,
    fontSize: F.body,
    lineHeight: 22,
  },
  subFineprint: {
    color: C.textMuted,
    fontSize: F.small,
    fontStyle: "italic",
  },
  inputCard: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.card,
    padding: S.md,
    gap: S.sm,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  label: {
    flex: 1,
    color: C.textDim,
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  smallBtn: {
    backgroundColor: C.cardSunken,
    borderColor: C.border,
    borderWidth: 1,
    paddingHorizontal: S.md,
    paddingVertical: 6,
    borderRadius: R.pill,
  },
  smallBtnText: {
    color: C.text,
    fontWeight: "800",
    letterSpacing: 1.5,
    fontSize: F.small,
  },
  input: {
    color: C.text,
    backgroundColor: C.cardSunken,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.pill,
    paddingHorizontal: S.md,
    paddingVertical: 12,
    fontFamily: "Menlo",
    fontSize: F.body,
  },
  fingerprint: {
    color: C.accent,
    fontFamily: "Menlo",
    fontSize: F.small,
    marginTop: 4,
  },
  error: {
    color: C.err,
    fontSize: F.small,
    fontWeight: "600",
  },
  saveBtn: {
    backgroundColor: C.accent,
    paddingVertical: S.md + 4,
    borderRadius: R.pill,
    alignItems: "center",
  },
  saveBtnText: {
    color: C.bg,
    fontSize: F.title,
    fontWeight: "900",
    letterSpacing: 3,
  },
  cancelBtn: {
    paddingVertical: S.md,
    borderRadius: R.pill,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  cancelBtnText: {
    color: C.textDim,
    fontSize: F.body,
    fontWeight: "800",
    letterSpacing: 2,
  },
  currentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
    marginTop: S.sm,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    backgroundColor: C.cardSunken,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
  },
  currentLabel: {
    color: C.textDim,
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
  },
  currentValue: {
    color: C.text,
    fontFamily: "Menlo",
    fontSize: F.small,
    flex: 1,
  },
  helpBox: {
    backgroundColor: C.cardSunken,
    borderRadius: R.pill,
    padding: S.md,
    gap: S.sm,
    marginTop: S.md,
  },
  helpTitle: {
    color: C.textDim,
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
  },
  helpBody: {
    color: C.textMuted,
    fontSize: F.small,
    lineHeight: 18,
  },
});
