# `_115` — RED TEAM: the "never stuck" story across process boundaries

**Operator order (2026-07-31):** "adversarial test the system to break it in the
name of bulletproofing and finding quirks." Surface assigned: **the P0 "never
stuck"** — kill things at the worst instants, corrupt what each component
persists, squeeze resources, diverge the components' beliefs, and abuse the
launcher.

**Filed as `_115`** (originally drafted as `_114`; renumbered by the coordinator after a same-number collision with the CaptainPad red-team; originally targeted `_109`) — a sibling thread took
`20260725_109_redteam_controllers.md` while this one was running (brief said
`_109`; re-read on mismatch, next free number used). A second sibling landed
`20260725_114_redteam_captainpad.md` minutes later; distinct slugs at one number
are already the convention here (`_107_redteam_captainpad` / `_107_redteam_fixtures`),
so both stand.

**HYGIENE.** Report-only. **Zero source edits, zero suite edits, zero scene
writes, zero git ops beyond reads.** Every artifact lives under
`~/tmp/redteam_chaos/` (`repro/` harnesses, `evidence/` logs+JSON, `rig/` the
private sim copy). Isolation is documented in §7, and §8 proves the operator's
stack came out byte-identical.

---

## 1 · Findings table

| # | Sev | Finding | Root cause (file:line) | Evidence |
|---|---|---|---|---|
| **P0-1** | P0 | **`start.js` is blind to the death of every server it owns, nothing restarts them, and every health surface reports GREEN.** kill -9 on the save server, the sACN INPUT bridge and the sACN OUTPUT bridge — all three — leaves `start.js` alive, logging one line each and continuing forever. The launcher supervises `start.js`, not its children, so no crash is detected, no teardown fires, the show-server supervisor's `restart_count` never moves, `deploy.py verify` passes, and `launcher.js status` prints ✅ because it only probes `:6969` and `:6968`. **The rig is dark and needs a human who happens to look at the lights.** | `simulation/start.js:86-94` (child `exit` handlers only `console.log`); `launcher.js:1051-1057` (one `startChild('sim', …)` + **one-shot** `waitForTcp` probes); `launcher.js:928-931` (`cmdStatus` checks sim-http + engine only) | `evidence/t03_start_js.log`, `repro/t03_sim_supervision.sh` |
| **P1-1** | P1 | **A backward wall-clock step permanently strands the party cue.** With the music loud and the mood key hot, a crash + restart resumes the party in **1.2 s** (correct). Do the same restart after the clock steps **back 6 h or 1 day** and the party cue **never fires again** — 30 s of `currentMood: party` with the deck sitting on `ambient`. `now - moodLastFire` is negative, so the cooldown gate is satisfied for the whole duration of the jump; `now - moodSince` likewise kills the dwell gate. Both stamps are **persisted absolute epoch ms** with no clock-sanity clamp. `/timeline/state` reports `mode: armed`, `planActive: true`, `lastError: null` throughout. Playa-real: no internet, RTC drift, BIOS AC-restore boots, any manual/GPS correction. | `marsin_engine/lib/timeline/triggers.js:306` (`dwellOk = now - next.moodSince >= …`) and `:308-309` (`cooldownOk = … now - last >= cooldownSec*1000`) — neither guards `last > now` | `evidence/t09_party_recovery.json`, `repro/t09_party_recovery.mjs` |
| **P1-2** | P1 | **A corrupt/torn `timeline_state.yaml` kills the timeline dead while the API says it is armed.** `loadTimelineState` correctly throws; `api_server.js` catches it into a single `console.error` and the engine boots "fine". `GET /timeline/state` → **200** with `mode: "armed"`, `activePlan: "rt_plan"`, `engineConnected: true`, **`lastError: null`**, `planWarnings: []`. No cue will ever fire. The `.catch()`'s own comment claims `start()` "records boot errors into the timelineState" — it does not. Only `planActive: false` + empty `cues[]` hint at it, and stdout on the show server goes to a log nobody reads. | `marsin_engine/lib/api_server.js:10400-10409` (catch logs, never sets `lastError`, contradicting its own comment at `:10398`) | `evidence/` (t02b output, quoted §3), `repro/t02_timeline_corrupt.mjs`, `repro/t02b.mjs` |
| **P1-3** | P1 | **Every corrupt engine state file silently resets the operator's saved show to factory defaults** (NO-FALLBACK is law). 20/20 corruption variants across `deck/mixer/globals/timeline_state.yaml` booted "successfully"; 10 lost real saved state. Zero-byte and half-truncated files (the classic torn-write shapes) are the **quietest** — `yaml.load(text) || defaultState` treats them as "no file". Worse, a file that parses to a **scalar** is truthy and becomes the state object: `globals_state.yaml = "just a string"` boots with `GET /globals.blackout === undefined`, and `timeline_state.yaml = "nonsense"` boots with `mode: undefined` and `planActive: true` — a running timeline over a string. | `marsin_engine/lib/state_manager.js:109-119` (`load()` — `catch → console.warn → return defaultState`, plus the `|| defaultState` truthiness hole) | `evidence/t01_corrupt_state.json` |
| **P1-4** | P1 | **A state write that fails returns `200 {"status":"ok","saved":true}`.** Deny write on the state dir (disk full / read-only media): `POST /settings/save-now` → `saved: true`, in-memory `master: 0.99`, **nothing on disk**. Hold an OS handle on `mixer_state.yaml` (Windows EBUSY class — OneDrive, AV, a backup agent, a second engine): same `saved: true`, disk still reads `master: 0.22` while the engine believes `0.88`. The engine *does* warn on stdout, but the API — the surface CaptainPad's green "✓ SAVED" badge reads — lies. Next restart silently reverts the show. | `marsin_engine/lib/state_manager.js:121-128` (`save()` swallows the throw into `console.warn`; the caller cannot know) | `repro/t11_disk_ebusy.mjs` output §5 |
| **P1-5** | P1 | **`-f` force-takeover kills the running stack BEFORE validating the arguments.** `assertSingleInstance(force)` (which force-kills the live launcher + its whole child tree and waits for the PID to die) runs at `launcher.js:1001`; `validate()` runs at `:1002`. Proven with the non-destructive half: a stale lock is **deleted** and only then does the scene typo fail. So `node launcher.js prod -f --scene titanicc` on the playa takes the show down and then exits 2 having started nothing. | `launcher.js:1001` before `:1002`; kill path `:369-378` | shell transcript §4 (lock destroyed before validation, operator ports untouched) |
| **P2-1** | P2 | **IPv4/IPv6 port shadowing defeats the launcher's free-port gate and its readiness probe.** On this Windows box a `0.0.0.0:P` listener and a `:::P` listener coexist. `checkPortFree` calls `probe.listen(port)` with **no host** (binds `::`) → **reports FREE** while an IPv4-only process squats the port. The sim server then also binds `::`, prints "Save server listening on 7670", and **every IPv4 client — `127.0.0.1`, `localhost`, and every LAN client on `10.1.1.x` — reaches the squatter instead.** `waitForTcp` probes `tcp://127.0.0.1:<port>`, i.e. it connects to the *squatter* and reports ✅. Today only the netstat-based `killStaleListeners` catches this — and that is skipped entirely under `--no-kill`. | `launcher.js:465-475` (`checkPortFree`, `probe.listen(port)`); `launcher.js:884-886` (`waitForTcp` → 127.0.0.1); sim servers bind default (`save-server.js:830`) | shell transcript §4 (two owners on 7670; `curl 127.0.0.1` → `IMPOSTOR!`; bare `listen(port)` → "REPORTS FREE") |
| **P2-2** | P2 | **"The engine never came up" is announced to nobody.** The bridge's engine-poll warning is edge-triggered off `engineState.reachable`, which is **initialised to `false`** — so an unchanged `false` signature short-circuits and neither logs nor broadcasts. Flapping is reported beautifully (verified, §3); a cold boot where the engine never starts is **total silence** on stdout and on the sim UI. That is precisely the shape a corrupt-state or crashed engine leaves behind. | `simulation/server/sacn_bridge.js:195` (initialiser) + `:676-678` (signature short-circuit) | `evidence/t06_divergence.log` PHASE 1 |
| **P2-3** | P2 | **`launcher.js status` and `stop` refuse to run on the exact corrupt lock that `start` was taught to recover from (`_99`).** Whitespace-only and truncated-JSON locks → `❌ Corrupt lock file … Inspect/delete it and retry`, exit 1, **lock left in place**. The `ELOCKCORRUPT` recovery added in `_99` lives only in `assertSingleInstance`; `readLock()`'s throw is uncaught in both subcommands — the two commands an operator reaches for after a power cut. | `launcher.js:291-305` (`readLock` throws) vs `:342-361` (recovery, start path only); `:922` `cmdStatus`, `:948` `cmdStop` | `repro/t07_launcher_lock.sh` (11 lock shapes) |
| **P2-4** | P2 | **A zero-byte `patches.yaml` produces zero relay routes, silently.** A *malformed* `patches.yaml` is handled beautifully — named file, YAML excerpt, line/column (`Could not read test_bench/patches.yaml: …`). A **zero-byte** one (same torn-write class) emits **nothing at all**, and the bridge boots with no `Route created` lines: a bridge that relays nothing while reporting itself up. | `simulation/server/sacn_bridge.js` patch loader (empty parses to `null`, treated as "no patches" rather than "broken file") | `evidence/t10_bridge_empty_patches.log` vs `t10_bridge_corrupt_patches.log` |
| **P2-5** | P2 | **Single-instance TOCTOU (ANALYSIS, not executed).** `assertSingleInstance` unlinks the lock at `:383`; `writeLock` runs at `:1032`. Between them sit `killStaleListeners` (a `Get-CimInstance` per PID) and `assertPortsFree` (up to **5 s of retry per port**, 6-7 ports) — a multi-second window with **no lock on disk**. Two launchers started inside it both pass single-instance, both force-claim, and the second kills the first's children. Live-relevant: the show-server supervisor relaunches every 10 s. Not executed — see P2-6. | `launcher.js:383` vs `:1032` | code read |
| **P2-6** | P2 | **TESTABILITY: nothing in the sim stack or the launcher accepts a port override, so a second constellation cannot exist.** `load_ports.cjs` is fail-loud and correct, but the ONLY input is `simulation/config.yaml` — no env, no CLI, in `start.js`, `save-server.js:51`, `sacn_bridge.js:31`, `sacn_output_bridge.js:31`, and `launcher.js` (`SIM_CONFIG_PATH`). The audio companion's `:6966` is **hardcoded in the launcher's `COMPANIONS` registry**. Consequence: `launcher.js` profile behaviour (double-launch, launch-during-shutdown, prod force-claim, P2-5) **cannot be tested except by seizing the operator's live ports** — which is why those three lines say ANALYSIS. Contrast the engine, which has `MARSIN_CONFIG_FILE` + `--port` and was fully exercised. | `simulation/lib/load_ports.cjs` (single arg, never overridden); `launcher.js:136-144` | this thread's whole isolation strategy (§7) |
| **P3-1** | P3 | **Orphaned `.tmp` files accumulate in the TRACKED states tree.** kill -9 mid-save leaves `.mixer_state.yaml.<pid>.<n>.tmp`; nothing sweeps them at boot, and `.gitignore` does not cover them (`git check-ignore` → not ignored), so each crash adds an untracked file to `git status` in `marsin_engine/states/<scene>/`. | `marsin_engine/lib/state_manager.js:158-185` (no boot sweep); `.gitignore` (`*.tmp-*` only) | `evidence/t05_kill_matrix.json` → `mid_save.tmpResidue` |
| **P3-2** | P3 | **`saveTimelineState` is weaker than every other state write**: no `fsync` before the rename (the exact power-loss hole `state_manager._writeFileAtomic:170-172` documents and closes), and a **fixed** `${filePath}.tmp` name instead of the pid+counter scheme. | `marsin_engine/lib/timeline/timeline_state.js:238-245` | code read |
| **P3-3** | P3 | **`assertSacnUdpAvailable` swallows every inspection error and continues.** `catch { return null }` → `Could not inspect UDP :5568 — continuing.` An `lsof`/`netstat` failure is indistinguishable from a real error, and the launcher proceeds into a boot where the port may be squatted by something that "silently swallows all sACN and darks the rig" (its own comment). | `launcher.js:507-516` | code read |

