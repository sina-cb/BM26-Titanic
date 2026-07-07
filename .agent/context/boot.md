# boot.md — Session Boot Sequence

Run this in order at the **start** of every session. Boot yourself — don't
ask what to read (`os/autonomy.md`).

1. **`.agent/codex.md`** — the holy word. Mission and P0 rules.
2. **`.agent/README.md`** — the map + the precedence stack.
3. **`.agent/context/now.md`** — the current state of play.
4. **`.agent/memory/MEMORY.md`** — the fact index. Open the facts relevant
   to your task; don't load them all.
5. **Your role brief in `.agent/roles/`** — adopt the matching role's
   mindset and checklist (coordinator, developer, subsystem expert, …).
6. **The laws your task touches** (`.agent/os/`):
   - `git.md` — **always**, if you'll commit.
   - `security_privacy.md` — **always**, if you'll commit (public repo).
   - `python_style.md` / `nodejs_style.md` — if you'll write code.
   - `multi_agent.md` — if you'll fan work out to sub-agents.
7. **The `ops/` runbooks + auto-checks** for **every subsystem you'll
   touch** — how to run it, and the checks that prove it works.
8. **The active project dossier in `.agent/projects/`** and its plan in
   `.agent/plans/`, if you're advancing a campaign.

## At session END

Close the loop — leave the OS better (`os/autonomy.md`):

- **Update `context/now.md`** if the state of play changed (branches,
  projects, hot notes).
- **Write `memory/` facts** for anything durable you learned (follow
  `os/memory.md`; update the index).
- **Write a report** in `reports/YYYYMM/YYYYMMDD_N_slug.md` if you're
  handing off or concluding an investigation.
- **File follow-ups** on the Notion task board (`os/task_tracking.md`) as
  `Backlog` cards — don't leave loose ends only in your own head.
