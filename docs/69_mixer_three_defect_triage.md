# 69 — Mixer defect triage: drag-start scroll glitch, the portrait rail that is STILL 0 pt, and a patterns-first landscape card

**Status:** DESIGN — ready for ONE Opus implementer session (operator
pipeline: Fable designs, Opus implements + validates) ·
**Author:** Fable (design report `_280`) · **Operator:** Sina Solaimanpour

Three operator orders, verbatim, from live iPad testing of the freshly
rebuilt pad (post-`_275`/`_277`/`_279` tree):

> 1. "the slider locking the scrolling is working, but has a tiny glitch at
>    the very start, can you make it faster to not show that glitch please"
> 2. "the captain pad ipad still shows no master output and the hide show
>    bar at the top → fix please and verify with screenshot — in the
>    horizontal layout only is showing, vertical no show!"
> 3. "in horizontal layout the pattern list is basically not showing up to
>    select patterns, that's bad — rethink the layout to make the patterns
>    themselves show up please"

Related canon: `docs/67` + `_275` (the wave item 2 REGRESSES-OR-SURVIVES),
`_263` (scroll-lock seam), `docs/64` + `_270` (card anatomy), `_279`
(params-room wave — item 3 composes with it, and its §5/§6 are load-bearing
here). All numbers below were measured tonight on a scratch stack: fresh
dist export of the current tree on :7189, black-holed engine :17989
(TEST-NET-1 `192.0.2.9` only, no Art-Net, `controllers: []`, state/playlists/
timeline redirected, auth off), 3 channels seeded from the operator's real
`titanic` playlists; live :6966-:6972/:6981 never bound and answered 200
before and after; all scratch ports verified FREE after teardown. Probe
artifacts: `~/tmp/mixer_three_design/`.

---

## 1. Item 2 first — the portrait rail is STILL 0 pt, and now we know exactly why

### 1.1 The `_275` fix is provably inert on native Yoga

`_275` W2 shipped `masterBarFillPortrait: { flexGrow:0, flexShrink:0,
flexBasis:'auto' }`, composed as
`[styles.masterBarFill, isPortrait && styles.masterBarFillPortrait]`. The
flattened portrait style is therefore
`{ flex:1, flexGrow:0, flexShrink:0, flexBasis:'auto', minWidth:0 }` — the
base style's `flex: 1` is a DIFFERENT key from the three longhands, so
flattening never removes it.

Yoga resolves that composition differently from CSS, **from this app's own
vendored source**
(`CaptainPad/node_modules/react-native/ReactCommon/yoga/yoga/node/Node.cpp:329-339`):

```cpp
Style::SizeLength Node::processFlexBasis() const {
  Style::SizeLength flexBasis = style_.flexBasis();
  if (!flexBasis.isAuto() && !flexBasis.isUndefined()) {
    return flexBasis;                       // explicit *lengths* win…
  }
  if (style_.flex().isDefined() && style_.flex().unwrap() > 0.0f) {
    return config_->useWebDefaults() ? StyleSizeLength::ofAuto()
                                     : StyleSizeLength::points(0);   // …but
  }                                         // an explicit 'auto' FALLS THROUGH,
  return StyleSizeLength::ofAuto();         // and flex:1 forces basis 0 on
}                                           // native (web defaults are off)
```

`resolveFlexGrow()` (same file, :426) honors the explicit `flexGrow: 0`. Net
resolution on the device: **grow 0 · shrink 0 · basis 0 → the bar is a
deterministic 0 pt**, exactly as tall as the original bug. On
react-native-web the same flattened object becomes real CSS longhands, and
in CSS `flex-basis: auto` DOES override the `flex: 1` shorthand — content
height, rail visible. That is why every web screenshot passed twice while
the device failed twice.

**Executed differential proof** (yoga-layout 3.x = the WASM build of this
same C++ algorithm; probe script `~/tmp/mixer_three_design/yoga_probe/probe.mjs`),
portrait chain modeled as shipped (definite-height screen column →
auto-height `masterRow` column → content column 30 pt + seat holding a 36 pt
bar):