**Counts — P0: 1 · P1: 5 · P2: 6 · P3: 3 (15 total).**

---

## 2 · RECOVERY MATRIX — component × kill-instant

`kill -9` (SIGKILL) in every row. "Auto?" = does it come back **without a human**.
Cold-boot times are the engine's own `/status`-ready latency measured across the
kill, on a warm box.

### 2a · marsin_engine (real process, black-holed, own port)

| Kill instant | Comes back? | Cost | What the rebooted engine believes | Verdict |
|---|---|---|---|---|
| mid-frame (40 fps steady state) | yes, on restart | 327 ms | `master` = the value set before the kill | **CLEAN** |
| mid-save (`POST /settings/save-now`) | yes | 335 ms | value intact; **leaks a `.tmp` in the tracked states dir** | **CLEAN + litter** (P3-1) |
| dirty-but-unsaved (PATCH then instant kill) | yes | 334 ms | change survived — writes are synchronous | **CLEAN** |
| mid plan hot-reload (`POST /timeline/plans`) | yes | 353 ms | plan file present, parses, timeline armed, 3 cues | **CLEAN** |
| mid-zoom (PERFORM takeover live) | yes | 329 ms | `zoom: null`, `mode: armed`, `controller: autopilot` | **CLEAN — by design** (`_100` F1 confirmed independently) |
| mid-party, music never stops | yes | 470 ms + **1.2 s** to re-enter party | deck back on `party_high` | **CLEAN** |
| **mid-party + clock stepped back 6 h** | boots | 1.2 s → **never** | `mood: party`, deck stuck on `ambient`, `lastError: null` | **COMES BACK WRONG — STUCK** (P1-1) |
| **mid-party + clock stepped back 1 day** | boots | **never** | same | **COMES BACK WRONG — STUCK** (P1-1) |
| mid-party + dead-RTC (all stamps → 1970) | yes | 1.0 s | party resumed | **CLEAN** (asymmetry confirms P1-1 is *backward*-only) |
| mid `POST /scene/reload` | yes | 330 ms | `modelStale: false`, `renderHealth.ok: true` | **CLEAN** |
| mid snapshot write | yes | 340 ms | `snapshots/chaos.yaml` complete | **CLEAN** |
| boot on corrupt `timeline_state.yaml` | boots | — | **timeline DEAD, API says `armed` / `lastError: null`** | **COMES BACK WRONG, SILENT** (P1-2) |
| boot on corrupt `deck/mixer/globals_state.yaml` | boots | — | **saved show silently reset to defaults** | **COMES BACK WRONG, SILENT** (P1-3) |
| boot on unwritable / locked state dir | boots | — | runs fine, **`saved: true` for writes that never landed** | **LIES** (P1-4) |

