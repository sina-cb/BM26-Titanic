import { describe, it, expect } from 'vitest';
import { companionUrlFromApiBase, AUDIO_COMPANION_PORT } from './companion_url';

describe('companionUrlFromApiBase', () => {
  it('swaps the engine port for the companion port, keeping the host', () => {
    // The operator's iPad override — this MUST NOT resolve to 127.0.0.1.
    expect(companionUrlFromApiBase('http://10.1.1.151:6968')).toBe('http://10.1.1.151:6966');
  });

  it('handles a base with no explicit port', () => {
    expect(companionUrlFromApiBase('http://titanic-ext')).toBe('http://titanic-ext:6966');
  });

  it('handles the loopback default from config.yaml', () => {
    expect(companionUrlFromApiBase('http://127.0.0.1:6968')).toBe('http://127.0.0.1:6966');
  });

  it('preserves the scheme and tolerates a trailing slash / whitespace', () => {
    expect(companionUrlFromApiBase(' https://10.1.1.151:6968/ ')).toBe('https://10.1.1.151:6966');
  });

  it('handles a bracketed IPv6 host', () => {
    expect(companionUrlFromApiBase('http://[fe80::1]:6968')).toBe('http://[fe80::1]:6966');
  });

  it('fails loudly on an empty base (no silent fallback)', () => {
    expect(() => companionUrlFromApiBase('')).toThrow(/api_base is empty/);
    expect(() => companionUrlFromApiBase('   ')).toThrow(/api_base is empty/);
  });

  it('fails loudly on an unparseable base', () => {
    expect(() => companionUrlFromApiBase('10.1.1.151:6968')).toThrow(/cannot parse api_base/);
    expect(() => companionUrlFromApiBase('ws://10.1.1.151:6968')).toThrow(/cannot parse api_base/);
  });

  it('pins the companion port to the launcher value', () => {
    expect(AUDIO_COMPANION_PORT).toBe(6966);
  });
});
