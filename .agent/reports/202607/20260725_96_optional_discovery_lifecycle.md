# 20260725_96 — Optional discovery: the provisional controller lifecycle + ONLINE/OFFLINE status

**Author:** developer (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-31

**Operator ruling that started this:** *"the discovery must be an optional stage
in the controller lifecycle and not required — that allows me to put the IP I
want and not have to start the controller just yet, until next boot; on first
boot and recognition of the board you can get missing data if anything from the
board itself."*

**Operator scope addition (same thread):** *"nice to have an ONLINE/OFFLINE
status for all DMX and LED controllers. maybe using ping? on the network and
make it fast and parallel to not cause delays in the UI."*

Both are one story — **the controller pane tells the truth about boards** — so
they ship together and are reported together.

Per `security_privacy.md` every real controller address is redacted here as
`10.x.x.NN`; `0.0.0.0` is the repo's own placeholder **sentinel**, not an
address. **Zero device HTTP, zero sACN output, zero flashes** — proved in-page
(§6.2).

---

## 0. TL;DR

| | |
|---|---|
| **Root cause closed** | `_92` §4: six rope strands were dark for weeks because the ONLY way to get a `device:` binding was a live discovery conversation. Now the operator declares one from a typed IP with the board in its box. |
| **Lifecycle** | `unbound → PROVISIONAL → VERIFIED`, with a loud reconcile stop instead of a silent side-pick |
| **What a provisional card patches** | **everything**: `patches.yaml` records, engine model lanes, bridge relay routes, subscribed universes — byte-identical to a verified card (pinned by test) |
| **Status** | per-card `● ONLINE` / `○ OFFLINE` / `◌ UNKNOWN`, server-side, parallel, cached, never blocking the UI |
| **New tests** | **76** across 3 files — 33 lifecycle, 23 probe (incl. real loopback sockets), 20 status model. All green. |
| **Sim suite** | 1482 → **1559 tests**, fail **9**. **Zero new failures** — 8 = the documented baseline, the 9th is the `_92` agent's in-flight TE-sign LED reclassification (proof in §7.2) |
| **Live** | 18/18 in-browser checks against the running stack, 7 screenshots, **1 off-host request attempted and REFUSED** (the pane's own pre-existing sync-chip read) |
| **Security** | `security_check.py` PASS; `--all` findings are 6 pre-existing MACs in gitignored `.scene_backups/`, none in any file this work touched |
| **Engine suite** | not run — **no shared engine code was touched** |

---

## 1. The lifecycle

```
                    ┌───────────────────────────────────────────────┐
                    │  ⚑ Patch without the board   (typed IP only)  │
                    ▼                                               │
  ┌──────────┐                    ┌───────────────┐                 │
  │ unbound  │───────────────────▶│  PROVISIONAL  │                 │
  │          │◀───────────────────│               │                 │
  └──────────┘   ✕ Drop           └───────┬───────┘                 │
       │         provisional              │                         │
       │                     FIRST CONTACT│(probe / Verify / Push)  │
       │                                  │                         │
       │                        ┌─────────┴──────────┐              │
       │                        │  reconcile verdict │              │
       │                        └────┬──────────┬────┘              │
       │                        agree│          │contradict         │
       │                             ▼          ▼                   │
       │                      ┌────────────┐  ┌──────────────────┐  │
       └─────── unbind ───────│ ✓ VERIFIED │  │ reconcile DIALOG │──┘
                              └────────────┘  │ stays PROVISIONAL│
                                              │ nothing changes  │
                                              └──────────────────┘
```

**The two grades**, and the one thing that separates them:

| grade | `device:` block | what it asserts | who wrote it |
|---|---|---|---|
| unbound | *(absent)* | nothing | — |
| **PROVISIONAL** | `{vendor, provisional: true, deviceName?, boardId?}` | *"I, the operator, say a MarsinLED lives at this IP and drives these outputs"* | the operator |
| **VERIFIED** | `{vendor, controllerId, deviceName?, boardId?, lastPush?, lastGammaPush?}` | *"the sim read this fingerprint off that box"* | the hardware |

A provisional block carries **no `controllerId`** and **no push receipts** — the
schema refuses both, loudly. Claiming a fingerprint nobody read, or a receipt
from a conversation that never happened, is the silent-lie shape codex P0 bans.
Conversely, absence of `provisional` still **requires** `controllerId`, so the
two shapes are mutually exclusive by construction and neither is derivable from
the other without hardware.

**Bind-by-controllerId is intact.** It governs VERIFIED bindings, which is where
it has always mattered: dedup, re-bind, push targeting, the "two cards, one
board" refusal. A PROVISIONAL card is matched by **IP** for exactly one purpose —
finding its own first contact — because the IP is the only thing the operator
actually asserted. The moment that match lands, the card is promoted and every
later match runs on the fingerprint like everything else.

### 1.1 What promotion is allowed to do

Promotion **only fills what the operator left empty**: `controllerId` always,
`deviceName`/`boardId` only when the operator stated no expectation. It never
rewrites the typed port/output/universe config, and a stated expectation the
board didn't contradict is never erased (pinned:
`promotion only FILLS what the operator left empty`).

### 1.2 What counts as a contradiction — and what deliberately doesn't

| code | meaning | hard blocker? |
|---|---|---|
| `device_not_recognized` | the host answered but carries no MarsinLED fingerprint | **yes** |
| `controller_id_claimed` | another card is already verified against this device | **yes** |
| `ip_mismatch` | the board answered at a different address than the one typed | no |
| `per_output_unsupported` | firmware predates per-output DMX (docs/41 §3) | no |
| `board_output_count` | a port row drives an output the board does not have | no |
| `board_id_mismatch` / `device_name_mismatch` | the board disagrees with a STATED expectation | no |

**Deliberately NOT contradictions:** per-output universes, enabled/disabled
outputs, and pixel counts on the board. Those are what a *push* is for, and a
fresh board disagrees on all of them by definition — treating them as binding
failures would make every first contact refuse. That drift is already measured
and named by the sync chip. **Promotion answers "is this the board?"; the sync
chip answers "does the board carry the plan?"** Two questions, two surfaces.

### 1.3 No fallbacks, in both directions

A contradicted contact raises the dialog and changes **nothing** — not the card,
not the device. The dialog offers two explicit choices and no default:

- **"Keep provisional (change nothing)"** — go fix the card or the IP.
- **"Promote anyway — accept the board identity"** — an explicit, labelled
  operator decision, **disabled** for the two hard blockers (an unidentifiable
  box, or a fingerprint another card already owns), because promoting past those
  cannot produce a coherent scene.

There is deliberately no "make the board match the card" button in this dialog:
that is a **push**, it reboots hardware, and it has its own confirm flow.

---

## 2. Where the patch chain changed — and where it didn't

**It didn't.** `isBoundLedController` was already the predicate the whole patch
chain reads, and it is now the **union** of both grades. That is the entire
mechanism: one predicate, one meaning ("this card has a declared board"), and
every layer downstream inherits provisional support with no new branch.

| layer (from `_58` §7.1) | how a provisional card lands |
|---|---|
| 1 device config | untouched — no device is contacted |
| 2 registry (`controllers.yaml`) | `device: {vendor, provisional: true}` |
| 3 `patches.yaml` | `computeLedStrandPatches` → real per-output records (main.js `projectLedStrandPatches`) |
| 4 engine model lanes | `pixelblaze_model_exporter` → real `patch: {universe, addr}`, **no** `unpatched: true` |
| 5 bridge relay routes | built from `patches.yaml` — records exist, so routes exist |
| 6 bridge subscription | the universes are the port rows' own; the `📡 Subscribed Universes` field is unchanged in behaviour |

The **`_92` `unpatched: true` contract is preserved exactly where it belongs**:
a controller carrying *no* device block at all still exports `patch: null` +
`unpatched: true`, still gets the loud per-strand console line, and still shows
up in the parity gate. What changed is that the operator now has a way to leave
that state without a live board. Pinned by two tests that sit next to each other:
*"a PROVISIONAL card projects the same strand patches as a VERIFIED one"* and
*"an UNBOUND card still projects NOTHING (the honest dark state)"*.

### 2.1 Promotion moves nothing

Pinned: `the patch chain is UNCHANGED by promotion`. Every strand record is
byte-identical before and after the fingerprint arrives. First boot does not
re-address the ship.

---

## 3. The placeholder sentinel (`0.0.0.0`)

`_92` parked the TE signs on a `0.0.0.0` PLACEHOLDER controller — a **universe
reservation with no address**. The two features compose cleanly, and the seam is
explicit:

- **`0.0.0.0` cannot be declared provisional.** `canMarkProvisional` refuses it
  with the reason spelled out — *"the placeholder sentinel, not an address —
  type the real IP first"*. A provisional binding whose whole premise is "the IP
  I want" is meaningless on a non-address.
- **Conversion is the operator typing the real IP over the sentinel**, then
  pressing the button. Pinned end-to-end: *"typing the real IP over 0.0.0.0
  converts it cleanly to provisional"* — the gate flips, the binding declares,
  and the strands patch at the real address.
- **A hand-written `0.0.0.0` + provisional card still patches**, with the
  sentinel showing through into every record — which is exactly the loud "no
  address yet" the parity gate's `placeholder_controller` finding exists to
  catch. Pinned so the composition can never drift into silence.
- **The status dot never probes the sentinel**: it returns `UNKNOWN` with
  *"a reserved patch with no address yet, so there is nothing to reach"*.

---

## 4. ONLINE / OFFLINE / UNKNOWN

### 4.1 Why three states, and why not ping

`unknown` is not padding. Codex P0 governs what the UI **claims** as much as what
the code does: a probe we never performed must never render as a confident
OFFLINE dot. That is the same silent-lie shape as a green surface over a dark
rope. So: no IP, the `0.0.0.0` sentinel, a malformed address, or an error class
that describes *our* machine (EACCES, EMFILE) all render `◌ UNKNOWN` **with the
reason in the tooltip**.

**Per-type probes**, because the transports genuinely differ:

| type | probe | why |
|---|---|---|
| **LED (MarsinLED)** | `GET http://<ip>/api/status` | these boards **do not answer ICMP** (docs/41 §2, memory `marsinled-controller-onboarding`). Ping would report the entire LED fleet offline. |
| **DMX gateway** | TCP connect ladder (`:80`, then `:8080`) | sACN and Art-Net receivers answer **nothing** on the data path — E1.31 has no query verb for a sink. A TCP SYN is the honest substitute, and its failure mode carries the signal: **`ECONNREFUSED`/`ECONNRESET` = ONLINE**, because a live IP stack sent that refusal. Only a timeout or an unreachable-host error is OFFLINE. |

Rejected, and why — these are the fallback-shaped answers:

- **ICMP** — raw sockets need admin on Windows, and shelling out to `ping` per
  controller is neither fast nor portable. It would also be *wrong* for every
  LED board.
- **ArtPoll** — only Art-Net nodes answer it, so it would silently mis-report
  every sACN gateway as dead.

### 4.2 Fast, parallel, never blocking

`server/controller_probe_service.cjs`, reached by `POST /controllers/probe` on
the save server (same hop the gamma routes already own — the browser can neither
open a TCP socket nor survive cross-origin to a gateway):

- **bounded pool** (16 concurrent) with a **1.2 s per-probe ceiling**;
- **de-duplicated by box** (`type:ip`) **within** a sweep as well as across —
  two cards on one address are one probe;
- **last-verdict cache** (5 s TTL, `force` to bypass) so the pane paints from
  cache instantly;
- the pane **never awaits a probe**: it renders from whatever it has, shows `⋯`
  mid-sweep, and repaints when the answer lands.

Pinned by test: 12 × 120 ms probes complete in ~120 ms, not 1.4 s; the
concurrency cap holds; the sweep always returns **one result per target, in input
order** (a controller silently missing from the answer would leave a card with a
stale dot and no way to know).

### 4.3 A failed sweep is not an offline controller

If the sweep itself fails, every dot **keeps its previous verdict** and the
error says what actually broke. The auto-sweep then **stops** — the
overwhelmingly likely cause is a save server older than the page (this route is
new), and re-failing every 20 s would bury the one line that explains it. One
loud toast carries the fix ("restart the sim stack, then press Check status").
The stop is session-scoped, not written to the preference, so a reload after the
restart just works.

### 4.4 Where it shows

- A **dot beside every controller's IP** — `●` online / `○` offline / `◌`
  unknown / `⋯` checking — with a tooltip stating the probe used, the detail,
  the timestamp/RTT, and one line that every dot carries:
  **"Reachability only — it does NOT prove sACN frames are arriving."**
- **`🛰 Check status`** + an **`auto ✓/✕`** toggle in the Controllers section
  head. Auto is ON by default and runs only while the pane is open; the toggle
  is persisted per machine (a bench that must not touch the network turns it
  off).

### 4.5 Wired to first contact

An LED probe's reply **is** the board's fingerprint, so the status sweep is the
"next boot / recognition" trigger the ruling asks for: a PROVISIONAL card that
comes back ONLINE *with a recognized fingerprint* goes straight into the same
reconcile → promote path as the manual button. An ONLINE answer with **no**
fingerprint (something else on `:80`) deliberately does **not** fire — the
reconcile would refuse it anyway, and firing would raise a dialog about a
machine that has nothing to do with the show.

---

## 5. Acceptance cases — the six ropes and the TE sign controller

### 5.1 The six rope strands (`_92` §4, the reason this exists)

`LeftRightRopes`, `RightLeftRopes`, `RightRightRopes` (`10.x.x.NN` ×3) carry no
`device:` block, so their six strands are honestly unpatched, receive no sACN,
and every surface stays green. Before this work the only exit was a live
discovery conversation with three boards that are not powered.

**Now, with the boards still in their boxes:**

1. Open **🎛 Controller Mapping**, find `RightRightRopes`.
2. The IP is already typed. Press **⚑ Patch without the board**.
3. The card badges **⚑ PROVISIONAL** — *"declared at 10.x.x.NN · fingerprint not
   read yet"* — and its port rows immediately show real addresses
   (`Right_Front_Right U36:1…`, `Right_Back_Right U37:1…`).
4. Repeat for the other two cards. Press **💾 Save Configuration**.
5. That save writes all six records into `patches.yaml`, re-exports the engine
   model with real `patch:` on all six strands, and gives the bridge six relay
   routes. **The chain is complete. The parity gate's six
   `placeholder/unpatched_marker` INFO findings go away.**
6. On show day the ropes power on. The status sweep sees them come ONLINE,
   reads each fingerprint, reconciles, and promotes all three cards to
   **✓ VERIFIED** with a toast each — or stops on the one that disagrees and
   says exactly what disagreed.

Nothing moves in step 6: the addresses were already correct (§2.1).

### 5.2 The TE sign controller

`TeSigns-PLACEHOLDER` sits on the `0.0.0.0` sentinel with U38/U39 reserved.
When the sign wiring is assembled and the box has an address:

1. Type the real IP over `0.0.0.0` in the card's IP field.
2. **⚑ Patch without the board** is now enabled (it refuses on the sentinel,
   with the reason).
3. Drop the `PLACEHOLDER` marker from the name.

The signs are patched from that moment; the board is promoted at first contact.

> **Note on `_92`'s concurrent addendum:** that agent is reclassifying the TE
> signs from the DMX placeholder to real **LED-bus** fixtures right now. That
> changes *which controller type* the signs hang off — it does not change any of
> the above, because the provisional grade lives on the LED card and the signs
> are moving **onto** an LED card. The two waves compose; §7.2 shows they do not
> collide.

---

## 6. Verification

### 6.1 Unit tests — 76 new, all green

| file | tests | what it pins |
|---|---|---|
| `tests/provisional_binding.test.js` | **33** | the schema (provisional may not carry a fingerprint or a receipt), the grades, `markControllerProvisional` refusing to downgrade a verified card, **the full chain** (provisional ≡ verified projection, byte-for-byte; unbound ≡ nothing; the engine model exports real addresses), promote-fills-only-empties, promotion-moves-nothing, **all six contradiction codes**, both hard blockers, and every `0.0.0.0` interaction |
| `tests/controller_probe_service.test.js` | **23** | per-class state mapping (refused = ONLINE, timeout = OFFLINE, EMFILE = UNKNOWN), the port ladder, placeholder/no-IP/malformed = UNKNOWN-with-reason, ordering + completeness, **measured parallelism**, the concurrency cap, cache + `force` + box-keying, and **five real-socket cases** on loopback stubs plus RFC 5737 TEST-NET-1 for offline |
| `tests/controller_status.test.js` | **20** | probe targets (including the ones that can't be probed), verdict merging (a broken sweep never overwrites a good verdict), the dot's three states + per-type explanation, the badge copy, **PROVISIONAL + OFFLINE as a coherent pair**, the first-contact trigger's four negative cases, and `canMarkProvisional` agreeing with the mutation it gates |

No physical controller is contacted by any of them: the network tests use only
`127.0.0.1` stubs this suite stands up itself and a documentation-reserved
address.

### 6.2 Live, in the real pane — 18/18 checks, 7 screenshots

New tool `simulation/agent_tools/provisional_status_verify.cjs` (scene
`test_bench`, servers already running — the operator's stack was reused, never
bounced). Safety is **asserted in-page** before anything is touched: the sACN OUT
socket is replaced by a permanently-closed stub before the first page script
runs, **every off-host fetch is refused** by a pre-boot interceptor, the
reachability auto-sweep is switched OFF in `localStorage`, and nothing is ever
saved.

```
✓ no sACN OUT socket from this window
✓ every dot reads UNKNOWN before any probe (never a guessed OFFLINE)
✓ the unknown dot explains itself
✓ an UNBOUND LED card shows NO grade badge
✓ an UNBOUND LED card with a typed IP offers "Patch without the board"
✓ the card is now PROVISIONAL, loudly badged
✓ the registry carries the provisional grade and NO fingerprint
✓ the provisional card offers Verify + Drop, and no longer offers Mark
✓ every strand on the provisional card is PATCHED (no board involved)
✓ the dots render the injected verdicts exactly
✓ OFFLINE renders ○ and ONLINE renders ●
✓ PROVISIONAL + OFFLINE coexist as two independent chips
✓ a contradicting board raises the reconcile dialog
✓ the dialog names every disagreement
✓ a contradiction changes NOTHING — the card is still provisional
✓ an agreeing board PROMOTES the card to VERIFIED
✓ the fingerprint is now recorded and the provisional grade is gone
off-host requests attempted (all REFUSED): 1 → http://10.x.x.NN/api/config
✓ no sACN frame ever left this window
══ ALL CHECKS PASSED ══
```

**That one refused request is the pane's own pre-existing sync-chip read on
panel open** — not this feature. Nothing else left the machine.

Screenshots in `~/tmp/provisional_status/`, all visually inspected:

| file | what it shows |
|---|---|
| `01_baseline_unknown_dots.png` | every dot `◌` before any sweep; the `🛰 Check status` + `auto ✕` controls in the section head |
| `02_unbound_offers_patch_without_board.png` | the unbound LED card, no grade badge, the new button live |
| `03_provisional_badge_and_patched.png` | the dashed amber **⚑ PROVISIONAL** badge, *"declared at 10.x.x.NN · fingerprint not read yet"*, **Verify / Drop / Push**, and the port rows carrying **real** patches (`LED_0 U10:1–80 ×20px`, `LED_1 U12:1–80 ×20px`) — patched from a typed IP alone |
| `04_status_dots_online_offline_unknown.png`, `04b_…_led_card.png` | the dots in place on the cards |
| `04c_status_dots_zoom.png` | 2.4× crop of the identity rows: a **filled green ●** beside the online controller, a **hollow red ○** beside the offline one |
| `05_reconcile_dialog.png` | the full reconcile stop: three named mismatches (`ip_mismatch`, `per_output_unsupported`, `board_output_count`), each with *declared* vs *board*, and the two explicit choices |
| `06_promoted_verified.png` | the same card after an agreeing contact: **✓ VERIFIED**, `Bench-Demo · angio4`, `○ Never pushed` |

The probe *transport* is not exercised live (that would mean probing the
operator's real boards, which this session forbids) — it is covered by the 23
unit tests including five real-socket cases. **Live status against real gear
happens on the operator's next stack restart**, which is also when the save
server picks up the `/controllers/probe` route (§4.3 makes that transition
self-explaining rather than a mystery).

---

## 7. Suite numbers

### 7.1 Totals

| suite | before | after |
|---|---|---|
| `simulation` (`npm test`) | 1482 tests, **8 fail** (documented baseline) | **1559 tests, 9 fail** |
| `marsin_engine` | — | **not run — no shared engine code touched** |
| `python scripts/security_check.py` | — | **PASS** |

`--all` reports 6 findings, all pre-existing MAC addresses in the **gitignored**
`simulation/.scene_backups/` tree. None in any file this work touched.

### 7.2 The 9th failure is not mine — proof

`real scene titanic: the model is fresh and complete…` fails on four
`unmapped_fixture` findings for the TE Sign halves, with the message *"this is
an LED pixel fixture (definition `bus: led`)… it appears in the LED half of the
unmapped tray."*

- That string occurs **6× in the worktree** `simulation/lib/scene_model_parity.cjs`
  and **0× at `HEAD`** — the message is produced by the `_92` agent's in-flight
  rewrite of that file, which references their brand-new
  `src/dmx/led/led_fixture_kind.js`.
- The parity test's entire dependency set is `lib/scene_model_parity.cjs`,
  `tools/scene_model_parity.cjs` and the scene/model files on disk. **This work
  touched none of them.**
- It is the expected mid-wave state of `_92`'s TE-sign LED reclassification: the
  signs are now classified `bus: led` while still chained on the DMX placeholder
  controller. It closes when that wave lands.

The other 8 are the documented baseline verbatim (bench_section_sync ×5,
pixel_map_view_defaults compression margin, scene_model_parity test_bench ×2).

### 7.3 Concurrency with `_92`

Both waves edited `simulation/src/gui/controller_map_editor.js` — disjoint
regions (theirs: LED-bus fixture classification in the tray/kind helpers; mine:
the status sweep + the dot in the card header). Both applied cleanly, the merged
file imports clean, and the full suite was re-run afterwards. `_92`'s three
barred files (`led_discovery_panel.js`, `marsinled_client.js`,
`device_config_mapper.js`) were mine alone; I touched nothing in the TE-sign
fixture or scene work.

**Zero scene writes.** `simulation/scenes/**` is untouched by this work.

---

## 8. Files touched

| file | what |
|---|---|
| `simulation/src/dmx/controller_registry.js` | the two binding grades in `normalizeDeviceBlock`; `isProvisionalDeviceBlock` / `isProvisionalLedController` / `isVerifiedLedController` / `ledBindingGrade`; `markControllerProvisional`, `promoteProvisionalBinding`, `controllerBoundToDeviceId`; both `record*Push` refuse a provisional block |
| `simulation/src/dmx/led/provisional_binding.js` | **new** — pure reconcile: the six mismatch codes, the two hard blockers, `provisionalCandidatesForDevice` (IP-matched, and why that is not a weakening of bind-by-controllerId) |
| `simulation/src/dmx/controller_status.js` | **new** — pure UI model: probe targets, verdict merge, the dot, the grade badge, the first-contact trigger, `canMarkProvisional` |
| `simulation/server/controller_probe_service.cjs` | **new** — per-type parallel probing, three honest states, box-keyed cache, injectable transports |
| `simulation/server/save-server.js` | `POST /controllers/probe` |
| `simulation/src/gui/led_discovery_panel.js` | the grade badge; "⚑ Patch without the board" / "🔗 Verify against board now" / "✕ Drop provisional"; `attemptFirstContactPromote` + the reconcile dialog; the discovery scan offers Promote on a provisional IP match; the push promotes a provisional card and refuses a claimed fingerprint; sync chips are VERIFIED-only |
| `simulation/src/gui/controller_map_editor.js` | the status dot per card, `🛰 Check status` + `auto` toggle, the sweep + `applyControllerProbeResults` ingestion, timer tied to pane visibility |
| `simulation/style.css` | grade badge, status dot, reconcile dialog |
| `simulation/src/dmx/pixelblaze_model_exporter.js` | contract comment: "device-bound" is the union of grades (behaviour already correct by construction) |
| `simulation/src/dmx/led/led_patch_projection.js` | same, on the projection's own header |
| `simulation/lib/bench_section.cjs` | **bug fixed in passing**: the bench mirror dropped `provisional` while keeping the block, which would have produced a verified block with no `controllerId` — a file the registry loader refuses outright |
| `simulation/agent_tools/provisional_status_verify.cjs` | **new** — the live proof tool of §6.2 |
| `simulation/tests/{provisional_binding,controller_probe_service,controller_status}.test.js` | **new** — 76 tests |

No git operations were performed.

---

## 9. For the operator

1. **Restart the sim stack once.** The page needs a reload for the new pane, and
   the save server needs a restart to serve `/controllers/probe`. Until then the
   pane says so in one toast and turns auto-status off by itself.
2. **Then: type the three rope IPs and press ⚑ Patch without the board on each,
   and Save.** Six strands patch end-to-end with nothing powered on (§5.1).
3. **The TE sign controller** converts the same way once its box has an address
   (§5.2) — type the real IP over `0.0.0.0` first; the button refuses the
   sentinel on purpose.
4. **`auto ✓` probes your real network** every 20 s while the Controllers pane is
   open — HTTP `/api/status` to LED boards, TCP connect to DMX gateways, nothing
   written anywhere. Turn it off with the `auto` button if you want a silent
   network.