**"Auto?" for every engine row is NO on the operator's laptop** — the launcher
does not restart a crashed child, it tears the whole stack down (`launcher.js:623-643`
→ `teardown(1)`). On the show server `deploy/boot_server.ps1`'s supervisor
relaunches the launcher after `RestartDelaySeconds = 10`, so a single engine
crash costs roughly **15-25 s of full blackout** (up to 8 s teardown grace per
child + 10 s delay + relaunch), not 0.3 s.

### 2b · simulation servers (real processes, private ports)

| Killed | `start.js` notices? | Auto-restart? | Launcher / supervisor / `status` see it? | Verdict |
|---|---|---|---|---|
| `save-server.js` | logs one line, stays alive | **NO** | **NO — all GREEN** | **NEEDS A HUMAN, INVISIBLE** (P0-1) |
| `sacn_bridge.js` (sACN IN) | logs one line, stays alive | **NO** | **NO — all GREEN** | **NEEDS A HUMAN, INVISIBLE** (P0-1) |
| `sacn_output_bridge.js` (sACN OUT → the rig) | logs one line, stays alive | **NO** | **NO — all GREEN** | **NEEDS A HUMAN, INVISIBLE** (P0-1) |
| `http-server` (:6969) | logs one line, stays alive | **NO** | `status` ❌ sim, launcher blind | needs a human, at least visible to `status` |
| `start.js` itself | n/a | **NO** — launcher tears the WHOLE stack down | yes | whole-stack blackout; supervisor recovers on the show server only |

