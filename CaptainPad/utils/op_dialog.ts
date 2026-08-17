// op_dialog — the ONE operator-facing notice + dialog broker for CaptainPad.
//
// OPERATOR RULING 2026-08-15: "do a deep analysis of alerts and make sure they
// are not like this regular HTML shit, and is handled properly as part of the
// app UI itself to be compatible with ipad too" — filed against a screenshot of
// a raw Chrome dialog reading `localhost:6967 says / Switch failed / special
// event "baby_reveal" is running and owns the deck …`.
//
// ── WHY THE OLD SURFACES WERE WRONG ───────────────────────────────────────
//
// CaptainPad ships BOTH a native iPad build and a web build (`npm run
// web:build`, served to the podium). react-native-web's `Alert` export is an
// EMPTY STUB (`class Alert { static alert() {} }` — see
// node_modules/react-native-web/dist/exports/Alert), so the two pre-existing
// surfaces each failed on one half of the product:
//
//   * `Alert.alert(title, message)` — correct on iPad, a SILENT NO-OP on web.
//     81 call sites. The engine refuses a request, the panel rolls its
//     optimistic state back, and the podium operator sees the UI snap back
//     with no explanation whatsoever. Codex P0 — fail loudly, never silently.
//   * `utils/op_alert.ts`'s `opAlert()` — the 2026-07 patch for the above. It
//     was loud, but it bought that loudness with `window.alert`: an unthemed
//     browser modal stamped with the origin, ignoring all five themes, and
//     BLOCKING the JS thread (WebSocket frames from the engine queue up behind
//     it) until a mouse reaches OK. On an iPad standalone/PWA it is worse
//     still — a system sheet over a full-screen show console. 16 call sites,
//     and the one in the operator's screenshot.
//
// Neither could ever carry a BUTTON: RN-web drops `Alert.alert` button
// callbacks entirely, which is why `components/ui/ConfirmSheet.tsx` already
// exists for destructive confirms. This module is the imperative sibling of
// that sheet, not a replacement for it — ConfirmSheet stays the right answer
// wherever a component already owns `visible` state declaratively.
//
// ── THE SHAPE ─────────────────────────────────────────────────────────────
//
// Two primitives, chosen by whether the operator must DECIDE something:
//
//   opNotify / opError / opWarn / opInfo → a themed TOAST. Non-blocking,
//     auto-dismissing, stacked. This is the right home for the ~90 "the engine
//     rejected X, we reverted" notices: during a live show the operator needs
//     to KNOW, but must never be stopped mid-cue to acknowledge a toast.
//   opDialog / opConfirm → a themed MODAL, promise-based, so a call site reads
//     `if (await opConfirm({...}))`. For refusals that carry an action ("OPEN
//     EVENTS") and for destructive choices.
//
// Pure TypeScript with no React / React Native imports, exactly like
// `utils/takeover_passcode.ts` — so vitest can drive the whole broker in the
// node environment (see `utils/op_dialog.test.ts`). The rendering half lives in
// `components/op_dialog_host.tsx`, mounted ONCE in `app/(tabs)/_layout.tsx`.

// ── Tones ─────────────────────────────────────────────────────────────────
//
// Deliberately THREE, each mapping onto palette tokens that already exist and
// are already contrast-tested across all five themes by
// `components/design_tokens.test.ts`:
//
//   error   → `error` / `errorContainer` / `errorContainerBorder`
//   warning → `warning` / `warningContainer` / `warningContainerBorder`
//   info    → `primary` / `primaryContainer`
//
// No new palette key is introduced. A 'success' tone was considered and
// dropped: there is no success token in the palette, and inventing one would
// mean a new hex per theme with its own WCAG sweep for a category that has
// zero call sites today.

export type OpTone = 'error' | 'warning' | 'info';

/** How long each tone's toast stays up. Errors linger longest — they are the
 *  ones carrying an engine reason the operator may need to read twice. */
export const OP_NOTICE_DURATION_MS: Record<OpTone, number> = {
  error: 7000,
  warning: 6000,
  info: 4000,
};

/** Toasts on screen at once. Beyond this the OLDEST is dropped: a burst of
 *  failures (every channel refusing at once when the engine goes away) must not
 *  paper over the show surface. */
export const OP_NOTICE_MAX_VISIBLE = 3;

/** Notices accepted before the host mounts. Bounded so a boot-time failure loop
 *  cannot grow this without limit. */
const PENDING_NOTICE_MAX = 8;

export interface OpNoticeRequest {
  tone: OpTone;
  /** Short headline, rendered uppercase by the host. */
  title: string;
  /** The engine's reason, verbatim. Optional. */
  message?: string;
  /** Override the tone's default dwell time. */
  durationMs?: number;
}

/** A notice, stamped with an id + resolved duration, handed to the host. */
export interface OpNotice {
  id: number;
  tone: OpTone;
  title: string;
  message?: string;
  durationMs: number;
}

