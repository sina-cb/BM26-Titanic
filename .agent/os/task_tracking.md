# 14. Task Tracking

Follow-up work that comes out of code reviews, bug reports, audits, and
operator conversations is tracked in **Notion**, not in the repo.

> **DEPRECATION NOTICE (2026-06-12):** the file-based tracker that
> lived at `.agent/04_task_tracker/` is deprecated and the directory
> has been removed. All of its tasks (001–013) were migrated to the
> Notion board on 2026-06-12. Older reports may still cite
> `.agent/04_task_tracker/NNN_*` paths — those files are gone; the
> task content lives on the board, and the original files remain
> reachable through git history if ever needed. Do **not** recreate
> task files in the repo.

## Where the tracker lives

- **Database:** `Titanic Lighting - Task Tracker`
- **Workspace:** Titanic's End (Notion), under
  *Camp Operations → Titanic Lighting*
- **URL:** <https://app.notion.com/p/titanicsend/9f241c2d454747859b149d738cc21bc8>
- **Data source ID** (for MCP page-creation calls):
  `collection://7f6eba92-4609-4adc-9ce5-02192879ed6f`
- **Views:** *Kanban Board* (grouped by Status, sorted by Priority) and
  *Default view* (flat table).

## Access requirement — Notion MCP must be enabled

Agents reach the tracker through the **Notion MCP server**. Two things
have to be true before any read or write works:

1. The session must have the Notion MCP connection enabled (Claude
   Code: the Notion connector/MCP server configured and connected).
2. The **Titanic's End workspace** content must be shared with that
   integration. If the database is not shared with the connection, the
   fetch fails with a `404 object_not_found` even though the page
   exists.

If you get a 404 on the tracker URL: **do not** conclude the tracker is
gone, and do not fall back to creating files in the repo. Tell the
operator (Sina) that the Notion MCP connection needs to be enabled /
the database needs to be shared with the integration, and wait. (This
exact failure was observed on 2026-06-12; access worked after Sina
enabled it — nothing was wrong with the URL.)

## Board schema

| Property | Type | Values |
|---|---|---|
| Name | title | Human-readable task title |
| Status | select | `Backlog` · `To Do` · `In Progress` · `In Review` · `Done` · `Blocked` |
| Priority | select | `High` · `Medium` · `Low` |
| Type | select | `Story` · `Task` · `Bug` · `Chore` |
| Assignee | person | optional |
| Due Date | date | optional |
| Notes | text | short freeform, body carries the detail |

Mapping from the old repo taxonomy (used during migration, keep using
it for severity judgement): `CRITICAL` and `IMPORTANT` → **High**,
`NORMAL` → **Medium**, `LOW` → **Low**. The old CRITICAL nuance ("fix
before the next show, stage-failure class") goes in the card body and,
when known, a Due Date.

## Card body format

Keep the structure the repo tracker used — it survives migration and
keeps cards greppable:

```markdown
**Source:** <path or link to the report / conversation that spawned this>
**Location:** <file:line where relevant, or "n/a">
**Created:** YYYY-MM-DD

## Description
One paragraph: what the issue is, in plain operator language.

## Suggested Fix
Bulleted or short-prose fix direction. Cite the source report's
wording; do not invent details.

## Why It Matters
One paragraph: the operational consequence if this is left alone.

## Notes
Optional. Operator acceptances, scope deferrals, related cards, etc.
```

Repo paths in card bodies (reports, file:line) stay relative to this
repository — the Notion board tracks the work, the repo stays the
source of truth for code and reports.

## How to add a task

1. Fetch the database first if you need to re-confirm the schema.
2. Create a page with parent data source
   `collection://7f6eba92-4609-4adc-9ce5-02192879ed6f`, setting `Name`,
   `Status` (new tasks: `Backlog`), `Priority`, and `Type`, with the
   body in the format above.
3. Reference the originating report path in **Source**, exactly like
   the repo tracker did.

## How to close a task

1. Set `Status` to `Done` (or `Blocked` with a Notes explanation if it
   is parked on an operator decision).
2. Append a `## Resolution` section to the body: what changed, commit
   SHA or PR link, and any caveats.
3. Declined work: set `Status` to `Done`, but the `## Resolution`
   section must say it was declined and why (the board has no
   `WONT_FIX` status — the body carries the reasoning so future audits
   can find it).

## Etiquette

- Check the board before starting new work — someone may already have
  the task `In Progress`.
- Operator-decision tasks (creative groupings, hardware re-patching)
  should say so explicitly in **Notes** so agents don't spin on them.
- Reports still live in `.agent/02_reports/` and remain the long-form
  record; cards link to reports, not the other way around.