### 2c · launcher.js

| Instant | Behaviour | Verdict |
|---|---|---|
| any child exits unexpectedly | `teardown(1)` — **stops everything, restarts nothing** | by design; ONLY the show-server supervisor recovers |
| launcher SIGKILL / `taskkill /F` | `process.on('exit')` never runs → children orphaned; `cmdStop` reaps them from the lock | handled (ANALYSIS) |
| corrupt lock, `prod` | deletes it loudly, continues (`_99` fix) | **CLEAN** |
| corrupt lock, `status` / `stop` | **refuse, exit 1, lock left behind** | **NEEDS A HUMAN** (P2-3) |
| stale lock + bad args | lock destroyed, then exit 2 | (P1-5) |
| double-launch inside the lock window | ANALYSIS only — untestable (P2-6) | (P2-5) |

---

## 3 · What HELD UP (worth as much as the breakage)

- **`StateManager._writeFileAtomic` is genuinely crash-safe.** 8 kill-9 instants,
  including inside a save and inside a snapshot write: **not one torn or
  half-written state file**. tmp + `fsync` + same-dir rename does exactly what
  its comment claims.
- **Engine cold boot is ~330 ms.** The recovery *mechanism* is fast; everything
  slow is supervision policy, not the engine.
- **Runtime-only timeline state really is runtime-only.** `zoom`, `activeProgram`,
  `pendingProgram`, `operatorLease` are all scrubbed on boot after a SIGKILL —
  independently reproduced, matching `_100` F1 / `_104` A2.
