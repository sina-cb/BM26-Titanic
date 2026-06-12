# 2026-06-12 — Task tracking migrated to Notion

Operator (Sina) directed the move of all task tracking from the
file-based `.agent/04_task_tracker/` to the Notion board
**Titanic Lighting - Task Tracker** (Titanic's End workspace →
Camp Operations → Titanic Lighting):
<https://app.notion.com/p/titanicsend/9f241c2d454747859b149d738cc21bc8>

## What changed

- `.agent/00_gol/14_task_tracking.md` rewritten: Notion board location,
  data source ID, schema, card body format, add/close workflow, and the
  **Notion MCP access requirement** (the connection must be enabled and
  the Titanic's End workspace shared with it, or reads 404).
- `.agent/04_task_tracker/` deprecated. Tasks 001–013 preserved
  read-only in `migrated/`; `README.md` explains the move.
  **UPDATE (later same day):** operator directed full removal — the
  directory (including `migrated/`) was deleted outright. The old task
  files remain reachable only through git history.
- `CLAUDE.md` gained a "Task tracking (Notion)" section; the `.agent/`
  table row and etiquette bullet updated.
- `docs/33_controller_mapping.md` path reference to task 012 fixed.

## Sync state at migration

The board already mirrored repo tasks 001–007 (created there
2026-06-03, all Backlog). Cards for 008–013 were created 2026-06-12
with the repo bodies carried over verbatim plus migration notes:

- 008 CaptainPad tsc Modulation.tsx (High/Bug) — noted that the
  `'0s' as any` casts on main do not suppress TS2353; re-verify.
- 009 audio_config kickEma contract test (Medium/Bug) — re-verified
  still failing 1/506 on 2026-06-12; needs operator decision.
- 010 sACN :5568 bind contention (High/Bug)
- 011 titanic.viewmasks composite presets (Medium/Task) — noted overlap
  with the existing "[MarsinLED] Grouping/Zoning" card.
- 012 Logsville universe 7 mismatch (Medium/Bug)
- 013 model exporter name escaping (Medium/Bug)

Priority mapping used (now codified in spec 14): CRITICAL/IMPORTANT →
High, NORMAL → Medium, LOW → Low.

Board total after sync: 19 cards — the 13 repo tasks plus 6
Notion-native items (Global Effect Limiter check, Logsville model
grouping bug, modeling strategy updates, MarsinLED grouping/zoning,
iPad feedback updates, audio-analysis launch automation) that have no
repo history.

## Follow-ups (filed on the board, not here)

- Consider merging card 011 into "[MarsinLED] Grouping/Zoning".
- Repo reports written before 2026-06-12 still cite
  `.agent/04_task_tracker/NNN_*` paths; those files no longer exist
  (recoverable via git history). Historical reports were intentionally
  not edited — they are verbatim records of past state.
