# 20260725_119 — WAVE 1 W1-4: sim save-server & controller-probe crash-proofing + save honesty

**Agent:** Opus (developer). **Wave:** operator-greenlit red-team fix campaign
("go", 2026-07-31), Wave 1 (dark-ship / crash-proofing). **Thread:** W1-4.
**Branch:** `feat/bm_readiness` (uncommitted; commit-gated on the operator — no
git ops performed).

**Files owned + edited (exclusively):**
- `simulation/server/save-server.js`
- `simulation/server/controller_probe_service.cjs`
- `simulation/tests/controller_probe_service.test.js` (added regression tests)
- `simulation/tests/save_server_hardening.test.js` (new tracked test file)

**Not touched** (other threads / out of scope): `marsin_engine/**` (W1-1/W1-3),
`simulation/start.js` + `launcher.js` (W1-2), `scenes/**`, `patterns/**`.

**Inputs:** `_111` synthesis (Family A + save-honesty), `_109` P1-1/P1-3, `_115`
L5.

---

## Summary

The `_109` P1-1 process-kill is **closed and now survived end-to-end**: the exact
malformed request that used to exit the whole save-server now answers a loud
`400` and the process keeps running and stays fully functional. Four fixes
landed, each with a `~/tmp` repro flipped into a green regression test in the
tracked sim suite.

**Suite delta:** baseline **1645 tests / 8 fail** → **1657 tests / 8 fail**.
`+12` new green tests, **zero new failures** (the 8 are the known pre-existing
baseline — byte-identical list, `scene_model_parity` / fixture-docking / CLI
parity rows).

---

## Fix 1 — `_109` P1-1 (Family A): a malformed probe killed the whole process

**Root cause.** `POST /controllers/probe` forwarded the body's `timeoutMs` with
only a `Number.isFinite` check (`save-server.js:806`). A negative value reached
`controller_probe_service.cjs`'s `tcpProbe`, where `socket.setTimeout(-1)`
(line 101) throws `ERR_OUT_OF_RANGE` **before** `socket.on('error', …)` (line
105) was registered. The throw escaped the Promise executor (route correctly
answered 500), but the socket was **already connecting with no `error`
listener**; when it settled (`ECONNREFUSED`/`ETIMEDOUT`/`ECONNRESET`) Node
emitted an unhandled `'error'` → `process.exit`. The save server owns scene
saves, `.scene_backups`, `/restore-backup`, the gamma routes and the probe — all
die at once; the rig stays lit (separate process) but the operator silently
loses the ability to save mid-show. A second, adjacent kill vector: a body of
`null` (`JSON.parse("null")` → `null`) made the `parsed.targets` read throw a
`TypeError` in the `req.on('end')` async callback — also unhandled → exit.

**Change.**
- **Route (save-server.js):** the probe endpoint now validates the body shape
  and timeout *before* dispatching. A non-object body (incl. `null`) → `400`; a
  bad `timeoutMs` → `400` (via the new `validateTimeoutMs`). The bad value can no
  longer reach the socket.
- **Probe service (`controller_probe_service.cjs`):** `tcpProbe` now registers
  `socket.on('error', …)` **before** any call that can throw, and wraps
  `socket.setTimeout` in a try/catch that turns a bad value into an honest
  `UNKNOWN` result instead of an escaping throw. New exported `validateTimeoutMs`
  (finite, `> 0`, `≤ 60 000 ms`) is the single source of truth for the rule.
- **Process backstop (save-server.js):** top-level `uncaughtException` /
  `unhandledRejection` handlers that log **NAMED** and `exit(1)` — deliberately
  *not* swallow-and-continue (codex "no fallback, fail loud"; after an uncaught
  throw the process may be half-corrupt). Supervision / auto-restart is W1-2's
  launcher watchdog; this net makes any *future* unforeseen throw loud and
  non-silent rather than a bare Node stack. The primary vector is fixed at the
  source, so this net is not what keeps the process alive under the P1-1 repro —
  the validated inputs + early error handler are.

