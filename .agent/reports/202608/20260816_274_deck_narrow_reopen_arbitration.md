# _274 — Deck minimize/maximize: the narrow stack now ARBITRATES, so a restored window can never take over the pattern list

**Operator order (verbatim intent, with an iPad screenshot as evidence):**

> "Deck minimize and maximize feature is still broken — when all is hidden and
> one is turned back on, it takes over the patterns' list. That's a corner case
> not handled properly. Screenshot a reproduced error, then fix, and screenshot
> again."

The operator RULED this a defect. That supersedes the `_267` disposition, which
recorded portrait reopen behaviour as **open decision 14** and declined to
change it citing the single-scroll-region and PATTERNS-pin pins.

Client-only. **Zero engine files touched, zero engine traffic added, zero
persisted-state changes** — `deck_workspace_layout_v1` is untouched in schema
and in content, and no reducer action was added.

Files: `CaptainPad/components/deck/deck_workspace_layout.ts` (pure),
`CaptainPad/components/deck/deck_workspace_layout.test.ts`,
`CaptainPad/app/(tabs)/index.tsx`.

---

## 1. The mechanism, named before any code was touched

In the narrow (portrait / sub-900 px) stack the columns host has exactly TWO
children:

1. the **PATTERNS** track, and
2. the ONE `ColumnsScrollRest` scroll region that hosts every other window.

Before this fix those two were sized by **two independent rules that never
looked at each other, and neither of which looked at the host**:

- PATTERNS took a rigid, **non-shrinkable** pin —
  `max(400 | 500, 38.5 % of the DEVICE WINDOW height)`, with both `flexBasis`
  and `height` set and `flexShrink: 0`;
- the region took `flex: 1`, i.e. "whatever is left", and the windows inside it
  are **content-sized** (their `SectionHost` is a plain `View` in narrow,
  because the `narrowScrollOwner` contract forbids a nested same-axis
  ScrollView).

Nothing arbitrated between them. Two failures fall straight out of that, and
both were reproduced and measured on a scratch web dist:

### Failure 1 — the operator's report: the restored window takes over

| viewport | state | PATTERNS | list viewport | fully visible rows | the newcomer |
|---|---|---|---|---|---|
| 834×1194 | all hidden | **835** | 633 | **12** | — |
| 834×1194 | reopen COLORS | **460** | 258 | **4** | **1010 px** in a 383 px viewport |
| 834×1194 | reopen PIXELS | 460 | 258 | 4 | 435 px |
| 1024×1366 | all hidden | **1007** | 805 | **15** | — |
| 1024×1366 | reopen COLORS | **526** | 324 | **6** | 998 px |
| 1024×1366 | reopen PIXELS | 526 | 324 | 6 | 530 px (stretched to 100 % of the region) |

One chip tap costs the operator **two thirds of his pattern list**, and the
window that caused it is 2.1–2.6× the height of the viewport it lands in — it
fills everything visible below PATTERNS and pushes anything else off-fold with
no seam. Screenshot: `repro_834x1194_reopen_colors.png`,
`repro_1024x1366_reopen_pixels.png`.

### Failure 2 — the strictly worse variant, found while probing the corner

When the pin **exceeds the host** — which happens on any narrow stack shorter
than ~1040 px of device window, e.g. Stage Manager / Split View — the
non-shrinkable PATTERNS overflows its container and the region is starved to
zero:

| viewport | host | PATTERNS | overflow past the host | region | the reopened window |
|---|---|---|---|---|---|
| 880×620 | 309 | **400** | **+95 px** (spills under the bottom PANIC bar) | **0** | **NOT ON SCREEN AT ALL** |
| 880×620 (PIXELS) | 347 | 400 | +57 px | 0 | not on screen |
| 834×760 | 449 | 400 | — | 41 | a 41 px sliver of a 547 px window |

Screenshot: `repro_tight_880x620_reopen_pixels.png` — the PIXELS chip has left
the HIDDEN rail (so the layout state really did change), the PATTERNS card runs
off under the bottom bar with its list clipped mid-row, and **the window the
operator just restored is nowhere on screen.** A restore chip that appears to
do nothing is the worst possible answer to a restore chip.

### On the operator's "renders OVERLAPPING / ON TOP", honestly

