# 20260725_109 — Red-team: LED controller lifecycle, status probes, push/merge stack

> **Numbering note:** commissioned as `_104`; a sibling red-team landed
> `20260725_104_redteam_zoom.md` first, so this took the next free slot.
>
> **De-confliction with `_106` (`20260725_106_redteam_controller.md`).** A
> second red-team ran the same surface concurrently and landed while this one
> was in flight. Re-read at write time; the overlap and the split are stated in
> "Overlap with `_106`" below. Where we agree, `_106` has priority of
> discovery — this report is corroboration plus a largely disjoint set.

**Agent:** adversarial red-team (Opus). **Mode:** report-only — **zero source
edits, zero edits to any existing suite, zero scene writes, zero git ops.**
**Branch:** `feat/bm_readiness` @ `be58eea7` (working tree as found).
**Repros:** `~/tmp/redteam_controllers/` (gitignored), 6 standalone scripts.

**Surface attacked:** `simulation/src/dmx/address_merge.js`,
`simulation/src/dmx/led/{device_config_mapper,provisional_binding}.js`,
`simulation/src/dmx/{controller_status,controller_registry,sacn_mapper}.js`,
`simulation/server/{controller_probe_service.cjs,save-server.js}`, and the
consuming paths in `src/gui/{led_discovery_panel,controller_map_editor}.js`.
Weaponised `_96` (provisional lifecycle + status probes), `_102` (same-address
merge), `_92` (LED sign fixtures) and the `_58`/`_70`/`_71` push-plan machinery.

**⚠ SAFETY CONFIRMATION.** Every repro is either a pure-module harness or an
HTTP stub bound to **127.0.0.1 on ports 7750–7763** (my assigned range). **Zero
device HTTP to any 10.x address. Zero sACN — no `Sender`, no `dgram`, no
`Receiver`.** The operator's stack (`:6967`, `:6969`–`:6972`, UDP 5568) was
never contacted; the save-server crash in **P1-1 was proven at module level
only and deliberately NOT fired at the live `:6970`.** Fake addresses are
RFC 5737 documentation ranges. No file outside `~/tmp/redteam_controllers/`
and this report was written.

---

## Findings by severity

**P0: 0 · P1: 4 · P2: 7 · P3: 10** — 21 total.