**Repro now green.** `~/tmp/redteam_controller/04_probe_crash_repro.mjs` spawns
the real save-server on a random high port (test-only `SIM_SAVE_SERVER_PORT`)
pointed at a throwaway `~/tmp` root (`SIM_SAVE_SERVER_ROOT`), fires
`{targets:[{id,ip:"192.0.2.1",type:"DMX"}], timeoutMs:-1}`, and asserts after
each hostile body that the endpoint answered a 4xx **and the child is still
alive** (a follow-up sweep returns 200). All checks pass. Tracked equivalents:
`save_server_hardening.test.js` ("a negative timeoutMs is a 400, not a process
kill"; "still fully functional after the P1-1 attack"; the `null`-body case) and
`controller_probe_service.test.js` ("validateTimeoutMs rejects hostile values
loudly"; "a negative timeoutMs never becomes an unhandled socket error").

---

## Fix 2 — `_109` P1-3: idle timeout, not an absolute deadline

**Root cause.** The "1.2 s per-probe ceiling" was the socket / `http.request`
**idle** timeout, which resets on activity. A slow-drip host emitting one byte
per interval held a probe **10.4 s** in the red-team measurement, occupying a
pool slot and delaying `probeSweeping = false`, so one misbehaving host on `:80`
froze the status of the entire fleet.

**Change (`controller_probe_service.cjs`).** Added an **absolute per-probe
deadline** in both transports: `tcpProbe` and `httpGetJson` each arm a
`setTimeout(timeoutMs)` that fires no matter what and caps the probe's total
wall-clock, cleared on settle. Also added a `256 KB` response-size cap
(`MAX_RESPONSE_BYTES`) so a broken/hostile host cannot make us buffer an
unbounded body (`_109` P2-10: 48 MB absorbed whole) — past the cap the read
aborts and the host classifies as ONLINE-but-unrecognized (it answered), never a
silent OOM/hang.

**Repro now green.** `controller_probe_service.test.js`: "a slow-drip host is cut
off by the ABSOLUTE deadline, not held open" (a real HTTP server dribbling one
byte / 60 ms is capped near `timeoutMs=300`, asserted `< 1500 ms`, and reads
OFFLINE) and "an oversized response body is capped, not buffered whole" (a server
streaming past the cap resolves ONLINE-but-unrecognized).

---

## Fix 3 — `_115` L5 / Family F: save-honesty (a failed write must never report SAVED)

**Root cause / audit.** The save-server's write paths already caught synchronous
throws and answered 500, but several returned a **bare `Error`** (unnamed), and
the guarantee rested implicitly on `writeFileAtomic` / `snapshotBeforeWrite`
throwing. The requirement is that a failed disk write can *never* surface as a
`200` the CaptainPad/sim UI reads as SAVED.

**Change (`save-server.js`).** Every write path I own now returns a **named
non-200** on failure: `/save`, `/save-cameras`, `/save-pixel-map-views` and
`/save-stl` changed from `res.end('Error')` to `res.end('Error: ' + e.message)`
(the pattern the other endpoints already used). `writeFileAtomic` and
`snapshotBeforeWrite` throw on any real failure and land in these catch blocks,
so a disk-full / EBUSY / EISDIR / EEXIST write is a `500 Error: …`, never a
`200 Saved`.

**Repro now green.** `save_server_hardening.test.js`: "a save whose disk write
fails answers a NAMED 500, never a false 200 SAVED" — the temp root seeds a plain
**file** where the scene *directory* is expected, so `/save?scene=faildir` cannot
create the scene dir and the write fails for real (deterministic,
cross-platform); the test asserts `status === 500`, body matches `^Error: ` and
does **not** contain `Saved`.

> Note: the engine-side `200 {"saved":true}` variant of L5 is W1-1's; this thread
> owns only the save-server writes, all of which are now honest.

---

## Fix 4 — server-surface hardening (not-crashing + honest errors)

`_109` flagged the endpoint binds `0.0.0.0` with CORS `*`, `JSON.parse` ignores
`Content-Type`, and there is no auth — so anything on the show LAN or any page in
the operator's browser can reach it. Scope (per the brief) was **not-crashing +
honest errors**, not auth.

**Change (`save-server.js`, `/controllers/probe`).**
- **Body-size cap:** a `1 MB` ceiling (`PROBE_MAX_BODY_BYTES`); past it the
  request is answered `413` and destroyed rather than buffered unbounded.
- **Non-object body:** `null` / number / string / array → `400` (closes the
  `null`→TypeError kill vector from Fix 1).
- **Garbage body:** unchanged behaviour, confirmed — `400` with the parse error
  named.
- **Non-array `targets`:** `400`.

This mirrors how the engine's REST surface already behaved under attack (clean
400s, zero 500s on input, no unhandled rejections — `_108` "what held").

