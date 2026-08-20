import { describe, expect, it } from 'vitest';

import {
  PIXEL_SIMULATION_PATH,
  SIMULATION_PORT,
  simulationOriginFromApiBase,
  simulationUrlFromApiBase,
} from './simulation_url';

describe('simulationUrlFromApiBase', () => {
  it('uses the engine host with the simulator port and canonical 2D query', () => {
    expect(simulationUrlFromApiBase('http://10.1.1.151:6968')).toBe(
      'http://10.1.1.151:6969/simulation/?profile=2d_pixels&lighting_mode=sacn_in',
    );
  });

  it('handles a hostname without an explicit engine port', () => {
    expect(simulationUrlFromApiBase('http://titanic-ext')).toBe(
      'http://titanic-ext:6969/simulation/?profile=2d_pixels&lighting_mode=sacn_in',
    );
  });

  it('preserves HTTPS and accepts surrounding whitespace and a trailing slash', () => {
    expect(simulationUrlFromApiBase(' https://10.1.1.151:6968/ ')).toBe(
      'https://10.1.1.151:6969/simulation/?profile=2d_pixels&lighting_mode=sacn_in',
    );
  });

  it('handles a bracketed IPv6 engine host', () => {
    expect(simulationUrlFromApiBase('http://[fe80::1]:6968')).toBe(
      'http://[fe80::1]:6969/simulation/?profile=2d_pixels&lighting_mode=sacn_in',
    );
  });

  it('fails loudly instead of guessing when api_base is empty', () => {
    expect(() => simulationUrlFromApiBase('')).toThrow(/api_base is empty/);
    expect(() => simulationUrlFromApiBase('   ')).toThrow(/api_base is empty/);
  });

  it('fails loudly on unsupported or incomplete addresses', () => {
    expect(() => simulationUrlFromApiBase('10.1.1.151:6968')).toThrow(
      /cannot parse api_base/,
    );
    expect(() => simulationUrlFromApiBase('ws://10.1.1.151:6968')).toThrow(
      /cannot parse api_base/,
    );
    expect(() => simulationUrlFromApiBase('http://10.1.1.151:6968/extra')).toThrow(
      /cannot parse api_base/,
    );
  });

  it('pins the launcher port and canonical view contract', () => {
    expect(SIMULATION_PORT).toBe(6969);
    expect(PIXEL_SIMULATION_PATH).toBe(
      '/simulation/?profile=2d_pixels&lighting_mode=sacn_in',
    );
  });
});

describe('simulationOriginFromApiBase', () => {
  it('returns a bare origin with no route attached', () => {
    expect(simulationOriginFromApiBase('http://10.1.1.151:6968')).toBe('http://10.1.1.151:6969');
    expect(simulationOriginFromApiBase('http://titanic-ext')).toBe('http://titanic-ext:6969');
    expect(simulationOriginFromApiBase(' https://10.1.1.151:6968/ ')).toBe('https://10.1.1.151:6969');
    expect(simulationOriginFromApiBase('http://[fe80::1]:6968')).toBe('http://[fe80::1]:6969');
  });

  it('is the exact prefix the iframe URL is built from — one host decision', () => {
    for (const base of ['http://10.1.1.151:6968', 'http://titanic-ext', 'https://[fe80::1]:6968']) {
      expect(simulationUrlFromApiBase(base))
        .toBe(`${simulationOriginFromApiBase(base)}${PIXEL_SIMULATION_PATH}`);
    }
  });

  it('fails loudly rather than guessing, exactly like the URL builder', () => {
    expect(() => simulationOriginFromApiBase('')).toThrow(/api_base is empty/);
    expect(() => simulationOriginFromApiBase('   ')).toThrow(/api_base is empty/);
    expect(() => simulationOriginFromApiBase('10.1.1.151:6968')).toThrow(/cannot parse api_base/);
    expect(() => simulationOriginFromApiBase('ws://10.1.1.151:6968')).toThrow(/cannot parse api_base/);
    expect(() => simulationOriginFromApiBase('http://10.1.1.151:6968/extra')).toThrow(/cannot parse api_base/);
  });
});
