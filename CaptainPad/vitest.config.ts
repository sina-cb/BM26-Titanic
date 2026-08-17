import { defineConfig } from 'vitest/config';
import path from 'node:path';

// The MIDI mapping layer (utils/midi/*) is PURE TypeScript with no React
// Native imports, so it runs in plain Node with no native-module stubs. Tests
// drive synthetic MIDI events + fake transports through the layer. Scope test
// discovery to these explicit globs so vitest never tries to load RN-only
// code: `components/**/*.test.ts` only matches PURE .ts logic tests (e.g.
// deck_tx_logic.test.ts) — RN components are .tsx and stay excluded.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
  test: {
    environment: 'node',
    // `utils/*.test.ts` (non-recursive) admits PURE api-contract tests that stub
    // the RN/engine/apiBase deps themselves — it must NOT be `utils/**` or it
    // would re-glob the midi tests. Keep RN-only .tsx component tests excluded.
    include: ['utils/*.test.ts', 'utils/midi/**/*.test.ts', 'components/**/*.test.ts', 'hooks/**/*.test.ts'],
  },
});
