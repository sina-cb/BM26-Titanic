# Python Style Guide

The essential style rules for all Python code in this project.

## 1. Imports

- **All imports at the top of the file.** Never import inside functions, methods, or conditional blocks.
- **Never wrap imports in try/except.** A missing dependency must fail loudly at startup, not silently at runtime.
- **Order:** standard library → third-party → local modules, separated by blank lines.
- **One import per line** for clarity.

```python
# ✅ GOOD
import os
import time

from meshtastic.serial_interface import SerialInterface

from utils import config_store

# ❌ BAD — import inside function
def connect():
    from meshtastic.serial_interface import SerialInterface  # NO
    ...

# ❌ BAD — swallowing import errors
try:
    import some_lib
except ImportError:
    some_lib = None  # NO — this hides broken dependencies
```

## 2. Naming

| What | Convention | Example |
|------|-----------|---------|
| Modules, packages | `snake_case` | `config_store.py` |
| Functions, variables | `snake_case` | `find_port_by_mac()` |
| Classes | `PascalCase` | `TestMultiChannel` |
| Constants | `UPPER_SNAKE` | `HEALTH_CHECK_TIMEOUT` |
| Private / internal | `_leading_underscore` | `_normalize_mac()` |

## 3. Docstrings

- Every module, class, and public function gets a docstring.
- Use triple double quotes. First line is a summary, then a blank line, then details.

```python
def find_port_by_mac(mac):
    """Find the current COM port for a given MAC address.

    Scans all serial ports and matches by normalized MAC.
    Returns port string or None.
    """
```

## 4. Type Hints

- Use type hints on function signatures for public APIs.
- Use `Optional`, `list`, `dict` from `typing` for complex types.

```python
def find_port_by_mac(mac: str) -> str | None:
```

## 5. Functions

- Keep functions short and focused — one job each.
- Maximum ~40 lines per function. If longer, extract helpers.
- Use keyword arguments for functions with 3+ parameters.
- Return early to avoid deep nesting.

```python
# ✅ GOOD — return early
def process(data):
    if not data:
        return None
    # ... main logic

# ❌ BAD — deeply nested
def process(data):
    if data:
        if data.is_valid():
            if data.has_items():
                # ... buried logic
```

## 6. Error Handling

- Catch specific exceptions, never bare `except:`.
- Don't suppress errors silently — always log or re-raise.
- Use `finally` for cleanup (connections, file handles).

```python
# ✅ GOOD
try:
    iface = SerialInterface(port)
except serial.SerialException as e:
    print(f"Connection failed: {e}")
    raise

# ❌ BAD
try:
    iface = SerialInterface(port)
except:  # catches everything silently
    pass
```

## 7. String Formatting

- Use f-strings for all string formatting. No `.format()` or `%`.

```python
# ✅ GOOD
print(f"Connected to {name} on {port}")

# ❌ BAD
print("Connected to {} on {}".format(name, port))
```

## 8. Code Organization

- One class per file when classes are substantial.
- Related utilities go in a `utils/` package.
- Tests mirror source structure in a `tests/` directory.
- Config and constants at the top of the file, after imports.

## 9. Comments

- Explain **why**, not **what**. The code shows what — comments show intent.
- Use `# ──` section separators for visual grouping in long files.
- TODO comments include context: `# TODO(name): description`

## 10. Line Length and Whitespace

- Max 100 characters per line.
- 4-space indentation, no tabs.
- Two blank lines between top-level definitions.
- One blank line between methods in a class.
- No trailing whitespace.
