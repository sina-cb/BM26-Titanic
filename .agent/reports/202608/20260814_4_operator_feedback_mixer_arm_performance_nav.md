# Operator feedback: Mixer, Live ARM, Performance navigation

**Date:** 2026-08-14  
**Worktree:** `live_touch_bm_readiness_rebase`  
**Branch:** `dev/bm_readiness_local`  
**Runtime:** deliberately stopped; no operator service was started or restarted.

## Delivered

### Mixer narrow-screen scrolling

The Mixer now carries a bounded `minHeight: 0` layout contract from its content
wrapper through the channel card and playlist/parameter columns. The existing
playlist ScrollView owns the space above the fixed MUTE/SOLO and transition
rows, so patterns no longer render underneath those controls on short desktop
viewports. Fader and gesture behavior was not changed.

### Live Touch ARM

ARM was failing before lease acquisition because the checked-in 2D chart
artifact was stale against the authored Titanic pixel-map view. The artifact
was regenerated and the browser lifecycle gate now starts an isolated
auth-required engine, enters global Performance, arms Live Touch, proves the
`live_touch` layer, disarms, and proves the Deck landing.

### Performance and Edit access

Global Performance now exposes only Deck, Mixer, and Live Touch. Every other
route is guarded before its content mounts, including direct/deep links.
Successful privileged authentication presents the explicit action to end
global Performance and return to Edit.

The private deployment credential file was inspected only structurally. Its
Sina credential entry is now syntactically normalized. Credentials are loaded
only at engine boot, so a process that cached an older malformed value must be
cleanly restarted before the corrected value can authenticate. No credential
value was printed, copied into this repository, or used in a non-isolated run.

### Audio Companion and Simulator lifecycle

Audio Companion is an embedded view within the existing Audio tab in Edit
mode; the standalone Companion tab/route is removed. Navigating away from
either Companion or Simulator explicitly stops/unloads the native WebView and,
on web, first navigates the iframe to `about:blank` and then removes it. Their
analyzer/render loops and server streams therefore do not remain mounted in
the background.

## Verification

- CaptainPad TypeScript: pass.
- Focused Mixer/policy/access/embedded lifecycle suites: 21/21 pass.
- Full CaptainPad suite: 1078 pass, 6 hardware skips.
- CaptainPad lint: 0 errors, 13 pre-existing warnings.
- CaptainPad web export: pass, 27 routes; no standalone
  `/audio_companion` route.
- Pixel artifact current check: pass.
- Pixel projection/preview suite: 16/16 pass.
- Browser Live Touch ARM lifecycle with auth required and Performance active:
  pass.
- Isolated engine authentication suite: 10/10 pass, including restart token
  invalidation and fresh authenticated exit from Performance.
- Public-repository security scan: pass.

## Live acceptance findings and repairs

The first clean-stack pass deliberately remained closed because it found four
issues that isolated tests had not exercised:

- A crash-relocked Performance show correctly rejected the launcher's
  unconditional Edit-only `POST /pattern`, causing the otherwise healthy stack
  to self-stop. The launcher now reads `/performance-mode`: it preserves and
  loudly reports an active crash lock, reasserts the boot pattern only in Edit,
  and fails loudly on malformed state. The full launcher supervision suite is
  16/16.
- GO LIVE reached the engine but CaptainPad waited only for a WebSocket echo,
  leaving its sidebar in Edit. The accepted POST response now reconciles the
  shared Performance state immediately and is followed by a REST re-seed.
- The portrait Mixer rule still expanded its playlist under the fixed action
  rows. The final live 344x848 geometry has a 0-4206 scroll range, playlist
  y=551-597, and fixed actions beginning at y=672; overlap is false.
- Live Touch previously required two panels to remain expanded. It now allows
  one, removes the unused grid row, and lets the survivor fill the workspace.

Post-restart real-stack proof:

- all launcher services healthy; about 7,400 sACN packets/5s reach the sim;
- Performance sidebar contains exactly Deck, Mixer, and Live Touch;
- privileged login returned HTTP 200 and authenticated KEEP exit returned HTTP
  200, after which the full Edit sidebar reappeared; no credential or token was
  emitted;
- Live Touch ARM landed `live_touch` with an owner/session, DISARM landed Deck
  and cleared the owner;
- Audio Companion mounted inside Audio and disappeared from the DOM after
  navigating to Deck;
- 2D Simulator mounted on its route and disappeared from the DOM after
  navigating to Deck;
- current SIZE warning is null and render health is good.

Evidence:

- `.agent_renders/20260814_mixer_narrow_scroll_fixed.png`
- `.agent_renders/20260814_performance_only_nav.png`
- `C:/Users/Titanic's End/tmp/live_touch_grid_live_proof/captainpad_one_panel_full_workspace.png`

## Clean-launch acceptance

1. Start `node launcher.js dev --scene titanic` from this worktree.
2. Hard-reload CaptainPad once so no previous Metro/web bundle remains.
3. On a short desktop viewport, verify the Mixer playlist scrolls above the
   fixed channel and transition controls.
4. Enter global Performance and verify only Deck, Mixer, and Live Touch remain.
5. Authenticate through the Performance/Edit control and choose the explicit
   global Edit action; verify all Edit routes return.
6. In Edit, open Audio and select its Companion view. Navigate away and verify
   its embedded document is unloaded. Repeat with Simulator.
7. Reload Live Touch once, ARM it, verify the Live layer lands, then disarm and
   verify Deck lands.

## Separate merge blockers still open

- Titanic globals contain 30 orphaned historical dimmer keys. They require an
  operator-authored archive/removal decision; no mapping was guessed.
- `playa_default.yaml` still needs explicit operator-authored autopilot values
  for sunrise, burn-night, and temple program actions. Defaults were not
  invented because a wrong choice can freeze one pattern for 90–120 minutes.
