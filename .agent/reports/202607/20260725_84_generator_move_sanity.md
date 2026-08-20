# 20260725_84 — Sanity check of `_83` (generator move fixture sync)

**Role:** timeboxed fresh-eyes sanity check of report
`20260725_83_generator_move_fixture_sync.md` and its code. Read-only on all
source; flag, don't fix.

**Verdict: PASS.** Every claim spot-checked held up against the code and the
suite. One open question answered (the 9th failure, identified below), two
cosmetic notes, nothing that needs action inside `_83`'s scope.

## 1. Test suite — PASS, and the 9th failure is identified

`cd simulation && npm test` → **tests 1391 / pass 1382 / fail 9** — exactly
the report's numbers. The new file's 25 tests are among the passes.

**The 9th failure** (the extra beyond the long-standing 8 enumerated in
`_46` §1 and re-confirmed byte-identical through `_48`/`_59`/`_71`):

> `the compression threshold has real headroom on the live scene`
> `simulation/tests/pixel_map_view_defaults.test.js:487`
> `AssertionError: the smallest collapsed band (5.20) is too close to the
> 5-unit threshold`

**It is operator-scene drift, not a code regression.** The test recomputes
the Top-Down view's dead bands from the live titanic scene's fixture **x**
positions — and it explicitly includes `SMALL_SMOKESTACK_GROUPS`. The
operator's Left Small SmokeStack move changed those x's, narrowing the
smallest collapsed band to 5.20 where the guard demands `> minWorldGap × 1.5
= 7.5`. No module `_83` touched is imported by this test, and `_83` wrote no
scene file. The pre-existing 8 are the familiar stale-model family
(`fixtures are docked beside the ship…`, `…accept the block today…`,
`view-bit headroom…`, the two `CLI:` parity cases, the three `real scene …`
cases) — all present and accounted for.

**But the guard is telling the truth about the scene:** at the smokestack's
current x, the Top-Down compression margin is thin (5.20 vs the 5-unit
threshold; the guard wants ≥ 7.5). If a future nudge takes that band under
5, the compressor will treat a real gap as a dead band and tear the side.
Worth an operator decision — shift the generator's x slightly, or accept a
retuned pin — but that is a scene-layout call, not `_83` code.

## 2. `trace_anchor.js` — PASS

`simulation/src/dmx/trace_anchor.js` is exactly as described: pure (no
THREE/DOM/window), `??` on every numeric field, `TRACE_ANCHOR_DEFAULTS`
frozen, line/corner world-space distinction isolated in
`traceUsesWorldSpacePath`. No `||` anywhere in the module. In
`gui_builder.js` the old patterns are gone — no `trace.x/y/z ||` remains;
the only `||` on trace numerics left is `trace.aimX || 0` (etc.) on the aim
*handle*, where the falsy default equals the numeric default (`0 || 0 ===
0`) — behaviorally identical to `??`, not the anchor bug class. Noted only
for completeness.

## 3. "Generation no longer touches the scene graph" — PASS

`generateGroupFromTrace` (`gui_builder.js:4734`) computes
`const worldMatrix = isWorldSpace ? null : traceAnchorMatrix(trace);` (line
4798) and every downstream placement/normal transform uses that matrix.
No `window.traceObjects` lookup, no `matrixWorld` read in the generation
path. The remaining `grp.matrixWorld` reads are in `buildTraceObject`'s
initial aim-line visual (line 3716-17, on a group placed by
`applyTraceAnchor` in the **same call**, after a forced
`updateMatrixWorld(true)` — fresh by construction, visual-only) — so the
report's "no consumer is left reading a THREE object" is a hair overstated
but the stale-read bug class is genuinely closed.

## 4. Scenes untouched + sticky-by-name — PASS

- `simulation/scenes/titanic/scene_config.yaml` on disk matches the report's
  claimed self-consistent state exactly: trace at
  `(-46.318…, -0.0, 8.6236…)`, fixture 1 at `(-42.318…, y: 0, 8.6236…)` —
  the ring the fixed code regenerates. Scene files show as modified in git,
  but that is the branch-wide uncommitted state predating `_83`; nothing
  contradicts "no scene file was written by this work".
- Sticky-by-name pins exist in the new test file (§3, e.g.
  `patches and 2D pixel-map references are keyed by NAME…`,
  `generator_move_fixture_sync.test.js:280`).

## 5. Fresh-eyes skim

Nothing further. (One grep-rendering false alarm — `gui_builder.js:4749`
looked like a bare `\` comment in tool output; the file really has `//`.)

## Follow-ups for the coordinator

1. The 9th failure is a **legitimate scene-layout warning**, not noise:
   Left Small SmokeStack's current x leaves only a 5.20-unit dead band vs
   the 7.5 the Top-Down compression guard wants. Operator call.
2. No action needed on `_83` itself.
