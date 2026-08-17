# _286 — Mixer: the portrait rail fixed for REAL (Yoga-executed proof) and the scroll lock lands in the same frame as the grant — `docs/69` W1+W2, PARTIAL

**Kind:** implementation + validation (Opus lead, Sonnet implementers) ·
**Contract:** `docs/69_mixer_three_defect_triage.md` W1 + W2 ·
**Design:** `_280` · **Operator:** Sina Solaimanpour ·
**Status:** **PARTIAL WAVE — W3 (patterns-first landscape card) still pending**,
lands separately as `_287` in this same session.

Two of the operator's three orders off the rebuilt pad are implemented and
gate-green. The third (landscape pattern list) is next and is now
unblocked — see §5, which is the most important section of this report for
anyone reading it as history, because the assumption the wave was sequenced
on turned out to be false.

---

## 1. W1 — the portrait rail (operator order 2)

### 1.1 What was actually wrong

`_275` shipped `masterBarFillPortrait: { flexGrow:0, flexShrink:0,
flexBasis:'auto' }` composed over `masterBarFill`'s `flex: 1`. Flattening
never removes the shorthand (different key), so the portrait style reaching
Yoga was `{ flex:1, flexGrow:0, flexShrink:0, flexBasis:'auto', minWidth:0 }`.
This RN's vendored `processFlexBasis` returns an explicit basis only when it
is *neither auto nor undefined* — an explicit `'auto'` falls through, and the
co-flattened positive `flex` then forces **basis 0** on native (web defaults
off), while the explicit `flexGrow: 0` *does* win. Resolved on the device:
grow 0 · shrink 0 · basis 0 = **0 pt**, the identical zero the `_273` bug
produced. `_275` changed the style without moving the number.

CSS resolves the same object the other way (longhands beat the shorthand),
which is why web screenshots passed twice while the iPad failed twice — and
the `_275` source guard pinned `flexBasis:'auto'` by name, so **the guard was
enforcing the bug**.

### 1.2 The fix — selection, not composition

The seat is now SELECTED between two pure exported objects in
`components/mixer/mixer_workspace_bar_logic.ts` (the bar's existing pure
brain, still zero-RN-import):

- `MASTER_BAR_SEAT_LANDSCAPE = { flex: 1, minWidth: 0 }` — byte-equal to the
  old `masterBarFill`; the orientation that was never broken is untouched.
- `MASTER_BAR_SEAT_PORTRAIT = { minWidth: 0 }` — **no flex-family key exists
  in the object at all**, so the `processFlexBasis` trap is structurally
  unreachable and Yoga's own defaults (grow 0 · shrink 0 · basis auto) size
  the seat to its content.

`mixer.tsx` renders `<View style={isPortrait ? MASTER_BAR_SEAT_PORTRAIT :
MASTER_BAR_SEAT_LANDSCAPE}>`; `styles.masterBarFill` and
`masterBarFillPortrait` are deleted. Both objects are `as const` rather than
annotated `ViewStyle` **on purpose**: the annotation would widen the type and
hide the very property the fix depends on, whereas the inferred type lets the
compiler itself carry "portrait has no flex key".

**The rule this wave banks: never override a `flex: N` base with longhands on
native — select, don't fight.**

### 1.3 The net that was missing — Yoga EXECUTED in vitest

`yoga-layout@3.2.1` is now a **devDependency** (dev-only; the app bundle gains
nothing, offline readiness untouched). It is the WASM build of the same C++
algorithm RN vendors, so `components/mixer/master_bar_seat_yoga.test.ts` runs
the REAL layout engine over the shipped portrait chain (definite-height screen
column → auto-height `masterRowPortrait` column → 30 pt canvas column + the
seat holding a 36 pt chip row), importing the REAL exports rather than copies.

