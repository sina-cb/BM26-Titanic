# 12 — Operating the Raspberry Pi (Titanic Server Bridge)

> Status: canonical onboarding doc for the Pi that runs the
> production bridge. If you are a new agent picking up the system,
> read this end-to-end before touching anything physical.
>
> **Address literals** sprinkled below (anything that looks like a fixed `10.*`
> address) are **examples from one camp network**. The Pi-side SSH topology
> lives in `control_podium/server_bridge/.ssh.secret` (gitignored, copy from
> `.ssh.secret.example`). The engine URL lives in
> `control_podium/.config.bridge.yaml::engine.url`. Update both when you move
> rigs.

## 0. TL;DR

| Fact | Value |
| --- | --- |
| Pi LAN IP / SSH user / port | `HOST` / `USER` / `PORT` in `control_podium/server_bridge/.ssh.secret` |
| SSH password | optional `PASSWORD` in `control_podium/server_bridge/.ssh.secret` |
| Install root | `INSTALL_ROOT` in `.ssh.secret` (example template uses `/opt/titanic-bridge`) |
| Service name | `titanic-bridge` |
| Engine URL the Pi reaches | `.config.bridge.yaml::engine.url` (override via `.ssh.secret::ENGINE_URL`) |
| Bridge health endpoint | HTTP `.config.bridge.yaml::health.port` on the Pi + `/health` (default `:7099`) |
| Server Heltec USB device | `/dev/ttyACMx` (auto-resolved by USB MAC) |
| OS | Debian 13 (Bookworm/Trixie) aarch64 |
| Python | system 3.11+ inside `/opt/titanic-bridge/venv` |
| Logs | `journalctl -u titanic-bridge -f` |
| Auto-start? | YES — `WantedBy=multi-user.target` via systemd unit |
| Auto-restart? | YES — `Restart=on-failure`, 5 restarts/60 s burst cap |

If you fix nothing else after a power blip, the bridge will come
back on its own. Everything below is what you need to know when
that ISN'T enough.

---

## 1. Why the Pi exists at all

The MarsinEngine + simulation run on a beefy laptop. The Pi exists
to be the **always-on tail** of the radio chain:

```
PortWatch (iPhone/iPad)
   │  BLE
   ▼
Captain Heltec (tcon_captain, node 0x0A)
   │  LoRa SF=10 / BW=125 kHz / CR=4/5 / +22 dBm
   ▼
Server Heltec (tcon_server, node 0x01)
   │  USB-CDC serial
   ▼
RASPBERRY PI 4  ← YOU ARE HERE
   │  Python `server_bridge` (systemd)
   │  WiFi
   ▼
MarsinEngine (URL from `.config.bridge.yaml::engine.url`; example rigs historically used LAN addresses like `10.*`)
```

The Pi is the only node that is:
* **Always powered** when the rig is alive. The laptop running the
  engine can sleep / be unplugged; the Pi stays on the truck.
* **Quiet enough to run unattended.** No operator looks at it during
  a show. The supervisor + systemd + auto-restart must be
  bulletproof.
* **Trusted on the LAN.** It's the only LoRa-facing device that has
  outbound access to the engine HTTP API.

If the Pi is dead, EVERY PortWatch in the field goes dark.
Treat its uptime like a fire alarm — silent ≠ healthy, see §5.

---

## 2. Physical setup

* **Hardware**: Raspberry Pi 4 (4 GB or 8 GB).
* **Power**: USB-C 5 V / 3 A. Use the official Pi supply or a
  measured 3 A bench supply — undervoltage warnings on a Pi 4 cause
  USB-CDC drops mid-frame and look exactly like "the bridge crashed".
* **USB**: ONE USB-CDC connection to the **server Heltec**. The Pi
  must NOT have any other Heltec plugged in — `find_port_by_mac`
  will find the wrong device otherwise.
* **Network**: WiFi or Ethernet onto the same LAN as the laptop
  running MarsinEngine. Prefer a DHCP reservation that matches the
  `HOST` you set in `control_podium/server_bridge/.ssh.secret` — update
  BOTH the router DHCP table and `.ssh.secret` when you renumber so
  deploy + tooling stay coherent.
* **Antenna**: U.FL-to-SMA pigtail to the LoRa antenna; the Heltec's
  built-in PCB antenna is NOT used for the production link.

---

## 3. SSH & secrets

### 3.1 Accessing the Pi

```
ssh <USER>@<HOST> -p <PORT>
# all three come from control_podium/server_bridge/.ssh.secret
# password (if any): same file, PASSWORD key
```

