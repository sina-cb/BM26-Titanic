// The SPECIAL EVENTS wire contract, from CaptainPad's side.
//
// Two jobs are pinned here. First, PARSING: a payload that does not match the
// contract must throw with the offending field named, because a half-read show
// is how an operator ends up tapping a button that does something else. Second,
// TRANSPORT: the ARM passcode travels in exactly one header on exactly one
// request and is never stored — the same audit agent _201 wrote for the
// timeline takeover, re-run for this route.
//
// P0: placeholder passcodes only — no credential material lives in this repo.

import { describe, expect, it, beforeEach, vi } from 'vitest';

const fetchWithTimeout = vi.fn();
vi.mock('./api', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));
vi.mock('./apiBase', () => ({
  getApiBaseAsync: async () => 'http://engine.test',
}));

import {
  armSpecialEvent,
  abortSpecialEvent,
  describeEventRefusal,
  EVENT_ACTIVE,
  fireSpecialEventQuickEffect,
  fireSpecialEventStage,
  parseEventCatalog,
  parseEventShow,
  parseSpecialEventsFrame,
  parseSpecialEventsState,
  NO_STAGE_AUTOPILOT,
  nowPlayingTitle,
  resetSpecialEventAutopilot,
  setSpecialEventAutopilot,
  SPECIAL_EVENT_LOCK,
  STAGE_NOT_ARMED,
} from './special_events_api';
import { TAKEOVER_PASSCODE_HEADER } from './timelineApi';

const FAKE_PASSCODE = 'fake-code-alpha';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

const GOOD_STAGE = {
  id: 'tease',
  label: 'START TEASE',
  color: '#FF9EC4',
  hint: 'Pink and blue, no answer yet.',
  ceremonial: false,
  kind: 'action',
  choices: [],
  quickEffects: [{ id: 'strobe', label: 'STROBE', color: '#FFF6E8' }],
  advance: { mode: 'manual', afterSec: null },
  extend: { label: 'RESTART TEASE', kind: 'actions' },
};

const GOOD_SHOW = {
  id: 'baby_reveal',
  name: 'Baby Reveal',
  color: '#FF9EC4',
  icon: 'sparkles',
  stages: [
    GOOD_STAGE,
    {
      id: 'reveal',
      label: 'THE REVEAL',
      ceremonial: true,
      kind: 'choice',
      quickEffects: [],
      advance: { mode: 'manual', afterSec: null },
      extend: null,
      choices: [
        { id: 'girl', label: 'ITS A GIRL', color: '#FF9EC4' },
        { id: 'boy', label: 'ITS A BOY', color: '#4FA8FF' },
      ],
    },
  ],
};

beforeEach(() => {
  fetchWithTimeout.mockReset();
  fetchWithTimeout.mockResolvedValue(jsonResponse({ ok: true }));
});

