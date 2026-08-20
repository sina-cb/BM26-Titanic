# 20260725_87 — map a universe → save → LEDs, with ZERO restarts

Operator order: after `_86`'s auto-sync worked and showed its warning, he
**still** had to kill and restart the launcher before the new universes carried
data. *"Can we make sure this can be done without a restart?"*

**Answer: yes — it is true now, and it was NOT fully true before this slice.**
Two things stood between him and a restart-free save; one was already fixed but
not yet running, the other was a live hole nobody had looked at.

Sim-side only. No `scenes/**` writes, no `marsin_engine/**` writes, no browser
session against his sim, no device HTTP, no server started or stopped, no git
ops. His freshly restarted bridge was not touched.

---

## 1. Why his restart was necessary THIS time (and only this time)

`_60` (slice S3) taught the bridge to `addUniverse()` at runtime. That code was
written while his bridge was already running, and the bridge was deliberately
**not** restarted — so the process serving him all day predated S3 and still had
a boot-frozen accept-list. His launcher restart is what put S3 into service.
That restart was a **one-time activation cost, not a recurring workflow step.**

His restart also re-read the widened `_86` field, which is why everything lit up
at once and made the two causes look like one.

## 2. The chain, link by link, with verdicts

Traced on the code as it stands after this slice. "PASS (was …)" marks a link
this slice changed.

| # | Link | Where | Verdict |
|---|---|---|---|
| 1 | Every save path funnels through **one** `exportConfig()` | `src/gui/gui_builder.js` | **PASS.** Controller pane 💾, Lighting Controls 💾, `controller_map_editor`'s save row, `PatchManager.saveAndNotify`, and the LED push's `persistScene` all call `window.exportConfig`. Pinned by `subscribed_universes.test.js` §6. |
| 2 | The `_86` gate runs before the first byte | `gui_builder.js` `exportConfig` | **PASS.** Ahead of `saveModelJS()`, so Cancel still means nothing on disk. |
| 3 | `POST /save` writes `patches.yaml` + `common.yaml` **before** answering | `server/save-server.js:284/336` | **PASS.** `writeFileAtomic` (tmp + fsync + rename, synchronous) completes before `res.end('Saved')`. The 200 is a durability receipt. |
| 4 | Notify is chained on the **awaited, verified** save | `gui_builder.js` | **PASS** (`_61`/`_62`, slice S4). `await fetch` → `if (!res.ok) throw` → `await notifySacnBridgeLoud()`. A failed save never notifies (re-reading the old file is not progress). New wiring test pins the ordering. |
| 5 | Notify = `setScene` over the sACN WS | `src/dmx/patch_manager.js:345` | **PASS.** Reports `{ok}`; "WebSocket not connected" is a loud failure with toast + monitor line, not a footnote. |
| 6 | Bridge handles `setScene` with a **full** recompute, even when the scene is unchanged | `server/sacn_bridge.js` | **PASS.** No early-return on an identical tag. |
| 7 | `recomputeRoutes` re-reads `patches.yaml` **fresh**, per scene, per call | `readSceneRoutePairs()` | **PASS.** `fs.readFileSync` lives inside the function; there is no cache at any level. Pinned by a wiring test that reads the source. |
| 8 | The union covers a universe that is newly patched in the just-saved file | `recomputeRoutes` | **PASS.** wanted = relay routes ∪ engine-owned excluded pairs ∪ every universe the **active** scenes patch. |
| 9 | LED-strand records contribute **all** their universes, not just the start | `readSceneRoutePairs` → `readPatchDeclarations` | **PASS (was FAIL — see §3).** |
| 10 | The `📡 Subscribed Universes` field reaches a **running** bridge | `recomputeRoutes` | **PASS (was FAIL — boot-read only; see §4).** |
| 11 | Subscription is applied **before** senders are built | `recomputeRoutes` | **PASS.** No window where a route is live and the receiver is deaf. |
| 12 | `receiver.addUniverse` → frames accepted | `lib/bridge_routing.cjs` | **PASS.** Per-universe error isolation; a failed multicast join is loud and the universe stays accepted for unicast (boot parity). |
| 13 | Relay routes send to the controller | `routeFrame` | **PASS.** Senders diffed on the same recompute; per-target error dedup. |
| 14 | Parked universes | — | **Not needed at runtime, by design.** A parked output carries no data; the field keeps it as free headroom for the next boot. Stated, not machined. |

