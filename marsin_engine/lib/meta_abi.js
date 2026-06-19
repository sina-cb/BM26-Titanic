// meta_abi.js — the per-pixel meta ABI stride, in ONE place.
//
// The host packs per-pixel metadata into a flat Int32 buffer the WASM VM
// reads in its *_with_meta render exports. The lane layout is an ABI
// CONTRACT shared with the MarsinLED firmware/WASM side — JS and WASM
// must agree on the stride and lane order or the VM reads garbage.
//
// Final Tier-C WASM (7 lanes):
//   [0]=controllerId [1]=sectionId [2]=fixtureId [3]=viewMask
//   [4]=fixtureTypeId [5]=pixelLocalIndex [6]=viewMaskHi
//
// Tier C (report 20260618_2 §3.3, ABI 20260619_1) adds a SECOND view word
// so a model can carry up to 62 in-VM view masks (viewMask + viewMaskHi).
// Lane 6 is `viewMaskHi`; the stride is 7 int32/pixel.
//
// ---------------------------------------------------------------------
// INTEGRATION GATE — now LIVE (Tier-C integrated 2026-06-19):
//
//   The final MarsinLED Tier-C WASM (commit e915c23) reads a 7-int meta
//   stride and exposes the `viewMaskHi` builtin. It is vendored into
//   marsin_pb/wasm, so VIEW_MASK_HI_ENABLED is TRUE and the host packs
//   the 7-lane stride with lane 6 = viewMaskHi.
//
//   Lane 6 carries up to 31 bits (views 31..61 as bit (view-31) of
//   viewMaskHi). It is packed as an EXACT Int32 in [0, 0x7FFFFFFF] — the
//   host NEVER sets bit 31. The WASM reads it through its exact-integer
//   setViewMaskHi path (no float round-trip). There is NO setMeta float
//   lane on this path: the BM26 host only ever uses the bulk metaBuf
//   render exports (marsin_render_all_with_meta[_6ch] / render_blend_6ch),
//   which consume the 7-lane buffer; the per-pixel setMeta call (now 6
//   params, the lossy 7th float deleted) lives entirely inside the WASM.
//
//   The two-word allocation, the per-pixel viewMaskHi merge, and the
//   MASK_* word-routing (low word -> `viewMask & MASK`, high word ->
//   inlined `(viewMaskHi & <literal>)`) are pure host-side bookkeeping
//   and always active. Only the WASM-facing stride is gated by this flag.
// ---------------------------------------------------------------------

// LIVE (Tier-C integrated 2026-06-19): the 7-lane WASM that reads lane 6
// (viewMaskHi) and exposes the `viewMaskHi` builtin is vendored into
// marsin_pb/wasm (MarsinLED commit e915c23). The host packs the 7-lane
// stride and writes lane 6 as an exact Int32 in [0, 0x7FFFFFFF].
export const VIEW_MASK_HI_ENABLED = true;

// Lanes per pixel, derived from the flag so the malloc size, the typed-
// array stride, and the pack loop can never drift apart.
export const META_LANES = VIEW_MASK_HI_ENABLED ? 7 : 6;

// Lane indices (lane 6 only meaningful when VIEW_MASK_HI_ENABLED).
export const LANE_CONTROLLER_ID = 0;
export const LANE_SECTION_ID = 1;
export const LANE_FIXTURE_ID = 2;
export const LANE_VIEW_MASK = 3;
export const LANE_FIXTURE_TYPE_ID = 4;
export const LANE_PIXEL_LOCAL_INDEX = 5;
export const LANE_VIEW_MASK_HI = 6;
