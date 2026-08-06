/**
 * bench_mirror_control.js — pure render state for the BENCH MIRROR control that
 * lives in the TOP HEADER of the 🎛 Controllers view (report 20260805_155 §8).
 *
 * WHY IT MOVED THERE (operator ruling 2026-08-05). The control used to live in
 * the 📡 sACN IN monitor, which is rendered ONLY while the lighting engine mode
 * is `sacn_in` — and `sacn_in` is precisely the mode that turns every sim window
 * into a hard-coded priority-150 sACN writer to the ship's real controllers
 * (`src/core/animate.js`). So the operator could not arm the mirror without
 * being in the exact mode that outranked it at the box. That placement was part
 * of the defect, not incidental to it. The Controllers header is available
 * regardless of lighting mode, and the sACN monitor is demoted to read-only
 * status + logs with NO actionable control.
 *
 * Separate from the panel that renders it for one reason: the panel is a
 * Preact/htm module whose dependencies are vendored for the browser only, so it
 * cannot be imported by a Node unit test. Every decision the control makes —
 * which label, whether it is pressable, which scene it would arm, what the
 * tooltip explains, what refusal text must be visible — lives here instead,
 * where it is DOM-free and testable.
 *
 * The control is deliberately unable to GUESS. If the bridge has not reported
 * its state, if the bridge socket is down, or if more than one scene declares an
 * armable sidecar, the button is disabled and SAYS WHY next to itself: arming
 * re-addresses physical hardware and suspends the entire ship's output, and
 * picking a scene on the operator's behalf is exactly the silent default the
 * codex bans.
 */

/** How much refusal text renders inline before the tooltip carries the rest. */
const REFUSAL_INLINE_CHARS = 96;

function truncate(text, max) {
  if (typeof text !== 'string') return '';
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * @param {Object|null|undefined} status the bridge's last `benchMirrorStatus`
 * @param {{connected?:boolean}} [link] the :6971 socket's state. `connected:false`
 *        renders LINK DOWN — distinct from "connected but not yet told", which
 *        is UNKNOWN. Neither ever renders as OFF.
 * @returns {{statusText:string, noticeText:string, buttonLabel:string,
 *            disabled:boolean, action:('arm'|'disarm'|null),
 *            armScene:(string|null), title:string}}
 */
export function benchMirrorControlState(status, link) {
  const connected = (link && typeof link.connected === 'boolean') ? link.connected : null;

  if (connected === false) {
    return {
      statusText: '🪞 BENCH MIRROR: LINK DOWN',
      noticeText: '✋ no connection to the sACN bridge (:6971)',
      buttonLabel: 'ARM',
      disabled: true,
      action: null,
      armScene: null,
      title: 'The sim is not connected to the sACN bridge on :6971, so its bench-mirror state ' +
        'cannot be read or changed. If this persists, restart the launcher.',
    };
  }

  if (!status) {
    return {
      statusText: '🪞 BENCH MIRROR: UNKNOWN',
      noticeText: '✋ the bridge has not reported its state on this connection',
      buttonLabel: 'ARM',
      disabled: true,
      action: null,
      armScene: null,
      title: 'The sACN bridge has not reported bench-mirror state on this connection yet. ' +
        'If this persists, the bridge is running older code — restart the launcher.',
    };
  }

  const refusal = typeof status.refusal === 'string' && status.refusal.trim() !== ''
    ? status.refusal.trim() : '';

  // A blackout in flight — in EITHER direction (the arm's ship-dark zeros or the
  // disarm's bench release) — locks the control. The bridge refuses both gestures
  // in that window; the UI must not offer a button the bridge would refuse.
  if (status.blackoutInFlight === true) {
    return {
      statusText: '🪞 BENCH MIRROR: DISARMING…',
      noticeText: 'all-zero frames still going out',
      buttonLabel: status.armed === true ? 'ARM' : 'DISARM',
      disabled: true,
      action: null,
      armScene: null,
      title: 'A blackout is in flight: the bridge is sending its 3 all-zero frames and will not ' +
        'accept another arm or disarm until they have landed. Wait for the next line in the ' +
        'sACN IN monitor.',
    };
  }

  if (status.armed === true) {
    const dests = (status.destinations || []).map(d => `U${d.universe}→${d.ip}`).join(', ');
    const mapped = (status.selection || []).filter(s => s.source).length;
    const dark = (status.selection || []).length - mapped;
    return {
      statusText: `🪞 BENCH MIRROR: ACTIVE — ${String(status.label || status.scene).toUpperCase()}`,
      noticeText: `SHIP OUTPUT SUSPENDED · ${mapped} slot(s) mapped, ${dark} dark`,
      buttonLabel: 'DISARM',
      disabled: false,
      action: 'disarm',
      armScene: null,
      title: `The bridge composes ${dests} and ALL ordinary relay is suspended — the bench is ` +
        'the only physical output, and the sim\'s own output bridge is gated. DISARM sends 3 ' +
        'all-zero frames to each bench destination, then restores the full relay set and ' +
        'ungates the sim.',
    };
  }

  const available = Array.isArray(status.available) ? status.available : [];
  const base = {
    statusText: '🪞 BENCH MIRROR: OFF',
    buttonLabel: 'ARM',
    action: null,
    armScene: null,
  };

  if (available.length === 0) {
    const broken = (status.specErrors || []).map(e => e.scene).join(', ');
    return {
      ...base,
      noticeText: refusal ? `✋ ${truncate(refusal, REFUSAL_INLINE_CHARS)}` : '✋ nothing armable',
      disabled: true,
      title: broken
        ? `No scene has an enabled, parsable bench_mirror.yaml. Refused: ${broken}.` +
          (refusal ? ` Last refusal: ${refusal}` : '')
        : 'No scene declares an enabled bench_mirror.yaml.' +
          (refusal ? ` Last refusal: ${refusal}` : ''),
    };
  }

  if (available.length > 1) {
    return {
      ...base,
      noticeText: refusal
        ? `✋ ${truncate(refusal, REFUSAL_INLINE_CHARS)}`
        : `✋ ${available.length} candidates`,
      disabled: true,
      title: 'More than one scene declares an enabled bench_mirror.yaml ' +
        `(${available.map(a => a.scene).join(', ')}). The bridge will not pick one for you — ` +
        'disable all but the one you want.' + (refusal ? ` Last refusal: ${refusal}` : ''),
    };
  }

  const only = available[0];
  return {
    ...base,
    noticeText: refusal ? `✋ ${truncate(refusal, REFUSAL_INLINE_CHARS)}` : `${only.label} ready`,
    disabled: false,
    action: 'arm',
    armScene: only.scene,
    title: `Arm the '${only.label}' stand-in (${only.slots} slot(s)). Opens the picker so you ` +
      'can choose, per bench fixture, which fixture of the scene the ENGINE is running feeds ' +
      'it. While armed the bench is the ONLY physical output: all ship relay is suspended and ' +
      'zeroed, and the sim\'s output bridge is gated. Disarms automatically when this window ' +
      'disconnects.' + (refusal ? ` Last refusal: ${refusal}` : ''),
  };
}