| Seat composition | Chain | Yoga result |
|---|---|---|
| pre-`_275` `{flex:1, minWidth:0}` | portrait | **0** (the `_273` bug) |
| shipped `_275` `{flex:1, minWidth:0, flexGrow:0, flexShrink:0, flexBasis:'auto'}` | portrait | **0** (the fix was inert) |
| `MASTER_BAR_SEAT_PORTRAIT` (real export) | portrait | **36** |
| `MASTER_BAR_SEAT_LANDSCAPE` (real export) | landscape | **250** of a 400 pt row |

Mutation-verified: setting the portrait export to either historical
composition turns this test RED. **This test fails on both prior attempts** —
it is precisely the class of proof web screenshots can never provide, and the
reason this item is being reported with confidence rather than hope.

The stale `_275` guard is flipped (`mixer_polish_source_guards.test.ts`): the
portrait seat is asserted to carry none of `flex`/`flexGrow`/`flexShrink`/
`flexBasis` **structurally, over `Object.keys` on the real object**; landscape
deep-equals `{flex:1,minWidth:0}`; `mixer.tsx` is pinned as consuming both
exports; and the old fighting shape is pinned as unable to return (by
StyleSheet-key form, since mixer.tsx's explanatory comment narrates the old
names in prose and `stripComments` removes it — verified directly, not
inferred).

## 2. W2 — the drag-start glitch (operator order 1)

Acquisition timing was already optimal: `HorizontalFader` claims at touch-down
and `lockScroll()` runs first in grant. The hole is **propagation** — acquire →
notify → `useSyncExternalStore` → re-render → Fabric commit is 1-2 frames
before `scrollEnabled=false` reaches the `UIScrollView`, whose pan recognizer
starts after ~10 pt of slop; a performance-speed drag (~1000 pt/s ≈ 16 pt per
frame) covers the slop inside that window, so the host pans briefly and then
freezes. That is the operator's "tiny glitch at the very start".

`LockableScrollView` now carries a **synchronous native fast path** beside its
render path: an internal ref composed with the forwarded ref, and a
`useEffect` subscription to `subscribeScrollLock` whose listener — gated
`Platform.OS !== 'web'` — calls
`getNativeScrollRef()?.setNativeProps({ scrollEnabled: … })`. The effect
returns the unsubscribe.

Value resolution is split deliberately, and the split is pure and pinned:

- **Render path (unchanged, the truth):** `scrollEnabled={locked ? false :
  scrollEnabled}` — the caller's prop, `undefined` included, passes through
  verbatim (`_263` pin, byte-identical).
- **Fast path:** `resolveFastPathScrollEnabled(locked, callerProp)` in
  `scroll_lock.ts` — lock → `false`; unlock → `callerProp ?? true`, because
  `setNativeProps` cannot express "unset" and a host that never set the prop
  is natively `true`. The next render reconverges the two by construction.

`scroll_lock.ts`'s store is untouched and the module stays RN-import-free.
**Zero acquire-site changes** — fader and hue dial keep their `_263` seam.

### 2.1 The assumption check `_275` skipped

The design's mechanism was verified against this RN (0.81.5) rather than
taken on trust, specifically because this wave exists because a previous fix
was *provably inert*:

- `getNativeScrollRef` is a real declared imperative method on `ScrollView`
  returning `HostInstance | null`.
- `ReactFabricHostComponent.setNativeProps` genuinely builds an update payload
  and applies it through Fabric.
- **`scrollEnabled` is present in `validAttributes` for BOTH ScrollView native
  configs.** This is the one that mattered: `setNativeProps` filters the
  payload through `validAttributes`, so had `scrollEnabled` been absent the
  fast path would have been silently inert — the exact failure mode of `_275`,
  one layer down. It is present; the payload carries it.

Escalation path named and NOT taken: `react-native-gesture-handler` blocking
relations would kill the race at the recognizer level, but that is a new
native dependency (offline rule, blast radius) for a residual race the fast
path already shrinks below the slop threshold.

**Honest limit on the numbers:** the before-figure (1-2 frames) and the
after-figure (same frame as grant) are derived from the mechanism and the
verified synchronicity of Fabric `setNativeProps`, not measured on a device —
an agent cannot instrument frames on the operator's iPad. The closing evidence
is the device check in §6.

