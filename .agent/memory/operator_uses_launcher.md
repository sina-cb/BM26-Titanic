---
name: operator-uses-launcher
description: Sina always starts the system via the repo-root launcher.js — never hand-start engine/sim pieces for him.
type: preference
created: 2026-07-24
updated: 2026-07-24
---

The operator **always** launches the full system through the repo-root
`launcher.js` ("I use the launcher to launch the system always to avoid
issues"). It orchestrates sim + engine + bridges together.

**Why:** hand-started pieces drift (wrong flags, missing bridges, stale
env) — several 2026-07-24 flicker/route bugs were aggravated by
individually-started components.

**How to apply:** when the operator will run the stack, give launcher
instructions (`node launcher.js …`), not per-component commands. Agents
starting a stack for THEMSELVES should still prefer the launcher unless
a slice specifically requires an isolated component; and after killing
processes for the operator, hand back a launcher one-liner.
