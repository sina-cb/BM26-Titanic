# 20260725_56 — LED controller "not showing up / can't restart" (the .60 unit)

Debug session on the operator's live-mapping report: the sim could neither
"see" nor restart the MarsinLED controller at `10.x.x.60` (the card he added
as an LED controller in the titanic scene). Diagnosis first, minimal
disturbance; the device belongs to a live mapping session.

Raw probe transcripts, timestamps and the reboot repro live in
`~/tmp/led_controller_debug/` (untracked — they carry full IPs and MACs).

---

## TL;DR

Two independent causes, both sim-side. The device was never at fault.

1. **"Not showing up"** — a **bind-affordance bug** in
   `simulation/src/gui/led_discovery_panel.js`. Discovery *did* find the
   device; the modal then refused to offer the **Bind** button because the
   operator's hand-added card already matched the device **by IP**. IP match
   is not a binding — that card had no `device:` block, so it stayed
   **unbound forever** and was skipped by every bound-only flow (sync chip,
   push-all, gamma-all). **FIXED + tested.**
2. **"Can't restart"** — **there is no restart control in the sim at all.**
   `rebootDevice()` exists in `simulation/src/dmx/led/marsinled_client.js`
   and is correct, but it has **zero callers** anywhere in the repo: no
   button, no server route, no test. Dead code. The endpoint it targets was
   verified working live. **Fix path identified; button NOT added** (see
   "Held for the operator").

---

## 1. Ground truth — the device is healthy

Read-only HTTP probes from the workstation (docs/41 §2 endpoints; the device
does not answer ICMP, so HTTP is the only valid liveness test):

| Probe | Result |
|---|---|
| `GET /api/status` | **HTTP 200**, ~190 ms warm, full JSON |
| `GET /api/config` | HTTP 200 |
| `GET /api/board` | HTTP 200 |
| `GET /api/version` | HTTP 200 |

The status body carries **all three** fingerprint fields docs/41 §2 requires
(`controllerId` + `boardId` + `strands`), so it is a valid discovery hit. It
advertises `capabilitiesExt.perOutputDmx: true`, i.e. the per-output universe
mapping the sim's only supported push style needs. Three of four outputs are
enabled (40 px RGBW each), already reporting the same per-output universes the
operator's card declares. Nothing about the device blocks the sim.

**CORS is not the problem either.** The device answers with
`Access-Control-Allow-Origin: *` on `GET /api/status`, so the browser-side
subnet sweep (discovery runs in the *page*, not on the save-server) can read
the response normally. A CORS-swallowed fetch was the leading hypothesis for a
silent miss; the headers rule it out. Note the sim's own comment in
`postConfigBody` is confirmed correct: **`OPTIONS` on the API paths returns
404**, which is why config writes must stay CORS-"simple" requests (no custom
headers, `text/plain` content type). That constraint is intact.

For the record, the three previously-documented units (`…201/.202/.203`) did
**not** answer during this session (4 s timeouts). They are simply not on the
bench right now — unrelated to this bug.

---

## 2. "Not showing up" — the bind affordance bug (FIXED)

### What the operator saw

He added the LED controller card by hand (correct IP, type LED, two ports on
U20/U21). Then he used the card's own **🔍 Discover / bind device** button and
scanned. The device appeared in the results — but the only thing offered was
the flat label **"✓ already added as '<his card>'"**. No bind action. The card
therefore never acquired a `device:` block, and in `controllers.yaml` it is
still **unbound** (confirmed: the entry has ports and IP but no `device:`).

### Why

`led_discovery_panel.js`'s result card computes an `existing` dedup that
matches a scene controller **either** by the device's `controllerId` **or** by
plain **IP equality**. It then gated the Bind button on:

```js
if (controller && (!existing || existing.id !== controller.id)) { … }
```

When you open the modal *from* a card whose IP already equals the device's,
`existing.id === controller.id` — so the Bind button is suppressed for
**exactly the card that needs it**. The dedup conflated *"a card with this
address exists"* with *"a card is bound to this device"*. Those are different
states: binding is what writes the `device:` fingerprint block that
`isBoundLedController()` checks and that the sync chip, push-all and gamma-all
flows all require.

Consequence chain: unbound card → no sync chip → skipped by "push gamma to
all" and "push all" → reads to the operator as "the sim doesn't see my
controller".

### The fix