I could **not** reproduce a literal box intersection on the web dist. The
harness measured `getBoundingClientRect` for PATTERNS and every shown window in
all 36 captured states plus a 12-state tight sweep, and the boxes never
intersect — the verdict function that looks for it fired zero times. What the
screenshots DO show is the two failures above, which produce exactly the reading
the operator described: a PATTERNS card squeezed to a fraction of the screen (or
spilling off it) with the PIXELS chips + ship canvas + honesty caption occupying
everything else. Failure 2 is also the overflow class that CAN paint over a
sibling on native, where the columns host does not clip — which is why the fix
below makes PATTERNS structurally unable to exceed the host, not merely
arithmetically unlikely to.

---

## 2. The fix — the NARROW analogue of `WIDE_FLEX_FLOOR`

One new pure function, `narrowStackSizing`, is now the ONE place the narrow
split is decided. It is built deliberately the same way `_267` built
`wideFlexFor`: **the sparse composition returns the shares of the SHIPPED
DEFAULT deck, and the protected window absorbs the slack.**

```
restCount   = openCount − 1                  (PATTERNS is always open)
restCount 0 → { mode: 'fill' }               ← patternsFillsNarrow, unchanged
pin         = max(400 | 500, round(windowHeight × 0.385))     ← the party pin
host null   → { pin }                        ← the unmeasured first frame is today's screen

restDefault = max(0, host − pin)             the region as the DEFAULT deck has it
share       = min(1, restCount / DEFAULT_NARROW_REST_COUNT)   ← =2, derived from DEFAULT_LAYOUT
rest        = max(restDefault × share, min(NARROW_REST_MIN_HEIGHT, restDefault))
patterns    = host − rest
patterns    = min(patterns, host − NARROW_REST_ABS_MIN_HEIGHT)   ← the ONE cut-in
patterns    = max(patterns, host × NARROW_PATTERNS_MIN_SHARE)
rest        = host − patterns
```

`share` is the whole idea. A region hosting FEWER windows than the shipped
default gets proportionally less of the stack; at
`restCount ≥ DEFAULT_NARROW_REST_COUNT` it saturates at 1 and the split is the
pin, unchanged.

Three constants, each with a job:

- **`NARROW_REST_MIN_HEIGHT` (220)** — the region's *preferred* floor. It is
  itself capped by `restDefault`, **on purpose**: a comfort floor for the
  newcomer must never be the reason PATTERNS gets less than the pin.
- **`NARROW_REST_ABS_MIN_HEIGHT` (72)** — the region's *hard* floor and the ONE
  rule allowed to cut into the pin. It only bites on a stack too short to seat
  the pin — precisely failure 2's state.
- **`NARROW_PATTERNS_MIN_SHARE` (0.5)** — PATTERNS is the deck's reason to
  exist; on a stack too short to pay even the hard floor out of slack, it keeps
  at least half of whatever there is.

### The structural half

`index.tsx` measures the columns host (`onLayout`, guarded on `!==`, no
feedback loop — the host is a `flex:1` sibling of the fixed chrome, so its
height depends on the bars above it and never on its own children) and hands it
to the pure function. The PATTERNS track's narrow style becomes
`{ flexGrow: 0, flexShrink: 1, flexBasis: <arbitrated>, minHeight: 0 }`: the
redundant `height` is dropped and **`flexShrink` goes 0 → 1**, so even a few
points of disagreement between the arbitrated height and the 4 pt track margins
are absorbed INSIDE the host. PATTERNS can no longer spill past the host's
bottom edge and be painted over by the sibling that follows it.

`ColumnsScrollRest`'s `collapsed` prop now reads `narrowStack.mode === 'fill'`
rather than calling `patternsFillsNarrow` separately — the track and the region
now read the SAME value, so they cannot disagree about which composition they
are in.

### The pin that was BENT, and why

**`docs/53` §3 / `docs/63` §5 pin 9 — the party 2026-07-11 PATTERNS pin.** The
38.5 %/400/500 expression is no longer the literal PATTERNS height in two
circumstances:

1. **exactly one secondary window open** — the pin becomes a FLOOR that
   PATTERNS grows past, so restoring one window from all-hidden no longer costs
   two thirds of the list;
2. **a stack shorter than the pin** — the pin YIELDS instead of overflowing the
   host and starving the region to zero.

