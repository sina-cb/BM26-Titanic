# 67 — Mixer polish: impeccable pass on the docs/64 workspace (band default, portrait rail, chip diet, scroll lock)

**Status:** DESIGN — ready for ONE Opus implementer session (operator
pipeline: Fable designs, Opus implements + validates) ·
**Author:** Fable (design report `_273`) · **Operator:** Sina Solaimanpour

Operator verdict on the docs/64 wave: *"mixer view improvements! great! love
it!!!"* — this wave is the polish pass on a layout that WORKS. Four orders,
verbatim intent, from live iPad testing (gen-8 prod, native, both
orientations):

> 1. "Master 2D pixels is too large — that's okay, just DISABLE (hide) it BY
>    DEFAULT."
> 2. "When working with sliders on the mixer layers, disable the master
>    scroll — they conflict and are annoying."
> 3. "The vertical view doesn't show the hide/show buttons AT ALL — make
>    sure it does."
> 4. "Some items in the hide-and-show are too-long texts — remove or
>    shorten; they couldn't be selected either."

Plus a full review of both operator screenshots (§6). Related canon:
`docs/64_mixer_relayout.md` (+ `_270` as-built), `_263` (scroll-lock seam),
`docs/66_live_touch_ipad_ergonomics.md` (the 44 pt doctrine),
`components/workspace_known_set_policy.ts` (the shared new-id rule).

---

## 1. Reproduction — every defect measured, mechanisms named

Captured tonight on a scratch stack (dist :7183 reusing the W7 export —
newer than every mixer source it renders; engine :17983 from a config copy,
sACN → TEST-NET-1 `192.0.2.9` only, OSC/fire-sync/audio/web_client disabled,
`MARSIN_STATE_DIR` redirected; live :6967/:6968 verified 200 and untouched
after teardown). Three channels seeded, one renamed to the 40-char
**"Ambient Golden Hour Cathedral Wash Layer"** to reproduce order 4.
Artifacts + probe JSON: `~/tmp/mixer_polish_fable/`.

### 1.1 Order 3 — the portrait rail is a native-only ZERO-HEIGHT collapse

**Mechanism (named):** `mixer.tsx` seats the workspace bar in
`styles.masterBarFill = { flex: 1, minWidth: 0 }`. In landscape,
`masterRow` is a **row**, so `flex:1` distributes the row's WIDTH — correct.
In portrait, `masterRowPortrait` flips the container to a **column**, so the
same `flex:1` becomes the HEIGHT axis: `flexBasis: 0%` with the container's
own height auto (content-sized). Yoga distributes grow space only against a
DEFINITE main size — with none, the bar measures at its basis: **0 pt
tall**. react-native-web resolves the identical style through CSS flexbox
intrinsic sizing, which keeps the content height (34 px) — which is exactly
why every W7 portrait screenshot (web puppeteer) passed while the
operator's native iPad shows no rail at all.

**Differential evidence:** the same build, same store, portrait 1024×1366 on
web renders the bar at 912×34 with all 5 chips
(`p5_portrait_master_hidden.png`, and W7's own `w7_06_portrait_edit.png`);
the operator's native portrait shows the full-width MASTER OUTPUT strip
(the sibling `masterCanvasColumn` — content-sized, so it survives) and
**nothing where the bar should be**. Landscape on the SAME device shows the
rail fine. Only the portrait/native cell of the matrix fails — the flex-axis
flip is the one variable.

### 1.2 Order 4 — two defects: unbounded chip width, and a fold with no affordance

**4a — labels are unbounded.** `workspace_chip.tsx`'s label `Text` has no
`numberOfLines` and no `maxWidth`; a chip's width is its label's intrinsic
width. Measured at 1366-landscape: normal chips 118–130 pt; the long-titled
chip **349 pt** (its label text alone 296 pt) — one channel eats 42 % of the
bar's 831 pt viewport. Channel titles are runtime data
(`deriveChannelTitle`: rename → active playlist entry label/pattern →
playlist name), so pattern-derived titles this long are a normal Tuesday.

**4b — chips past the fold are effectively unselectable.** The bar's
ScrollView renders `showsHorizontalScrollIndicator={false}` and no other
overflow affordance. Measured, fresh store: content 904 pt in an 831 pt
viewport; the COLORS chip sits at x=1328 with rightEdge=**1423** — a
**38 pt sliver** on a 1366 screen (below the 44 pt floor of docs/66), the
rest untouchable beyond the fold, and nothing tells the operator the row
scrolls. In the operator-matching perf state the content is 1173 pt in a
1068 pt viewport and the trailing caption (262 pt) is hard-clipped at the
fold — the operator's `PARAMS HIDDEN · SHOW MODE · MID…` screenshot,
reproduced pixel-for-pixel (`p4z_landscape_perf_bar.png`). The chips'
handlers are alive (the harness clicked the 349 pt chip successfully) — this
is a reachability/affordance failure, aggravated on native where a tap that
wanders a few points becomes a scroll claim and the press is cancelled.

### 1.3 Orders 1 + 2 — state confirmed

The operator's own store already closes `citizen/masterBand` by hand (both
screenshots show the thin-strip residue, §3.5 of docs/64) — order 1 is about
the SHIPPED DEFAULT for stores that never recorded an opinion. For order 2,
the gesture audit (§5.1) found every mixer drag-steered control is already a
`HorizontalFader` — which has carried the `_263` native lock seam since that
wave — but **no mixer scroll host is enlisted**, so the lock the faders take
is inert exactly where the operator feels the conflict.

