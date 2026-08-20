// Playlist role-routing contract. The engine deliberately rejects a deck
// channel on mixer playlist routes with HTTP 400 WRONG_ROLE, so the Deck UI
// must always use the role-aware helper.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchChannelPlaylist } from './api';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('./engineEvents', () => ({ engineEvents: { subscribe: () => () => undefined } }));
vi.mock('./apiBase', () => ({
  api_base: 'http://engine.test',
  getApiBase: () => 'http://engine.test',
  getApiBaseAsync: async () => 'http://engine.test',
  getDefaultApiBase: () => 'http://engine.test',
  setApiBase: () => undefined,
}));
vi.mock('./privileged_session', () => ({
  clearPrivilegedSession: async () => undefined,
  getPrivilegedSession: () => null,
}));
const okResponse = (body: unknown): Response => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
} as Response);

let requestedUrls: string[];

beforeEach(() => {
  requestedUrls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requestedUrls.push(url);
    return okResponse(null);
  }));
});

describe('fetchChannelPlaylist role routing', () => {
  it('routes the deck base channel to /deck/playlist, never a mixer channel URL', async () => {
    const result = await fetchChannelPlaylist('deck', 'ch_base');

    expect(result.ok).toBe(true);
    expect(requestedUrls).toEqual(['http://engine.test/deck/playlist']);
    expect(requestedUrls[0]).not.toContain('/mixer/channels/');
  });

  it('preserves the mixer channel endpoint for mixer roles', async () => {
    const result = await fetchChannelPlaylist('mixer', 'ch_fx');

    expect(result.ok).toBe(true);
    expect(requestedUrls).toEqual(['http://engine.test/mixer/channels/ch_fx/playlist']);
  });
});
