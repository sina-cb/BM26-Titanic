@AGENTS.md

**`AGENTS.md` is the canonical, agent-agnostic map** — mission, the Agent OS,
hard rules, repo map. Read it (and `.agent/codex.md`) first. This file holds
only the Claude Code–specific notes.

## Claude Code specifics

- **Security gate on Bash.** A PreToolUse hook runs
  `python scripts/security_check.py --hook-gate` before every Bash command;
  if the command is a `git commit`, it scans staged + tracked-unstaged
  changes and **blocks** the commit on any finding. Never bypass with
  `--no-verify`. Rules: `.agent/os/security_privacy.md`.
- **New clone setup.** Run `git config core.hooksPath .githooks` once so the
  `.githooks/pre-commit` security check is active.
- **Worktree session branches.** Claude Code worktree sessions start on
  auto-named branches — these are scratch. **Promote** durable work to a
  descriptive `feat/<snake_case>` branch (GitHub rename) or delete it; never
  keep an auto-named branch. Full rules: `.agent/os/git.md`.
- **Notion access** goes through the Notion MCP connection. If reads 404,
  ask Sina to enable the MCP connection and share the Titanic's End
  workspace — do not fall back to creating task files in the repo.
