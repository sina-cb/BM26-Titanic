# 2026-07-25_6 — titanic-ext mic check: is the dead-capture issue fixed?

**Role:** validator (read-only — no remote writes, no stack ops, nothing
started or stopped on the show server).
**Trigger:** follow-up to `20260725_5_titanic_ext_deploy_review.md` §2, which
found the Audio Companion's ffmpeg capture on **titanic-ext** had failed
permanently at boot ("giving up (no more restarts)"). Operator changed the mic
device from CaptainPad and asked: *"can you check if it's fixed now?"*
**Host redaction:** titanic-ext lives on the show LAN at `10.1.1.NNN`; the
real address stays in the private manifest (`$BM26_MACHINES`).

---

## Verdict: **FIXED** ✅ — capture is live on the USB mic, both in the Companion and in the engine

Audio capture on titanic-ext is healthy as of **2026-07-27 14:07–14:08 local
(21:07–21:08 UTC)**. It recovered at **14:05:59 local**, ~2 minutes before the
probe, via the operator's manual two-step in the Audio Companion UI (§3).

---

## 1. Stack is up

TCP probe from the laptop (`Test-NetConnection`, 2026-07-27 21:06 UTC):

| Port | Service | Open |
|---|---|---|
| 22 | OpenSSH | ✅ |
| 6966 | Audio Companion | ✅ |
| 6967 | CaptainPad Expo | ❌ (expected — `prod` profile runs sim + engine only) |
| 6968 | marsin_engine API | ✅ |
| 6969 / 6970 | sim HTTP / save | ✅ |
| 6971 / 6972 | sACN bridges | ✅ |

`GET :6968/status` → `activeScene: test_bench`, `activeModel: test_bench`,
`activePattern: 11_bioluminescence`, `renderHealth.ok: true`, frame 58840,
streaming to controller `Titanic-202` on universes 10/12. The supervisor log
is still `boot_server_20260727_133534.log` — i.e. the **supervisor was never
restarted**; only the *audio subsystem* was hot-restarted by the CaptainPad
device change (the `PATCH /audio/config` hot-restart path).

## 2. Live capture evidence

**Companion (`ws://<titanic-ext>:6966/ws`, 9 s read-only listen, 21:07:20–21:07:29 UTC)**

- `hello` → `mode: "mic"`, `device: "audio=Microphone (Amazon USB Streaming
  Mic)"`, `engineLink.connected: true`.
- **No** `sourceStatus` error broadcast during the window (a dead capture
  emits `enabled:false` + `errorCode`).
- 405 live analysis messages in 9 s (`frames` 263, `frame` 142) — ~60 Hz.
- Band values **moving**, not frozen: `mid` 0.2349 → 0.2312 → 0.2271 → 0.2480
  → 0.1764 → 0.1831 → 0.2367 → 0.1399; `high` 0.2896 → 0.1327 → 0.1601 →
  0.0777; dominant frequency `dom1` wandering 4195 → 1583 → 6322 → 668 Hz.
- OSC accounting advanced across the window: `totalSent` **188 326 → 199 422**,
  per-signal `count` 4964 → 5256 at `rateHz` 59.56 → 59.70.

**Engine (`GET :6968/audio/status`, two samples 6 s apart, 21:08:34 / 21:08:40 UTC)**

| Field | T1 | T2 |
|---|---|---|
| `captureFps` | 86 | 86 |
| `lastFrameAtMs` | 1785186513721 | 1785186519771 (**+6050 ms ≈ wall clock; 199 ms behind "now"**) |
| `phase` / `restartCount` / `errorCode` | running / 0 / null | running / 0 / null |
| `lastKickMs` | 1785186456634 (63 s old) | same |

`lastFrameAtMs` tracking real time is the decisive "capturing, not frozen"
proof. `low` and `kick` read 0 throughout and the last kick is ~1 min old —
consistent with a **quiet room** (ambient hiss is mid/high energy, below the
low-band/kick gates), not with dead input, because the mid/high bands and the
frame clock are demonstrably alive.

**Fresh log lines** (`C:\titanic\logs\boot_server_20260727_133534.log`, local time):

