# 20260816_279 — Mixer: hiding LOCAL PARAMS now gives the room to the pattern list

**Operator ask (verbatim):** "in the mixer view, when hiding params, make room
for the pattern list so we show more patterns in the view please — that was the
whole purpose of hiding the params :)"

**Verdict:** the ask was correct and the defect was total — hiding params freed
**nothing**, in either orientation. Fixed. Portrait now converts the freed band
into visible pattern rows (**2 → 4 rows**); landscape converts it into list
width (**176 → 196 pt**, long pattern names stop truncating) and, on a wide
2-channel card, **283 → 374 pt**. Landscape gains no extra ROWS, and that is
geometric, not a shortfall in the fix — see §5.

---

## 1. What the freed space did before: nothing at all

Measured on a scratch dist export of the shipped tree, served on :7191 against
the live engine, driven headless at iPad landscape 1194×834 and portrait
834×1194, three channels visible. Every number below is
`getBoundingClientRect` on the playlist's own scroll viewport, and "rows" is
entries **fully** inside it.

| Viewport | State | Playlist viewport | Rows | LOCAL PARAMS panel |
|---|---|---|---|---|
| landscape | params shown | 176 × 24 | 0 (+1 partial) | 135 × 102 |
| landscape | params **hidden** | 176 × 24 | 0 (+1 partial) | **135 × 102** |
| portrait | params shown | 292 × 158 | 2 | 318 × 128 |
| portrait | params **hidden** | 292 × 158 | 2 | **318 × 128** |

The playlist is **byte-identical** with params shown and hidden. The params
panel does not shrink by a single pixel — it keeps its full share of the strip
body while rendering only the 28 pt "LOCAL PARAMS ▸" micro-header. The vacated
area is simply dead ground: a ~100 pt empty band under the stub in portrait, a
135 × 102 pt empty column beside the list in landscape. Screenshots:
`before_portrait_params_hidden.png` (the dead band is unmistakable),
`before_landscape_params_hidden.png` (three empty columns).

### Why

`ChannelStrip`'s body is a flex box with two children, and neither one was ever
told to stop claiming space when its content went away:

- **portrait** — `channelBody` is a COLUMN; the params panel carries
  `flexGrow: 1` (`MIXER_PORTRAIT_PARAMS_PANEL` / `MIXER_TALL_PORTRAIT_PARAMS_PANEL`).
  A flex WEIGHT is claimed whether or not there is anything to put in it.
- **landscape** — `channelBody` is a ROW; the params panel is `width: '40%'`
  (`styles.paramsPanel`). A percentage width is likewise unconditional.

### The PIXELS section is the control, and it never had this defect

Same run, hiding `sec/<id>/pixels` instead: landscape **24 → 167 pt (0 → 2
rows)**, portrait **158 → 253 pt (2 → 4 rows)** — with no layout code of its
own. The band is a full-card-width block in the card's VERTICAL stack, so
collapsing it to its header returns the height to `channelBody` (`flex: 1`) and
the playlist absorbs it for free.

Params could not inherit that because it is a **sibling panel inside the body**,
not a block above it. So the two sections are now consistent in OUTCOME (freed
space reaches the list) by different means, and the report's answer to "did
pixels have the same defect?" is: **no — it was already correct, and it is the
proof of what correct looks like.**

## 2. The fix

New pure layout rule in `CaptainPad/components/mixer_scroll_layout.ts` — the
render layer asks, it never re-derives:

- `mixerParamsColumnMode({perfActive, paramsShown, pixelsShown})` → `'full'` |
  `'stub'` | `'empty'`. It mirrors `ChannelStrip`'s render branches exactly,
  including perf's asymmetry (perf has already replaced the sliders with the
  band, so `paramsShown` cannot change what occupies the column — only
  `pixelsShown` can, and perf never resurrects an operator-hidden band).
