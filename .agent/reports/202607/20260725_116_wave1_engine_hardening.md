# _116 — Wave 1 (W1-1): engine HTTP/WS/timeline crash-proofing

**Thread:** W1-1 of the operator-greenlit red-team fix campaign (synthesis
`_111`; top tier 1 CRITICAL + 5 P0, all "dark ship"). **Scope owned:**
`marsin_engine/engine.js`, `marsin_engine/lib/api_server.js`,
`marsin_engine/lib/timeline/*.js` (+ `lib/autopilot_pick.js`, explicitly handed
to the I3 fix). Sim, pattern VM / wasm host / audio harness, scenes, patterns,
playlists untouched.

**Result:** 7 fixes landed, each with a red-team repro flipped into a GREEN
committed regression test. Full engine suite **2520 tests / 8 fail** — the 8 are
the known environmental baseline (audio-capture framing, OSC-listener lifecycle/
port-binding, mixer view-fader, pattern/scene playlist parity, effects layout);
**none import a module this thread changed, zero new failures**. Timeline family
**410/410** before and after. `marsin_engine/config.yaml` CLEAN vs HEAD. Every
spawned test engine black-holed via `MARSIN_CONFIG_FILE` (the `_97` §4.4 trap
avoided — no `--dest`-only), state/playlists/timeline redirected to temp,
random 7700–7899 ports; zero device HTTP, zero sACN to hardware; operator stack
(:6967, :6969–:6972) untouched.

---

## Fix 1 — CRITICAL (_108, Family A): a malformed WS frame kills the engine

**Root cause.** None of the four `/ws/*` `WebSocketServer`s (nor the `/` alias)
attached a per-CONNECTION `ws.on('error')`. The `ws` library emits `'error'` on
the **socket instance** for every protocol/frame violation (invalid-UTF-8 text,
reserved opcode, RSV1 with no extension, bad close code, oversize control frame).
An `EventEmitter` `'error'` with no listener THROWS → uncaughtException →
`process.exit` → dark ship, and `launcher.js` tore the stack down rather than
restarting. A WiFi-corrupted frame does it with zero malice; playa RF is hostile.
The per-topic `wss.on('error')` that already existed catches **server**-level
errors, not the **per-socket** ones.

**Change** (`api_server.js`, the manual upgrade router). Attach a classified
non-fatal `ws.on('error')` in the `handleUpgrade` callback **before** the
`connection` event fires — one point that covers all four topics AND the `/`
alias. `ws` closes the offending socket itself, so the engine + every other
client are unaffected; we log at WARN and return (the `_99` bridge shape).

**Test (repro→green):** `tests/e2e/ws_frame_crashproof.test.js` — drives a real
engine subprocess, fires 7 hostile frames (all five violation classes across
`/ws/control`, `/ws/params`, `/ws/signals`, `/ws/viz`, and the `/` alias), and
asserts the engine answers `/status` after **every** one, that the per-socket
handler logged, that the fatal process backstops were **not** tripped, and that a
normal `/ws/control` client still connects + replays afterward. Flipped from
`~/tmp/redteam_api/ws_crash.mjs`. **GREEN** (3.9 s).

## Fix 2 — Process backstops (_108/_109, Family A)

**Root cause.** No process-level `uncaughtException` / `unhandledRejection`
backstop, so any surviving throw/rejection anywhere killed the engine silently.

**Change** (`engine.js`, module scope). Registered both handlers. Design intent
"never die silently, never run half-alive": registering a handler SUPPRESSES
Node's default crash, so each handler MUST decide loudly and exit — a
log-and-return would leave the engine limping (the fallback the codex forbids).
Both log the full error with a NAMED reason and `exit(1)` (a clean non-75 exit is
what the W1-2 watchdog restarts, turning any surviving crash vector into a ~1 s
blink). Registered at module scope so a boot-time throw is caught + diagnosed too.
These are the LAST RESORT beneath Fix 1 — the WS CRITICAL never reaches them now.

**Proof:** the WS e2e asserts `ENGINE FATAL` is **absent** from engine stdout
across the frame storm — i.e. survivable per-socket errors are handled at the
socket, not escalated to the backstop. (A deliberate crash-to-verify-exit(1) was
not automated to avoid a self-killing test; the handler bodies are trivial and
inspected.)

## Fix 3 — J1 (_113, P0): `/timeline/overview` freezes the engine

**Root cause.** The `_95` day ribbon was built synchronously on the HTTP thread
in O(days × cues²): `buildDaySegments` re-ran `resolveDayTimes` per sample point,
each constructing `Intl.DateTimeFormat` per clock cue. Measured pre-fix: 512 cues
× 8 days = **296 s frozen** (render loop, sACN out, tick all share the thread).

