/**
 * cue_edit_logic — PURE cue-assembly rules for the CueEditorSheet.
 *
 * Extracted so two operator rulings (2026-08-03) are pinned by plain-node
 * vitest instead of living untestably inside the component:
 *
 *   1. Cue-level `size` is REMOVED from cues. The editor never shows it and
 *      never emits it; an old saved cue that still carries `globals.size` is
 *      accepted on read and silently shed on the next save (accept-and-ignore,
 *      never re-emit). The DECK-level size global is untouched — it is a real
 *      deck control; only the cue authoring surface lost it.
 *
 *   2. HOLD left the cue UI entirely ("remove hold from the cue UI to avoid
 *      confusion, but keep it for the party"). The mechanism stays fully alive
 *      engine-side (cue.hold in the schema, the arbiter/hold behavior, the
 *      party program's hold in the plan YAMLs). The editor merely stops
 *      displaying or editing it — an existing cue.hold must ROUND-TRIP through
 *      an edit UNTOUCHED, and a new cue emits no hold (engine semantics for an
 *      omitted hold: the program holds until the next program).
 *
 * Type-only imports (erased at build) keep this module free of the
 * RN-flavoured module graph `utils/timelineApi.ts` sits in — same discipline
 * as zoom_logic.ts.
 */
import type {
  ActionPlaylist,
  CueAction,
  CueDays,
  CueKind,
  CueTrigger,
  PlanCue,
} from '../../utils/timelineApi';

/**
 * Shed the legacy cue-level `size` from a playlist action's globals map.
 * Every other key rides through untouched; a globals map that held ONLY size
 * is dropped whole (an empty {} would still read as "this cue sets globals").
 * Non-playlist actions and actions without globals are returned as-is.
 */
export function stripCueSizeGlobal(action: CueAction): CueAction {
  if (action.type !== 'playlist') return action;
  const globals = action.globals;
  if (!globals || !('size' in globals)) return action;
  const { size: _shed, ...rest } = globals;
  const out: ActionPlaylist = { ...action };
  if (Object.keys(rest).length > 0) out.globals = rest;
  else delete out.globals;
  return out;
}

/**
 * Assemble the emitted PlanCue from the original cue + the editor's managed
 * fields. The ORIGINAL cue is spread first so every field the editor does NOT
 * surface — `hold` (operator ruling above), `enabled`, `catchUp`, and any
 * future keys — survives the round-trip byte-identical; the editor then
 * overlays only what it manages. `size` is shed from the action here so no
 * save path can re-emit it regardless of what was loaded.
 */
export function assembleCue(args: {
  initial: PlanCue | null;
  kind: CueKind;
  trigger: CueTrigger;
  action: CueAction;
  days: CueDays;
  label: string;
  /** REQUIRED positive duration — the editor guarantees it. */
  durationMin: number;
}): PlanCue {
  const cue: PlanCue = {
    ...(args.initial ?? {}),
    id: args.initial?.id ?? '', // parent mints ids for new cues
    kind: args.kind,
    trigger: args.trigger,
    action: stripCueSizeGlobal(args.action),
    days: args.days,
  };
  const label = args.label.trim();
  if (label) cue.label = label;
  else delete cue.label;
  cue.durationMin = args.durationMin;
  return cue;
}