| Seat composition | Yoga height |
|---|---|
| pre-`_275` `{flex:1}` | **0** (the `_273` bug) |
| shipped `_275` `{flex:1, grow:0, shrink:0, basis:'auto'}` | **0** (fix inert) |
| `{}` — no flex-family keys at all | **36** ✓ |
| `{flex:0, grow:0, shrink:0, basis:auto}` | **36** ✓ |

Ruled out: a stale device bundle. The operator's same test round confirms
the `_275` W4 scroll lock works (item 1: "the slider locking the scrolling
is working"), and W2/W4 edited the same file in the same session — a bundle
carrying W4 carries W2. The style is on the device; the style is the bug.

"No master output" in the same breath: `masterCanvasColumn` is content-sized
and cannot collapse (verified: `ChannelVizStrip` always renders its
fixed-height strip), but with the rail at 0 pt the whole portrait master
block is a ~26 pt label + 12 pt sliver — which an operator reasonably reads
as "nothing at the top". Restoring the rail restores the landscape grammar
(label + strip + rail) that he calls "showing" in horizontal. Confidence:
root cause **high** (algorithm executed, all four evidence cells explained);
that no SECOND native-only defect hides behind it: **medium-high** — the
device screenshot in the acceptance is the closing evidence.

### 1.2 Why `_275`'s verification missed it — and what must change

Web screenshots cannot execute Yoga, and the `_275` source guard pinned the
**property name** (`flexBasis: 'auto'`) — i.e. it pins the exact property
Yoga cannot honor in this composition. The guard enforces the bug. The
verification this contract mandates (W1) runs the REAL algorithm in vitest.

## 2. W1 — portrait seat, fixed for real (item 2)

1. **Style SELECTION, not override composition** (D1). The seat becomes
   `style={isPortrait ? MASTER_BAR_SEAT_PORTRAIT : MASTER_BAR_SEAT_LANDSCAPE}`
   with the two objects exported from a pure module
   (`components/mixer/mixer_workspace_bar_logic.ts` — already the bar's pure
   brain): `LANDSCAPE = { flex:1, minWidth:0 }` (byte-equal to today),
   `PORTRAIT = { minWidth:0 }` — **no flex-family key exists in the portrait
   object**, so the `processFlexBasis` trap is structurally unreachable and
   Yoga's defaults (grow 0 · shrink 0 · basis auto) size the seat to its
   content. `styles.masterBarFill`/`masterBarFillPortrait` retire.
2. **Flip the `_275` guard.** `mixer_polish_source_guards.test.ts` currently
   pins `flexBasis:'auto'` — replace with: portrait seat object contains
   NONE of `flex`/`flexGrow`/`flexShrink`/`flexBasis` (trivially assertable
   now that the object is pure), landscape seat deep-equals `{flex:1,
   minWidth:0}`, and `mixer.tsx` consumes the two exports (source-text pin).
3. **Yoga-executed regression test** (D2): devDependency `yoga-layout@^3`
   (WASM build of the same C++ Yoga RN vendors; dev-only, playa runtime
   untouched). New `components/mixer/master_bar_seat_yoga.test.ts` builds
   the portrait chain from the REAL exported seat objects and asserts: the
   two historical compositions (flex:1 alone; flex:1 + the `_275` longhands)
   compute 0 — documenting the class — and the shipped seat computes the
   bar's content height. This test fails on BOTH prior attempts; it is the
   net that was missing.
4. **Class sweep.** The only other `flexBasis:'auto'` sites
   (`mixer_scroll_layout.ts`, `_279`'s collapsed panels) compose over
   LONGHAND-only bases (`flexGrow`/`flexBasis:0` — no `flex` shorthand), so
   they resolve correctly; add one assertion to their existing test pinning
   "no `flex` shorthand co-flattens with these constants" so the trap can't
   be introduced later. Note for all future work: **never override a
   `flex: N` base with longhands on native — select, don't fight.**

*Accept:* Yoga test red-on-old/green-on-new (mutation-check both prior
compositions); style-invariant + consumption guards green; web portrait
1024×1366 screenshot: rail full-width (912×36 measured tonight) below the
MASTER OUTPUT block, byte-comparable to today's web render; landscape
screenshots byte-identical; **operator device screenshot** (the order asked
for it explicitly): MIXER in portrait showing MASTER OUTPUT label + thin
strip + chip rail, chips pressable, landscape unchanged. An agent cannot
produce that native screenshot — the handoff scripts the 20-second check
and says so plainly.

## 3. W2 — the drag-start glitch (item 1)

### 3.1 Mechanism

`HorizontalFader` claims at touch-down (`onStartShouldSetPanResponderCapture`
→ grant) and `lockScroll()` runs FIRST in grant — acquisition timing is
already optimal. The latency is in **propagation**: acquire → notify →
`useSyncExternalStore` → React re-render of every `LockableScrollView` →
commit → Fabric mount → `scrollEnabled=false` reaches the `UIScrollView`.
That is ≥1-2 frames. `UIScrollView`'s pan recognizer begins after ~10 pt of
travel; a performance-speed drag (~1000 pt/s ≈ 16 pt/frame) covers the slop
inside the window, so the host pans for a few frames and then freezes — the
operator's "tiny glitch at the very start". (Worst case the native cancel
also terminates the drag; the fader's terminate handler commits and
releases, which is why it reads as a glitch rather than a loss.)

### 3.2 Design — a synchronous native fast path in the HOST

`LockableScrollView` (the one file every enlisted host shares) gains, next
to its existing render path:

- an internal ref composed with the forwarded ref;
- a `useEffect` subscription to `subscribeScrollLock` whose listener —
  gated `Platform.OS !== 'web'` — resolves the target value and calls
  `getNativeScrollRef()?.setNativeProps({ scrollEnabled: target })`.
  Fabric's `setNativeProps` is a real synchronous UI-thread update in this
  RN version (verified:
  `Libraries/ReactNative/ReactFabricPublicInstance/ReactFabricHostComponent.js:137`
  builds the payload and calls the Fabric `setNativeProps`), so the disable
  lands inside the same frame as the grant — well inside the pan slop.

Value resolution is split, deliberately:

- **Render path (unchanged, the source of truth):**
  `scrollEnabled={locked ? false : scrollEnabled}` — the caller's prop,
  including `undefined`, passes through verbatim when idle (`_263` pin).
- **Fast path (native-only):** lock → `false`; unlock →
  `scrollEnabled ?? true` (a host that never set the prop is natively
  `true`; `setNativeProps` cannot express "unset"). The very next render
  reconverges the two paths by construction — the rendered value changes on
  every lock transition, so React re-applies it.

Extract `resolveFastPathScrollEnabled(locked, callerProp)` into
`scroll_lock.ts` (pure TS) so the undefined-coercion rule is vitest-pinned,
not implied. `scroll_lock.ts`'s store is untouched (notify is already
synchronous and transition-only). **Zero acquire-site changes** — fader and
hue dial keep their `_263` three-point seam; every acquirer benefits through
the shared host.