**Change** (three in-lane edits):
1. `triggers.js` — cache `Intl.DateTimeFormat` per `(purpose, tz)` (`dayKeyFor`,
   `tzOffsetMinutes`). Construction was the dominant cost; `.format()` on a
   cached instance is cheap. ~100× alone per `_113`.
2. `resolve_deck_state.js` — `resolveDeckStateAt` accepts an optional injected
   `dayTimes`; `buildDaySegments` computes the day's `dayTimes` ONCE and injects
   it into every per-sample resolve (all samples of one day resolve the same cue/
   phase times). `hhmm` formatter cached per tz. Direct callers (/travel,
   /resolve, _catchUp) are unchanged (they omit `dayTimes`).
3. `timeline_service.js` + `api_server.js` — the ACTIVE-plan GET is MEMOISED
   (`TimelineService.getOverview`) keyed by plan-object identity + calendar-day
   bucket, so repeated day-zoom opens rebuild at most once per (plan, day). The
   POST path (arbitrary unsaved draft) calls the now-fast builder directly.

**Test:** `tests/timeline/overview_perf.test.js` — 500 cues × 8-day festival
builds in **~347 ms** (budget 15 s; ~850× under the pre-fix 296 s), and a
correctness invariant asserts the injected-`dayTimes` ribbon names the same
owner/cueId/playlist as an independent direct resolve at a sample instant.
**GREEN.**

## Fix 4 — J2/L3 (_113 + _115, P0, double-confirmed): corrupt state silently kills the timeline

**Root cause.** `loadTimelineState` validated ONLY the 5 party fields. A bad
`firedToday`/`moodArmed`/a top-level SCALAR document loaded CLEAN, then threw on
EVERY tick while `/timeline/state` reported `mode:armed, lastError:null` — a
silent dead ship. (`partyConfigOf` treats a scalar as `{}`, so a scalar passed.)

**Change** (`timeline_state.js`). Added `validateTimelineStateShape` covering the
ENTIRE persisted shape — the property-assigned maps (`firedToday`/`moodLastFire`/
`moodArmed`, including value types), numeric fields (`moodSince`/`lastFiredAtMs`),
string identifiers, booleans, the `mode` enum (`armed`|`overridden` — closes
`_113` P3), and object-or-null leases — plus an up-front reject of a non-object
document. On any corruption it THROWS `timeline state invalid (<file>): <field>
…`, exactly the party-field contract: the caller (`start()`) refuses to half-run
(consistent with the existing `party_config.test.js` assertion that a corrupt
state leaves `_tickHandle === null`). One loud error at load instead of a silent
night, and the API no longer lies (a timeline that refused to start is visibly
not healthy).

**Test:** `tests/timeline/timeline_state_validation.test.js` — asserts a scalar
`firedToday`, a numeric `moodArmed`, a bare-scalar document, a string `moodSince`,
a bad `mode` enum, and a bad map VALUE each throw naming file+field; a valid state
round-trips; a missing file loads the clean default; an older/partial file still
migrates. **GREEN.**

## Fix 5 — I3 (_112, P1): a non-compiling entry wedges the sequential autopilot

**Root cause.** An entry that EXISTS but won't COMPILE is not `_missing`, so the
pure picker treated it as usable, the autopilot loaded it, the compile threw, the
daemon logged + swallowed — and a failed load never advances `activeEntryId`, so
the sequential picker re-selected the same broken entry every beat, wedging the
deck forever (the live ChatGPT-authoring failure mode). Silent twin: duplicate
entry ids pinned the walk at cursor 0.

**Change:**
- `autopilot_pick.js` (pure) — `usable` now excludes `_broken` as well as
  `_missing`, and de-dupes duplicate ids (keeping the first, preserving order).
  Sequential walks the `usable` list, so a broken current entry can never trap
  the walk. Well-formed playlists behave identically.
- `api_server.js` — a `brokenAutoEntries` set + `annotateBrokenEntries` /
  `markAutoEntryBroken` helpers. All three advance sites (deck daemon, mixer
  `autoCycleTick`, `deckOverlayAutoCycleTick`) annotate the freshly-loaded
  playlist before picking and, on a DETERMINISTIC (compile/missing) load failure,
  flag the entry broken so the next pick skips it — surfacing WHICH entry is
  broken (loud, once). Transient failures (EBUSY) are never latched. A clean load
  of an entry clears its flag (operator fixes the pattern + re-selects). The
  compile-before-commit that loadPlaylistEntry already had means a throw never
  left the cursor on a half-loaded entry.

