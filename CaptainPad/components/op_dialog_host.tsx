import React, { useCallback, useEffect, useState } from 'react';

import { OpDialogSheet } from '@/components/ui/op_dialog_sheet';
import { OpToastStack } from '@/components/ui/op_toast_stack';
import {
  OP_NOTICE_MAX_VISIBLE,
  registerOpDialogHost,
  type OpDialog,
  type OpNotice,
} from '@/utils/op_dialog';

// ── OpDialogHost ───────────────────────────────────────────────────────────
//
// ONE app-wide mount (app/(tabs)/_layout.tsx, beside TakeoverPasscodeHost and
// the other floating overlays) that serves EVERY operator notice and dialog in
// CaptainPad — the in-app replacement for `Alert.alert` (a silent no-op on the
// web build) and `window.alert` (an unthemed, thread-blocking browser dialog).
// See utils/op_dialog.ts for the full rationale.
//
// Living outside <Tabs> matters for the same reason it does for the passcode
// host: a notice is very often raised by a request that is still in flight
// while the operator moves to another tab, and a Modal owned by a screen would
// unmount mid-question.
//
// This component holds NO business state. It is a mailbox: the broker hands it
// notices and dialogs, it renders them, and it hands the operator's answer
// straight back through `dialog.resolve`.

export function OpDialogHost() {
  const [notices, setNotices] = useState<OpNotice[]>([]);
  const [dialog, setDialog] = useState<OpDialog | null>(null);

  useEffect(() => registerOpDialogHost({
    pushNotice: (notice) => {
      setNotices((current) => {
        // Newest at the end (the column grows upward from the bottom edge).
        // Past the cap the OLDEST is dropped: when the engine goes away every
        // panel fails at once, and a wall of stacked toasts would curtain off
        // the show surface the operator is trying to recover.
        const next = [...current, notice];
        return next.length > OP_NOTICE_MAX_VISIBLE
          ? next.slice(next.length - OP_NOTICE_MAX_VISIBLE)
          : next;
      });
    },
    openDialog: (next) => {
      // A dialog asks a question the caller is awaiting, so a second one
      // arriving while the first is open must NOT silently drop that caller's
      // promise. Resolve the incumbent as dismissed (null) — the same value a
      // backdrop tap produces, which every call site already handles — then
      // show the newcomer.
      setDialog((current) => {
        if (current) current.resolve(null);
        return next;
      });
    },
  }), []);

  const dismissNotice = useCallback((id: number) => {
    setNotices((current) => current.filter((n) => n.id !== id));
  }, []);

  // Wrap the resolver so answering always closes the sheet, and so a late
  // second call (double-tap on a button) is inert — the broker's own `settled`
  // guard makes the promise side safe, this makes the UI side safe.
  // `value` rides through untouched: for a PROMPT the sheet reads its own field
  // and hands the literal text back here, and this wrapper must not have an
  // opinion about it (an empty name is a real answer — see opPrompt).
  const answer = useCallback((live: OpDialog) => ({
    ...live,
    resolve: (actionId: string | null, value?: string) => {
      setDialog((current) => (current?.id === live.id ? null : current));
      live.resolve(actionId, value);
    },
  }), []);

  return (
    <>
      <OpToastStack notices={notices} onDismiss={dismissNotice} />
      <OpDialogSheet dialog={dialog ? answer(dialog) : null} />
    </>
  );
}
