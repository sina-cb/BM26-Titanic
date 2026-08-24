// What the SPECIAL EVENTS tab draws, pinned against the engine state document.
//
// The tab is a VIEW: the engine owns the stage cursor, and every enable /
// disable below must be a function of what the engine published. These tests
// exist so a future edit cannot quietly introduce a client-side guess — the
// failure mode they guard against is the pink button being live at the wrong
// moment on the biggest night of somebody's life.
//
// The fixture is the operator's revised Baby Reveal flow:
//   TEASE (quick effects) → BLACKOUT → THE REVEAL (choice; final hold)

import { describe, expect, it } from 'vitest';

import type {
  EventAutopilotState,
  EventShow,
  EventStageAutopilot,
  SpecialEventsState,
} from '@/utils/special_events_api';
import {
  ACCENT_MIN_CONTRAST,
  armConfirmMessage,
  describeEndReason,
  describeEventScreen,
  effectEnabled,
  paintAccent,
  placeStages,
} from './special_events_view';

const PINK = '#ff9ec4';
const BLUE = '#4fa8ff';
const DARK_SURFACE = '#171d20';

// A stage that authors no `autopilot:` block. The engine still sends a COMPLETE
// block with `supported:false`, so the tab never has to invent one — pinning
// that shape here is what keeps the card from appearing on the blackout.
const NO_ROTATION: EventStageAutopilot = {
  supported: false,
  active: false,
  everySec: 30,
  shuffle: false,
  groupMode: false,
  groupSize: 3,
  groupDwell: 6,
  transition: { enabled: false, mode: 'trans_crossfade', durationMs: 1000, shuffle: false },
};

/** The tease's authored rotation: shuffled patterns, 1 minute, 1 s transition. */
const TEASE_ROTATION: EventStageAutopilot = {
  ...NO_ROTATION,
  supported: true,
  active: true,
  everySec: 15,
  shuffle: true,
  transition: { enabled: true, mode: 'trans_crossfade', durationMs: 1000, shuffle: false },
};

/** The selected Baby family shuffles until the operator ends the show. */
const REVEAL_ROTATION: EventStageAutopilot = {
  ...TEASE_ROTATION,
  everySec: 15,
  shuffle: true,
  transition: { enabled: true, mode: 'trans_crossfade', durationMs: 1000, shuffle: false },
};

/** The live block on a frame where nothing is rotating. */
const IDLE_AUTOPILOT: EventAutopilotState = {
  supported: false,
  stageId: null,
  active: false,
  everySec: null,
  shuffle: false,
  groupMode: false,
  groupSize: null,
  groupDwell: null,
  transition: null,
  nextSwapAtMs: null,
  nowPlaying: null,
  overridden: false,
};

const BABY_REVEAL: EventShow = {
  id: 'baby_reveal',
  name: 'Baby Reveal',
  color: PINK,
  icon: 'gift',
  description: 'Three playlists, one blackout, and a white flash.',
  playlistsUsable: true,
  stages: [
    {
      id: 'tease',
      label: 'START TEASE',
      color: PINK,
      hint: 'Pink and blue, no answer yet.',
      ceremonial: false,
      kind: 'action',
      choices: [],
      effects: [
        { id: 'strobe', label: 'STROBE', color: null, mode: 'toggle' },
        { id: 'flash_vintage_white', label: 'FLASH VINTAGE WHITE', color: null, mode: 'pulse' },
      ],
      extendLabel: 'RESTART TEASE',
      extendKind: 'actions',
      advanceSec: null,
      autopilot: TEASE_ROTATION,
    },
    {
      id: 'blackout',
      label: 'GO DARK',
      color: null,
      hint: null,
      ceremonial: false,
      kind: 'action',
      choices: [],
      effects: [],
      extendLabel: null,
      extendKind: null,
      advanceSec: null,
      autopilot: NO_ROTATION,
    },
    {
      id: 'reveal',
      label: 'THE REVEAL',
      color: null,
      hint: null,
      ceremonial: true,
      kind: 'choice',
      choices: [
        { id: 'pink', label: 'BABY PINK', color: PINK },
        { id: 'blue', label: 'BABY BLUE', color: BLUE },
      ],
      effects: [],
      extendLabel: null,
      extendKind: null,
      advanceSec: null,
      autopilot: REVEAL_ROTATION,
    },
  ],
};