In **every** composition with two or more secondary windows open on a stack tall
enough to seat the pin — the shipped default deck and every richer one — the pin
is returned unchanged and the screen is byte-identical. That is measured below,
not asserted. The bend is recorded in the code comment above
`narrowStackSizing` as well as here.

**Pins KEPT intact:** `narrowScrollOwner` (still exactly one scroll region; no
same-axis ScrollView was nested — the newcomer stays content-sized and the ONE
region scrolls), `patternsFillsNarrow` (identical predicate, identical
behaviour, now carried as `mode:'fill'`), the no-remount contract, the perf
overlay's zero-write contract, `wideFlexFor` and all of wide mode, the
persistence schema.

---

## 3. Measured before / after

Scratch stack: dist exported to `C:/Users/TITANI~1/tmp/deck_reopen_fix/`
(8.3 short path — the apostrophe in the profile name silently breaks
`--output-dir`), served on :7191/:7193, against a scratch engine on **:17968**
with sACN to **192.0.2.x** (TEST-NET-1), `outputRouting.controllers` verified
`[]`, no Art-Net sender, OSC + fire-sync + VSN1 deploy disabled in a config
copy, `MARSIN_STATE_DIR`/`PLAYLISTS_DIR`/`TIMELINE_DIR` redirected. The
operator's live stack (6966-6972, :6981) was never bound, never touched;
`CaptainPad/dist`'s mtime did not move. Puppeteer with console muted and Web
MIDI hard-disabled before boot.

### The reported transition — reopen ONE window from all-hidden (portrait)

| viewport | reopened | PATTERNS before → after | visible rows before → after |
|---|---|---|---|
| 834×1194 | PARAMETERS | 460 → **623** | 4 → **8** |
| 834×1194 | AUTOPILOT | 460 → **623** | 4 → **8** |
| 834×1194 | COLORS | 460 → **623** | 4 → **8** |
| 834×1194 | PIXELS | 460 → **661** | 4 → **8** |
| 1024×1366 | PARAMETERS | 526 → **770** | 6 → **10** |
| 1024×1366 | AUTOPILOT | 526 → **770** | 6 → **10** |
| 1024×1366 | COLORS | 526 → **770** | 6 → **10** |
| 1024×1366 | PIXELS | 526 → **789** | 6 → **11** |

The newcomer is now **bounded by the scroll viewport** (220–245 px at these
viewports) instead of claiming everything left over, and it still scrolls
inside the one region — nothing is clipped, nothing is unreachable.

### The regression check — every OTHER composition

| viewport | composition | PATTERNS / list viewport / rows | verdict |
|---|---|---|---|
| 834×1194 | default (PARAMS+AUTOPILOT) | 460 / 258 / 4 → 460 / 258 / 4 | **byte-identical** |
| 834×1194 | + COLORS, + PIXELS | 460 / 258 / 4 → 460 / 258 / 4 | **byte-identical** |
| 1024×1366 | default | 526 / 324 / 6 → 526 / 324 / 6 | **byte-identical** |
| 1024×1366 | + COLORS / + PIXELS | 526 / 324 / 6 → 526–527 / 324–325 / 5–6 | ±1 px (the dropped redundant `height`); row-count blip is the known auto-scroll-to-live-entry artifact |
| 1194×834 | ALL states | unchanged in every one | **byte-identical — wide mode is untouched** |
| 1366×1024 | ALL states | unchanged in every one | **byte-identical** |
| all | PATTERNS alone | 835 / 1007 fill | **byte-identical** |

### Failure 2 — the short stacks

| viewport | host | before | after |
|---|---|---|---|
| 880×620 | 309 | PATTERNS 400, **+95 px overflow**, region **0**, window invisible | PATTERNS 237, no overflow, region **64**, window **on screen and scrollable** |
| 880×620 (PIXELS) | 347 | PATTERNS 400, +57 px, region 0 | PATTERNS 275, no overflow, region 64 |
| 834×760 | 449 | PATTERNS 400, region 41 (a sliver) | PATTERNS 377, region 64 |
| 640×960 | 609 | PATTERNS 400, region 201 | PATTERNS 400, region 201 — **unchanged** |

(The region lands at 64 rather than the nominal 72 because the track carries 4 pt
of vertical margin at each end; `flexShrink:1` absorbs it inside the host, which
is exactly what it is there for.)

### The FULL minimize/maximize cycle

