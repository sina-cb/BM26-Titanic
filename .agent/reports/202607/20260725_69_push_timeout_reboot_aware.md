# 20260725_69 — the per-output push is reboot-aware (the 5000 ms failure)

Operator bug, verbatim: during a real per-output push from the LED controller
pane he got **"✋ per-output push failed: timed out after 5000 ms — device did
not respond"**, and: *"the restart takes much longer for the config reset, can
it be fixed in the LED controller pane?"*

Yes — and it was worse than a short timer: the push declared a **failure over a
device it had almost certainly just written**.

Code + unit tests only: **no browser session against the sim, no scene save, no
device HTTP (not even a GET), nothing started or restarted, no git operations.**
The operator was running lit hardware off this stack throughout; every device
timing below is quoted from earlier live evidence, not re-measured.

---

## 1. Where the 5000 ms lived

One constant, used for every phase:

`simulation/src/dmx/led/marsinled_client.js`
```js
const DEFAULT_HTTP_TIMEOUT_MS = 5000;   // getConfig/pushConfig on a chosen device
```

`pushPerOutputUniverses(ip, {universeByOutputIndex})` read `opts.timeoutMs ??
DEFAULT_HTTP_TIMEOUT_MS` **once** and handed the same 5000 ms to both the
`GET /api/config` and the `POST /api/config`. The panel calls it with no opts,
so the live push ran on the default.

The message itself is minted in `fetchWithTimeout` (same file): when *our*
`AbortController` fires it throws `timed out after ${timeoutMs} ms — device did
not respond` (a G6 legibility fix — the raw AbortError used to leak). That
rejection propagated out of `pushPerOutputVerifyRecord`
(`simulation/src/gui/led_discovery_panel.js`) into `runPerOutputPush`'s catch,
which painted `✋ per-output push failed: …` and stopped: no reboot wait, no
read-back, **no save, no notify**.

### Why that is guaranteed to fail on healthy hardware

Measured facts on this rig:

| fact | measurement |
|---|---|
| device reboot after a per-output config write | **~10–11 s** (`_56` addendum, live push) |
| cold device → first HTTP byte | **~5 s** (titanic_202: first GET 4984 ms, warm 162–236 ms) |
| discovery probe budget per 64-batch | ~6.5 s |

A per-output write makes the firmware persist the strand table and **reboot** —
and on this rig it goes down *before flushing the HTTP reply*, so the socket
just stops. A 5000 ms budget on the POST therefore aborts **mid-reboot, every
time, on a perfectly healthy device**. Worse, 5000 ms also sat exactly on top of
the ~5 s cold-first-byte number, so even the plain reads were a coin flip on the
first call after an idle device.

### The real defect: a timeout was treated as proof of failure

The push's own contract (`_58` §5, `_61`) is that a push is done only when the
device AND the feed agree, *or* it says exactly which layer is stale. But an
unanswered write is **not** evidence the write failed — it is evidence of
*silence*. Reporting "push failed" over a device that applied the config leaves
the sim's mirror saying "not written" while the hardware is written: the exact
mirror-vs-device lie this campaign exists to kill, and the operator then can't
trust either side. The read-back — which the code already had — is the only
thing that can settle it, and the old flow never reached it.

## 2. The new phase budgets

All named, exported, and commented with their measured basis in
`marsinled_client.js`:

| constant | value | basis |
|---|---|---|
| `DEFAULT_HTTP_TIMEOUT_MS` | **8000** (was 5000) | one read on a possibly COLD chosen device; ~5 s to first byte + margin |
| `PER_OUTPUT_WRITE_TIMEOUT_MS` | **12000** | POST `/api/config`; room for a slow flash commit, and it overlaps the ~11 s reboot so a lost reply costs nothing — the poll that follows finds a device already back |
| `REBOOT_WAIT_TIMEOUT_MS` | **45000** (was 30000) | reboot measured ~11 s; honest headroom for a cold WiFi re-associate. Hard deadline, no infinite spinner |
| `REBOOT_POLL_INTERVAL_MS` | **1000** | unchanged |
| `DEFAULT_PROBE_TIMEOUT_MS` | 6500 | unchanged (per-IP sweep probe) |