---

## 2. Order 1 — `citizen/masterBand` defaults CLOSED

### 2.1 The change (one constant, two consumers)

`mixer_workspace_layout.ts`:

```ts
export const SHIPPED_DEFAULT_CLOSED_CITIZENS: readonly MixerCitizenKey[] =
  ['colors', 'masterBand'];
```

`shippedDefaultClosed` has exactly two consumers — `normalizeLayout`'s
silent-id fallback and the reducer's `reset` — and both then do the right
thing with zero further edits: a store with no opinion about the band closes
it; RESET returns to a closed band.

### 2.2 Who gets the new default — fresh stores ONLY (recommended)

The known-set machinery already implements precisely the upgrade policy this
flip needs, and the store's shape PROVES it is safe:

- Every store written since `_270` serialized `known = roster ∪ citizens ∪
  sections` — `citizen/masterBand` is in the `known` of **every existing
  mixer store without exception** (there is no legacy pre-`known` mixer
  store; docs/64 §2.3 pinned that). `normalizeLayout`'s `wasKnown` check
  therefore exempts every existing store from the flip automatically.
- The flip lands exactly on: no-key stores (fresh installs, cleared
  storage, new pads) and nothing else.

**A one-time migration is REJECTED**, deliberately: the store records
membership, not intent — `closed` says what is hidden, `known` says what the
author could see. "Open and known" cannot distinguish *operator deliberately
reopened the band* from *operator never touched it*, so any migration that
force-closes known-open bands would fight a possible explicit choice, which
is the exact thing the `_225` invariant exists to prevent ("silence must
reproduce the screen the store's author was looking at" — an open band in a
known store IS that screen). The migration also buys nothing: the operator's
own pad already closed the band by hand, so the flip's entire value is for
fresh boots — precisely the population the shipped-default table governs.

### 2.3 Convergence-table update (`WORKSPACE_KNOWN_SET_RULE`)

`components/workspace_known_set_policy.ts` — the mixer row changes:

| id outside `known` | old default | new default |
|---|---|---|
| `citizen/masterBand` | VISIBLE ("today's screen") | **CLOSED** (operator ruling, this doc: the master band is a large show surface the operator opens on demand) |

The PRINCIPLE is unchanged — silence reproduces the author's screen; what
changed is the shipped default for a surface **no existing store is silent
about** (every one records it in `known`), which is what makes the flip
provably fresh-store-only. The deck's re-export stays the same object
reference (the `_270` §5 regression guard keeps proving the convergence).
`docs/64` §2.3 + §7 D-table get a short as-built addendum pointing here
(same idiom as the aspect correction block).

### 2.4 Consequences to pin in tests

