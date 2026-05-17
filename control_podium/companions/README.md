# `control_podium/companions/` — Host-Side Apps

The companions are the **host-side processes** that drive (and live above)
the Heltec radios. The radios themselves are dumb byte relays; everything
interesting — frame encoding, AEAD, ACL, the bridge to MarsinEngine,
status publishing, and the operator UX — runs in this directory as
ordinary Python.

There are two production apps and three acceptance harnesses. **Nothing
else** lives here, by design — older v1 podium / control-surface /
fire-station / monitor experiments were intentionally removed.

> See `docs/07_control_podium.md` (especially §3, §7, §8, §10) for the
> protocol and topology these apps implement.

---

## The two production apps

### `client_companion.py` — captain / crew handheld

Interactive CLI that runs on a captain's (or crew's) laptop. Speaks
USB-CDC to the locally-paired Heltec, encrypts every outbound frame with
AEAD, and decrypts/displays inbound replies and broadcasts.

```bash
PYTHONPATH=. python -m companions.client_companion \
    --bus serial --serial-port /dev/cu.usbserial-CAPTAIN \
    --node-id 0A --role captain
```

Commands:

| Prompt input            | What happens on the wire                                  |
|-------------------------|-----------------------------------------------------------|
| `/qry engine/status`    | `T2|0A|01|<seq>|qry|1|…` → bridge replies `rep`           |
| `/cmd pattern/breathing`| `T2|0A|01|<seq>|cmd|1|…` → bridge updates engine, `ack`s  |
| `/cmd param/speed/0.5`  | `T2|0A|01|<seq>|cmd|1|…` → engine `/param-center` write   |
| `/ping 01`              | `T2|0A|01|<seq>|pin|1|-` → server replies `pon`           |
| `/sub pub`              | start streaming the bridge's broadcast `pub` frames        |

Crew clients (`--role crew`) lose `/cmd` — the bridge will reject those
with `nak acl_denied`. Crew can still `/qry` and `/ping` (handy for
flagging a captain when something needs attention).

The companion **fails to start** if `marsin_engine/secret.yaml` is
missing or unreadable. Copy `marsin_engine/secret.yaml.example` to
`marsin_engine/secret.yaml`, populate it, and ship the same content to
every machine.

### `bridge_companion.py` — server-side bridge

Runs on the same host as (or near) the server Heltec. One process, three
async tasks:

1. **Inbound RX loop** — read frames from the server radio (USB-CDC),
   decrypt with the shared key, check the per-source replay window,
   look up the sender role, validate against `.config.commands.yaml`,
   dispatch to a MarsinEngine REST call, send back `ack` / `nak` / `rep`.
2. **Adaptive status publisher** — every 5 s while clients are active
   (every 30 s when idle), pull engine state and broadcast a compact
   `pub` frame.
3. **Engine session** — `EngineClient` against the URL(s) in
   `.config.bridge.yaml`. Discovers the first reachable engine from a
   primary + fallback list at startup.

```bash
PYTHONPATH=. python -m companions.bridge_companion \
    --bus serial --serial-port /dev/cu.usbserial-SERVER \
    --engine http://10.1.1.172:6968 \
    --node-id 01
```

Same `marsin_engine/secret.yaml` requirement applies — refuses to start
without it. (Refusing to run is preferred to silently allowing plaintext
on the air.)

---

## The three acceptance harnesses (dev only)

These are NOT meant to run in production. They exist so a single
`PYTHONPATH=. python -m companions.<demo>` invocation gives a yes/no
answer about whether the system still works after a change.

### `mesh_demo.py` — hardware-free multi-client smoke

Spins up `sim_bus.py` + `bridge_companion`-equivalent + a captain client
+ a crew client + a (mocked) MarsinEngine, then exercises the full
allowlist: `hlo`, `pin`, `qry engine/status`, `cmd pattern/<x>`,
`cmd param/<k>/<v>`, `cmd brightness/<v>`, the ACL deny path for crew,
the replay-window re-anchor on a counter reset, etc. Asserts wire shapes
AND engine state changes.

```bash
PYTHONPATH=. python -m companions.mesh_demo -q
```

Must print `ALL CHECKS PASSED — mesh is HIL-ready` and exit 0. This is
the baseline check before any change.

### `hil_secured_demo.py` — secured channel through real radios

Same shape as `mesh_demo`, but the airwaves are real. Requires both
Heltecs paired in `.config.nodes.yaml` and a reachable engine. Asserts
that the AEAD layer + replay window survive a real RF round-trip.

```bash
PYTHONPATH=. python -m companions.hil_secured_demo \
    --serial-server /dev/cu.usbserial-SERVER \
    --serial-client /dev/cu.usbserial-CAPTAIN \
    --engine http://10.1.1.172:6968
```

### `hil_companion_demo.py` — full-stack HIL acceptance

End-to-end version of the workflow the operator actually runs: the
captain client sends real `cmd` frames over real LoRa to the bridge,
which calls a real MarsinEngine, and we then assert that the engine's
state changed (pattern swapped, param updated, blackout flipped). This
is the single test that proves the deployable system works. Run it
after any firmware change AND after any change in `comms/` or `companions/`.

```bash
PYTHONPATH=. python -m companions.hil_companion_demo
```

---

## What this directory deliberately does NOT contain

* **No GUI.** The old PySide6 `control_center.py` was a v1 monitor for
  the operator-podium ↔ server point-to-point link. It's gone.
* **No fire-station emulator.** FW-SPEC-001 is its own firmware on its
  own transport; the radio mesh has no fire path.
* **No long-range control surface emulator.** That hardware will ship
  with its own firmware later and join the mesh as a `captain`-role
  client driving the same `cmd` allowlist that `client_companion.py`
  uses today.
* **No raw-LoRa v1 podium / server companions.** The protocol is v2-only
  on this branch.

If you find yourself wanting to add code in any of those four buckets,
that work belongs in a different subsystem — please talk to the rest of
the camp before reintroducing it here.