Escalation path, named and NOT taken: `react-native-gesture-handler`
blocking relations would kill the race at the recognizer level, but it is a
new native dependency (offline rule, blast radius) for a residual race the
fast path already shrinks below the slop threshold for realistic drags.

*Accept:* pure tests for `resolveFastPathScrollEnabled` (locked×prop
matrix, `undefined→true` only when unlocking); `native_gesture_armor`
source guards: fast path present + platform-gated + uses
`getNativeScrollRef` + unsubscribes on unmount + render ternary preserved
verbatim; web dist byte-identical behavior (hosts scroll normally, nothing
acquires); operator on-device: with ≥4 channels, 5 fast drags each on a
CHANNEL fader, a LOCAL PARAMS slider, and the portrait COLORS hue dial —
the host must not move a visible pixel at drag start, taps still change
nothing, scrolling returns on lift.

## 4. W3 — patterns-first landscape card (item 3)

### 4.1 Measured tonight (current tree, 3 channels, edit mode, landscape)

| Viewport | Card | PIXELS band block | Body (playlist+params) | Playlist list viewport | Full rows visible |
|---|---|---|---|---|---|
| 1194×834 | 339×553 | **208 pt** | 134 pt | **56 pt** | **0** (one partial) |
| 1194×834, pixels hidden | 339×553 | 59 pt (strip 31 + stub 28) | 277 pt | 199 pt | 3 |
| 1366×1024 | 397×743 | 208 pt | 324 pt | 246 pt | 4 |
| 1366×1024, pixels hidden | 397×743 | 59 pt | 467 pt | 389 pt | 6 |

