# Gain op `max: 1000` can lock mic bands at 1.0 on stage

- **ID:** 002
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** .agent/02_reports/202605/20260527_1_code_review.md (§P1-4)
- **Location:** marsin_engine/lib/signal_post_processor.js OP_SCHEMA
  `gain` block (`value: { type: 'number', min: 0, max: 1000 }`);
  marsin_engine/engine.js:702-713 (CPC gainMax override)
- **Created:** 2026-05-27
- **Updated:** 2026-05-27

## Description
The CPC mic-gain registry is correctly overridden to `range: [0, gainMax]`
(default 2 via `config.yaml osc.gainMax: 2`). But the SignalPostProcessor
Gain op schema independently accepts `value: { min: 0, max: 1000 }` and
can use either `value` or `paramKey`. An operator who configures a chain
with a fixed `value: 50` on a mic band gets `low * 50` from the chain
into CPC, which then clamps to the [0,1] live-key range. Net effect: the
band sticks at 1.0 the moment any signal is present — kicks/strobes
never relax. Visually a "blown-out reactivity" stage failure.

## Suggested fix
Three options from the report; (c) is the cheapest insurance:

- (a) lower the Gain op `value: max` to ~10, or
- (b) propagate `osc.gainMax` into the Gain op schema's max, or
- (c) **clamp the chain output to `[0, 1]` explicitly inside
  `signal_post_processor.process()` before the CPC write**.

## Why it matters
Subtle and easy to ship. The operator may build a chain on the bench,
tap the wrong value, and not realize the consequence until they're in
front of an audience and the rig is locked into strobe-on-everything.

## Notes
AudioChainsCard.tsx may clamp client-side, but trusting a client clamp
for stage safety is itself a risk — an operator can author the bad
chain via `curl` on the bench. Server-side clamp is required.
