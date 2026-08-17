# _273 — Mixer polish DESIGN (Fable): band default-closed, the portrait rail's native collapse, chip diet, mixer scroll lock — `docs/67`

**Kind:** design (Fable pass; ONE Opus implementer session follows) ·
**Contract produced:** `docs/67_mixer_polish.md` ·
**Operator context:** delighted with the docs/64 relayout ("mixer view
improvements! great! love it!!!"); four polish orders + "review the two
screenshots" from live iPad testing (gen-8 prod, native, both orientations).

## Reproduction — measured on a scratch stack, not guessed

Dist :7183 (reused the W7 export — verified newer than every mixer source it
renders), engine :17983 from a config copy (sACN → TEST-NET-1 `192.0.2.x`
only, OSC/fire-sync/audio/web_client off, `MARSIN_STATE_DIR` redirected,
`BM26_CAPTAINPAD_AUTH_REQUIRED=0`), 3 channels seeded, one renamed to a
40-char title. Live :6967/:6968 confirmed 200 before and after; stack torn
down; zero repo/state residue. Evidence: `~/tmp/mixer_polish_fable/`
(screenshots + `polish_probe.json`).

### Order 3 mechanism — portrait rail collapses to 0 pt on NATIVE only

`styles.masterBarFill = { flex:1, minWidth:0 }` seats the workspace bar in
the master row. Portrait flips `masterRow` to a COLUMN, so `flex:1` becomes
the height axis: `flexBasis:0%` inside a content-sized (auto-height) column
— Yoga has no definite free space to distribute, so the bar measures **0 pt
tall**. react-native-web resolves the same style through CSS intrinsic
sizing and keeps the 34 px content height — which is why every W7 portrait
screenshot (web puppeteer) passed while the operator's native iPad shows no
rail. Differential is photographic: same build + store renders the bar
912×34 on web portrait; operator's native portrait shows the sibling strip
(content-sized, survives) and nothing else. Fix: portrait style override
`{ flexGrow:0, flexShrink:0, flexBasis:'auto' }`; acceptance is NATIVE
(on-device checklist) + web-unchanged.

### Order 4 mechanisms — two, both measured

1. **Unbounded chip width:** the shared `WorkspaceChip` label has no
   `numberOfLines`/`maxWidth`; the 40-char title renders a **349 pt chip**
   (label text 296 pt) in an 831 pt bar viewport.
2. **Fold with no affordance:** the bar's ScrollView hides its indicator and
   renders no overflow hint; fresh-store landscape content = 904 pt in
   831 pt, leaving the COLORS chip a **38 pt sliver** (rightEdge 1423 on a
   1366 screen) — under the 44 pt floor, unreachable without a scroll
   nothing advertises. In the operator-matching perf state the 262 pt
   caption hard-clips at the fold — his `…MID…` screenshot reproduced
   pixel-for-pixel. Handlers are alive (harness clicked the long chip fine):
   it is a reachability/affordance failure, aggravated on native by
   tap-becomes-scroll-claim.

## The design (docs/67, per order)

1. **masterBand default CLOSED:** `SHIPPED_DEFAULT_CLOSED_CITIZENS =
   ['colors','masterBand']` — its only two consumers (normalize fallback,
   reset) then do the right thing. **Fresh stores only, NO migration**:
   every post-`_270` store records `citizen/masterBand` in `known`, so the
   `wasKnown` gate provably exempts all existing stores; a migration cannot
   distinguish "deliberately reopened" from "never touched" and would risk
   fighting an explicit choice (the `_225` invariant). The shared
   `WORKSPACE_KNOWN_SET_RULE` table row flips with rationale; same-reference
   convergence test keeps holding. Pinned consequence: fresh store in perf
   shows NO band (perf never resurrects a closed citizen).
2. **Mixer scroll lock:** audit found every mixer drag-steered control is
   already a lock-acquiring `HorizontalFader` (`_263`) — **zero new acquire
   sites**; the wave is host enlistment only: the channel-strip horizontal
   ScrollView, the LOCAL PARAMS ScrollView, the COLORS citizen card's
   ScrollView become `LockableScrollView`. TimerWheel is a native FlatList
   (scroll-vs-scroll, not a PanResponder) — no seam. Chip rail + modals stay
   plain (taps). Web byte-identical; tap-changes-nothing carried.
3. **Portrait rail:** fix above; placement ruling — its own full-width row
   below the master strip, ONE row, never wraps (truncated chips make 5
   chips ≈ 700 pt < 992 pt portrait row; overflow scrolls behind the hint).
4. **Chip diet:** `WORKSPACE_CHIP_LABEL_MAX_WIDTH = 168` (≈25 uppercase
   chars at the measured 6.7 pt/char) + `numberOfLines={1}` on the shared
   chip — tail ellipsis keeps the `N · ` index by construction; full title
   stays in data + a11y; deck bar pixel-identical (longest deck label
   ≈80 pt). Rail gains a pinned `›` hint while scrollable-and-not-at-end (no
   new dep — `expo-linear-gradient` is not in the tree). The perf caption
   moves OUT of the scroll content to a pinned, ellipsizing right slot.

## Impeccability critique (folded into docs/67 §6)

C1 caption clip + C2 COLORS sliver (fixed by the chip diet); C3 card header
hard-clips long titles → `numberOfLines` rider; C4 adjacent chip hit regions
overlap 8 pt (gap 8 < 2×8 hitSlop — the `_272` BPM-boundary class) → gap 12
rider; C5 bar padding 4/2 asymmetry → 4/4; C6 `N · DEFAULT` triple-identity
chips (playlist-name fallback) → backlog note, not this wave; C7 portrait
2.5-cards-by-design and C8 full-width thin strip → correct, no change.

## Deliverables + handoff

- `docs/67_mixer_polish.md` — five W-items (W1 store flip → W2 portrait fix
  → W3 chip diet + riders → W4 lock enlistment → W5 validation), measured
  acceptance criteria, 7-row screenshot matrix, 7 decision points with
  defaults (D1 fresh-only, D2 perf-no-band accept, D3 style-level
  truncation, D4 `›` hint, D5 pinned caption, D6 three hosts, D7 gap 12).
- Pins carried: `_270` invariants (view-only hiding, zero engine calls,
  floor, aspect-honest geometry untouched, ONE perf caption), `_263` lock
  semantics, docs/66 44 pt floor, shared-chip byte-compat for the deck,
  client-only / no engine restart / no new deps.
- Two acceptance items are NATIVE-ONLY and need the operator's device round:
  the portrait rail (web never had the bug) and the scroll-lock feel — both
  scripted as checklists in W2/W4/W5.

## Services + residue honesty

Scratch engine + dist server started and KILLED (ports 17983/7183 verified
free after); nothing touched 6966-6972/5568/6981 beyond two read-only
status GETs; engine state fully redirected (`~/tmp/mixer_polish_fable/state`)
— the real `marsin_engine/states/` untouched by this session. No git
operations, no product-file edits; new files: `docs/67_mixer_polish.md`,
this report, tracker/dossier landing lines.