function state(over: Partial<SpecialEventsState> = {}): SpecialEventsState {
  return {
    status: 'idle',
    showId: null,
    currentStageId: null,
    armedStageId: null,
    choiceId: null,
    countdownSec: null,
    stageElapsedSec: null,
    endedReason: null,
    endedDetail: null,
    error: null,
    leaseHeld: false,
    quickEffectStates: {},
    autopilot: IDLE_AUTOPILOT,
    // The library rides on every frame — see special_events_api's header.
    catalog: { shows: [BABY_REVEAL], errors: [] },
    ...over,
  };
}

const ARMED = state({ status: 'armed', showId: 'baby_reveal', armedStageId: 'tease' });
const TEASING = state({
  status: 'running',
  showId: 'baby_reveal',
  currentStageId: 'tease',
  armedStageId: 'blackout',
});
const BLACKED_OUT = state({
  status: 'running',
  showId: 'baby_reveal',
  currentStageId: 'blackout',
  armedStageId: 'reveal',
});
const CHOOSING = BLACKED_OUT;
const REVEALED = state({
  status: 'running',
  showId: 'baby_reveal',
  currentStageId: 'reveal',
  armedStageId: null,
  choiceId: 'pink',
});

function stageOf(s: SpecialEventsState, id: string) {
  const screen = describeEventScreen(s);
  const stage = screen.stages.find((x) => x.id === id);
  if (!stage) throw new Error(`no stage '${id}' in the model`);
  return stage;
}

describe('stage placement from engine state', () => {
  it('arms the first stage and locks the rest before anything fires', () => {
    expect(placeStages(BABY_REVEAL.stages, ARMED))
      .toEqual(['armed', 'locked', 'locked']);
  });

  it('marks the fired stage current and the next one armed', () => {
    expect(placeStages(BABY_REVEAL.stages, TEASING))
      .toEqual(['current', 'armed', 'locked']);
  });

  it('leaves passed stages done once the run is deep in the show', () => {
    expect(placeStages(BABY_REVEAL.stages, REVEALED))
      .toEqual(['done', 'done', 'current']);
  });

  it('treats the current stage as the frontier when nothing is armed', () => {
    expect(placeStages(BABY_REVEAL.stages, REVEALED))
      .toEqual(['done', 'done', 'current']);
  });

  it('follows the ENGINE armed cursor even when it skips ahead', () => {
    // If the engine says the reveal is armed, that is what is tappable — the
    // view never re-derives "next" by adding one to the current index.
    const skipped = state({
      status: 'running',
      showId: 'baby_reveal',
      currentStageId: 'tease',
      armedStageId: 'reveal',
    });
    expect(placeStages(BABY_REVEAL.stages, skipped))
      .toEqual(['current', 'done', 'armed']);
  });
});

