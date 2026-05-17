// titanicLink.ts — bridges the BLE transport, the AEAD codec, and the
// rest of the app.
//
// Flow:
//   sendOp(op) → build Frame → codec.encode → ble.writeFrame
//                                                ↓
//                                  firmware transmits over LoRa
//                                                ↓
//                              server Heltec → bridge → MarsinEngine
//                                                ↑
//   onLine(line) ← codec.decode ← ble.notify ← firmware on RX
//
// Outbound has a per-seq awaiter so callers can `await sendOp()` and
// get back the bridge's reply (or a timeout). Inbound also fires an
// event for every decoded frame, so the UI's event log can show
// pubs / pings to other captains / etc.

import {
  Codec,
  BadTagError,
  SecureFrameError,
  looksLikeV2,
  WIRE_VERSION,
} from "../crypto/codec";
import {
  BROADCAST,
  DEFAULT_IPHONE_NODE_ID,
  Frame,
  SERVER_ID,
  TYPE_ACK,
  TYPE_NAK,
  TYPE_PON,
  TYPE_PUB,
  TYPE_REP,
} from "../frame/types";
import { OpDescriptor, frameForOp } from "../frame/ops";
import { BleClient } from "../ble/client";

export type WireDirection = "tx" | "rx";

export interface WireEvent {
  ts: number;
  dir: WireDirection;
  /** Pretty single-line describing what happened. */
  summary: string;
  /** Raw cleartext frame fields (so the UI can render badges). */
  frame: Frame | null;
  /** The on-air `T2|…` line for power users. */
  raw: string;
  ctr?: number;
  ok: boolean;
}

export interface SendResult {
  request: Frame;
  reply: Frame | null;
  rttMs: number;
  timedOut: boolean;
  /** Raw on-the-wire representation of the request, for the log. */
  requestLine: string;
  /** Raw on-the-wire representation of the reply (if any). */
  replyLine: string | null;
}

interface PendingAwaiter {
  resolve: (frame: Frame, line: string) => void;
  startMs: number;
  timer: ReturnType<typeof setTimeout>;
}

export interface TitanicLinkOpts {
  src?: number;
  defaultTimeoutMs?: number;
  onWireEvent?: (e: WireEvent) => void;
}

export class TitanicLink {
  private codec: Codec;
  private ble: BleClient;
  private src: number;
  private nextSeq = 0;
  private pending = new Map<string, PendingAwaiter>();
  private onWireEvent: (e: WireEvent) => void;
  private defaultTimeoutMs: number;

  constructor(codec: Codec, ble: BleClient, opts: TitanicLinkOpts = {}) {
    this.codec = codec;
    this.ble = ble;
    this.src = opts.src ?? DEFAULT_IPHONE_NODE_ID;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 6000;
    this.onWireEvent = opts.onWireEvent ?? (() => undefined);
  }

  /** Allocate the next per-sender seq (wraps modulo 256). */
  private allocSeq(): number {
    const s = this.nextSeq & 0xff;
    this.nextSeq = (this.nextSeq + 1) & 0xff;
    return s;
  }

  /** Wire matcher key — must match what the bridge sends back. */
  private pendingKey(srcPeer: number, seq: number): string {
    return `${srcPeer.toString(16).padStart(2, "0")}:${seq.toString(16).padStart(2, "0")}`;
  }

