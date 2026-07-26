# 20260724_33 — Slice S1: `trace_chains.js` pure circle-chain math (IMPLEMENTED)

**Author:** Fable Opus implementer (S1). **Branch:** `feat/bm_readiness` ·
**Date:** 2026-07-24. **Design:** `20260724_32` §3.2 / §4-S1.
**Scope:** new files only — no edits to `gui_builder.js`, `config.js`, or any
existing file (S2 owns that wiring). No git ops (operator offline).

## What landed

- `simulation/src/dmx/trace_chains.js` — pure module, ESM `export` (matches
  `src/dmx/*` convention; no DOM/window/THREE; imports at top; fail-loud).
- `simulation/tests/trace_chains.test.js` — 23 tests, all green.

## API surface for S2

```js
import { chainPlan, chainGroupNames } from '../dmx/trace_chains.js';
```

### `chainGroupNames(trace) -> string[]`
The flat group names a trace owns, in chain order. Use in **both**
`generateGroupFromTrace`'s regeneration sweep (union with legacy
`trace.groupName`) **and** `config.js`'s `traceGenerated` re-stamp.

| trace | returns |
|---|---|
| `splits` absent / `1` | `[trace.groupName]` (legacy single-group contract) |
| `splits:2, splitLayout:'mirror'` | `['<g> L', '<g> R']` |
| `splits:N, splitLayout:'sequential'` | `['<g> Chain 1' … '<g> Chain N']` |

### `chainPlan(trace) -> ChainPlan[]`
```
ChainPlan = {
  suffix,     // 'L' | 'R' | 'Chain N' | null (single chain)
  groupName,  // flat group name for this chain's fixtures (=== chainGroupNames[k])
  count,      // fixtures in this chain (per-chain count once splits>1)
  angles,     // [deg…] absolute angle on the ring — for UI/preview/labels
  points,     // [{x, y:0, z}…] local circle-space positions — AUTHORITATIVE
}
```
**S2 must place fixtures from `points`, not from `angles`.** A
radians→degrees→radians round trip is not bit-stable, so degrees are display
only; `points` carry the byte-identical placement. `points` are local circle
space (before the trace's x/y/z/rot group transform — apply that downstream
exactly as today). `points` is the base EVEN layout (no `pointOffsets`);
splits=1 keeps the caller's offset post-processing, splits>1 disables it
(even-coverage primitive, design §3.2 / §8-D10).

**Trace input:** `{ shape:'circle', radius, arc, count, groupName,
splits?=1, startAngle?=0, splitLayout?='mirror' }`. `count` is per-chain when
`splits>1` (design §3.1). `startAngle` is degrees, folded in as
`theta = startRad + evenAngle` — the exact form S2's planned `buildTracePath`
change (`angle = startRad + (s/length)*arcRad`) must adopt so splits=1 stays
byte-identical.

**Ordering contract:** index 0 of each chain's arrays is fixture **#1**, the
one nearest the chain's start point (matches the operator's "starting indexes
from the closest point"). S2 emits chain-major with `name = '<groupName> <i+1>'`.

**Layouts:** `mirror` (only valid for `splits===2`; fans CCW=`L` and CW=`R`
from the start at half-steps) and `sequential` (chains tile the arc
head-to-tail, same direction; splits 2–4). `mirror` with splits≠2 throws.

## Equivalence proof (the byte-identical contract)

The test embeds an independent **oracle** copied verbatim from
`gui_builder.js` (`computeTraceBaseArclengths` circle branch ~L3304 +
`buildTracePath.at` ~L2489) and asserts **strict `===`** on every `x/y/z`.

- Real titanic smokestack trace (`circle, radius 3, arc 360, count 10`):
  `chainPlan(...)[0].points` are bit-identical to the oracle for all 10 dots.
- Also bit-identical across 6 varied geometries incl. open arcs (180/270/90)
  and count=1.

**Why the exact arithmetic matters** (verified empirically before writing):
the shipping math computes `s=(i/denom)*length` then `angle=(s/length)*arcRad`.
The naive `(i/denom)*arc` degree form and even `(i/denom)*arcRad` diverge from
it by 1 ULP on several dots (e.g. `radius 5, arc 360, count 8`, i=3/6). The
module preserves the length round-trip so the last bit matches. A degrees
round-trip is likewise not bit-stable — hence `points` is authoritative.

## Test coverage (23 tests, all pass)

splits=1 byte-identity (real smokestack numbers + 6 geometries + `splits`
absent==1 + startAngle rotation); mirror-2 smokestack (L/R names, ±22.5…157.5
fan, index-1-nearest-start, even 45° union coverage with no fixture at
start/seam, points↔angles agreement, startAngle shift); sequential (uniform
`splits·count` ring, per-chain block starts); `chainGroupNames` (splits=1
legacy contract, mirror/sequential naming, intra-trace uniqueness +
agreement with `chainPlan`, blank/missing name throws — the collision guard);
fail-loud validation (count<1 / non-integer / missing = "0 fixtures" &
"splits>fixtures" class; splits out of 1–4 / non-integer; mirror≠2;
unknown layout; non-finite/`string` startAngle; non-circle shape; bad
radius/arc; non-object trace).

## Verification

- `node --check` both files: OK.
- `cd simulation && npm test`: **519 pass / 0 fail** (484 baseline + my 23 +
  a concurrent sibling slice's additions; my file adds 23, zero fails).

## Notes for S2 / hand-off

- Collision behavior: `chainGroupNames` throws on blank/whitespace/non-string
  `groupName` (would otherwise collide every chain onto `' L'`/`' R'`). It does
  NOT dedupe against *other* groups — that stays with the existing
  `uniqueGroupName` trace-collision dodge (report _29); S2 feeds the **chain**
  names into that union (design §3.2).
- No fallbacks: the module does **not** reproduce gui_builder's
  `Math.max(1, Math.round(count ?? 8))` clamp — a bad/missing count throws.
  For valid integer counts the two are identical, so byte-identity holds; for
  degenerate input the module fails loud per P0.
