"""HIL-local pytest hooks (marks, shared fixtures).

Register custom marks here so pytest does not emit warnings when
optional plugins (e.g. pytest-timeout) read ``@pytest.mark.timeout``.
"""

from __future__ import annotations


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "timeout(seconds): optional per-test wall-clock limit "
        "(requires pytest-timeout; harmless if absent).",
    )
