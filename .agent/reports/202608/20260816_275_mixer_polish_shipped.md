# _275 — Mixer polish SHIPPED: the master band defaults closed, the portrait rail exists, chips are on a diet, the sliders own their drag (Opus) — `docs/67`

**Kind:** implementation + validation (one Opus session, W1→W5) ·
**Contract:** `docs/67_mixer_polish.md` (Fable design `_273`) ·
**Operator:** Sina Solaimanpour · **Scope:** CaptainPad client only — zero
engine changes, no restart, no new dependencies.

The operator's four orders off live iPad testing, all four answered:

1. *"Master 2D pixels is too large — just DISABLE (hide) it BY DEFAULT."* →
   W1.
2. *"When working with sliders on the mixer layers, disable the master
   scroll."* → W4.
3. *"The vertical view doesn't show the hide/show buttons AT ALL."* → W2.
4. *"Some items in the hide-and-show are too-long texts — they couldn't be
   selected either."* → W3.

---

## W1 — `citizen/masterBand` defaults CLOSED (fresh stores only)

`SHIPPED_DEFAULT_CLOSED_CITIZENS` is now `['colors', 'masterBand']`
(`components/mixer/mixer_workspace_layout.ts`). Its two consumers —
`normalizeLayout`'s silent-id fallback and the reducer's `reset` — then do the
right thing with no further edits, and the shared
`WORKSPACE_KNOWN_SET_RULE` file's default table flips its masterBand row while
staying the SAME OBJECT both layout modules re-export (the `_270` §5
same-reference convergence test is still green).

**Fresh-stores-only, proven not asserted.** Every mixer store ever written
serializes `known = roster ∪ citizens ∪ sections`, so `citizen/masterBand` is
in the `known` of all of them and `normalizeLayout`'s `wasKnown` gate exempts
them automatically. A migration was rejected per D1: the store records
MEMBERSHIP, not INTENT, so "known and open" cannot tell *deliberately
reopened* from *never touched*.