## 3. Gates

- **CaptainPad vitest: 2328 pass / 0 fail / 6 skipped (107 files).**
  Re-baselined the same session at **2312/0** (the `_280` figure of 2291 had
  already moved as other threads landed). Delta reconciles exactly:
  +11 W2 (6 resolver matrix, 5 source guards), +4 Yoga, +1 guard block.
- `tsc --noEmit` clean. `expo lint` **0 errors** (13 warnings, all pre-existing
  in files this wave never touched — verified none are in a touched file).
- Security scan: no finding in any touched file. (`--all` reports 82
  pre-existing findings, all in `.agent/reports`, `.agent/memory`,
  `.agent/projects` and `simulation/.scene_backups` — untouched by this wave.)
- **Web non-regression probe** (scratch dist, own static server + black-holed
  scratch engine on TEST-NET-1): portrait 1024×1366 master-bar seat measures
  **912 × 36 px — byte-identical to `_280`'s pre-change baseline of 912×36**,
  chips on ONE full-width row; landscape 1194×834 seat 927.67 × 36, still
  claiming the row remainder. Both PNGs visually inspected by the lead: MASTER
  OUTPUT label, viz strip and the six-chip rail all present and correctly laid
  out. Web was never broken and **web did not change** — which is exactly the
  required result, since the defect was native-only.
- Scroll hosts still scroll on web (W2 non-regression): LOCAL PARAMS and the
  playlist lists overflow and scroll in both orientations; the channel-strip
  row scrolls at its portrait threshold. No element left frozen.

## 4. Files

**W1:** `CaptainPad/components/mixer/mixer_workspace_bar_logic.ts` (seat
exports), `CaptainPad/app/(tabs)/mixer.tsx` (seat selection + import; the two
dead styles removed), `CaptainPad/components/mixer/master_bar_seat_yoga.test.ts`
(new), `CaptainPad/components/mixer/mixer_polish_source_guards.test.ts`
(guard flipped), `CaptainPad/package.json` + `package-lock.json`
(`yoga-layout` devDep — **exactly that one line**, see §5.3).
**W2:** `CaptainPad/components/ui/lockable_scroll_view.tsx`,
`CaptainPad/components/ui/scroll_lock.ts`,
`CaptainPad/components/ui/scroll_lock.test.ts`,
`CaptainPad/components/native_gesture_armor.test.ts`.

No git operations. `CaptainPad/dist` never written. Live stack
:6966-:6972/:6981/5568 never bound or restarted (:6968 answered 200 before and
after the probe); scratch dist server :7195 and scratch engine :17995 both
stopped and their ports verified FREE.

## 5. Deviations and findings — reported, not hidden

### 5.1 The crush-fix substrate never existed (the big one)

This wave was sequenced on the ruling that a dedicated agent owned and would
land the landscape + MASTER-VIEW-open crush fix as substrate for W3, and that
W3 must not double-fix it. **That agent did not fix it.** Its report
(`_285` — `20260816_285_mixer_landscape_master_band_crush.md`; it was
renumbered from `_284` in tonight's fourth numbering collision, after which
the coordinator began RESERVING report numbers for active agents — `_284`
belongs to the Live Touch design) reproduced and
root-caused the defect, **modified no source file**, ran no gates, and handed
the fix back to `docs/69` item 3.

It also **disproved the premise** `docs/69` §4.2 and D7 rest on. The crush is
NOT the landscape twin of the portrait W0 bounded-flex fix: portrait's
`channelBody` is a COLUMN where `flexBasis:0`+grow+shrink governs height,
landscape's is a ROW where height comes from `align-items: stretch`, and the
landscape panels already resolve correctly. The real cause is that the card is
**over-subscribed**: `channelCard`'s height is exogenous, `channelBody`
(`flex:1`) is its only shrinkable child, and opening the citizen takes 136 pt
off the strip row while 411 pt of unshrinkable chrome stays — of which the
per-channel PIXELS band is **208 pt, half the card**. The body is entitled to
exactly 0. Every in-scope candidate was measured and rejected; its conclusion
is "the landscape card needs to shed a block, not trim one".

