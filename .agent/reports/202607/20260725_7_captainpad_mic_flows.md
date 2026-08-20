# 2026-07-25_7 — CaptainPad mic flows: refresh + select, verified against the Audio Companion

**Role:** validator → developer (verify-then-fix; local laptop only — nothing on
titanic-ext or the show LAN was touched).
**Trigger:** operator — *"focus on the iPad app too: make it possible to refresh
from the iPad app (already supported) and also to select a good mic — already
exists, just needs to be checked again[st] Audio Companion and make sure it's
not broken somehow."*
**Context:** report `20260725_6_titanic_ext_mic_check.md` — the show server's mic
died at boot and the operator recovered only via a **two-step in the Audio
Companion's own UI** (pick default mic, then re-pick the USB mic), *after*
trying to change the mic from CaptainPad.

---

## Verdict

| Flow | Before | After |
|---|---|---|
| **REFRESH** device list from CaptainPad | ✅ works — genuinely re-enumerates | unchanged |
| **SELECT a DIFFERENT device** from CaptainPad | ✅ works — engine + Companion both switch | unchanged |
| **RE-SELECT the SAME device** (the recovery case) | ❌ **BROKEN** — silent no-op on the Companion | ✅ **FIXED** |
| CAPTURE DEVICE read-out honesty | ❌ named a mic that was not the source | ✅ **FIXED** |

**The operator's two-step workaround existed because of exactly one line of
guard logic.** When the Companion's capture has terminally given up, re-picking
that same mic in CaptainPad did nothing — the only way to force a restart was to
make the device string *change*, which is precisely what "pick default, then
pick the USB mic" does.

---

## 1. Contract map

```
CaptainPad AUDIO tab  ──REST──▶  marsin_engine :6968  ──WS /ws/control──▶  Audio Companion :6966
  app/(tabs)/audio.tsx            lib/api_server.js                        audio/companion/companion_server.js
```

### Refresh
| Side | Where |
|---|---|
| UI | `CaptainPad/app/(tabs)/audio.tsx:1541` — `↻ REFRESH` → `loadDevices()` (`:1233`) |
| Client | `CaptainPad/utils/api.ts:1100` `fetchAudioDevices()` → `GET /audio/devices` |
| Engine | `marsin_engine/lib/api_server.js:7549` — shells `ffmpeg -list_devices` on the **engine** machine, **2 s** response cache |
| Enumerator | `marsin_engine/audio/capture/audio_devices.js:99` `listAudioDevices()` — **no cache of its own** |

Wire shape: `{ platform, inputFormat, devices[{id,label,platform,inputFormat,ffmpegDevice,alternativeName,isDefault}], current{device,deviceLabel,deviceId,inputFormat} }`.
CaptainPad's `AudioDevice` interface (`audio.tsx:105`) matches field-for-field. **No drift.**

### Select
| Side | Where |
|---|---|
| UI | `audio.tsx:1294` `selectDevice()` → `patchAudioConfig({capture:{device,deviceLabel,deviceId,inputFormat,platform}})` |
| Engine validate | `marsin_engine/audio/config/audio_config.js` `AUDIO_LIVE_CAPTURE_FIELDS` = exactly those 5 fields → `requiresCaptureRestart` |
| Engine apply | `engine.js:2033` `applyLiveUpdate()` → stop capture → `buildAndStartAudio()` → persist to `states/<scene>/audio_state.yaml` → broadcast `{type:'audioConfig', config}` |
| Companion subscribe | `audio/companion/engine_config_link.js:126` — `audioConfig` frames → `applyEngineSharedTuning()` |
| Companion apply | `companion_server.js` `applyEngineCaptureDevice()` → `parseCaptureDevice()` → `setMode('mic',{device})` |

**No field-name or endpoint drift anywhere in either flow.** The defect was
purely behavioural.

### The shared-field subtlety (source of the second bug)
`capture.device` is **not just a mic**. The Companion overloads it as its whole
SOURCE MODE (`companion_config.js:165 parseCaptureDevice`):
`'test'` = synthetic generator · `'file:<path>'` = clip replay · `''`/`null` =
platform default input · anything else = that pinned mic. But `deviceLabel` /
`deviceId` are **not cleared** when the source flips to test/file.

---

## 2. Live findings (laptop, `node launcher.js prod --scene test_bench --no-launch`)

Fresh `web:build` + `serve dist` on :6967 (never Metro — memory
`metro-stale-watcher`), puppeteer with console muted before boot (memory
`captainpad-screenshot-technique`).

### ✅ Refresh genuinely re-enumerates
Two `GET /audio/devices` from the real UI, and a timing probe proving the cache
boundary is not hiding a stale list:

```
call1 (uncached):            306 ms   ← ffmpeg spawn
call2 (<2 s → engine cache):   2 ms
call3 (>2 s → re-enumerated): 294 ms  ← ffmpeg spawn again
```

Picker rendered 5 real inputs with the current one marked `ACTIVE`
(`~/tmp/mic_probe/shots/before4_5_refresh_done.png`).

