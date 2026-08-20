// deck_workspace_store.test.ts — the shared in-memory deck workspace store.
//
// Deck and Mixer each call `useDeckWorkspace()` while their tabs stay mounted;
// this suite proves the store converges every subscriber immediately and
// persists at most once per actual transition.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_LAYOUT } from '@/components/deck/deck_workspace_layout';
import {
  __resetDeckWorkspaceStoreForTests,
  createDeckWorkspaceStore,
} from '@/components/deck/deck_workspace_store';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_SOURCE = readFileSync(join(HERE, 'deck_workspace.tsx'), 'utf8');

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

afterEach(() => {
  __resetDeckWorkspaceStoreForTests();
});

describe('createDeckWorkspaceStore — multi-consumer convergence', () => {
  it('two subscribers see the same layout immediately after one dispatches close(audioBar)', () => {
    const persist = vi.fn();
    const store = createDeckWorkspaceStore(persist);
    const seenA: string[][] = [];
    const seenB: string[][] = [];

    const offA = store.subscribe(() => {
      seenA.push([...store.getLayout().closed]);
    });
    const offB = store.subscribe(() => {
      seenB.push([...store.getLayout().closed]);
    });

    store.dispatch({ type: 'close', id: 'audioBar' });

    expect(store.getLayout().closed).toContain('audioBar');
    expect(seenA.at(-1)).toContain('audioBar');
    expect(seenB.at(-1)).toContain('audioBar');
    expect(persist).toHaveBeenCalledTimes(1);

    store.dispatch({ type: 'close', id: 'audioBar' });
    expect(persist).toHaveBeenCalledTimes(1);

    offA();
    offB();
  });

  it('open(audioBar) fans out to every mounted subscriber after a hide', () => {
    const persist = vi.fn();
    const store = createDeckWorkspaceStore(persist);
    store.dispatch({ type: 'close', id: 'audioBar' });

    const seen: boolean[] = [];
    const off = store.subscribe(() => {
      seen.push(!store.getLayout().closed.includes('audioBar'));
    });

    store.dispatch({ type: 'open', id: 'audioBar' });

    expect(store.getLayout().closed).not.toContain('audioBar');
    expect(seen.at(-1)).toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);

    off();
  });

  it('stops notifying an unsubscribed listener', () => {
    const persist = vi.fn();
    const store = createDeckWorkspaceStore(persist);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    off();

    store.dispatch({ type: 'close', id: 'audioBar' });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createDeckWorkspaceStore — hydrate + touched discipline', () => {
  it('hydrate does not overwrite a live operator gesture', () => {
    const persist = vi.fn();
    const store = createDeckWorkspaceStore(persist);

    store.dispatch({ type: 'close', id: 'audioBar' });
    store.hydrateFromStorageRaw(JSON.stringify({ closed: [], known: [] }));

    expect(store.getLayout().closed).toContain('audioBar');
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('hydrate never persists — only dispatch does', () => {
    const persist = vi.fn();
    const store = createDeckWorkspaceStore(persist);

    store.hydrateFromStorageRaw(JSON.stringify({ closed: ['audioBar'], known: [] }));

    expect(store.getLayout().closed).toContain('audioBar');
    expect(persist).not.toHaveBeenCalled();
  });

  it('hydrate is idempotent', () => {
    const persist = vi.fn();
    const store = createDeckWorkspaceStore(persist);
    const payload = JSON.stringify({ closed: ['audioBar'], known: [] });

    store.hydrateFromStorageRaw(payload);
    const afterFirst = store.getLayout();
    store.hydrateFromStorageRaw(JSON.stringify({ closed: [], known: [] }));

    expect(store.getLayout()).toBe(afterFirst);
    expect(persist).not.toHaveBeenCalled();
  });

  it('a null storage payload keeps the shipped default without persisting', () => {
    const persist = vi.fn();
    const store = createDeckWorkspaceStore(persist);

    store.hydrateFromStorageRaw(null);

    expect(store.getLayout()).toEqual(DEFAULT_LAYOUT);
    expect(persist).not.toHaveBeenCalled();
  });

  it('getLayout keeps a stable reference until the closed set changes', () => {
    const store = createDeckWorkspaceStore(vi.fn());
    const first = store.getLayout();
    expect(store.getLayout()).toBe(first);

    store.dispatch({ type: 'close', id: 'audioBar' });
    expect(store.getLayout()).not.toBe(first);
  });
});

describe('createDeckWorkspaceStore — corrupt storage', () => {
  it('falls back to the default layout on invalid JSON without persisting', () => {
    const persist = vi.fn();
    const store = createDeckWorkspaceStore(persist);

    store.hydrateFromStorageRaw('{not json');

    expect(store.getLayout()).toEqual(DEFAULT_LAYOUT);
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('useDeckWorkspace wiring', () => {
  const hookCode = stripComments(HOOK_SOURCE);

  it('reads layout through useSyncExternalStore on the shared store', () => {
    expect(hookCode).toMatch(/const store = getDeckWorkspaceStore\(\)/);
    expect(hookCode).toMatch(/useSyncExternalStore\(store\.subscribe, store\.getLayout, store\.getLayout\)/);
  });
});
