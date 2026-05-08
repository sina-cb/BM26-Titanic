# CaptainPad iPad Build Runbook

This is the canonical guide for future agents building the CaptainPad iPad app
with EAS. Keep it practical, current, and free of secrets.

Do not add Apple IDs, passwords, App Store Connect session paths, certificate
serial numbers, provisioning profile IDs, device UDIDs, auth tokens, or signed
log URLs to this file. If a build log contains those values, summarize the
technical failure instead of pasting the secret-bearing line.

Use repo-relative paths only. Do not write machine-specific absolute paths such
as a Windows user profile path into this document.

## Project Location

Repository root:

The directory that contains `.agent/` and `CaptainPad/`.

Expo app root:

```text
CaptainPad/
```

Run all Expo, npm, and EAS commands from `CaptainPad` unless this doc says
otherwise.

## Current App Specs

- App name: `CaptainPad`
- Main entry: `expo-router/entry`
- Expo SDK: `~54.0.34`
- React Native: `0.81.5`
- React: `19.1.0`
- EAS CLI requirement: `>= 18.7.0`
- iOS bundle identifier: `com.titanicrig.captainpad`
- iPad support: enabled through `ios.supportsTablet: true`
- Native architecture: `newArchEnabled: true`
- iOS preview build profile: internal distribution, Release configuration
- Managed Expo app: generated `ios/` and `android/` folders are ignored
- App uses local network access for MarsinEngine communication
- Bonjour service declared in iOS plist: `_marsinengine._tcp`
- YAML imports are supported by `yaml-transformer.js` and Metro `sourceExts`

The `preview` profile is the normal iPad install build profile. It uses remote
iOS credentials stored on EAS. Do not document the Apple account, certificates,
provisioning profile identifiers, or device UDIDs here.

## How EAS Gets The Code

EAS Build uploads an archive from the local `CaptainPad` folder when this command
runs:

```powershell
eas build --platform ios --profile preview --clear-cache
```

It does not pull the app source from a remote branch for this workflow. Local
files are archived, except files ignored by `.easignore` if present, otherwise by
the ignore rules EAS derives from the project. `node_modules`, `.expo`, `dist`,
`ios`, and `android` should not be uploaded; EAS installs dependencies and
generates native files on the builder.

Agents must not use git commands for this build flow unless the human explicitly
asks. Build, inspect logs, and edit files directly.

## Normal Build Command

Interactive build:

```powershell
cd CaptainPad
eas build --platform ios --profile preview --clear-cache
```

Non-interactive build, useful when credentials already exist on EAS:

```powershell
cd CaptainPad
eas build --platform ios --profile preview --clear-cache --non-interactive
```

Interactive mode may ask whether to log in to Apple. That is acceptable only
when the human is present or has explicitly allowed it. Never store Apple
credentials in repo files or agent docs.

## Required Local Checks Before Remote Build

Install dependencies:

```powershell
cd CaptainPad
npm ci
```

Run lint:

```powershell
npm run lint
```

Run the same iOS JavaScript bundle phase that failed on EAS:

```powershell
npx expo export:embed --eager --platform ios --dev false --reset-cache
```

If Metro config, asset imports, route files, YAML imports, or dependency
resolution changed, this local bundle command must pass before starting another
remote EAS build.

## Reading EAS Logs

The terminal prints a build URL like:

```text
See logs: https://expo.dev/accounts/.../projects/.../builds/<build-id>
```

Open that URL in a browser and look for the failed phase. For the failures seen
on 2026-05-08, the real error was under:

```text
EAGER_BUNDLE
Bundle JavaScript
```

The top-level EAS message can be vague:

```text
iOS build failed:
Unknown error. See logs of the Bundle JavaScript build phase for more information.
```

That message is not enough. Always inspect the `Bundle JavaScript` or
`EAGER_BUNDLE` phase before making a fix.

Useful CLI commands:

```powershell
eas build:list --platform ios --limit 5
eas build:view <build-id>
eas build:view <build-id> --json
```

PowerShell helper to extract relevant log lines without storing full signed log
URLs in docs:

```powershell
$buildId = "<build-id>"
$raw = eas build:view $buildId --json 2>$null | Out-String
$start = $raw.IndexOf("{")
$end = $raw.LastIndexOf("}")
$json = $raw.Substring($start, $end - $start + 1) | ConvertFrom-Json

for ($i = 0; $i -lt $json.logFiles.Count; $i++) {
  $text = (Invoke-WebRequest -Uri $json.logFiles[$i] -UseBasicParsing).Content
  if ($text -match "EAGER_BUNDLE|Bundle JavaScript|Bundling failed|Unable to resolve|Error:") {
    "----- log file $i -----"
    $text -split "`n" |
      Select-String -Pattern "EAGER_BUNDLE|Bundle JavaScript|Bundling failed|Unable to resolve|Error:" -Context 3,8
  }
}
```

Do not paste the full JSON output into repo docs. It can include signed URLs and
credential metadata.

## Known Critical Metro Rule

`CaptainPad/metro.config.js` must not block every `dist` folder globally.
Dependency packages commonly publish their runtime files under `node_modules/*/dist`.

Good pattern:

```js
function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function projectPathPattern(...segments) {
  const absolutePath = path.resolve(__dirname, ...segments);
  const pattern = absolutePath.split(path.sep).map(escapeRegExp).join('[\\\\/]');
  return new RegExp(`^${pattern}(?:[\\\\/].*)?$`);
}

config.resolver.blockList = [
  projectPathPattern('dist'),
  projectPathPattern('.expo'),
  projectPathPattern('node_modules', '.cache'),
];
```

Bad pattern:

```js
config.resolver.blockList = [
  /dist\/.*/,
  /\.expo\/.*/,
  /node_modules\/\.cache\/.*/,
];
```

The bad pattern hides package files such as:

- `node_modules/whatwg-fetch/dist/fetch.umd.js`
- `node_modules/abort-controller/dist/abort-controller.js`
- `node_modules/memoize-one/dist/memoize-one.cjs.js`
- `node_modules/react-native-is-edge-to-edge/dist/index.js`

Metro then reports those files as missing even though npm installed them. If the
log says a package `package.json` was found but its `main` under `dist` does not
exist, check `metro.config.js` before adding shims or dependencies.

Quick verification:

```powershell
node -e "const config=require('./metro.config'); const rules=Array.isArray(config.resolver.blockList)?config.resolver.blockList:[config.resolver.blockList]; const paths=[require('path').resolve('dist/index.js'), require('path').resolve('node_modules/whatwg-fetch/dist/fetch.umd.js'), require('path').resolve('node_modules/react-native-is-edge-to-edge/dist/index.js')]; for (const p of paths) console.log(p, rules.some((r)=>r.test(p)));"
```

Expected result:

- `CaptainPad\dist\...` prints `true`
- `CaptainPad\node_modules\...\dist\...` prints `false`

## Known Failure Signatures

### Package main file appears missing under `dist`

Example:

```text
The package .../node_modules/react-native-is-edge-to-edge/package.json was successfully found.
However, this package itself specifies a main module field that could not be resolved:
.../node_modules/react-native-is-edge-to-edge/dist/index
```

Likely cause: Metro `blockList` is hiding dependency `dist` files.

Fix: keep the block list anchored to project-local generated folders with
`projectPathPattern(...)`.

Do not add empty shims for these packages. An empty `whatwg-fetch` shim caused a
runtime crash:

```text
TypeError: Cannot set property 'Headers' of undefined
Invariant Violation: "main" has not been registered
```

That crash means an early module failed before React Native registered the app.
Find the first runtime error, not the later `main has not been registered`
message.

### Top-level EAS says only `Unknown error`

Likely cause: the meaningful error is inside a build phase log.

Fix: inspect `EAGER_BUNDLE`, `Bundle JavaScript`, `INSTALL_DEPENDENCIES`,
`PREBUILD`, or `RUN_FASTLANE`, depending on where EAS marks the failure.

### Credentials or provisioning prompt fails

Likely cause: Apple session expired, missing device in provisioning profile, or
remote credentials need validation.

Fix: rerun interactively with the human present:

```powershell
eas build --platform ios --profile preview --clear-cache
```

Do not write Apple credentials, team IDs, cert serials, profile IDs, or device
UDIDs into docs.

## Build Discipline

Do not run blind repeated remote builds. For every failed build:

1. Capture the build ID from the terminal.
2. Inspect the failed phase logs.
3. Identify the first concrete error, not the final wrapper error.
4. Reproduce locally when possible with `npx expo export:embed`.
5. Make the smallest config or code fix.
6. Run local checks.
7. Start one new remote EAS build.

## Current Known-Good State

As of 2026-05-08, the iOS preview build passed after fixing the Metro block list
to stop hiding dependency `dist` folders.

The successful path was:

```powershell
cd CaptainPad
npx expo export:embed --eager --platform ios --dev false --reset-cache
eas build --platform ios --profile preview --clear-cache --non-interactive
```