| # | Sev | Title | Where | Repro |
|---|---|---|---|---|
| **P1-1** | P1 | `POST /controllers/probe` with a negative `timeoutMs` **kills the save-server process** (unhandled socket `error`), not a 500 | `controller_probe_service.cjs:100-105`, `save-server.js:806` | `04_probe_crash_repro.mjs` |
| **P1-2** | P1 | A DMX **gap** claim (reserves channels, writes no bytes) can WIN the higher-IP contest and **mute a real fixture** — channels go dark under an "allowed / unified" banner | `address_merge.js:461-480` | `01` §C |
| **P1-3** | P1 | The "1.2 s per-probe ceiling" is a socket **idle** timeout, not a deadline — a slow-drip host wedges the sweep and `probeSweeping` never clears, freezing every later sweep | `controller_probe_service.cjs:143-165`, `controller_map_editor.js:1011` | `03` §2 |
| **P1-4** | P1 | **Reconcile-dialog storm**: a non-blocking contradiction re-raises a NEW modal on every 20 s auto-sweep, forever, stacking DOM overlays. **⚠ Same defect as `_106` HIGH-2, which found it first and went further** — see "Overlap with `_106`" | `controller_map_editor.js:996-1002` | `03` §10, `06` §3 |
| **P2-5** | P2 | A non-canonical `0.0.0.0` (`0.0.0.00`, an all-triple-zero quad, `00.0.0.0`) bypasses **both** the placeholder gate and the unrankable hard error, becoming the numerically lowest rankable address | `controller_status.js:190`, `address_merge.js:80` | `01` §D, `06` §1 |
| **P2-6** | P2 | Two destinations minted for **one box** when its IP is spelled two ways — the "exactly one packet per (universe, destination IP)" invariant breaks with no warning | `address_merge.js:248-253` | `01` §E |
| **P2-7** | P2 | `derivePerOutputPlan` never checks the ≤16-universe **span** or **duplicate universes** across operator-declared outputs; the push dies in `validatePerOutputPlan` after the confirm | `device_config_mapper.js:354-394` | `02` §1, §2 |
| **P2-8** | P2 | `collectClaimedUniverses` is blind to a **DMX** controller's declared-but-unprojected universe → the LED park/repair auto-assigner takes it. **The `_102` "auto-assign never creates a share" invariant is violated.** | `device_config_mapper.js:138-147` | `02` §8 |
| **P2-9** | P2 | A cached probe verdict survives an **IP retype** — first contact re-runs against the old address, and `ip_mismatch` is not a hard blocker, so "Promote anyway" is offered | `controller_status.js:164`, `controller_map_editor.js:958` | `06` §6 |
| **P2-10** | P2 | No response-size cap and no total-duration deadline in `httpGetJson` — 48 MB absorbed whole in the measurement | `controller_probe_service.cjs:143-165` | `03` §4 |
| **P2-11** | P2 | No pixel-count ceiling anywhere: a 100 000-px strand is written verbatim into the ENABLE `count` with **zero** warnings from either validator | `device_config_mapper.js:462`, `marsinled_client.js:607` | `02b_huge_count.mjs` |
| **P3-12** | P3 | `used.delete(port.universe)` deletes the **wrong** variable when a repaired output is later dropped — permanent universe reservation leak | `device_config_mapper.js:434` | `02` §4 |
| **P3-13** | P3 | The repair loop skips `used` + `claimedUniverses` but never `cardUniverses` → auto-assigns a universe a sibling port row already declares | `device_config_mapper.js:400-417` | `02` §7 |
| **P3-14** | P3 | `autoAssignPerOutputUniverses` takes no claim index at all; **zero production callers** — dead code contradicting the `_102` invariant | `device_config_mapper.js:541` | `02` §9 |
| **P3-15** | P3 | `overlapsForController` attributes by raw IP **string** → a card whose last octet is written `09` instead of `9` renders **no** shared-address banner for a contest it is part of | `address_merge.js:510-517` | `01` §H |
| **P3-16** | P3 | `provisionalCandidatesForDevice` is an exact string match → a stray-space / leading-zero IP never gets first contact, and Node's stack cannot resolve it either (`◌ UNKNOWN` forever) | `provisional_binding.js:226` | `06` §5, `05` §8b |
| **P3-17** | P3 | `markControllerProvisional` has **no IP check of its own** — the "typed IP is the whole premise" rule lives only in the UI gate | `controller_registry.js:912` | `06` §2 |
| **P3-18** | P3 | Duplicate-output configs promote to ✓ VERIFIED although they can never be pushed (`board_output_count` is checked, `duplicate_output` is not) | `provisional_binding.js:155-167` | `06` §7 |
| **P3-19** | P3 | `probeCache` is a module-global Map, TTL checked only on read, **never evicted**; the route accepts an unbounded `targets[]` | `controller_probe_service.cjs:283-294` | `05` §8c |
| **P3-20** | P3 | In-sweep de-dup keys the raw IP string → "two cards on one address are one probe" does not hold for spelling variants | `controller_probe_service.cjs:285` | `05` §8b |
| **P3-21** | P3 | `composeUnifiedFrame` silently drops every byte past ch 512 with a comment promising a next frame nothing produces; `collectAddressClaims`' LED branch throws on an empty label where the DMX branch guards | `address_merge.js:414`, `:486` | `01` §F, §G |

---

## The three that matter most

### P1-1 — a malformed probe request kills the save server (not a 500, a process exit)

**Repro:** `node ~/tmp/redteam_controllers/04_probe_crash_repro.mjs`
**Request that does it** (do **not** fire this at the live `:6970`):

