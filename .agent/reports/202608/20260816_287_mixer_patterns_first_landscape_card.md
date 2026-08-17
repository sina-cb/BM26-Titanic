# _287 — Mixer: the landscape card sheds a block and patterns become its first citizen; the MASTER-VIEW crush is FIXED, not worked around — `docs/69` W3 + R1

**Kind:** implementation + validation (Opus lead, Sonnet implementers) ·
**Contract:** `docs/69_mixer_three_defect_triage.md` §4 · **Design:** `_280` ·
**Crush analysis absorbed:** `_285` · **Prior art:** `_279` ·
**Partner report:** `_286` (W1+W2) · **Operator:** Sina Solaimanpour

Operator order 3 — *"in horizontal layout the pattern list is basically not
showing up to select patterns, that's bad — rethink the layout to make the
patterns themselves show up"* — plus his follow-up during the wave: *"great
idea to move the 2d pixels to the side when in horizontal view, but please make
sure the UI fits 2 layers properly without needing to scroll."*

**Read §5 before trusting any number here.** The final acceptance measurement
was destroyed by a live-stack incident and the last three fixes are unit-tested
but NOT browser-measured.

---

## 1. What shipped

In **landscape EDIT** the per-channel 2D PIXELS band leaves the card's vertical
stack and mounts at the TOP of the right-hand media column, above LOCAL PARAMS.
That is perf mode's already-proven grammar (`_243`/`_270`) extended to edit
mode, so the mixer now has ONE landscape body shape:

```
┌──────────────── channelBody (flex:1) ────────────────┐
│ patterns column (grower)  │ media column (bounded)   │
│ PlaylistPanel, FULL body  │ 2D band (aspect-fit)     │
│ height                    │ LOCAL PARAMS hdr+scroller│
└───────────────────────────┴──────────────────────────┘
```

Portrait keeps the band exactly where it was (a portrait card has no
side-by-side column to move it into — docs/64 §3.7 already special-cases
portrait perf the same way). Landscape perf and portrait perf are untouched.
The section wiring is identical at the new mount, so the chevron and the ⋮
menu's Show/Hide pixels row still dispatch the same `sec/<id>/pixels` action
and still agree.

New pure rule `mixerMediaColumnMode({perfActive,isPortrait,paramsShown,
pixelsShown})` in `mixer_scroll_layout.ts` delegates byte-for-byte to `_279`'s
`mixerParamsColumnMode` whenever `perfActive || isPortrait` — perf and portrait
resolve exactly as `_279` left them — and adds ONE branch: landscape edit is
`'full'` when `paramsShown || pixelsShown`, else `'stub'`. Landscape edit never
returns `'empty'` (asserted). `mixerLandscapeMediaBandSlot` bounds the band's
own slot (`flexShrink:1`, floor of header + `MIN_BAND_CANVAS_HEIGHT`,
`overflow:hidden`) so a starved column shrinks the band first and can never let
it paint over LOCAL PARAMS.

## 2. The crush is FIXED — and that is a change of ruling

`docs/69` D7 and this session's brief both assumed a dedicated agent would land
the landscape + MASTER-VIEW-open crush fix as substrate, and that W3 must only
assert non-regression over it. **That agent landed no code.** `_285`
root-caused the defect, modified no source file, and handed the fix back to
W3 — while disproving the premise: it is not the landscape twin of the portrait
W0 bounded-flex fix (landscape's `channelBody` is a ROW sized by
`align-items:stretch`, and its panels already resolve correctly), but an
**over-subscribed card**. `channelBody` is the only shrinkable child; opening
the citizen costs 136 pt while 411 pt of unshrinkable chrome stays, of which
the PIXELS band is **208 pt — half the card**. Its verdict: *"the landscape
card needs to shed a block, not trim one."*

Relocating the band IS that block-shedding, so W3 became the only remedy on the
table and the coordinator re-ruled it as a real fix to be proven, not a
non-regression to be asserted. Measured, 1194×834, 2 visible channels, MASTER
VIEW open:

| | `_285` before | after |
|---|---|---|
| `channelBody` | 515 × **0** | 515 × **180** |
| playlist scroller | 283 × **0** | 283 × **102-104** |
| LOCAL PARAMS | 206 × 16 | reachable |
| MUTE/SOLO | painted over | y=658, 9 pt clear of body bottom |
| TRANSITION | ejected from card | y=710, 24 pt inside the card |

No content paints outside the scroller. `CHANNEL_EDIT_CAP_HEIGHT` was **not**
lowered — W3 sidesteps it by MOVING the band rather than shrinking it in place,
exactly as `_243` resolved the same budget. It remains escalated to Sina
(`_279`, `_285`).

## 3. Rows

| Case | before | after | target |
|---|---|---|---|
| 1366×1024, 3 ch, default | 246 pt = **4 rows** | 428-430 pt = **7 rows** | ≥7 ✔ |
| 1194×834, 3 ch, default | 56 pt = **0 rows** | 238-240 pt = **3 rows** (pre-R1) | ≥4 — see §5 |

The 834 case missed by **3-5 pt** of row height, so `docs/69`'s **R1 rider**
was taken (its D5 default is ON; coordinator approved): compact playlist rows
in the MIXER mount at `minHeight: 44` — the docs/66 floor EXACTLY, never below
— with row padding 4→2. Scoped by a NEW `compactRows` prop threaded only from
`mixer.tsx`'s channel-strip mount, deliberately kept separate from the existing
`compact` prop because `DeckOverlayStack.tsx` also sets that one; neither
`split_playlist_panes.tsx` nor `DeckOverlayStack.tsx` passes `compactRows`, so
**the deck's rows are untouched** (pinned by a scope test, not assumed).

Honest limit: the implementer trimmed padding only, not the control-row button
heights or the sub-label line, so bare rows floor at exactly 44 (was ~45) and
sub-labeled + control rows go ~58 → ~54. That is the contracted `minHeight: 44`
but likely short of the design's "+~30 %" aggregate estimate.

**R1 is independently vetoable** — one line reverses it (drop `compactRows` at
the `mixer.tsx` mount) and the deck cannot be affected either way.

## 4. Two defects found and fixed inside the wave

**Both-hidden inverted the layout.** With pixels AND params hidden the media
column WIDENED to 247.64 pt and the playlist SHRANK to 89.7 pt — the opposite
of `_279`'s payoff. Cause: the collapsed column's `flexShrink:0` (a deliberate
`_279` choice, to keep the stub tappable) hugged `PixelViewBand`'s header at
its full 247.64 pt intrinsic width, because the header kept rendering its
`TOP-DOWN ▾` view-picker and `100/964` ratio while collapsed — neither is
load-bearing with the picture folded away. Fix: a new `compactWhenCollapsed`
prop hides that optional chrome while collapsed (the **chevron is never**
gated — it is the only way back, docs/64 §3.1), passed at the landscape-edit
mount ONLY; plus the collapsed column becomes `flexShrink:1` + `minWidth:44`
(docs/66 floor) + `overflow:hidden` as defence in depth.

**The band canvas was 2 pt under its own floor** (70 pt vs
`MIN_BAND_CANVAS_HEIGHT` 72). Not a slot bug: react-native-web's `View`
defaults to `boxSizing:'border-box'` and Yoga treats border the same way, so
the picture box — styled with the already-correct `computeBandCanvasSize`
result AND `borderWidth: 1` — delivered only `(w-2)×(h-2)` to the canvas. A
floored 72 rendered at exactly 70. Fix: the picture box now applies
canvas size + 2×border, named `PICTURE_BORDER_WIDTH` once. `bandCanvasSizeForAspect`,
`MIN_BAND_CANVAS_HEIGHT`, `pixel_paint_scheduler`, `PixelSurface` and
`use_pixel_view_artifact` are all untouched (contract pin #3). Note this fix is
**universal, not call-site scoped** — the border was eating 2 pt in every
placement including the master band — so §5's unmeasured list includes a
master/perf band regression check.

## 5. What is NOT verified — read this before believing §3

The final acceptance run never took a number: it died with the live-stack
incident in §7. **The three fixes in §4 and R1 in §3 are unit-tested but NOT
browser-measured.** Specifically unproven:

- 1194×834 reaching **≥4 rows** after R1 (it was 3 before R1).
- Band canvas reaching **≥72 pt** after the border fix, and staying
  aspect-honest at 1-4 visible channels.
- Both-hidden now collapsing toward the 44 pt floor instead of inverting.
- **The operator's 2-layers-no-scroll order.** Verified only STRUCTURALLY:
  `mixer.tsx`'s root is `{flex:1}` with no page-level ScrollView, the channel
  row is `{flex:1, minHeight:0}`, and `channelCard` is `alignSelf:'stretch'`
  with no unshrinkable height — so cards stretch to the scroller rather than
  forcing it taller, and all three fixes only reduce consumption. Not measured.
- No master-band / perf regression from the universal border fix.
- Deck pixel-identity after R1 (pinned by test; no screenshot).

Zero screenshots exist for W3 in any run: the first measurement pass lost the
browser pane's compositing (`document.visibilityState` stuck `hidden`, canvases
stopped painting), and the second never started. Every number in §2 and §3 is
DOM `getBoundingClientRect` geometry, which is trustworthy without compositing
— but nobody has looked at a picture of this card.