**Pinned (the contract's §2.4 list 1–5, verbatim, +2):** upgrade store
`{closed:[], known:[…masterBand]}` keeps the band OPEN; a store that already
hid it by hand keeps it hidden and is not double-appended; no key at all →
closed, with `closed === ['citizen/masterBand','citizen/colors']` so the fresh
rail reads **MASTER VIEW, COLORS**; a synthetic `known` without the band →
closed; RESET closes both citizens and provably never a channel
(`shippedDefaultClosed` is citizen-only, asserted over the whole reset set);
**perf on a fresh store shows NO band** (D2, accepted) while an upgraded store
still gets it; serialize→normalize is a fixpoint (mid-show store stability).

Docs: `docs/64` §2.3 gained an as-built addendum and §7 a `D8b` row.

## W2 — the portrait rail (NATIVE-ONLY bug, web never had it)

`masterBarFillPortrait: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }`,
applied as `[styles.masterBarFill, isPortrait && styles.masterBarFillPortrait]`.
Mechanism as Fable named it: `masterRowPortrait` flips the row to a column, so
`flex:1` becomes `flexBasis:0%` + grow on the HEIGHT axis inside an
auto-height parent — Yoga has no definite main size to distribute, so the bar
measures 0 pt and the iPad shows no rail. react-native-web keeps the
intrinsic 34 px, which is why every web screenshot passed.

Landscape is byte-identical (`masterBarFill` untouched, the override only
ever joins the array under `isPortrait`) and the guard pins `flexBasis:'auto'`
by name — `flexGrow:0` alone would leave the 0 % basis and not fix anything.

## W3 — chip diet

- `WORKSPACE_CHIP_LABEL_MAX_WIDTH = 168` + `numberOfLines={1}` on the shared
  `WorkspaceChip` label (`components/ui/workspace_chip.tsx`), applied as its
  own `chipLabelCap` style so it composes with both label recipes. Full title
  stays in the data and in `accessibilityLabel`; no `flexShrink` on the label,
  so the 44 pt effective target (28 pt height + the exported 8 pt hitSlop)
  never shrinks.
- Pinned `›` overflow hint OUTSIDE the scroller. Its one decision was
  extracted to the pure module as `shouldShowBarOverflowHint` — the same
  discipline every other bar decision follows, so it is genuinely
  vitest-covered (6 cases: unmeasured, fits, the measured 904-in-831 overflow,
  at-end, rubber-band overscroll, sub-pixel epsilon) rather than a source
  guard over an untestable `.tsx` predicate. No new dependency.
- The perf caption moved OUT of the scroll content into a pinned, ellipsizing
  right slot. Still exactly ONE, still `PERF_PARAMS_CAPTION`, full sentence in
  `accessibilityLabel`.
- Riders: C4 chip gap `Space.sm`→`Space.md` (8→12 — adjacent 8 pt hit regions
  no longer overlap, the milder `_272` BPM-boundary class), C5 bar padding
  4/2→4/4.

**One measured DEVIATION from the contract.** §4.3 specified
`maxWidth: 260` for the caption; the caption's intrinsic width measures
**262.36 pt**, so 260 ellipsized it at EVERY viewport — turning "shortens
under pressure" into "permanently abbreviated", which is worse than
pre-wave at full width. Shipped **280**, and the guard pins the property as
*>263 and ≤320* rather than a bare number, so the intent survives a future
edit. Re-measured after the change: the caption renders WHOLE (262 pt) at
1366, 1024-portrait and 900, and genuinely ellipsizes (223 of 262) at a forced
380 px viewport — never sheared off the screen edge at any width.

**C3 (long card-header titles shear) is NOT implemented — deliberately.**
The strip header title is an editable `TextInput` (uncontrolled, `defaultValue`
+ blur-commit; the rename path with its own documented bug history). RN's
`numberOfLines` is a multiline/Android prop on `TextInput` and does nothing to
a single-line field on either platform, and RN exposes no ellipsize option for
`TextInput` at all — so the rider as scripted would have been an inert line
that looked like a fix. A Text/TextInput swap on focus is a real behaviour
change to renaming and far outside a P2 one-liner. Flagged for the backlog
alongside C6.

## W4 — the mixer joins the `_263` scroll-lock seam

**The "zero new acquire sites" claim was verified before it was trusted, by
grep, not by faith:** `PanResponder.create` appears in exactly 7 files
repo-wide; the only ones reachable from the mixer are `HorizontalFader`
(all four mixer render sites: LOCAL PARAMS via the shared `ParamRow`, the
CHANNEL fader, the HUE trim, the GLOBALS master fader) and, inside COLORS,
`hue_wheel` — both of which have carried the lock since `_263`.
`NauticalFader` is dimmer-rack-only, `split_playlist_panes` is deck-only,
`TimerWheel` is a FlatList (scroll-vs-scroll, not a PanResponder).

Three hosts, exactly, became `LockableScrollView`: the channel-strip
horizontal scroller (its count-based `scrollEnabled` expression preserved
verbatim and guard-pinned), the LOCAL PARAMS column (`nestedScrollEnabled`
kept), the COLORS citizen card. Guards in
`components/native_gesture_armor.test.ts` count open AND close tags
(exactly 3 each), pin each host's distinguishing prop, assert none was left
bare, and assert mixer.tsx never touches `acquireScrollLock`/
`releaseScrollLock` itself.

## W5 — validation walk

Scratch stack only: dist **:7184** (fresh 8.3-short-path export, `index.html`
+ `mixer.html` mtime verified), engine **:17984** from a config copy — sACN →
TEST-NET-1 `192.0.2.x` only, OSC/fire-sync/web_client disabled,
`MARSIN_STATE_DIR` redirected to `~/tmp/mixer_polish_opus/state`. The
operator's live 6966-6972/:6981 were never bound; :6967 and :6968 answered 200
before and after; both scratch ports verified FREE after teardown;
`marsin_engine/states/` mtimes unmoved. Three channels seeded, one renamed to
the 40-char **"Ambient Golden Hour Cathedral Wash Layer"**, reproducing
Fable's repro exactly. Evidence + `w5_probe.json`:
`C:/Users/Titanic's End/tmp/mixer_polish_opus/` — every PNG inspected.

### Measured acceptance (before → after)

| Measurement | Contract bar | Before (`_273`) | After |
|---|---|---|---|
| Long-title chip, total | ≤ 220 pt | **349** | **220** |
| Long-title chip, LABEL | ≤ 168 pt | 296 | **168**, ellipsized, `2 · AMBIENT GOLDEN HOUR C…` |
| Fresh landscape bar content vs viewport | fits | 904 in 831 (overflow) | **1068 in 1068 — no overflow** |
| COLORS chip, fresh landscape | ≥ 44 pt, on screen | 38 pt sliver, rightEdge **1423** > 1366 | **95×28 pt**, rightEdge **1079** < 1366 |
| Widest chip right edge, fresh landscape | ≤ 1366 | 1423 | **1079** |
| Perf caption | count 1, never clipped | 262 pt hard-clipped at the fold (`…MID…`) | **262 pt whole**, right 1350 < 1366, pinned OUTSIDE the scroller |
| Perf caption at 900 / 380 px | ellipsis, not shear | — | 262 whole at 900; **223 of 262 ellipsized** at 380, right 364 < 380 |
| `›` hint | only while scrollable-and-not-at-end | absent | shown at 777-in-799 and 465-in-799; absent at 1068-in-1068 |
| Every chip height | ≥ 28 pt (44 effective) | 28 | **28**, all 5 |

### Deck pixel-parity proof

Same shared chip, deck bar, same viewport: 8 chips, labels **25–75 pt**
(longest `PARAMETERS` = 75), **none truncated** (`scrollWidth === clientWidth`
on every one), scroller 1112-in-1112 no overflow, chip heights 28 (PLAN 48, its
own recipe). The cap is 168 — more than double the widest deck label — so no
deck chip can reach it, and `numberOfLines={1}` cannot change a label that had
no wrap opportunity. The `restyle_contrast` / design-token / chip suites are
green, and the deck screenshot matches its known layout.

### Persistence + lock probes

- Fresh landscape store persists `closed:["citizen/masterBand","citizen/colors"]`
  with the full `known` — the flip lands, in rail order.
- Upgrade store (`known` incl. masterBand, `closed:[]`) renders the band OPEN
  with no HIDDEN divider — the pre-flip screen reproduced.
- Reload after hide-band + rail-a-channel restores the exact store and screen.
- Hosts on web behave as plain ScrollViews (nothing acquires there): channel
  strip 1254-in-1420 and `scrollLeft` moves 0→120; LOCAL PARAMS 112-in-288
  scrollable; COLORS card 605-in-1087 and `scrollTop` moves 0→60.
- Console: only the pre-existing minified React **#418** hydration warning,
  which reproduces identically on untouched routes (`/config`, `/audio`, deck
  `/`) — not this wave's.

**Row 6 of the matrix (RESET) has no mixer UI affordance.** `useMixerWorkspace`
exposes `reset()` but `mixer.tsx` wires no control to it, so it cannot be
screenshotted; it is pinned at the reducer level instead (band + COLORS closed,
all channels visible, reset-closed set provably citizen-only).

**Degenerate-width note, not a defect:** at a 380 px viewport the bar's
scroller measures 0 px wide, so the hint correctly answers false via its
documented `viewport <= 0` guard. No iPad reaches that width.

---

## Gates

- **CaptainPad suite: 104 files / 2265 passed / 6 skipped / 0 failed** (baseline
  was 103/2224 — **+1 file, +41 tests**). No foreign in-flight reds were
  observed at any point; the concurrent deck-reopen work (`_274`) was green
  when this landed.
- `tsc --noEmit` clean. `eslint .` — **0 errors in any file this wave
  touched**; the repo's 10 standing errors are all in the untouched
  `scripts/osc_synth.mjs`, and no new warnings.
- Two tests elsewhere flipped their masterBand expectation with the default
  (`hooks/use_mixer_workspace.test.ts`, `mixer_workspace_bar_logic.test.ts`) —
  each rewritten to assert the NEW truth rather than deleted.

## Files

`CaptainPad/components/mixer/mixer_workspace_layout.ts` (+ test),
`components/workspace_known_set_policy.ts` (doc/table only — same object),
`components/mixer/mixer_workspace_bar_logic.ts` (+ test),
`components/mixer/mixer_workspace_bar.tsx`,
`components/ui/workspace_chip.tsx`, `app/(tabs)/mixer.tsx`,
`components/native_gesture_armor.test.ts`,
`hooks/use_mixer_workspace.test.ts`, **new**
`components/mixer/mixer_polish_source_guards.test.ts`,
`docs/64_mixer_relayout.md` (as-built addendum).

**No engine changes, no restart. CaptainPad rebuild required** (the
coordinator's `rebuild-pad`; nothing was exported into `CaptainPad/dist` by
this session).

---

## Operator device checklist — the two NATIVE-ONLY acceptance items

Web cannot prove either of these: the portrait rail bug does not exist on
react-native-web, and the scroll lock is inert there by design. Three steps,
on the iPad, after `rebuild-pad`:

1. **Portrait rail (order 3).** Open MIXER, rotate to **portrait**. The chip
   rail must be visible as its own full-width row **directly below the MASTER
   OUTPUT strip** and above the channel cards — one row tall, never wrapped.
   Tap **MASTER VIEW** on it: the band opens; tap again: it closes. Rotate back
   to **landscape**: identical to before this wave.
2. **Scroll lock (order 2), three drags.** With ≥4 channels open (so the strip
   row actually scrolls): drag a **CHANNEL fader** left/right — the strip row
   must NOT pan under your finger. Open **LOCAL PARAMS** and drag a slider —
   the params column must NOT scroll. In **portrait**, open **COLORS** and drag
   the **hue dial** — the COLORS card must NOT scroll. In all three, lift your
   finger and confirm scrolling works again immediately.
3. **Taps change nothing.** Tap (don't drag) each of those three controls once:
   the value must not move, and the surface must stay scrollable. Then, on a
   **fresh pad or after clearing storage**, confirm the master 2D band starts
   HIDDEN with MASTER VIEW on the rail — while YOUR pad, which already has a
   stored layout, keeps whatever it was showing.

Report anything that fails at step 1 as native overflow (the fix is structural
but the device is the judge) and anything at step 2 as a missed host.
