import React, { useCallback, useEffect, useState } from 'react';

import { TakeoverPasscodeSheet } from '@/components/takeover_passcode_sheet';
import {
  registerTakeoverPasscodePrompt,
  type TakeoverPasscodePrompt,
} from '@/utils/takeover_passcode';

// ── TakeoverPasscodeHost ───────────────────────────────────────────────────
//
// ONE app-wide mount (app/(tabs)/_layout.tsx, next to the other floating
// overlays) that serves the per-attempt takeover passcode prompt for EVERY
// takeover affordance in CaptainPad:
//
//   * PlanLockBanner "TEMPORARY TAKE OVER" (deck, mixer, touch-control tabs)
//   * the mixer's takeover-and-switch-output variant (handleMixerTakeover)
//   * the implicit takeover fired by touching a manual control while a plan
//     drives the rig (useOperatorTakeover → notifyInteraction)
//   * the timeline EVENT sheet's scoped PERFORM takeover
//
// They all funnel through hooks/useTimeline's runTakeover/runPerformTakeover,
// which call the gate in utils/takeover_passcode.ts, which asks this host.
//
// Living outside <Tabs> matters: a takeover can be triggered from any surface,
// and a Modal owned by a screen would unmount on a tab switch mid-prompt.
//
// This component holds NO passcode state. The typed characters live in the
// sheet; the submitted string is passed straight through to the in-flight
// request and is never assigned to anything here.

export function TakeoverPasscodeHost() {
  const [prompt, setPrompt] = useState<TakeoverPasscodePrompt | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => registerTakeoverPasscodePrompt((next) => {
    // A fresh request always opens a FRESH sheet: no carried-over error, no
    // carried-over input (the sheet wipes its own state when it closes).
    setPrompt(next);
    setPending(false);
    setError(null);
  }), []);

  const handleSubmit = useCallback((passcode: string, remember30: boolean) => {
    if (!prompt) return;
    setPending(true);
    setError(null);
    void prompt.submit(passcode, remember30).then((retryReason) => {
      if (retryReason === null) {
        // Flow finished (authorised, or an error the caller surfaces itself).
        setPrompt(null);
        setError(null);
      } else {
        // Refused — keep the sheet open with the engine's reason. The sheet has
        // already cleared the box, so the retry starts from empty.
        setError(retryReason);
      }
      setPending(false);
    });
  }, [prompt]);

  const handleCancel = useCallback(() => {
    if (!prompt) return;
    prompt.cancel();
    setPrompt(null);
    setPending(false);
    setError(null);
  }, [prompt]);

  return (
    <TakeoverPasscodeSheet
      visible={prompt !== null}
      pending={pending}
      error={error}
      title={prompt?.title ?? ''}
      detail={prompt?.detail ?? ''}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
    />
  );
}