describe('what is tappable', () => {
  it('fires the armed stage and offers a confirmed re-run of the current one', () => {
    const blackout = stageOf(TEASING, 'blackout');
    expect(blackout.state).toBe('armed');
    expect(blackout.fireable).toBe(true);
    expect(blackout.requiresConfirm).toBe(false);

    const tease = stageOf(TEASING, 'tease');
    expect(tease.fireable).toBe(true);
    expect(tease.requiresConfirm).toBe(true);
  });

  it('refuses taps on locked and done stages', () => {
    expect(stageOf(TEASING, 'reveal').fireable).toBe(false);
    expect(stageOf(REVEALED, 'tease').state).toBe('done');
    expect(stageOf(REVEALED, 'tease').fireable).toBe(false);
  });

  it('never makes the choice stage row itself tappable', () => {
    // The reveal is fired BY a choice button; tapping the row would be an
    // answer with no answer in it.
    expect(stageOf(CHOOSING, 'reveal').state).toBe('armed');
    expect(stageOf(CHOOSING, 'reveal').fireable).toBe(false);
  });

  it('shows the countdown only on an armed auto-advance stage', () => {
    const timed: EventShow = {
      ...BABY_REVEAL,
      stages: BABY_REVEAL.stages.map((s) => (
        s.id === 'blackout' ? { ...s, advanceSec: 20 } : s
      )),
    };
    const s = state({
      status: 'running',
      showId: 'baby_reveal',
      currentStageId: 'tease',
      armedStageId: 'blackout',
      countdownSec: 12,
    });
    const screen = describeEventScreen({ ...s, catalog: { shows: [timed], errors: [] } });
    expect(screen.stages.find((x) => x.id === 'blackout')?.countdownSec).toBe(12);
    // The manual tease stage never shows a clock, even though one is ticking.
    expect(screen.stages.find((x) => x.id === 'tease')?.countdownSec).toBeNull();
  });
});

describe('the ceremonial choice pair', () => {
  it('is live in the choice stage — armed or current — and nowhere else', () => {
    expect(stageOf(CHOOSING, 'reveal').choices.map((c) => c.enabled)).toEqual([true, true]);
    expect(stageOf(REVEALED, 'reveal').choices.map((c) => c.enabled)).toEqual([true, true]);

    // Locked (the show has not reached it) and idle-armed: dark.
    expect(stageOf(ARMED, 'reveal').state).toBe('locked');
    expect(stageOf(ARMED, 'reveal').choices.every((c) => c.enabled)).toBe(false);
    expect(stageOf(TEASING, 'reveal').choices.every((c) => c.enabled)).toBe(false);
  });

  it('asks before replacing an answer that is already on the ship', () => {
    expect(stageOf(CHOOSING, 'reveal').choices.every((c) => c.requiresConfirm)).toBe(false);
    expect(stageOf(REVEALED, 'reveal').choices.every((c) => c.requiresConfirm)).toBe(true);
    expect(stageOf(CHOOSING, 'reveal').choices.every((c) => !c.compact)).toBe(true);
    expect(stageOf(REVEALED, 'reveal').choices.every((c) => c.compact)).toBe(true);
  });

  it('marks only the answer the engine says is live', () => {
    expect(stageOf(CHOOSING, 'reveal').choices.map((c) => c.selected)).toEqual([false, false]);
    expect(stageOf(REVEALED, 'reveal').choices.map((c) => c.selected)).toEqual([true, false]);
  });

  it('carries each choice its own show accent', () => {
    expect(stageOf(CHOOSING, 'reveal').choices.map((c) => c.accent)).toEqual([PINK, BLUE]);
  });

  it('dims the rest of the column while the ceremony is live', () => {
    expect(describeEventScreen(CHOOSING).ceremonyLive).toBe(true);
    expect(describeEventScreen(REVEALED).ceremonyLive).toBe(true);
    expect(describeEventScreen(TEASING).ceremonyLive).toBe(false);
  });
});