### Where the two gaps sat

Links 1–8 and 11–13 were already sound. Links **9** and **10** were not, and
either one alone is enough to make "save is sufficient" false.

## 3. Gap A — LED strand **spill** universes were invisible (fixed)

`readSceneRoutePairs()` read `patch.dmxUniverse` and nothing else. That is the
**start** universe. An LED strand record also carries `segments[]` — one run per
universe the strand occupies as it walks past channel 512 — plus
`endUniverse`/`endChannel` (`_66`/`_71` projections, written by
`save-server.js`).

So a 200 px RGBW strand patched at U30 produced:

- one relay route `U30 → 10.x.x.60` and **no route for U31**;
- one subscription claim for U30 and **none for U31**.

Result: pixels 1–128 light, pixels 129–200 stay dark, the log says
`Route created`, the monitor is green, `patches.yaml` is fresh. That is the same
silent-dark signature `_60` closed for post-boot universes, one field deeper —
and it is **restart-proof**: restarting the bridge would not have fixed it
either, because the boot scan (`getAllPatchUniverses`) read `dmxUniverse` too.

Today's titanic mapping does not trip it — every strand is 40 px on its own
universe (`U30`, `U31`), verified against the live file. It trips the moment a
rope run exceeds 128 px RGBW / 170 px RGB, which is exactly the direction his
rope mapping is heading.

**Fix.** `lib/bridge_routing.cjs` gains two pure functions:

- `patchRecordUniverses(patch)` — every universe ONE record occupies.
  `segments[]` is authoritative when present. A record carrying `endUniverse`
  with no segments (hand-edited, or written before the field existed) has its
  interior interpolated — a strand's walk is contiguous by construction — and
  the caller is handed an `anomaly` string so nothing is derived in silence. A
  span beyond 64 universes is **refused** rather than interpolated, loudly:
  that is an authoring bug, not a strand.
- `readPatchDeclarations(patchesTree)` — the whole `patches` map → the declared
  `(universe → controllerIp)` pairs, every universe the scene occupies, and the
  anomalies. Unpatched records (`dmxUniverse: 0`) contribute nothing, exactly as
  before.

`sacn_bridge.js` now uses it in **both** places that read patch files — the boot
scan and `readSceneRoutePairs` — so the boot floor and the runtime diff can no
longer disagree about what a record occupies. Spill universes become relay
routes to the same controller and subscription claims in the same pass.

## 4. Gap B — the `_86` field, and whether a field-only universe must flow

The `📡 Subscribed Universes` field (`scenes/common.yaml` →
`colorWave.sacn_universes`) was read **once, at boot**. `_86` made the save keep
it honest; the running receiver never saw the update. That is precisely the
mismatch his restart papered over.

**Determination.** After Gap A is fixed, which universes exist only in the field?

| Field source (`_86` §2) | Reaches a running bridge without the field? |
|---|---|
| DMX fixture claims | Yes — patch records → routes + scene-patch union |
| LED strand claims incl. **spill** | Yes — **as of Gap A**; before it, no |
| Declared port rows with nothing patched | Carry no data. Nothing to receive. |
| Parked outputs | Carry no data, by definition. |
| Stored patch records | Yes — same as row 1 |
| Engine-delivered universes | Yes — engine-owned pairs from `/status outputRouting` |
| **Operator-added extras** (a console, a second machine, another rig on the wire) | **No.** Nothing in the configuration implies them. |

The last row is real. It is the documented escape hatch — `_86`'s never-remove
rule exists *because* the operator legitimately subscribes to universes the
registry knows nothing about. Leaving that boot-only means the dialog must keep
a restart caveat, which is the exact sentence he asked us to delete. His live
field carries **U32–U37** today with nothing patched on them: field-only
universes, right now, on his box.

**Fix — a re-read, not new machinery.** `recomputeRoutes()` already re-reads
`patches.yaml` for every active scene; it now also re-reads the same
`common.yaml` / `scene_config.yaml` `colorWave` block the boot path reads, and
feeds the parsed universes into the **same** `wanted` list with provenance
`📡 Subscribed Universes field`. No new message type, no new protocol, no new
file, no cache.

Properties:

- **One parser.** `parseSubscribedUniversesField()` lives in
  `bridge_routing.cjs` and is used by the boot block **and** the runtime read.
  A parity test pins it token-for-token against the browser-side
  `parseSubscribedUniverses()` that drives the dialog — if the gate ever
  reported a set the bridge does not actually subscribe to, that would be the
  original silent-dark shape one level up.
- **Floor, never ceiling.** Field universes are added to the union; the bridge
  still never unsubscribes. Removing a universe from the field takes effect at
  the next start — same never-remove doctrine as the save-side gate.
- **The `1-24` trap is now loud.** The field has no range syntax; `1-24` means
  U1 and 23 dark universes. Every token whose parse differs from its appearance
  is warned about once, to console and the monitor panel. Previously the bridge
  did this silently at boot.
- **A read failure is loud and bounded.** An unparseable `common.yaml` warns
  once and that recompute subscribes from the patch/engine-derived universes
  only — stated in the warning, not a silent fallback.

One incidental correction: the old boot parser kept `0` and negative tokens
(`filter(u => !isNaN(u))`); the shared parser drops anything below U1, matching
the browser twin and E1.31. Universe 0 was never receivable.

## 5. The new dialog wording

`src/gui/subscribed_universes_prompt.js` — the second `led-push-warn` banner.

Was:

> ⏱ Takes effect at the NEXT sACN bridge start. The running bridge keeps the
> accept-list it built at boot, so nothing changes on the wire until the bridge
> is restarted.

Now:

> ✅ Takes effect IMMEDIATELY on save — no bridge restart. The save writes the
> field and then tells the running bridge to re-read it, so the new universes
> are subscribed on the spot. Watch the bridge console for
> "runtime-subscribed U…", then "First frame on U…". This list is also the
> accept-list the bridge starts from at its next boot.

The console line `syncSubscribedUniverses` writes on **Update + save** was
changed to match, and both are pinned by tests that also assert the retired
caveat does not survive anywhere. **No genuinely restart-bound case was found**,
so no caveat replaces it — the only thing the next boot adds is the floor.

## 6. Proof affordance — the logs he watches

Both acceptance lines fire on the traced path and reach **two** surfaces: the
bridge's stdout (the launcher runs it with `stdio: 'inherit'`, so it is the same
terminal window) and `broadcastLog` → the sim's sACN-IN monitor panel.

Verified by running the real `sacn_bridge.js` in a throwaway process with the
`sacn` and `ws` modules replaced by fakes — nothing bound a port, joined a
multicast group, or sent a datagram, and his live bridge on `:6971`/`:5568` was
never approached. Actual output against the real titanic scene files:

```
[sACN Bridge] runtime-subscribed U31 (relay route → 10.x.x.60; scene 'titanic' patch) — boot
[sACN Bridge] runtime-subscribed U999 (📡 Subscribed Universes field) — boot
[sACN Bridge] ⚠ 📡 Subscribed Universes: token '40-44' — the bridge reads this as U40 only
              (it has no range syntax). Type each universe separated by commas (e.g. 1, 2, 3).
```

The `U999` line is the load-bearing one: the harness returned a **narrower**
field on the boot read and a **wider** one on every later read — exactly what a
save does to `common.yaml` under a running bridge — and the universe that
appeared only in the second read was subscribed at runtime. The banner now
reads:

```
Runtime Subscribe   : ON — relay routes + active scenes' patched universes
                      (incl. LED spill) + the 📡 Subscribed Universes field,
                      all RE-READ on every recompute
```

`✅ First frame on U… — runtime-subscribed after boot` is unchanged from `_60`
and still fires from the packet handler for any universe outside the boot
snapshot (`BOOT_UNIVERSES` is taken before the first runtime subscription — the
`sacn` package mutates the very array handed to its constructor).

## 7. Operator acceptance recipe

Next real mapping change — no preparation, no restart:

1. Map the controller / port / strand as usual in **Controller Mapping**.
2. Hit 💾 (either button — one save path). If the field is short, answer
   **Update + save**.