```
POST /controllers/probe
{"targets":[{"id":1,"ip":"<any valid IPv4>","type":"DMX"}],"timeoutMs":-1}
```

**Mechanism, line by line:**

- `save-server.js:806` forwards the body's `timeoutMs` with a `Number.isFinite`
  check only — **no floor, no ceiling.**
- `controller_probe_service.cjs:100` `const socket = net.connect({host, port})`
- `:101` `socket.setTimeout(timeoutMs)` → Node throws `ERR_OUT_OF_RANGE`
  for any negative value.
- `:105` `socket.on('error', …)` — **never reached.**

The throw escapes the `new Promise` executor, so the probe promise rejects and
the route correctly answers 500. But the socket is **already connecting with no
`error` listener**. When it settles (`ECONNREFUSED` / `ETIMEDOUT` /
`ECONNRESET`) Node emits an unhandled `'error'` and the process exits.

**Observed:**

```
sweep REJECTED (route answers 500): ERR_OUT_OF_RANGE
>>> UNCAUGHT EXCEPTION reached the process
    ECONNREFUSED connect 127.0.0.1:80
```

**Expected:** a bad `timeoutMs` is a 400 with the reason named; a socket error
is never unhandled.

**Exposure.** `save-server.js:830` is `.listen(SAVE_PORT, …)` with **no host
argument → binds `0.0.0.0`**, and `:161` sets
`Access-Control-Allow-Origin: *`. `JSON.parse(body)` ignores `Content-Type`, so
this is a CORS **simple** request (`text/plain`) — no preflight. Anything on
the show LAN, and any page open in the operator's browser, can send it. There
is no `process.on('uncaughtException')` anywhere in `save-server.js`.

**Blast radius:** the save server owns scene saves, `.scene_backups`,
`/restore-backup`, the gamma routes and `/controllers/probe`. The engine and
the sACN path are separate processes, so **the rig stays lit** — which is why
this is P1 and not P0 — but the operator silently loses the ability to save
mid-show, and the pane's only symptom is the generic "sweep failed, restart the
stack" toast (`controller_map_editor.js:1046`), which points at the wrong
cause.

### P1-2 — a *gap* can win the higher-IP contest and dark a real strand

`collectAddressClaims` (`address_merge.js:461-480`) walks
`computeProjection().universeMaps` and skips exactly one kind of claim:
`if (c.effect) continue;` (gang-fire pins). It does **not** skip **gap** claims
— the absolute channel reservations pushed by `controller_registry.js:2017`
`claim(port.universe, entry.at, gapEnd, null, gapItem, …)`, whose `name` is
`null` and which are re-labelled here as `gap on <controller> P<n>`.

A gap reserves channels for hardware **the sim does not model**. It never
appears in the render list and writes **no bytes**. But it is a full claimant
in the merge, so if its controller has the numerically higher IP it **wins**,
and the real strand on the lower-IP box is entered into `lostChannelIndex` and
muted by `sacn_mapper.pokeChannel`.

**Observed** (`01_address_merge_matrix.mjs` §C):

```
gap-vs-strand: winner='gap on HighBox P1'  loser='RealStrand'
```

**Expected:** a claimant that cannot write bytes must not be able to take
channels away from one that can — either gaps are excluded from the contest
like effect pins, or a gap winning is itself the loud condition.

**Preconditions:** (a) two controllers sharing a universe — newly *allowed and
encouraged* since `_102`, and (b) a gap on the higher-IP box overlapping the
lower-IP box's fixtures. Two conditions, so not P0; but the operator-facing
banner in that state says the share is **allowed** and the frames are
**unified**, which is the opposite of what the wire does.

### P2-8 — auto-assign *can* create a share (the `_102` asymmetry does not hold)

`_102` §1 states the invariant: *"an EXPLICIT operator-declared universe may
now be shared, but the auto-assign paths still skip every claimed universe. The
sim never chooses to create a shared address."*