### ✅ Selecting a different device works end-to-end
Driven through the real CaptainPad UI (`after_6_after_select.png`):
```
21:26:00 PATCH /audio/config           (CaptainPad)
+127.41s sourceStatus mode=mic device="audio=Webcam 1 (NDI Webcam Audio)" phase=running errorCode=null
+129.01s frames=210 … +138.01s frames=258     (Companion analyzing the new input)
```

### ❌ Re-selecting the SAME device was a silent no-op — reproduced exactly

Sequence (companion WS trace, `~/tmp/mic_probe/watch1.log`):

1. Selected an un-openable device to reproduce titanic-ext's boot state →
   AudioCapture burned its restart budget:
   `errorCode:"capture_failed_repeatedly", phase:"error", consecutiveFailures:5`.
2. **Re-selected the SAME device from CaptainPad** (the operator's natural retry):
   ```
   +120.70s engineDevice device="audio=Probe Ghost Mic"    ← only an echo
   +123.01s … frames=0        +126.01s … frames=0          ← still deaf
   ```
   The **engine** restarted its own capture; the **Companion — the sole analyzer
   that feeds the lights over OSC — did nothing.**
3. Selecting a *different* device recovered instantly (`phase:"running"`,
   frames flowing) — i.e. the operator's documented two-step worked only because
   it made the device string change.

Root cause: `applyEngineCaptureDevice()` guarded on
`changed = mode !== 'mic' || configDevice !== target.device`. That guard is
*necessary* (the engine rebroadcasts the whole config on every PATCH, so an
inputGain tweak must not churn the capture stream) — but it also swallowed the
one case that matters most.

### ❌ CAPTURE DEVICE read-out named a mic that was not the source
With `capture.device: test` (the state checked into
`states/test_bench/audio_state.yaml`), CaptainPad rendered:

> ● **Microphone Array (2- Realtek(R) Audio)** · error

…while the Companion was demonstrably running its **synthetic test generator**,
and the picker highlighted that mic row as `ACTIVE`. During a "pick a good mic"
task this is the worst possible lie.

---

## 3. What changed

### Fix 1 — re-arm a terminally-dead mic capture (THE fix)
`marsin_engine/audio/companion/companion_server.js`

| Line | Change |
|---|---|
| `1094` | `let lastCaptureStatus = null;` — retain the current capture's last status |
| `1255` | `onStatus` now records it before broadcasting |
| `1237` | new `captureGaveUp()` — true only for `errorCode === 'capture_failed_repeatedly'` (audio_capture.js `_giveUp`, deliberately terminal) or a capture that never constructed |
| `1250` | `stopSource()` resets `lastCaptureStatus` |
| `778-800` | `applyEngineCaptureDevice()` — `if (changed \|\| reArm) setMode(...)`, with a `console.warn` naming the device |

This is **reconciliation, not a fallback** (codex P0): the config says "capture
from X", the actual state is "capturing nothing and will never retry", so we
converge — loudly, and only from a state that can never self-heal. Restarting /
exited / starting are *not* treated as dead.

### Fix 2 — the CAPTURE DEVICE card tells the truth
`CaptainPad/app/(tabs)/audio.tsx`

| Line | Change |
|---|---|
| `115-152` | new `CaptureSource` type + `describeCaptureSource()` / `captureSourceText()` — read the `capture.device` **sentinel**, never the stale `deviceLabel` |
| `1385` | `const capSource = describeCaptureSource(cfg?.capture)` |
| `1560-1573` | row renders `TEST SIGNAL — Companion synthetic generator` / `FILE — <name>` / `Platform default input (no mic pinned)` / the pinned mic, plus a red one-liner on test/file: *"Not listening to a microphone … Pick a device below to go back to live mic input."* |
| `1622-1630` | `isCurrent` requires `capSource.kind === 'mic'` — no ACTIVE badge on a row that isn't the source |

---

## 4. Verification

**Fix 1 — re-arm fires (`~/tmp/mic_probe/watch2.log` + `launcher2.log:266`)**
```
[audio] [companion] mic capture had given up on "audio=Probe Ghost Mic";
        config re-asserted the same device — re-arming capture
+33.51s sourceStatus phase="starting"  ← fresh AudioCapture, restart budget reset
```
Then selecting the real mic: `phase:"running"`, `frames=257/3 s`, live bands.

**Regression — a healthy capture must NOT churn**
```
sourceStatus lines before=38 after=38   (unchanged-device PATCH + a bands.inputGain PATCH)
frames=259 … frames=257                  (uninterrupted)
```

**Fix 2 — visual** (`~/tmp/mic_probe/shots/testsrc2_3_picker_open.png`, inspected):
`● TEST SIGNAL — Companion synthetic generator · error` + the red explainer, and
**no** row badged ACTIVE, while the AUDIO SIGNALS meters run off the test synth.

**Tests**
| Suite | Result |
|---|---|
| `CaptainPad` `npm test` | ✅ 37 files, **790 passed**, 6 skipped |
| `CaptainPad` `npx tsc --noEmit` | ✅ clean |
| `marsin_engine` `node --check companion_server.js` | ✅ |
| `marsin_engine` `npm test` | 7 failures: the **6 known baselines** (5× audio_capture device-pinning + 1× osc_listener EACCES) + `effects_v2_mode_page_layout.test.js`, which is a node test-runner IPC deserialization flake — **47/47 pass when run alone**, and no effects code was touched |
| `simulation` | not run — untouched |

---

## 5. Recommendations (NOT implemented)

1. **The engine tries to open the `'test'` / `'file:'` sentinels as ffmpeg dshow
   devices.** Observed live: `Error opening input file test.` → the engine's own
   capture error-loops whenever the Companion selects a non-mic source. The
   engine should recognise the sentinels (`parseCaptureDevice` already exists)
   and simply not run capture for them. **This is a real defect** — it was out of
   scope for a minimal fix but is worth a follow-up card.
2. **Two ffmpeg captures on one mic.** `states/*/audio_state.yaml` carries
   `enabled: true`, which overrides `config.yaml`'s `audio.enabled: false`, so the
   engine AND the Companion both open the same device. It works on this rig, but
   it is redundant now that the Companion is the sole analyzer — and it is the
   likely aggravator of the titanic-ext boot contention.
3. **No capture-dead indicator where the operator looks** (carried over from
   `20260725_6` §4.3). CaptainPad surfaces the *engine's* audio status; the
   **Companion's** capture health never reaches the iPad. A badge fed by the
   Companion's `phase`/`errorCode` would have made the whole incident
   self-evident. Needs a Companion→engine health channel — not small.
4. **`states/test_bench/audio_state.yaml` is incoherent as committed-plus-dirty:**
   `device: test` next to `deviceLabel: Microphone (Amazon USB Streaming Mic)`.
   Worth an operator decision before the next deploy — with Fix 2 the iPad now
   shows this honestly instead of hiding it.

---

## 6. Deploy to titanic-ext — BLOCKED, needs the operator

The companion fix (Fix 1) lives in **engine-side code**, so the operator's iPad
test against the **remote** show server will NOT exercise it until titanic-ext is
redeployed. (Fix 2 is CaptainPad app code and reaches the iPad via the Expo
server hosted on this laptop, so it is already live for him.)

I attempted the operator-lawful pipeline:

```
python deploy/deploy.py deploy --machine titanic-ext --scene test_bench
```

**It was refused by the Claude Code permission gate** (auto-mode classifier),
from both the Bash and PowerShell paths. I did not attempt to work around it —
a coordinator relay is not operator consent for a gated action.

**Action required from Sina:** run that command yourself (or approve the
permission), then the remote stamp should move off `e805ef01 @ 13:30`. Until
then:

| What the operator tests | Carries the fix? |
|---|---|
| CaptainPad UI (Expo from this laptop) | ✅ Fix 2 live |
| Companion mic re-arm on titanic-ext | ❌ **still the old code** — the "re-pick the same mic" retry will still be a no-op there, and the Companion-UI two-step remains the field workaround |

Remote stamp at time of writing is unchanged from
`20260725_5_titanic_ext_deploy_review.md`: `git_head e805ef01`, deployed
`2026-07-27T13:30:17` from FoH-Windows. It does **not** cover this report's
`companion_server.js` change.

---

## 7. Honesty notes

- **The full recovery loop was proven in two halves, not one shot.** I proved (a)
  the re-arm fires on an unchanged device and constructs a fresh capture, and (b)
  a fresh capture on an available device runs and delivers frames. I could not
  make a device that was un-openable *become* openable on this laptop without
  touching system settings, so the single continuous "dead mic → re-pick same mic
  → live audio" run was not executed. The two halves compose, but that is
  inference on the joint, not a measurement of it.
- The give-up state was induced with a fabricated device name
  (`audio=Probe Ghost Mic`), not a real USB unplug. It produces the identical
  terminal state (`capture_failed_repeatedly`) that titanic-ext's log shows.
- The re-arm fires on **any** `audioConfig` frame received while capture is dead
  — including an unrelated `bands.inputGain` PATCH. That is bounded (AudioCapture's
  own 5-attempt budget) and logged, and I judged self-heal to be the desirable
  behaviour, but it is slightly broader than "the operator re-picked the mic".
- The room was quiet: `phase: running` + frame counts + `errorCode: null` are the
  liveness evidence, not loud band values.
- **State residue:** the engine rewrote `states/test_bench/*` and
  `states/titanic/*` as usual. I deliberately PATCHed
  `test_bench/audio_state.yaml` back to its **exact pre-session working-tree
  values** (`device: test`, Amazon label/id, `inputGain: 8.83`) through the engine
  API rather than leaving my probe's `Webcam 1 (NDI Webcam Audio)` pinned in a
  file the show server deploys from. Everything else is ordinary run residue —
  reported, not reverted.
- Cleanup: stack stopped via `node launcher.js stop`; puppeteer closed; the
  CaptainPad `serve` and its surviving `npx serve` child killed. **Ports
  6966–6972 confirmed free** (6967 handed back for the operator's Expo Go test).
  Probes live in `~/tmp/mic_probe/`.
- Nothing on titanic-ext or the show LAN was contacted.
