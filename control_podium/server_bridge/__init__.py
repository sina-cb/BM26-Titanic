"""server_bridge — Pi-deployable Titanic radio↔engine bridge.

The bridge is the only piece of the system that has to run
unattended on a Raspberry Pi sitting in a road case, plugged into a
Heltec WiFi LoRa V4 over USB and reaching the MarsinEngine over WiFi.
It must:

* Boot itself on every Pi power cycle (systemd unit).
* Recover from USB unplugs / Heltec brown-outs without operator help.
* Recover from engine outages without operator help.
* Recover from network drops without operator help.
* Refuse to start as anything other than the ``server``-role node.

This package is the canonical home for that runtime + its deploy
tooling. The runtime lives in ``server_bridge.runner`` (moved out
of the historical ``companions/`` test-fixtures directory now that
the bridge ships to production).

Entrypoints (run from ``control_podium/`` or with
``PYTHONPATH=path/to/control_podium``):
    python -m server_bridge          # run the bridge
    python -m server_bridge.deploy   # deploy to a Pi

Design doc: ``docs/22_server_bridge.md``.
"""

__all__ = ["main"]
