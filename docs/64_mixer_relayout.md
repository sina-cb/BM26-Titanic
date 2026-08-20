# 64 — Mixer relayout: channels as windows, aspect-honest pixels, hideable sections, COLORS in the mixer

**Status:** DESIGN — ready for implementation (Sonnet implementers under an
Opus lead, the operator's standing pipeline) ·
**Author:** Fable (design report `_258`) · **Operator:** Sina Solaimanpour

Operator order (verbatim intent, from live iPad testing):

> "the mixer UI is a mess — deck was good, minor changes; Mixer is fugged up
> bad! Especially the 2d pixels. Take screenshots and design an update for the
> layout and params; support hiding params and 2d vis PER CHANNEL; optimize
> for 2 channels, max 3, in horizontal view — more is supported and we have
> groups, but I don't think I use them at all."

Addendum (same session, first-class requirements):

> 1. "Make the layouts or channels a WINDOW like the deck that we can hide or
>    show — that way I can bring up some channels and hide them minimally."
> 2. "Allow using the color picker UI I tuned in the deck view as a component
>    again — hideable and showable."

Related canon: `docs/58_mixer_pixel_views.md` (the band machinery — its §4
engine is pinned below), `docs/63_deck_declutter_view_optimizer.md` (the
tier/chip/known-set grammar this doc adopts wholesale),
`docs/53_deck_workspace_windows.md` §3 (closed-set model),
`docs/61_colors_interaction_model.md` (the COLORS rules that bind wherever
the picker appears), `docs/54_deck_ui_restyle.md` (visual grammar), reports
`_225` (known-set hazard), `_241`/`_243` (band design + as-built), `_252`
(PixelSurface native seam).

---

## 1. What the screenshots show — the mess, named

Captured tonight read-only off the prod dist (:6967, live engine in
performance mode, 2 channels) at iPad landscape 1366×1024 and portrait
1024×1366 → `~/tmp/mixer_relayout_258/`; edit-mode state from the `_243`
campaign (`~/tmp/fix_243/`). All inspected. Top-down view aspect measured
from the artifact itself: glyph extent 694×364 ≈ **1.91:1** (front panels
1.53/1.20, strands 1.92, te_sign 0.74/0.60).

> **AS-BUILT CORRECTION (W2, verified independently by the Opus lead).**
> The aspect figures in this section are measured **~2 % too wide**, and the
> multi-panel guidance in §3.2 was wrong by ~8 %. They are corrected here
> once; the implementation carries the corrected values, not these.
>
> 1. **Corner-vs-centre.** This section measured each glyph's `x`/`y` as a
>    top-left corner (`x` → `x + w`). `flattenView` treats them as glyph
>    **centres** (`x ± sizeX/2`), and the painter's bounds are what the canvas
>    must match. True figures: **top-down 1.872** (707.0 × 377.7, not
>    694 × 364), strands 1.901, front panels 1.52/1.19, te_sign 0.74/0.61.
>    Every "1.91:1 ship" below should read **1.872:1**; the void percentages
>    the section reports are unaffected in substance.
> 2. **Multi-panel aspect is NOT the sum of the panel aspects.** §3.2's
>    "FRONT side-by-side ~2.7" came from summing per-panel aspects.
>    `arrangePanels` letterboxes each panel against the view's **common box**
>    and then measures the composite from each panel's own bounds, so panels
>    sitting at different heights are undercounted by that sum. The true
>    composite aspect is a **fixed point** solved through the real
>    arrangement: **front columns 2.9227**, front rows 0.7674, **te_sign
>    columns 1.4197**, te_sign rows 0.3717. The old sum (2.713 / 1.353) would
>    have left ~8 % residual letterbox on FRONT and TE SIGN — the very defect
>    M1 names. Single-panel views (top-down, strands, and therefore the
>    default view) were never affected, which is why the mess looked
>    aspect-correct on the default view.
> 3. **`panelGap` makes the fixed point scale-dependent.** The gap is real
>    viewport pixels, so at the band's real 72–176 px caps it is a
>    non-negligible share of the canvas and the gap-free asymptote still
>    leaves measurable void (measured 1.6 % on front, 3.5 % on te_sign at the
>    176 px cap). The shipped sizing therefore refines the fixed point
>    against the REAL `arrangePanels` at the REAL slot and cap. Verified over
>    the full view × cap × slot matrix: worst-case void **0.38 %**.

**M1 — the 2D canvases are mostly dead black (the "fugged" pixels).** Every
band slot is a fixed height that ignores the view's aspect, and the canvas
paints its letterbox bars as stage-black. The master band at 1366-landscape
is a 1220×158 canvas (7.7:1) holding a 1.91:1 ship → the lit picture is
~302×158 and **~75 % of the canvas is black void**. Portrait master:
878×158 → ~66 % void. Perf-mode channel column: 313×245 (1.28:1) → ship
313×164, ~33 % void, and the ship the operator actually gets is *smaller
than the edit-mode band* it replaced. Edit channel band 316×112 → ~32 %
void. The screen reads as black rectangles with a small smear in each.

**M2 — the band crushes the mixing body in edit mode** (`243_01`, 4 ch @
1440×900): the card is fixed-height, so the 140 px band is taken from the
body — the playlist shows **one row**, and LOCAL PARAMS is a ~110 px column
with truncated labels ("LOCAL SP… 50"). The primary mixing surfaces lost to
a picture.

**M3 — portrait is broken outright** (live portrait capture + `243_09`):
the MUTE/SOLO/BUMP row and the TRANSITION row render **on top of** the
playlist text (button labels over entry names), LOCAL PARAMS and the perf
pixel view are pushed clean out of the card (the 300×118 canvases exist in
the DOM and are invisible). This is a layout defect, not a taste issue —
W0 below, fix first.

**M4 — duplicated surfaces and caption noise.** Per channel: a 14 px thin
strip AND a 2D band of the same buffer; per screen: master strip AND master
band. `PARAMS HIDDEN · SHOW MODE · MIDI STILL LIVE` prints **once per
channel**; `100/964` on every band; `964/964 FULL` always-on on the master.

**M5 — ~37 % of the landscape viewport is chrome before the first channel.**
Nav + GLOBALS + AUDIO + MASTER OUTPUT label/strip + the forced-open 158 px
master band ≈ 380 px of 1024 in perf mode — and per M1 three quarters of the
tallest block is black void.

**M6 — portrait wastes the right third.** Fixed ~320 px columns leave a
~250 px dead gutter at 1024 wide while everything inside the cards is
starved.

**M7 — the perf-mode "dominant" view isn't.** The `_243` §2 deviation
(55/45 split) shipped as the best of a bad set of options on a fixed-height
card; the operator's verdict tonight vetoes the result. The design lever it
lacked is now available: **fewer visible channels** (addendum 1) makes cards
wider, and aspect-honest sizing (§3.2) makes the pixels real instead of
void. What was already flagged in `_243` §4 and stands for this wave:
the split (point 1), band default-open cost (point 3); D5 masking shipped
and is NOT revisited here.

---

## 2. The model — a mixer workspace, one reducer, runtime citizens

The deck's grammar (docs/53 §3, generalized by docs/63 §2) comes to the
mixer **unchanged in spirit**: one pure reducer, one persisted closed set +
`known` set, one chip row with a HIDDEN divider, derived overlays that never
write. The one genuinely new problem is that the deck's surfaces are a
static enum while mixer channels are **runtime-created, runtime-named,
runtime-deleted**. The store therefore keys on **namespaced string ids**:

### 2.1 Surface ids (`components/mixer/mixer_workspace_layout.ts`, new, pure)

```ts
// Namespaced keys, one flat closed-set over all of them:
//   ch/<channelId>              a channel card (runtime id from the engine)
//   sec/<channelId>/params      that channel's LOCAL PARAMS column
//   sec/<channelId>/pixels      that channel's 2D pixel band
//   citizen/masterBand          the master 2D band
//   citizen/colors              the COLORS window (§5)
```

Channels are **windows** (chip on the rail when hidden, card in the row when
shown). Sections are **per-channel hideable regions** (order: "hiding params
and 2d vis PER CHANNEL") — they get no chips in the global row (2N section
chips would bury the channel chips); their affordance lives on the strip
(§3.1). Citizens are static, deck-style. Groups get **no citizenship** (§6).

### 2.2 Store, reducer, selectors

`MixerWorkspaceLayout = { closed: string[]; known: string[] }`, AsyncStorage
key **`mixer_workspace_layout_v1`**, same shape discipline as
`deck_workspace_layout`: three actions (`close`/`open`/`reset`), unknown
action types throw, untrusted input normalized in exactly one place.
Selectors are total over namespaces (`visibleChannels(roster, layout)`,
`hiddenChannelChips(roster, layout)`, `isSectionShown(layout, chId, sec)`,
`isCitizenShown(layout, id)`) — render code never re-derives layout facts.

**Floor:** the reducer refuses to close the **last visible channel** (given
the roster it is handed), and the normalizer backstops it — the mixer's twin
of the deck's protected PATTERNS. An all-hidden mixer is a screen with no
reason to exist (D1).

### 2.3 Persistence + the `_225` discipline, extended to runtime ids

docs/63 §2.3 states the invariant this store must satisfy: *a store may only
be silent about an element that did not exist when it was written, and
silence must reproduce the screen that store's author was looking at.* For
runtime ids that resolves as:

- **A channel id absent from `known` is NEW → VISIBLE.** The **inverse** of
  the deck's windows-default-closed rule, and deliberately so: a deck window
  is chrome shipped by a build, but a channel is operator-created **live
  content that is already painting the rig** — a store written before the
  channel existed must show it, and a channel added from a second pad must
  appear on this one. (The deck rule exists because only the closed set is
  persisted; with `known` recorded, new-id policy is free per namespace.)
- **A `sec/…` id absent from `known` → its shipped default: VISIBLE** (both
  params and pixels — today's screen).
- **`citizen/masterBand` absent → VISIBLE** (today's screen) —
  **SUPERSEDED, see the as-built addendum below**;
  **`citizen/colors` absent → CLOSED** (new chrome defaults closed, the
  `_225` rule verbatim).
- **Pruning deleted channels:** `ch/…`/`sec/…` entries whose channel id is
  missing from the roster are **retained in storage, never rendered** while
  the roster could be stale (boot, reconnect), and pruned only when a layout
  action is committed against a **confirmed** roster (connected, mixer doc
  received). Deleting a channel therefore removes its chip the moment the
  broadcast lands (render = roster ∩ layout), and the store self-cleans on
  the next operator interaction — no timer, no background write.
- Every write serializes `known` = the ids this build could see at write
  time (roster ∪ citizens ∪ section keys for the roster).

> **AS-BUILT ADDENDUM — `citizen/masterBand` now defaults CLOSED**
> (`docs/67_mixer_polish.md` §2, operator ruling from live iPad testing:
> *"Master 2D pixels is too large — that's okay, just DISABLE (hide) it BY
> DEFAULT."*). `SHIPPED_DEFAULT_CLOSED_CITIZENS` is now
> `['colors', 'masterBand']`, so a fresh store rails **MASTER VIEW, COLORS**
> and RESET returns to a closed band. The `_225` PRINCIPLE above is
> untouched: no existing store is *silent* about the band — every mixer
> store ever written records `citizen/masterBand` in `known` (this section's
> own guarantee), so the `wasKnown` gate exempts all of them and the new
> default provably reaches fresh installs only. A one-time migration was
> rejected deliberately — `known`-and-open cannot distinguish "deliberately
> reopened" from "never touched". Consequence carried: perf mode on a fresh
> store shows **no** master band (§2.6's "perf never resurrects a closed
> citizen" now applies to the default state too); the §3.5 thin strip
> carries the master's honesty.

### 2.4 The chip row (the rail)

One horizontal row, rendered by `components/mixer/mixer_workspace_bar.tsx`
(new), seated **between the MASTER OUTPUT block and the strip row** — NOT
inside `CPCControls` (that file is docs/63-W3's this season; the mixer bar
needs nothing from it). Grammar per docs/63 §3.3: shown chips in canonical
order (channels in engine order, then MASTER VIEW, then COLORS) → `HIDDEN`
divider → rail chips in close order. Same `WindowChip` recipe, ▾/▸ glyphs,
≥44 pt targets, identity dots subject to the 3:1 contrast gate.

- **Channel chip label:** `1 · SPARKLE` (index dot + derived title —
  `deriveChannelTitle` already exists and is what the card header shows).
  Dot tinted by group color when grouped, else `C.secondary`. A **muted**
  hidden channel renders its chip label in the muted style — a hidden-and-
  silenced layer must be discoverable at a glance; hiding NEVER mutes
  (view-only, engine untouched).
- **Overflow:** the chip strip is its own horizontal ScrollView (a chip row
  is not a fader surface; the no-new-scroll rule in docs/58 §4.1 was about
  the band/canvas region, and the deck bar ships the same pattern).
- The bar is always rendered — it is the surface that restores everything
  else.

### 2.5 What hiding a channel means

View-only, exactly like closing a deck window: the card leaves the strip
row, survivors reflow (2 visible channels at 1366 → two wide cards, the
operator's "bring up some channels" IS the 2-3-channel optimization), engine
state untouched — the hidden channel keeps rendering to the rig, keeps its
faders/solo/mute as they were, stays MIDI-reachable (focus by APC track
button still works; the on-screen FOCUS overlay simply isn't visible).
Channel cards may be **unmounted** when hidden (docs/63 §2.6 reasoning: the
strip's live state — playlist scroll, rename edits — is worth a decision:
see D10; the recommended default keeps them mounted-but-displaced like deck
windows, `windowDisplay` style, because a mid-rename unmount eats input).

### 2.6 Performance overlay stays a pure derivation

Raw `usePerformanceMode().active`, zero writes, byte-identical round trip —
the `_217`/docs/58 §2.3 contract is untouched. Perf mode composes AFTER the
persisted layout: hidden channels stay hidden, hidden sections stay hidden;
perf additionally suppresses the params sections of the *visible* channels
(derived), never resurrects anything the operator closed. The master band's
forced-open-in-perf rule survives only if `citizen/masterBand` is shown;
perf never reopens a citizen the operator closed (a show surface he removed
is his call — the docs/63 §2.5 bar precedent).

---

## 3. The strip, rebuilt for 2-3 wide channels

### 3.1 Per-channel section hiding (the original order)

Each expanded card's two hideable sections get their affordance **on the
strip, in the section's own header line** (the band already has a chevron
row; LOCAL PARAMS gets the same 28 px micro-header with a ▾/▸), plus mirror
rows in the existing ⋮ actions menu (`SHOW/HIDE PARAMS`, `SHOW/HIDE
PIXELS`) so both are reachable when a section is fully gone (a hidden
section leaves a 28 px header stub, docs/53 §3.1 — no unreachable state,
no affordance that always refuses). State goes to the §2 store (persisted,
known-set), **replacing** the band's session-local `collapsed` (the session
store in `pixel_view_band_logic` keeps only `viewId` if D7 is declined).

### 3.2 Aspect-honest pixel bands — the M1 kill

The band stops naming fixed canvas heights. New pure geometry in
`pixel_view_band_logic.ts` (constants die: `CHANNEL_BAND_CANVAS_HEIGHT`,
`MASTER_BAND_CANVAS_HEIGHT`, …):

```
aspect      = arranged design aspect of the RESOLVED view (new pure export
              from pixel_view_logic — the number layoutView already computes;
              multi-panel views use the arranged bounds, so FRONT stacked is
              ~0.7, side-by-side ~2.7)
canvasH     = clamp(slotWidth / aspect, MIN_BAND_H=72, capH(placement))
canvasW     = min(slotWidth, canvasH × aspect)
```

The canvas is **sized to the picture** — the letterbox bars cease to exist
instead of being painted black. Surplus slot width is card/page ground.
Caps (tokens, tuned in W5 against the screenshot matrix): channel edit
≈ 176, channel perf = the vacated column height (fill, but aspect-fit inside
it — no stretch), master edit ≈ 120, master perf ≈ 176.

**The master band's reclaimed width becomes the rail.** The MASTER OUTPUT
block becomes one row: `[master 2D canvas, aspect-sized, left]` +
`[mixer workspace bar chips, filling the reclaimed right side]` (portrait
stacks them). The tallest block on the screen stops being 75 % void and
starts carrying the show-restore surface — M1 and M5 attacked with the same
pixels.

### 3.3 Landscape card widths — optimize for 2, max 3

`landscapeMaxWidth` re-derives from **visible** (not total) channels:
2 visible → cap ~640 (two cards fill 1366 minus padding), 3 → ~437, 1 →
920 (unchanged). ≥4 visible keeps today's 560/scroll behavior — more
channels stay SUPPORTED, the rail is how the operator gets the wide layout.
Resulting top-down ship at 2 visible: ~336×176 in-card (vs 214×112 today —
~2.5× the lit area, zero void) and perf-column ~330×173 with no stretched
canvas.

### 3.4 Perf mode per channel

As shipped (`_243` W4) structurally — params column vacated, band moves in,
playlist stays live ("viz more dominantly WITH patterns") — but the view is
**aspect-fit inside the column, never stretched to fill it** (the 313×245
void-canvas is M1's worst per-channel case). D6 offers the full-card
alternative the operator was promised in `_243` §4.1(b).

### 3.5 The thin strip earns its place

The 14 px `ChannelVizStrip` renders **only when that channel's 2D band is
hidden** (D4) — it is the collapsed band's honest residue, not a permanent
duplicate. Same rule for the master strip vs master band. (The buffers and
subscriptions are untouched; this is a render gate.)

### 3.6 Caption diet

- `PARAMS HIDDEN · SHOW MODE · MIDI STILL LIVE` prints **once**, at the
  right end of the workspace bar while perf mode is active — not per
  channel.
- The per-band compact ratio (`100/964`) **stays** — it is the honesty
  arithmetic (codex P0, docs/58 §2.1) and costs ~40 pt; the full sentence
  stays in the picker footer. `964/964 FULL` on the master likewise.
- The band header's `PIXELS` label already shrinks first; with the section
  header doubling as the hide affordance (§3.1) no new chrome is added.

### 3.7 Portrait

- **W0 (defect, first, standalone):** the bottom action rows must never
  overlap the body — bound the playlist/params body (`minHeight: 0` +
  proper flex chain) so MUTE/SOLO/TRANSITION always sit below it; the perf
  pixel view must be visible (today it's pushed out of the card entirely).
- Cards flex to fill portrait width (2 across at 1024 → ~470 pt each; M6's
  dead gutter becomes card).
- Portrait perf: the pixel view renders full-card-width, aspect-fit,
  ABOVE the body (the side-by-side split has no room in a 470 pt card).

---

## 4. COLORS in the mixer (addendum 2)

**One rig-global window — never per-channel.** `colorPalette1/2` is engine-
global CPC state (one palette pair for the whole rig; per-channel color does
not exist — the per-channel HUE trim on each strip is a different, real
per-channel field and stays where it is). "Showing it per mixer channel"
would draw N copies of the same two handles; the design refuses that lie.

- **Mount:** `citizen/colors` — a chip on the rail (default CLOSED); when
  shown it renders as a **fixed-width card (~380 pt) at the right end of the
  strip row**, deck-window styled, scrolling with the row. Portrait: a
  full-width block below the strips.
- **Componentization seam:** `ColorsWindow` is already a self-contained
  component with a narrow mount contract (module path + export name +
  `disabled` prop, docs/53 slice-A pin) that reads the broadcast and writes
  `/param-center` atomically. The mixer mounts **the same component** —
  no fork, no move; if captions need to know their host, ONE optional
  `host?: 'deck' | 'mixer'` prop (default `'deck'`) is the entire seam.
  What stays deck-specific: nothing structural — the window never reads
  deck state; its `disabled` wiring in the mixer is `activationsLocked`
  (the same plan-lock the strips obey).
- **docs/61 binds here.** The yield rules, the driving strip, the gate
  sentence that names the driver, single-writer arbitration — all of it
  applies wherever the picker appears, and mounting the REAL window in the
  mixer is precisely what fixes docs/61's C5 for this surface (today's
  mixer-side palette writes go through ungated pickers). **Sequencing is
  mandatory:** the mixer mount lands only after the docs/61 wave lands
  (their W1/W2 own `colors_window_logic.*` / `colors_window.tsx` +
  `driving_strip.tsx`), so the mixer inherits the finished interaction
  model instead of mounting the pre-model window twice.

---

## 5. Groups — de-emphasized, not deleted

Operator: "I don't think I use them at all." What de-emphasis means here:

- **No group citizenship, no group chips, no new group features.** Hiding is
  per-channel; a hidden grouped channel just hides (its chip keeps the group
  tint as its only group trace).
- The group machinery (containers, collapse bars, gang faders, GROUPS
  modal) is **untouched and stays functional** — it already costs zero
  pixels when no groups exist, which is the operator's actual state.
- The GROUPS button stays where it is (GLOBALS row trailing slot) — it is
  already one small chip; moving it into an overflow menu buys ~70 pt and
  costs discoverability. Offered as D3's alternative, not recommended.
- Nothing is deleted (operator decision point D3 records the veto right).

---

## 6. Must-not-change pins

1. **The `_243` band engine**: `pixel_paint_scheduler` (8 ms budget,
   round-robin, latest-wins), the shared `pixel_view_paint`/`PixelSurface`
   painter (`_252` native seam), `use_pixel_view_artifact` (ONE fetch),
   drain-time visibility gating. §3.2 changes what SIZE the canvas is, never
   how it paints. Zero React on the frame path stays law (`_225`).
2. **Perf-mode derived-overlay contract**: raw mode, zero writes, identical
   round trip — now asserted over the *persisted* workspace store too.
3. **D5 masking as shipped** (`pattern_mixer.js`) — not revisited.
4. **Zero engine changes in this wave.** Client-only; no restart rides on it.
5. `MixerScreen`'s non-subscription to the viz bus; faders' capture-claimed
   drags; canvas `pointerEvents="none"`; no same-axis nested scrolls in the
   card body.
6. Offline readiness (no CDNs, vendored deps) and `known`-set upgrade
   safety: a pre-wave store must hydrate to today's screen exactly.

---

## 7. Operator decision points (defaults chosen; overrides welcome)

| # | Question | Recommended default |
|---|---|---|
| D1 | Floor on hiding channels? | Refuse hiding the LAST visible channel |
| D2 | New/foreign channel ids default | VISIBLE (content ≠ chrome; argued §2.3) |
| D3 | Groups de-emphasis depth | Keep machinery + GROUPS button as-is; no group chips; delete nothing. Alt: move GROUPS into ⋮ overflow |
| D4 | Thin 1D strips | Render only when that surface's 2D band is hidden. Alt: keep both always |
| D5 | Caption diet | PARAMS-HIDDEN once on the bar; per-band ratio stays (honesty pin) |
| D6 | Perf-mode channel view | Aspect-fit in the vacated column, playlist stays. Alt (`_243` §4.1b): full-card view, transition bar hidden in perf |
| D7 | Persist band view choice too? | YES — fold `viewId` into the workspace store (the operator now curates layout; session-only was `_243` §4.5's open item). Alt: keep session-only |
| D8 | COLORS placement | Rig-global card at the right end of the strip row, default hidden. Never per-channel |
| D8b | MASTER VIEW default (as-built, docs/67 §2) | **Default HIDDEN too** — operator ruling; fresh stores only, no migration (see the §2.3 as-built addendum) |
| D9 | Hidden channel chips show state? | Muted style on muted channels only (no live meters in chips — cost without a question they answer) |
| D10 | Hidden channels unmount? | Keep mounted, display-suppressed (deck `windowDisplay` precedent — preserves rename/scroll state). Alt: unmount for memory |

---

## 8. W-items (Sonnet-sized; Opus lead sequences)

**File-ownership note for the lead:** `mixer.tsx` is touched by W0, W3, W4,
W5, W6 — serialize those in that order. W1 + W2 are parallel, up front,
disjoint. Baseline discipline per docs/58 §6 (suites baselined, tsc/eslint
clean, no git ops, fresh dist on a scratch port, live stack untouched).

**W0 — portrait overlap defect (standalone, first).**
File: `CaptainPad/app/(tabs)/mixer.tsx` (styles/flex chain only).
*Accept:* portrait 1024×1366 with 2 and 4 channels, edit AND perf: bottom
action rows fully below the body, LOCAL PARAMS reachable (scroll), perf
pixel view visible in-card; landscape screenshots byte-identical.

**W1 — workspace layout brain (pure).**
Files: `CaptainPad/components/mixer/mixer_workspace_layout.ts` + test (new).
Namespaced ids, reducer, floor rule, normalizer, known-set rules of §2.3
(the new-id policy TABLE is the test matrix: window-new→visible,
sec-new→visible, colors-new→closed, masterBand-new→visible), roster pruning
(prune only on commit against confirmed roster), serialization.
*Accept:* the §2.3 invariant test — a store written by TODAY's build (no
`known`, no workspace key) hydrates to today's screen; every future-id case
lands on its shipped default; floor refusal; round-trip stability.

**W2 — aspect-honest geometry (pure + band).**
Files: `CaptainPad/components/deck/pixel_view_logic.ts` (ONE new pure export:
arranged design aspect for a resolved view), `pixel_view_band_logic.ts`
(sizing function of §3.2 + caps; height constants retired),
`pixel_view_band.tsx` (canvas sized to picture, no painted letterbox).
Must not touch scheduler/painter/artifact loader.
*Accept:* unit tests pin canvasW/H for top-down (1.91), front-stacked,
te_sign across slot widths 300/620/1220 incl. clamps; screenshot: master
band shows ZERO black wings; deck PIXELS window unaffected (its own layout
path untouched).

**W3 — workspace bar + hide/show wiring (after W1).**
Files: `CaptainPad/components/mixer/mixer_workspace_bar.tsx` (new),
`mixer.tsx` (bar seated per §3.2 master row; strip row renders
roster ∩ layout; card widths from VISIBLE count §3.3).
*Accept:* hide→chip→show round trip; floor refusal narrated (disabled chip
state, docs/53 §3.1); add-channel appears visible + chip-less; delete-
channel chip vanishes on broadcast; reload restores; muted-chip style;
contrast gate on chip dots (extend `restyle_contrast.test.ts`).

**W4 — per-strip section hiding + strip diet (after W1, after W3 lands in
`mixer.tsx`).**
Files: `mixer.tsx` (ChannelStrip region), `pixel_view_band.tsx` (chevron →
store-backed), ⋮ menu rows.
*Accept:* params/pixels hide per channel, persisted, 28 px stubs remain;
thin-strip-only-when-band-hidden (D4); PARAMS-HIDDEN caption once on the
bar, absent per-channel; perf overlay suppresses visible channels' params
derived-only (store snapshot byte-identical across enter/exit).

**W5 — layout optimization pass (after W2 + W3).**
Files: `mixer.tsx`.
Visible-count card caps, master-row composition (canvas + bar), perf
aspect-fit column, portrait full-width cards + full-width perf view.
*Accept:* the §9 screenshot matrix, visually inspected; no clipped body at
1366×1024 with 2 and 3 visible; ship lit-area ≥2× current at 2-visible
(measure the canvas, not vibes).

**W6 — COLORS citizen (SEQUENCED: only after the docs/61 wave lands).**
Files: `mixer.tsx` (mount + chip), `colors_window.tsx` (only the optional
`host` prop if captions need it — coordinate with the docs/61 owner; zero
structural change).
*Accept:* chip default-hidden; shown card renders the REAL ColorsWindow;
plan-lock disables it; docs/61's driving strip/gate sentence appear
verbatim in the mixer mount; hiding the window mid-rotation changes nothing
engine-side (disappearance never yields — docs/61 §2.2).

**W7 — validation walk (Opus, last, no product files).**
Suites vs baseline (CaptainPad vitest, engine untouched ⇒ engine suite
unchanged), tsc/eslint, the full screenshot matrix at BOTH orientations,
persistence round-trips (reload + upgrade-from-today store), perf-mode
walk (enter with hidden channels/sections → everything still reachable →
exit byte-identical), scheduler duty re-measured with the new canvas sizes
(8 ms budget still holds — bigger canvases cost more per paint; the
`_239` cost model says glyph-count-bound, verify, don't assume).

---

## 9. Screenshot matrix (fresh dist, scratch port, offline engine 17xxx,
TEST-NET-1; both 1366×1024 and 1024×1366 unless noted)

| # | shot |
|---|---|
| 1 | Edit, 2 visible channels — wide cards, aspect-honest bands, master row (canvas + chips), no black wings |
| 2 | Edit, 3 visible — the max-optimized row |
| 3 | 5 channels, 3 hidden — rail chips (one muted style), row layout unchanged |
| 4 | One channel: params hidden; sibling: pixels hidden (stubs visible, thin strip back) |
| 5 | Perf mode, 2 visible — aspect-fit column views, single PARAMS-HIDDEN caption on the bar |
| 6 | Perf enter/exit round trip — byte-identical layout probe incl. workspace store snapshot |
| 7 | Portrait edit — full-width cards, no overlap (W0 proof), bottom rows below body |
| 8 | Portrait perf — full-width aspect-fit view above body |
| 9 | COLORS citizen shown (post-docs/61) — real window in the row, driving strip visible while a rotation runs |
| 10 | 8 channels all visible — legacy density still supported, rail scrolls |
| 11 | Reload after 3/4/9 — persistence restored; plus upgrade shot: today's store hydrates to today's screen |

---

## 10. Sequencing + file overlaps (for the Opus lead)

- **docs/61 wave** owns `colors_window_logic.*`, `colors_window.tsx` (+
  `driving_strip.tsx`), `app/(tabs)/index.tsx`, `deck_workspace.tsx`,
  `useEngineState.ts`, `color_mode_chip.tsx`. This wave touches NONE of
  those except W6's optional one-prop addition to `colors_window.tsx` —
  **W6 starts strictly after their wave lands.** Everything else here is
  independent of docs/61.
- **docs/63 wave** owns `deck_workspace_layout.ts`, `deck_workspace.tsx`,
  `index.tsx`, `CPCControls.tsx`. This wave deliberately avoids all four
  (the mixer bar is NOT seated in CPCControls). **Convergence duty:** the
  chip recipe (`WindowChip`) will exist in their W2; whichever wave lands
  second extracts it to `components/ui/workspace_chip.tsx` and consumes it
  — two hand-rolled chip rows is the outcome to refuse. The known-set
  new-id policy table (§2.3 here, §2.3 there) must read as one rule.
- **docs/61 W4's app-wide COLOR chip** may want a slot near the mixer
  header — the mixer bar's right end is available; note it to their owner.
- This wave is client-only: no engine restart, does not ride the pending
  gen-7 bounce.
