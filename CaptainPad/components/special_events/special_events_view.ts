// special_events_view — PURE derivation of what the SPECIAL EVENTS tab draws.
//
// Everything the screen decides ("is this stage armed", "may the pink button be
// pressed", "is STROBE live right now") is computed HERE, from the engine's
// state document plus the show data the engine published. The .tsx is a
// renderer with no opinions, so vitest can pin every rendering rule without a
// React Native runtime (the repo's vitest config runs pure .ts only).
//
// ── The one invariant ────────────────────────────────────────────────────
// THE UI RENDERS TRUTH, IT NEVER ASSUMES. Every enabled/disabled decision below
// is a function of engine-published fields (`status`, `currentStageId`,
// `armedStageId`, and — when the engine computes them — `availableEffectIds` /
// `extendAvailable`). There is no client-side "we probably advanced" state, no
// optimistic stage cursor, and nothing is remembered across frames. A tap that
// the engine would refuse is drawn as refusable; the engine's 409 remains the
// authority and is surfaced verbatim (docs/52 §2.4 — "the UI never has to be
// the only guard").
//
// ── Operator's Baby Reveal flow (the shape this serves) ──────────────────
//   1. TEASE      — quick-effect pulse buttons (STROBE, FLASH VINTAGE WHITE)
//                   render right beside the button that starts the sequence,
//                   and fire as often as the operator likes WHILE tease is the
//                   current stage.
//   2. BLACKOUT   — the drum-roll hold in between.
//   3. THE REVEAL — a ceremonial CHOICE stage: two huge buttons, BABY PINK and
//                   BABY BLUE, live only in that stage.
//   … plus one EXTEND (when the current stage authors one) and one ABORT.

import { contrastRatio, readableInk } from '@/components/param_row_layout';
import type {
  EventShow,
  EventShowLoadError,
  EventStageSummary,
  SpecialEventsState,
} from '@/utils/special_events_api';

// ── Data accents vs. theme tokens ─────────────────────────────────────────
//
// Chrome colours come from `usePalette()` tokens, always. The stage/choice
// accents are SHOW DATA (the pink and the blue ARE the show), so they are
// checked at render: an accent that cannot clear WCAG's 3:1 large-text ratio
// against the surface it sits on is not painted as a fill — the button falls
// back to a token treatment rather than becoming a dark smudge on dark glass.
// The hex itself was already validated at parse time.

export const ACCENT_MIN_CONTRAST = 3;

export interface AccentPaint {
  /** The accent, safe to use as a fill. */
  fill: string;
  /** Near-black or white, whichever is legible on `fill`. */
  ink: string;
}

/**
 * Paint for a data accent on `surfaceHex`, or `null` when the accent is absent
 * or too close to the surface to read — the caller then uses theme tokens.
 */
export function paintAccent(accent: string | null, surfaceHex: string): AccentPaint | null {
  if (accent === null) return null;
  if (contrastRatio(accent, surfaceHex) < ACCENT_MIN_CONTRAST) return null;
  return { fill: accent, ink: readableInk(accent) };
}

/** Where a stage sits in the run, right now. */
export type StageRenderState =
  /** Fired and left behind — dimmed, checkmarked, not tappable. */
  | 'done'
  /** Holding the rig now — glowing border, elapsed/effects live. */
  | 'current'
  /** The ONE stage the engine will accept a fire for — full brightness. */
  | 'armed'
  /** Ahead of the armed stage — visible at low opacity, not tappable. */
  | 'locked';

export interface ChoiceViewModel {
  id: string;
  label: string;
  /** Show-data accent, or `null` to use the theme. */
  accent: string | null;
  enabled: boolean;
  /** True when pressing re-runs an already-made choice (asks first). */
  requiresConfirm: boolean;
  /** The answer is already live: collapse the ceremony buttons into compact,
   *  confirmed correction controls. */
  compact: boolean;
}

export interface EffectViewModel {
  id: string;
  label: string;
  accent: string | null;
  enabled: boolean;
}

export interface ExtendViewModel {
  label: string;
  enabled: boolean;
}

export interface StageViewModel {
  id: string;
  label: string;
  /** Show-authored one-liner telling the operator what this stage is for. */
  hint: string | null;
  accent: string | null;
  ceremonial: boolean;
  kind: 'action' | 'choice';
  state: StageRenderState;
  /** The stage button itself is tappable (choice stages fire via their choices). */
  fireable: boolean;
  /** True when firing re-runs the stage that is already current. */
  requiresConfirm: boolean;
  /** Live auto-advance countdown for the armed stage; `null` when manual. */
  countdownSec: number | null;
  choices: ChoiceViewModel[];
  effects: EffectViewModel[];
  extend: ExtendViewModel | null;
}

