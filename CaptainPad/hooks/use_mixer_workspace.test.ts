// use_mixer_workspace — tests for the PURE engine `createMixerWorkspaceEngine`
// factors out of the `useMixerWorkspace` React hook (contract:
// docs/64_mixer_relayout.md §2, §2.2, §2.3, W3b).
//
// There is no React renderer in this repo's devDependencies (no
// `react-test-renderer`, no `@testing-library/react-*`) and the vitest config
// only discovers plain `.ts` — so the hook's own `useState`/`useEffect` body
// cannot be exercised directly (same reason `deck_workspace.tsx`'s
// `useDeckWorkspace` has no direct test). Every decision the hook makes lives
// in the engine below and is driven here with spy `onChange`/`onPersist`
// callbacks standing in for React's setState / AsyncStorage.setItem.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createMixerWorkspaceEngine } from './use_mixer_workspace';
import {
  MASTER_BAND_ID,
  channelSurfaceId,
  citizenSurfaceId,
  isCitizenShown,
  isSectionShown,
  normalizeLayout,
  sectionSurfaceId,
  visibleChannels,
  type MixerChannelId,
} from '@/components/mixer/mixer_workspace_layout';

const ROSTER: readonly MixerChannelId[] = ['a', 'b', 'c'];

function makeEngine() {
  const onChange = vi.fn();
  const onPersist = vi.fn();
  const engine = createMixerWorkspaceEngine(onChange, onPersist);
  return { engine, onChange, onPersist };
}