## 6. The operator's 3-layer scrolling report — investigated, no code change

*"adding 3 layers now in the app but the scrolling in the UI isn't working."*
The leading hypothesis was the channel row's count heuristic
(`visibleChannelIds.length > 3` in landscape ⇒ hard-disabled at exactly 3).
**Disproven** — measured on the current tree, `scrollEnabled` tracked REAL
overflow at every boundary: landscape 3 ch → false with 1082 vs 1082 (no
overflow); 3 ch + COLORS → true, 1420 vs 1082; 4 ch → true, 1756 vs 1082;
portrait 2 ch → false, 722 vs 722; 3 ch → true, 1024 vs 722. No unreachable
content, no code changed.

Most likely explanation: **a stale build.** His dist predates this wave, and
`_280` measured that pre-fix state at 3 channels/1194×834 as a 56 pt playlist
viewport = 0 full rows — which is what "scrolling isn't working" looks like
from the operator's chair. On the current tree the same scroller measures
~270 pt against ~1600-2000 pt of content. **This is plausible, not proven**;
his next test on a rebuilt pad IS the confirmation.

A sub-agent argued the wedged-lock hypothesis was "dead by construction"
because `Platform.OS === 'web'` makes every acquire bail. **That reasoning is
wrong and was rejected:** the operator's own item-1 feedback ("the slider
locking the scrolling is working, but has a tiny glitch") is only possible on a
build where locks DO acquire — he runs native via Expo Go. The lock is live on
his device, so a wedge stays a real failure mode.

