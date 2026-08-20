# 2026-07-24 — Engine G10 fix: hot-reload routes newly-patched universes

Slice 6 of **bm_readiness_mapping** (branch `feat/bm_readiness`). Implementer
session. **No git ops, no commits — changes left uncommitted.** Fixes glitch
**G10** from `20260724_0_mapping_readiness_review.md` §2.

## Root cause (confirmed)

`marsin_engine/lib/output_dispatch.js`. The composite dispatch builds its
transport senders by partitioning the **boot-time** universe list only
(`allUniverses`, the old lines 137–171). A controller declared in engine
`config.yaml` whose universes are **not patched at boot** therefore gets **no
sender** — its host never appears in `sacnUnicastByHost` / `artnetByHost`.

When the model hot-reload path later re-patches such a universe
(`engine.js:1623` `registerUniverse` → `sacnOut.addUniverse(uid)`), the old
`addUniverse` looked up `byUniverse.get(id)`, found the controller declaration
(truthy `decl`), searched the senders for one already owning the id, found
none, and hit:

```js
return; // declared but its sender was pruned (no universes) — nothing to do
```

So **no sender was ever created** and the universe never transmitted. On playa:
boot titanic 0-patched → patch strands onto a declared universe → regenerate
model → hot-reload → **controller stays dark until a full engine restart.**
Exactly the review's diagnosis (`output_dispatch.js:203`), verified by reading
the boot partition + both underlying senders.

## Fix

`marsin_engine/lib/output_dispatch.js`:

- **Tagged senders.** Each sender item now carries `{ out, universes, host,
  protocol }`. `host === null` marks the single flat-destinations sACN default
  sender; per-controller senders match on `host` + `protocol`. This lets a
  universe appearing after boot find (or create) the correct sender.
- **`ensureFlatSender()` / `ensureControllerSender(host, protocol)`** — locate
  the target sender, creating it on demand (sACN unicast or Art-Net) and
  starting it if the dispatch is already running (`_started` flag, set in
  `start()`). The underlying `createSacnOutput` / `createArtnetOutput` already
  support post-start `addUniverse`, so a live-created sender streams
  immediately.
- **`routeInto(sender, id, isFlat)`** — idempotent add: guards on
  `sender.universes.has(id)`, calls the underlying `out.addUniverse`, and keeps
  `sacnDefaultUniverses` (the `_routing.flatUniverses` introspection) in step.
- **Rewrote `addUniverse(uid)`:**
  - undeclared → flat default sACN (unchanged legacy contract), creating the
    flat sender if the rig had none at boot;
  - declared → `ensureControllerSender(decl.host, decl.protocol)` (**the fix**
    — reuses the controller's boot sender or builds it now);
  - `decl.alsoFlat` → the universe ALSO joins the flat destinations (dual-send
    parity preserved).
- **`_routing.senderCount` / `flatUniverses` are now getters**, not
  construction-time snapshots, so introspection reflects runtime `addUniverse`.

Covers **both sACN and Art-Net** — they share this one send-set path.

### Universe removal (checked, no change needed)

Removal is owned by the engine, not the dispatch: `engine.js:1635–1665` zeroes
the router buffer, sends a 3× sACN stream-termination blackout via
`sacnOut.sendFrame` (which routes correctly to the owning controller sender
under the new tagging), then splices `universeIds` so future frames omit it.
The dispatch's sender `Set` retains the removed id (harmless), and `routeInto`
makes a later revival idempotent. Removal works naturally and the fix does not
disturb it — no dispatch-side change warranted.

## Tests added

`marsin_engine/tests/io/output_dispatch.test.js` — 7 new tests (default suite,
correct `io/` domain subdir, `.test.js` = default runner):

1. **G10 core, Art-Net wire proof:** boot with only undeclared U2 (→ flat);
   Art-Net controller for U4 declared but unpatched at boot (senderCount 1);
   `addUniverse(4)` → senderCount 2 → `sendFrame({4})` lands a **real ArtDMX
   datagram for U4** on an ephemeral loopback port. This is the exact failing
   playa scenario; it could not pass before the fix.
2. Declared **sACN** universe unpatched at boot → `addUniverse` creates a
   per-controller unicast sender; does not leak to the flat set.
3. **Reuse:** controller declaring U4+U5 with only U4 patched at boot →
   `addUniverse(5)` reuses the same Art-Net sender (no duplicate).
4. **alsoFlat** declared universe added live → reaches controller (Art-Net
   wire) **and** flat (dual-send).
5. Undeclared universe added live when the rig had **no flat sender** at boot →
   flat sender created.
6. **Idempotency:** repeat `addUniverse` calls add no senders and no duplicate
   flat entries.

## Auto-checks (`.agent/ops/marsin_engine_auto_checks.md`)

- `git diff --check -- marsin_engine`: **clean** (only LF→CRLF notices on
  pre-existing titanic model files, not mine).
- `node --check lib/output_dispatch.js` + test file: **pass**.
- `node engine.js --list`: **pass**.
- `node engine.js --pattern test_const --model test_bench --dry-run`: **pass**,
  no missing-blend warning.
- Default suite `node --test "tests/**/*.test.{js,mjs}"`: **2088 pass / 9 fail /
  0 skipped** (24/24 in `output_dispatch.test.js`, incl. all 7 new). The 9
  failures are pre-existing/environmental and unrelated — none import
  `output_dispatch`: 5 audio_capture, 1 osc_listener (`EADDRINUSE`), 2
  config_persistence_guard (CRLF-vs-LF byte diff on `config.yaml`, Windows
  line-endings), 1 effects_v2_mode_page_layout (**passes in isolation** —
  parallel-run interference).

No tracked `states/**` touched (unit tests only; no live engine spawned).

## Files changed

- `marsin_engine/lib/output_dispatch.js` — the fix.
- `marsin_engine/tests/io/output_dispatch.test.js` — 7 regression tests.

## Follow-ups

- **Not blocking G10.** titanic's engine `config.yaml` still declares only the
  sACN `Titanic-202` controller (no Art-Net) and titanic is 0%-patched
  (`titanic.js` stale). The fix is proven with unit-level wire tests; a live
  end-to-end playa rehearsal (patch a declared-but-unpatched universe in the
  sim → save → confirm hardware lights without restart) should be run once
  titanic is actually patched (premap slice).
- The dispatch's sender `Set`s are not pruned on universe removal (documented
  above as harmless). If a future audit wants exact introspection parity, prune
  the id from the owning sender's `Set` in the engine removal loop — cosmetic,
  not correctness.