`collectClaimedUniverses` closes the LED half of that hole (`_70` §4): it walks
other **LED** controllers' port rows and parked outputs to catch universes that
are *declared but project no claim*. Line 140 is
`if (!isLedController(other)) continue;` — the **DMX** half was never covered.

A DMX controller port with an empty chain (or one whose fixtures all project
unpatched) declares a universe that produces **no occupancy entry**, so it
never reaches `dmxUniverseMaps` and is invisible to the claim index. The LED
park/repair allocator then takes it, and the sim has *chosen* the share.

**Observed** (`02_per_output_plan.mjs` §8): a DMX card declaring U12 on an
empty port yields `claim index: []`.

**Expected:** the same "declared but unprojected" sweep the LED branch already
does, applied to every controller type.

---

## Everything else, in one pass

**Merge / addressing.** The contest math itself is exact — see "What held".
What is soft is **IP identity**: `ipToNumber` folds numerically while every
*keying* decision (destination map `:250`, `lostChannelIndex` `:327`,
`overlapsForController` `:512`, `provisionalCandidatesForDevice`, the probe
cache) compares raw strings. That single inconsistency produces P2-5, P2-6,
P3-15, P3-16 and P3-20. `0.0.0.00` is the sharpest case: `ipToNumber` returns
`0` (rankable, and the lowest possible address) while `'0.0.0.0'` returns
`null` (unrankable), so the documented hard error is bypassed by spelling
alone, and the same string simultaneously passes `canMarkProvisional`.

**Push plan.** `derivePerOutputPlan` is the pre-flight the confirm dialog,
the sync chip and the push all read, and two firmware rules it does not model
(`span ≤ 16`, `no two outputs on one universe`) are enforced only inside
`validatePerOutputPlan` at write time. A card declaring `U2` + `U500`, or two
ports on `U7`, sails through the pre-flight with **zero collisions and zero
warnings** and then throws after the operator has confirmed. Two smaller
allocator bugs sit next to it: `used.delete(port.universe)` deletes the
pre-repair value (P3-12) and the repair loop ignores `cardUniverses` (P3-13).
`autoAssignPerOutputUniverses` is claim-blind **and unreferenced outside
tests** (P3-14) — a loaded gun for the next caller.

**Provisional lifecycle.** The schema is the strongest thing in this surface
(see "What held"). The weakness is entirely in **when** first contact fires:
the pane caches probe verdicts by controller **id** and never invalidates them
when the card's IP changes, and `shouldAttemptFirstContact` compares only
`state` + fingerprint presence, never the address (P2-9). Combined with P1-4
this is the worst operator-facing behaviour in the surface: an old-firmware
board (`per_output_unsupported`) or a mistyped IP (`ip_mismatch`) — both
explicitly documented as **not** hard blockers — raises a fresh modal overlay
every 20 seconds for as long as the Controller Mapping pane is open, with no
"already asked" record anywhere and no cap on stacked overlays.

**Status probes.** Honest about state (`unknown` is never downgraded to
`offline`; garbage bodies, `null`, arrays, numeric `controllerId` and
non-array `strands` are all correctly refused as "not a MarsinLED"; a
prototype-pollution payload had no effect). What is not honest is the
**budget**: the 1.2 s figure is `http.request`'s idle timeout, so a host that
emits one byte every 400 ms held the probe for **10 414 ms** in the
measurement, and a 48 MB body was buffered whole in 148 ms. Both occupy a pool
slot and delay `probeSweeping = false`; while that flag is true
(`controller_map_editor.js:1011`) **no further sweep can start**, so a single
misbehaving host on `:80` freezes the status of the entire fleet.

---

## What held (PRAISE — attacked and did not break)

- **Overlap math.** Contest = intersection only, verified at ch 1, ch 512,
  1-channel overlaps, the touching seam, total containment in both IP
  directions, identical ranges, and 3-way contests. The `break` optimisation in
  the sorted pair loop is sound. Results are order-independent and the warning
  list does not reshuffle between runs.
