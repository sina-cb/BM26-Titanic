// secretStore.ts — runtime AES-128 key handling for production builds.
// =====================================================================
//
// Why this exists:
//
//   * Dev / preview builds: the key is baked into the bundle by
//     scripts/sync-secret.mjs. Convenient — no operator action.
//   * Production (App Store / TestFlight) builds: the bundle ships
//     WITHOUT the camp's PSK. The operator pastes it into PortWatch
//     once, after which it lives in iOS Keychain (via expo-secure-
//     store) until they either re-enter or the app is uninstalled.
//
// Why Keychain (not AsyncStorage):
//
//   AsyncStorage is unencrypted on disk. Anyone with file-system
//   access to a recovered device backup could exfiltrate the PSK.
//   expo-secure-store wraps iOS Keychain with `WHEN_UNLOCKED_THIS_
//   DEVICE_ONLY` accessibility, so the key never leaves the secure
//   enclave-backed credential store and is not synced to iCloud.
//
// Why both raw bytes AND a fingerprint:
//
//   The app needs both for its hot path (encrypt / decrypt) and for
//   the LinkBar / Status surface (display the SHA-256 fingerprint
//   without re-deriving on every render). The fingerprint can be
//   shown in clear; the bytes can not.
//
// Note on logging:
//   Per the workspace logging rules, this module never logs the key
//   or its fingerprint at any level. The fingerprint *is* shown in
//   the UI (it's a hash, not the secret), but we keep it out of
//   console.log so a stray screen-record / xcodebuild log doesn't
//   leak even that.

import { sha256 } from "@noble/hashes/sha2.js";
import * as SecureStore from "expo-secure-store";

/** Storage key — prefixed so it's easy to audit alongside other items. */
const SECRET_KEYCHAIN_KEY = "portwatch.secret.aes128.v1";
/** AES-128 key size. */
const KEY_BYTES = 16;

/** Result of loading the runtime secret. */
export interface RuntimeSecret {
  bytes: Uint8Array;
  fingerprint: string;
}

/**
 * Parse an operator-entered secret into raw bytes. Mirrors the YAML
 * shapes accepted by sync-secret.mjs:
 *
 *   * 32 hex chars → 16 bytes (production form). Whitespace allowed.
 *   * Any other non-empty UTF-8 string → SHA-256 → first 16 bytes.
 *
 * Returns `{ ok: true, bytes }` on success, `{ ok: false, error }`
 * with a user-safe message on failure (no internals leaked).
 */
export function parseSecretInput(
  input: string,
): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Enter the camp's shared key." };
  }

  // Production form: hex.
  const compact = trimmed.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]+$/.test(compact)) {
    if (compact.length !== KEY_BYTES * 2) {
      // Hex-only inputs that aren't 32 chars are almost always typos
      // of a key_hex value — surface that explicitly.
      return {
        ok: false,
        error:
          "Hex keys must be exactly 32 characters (16 bytes). " +
          `Got ${compact.length}.`,
      };
    }
    const bytes = new Uint8Array(KEY_BYTES);
    for (let i = 0; i < KEY_BYTES; i++) {
      bytes[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
    }
    return { ok: true, bytes };
  }

  // Dev form: plain string → SHA-256 → first 16 bytes (matches
  // sync-secret.mjs's behaviour for `key:` strings).
  const enc = new TextEncoder().encode(trimmed);
  const digest = sha256(enc);
  return { ok: true, bytes: digest.slice(0, KEY_BYTES) };
}

/** Compute the canonical 16-hex-char fingerprint for a key. */
export function fingerprintFor(bytes: Uint8Array): string {
  const digest = sha256(bytes);
  // Hex-encode the first 8 bytes manually so this stays portable
  // across the various Uint8Array typings React Native ships with
  // (some shims widen the element type to `unknown` in iteration).
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += digest[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Build a privacy-safe display string from a fingerprint.
 *
 * The fingerprint is itself a hash (not the raw key), so revealing it
 * leaks nothing exploitable — but operators tend to glance at the
 * iPhone in shared spaces (a tech booth, a stage, a Slack screenshot)
 * and the *fingerprint* still uniquely identifies which key the camp
 * is using. We hide it by default and only reveal on operator demand.
 *
 * The "tail" form keeps the last 4 hex chars visible so two operators
 * standing next to each other can quickly confirm "yep, same key" with
 * a single comparison without a full reveal.
 */
export function maskFingerprint(
  fingerprint: string,
  mode: "full" | "tail" | "hidden" = "hidden",
): string {
  if (!fingerprint) return "";
  switch (mode) {
    case "full":
      return fingerprint;
    case "tail": {
      // For a 16-hex fingerprint, show last 4 chars: ••••••••••••3a4f
      const tail = fingerprint.slice(-4);
      return `${"\u2022".repeat(Math.max(0, fingerprint.length - 4))}${tail}`;
    }
    case "hidden":
    default:
      return "\u2022".repeat(fingerprint.length || 16);
  }
}

/**
 * Read the persisted runtime secret from iOS Keychain. Returns null
 * when nothing has been stored yet (first launch, or after a
 * `clearRuntimeSecret`).
 *
 * Defensive against malformed entries — anything that doesn't decode
 * to exactly 16 bytes is treated as missing (not corrupt) so the user
 * just gets the entry sheet again instead of a crash.
 */
export async function loadRuntimeSecret(): Promise<RuntimeSecret | null> {
  try {
    const hex = await SecureStore.getItemAsync(SECRET_KEYCHAIN_KEY);
    if (!hex) return null;
    const compact = hex.replace(/\s+/g, "");
    if (compact.length !== KEY_BYTES * 2 || !/^[0-9a-fA-F]+$/.test(compact)) {
      return null;
    }
    const bytes = new Uint8Array(KEY_BYTES);
    for (let i = 0; i < KEY_BYTES; i++) {
      bytes[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
    }
    return { bytes, fingerprint: fingerprintFor(bytes) };
  } catch {
    // SecureStore can throw on simulator devices that haven't been
    // set up with a passcode. Treat as "no secret" rather than
    // surfacing the implementation error to the operator.
    return null;
  }
}

/**
 * Persist a runtime secret to Keychain. Uses
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` so the secret is bound to this
 * physical device — not synced to iCloud, not included in encrypted
 * backups that get restored on a different device.
 */
export async function saveRuntimeSecret(
  bytes: Uint8Array,
): Promise<RuntimeSecret> {
  if (bytes.length !== KEY_BYTES) {
    throw new Error(`expected ${KEY_BYTES} bytes, got ${bytes.length}`);
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await SecureStore.setItemAsync(SECRET_KEYCHAIN_KEY, hex, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return { bytes, fingerprint: fingerprintFor(bytes) };
}

/** Wipe the persisted secret. Used by the "Forget key" button. */
export async function clearRuntimeSecret(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SECRET_KEYCHAIN_KEY);
  } catch {
    // Best-effort: failure to delete a non-existent key is fine.
  }
}
