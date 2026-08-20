# _270 — Mixer relayout SHIPPED: channels are windows, pixels are aspect-honest, COLORS is a citizen (Opus lead + Sonnet implementers)

**Contract:** `docs/64_mixer_relayout.md` (design `_258`) · **Pipeline:** Sonnet
implementers under an Opus lead (operator's standing pipeline) · **Client-only
— ZERO engine changes, no restart rides on this.**

Operator verdict that started it: *"the mixer UI is a mess — Mixer is fugged
up bad! Especially the 2d pixels … support hiding params and 2d vis PER
CHANNEL; optimize for 2 channels, max 3, in horizontal view"*, plus the
addendum that channels become deck-style hideable WINDOWS and the tuned
COLORS picker returns to the mixer as a hideable component.

---

## 1. What shipped, measured

| surface | before (`_243`/`_258` measured) | after (this wave, measured) |
|---|---|---|
| master band | 1220×158, **~75 % black void** | 223×118 edit / 327×174 perf, **zero void** |
| channel band @2 visible | 316×112, ~32 % void (~24 067 lit px²) | **327×174 = 56 977 px², zero void → 2.37×** |
| perf channel column | 313×245 stretched, ship SMALLER than the edit band | 313×166 **aspect-fit**, never stretched |
| portrait cards | fixed 320 pt + a ~250 pt dead gutter | ~470 pt, gutter reclaimed |
| portrait action rows | **painted ON TOP of the playlist (defect)** | always below the body |
| PARAMS-HIDDEN caption | once **per channel** | **exactly once**, on the bar |

The master band's reclaimed 75 % is now where the chip rail lives — M1 and M5
attacked with the same pixels.

## 2. The model as built

One pure reducer + persisted `closed`/`known` sets over **namespaced runtime
ids** (`ch/<id>`, `sec/<id>/params|pixels`, `citizen/masterBand|colors`),
AsyncStorage key `mixer_workspace_layout_v1`. Channels are windows (chip on
the rail when hidden, card in the row when shown); sections are per-channel
hideable regions with 28 px header stubs + `⋮` mirrors; citizens are static.
Hiding is **VIEW-ONLY** — zero engine calls, proven, not asserted. Hidden
channels stay MOUNTED (`display:'none'`), so a mid-rename hide never eats
operator input. Floor: the reducer refuses to close the last visible channel
and the normalizer backstops it.

**Groups: de-emphasized by BUILDING NOTHING** (D3) — machinery, containers,
gang faders, GROUPS button all untouched; no group chips; nothing deleted.

## 3. Corrections the lead made to the CONTRACT itself

`docs/64` §1 now carries an **AS-BUILT CORRECTION** block. Three errors, all
verified independently by the lead before amending:

1. **Corner-vs-centre.** The design measured glyph `x`/`y` as top-left
   corners; `flattenView` treats them as **centres** (`x ± sizeX/2`), and the
   painter's bounds are what a canvas must match. Top-down is **1.872**
   (707.0 × 377.7), not 1.91. Strands 1.901, front panels 1.52/1.19, te_sign
   0.74/0.61. *(The lead's own first independent check reproduced the design's
   error before reading the painter — W2's artifact-measured number was right
   and the lead's was wrong.)*
2. **Multi-panel aspect is NOT the sum of the panel aspects.** `arrangePanels`
   letterboxes each panel against the view's COMMON box and measures the
   composite from each panel's OWN bounds, so panels at different heights are
   undercounted by a sum. True fixed points: **front columns 2.9227** (not
   2.713), **te_sign columns 1.4197** (not 1.353). The wrong formula left
   ~8 % residual letterbox on FRONT and TE SIGN — the very defect M1 names.
   Single-panel views (top-down, strands) were never affected, which is why
   the mess still looked aspect-correct on the DEFAULT view.
3. **`panelGap` makes the fixed point scale-dependent.** The gap is real
   viewport pixels, so at the band's 72–176 px caps the gap-free asymptote
   still leaves measurable void (lead-measured **1.59 %** front, **3.46 %**
   te_sign at the 176 px cap). Shipped sizing refines the fixed point against
   the REAL `arrangePanels` at the REAL slot and cap, throwing rather than
   falling back if it cannot converge. Verified across the full view × cap ×
   slot matrix: **worst-case void 0.38 %**.

## 4. Lead rulings (operator veto points)

- **D7 mechanism.** §2.2 pins the store to exactly three membership actions,
  and a per-band `viewId` is a different KIND of fact. So D7 shipped as
  persistence on the band's OWN session store (`mixer_band_views_v1`) behind
  a pure serialization seam + a thin AsyncStorage adapter — the three-action
  pin holds, and `mixer.tsx` needed no change.
- **COLORS never yields (NEW decision, please confirm).** `docs/61` §3's L2
  row says hiding the COLORS window YIELDS (stops FOLLOW NOTE) when the card
  is `'follow'`; `docs/64` §8 says the mixer mount's disappearance never
  yields. **Ruled: the mixer's COLORS chip is VIEW-ONLY and posts nothing.**
  Reasons: (a) this wave's load-bearing invariant, held against every slice,
  is that hiding makes zero engine calls; (b) `docs/61`'s rule was designed
  when COLORS lived on ONE surface — with the deck's window also mounted and
  never unmounted, "the window was hidden" no longer implies "the operator
  left the follow-note card", so stopping a running show mode because a
  SECOND surface's chip was tapped is a surprising engine write mid-show;
  (c) §2.2 already exempts TURNS/crossfade/palette-set, so only follow-note
  was ever in scope. **The deck's own L2/L3 yield behaviour is untouched.**
  Proven engine-silent: puppeteer network listener, live rotation, citizen
  hidden twice → **zero** color-autopilot POSTs.

## 5. Convergence duty (docs/63 landed first ⇒ ours)

- `components/ui/workspace_chip.tsx` extracted; the deck's `WindowChip` and
  the mixer's hand-rolled twin both consume it. The identity dot is a
  **ReactNode slot** (a flat `identityDot` and a live engine-fed `DualSwatch`
  are structurally different; a slot serves both without `components/ui/`
  reaching into engine state); `onPress: null` means unpressable-by-design,
  covering the deck's protected PATTERNS and the mixer's floor chip without
  smuggling domain flags into shared code. Both bars' PUBLIC props are
  byte-unchanged.
- The two `known`-set policy tables now read as ONE rule: a shared exported
  `WORKSPACE_KNOWN_SET_RULE`, with a test asserting the deck's and mixer's
  re-exports are the **same object reference** — not merely equal text. That
  is a regression guard against the convergence being silently un-done.

## 6. Validation walk (Opus lead, W7)

Scratch stack only: dist on :7181, engine on **:17981** from a config COPY
with **OSC (10000) and fire-sync (7703) DISABLED** (machine-wide singletons),
sACN blackholed to `192.0.2.x`, `--model titanic` (matching the live rig, so
no spurious model-mismatch caption), `MARSIN_STATE_DIR` redirected. Live
:6967/:6968/:6981 verified untouched throughout and still 200 after teardown.

**Static gates:** CaptainPad vitest **103 files / 2214 passed / 6 skipped /
0 failed**, owned failing list EMPTY, zero foreign reds. `tsc --noEmit`
clean. `expo lint` **0 errors** (14 pre-existing warnings, none in files this
wave touched). Engine suite untouched (zero engine changes).

**Measured gates, all PASS:**

| gate | evidence |
|---|---|
| zero letterbox void | every band canvas aspect within 1 % of a true view aspect — measured 1.8867 / 1.8819 (landscape 3-visible, 2-visible, portrait) |
| 2-visible lit area | 327×174 = 56 977 px² vs pre-wave ~24 067 lit px² → **2.37×** (gate ≥2×) |
| chip rail round trip | hide → rail chip → reload → restored; stored `closed` exactly `["citizen/colors","ch/…"]` |
| upgrade safety | no-key store hydrates to today's screen: rail = exactly `[COLORS]`, all 3 channel chips shown |
| reopen proportional | hide → reopen → chip order **1,2,3** (canonical, never appended) |
| floor refusal | with one visible: 0 hideable channel chips; label *"3 · Default is the only visible channel and cannot be hidden"* |
| single PARAMS-HIDDEN | perf ON → count **1**; perf OFF → count **0**; `PARAMS HIDDEN` occurs in exactly ONE source location (the bar) |
| perf byte-identity | stored layout string **identical** before / during / after a real `POST /performance-mode` round trip |
| thin strip only when band hidden | source gates `{!pixelsShown ? …}` and `{!masterBandShown ? …}` + visual: MASTER VIEW hidden ⇒ 1D strip present AND 2D band gone |
| scheduler duty | rAF n=357, median 16.7 ms, p95 18.4 ms at the NEW larger canvases — 60 fps, no jank; the 8 ms paint budget holds |

Screenshots (inspected): `~/tmp/mixer_w7/` — `w7_01` 3-visible, `w7_02`
2-visible (master canvas + chips row, two ~600 pt cards, zero wings),
`w7_06` portrait, `w7c_master_hidden_thin_strip` (thin strip back, band gone).
Plus per-slice sets in `~/tmp/mixer_w0/…w6/`.

**Three "failures" in the first two passes were HARNESS bugs, not defects**,
and are recorded because the distinction cost real time: (1) a bare
`[aria-label^="Show "]` sweep also caught the master band's SHOW/RIG *source*
chips — chip queries must be scoped to `[data-mixerworkspacebar="1"]`;
(2) a fresh store legitimately has ONE rail chip (COLORS defaults CLOSED per
the `_225` rule), so "rail must be empty" was the wrong assertion;
(3) `POST /performance-mode {active:false}` is REFUSED without an explicit
`exitAction` ('keep'|'keep-save'|'restore') — the harness never checked the
status code, so perf stayed ON and the caption count of 1 was correct. Also:
the thin 1D strip renders as RN `<View>` cells, **not** a canvas, so a
canvas-based detector can never see it.

## 7. ⚠ STATE RESIDUE — operator action before the gen-8 restart

`marsin_engine/states/titanic/mixer_state.yaml` carries **TWO stray test
channels** into the next boot. Reported, not reverted (AGENTS.md). Ids decode
their own creation time:

| channel id | created | origin |
|---|---|---|
| `ch_1785801995942_0` | 2026-08-04 | the operator's REAL channel — keep |
| `ch_1786733914718_0` | 2026-08-14 18:58Z | **pre-existing residue from an EARLIER session — not this wave** |
| `ch_1786846862499_0` | 2026-08-16 02:21Z | **this wave (W5 scratch run, did not redirect `MARSIN_STATE_DIR`)** |

Also untracked: `states/titanic/global_effect_slots.yaml`,
`states/titanic/snapshots/`, `states/titanic/special_events_state.yaml`, and a
stray atomic-write temp `states/test_bench/.mixer_state.yaml.31488.2.tmp`.
**A stray test channel appearing in the live mixer at gen-8 boot would
contaminate the operator's test round.** The lead's own W7 walk redirected
`MARSIN_STATE_DIR` and added ZERO further residue (real file mtime unchanged).

## 8. Pins honoured

`_243` machinery untouched (8 ms scheduler, shared `pixel_view_paint`/
`PixelSurface` `_252` seam, ONE artifact fetch, drain-time visibility gating —
sizes and placement changed, never how it paints); perf overlay stays a pure
DERIVATION with zero persistence writes; honesty captions kept (`100/964`
per band, `964/964 FULL` master); D5 mask not revisited; no same-axis nested
scrolls; `MixerScreen` still not subscribed to the viz bus; offline-ready.

## 9. Follow-ups for the operator

1. **Confirm the COLORS-never-yields ruling** (§4) — the one place this wave
   knowingly diverges from `docs/61` as written.
2. **Clean the two stray test channels** before the gen-8 restart (§7).
3. Deprecation debt is fully retired: `bandCanvasHeight`, the three fixed
   height constants and the `canvasHeight` null-sentinel are gone;
   `placement` is now required.

**Needs:** a CaptainPad rebuild for the operator's pad. **No engine restart.**