- **Master-dimmer force-write** (`sacn_mapper.js:303`) goes through
  `pokeChannel` exactly as `_102` claims — a losing par cannot blast the
  winner's fixture to full.
- **The provisional/verified schema is airtight.** `normalizeDeviceBlock`
  refused every smuggling attempt: a fingerprint on a provisional block, either
  push receipt, and a string or numeric `provisional`. Neither grade is
  derivable from the other.
- **Bind-by-controllerId dedup holds.** Two provisional cards on one typo'd IP:
  the first promotes, the second is hard-blocked with `controller_id_claimed`.
  `markControllerProvisional` refuses to downgrade a verified card across
  repeated unbind/rebind cycles.
- **The obvious promote race is genuinely safe.** Dropping the provisional
  binding while a verdict is in flight cannot promote: the sweep re-reads
  `shouldAttemptFirstContact` per controller inside the same synchronous loop,
  and `reconcileProvisionalContact` throws rather than acting on a card that is
  no longer provisional.
- **Parks never create a share.** With an explicitly shared universe on one
  port, every park allocation correctly skipped the claimed universes.
- **`unknown` never renders as `offline`**, on every path tested.

---

## Verification — the tree is unchanged

```
node --test "tests/*.test.js"     (simulation/)
ℹ tests 1645   ℹ pass 1637   ℹ fail 8
```

Byte-identical to the `_102` baseline: fixture docking, titanic block
acceptance, view-bit headroom, two parity CLI rows, the compression-threshold
row, and the two `scene_model_parity` `test_bench` rows. **Zero new failures,
zero source edits** — `git status` on every file in the attacked surface is
exactly as this session found it.

## Repro inventory (`~/tmp/redteam_controllers/`)

| file | covers |
|---|---|
| `01_address_merge_matrix.mjs` | IP folding edge values, channel boundaries, containment, 3-way, gap-wins, hard-error bypass, destination minting, structural throws, `composeUnifiedFrame`, attribution, determinism |
| `02_per_output_plan.mjs` | duplicate universes, span, park anchoring, the `used.delete` leak, absurd pixel counts, duplicate/out-of-range outputs, the DMX claim-index hole, claim-blind auto-assign, share+park, degenerate cards |
| `02b_huge_count.mjs` | the missing pixel-count ceiling |
| `03_probe_service.mjs` | slow answers around the ceiling, slow-loris, garbage bodies, huge payload, mid-body reset, sweep blast radius, `timeoutMs` passthrough |
| `04_probe_crash_repro.mjs` | **the isolated save-server process kill** |
| `05_cache_flap.mjs` | cache keying, in-sweep de-dup, flapping, unbounded growth |
| `06_provisional_lifecycle.mjs` | the sentinel gate, the mutator/gate gap, all seven mismatch codes, two-cards-one-IP, IP spelling, both promote races, absurd configs, unbind loops, schema smuggling |

## Coverage gaps — what I could not determine from here

- **No live pane.** Every UI finding (P1-4, P2-9, P3-15) is read off the code
  path, not off a rendered DOM. The dialog-storm claim in particular deserves a
  60-second in-browser confirmation before anyone acts on it — the operator's
  stack was out of bounds for this session.
- **No hardware.** Whether a MarsinLED actually accepts, rejects or bricks on a
  100 000-pixel `count` (P2-11) is unknown; I measured only that nothing in the
  sim stops it.
- **P1-1 was not fired at the live `:6970`.** The mechanism is proven at module
  level with the route's exact argument marshalling replicated; the end-to-end
  HTTP hit was deliberately not performed.
- **Gap reachability on the real scenes** — I proved the code path, not that
  any current `titanic`/`test_bench` gap overlaps another controller's claim.
  A scene sweep would settle it.

## Overlap with `_106` (the concurrent red-team on this surface)