```
13:35:36 [engine] ⚠ configured mic 'Microphone (Amazon USB Streaming Mic)' not found
                    on this machine — pick a new mic from the AUDIO tab in CaptainPad
                    (saw 0 alternative devices)
13:35:37 [audio]  [ffmpeg] [dshow @ …] Could not enumerate audio only devices (or none found).
13:35:53 [audio]  [AudioCapture] ffmpeg failed 5× in a row on device
                    "audio=Microphone (Amazon USB Streaming Mic)" — giving up (no more restarts).
                    Last failure: ffmpeg exited (code=4294967291, signal=none)
--- operator's CaptainPad two-step ---
14:01:59 [engine] 🎤 audio analysis: ENABLED — listening on audio=Microphone (Amazon USB Streaming Mic)
14:05:58 [engine] ⚠ audio listener disabled at boot: Windows audio capture requires a pinned device.
14:05:59 [engine] 🎤 audio analysis: ENABLED — listening on audio=Microphone (Amazon USB Streaming Mic)
14:05:59 [audio]  [ffmpeg] [aist#0:0/pcm_s16le @ …] Guessed Channel Layout: stereo
14:06:00 [engine] [ffmpeg] [aist#0:0/pcm_s16le @ …]
```

The `[audio]` (= Companion) ffmpeg line at 14:05:59 is ffmpeg **successfully
opening the stream** — the exact counterpart of the 13:35:53 give-up. Root
cause of the original failure is visible at 13:35:36/37: at boot the USB mic
was **not enumerable at all** (dshow saw 0 audio devices). It is enumerable
now — `GET :6968/audio/devices` lists exactly one input,
`Microphone (Amazon USB Streaming Mic)` (`dshow`), and it is `current`.

## 3. Operator's manual workaround (the on-playa recovery recipe)

Recorded verbatim from the operator, because this is the field procedure until
it is fixed properly:

> it WORKS now, and the fix required a manual two-step in the Audio Companion
> UI: (1) select the DEFAULT mic first, (2) then select the refreshed USB mic
> from the list.

The log corroborates the shape exactly: `14:05:58` = step 1 (default → "audio
listener disabled … requires a pinned device"), `14:05:59` = step 2 (refreshed
USB mic → ENABLED + ffmpeg stream open).

## 4. Follow-up candidates (NOT implemented — pointers only)

The recovery required a human because nothing in the stack re-tries or
re-enumerates after a boot-time device failure:

1. **Terminal give-up has no re-arm.**
   `marsin_engine/audio/capture/audio_capture.js:456-468` — consecutive-failure
   budget with exponential backoff; on exhaustion `_giveUp()`
   (`audio_capture.js:478-495`) clears every timer, sets
   `errorCode: 'capture_failed_repeatedly'`, and **never restarts**. Deliberate
   (incident 2026-07-08: don't spin ffmpeg forever on a config that can never
   work) — but it means a mic that shows up *later* (USB enumeration lag at
   cold boot) is never picked up. Candidate: a slow re-arm tier (e.g. re-probe
   every 30–60 s, re-enumerating devices, capped) distinct from the fast
   restart budget.
2. **No device re-enumeration on failure.** The Companion only re-lists devices
   on an explicit `listDevices` WS message or a start-time throw
   (`marsin_engine/audio/companion/companion_server.js:1255`, `:1635-1637`);
   `setMode('mic', …)` at `:1240-1256` doesn't re-enumerate on the give-up path.
   That is presumably why "select default, then the refreshed USB mic" was
   needed — the list had to be refreshed by a mode change.
3. **No capture-dead indicator where the operator looks.** The terminal state
   is discoverable only in the log or by reading `GET /audio/status`
   (`marsin_engine/lib/api_server.js:7544`). A CaptainPad AUDIO-tab badge fed
   by `phase`/`errorCode`/`captureFps` would have made this self-evident.

## 5. Honesty notes

- Everything above is read-only: TCP probes, HTTP GETs, one 9 s WS listen (no
  commands sent on the socket), and one SSH session that only read the log.
  The SSH session exited cleanly; no probe process is left running on either
  side. Nothing on titanic-ext was written, started, or stopped.
- The first `GET /audio/status` (21:05 UTC, ~1 min earlier) returned
  `captureFps: 0, lastFrameAtMs: null` — that was the freshly hot-restarted
  status object before its first fps tick, not a fault; the 21:08 double-sample
  supersedes it. Recorded because it is a real transient a future reader could
  hit and misread.
- The room was quiet during the probe. "Healthy" here rests on the frame clock
  advancing + mid/high bands varying + no error state — **not** on loud audio.
  A deliberate loud-sound test (clap next to the mic, watch `kick`) would be a
  stronger confirmation and costs the operator 5 seconds.
- The two-step workaround is the operator's own account; this report reproduces
  its log signature but did not re-run it.
