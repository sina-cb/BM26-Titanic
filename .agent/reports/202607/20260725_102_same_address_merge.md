# `_102` — Same-address merge: warning instead of error, unified packets, higher IP wins

**Date:** 2026-07-31 · **Branch:** `feat/bm_readiness` · **Agent:** Opus (developer)
**Status:** LANDED (uncommitted — git ops are operator-gated)

## The order

> **Operator, 2026-07-31 (verbatim):** *"make controllers allow sending to the
> same address with a warning instead of an error — and for those, make sure you
> unify the packets and then send; if conflicting, prioritize higher IPs and
> override."*
>
> **Operator emphasis, same day (verbatim):** *"but the UI must show that that's
> a warning."*

---

## 1. Where "the same address" was an ERROR

I swept every place a same-(universe, channel-range) claim was refused. There
turned out to be exactly **one** hard refusal, and three places that were already
warnings:

| Site | Verdict BEFORE | Verdict NOW |
|---|---|---|
| **`derivePerOutputPlan` → `universe_owned` collision** — `simulation/src/dmx/led/device_config_mapper.js:352-362` | **BLOCKING.** Pushed a `collisions[]` entry, which refused the push in all three consumers (single push, fleet push, sync chip) | **WARNING.** A `sharedUniverses[]` entry, mirrored into `warnings[]` |
| `validateLedManualUniverses` → `led_universe_collision` / `led_universe_duplicate` — `led_patch_projection.js:397+` | already WARN, never blocked | unchanged |
| `computeProjection` per-universe overlap sweep — `controller_registry.js:2185-2222` (`overlap` violation, "BOTH KEPT") | already WARN (red chip, claim stands) | unchanged |
| sACN bridge cross-scene universe conflict — `server/sacn_bridge.js:623-643` | already WARN (all relayed) | unchanged |

The three consumers of the blocking verdict, all in
`simulation/src/gui/led_discovery_panel.js`:

- `showPerOutputCollisionRefusal` — the ✋ modal ("**Push refused** … an output
  that would stream on a universe another controller already owns"),
- `startPerOutputPush` / `pushAllLedControllers` — the pre-flight gate,
- `computeSyncState` — reported `drift` so the chip agreed with the refusal.

All three now let a shared universe through; all three say so.

**One asymmetry is deliberate and stays:** an **explicit operator-declared**
universe may now be shared, but the **auto-assign** paths (universe repair, park
allocation) still skip every claimed universe. The sim never *chooses* to create
a shared address — it only honours one the operator declared.

---

## 2. The merge semantics

New pure module: **`simulation/src/dmx/address_merge.js`** (no DOM, no I/O, no
registry mutation — every rule below is unit-tested byte for byte).

### 2.1 Overlap

An overlap is **same universe AND intersecting channel range**. Two claims on one
universe at disjoint channels are not a contest at all. The contested region is
the **intersection only** — a 4-ch fixture at ch10–13 and a strand at ch12–20
contest ch12–13, and the strand keeps ch14–20 outright.

Global-effect pins are **exempt**: identical pin addresses gang-fire by design
(operator decision 2026-06-12, "same address to start multiple foggers at the
same time, always"), so they never produce a warning.

### 2.2 The IP comparison — NUMERIC, octet-wise

```
ipToNumber('a.b.c.d') = a·2²⁴ + b·2¹⁶ + c·2⁸ + d      (unsigned 32-bit)
```

Higher value wins. **This is not string ordering, and the difference is not
academic on this rig:** take two boxes in the same `/24` ending `.9` and `.10`.
As strings the `.9` one sorts HIGHER (because `'9' > '1'`), which is backwards;
numerically the `.10` one is the higher address and is therefore the winner.
Every controller IP on the show LAN sits in one `/24`, so the last octet is what
actually decides — exactly the number on the controller's label.

Two implementation notes worth keeping:

- `a * 2**24`, **never** `a << 24`. JS shifts are signed 32-bit, so every address
  whose first octet is ≥128 would come out NEGATIVE and rank below every address
  in 10/8. Invisible on this 10/8 LAN; it would surface the first time somebody
  plugged in a 192.168/16 box.
- `0.0.0.0` (the sim's "not wired yet" placeholder), blanks and malformed strings
  are **unrankable**, not "the lowest address".

### 2.3 Packet unification

A **destination** is a `(universe, IP)` pair and it gets **exactly one outgoing
packet per frame**. Two mechanisms, and they already agreed:

- `animate.js:686-718` already groups by `` `${universe}:${ip}` `` and sends the
  full universe buffer once per group. Confirmed, commented, and now pinned by a
  test on the plan's `destinations[]` (a destination appears once however many
  claimants feed it).
- The **universe frame buffer** is the composition point. `composeUnifiedFrame()`
  is the byte-level statement of the same thing: contributions are applied in
  **ascending IP order**, so the highest IP's bytes land last and win by
  construction. A contributor with an unrankable IP is refused there rather than
  ordered arbitrarily — that function is on the write path.

### 2.4 The override on the write path

Rather than depend on render-list order, the **loser is told which absolute
channels it must not write**:

- `lostChannelIndex(plan)` → `universe → losing IP → [{start, end, winnerIp}]`,
  built **once per projection** (`main.js publishAddressMergePlan`, at the end of
  `projectLedStrandPatches` where both projections are final), never per frame.
- `sacn_mapper.js mapPixelsToSacn` resolves it **once per pixel** (one Map miss on
  an uncontested rig, which is all of them normally) and routes every buffer write
  through `pokeChannel()`.
- Keyed by **IP**, not by claim label, because the render list is per-pixel and a
  pixel knows its `fixtureConfig.controllerIp` and its own `(universe, channel)`
  — not which projection record it came from. Equivalent by construction: two
  fixtures of the *same* controller contesting a channel is a `same_ip`
  ambiguity, which is a hard error and can never reach here.

The master-dimmer force-write (`buf[addr] = 255` for pars) goes through the same
gate — otherwise a losing par would blast the winner's fixture to full.

**One-liner:** *overlapping claims are allowed; each `(universe, destination IP)`
gets exactly one packet, and on any contested channel the numerically higher
controller IP overrides.*

---

## 3. The warning surfaces (operator's first-class requirement)

Four surfaces, all naming both claimants, the exact `(universe, ch range)`, and
who wins:

1. **PERSISTENT card banner** in the Controller Mapping pane —
   `renderSharedAddressBanner` / `sharedAddressBannerModel` in
   `led_discovery_panel.js`, styled `.led-shared-address-warn` in `style.css`.
   Amber, with a left rule so it reads as a **standing state**, not a dialog
   note. It is deliberately **not a toast**: a toast is gone in 8 seconds and the
   operator maps for an hour. It persists exactly as long as the overlap does
   (proven: the cleanup step in §6 shows it disappearing when the overlap goes).
2. **Push/save confirm dialog** — a `⚠ N SHARED ADDRESSES` block, placed **first**
   on the dialog, above even the "this saves the scene" notice, because it is the
   one item on the plan that changes what *other* hardware sees.
3. **Sync chip** — stays `in-sync` (a shared universe does not make the device
   differ from the plan, which is what the chip measures) but carries the warning
   in its `detail`, and therefore its tooltip.
4. **Logs** — `console.warn('[AddressMerge] ⚠ …')` on every transition from
   `main.js` (so an operator who never opens the pane still learns of it), plus a
   per-push `[LedPanel]` line naming the winner, plus the fleet push's
   per-controller `detail`.

The blocking grade is **visually distinct**: `.led-shared-address-error`, red,
different left rule, headline `✋ … UNRESOLVABLE … the push is REFUSED`. A test
pins that the two headlines and the two border colours can never be equal.

---

## 4. Ambiguous cases left as HARD ERRORS — operator decisions

The operator's rule ranks **IP-bearing** claimants. Where it cannot rank, I did
**not** invent a tie-break (codex P0). Both are named errors, rendered red in the
pane and refused at the push:

| Case | Why it is unrankable | What the operator sees |
|---|---|---|
| **Same IP** — two claims on one controller's own address, or two cards sharing an IP | One box cannot outrank itself; there is no winner to pick | `U<n> ch a–b: 'X' and 'Y' claim the same channels on the SAME controller IP <ip> — one box cannot outrank itself, so there is no winner to pick. Move one address.` |
| **No usable IP** — blank, `0.0.0.0` placeholder, or malformed | Nothing to compare against | `… but 'Y' has no usable controller IP (…) — the higher-IP rule cannot rank them. Give it a real device IP, or move one address.` |

**These are the two operator decisions this report hands back.** If either should
resolve automatically, the rule has to come from him — e.g. "on the same IP the
lower channel wins", or "a claimant with no IP always loses". I have implemented
neither, because either would be a fallback he did not ask for.

Scoping note: an unrankable overlap blocks **only the controllers that are part
of it**. One card is never held hostage by an unrelated bad pair elsewhere in the
rig.

---

## 5. Interplay with the `_89` bench mirror (composed WITH, not against)

Checked explicitly; nothing here fights it.

- The bench mirror lives in **`server/sacn_bridge.js`** and composes **inbound**
  sACN into destination universes, owning its `(universe, host)` pairs and
  suppressing the raw relay for exactly those (`mirrorOwned` /
  `mirrorSuppressed`, one-writer law from `_15`).
- This work lives on the **sim's outbound** side (`main.js` projection →
  `sacn_mapper` write path → `animate.js` per-destination send) and in the
  **mapping pane**. It touches no bridge file, adds no sender, and removes no
  suppression.
- The two are the **same doctrine at two layers**: the mirror unifies at the
  bridge ("one writer per destination pair"); this unifies at the sim ("one
  packet per destination, one winner per channel"). A universe the mirror
  composes still arrives at the box as one packet from one writer; a universe two
  sim claimants share still leaves the sim as one packet per destination.
- `_99`'s receiver-boot work and the `_89`/`_99` uncommitted bridge changes were
  **not touched** — `git status` shows `server/sacn_bridge.js` exactly as I found
  it.

---

## 6. Verification

### Unit tests — +53, all green

| File | Tests | What it pins |
|---|---|---|
| `simulation/tests/address_merge.test.js` | 32 | octet-wise IP folding incl. the unsigned->127 case and the string-order inversion; overlap = intersection only; determinism; the two ambiguity classes; `assertResolvableOverlaps` throws; destination uniqueness; **byte-level `composeUnifiedFrame`** (higher IP owns the overlap, order-independent, refuses unrankable, clamps to 512); the DMX-stable-id vs LED-panel-ordinal claim-collection trap; gang-fire exemption; the per-controller banner view |
| `simulation/tests/address_merge_runtime.test.js` | 9 | the real `mapPixelsToSacn` write path: higher IP owns contested channels in **both** render orders; a control test proving that **without** the merge the order decides (the defect this closes); the loser keeps every channel it did not lose; different universe / no-IP fixtures never suppressed; the **master-dimmer** byte obeys the override |
| `simulation/tests/shared_address_ui.test.js` | 12 | the banner exists / is absent correctly, names range + claimants + winner from **both** sides, warning vs error grade never collide; the push gate: unrankable REFUSES with the reason named, an unrelated unrankable pair does not block, a resolvable share PUSHES, a **malformed** merge plan throws rather than degrading to "no overlaps" |
| `simulation/tests/per_output_push.test.js` | 3 rewritten | the same three cases that asserted the OLD blocking behaviour, now asserting the warning: plan carries `sharedUniverses` + a mirrored `⚠` warning and **zero** collisions; fleet push **pushes** with the share in its detail; sync chip **in-sync** carrying the warning |

### Sim suite

| | tests | pass | fail |
|---|---|---|---|
| baseline (before) | 1592 | 1584 | **8** |
| after | **1645** | **1637** | **8** |

**Zero new failures.** The 8 are the known baseline set, byte-identical list
(fixture docking, titanic block acceptance, view-bit headroom, two parity CLI
rows, compression threshold, two `test_bench` model-parity rows).

### Security check

`python scripts/security_check.py --all` — **no findings in any file this thread
touched.** One finding was raised and fixed during the work: my first IP test
used a real routable address (first octet 128), which trips `bm26-public-ip`;
replaced with an RFC 5737 TEST-NET-2 address, which still proves the
unsigned-above-127 point.
The 6 remaining findings are the pre-existing MACs in the gitignored
`simulation/.scene_backups/**` (already tracked in `now.md`).

### Live verification — new probe, screenshots

**`simulation/agent_tools/shared_address_verify.cjs`** (`node shared_address_verify.cjs`),
run against the operator's live sim on the standard ports. **All 13 checks pass.**

Safety, per the service grant:
- the sACN OUT bridge socket (`ws :6972`) is **blocked before the first page
  script runs**, and the block is **asserted** before anything is touched
  (`framesSent = 0`) — this window can never put a frame on the wire;
- **zero device HTTP** — the injected controllers are unbound, nothing is pushed,
  no discovery runs;
- **zero scene writes** — the two overlapping controllers and their strands are
  injected into the **in-memory** registry only and removed again; the probe
  asserts nothing was saved, and the final screenshot shows the pane back to its
  original state;
- the probe IPs are **RFC 5737 TEST-NET-1**, ending `.9` and `.10`, chosen
  so that (a) they cannot collide with a real box even if something escaped, and
  (b) `.9` vs `.10` is exactly the pair a string comparison would get backwards.

What it proved live:

```
✓ baseline: no shared-address banner before the overlap exists
✓ the pane shows a ⚠ WARNING banner (not an error, not silence)
✓ the banner headline says the share is ALLOWED and the higher IP overrides
✓ the banner names the universe, the exact channel range, both claimants and the winner
✓ the ⚠ banner is reachable in the pane (scrolled into view for the capture)
✓ ONE destination (= one packet) per (universe, controller IP)
✓ the HIGHER IP owns the contested channels (blue, not red)
✓ the composed frame does NOT depend on render order
✓ the suppression names the LOSER only, with the winner recorded
✓ an unrankable overlap renders the ERROR grade, visibly distinct
✓ the error banner says the push is REFUSED and why
✓ warning and error banners do not share a colour
✓ cleanup: the banner is gone once the overlap is gone (nothing persisted)
✓ NOTHING was saved to disk
```

The live overlap message, verbatim off the running sim:

```
U900 ch 1-160: '__probe_ProbeHighIp' (<TEST-NET .10>) and '__probe_ProbeLowIp' (<TEST-NET .9>)
both send here - frames are UNIFIED into one packet per destination and <TEST-NET .10>
wins the contested channels (higher IP overrides).
```

and the wire read back off the real universe buffer:

```
lowFirst  : [0, 0, 255]     ← red from .9 painted first, blue from .10 wins
highFirst : [0, 0, 255]     ← identical: order does not decide
destinations on U900: ["U900 -> <TEST-NET .10>", "U900 -> <TEST-NET .9>"]  (one each - no racing packets)
suppression: <TEST-NET .9> loses ch 1-160 to <TEST-NET .10>
```

**SCREENSHOTS** (operator's required evidence), in `~/tmp/shared_address/`:

| File | Shows |
|---|---|
| `1_baseline_no_overlap.png` | the pane with no overlap — no banner |
| **`2_shared_address_warning.png`** | **the ⚠ amber warning banner on the affected card**, reading *"⚠ 1 shared address — allowed: frames are unified into one packet per destination, higher IP overrides"* over *"U900 ch 1–160 — shared with '\_\_probe_ProbeHighIp' (the TEST-NET `.10` box); '\_\_probe_ProbeHighIp' WINS and overrides this card here (higher IP)."* |
| `3_unrankable_error.png` | the same overlap on ONE IP → the red ✋ error grade, *"⚠ 1 UNRESOLVABLE — the higher-IP rule cannot rank these; the push is REFUSED until one address moves"* |
| `4_after_cleanup.png` | overlap removed → banner gone, pane unchanged |

---

## 7. `sacn-route-ownership` memory — the one-writer doctrine needs amending

This work **relaxes** the doctrine. The memory
(`.claude/…/memory/sacn-route-ownership.md`) currently says, flatly:

> *One writer per (universe, controller) is the law.*

That is still true **on the bridge relay**, and must stay. It is no longer the
whole truth on the **sim's outbound** side. Proposed amended bullet (coordinator
to apply — I did not edit the memory):

> - **One writer per (universe, controller) is the law ON THE WIRE, and it now
>   has two enforcers, not one.** (a) *Bridge relay:* engine-declared controllers
>   (`marsin_engine/config.yaml controllers:` + alsoFlat) are owned by the engine
>   and the bridge suppresses its relay for those pairs, logging why; the `_89`
>   bench mirror owns its composed destination pairs the same way. (b) *Sim
>   outbound (`_102`, operator order 2026-07-31):* several controllers MAY now
>   claim the same (universe, channel) — that is a WARNING, not an error. The
>   invariant is preserved by MERGING, not by refusing: exactly one packet per
>   (universe, destination IP), composed from one shared universe buffer, and on
>   any contested channel the numerically **higher controller IP** (octet-wise
>   numeric, never string order) overrides. Overlaps the IP rule cannot rank —
>   two claims on the SAME IP, or a claimant with no usable IP — remain HARD
>   ERRORS and refuse the push. Pure logic + the rule's full rationale:
>   `simulation/src/dmx/address_merge.js`; live probe:
>   `simulation/agent_tools/shared_address_verify.cjs`.

---

## 8. Files touched

**New**
- `simulation/src/dmx/address_merge.js` — the pure merge module
- `simulation/tests/address_merge.test.js` (32)
- `simulation/tests/address_merge_runtime.test.js` (9)
- `simulation/tests/shared_address_ui.test.js` (12)
- `simulation/agent_tools/shared_address_verify.cjs` — the live probe

**Changed**
- `simulation/src/dmx/led/device_config_mapper.js` — `universe_owned` collision →
  `sharedUniverses` + warning; doc block restated
- `simulation/src/gui/led_discovery_panel.js` — banner, confirm-dialog block,
  sync-chip detail, unrankable push gate, refusal-dialog prose, fleet-push detail
- `simulation/src/gui/controller_map_editor.js` — `addressMergePlanNow()` into `ledCtx`
- `simulation/main.js` — `publishAddressMergePlan()` at the end of
  `projectLedStrandPatches`; `__addressMergePlan` + `__addressSuppressionIndex`
- `simulation/src/dmx/sacn_mapper.js` — `pokeChannel` override on every buffer write
- `simulation/style.css` — `.led-shared-address*` warning/error grades
- `simulation/tests/per_output_push.test.js` — 3 tests rewritten to the new verdict

**Deliberately NOT touched:** `server/sacn_bridge.js`, `lib/bench_mirror.cjs`,
`lib/bridge_routing.cjs` (the uncommitted `_89`/`_99` work), any scene file, any
`marsin_engine/` timeline code (`_100` was in flight).

---

## 9. Residue I caused, and the guard I added (reported, not hidden)

**The first runs of my live probe rewrote a tracked file.** `main.js` calls
`saveModelJS()` on page boot, and my probe did not block the save server, so
loading the `test_bench` scene re-exported
**`marsin_engine/models/test_bench.js`**. Reporting it rather than reverting it
(codex: never use `git checkout` to hide a test side effect; AGENTS.md: engine
runtime residue is reported, not silently reverted).

**What actually changed, and it is not a regression:** the diff is the `Updated:`
timestamp plus the 76 `TE Sign V3 A` / `TE Sign V3 B` pixel rows flipping from
`type: 'dmx', channels: {r,g,b}` to `type: 'led', channels: null, whiteMode:
'native', unpatched: true`. That is the **`_92` correction landing in the export**
— the signs ARE LED, the model was stale on that point, and the re-export moved
it FORWARD onto the code already in the working tree. Any sim page load on this
tree would have done the same. The sim suite is byte-identical before and after
(the same 8 baseline failures, including the two `scene_model_parity` rows that
were already saying *"the model is stale — re-export"*; those persist because the
signs are still awaiting the operator's mapping, per `_92`).

**Fixed for the future:** the probe now aborts **every non-GET to :6970** by
request interception and counts them (the `_89` GUARD-3 recipe I should have
copied first time). Re-verified: the guarded run reports *"4 save-server write(s)
aborted"*, passes all 14 checks, and leaves `marsin_engine/models/test_bench.js`
**byte-identical**.

**One residue I did NOT cause and cannot attribute:**
`simulation/scenes/common.yaml` has `colorWave.lightingMode: sacn_in →
pixelblaze`. Its mtime (17:01) predates my first probe run (~17:45) by three
quarters of an hour, so it came from an earlier sim session — the operator's own
or a concurrent thread. Flagging it because it is an operator-facing mode switch
sitting uncommitted, not because I know whose it is.

Nothing else was written: `simulation/scenes/test_bench/{controllers,patches}.yaml`
still carry their 2026-07-28 mtimes, and the probe controllers/strands
(`__probe_*`, TEST-NET IPs) appear in **no** file on disk.

---

## 10. Open / follow-ups

- **Operator decisions (§4):** same-IP overlap and no-IP overlap — both currently
  hard errors, by design. A rule for either has to come from him.
- **Memory amendment (§7)** — proposed wording above; coordinator to apply.
- **Uncommitted residue (§9)** — a re-exported `marsin_engine/models/test_bench.js`
  (a correct `_92` catch-up, left in place) and a `common.yaml` `lightingMode`
  flip that is not mine. Both for the operator's commit-time judgement.
- No git operations were performed (operator-gated).
