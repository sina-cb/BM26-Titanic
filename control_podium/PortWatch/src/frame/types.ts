// Wire-level constants and types for Titanic Frame v2.
// Mirrors control_podium/comms/frame.py exactly.
//
// The Heltec firmware does NOT parse these — they're produced and
// consumed end-to-end by the host (this app on the captain side, the
// bridge on the server side).

export const TYPE_HLO = "hlo"; // client hello (re-anchors replay window)
export const TYPE_PIN = "pin"; // ping
export const TYPE_PON = "pon"; // pong (from server)
export const TYPE_CMD = "cmd"; // captain-only command
export const TYPE_ACK = "ack";
export const TYPE_NAK = "nak";
export const TYPE_QRY = "qry"; // read-only query
export const TYPE_REP = "rep";
export const TYPE_PUB = "pub"; // server broadcast

export const VALID_TYPES = new Set<string>([
  TYPE_HLO,
  TYPE_PIN,
  TYPE_PON,
  TYPE_CMD,
  TYPE_ACK,
  TYPE_NAK,
  TYPE_QRY,
  TYPE_REP,
  TYPE_PUB,
]);

export const FLAG_ACK_REQUESTED = 0x1;
export const FLAG_PRIVILEGED = 0x2;
export const FLAG_RETRY = 0x4;

export const SERVER_ID = 0x01;
export const BROADCAST = 0xff;
export const RESERVED_ZERO = 0x00;

// Default node ID this iPhone uses on the mesh.
// Per .config.nodes.yaml `0x0B` is reserved as `misha` / type `ipad` /
// role `captain`. The captain Heltec the iPhone tunnels through is
// `0x0A` (sina); the bridge sees `src=0x0B` and applies captain ACL.
export const DEFAULT_IPHONE_NODE_ID = 0x0b;

export interface Frame {
  src: number; // 0..0xfe
  dst: number; // 0..0xff (0xff = broadcast)
  seq: number; // 0..0xff
  typ: string; // see VALID_TYPES
  flags: number; // 0..0xf
  arg: string; // utf-8 plaintext
}

export class FrameError extends Error {}
