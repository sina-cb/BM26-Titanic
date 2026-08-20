# `_304` — `pushXY()` non-integer pointerId silent-drop fallback: FIXED

**Date:** 2026-08-17 · **Agent:** Opus (operator-briefed) ·
**Phase:** implementation + offline validation · **Live rig:** untouched
(no port bound, no engine write, no ARM mutation, no restart) · **Git:** none.

Closes the follow-up filed by `_302` §3.1 / §8 (and documented at length in the
header of `simulation/tests/touch_control_spatial_stroke_ids.test.js`).

---

## 1. The defect

`docs/ui/touch_control_wire.js`, inside `pushXY()`:

```javascript
var pointerId = Number.isInteger(e.pointerId) ? e.pointerId : TAKE_POINTER_ID;
```

`Number.isInteger` was being used as a **proxy** for "this is a real pointer",
because the only synthetic caller (the TAKE playback replay) happened to pass
the reserved integer `TAKE_POINTER_ID = 0x7ffffffe`.

WKWebView derives pointer ids from iOS touch identifiers and can hand back a
genuinely non-integer double. Such a finger resolved to the **playback** entry
rather than the entry `pointerdown` had just created for it, so
`pointer.current` was never set on its own entry and that touch vanished from
`spatialPayload()`'s `strokes[]` — **painted nothing, reported nothing**. A
fallback, which AGENTS.md P0 forbids ("Fail loudly").

Every OTHER site already keyed `spatialPointers` on the raw `e.pointerId`
(`pointerdown` `:2486`, `pointermove` `:2506`, `liftBrush` `:2521`). `pushXY`
was the single place that re-derived identity, and it derived it wrongly.

## 2. Semantics chosen — identity is DECLARED, never inferred

Three parts, all in `touch_control_wire.js`:

1. **A synthetic playback sample announces itself.** The `spatialplay` handler
   now calls `pushXY({ spatialPlayback: true, clientX, clientY })`. The marker,
   not a reserved number, is what routes a sample to the playback contact.

2. **Everything else resolves to its raw `e.pointerId`** — the same key every
   other handler uses. So a fractional id finds the entry `pointerdown`
   created for it and paints, exactly like an integer one. `pointer.slot`
   remains the compact 0..9 wire id and `pointer.id` remains the raw pointerId
   / Map key: **W2's compact stroke-slot mapping is untouched.**

3. **The playback contact left the pointerId namespace entirely.**
   `TAKE_POINTER_ID = 0x7ffffffe` became `TAKE_CONTACT_KEY = 'take-playback'`.
   A DOM `pointerId` is always a number, so a real finger can no longer collide
   with the playback key **by construction**, rather than by relying on
   `0x7ffffffe` being an improbable id. This is the part that makes "a real
   pointer never aliases the playback slot" a structural guarantee instead of a
   probability argument — worth the rename, since a constant called
   `..._POINTER_ID` living in the same namespace as real ids is precisely the
   confusion that produced the bug.

Resolution is centralised in one small helper next to the constant:

```javascript
function spatialContactKey(e) {
  if (e.spatialPlayback === true) return TAKE_CONTACT_KEY;
  if (typeof e.pointerId === 'number' && !Number.isNaN(e.pointerId)) return e.pointerId;
  fail('spatial touch', 'a spatial sample carried no usable pointerId ('
    + String(e.pointerId) + ') and no playback marker; refusing it');
  return undefined;
}
```

A sample that is neither a declared playback frame nor a numeric pointer id is
**refused loudly** (red pill + console) instead of being routed to whatever
entry is convenient. `pushXY` returns on `undefined` with a `/* refused,
reported */` note, matching the file's existing refusal idiom
(`xyMasterFloor()`, `brushAmount()`).

**Call sites audited** — all four dispatchers of `pushXY` were checked:
`pointerdown` (`:2503`), `pointermove` (`:2509`), `liftBrush` (`:2526`, bound to
both `pointerup`/`pointercancel` on the pad AND on `window`), and the
`spatialplay` replay (`:2498`). Only the replay is synthetic; it is the only one
that gained the marker. The page (`touch_control.html:4535/4547/4559`) emits
`spatialplay` with `{u, v, down, end}` only — it never carried a pointer id and
is **unchanged**. Both other reads of the old constant (the pen-up lookup
`:2478` and the create site `:2486-2492`) moved to the new key.

Style note: the file is deliberately ES5 `var`-style throughout for old-WebView
safety; the new code matches the file rather than `nodejs_style.md`'s
`const`/arrow rules, which target Node sources.

