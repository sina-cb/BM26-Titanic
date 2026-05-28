# 14. Task Tracking

Lightweight, file-based task tracker for follow-up work that comes out of
code reviews, bug reports, audits, and operator conversations. No issue
tracker, no JSON, no DB — just one markdown file per task in a single
directory, so any agent (or human) can scan it with `ls`.

The tracker lives at:

```text
.agent/04_task_tracker/
.agent/04_task_tracker/done/
```

The top-level directory holds live work. Completed tasks are moved to
`done/` so `ls` of the top level shows only what's still open. Sequence
numbers are never reused — a task that comes back from the dead gets a
new file.

## File naming

```text
NNN_<priority-lowercase>_<short-kebab-slug>.md
```

- `NNN` is a zero-padded sequence number (`001`, `002`, …). Allocate the
  next free number; do not reuse a retired one.
- `<priority-lowercase>` is one of `critical`, `important`, `normal`,
  `low`. Encoding it in the filename lets `ls | sort` group by severity
  without opening files.
- `<short-kebab-slug>` is a 3–6 word identifier, kebab-case, that
  matches the human-readable title.

Example: `001_critical_engine-rest-ws-no-auth.md`

## Per-task file format

Every task file starts with a fixed header block, then a short body.
Keep the body tight — link out to the source report rather than
duplicating it.

```markdown
# <Human-readable title>

- **ID:** NNN
- **Priority:** CRITICAL | IMPORTANT | NORMAL | LOW
- **Status:** OPEN | IN_PROGRESS | DONE | WONT_FIX
- **Source:** <path or link to report / conversation that spawned this>
- **Location:** <file:line where relevant, or "n/a">
- **Created:** YYYY-MM-DD
- **Updated:** YYYY-MM-DD

## Description
One paragraph: what the issue is, in plain operator language.

## Suggested fix
Bulleted or short-prose fix direction. Cite the report's wording when
available; do not invent details.

## Why it matters
One paragraph: the operational consequence if this is left alone.

## Notes
Optional. Context that doesn't fit the slots above (operator
acceptances, scope deferrals, links to follow-up tasks, etc.).
```

## Priority taxonomy

- **CRITICAL** — fix before the next show. Stage-failure or
  remote-control / safety class.
- **IMPORTANT** — fix this week. High likelihood of biting under
  realistic operator workflow.
- **NORMAL** — known issue, scheduled fix. Has a workaround or low
  hit-rate.
- **LOW** — nice-to-have, deferred. Style, polish, post-event cleanup.

## Status taxonomy

- **OPEN** — not started.
- **IN_PROGRESS** — an agent or human has it.
- **DONE** — fix landed; file moved to `done/`.
- **WONT_FIX** — explicitly declined. Keep the file (do not delete) so
  future audits can find the reasoning; move it to `done/` with status
  `WONT_FIX` and a `## Resolution` block explaining why.

## How to add a new task

1. `ls .agent/04_task_tracker/` and pick the next free sequence number
   (highest live + highest in `done/`, plus one).
2. Choose a priority (`critical` | `important` | `normal` | `low`) and a
   3–6 word kebab slug.
3. Create `NNN_<priority>_<slug>.md` using the header block above.
4. Fill in `Source` with a path to the originating report (e.g.
   `.agent/02_reports/202605/20260527_1_code_review.md`) and `Location`
   with `file:line` if the issue is in code.
5. Commit the file with the work it tracks (or as a standalone commit
   if you're just triaging).

## How to close a task

1. Update `Status` to `DONE` (or `WONT_FIX`).
2. Bump `Updated` to today.
3. Add a `## Resolution` block at the bottom: what changed, commit SHA
   or PR link, and any caveats.
4. `git mv` the file into `.agent/04_task_tracker/done/`.

## How to reprioritize

Change the `Priority` field, bump `Updated`, and `git mv` the file to
its new priority slug (`001_critical_…` → `001_important_…`). Keep the
sequence number stable so cross-references in reports don't rot.