`pushPerOutputUniverses` now takes `{readTimeoutMs, writeTimeoutMs}` and
**refuses a flat `opts.timeoutMs`** with a loud error — one budget across a read
and a reboot-spanning write is precisely the bug, so no future caller can
silently reintroduce it.

The push runs as three explicitly-budgeted phases
(`pushPerOutputVerifyRecord`):

1. **write** — `POST /api/config`, `PER_OUTPUT_WRITE_TIMEOUT_MS`;
2. **reboot wait** — `awaitReboot` polls `/api/status` until the device answers,
   `REBOOT_WAIT_TIMEOUT_MS`, with `onProgress` feeding the dialog;
3. **verify** — read `sacn.perOutput` back, **only after the device answered**.

Dialog copy now names the phase and its budget, so a reboot never reads as a
hang:

```
pushing per-output universes… (the device may take up to 12s to answer the write)
device rebooting — waiting up to 45s for it to answer (7s elapsed)…
reading confirmed mapping…
```

The confirm dialogs' old "device WILL REBOOT (~10 s)" line now says
"~11 s measured; the push waits up to 45 s for it to answer, and reads the
mapping back before calling it done" (single and fleet).

## 3. A timeout is not a verdict

`pushPerOutputUniverses` classifies write failures:

- the device **answered** (400 with `{field,detail}`, or any other non-2xx —
  the error now carries `err.httpStatus`) ⇒ **definite failure**, unchanged
  loud path;
- the device gave **no answer at all** (our timeout — `err.timedOut` — or a
  dropped socket) ⇒ the rejection is tagged **`err.writeResponseLost = true`**.

`pushPerOutputVerifyRecord` treats a `writeResponseLost` error as *ambiguous*,
not fatal: it enters the **same** reboot-wait poll and then reads the config
back. The read-back is the arbiter:

| read-back | outcome |
|---|---|
| matches the pushed plan | **SUCCESS** — `responseLost: true`; the device step reads `✓ device verified — the write reply was LOST (the device rebooted before answering), but the read-back confirms the mapping applied`, and the push continues to save + notify exactly as normal |
| **different** mapping | failure — `the device did not answer the write AND the read-back shows a DIFFERENT mapping — device mapping mismatch — output N: device U… ≠ wanted U…`, sync chip `drift`, no save, no notify |
| device never answers through the whole 45 s | failure — `…; and the device never answered again within 45s — the write is UNCONFIRMED: it may or may not have applied. Power-cycle the controller, re-open this card to read its live mapping, then push again.` Sync chip `unreachable`, no save, no notify |

Note the third row's wording: an unreachable device gets an **UNCONFIRMED**
verdict, never "the write failed". We do not know, so we do not claim.

**S1 composition is preserved** (`_61`): a red device step still skips both the
save and the bridge notify (nothing to project), a verified-after-timeout write
proceeds to save + notify normally, and the completion sentence is built by the
same `describePushCompletion` with the device step passed as its `lead`. The
success toast appends `(the write reply was lost — the read-back confirmed it)`
so the operator is never told a clean story about a messy one.
**S2 is untouched** — the registry-aware collision gate still runs pre-write and
returns before the confirm dialog.

**Fleet push** (`pushAllLedControllers`) rides the identical core, so every
controller gets the same three budgets and the same arbitration. A lost reply
that verifies is `state: 'pushed'` with the note; a device that never comes back
is `state: 'failed'` with the UNCONFIRMED detail; the summary line counts the
lost-reply-but-verified controllers by name.

## 4. Test counts

`cd simulation && npm test`

| | tests | pass | fail |
|---|---|---|---|
| before | 1161 | 1153 | 8 |
| after | 1174 | 1166 | 8 |