## 3. Files changed

| File | Change |
|---|---|
| `docs/ui/touch_control_wire.js` | `TAKE_POINTER_ID` → `TAKE_CONTACT_KEY = 'take-playback'`; new `spatialContactKey(e)`; `pushXY` resolves through it and refuses loudly; `spatialplay` replay carries `spatialPlayback: true` |
| `marsin_engine/tests/effects/touch_control_wire_layers_contract.test.js` | W2's `id: TAKE_POINTER_ID` pin retargeted to `TAKE_CONTACT_KEY` (intent preserved); **new test** pinning the whole shape |
| `simulation/tests/touch_control_spatial_stroke_ids.test.js` | header rewritten (the flagged quirk is now the fixed defect); the fractional-id expectation flipped from 2 strokes to 3; **two new tests** |

Nothing else was touched. No engine source, state, config or scene file.

## 4. Regressions added

**`simulation/tests/touch_control_spatial_stroke_ids.test.js`** (real puppeteer,
real page; pathological ids delivered by dispatching a plain `Event` with
`.pointerId` assigned directly, since Chromium's `PointerEvent` constructor
coerces `pointerId` to a signed 32-bit `long`):

- *a non-integer real pointer id paints its own stroke and never aliases the
  playback contact* — opens a TAKE playback contact FIRST, so aliasing would be
  **observable** rather than merely silent, then lands `8589934592.25`. Proves:
  it gets its own distinct compact slot; both contacts appear in `strokes[]`;
  the playback stroke's target is **byte-identical before and after** (the
  finger did not write into it); dragging the fractional finger moves only its
  own stroke; lifting it releases only its own slot and leaves the take
  painting; no page errors.
- *a replayed TAKE still paints through the synthetic-event path and lifts on
  pen-up* — the focused playback coverage the coordinator asked for, since the
  marker replaced the mechanism that used to deliver playback samples. Proves
  the contact is created on the first frame, owns a compact slot, is *stable*
  (later frames move it rather than opening a second contact), and that pen-up
  retires it, releases the slot, and drops `touch` to `false`.
- The existing *huge and fractional ids* test now asserts **3** strokes where it
  asserted 2. That flip is the differential proof this fix is not vacuous: the
  fractional pointer that the suite previously had to prove at slot-allocation
  level only now reaches the actual wire payload.

**`touch_control_wire_layers_contract.test.js`** — new source pin *"a spatial
sample declares its contact — the playback key is unreachable from any real
pointer"*: `Number.isInteger(e.pointerId)` may never reappear; the playback key
must not be a `0x…` literal; `spatialContactKey` must return `TAKE_CONTACT_KEY`
only on the explicit marker, return `e.pointerId` otherwise, and `fail(...)` on
anything else; the replay must carry the marker.

## 5. Validation

All offline. No live port bound, no live write, no restart, no git command.

| Gate | Result |
|---|---|
| `node --check docs/ui/touch_control_wire.js` (after every save) | **PASS** |
| `simulation`: `touch_control_spatial_stroke_ids` | **6 pass, 0 fail** (was 4) |
| `simulation`: `live_touch_ui_layout` + `touch_control_arm_brush_geometry` | **14 pass, 0 fail** |
| `marsin_engine`: `touch_control_wire_layers_contract` | **35 pass, 0 fail** (was 34) |
| `python scripts/security_check.py --all` | 6 findings, **all pre-existing**, all in gitignored `simulation/.scene_backups/studiodj/**/controllers.yaml` (MAC addresses in untouched backup residue, identical to the `_302` baseline). **Zero findings in any file this wave touched.** |

Net new tests: **+3** (2 behavioral, 1 source pin).

The `live_touch_ui_layout` case *"native touch events produce one canonical
spatial contact and no ghost contacts"* — the suite's own playback/contact
guard — passes unchanged.

## 6. Deployment

**ENGINE RESTART: NOT REQUIRED.** No engine source, state, config or scene file
changed. **No CaptainPad rebuild required** — no CaptainPad source changed.

Everything landed is `docs/ui/touch_control_wire.js` (hot-served) plus two test
files. The operator needs **an iPad RELOAD and nothing else**: tap the Live
Touch header **RELOAD** while DISARMED so the WebView pulls the changed asset.

Optional confirmation on the pad (writes to the rig, operator's call when):
paint a multi-finger stroke in SPATIAL and confirm no red pill; then record a
TAKE and PLAY/LOOP it, confirming the replayed stroke paints and stops cleanly
at the end of playback — that is the path whose delivery mechanism changed.