describe('catalog parsing', () => {
  it('reads a well-formed show, deriving stage kind from the data', () => {
    const show = parseEventShow(GOOD_SHOW);
    expect(show.id).toBe('baby_reveal');
    expect(show.stages[0].kind).toBe('action');
    expect(show.stages[0].effects)
      .toEqual([{ id: 'strobe', label: 'STROBE', color: '#FFF6E8' }]);
    expect(show.stages[0].extendLabel).toBe('RESTART TEASE');
    expect(show.stages[0].extendKind).toBe('actions');
    expect(show.stages[0].advanceSec).toBeNull();
    expect(show.stages[0].hint).toBe('Pink and blue, no answer yet.');
    expect(show.stages[1].kind).toBe('choice');
    expect(show.stages[1].ceremonial).toBe(true);
    expect(show.stages[1].choices.map((c) => c.id)).toEqual(['girl', 'boy']);
  });

  it('carries the load errors of broken show files so they can be shown', () => {
    const catalog = parseEventCatalog({
      shows: [GOOD_SHOW],
      loadErrors: [{ file: 'broken.yaml', error: "stage 'x' has neither actions nor choices" }],
    });
    expect(catalog.shows).toHaveLength(1);
    expect(catalog.errors[0].error).toContain('neither actions nor choices');
  });

  it('reads a timed advance window, and a manual stage as null', () => {
    const timed = parseEventShow({
      ...GOOD_SHOW,
      stages: [{ ...GOOD_STAGE, advance: { mode: 'timed', afterSec: 45 } }],
    });
    expect(timed.stages[0].advanceSec).toBe(45);
    expect(parseEventShow(GOOD_SHOW).stages[0].advanceSec).toBeNull();
  });

  it('refuses a stage whose declared kind contradicts its payload', () => {
    expect(() => parseEventShow({
      ...GOOD_SHOW,
      stages: [{ ...GOOD_STAGE, kind: 'choice' }],
    })).toThrow(/'kind' is 'choice' but the stage has 0 choices/);
  });

  it('refuses a malformed accent instead of crashing inside a render', () => {
    expect(() => parseEventShow({ ...GOOD_SHOW, color: 'hot-pink' }))
      .toThrow(/must be a #rrggbb color/);
  });

  it('refuses a show with no stages, and a stage with no label', () => {
    expect(() => parseEventShow({ ...GOOD_SHOW, stages: [] }))
      .toThrow(/'stages' must be a non-empty array/);
    expect(() => parseEventShow({ ...GOOD_SHOW, stages: [{ id: 'x' }] }))
      .toThrow(/'label' must be a non-empty string/);
  });

  it('refuses a timed stage with no usable window', () => {
    expect(() => parseEventShow({
      ...GOOD_SHOW,
      stages: [{ ...GOOD_STAGE, advance: { mode: 'timed', afterSec: 0 } }],
    })).toThrow(/'advance.afterSec' must be a positive finite number/);
  });

  it('refuses an extend whose kind it does not understand', () => {
    expect(() => parseEventShow({
      ...GOOD_SHOW,
      stages: [{ ...GOOD_STAGE, extend: { label: '+30s', kind: 'magic' } }],
    })).toThrow(/'extend.kind' must be 'time' or 'actions'/);
  });
});

describe('state parsing', () => {
  it('reads the full document, renaming engine fields to the app vocabulary', () => {
    const s = parseSpecialEventsState({
      type: 'specialEvents',
      status: 'running',
      showId: 'baby_reveal',
      stageId: 'tease',
      armedStageId: 'blackout',
      choiceId: null,
      countdownSec: 42,
      stageElapsedSec: 7,
      endedReason: null,
      lastError: null,
      timelineLeaseHeld: true,
      shows: [GOOD_SHOW],
      loadErrors: [],
    });
    expect(s.status).toBe('running');
    // `stageId` on the wire is the stage HOLDING the rig.
    expect(s.currentStageId).toBe('tease');
    expect(s.armedStageId).toBe('blackout');
    expect(s.countdownSec).toBe(42);
    expect(s.stageElapsedSec).toBe(7);
    expect(s.leaseHeld).toBe(true);
    // The show library rides along, so the run and the shows are one document.
    expect(s.catalog.shows.map((x) => x.id)).toEqual(['baby_reveal']);
  });

  it('reads an idle document with an empty library', () => {
    const s = parseSpecialEventsState({ status: 'idle', shows: [], loadErrors: [] });
    expect(s.showId).toBeNull();
    expect(s.currentStageId).toBeNull();
    expect(s.error).toBeNull();
    expect(s.leaseHeld).toBe(false);
    expect(s.catalog.shows).toEqual([]);
  });

  it('surfaces the engine lastError and endedDetail', () => {
    const s = parseSpecialEventsState({
      status: 'ended',
      endedReason: 'restore_failed',
      endedDetail: 'snapshot ev_prev missing',
      lastError: 'recall failed',
      shows: [],
      loadErrors: [],
    });
    expect(s.error).toBe('recall failed');
    expect(s.endedDetail).toBe('snapshot ev_prev missing');
  });

  it('refuses an unknown status or end reason', () => {
    expect(() => parseSpecialEventsState({ status: 'halfway', shows: [] }))
      .toThrow(/'status' must be one of/);
    expect(() => parseSpecialEventsState({ status: 'ended', endedReason: 'meh', shows: [] }))
      .toThrow(/'endedReason' must be one of/);
  });

  it('refuses a document with no show library at all', () => {
    expect(() => parseSpecialEventsState({ status: 'idle' }))
      .toThrow(/'shows' must be an array/);
  });
});

describe('WS frame envelope', () => {
  it('reads the engine\'s flat broadcast idiom', () => {
    const s = parseSpecialEventsFrame({
      type: 'specialEvents', status: 'armed', showId: 'baby_reveal', shows: [], loadErrors: [],
    });
    expect(s.status).toBe('armed');
    expect(s.showId).toBe('baby_reveal');
  });

  it('reads a document nested under `state`', () => {
    const s = parseSpecialEventsFrame({
      type: 'specialEvents', state: { status: 'idle', shows: [], loadErrors: [] },
    });
    expect(s.status).toBe('idle');
  });

  it('throws on a frame it cannot read, rather than dropping it silently', () => {
    expect(() => parseSpecialEventsFrame({ type: 'specialEvents' }))
      .toThrow(/'status' must be one of/);
  });
});

describe('transport', () => {
  it('ARMs with no passcode header when none is supplied', async () => {
    await armSpecialEvent('baby_reveal');
    const [url, init] = fetchWithTimeout.mock.calls[0];
    expect(url).toBe('http://engine.test/special-events/arm');
    expect(init.body).toBe(JSON.stringify({ show: 'baby_reveal' }));
    expect(Object.keys(init.headers)).not.toContain(TAKEOVER_PASSCODE_HEADER);
  });

  it('attaches the passcode to exactly that one request, in the header only', async () => {
    await armSpecialEvent('baby_reveal', FAKE_PASSCODE);
    const [url, init] = fetchWithTimeout.mock.calls[0];
    expect(init.headers[TAKEOVER_PASSCODE_HEADER]).toBe(FAKE_PASSCODE);
    expect(init.headers['Content-Type']).toBe('application/json');
    // Never in the URL, never in the body.
    expect(url).not.toContain(FAKE_PASSCODE);
    expect(String(init.body)).not.toContain(FAKE_PASSCODE);
  });

  it('does not leak the passcode into the NEXT request', async () => {
    await armSpecialEvent('baby_reveal', FAKE_PASSCODE);
    await armSpecialEvent('baby_reveal');
    const second = fetchWithTimeout.mock.calls[1][1];
    expect(second.headers[TAKEOVER_PASSCODE_HEADER]).toBeUndefined();
  });

  it('never carries a passcode on the non-takeover verbs', async () => {
    await fireSpecialEventStage('reveal', 'girl');
    await fireSpecialEventQuickEffect('strobe');
    await abortSpecialEvent();
    for (const call of fetchWithTimeout.mock.calls) {
      expect(call[1].headers[TAKEOVER_PASSCODE_HEADER]).toBeUndefined();
    }
  });

  it('posts the choice with the stage, and omits it for an action stage', async () => {
    await fireSpecialEventStage('reveal', 'girl');
    expect(fetchWithTimeout.mock.calls[0][1].body)
      .toBe(JSON.stringify({ stageId: 'reveal', choiceId: 'girl' }));
    await fireSpecialEventStage('blackout');
    expect(fetchWithTimeout.mock.calls[1][1].body)
      .toBe(JSON.stringify({ stageId: 'blackout' }));
  });

  it('pulses a quick effect by id alone - the engine resolves the stage', async () => {
    await fireSpecialEventQuickEffect('strobe');
    const [url, init] = fetchWithTimeout.mock.calls[0];
    expect(url).toBe('http://engine.test/special-events/quick-effect');
    expect(init.body).toBe(JSON.stringify({ id: 'strobe' }));
  });

  it('adopts the state the engine returns from a mutation', async () => {
    fetchWithTimeout.mockResolvedValue(jsonResponse({
      status: 'ok',
      state: {
        status: 'running', stageId: 'tease', armedStageId: 'blackout', shows: [], loadErrors: [],
      },
    }));
    const r = await fireSpecialEventStage('tease');
    expect(r.ok).toBe(true);
    expect(r.data?.currentStageId).toBe('tease');
    expect(r.data?.armedStageId).toBe('blackout');
  });

  it('refuses a mutation response with no state document', async () => {
    fetchWithTimeout.mockResolvedValue(jsonResponse({ status: 'ok' }));
    const r = await fireSpecialEventStage('tease');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected a 'state' document/);
  });

  it('threads the engine refusal code through, verbatim message and all', async () => {
    fetchWithTimeout.mockResolvedValue(
      jsonResponse({ error: 'stage reveal is not armed', code: STAGE_NOT_ARMED }, 409),
    );
    const r = await fireSpecialEventStage('reveal', 'girl');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.code).toBe(STAGE_NOT_ARMED);
    expect(r.error).toBe('stage reveal is not armed');
  });

  it('reports a transport failure honestly instead of faking a refusal', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('Network request failed'));
    const r = await abortSpecialEvent();
    expect(r.ok).toBe(false);
    expect(r.status).toBeUndefined();
    expect(r.error).toBe('Network request failed');
  });
});