- `MIXER_PORTRAIT_PARAMS_PANEL_COLLAPSED` — drops the flex WEIGHT
  (`flexGrow: 0`, `flexBasis: 'auto'`), keeps `flexShrink: 0` so the stub can
  never be squeezed untappable, and deliberately leaves `width` alone so the
  portrait stub keeps spanning the strip.
- `MIXER_LANDSCAPE_PARAMS_PANEL_COLLAPSED` — clears the 40 % to `'auto'`.
- `MIXER_LANDSCAPE_PARAMS_PANEL_EMPTY` — perf mode with the band hidden too:
  the column renders nothing, so it costs `width: 0` and `padding: 0`.
- `MIXER_LANDSCAPE_PLAYLIST_PANEL_EXPANDED` — the playlist becomes the row's
  only grower.

`app/(tabs)/mixer.tsx` applies these LAST in the two style arrays (they must
beat the base 60/40 and perf's 45/55). **View-only throughout — zero engine
calls, no new scroll-acquire sites, the floor-of-one rule untouched.**

### The bug inside the fix, worth remembering

The first implementation used `width: undefined` to clear the 40 %. On
**react-native-web a later `undefined` does not override an earlier value** —
the resolver drops undefined properties instead of overwriting with them — so
the landscape column silently kept its full 40 % and the verified build showed
zero landscape change. `'auto'` is a real value, it overwrites, and it is now
pinned by its own test (`never clears a width with 'undefined', which
react-native-web ignores`). Note `cardStyle` in `mixer.tsx` (~line 3355) still
uses `width: undefined`; it is masked there by `flex` + `maxWidth`, but it is
the same latent trap.

## 3. Before → after, per viewport

| Viewport | State | Playlist BEFORE | Playlist AFTER | Rows |
|---|---|---|---|---|
| landscape, 3 ch | params hidden | 176 × 24 | **196 × 24** | 0 → 0 |
| landscape, 2 ch | params hidden | 283 × 56 | **374 × 56** | 0 → 0 |
| portrait, 3 ch | params hidden | 292 × 158 | **292 × 242 / 244** | **2 → 3 / 4** |
| portrait, 2 ch | params hidden | 309 × 158 | **309 × 242 / 244** | **2 → 3 / 4** |
| portrait, master band open | params hidden | 309 × 62 | **309 × 98** | 1 → 1 |

The two portrait cards differ (3 vs 4) only because their playlists have
different entry heights — both gained the same ~85 pt.
`after2_portrait_params_hidden.png` shows four entries where three plus a dead
band used to be; `after2_landscape_params_hidden.png` shows
`00_golden_hour_wash` rendering in full where it used to truncate to
`00_golden_hour_w…`.

## 4. Regression sweep

**Params SHOWN (the default) is geometrically identical before and after** in
every scenario measured — landscape and portrait, 2 and 3 visible channels,
master band open and closed:

```
landscape 2ch shown  BEFORE 283x56=0r params 206x134   AFTER 283x56=0r params 206x134
portrait  2ch shown  BEFORE 309x158=2r params 335x128  AFTER 309x158=2r params 335x128
master open  shown   BEFORE 309x62=1r  params 335x80   AFTER 309x62=1r  params 335x80
```

Pixels-hidden is likewise untouched (landscape 176 × 167 = 2 rows before and
after). Perf mode is covered by the pure tests rather than the live rig — the
`'empty'` mode is the only new behavior there and it only ever removes a column
that renders nothing.

**4+ channels:** not exercised against the engine, because adding channels is a
structural engine write and the operator's live show was the only engine
available. It is covered structurally instead: the new rule reads only
`(perfActive, paramsShown, pixelsShown)` and `isPortrait` — never the channel
count, which affects `cardStyle`'s WIDTH and nothing inside the body. And the
narrowest branch is already measured: portrait with ≥3 visible takes the fixed
320 pt card path, which is exactly what 4+ uses, and it was tested with 3.
Landscape ≥4 caps at 560 pt, wider than the 437 measured at 3.

## 5. Landscape gains width, not rows — and why that is the honest answer

In landscape the params column sits **beside** the list, so the space it frees
is horizontal. No flex rule can turn width into rows. The row count there is set
by the card's HEIGHT, and the thing eating it is the 2D pixel band (~180 pt of a
~560 pt card) — which is why hiding PIXELS is the lever that adds rows in
landscape (0 → 2, already working today).