**Release-safety net added** (coordinator's order). Audit of `HorizontalFader`
and `hue_wheel` found **no real gap**: `unlockScroll()` runs first and
unconditionally in Release/Terminate; both use `useEffect(() => unlockScroll,
[unlockScroll])` with `useCallback(…, [])` so cleanup fires only on true
unmount; and `lockScroll` guards `if (scrollLockRef.current) return;` before
acquiring, which is what makes a second grant unable to orphan a still-held
token. That guard was previously UNPINNED — now it is. +13 tests: the
orphaned-handle case (acquire twice, release once ⇒ store stays honestly
locked, no papering over), release-after-unsubscribe, interleaved multi-gesture
lifecycles ending free, and source guards on ref-storage, the idempotency
guard, null-before-release ordering, and the empty-dep stability that keeps
cleanup from firing on every render. No timeout, watchdog or auto-release was
added — that would be exactly the fallback behavior P0 forbids.

## 7. Incidents — two, both mine, both reported not hidden

**(a) Live show state mutated.** A sub-agent navigated straight to the scratch
dist's `/mixer` before pinning `API_BASE`. `utils/apiBase.ts` derives the
engine host from `window.location.hostname` with the **port hard-pinned to
6968**, so a page served from ANY scratch port still resolves to the LIVE
engine; the mixer's mount effect fired a real `POST /layers/activate` and
flipped the rig from `deck` to `mixer`. Its self-revert was blocked by the
safety classifier. I did NOT issue a counter-write — ~20 minutes had passed and
a blind flip could have overwritten a deliberate operator choice; it went to
the operator with a one-tap remedy. **Standing rule now in
`.agent/ops/captain_pad_debugging.md`: load a NON-APP static path first
(`/favicon.ico`), pin `API_BASE` there, and only then navigate to the app.**

**(b) The live stack was taken down.** A later sub-agent passed `--config
<scratch.yaml>` to `marsin_engine/engine.js`, **which has no such flag**. The
unknown flag was **silently ignored**, so the "black-holed scratch engine"
booted from the tracked default config — real port 6968, OSC and fire-sync on,
real destinations — and engine boot clears whatever holds its target API port
before binding, killing the live engine. The rogue process was killed within
~a minute and its `launcher.js prod` restart was blocked by the classifier; it
stopped and disclosed rather than routing around the block.

Damage assessment, checked directly: `marsin_engine/config.yaml`'s diff is
legitimate Aug-15 work (vis `keyMaxPixels`, audio BPM/note-latency comments),
mtime 2026-08-15 — untouched tonight, `server.port: 6968` intact, sACN NOT
redirected, so a launcher bounce comes up on the real config.
`states/titanic/mixer_state.yaml` intact (3 channels, master 1, written 13:41 —
before the incident); `states/test_bench/` untouched since Aug 15. No state
file corrupted. The operator's already-ordered stack refresh restored it.

**Follow-up worth filing:** `engine.js` silently ignoring an unrecognized flag
is a P0 fallback-behavior violation — an unknown flag should make it REFUSE TO
BOOT, exactly as the vis-budget config does. As written, one fat-fingered flag
boots a real engine on the live port and takes down the show.

## 8. Gates

- CaptainPad vitest **2370 pass / 0 fail / 6 skipped (110 files)**. From
  `_286`'s 2328: +21 W3/R1/fixes, +13 release-safety, +8 the W3 column rule.
  (One implementer over-attributed its own delta as 34; the true split was
  verified by re-counting the touched files — 70 tests across
  `scroll_lock.test.ts` + `native_gesture_armor.test.ts`, up from 57.)
- `tsc --noEmit` clean. `expo lint` **0 errors** (14 warnings, all pre-existing
  in untouched files).
- No git operations. `CaptainPad/dist` never written by any agent in this wave.

## 9. Files

`app/(tabs)/mixer.tsx` · `components/mixer_scroll_layout.ts` (+test) ·
`components/mixer/pixel_view_band.tsx` · `components/PlaylistPanel.tsx` ·
`components/playlist_row_sizing.ts` (+test) ·
`components/ui/scroll_lock.test.ts` · `components/native_gesture_armor.test.ts`
· new: `components/mixer/pixel_view_band_collapsed_header.test.ts`,
`components/mixer/pixel_view_band_picture_border_compensation.test.ts`,
`components/playlist_panel_compact_rows_scope.test.ts`.

## 10. Operator checklist — CaptainPad rebuild REQUIRED, no engine restart

Landscape MIXER, and please look at these in order:

1. **Patterns (order 3).** With 2-3 layers in landscape, each card should show
   a real pattern list — target 4+ full rows at 1194×834, 7+ at 1366×1024 —
   with the 2D pixel view now beside LOCAL PARAMS on the right instead of a
   band across the card. **This is the least-verified item in the wave (§5)**;
   if it still looks starved at the smaller landscape size, say so plainly.
2. **Two layers, no scrolling** (your follow-up order). With exactly 2 layers
   in landscape, both cards should fit completely — no vertical scrolling to
   see them. Structurally sound but unmeasured.
3. **MASTER VIEW open in landscape** — previously the card body collapsed to
   zero and the list painted over MUTE/SOLO. It should now be a usable list
   with MUTE/SOLO and TRANSITION inside the card. This one IS measured.
4. **Hide BOTH pixels and params on a card** — the right column should shrink
   to a thin stub and the pattern list should take nearly the whole card. Both
   chevrons must stay tappable so you can bring the sections back. Unmeasured.
5. **The band's picture** should look correct, not stretched, at 1-4 layers,
   and the MASTER band at the top should be unchanged.
6. **Deck screen** should be pixel-identical — the compact rows are
   mixer-only. If deck rows look tighter, that is a leak: report it.

**R1 (the 44 pt compact rows) is one line to reverse** if you dislike the
tighter list — tell us and it goes.
