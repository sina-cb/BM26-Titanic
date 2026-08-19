# Live Touch and Four-iPad Handoff

Use this document to start a fresh agent on Live Touch work. The target branch
is `feat/bm_readiness`. Commit `7dda9d9` is the latest pushed, validated
checkpoint.

## Product intent

Live Touch is the manual performance surface embedded in CaptainPad. It controls
the MarsinEngine `live_touch` layer without borrowing Deck or Mixer state.

Four iPads may be connected at once, but they are not four competing writers.
Exactly one Live Touch page may hold the engine's ARM lease. Other iPads remain
connected and readable, but an ARM attempt must be refused until the current
owner cleanly disarms or its deadman lease expires.

This single-writer rule is a show-safety requirement, not a temporary
limitation.

## Non-negotiable contracts

- Every page creates a cryptographically random owner ID. Never use a device
  name, device identifier, clock value, or network address as the lease key.
- Opening Live Touch is passive. No show mutation is allowed before ARM.
- MarsinEngine is authoritative for connection, ownership, ARM, layer,
  Performance mode, and session state.
- Same-owner reconnect renews the existing lease. A different owner is refused.
- Disconnect, page close, crash, or background loss must trigger deadman
  recovery. Never leave the rig stuck in a manual look.
- DISARM completes owner-scoped cleanup before releasing the lease.
- Timeline priority may force-disarm Live Touch. Never auto-rearm afterward.
- Continuous controls are coalesced. Do not send display-frame-rate writes to
  the engine.
- The Live Touch palette is exactly five HSL/HSV colors at every boundary,
  including every transition frame.
- TAKE playback may mix several recordings inside the active owner's session,
  but it must not create additional engine owners.
- When the engine is unavailable, show a calm, intentional unavailable state.
  Do not expose raw JSON, fetch errors, or a half-interactive surface.
- CaptainPad is landscape-only. Every native React Native `Modal` must use
  `CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS`.
- Operator passcodes use the in-app hexadecimal keypad. Raw passcodes are not
  persisted. The optional 30-minute remember feature stores only an opaque,
  engine-issued waiver.
- No fallback behaviors. Refuse loudly when authority or capability is unknown.

## Architecture map

- `CaptainPad/app/(tabs)/index.tsx`: hosts the Live Touch WebView.
- `CaptainPad/utils/captainpad_auth_boot.ts`: hydrates and validates remembered
  operator authorization.
- `docs/ui/touch_control.html`: Live Touch shell and panel layout.
- `docs/ui/touch_control_wire.js`: engine protocol, ARM lease, spatial input,
  effects, palette, presets, and TAKE wiring.
- `docs/ui/touch_control_take_state.js`: one recording's state machine.
- `docs/ui/touch_control_take_bank.js`: multi-TAKE slot coordinator.
- `docs/ui/touch_control_take_playback_overlay.js`: display-only playback paths
  in the Spatial panel.
- `marsin_engine/lib/api_server.js`: HTTP and WebSocket authority.
- `marsin_engine/lib/live_touch_session_context.js`: owner-private Live Touch
  session state.
- `marsin_engine/lib/live_touch_session_palette.js`: exact-five palette and
  transition-frame validation.

## Current pushed checkpoint

Commit `7dda9d9` includes:

- Landscape orientation protection for every CaptainPad native modal.
- Touch-only operator keypad and engine-issued 30-minute passcode waivers.
- Correct operator auth headers and boot hydration.
- Regenerable native iOS build verification.
- Automatic rebuild of stale CaptainPad static exports at launcher startup.
- Reliable 2D pixel selection, drag, persistence, touch input, and ghost-layer
  cleanup.
- Engine-side Live Touch session palette validation.

The checkpoint passed CaptainPad typecheck, lint with no errors, 2,681 tests,
the iOS prebuild contract, focused engine tests, launcher tests, real browser
2D edit lifecycle tests, privacy checks, and the staged security scan.

## Uncommitted Live Touch work

The working tree currently contains unfinished work for:

- Color-transition timing and exact-five overlay frames.
- Transient Spatial contact-limit notices.
- Four TAKE slots and playback visualization.
- Brush-size remapping.
- Presets layout priority and recall preflight.

Do not assume these files are merge-ready. Known feature-cut blockers include:

- Playback overlay cleanup must accept legitimate `kind: "settle"` events.
- TAKE-bank tests need their fake clock injected into slot construction.
- Some browser contract tests still use stale Color Hub and synthetic event
  assumptions.

Keep this work separate from the pushed checkpoint until its focused suites are
green.

## Next implementation slice

1. Add an intentional Live Touch unavailable curtain driven by the validated
   engine endpoint and health state. Disable all controls while unavailable and
   recover automatically after a verified reconnect.
2. Finish the TAKE bank as four independent slots. Each slot needs record,
   play, loop, stop, and clear. Several slots may loop concurrently.
3. Render every active TAKE in Spatial with distinct, subtle playback paths.
   The overlay is display-only and must never synthesize extra engine writes.
4. Keep TAKE scheduling deterministic. One slot's stop or clear must not affect
   another slot.
5. Compact the Deck and Mixer effects bar without changing control semantics or
   touch target minimums.
6. Repair the outstanding tests, then run the full Live Touch engine and browser
   suites.

## Four-iPad acceptance matrix

Validate with four independent CaptainPad sessions:

1. All four connect and display engine state while DISARMED.
2. Session A arms successfully.
3. Sessions B, C, and D are refused with a clear "another panel holds the desk"
   message and cannot write.
4. A short reconnect from A renews the same lease without reseeding or
   interrupting active effects.
5. If A disappears beyond the grace period, the engine reverts safely and one
   of B, C, or D can then arm.
6. A can loop multiple TAKE slots concurrently; stopping one leaves the others
   running.
7. B, C, and D may observe authoritative state but cannot alter A's TAKE bank or
   owner-private session.
8. When the engine is unavailable, all four show the designed unavailable
   state, no raw error, and no enabled mutation controls.
9. Opening passcode, playlist, color, timeline, and confirmation sheets never
   rotates or terminates the app.
10. DISARM clears active effects, spatial contacts, TAKE playback, and private
    session state before releasing ownership.

## Validation and commit boundaries

- Do not commit `marsin_engine/states/**`.
- Do not commit local reports, device details, network details, credentials, or
  generated deployment identifiers.
- Preserve unrelated dirty-tree work.
- Run touched subsystem checks and
  `python scripts/security_check.py --staged` before every commit.
- Do not claim four-iPad compatibility from unit tests alone. Complete the
  four-session ownership matrix and physical-iPad acceptance.
