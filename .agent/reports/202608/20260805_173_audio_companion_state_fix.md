# `_173` — Audio Companion keeps snapping back to the test signal: root cause + fix

**Thread:** fix agent `_173`
**Operator report (verbatim):** *"check the audio companion and how the state is
stored for it. It keeps going back to the test signals and that's annoying. I want
to have it remember our last settings. if it changed due to a test, that's okay."*

**Verdict: FOUND AND FIXED.** The engine test suite was reaching into the
operator's running show and switching its audio source to the synthetic test
generator. Not a metaphor and not a race — a measured, reproducible HTTP PATCH.

---

## 1. How Companion state is actually stored (the map)

There is **one** persistent home for the audio source, and it is on the engine
side. The Companion itself persists almost nothing.

| What | Where it lives | Who writes it | Who restores it |
|---|---|---|---|
| **Source mode + mic device** (`test` / `file:<path>` / `<ffmpeg device>` / `''`) | `marsin_engine/states/<scene>/audio_state.yaml` → `capture.device` | engine `applyLiveUpdate()` (`engine.js:2124`) on every `PATCH /audio/config`, plus an unconditional **boot-write** at `engine.js:2200` | engine at boot (`config.yaml audio.*` ← `states/<scene>/audio_state.yaml`), then broadcast as `audioConfig` to every `/ws/control` subscriber |
| Analyzer tuning (gain, gates, smooth, fft/hop, kick, sub) | same file | same path | same path |
| Mic gain/gate **profiles** | `marsin_engine/audio/companion/mic_profiles.yaml` | Companion `persistProfiles()` | Companion boot |
| Signal/view **design**, OSC rate | `marsin_engine/audio/companion/companion_config.yaml` | Companion **only on explicit "Export config"** | Companion boot |
| Party thresholds | `marsin_engine/config.yaml` `party:` | Companion `persistPartyConfig()` | Companion boot |
| Companion **boot** source + device (fallback only) | `marsin_engine/config.yaml` `companion.source` / `companion.device` / `audio.capture.device` | nothing — static operator declaration | Companion `applyEngineConfig()` (`companion_server.js:2436`) |

The two-way sync, verbatim from the code:

- **engine → Companion**: `EngineConfigLink` opens `ws://<engine>/ws/control`,
  seeds once over `GET /audio/config`, and every `audioConfig` frame runs
  `applyEngineCaptureDevice()` → `parseCaptureDevice(device)` → `setMode()`.
  `'test'` ⇒ the Companion switches to the synthetic generator.
- **Companion → engine**: an operator `setMode` runs
  `writeThroughCaptureDevice()` → `PATCH /audio/config {capture:{device}}`.
  The engine persists it and rebroadcasts.

So: **whatever string sits in `capture.device` is the source, for the engine,
for CaptainPad, and for the Companion — on every boot and on every reconnect.**

---

## 2. Root cause — the engine test suite PATCHes the live show

`companion_server.js` resolved the engine config with a **hardcoded** path:

```js
const ENGINE_CONFIG_PATH = path.join(__dirname, '..', '..', 'config.yaml');   // before
```

It did **not** honour `MARSIN_CONFIG_FILE` — the seam `engine.js` and both
autopilots already resolve through, and which
`tests/helpers/setup_config_guard.mjs` sets for the whole suite. Measured on the
tracked config:

```
ENGINE_CONFIG_PATH decl: const ENGINE_CONFIG_PATH = path.join(__dirname,'..','..','config.yaml')
honours MARSIN_CONFIG_FILE? false
resolveEngineEndpoint(real config.yaml) = {"host":"127.0.0.1","port":6968}
companion.osc = {"host":"127.0.0.1","port":10000}
```

`127.0.0.1:6968` is the operator's live engine. `127.0.0.1:10000` is its live OSC
input. **Every** companion process spawned anywhere on this box resolved to them.

Two suites spawn the real `companion_server.js` and then send the same message:

- `marsin_engine/tests/companion/companion_osc_accounting.test.js:67`
- `marsin_engine/tests/companion/companion_new_signals.test.js:76`

```js
ws.send(JSON.stringify({ type: 'setMode', mode: 'test' }));
```

`setMode` → `writeThroughCaptureDevice()` → `PATCH /audio/config` on the linked
engine → **the operator's engine writes `capture.device: test` into
`states/<scene>/audio_state.yaml` and rebroadcasts `audioConfig`, which slams the
operator's real Companion to the synthetic generator mid-session** — and it stays
there across every subsequent boot, because it is now the persisted state.