**+13 tests, +13 pass, failures unchanged at 8** — the known pre-existing
stale-model family, byte-identical before and after (`fixtures are docked
beside the ship…`, `the real titanic scene can accept the block today…`,
`view-bit headroom is REPORTED…`, the two `CLI:` parity cases, and the three
`real scene …` cases). They clear on the operator's one sim-save. Not touched.

New cases (nothing sleeps a real budget — `awaitReboot` is mocked in the io bag
for the flow tests, and injected with a tiny `timeoutMs`/`pollIntervalMs` for
the transport test):

- `simulation/tests/per_output_push.test.js` — **+7** (`_69` section): a lost
  write reply is settled by the read-back (asserts the exact call order
  `push → awaitReboot → getStatus → persistScene → notifyBridge`, the
  "response lost, write verified" sentence, green status, non-error toast);
  the dialog names each phase with its budget and the elapsed reboot time; a
  device unreachable through the whole budget is red with **no save and no
  notify** and an `unreachable` chip; the UNCONFIRMED wording; a lost reply
  with a **different** read-back is a `drift` failure that still saves nothing;
  and the two fleet cases (pushed-with-note / failed-loudly).
- `simulation/tests/marsinled_client.test.js` — **+6**: an unanswered write is
  flagged `writeResponseLost` (and `timedOut`); a 400 and a 503 are **not**
  flagged (`httpStatus` set); a flat `timeoutMs` is refused; the budgets
  themselves are asserted against the measured numbers (write > 11 s reboot,
  read > 5 s cold first byte, reboot wait ≥ 30 s and > the write budget); and
  the reboot poll stops at its budget while reporting progress.

`node --check` (copied to `.mjs`, ES-module syntax) passes on all four touched
files.

## 5. Operator live-verification steps

Nothing here has touched hardware. To verify, re-run the push that failed:

1. Open the sim's Controllers panel → the LED card that failed → **⬆ Push**.
2. Expect, in order, in the dialog's status line:
   `pushing per-output universes… (up to 12s to answer the write)` →
   `device rebooting — waiting up to 45s for it to answer (Ns elapsed)…` →
   `reading confirmed mapping…` → a **green** three-step line ending
   `✓ scene saved (patches projected) · ✓ bridge notified — routes follow`.
3. If the write reply is lost again (likely — the firmware drops it), the green
   line will instead lead with *"✓ device verified — the write reply was LOST …
   but the read-back confirms the mapping applied"*. **That is a success.**
   The LEDs should follow with no manual save.
4. Only a red line is a failure now, and it names which of the three it is:
   UNCONFIRMED (device never came back), a mapping mismatch, or a save/notify
   failure with the device write standing.

**Did his failed push leave the device and the mirror out of sync?** Very
likely yes, in the "device ahead of the sim" direction: the POST had been sent
and the device almost certainly applied it and rebooted — the timeout means we
never heard back, not that nothing happened. Because the old code returned on
the error, the push recorded **no** provenance and ran **no** save and **no**
bridge notify, so `patches.yaml`, the engine model and the controller card's
`device.lastPush` all still describe the pre-push world.

How to tell, without guessing: open that card and read its **sync chip** — it
re-reads the device's `sacn.perOutput` and compares it to the plan this page
would push. `in-sync` ⇒ the device did take the write (mirror was merely
un-stamped, and the feed on disk is what still needs the save). `drift` ⇒ the
write really did not land. **Either way the fix is the same: press ⬆ Push
again.** The push is a FORCE push, it is idempotent, and it now finishes the
loop (device → save → notify) instead of stopping at a timeout.

## 6. Untouched / out of scope

- No `simulation/scenes/**`, no `marsin_engine/**`, no server/bridge code, no
  fixture files (agent `_68`'s area).
- The S2 collision gate, the S1 save/notify steps and their sentences, the sync
  chip semantics, and the gamma push path are all behaviourally unchanged.
- The `.60`'s enabled-but-unmapped third output (`_58` §9.2) is still an open
  operator item; nothing here changes it.
