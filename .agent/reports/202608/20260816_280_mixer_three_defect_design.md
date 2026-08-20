# _280 — Mixer three-defect DESIGN (Fable): the `_275` portrait fix was provably inert on Yoga, the lock's render round-trip is the glitch, and patterns become the landscape card's first citizen — `docs/69`

**Kind:** design + root-cause investigation (no product code edited) ·
**Contract produced:** `docs/69_mixer_three_defect_triage.md` ·
**Operator:** Sina Solaimanpour · **Implements next:** one Opus session
(W1..W4 in the contract).

Three operator orders off the freshly rebuilt pad; per-item verdicts:

## Item 2 — portrait rail: ROOT CAUSE FOUND, high confidence, evidence executed

The `_275` W2 override (`flexGrow:0, flexShrink:0, flexBasis:'auto'` layered
over `masterBarFill`'s `flex:1`) is **inert on native Yoga**: this RN
version's own vendored `yoga/node/Node.cpp:329-339` (`processFlexBasis`)
returns an explicit basis only when it is *neither auto nor undefined* — an
explicit `'auto'` falls through, and the co-flattened `flex:1` forces
**basis 0** (native never uses web defaults) while the explicit `flexGrow:0`
*does* win. Resolved on device: grow 0 · shrink 0 · basis 0 → **0 pt bar**,
the same zero as the original `_273` bug. CSS longhands beat the shorthand
on react-native-web, which is why web screenshots passed twice while the
iPad failed twice — and the `_275` source guard pins `flexBasis:'auto'`,
i.e. **the guard enforces the bug**.

Proof was executed, not argued: yoga-layout 3 (WASM build of the same C++)
ran the shipped portrait chain — pre-fix `{flex:1}` → **0**, shipped `_275`
composition → **0**, a seat with no flex-family keys → **36**, `flex:0` +
longhands → **36** (`~/tmp/mixer_three_design/yoga_probe/probe.mjs`). Stale
bundle ruled out: the operator's same round confirms `_275` W4 (same file,
same session) works. "No master output" is the same defect's shadow — the
0 pt rail leaves the portrait master block a ~26 pt label + 12 pt sliver
(`ChannelVizStrip` itself provably cannot collapse).

**Fix (W1):** style SELECTION, not override — portrait seat object carries
NO flex-family key, exported pure; the `_275` guard flipped; and a
**Yoga-executed vitest** (`yoga-layout@^3` devDep) that fails on both
historical compositions — the class-killing net web screenshots can never
be. Acceptance keeps the operator's asked-for device screenshot (agents
cannot produce a native screenshot; the handoff says so and scripts the
20-second check).

## Item 1 — drag-start glitch: mechanism named, fix is a synchronous fast path

Acquisition timing is already optimal (grant fires at touch-down;
`lockScroll()` is first). The hole is **propagation**: acquire →
`useSyncExternalStore` → re-render → Fabric commit ≈ 1-2 frames before
`scrollEnabled=false` reaches the `UIScrollView`, whose pan starts after
~10 pt of slop — a fast drag covers the slop inside the hole, so the host
pans briefly, then freezes. **Fix (W2):** `LockableScrollView` gains a
native-only subscription that calls
`getNativeScrollRef()?.setNativeProps({scrollEnabled})` — a real
synchronous UI-thread update on Fabric in this RN version (verified in
`ReactFabricHostComponent.js:137`) — landing the disable in the same frame
as the grant. Render path stays the source of truth and web stays
byte-identical; zero acquire-site changes; unlock restores
`callerProp ?? true` via a pure, vitest-pinned resolver. Escalation path
(gesture-handler dependency) named and not taken.

## Item 3 — landscape patterns: measured, and the rethink is authorized

Scratch-measured tonight (current tree, 3 ch, edit, defaults): playlist
viewport **56 pt = 0 full rows** at 1194×834 (208 pt pixel-band block +
203 pt fixed rows eat the card); 246 pt = 4 rows at 1366×1024; rows cost
~57 pt. `_279` (landed mid-design) proved independently that params-hide
buys landscape width only, offered the right mechanism in its §5 ("relocate
the band into the column… ~5 rows"), and found the cliff in §6 (landscape +
MASTER VIEW open crushes the body to 283×0). **Design (W3):** in landscape
edit the band moves into the RIGHT column above LOCAL PARAMS — perf mode's
proven grammar, now the ONE body shape for both modes; patterns get the
full body height. Targets: **≥4 full rows at 1194×834, ≥7 at 1366×1024,
everything default-shown** (≥5/≥8 with the 44 pt compact-row rider); the
edit band shrinks to its column (~72-122 pt canvas — the trade the operator
ordered, D4 records the veto). Composes with `_279`, never reverts it;
portrait untouched; deck pixel-identical. **Mid-design coordinator update
(incorporated):** the `_279` §6 crush bug is owned by a DEDICATED
operator-green-lit Opus agent (`mixer.tsx` + `mixer_scroll_layout.ts`,
landing `_281`-range) — docs/69 treats it as LANDED SUBSTRATE, not a W3
package: W3 rebases on it (blocks if unlanded at session start) and asserts
crush non-regression only (D7 rewritten accordingly).

## Decisions D1-D8

In `docs/69` §6, one line each: seat = keyless selection (D1),
`yoga-layout` devDep net (D2), setNativeProps fast path (D3), band → media
column (D4), 44 pt row diet (D5), playlist chrome merge (D6), crush bug
folded into W3 (D7), pixels default stays VISIBLE (D8).

## Probe hygiene

Fresh export of the current tree → dist :7189 (own static server; a
bootstrap page pinned `API_BASE` to the scratch engine BEFORE app boot, so
the browser never touched live :6968); engine :17989 from a config copy —
sACN → TEST-NET-1 `192.0.2.x` only, no Art-Net line, `controllers: []`,
OSC/fire-sync/audio/web_client off, auth off, state/playlists/timeline
redirected under `~/tmp/mixer_three_design/`; 3 channels seeded from copies
of the operator's real `titanic` playlists. Live :6967/:6968 answered 200
before and after; both scratch ports verified FREE after teardown; one expo
export machine-wide honored (waited out `_279`'s `dist_after` export). No
git ops; no product file edited; `CaptainPad/dist` never written.

Side observations, banked not chased: on web, a live landscape→portrait
resize did NOT re-derive `isPortrait` until reload (RNW dimensions
staleness — irrelevant to the device, noted for future web probes); the
browser-pane screenshot pipeline wouldn't composite, so tonight's evidence
is numeric (`getBoundingClientRect` probes), which the contract's W4
screenshot matrix supersedes.

## Collisions

`_279` landed mid-design and is **load-bearing prior art here, not a
conflict** — docs/69 W3 explicitly rebases on it. A second substrate is in
flight at close: the dedicated landscape crush-fix agent (coordinator
message, operator green-lit) owns `mixer.tsx` + `mixer_scroll_layout.ts`
and lands the bounded-flex-chain fix in the `_281`-range — the docs/69
implementer INHERITS both and W3 blocks on that landing if it isn't in the
tracker at session start. The deck debug thread (`deck_workspace_layout.ts`
/ `index.tsx`) is disjoint. Implementer must re-check the tracker tail at
start (more threads landing tonight; `_278` and `_279` both appeared during
this session).

**Files:** `docs/69_mixer_three_defect_triage.md` (new; the contract),
this report, tracker landing block, dossier row + log, `context/now.md`,
memory fact `yoga_flex_shorthand_trap.md`. **No rebuild rides on this
design session.**
