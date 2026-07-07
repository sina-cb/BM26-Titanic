# Views Rehaul — Master Tracking Checklist

Branch: `dev/claude/views_rehaul` (BM26-Titanic + MarsinLED). Status as of 2026-06-19.
This is the source-of-truth checklist for the views/fixture-type/LED/Tier-C arc.
An item is DONE only when its acceptance test passed and it is pushed.

## DONE — shipped & pushed

| # | Item | Where | Acceptance |
|---|------|-------|-----------|
| 1 | Fixture-type metadata + `FIX_*` builtin (Tier-A + Tier-B) | both repos | `27_swipe` runs cross-model; WASM-boundary type select exact |
| 2 | Named masks / unbounded MaskRegistry (`members[]`) | BM26 | host-side views unbounded, bit-free |
| 3 | MarsinScript in-VM strings (`==`/`!=`) | MarsinLED | compiled-WASM tests green |
| 4 | Perf gauge + validation harness | BM26 | fail-loud thresholds + golden-hash oracle |
| 5 | Mixer atomic view-selection + loud unknown-view | BM26 | HTTP 400, no half-applied state |
| 6 | LED↔DMX parity (controller type, RGBW out, white viz, strand views) | BM26 | strands lit white + animate; per-strand/L-R views zero-leak |
| 7 | LED strand "Show Guides" toggle (pixels-only) | BM26 sim | guides hide, pixels remain |
| 8 | Test Auto-Patch + Clear All Patches | BM26 sim | one-click whole-rig patch; rig lights; clear wipes |
| 9 | Titanic model audit + view-gen suggestions | report | — |
| 10 | **Tier-C firmware** — `viewMaskHi` (62 in-VM views), bulletproof | MarsinLED `e915c23` | 2 indep reviews + 2 adversarial passes (1 real BLOCKER caught+fixed) → CLOSED |
| 11 | Tier-C host integration (7-lane meta, 2-word alloc, inlined-literal injector) | BM26 `94dec87` | 62-view e2e: hi/low word select exact, zero cross-word leak |
| 12 | Whole-ship auto-view catalog (`deriveAutoViews`) | BM26 `7c2fc3e` | 31 auto-views on titanic, bit-free, exact membership |
| 13 | Art-Net output transport (sACN + Art-Net, no DDP) | BM26 `760f38b` | ArtDMX byte-asserted + loopback proven |
| 14 | True per-pixel `localIndex` from exporter | BM26 `3f3559b` | sweep-along-bar in pixel order; partial-carry throws |
| 15 | `inView("Name")` intrinsic + on-demand bit promotion | BM26 `2ee383a` | bit-free view promotes + selects exact via vendored WASM |
| 16 | Sim sACN auto-subscribe + brighter titanic (0.05→0.7) | BM26 `e3daddc` | patched universes auto-subscribe, no MISMATCH banner |

Final union state: engine **898/898**, sim **118/118**, all golden hashes stable.

## REMAINING — follow-ups (none block the branch)

### Hardware / operator config (NOT engineering tasks)
- [ ] **ESP32 `pio run`** across all 5 firmware envs (`esp32dev`, 3× S3 boards) on a registry-reachable build host — verify the Tier-C firmware LINKS + flash/RAM footprint. Could not be done in-sandbox (network allowlist blocks the PlatformIO registry). **Required before flashing.**
- [ ] **Real titanic patching** + bind a real **LED controller** to the 16 strands (real IPs/universes/topology). Test Auto-Patch is a test tool only; the committed titanic model stays unpatched by design.
- [ ] **Re-export** test_bench/titanic models to pick up the new exporter `localIndex` field (legacy heuristic works until then).
- [ ] **Real Art-Net hardware** confirmation (packet format + routing are unit-proven only).

### Engineering follow-ups (nice-to-have)
- [ ] **sim→engine controllers bridge** — the engine reads transport/routing from `config.yaml.controllers`; wire the sim's per-controller protocol/LED config through to the engine model export (surfaced by the Art-Net work).
- [ ] **Pin emsdk version** for the vendored WASM + refresh the embedded build-tag string (currently shows `4a30497`; behavior verified `e915c23` — functional no-op).
- [ ] **Per-fixture (vs group) high-view UI authoring** in the sim Views panel (group-based + engine path complete).

### Process
- [ ] Open PRs for both repos (cross-repo MarsinLED↔BM26 dependency noted) + watch CI — on operator request.
- [ ] File these follow-ups as Notion cards if the connection is enabled.

## Explicitly deferred
- Tier-C bit-widening beyond 62 — not needed (titanic uses 28; Tier-C gives 62).
- DDP/WLED-native transport — operator decided sACN + Art-Net is the ceiling.
