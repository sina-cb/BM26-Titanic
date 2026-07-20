# Per-machine config overlays

An **overlay** is one machine's set of config **overrides** - the minimal diff
from the tracked repo config needed to run that physical rig. The tracked files
in the repo are the **default** config; a server that needs something different
(real controller IPs, a specific audio device) carries only those changed keys
in its overlay, and the deploy deep-merges them over the tracked tree on the
server. Full design:
[docs/43](../../docs/43_show_server_deployment.md).

> **Minimal-diff philosophy (operator ruling, 2026-07-20).** An overlay
> `.yaml` is a **fragment**, never a full copy of the tracked file. Put only
> the keys that differ from the tracked config in it. A full copy is banned -
> it silently rots when the tracked config changes and hides what a machine
> actually overrides.

## How it is applied

`deploy\deploy.py` applies overlays during a **prod deploy** (its overlay
phase, after the robocopy sync). For each file under this machine's overlay
dir:

- **`.yaml` files are MERGE FRAGMENTS.** The fragment is **deep-merged** over
  the same repo-relative tracked file, and the merged result is written to the
  destination:
  - **maps merge recursively** - keys you don't mention keep their tracked
    values;
  - **arrays and scalars REPLACE** - an overlay list (or string/number/bool)
    fully supersedes the tracked one; there is no element-wise list merge.

  The merge is done with the engine's own `js-yaml` (so it parses exactly like
  the engine does). A malformed fragment, an empty/`null` fragment, or a `.yaml`
  with no tracked base file at the same path is a **loud FAIL** - no silent
  fallback (codex P0).
- **Any non-`.yaml` file keeps full-copy semantics** - it is written
  byte-for-byte over the destination path (for the rare asset that must be
  replaced wholesale, not merged).

`set_boot.ps1` does **not** apply overlays (it only sets the boot scene + task);
overlays are a deploy-time concern so a local run can never diverge from what a
deploy produces.

### Missing or empty overlay = tracked config (the default)

A machine with **no overlay dir, or an empty one, is legal and normal** - it
runs the tracked config as-is. The deploy prints:

```
no overlay overrides - tracked config runs as-is (operator default)
```

The operator has ruled the tracked config is the correct default (2026-07-20),
so this is not a fallback - it is the intended path for any machine that needs
no changes. (Git cannot track empty directories, so a missing dir must be
legal.)

## Layout convention

```
deploy\overlays\<hostname-lowercase>\<repo-relative-path>
```

The path under `<hostname-lowercase>\` is exactly the path the file has in the
repo, so the merged result lands in the right place. Example (illustrative -
`titanic-int` does not currently need this):

```
deploy\overlays\titanic-int\
  marsin_engine\config.yaml      # ONLY the keys that differ from tracked
```

**`titanic-int` currently carries NO overrides** - its overlay dir does not
exist, and the tracked `marsin_engine\config.yaml` is exactly what it runs. Add
an overlay only when a machine genuinely needs a config key changed.

## What belongs in an overlay

Only the keys a machine changes from the tracked config. Typically for a show
server:

- **`marsin_engine\config.yaml`** as a fragment - e.g. real controller IPs
  under `controllers`/`sacn.destinations`, or the audio capture `device` for a
  box that does live audio. Write just those keys; everything else stays
  tracked-default via the deep-merge.
- `simulation\config.yaml` - only if a machine ever needs port changes (it
  should not; every server runs the ONE standard 6966-6972 port stack).

### VSN1 MIDI auto-deploy - now the default, no override needed

`vsn1.deployLayout` / `vsn1.deployOnBoot` used to be a per-machine choice set in
the overlay (defaulting off, because a server may have several ESP32/MIDI boards
on COM ports and auto-flashing the wrong one is a hazard). **As of the operator
decision 2026-07-20, VSN1 auto-deploy is the default TRUE everywhere**: the
tracked `marsin_engine\config.yaml` sets `vsn1.deployLayout: true` and
`vsn1.deployOnBoot: true`, and the engine reads that single file with no
per-scene override path. So `titanic-int` (and any other machine) needs **no
overlay override** to get auto-deploy - it is on by default. A machine that must
*not* auto-flash can pin it off with the `MARSIN_VSN1_DEPLOY=0` env var or a
fragment that sets `vsn1.deployLayout: false`.

## What NEVER belongs here

- **Secrets** of any kind - Wi-Fi/AP passwords, API keys, tokens. This repo
  is public and the security check blocks commits that carry them.
- **MACs** - the security check bans them; hardware pairing lives outside
  the repo.
- Anything machine-identifying beyond LAN hostnames/IPs.

## Adding a new machine

Create `deploy\overlays\<new-hostname-lowercase>\marsin_engine\config.yaml`
containing **only** the keys that differ from the tracked config for that box
(real controller IPs, audio device). Leave everything else out - the deep-merge
fills it from the tracked default. If a machine needs no changes, add no overlay
at all. Overlays take effect on the next `deploy\deploy.py deploy`.
