# Per-machine config overlays

An **overlay** is one machine's real-deployment config, mirrored over the
repo tree so a show server runs the physical rig instead of the laptop's
dev defaults. The tracked files in the repo are the **design-station**
config (engine sACN to loopback, no physical controllers) - correct for
Sina's laptop, wrong for a box that has to light the ship. The overlay is
how a server gets its own truth without forking the tree. Full design:
[docs/43](../../docs/43_show_server_deployment.md).

## How it is applied

`deploy\set_boot.ps1` copies every file under this machine's overlay dir
over the repo root, preserving relative paths (`Copy-Item -Force` per file),
after it writes the manifest and ensures the boot task. No overlay dir is a
loud WARN (the machine then runs the tracked laptop/dev config), not a
failure - a sim-only box is legitimate.

> INTERIM: per docs/43 this belongs to the Phase 2 `deploy.py` pipeline
> (phase 4, applied after the robocopy sync). `set_boot.ps1` covers the gap
> until that lands, and the step moves there when it does.

## Layout convention

```
deploy\overlays\<hostname-lowercase>\<repo-relative-path>
```

The path under `<hostname-lowercase>\` is exactly the path the file has in
the repo, so it lands in the right place when mirrored. Example:

```
deploy\overlays\titanic-int\
  marsin_engine\config.yaml      # this machine's real engine config
```

`titanic-int\` is the live example - the first interior show server.

## What belongs in an overlay

- **`marsin_engine\config.yaml`** - the whole file (overlays REPLACE a file,
  they do not deep-merge, so it must be complete). For a show server:
  - real controller IPs in `sacn.destinations` (the tracked file points at
    `127.0.0.1` loopback);
  - `vsn1.deployLayout: false` - a server must never auto-flash a VSN1 that
    happens to be on a COM port;
  - the audio capture `device` for that box, if it does live audio.
- `simulation\config.yaml` - only if a machine ever needs port changes (it
  should not; every server runs the ONE standard 6966-6972 port stack).

## What NEVER belongs here

- **Secrets** of any kind - Wi-Fi/AP passwords, API keys, tokens. This repo
  is public and the security check blocks commits that carry them.
- **MACs** - the security check bans them; hardware pairing lives outside
  the repo.
- Anything machine-identifying beyond LAN hostnames/IPs.

## Adding a new machine

Copy an existing overlay dir to `deploy\overlays\<new-hostname-lowercase>\`,
then edit `marsin_engine\config.yaml` for that box - real controller IPs,
`deployLayout: false`, its audio device. Then run `deploy\set_boot.ps1` on
that machine.