3. Watch the **launcher terminal** (or the sim's 📡 sACN-IN monitor panel):
   - `[sACN Bridge] runtime-subscribed U<n> (…) — client scene 'titanic'`
     — the receiver accepted the universe. Appears within the save.
   - `[sACN Bridge] Route created: U<n> → <controller ip>` — the relay sender
     for it exists.
   - `[sACN Bridge] ✅ First frame on U<n> from '<source>' — runtime-subscribed
     after boot` — data is actually arriving on it.
4. LEDs follow. **Zero restarts.**

If step 3 shows `runtime-subscribed` but never `First frame`, the subscription
is fine and nothing is *sending* on that universe — look at the engine/model,
not the bridge. If it shows neither, the notify did not arrive: the save toast
and the monitor will have said so in red (`_61` slice S4), and a page reload
re-sends `setScene` on WebSocket open.

## 8. Files

| File | Change |
|---|---|
| `simulation/lib/bridge_routing.cjs` | **+`patchRecordUniverses`**, **+`readPatchDeclarations`**, **+`parseSubscribedUniversesField`**, `+MAX_INTERPOLATED_STRAND_SPAN` |
| `simulation/server/sacn_bridge.js` | boot scan + `readSceneRoutePairs` use the shared declaration reader (LED spill); `readColorWaveSection` / `readSubscribedUniversesField` factored and used at boot **and** on every recompute; the field joins the `wanted` union; `warnOnce` for patch anomalies + field issues; banner updated |
| `simulation/src/gui/subscribed_universes_prompt.js` | dialog caveat → the no-restart truth + the log lines to watch |
| `simulation/src/dmx/subscribed_universes.js` | module header + the Update-and-save log line restated; parser cross-reference to the server twin |
| `simulation/tests/bridge_routing.test.js` | **+19 tests** (file 24 → 43) |
| `simulation/tests/subscribed_universes.test.js` | two caveat assertions retargeted, plus a `doesNotMatch` on the retired wording |

## 9. Tests (honest counts)

`cd simulation && npm test`

| | tests | pass | fail |
|---|---|---|---|
| Baseline (measured on this branch, before) | 1433 | 1423 | **10** |
| After | **1452** | **1442** | **10** |

**+19 tests, zero new failures, byte-identical failing list.**

The failing set is the known pre-existing family: the 8 stale-model /
real-scene-parity cases (fixtures-docked, titanic block acceptance, view-bit
headroom, the two CLI parity cases, `test_bench` ×2, `titanic` ×2) plus the
operator-owned compression-margin tripwire. Note the count is **10, not the 9
recorded in `_86`** — `real scene test_bench: every remaining error is a known
open mapping defect` has gone red since, from operator-side scene edits. It is
untouched here (`scenes/**` is off limits to this slice) and it clears with the
same re-export/engine restart the other stale-model failures need.

New coverage: DMX record → one universe; unpatched record → no claim; strand
with `segments[]` → every segment universe; `segments[]` beating a stale
`endUniverse`; interpolation of a segment-less span **with** its anomaly; an
absurd span refused with only the endpoints kept; declarations relaying spill to
the same controller with no spurious refusals; the spill universe arriving at a
fake `Receiver` end-to-end through `computeEffectiveRoutes` +
`applyUniverseSubscriptions`; a universe present only in the **after-save** tree
being subscribed with no restart; shapeless/empty trees; field parsing
(bridge-exact, the `1-24` trap and its report, sub-1 and non-numeric rejection,
empty forms); **server↔browser parser parity over 12 inputs**; and four wiring
tests — the file is read inside `readSceneRoutePairs`, the field is re-read and
joins `wanted` **before** the subscription is applied, `setScene` triggers a
full recompute, and the notify follows the awaited/verified save.

Parse-check: acorn on all seven touched source + test files (script mode for the
CJS/server files, module for the ESM ones) — clean.
`python scripts/security_check.py --all`: 6 findings, all a MAC in gitignored
`simulation/.scene_backups/studiodj/**`, pre-existing and untouched. Nothing in
any file this slice touched.

## 10. Not done / open

- **Nothing here is operator-gated.** The changes are inert until the bridge
  process next starts — but that is the ordinary "code lands, restarts on the
  next launch" cost, not a step in his workflow. Until then his running bridge
  keeps S3's behavior (patch-derived runtime subscription, start-universe only)
  plus the boot field, which covers today's titanic mapping in full — verified
  against the live files: every universe `titanic/patches.yaml` occupies
  (`2–27, 30, 31`) is inside his current field (`1–27, 30–37`).
- **Gap A only bites on a strand longer than one universe.** No such strand
  exists in any scene today. The fix is preventive, and the boot scan carries it
  too.
- The field still cannot be **shrunk** from the sim, deliberately (`_86` §4).