- **Party recovery works when the clock behaves**: crash mid-party with the music
  still loud → back on `party_high` in **1.2 s**.
- **`loadTimelineState` fails loud and names the field.** `partyEnabled: "no"` →
  `timeline state invalid (<abs path>): timeline state partyEnabled must be a
  boolean, got "no"`. Exactly the D11 behaviour it advertises. The bug is
  downstream (P1-2), not here.
- **The sACN bridge is unbreakable by engine flapping.** 4 engine deaths and
  revivals underneath it: bridge never died, WS client never dropped, and the
  reachable/unreachable transitions are **edge-triggered, named, and broadcast to
  the UI** (`broadcastLog`) — no per-poll spam, no stacked polls
  (`_enginePollBusy`). The only gap is the cold-boot baseline (P2-2).
- **`load_ports.cjs` is a model fail-loud reader.** `http_port: "not a number"` →
  `[config] 'http_port' missing or not an integer in <abs path> — refusing to
  guess a port. Fix simulation/config.yaml.` Bridge exits 1. No guessing.
- **Malformed `patches.yaml` diagnostics are excellent** — file named three
  times, plus the YAML excerpt with line/column.
- **`MARSIN_CONFIG_FILE` / `MARSIN_STATE_DIR` / `MARSIN_PLAYLISTS_DIR` /
  `MARSIN_TIMELINE_DIR` held perfectly.** ~60 engine boots, dozens of writes,
  every one landed in temp. `marsin_engine/config.yaml`, `states/**`,
  `scenes/**/playlists`, `scenes/**/timeline` all clean vs HEAD afterwards.
- **`launcher.js stop` handles PID reuse correctly** — it re-checks each recorded
  child's command line before killing it (verified against fabricated locks with
  dead and bogus PIDs).

---

## 4 · Key transcripts

**P1-2 — the dead timeline that says it is armed** (corrupt `timeline_state.yaml`,
engine rebooted on it):

```
GET /timeline/state -> 200
  "mode": "armed",  "activePlan": "rt_plan",  "planActive": false,
  "engineConnected": true,  "waiting": true,
  "cues": [],  "planWarnings": [],  "lastError": null      <-- null
stdout (the ONLY truthful surface, once, at boot):
  ⛔ TIMELINE DID NOT START — the show plan/state is not running:
     timeline state parse failed (<path>): end of the stream ... (1:9)
GET /status  ->  no `timeline` key at all
```

