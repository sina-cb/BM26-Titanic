import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const appConfig = JSON.parse(readFileSync(join(HERE, '..', 'app.json'), 'utf8'));

describe('CaptainPad native orientation contract', () => {
  it('locks the iPad app to full-screen landscape', () => {
    expect(appConfig.expo.orientation).toBe('landscape');
    expect(appConfig.expo.ios.supportsTablet).toBe(true);
    expect(appConfig.expo.ios.requireFullScreen).toBe(true);
  });
});