export type EventScreenMode =
  /** No engine truth yet — the tab shows the offline banner, nothing else. */
  | 'offline'
  /** Runner idle — pick a show. */
  | 'picker'
  /** A show is armed or running. */
  | 'show'
  /** The last run ended (finished / aborted / panic / restore_failed). */
  | 'ended';

export interface EventScreenModel {
  mode: EventScreenMode;
  /**
   * What the picker draws — the validated library NARROWED to shows the
   * active scene can actually ARM (`playlistsUsable`). A show whose scene is
   * missing its playlists (e.g. wedding on titanic) loaded fine as data but
   * is left out here rather than offered as a card that ARM would refuse.
   */
  shows: EventShow[];
  /** Show files that refused to load — red, untappable cards in the picker. */
  loadErrors: EventShowLoadError[];
  /** The armed/running show; `null` in picker / offline / ended-with-no-show. */
  show: EventShow | null;
  stages: StageViewModel[];
  /** True while a ceremonial stage is armed or current — dim everything else. */
  ceremonyLive: boolean;
  /** ABORT is offered from ARM onward (docs/52 §5). */
  abortAvailable: boolean;
  /** FINISH: the polite exit, offered once the LAST stage is current. */
  finishAvailable: boolean;
  /** Banner copy for an ended run, or `null`. */
  endedNotice: string | null;
  /** The engine's own error (failed restore, etc.), verbatim, or `null`. */
  engineError: string | null;
}

// ── Stage placement ───────────────────────────────────────────────────────

/**
 * Where each stage sits, derived ONLY from the engine's two cursors.
 *
 * `armedStageId` is the engine's own gate, so it — not an index arithmetic
 * guess — decides what is tappable. Stages before the frontier are done,
 * stages after it are locked. When the engine has armed nothing (a finished
 * run, or a stage that ends the show) the frontier is the current stage.
 */
export function placeStages(
  stages: EventStageSummary[],
  state: SpecialEventsState,
): StageRenderState[] {
  const currentIdx = stages.findIndex((s) => s.id === state.currentStageId);
  const armedIdx = stages.findIndex((s) => s.id === state.armedStageId);
  const frontier = armedIdx >= 0 ? armedIdx : currentIdx;

  return stages.map((stage, i) => {
    if (armedIdx >= 0 && i === armedIdx) return 'armed';
    if (currentIdx >= 0 && i === currentIdx) return 'current';
    if (frontier < 0) return 'locked';
    return i < frontier ? 'done' : 'locked';
  });
}

// ── Enablement rules ──────────────────────────────────────────────────────

/**
 * May this stage's quick effects be pulsed right now?
 *
 * This is the ENGINE's own rule, mirrored (special_events_service.quickEffect):
 * it refuses with `NO_STAGE_RUNNING` unless the run is `running`, and with
 * `QUICK_EFFECT_NOT_FOUND` unless the id belongs to the stage that is CURRENT.
 * Drawing exactly that means a lit button is a button the engine will honour,
 * and a dark one is a refusal the operator never has to discover by tapping.
 *
 * An armed-but-not-yet-fired stage's effects stay dark: the content they pulse
 * is not on the deck yet.
 */
export function effectEnabled(stageIsCurrent: boolean, state: SpecialEventsState): boolean {
  return state.status === 'running' && stageIsCurrent;
}

function buildChoices(
  stage: EventStageSummary,
  placement: StageRenderState,
  state: SpecialEventsState,
): ChoiceViewModel[] {
  // The ceremonial pair is live exactly in ITS stage: armed (the answer has not
  // been given) or current (the answer is on the rig and may be re-fired after
  // a confirm — a wrong-button press at the biggest moment of the night must
  // be recoverable). Every other placement is dark.
  const inChoiceStage = placement === 'armed' || placement === 'current';
  const enabled = inChoiceStage && (state.status === 'armed' || state.status === 'running');
  return stage.choices.map((c) => ({
    id: c.id,
    label: c.label,
    accent: c.color,
    enabled,
    requiresConfirm: enabled && placement === 'current',
    compact: placement === 'current' && state.choiceId !== null,
  }));
}

function buildExtend(
  stage: EventStageSummary,
  placement: StageRenderState,
  state: SpecialEventsState,
): ExtendViewModel | null {
  if (stage.extendLabel === null) return null;
  if (placement !== 'current') return null;
  // Mirrors the engine again: EXTEND needs a running stage that authored one,
  // and a `time` extend additionally needs a live countdown to add to — the
  // engine answers `NO_COUNTDOWN` otherwise.
  const enabled = state.status === 'running'
    && (stage.extendKind !== 'time' || state.countdownSec !== null);
  return { label: stage.extendLabel, enabled };
}

// ── The screen ────────────────────────────────────────────────────────────

/**
 * Build the whole screen model.
 *
 * `state === null` means we have neither a WS frame nor a REST seed: the tab
 * says so and offers nothing (Codex P0 — never paint a guess).
 */
