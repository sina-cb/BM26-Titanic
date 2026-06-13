import { defineConfig } from 'vitest/config';

// The MIDI mapping layer (utils/midi/*) is PURE TypeScript with no React
// Native imports, so it runs in plain Node with no native-module stubs. Tests
// drive synthetic MIDI events + fake transports through the layer. Scope test
// discovery to utils/midi so vitest never tries to load RN-only code.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['utils/midi/**/*.test.ts'],
  },
});
