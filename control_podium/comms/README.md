# `comms/` — Titanic radio comms layer

Implementation of the **Titanic Frame v2** protocol (AEAD-secured)
described in [`docs/07_control_podium.md`](../../docs/07_control_podium.md).

The whole stack is **driven by YAML configuration** under
`control_podium/`, so future agents can re-skin radio behavior — add
commands, change roles, update node identities — without redeploying
code. Restart the bridge to pick up changes.

## Modules

| File | What it does |
|------|--------------|
| `frame.py` | Wire-format encode/decode + arg helpers (Titanic Frame v1 + v2) |
| `secure.py` | AES-128-GCM AEAD codec, key loader, default-codec auto-load |
| `replay.py` | Per-source counter window for anti-replay defense |
| `acl.py` | Node identity + per-role allowed frame-type table |
| `registry.py` | Loads `.config.commands.yaml` → per-cmd / per-qry decisions |
| `engine_client.py` | Async REST/discovery client for MarsinEngine |
| `bridge.py` | The Pi-side translator (RX loop, dispatch, status publisher) |
| `radio_port.py` | Abstract send/receive transport (auto-wraps with codec + replay) |
| `radio_port_sim.py` | TCP client connector to `sim_bus` |
| `radio_port_serial.py` | USB-CDC wrapper around `serial.Serial` (production) |
| `sim_bus.py` | TCP broadcast hub (the "fake LoRa") |

## Where to look first

* **What does a frame look like on the wire?** — `frame.py` (v1 layout)
  and `secure.py` (v2 AEAD wrapping).
* **How is a command authorized?** — `acl.py` (role → frame-types) and
  `registry.py` (per-cmd `min_role`).
* **How does the bridge translate a `cmd pattern/sunset` into HTTP?** —
  `bridge._exec_cmd()`.
* **How is the secret loaded?** — `secure.default_codec()` reads from
  `marsin_engine/secret.yaml` (override with `TITANIC_SECRET_PATH`).

## Out of scope (intentionally not in this directory)

* **Cooldowns / rate limiting.** Pacing belongs to the captain
  companion (or future CaptainPad UI). The bridge is the router, not
  the politeness layer.
* **Fire-effect protocol.** The flame controller (FW-SPEC-001) runs
  separate firmware on its own transport — no fire path on this mesh.
* **GUI.** The companion apps (`../companions/`) drive these modules
  from the command line. A graphical operator console is a future
  CaptainPad concern.
