# 20260805_167 — Fix: one unauthenticated GET no longer kills the engine

**Agent:** fix `_167` · **Branch:** `feat/bm_readiness` · **Scope:** operator-authorized
fix of the CRITICAL crash found by `_164` (§3 of
`.agent/reports/202608/20260805_164_engine_test_implementation.md`), plus the
same-shape audit `_164`/`_166` asked for. Production change is confined to
**`marsin_engine/lib/api_server.js`**; test change is confined to
**`marsin_engine/tests/e2e/pattern_dirs_crash_pin.test.js`**. No git ops, no ports
in 6966–6972 / 5568 / 8081 / 10000, no packets, no scene/pattern/playlist edits.

---

## 1. The bug

`GET /pattern-dirs/<invalid-slug>` killed the **entire engine process**. Original
code (`api_server.js`, the `/pattern-dirs/<dir>` route):

```js
try {
  const dir = decodeURIComponent(req.url.split('/')[2]);
  res.writeHead(200, { 'Content-Type': 'application/json' });        // (A) headers COMMITTED
  res.end(JSON.stringify(listPatternsInDir(patternsDir, dir)));      // (B) can throw
} catch (e) {
  res.writeHead(400); res.end(JSON.stringify({ error: e.message })); // (C) SECOND writeHead
}
```

`listPatternsInDir` **refuses** (throws `Invalid pattern directory: "<dir>"`) any slug
failing `VALID_PATTERN_DIR` = `/^[a-z0-9][a-z0-9_-]{0,63}$/` — a traversal probe
(`..%2F..`), an uppercase name (`Default`), anything with a dot or a space, anything
over 64 chars. That refusal is correct; the ordering was not. The throw at (B) landed
with headers already sent, so (C)'s second `writeHead` raised Node's
`ERR_HTTP_HEADERS_SENT` **from inside the catch handler**, where nothing could catch
it. It reached `engine.js`'s module-scope `process.on('uncaughtException')`, which —
correctly per its own design (no fallback masking, report `_116`) — logged
`ENGINE FATAL` and called `process.exit(1)`.

One request. No prior state. No authentication anywhere on the playa LAN
(`_157` D7). The rig goes dark and stays dark until someone restarts the engine.

## 2. The fix

Two halves, both in `api_server.js`.

**(a) Compute the body BEFORE committing headers** — the route-level correctness fix.
The refusal now happens while the response is still uncommitted, so it produces a
**loud, named 400** (P0: refuse the input, never a silent default):

```js
const dir = decodeURIComponent(req.url.split('/')[2]);
const body = JSON.stringify(listPatternsInDir(patternsDir, dir));   // may throw — nothing sent yet
res.writeHead(200, { 'Content-Type': 'application/json' });
res.end(body);
```

**(b) A shared error responder that cannot write headers twice** — new module-scope
export `sendJsonError(res, status, payload, headers)` (`api_server.js` ~line 393–427):

```js
export function sendJsonError(res, status, payload, headers) {
  if (res.headersSent) {
    console.error(`  ⛔ [api] handler threw AFTER response headers were sent — ` +
      `intended ${status} ${JSON.stringify(payload)}. Response truncated; ` +
      `engine kept alive (a second writeHead here would kill the process).`);
    if (!res.writableEnded) res.end();
    return;
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}
```

`headers` is passed straight through, so `sendJsonError(res, 400, x)` is byte-identical
to the bare `res.writeHead(400)` it replaces — no response-shape change on any path
that already worked. The `headersSent` branch **does not swallow**: it names the error
and the status it wanted on stderr, then closes the socket. The client sees a truncated
body (honest), and the show stays lit.

**No global net was added.** Per the scope note and P0 ("no fallback behaviors"), the
existing `process.on('uncaughtException')` in `engine.js` was left exactly as-is —
it is the deliberate last resort, and its own header comment already states the
doctrine ("the primary fix is at the source; this is the net beneath it", citing the
`_108` malformed-WS-frame precedent, which was likewise fixed per-connection with
`ws.on('error')`). **No `server.on('clientError')` handler exists and none was added** —
grep-verified; Node's default clientError behavior (400 + destroy) is already
non-fatal, and adding one would be an unrequested behavior change.

## 3. Same-shape audit across `api_server.js`

Method: a brace-matching scanner (scratch, `~/tmp/fix_167/scan_shape2.mjs`,
`scan_shape3.mjs`) over every `try {…} catch {…}` in the file, classifying by
(i) does the catch call `res.writeHead`, (ii) does the try commit headers on a
non-returning path, (iii) is a real **function call** evaluated after that commit.

