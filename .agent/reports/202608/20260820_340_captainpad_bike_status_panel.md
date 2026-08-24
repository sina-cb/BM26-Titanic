# 340 — CaptainPad bike color link status panel

> Wave: `feat/bm_readiness` working tree, 2026-08-20. Manager-verified.
> Scope: CaptainPad client ONLY — consumes the engine surface built in
> report `_336` (`GET /bikes`, `POST /bikes/config`). Nothing under
> `marsin_engine/`, `simulation/`, or `CaptainPad/live_touch/` was touched;
> the 37-pin gate file (`components/deck/colors_window_wiring.test.ts`) was
> not modified. No git operations; nothing committed or staged. No operator
> service (:6967 Expo, :6968 engine) was launched, killed, or contacted —
> verified before every probe (nothing was listening on 6967/6968).

## What landed

A compact, read-focused **BIKE COLOR LINK** status card on the **Config
tab**, showing the engine's bike color-share registry live: per bike —
`controllerId`, link state (`LINKED / DISCOVERED / STALE / UNSUPPORTED /
GONE`) as a color-coded pill, address, firmware tag + active pattern, lease
`msRemaining`, last-seen age, and push ok/failed tallies — plus a global
sweep/push/overrun stats footer, the feature's ENABLED/DISABLED state, and
an enable/disable control wired to `POST /bikes/config`. Disable goes
through an `opConfirm` sheet whose copy states plainly that bikes revert to
their **own** colors within ~60 s (firmware lease expiry — no revert
traffic); the same fact sits permanently under the control as a hint line.

Every reachable condition renders an EXPLICIT honest state (codex P0 — no
silent empty list, no fallback data):

| Condition | What the card shows |
|---|---|
| Engine build predates `/bikes` (HTTP 404) | "This engine build predates the bike link — restart the engine on the new build to see bikes here." Controls hidden. |
| Feature module unavailable (503) / network failure | Error row with the engine's message (or transport error); pill UNAVAILABLE; controls hidden. |
| Disabled | "Bike color link is off. …bikes are running their own colors." + ENABLE control. |
| Enabled, zero bikes, targets configured | "Scanning `<targets>` — no bikes found yet." |
| Enabled, zero bikes, NO targets | "Enabled, but no scan targets are configured — nothing to scan. Set targets to start discovery." |
| A poll fails after a good snapshot | Last good snapshot stays on screen with a visible error row layered on (never silently blanks; the `unavailable` body suppresses the duplicate row). |

The card polls `GET /bikes` every 3 s while mounted (immediate first fetch,
interval cleared on unmount, alive-guarded). Writes are NOT optimistic: the
toggle waits for the engine's answer, then re-polls; a rejection surfaces
via `opError` — the card never shows a value the engine never accepted.

## Placement rationale

The Config tab is where CaptainPad's operational status + engine feature
surfaces already live: the Connection Status card (live engine data), the
Engine Settings card (AUTO-SAVE / BOOT MODE — engine-side feature toggles
over `GET/POST /settings`), and Network Discovery. The bike link is exactly
that family — an engine-side feature with a status readout and one toggle —
so the card renders immediately **after `EngineSettingsCard`** in
`app/(tabs)/config.tsx` (Section 1a-2). No new route, no tab-policy change,
no new navigation paradigm; `PerformanceRouteGuard` on Config gates it in
show mode like its neighbors. No test pins config.tsx source, so the
insertion is structurally safe.

## Files

