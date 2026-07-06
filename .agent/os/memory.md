# memory.md — The Memory Protocol

Durable, **agent-agnostic** memory that survives sessions and context
compaction. It complements — never replaces — `reports/` (the long-form
record) and `plans/` (campaign ground truth). Memory is for the small,
load-bearing facts you'd otherwise rediscover the hard way next session.

## Format

One **fact per file** in `.agent/memory/`, named `<snake_or_kebab_slug>.md`,
with YAML frontmatter:

```yaml
---
name: agent-os-migration-2026-07
description: One-line hook — what this fact is, in a sentence.
type: decision        # decision | gotcha | hardware | preference | project
created: 2026-07-06
updated: 2026-07-06
---
```

Body: the fact itself. For `decision` and `gotcha` facts, add a **Why** line
(the reasoning) and a **How to apply** line (what to do about it). Link
related facts with relative links (`[other fact](other-fact.md)`).

## Index

`.agent/memory/MEMORY.md` holds **one line per fact**:

```
- [name](file.md) — one-line hook
```

At boot, agents load **only the index**, then open individual facts on
demand. Keep the index tight; it is the fast lookup, not the storage.

## Rules

- **Check before writing.** Search for an existing fact first — **update**
  it, don't duplicate.
- **Delete facts proven wrong.** A stale fact is worse than no fact.
- **Don't store what the repo already records.** No code, no git history,
  no restating a report. Memory is for what would otherwise be lost.
- **No secrets, ever.** No keys, IPs, MACs, or PII — this repo is public
  (`security_privacy.md` applies to memory too).
- **Absolute dates only.** `2026-07-06`, never "yesterday" or "last week".
