// Titanic Frame v2 AEAD codec — TypeScript port of
// control_podium/comms/secure.py.
//
// Wire format (single ASCII line, '|'-delimited, 9 fields):
//
//   T2|<src>|<dst>|<seq>|<typ>|<flags>|<ctr>|<body>|<tag>
//
// Where:
//   * <src>/<dst>/<seq> = 2-char lowercase hex bytes
//   * <typ>             = 3-char ASCII (see types.ts)
//   * <flags>           = 1 hex digit (4-bit bitmask)
//   * <ctr>             = 12 hex chars = 48-bit big-endian per-source counter
//   * <body>            = base64url no-pad of the AES-GCM ciphertext
//                          (or "-" for empty plaintext)
//   * <tag>             = 32 hex chars = 16-byte AEAD tag
//
// AAD is the cleartext header through <ctr> (no trailing '|').
// Nonce  = src(1) || 0x00*5 || ctr_be(6).  Per-source nonce spaces are
// disjoint, so collisions are structurally impossible if every sender
// keeps its counter monotone.
//
// CRITICAL: receivers MUST silently drop frames that fail any check.
// Never NAK or log the body on a bad tag — that's an oracle for an
// active attacker.
//
// Pure-JS implementation via @noble/ciphers/aes (audited, no native
// deps, fully synchronous — React Native's crypto.subtle is not
// guaranteed to expose AES-GCM, so we don't use the webcrypto path).

import { gcm } from "@noble/ciphers/aes.js";
import { Frame, VALID_TYPES } from "../frame/types";
import { fingerprintFor } from "../security/secretStore";

export const WIRE_VERSION = "T2";
const KEY_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const CTR_BYTES = 6;
const CTR_HEX_LEN = CTR_BYTES * 2;
const TAG_HEX_LEN = TAG_BYTES * 2;
const EMPTY_BODY = "-";

export class SecureFrameError extends Error {}
export class BadTagError extends SecureFrameError {}

export interface DecodedFrame {
  frame: Frame;
  ctr: number;
}

// ── Hex / base64url helpers (pure JS, no deps) ─────────────────────

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hex string must have even length");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(b)) {
      throw new Error(`bad hex char in "${hex}"`);
    }
    out[i] = b;
  }
  return out;
}

const BASE64URL_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64urlEncodeNoPad(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += BASE64URL_CHARS[a >> 2];
    out += BASE64URL_CHARS[((a & 0x03) << 4) | (b >> 4)];
    out += BASE64URL_CHARS[((b & 0x0f) << 2) | (c >> 6)];
    out += BASE64URL_CHARS[c & 0x3f];
  }
  if (i < bytes.length) {
    const a = bytes[i];
    if (i + 1 < bytes.length) {
      const b = bytes[i + 1];
      out += BASE64URL_CHARS[a >> 2];
      out += BASE64URL_CHARS[((a & 0x03) << 4) | (b >> 4)];
      out += BASE64URL_CHARS[(b & 0x0f) << 2];
    } else {
      out += BASE64URL_CHARS[a >> 2];
      out += BASE64URL_CHARS[(a & 0x03) << 4];
    }
  }
  return out;
}

function base64urlDecode(s: string): Uint8Array {
  const lookup: Record<string, number> = {};
  for (let i = 0; i < BASE64URL_CHARS.length; i++) {
    lookup[BASE64URL_CHARS[i]] = i;
  }
  // Strip any padding the wire might still carry.
  s = s.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((s.length * 6) / 8));
  let bitBuf = 0;
  let bitCount = 0;
  let outIdx = 0;
  for (const ch of s) {
    const v = lookup[ch];
    if (v === undefined) {
      throw new Error(`bad base64url char ${JSON.stringify(ch)}`);
    }
    bitBuf = (bitBuf << 6) | v;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out[outIdx++] = (bitBuf >> bitCount) & 0xff;
    }
  }
  return out.subarray(0, outIdx);
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

// ── Nonce ───────────────────────────────────────────────────────────

