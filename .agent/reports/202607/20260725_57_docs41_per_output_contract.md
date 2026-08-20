# 20260725_57 — docs/41 re-based onto the per-output LED contract

First application of the operator's standing order
(`.agent/memory/doc_inconsistency_standing_fix.md`, 2026-07-30): *"if you find
doc inconsistency, fix and clean up."* The doc debt was flagged by `_56` §4 —
`docs/41_led_controller_onboarding.md` §3 still documented the **linear
single-base sACN mapping** as the LED controller contract, while both the
hardware and the sim's push path have been **per-output only** since the
operator's 2026-07-10/11 ruling.

Descriptive truth only: every change below corrects a claim about *how things
work*. No policy/intent statement was altered. No code, scene, model or git
operation was touched; no device was probed (code + reports were the evidence).

---

## 1. What was stale → what it says now

| # | Stale claim (before) | Corrected claim (now) | Evidence |
|---|---|---|---|
| 1 | **§3 heading + body:** "The linear-mapping constraint" — the receiver maps channels *linearly across enabled strands* from one `dmx.universe`/`startAddress`; "It has **no per-output universe assignment** — it is one contiguous stream" | **§3 "The per-output universe contract"** — one INDEPENDENT sACN receiver per physical output, each on its OWN `{universe, startAddress:1}`; no contiguous stream across outputs. Split into 3.1 feature gate + read-back, 3.2 port=output, 3.3 byte layout within an output, 3.4 worked example, 3.5 plan rules | `marsinled_client.js` (`deviceSupportsPerOutput`, `readPerOutput`, `validatePerOutputPlan`, `applyPerOutputUniverses`, `pushPerOutputUniverses`); `led_patch_projection.js` module contract; report `20260725_56` §1 + §4 (live device advertises `capabilitiesExt.perOutputDmx: true`, distinct universe per enabled output) |
| 2 | **§3 worked example:** output 0 → `U ch1–160`, output 1 → `U ch161–320` (both on ONE universe, output 1 continuing output 0's run) | Output 0 → **U3** ch1–160, output 1 → **U4** ch1–160 — each starts at channel 1 of **its own** universe. Explicit note that this is precisely the difference from the old table | `led_patch_projection.js:183-209` (cursor RESETS to `(port.universe, 1)` per port) + its module header: the linear model "darkened every output past the first on real per-output firmware" |
| 3 | **§3:** "the operator **does not pick a universe per output**" — the sim derives it from cumulative pixel counts | The operator **does** pick a universe per output — it is that port row's `universe` in `controllers.yaml`; `derivePerOutputPlan` keys the plan by `port.port - 1`. `led.baseUniverse` is **ignored** on the per-output path | `device_config_mapper.js::derivePerOutputPlan` ("`led.baseUniverse` is ignored — per-output only") |
| 4 | **§3:** silent on what happens when an enabled output has no valid universe | Documented: **auto-extend** to the next free universe (all-or-none is a firmware rule) with a warning surfaced in the push confirm dialog — never a silent fill | `device_config_mapper.js::derivePerOutputPlan` second pass + `warnings[]` |
| 5 | **§3:** no plan-validation rules documented | New **§3.5**: all-or-none, sACN only (`protocol:0`), start always 1, universe 1–63999, span ≤ 16, no overlap on spill — plus the two non-blocking warnings `led_universe_duplicate` / `led_universe_collision` | `marsinled_client.js::validatePerOutputPlan`; `led_patch_projection.js::validateLedManualUniverses` |
| 6 | **§3:** silent on LED port ↔ output-slot semantics | New **§3.2**: an LED port IS a device output index, so `+port` fills the **lowest free slot 1…16** and refuses loudly past 16; DMX keeps append-only `max+1` | `controller_registry.js::nextLedOutputPortNumber` + `addPort` LED branch; report `20260725_52` §5.2 |
| 7 | **§2 discovery:** probe "~600 ms timeout, batches of 32" | **6500 ms, batches of 64** — a cold MarsinLED takes ~5 s to first HTTP byte, so 600 ms reported an empty subnet; ≈4 batches for a full `/24` | `marsinled_client.js` `DEFAULT_PROBE_TIMEOUT_MS`/`DEFAULT_BATCH_SIZE` + their rationale comment; report `20260710_12` |
| 8 | **§2:** "**Key by IP** (operator decision — not MAC). Dedup by IP." — conflated scan dedup with binding identity | Split into two facts: scan **results** dedup by IP, but **binding identity is the device `controllerId`** (the `device:` block). Documents the fixed Bind affordance (offered by device identity, so a hand-typed card with the right IP is bindable) and the honest label "✓ added as '<name>' — NOT bound yet" | `controller_registry.js::normalizeDeviceBlock`; `led_discovery_panel.js::shouldOfferBind` + the dedup-label branch; report `20260725_56` §2 |
| 9 | **§2:** MAC listed as an identify field with no handling note | Added: the MAC is **never persisted** — live display only; `normalizeDeviceBlock` drops it on load (public repo, `bm26-mac-address` gate) | `controller_registry.js::normalizeDeviceBlock` NOTE block; `led_discovery_panel.js::setLiveMac` ("display-only — never persisted") |
| 10 | **§2:** identify list omitted the fields the push path actually gates on | Added `capabilitiesExt.perOutputDmx` and `sacn.perOutput` to the identify list | `marsinled_client.js::deviceSupportsPerOutput` / `readPerOutput` |
| 11 | **§4.1(a) strands JSON:** enabled strands carried no per-output fields | Enabled strands carry **`dmxUniverse` + `dmxStartAddress: 1`**; disabled strands are copied through untouched (no per-output fields added); the push is an explicit read-modify-write of the whole array | `marsinled_client.js::applyPerOutputUniverses` / `pushPerOutputUniverses`; report `20260710_11` (exact POST body) |
| 12 | **§4.1(b) dmx JSON:** `{enabled, protocol, universe:<U>, startAddress:1, timeoutMs}` — the legacy single-base body | `{enabled:true, protocol:0, timeoutMs:3000}` — **no `universe`/`startAddress`**, those are per-strand now. Notes the old form belonged to the removed legacy push | `marsinled_client.js::pushPerOutputUniverses` body literal |
| 13 | **§4.2:** `strands` 1–16 stated without consequence | Same bound, now tied to `LED_MAX_OUTPUTS = 16` (§3.2), + pointer to the per-output plan rules in §3.5 | `controller_registry.js:62-67` |
| 14 | **§4.3:** "an explicit `POST /api/system/reboot` also exists" (unverified aside) | Verified live (HTTP 200, device back in ~11 s, `resetReason: software`, bogus sibling path → 404). Also records that **every per-output push reboots** the device, and that the sim has **no restart button** — `rebootDevice` has no callers | report `20260725_56` §3 (probe table); `marsinled_client.js::rebootDevice`; `led_discovery_panel.js::startPush` |
| 15 | **§5.1/5.2 wiring:** strands patched "**contiguously** on the controller's base universe per §3"; model pixels "on the LED universe" (singular) | Each enabled port carries its **own** universe; model pixels land per-output on their own universes | same as #1–#3 |
| 16 | **§5.3:** dual-destination left as an open question ("decide per §Follow-ups") | **Answered:** `alsoFlat: true` on the engine controller entry fans the universes to hardware **and** the flat sim-bridge destinations | `marsin_engine/lib/output_dispatch.js` (`alsoFlat` opt-in); report `20260709_2` |
| 17 | **Header status block:** "exporter **linear** addressing … tested (sim suite 190/190)" | "exporter **per-output** addressing"; the stale absolute suite count dropped (the suite is now ~1080 tests with a standing pre-existing failure set); added an up-front pointer to §3 for the mapping model | reports `20260710_12`, `20260725_56` §5 |
| 18 | **§6 implementation plan:** presented as current, and repeats "linear layout (§3)" in Slices B and C | Marked **historical (executed 2026-07-09/10)** with a note naming the two superseded assumptions (600 ms/32 scan window; linear layout). Plan text itself left intact as a record | `.agent/plans/20260709_0_led_integration_execution.md` is the campaign record; AGENTS.md says plans are read, not rewritten |
| 19 | **§7 follow-ups:** dual-destination listed as open; restart decision absent | Split into **Resolved** (dual-send) / **Open**; added the explicit restart-control decision carried over from `_56` §3 "Held for the operator" | reports `20260709_2`, `20260725_56` |
| 20 | **§2 intro:** "`Promise.all` batches of 32 … **Reuse that shape**" — prescribed CaptainPad's timings, contradicting the bullet below it | Borrows CaptainPad's *shape*; states plainly that the **timings differ** and points at the corrected bullet | same as #7 |
| 21 | **§4 intro:** 400 body documented as `{error, field, detail}` only; CORS constraints undocumented | Adds the per-output `fields: [{field, detail}, …]` multi-error shape, and documents that writes must stay CORS **simple requests** (`text/plain`, no custom headers) because the device 404s `OPTIONS` | `marsinled_client.js::postConfigBody` docstring + implementation; report `20260725_56` §1 (404-on-OPTIONS and `Access-Control-Allow-Origin: *` re-confirmed live) |
| 22 | **End of file:** stray `</content>` / `</invoke>` tool-call residue committed into the tracked doc | Removed | n/a — plain junk |

## 2. Memory facts corrected

`marsinled-controller-onboarding` (agent auto-memory for this project) carried
the same stale bullet: *"sACN input is mapped LINEARLY across enabled strands …
no per-output universe … must compute a contiguous channel layout"*. Rewritten
to the per-output contract, plus the corrected discovery window and the
bind-by-`controllerId` rule; its `description` line and the `MEMORY.md` index
entry were re-worded off "linear sACN mapping".

`.agent/memory/` and `.agent/ops/` in-repo were grepped for the linear claim —
**no runbook or repo memory fact repeats it** (the only hits are `_56`'s own
doc-debt flag in the readiness thread tracker and the standing-order fact, both
of which describe the debt correctly).

## 3. Scope discipline — what was checked and NOT changed

- **Directly-linked docs only.** `docs/41` links no other `docs/NN` file. A
  sweep of all of `docs/` for the LED linear-mapping claim found **zero** other
  occurrences (every other "linear" hit is unrelated: audio curves, crossfades,
  palette interpolation).
- **Linked `.agent/plans/`** (`20260709_0`, `20260710_2`) were read, not
  rewritten — plans are historical campaign records.
- **Firmware internals stayed out.** The old §3 cited a private-repo source file
  (`src/network/DmxReceiver.cpp::drivePixels`); the rewrite derives the contract
  from the sim-side code and the device's public HTTP surface instead, so the
  doc no longer reaches into the MarsinLED repo.
- **Full RFC1918 IPs left as-is** in `docs/41` (`10.x.x.201` etc. appear in §1,
  §5, §7). They are the doc's established convention and the security gate
  allowlists `10.` in non-report paths — redacting them is a separate,
  doc-wide style call, not a truth fix. Flagged, not done.
- **No policy/intent edits.** Open decisions stayed open; the operator's
  per-output-only ruling was recorded, never re-litigated.

## 4. Verification

- Public-repo hygiene: no secrets, no MACs, no IPv4 anywhere in this report, no
  future dates or deadlines in either changed tracked file.
- `docs/41` line endings unchanged in git terms (`core.autocrlf=true`); the diff
  is content-only, 249 insertions / 69 deletions.
- Every corrected claim above is anchored either to a named function in the
  current sim source or to a dated report; nothing was inferred from guesswork.

## 5. Follow-ups

- **Operator decision still open:** the "⟳ Restart device" button (`_56` §3,
  now recorded in `docs/41` §7).
- **Optional style pass:** redact the remaining full RFC1918 IPs in `docs/41`
  to the `10.x.x.NN` house style — cosmetic, needs no verification work.
