// color_autopilot_narration — the operator-facing sentence for a rejected or
// unreachable colour-autopilot RETUNE patch (docs/75 §5 "Fail-loud"), kept as
// PURE TypeScript so both mounts (deck `app/(tabs)/index.tsx` and mixer
// `app/(tabs)/mixer.tsx`) build the exact same wording from one place.
//
// `_315` W2 turns every colour gesture into a retune, so the generic "Retune
// not applied" sentence gets a lot more common. `onColorAutopilotRetune`
// gained an optional `failNote` argument (the gesture that triggered the
// retune, e.g. "CONTRAST retune") so the operator can tell WHICH selection
// the rig refused, not just that something did. This composes that note onto
// the existing sentence the same way `onColorAutopilotChange`'s handlers
// already fold their own `failNote` in (`[...].filter(Boolean).join(' ')`).
//
// The leading sentence for each kind is the one already shipped verbatim —
// this only appends, never rewords, so a diff in the operator-facing text is
// a regression, not an improvement.

/** Which failure branch of the retune PATCH produced the narration. */
export type RetuneRejectionKind = 'rejected' | 'unreachable';

/**
 * Compose the `opError` body for a failed colour-autopilot retune.
 *
 * - `rejected`: the engine answered with `{ok: false}` — `detail` is
 *   `res.error`.
 * - `unreachable`: the PATCH threw — `detail` is `err?.message`.
 *
 * Empty/undefined parts are dropped and the remaining pieces are joined with
 * a single space, exactly like the `onColorAutopilotChange` handlers already
 * do. With no detail and no failNote this returns today's shipped sentence
 * byte-for-byte.
 */
export function retuneRejectionMessage(
  kind: RetuneRejectionKind,
  detail: string | undefined,
  failNote: string | undefined,
): string {
  if (kind === 'rejected') {
    return [
      `The engine refused the change. ${detail || ''} The rotation is still running its previous settings.`.trim(),
      failNote,
    ].filter(Boolean).join(' ');
  }
  return [
    `Could not reach the engine. ${detail || ''}`.trim(),
    failNote,
  ].filter(Boolean).join(' ');
}