### Reproduced end-to-end (no live service touched)

`~/tmp/fix_173/repro_clobber.mjs` stands up a **fake** engine
(`/audio/config` + `/ws/control`) on an OS-assigned free port, points a scratch
config at it, spawns the real `companion_server.js` exactly as the tests do, and
sends the exact test message:

```
fake engine on 127.0.0.1:55559
  [companion]      ↔ engine tuning sync: 127.0.0.1:55559 (single source of truth; degrades gracefully)
  [fake engine] companion opened /ws/control
  [companion]   🔗 engine config link UP → ws://127.0.0.1:55559/ws/control
hello.mode = mic | hello.device = "audio=Microphone (Amazon USB Streaming Mic)" | engineLink.connected = true
--- sending the exact message the companion tests send: {type:"setMode",mode:"test"} ---
  [fake engine] PATCH /audio/config  <-  {"capture":{"device":"test"}}
PATCHes the engine received: [ '{"capture":{"device":"test"}}' ]
```

### The git record agrees

`marsin_engine/states/titanic/audio_state.yaml`:

- `3246deb2` (Jul 30) — `device: audio=Microphone (Amazon USB Streaming Mic)`
- `7d2cb6d7` (Aug 3) — `device: test`  ← committed clobber, shipped as the default
- working tree now — `device: ''`

`states/test_bench/audio_state.yaml` shows the same `device: test` at HEAD.

### The second-order damage: `device: ''`

Once `capture.device` is `test`, the Companion's remembered mic (`configDevice`)
is whatever `config.yaml audio.capture.device` says — **`null`** — because
`applyEngineCaptureDevice()` only populates `configDevice` on the *mic* branch
(`companion_server.js:1013`). The Companion UI's "Mic / Line" button then sends
`{mode:'mic', device: S.device || null}` → `captureDeviceString()` → **`''`**,
which is what is persisted for `titanic` right now. On Windows `''` is fatal:

```js
// audio/capture/audio_capture.js:145
if (platform === 'win32') { … err.code = 'device_not_configured'; throw err; }
```

So the loop the operator lived: source is `test` → click Mic → capture throws,
Companion goes deaf → click Test to get a signal back → suite runs again → `test`
re-persisted. That is the whole annoyance.

### What it is NOT

- **The engine never falls back to a test source.** `engine.js` contains no
  `'test'` device path at all; a mic failure sets `audioState.lastStatus.error`
  and logs the `--choose_mic` remedy loudly. No P0 fallback violation there.
- **Engine-spawning unit tests are already isolated.** Every suite that spawns
  `engine.js` goes through `tests/helpers/spawn_engine.mjs` (or sets
  `MARSIN_STATE_DIR` itself); the three "raw" hits are source-reading structural
  tests that spawn nothing. HIL harnesses are gated to `test_bench` by
  `hil_guard.mjs` and only run under `npm run test:hil`. **The state-dir
  redirect was never the gap — the Companion was.**

---

## 3. What changed (4 files)

**`marsin_engine/audio/companion/companion_server.js`** — `ENGINE_CONFIG_PATH`
now resolves through `MARSIN_CONFIG_FILE`, with the same contract as
`lib/state_paths.js`: unset ⇒ the tracked `config.yaml` (operator behaviour
byte-identical); set-but-relative/empty ⇒ **throws at boot** (codex P0, no silent
fallback to the real config). This closes the seam for the engine link, the OSC
target *and* the PARTY tab's `persistPartyConfig()` write-back.

**`marsin_engine/tests/helpers/companion_isolation.mjs`** (new, ~95 lines) —
`isolatedCompanionEnv(prefix)` writes a scratch copy of `config.yaml` with:

- `companion.engine.host` and `companion.osc.host` → **the RFC 5737 TEST-NET-1 black-hole address**,
- `companion.source: test`, `companion.device: null` (so a spawned companion
  never opens the operator's microphone),

and returns the child `env` carrying `MARSIN_CONFIG_FILE`.
`assertEngineLinkDown(hello, assert.ok)` fails the suite if the spawned companion
is linked to anything.

> **`127.0.0.9` is not a black hole.** First cut used the repo's usual nowhere
> address and the assertion caught it: `engineLink={"connected":true}`. The engine
> binds its API on `0.0.0.0`, which accepts connections on **every** local
> address, and all of `127.0.0.0/8` is local. The chosen host is RFC 5737 TEST-NET-1
> — never routed — so a TCP connect can only fail and a UDP datagram can only be
> dropped. (See §6: the same mistake very likely applies to `--dest 127.0.0.9`.)

**`marsin_engine/tests/companion/companion_osc_accounting.test.js`** and
**`…/companion_new_signals.test.js`** — spawn with `isolation.env`, assert
`assertEngineLinkDown` on the `hello` frame **before** sending `setMode`, and
`isolation.cleanup()` in `finally`.

Nothing else was touched. No engine restart, no state file edited, no scene /
pattern / playlist change, no git operation.

---

## 4. The one-time operator step

The fix stops the clobbering, but it cannot repair the value already persisted.
`states/titanic/audio_state.yaml` currently holds `capture.device: ''`, which
throws `device_not_configured` on Windows — the engine is running and would
overwrite any hand-edit on shutdown anyway, so this was deliberately left alone.

**Do this once, live, no restart needed:**

> CaptainPad → **AUDIO** tab → **SETTINGS** → device picker → pick
> **Microphone (Amazon USB Streaming Mic)**.

That PATCH writes the full quintet (`device` / `deviceLabel` / `deviceId` /
`inputFormat` / `platform`), the engine persists it to
`states/titanic/audio_state.yaml`, and the Companion picks it up on the same
broadcast. **From then on it survives** — reboots, and now test runs too.

Equivalent alternatives: `node engine.js --choose_mic --model titanic` (engine
stopped), or the Companion's own **Mic / Line** + device dropdown (works, but
writes only `device` and leaves `deviceLabel`/`deviceId` stale — prefer
CaptainPad).

Note `test_bench` already holds the real device string; only `titanic` was left
blank.

---

## 5. Suites

| Suite | Result |
|---|---|
| Engine full (`npm test`) | **2796 / 2789 / 7** — identical to the `_172` documented baseline, name for name: 5 × `audio_capture` (`device_not_configured`, the standing Windows env precondition), 1 × `osc_listener` `EADDRINUSE→EACCES`, 1 × `effects_v2_mode_page_layout` (file-level deserialize). **Zero new failures.** |
| Focused: the two companion suites | **5 / 5 / 0** (both engine-link assertions green) |
| `python scripts/security_check.py --all` | **6** — unchanged baseline, all inside gitignored `simulation/.scene_backups/` |
| Sim suite | not run — no `simulation/` file touched |

Residue check after the full run: `git status` shows only my 4 files; no state
file gained a `capture.device: test`, and `states/titanic/audio_state.yaml` still
reads `device: ''` (i.e. the suite no longer writes there at all).

**Self-disclosure — two transient touches of the live stack, both mine.** The
repro (§2) and the first, assertion-failing test run each ran a companion whose
**OSC** target was still `127.0.0.1:10000` / `127.0.0.9:10000`, so a few seconds
of synthetic audio CPC values landed on the live engine's OSC listener. Runtime
only, never persisted, overwritten at ~86 Hz by the real Companion. The repro's
companion also opened the USB mic for ~2 s. No `capture.device` PATCH ever
reached the live engine: in the failing run the assertion throws *before*
`setMode` is sent. This is the same leak the two suites have been causing on
every run; it is now closed by the TEST-NET-1 black hole.

---

## 6. Follow-ups (not done here — out of scope for a QoL fix)

1. **`--dest 127.0.0.9` is probably not a black hole either.** The sim's sACN
   receiver calls `socket.bind(this.port, cb)` with no address
   (`simulation/node_modules/sacn/dist/receiver.js:43`) → binds `0.0.0.0` → it
   receives datagrams addressed to **any** local IP, including `127.0.0.9`. Every
   spawned test engine using `--dest 127.0.0.9` may therefore be feeding the
   operator's live bridge. Worth measuring, and re-pointing at the TEST-NET-1 black hole if
   confirmed. `.agent/memory/spawning_a_test_engine.md` would need updating too.
2. **`capture.device` conflates source-mode and mic identity.** Selecting `test`
   destroys the mic string; the Companion's recovery depends on an in-process
   variable that dies with the process. A separate `capture.source` (mode)
   alongside a sticky `capture.device` (mic) would make the mic un-losable. Left
   alone deliberately — schema change, not a QoL fix.
3. **`config.yaml` `companion.source: mic` + `audio.capture.device: null`** means
   a Companion booted while the engine is down starts a mic capture with no
   device and dies loudly on Windows. Harmless today (the engine link corrects it
   on connect) but it is the reason the Companion looks broken on a cold start.
