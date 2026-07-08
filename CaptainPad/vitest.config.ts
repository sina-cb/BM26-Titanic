import { defineConfig } from 'vitest/config';

// The MIDI mapping layer (utils/midi/*) is PURE TypeScript with no React
// Native imports, so it runs in plain Node with no native-module stubs. Tests
// drive synthetic MIDI events + fake transports through the layer. Scope test
// discovery to these explicit globs so vitest never tries to load RN-only
// code: `components/**/*.test.ts` only matches PURE .ts logic tests (e.g.
// deck_tx_logic.test.ts) — RN components are .tsx and stay excluded.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['utils/midi/**/*.test.ts', 'components/**/*.test.ts'],
  },
});