| File | Change |
|---|---|
| `CaptainPad/utils/api.ts` | Appended (pure append at EOF): `BikeLinkState`, `BikeShareConfig`, `BikePushStats`, `BikeSnapshot`, `BikeShareStats`, `BikesSnapshot` types; `FetchBikesResult` discriminated union; `fetchBikes()` (checks `res.status` — a bare 404 is decided from status alone and never `res.json()`ed, since a pre-feature engine's 404 body isn't JSON-guaranteed); `setBikesConfig()` (mirrors `setEngineSettings`'s fail-loud posture) |
| `CaptainPad/components/bike_link_logic.ts` | NEW — pure logic, no RN imports: `derivePanelState` (6-state union incl. keep-last-good-on-failed-poll), `sortBikes` (LINKED → DISCOVERED → STALE → UNSUPPORTED → GONE, stable by controllerId), `bikeVisualRole` (token ROLES, not hex: tertiary/primary/warning/error/icon), injected-clock formatters (`formatLeaseRemaining`, `formatAge` with negative-skew clamp, `formatPushStats`), and ALL operator-facing copy pinned as exported constants |
| `CaptainPad/components/bike_link_logic.test.ts` | NEW — 30 vitest tests, mock payloads only |
| `CaptainPad/components/BikeColorLinkCard.tsx` | NEW — the card. Matches the Config-tab idiom exactly (`useGlobalStyles`/`usePalette` tokens, `IconSymbol`, caps SpaceGrotesk headers, Inter body, the EngineSettingsCard pill-pair + error-row recipes). No `flex: 1` inside auto-height parents (report `_333`'s Fabric/Yoga rule) — rows use `width:'100%'` + `justifyContent:'space-between'` |
| `CaptainPad/app/(tabs)/config.tsx` | Import + `<BikeColorLinkCard />` after `<EngineSettingsCard />`, matching the file's section-comment style |

Icon: the already-mapped `network` SF symbol (→ Material `lan`) — no
`bicycle` mapping exists in `icon-symbol.tsx`, and reusing a mapped glyph
kept the change inside the intended file set (`IconSymbolName` is
compile-time checked, so an unmapped name would not even typecheck).

## Gates — all personally re-run by the wave manager

| Gate | Result |
|---|---|
| Full suite BEFORE (baseline) | **156 files, 2699 passed / 6 skipped (2705)** |
| New logic tests (run directly) | **30/30 pass** |
| Full suite AFTER (final state) | **157 files, 2729 passed / 6 skipped (2735)** — baseline + exactly the 30 new tests, zero regressions (re-run after every late edit; final run 16:35 local) |
| `npm run typecheck` (tsc --noEmit) | clean, exit 0 (re-run on final state) |
| ESLint on the 5 touched files | **0 errors; 0 wave-introduced warnings.** Remaining warnings pre-existing on untouched lines: `config.tsx:91` (mount-only effect deps, deliberate), `api.ts` `Platform`-unused + five `Array<T>` styles (lines 1–1578; our api.ts change is a pure append at line 3369) |
| `npm run web:build` | exports clean, `/config` route built (71 kB) — rebuilt after final edit |
| Port hygiene | probes used only :7167 (documented dist convention) + loopback 127.0.0.1:17569 (the 17560+ e2e band); both released after capture; zero references to 6966-6972/6981/5568 in new files (grep) |
| Public-repo hygiene | IP grep over new files: only RFC1918 doc-style `10.1.1.x` fixtures (the family config.tsx already uses as its own example) — no real rig addresses, no MACs, no secrets, no future dates |
| Operator services | never launched, killed, or contacted — nothing was listening on :6967/:6968 at any point during probes (netstat-verified before serving) |

## Visual evidence — visually inspected

Captured via puppeteer (repo technique: console muted pre-boot, 1180×820
iPad-landscape viewport) against a **fresh `npm run web:build` dist served
on :7167** and a **loopback mock engine on 127.0.0.1:17569** — no operator
service was running or contacted. In `~/tmp/bike_link_card_screenshots/`
(gitignored):

- `01_engine_offline_unavailable.png` — no engine anywhere: pill
  UNAVAILABLE, one explicit "Failed to fetch" row, controls hidden. Also
  shows the card seated between BOOT MODE and APPEARANCE.
- `02_enabled_list_all_states.png` — all five states at once, in sort
  order: 2× LINKED (green pill, live lease 47 s/39 s), DISCOVERED (teal),
  STALE (amber, 4 failed pushes), UNSUPPORTED (red, v1.9.2, zero pushes),
  GONE (dim, seen 2 h ago); global stats footer (42 sweeps · 21 push
  cycles · 63 ok / 2 failed).
- `03_disable_confirm_sheet.png` — the `opConfirm` sheet (themed, in-app —
  never a browser dialog) with the full ~60 s self-revert copy and a
  destructive DISABLE action.
- `04_disabled_state.png` — after confirming: pill DISABLED, "Bike color
  link is off. 1 previously-seen bike is running their own colors.",
  ENABLE offered, revert hint persistent. This capture caught a real
  singular/plural grammar bug ("1 bike are") — fixed in logic + test and
  re-verified through every gate.

The disable round-trip in 03→04 ran live against the mock: sheet → confirm
→ `POST /bikes/config {enabled:false}` → re-poll → honest disabled state.

## Process notes

One Sonnet slice built the feature to a manager-frozen contract; the
manager independently re-ran every gate, live-verified the export in a
browser, and applied two fixes the slice's own gates couldn't see: the
duplicate error row in the `unavailable` state (body + poll-error row
showed the same message twice) and the `disabledMessage` singular-verb
grammar bug — both found by visual inspection of the captures.

**Cross-wave flag for whoever lands this branch:** `python
scripts/security_check.py --all` reports **zero findings in any of this
wave's files** (the 5 CaptainPad files + this report), but it DOES flag
`.agent/reports/202608/20260820_336_engine_bike_color_link_impl.md`
(`bm26-report-ip`, lines 144/152 — the TEST-NET example ranges in its
enable-instructions) plus the known pre-existing hits (a pre-wave
`.agent/memory` file and gitignored sim scene backups). `_336` is another
wave's handoff report, so it was flagged here rather than edited — but the
pre-commit gate will block staging it until those example IPs are reworded.

## What the operator does to see it live

1. Land/merge this wave, then bounce the launcher so the ENGINE picks up
   the `_336` `/bikes` routes (until then the card honestly reports the
   engine build predates the feature).
2. Rebuild/reload the pad (`npm run web:build` + the usual dist serve, or
   just reload the served pad once the dist is rebuilt).
3. Config tab → BIKE COLOR LINK (right under BOOT MODE). Set `targets` per
   `_336` (config.yaml or `POST /bikes/config`), then tap ENABLE. DISABLE
   asks for confirmation and reminds you bikes fade back to their own
   colors within ~60 s.

Follow-up candidates (Notion board): an in-card targets editor (today the
card reads targets; editing is REST/config.yaml per `_336`), and a
controllerId → friendly-name map if the firmware ever exposes one (the
payload deliberately has no name field today).