Rows cost ~57 pt (27-entry playlist, scrollHeight 1547); the playlist
panel's own chrome (caption + dropdown row) costs ~78 pt; fixed card rows
(header 53, fader 30, hue 23, MUTE/SOLO 45, TRANSITION 52) ~203 pt. `_279`
measured the same geometry independently (~24 pt list at its probe state)
and proved hiding params buys landscape WIDTH only — "no flex rule can turn
horizontal space into rows... the thing eating it is the 2D pixel band."
And `_279` §6 found the cliff beyond the squeeze: **landscape + MASTER VIEW
open crushes the body to literally zero** (283×0 list, rows painting over
each other) because the landscape panels never got portrait's W0 bounded
chain. The operator's "basically not showing" is this geometry, possibly
including that cliff.

### 4.2 The rethink — one body grammar for edit and perf

`_279` §5 already sized the right mechanism and left it awaiting operator
authority; order 3 is that authority. In **landscape edit mode** the pixel
band leaves the card's vertical stack and mounts in the RIGHT column of the
body, ABOVE the LOCAL PARAMS scroller — the body becomes:

```
┌───────────────────────── channelBody (flex:1) ─────────────────────────┐
│  patterns column (grower)   │  media column (~40%, bounded)            │
│  PlaylistPanel, FULL body   │  2D band, aspect-fit to column width     │
│  height                     │  LOCAL PARAMS header + scroller below    │
└─────────────────────────────┴──────────────────────────────────────────┘
```

This is perf mode's proven grammar (band already occupies the params column
there, `_243`/`_270`) extended to edit mode — after W3 the mixer has ONE
landscape body shape, with the column holding band+params (edit) or band
(perf) or stubs (hidden). The top-of-card thin strip keeps its docs/64 §3.5
rule (renders only while pixels hidden). Portrait is untouched (already
fixed by `_279`: 2 → 4 rows).

Resulting budget: fixed rows drop from ~411 pt to ~203 pt. Patterns column
gets the full body height:

- 1194×834: body 134 → ~350 pt; list viewport 56 → ~260 pt = **4-5 full
  rows** with everything default-shown (vs 0 today).
- 1366×1024: body 324 → ~540 pt; list ~450 pt = **7-8 rows** (vs 4).
- Edit-mode band shrinks to column width: ~135 pt wide → ~72 pt canvas at 3
  visible (vs 337×176 today); ~228 → ~122 pt at 2 visible. Aspect stays
  honest (`bandCanvasSizeForAspect` untouched — only its slot input
  changes); the master band and the perf dominant view are untouched. This
  trade is the design's one real cost and it is exactly the trade the
  operator ordered (D4 records the veto).

**Composition with `_279` (mandatory):** its `mixerParamsColumnMode` +
collapsed/expanded constants remain the authority. In the new structure:
params hidden → media column = band + params stub (band keeps the column);
pixels hidden → strip on top of card + media column = stub + params; BOTH
hidden → the column hugs its stubs and the playlist expands to nearly the
whole card — `_279`'s payoff, amplified. The applies-last discipline of its
style arrays is preserved; W3 rebases onto the landed `_279` code, never
reverts it. Clear widths with `'auto'`, never `undefined` (`_279`'s RNW
trap, now test-pinned).