**P1-1 — the stranded party**:

```
crash_mid_party       entered=true RESUMED after 1.2s
   trace: party/ambient/null -> party/party_high/true
crash_clock_back_6h   entered=true NEVER RESUMED (30 s of loud music, rig on ambient)
   trace: party/ambient/null
crash_clock_back_1d   entered=true NEVER RESUMED (30 s of loud music, rig on ambient)
crash_epoch_zero      entered=true RESUMED after 1.0s
```

**P2-1 — port shadowing**:

```
squatter bound 0.0.0.0:7670
Save server listening on 7670                 <-- both believe they own it
LocalAddress OwningProcess
::                   50888                    (save server)
0.0.0.0              64700                    (squatter)
curl http://127.0.0.1:7670/scenes  ->  IMPOSTOR!
curl http://[::1]:7670/scenes      ->  (save server)
# with ONLY the IPv4 squatter present, the launcher's own probe:
node -e "net.createServer().listen(7670)"  ->  *** checkPortFree REPORTS FREE ***
```

**P1-5 — lock destroyed before validation**:

```
[launcher] Removing stale lock from dead launcher pid 999991 (<fakehome lock>).
  ❌ Scene 'definitely_not_a_scene' not found: ...
lock after: *** DELETED ***
operator ports 6969/6970/6971/6972: unchanged
```

**P1-4 — the save that lied**:

```
A. UNWRITABLE STATE DIR: boot=OK  PATCH=200  save-now=200 {"saved":true}  master=0.99
   engine warned on stdout? true      ** but the API reports saved:true **
B. LOCKED STATE FILE:    save-now=200 {"saved":true}
   on-disk first line: master: 0.22   (engine believes 0.88)
```

---

## 5 · Suggested fixes (NOT applied — report-only)