describe('refusal copy', () => {
  it('explains the well-known codes and always keeps the engine sentence', () => {
    expect(describeEventRefusal({ error: 'stage reveal is not armed', code: STAGE_NOT_ARMED }))
      .toContain('Out of order');
    expect(describeEventRefusal({ error: 'stage reveal is not armed', code: STAGE_NOT_ARMED }))
      .toContain('stage reveal is not armed');
    expect(describeEventRefusal({ error: 'baby_reveal is armed', code: EVENT_ACTIVE }))
      .toContain('already armed or running');
    expect(describeEventRefusal({ error: 'event owns the deck', code: SPECIAL_EVENT_LOCK }))
      .toContain('owns the deck');
  });

  it('passes an unknown refusal straight through', () => {
    expect(describeEventRefusal({ error: 'portwatch owns the rig', code: 'WRONG_ROLE' }))
      .toBe('portwatch owns the rig');
    expect(describeEventRefusal({ status: 500 })).toBe('HTTP 500');
  });
});

// ── stage autopilot (the show's pattern rotation) ─────────────────────────
//
// The operator retunes the tease cadence and its crossfade from this tab while
// the ceremony runs, so the wire for it has to be exact in both directions:
// what the engine says is rotating, and what a knob sends back.

describe('stage autopilot', () => {
  const ROTATION = {
    supported: true,
    stageId: 'tease',
    active: true,
    everySec: 20,
    shuffle: false,
    groupMode: false,
    groupSize: 3,
    groupDwell: 6,
    transition: { enabled: true, mode: 'trans_crossfade', durationMs: 2000, shuffle: false },
    nextSwapAtMs: 1760000000000,
    overridden: false,
  };

  it('reads the live rotation off the state document', () => {
    const s = parseSpecialEventsState({
      status: 'running', stageId: 'tease', shows: [], loadErrors: [], autopilot: ROTATION,
    });
    expect(s.autopilot.supported).toBe(true);
    expect(s.autopilot.stageId).toBe('tease');
    expect(s.autopilot.everySec).toBe(20);
    expect(s.autopilot.transition?.durationMs).toBe(2000);
    expect(s.autopilot.transition?.mode).toBe('trans_crossfade');
    expect(s.autopilot.nextSwapAtMs).toBe(1760000000000);
    expect(s.autopilot.overridden).toBe(false);
  });

  // An unsupported stage carries nulls where a supported one carries numbers,
  // so the card cannot be drawn half-configured off a blackout.
  it('reads an unsupported stage without inventing a cadence', () => {
    const s = parseSpecialEventsState({
      status: 'running', shows: [], loadErrors: [],
      autopilot: { ...ROTATION, supported: false, stageId: null, active: false,
        everySec: null, groupSize: null, groupDwell: null, transition: null,
        nextSwapAtMs: null },
    });
    expect(s.autopilot.supported).toBe(false);
    expect(s.autopilot.everySec).toBeNull();
    expect(s.autopilot.transition).toBeNull();
  });

  // Absent is tolerated (it means "nothing is rotating") so a missing optional
  // CARD can never black out this tab's ABORT button. Present-but-broken is
  // still a loud throw — that is the line.
  it('treats an absent block as nothing rotating, but refuses a malformed one', () => {
    const s = parseSpecialEventsState({ status: 'idle', shows: [], loadErrors: [] });
    expect(s.autopilot.supported).toBe(false);
    expect(s.autopilot.active).toBe(false);

    expect(() => parseSpecialEventsState({
      status: 'running', shows: [], loadErrors: [],
      autopilot: { ...ROTATION, everySec: 'twenty' },
    })).toThrow(/everySec/);
    expect(() => parseSpecialEventsState({
      status: 'running', shows: [], loadErrors: [],
      autopilot: { ...ROTATION, transition: { enabled: true, mode: 'trans_crossfade' } },
    })).toThrow(/durationMs/);
  });

  // NOW PLAYING (docs/57 §4.3, report `_240`) — the SHOW card's first line.
  it('reads nowPlaying off the same block, and treats absent as nothing to name', () => {
    const withEntry = parseSpecialEventsState({
      status: 'running', shows: [], loadErrors: [],
      autopilot: { ...ROTATION, nowPlaying: { pattern: '07_shimmer', label: 'Shimmer Deep' } },
    });
    expect(withEntry.autopilot.nowPlaying).toEqual({
      pattern: '07_shimmer', label: 'Shimmer Deep',
    });

    // A deck with no active entry, and an omitted field, both mean "nothing".
    for (const nowPlaying of [null, undefined]) {
      const s = parseSpecialEventsState({
        status: 'running', shows: [], loadErrors: [],
        autopilot: { ...ROTATION, nowPlaying },
      });
      expect(s.autopilot.nowPlaying).toBeNull();
    }
    // An unsupported stage carries null too.
    const idle = parseSpecialEventsState({ status: 'idle', shows: [], loadErrors: [] });
    expect(idle.autopilot.nowPlaying).toBeNull();
  });

  // Present-but-malformed still throws: the card would otherwise render a
  // confident blank where a pattern name belongs.
  it('refuses a malformed nowPlaying block', () => {
    expect(() => parseSpecialEventsState({
      status: 'running', shows: [], loadErrors: [],
      autopilot: { ...ROTATION, nowPlaying: { pattern: 42, label: null } },
    })).toThrow(/pattern/);
    expect(() => parseSpecialEventsState({
      status: 'running', shows: [], loadErrors: [],
      autopilot: { ...ROTATION, nowPlaying: 'shimmer' },
    })).toThrow(/nowPlaying/);
  });

  it('names an entry the way the operator named it', () => {
    // label wins; the pattern id is the fallback; nothing usable is null.
    expect(nowPlayingTitle({ pattern: '07_shimmer', label: 'Shimmer Deep' })).toBe('Shimmer Deep');
    expect(nowPlayingTitle({ pattern: '07_shimmer', label: null })).toBe('07_shimmer');
    expect(nowPlayingTitle({ pattern: '07_shimmer', label: '   ' })).toBe('07_shimmer');
    expect(nowPlayingTitle({ pattern: null, label: null })).toBeNull();
    expect(nowPlayingTitle(null)).toBeNull();
  });

  it('carries the authored defaults of each stage on the show summary', () => {
    const show = parseEventShow({
      id: 'baby_reveal',
      name: 'Baby Reveal',
      stages: [
        { id: 'tease', label: 'TEASE', autopilot: { ...ROTATION, supported: true } },
        { id: 'blackout', label: 'GO DARK' },
      ],
    });
    expect(show.stages[0].autopilot.supported).toBe(true);
    expect(show.stages[0].autopilot.everySec).toBe(20);
    // A stage that authors none still parses — it simply draws no card.
    expect(show.stages[1].autopilot.supported).toBe(false);
  });

  it('POSTs a sparse patch and adopts the engine answer', async () => {
    fetchWithTimeout.mockResolvedValueOnce(jsonResponse({
      status: 'ok',
      state: {
        status: 'running', stageId: 'tease', shows: [], loadErrors: [],
        autopilot: { ...ROTATION, everySec: 8, overridden: true },
      },
    }));
    const r = await setSpecialEventAutopilot({ everySec: 8 });
    expect(r.ok).toBe(true);
    expect(r.data?.autopilot.everySec).toBe(8);
    expect(r.data?.autopilot.overridden).toBe(true);

    const [url, init] = fetchWithTimeout.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://engine.test/special-events/autopilot');
    expect(init.method).toBe('POST');
    // SPARSE: only the knob that moved is sent, so the engine merges rather
    // than the tab overwriting settings it never touched.
    expect(JSON.parse(init.body as string)).toEqual({ everySec: 8 });
  });

  it('sends reset as its own verb', async () => {
    fetchWithTimeout.mockResolvedValueOnce(jsonResponse({
      status: 'ok',
      state: { status: 'running', shows: [], loadErrors: [], autopilot: ROTATION },
    }));
    await resetSpecialEventAutopilot();
    const [, init] = fetchWithTimeout.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ reset: true });
  });

  it('explains a stage that has no rotation to tune', () => {
    const said = describeEventRefusal({
      error: 'stage "blackout" authors no autopilot block',
      code: NO_STAGE_AUTOPILOT,
    });
    expect(said).toContain('does not rotate patterns');
    expect(said).toContain('blackout');
  });
});