**Crush bug = LANDED SUBSTRATE, not this wave's work (coordinator ruling,
2026-08-16 evening).** The `_279` §6 landscape+MASTER-VIEW-open crush is
being fixed by a DEDICATED, operator-green-lit Opus agent that owns
`app/(tabs)/mixer.tsx` + `components/mixer_scroll_layout.ts` right now and
lands a bounded-flex-chain fix (the landscape twin of the portrait W0 fix)
in the `_280+` report range. W3 does NOT implement it and MUST NOT
double-fix it: this design assumes a world where the master band no longer
crushes `channelBody`, and the remaining structural problem W3 owns is the
vertical budget itself — ~24-56 pt of pattern list with the band open, and
width-not-rows on params-hide. The W3 owner rebases onto that agent's
landed panels exactly as onto `_279`'s (read its report first — tracker
tail, `_281`-range); if it has NOT landed when the session starts, W3
**blocks and waits** — it may not race the same files. The restructure
still removes 208 pt from the vertical stack, so on top of the substrate
the master-band-open case retains a usable list (~2 rows at 834) by
geometry, and W3's acceptance re-proves that as NON-REGRESSION, crediting
the substrate wave.

**Riders, P2, individually vetoable:** (R1) compact playlist rows in the
mixer mount — `minHeight 44` (docs/66 floor kept exactly) vs today's ~57 →
+~30 % rows; scoped by prop so the DECK's PlaylistPanel mount is
pixel-identical (chip/contrast suites re-run as proof). (R2) merge the
`CH n · PLAYLIST` caption row with the assignment dropdown row (~30 pt
back).