export function describeEventScreen(state: SpecialEventsState | null): EventScreenModel {
  if (state === null) {
    return {
      mode: 'offline',
      shows: [],
      loadErrors: [],
      show: null,
      stages: [],
      ceremonyLive: false,
      abortAvailable: false,
      finishAvailable: false,
      endedNotice: null,
      engineError: null,
    };
  }

  // The show library rides on every state frame, so the run and the shows can
  // never be a version apart. The PICKER only offers shows the active scene
  // can actually ARM (`playlistsUsable`) — e.g. the wedding show ships on
  // test_bench only, so its card must not appear on titanic even though the
  // show file itself loads fine there. This is gating, not deletion: an
  // already-armed/running show is looked up in the FULL, unfiltered list
  // below, because a show that passed ARM must never vanish from its own
  // running screen.
  const shows = state.catalog.shows;
  const pickerShows = shows.filter((s) => s.playlistsUsable);
  const show = state.showId === null
    ? null
    : shows.find((s) => s.id === state.showId) ?? null;

  const running = state.status === 'armed' || state.status === 'running';
  const stages: StageViewModel[] = [];

  if (running && show !== null) {
    const placements = placeStages(show.stages, state);
    show.stages.forEach((stage, i) => {
      const placement = placements[i];
      const isCurrent = placement === 'current';
      const isArmed = placement === 'armed';
      stages.push({
        id: stage.id,
        label: stage.label,
        hint: stage.hint,
        accent: stage.color,
        ceremonial: stage.ceremonial,
        kind: stage.kind,
        state: placement,
        // A choice stage is fired BY a choice button, never by the row itself.
        fireable: stage.kind === 'action' && (isArmed || isCurrent),
        requiresConfirm: stage.kind === 'action' && isCurrent,
        countdownSec: isArmed && stage.advanceSec !== null ? state.countdownSec : null,
        choices: buildChoices(stage, placement, state),
        effects: stage.effects.map((e) => ({
          id: e.id,
          label: e.label,
          accent: e.color,
          enabled: effectEnabled(isCurrent, state),
        })),
        extend: buildExtend(stage, placement, state),
      });
    });
  }

  const lastStageId = show !== null && show.stages.length > 0
    ? show.stages[show.stages.length - 1].id
    : null;

  // The engine is running a show this catalog does not carry (stale tab, a
  // show file removed under a live run). We cannot draw its stages, so we say
  // exactly that and send the operator back to the picker — silently painting
  // an empty column would read as "the show is over".
  const orphanNotice = running && show === null
    ? `The engine is running show '${state.showId}', which is not in this catalog. `
      + 'Reload the tab; use ABORT from another surface if the rig is stuck.'
    : null;

  return {
    mode: state.status === 'ended' ? 'ended' : (running && show !== null ? 'show' : 'picker'),
    shows: pickerShows,
    loadErrors: state.catalog.errors,
    show,
    stages,
    ceremonyLive: stages.some((s) => s.ceremonial && (s.state === 'armed' || s.state === 'current')),
    abortAvailable: running,
    finishAvailable: state.status === 'running' && state.currentStageId === lastStageId,
    endedNotice: state.status === 'ended' ? describeEndReason(state) : null,
    engineError: [state.error, orphanNotice].filter((m) => m !== null).join(' · ') || null,
  };
}

/**
 * One honest sentence for each way a run can stop, with the engine's own
 * detail appended when it sent one (that detail is the whole story on a
 * `restore_failed`).
 */
export function describeEndReason(state: SpecialEventsState): string {
  const detail = state.endedDetail === null ? '' : ` ${state.endedDetail}`;
  return `${endReasonHeadline(state)}${detail}`;
}

function endReasonHeadline(state: SpecialEventsState): string {
  switch (state.endedReason) {
    case 'finished':
      return 'ENDED — the show finished and the pre-show look is back.';
    case 'aborted':
      return 'ENDED — aborted. The pre-show look is back.';
    case 'panic':
      return 'ENDED — PANIC. The rig was forced to a known-good lit state; '
        + 'the pre-show look was NOT restored.';
    case 'restore_failed':
      return 'ENDED — the show stopped but the pre-show look FAILED to restore. '
        + 'Check the rig and the engine log.';
    default:
      // The engine said `ended` without naming a reason: say exactly that
      // rather than inventing a friendly one.
      return 'ENDED — the engine reported no reason.';
  }
}

/**
 * Copy for the ARM confirm sheet. Names every side effect ARM has, so nobody
 * discovers the autopilot pause mid-ceremony (docs/52 §3).
 */
export function armConfirmMessage(show: EventShow): string {
  return `Arming ${show.name} captures the current look, pauses the deck autopilots, `
    + 'and takes the rig over from the timeline plan. Nothing changes on the rig until '
    + 'you fire the first stage. ABORT (or FINISH) puts everything back.';
}