// ── Dialogs ───────────────────────────────────────────────────────────────

/** `cancel` is the safe escape (also what a backdrop tap resolves to);
 *  `destructive` gets the danger ink; `default` is a plain action. */
export type OpDialogActionKind = 'default' | 'cancel' | 'destructive';

export interface OpDialogAction {
  /** Returned by `opDialog` when this action is chosen. */
  id: string;
  label: string;
  kind?: OpDialogActionKind;
}

/**
 * A single-line TEXT FIELD on the dialog card (_242 order 4: "ask for a name
 * too"). Present only on prompts; `opDialog` / `opConfirm` never set it.
 *
 * There is deliberately no `required` flag. The one caller that exists wants an
 * EMPTY answer to be a real answer ("by default accept an empty name too for no
 * name on the screen"), and a validation rule with no user is a rule nobody has
 * checked. A caller that needs a non-empty value can re-ask.
 */
export interface OpDialogInput {
  placeholder?: string;
  initialValue?: string;
  maxLength?: number;
}

export interface OpDialogRequest {
  tone: OpTone;
  title: string;
  message: string;
  /** At least one. The host renders them left-to-right. */
  actions: OpDialogAction[];
  /** Render a text field above the buttons and hand its value to `resolve`. */
  input?: OpDialogInput;
  /**
   * CSS colour strings drawn as a generated preview icon on the card. Plain
   * strings on purpose: this module stays free of any colour model, so the
   * caller owns what the icon MEANS and the sheet only draws it.
   */
  swatches?: string[];
}

/** What the host hands back: the chosen action (or `null` for a dismissal) and,
 *  for a prompt, the literal contents of the field. */
export interface OpDialogResult {
  actionId: string | null;
  value?: string;
}

/** A dialog, stamped with an id and its resolver, handed to the host. */
export interface OpDialog extends OpDialogRequest {
  id: number;
  /** Chosen action id, or `null` for backdrop / hardware-back dismissal. The
   *  second argument carries the text field's value on an `input` dialog. */
  resolve: (actionId: string | null, value?: string) => void;
}

// ── Host registration ─────────────────────────────────────────────────────

export interface OpDialogHostHandlers {
  pushNotice: (notice: OpNotice) => void;
  openDialog: (dialog: OpDialog) => void;
}

let _host: OpDialogHostHandlers | null = null;
let _seq = 0;

/** Notices raised before the host mounted (or between Fast Refresh remounts).
 *  Flushed in order on registration — a startup-race buffer, NOT a fallback
 *  surface: nothing here is ever silently discarded except by the bound. */
let _pending: OpNotice[] = [];

/**
 * Mount-point registration. Returns the unregister function.
 * A SECOND registration replaces the first (Fast Refresh remounts the host);
 * the unregister only clears the handlers it installed.
 */
export function registerOpDialogHost(handlers: OpDialogHostHandlers): () => void {
  _host = handlers;
  if (_pending.length > 0) {
    const queued = _pending;
    _pending = [];
    for (const notice of queued) handlers.pushNotice(notice);
  }
  return () => {
    if (_host === handlers) _host = null;
  };
}

/** True once the app-wide host is mounted. */
export function opDialogHostReady(): boolean {
  return _host !== null;
}

/** Test seam — drops the host and any buffered notices. */
export function resetOpDialogForTest(): void {
  _host = null;
  _pending = [];
  _seq = 0;
}

// ── Notices (toast) ───────────────────────────────────────────────────────

/**
 * Raise a non-blocking themed toast.
 *
 * With no host mounted the notice is BUFFERED and flushed when the host
 * registers, rather than thrown away. It deliberately does not throw the way
 * `opDialog` does: almost every call site is inside a `catch`, and throwing
 * there would replace the operator's real engine error with a plumbing error —
 * the exact silent-failure mode this module exists to kill. Overflow past
 * `PENDING_NOTICE_MAX` is reported to the console rather than hidden.
 */
export function opNotify(request: OpNoticeRequest): void {
  const notice: OpNotice = {
    id: ++_seq,
    tone: request.tone,
    title: request.title,
    message: request.message,
    durationMs: request.durationMs ?? OP_NOTICE_DURATION_MS[request.tone],
  };
  const host = _host;
  if (host) {
    host.pushNotice(notice);
    return;
  }
  if (_pending.length >= PENDING_NOTICE_MAX) {
    console.error(
      '[op_dialog] notice buffer full before host mount — dropping oldest:',
      _pending[0]?.title,
    );
    _pending.shift();
  }
  _pending.push(notice);
}

/** Engine refused / a request failed. The most common notice by far. */
export function opError(title: string, message?: string): void {
  opNotify({ tone: 'error', title, message });
}

/** Applied, but not the way the operator asked — or a caution worth reading. */
export function opWarn(title: string, message?: string): void {
  opNotify({ tone: 'warning', title, message });
}