`simulation/src/gui/led_discovery_panel.js`:

- New exported pure predicate **`shouldOfferBind(controller, device)`** — true
  whenever the modal was opened from a controller that is **not already bound
  to this device** (compared on the device `controllerId`, the real identity,
  not on the address). Rebinding onto a different device stays offered;
  binding a card to the device it already is stays suppressed.
- The result card now calls it instead of the IP-derived dedup.
- The dedup label is now honest about the two states: a matching card that is
  **not** bound renders **"✓ added as '<name>' — NOT bound yet"** rather than a
  plain ✓, so the difference is visible instead of implied.

**Note there was no swallowed error here.** `probeDevice` returning `null` on a
miss is documented and correct (it is a 254-IP sweep). The failure was a UI
gate, not a hidden `catch` — no P0 fallback violation found in this path.

### Test

New `simulation/tests/led_bind_affordance.test.js` — 5 cases, no DOM, no
network: the live case (unbound card, same IP → **offer**), already bound to
this device → no offer, bound to a different device → offer (rebind),
create-only mode → no offer, and a partial `device:` block cannot silently
suppress the offer.

---

## 3. "Can't restart" — there is no restart control

### What the restart path actually is

The sim has **two** device-reboot mechanisms on paper, and only one is wired:

1. **Implicit reboot inside the push flow** — `pushPerOutputUniverses` writes
   `strands[]` + `dmx{}`, which per docs/41 §4.3 always replies
   `needs-reboot`; the panel then waits it out with `awaitReboot` and verifies
   the read-back. This path **is** wired (the "⬆ Push to controller" button)
   and its logic is sound.
2. **Explicit reboot** — `rebootDevice(ip)` in
   `simulation/src/dmx/led/marsinled_client.js`. A repo-wide search for
   `rebootDevice` returns **only its own definition and its own doc comment**.
   No UI button, no save-server route, no test, no CLI tool. It is dead code.

So "the sim cannot restart the controller" is literally true: **the sim never
had a restart button.** The operator's only reboot lever is the full
push-and-reboot flow, which also rewrites the device's strand/DMX config —
much more than "restart it".

### The endpoint itself is fine (verified live, once)

Read-only evidence could not settle whether the endpoint `rebootDevice` targets
even exists on this firmware build — and there was a real reason to doubt it:
the device's **own** web console never calls it (its config page reboots as a
side effect of a config write instead). So one deliberate, budgeted restart was
executed as the repro, with a control probe first:

| Step | Time (UTC) | Result |
|---|---|---|
| baseline status | 17:33:48 | `uptimeMs` 353 751, `resetReason` `poweron` |
| POST to a **bogus** sibling path (control) | 17:33:49 | **404**, empty body — this is the unregistered-route signature |
| **POST the reboot endpoint** | **17:34:08** | **200** `{"status":"ok","message":"Device Rebooting…"}` |
| status re-read | 17:34:19 | `uptimeMs` **9 353**, `resetReason` **`software`**, back on the same address |

The route exists, is distinguishable from a 404, and the device came back in
~11 s (consistent with the ~9.2 s boot docs/41 records). **The sim's reboot
endpoint constant is correct — it is simply never called.**

> Attribution note for the operator: **the only device restart this session
> caused was at 17:34:08 UTC.** Another agent was separately tasked with a
> WiFi/Ethernet change on this device; any other blink or brief unreachability
> is theirs, not this session's. **No config was written to the device by this
> session — reads plus that single reboot, nothing else.** The Ethernet-only
> task was handed off and dropped here before any write.

### Held for the operator (NOT implemented)

Wiring a **"⟳ Restart device"** button into the LED card's device section is
small and now fully de-risked — the transport function exists and the endpoint
is verified. It was deliberately **not** added: it is a new *destructive*
control appearing mid-way through a live mapping session, so it wants the
operator's sign-off rather than a debug agent's initiative. Shape when wanted:
a confirm dialog (naming the ~10 s outage), `rebootDevice` → `awaitReboot` →
status re-read, loud failure on either, no silent retry.

---

## 4. Contract drift worth recording (no action taken)

