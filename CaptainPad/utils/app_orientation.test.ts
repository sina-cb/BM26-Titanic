import { afterEach, describe, expect, it, vi } from 'vitest';

const LANDSCAPE_LOCK = 6;

async function loadOrientationModule(platform: 'ios' | 'android' | 'web') {
  const lockAsync = vi.fn(async () => {});

  vi.resetModules();
  vi.doMock('react-native', () => ({ Platform: { OS: platform } }));
  vi.doMock('expo-screen-orientation', () => ({
    OrientationLock: { LANDSCAPE: LANDSCAPE_LOCK },
    lockAsync,
  }));

  return {
    module: await import('./app_orientation'),
    lockAsync,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('react-native');
  vi.doUnmock('expo-screen-orientation');
});

describe('CaptainPad app orientation', () => {
  it('locks native iOS to the SDK landscape lock', async () => {
    const { module, lockAsync } = await loadOrientationModule('ios');

    await module.lockCaptainPadOrientation();

    expect(module.CAPTAIN_PAD_ORIENTATION_LOCK).toBe(LANDSCAPE_LOCK);
    expect(lockAsync).toHaveBeenCalledOnce();
    expect(lockAsync).toHaveBeenCalledWith(LANDSCAPE_LOCK);
  });

  it('leaves web orientation responsive', async () => {
    const { module, lockAsync } = await loadOrientationModule('web');

    await module.lockCaptainPadOrientation();

    expect(lockAsync).not.toHaveBeenCalled();
  });

  it('fails loudly when the native lock is rejected', async () => {
    const { module, lockAsync } = await loadOrientationModule('ios');
    lockAsync.mockRejectedValueOnce(new Error('native module refused the lock'));

    await expect(module.lockCaptainPadOrientation()).rejects.toThrow(
      '[CaptainPad] landscape orientation lock failed: native module refused the lock',
    );
  });
});
