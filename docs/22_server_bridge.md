# 22 — server_bridge: Pi-Deployed Radio↔Engine Bridge

> **Status:** Living design doc for the bridge process that runs
> unattended on the Raspberry Pi at every Titanic install.
>
> **Companions to read first:** `07_control_podium.md` (the LoRa mesh,
> Titanic Frame v2, the captain/crew/server roles), `21_portwatch_monitor.md`
> (the consumer-side app on the other end of the mesh), and
> `16_captain_pad.md` (CaptainPad — the operator-side surface that
> talks to the engine directly).
>
> **Out of scope (deliberately):** the radio protocol itself (frame
> layout, AEAD, replay defence) — that lives in `07_control_podium.md`
> §3 and is treated as fixed here. This doc is about the Python process
> that ferries frames between USB-CDC (Heltec) and the MarsinEngine
> HTTP/WebSocket API, and the deployment story that gets it onto a Pi
> and keeps it there.

---

## 1. What server_bridge Is

`server_bridge` is the **single Python process** that runs on the
Raspberry Pi attached to the server-role Heltec. Its job:

1. Listen on the USB-CDC link to the Heltec for Titanic Frame v2
   lines coming off the LoRa air.
2. Decode them, check the ACL, route `qry`/`cmd` paths through the
   command registry to the MarsinEngine REST API.
3. Reply with `ack` / `nak` / `rep` on the same channel.
4. Periodically broadcast `compact_status` PUBs, while PortWatch also polls
   `qry engine/status` on an 8 s interval as a reliability backstop.
5. Survive everything that happens to a Pi sitting in a road case:
   USB wiggles, engine restarts, WiFi drops, OOM kills, power cycles.

It is **not** the engine. It is **not** CaptainPad. It owns no
operator UI, no state of its own, and no fallback "default behaviour"
when the engine is down — when the engine is down, the bridge replies
`nak engine_error` to every `qry`/`cmd` and resumes the moment the
engine comes back.

### Where it sits in the system