Run at all four viewports: all-open → hide each of the four in turn → all-hidden
→ reshow each in turn. Every step measured; no overflow, no zero-height region,
no zero-row list, no box intersection at any step, in either orientation. The
portrait progression is now GRADUAL in both directions — 1024×1366 reads
527 → 527 → 527 → 789 → 1007 going down and 770 → 526 → 526 → 527 coming back,
instead of the old cliff.

### Screenshots (all inspected)

`C:/Users/TITANI~1/tmp/deck_reopen_fix/`, `repro_*` vs `fixed_*`, same
viewports, side-by-side-able:

- `repro_834x1194_reopen_colors.png` ↔ `fixed_834x1194_reopen_colors.png`
- `repro_1024x1366_reopen_pixels.png` ↔ `fixed_1024x1366_reopen_pixels.png`
- `repro_tight_880x620_reopen_pixels.png` ↔ `fixed_tight_880x620_reopen_pixels.png`
- plus the full matrix: 4 viewports × {all-hidden, reopen ×4, populated ×4} and
  the tight sweep 3 viewports × {all-hidden, reopen ×3}.

Measurement JSON: `repro_measurements.json`, `fixed_measurements.json`,
`repro_tight_measurements.json`, `fixed_tight_measurements.json`. Harnesses:
`probe.cjs`, `probe_tight.cjs`.

---

## 4. Gates

- **CaptainPad suite: 104 files / 2265 passed / 6 skipped / 0 failed** — my
  failing list is EMPTY.
- **+9 new tests** in `deck_workspace_layout.test.ts` (101 in that file), all
  table-driven and all pure: the pin restated; fill-when-alone plus a
  cross-check that `narrowStackSizing`'s `mode` and `patternsFillsNarrow` agree
  on the same condition; the default deck at both iPad portrait viewports;
  every composition with ≥ `DEFAULT_NARROW_REST_COUNT` secondaries returning the
  pin; defect 1's exact numbers; defect 2's exact numbers; the preferred floor
  never cutting into the pin; the unmeasured-host parity case (incl. 0 and NaN);
  a bound second playlist; `DEFAULT_NARROW_REST_COUNT` being derived; and a
  **720-case invariant sweep** (6 window heights × 10 stacks × 5 open counts ×
  2 bound states) asserting the split always sums to the host exactly, the
  region is always > 0, PATTERNS never falls below its share, and any shortfall
  below the pin is the hard floor's doing and nothing else.
- `tsc --noEmit` **clean**. `expo export` succeeds.
- Lint **0 errors, 0 new warnings** on the touched files. The one remaining
  warning in `index.tsx` (`ScrollView` unused) is FOREIGN — `_267` already
  reported it as `_263` residue and it is untouched here.

---

## 5. As-built notes and what stays open

1. **Decision 14 is CLOSED by the operator's ruling** and superseded by this
   report. The "portrait narrow-window content sizing is shipped behaviour, not
   a defect" disposition no longer stands for the reopen transition. What was
   correct in `_267`'s analysis and is still true: the narrow secondary windows
   are still content-sized and still scroll inside the ONE region — that was not
   changed, and no ScrollView was nested. What changed is the SPLIT.
2. **The `onLayout` first frame.** Before the host reports, the sizer returns
   the bare pin, i.e. exactly the pre-fix screen; the corrected split lands on
   the next layout pass. That is one extra render on mount and on rotation, and
   it is deliberate — the alternative is guessing a host height, which this repo
   does not do.
3. **Short stacks below ~1040 px of device window now split roughly in half**
   when the pin cannot be seated, including in the DEFAULT composition. That is
   a behaviour change outside the sparse case, and it is the fix for failure 2:
   the previous behaviour there was an overflow or a 41 px sliver. No iPad
   viewport in either orientation is in this range.
4. **The literal overlap could not be reproduced on the web dist** (§1). If the
   operator still sees paint-over on the native iPad after this lands, the
   remaining suspect is native-only: the columns host does not clip, so any
   future chrome addition that shortens the stack would reproduce failure 2's
   overflow — which this fix now makes structurally impossible via
   `flexShrink:1` plus the host-measured basis. Worth his eye on the iPad.
5. **Deployment:** client-side only. No engine restart, no schema change, no
   wire change. **CaptainPad web rebuild required** for the deck to pick this
   up (the coordinator's `rebuild-pad`); a native pad needs its own rebuild.