**Repro now green.** `save_server_hardening.test.js`: garbage body → 400;
non-array targets → 400; oversized body → 413 (or a connection reset, both are
"rejected loudly, did not buffer, did not crash"); "the server survives the whole
barrage".

---

## Testability hooks added (test-only, default to production)

To run the real save-server on a random high port against a throwaway tree
(never the operator's `:6970`, never real `scenes/`), two env overrides were
added to `save-server.js`, both **explicit config, not fallbacks** — when unset
the behaviour is byte-identical to before:
- `SIM_SAVE_SERVER_PORT` — bind port (validated as a real port or fails loudly).
- `SIM_SAVE_SERVER_ROOT` — root the scene/backup writes redirect under (wired via
  `scene_backup.deriveRoots`, passed explicitly to every `snapshotBeforeWrite` /
  `listBackups` / `restoreBackup` call so nothing quietly writes the default
  tree).

This also partially closes the `_115` P2-6 testability gap for the save-server
(the launcher-wide override remains W1-2's).

---

## Verification

- **Full sim suite:** `node --test "tests/*.test.js"` → **1657 tests, 1649 pass,
  8 fail**. The 8 are the known baseline (byte-identical to the pre-change run:
  `scene_model_parity` test_bench rows, fixture-docking, view-bit headroom,
  compression-threshold, the two parity-CLI rows, titanic-block-accept). **Zero
  new failures**; `+12` tests all green.
- **Repro:** `node ~/tmp/redteam_controller/04_probe_crash_repro.mjs` → all
  checks PASS; the process survives the P1-1 request and the whole hostile-body
  barrage.
- **Syntax:** `node --check` clean on both owned files.
- **Hygiene:** zero device HTTP (loopback `127.0.0.1` + RFC 5737 documentation
  `192.0.2.x` only — no `10.x` addresses in code or tests), zero sACN to
  hardware, operator ports `:6967` / `:6969`–`:6972` / `:6970` never contacted.
  `marsin_engine/config.yaml` CLEAN vs HEAD. No scene writes (all tests use
  `~/tmp` / OS-temp roots). No git ops.

---

## Handoffs / notes

- **W1-2 (launcher watchdog):** the process backstop here logs NAMED and exits
  rather than self-restarting — supervision/auto-restart is W1-2's; my honest
  exit is the precondition for it. The `SIM_SAVE_SERVER_PORT` hook is a model for
  the stack-wide port override P2-6 asks W1-2 for.
- **Left for later (out of this thread's fix scope, from `_109`):** the IP-key
  canonicalization family (P2-5/P2-6/P3-15/P3-16/P3-20), the DMX gap-claim merge
  question (P1-2, an operator decision), and `probeCache` unbounded growth
  (P3-19) — none are crash/save-honesty and all sit outside my two owned files.
- **Notion:** no Notion MCP tool in this session; file a `Backlog`→`Done` row for
  W1-4 pointing at this report when the connection is available.
