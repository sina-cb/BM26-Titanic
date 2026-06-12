# Logsville patches use universe 7 which is not in sacn_universes

- **ID:** 012
- **Priority:** NORMAL
- **Status:** OPEN
- **Source:** .agent/02_reports/202606/20260610_3_sim_owned_views_and_save_hardening.md
- **Location:** simulation/scenes/summer_camp_logsville/patches.yaml, sACN settings (sacn_universes)
- **Created:** 2026-06-10
- **Updated:** 2026-06-10

## Description
On every summer_camp_logsville boot, PatchManager logs:

```
🚨 UNIVERSE MISMATCH — Patches use universe(s) [7] but sacn_universes
only has [1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
```

Likely residue from the on-site repatching sessions (the stale-save bug,
now fixed). Fixtures patched to universe 7 receive no data from the
engine path.

## Suggested fix
Decide which is right with Sina: either re-patch the universe-7
fixtures onto a subscribed universe, or add 7 to the subscribed
universes (⚡ Lighting Engine → 📡 sACN Settings) and save.

## Why it matters
Silent dead fixtures at the next Logsville deployment if the patch is
actually live on hardware.