1. **P0-1** — make `start.js` a real supervisor (restart a dead child with
   backoff, or exit so the launcher's existing crash path fires), **and** teach
   `cmdStatus` + the launcher's readiness probes to keep checking `save_port`,
   `sacn_port`, `sacn_output_port`. Either half alone leaves the blackout
   invisible.
2. **P1-1** — clamp the persisted stamps: `if (last > now) last = now` (same for
   `moodSince`) in `triggers.js`, and log the clock step once. A one-line guard
   in two places.
3. **P1-2** — the `.catch()` at `api_server.js:10407` should set
   `timelineService.lastError` (and a `timelineDown: true`) so
   `/timeline/state` tells the truth its own comment promises.
4. **P1-3** — `StateManager.load` should distinguish *missing* (default is
   correct) from *present-but-unreadable* (P0: refuse, or quarantine to
   `<name>.corrupt-<ts>` and surface it on `/status`), and reject non-object
   parses instead of returning them.
5. **P1-4** — `save()` must propagate the failure; `/settings/save-now` should
   return the real result, and the CaptainPad SAVED badge should follow it.
6. **P1-5** — move `validate()` above `assertSingleInstance()`.
7. **P2-1** — `checkPortFree` should probe **both** `0.0.0.0` and `::`.
8. **P2-6** — an env override for the sim port map (`BM26_SIM_CONFIG`, same
   fail-loud contract as `MARSIN_CONFIG_FILE`) would make the launcher and the
   sim servers testable at all. Right now they are the only untestable
   subsystem, and P2-5 is unverifiable because of it.

---

## 6 · Follow-ups filed

**BLOCKED — the Notion MCP connection is not available in this session.** No
Notion tool is exposed at all (not a 404 on the board — the server is absent),
so per `.agent/os/task_tracking.md` the card was **not** filed and **no task
file was created in the repo**.

The one card to create, once the connection is enabled (Sina):

- **Name:** `Red team _115: never-stuck recovery gaps (P0 sim supervision, P1 clock-jump party stranding)`
- **Status:** `Backlog` · **Priority:** `High` · **Type:** `Bug`
- **Source:** `.agent/reports/202607/20260725_115_redteam_chaos.md`
- **Location:** `simulation/start.js:86-94`, `launcher.js:1051-1057`,
  `launcher.js:928-931`, `marsin_engine/lib/timeline/triggers.js:306,308`
- **Description:** kill -9 on any of the three servers `start.js` owns leaves the
  rig dark with every health surface reporting GREEN and nothing restarting them;
  and a backward wall-clock step permanently strands the party cue (negative
  elapsed defeats the dwell/cooldown gates) with `lastError: null`.
- **Why it matters:** both break the mission's "NEVER STUCK" P0 at night, on the
  playa, with no internet and no signal to the operator.

---

## 7 · Isolation (how nothing touched the rig)

- **Engine** — real `engine.js` subprocesses on **7601-7641**, every one with
  `MARSIN_CONFIG_FILE` → a black-holed config (`controllers: []`,
  `sacn.destinations: ['127.0.0.9']`, osc/web_client/audio/vsn1-deploy off) plus
  `MARSIN_STATE_DIR` / `MARSIN_PLAYLISTS_DIR` / `MARSIN_TIMELINE_DIR` into
  `~/tmp/redteam_chaos/rigs/<case>/`. The three walls from
  `.agent/memory/spawning_a_test_engine.md` were **ASSERTED on every boot**
  (sender lines name only `127.0.0.9`; no Art-Net sender; `outputRouting.controllers === []`).
  Model `test_bench`, never `titanic`.
- **Sim** — because no sim component accepts a port override (P2-6), a **private
  copy** of `simulation/` was made at `~/tmp/redteam_chaos/rig/simulation` with
  its own `config.yaml` (**7669 / 7670 / 7671 / 7672, UDP 7568**) and
  `node_modules` junctioned. Every controller IP in the copied scenes was
  rewritten to **RFC 5737 TEST-NET-1 (`192.0.2.x`)** before anything started —
  verified `0` remaining `10.1.1.*` — so even a stray relay frame is
  unroutable. **UDP 5568 was never bound.**
- **Launcher** — only `status` and `stop`, and only against a lock in a fake
  `USERPROFILE` (`~/tmp/redteam_chaos/fakehome`). **No profile was ever
  launched**, because `prod` force-claims 6966-6972 (`launcher.js:1023-1028`).
  The one `prod` invocation in §4 was deliberately given a nonexistent scene so
  `validate()` exits before `killStaleListeners` — and the port table after it
  proves nothing was touched.
- **Artifacts** — `~/tmp/redteam_chaos/{repro,evidence,rig,rigs,fakehome}` only.

---

## 8 · Operator's stack — verified unchanged

Snapshot taken **before** any chaos (`evidence/00_operator_stack_before.json`)
and re-taken at the end. **Identical, PID for PID:**

| Port | PID before | PID after | Process |
|---|---|---|---|
| TCP 6969 (`0.0.0.0`) | 35692 | **35692** | `http-server ../ -p 6969 -c-1 --cors` |
| TCP 6970 (`::`) | 17308 | **17308** | `node server/save-server.js` |
| TCP 6971 (`::`) | 38388 | **38388** | `node server/sacn_bridge.js --scene titanic` |
| TCP 6972 (`::`) | 50272 | **50272** | `node server/sacn_output_bridge.js` |
| UDP 5568 (`0.0.0.0`) | 38388 | **38388** | same bridge |

`:6966`, `:6967`, `:6968`, `:7167` free before and after (engine still DOWN, as
`_99` left it). My band 7600-7699 + UDP 7568 is empty at exit — the only listener
in range is `:7680`, `svchost.exe` (Windows Delivery Optimization), pre-existing
and documented in `tests/e2e/timeline_e2e_harness.mjs:311-312`.

**Repo:** no file under the repo was modified by this thread — every write since
session start belongs to sibling threads (CaptainPad `dist/`, timeline sources,
`.agent/**`), all timestamped before this thread began; `simulation/config.yaml`
still reads `6969/6970/6971/6972/5568` and its only diff is the `_99`
`sacn_interface` comment block. `marsin_engine/config.yaml` and
`marsin_engine/states/**` untouched.

**Operator's stack was left exactly as found — same ports, same PIDs, nothing
started, nothing stopped, nothing killed.**
