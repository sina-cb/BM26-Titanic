# _216 — DESIGN: COLORS schemes + engine crossfade + fullscreen + perf overlay

**Date:** 2026-08-14 · **Agent:** _216 (Fable, design) ·
**Branch:** feat/bm_audio_tuning (shared tree, docs-only — no product code
touched, no services run, no git ops).
**Deliverable:** `docs/55_colors_schemes_and_perf_overlay.md` — the full UX
spec + engine anchors + the ordered implementation contract (11 work items,
acceptance criteria, test plan, 6-row screenshot matrix) for the Opus
implementer.
**Inputs:** docs/53 (+§8 AS BUILT), docs/54, `_211` report,
`docs/ui/touch_control.html` PALETTE GENERATORS (~3221–3330, the canonical
generator source — the old TS module is deleted),
`marsin_engine/lib/color_autopilot.js`, `lib/api_server.js` (resolver ~5645,
`setColorAutopilot` ~5733), `colors_window_logic.ts`, `colors_window.tsx`,
`deck_workspace_layout.ts`, `deck_workspace.tsx`, `index.tsx` (narrow pin
1147–1152, `ColumnsScrollRest` 146–162), `usePerformanceMode.ts`. All
recon anchors spot-checked against the current tree this session.

---

## The three big calls (docs/55 §1)

**D1 — hue interpolation: the ENGINE gets shortest-arc.** `lerpParams`
(color_autopilot.js:505) is plain linear; a TURNS ring's wrap pair fades the
long way round the wheel (~78 % instead of 22 % for a typical ring) — an
operator-visible defect the preview would otherwise have to MODEL. New
exported `lerpHue` (shortest arc mod 1, tie at exactly 0.5 resolves forward)
used only for the `h` channel of colour-shaped `{h,s,v}` sub-objects;
everything else byte-identical. This also aligns the daemon with the engine's
own manual-slew interpolator (color_transition.js, OKLCH shortest-arc) —
the fade path was the one long-way interpolator left. Blast radius: only
fades whose hue wrap-distance exceeds 0.5, i.e. exactly the wrong-looking
ones; transitionMs defaults to 0 (hard cut) so most legacy configs are
untouched. A shared reference table is pinned in BOTH test suites so engine
and client `lerpHue` can never drift.

**D2 — MASTER/HUE expressibility: inline pairs widen to FULL HSV,
backward-compatibly.** `c1`/`c2` become number (hue, resolves s=1,v=1 —
existing wire byte-unchanged) OR `{h,s,v}` (each channel validated loudly).
CPC palette params are already full HSV — the hue-only pin was resolver
policy. With this, all four Live Touch generators port VERBATIM (incl.
BASE.s=0.95, MONO_STEPS with the v≥0.1 floor, COMP_OFFSETS
[0,+60,+30,−30,−60], 72° pentad) and the Deck's swatches are byte-identical
to Live Touch's. The docs/36 S=V=1 pin stays true where it lives — the A/B
wheel surface; full HSV rides only in rotation rings, and wheel-handle FILLS
render the true broadcast HSV so the glass never overstates brightness.
Client emits a plain number whenever s=1∧v=1 (wire minimization). Flagged to
the operator (non-blocking): HUE's darkest turn is v=0.25 by definition.

**D3 — perf-mode rail chips: SUPPRESSED + one static caption.** During
performance mode the PARAMETERS/AUTOPILOT chips are not rendered at all
(neither open nor rail) and the bar shows `PERFORMANCE — PARAMS & AUTOPILOT
HIDDEN` (microCaps, C.icon). A chip that cannot restore its window is docs/53
§3.1's "affordance that always refuses"; the windows are DELIBERATELY
unreachable and the reach path is exiting performance mode. COLORS chip stays
fully live (user taps persist — the constraint is that the OVERLAY never
writes layout). The overlay reads `usePerformanceMode().active` RAW, not
`usePerfLock()` (the captain-session bypass is edit rights, not screen
composition); not-ready defaults to inactive = everything shown.

## The unification that fell out

Intent 2 ("crossfade should update the palette") + intent 3 ("the fade moves
one to the other") collapse into ONE mechanism: **the crossfade IS a 2-entry
TURNS ring** `[(A,B),(B,A)]` on the existing engine daemon, and the
continuous-triangle feel the operator approved in the prototype becomes
`delay_s: 0` (new, guarded: 0 requires transitionMs ≥ 100 or validate throws
— zero+zero would be a hard-cut spin loop; and `_scheduleNext`'s
`> 0 ? : DEFAULT` fallback at line ~314 MUST be fixed or CONT silently
becomes a 30 s hold). The `_211` local preview loop is retired; the card is
relabelled `CROSSFADE · DRIVES THE RIG`, animates purely from the broadcast
slots (no local clock at all — the glass shows the ship), STOP freezes
in place natively (`_cancelTween`), and the BLEND scrubber becomes gated
finger-driven manual writes using the same `lerpHue` as the engine tween, so
a frozen fade position round-trips exactly. One surgical engine addition:
REST `setColorAutopilot` seeds `_currentParams` from live CPC on activation
(the four lines the timeline path already runs, WITHOUT triggerNext) so a
deck-started rotation's first transition fades instead of hard-cutting.

Rotation-active grammar is a full table (docs/55 §2.6): manual CPC writes
refused with the existing sentence; scheme tap during a live TURNS ring is a
ONE-TAP RESTAGE (a config write through the daemon's front door — the single
writer never changes, narrated on the message line); during a crossfade or a
library palette-set it stages the draft only and says what button takes over.
Nothing auto-pauses anywhere.

## Fullscreen + overlay mechanics

Fullscreen is a NARROW-only fix, strictly conditional on the EFFECTIVE open
set being exactly `{patterns}` (layout closures AND the perf overlay both
count): the fixed pin (index.tsx:1147-1152) swaps for flex-fill and
`ColumnsScrollRest` collapses but stays mounted. The party-2026-07-11 pin
contract is byte-identical whenever any second window is open. The overlay is
derived at the `isOpen`/`flexFor`/rail boundary inside `useDeckWorkspace()`
(new pure fns `effectiveOpenWindows` / `effectiveRailWindows` /
`patternsFillsNarrow` in deck_workspace_layout.ts) — the reducer, normalizer
and AsyncStorage key are never touched, and S6 of the screenshot matrix
asserts the stored layout is byte-identical across a perf-mode round trip.

## What the implementer must get from the operator first

Nothing blocks the build — three defaults are chosen and flagged (docs/55
§8): (1) HUE's v=0.25 darkest turn at night, (2) crossfade HOLD default =
CONT, (3) the perf caption wording. Test-engine hygiene is mandatory and
spelled out in the contract: the loopback pseudo-blackhole is NOT isolation —
`--dest` on a TEST-NET-1 address or no-sACN config, high ports, fresh dist on
:7167 only, never the operator's :6967/:6968.

## Files

- `docs/55_colors_schemes_and_perf_overlay.md` — the contract (this design).
- `.agent/memory/bm_readiness_thread_tracker.md` — `## _216` landing block.
- `.agent/projects/bm26_show_readiness.md` — Color deck thread row updated.
- No product code, tests, or state files touched.