| this report | `_106` | verdict |
|---|---|---|
| **P1-4** dialog storm | **HIGH-2** | **Same defect — `_106` found it first and went further**: it also shows that a stale dialog's "Promote anyway", pressed after another dialog already promoted the card, calls `promoteProvisionalBinding` on a now-VERIFIED card and **throws uncaught inside `ctx.mutate`**. Treat `_106` HIGH-2 as the canonical write-up; P1-4 here is independent corroboration of the trigger. |
| **P2-9** stale verdict survives an IP retype | **HIGH-1** `ip_mismatch` is dead code on the provisional path | **Complementary, both true.** `_106` is right that in the *steady* case `device.ip` is built from `controller.ip`, so the guard can never fire — that is the dangerous case, because contact auto-promotes. P2-9 is the *one* case where it does fire: the operator retypes the IP after the sweep, so the cached `device.ip` is the old address. Same root (the verdict is never re-validated against the address currently on the card), opposite symptom. |
| **P2-10 / P1-3** probe budget | **LOW** "1.2 s deadline flaps cold boards" | Different: `_106` measured the ceiling being *too short* for a cold board; this report shows the ceiling is not a ceiling at all (idle, not total) and that a slow-drip host wedges the whole sweep. |
| — | **MED-1** a failed scene-save settles to a GREEN "In sync" chip | Not covered here. |
| — | **MED-2** promote off a cached fingerprint (same-IP hot swap) | Not covered here; adjacent to P2-9 and P3-19/P3-20. |
| — | **MED-3** `ECONNREFUSED` always → ONLINE | Not attacked here (confirmed as *designed* behaviour, `_96` §4.1). |
| **P1-1, P1-2, P2-5..P2-8, P2-11, all P3** | — | **Disjoint — not in `_106`.** |

`_105` (`20260725_105_redteam_bridge.md`) also touched `address_merge.js` from
the bridge side: it covered `composeUnifiedFrame`'s missing same-IP self-guard
and the leading-zero-octet decimal/octal divergence. This report attacks the
claim-collection, destination-keying and suppression sides. P2-5/P2-6/P3-15
sharpen `_105`'s leading-zero observation into three concrete operator-visible
consequences.

## Recommended handoffs

- **P1-1** → `simulation_expert.md`. Smallest closing move: register the error
  listener before `setTimeout`, and bound `timeoutMs` at the route. A
  `process.on('uncaughtException')` on the save server is a separate,
  independently valuable hardening.
- **P1-2, P2-5, P2-6, P3-15, P3-16, P3-20** → one thread, `simulation_expert.md`:
  they are all the same root — **canonicalise the IP once** and key everything
  off the canonical form — plus the gap-claim decision, which is an **operator
  question**: should a gap be able to win a contested channel at all?
- **P1-3, P1-4, P2-9, P2-10, P3-19** → `simulation_expert.md`: the probe
  budget and the first-contact trigger.
- **P2-7, P2-8, P3-12, P3-13, P3-14** → `simulation_expert.md`: the push
  pre-flight and the claim index.

## Operator decisions this hands back

1. **May a `gap` win a contested channel?** (P1-2) It reserves channels for
   hardware the sim does not model, so "the gap owns it, stay off" is a
   defensible reading — but then the banner must say the winner writes nothing.
2. **Is a non-canonical `0.0.0.0` a placeholder or an address?** (P2-5) Today
   the sim answers both, in different modules.
3. **Should the reconcile dialog have a "don't ask again for this card"?**
   (P1-4) Without one, a permanently-contradicted board is unusable alongside
   an open Controller Mapping pane.

## Out of scope (intentional)

The sACN bridge, routing, subscription and bench mirror — the concurrent `_105`
red-team owns those and its report landed first. The only overlap is
`address_merge.js`, where `_105` covered `composeUnifiedFrame`'s same-IP
self-guard and the leading-zero octet divergence from the bridge side; this
report attacks the claim-collection, destination and suppression sides.
Also out of scope: the gamma push path, discovery subnet scanning, and the
engine.
