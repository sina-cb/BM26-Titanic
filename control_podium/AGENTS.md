# AGENTS — Control Podium

If you are an agent picking this up, read this **first**. It's intentionally short.

## What you have in front of you

A multi-client LoRa mesh + Pi bridge for the TITANIC art car:

* **Mesh + secured channel** — multi-client mesh with a server-side
  bridge, role-based ACL, YAML-driven command allowlist, AES-128-GCM
  authenticated frames (`Titanic Frame v2`) with a per-source replay
  window, and a small two-app companion stack (captain client + bridge).
  Code: `comms/`, `companions/{client,bridge,mesh_demo,hil_secured_demo,hil_companion_demo}.py`,
  and the `.config.{nodes,commands,bridge}.yaml` files.
* **Production deployment topology** —
  ```
  [captain laptop] ──USB──→ Heltec 0x0A ───LoRa T2───→ Heltec 0x01 ──USB──→ [bridge laptop / Pi]
                                                                                     │
                                                                                     ▼
                                                                          LAN MarsinEngine (REST)
  ```
  Both companion apps hold the AES-128 key from
  **`marsin_engine/secret.yaml`** (one secret file shared with the engine
  and any future CaptainPad app); the firmware is a transparent ASCII byte
  relay (see `docs/07_control_podium.md` §3.6.8b for why firmware-side
  AEAD is deferred).

### Vocabulary (ship-themed)

| Role      | Old alias  | What it can do                                         |
|-----------|------------|--------------------------------------------------------|
| `captain` | `priv`     | Full command surface (`hlo`, `pin`, `qry`, `cmd`).      |
| `crew`    | `reg`      | Read-only. Can ping any captain to flag attention.      |
| `server`  | (unchanged)| The Pi bridge itself.                                   |

Old labels still work in YAML and on the wire as deprecated aliases.

## What this subsystem deliberately does NOT own

If a request lands in your lap that involves any of these, **stop and
re-scope** — they live elsewhere on purpose:

* **Cooldowns / rate limiting / slider debouncing.** Pacing is the
  captain UI's job (the `client_companion.py` interactive loop, and
  eventually CaptainPad). The bridge is the protocol, not the politeness
  layer.
* **Fire-effect commands.** The Flame Effect Controller (FW-SPEC-001) is
  separate firmware on separate hardware (WT32-ETH01) on a separate
  protocol. The radio mesh has NO fire path. As a guard, the bridge
  HARD-rejects any cmd containing `fire` regardless of role.
* **Long-range visual control surface internals.** Its own program / its
  own firmware. When it ships it will join this mesh as a `captain`-role
  client driving the same `cmd` allowlist below.

## First 60 seconds

1. **Read `docs/07_control_podium.md`.** This is the design doc. It's authoritative.
2. **Read `control_podium/README.md`.** Top-level orientation and where-to-look-for-what.
3. **Make sure the secret exists.** Every machine that runs an engine,
   bridge, or captain companion must have `marsin_engine/secret.yaml`.
   Copy `marsin_engine/secret.yaml.example` if needed and propagate the
   SAME content. Companions refuse to start without it.
4. **Run the mesh demo to prove your environment works:**

   ```bash
   cd control_podium
   PYTHONPATH=. ../.venv-dev/bin/python -m companions.mesh_demo -q
   ```

   Expect `ALL CHECKS PASSED — mesh is HIL-ready` and exit 0 in ~10 s.

5. **Run the test suite:**

   ```bash
   cd /Users/ssolaimanpour/workspace/BM26-Titanic
   PYTHONPATH=. .venv-dev/bin/python -m pytest control_podium/tests/ -q
   ```

   Run from the repo root with `PYTHONPATH=.` (the test imports use
   absolute paths like `from control_podium.comms.replay import …`).