/** Neutral confirmation / status. */
export function opInfo(title: string, message?: string): void {
  opNotify({ tone: 'info', title, message });
}

// ── Dialogs (modal) ───────────────────────────────────────────────────────

/**
 * Open a themed modal and resolve with the chosen action id, or `null` if the
 * operator dismissed it (backdrop tap / hardware back).
 *
 * Codex P0 — no fallback: with no host mounted this THROWS rather than
 * resolving `null`, which a call site would read as "the operator said no" and
 * silently skip the action.
 */
export function openOpDialog(request: OpDialogRequest): Promise<OpDialogResult> {
  const host = _host;
  if (!host) {
    throw new Error(
      'op_dialog host is not mounted — cannot ask the operator to choose',
    );
  }
  if (request.actions.length === 0) {
    throw new Error('op_dialog requires at least one action');
  }
  return new Promise<OpDialogResult>((resolve) => {
    let settled = false;
    host.openDialog({
      id: ++_seq,
      tone: request.tone,
      title: request.title,
      message: request.message,
      actions: request.actions,
      input: request.input,
      swatches: request.swatches,
      resolve: (actionId, value) => {
        if (settled) return;
        settled = true;
        resolve({ actionId, value });
      },
    });
  });
}

/** The chosen action id only — what every button-dialog call site wants. */
export function opDialog(request: OpDialogRequest): Promise<string | null> {
  return openOpDialog(request).then((r) => r.actionId);
}

export interface OpConfirmRequest {
  title: string;
  message: string;
  /** Label for the action that proceeds. Defaults to "CONFIRM". */
  confirmLabel?: string;
  /** Label for the safe escape. Defaults to "CANCEL". */
  cancelLabel?: string;
  /** Paint the confirm button in the danger ink. Defaults to true — this
   *  primitive exists for choices worth stopping the operator for. */
  destructive?: boolean;
  /** Defaults to 'warning'. */
  tone?: OpTone;
}

/**
 * Promise-based confirmation, so a call site reads:
 *   `if (!(await opConfirm({ ... }))) return;`
 *
 * Dismissal (backdrop / back) resolves FALSE — for a confirm, and only for a
 * confirm, "no answer" is unambiguously "do not proceed".
 */
export async function opConfirm(request: OpConfirmRequest): Promise<boolean> {
  const chosen = await opDialog({
    tone: request.tone ?? 'warning',
    title: request.title,
    message: request.message,
    actions: [
      { id: 'cancel', label: request.cancelLabel ?? 'CANCEL', kind: 'cancel' },
      {
        id: 'confirm',
        label: request.confirmLabel ?? 'CONFIRM',
        kind: request.destructive === false ? 'default' : 'destructive',
      },
    ],
  });
  return chosen === 'confirm';
}

// ── Prompt (a themed modal with a text field) ─────────────────────────────

export const OP_PROMPT_SUBMIT = 'submit';
export const OP_PROMPT_CANCEL = 'cancel';

export interface OpPromptRequest {
  title: string;
  message: string;
  /** Defaults to 'info' — naming a thing is not a warning. */
  tone?: OpTone;
  placeholder?: string;
  initialValue?: string;
  maxLength?: number;
  /** Label for the action that submits. Defaults to "SAVE". */
  submitLabel?: string;
  cancelLabel?: string;
  /** CSS colours drawn as a generated preview icon above the field, so the
   *  operator names the thing while looking at it. */
  swatches?: string[];
}

/**
 * Ask the operator for a line of text.
 *
 * Resolves the LITERAL contents of the field — including the empty string,
 * which is a real answer and not a refusal — or `null` when the operator
 * cancelled or dismissed the card. Those two are distinct on purpose: the one
 * caller today saves an unnamed preset for `''` and saves nothing for `null`,
 * and collapsing them would make CANCEL indistinguishable from SAVE-with-no-name.
 *
 * Codex P0 — no fallback: a submit that arrives without a value means the host
 * rendered the card without wiring its field, and THROWING is the only way that
 * bug ever gets seen. Silently substituting `''` would ship a naming dialog
 * that quietly refuses to name anything.
 */
export async function opPrompt(request: OpPromptRequest): Promise<string | null> {
  const { actionId, value } = await openOpDialog({
    tone: request.tone ?? 'info',
    title: request.title,
    message: request.message,
    swatches: request.swatches,
    input: {
      placeholder: request.placeholder,
      initialValue: request.initialValue,
      maxLength: request.maxLength,
    },
    actions: [
      { id: OP_PROMPT_CANCEL, label: request.cancelLabel ?? 'CANCEL', kind: 'cancel' },
      { id: OP_PROMPT_SUBMIT, label: request.submitLabel ?? 'SAVE', kind: 'default' },
    ],
  });
  if (actionId !== OP_PROMPT_SUBMIT) return null;
  if (typeof value !== 'string') {
    throw new Error(
      'op_dialog host resolved a prompt without the field value — the input was rendered but not wired',
    );
  }
  return value;
}