*Accept (measured on the scratch dist, both viewports, 2 AND 3 visible):*
at 1194×834 with everything default-shown: **≥4 fully visible pattern rows
per card** (today 0); at 1366×1024: **≥7** (today 4). With R1: ≥5 / ≥8.
Landscape + MASTER VIEW open: list viewport > 100 pt, no overlap painting —
asserted as NON-REGRESSION over the dedicated crush-fix substrate (that
wave owns the fix; W3 must merely not reintroduce the crush). Params-hidden still frees
width/space (`_279`'s probe re-run green). Perf mode enter/exit
byte-identical store round-trip; perf screenshots unchanged vs tonight's.
Band canvas ≥ `MIN_BAND_CANVAS_HEIGHT` (72) and aspect-honest at every
count 1-4. Zero engine calls; floor-of-one untouched; no new scroll hosts
(the params scroller is already the enlisted `LockableScrollView`; the band
is not scrollable).

## 5. W4 — validation walk (Opus, last, no product files)

Suites vs baseline (**2291 pass / 0 fail** as of `_279` — re-baseline the
same minute; more agents are landing tonight), tsc/eslint, security scan on
touched files. Screenshot matrix, web scratch dist: landscape 1194×834 and
1366×1024 × {default, pixels hidden, params hidden, both hidden, MASTER
VIEW open, perf} + portrait 1024×1366 {default, perf}; every PNG visually
inspected. Persistence round-trip (reload restores; upgrade store unchanged
semantics). The three operator device checks (W1 screenshot, W2 drags, W3
row counts) written as ONE two-minute script in the handoff.

## 6. Decisions (defaults chosen; one-line vetoes welcome)

| # | Decision | Default |
|---|---|---|
| D1 | Portrait seat fix shape | **Style selection — portrait object carries NO flex-family keys** (the trap is co-presence; absence is provable). Alt: `flex:0` override (equally correct per the probe, but leaves the fighting pattern alive) |
| D2 | Native-layout regression net | **Add `yoga-layout@^3` devDependency** + the executed-layout test (would have caught both failed attempts). Alt: style-invariant test only (blind to novel Yoga divergences) |
| D3 | Glitch fix mechanism | **Synchronous `setNativeProps` fast path in `LockableScrollView`**, web-gated, render path unchanged as truth. Alt: status quo render-only (measured 1-2 frame hole) |
| D4 | Landscape edit band placement | **Into the media column beside patterns** (edit band shrinks to ~135-228 pt wide; perf + master untouched) — `_279` §5's sized option, now operator-ordered. Alt: keep full-width band with a height-aware cap (~96 pt at 834) — buys only ~1.5 rows, rejected |
| D5 | R1 row diet | **Compact 44 pt rows in the mixer mount** (docs/66 floor exact). Alt: keep 57 pt |
| D6 | R2 playlist chrome merge | **Merge caption + dropdown rows** (~30 pt). Alt: keep |
| D7 | `_279` §6 crush bug | **LANDED SUBSTRATE — owned by the dedicated crush-fix agent (coordinator ruling), NOT a W3 package.** W3 rebases on its landed panels, blocks if it hasn't landed, and re-proves non-regression only |
| D8 | `sec/<id>/pixels` fresh-store default | **Stays VISIBLE** — patterns priority is achieved structurally, no default flip |

## 7. Sequencing, files, collisions

- **W1 → W3 serialize** (both edit `mixer.tsx`); W2 is independent (ui/
  files only). One Opus session, order W1, W2, W3, W4.
- **W3 rebases on TWO landed substrates:** `_279` (LANDED) and the
  dedicated landscape crush-fix wave (in flight at design close, `_281`-range
  — the coordinator's operator-green-lit agent owning `mixer.tsx` +
  `mixer_scroll_layout.ts`). The implementer INHERITS a `mixer.tsx` that
  contains both. Never edit their constants except to extend
  `mixer_scroll_layout.ts` with the media-column styles beside them; if the
  crush fix has not landed at session start, **W3 blocks on it** — never
  race or double-fix the same files.
- The concurrent DECK debug thread owns `deck_workspace_layout.ts` /
  `app/(tabs)/index.tsx` — disjoint; verify at implementation start that
  mixer.tsx picked up no interim edits beyond the two named substrates
  (tracker check, same minute).
- Files: **W1** `app/(tabs)/mixer.tsx`,
  `components/mixer/mixer_workspace_bar_logic.ts` (+test),
  `components/mixer/mixer_polish_source_guards.test.ts` (flip),
  new `components/mixer/master_bar_seat_yoga.test.ts`,
  `CaptainPad/package.json` (devDep). **W2**
  `components/ui/lockable_scroll_view.tsx`, `components/ui/scroll_lock.ts`
  (+`scroll_lock.test.ts`), `components/native_gesture_armor.test.ts`.
  **W3** `app/(tabs)/mixer.tsx`, `components/mixer_scroll_layout.ts`
  (+test), `components/PlaylistPanel.tsx` (R1/R2, prop-scoped),
  `components/mixer/pixel_view_band_logic.ts` only if the media-column cap
  needs a named constant (sizing math untouched).
- Scratch discipline: exports to `C:/Users/TITANI~1/tmp/` (8.3), 71xx/179xx
  ports, TEST-NET-1 sACN, state/playlists/timeline redirected, ONE expo
  export machine-wide at a time, never `CaptainPad/dist`, no git ops.
  CaptainPad rebuild required at the end; no engine restart.

## 8. Must-not-change pins

1. `_263`/`_275` lock semantics: acquire on grant only at the sanctioned
   surfaces, release on release/terminate/unmount, idempotent, web inert;
   the three enlisted mixer hosts stay exactly three.
2. `_270`/`_275` workspace grammar: view-only hiding, zero engine calls,
   floor-of-one, known-set upgrade safety, thin-strip-only-when-band-hidden,
   perf as pure derivation with byte-identical round trip.
3. Paint engine (`pixel_paint_scheduler`, `PixelSurface`,
   `use_pixel_view_artifact`) untouched — W3 changes canvas SLOT inputs only.
4. Deck screens pixel-identical (shared chip, shared PlaylistPanel — suites
   + one deck screenshot compare).
5. docs/66 44 pt floor everywhere, including R1's compact rows.
6. Offline readiness: `yoga-layout` is dev-only; the app bundle gains no
   dependency.