describe('quick-effect pulses', () => {
  it('fire only while their own stage is holding the rig', () => {
    expect(stageOf(TEASING, 'tease').effects.map((e) => e.enabled)).toEqual([true, true]);
    // Armed but not fired: the tease pattern is not on the deck yet.
    expect(stageOf(ARMED, 'tease').effects.every((e) => e.enabled)).toBe(false);
    // The show moved on.
    expect(stageOf(BLACKED_OUT, 'tease').effects.every((e) => e.enabled)).toBe(false);
    expect(stageOf(REVEALED, 'tease').effects.every((e) => e.enabled)).toBe(false);
  });

  it('are still DRAWN when idle, so the operator knows the stage has them', () => {
    expect(stageOf(BLACKED_OUT, 'tease').effects).toHaveLength(2);
  });

  it('shows toggle state only when the engine says the effect is actually on', () => {
    const strobeOn = state({
      ...TEASING,
      quickEffectStates: { strobe: true },
    });
    expect(stageOf(TEASING, 'tease').effects[0].active).toBe(false);
    expect(stageOf(strobeOn, 'tease').effects[0].active).toBe(true);
    expect(stageOf(strobeOn, 'tease').effects[1].active).toBe(false);
  });

  it('mirror the two refusals the engine itself raises', () => {
    // special_events_service.quickEffect() answers NO_STAGE_RUNNING unless the
    // run is running, and QUICK_EFFECT_NOT_FOUND unless the id belongs to the
    // CURRENT stage. A lit button must be a button the engine will honour.
    expect(effectEnabled(true, state({ status: 'armed' }))).toBe(false);
    expect(effectEnabled(true, state({ status: 'ended' }))).toBe(false);
    expect(effectEnabled(true, state({ status: 'idle' }))).toBe(false);
    expect(effectEnabled(true, state({ status: 'running' }))).toBe(true);
    expect(effectEnabled(false, state({ status: 'running' }))).toBe(false);
  });
});

describe('extend', () => {
  it('appears only on the current stage that authored one', () => {
    expect(stageOf(TEASING, 'tease').extend).toEqual({ label: 'RESTART TEASE', enabled: true });
    // Armed, not yet fired → nothing to extend.
    expect(stageOf(ARMED, 'tease').extend).toBeNull();
    // A stage with no extend never grows one.
    expect(stageOf(BLACKED_OUT, 'blackout').extend).toBeNull();
  });

  it('greys a TIME extend with no live countdown — the engine says NO_COUNTDOWN', () => {
    const timedExtend: EventShow = {
      ...BABY_REVEAL,
      stages: BABY_REVEAL.stages.map((s) => (
        s.id === 'tease' ? { ...s, extendLabel: '+30s', extendKind: 'time' as const } : s
      )),
    };
    const noClock = { ...TEASING, catalog: { shows: [timedExtend], errors: [] } };
    expect(describeEventScreen(noClock).stages[0].extend)
      .toEqual({ label: '+30s', enabled: false });

    const ticking = { ...noClock, countdownSec: 18 };
    expect(describeEventScreen(ticking).stages[0].extend)
      .toEqual({ label: '+30s', enabled: true });
  });
});