1. `{closed:[], known:[…incl citizen/masterBand]}` → band stays OPEN
   (upgrade safety — the pre-flip store's screen is reproduced).
2. No key at all → band CLOSED; fresh rail reads `MASTER VIEW`, `COLORS`
   (close-order: reset/normalize order, both citizens).
3. Synthetic `known` without `citizen/masterBand` → CLOSED.
4. `reset` now closes the band; still never closes a channel (floor
   untouchable by construction — `shippedDefaultClosed` is citizen-only).
5. **Perf mode on a fresh store shows NO master band** — docs/64 §2.6's
   "perf never resurrects a closed citizen" now applies to the default
   state too. The thin strip (§3.5 residue) carries the master's honesty.
   This is the intended reading of the order (decision point D2).

---

## 3. Order 3 — the portrait rail, fixed and placed

### 3.1 The fix (styles only, landscape byte-identical)

`mixer.tsx`: the bar's seat gets a portrait override —

```ts
masterBarFillPortrait: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
// applied as: [styles.masterBarFill, isPortrait && styles.masterBarFillPortrait]
```

In the portrait column the bar then sizes to its own content (one 34 pt
row), full-width via the column's `alignItems:'stretch'`. Landscape keeps
`flex:1` untouched. Explicit `flexBasis:'auto'` rather than `flex:0` so the
intent is readable and the guard can pin the exact property.

### 3.2 Portrait placement (design ruling)

The rail is its OWN full-width row, directly BELOW the master strip/canvas
block and ABOVE the channel-strip row — the position the docs/64 stack
already gives it, now actually rendered on native. **One row tall, always;
no wrapping.** Rationale: with §4's label cap, 5 chips (3 channels + 2
citizens) measure ≈ 700 pt and fit the 992 pt portrait row outright; a
6-chip-plus rail scrolls behind the §4 overflow affordance. Wrapping was
considered and rejected — a second chip row costs 34 pt of the portrait
column permanently to serve a rare state that scrolling serves for free, and
the deck bar (same recipe) is single-row; two grammars is the outcome to
refuse.

### 3.3 Acceptance is NATIVE

Web cannot prove this fix (web never had the bug). Acceptance: source guard
pinning the portrait override (the `native_gesture_armor.test.ts` idiom),
web portrait screenshot unchanged vs tonight's capture, and an on-device
check in the operator's round: rotate to portrait → chip rail visible below
the MASTER OUTPUT strip, chips pressable, rotate back → landscape identical.

---

## 4. Order 4 — chip diet: bounded labels, honest overflow, pinned caption

### 4.1 Label truncation (the shared chip, one token)

`workspace_chip.tsx`:

- `export const WORKSPACE_CHIP_LABEL_MAX_WIDTH = 168;`
- label `Text` gets `numberOfLines={1}` + `maxWidth:
  WORKSPACE_CHIP_LABEL_MAX_WIDTH` (tail ellipsis is RN's default).

Numbers, from tonight's measurements: `labelCaps` uppercase runs ≈ 6.7 pt/
char (296 pt / 44 chars), so 168 pt ≈ 25 characters — the long repro title
renders `2 · AMBIENT GOLDEN HOUR C…`, a 40-char pathological title's chip
tops out ≈ 218 pt total (vs 349 unbounded), and every real-world title the
operator has shown ("GOLDEN HOUR WASH", 16 ch ≈ 110 pt) renders WHOLE. The
index prefix `N · ` is the head of the string, so tail-ellipsis keeps the
index prominent by construction — no label recomposition needed, and the
`accessibilityLabel` already carries the full title. Truncation lives at
the STYLE level (pixel-honest across fonts), not as a character cap in
`channelChipLabel` — the pure plan keeps full titles so nothing downstream
loses data. **Deck impact: zero** — the deck's longest static label
("PERFORMANCE", ≈ 80 pt) is far under the cap, so its chips render
byte-identically; the shared-chip contrast and guard suites re-run as the
proof.

### 4.2 Rail overflow affordance (the fold becomes visible)

The bar keeps its horizontal ScrollView and gains ONE hint: a pinned
right-edge `›` glyph (microCaps size, `C.icon`, plain `View`/`Text` — no
new dependency; `expo-linear-gradient` is not in the tree and a fade is not
worth adding a dep for). It renders only while `contentWidth >
viewportWidth` and the scroller is not at the end (state from
`onContentSizeChange`/`onLayout`/`onScroll`, render-layer only, no store
contact). With §4.1 caps the overflow state itself becomes rare; the hint
is for the residual case (many channels, several railed).

Minimums stay: chips keep `minHeight: 28` + the exported 8 pt hitSlop
(= 44 pt effective, the docs/66 floor); labels never shrink below their
truncated width (no `flexShrink` on the label).

### 4.3 The perf caption leaves the scroll content

`PARAMS HIDDEN · SHOW MODE · MIDI STILL LIVE` becomes a pinned trailing
element OUTSIDE the ScrollView (a sibling inside `styles.bar`'s row, divider
included), with `numberOfLines={1}`, `flexShrink: 1`, `maxWidth: 260`. It
can no longer scroll away, no longer pushes chips, and under pressure it
ellipsizes instead of hard-clipping at the screen edge (the operator's
`MID…`). Still exactly ONE caption, still sourced from
`PERF_PARAMS_CAPTION`, full sentence in the accessibility label. The
`shown → HIDDEN divider → rail` grammar stays entirely inside the scroller.

---

## 5. Order 2 — the scroll lock comes to the mixer

### 5.1 Gesture audit (what exists, measured against `_263`)

| Surface | Kind | Lock status |
|---|---|---|
| CHANNEL fader, HUE trim (strip) | `HorizontalFader` | already ACQUIRES (`_263` three-point seam) |
| LOCAL PARAMS sliders (`MixerLocalParams` → ParamRow) | `HorizontalFader` | already ACQUIRES |
| Master fader (GLOBALS row) | `HorizontalFader` | acquires; no scroll ancestor — inert, harmless |
| COLORS citizen (hue dial, BLEND scrubber) | `hue_wheel` / `HorizontalFader` | already ACQUIRE |
| Transition duration wheel | `TimerWheel` = native FlatList | NOT a PanResponder — native scroll-vs-scroll axis negotiation covers it; no seam |
| Playlist rows, MUTE/SOLO/BUMP/SAFE/FOCUS, TRANSITION, style dropdown, chip rail | Touchables (taps) | no responder war to lose (`_263` sibling-audit reasoning) |

**Conclusion: zero new acquire sites.** The whole order is host enlistment.

### 5.2 Hosts that become `LockableScrollView` (three, exactly)

1. **The channel-strip horizontal ScrollView** (`mixer.tsx` ~line 3273) —
   the "master scroll" of the order. Its conditional
   `scrollEnabled={…count-based…}` passes through untouched;
   `LockableScrollView` composes `locked ? false : scrollEnabled`, so the
   caller's expression stays verbatim (guard-pinned).
2. **The LOCAL PARAMS vertical ScrollView** (~line 1245) — the sliders live
   inside it; the vertical drift of a horizontal fader drag is what scrolls
   it today. `nestedScrollEnabled` stays.
3. **The COLORS citizen card's ScrollView** (~line 1734, portrait
   full-width block) — the hue dial and BLEND scrubber sit inside it; this
   is the deck bug of `_263` in its mixer mount.

NOT enlisted, deliberately: the workspace bar's chip ScrollView and the
groups/blend modal ScrollViews (tap surfaces — locking them buys nothing and
widens blast radius), the TimerWheel FlatList (it IS a scroll surface, not a
dragger), dimmer_rack's already-gated row (prior art, untouched). Note the
lock store is app-global: during a mixer fader drag the deck's enlisted
hosts lock too — harmless (one finger) and symmetric with `_263`.

### 5.3 Invariants carried

