"""Entry point: ``python -m server_bridge``.

The runtime now lives in this package (``server_bridge.runner``)
alongside the deploy tooling and systemd glue.
"""
from __future__ import annotations

# Make sure ``import comms.* / import utils.*`` resolves regardless of
# where this is launched from (dev laptop / `python -m` from
# `control_podium/`, or the Pi deployment which puts the whole
# `control_podium` directory on PYTHONPATH).
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_CP_ROOT = _HERE.parent  # .../control_podium
if str(_CP_ROOT) not in sys.path:
    sys.path.insert(0, str(_CP_ROOT))

from server_bridge.runner import main  # noqa: E402


if __name__ == "__main__":
    main()