describe('createMixerWorkspaceEngine — hydrate discipline', () => {
  it('hydrate() with no prior store reproduces normalizeLayout(undefined, roster) exactly', () => {
    const { engine, onPersist } = makeEngine();
    engine.commit(ROSTER, true); // pre-hydrate: stashes, never persists
    expect(onPersist).not.toHaveBeenCalled();
    engine.hydrate(undefined);
    expect(engine.getLayout()).toEqual(normalizeLayout(undefined, ROSTER));
  });

  it('hydrate() never persists — normalizing the stored value is a pure read', () => {
    const { engine, onPersist } = makeEngine();
    engine.commit(ROSTER, true);
    engine.hydrate({ closed: [channelSurfaceId('a')] });
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('replays a commit that arrived before hydrate — pruning a stale closed entry the stored raw carries', () => {
    const { engine, onPersist } = makeEngine();
    // The roster shrank to ['a', 'b'] BEFORE the async storage read landed.
    engine.commit(['a', 'b'], true);
    // The stored raw still has channel 'c' hidden from a previous session.
    engine.hydrate({ closed: [channelSurfaceId('c'), channelSurfaceId('a')] });
    // normalizeLayout alone never prunes by roster (closed entries are kept
    // verbatim) — only the REPLAYED commitRoster prunes 'c' once it lands.
    expect(engine.getLayout().closed).not.toContain(channelSurfaceId('c'));
    expect(engine.getLayout().closed).toContain(channelSurfaceId('a'));
    // One persisted write — the replay's own, not a second one from hydrate.
    expect(onPersist).toHaveBeenCalledTimes(1);
  });

  it('hydrate() is idempotent — a second call is a total no-op', () => {
    const { engine, onChange } = makeEngine();
    engine.commit(ROSTER, true);
    engine.hydrate({ closed: [channelSurfaceId('b')], known: [] });
    const afterFirst = engine.getLayout();
    onChange.mockClear();
    engine.hydrate({ closed: [], known: [] }); // different payload, ignored
    expect(engine.getLayout()).toBe(afterFirst);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a live gesture before hydrate wins — the stored preference never overwrites it', () => {
    const { engine } = makeEngine();
    engine.commit(ROSTER, true); // pre-hydrate stash only
    engine.close(channelSurfaceId('a')); // touches — hides channel 'a'
    expect(visibleChannels(ROSTER, engine.getLayout())).toEqual(['b', 'c']);
    // The store on disk claims 'b' was hidden instead — must be ignored.
    engine.hydrate({ closed: [channelSurfaceId('b')] });
    expect(visibleChannels(ROSTER, engine.getLayout())).toEqual(['b', 'c']);
  });
});

describe('createMixerWorkspaceEngine — the write gate (same-reference no-op)', () => {
  it('open() on an id that is not closed is a no-op: no onChange, no onPersist', () => {
    const { engine, onChange, onPersist } = makeEngine();
    engine.commit(ROSTER, true);
    engine.hydrate(undefined);
    onChange.mockClear();
    onPersist.mockClear();
    engine.open(channelSurfaceId('a')); // already open
    expect(onChange).not.toHaveBeenCalled();
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('close() then close() again on the same id only persists once', () => {
    const { engine, onPersist } = makeEngine();
    engine.commit(ROSTER, true);
    engine.hydrate(undefined);
    onPersist.mockClear();
    engine.close(channelSurfaceId('a'));
    expect(onPersist).toHaveBeenCalledTimes(1);
    engine.close(channelSurfaceId('a'));
    expect(onPersist).toHaveBeenCalledTimes(1);
  });

  it('reset() with nothing to reset is a no-op', () => {
    const { engine, onChange, onPersist } = makeEngine();
    engine.commit(ROSTER, true);
    engine.hydrate(undefined); // colors already default-closed, nothing else to reset
    onChange.mockClear();
    onPersist.mockClear();
    engine.reset();
    expect(onChange).not.toHaveBeenCalled();
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('commit() with an unchanged, already-confirmed roster is a no-op', () => {
    const { engine, onPersist } = makeEngine();
    engine.commit(ROSTER, true);
    engine.hydrate(undefined);
    onPersist.mockClear();
    engine.commit(ROSTER, true); // identical roster, nothing to prune/re-know
    expect(onPersist).not.toHaveBeenCalled();
  });
});

describe('createMixerWorkspaceEngine — close()/open() round trip + floor', () => {
  it('close hides a channel; open restores it; visibleChannels reflects both', () => {
    const { engine } = makeEngine();
    engine.commit(ROSTER, true);
    engine.hydrate(undefined);
    engine.close(channelSurfaceId('b'));
    expect(visibleChannels(ROSTER, engine.getLayout())).toEqual(['a', 'c']);
    engine.open(channelSurfaceId('b'));
    expect(visibleChannels(ROSTER, engine.getLayout())).toEqual(['a', 'b', 'c']);
  });

  it('refuses to close the last visible channel, using the internally-tracked roster', () => {
    const { engine } = makeEngine();
    const solo: readonly MixerChannelId[] = ['only'];
    engine.commit(solo, true);
    engine.hydrate(undefined);
    engine.close(channelSurfaceId('only'));
    expect(visibleChannels(solo, engine.getLayout())).toEqual(['only']);
  });

  it('sections and citizens honour their own defaults (params/pixels visible, BOTH citizens hidden)', () => {
    const { engine } = makeEngine();
    engine.commit(ROSTER, true);
    engine.hydrate(undefined);
    const layout = engine.getLayout();
    expect(isSectionShown(layout, 'a', 'params')).toBe(true);
    expect(isSectionShown(layout, 'a', 'pixels')).toBe(true);
    // docs/67 §2: masterBand joined colors in the shipped default-closed set.
    // A hydrate of `undefined` IS the fresh-store case the flip targets.
    expect(isCitizenShown(layout, 'masterBand')).toBe(false);
    expect(isCitizenShown(layout, 'colors')).toBe(false);
  });
});

describe('createMixerWorkspaceEngine — commit() roster confirmation', () => {
  it('an unconfirmed commit never prunes a channel that left the roster', () => {
    const { engine, onPersist } = makeEngine();
    engine.commit(ROSTER, true);
    engine.hydrate(undefined);
    engine.close(channelSurfaceId('c'));
    onPersist.mockClear();
    engine.commit(['a', 'b'], false); // 'c' left, but this snapshot is unconfirmed
    expect(engine.getLayout().closed).toContain(channelSurfaceId('c'));
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('a confirmed commit prunes closed entries for channels no longer in the roster', () => {
    const { engine, onPersist } = makeEngine();
    engine.commit(ROSTER, true);
    engine.hydrate(undefined);
    engine.close(channelSurfaceId('c'));
    onPersist.mockClear();
    engine.commit(['a', 'b'], true);
    expect(engine.getLayout().closed).not.toContain(channelSurfaceId('c'));
    expect(onPersist).toHaveBeenCalledTimes(1);
  });

  it('a channel absent from the roster at hydrate time, added later, defaults VISIBLE (docs/64 §2.3)', () => {
    const { engine } = makeEngine();
    // Boot: engine only knows about 'a' and 'b'.
    engine.commit(['a', 'b'], true);
    engine.hydrate(undefined);
    // A confirmed broadcast reports a brand-new channel 'd'.
    engine.commit(['a', 'b', 'd'], true);
    expect(visibleChannels(['a', 'b', 'd'], engine.getLayout())).toEqual(['a', 'b', 'd']);
  });
});

describe('createMixerWorkspaceEngine — never touches performance mode', () => {
  it('the engine module has zero performance-mode awareness — perf enter/exit cannot write', () => {
    // The strongest guarantee this engine can offer against a perf-mode
    // transition writing anything is that it has no code path that could even
    // observe one: perf composes OUTSIDE this hook (docs/64 §2.6), purely as
    // a derivation over `layout` by the caller. A source scan pins that this
    // stays true rather than a runtime simulation that can't actually prove a
    // negative about a state this module never reads. (The file's own doc
    // comment NAMES `usePerformanceMode.ts` as a design precedent, so the
    // scan checks for an actual IMPORT/CALL, not the bare word.)
    const src = readFileSync(join(__dirname, './use_mixer_workspace.ts'), 'utf8');
    expect(src).not.toMatch(/from ['"]@\/hooks\/usePerformanceMode['"]/);
    expect(src).not.toMatch(/usePerformanceMode\(|perfActive/);
  });

  it('concretely: no method call sequence unrelated to open/close/reset/commit ever persists', () => {
    const { engine, onPersist } = makeEngine();
    engine.commit(ROSTER, true);
    engine.hydrate(undefined);
    onPersist.mockClear();
    // getLayout() is the only other surface the hook exposes to a re-render
    // (e.g. a perf-mode toggle re-rendering the screen calls this, nothing
    // else) — reading it must never itself be a write.
    for (let i = 0; i < 5; i += 1) engine.getLayout();
    expect(onPersist).not.toHaveBeenCalled();
  });
});

describe('createMixerWorkspaceEngine — surface id sanity against the shared constants', () => {
  it('uses the same MASTER_BAND_ID the store exports', () => {
    expect(citizenSurfaceId('masterBand')).toBe(MASTER_BAND_ID);
  });

  it('sectionSurfaceId ids the engine closes are the ones isSectionShown reads', () => {
    const { engine } = makeEngine();
    engine.commit(ROSTER, true);
    engine.hydrate(undefined);
    engine.close(sectionSurfaceId('a', 'params'));
    expect(isSectionShown(engine.getLayout(), 'a', 'params')).toBe(false);
    expect(isSectionShown(engine.getLayout(), 'a', 'pixels')).toBe(true);
  });
});
