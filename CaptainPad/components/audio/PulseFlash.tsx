// PulseFlash — a flashing dot for one-frame PULSE audio signals on the AUDIO
// tab, mirroring the Audio Companion's arm-on-rising-edge / decay envelope
// (companion_app.js: armPulse / tickFlash / tickLit).
//
// WHY THIS EXISTS
//   Many Companion CPC keys (micOnsetLow/Mid/High, audioChestHit,
//   audioDropCountdown, audioBeat, audioPhraseBoundary, audioTrackChange,
//   audioSwitchColor, audioSwitchPattern) are 30 Hz, ONE-FRAME pulses: they
//   snap to 1 for a single analyser hop on an event and sit at 0 otherwise.
//   Rendered as the normal [0,1] intensity BAR they flatline at ~0 — the
//   single-hop spike almost always lands BETWEEN the CaptainPad ~20 Hz param
//   polls, so the operator sees a dead bar that imperceptibly twitches
//   (Adv-D P2-A).
//
//   This component instead drives a DOT whose brightness is a hold+decay
//   envelope: the moment the live value crosses the arm threshold it snaps to
//   full, then eases back down over ~150-250 ms. A one-hop pulse therefore
//   stays clearly visible. Exactly the Companion's posture — armPulse sets the
//   flash to 1 on the rising edge, tickFlash/tickLit multiply it by a per-frame
//   decay each animation frame until it falls below a floor.
//
// CONGESTION-AWARE, OFFLINE
//   No new subscription: the parent already pulls the live value from the
//   throttled bus and hands it down as `value`. The envelope is computed
//   on-device in an rAF loop (decoupled from the WS cadence), and the loop
//   pauses itself when the tab blurs (`active`). No CDN, no new dep — pure RN
//   Views, themed via the caller-supplied palette colour.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';

// Rising-edge arm threshold — a pulse snaps from ~0 to 1, so 0.5 cleanly
// separates "fired" from "rest". Mirrors armPulse's `> 0.5 && prev <= 0.5`.
const ARM_THRESHOLD = 0.5;

// Per-frame decay multiplier for the flash envelope. At ~60 fps a 0.86 decay
// fades a full flash to the 0.02 floor in ~ln(0.02)/ln(0.86) ≈ 26 frames ≈
// 430 ms of total fade, holding clearly-visible (> 0.4, the Companion's `.lit`
// threshold) for the first ~150 ms — the "stays visible ~150-250 ms" the
// brief asks for. Frame-rate-normalised below so a 120 Hz panel decays at the
// same wall-clock rate as a 60 Hz one.
const DECAY_PER_60FPS_FRAME = 0.86;

// Below this the flash is considered fully out (matches companion's 0.02).
const FLASH_FLOOR = 0.02;

// Brightness above which the dot reads as "lit" (full colour + glow ring),
// mirroring the Companion's `.lit` toggle at 0.4.
const LIT_THRESHOLD = 0.4;

export interface PulseFlashProps {
  /** Latest live pulse value (≈0 at rest, ≈1 on a one-hop fire). */
  value: number;
  /** Pulse accent colour (resolved hex) — the dot + glow colour. */
  color: string;
  /** Faint border/ring colour at rest (from the palette). */
  restColor: string;
  /** Surface colour behind the dot (from the palette). */
  background: string;
  /** Rendered height in px (matches the bar+trace block it replaces). */
  height: number;
  /** Pause the rAF loop when false (tab blurred) — congestion/cpu guard. */
  active: boolean;
}

const clamp01 = (x: number): number => (x > 1 ? 1 : x > 0 ? x : 0);

// One self-animating flash dot. Owns the envelope state in refs and emits one
// setState (the current flash level) per animation frame — scoped to THIS dot,
// so the page body never re-renders on the hot path.
export function PulseFlash({
  value, color, restColor, background, height, active,
}: PulseFlashProps) {
  // Live target refreshed every render from props, read inside the rAF loop so
  // the loop never closes over a stale value.
  const valueRef = useRef(clamp01(value));
  valueRef.current = clamp01(value);
  // Previous live value — for rising-edge detection (armPulse semantics).
  const prevRef = useRef(clamp01(value));
  // Current envelope level (the displayed brightness).
  const flashRef = useRef(0);
  const lastTsRef = useRef(0);

  // The ONLY hot-path state: the rendered flash level. A number setState per
  // frame is cheap and scoped here.
  const [flash, setFlash] = useState(0);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    lastTsRef.current = 0;
    const tick = (ts: number) => {
      if (lastTsRef.current === 0) lastTsRef.current = ts;
      const dt = Math.min(0.1, (ts - lastTsRef.current) / 1000); // clamp resume gaps
      lastTsRef.current = ts;

      // 1. ARM on the rising edge: a fresh fire snaps the envelope to full.
      const cur = valueRef.current;
      const prev = prevRef.current;
      if (cur > ARM_THRESHOLD && prev <= ARM_THRESHOLD) flashRef.current = 1;
      prevRef.current = cur;

      // 2. DECAY toward the floor, frame-rate-normalised so wall-clock fade is
      //    identical at 60/120 Hz: decay^(dt / (1/60)).
      const decay = Math.pow(DECAY_PER_60FPS_FRAME, dt * 60);
      flashRef.current *= decay;
      if (flashRef.current < FLASH_FLOOR) flashRef.current = 0;

      setFlash(flashRef.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  const lit = flash > LIT_THRESHOLD;
  // Dot opacity rides the envelope but never fully vanishes — a resting glyph
  // stays dimly present (tickLit posture: dim at rest, light on a pulse).
  const dotOpacity = 0.18 + 0.82 * flash;

  return (
    <View style={{
      height,
      backgroundColor: background,
      borderRadius: 4,
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {/* Glow ring — only painted while lit, scales the perceived flash. */}
      <View style={{
        width: 22, height: 22, borderRadius: 11,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: lit ? 2 : 1,
        borderColor: lit ? color : restColor,
        backgroundColor: lit ? `${color}22` : 'transparent',
      }}>
        {/* The dot itself — its opacity tracks the decay envelope. */}
        <View style={{
          width: 10, height: 10, borderRadius: 5,
          backgroundColor: color,
          opacity: dotOpacity,
        }} />
      </View>
      {/* PULSE caption so the dot reads as an event cue, not a stuck meter. */}
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8,
        color: lit ? color : restColor,
        letterSpacing: 0.8, marginTop: 3,
      }}>{lit ? 'PULSE' : 'idle'}</Text>
    </View>
  );
}