| Tier | Count | Disposition |
|---|---|---|
| `try`/`catch` blocks whose catch calls `res.writeHead` | **97** | population |
| …of those, try never commits headers before a throwable (writeHead+`return`, or compute-first) | **56** | already correct |
| …of those, a **function call** runs after headers are committed (the exact crash shape) | **19** | **18 fixed**, 1 false positive |
| …of those, only **property reads** run after headers (tier-2, see below) | **23** | **not fixed** — see §3.3 |

### 3.1 Fixed — 18 blocks, 20 call sites

Current line numbers (the file is being edited concurrently by other agents this
session, so treat these as approximate and the route as authoritative):

| Line | Route | Call that could throw after headers | Extra fix |
|---|---|---|---|
| 4965 | `GET /pattern-dirs/<dir>` | `listPatternsInDir` | **compute-first** (the original bug) |
| 5319 | `POST /scene` | `setTimeout` / `engineCore.requestSceneSwitch` | replaced a nested try that **swallowed** the throw |
| 5370 | `POST /scene/reload` | same | replaced a swallowing nested try |
| 5760 | `PATCH /global-effect-slots` | `globalEffectSlotManager.getSlots` | compute-first |
| 6083 | `POST /global-effect-slots/<id>/<action>` | `globalEffectsController.getStatus` | compute-first |
| 6182 | `GET /party-config` | `timelineService.listAvailablePlaylists` | compute-first |
| 7158, 7160 | `GET /mixer/param-presets` | `paramPresetManager.listParamPresets` | compute-first (both catch arms) |
| 8180 | `PATCH /osc/config` | `Object.keys(next.bindings)` etc. | compute-first |
| 8547 | `POST /playlists` | `broadcastWs`, `playlistManager.list` | catch guard only |
| 8566 | `DELETE /playlists/<name>` | `broadcastWs`, `playlistManager.list` | catch guard only |
| 9036 | `POST /deck/overlays/<id>/playlist` | `broadcastChannelPlaylistData`, `broadcastDeckState` | catch guard only |
| 9059 | `POST /deck/overlays/<id>/playlist/entry` | `broadcastDeckState` | catch guard only |
| 9355 | `POST /deck/playlist` | `broadcastWs`, `broadcastMixerState` | catch guard only |
| 9524 | `POST /deck/playlist/capture` | `broadcastWs`, `broadcastMixerState` | catch guard only |
| 9944 | `POST /mixer/channels/<id>/playlist` | `broadcastChannelPlaylistData`, `broadcastMixerState` | catch guard only |
| 9972, 9974 | `POST /mixer/channels/<id>/playlist/entry` | `broadcastMixerState` | catch guard only (both arms, incl. EBUSY 409) |
| 10036 | `POST /mixer/channels/<id>/playlist/capture` | `broadcastWs`, `broadcastMixerState` | catch guard only |
| 10084 | `POST /mixer/channels/<id>/playlist/discard` | `broadcastMixerState` | catch guard only |

Two sub-shapes, deliberately treated differently:

- **Compute-then-commit** (8 routes above, plus the bug). The post-header call is
  *pure body computation*. Hoisting it above `writeHead` is behaviour-identical on
  success and converts a would-be process kill into a proper 4xx/5xx. Notably
  `GET /mixer/param-presets` carried a comment saying a corrupt preset file
  "surfaces here … fail loud" — it did not fail loud, it killed the engine.
- **Respond-then-broadcast** (the playlist/deck/mixer routes). These deliberately
  answer the client first and fire WS broadcasts afterwards; reordering would change
  intended ordering semantics, so **only the catch arm was guarded**. A throw from a
  broadcast now logs loudly with the socket closed instead of exiting the process.

### 3.2 Examined and NOT fixed — 1 false positive

`/scheduled-tasks/<id>` outer `try` (~6121–6151): the scanner flags `writeHead` at
6126, but that line lives inside the **async** `readBody(data => …)` callback, which
cannot run before the outer `try/catch` has already returned. Every other branch of
that block computes before `writeHead`. Not reachable; left untouched.

### 3.3 Tier-2, listed not fixed — 23 blocks