`docs/41` §3 still describes the **linear** single-stream mapping (one base
universe, pixels packing across enabled strands) as the firmware's contract,
with per-output universes listed only as a later capability. The device on the
bench reports per-output DMX support and carries a distinct universe per
enabled output, and the sim's push path is now **per-output only** (it refuses
the legacy style outright, correctly, per the operator's ruling). §3's worked
example is therefore stale relative to both the hardware and the sim. Not
touched here — flagged so docs/41 can be re-based when someone owns that doc.

---

## 5. Verification

- New tests: `simulation/tests/led_bind_affordance.test.js` — 5/5 pass.
- Related suites re-run green: `led_device_binding`,
  `led_discovery_scene_liveness`, `marsinled_client` — 49/49.
- **Full sim suite: 1080 tests, 1072 pass, 8 fail — the same 8 as the
  baseline**, all pre-existing scene-parity / pixel-map CLI failures from live
  scene editing and other agents' in-flight work (duplicate `TE Sign V3 A/B`
  names, LED strands present in the exported model but not yet recorded in
  `patches.yaml`, view-bit headroom, fixture docking). **Zero new failures by
  name**; nothing in the failing set touches the LED discovery path.
- Live-session constraints honoured: no writes to `scenes/**` or `models/**`,
  no sim save, no sim restart, no sACN output controls touched, no browser
  session opened against the operator's running sim, no git operations.

## 6. Follow-ups

- **Operator action:** re-open the .60 card's **🔍 Discover / bind device**,
  scan, and press the now-present **Bind** button — that writes the `device:`
  block and the card joins the sync-chip / push-all / gamma-all flows. (The
  fix ships in the sim bundle; it needs a page reload to take effect.)
- **Decision wanted:** add the explicit "⟳ Restart device" button? (§3.)
- **Doc debt:** re-base `docs/41` §3 onto the per-output mapping. (§4.)

---

## Addendum — live re-check ~24 min after the baseline

Operator asked for a status check on the .60 unit. Read-only probes only, no
writes, no reboots. Evidence: `~/tmp/led_controller_debug/recheck_*.txt`.

**Reachable and unchanged.** HTTP 200 in ~180 ms at the same address, same MAC,
same SSID, same signal. `firmwareSHA` unchanged (no reflash), `networkMode`
still WiFi with no Ethernet fields, strands and per-output universes identical,
gamma still flat, `configSource: primary`, `stagedPending: false` — so **nobody
staged or applied a config write**.

**No reboot since the sanctioned one.** Uptime reads 23 m 53 s; the gap between
the 17:34:08 UTC restart and this probe is 23 m 54 s — an exact match, with
`resetReason` still `software`. **The external WiFi/Ethernet agent has not
rebooted, reconfigured or re-addressed this device at all.** Heap is healthy and
the boot report is clean (3/3 outputs bound, 120 px, zero errors), with a
*higher* free-heap low-water mark than the previous boot.

**The real finding: the strands are dark, and have been since boot.** The sACN
receiver is armed and listening on its three per-output universes but reports
**`rxPackets: 0`, `lastUniverse: 0`, `lastPacketAgeMs: -1` after 24 minutes** —
it has received nothing at all. Each enabled output shows `framesPresented: 2`
at ~12 s after boot (the boot self-test) and nothing since; the local pattern VM
is parked, which is correct behaviour while DMX mode is enabled. So the device
is configured correctly and waiting on a source that never arrives. This is
unchanged from the baseline — not a regression, and not something the bind fix
addresses.

**Why nothing arrives (read-only look at the engine config).**
`marsin_engine/config.yaml` has exactly **one** `controllers:` route — to the
`…202` unit, for two unrelated universes. There is **no route for the .60
device and none for its three universes**, so those universes fall through to
the flat `sacn.destinations` (loopback, i.e. the sim bridge) and are streamed to
the *simulation only*, never to the hardware. Worth noting the one route that
does exist points at the `…202` unit, which did not answer during this session.
Per docs/41 §5.3 this is the known "dual-destination for LED universes" open
decision. Nothing was changed here — routing and sACN output controls were left
strictly alone during the live session.

**Sim bind state: still unbound.** The scene's `.60` entry has no `device:`
block yet (no `device:` key anywhere in that file), so the Bind button has not
been pressed — expected, since the fix needs a page reload to appear.

**Verdict: healthy, unchanged, and correctly configured — but unfed.** Nothing
is wrong with the controller. To light it, its universes need a route to the
device instead of loopback-only; that is an engine-routing change and an
operator decision, not a device or discovery fault.