6. **Verify firmware still compiles** (don't skip this even on Python-only changes):

   ```bash
   cd control_podium/firmware
   ../../.venv-dev/bin/pio run -e podium_tx -e server_rx
   ```

7. **(Optional, requires both Heltec V4s + LAN engine) Run the HIL demos:**

   ```bash
   cd control_podium
   PYTHONPATH=. ../.venv-dev/bin/python -m companions.hil_secured_demo
   PYTHONPATH=. ../.venv-dev/bin/python -m companions.hil_companion_demo
   ```

If any of the above fails on a clean checkout, **fix that before
changing anything else**. Don't build on a broken foundation.

## Where to make changes

| You want to…                            | Edit                                   |
|-----------------------------------------|----------------------------------------|
| Add a new node / client                 | `.config.nodes.yaml`                   |
| Pair / re-pair a USB MAC                | `firmware/deploy.py --node 0x… [--pair / --clear]` |
| Add a new command path                  | `.config.commands.yaml` + handler in `comms/bridge.py::_exec_cmd` |
| Disable a command in the field          | `.config.commands.yaml`: `enabled: false` |
| Change engine URL / pub cadence         | `.config.bridge.yaml`                  |
| Touch the wire format                   | `comms/frame.py` + bump version + new test vector |
| Change the AEAD layer                   | `comms/secure.py` + `tests/test_comms_secure.py` |
| Change the replay-window logic          | `comms/replay.py`                      |
| Add a role                              | `comms/acl.py` `_TYPES_BY_ROLE`        |
| Add an integration test                 | `tests/test_comms_e2e_sim.py`          |

**Rule of thumb:** YAML > code. Reach for code only when adding genuine
new BEHAVIOR. New nodes, new commands, new role gates → YAML.

## Hard rules (don't break these)

1. **No fire commands on the radio. Ever.** FW-SPEC-001 §1.4. The
   protocol has no fire path, the allowlist has no fire entry, AND the
   bridge denylists any `cmd` containing `fire` regardless of role.
2. **The shared secret stays gitignored.** `marsin_engine/secret.yaml`
   never goes into git. The example file (`secret.yaml.example`) is the
   only thing committed.
3. **No `marsin_engine/states/test_bench/*.yaml` in commits.** They're
   runtime artifacts. Revert them before `git add`.
4. **Firmware must compile** after every change in `firmware/`.
5. **No `2>&1` in shell commands.** Hides output context from the user.
   Either let stdout/stderr stream normally, redirect to a file with
   `> file`, or use the terminal-spec guidance.
6. **Don't reintroduce removed features.** Cooldowns, fire-station
   integration, control-surface emulator, raw-LoRa v1 companions, and
   the old `cli.py` were intentionally cut. If you find yourself wanting
   to add them back, talk to the rest of the camp first.

## Common pitfalls

* `python -m companions.mesh_demo` from the wrong directory or without
  `PYTHONPATH=.` ⇒ `No module named 'companions'`. Always cd into
  `control_podium/` and set `PYTHONPATH=.`.
* The pytest suite uses absolute imports — run it from the **repo root**
  with `PYTHONPATH=.`, not from inside `control_podium/`.
* HIL fixtures in `tests/conftest.py` are opt-in via `server_port` /
  `podium_port` fixtures. They auto-skip when `.config.nodes.yaml` has
  no `usb_mac` for the requested role, so running `pytest tests/` on a
  hardware-less machine "just works".
* SX1262 LoRa max payload is 255 bytes. After v2 AEAD wrapping each
  plaintext byte becomes ~1.34 ciphertext bytes, so `qry/cmd` reply
  args must stay under ~115 plaintext bytes to fit. The `engine/patterns`
  reply truncates to enforce this; if you add a new query that returns a
  list, mirror that pattern and add a regression test.
* Firmware RX: do NOT use `radio.receive(payload, 0)` — it's blocking
  (up to ~1.83 s) and resets the chip to standby on every call. Use the
  IRQ-poll pattern in `src/{podium_tx,server_rx}/main.cpp`:
  `radio.startReceive()` once at boot + `getIrqFlags() & RX_DONE`
  polling each loop.
* Counter restart: a captain that reboots starts its 48-bit per-source
  counter back at 0. The bridge accepts a single `hlo` to re-anchor its
  replay window (see §3.6.5); other frame types from a counter-rewound
  source are still rejected. If you change replay logic, keep this hook.

## Branch hygiene

This work lives on `dev/lora_work`. Don't merge to a release branch without:

1. Mesh demo passes (`companions.mesh_demo`).
2. Full unit/sim suite passes (`pytest control_podium/tests/`).
3. Both firmware envs compile (`pio run -e podium_tx -e server_rx`).
4. (When hardware available) HIL demos pass: `hil_secured_demo` + `hil_companion_demo`.
5. Design doc and the three READMEs (`README.md`, `comms/README.md`,
   `companions/README.md`, `firmware/README.md`) still reflect the actual code.

When in doubt, **read `docs/07_control_podium.md`** again. It's been
written carefully and is the source of truth for design decisions.
