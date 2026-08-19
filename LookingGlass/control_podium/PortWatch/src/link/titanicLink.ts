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
import { DurableCounter } from "../security/counterStore";

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
  /**
   * Minimum wall time between the end of one `sendOp` (BLE write
   * + reply or timeout) and the start of the next. Keeps the
   * captain firmware's BLE→LoRa queue from filling on a slow link.
   * Default 200 ms is small enough that interactive feel isn't hurt
   * but large enough that the SX1262 has switched standby→RX before
   * the next frame lands.
   */
  interFrameGapMs?: number;
}

export class TitanicLink {
  private codec: Codec;
  private ble: BleClient;
  private src: number;
  private counterStore: DurableCounter;
  private nextSeq = 0;
  private pending = new Map<string, PendingAwaiter>();
  private onWireEvent: (e: WireEvent) => void;
  private defaultTimeoutMs: number;
  private interFrameGapMs: number;
  // ── Single-flight request manager ──────────────────────────────
  //
  // Every BLE characteristic write goes through `_txChain` so the
  // captain firmware sees a STRICTLY SERIAL stream of commands, not
  // a burst that overflows its 8-slot ring queue. Without this, the
  // three pollers + a user tap + a REFRESH page-fetch can all fire
  // `sendOp()` from independent async tasks within ~1 ms; the OS
  // BLE stack may or may not serialize them, and the firmware
  // CERTAINLY can't drain that fast at SF=10/BW=125 (~250 ms per
  // frame on air).
  //
  // We chain Promises: each new sendOp awaits the previous one's
  // completion (success OR timeout) plus an inter-frame gap before
  // starting. Cleaner than an explicit lock — no risk of forgetting
  // to release, no recursive-lock surprises, and it's typed.
  private _txChain: Promise<unknown> = Promise.resolve();
  // Diagnostic counters so the Status screen can surface "you have
  // N requests queued" if the link is slow enough that the wait
  // matters to the operator.
  private _queueDepth = 0;
  private _peakQueueDepth = 0;
  private _serializedCount = 0;

  constructor(codec: Codec, ble: BleClient, opts: TitanicLinkOpts = {}) {
    this.codec = codec;
    this.ble = ble;
    this.src = opts.src ?? DEFAULT_IPHONE_NODE_ID;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 6000;
    this.interFrameGapMs = opts.interFrameGapMs ?? 200;
    this.onWireEvent = opts.onWireEvent ?? (() => undefined);
    this.counterStore = new DurableCounter(this.codec.getKeyFingerprint(), this.src);
  }

  /** Observable depth of the outbound request queue (incl. in-flight). */
  get queueDepth(): number {
    return this._queueDepth;
  }
  /** All-time peak queue depth. Useful for tuning timeouts. */
  get peakQueueDepth(): number {
    return this._peakQueueDepth;
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
   *
   * Serialization: this method awaits a per-link transmit chain so
   * the captain firmware never has more than one frame in flight on
   * the BLE characteristic. Callers don't need to coordinate — they
   * can `sendOp()` from independent async tasks freely.
   */
  async sendOp(op: OpDescriptor, opts: { timeoutMs?: number; dst?: number } = {}): Promise<SendResult> {
    return await this._runThroughChain(() => this._doSendOp(op, opts));
  }

  /**
   * Switch the LoRa profile on EVERY controller on the mesh.
   *
   * This is a "master" change initiated by the operator from PortWatch.
   * Since PortWatch is the captain's BLE peer and the captain firmware
   * intercepts `*CFG` lines + relays them over LoRa on the OLD
   * profile, a single BLE write here flips both the captain AND the
   * server (and any other nodes in range) onto the new profile at a
   * synchronized monotonic deadline.
   *
   * The line is plaintext — bypasses the v2 codec — because:
   *   1. The captain firmware's transmitMessage() checks for `*CFG `
   *      prefix BEFORE handing to the codec. A v2-encoded *CFG would
   *      not be recognised.
   *   2. The *CFG protocol predates the v2 codec and is intentionally
   *      operator-control only — the v2 codec is for engine traffic
   *      whose payloads are radio-untrusted.
   *
   * Serialization: this DOES go through `_txChain` (unlike the
   * earlier implementation which bypassed it). The earlier bypass
   * felt safe because *CFG is rare, but it meant a profile-switch
   * tap could land mid-BLE-write of a pattern qry and corrupt the
   * captain's BLE→LoRa command queue. Now every outbound write —
   * secured frame OR plaintext control — goes through the same
   * single-flight chain, so the firmware never sees overlapped
   * writes regardless of what the operator did.
   *
   * @param name  one of "test_bench" / "local" / "playa" (firmware
   *              rejects anything else with no on-air relay).
   * @param delayMs  synchronized apply delay (default 2000 ms gives
   *              the LoRa relay enough time to land on the server
   *              before both sides flip).
   */
  async setLoraProfile(name: string, delayMs = 2000): Promise<void> {
    const safe = name.trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(safe)) {
      throw new Error(`bad profile name: ${JSON.stringify(name)}`);
    }
    const line = `*CFG name=${safe} t=${delayMs}\n`;
    await this._runThroughChain(async () => {
      this.onWireEvent({
        ts: Date.now(),
        dir: "tx",
        summary: `*CFG name=${safe} t=${delayMs} (mesh-wide profile switch)`,
        frame: null,
        raw: line,
        ok: true,
      });
      await this.ble.writeFrame(line);
    });
  }

  /**
   * Single-flight queue primitive shared by `sendOp` and
   * `setLoraProfile`. Every outbound write goes through here — both
   * v2-secured ops AND plaintext control lines like `*CFG`. The
   * captain firmware's BLE→LoRa ring queue (titanic_ble.h) is
   * single-producer/single-consumer; this enforces the producer side
   * never lets two writes land in the same firmware tick.
   *
   * A failed/timed-out request does NOT poison the chain — we catch
   * the previous chain's error so a subsequent send still runs.
   * Inter-frame gap is enforced AFTER each operation settles.
   */
  private async _runThroughChain<T>(work: () => Promise<T>): Promise<T> {
    this._queueDepth++;
    if (this._queueDepth > this._peakQueueDepth) {
      this._peakQueueDepth = this._queueDepth;
    }
    const prev = this._txChain.catch(() => undefined);
    const ours = prev.then(() => work());
    this._txChain = ours
      .catch(() => undefined)
      .then(() => new Promise<void>((r) => setTimeout(r, this.interFrameGapMs)));
    try {
      return await ours;
    } finally {
      this._queueDepth--;
      this._serializedCount++;
    }
  }

  /**
   * Inner sendOp — the unsynchronized version that actually talks
   * to BLE + waits for a reply. Wrapped by `sendOp()` for serialization.
   */
  private async _doSendOp(
    op: OpDescriptor,
    opts: { timeoutMs?: number; dst?: number },
  ): Promise<SendResult> {
    const seq = this.allocSeq();
    const dst = opts.dst ?? SERVER_ID;
    const frame = frameForOp(op, seq, this.src, dst);
    const ctr = await this.counterStore.nextCounter();
    const line = this.codec.encode(frame, ctr);

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
