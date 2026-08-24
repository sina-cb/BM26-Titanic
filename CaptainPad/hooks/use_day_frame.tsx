// Day-frame context — WORKING DAY (6 PM → 6 PM) vs CALENDAR DAY (12 AM → 12 AM).
//
// Report _359 §C.1. The frame is a VIEW TRANSFORM over unchanged engine
// semantics: the engine keeps emitting calendar days and never learns about
// frames. That is exactly why this lives on the DEVICE and not in the plan —
// a plan-level field would need a schema bump plus validator changes, and two
// pads could then disagree about the same plan. One tap, survives a reload,
// and the cue editor always stamps the active frame in its title so nothing is
// ever authored blind.
//
// Codex P0: a missing or unrecognized stored value resolves to `'working'` —
// the operator's stated mental model, and a DOCUMENTED default, not a silent
// fallback over a broken read. The provider mounts next to <ThemeProvider>.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DAY_FRAMES, type DayFrame } from '@/components/timeline/day_frame_logic';

const STORAGE_KEY = '@CaptainPad:timelineDayFrame';

/** The documented default (see the header). */
export const DEFAULT_DAY_FRAME: DayFrame = 'working';

function isDayFrame(v: unknown): v is DayFrame {
  return typeof v === 'string' && (DAY_FRAMES as readonly string[]).includes(v);
}

interface DayFrameContextValue {
  frame: DayFrame;
  setFrame: (frame: DayFrame) => void;
}

const DayFrameContext = createContext<DayFrameContextValue | null>(null);

export function DayFrameProvider({ children }: { children: React.ReactNode }) {
  const [frame, setFrameState] = useState<DayFrame>(DEFAULT_DAY_FRAME);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (isDayFrame(stored)) setFrameState(stored);
      })
      .catch((err: unknown) => {
        // A storage read that FAILS is not the same as an absent key: say so
        // loudly and stay on the documented default.
        console.error('[CaptainPad] could not read the stored timeline day frame', err);
      });
  }, []);

  const setFrame = useCallback((next: DayFrame) => {
    setFrameState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch((err: unknown) => {
      console.error('[CaptainPad] could not persist the timeline day frame', err);
    });
  }, []);

  const value = useMemo<DayFrameContextValue>(() => ({ frame, setFrame }), [frame, setFrame]);
  return <DayFrameContext.Provider value={value}>{children}</DayFrameContext.Provider>;
}

export function useDayFrame(): DayFrameContextValue {
  const ctx = useContext(DayFrameContext);
  if (!ctx) {
    // P0: never silently pick a frame. A component rendered outside the
    // provider is a wiring bug the developer must see.
    throw new Error('useDayFrame() called outside <DayFrameProvider>');
  }
  return ctx;
}