Web byte-identical (acquires are gated `Platform.OS !== 'web'` at the
acquirer, already shipped; `LockableScrollView` passes `scrollEnabled`
through when idle). Tap-changes-nothing preserved: a tap takes and returns
the lock and writes no frame (`_263` pinned tests). Release on release AND
terminate AND unmount — already the fader's contract; no mixer-side lifecycle
code at all. Guards: extend `native_gesture_armor.test.ts` with mixer.tsx
source assertions (three hosts render `LockableScrollView`; the strip
scroller's `scrollEnabled` expression preserved).

---

## 6. Impeccability critique — both operator screenshots, item by item

Landscape reads WELL: the chip rail earns the master row's reclaimed width,
cards balance, the thin strip is honest. The polish list, priority-ordered
(C1–C2 are fixed by §4 outright; the rest are P2 riders with
recommendations):

- **C1 — trailing caption hard-clips at the fold** (`MID…` in the
  operator's shot; measured 262 pt starting at x=1193 of 1366). Fixed by
  §4.3.
- **C2 — fresh-store landscape leaves the COLORS chip a 38 pt sliver** past
  the HIDDEN divider (measured rightEdge 1423 > 1366) — an under-44 pt
  target of the exact kind docs/66 outlaws. Fixed by §4.1 + §4.2 (with
  truncation the fresh rail fits outright).
- **C3 — the card HEADER hard-clips long titles too** (portrait capture:
  `AMBIENT GOLDEN HOUR CATHEDRAL WAS`). Rider: `numberOfLines={1}` on the
  strip header title so it ellipsizes instead of shearing. One line.
- **C4 — adjacent chip hit regions overlap 8 pt** (gap `Space.sm`=8 <
  2×8 hitSlop) — the `_272` BPM-boundary finding's milder cousin: a tap on
  the seam can fire the neighbor. Rider: raise the bar's `barContent` gap
  to 12 (visual change ≈ invisible, seam gets real separation). Applies to
  the mixer bar's own style; the deck bar may adopt the same gap in its own
  file — coordinate, don't fork the chip.
- **C5 — bar vertical padding is asymmetric** (`paddingTop:4,
  paddingBottom:2`); with the rail now the portrait row's only content the
  lopsidedness reads as a misalignment against the strip above. Rider:
  4/4.
- **C6 — three chips reading `N · DEFAULT` carry no identity** beyond the
  index (playlist-name fallback when no entry is active). Not this wave —
  `deriveChannelTitle` is shared with the card header and a smarter
  fallback (prefer the queued entry's pattern when the playlist name is the
  generic `default`) deserves its own tiny design note; flagged for the
  backlog, no W-item.
- **C7 — portrait with 3 visible shows 2.5 cards** (third clipped
  off-right, by design, scrollable). Correct behavior; once the rail is
  back (order 3) the operator's own fix — hide to 2 — is one tap. No
  change.
- **C8 — the portrait full-width thin strip** looked odd in the operator's
  shot mostly because the rail beneath it was missing; with §3 it reads as
  strip-over-rail, the landscape grammar rotated. No change.

---

## 7. Must-not-change pins

1. Everything `_270` landed and proved: view-only hiding (**zero engine
   calls** from any chip/section affordance), the D1 floor, aspect-honest
   band geometry (§3.2 sizing untouched — this wave never touches
   `pixel_view_band_logic` numbers), thin-strip-only-when-band-hidden, the
   single perf caption (its POSITION changes in §4.3, its count and source
   do not), perf overlay as a pure derivation with byte-identical store
   round-trip.
2. `_263` lock semantics: acquire on grant, release on release/terminate/
   unmount, idempotent release, web inert. No new acquire sites in this
   wave; hosts only.
3. The shared `WorkspaceChip` public props stay byte-compatible; the deck
   bar's rendering must be pixel-identical after §4.1 (its labels are all
   under the cap) — assert via the existing chip/contrast suites.
4. docs/66's 44 pt floor: every chip keeps a ≥44 pt effective target;
   nothing in this wave introduces a sub-44 control.
5. `WORKSPACE_KNOWN_SET_RULE` stays ONE shared object (same-reference test
   keeps passing); the policy edit is a text/table change in the one
   canonical file.
6. Zero engine changes; client-only; no restart rides on this wave.
7. Offline readiness: no new dependencies (§4.2's affordance is plain
   Views/Text by design).

---

## 8. Operator decision points (defaults chosen; overrides welcome)

| # | Question | Recommended default |
|---|---|---|
| D1 | Who gets the masterBand default flip? | **Fresh stores only** (no migration) — the known-set machinery already proves existing stores keep their screen; a migration could fight an explicit reopen (§2.2) |
| D2 | Perf mode on a fresh store: no master band? | **Accept** — perf never resurrects a closed citizen (docs/64 §2.6); the thin strip carries master honesty; MASTER VIEW is one tap away on the rail |
| D3 | Truncation mechanism | **Style-level** `maxWidth:168` + `numberOfLines=1` on the shared chip label (pixel-honest, full title preserved in data + a11y). Alt: pure char-cap in `channelChipLabel` (testable in vitest but font-blind) |
| D4 | Overflow affordance | **Pinned `›` hint while scrollable-and-not-at-end** (no new dep). Alt: `showsHorizontalScrollIndicator={true}` (free but invisible until touched on iPadOS) |
| D5 | Caption placement | **Pinned outside the scroller, right end, ellipsizing** (§4.3). Alt: keep in-scroll (rejected — reproduces the operator's clipped caption) |
| D6 | Lock-enlisted hosts | **Exactly the three of §5.2.** Alt: also the chip rail's ScrollView (rejected: taps only, blast radius for nothing) |
| D7 | C4 chip-gap rider | **gap 8 → 12 in the mixer bar** (hit-region separation). Alt: trim hitSlop to 4 L/R (rejected: shrinks the 44 pt target) |

---

## 9. W-items (ONE Opus session; sequence as listed)

**File-ownership note:** `mixer.tsx` is touched by W2 and W4 — serialize.
W1 (pure store) and W3 (shared chip + bar) are independent of each other.
Baseline discipline per docs/58 §6: suites baselined first, tsc/eslint
clean, no git ops, scratch ports only (17xxx/71xx, sACN → TEST-NET-1,
`MARSIN_STATE_DIR` redirected — the `_270` §7 residue incident is the
cautionary tale), fresh dist never exported into `CaptainPad/dist`.

**W1 — masterBand defaults CLOSED (pure).**
Files: `components/mixer/mixer_workspace_layout.ts` (+ its test),
`components/workspace_known_set_policy.ts`, `docs/64` addendum note.
*Accept:* the §2.4 test list 1–5 verbatim; the same-reference convergence
test still passes; full existing suite green (the new-id policy table tests
flip their masterBand row).

**W2 — portrait rail fix (styles only).**
Files: `app/(tabs)/mixer.tsx` (`masterBarFillPortrait` + style array).
*Accept:* source guard pins `flexBasis: 'auto'` on the portrait override;
web portrait screenshot unchanged vs `~/tmp/mixer_polish_fable/`
`p5_portrait_master_hidden.png` (bar present at full width, one row);
landscape screenshots byte-identical; operator on-device check scripted
into the handoff note (§3.3).

**W3 — chip diet: truncation + overflow hint + pinned caption (+C3/C4/C5
riders).**
Files: `components/ui/workspace_chip.tsx` (label cap),
`components/mixer/mixer_workspace_bar.tsx` (hint, caption move, gap, padding),
`app/(tabs)/mixer.tsx` (header `numberOfLines` rider — coordinate with W2's
edit window), guards.
*Accept:* with the 40-char repro title: chip total ≤ 220 pt, label
ellipsized, index prefix visible; fresh-store landscape rail fits 1366 with
NO sub-44 pt sliver chip (re-measure the §1.2 probe); perf caption count
still exactly 1, never clipped at the fold (ellipsis proof at a forced
narrow viewport); `›` hint appears only while scrollable-and-not-at-end;
deck bar pixel-identical (chip/contrast suites + one deck screenshot
compare); a11y labels carry full titles.

**W4 — mixer scroll-lock enlistment.**
Files: `app/(tabs)/mixer.tsx` (three host swaps §5.2),
`components/native_gesture_armor.test.ts` (mixer guards).
*Accept:* guards pin the three `LockableScrollView` hosts + the preserved
`scrollEnabled` expression; web dist screenshot byte-comparable;
tap-changes-nothing re-asserted (existing `_263` suite green); on-device
walk in the handoff note: CHANNEL fader drag → row must not pan; LOCAL
PARAMS slider drag → column must not scroll; portrait COLORS hue-dial drag
→ card must not scroll; every tap → value unchanged, scrolling restored on
lift.

**W5 — validation walk (Opus, last, no product files).**
Suites vs baseline, tsc/eslint, screenshot matrix §10 at both orientations
(web) + the two on-device checklists (W2, W4) written up for the operator's
next round, persistence round-trips (reload; upgrade store `{closed:[],
known:[…masterBand]}` keeps the band open; no-key store rails MASTER VIEW),
perf enter/exit byte-identity re-run (the store must survive §2's flip
unchanged mid-show).

---

## 10. Screenshot matrix (scratch stack; 1366×1024 and 1024×1366)

| # | shot |
|---|---|
| 1 | Fresh store, landscape — MASTER VIEW + COLORS on the rail, thin strip residue, every chip fully on-screen |
| 2 | 3 channels, one 40-char title — truncated chip, tail chips reachable, `›` hint while overflowing |
| 3 | Operator-state perf (band hidden, one channel railed) — pinned caption, ellipsis not clip, count 1 |
| 4 | Portrait, fresh + operator-state — rail visible below the strip, full width, one row (web; native = operator checklist) |
| 5 | Upgrade pair — pre-flip store keeps band OPEN; no-key store CLOSED |
| 6 | RESET → band + COLORS closed, all channels visible |
| 7 | Reload after 2/3 — persistence restored |