function makeNonce(src: number, ctr: number): Uint8Array {
  if (src < 0 || src > 0xff) {
    throw new Error(`src out of byte range: ${src}`);
  }
  const nonce = new Uint8Array(NONCE_BYTES);
  nonce[0] = src;
  // bytes 1..5 stay zero (reserved epoch field for future use)
  // bytes 6..11 = ctr big-endian (6 bytes / 48 bits)
  // JS bit-ops are 32-bit — split high vs low 24 bits.
  const ctrHigh = Math.floor(ctr / 0x100000000); // top 16 bits
  const ctrLow = ctr >>> 0; // bottom 32 bits
  nonce[6] = (ctrHigh >>> 8) & 0xff;
  nonce[7] = ctrHigh & 0xff;
  nonce[8] = (ctrLow >>> 24) & 0xff;
  nonce[9] = (ctrLow >>> 16) & 0xff;
  nonce[10] = (ctrLow >>> 8) & 0xff;
  nonce[11] = ctrLow & 0xff;
  return nonce;
}

function ctrToHex(ctr: number): string {
  // Same split for hex, since ctr is up to 48 bits and JS numbers
  // can represent that exactly (up to 2^53).
  const ctrHigh = Math.floor(ctr / 0x100000000);
  const ctrLow = ctr >>> 0;
  return (
    (ctrHigh & 0xffff).toString(16).padStart(4, "0") +
    ctrLow.toString(16).padStart(8, "0")
  );
}

function hexToCtr(hex: string): number {
  if (hex.length !== CTR_HEX_LEN) {
    throw new Error(`ctr hex must be ${CTR_HEX_LEN} chars`);
  }
  const high = parseInt(hex.substring(0, 4), 16);
  const low = parseInt(hex.substring(4), 16);
  return high * 0x100000000 + low;
}

// ── Codec ──────────────────────────────────────────────────────────

export class Codec {
  private readonly key: Uint8Array;
  private counter: number;