describe('screen modes', () => {
  it('renders nothing but the offline notice without engine truth', () => {
    const screen = describeEventScreen(null);
    expect(screen.mode).toBe('offline');
    expect(screen.stages).toEqual([]);
    expect(screen.abortAvailable).toBe(false);
  });

  it('shows the picker while the runner is idle', () => {
    expect(describeEventScreen(state()).mode).toBe('picker');
  });

  it('the picker offers only shows the active scene can actually ARM', () => {
    // The wedding show is real data (it loaded — no `loadErrors` entry) but
    // ships on test_bench only. On a scene missing its playlists the engine
    // marks it `playlistsUsable: false`; the picker must decline to draw a
    // card that ARM is guaranteed to refuse (docs/52 §3, this task's S1).
    const wedding: EventShow = { ...BABY_REVEAL, id: 'wedding_program', name: 'Wedding', playlistsUsable: false };
    const screen = describeEventScreen(
      state({ catalog: { shows: [BABY_REVEAL, wedding], errors: [] } }));
    expect(screen.shows.map((s) => s.id)).toEqual(['baby_reveal']);
  });

  it('an unusable show is still findable once ARMED — gating hides the picker card only', () => {
    // Gating must never make a RUNNING show vanish from its own screen: only
    // the picker's offer list is narrowed, never the show lookup by id.
    const wedding: EventShow = { ...BABY_REVEAL, id: 'wedding_program', name: 'Wedding', playlistsUsable: false };
    const running = state({
      status: 'running',
      showId: 'wedding_program',
      currentStageId: BABY_REVEAL.stages[0].id,
      catalog: { shows: [wedding], errors: [] },
    });
    const screen = describeEventScreen(running);
    expect(screen.mode).toBe('show');
    expect(screen.show?.id).toBe('wedding_program');
  });

  it('shows the show column from ARM onward, with ABORT always reachable', () => {
    expect(describeEventScreen(ARMED).mode).toBe('show');
    expect(describeEventScreen(ARMED).abortAvailable).toBe(true);
    expect(describeEventScreen(TEASING).abortAvailable).toBe(true);
  });

  it('offers FINISH only once the last stage is live', () => {
    expect(describeEventScreen(TEASING).finishAvailable).toBe(false);
    expect(describeEventScreen(REVEALED).finishAvailable).toBe(true);
  });

  it('says so LOUDLY when the engine runs a show this catalog has never heard of', () => {
    const orphan = state({ status: 'running', showId: 'ghost_show', currentStageId: 'x' });
    const screen = describeEventScreen(orphan);
    expect(screen.show).toBeNull();
    expect(screen.stages).toEqual([]);
    expect(screen.engineError).toContain('ghost_show');
    expect(screen.engineError).toContain('not in this catalog');
  });

  it('keeps the engine error alongside the catalog-divergence notice', () => {
    const both = state({
      status: 'running',
      showId: 'ghost_show',
      currentStageId: 'x',
      error: 'restore morph failed',
    });
    const msg = describeEventScreen(both).engineError ?? '';
    expect(msg).toContain('restore morph failed');
    expect(msg).toContain('ghost_show');
  });

  it('surfaces the engine error verbatim', () => {
    const broken = state({ status: 'ended', endedReason: 'restore_failed', error: 'snapshot ev_prev missing' });
    const screen = describeEventScreen(broken);
    expect(screen.engineError).toBe('snapshot ev_prev missing');
    expect(screen.mode).toBe('ended');
  });

  it('names every way a run can end, and never softens PANIC', () => {
    expect(describeEndReason(state({ endedReason: 'finished' }))).toContain('finished');
    expect(describeEndReason(state({ endedReason: 'aborted' }))).toContain('aborted');
    const panic = describeEndReason(state({ endedReason: 'panic' }));
    expect(panic).toContain('PANIC');
    expect(panic).toContain('NOT');
    expect(describeEndReason(state({ endedReason: 'restore_failed' }))).toContain('FAILED');
    expect(describeEndReason(state({ endedReason: null }))).toContain('no reason');
    // The engine's own detail is appended, never paraphrased away.
    expect(describeEndReason(state({
      endedReason: 'restore_failed',
      endedDetail: 'snapshot ev_prev missing',
    }))).toContain('snapshot ev_prev missing');
  });
});

describe('accents are data, chrome is tokens', () => {
  it('paints a legible accent and reports readable ink', () => {
    const paint = paintAccent(PINK, DARK_SURFACE);
    expect(paint).not.toBeNull();
    expect(paint!.fill).toBe(PINK);
    // Pink is bright: near-black ink.
    expect(paint!.ink).toBe('#0b0f10');
  });

  it('refuses an accent that cannot be seen against the surface', () => {
    expect(paintAccent('#181e21', DARK_SURFACE)).toBeNull();
    expect(paintAccent(null, DARK_SURFACE)).toBeNull();
  });

  it('holds the WCAG large-text bar', () => {
    expect(ACCENT_MIN_CONTRAST).toBe(3);
  });
});

describe('ARM confirm copy', () => {
  it('names every side effect of arming', () => {
    const msg = armConfirmMessage(BABY_REVEAL);
    expect(msg).toContain('Baby Reveal');
    expect(msg).toContain('captures the current look');
    expect(msg).toContain('autopilot');
    expect(msg).toContain('takes the rig over');
  });
});