Same skeleton, but the only thing evaluated after `writeHead` is
`JSON.stringify` over **already-resolved values** (e.g.
`res.end(JSON.stringify({ status:'ok', mode: result.mode }))`). Throwing requires a
service to return `undefined` where the route expects an object — an internal-invariant
break, not attacker-controllable and not reachable by malformed input. Fixing them
would mean converting every remaining `catch { res.writeHead(…) }` in the file, which
is the refactor the scope explicitly excluded. Scanner output is reproducible with
`node ~/tmp/fix_167/scan_shape2.mjs marsin_engine/lib/api_server.js`. Two of these
(`PUT /pattern` ~5119, `POST /pattern` path) additionally carry their own nested
try/catch around the error response, so they were already non-fatal.

**Recommendation for a follow-up slice (not done here):** convert the remaining 23
catch arms to `sendJsonError` mechanically, which would make the double-`writeHead`
process-kill class structurally impossible in this file.

## 4. Test evidence

`tests/e2e/pattern_dirs_crash_pin.test.js` was **flipped** from pinning the crash to
asserting the fix, exactly as its own header (and `_166`'s addendum) instructed. It
keeps its isolated spawn/teardown so a future regression stays contained. Filename kept
so `_164`/`_166`'s references still resolve; the header now carries the crash as
history plus the fix.

Contents: 10 hostile-slug cases (traversal `..%2F..`, fully-encoded traversal
`%2e%2e%2f%2e%2e`, uppercase `Default`, embedded space, embedded dot, leading `_`,
leading `-`, 65-char overlength, malformed escape `%ZZ`, encoded NUL `%00`) each
asserting **400 + a named reason** (`Invalid pattern directory` or `URI malformed`)
**and** `proc.exitCode === null` **and** a live `GET /status`; a happy-path test
(`/pattern-dirs` lists `default`; `/pattern-dirs/default` returns a non-empty array
with `content-type: application/json`); an end-of-sweep liveness test; and 4 pure unit
tests driving `sendJsonError` directly against a fake response — including the branch
where `writeHead` would throw, proving the responder does not.

| Run | Result |
|---|---|
| `tests/e2e/pattern_dirs_crash_pin.test.js` isolated | **16 / 16 pass** |
| `tests/e2e/http_malformed_sweep.test.js` (G-5) isolated | **36 / 36 pass** |
| Full engine suite (`npm test`) | **2789 tests / 2782 pass / 7 fail** — failing LIST byte-matches the documented baseline, **zero new failures** (see §6) |
| `python scripts/security_check.py --all` | **6 findings** — matches the documented baseline exactly (all in gitignored `simulation/.scene_backups/studiodj/**`); `_164`'s 7th, the MAC in `_163`'s report, has since been redacted. **Zero findings in any file this session touched.** |

## 5. Operator note — the live engine

This fix applies at the operator's **next engine restart**. The currently-running
engine on the operator's box still has the crashing route loaded in memory; until it
is restarted, `GET /pattern-dirs/<invalid-slug>` against **that** process still kills
it. Nothing in this session touched the operator's live engine.

## 6. Counts and residue

**Full engine suite: 2789 tests / 2782 pass / 7 fail.** The failing LIST — the stable
quantity, not the total — byte-matches the documented baseline: 5x
`tests/audio/audio_capture.test.js` (no pinned mic device on this Windows box), 1x
`tests/effects/effects_v2_mode_page_layout.test.js` (file-level IPC deserialize crash,
pre-existing), 1x `tests/io/osc_listener.test.js` "EADDRINUSE" (gets `EACCES` on this
box). **Zero new failures.** `tests/mixer/performance_mode.test.js` passed in this run
(it is the known contention-flaky file). The total rose from `_164`'s 2772 because this
session's rewritten pin file went 1 → 16 tests and concurrent agents added their own.

**Concurrency disclosure:** `marsin_engine/lib/api_server.js` was being edited by at
least two other agents during this session (a `/shutdown` route from the `_169` slice,
and an `outputRouting` change from the bench-mirror work). Their hunks are present in
the working tree alongside mine and were **not** reverted or modified. The full-suite
run below therefore measures the combined tree, not this session's change in isolation;
the two isolated runs in §4 are the clean evidence for this fix.

Running the engine suite spawns real engines against the tracked
`marsin_engine/states/**` and `simulation/scenes/*/playlists/default.yaml` —
documented-expected residue per AGENTS.md, reported not reverted.

## 7. Files

- **Changed (production):** `marsin_engine/lib/api_server.js` — 1 new exported helper,
  1 route reordered + 7 more compute-first reorders, 18 catch arms guarded.
- **Changed (test):** `marsin_engine/tests/e2e/pattern_dirs_crash_pin.test.js` —
  rewritten from crash-pin to regression guard (1 test → 16).
- **Scratch (gitignored, not in the tree):** `~/tmp/fix_167/scan_shape*.mjs`.