  constructor(key: Uint8Array) {
    if (key.length !== KEY_BYTES) {
      throw new Error(`key must be ${KEY_BYTES} bytes, got ${key.length}`);
    }
    this.key = key;
    // Random 32-bit seed in the bottom of the 48-bit space. Restarts are
    // rare and the bridge auto-re-anchors on the next `hlo`, so any
    // collision risk is negligible. Production callers can also pass an
    // explicit ctr to encode().
    const r = new Uint8Array(4);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(r);
    } else {
      // Last-ditch fallback (shouldn't ever fire on RN with web crypto).
      for (let i = 0; i < 4; i++) r[i] = Math.floor(Math.random() * 256);
    }
    this.counter =
      ((r[0] << 24) | (r[1] << 16) | (r[2] << 8) | r[3]) >>> 0;
  }

  getKeyFingerprint(): string {
    return fingerprintFor(this.key);
  }

  nextCtr(): number {
    this.counter = (this.counter + 1) % 0x1000000000000; // 2^48
    return this.counter;
  }

  peekCtr(): number {
    return this.counter;
  }

  /** Reset the counter (only for tests). */
  resetCtr(value: number): void {
    this.counter = value % 0x1000000000000;
  }

  encode(frame: Frame, ctr?: number): string {
    if (ctr === undefined) ctr = this.nextCtr();
    if (ctr < 0 || ctr >= 0x1000000000000) {
      throw new Error(`ctr ${ctr} out of 48-bit range`);
    }

    const header =
      WIRE_VERSION +
      "|" + frame.src.toString(16).padStart(2, "0") +
      "|" + frame.dst.toString(16).padStart(2, "0") +
      "|" + frame.seq.toString(16).padStart(2, "0") +
      "|" + frame.typ +
      "|" + (frame.flags & 0xf).toString(16) +
      "|" + ctrToHex(ctr);
    const ad = TEXT_ENCODER.encode(header);

    const nonce = makeNonce(frame.src, ctr);
    const plaintext = TEXT_ENCODER.encode(frame.arg);
    const aead = gcm(this.key, nonce, ad);
    const ctAndTag: Uint8Array = aead.encrypt(plaintext);

    const ciphertext = ctAndTag.subarray(0, ctAndTag.length - TAG_BYTES);
    const tag = ctAndTag.subarray(ctAndTag.length - TAG_BYTES);

    const body = ciphertext.length === 0 ? EMPTY_BODY : base64urlEncodeNoPad(ciphertext);
    return header + "|" + body + "|" + bytesToHex(tag);
  }

  decode(line: string): DecodedFrame {
    if (!line) throw new SecureFrameError("empty input");
    line = line.replace(/[\r\n]+$/, "");
    const parts = line.split("|");
    if (parts.length !== 9) {
      throw new SecureFrameError(`expected 9 fields, got ${parts.length}`);
    }
    const [magic, srcHex, dstHex, seqHex, typ, flagsHex, ctrHex, bodyB64, tagHex] = parts;
    if (magic !== WIRE_VERSION) {
      throw new SecureFrameError(`bad magic ${JSON.stringify(magic)}`);
    }
    if (ctrHex.length !== CTR_HEX_LEN) {
      throw new SecureFrameError(`ctr field must be ${CTR_HEX_LEN} hex chars`);
    }
    if (tagHex.length !== TAG_HEX_LEN) {
      throw new SecureFrameError(`tag field must be ${TAG_HEX_LEN} hex chars`);
    }

    let src: number, dst: number, seq: number, flags: number, ctr: number, tag: Uint8Array;
    try {
      src = parseInt(srcHex, 16);
      dst = parseInt(dstHex, 16);
      seq = parseInt(seqHex, 16);
      flags = parseInt(flagsHex, 16);
      ctr = hexToCtr(ctrHex);
      tag = hexToBytes(tagHex);
    } catch (e: any) {
      throw new SecureFrameError(`bad hex field: ${e.message ?? e}`);
    }
    if (![src, dst, seq, flags].every(Number.isFinite)) {
      throw new SecureFrameError("bad hex field");
    }

    let ciphertext: Uint8Array;
    if (bodyB64 === EMPTY_BODY) {
      ciphertext = new Uint8Array(0);
    } else {
      try {
        ciphertext = base64urlDecode(bodyB64);
      } catch (e: any) {
        throw new SecureFrameError(`bad base64 body: ${e.message ?? e}`);
      }
    }

    // Rebuild AAD from parsed fields (NOT input slice) so trailing
    // whitespace / extra chars cleanly fail tag verify.
    const ad = TEXT_ENCODER.encode(
      WIRE_VERSION +
        "|" + src.toString(16).padStart(2, "0") +
        "|" + dst.toString(16).padStart(2, "0") +
        "|" + seq.toString(16).padStart(2, "0") +
        "|" + typ +
        "|" + (flags & 0xf).toString(16) +
        "|" + ctrToHex(ctr)
    );
    const nonce = makeNonce(src, ctr);

    let plaintext: Uint8Array;
    try {
      const ctAndTag = new Uint8Array(ciphertext.length + tag.length);
      ctAndTag.set(ciphertext, 0);
      ctAndTag.set(tag, ciphertext.length);
      const aead = gcm(this.key, nonce, ad);
      plaintext = aead.decrypt(ctAndTag);
    } catch {
      // Don't include cipher-derived bytes in the message — keeps logs
      // from leaking partial decrypts (per spec §3.6.7).
      throw new BadTagError(`AEAD verify failed for src=0x${src.toString(16).padStart(2, "0")} ctr=${ctr}`);
    }

    let arg: string;
    try {
      arg = TEXT_DECODER.decode(plaintext);
    } catch (e: any) {
      throw new SecureFrameError(`plaintext is not valid utf-8: ${e.message ?? e}`);
    }

    if (!VALID_TYPES.has(typ)) {
      throw new SecureFrameError(`unknown typ: ${JSON.stringify(typ)}`);
    }
    if (src < 0 || src > 0xfe) throw new SecureFrameError(`src out of range: 0x${src.toString(16)}`);
    if (dst < 0 || dst > 0xff) throw new SecureFrameError(`dst out of range: 0x${dst.toString(16)}`);
    if (seq < 0 || seq > 0xff) throw new SecureFrameError(`seq out of range: 0x${seq.toString(16)}`);
    if (flags < 0 || flags > 0xf) throw new SecureFrameError(`flags out of range: 0x${flags.toString(16)}`);

    const frame: Frame = { src, dst, seq, typ, flags, arg };
    return { frame, ctr };
  }
}

export function looksLikeV2(line: string): boolean {
  return line.startsWith(WIRE_VERSION + "|");
}
