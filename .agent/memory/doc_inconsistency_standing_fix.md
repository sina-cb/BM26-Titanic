# Standing order: fix doc inconsistencies on sight

**Operator directive (Sina, 2026-07-30):** "if you find doc inconsistency,
fix and clean up."

When any agent finds tracked documentation (docs/, .agent/ops/, skills,
onboarding guides) contradicting the current code or hardware behavior,
fixing it is **sanctioned by default** — no per-instance operator approval
needed. Scope of the sanction:

- Correct the stale claim to match verified current behavior; cite the
  report or code that establishes the new truth.
- Clean up surrounding staleness found in the same pass (same doc or
  directly-linked docs), don't just patch one line.
- Standing P0s still apply: repo is PUBLIC (no secrets/IPs/future dates),
  MarsinLED firmware internals stay out (private repo), codex.md is
  Sina-only, no git operations.
- Substantive *policy* changes (what we intend, not what is) remain the
  operator's; this sanction covers descriptive truth only.

First application: docs/41 §3 documented linear single-base LED mapping
while hardware + sim push path are per-output only (found in report
20260725_56).