  /**
   * Fire one op and wait for the bridge to ack/nak/rep/pon. Resolves
   * with the reply (or null + `timedOut: true` after the timeout).
   *
   * If the link drops mid-flight, the pending awaiter eventually
   * times out; cleanup() is the explicit reset path.
   */
  async sendOp(op: OpDescriptor, opts: { timeoutMs?: number; dst?: number } = {}): Promise<SendResult> {
    const seq = this.allocSeq();
    const dst = opts.dst ?? SERVER_ID;
    const frame = frameForOp(op, seq, this.src, dst);
    const line = this.codec.encode(frame);

    // Register the awaiter BEFORE writing so a fast reply can't race us.
    const key = this.pendingKey(SERVER_ID, seq);
    const startMs = Date.now();

    const awaitReply = new Promise<{ frame: Frame; line: string } | null>((resolve) => {
      const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
      const timer = setTimeout(() => {
        this.pending.delete(key);
        resolve(null);
      }, timeoutMs);
      this.pending.set(key, {
        resolve: (f, raw) => {
          clearTimeout(timer);
          this.pending.delete(key);
          resolve({ frame: f, line: raw });
        },
        startMs,
        timer,
      });
    });

    this.onWireEvent({
      ts: startMs,
      dir: "tx",
      summary: `${frame.typ.toUpperCase()} ${op.arg || "(empty)"}  → 0x${dst.toString(16).padStart(2, "0")}`,
      frame,
      raw: line,
      ok: true,
    });

    try {
      await this.ble.writeFrame(line);
    } catch (err) {
      // Cancel the awaiter and surface the error.
      const aw = this.pending.get(key);
      if (aw) {
        clearTimeout(aw.timer);
        this.pending.delete(key);
      }
      this.onWireEvent({
        ts: Date.now(),
        dir: "tx",
        summary: `BLE write failed: ${(err as Error).message}`,
        frame: null,
        raw: line,
        ok: false,
      });
      throw err;
    }

    const reply = await awaitReply;
    const rttMs = Date.now() - startMs;
    return {
      request: frame,
      reply: reply ? reply.frame : null,
      rttMs,
      timedOut: !reply,
      requestLine: line,
      replyLine: reply ? reply.line : null,
    };
  }

  /**
   * Inbound BLE notification handler. The BleClient feeds raw lines
   * here; we try to decode them as v2 frames, route to the matching
   * pending awaiter (if any), and emit a wire event for the log.
   */
  onLine = (line: string): void => {
    line = line.trim();
    if (!line) return;
    if (!looksLikeV2(line)) {
      // Could be the firmware's own banner ("SERVER_RX vX node=0x01")
      // or a v1 frame; either way not for us. Log without parsing.
      this.onWireEvent({
        ts: Date.now(),
        dir: "rx",
        summary: `non-${WIRE_VERSION} payload (dropped)`,
        frame: null,
        raw: line,
        ok: false,
      });
      return;
    }
    let decoded;
    try {
      decoded = this.codec.decode(line);
    } catch (err) {
      const tagFail = err instanceof BadTagError;
      this.onWireEvent({
        ts: Date.now(),
        dir: "rx",
        summary: tagFail ? "BAD TAG (dropped silently)" : `bad frame: ${(err as Error).message}`,
        frame: null,
        raw: line,
        ok: false,
      });
      return;
    }
    const { frame, ctr } = decoded;

    // Filter: anything for us OR broadcast OR from the server gets logged.
    // Frames addressed to other captains travel through anyway (the
    // firmware doesn't filter); we drop them quietly to avoid clutter.
    const isForUs = frame.dst === this.src;
    const isBroadcast = frame.dst === BROADCAST;
    const isFromServer = frame.src === SERVER_ID;

    if (!isForUs && !isBroadcast && !isFromServer) {
      return;
    }

    // Try to satisfy any pending awaiter (server replies have dst=our src
    // and seq echo'ing the request).
    const awaiterKey = this.pendingKey(frame.src, frame.seq);
    const aw = this.pending.get(awaiterKey);
    const isReply = aw && [TYPE_ACK, TYPE_NAK, TYPE_REP, TYPE_PON].includes(frame.typ);
    if (aw && isReply) {
      aw.resolve(frame, line);
    }

    let summary = `${frame.typ.toUpperCase()} ${frame.arg || "(empty)"}  ← 0x${frame.src.toString(16).padStart(2, "0")}`;
    if (frame.typ === TYPE_PUB) {
      summary = `PUB ${frame.arg}`;
    }

    this.onWireEvent({
      ts: Date.now(),
      dir: "rx",
      summary,
      frame,
      raw: line,
      ctr,
      ok: true,
    });
  };

  /**
   * Drop every pending awaiter as timed-out. Call after a disconnect.
   */
  cleanup(): void {
    for (const [, aw] of this.pending) {
      clearTimeout(aw.timer);
    }
    this.pending.clear();
  }

  getSrc(): number {
    return this.src;
  }
}