Consequence for W3, ruled with the coordinator: W3 is now the ONLY remedy on
the table and relieves the crush **by construction**, because relocating the
208 pt band out of the card's vertical stack is precisely the block-shedding
`_285` points at (and `_243` resolved the same budget the same way). W3 will
therefore PROVE the crush relief with a before/after measurement, not assert
non-regression as the contract originally assumed. `CHANNEL_EDIT_CAP_HEIGHT`
stays untouched — `_279` and `_285` have both escalated lowering it to Sina,
and W3 sidesteps it by moving the band rather than shrinking it in place.

### 5.2 Process deviations

- **File-ownership waiver, moot in the end.** The coordinator waived the
  ownership rule for exactly the ~5-line master-row region of `mixer.tsx`
  while the crush agent was believed to own the file. By the time the edit
  ran, that agent had landed having modified no source file, so the regions
  were free and no concurrent edit existed. Region-disjointness was verified
  immediately before editing anyway (master row ~L3290/~L3996-4025 vs the
  crush territory `channelBody` ~L1146 and styles ~L4372-4427).
- **The lead wrote the `mixer.tsx` edit personally**, departing from the
  "Sonnet writes all code" pipeline, to minimise tool calls inside what was
  then a contested file. Every other line in this wave was written by Sonnet
  sub-agents and reviewed by the lead. Recording it because the pipeline is
  the operator's, not mine to quietly amend.

### 5.3 Undeclared dependency found in another thread's work — NOT touched

`CaptainPad/components/deck/pixel_paint_target_skia.ts` and
`components/deck/pixel_surface.tsx` import `@shopify/react-native-skia`, which
is present in `node_modules` but declared in **no** `package.json`. The
`yoga-layout` install tried to reconcile it into the tracked manifest; that
incidental addition was stripped, so this wave's `package.json` delta is
exactly the one `yoga-layout` line (verified against git). Whoever owns the
pixel-surface work should add that dependency deliberately — otherwise the
next `npm install` in this checkout keeps picking it up as a side effect of an
unrelated wave. Coordinator is tracking it.

### 5.4 Note for other agents

`npm install` ran once in `CaptainPad` for the devDep, which can invalidate
Metro caches for other agents' exports. The launcher's fingerprint guard
handles the operator's Metro on next start.

## 6. Operator device checklist (the part an agent cannot do)

Both items need the physical iPad; neither is provable from an agent's web
build. **CaptainPad rebuild REQUIRED** before these; no engine restart.

1. **Portrait rail (order 2, ~20 seconds).** Open MIXER, hold the pad in
   PORTRAIT. Expect, top to bottom: the `MASTER OUTPUT` label, the thin
   colour strip, and **a full-width row of chips** (`1 · …`, `2 · …`, `HIDDEN`,
   `MASTER VIEW`, `COLORS`). Tap a chip — it must open/close its surface.
   Then rotate to LANDSCAPE and confirm it looks exactly as it does today.
   *Before this fix that chip row was 0 pt tall — invisible — which is what
   read as "no master output and no hide/show bar".* A screenshot of portrait
   MIXER is the evidence the order asked for.
2. **Drag-start glitch (order 1, ~60 seconds).** With at least 4 channels
   visible, do 5 FAST drags on each of: a CHANNEL fader, a LOCAL PARAMS
   slider, and the portrait COLORS hue dial. The pane under your finger must
   **not move a visible pixel** at drag start. Taps must still change nothing,
   and normal scrolling must return the instant you lift.

If either still misbehaves, that is a real finding — say so plainly; the Yoga
test proves the portrait geometry on the real algorithm, so a remaining
portrait failure would mean a SECOND defect stacked behind the first.