You should land in `/home/titanic`. The deployed bridge lives in
`/opt/titanic-bridge`.

### 3.2 The `.ssh.secret` file

SSH host/user/port/install all come from `control_podium/server_bridge/.ssh.secret`
(GITIGNORED). Copy from `.ssh.secret.example` and fill in `HOST`, `USER`,
`INSTALL_ROOT` at minimum.

* `firmware/deploy.py` reads this when you ask it to flash the
  **server Heltec remotely** (the captain's USB is on the laptop;
  the server's USB is on the Pi).
* `server_bridge/deploy.py` reads it to push code updates.

`.ssh.secret.example` is the committed template — copy and fill in
when bootstrapping a new Pi. Never commit the real file.

---

## 4. Software layout on the Pi

```
/opt/titanic-bridge/
├── venv/                       Python 3.11+ virtualenv (deploy.py owns it)
├── control_podium/             Mirror of the repo's control_podium/ dir
│   ├── .config.bridge.yaml     Bridge config (engine URL, pub cadence, health port)
│   ├── .config.nodes.yaml      Node ACL + USB-MAC pairings
│   ├── .config.firmware.yaml   Compile-time firmware knobs (read here by deploy)
│   ├── secret.yaml             AES-128 key (gitignored, rsync'd over by deploy)
│   ├── comms/                  Framing, codec, radio, bridge, health server
│   ├── companions/             client_companion + HIL demos (dev-only)
│   ├── server_bridge/          Pi-side bridge runtime (runner.py) + deploy + systemd
│   └── …                       (firmware/ is shipped to enable remote flashing)
└── docs/                       docs/22_server_bridge.md is the design doc
```

Bridge entry point: `python -m server_bridge --bus serial -v`,
launched by systemd from
`/opt/titanic-bridge/venv/bin/python`.

---

## 5. Systemd service

Unit file: `control_podium/server_bridge/systemd/titanic-bridge.service`
(installed to `/etc/systemd/system/titanic-bridge.service` by
deploy).

### 5.1 Commands you'll actually use

| Goal | Command |
| --- | --- |
| See if it's running | `systemctl status titanic-bridge` |
| Tail logs (LIVE) | `journalctl -u titanic-bridge -f` |
| Last 200 lines | `journalctl -u titanic-bridge -n 200 --no-pager` |
| Stop (e.g. before flashing the server Heltec) | `sudo systemctl stop titanic-bridge` |
| Start | `sudo systemctl start titanic-bridge` |
| Restart | `sudo systemctl restart titanic-bridge` |
| Disable auto-start | `sudo systemctl disable titanic-bridge` (NEVER do this in production) |
| Re-enable auto-start | `sudo systemctl enable titanic-bridge` |

### 5.2 Restart-burst protection

`StartLimitIntervalSec=60` + `StartLimitBurst=5` means **5 restarts
in a 60 s window parks the unit in `failed` state**. If you see
`systemctl status` reporting `failed`, the bridge is hitting a
hard config error on boot (wrong serial port, missing secret.yaml,
mis-aligned firmware key, etc.). Fix it and:

```
sudo systemctl reset-failed titanic-bridge
sudo systemctl start titanic-bridge
```

### 5.3 Restart policy

* `Restart=on-failure` — exit 0 (clean stop) does NOT auto-restart;
  exit ≠ 0 (any crash, including OOM) DOES.
* `RestartSec=5` — 5 second back-off between restarts.
* In-process supervisor (`server_bridge.runner._run`) restarts the
  bridge ITSELF on most failures, so systemd typically only kicks
  in for catastrophic crashes (segfault in pyserial, OOM, etc.).
  See `docs/22_server_bridge.md §6` for the supervisor layers.

---

## 6. Bridge health endpoint

> Build the URL from the Pi's LAN address (`HOST` in `.ssh.secret`) and
> the port in `.config.bridge.yaml::health.port` (default `7099`).

```bash
curl -s http://BRIDGE_HOST:7099/health | jq .
```

Returns operational metrics ONLY (per the logging-security rule —
no secrets, no frame payloads, no engine bearer tokens). Sample (shape only; IPs illustrative):

```json
{
  "service": "titanic-bridge",
  "version": "1.0",
  "node_id": "0x01",
  "uptime_s": 18234,
  "config": { "short_interval_s": 15.0, "long_interval_s": 30.0 },
  "stats": { "rx_frames": 4231, "tx_frames": 4118, "parse_errors": 12 },
  "lora": {
    "rx_count": 4231, "tx_count": 4118,
    "last_rx_ms_ago": 1873, "last_rssi_dbm": -98.4,
    "rssi_avg_dbm": -96.1, "snr_avg_db": 7.8
  },
  "engine": {
    "url": "http://<engine-host-example>/",
    "reachable": true,
    "ws_connected": true,
    "last_ok_ms_ago": 1003,
    "engine_errors": 0,
    "pubs_sent": 1216,
    "last_active_pattern": "rainbow"
  }
}
```

PortWatch's Status screen polls this every 10 s and renders four
rows on the SERVER BRIDGE card: Bridge HTTP / Bridge RX / Bridge
RSSI / and the LoRa frame age. The endpoint is the canonical
ground truth for "is the bridge process alive" — neither the
engine WiFi probe nor the LoRa PUB chain can prove that on its own.

Default TCP port comes from `.config.bridge.yaml::health.port` (see `default_health_listen_port()` in `comms/bridge_health.py`); falls back to `7099` if unset.

---

## 7. Deploying the bridge code

From the dev laptop:

```
cd <repo>/control_podium
python -m server_bridge.deploy
```

What it does (see `server_bridge/deploy.py`):

1. Loads SSH target + install root from `server_bridge/.ssh.secret`.
2. `rsync`s `control_podium/` to `/opt/titanic-bridge/` over SSH
   (excludes `__pycache__`, `tests/`, `PortWatch/`, etc.).
3. Ensures `/opt/titanic-bridge/venv/` exists, then runs
   `pip install -r control_podium/server_bridge/requirements.txt`.
4. Installs / updates the systemd unit.
5. `systemctl daemon-reload && systemctl enable --now titanic-bridge`.
6. Polls `journalctl` until the boot banner is seen, then exits.

After a successful deploy you should see the bridge banner in
`journalctl -u titanic-bridge -f` within ~5 s, followed by periodic
`compact_status` PUB lines (every 15 s active / 30 s idle).

---

## 8. Deploying firmware to the server Heltec (remote flash)

The server Heltec's USB is on the Pi, not on your laptop. The dev
laptop's `firmware/deploy.py` knows how to remote-flash:

```
cd <repo>/control_podium
python firmware/deploy.py --node 0x01           # server only
python firmware/deploy.py --all                  # ALL paired controllers
```

What `--all` does:

1. Resolves every Heltec MAC in `.config.nodes.yaml`.
2. For each MAC, asks `pyserial` if it's on a LOCAL USB port.
3. For MACs NOT found locally, SSHes into the Pi using credentials from `server_bridge/.ssh.secret`.
4. For MACs found on the Pi, builds locally with PlatformIO, rsyncs
   the binaries to the Pi, **stops `titanic-bridge.service`** (to
   release the serial port — also runs `sudo fuser -k` on the port
   for good measure), flashes via `esptool`, then restarts the
   service.

You will see one block of PlatformIO build output per role, then
remote `scp` + `esptool` output for the Pi-attached units. The
end-of-flash banner verification confirms the new firmware booted
with the right NODE_ID and radio params.

Common gotchas:
* `pio` not on PATH on the Pi: deploy.py looks in
  `~/.platformio/penv/bin/pio` as a fallback. If it's not there
  either, SSH in and install via:
  `python -m pip install --user platformio` (as the `titanic`
  user, NOT root).
* "serial port still busy" — the bridge release path can race
  with a sticky `cu.usbmodem`. The script sleeps + `fuser -k`s,
  but if you hit a stubborn one, manually `sudo systemctl stop
  titanic-bridge && sudo fuser -k /dev/ttyACM0`.

---

## 9. Bootstrapping a NEW Pi from scratch

If you've replaced the SD card or set up a new physical unit:

1. Flash Raspberry Pi OS Lite (64-bit) onto the SD card. Use
   `raspi-config` (or the Imager's advanced settings) to set the
   `titanic` user, WiFi credentials, and SSH-on-boot.
2. First boot — find the Pi on the LAN, SSH in as `titanic`, run
   `sudo apt update && sudo apt install -y python3-venv rsync
   sshpass`. (The dev laptop also needs `sshpass` to non-
   interactively SSH.)
3. Reserve the LAN address you will write into `server_bridge/.ssh.secret::HOST` (DHCP reservation or static DHCP config on the Pi).

4. Ensure the Linux account named by `.ssh.secret::USER` can open serial devices: `sudo usermod -aG dialout titanic` (replace `titanic` if you changed the account) then re-login.

5. From the dev laptop, copy `server_bridge/.ssh.secret.example` to `server_bridge/.ssh.secret` and fill in `HOST` / `USER` / `INSTALL_ROOT` (and `PASSWORD` if needed). Edit `control_podium/.config.bridge.yaml::engine.url` to point at your laptop's engine. Then run `python -m server_bridge.deploy`. First-time deploy creates the venv, installs deps, installs systemd unit, and starts the service.

6. Curl `http://<HOST>:7099/health` (or whatever you set in `.config.bridge.yaml::health.port`) and confirm JSON returns.

7. Plug in the server Heltec via USB; verify
   `journalctl -u titanic-bridge -f` shows a `compact_status` PUB
   within ~15 s.

---

## 10. Troubleshooting

### "PortWatch says bridge is DOWN"

1. SSH in: `systemctl status titanic-bridge`. Is it `active
   (running)`? If `failed`, see §5.2.
2. `curl http://<HOST>:7099/health` from your workstation. If this hangs,
   the bridge process is wedged — `sudo systemctl restart titanic-bridge`.
3. If `/health` answers but `engine.reachable: false`: verify the Marsin laptop is up and reachable at the host part of `.config.bridge.yaml::engine.url` (ICMP ping is illustrative only — HTTPS may still succeed while ICMP drops).
4. If `engine.reachable: true` but `lora.rx_count` is stuck at 0:
   the server Heltec isn't sending frames to the Pi. Re-seat USB,
   verify `lsusb` sees the Heltec, check `journalctl` for
   `serial reopen … failed`.
5. If `lora.last_rssi_dbm` is below ~-115 dBm: the RF link is too
   weak. Move the captain closer, or re-tune via
   `firmware/hill_climb_link.py`.

### "Bridge keeps restarting"

`journalctl -u titanic-bridge -n 200`. Most common causes:

* Wrong serial port — `.config.nodes.yaml` server `usb_mac`
  doesn't match the device plugged in. Run `lsusb -v | grep
  iSerial` on the Pi to see the actual MAC, then update the YAML
  and re-deploy.
* Wrong AES key — `secret.yaml` on the Pi differs from the
  captain's firmware build. Re-flash the captain with the same
  `secret.yaml` (firmware deploy bakes it in).
* Engine URL unreachable — bridge boots fine but every status call fails.
  Update `control_podium/.config.bridge.yaml::engine.url` (or set
  `ENGINE_URL` in `.ssh.secret` for a systemd-baked override) and re-deploy.

### "I want to roll back"

`git revert` the offending PR on the dev laptop, then re-run
`python -m server_bridge.deploy`. There is no Pi-side rollback —
the install is fully owned by the deploy script.

---

## 11. Things you must NEVER do

* **Never `systemctl disable titanic-bridge`** without a plan to
  re-enable. A Pi that boots without the bridge service is
  silently broken — you only find out when the next field test
  fails.
* **Never run a manual `python -m server_bridge` ON the Pi while
  the systemd unit is enabled.** Both processes will fight for
  the serial port and the resulting "works on tuesday, broken on
  wednesday" behavior is a nightmare to debug.
* **Never `sudo rm -rf /opt/titanic-bridge/.config*`.** The
  configs are committed in the repo but the LIVE copies on the Pi
  may have been hand-tweaked for a show — deploy.py overwrites
  them, but a manual `rm` between deploys nukes any live tweak.
* **Never commit `.ssh.secret`.** It's in `.gitignore`; keep it
  there. Use the laptop's password manager / a sealed copy on the
  team Vault for backups.
* **Never expose the bridge ``network.bridge.health_port`` (/health listener) outside the LAN.** The endpoint is unauthenticated by design; if you NAT the Pi, firewall that port explicitly.

---

## 12. Where to look next

* `docs/22_server_bridge.md` — the bridge's own design doc;
  covers the supervisor, frame relay, engine WS subscriber,
  serial reconnect, log throttling.
* `docs/21_portwatch_monitor.md` — how PortWatch consumes what
  this Pi produces.
* `control_podium/comms/bridge.py` — the bridge implementation.
* `control_podium/comms/bridge_health.py` — the `/health`
  endpoint.
* `control_podium/server_bridge/deploy.py` — code deploy.
* `control_podium/firmware/deploy.py` — remote firmware flash.
* `control_podium/firmware/hill_climb_link.py` — link tuning.
* `control_podium/tests/hil/test_hil_link_reliability.py` —
  end-to-end link stats.

If you've read this whole doc and still don't know how the Pi
fits into the system, escalate to a human. Better one minute of
"is this right?" than one minute of broken radio link at a show.
