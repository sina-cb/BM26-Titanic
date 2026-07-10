# now.md — State of Play

> Updated by any agent, any time state changes. Keep it under a screen.
> Absolute dates only.

_Last touched: 2026-07-10_

## Active branches

- **`main`** — integration branch. Push/merge is operator-gated.
- **`feat/led_integration`** — MarsinLED controller onboarding (discovery,
  per-output mapping UI, remote config push, engine dual-send). **Infra
  complete + tested (sim 190/190)**; awaiting the operator's manual UI
  mapping session on the test_bench + commit. Plan:
  `.agent/plans/20260709_0_led_integration_execution.md`; reference:
  `docs/41_led_controller_onboarding.md`.
- **`feat/views_rehaul`** — views-rehaul deliverable, awaiting merge.
- **`feat/titanic_agent_rework`** — this Agent OS migration, **in progress**.

## Active projects

- **agent_os_rework** — reworking `.agent/` into the Agent OS. See
  [`../projects/agent_os_rework.md`](../projects/agent_os_rework.md).

## Hot notes

- **gitleaks v8.28.0** must be on `PATH` for the commit security gate to
  run. Operator is installing it on the Windows machine (2026-07-06).