Worth the operator knowing, from the same measurements: **in landscape with the
pixel band open, the pattern list is only ~24 pt tall — one partial row.** The
list is effectively unusable there until the band is hidden, params or no
params.

One option was considered and **not** taken: relocating the pixel band into the
vacated column in landscape (exactly what perf mode already does), which would
convert the freed width into ~180 pt of height and take the list from 1 row to
~5. It was rejected because it shrinks the band the operator did not ask to
shrink — at 3 visible channels the band would drop from ~330 × 122 to ~135 × 50.
**If Sina wants landscape rows more than he wants the big band, this is a
~10-line follow-up and the mechanism is already tested in perf mode.**

## 6. Pre-existing bug found (NOT caused by this change)

**Landscape + MASTER VIEW open crushes the channel card body to zero.** Measured
at 1194 × 834 with 2 visible channels: the playlist scroller goes to **283 × 0**
(list gone entirely) and the params column to 206 × 16; the playlist card and
sliders visibly paint UNDERNEATH the MUTE/SOLO and TRANSITION rows, and the
params chevron becomes untappable. **Identical numbers on the build before this
change** — it is the LANDSCAPE twin of the portrait "W0 fix": landscape's
`patternListPanel`/`paramsPanel` are percentage widths with no `flexShrink`, so
they never participate in the shrink negotiation the portrait panels were given.
Filed as a background task with the full repro.

## 7. Gates

- **CaptainPad vitest: 2291 pass / 0 fail / 6 skipped** (105 files).
  `mixer_scroll_layout.test.ts` went **5 → 14 tests**, so this change
  contributes exactly **+9**. The intermediate run mid-implementation read
  2289 = baseline 2281 + the 8 tests written by then; the last 2 come from
  **+1 of mine** (the RNW `undefined` guard) and **+1 from a concurrent
  agent** — `components/special_events/{show_autopilot_logic,special_events_view}.test.ts`
  were both modified during this session by another thread. Zero failures at
  every point.
- `tsc --noEmit` clean.
- `expo lint`: **0 errors**; the 14 pre-existing warnings are all in files this
  change does not touch.
- Security: the three touched files scan clean (no MAC/IP/email/credential/
  future-date patterns). `security_check.py --all` reports only the known
  pre-existing MAC findings in gitignored `simulation/.scene_backups/**`.
- Live stack untouched: :6966-:6972 / :6981 never bound, killed or restarted;
  `CaptainPad/dist` never written; all scratch servers (:7191/:7192/:7193)
  stopped. The pad connected to the live engine **read-only** — the workspace
  hide is view-only by contract and no other control was touched.

**CaptainPad rebuild REQUIRED** (`node launcher.js rebuild-pad`). No engine
restart.

## 8. Files

- `CaptainPad/components/mixer_scroll_layout.ts` — the new pure rule + four
  panel constants, with the full account of the defect and the RNW
  `undefined`-does-not-override trap.
- `CaptainPad/components/mixer_scroll_layout.test.ts` — +8 tests.
- `CaptainPad/app/(tabs)/mixer.tsx` — derives `paramsColumnMode`, applies the
  collapsed/expanded overrides last in the two panel style arrays.

Note both `mixer_scroll_layout.*` files are still **untracked** in the working
tree (as are 112 other CaptainPad files from the uncommitted wave) — the
eventual commit must `git add` them or `mixer.tsx` will import a file that does
not exist in the repo.
