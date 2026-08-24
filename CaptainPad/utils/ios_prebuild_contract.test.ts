import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8')) as Record<string, unknown>;
}

function readText(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

const appConfig = readJson('app.json') as {
  expo: {
    name: string;
    slug: string;
    orientation: string;
    newArchEnabled: boolean;
    scheme: string;
    ios: {
      supportsTablet: boolean;
      requireFullScreen: boolean;
      bundleIdentifier: string;
      infoPlist: Record<string, unknown>;
    };
    plugins: unknown[];
  };
};

const easConfig = readJson('eas.json') as {
  build: {
    preview: {
      distribution: string;
      ios: {
        buildConfiguration: string;
      };
    };
  };
};

describe('CaptainPad iOS prebuild contract (declarative, non-mutating)', () => {
  it('keeps ios/ and android/ generated-only (gitignored, not EAS-uploaded)', () => {
    expect(readText('.gitignore')).toMatch(/^\/ios$/m);
    expect(readText('.gitignore')).toMatch(/^\/android$/m);
    expect(readText('.easignore')).toMatch(/^\/ios$/m);
    expect(readText('.easignore')).toMatch(/^\/android$/m);
  });

  it('keeps direct iPad MIDI in a local Expo module, never in generated CaptainPad/ios', () => {
    const moduleConfig = readJson('modules/captain-midi/expo-module.config.json') as {
      platforms: string[];
      apple: { modules: string[] };
    };
    const modulePackage = readJson('modules/captain-midi/package.json') as {
      name: string;
      main: string;
      private: boolean;
    };
    const podspec = readText('modules/captain-midi/ios/CaptainMidi.podspec');
    const swift = readText('modules/captain-midi/ios/CaptainMidiModule.swift');

    // `modules/` is Expo's local-module source boundary. The generated
    // top-level `ios/` remains disposable (the preceding test pins both ignore
    // files), while prebuild discovers this declaration and emits the provider.
    expect(modulePackage).toMatchObject({
      name: 'captain-midi',
      main: 'src/index.ts',
      private: true,
    });
    expect(moduleConfig.platforms).toEqual(['apple']);
    expect(moduleConfig.apple.modules).toEqual(['CaptainMidiModule']);
    expect(podspec).toContain("s.dependency 'ExpoModulesCore'");
    expect(podspec).toContain("s.frameworks = 'CoreMIDI'");
    expect(swift).toMatch(/public class CaptainMidiModule:\s*Module/);
    expect(swift).toMatch(/Name\("CaptainMidi"\)/);
  });

  it('declares every native iOS setting in app.json (no hand-edited Info.plist required)', () => {
    const { expo } = appConfig;
    expect(expo.name).toBe('CaptainPad');
    expect(expo.slug).toBe('CaptainPad');
    expect(expo.orientation).toBe('landscape');
    expect(expo.newArchEnabled).toBe(true);
    expect(expo.scheme).toBe('captainpad');

    const ios = expo.ios;
    expect(ios.supportsTablet).toBe(true);
    expect(ios.requireFullScreen).toBe(true);
    expect(ios.bundleIdentifier).toBe('com.titanicrig.captainpad');

    const plist = ios.infoPlist;
    expect(plist.ITSAppUsesNonExemptEncryption).toBe(false);
    expect(plist.NSLocalNetworkUsageDescription).toMatch(/MarsinEngine/);
    expect(plist.NSBonjourServices).toEqual(['_marsinengine._tcp']);
    expect((plist.NSAppTransportSecurity as { NSAllowsLocalNetworking: boolean }).NSAllowsLocalNetworking).toBe(true);
  });

  it('uses only tracked Expo config plugins (no custom native deltas in ios/)', () => {
    expect(appConfig.expo.plugins).toEqual([
      'expo-router',
      [
        'expo-splash-screen',
        {
          image: './assets/images/icon.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#f8f9fa',
          dark: { backgroundColor: '#151718' },
        },
      ],
      'expo-web-browser',
    ]);
  });

  it('targets internal Release builds on EAS preview (same bundle shape as local Release)', () => {
    expect(easConfig.build.preview.distribution).toBe('internal');
    expect(easConfig.build.preview.ios.buildConfiguration).toBe('Release');
  });

  it('keeps Metro YAML + blockList rules that EAS and local Xcode both depend on', () => {
    const metro = readText('metro.config.js');
    expect(metro).toContain('yaml-transformer.js');
    expect(metro).toContain('projectPathPattern(');
    expect(metro).not.toMatch(/blockList\s*=\s*\[[^\]]*\/dist\\\/\*\*/);

    const pkg = readJson('package.json') as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies['js-yaml']).toBeTruthy();
    expect(readText('yaml-transformer.js')).toContain('js-yaml');
  });

  it('documents signing as a build-time override, not a committed ios/ delta', () => {
    // Fresh expo prebuild must not bake team IDs into tracked config. Operators
    // pass DEVELOPMENT_TEAM on the xcodebuild command line (see README + runbook).
    expect(readText('README.md')).toMatch(/DEVELOPMENT_TEAM=<TEAM_ID>/);
    expect(readText('README.md')).not.toMatch(/DEVELOPMENT_TEAM=(?!<TEAM_ID>)[A-Z0-9]+/);
  });
});