**Test:** `tests/timeline/autopilot_broken_entry.test.js` — the picker skips a
`_broken` entry, never traps on it, cycles the good entries, de-dupes duplicate
ids, returns null when all are broken, and is byte-behaviour-identical for a
well-formed playlist. **GREEN.**

## Fix 6 — L2 (_115, P1): a backward wall-clock step strands the party cue

**Root cause.** The mood dwell/cooldown gates compare `now` against absolute
epoch stamps (`moodSince`, `moodLastFire[id]`). The playa has no internet, so an
RTC drift / BIOS AC-restore boot can step the clock BACKWARD — after which those
stamps sit in the future, `now - stamp` goes negative, and the party cue never
fires again for the duration of the jump (forward/1970 boots self-heal;
backward-only wedges).

**Change** (`triggers.js`, top of `evaluateTick`). Clamp any stamp ahead of `now`
down to `now` (negative elapsed = "just happened" / re-derive): dwell restarts
cleanly, cooldown restarts cleanly, a backward step becomes a self-healing re-arm.

**Test:** `tests/timeline/clock_backstep_clamp.test.js` — future-dated stamps are
clamped to `now`; after the clamp the party cue self-heals and fires again (was
permanently stranded); a normal past stamp is untouched and still fires. **GREEN.**

## Fix 7 — L5 (_115, P1): a failed state write returns 200 {saved:true}

**Root cause / disposition.** The CaptainPad "✓ SAVED" badge reads the save
response, so a 200 `{saved:true}` on a disk-full/EBUSY write lies.
- **Timeline-state writes (in-lane, fixed + tested):** `saveTimelineState`
  (raw `writeFileSync`+`renameSync`) THROWS on failure and `_persistAndBroadcast`
  does NOT swallow, so a write failure propagates out of the service method and
  the endpoint returns a non-200 — honest by construction.
- **`POST /settings/save-now` (in-lane, hardened):** wrapped in try/catch → an
  honest 500 `{saved:false,error}` on any throw from the persistence path.
- **Remaining root (HANDOFF, out of lane):** `StateManager.save()`
  (`lib/state_manager.js`, shared engine core — NOT one of this thread's three
  exclusively-owned files) SWALLOWS the atomic-write error with only a
  `console.warn`, so the deck/mixer/globals branch of save-now can still succeed
  silently on a failed write. Its own `_writeFileAtomic` re-throws; the swallow
  is in the public `save()` wrapper. A follow-up should add a STRICT save path
  for the EXPLICIT operator save (keeping the ~80 auto-save triggers best-effort,
  so a transient disk blip never crashes the ship). Spawned as a background task.

**Test:** `tests/timeline/save_write_honesty.test.js` — `saveTimelineState`
throws when the write can't land; a persist failure PROPAGATES out of
`setPartyConfig` (i.e. the endpoint returns non-200, never `saved:true`). **GREEN.**

---

## Handoffs

- **W1-2 (launcher watchdog):** `/status` + `/timeline/state` already report
  HONEST health — a corrupt-state timeline now refuses to start (loud, tick
  never armed) rather than reading `armed` while dead (Fix 4); a clean non-75
  `exit(1)` from the process backstops (Fix 2) is your restart signal. No new
  hook needed from this thread.
- **W1-3 (pattern VM never-black):** the `/timeline/state` + `/status` surfaces
  are the intended home for a "never-black" health signal. W1-3's report did not
  land a function/return-shape by the time this thread completed, so the hook is
  left NAMED but unwired — wire `getRenderHealth`-style output into
  `getState()`'s `lastError`/a `renderHealth` field when W1-3 defines it.
- **L5 root (any wave that owns `lib/state_manager.js`):** the `save()` swallow
  above — spawned as a background task.

## Files

Source (owned): `marsin_engine/engine.js`, `marsin_engine/lib/api_server.js`,
`marsin_engine/lib/autopilot_pick.js`, `marsin_engine/lib/timeline/triggers.js`,
`marsin_engine/lib/timeline/resolve_deck_state.js`,
`marsin_engine/lib/timeline/timeline_state.js`,
`marsin_engine/lib/timeline/timeline_service.js`.
Tests (new): `tests/e2e/ws_frame_crashproof.test.js`,
`tests/timeline/clock_backstep_clamp.test.js`,
`tests/timeline/timeline_state_validation.test.js`,
`tests/timeline/autopilot_broken_entry.test.js`,
`tests/timeline/overview_perf.test.js`,
`tests/timeline/save_write_honesty.test.js`.