- CaptainPad connects over Wi-Fi to MarsinEngine (HTTP + WS base authored in MarsinEngine's own config).
- PortWatch takes the BLE → Heltec → LoRa path through the Raspberry Pi bridge, which terminates on USB‑CDC into the server Heltec.
- Bridge-side topology lives in `control_podium/.config.bridge.yaml` (engine URL) and `control_podium/server_bridge/.ssh.secret` (Pi SSH credentials, gitignored).

Historical ASCII diagram trimmed to avoid drifting literals; mentally overlay the LAN addresses from topology when tracing packets.

The bridge is the only process that holds keys to both worlds. Every
other component (PortWatch, CaptainPad, the engine itself) speaks one
side or the other. The bridge does NOT cache anything mesh-side that
isn't immediately re-derivable from the engine, and does NOT make
authoritative decisions on its own — the engine is the source of truth
for pattern state, autopilot state, the control lock, everything.

### What the bridge replaces

Before this package, the bridge ran via a `companions/bridge_companion.py`
script on the developer laptop — same Mac that runs MarsinEngine. That worked
for bench testing but fails the real install because:

* **The Mac sleeps.** macOS aggressively suspends USB on lid close
  even with caffeinate. The Heltec drops, the bridge dies, nobody
  notices until someone tries to use PortWatch from across camp.
* **The engine and the radio surface have different reliability
  needs.** Engine restarts are routine (scene reloads, asset hot-
  swaps); each one kills the bridge unless it lives in a separate
  process. With them on the same machine, "restart MarsinEngine"
  meant 30 s of mesh outage.
* **Field-side observability requires a Linux box.** journalctl is
  the right tool for "did the bridge come up after last night's
  power cycle?". macOS Console.app is the wrong tool for the same
  question.

A Pi runs Debian, never sleeps, costs $40, and survives being
glued to the inside of a road case. The bridge moves there and the
laptop becomes a laptop again.

### server_bridge lives at

```
control_podium/server_bridge/
  __init__.py              ← package marker + entrypoint notes
  __main__.py              ← `python -m server_bridge` → runner.main()
  runner.py                ← the bridge runtime (was companions/bridge_companion.py)
  deploy.py                ← `python -m server_bridge.deploy` → push to Pi
  requirements.txt         ← runtime pip deps (pyserial, aiohttp, etc.)
  .ssh.secret.example      ← template for the gitignored .ssh.secret
  .ssh.secret              ← REAL creds (gitignored)
  systemd/
    titanic-bridge.service ← unit file templated by deploy.py
```

The bridge runtime lives in `server_bridge/runner.py` — moved out of
`companions/` (a test-fixtures directory) into this Pi-deployable
package now that it ships to production. `__main__.py` is a thin
shim that does `from .runner import main` and runs it.

### 1.5 Message Types and ACK Semantics

The bridge processes and emits the following Titanic Frame v2 message types:

| `typ` | Direction      | Meaning / Description                                                                                  |
|-------|---------------|--------------------------------------------------------------------------------------------------------|
| `hlo` | C → S         | Hello / client presence / bridge wake. Arg `name/Sina,role/captain`. Server logs presence.             |
| `pin` | C → S         | Ping. Server replies with `pon`. Used for liveness/latency.                                            |
| `pon` | S → C         | Pong.                                                                                                  |
| `cmd` | C → S         | Mutation command requiring privileged ACL. Arg uses path/value syntax — see §3.4.                      |
| `qry` | C → S         | Query (read-only). Allowed for any role. Arg is a path: `engine/status`, `param/speed`, ...           |
| `ack` | S → C         | Authenticated command accepted, ACL passed, MarsinEngine REST call succeeded. `seq` echoes the original.|
| `nak` | S → C         | Authenticated command rejected (e.g. `acl_denied`, `unknown_cmd`) or engine operation failed (`engine_error`). |
| `rep` | S → C         | Reply with data for a `qry`. Arg is a compact key/value list (see §3.4).                              |
| `pub` | S → broadcast | Broadcast status publish. Sent periodically on `dst = FF`. Arg is a compact key/value list.            |

> [!IMPORTANT]
> **Engine-Success ACK Semantics:**
> There is **no radio-level ACK** in the system. The bridge returns `ack` only after the incoming frame has been successfully authenticated, the command has passed ACL gates, and the subsequent REST invocation on MarsinEngine has returned successfully (HTTP 200/204). If the engine REST call fails or times out, the bridge returns `nak` to the captain client. PortWatch uses this strict engine-level ACK semantics for optimistic intent resolution.

---

## 2. Identity gate — only the server role attaches

The bridge MUST run as the `server` role on the radio mesh (node
0x01 by default; configurable via `.config.bridge.yaml::bridge.node_id`).
Captains / crew / spectator nodes have different ACL rules and the
mesh trusts `src=0x01` as the authoritative status publisher; letting
a wrong-role process impersonate that breaks every assumption every
other component makes.

The gate is enforced in two places:

1. **At boot** in `_resolve_serial_port`: load the node entry from
   `.config.nodes.yaml`, verify `role: server`. If it's anything else
   (`captain`, `crew`, or unspecified), `sys.exit` with a clear error.
   This is a *hard config error* — the operator has to fix the YAML;
   spinning forever would just mask the misconfig.

2. **At wire encode time** in the Bridge class itself: every outbound
   frame is stamped with `src=node_id` from the bridge config. Even
   if the resolver gate were bypassed, the bridge would still send as
   whatever node_id the config says — never as the wrong identity by
   accident.

What we **deliberately do NOT do** is cross-check the connected
Heltec's USB MAC against the role table. That extra interlock was
prototyped and reverted: every time a board got swapped on the bench
and the YAML pairing drifted (which happens often during firmware
development), the bridge would refuse to boot mid-rehearsal with a
"wrong board" error that took minutes to debug. The radio-side
identity is already what matters; a wrong-board mistake is
recoverable by re-pairing, but a refused boot at gig time is not.

---

## 3. Bulletproof — what "zero monitoring" actually requires

The bridge has to keep running through every kind of disruption a
Pi in a road case can experience. The contract:

> Once the Pi has power and the engine is on the same network, the
> bridge runs forever, recovers from any transient failure without
> operator help, and emits a journalctl-grep-able log line for every
> distinct failure mode. The only thing that should ever require an
> operator on the Pi is replacing the SD card.

### 3.1 The three nested supervisors

Three layers of restart logic, each with a different responsibility
and a different recovery time:

| Layer            | What it catches                                       | Recovery time |
| ---------------- | ----------------------------------------------------- | ------------- |
| `RadioPortSerial` reopen loop | USB cable drop, Heltec brown-out, FD invalidation | < 5 s |
| `_run()` supervisor loop      | Bridge `run()` crash, engine-side fatal exception | 1–30 s        |
| systemd                       | Whole Python process crash, OOM kill, Pi reboot   | < 10 s        |

**Layer 1 — Serial port reopen.** `recv_frames` wraps
`pyserial.readline()` in try/except. Any read failure
(`OSError(6, 'Device not configured')` on macOS,
`SerialException("device disconnected")` on Linux, etc.) closes the
dead handle, sleeps with exponential backoff (1 s → 30 s cap), and
retries `serial.Serial(port)`. While the port is reopening, `send()`
silently drops outbound frames (one DEBUG line each) — LoRa is best-
effort anyway, and the bridge MUST NOT die because the operator
wiggled a USB cable. Reopen success emits an INFO line so the
journal shows the recovery.

**Layer 2 — In-process supervisor.** `server_bridge.runner._run()` wraps
`bridge.run()` in a forever-loop with the same backoff (1 s → 30 s,
reset to 1 s after 30 s of healthy uptime). It distinguishes:

* `SystemExit` from the resolver / secret loader → *hard config
  error*, propagate so the operator sees the cause. (Wrong role,
  missing pairing, missing AES key.)
* `TransientBootError` from the resolver → *recoverable*, retry
  forever. (Heltec not plugged in, USB device path disappeared.)
  This is the May 2026 regression that motivated this whole
  package: the supervisor used to treat USB-not-found as a hard
  config error and exit the process; the bridge would die mid-shift
  and never come back. Now the supervisor catches `TransientBootError`,
  logs once per `_LogThrottle` window, and keeps retrying.
* Any other exception from `bridge.run()` → log + restart with
  backoff. Bridge.run() exiting cleanly without a stop signal is
  also treated as a crash and restarted.

**Layer 3 — systemd.** The unit at
`/etc/systemd/system/titanic-bridge.service` declares
`Restart=on-failure, RestartSec=5, StartLimitBurst=5/60`. If the
Python process itself crashes (segfault, OOM kill, KeyboardInterrupt
escaping the supervisor) systemd brings it back in 5 s. The
`StartLimitBurst=5` cap prevents a hard config error from burning
the Pi's CPU — after 5 fast restarts in a minute, systemd parks the
unit in `failed` state and surfaces the cause on `systemctl status`.

### 3.2 Log dampening

Three repeated failures used to dominate the log during outages,
each at one line per retry:

* `qry engine_error: unreachable: [Errno 61] Connection refused`
  — once per client poll. At 5 clients × 5 s cadence that's 60
  lines/min while the engine is down. Now throttled to one INFO
  line per 30 s with a `(+N similar suppressed)` summary, and an
  explicit `engine HTTP recovered` line when it comes back.
* `engine WS closed ([...]); reconnecting in N.0s` — once per
  reconnect attempt. With a 30 s backoff that's still 2/min during
  a flap. Same `_LogThrottle` with a 60 s window; recovery emits
  `engine WS recovered: ws://...`.
* `bridge waiting for prerequisite: no USB device with MAC ...` —
  once per supervisor restart while the Heltec is unplugged.
  Throttled to one INFO per 60 s.

The goal is that `journalctl -u titanic-bridge | grep -i error`
returns nothing during a healthy run, and during an outage returns
*one line per kind of failure* (engine HTTP, engine WS, USB),
each with a clear recovery line when things come back. Anything
noisier is a bug.

### 3.3 What we do NOT recover from

* **Wrong shared-channel AES key** (`marsin_engine/secret.yaml`).
  The bridge fails to load the codec at boot and exits. The mesh
  cannot run in plaintext (see `07_control_podium.md` §3.6).
  Recovery: copy the right secret to the Pi.
* **Role mismatch** (configured node has `role: captain`). Boot-time
  `sys.exit` with a clear message. Recovery: fix `.config.nodes.yaml`.
* **`bridge.node_id` points at a missing entry.** Same.
* **No `usb_mac` paired for the server node.** Boot-time `sys.exit`.
  Recovery: run `firmware/deploy.py --pair --node 0x01` once.

These four are the only places `sys.exit` survives. Everything else
retries.

---

## 4. Deployment to a Raspberry Pi

### 4.1 What the Pi needs

* Debian 12+ aarch64 (tested on Trixie). Raspberry Pi OS works.
* Python 3.11+. The deploy script `apt`-installs `python3-venv` and
  `python3-pip` if missing.
* A user account with sudo. Either passwordless sudo or a known
  password.
* The server-role Heltec plugged in via USB (kernel sees it as
  `/dev/ttyACM0`).
* Reachable WiFi/Ethernet to the laptop running MarsinEngine.

### 4.2 First-time deploy

```bash
# 1. Pi SSH credentials (gitignored):

cd control_podium/server_bridge
cp .ssh.secret.example .ssh.secret
$EDITOR .ssh.secret   # fill in HOST / USER / INSTALL_ROOT (+ PASSWORD / ENGINE_URL)

# 2. Engine URL: edit ../.config.bridge.yaml::engine.url to point at the
#    machine running MarsinEngine.

# 3. Deploy from repository root:

cd ../..
PYTHONPATH=control_podium python -m server_bridge.deploy
```

The deploy runs 8 steps and prints each:

1. SSH smoke test (host reachable, sudo works).
2. `apt-get install python3-venv python3-pip rsync` (skipped if cache fresh).
3. `rsync` the `control_podium/` tree + `marsin_engine/secret.yaml`
   + `docs/22_server_bridge.md` to `INSTALL_ROOT`. Excludes PortWatch,
   tests, firmware, pycache.
4. Create `INSTALL_ROOT/venv` and `pip install -r requirements.txt`.
5. Add the runtime user to the `dialout` group (USB serial access).
6. Template `systemd/titanic-bridge.service`, fill in install paths
   and the engine URL, install to `/etc/systemd/system/`.
7. `systemctl daemon-reload && enable --now titanic-bridge && restart`.
8. Wait 5 s, check `is-active`, dump the last 30 journal lines.

Re-running the deploy after a code change is the same command —
rsync handles the diff, pip is a no-op when requirements haven't
moved, systemctl restarts the unit so the change actually picks up.

### 4.3 Verifying

After the deploy returns "✓ active and running", from the laptop (SSH target from `server_bridge/.ssh.secret`):

```bash
# Tail logs live (replace user/host with the values from your .ssh.secret):

sshpass -e ssh titanic@your-pi-hostname \
  'sudo journalctl -u titanic-bridge -f'

# Or one-shot health check (no rsync, no restart):

PYTHONPATH=control_podium python -m server_bridge.deploy --verify-only
```

A healthy bridge prints the boot banner once, then one log line per
~30 s as PUBs fire (at the long_interval_s cadence) and per client
poll. Anything noisier than that is worth investigating.

### 4.4 Firmware flash from the Pi

The server-side Heltec lives at the end of a USB cable that's only
reachable from the Pi — the laptop can't flash it directly during a
gig. The deploy script's ``--firmware`` mode handles this by building
the image on the laptop (where PIO + the ESP32 toolchain already
live), shipping the four ``.bin`` images to the Pi, and running
``esptool write_flash`` from there.

```bash
# Code change only — push Python:
PYTHONPATH=control_podium python -m server_bridge.deploy

# Firmware change only — flash the Heltec, leave bridge code alone:
PYTHONPATH=control_podium python -m server_bridge.deploy --firmware-only

# Both at once (e.g. for a release that needs new C + new bridge code):
PYTHONPATH=control_podium python -m server_bridge.deploy --firmware
```

Under the hood (see ``server_bridge/deploy.py`` for the source):

1. **Build local.** Calls ``firmware/deploy.py --node 0x01 --build-only``
   on the laptop. That run produces
   ``control_podium/firmware/.pio/build/server_rx/{bootloader,
   partitions, boot_app0, firmware}.bin``. Building on the laptop
   takes ~30 s; building on a Pi 5 takes 5+ minutes and bloats the
   Pi install by half a gigabyte of toolchain.

2. **rsync images** to ``$INSTALL_ROOT/firmware-images/`` on the Pi.

3. **Install esptool** into the Pi's venv if missing
   (``pip install esptool>=4.7``).

4. **Stop the bridge service** so esptool can claim
   ``/dev/ttyACM0`` — the bridge holds the port open with an
   exclusive grab.

5. **Flash the four images** at the standard ESP32-S3 offsets
   (0x0 / 0x8000 / 0xE000 / 0x10000) with
   ``esptool --chip esp32s3 --port /dev/ttyACM0 --baud 460800
   write_flash --flash_mode dio --flash_freq 80m --flash_size detect``.

6. **Restart the bridge service** and verify ``is-active`` plus the
   new boot banner (``SERVER_RX vX.Y (node=0x01)``) in the journal.

If step 5 fails (USB drop mid-flash, signature mismatch, etc.) the
``try/finally`` in ``deploy()`` STILL restarts the bridge afterward
so the operator isn't left with a stopped service AND a half-flashed
board — the supervisor will just spam reopen failures until the
flash is retried.

The client-side Heltec stays on a USB cable to the dev laptop and
is flashed directly with ``firmware/deploy.py --role captain`` (or
by ``--node 0x0A`` etc.) — there's no remote-flash path for it
because there doesn't need to be. The bridge knows the difference
because role gating in ``_resolve_serial_port`` only ever accepts
the ``server`` role.

### 4.5 What happens on Pi reboot

The systemd unit has `WantedBy=multi-user.target`, so it auto-starts
on every boot. The dependencies are `network-online.target` (so
engine HTTP works) and `dev-ttyACM0.device` (so the Heltec is
enumerated). On a typical Pi cold boot the bridge is `active` within
~15 s of kernel-up.

### 4.6 What happens on SSH disruption

The bridge is decoupled from SSH entirely. Restarting `sshd` on the
Pi has no effect on the bridge — only the operator's ability to
log in and check on it. This is intentional: production we don't
want SSH and the bridge sharing failure modes.

The deploy script's `--verify-only` mode is the canary: it SSHes in,
runs `systemctl is-active titanic-bridge`, dumps the journal, and
reports. If you can SSH in and verify-only says `active`, the bridge
is fine even if SSH itself just bounced.

---

## 5. Configuration

The bridge reads these files (paths relative to `INSTALL_ROOT/control_podium/`):

| File | Purpose | Source of truth |
| ---- | ------- | ---------------- |
| `.config.bridge.yaml` | Engine URL, bus mode, health port, publish cadence | Repo (committed) |
| `.config.nodes.yaml`  | Node id → role + USB MAC pairing | Repo (committed) |
| `.config.commands.yaml` | `qry`/`cmd` allowlist + min-role gates | Repo (committed) |
| `../marsin_engine/secret.yaml` | Shared AES-128-GCM key for Titanic Frame v2 | Per install, NEVER committed |
| `server_bridge/.ssh.secret` | Pi SSH credentials for deploy (HOST/USER/PORT/INSTALL_ROOT/PASSWORD/ENGINE_URL) | Per developer/show, GITIGNORED |

`.ssh.secret` is read only by the deploy scripts on the dev laptop —
it is **never rsync'd to the Pi**. Required keys: HOST, USER,
INSTALL_ROOT. Optional: PORT (default 22), PASSWORD (sshpass), and
ENGINE_URL (bakes a systemd `--engine` override into the unit file).

### 5.1 Per-environment overrides

Rare tunnels or staging racks can set `ENGINE_URL` in `.ssh.secret` to
override the committed `.config.bridge.yaml::engine.url` for one Pi
without changing the repo. For multi-rig deployments, prefer editing
`.config.bridge.yaml` so all consumers agree.

---

## 6. Observability

### 6.1 What the bridge logs

Healthy steady state (per minute, approx):

```
INFO  status PUB sent (...)
```

Unhealthy states emit at most one INFO line per `_LogThrottle`
window:

```
INFO  qry engine_error: unreachable: [Errno 61] Connection refused
INFO  engine WS closed (...); will retry every 60s
INFO  serial read /dev/ttyACM0 lost (...); will reopen
INFO  serial port /dev/ttyACM0 recovered after drop
INFO  engine HTTP recovered
INFO  engine WS recovered: ws://<topology engine host + ws path>
```

Hard errors that need an operator on the Pi:

```
ERROR shared-secret load failed: ...
ERROR node 0x01 has role 'captain'; bridge requires 'server'
```

### 6.2 Useful one-liners

```bash
# Is the bridge up right now?
ssh titanic@pi 'systemctl is-active titanic-bridge'

# When did it last boot?
ssh titanic@pi 'systemctl show titanic-bridge -p ActiveEnterTimestamp'

# Last 100 lines of the journal:
ssh titanic@pi 'sudo journalctl -u titanic-bridge -n 100 --no-pager'

# Live tail:
ssh titanic@pi 'sudo journalctl -u titanic-bridge -f'

# How many times has it restarted since boot?
ssh titanic@pi 'systemctl show titanic-bridge -p NRestarts'

# Disable auto-start (e.g. for maintenance):
ssh titanic@pi 'sudo systemctl disable --now titanic-bridge'
```

### 6.3 HTTP Health and Profile API

The bridge exposes a local HTTP server (binding to `0.0.0.0:7099` by default, or the port configured in `.config.bridge.yaml::health.port`) for monitoring and client status checks.

#### Endpoints

- **`GET /health`** (or `GET /`): Returns the operational health snapshot of the bridge as a JSON object containing:
  - **`status`**: String indicating overall service status.
  - **`engine`**: Sub-object with engine connection stats (e.g., whether the WebSocket subscription is active).
  - **`profile`**: String representing the active LoRa profile name.
  - **`radio`**: Sub-object showing `RadioPortSerial` stats:
    - `rx`: total frames received.
    - `tx`: total frames transmitted.
    - `tx_drop`: dropped transmissions.
    - `parse_error`: malformed packets.
  
- **`GET /profile`**: Returns JSON with the current profile name and the list of available profile names.
- **`POST /profile`**: Requests a profile switch. (Disabled/returns 503 or 403 if profile switching is gated off in production configuration.)

---

## 7. Testing

### 7.1 Unit tests on the dev laptop

```bash
cd control_podium
PYTHONPATH=. ../.venv-dev/bin/python -m pytest tests/ -q
```

The resilience-focused tests live in `tests/test_bridge_resilience.py`
and pin:

* `_LogThrottle` collapses repeated identical failures.
* `RadioPortSerial` transparently reopens after a read error.
* `close()` is crash-safe (swallows the `OSError(9)` that pyserial
  raises on an already-broken fd).
* `_resolve_serial_port` refuses a non-`server` role.
* `_resolve_serial_port` raises `TransientBootError` (not
  `SystemExit`) when the USB device is unplugged.

The full E2E suite (`tests/test_comms_e2e_sim.py`) drives the
bridge against a `FakeEngine` over an in-process `sim_bus` and
covers ~100 protocol-level scenarios.

### 7.2 Live integration on the Pi

After deploying, the smoke test that proves the contract end-to-end:

```bash
# Force-restart sshd on the Pi. The bridge MUST stay up.
sshpass -e ssh titanic@pi 'sudo systemctl restart ssh'
# Wait for ssh to be reachable again, then verify the bridge:
sleep 10
PYTHONPATH=control_podium python -m server_bridge.deploy --verify-only

# Unplug the Heltec mid-run. The bridge MUST log a reopen attempt
# and recover when you plug it back in. No process exit.
sshpass -e ssh titanic@pi 'sudo journalctl -u titanic-bridge -f'
# (unplug, wait 3 s, plug back in)

# Stop the engine. The bridge MUST log one "engine HTTP" line and
# resume the moment the engine restarts.
# (stop and restart the engine on the laptop)
```

If any of these results in the bridge process exiting,
`systemctl status titanic-bridge` showing anything other than
`active`, or the journal filling with repeated identical INFO lines
faster than one per `_LogThrottle` window, the bulletproofing has
regressed — that's a bug to fix in `comms/radio_port_serial.py`,
`comms/bridge.py`, or `server_bridge/runner.py`, not on the
Pi side.

---

## 8. Out of scope

Things the bridge deliberately doesn't do, and where they live
instead:

* **DMX / sACN output.** Engine, not bridge.
* **Pattern compilation.** Engine.
* **CaptainPad lock arbitration.** Engine (the engine owns the lock
  lease; the bridge just relays the current owner field in
  `compact_status`).
* **PortWatch UI state.** PortWatch (the bridge has no opinion on
  caching, paging, or rebuildWorld; those are app-side concerns).
* **Fire-effect telemetry.** Separate firmware (FW-SPEC-001) on a
  separate transport. The mesh radio carries no fire path by design.
* **OTA firmware push to the server Heltec.** That's
  `firmware/deploy.py` run from the laptop, not from the Pi. The Pi
  doesn't need a flashing toolchain.

---

## 9. LoRa profile switching (`/profile`)

> [!WARNING]
> **Development / Bench-Only Feature:**
> Runtime profile switching is a development and bench diagnostic feature only. It is unsafe for production while it relies on plaintext `*CFG` commands over the air. Any 915 MHz transmitter that can emit a valid-looking `*CFG` line can force radios onto another profile and deny service (DoS).

### Target Production Design:
1. **LoRa-Originated CFG Rejected:** Production firmware must reject unauthenticated LoRa-originated `*CFG` commands.
2. **Bridge /profile Disabled:** The bridge's `/profile` endpoint is disabled by default in production unless explicitly enabled via `.config.bridge.yaml::profile_switching.enabled`.
3. **PortWatch Picker Hidden:** The PortWatch profile picker UI is hidden unless the bridge `/profile` API indicates it is enabled.
4. **Local USB Recovery:** Local USB recovery remains available under all environments — if a node becomes orphaned, it must be flashed or recovered via local serial connection.

### Profile Table
Defined in `firmware/src/titanic_profiles.h`. The bridge maps available profiles in lock-step with the firmware.

| name         | SF | BW (kHz) | CR  | TX dBm HIGH | TX dBm LOW | scenario                                |
| ------------ | -- | -------- | --- | ----------- | ---------- | --------------------------------------- |
| `test_bench` |  7 | 500      | 4/5 |  +0         |  -9        | bench/lab — receivers safe within 1 m   |
| `local`      |  9 | 250      | 4/5 | +14         |  +6        | indoor / venue scale; ~100 m            |
| `playa`      | 10 | 125      | 4/5 | +22         | +14        | long range; ~2 mi LOS + mesh hops       |

### HTTP API
When enabled, the bridge exposes the following REST paths:

`GET /profile`
```json
{ "available": ["test_bench","local","playa"], "current": "playa" }
```

`POST /profile`  body `{"name": "test_bench"}` (optional `delay_ms`):
```json
{ "applied": true, "name": "test_bench" }
```

* `applied=true` means the bridge successfully wrote to USB.
* `applied=false` means the bridge accepted the request but the USB write failed.

The bridge persists the most recent choice to `/var/lib/titanic-bridge/profile.txt` and reads it back on startup.

### Wire format
Plaintext ASCII over local USB or the diagnostic side-channel, terminated by `\n`:

```
*CFG name=<short>
     [sf=<7-12>] [bw=<62|125|250|500>] [cr=<5-8>]
     [hi=<-9..+22>] [lo=<-9..+22>]
     t=<delay_ms>
```

### Failure mode: link death after a profile change
If a client node misses a profile transition (due to RF packet loss), it becomes "orphaned" on the old profile and cannot communicate. Because profile state is persisted to NVS, power-cycling does not recover it.
Recovery:
1. **Plug the captain into a laptop via USB.**
2. Send `*CFG name=<server_profile> t=0\n` on its serial port.
3. The captain applies immediately and both ends are back in sync.

---

## 10. Change log

* **2026-05-17** — Initial draft. Created the
  `control_podium/server_bridge/` package, the deploy.py script, the
  systemd unit template, and `.ssh.secret(.example)`.
* **2026-05-19** — Moved the bridge runtime out of the
  `companions/` test-fixtures directory into `server_bridge/runner.py`.
  `__main__.py` now does `from .runner import main` directly.
* **2026-05-17 (later)** — Added `--firmware` / `--firmware-only`
  flash modes to deploy.py. The server Heltec is now reflashable
  from the laptop via the Pi: build local with PIO, ship the four
  `.bin` images, esptool-flash from the Pi while the bridge service
  is stopped, then resume. Bridge service is restarted in a `finally`
  so a failed flash doesn't leave the system in a stopped state.

  Companion firmware change: clients now stay at HIGH power for the
  full duration of a BLE session via a new
  `titanic_pwr_holdBegin()` / `titanic_pwr_holdEnd()` latch wired
  into the BLE `onConnect` / `onDisconnect` callbacks. The previous
  behaviour dropped clients to LOW (14 dBm) after 60 s of no command
  writes, which silently degraded LoRa range during a range walk
  even while the phone was still paired. The server controller was
  already pinned HIGH via `-DPWR_PIN_HIGH=1` and is unaffected.

* **2026-05-18** — Runtime LoRa profile switching. Added
  `titanic_profiles.h` (firmware), `Bridge.request_profile_change()` +
  `/profile` endpoints (bridge), `setBridgeProfile()` + Status-screen
  picker UI (PortWatch). Three named profiles ship by default —
  `test_bench`, `local`, `playa`. Bridge version bumped to 1.1 so
  PortWatch can detect the new `/health.profile` block.

  Spawned by a real saturation incident: server + captain placed
  ~1 m apart on the bench at SF=10/BW=125/+22 dBm overdrove the
  SX1262 receiver front-end (-10 dBm received vs -25 dBm overload).
  Switching to `test_bench` at +0 dBm makes lab work safe; switching
  to `playa` re-arms for outdoor 2-mile range. No reflash needed.

---

## 12. Server Bridge HIL & Production Readiness Checklist

This checklist details the hardware-in-the-loop (HIL) operational verification procedures required specifically for the Server Bridge and core radio policy gateways:

* **Latency & RTT Performance**
  - [ ] **Mutation Command RTT**: Verify $p_{95}$ response time for `cmd brightness/<n>` returning `ack` is within 6 seconds under the target profile.
  - [ ] **Query Status RTT**: Verify $p_{95}$ response time for `qry engine/status` returning `rep` is within 6 seconds under the target profile.
* **Server & Process Recovery**
  - [ ] **Server Heltec Reboot**: Reboot the server Heltec. The bridge must automatically recover serial communication and re-anchor the replay window for the client node upon receiving the first valid frame.
  - [ ] **Bridge Process Restart**: Kill and restart the `titanic-bridge.service` on the Pi. The bridge must initialize, load saved profiles, and synchronize.
  - [ ] **Raspberry Pi Reboot**: Reboot the Pi. The `systemd` unit must start the bridge at boot, and all client connections must recover.
  - [ ] **MarsinEngine Restart**: Restart the engine process. The bridge must handle request failures by returning clean NAKs to PortWatch, and automatically recover when the engine is back up.
  - [ ] **USB Serial Unplug/Replug**: Unplug the server Heltec from the Pi and plug it back in. The bridge must recover connection serial lines without crashing the process.
  - [ ] **Engine Outage Resilience**: With the engine down, verify the bridge returns `nak engine_error: unreachable` to PortWatch clients. Once restarted, the bridge must cleanly resolve subsequent commands.
* **Security, Authenticity, & Access Control**
  - [ ] **Replayed Frame Rejection**: Re-transmit an old recorded Frame v2. Verify that the bridge rejects it as `REPLAY_TOO_OLD` or `REPLAY_DUP` and logs the warning.
  - [ ] **Ciphertext Tampering**: Mutate one byte of the `<body>` field. Verify that the bridge silently rejects the frame due to authentication tag mismatch.
  - [ ] **Header / AAD Tampering**: Mutate one byte of the `<seq>` or `<flags>` field while keeping the body intact. Verify that the GCM engine fails authentication and rejects the frame.
  - [ ] **Production LoRa Profile CFG Rejection**: Send a raw plaintext `*CFG` command over LoRa (simulating an RF attacker). Verify that production firmware rejects the command and logs `PROF: OTA *CFG rejected`.
  - [ ] **USB Profile CFG Recovery**: Send a `*CFG` command locally over USB serial. The server must process it successfully, schedule the switch, and update NVS.
  - [ ] **Unauthenticated Command Rejection**: Send a frame with an invalid tag or no tag. Verify it is rejected.
  - [ ] **Role-Based Authorization**: Send a command that requires `captain` role from a node configured with the `crew` role in `.config.nodes.yaml`. Verify that the bridge returns a NAK indicating role denial.
  - [ ] **Pyro System Block**: Send any command carrying a pyro/fire payload. The bridge and engine must reject the command structurally.

