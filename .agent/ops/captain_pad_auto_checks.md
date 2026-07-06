# CaptainPad Auto-Checks Spec

This spec defines the checks every agent must run before claiming CaptainPad is
merge-ready. CaptainPad is a TypeScript Expo app, so syntax-only checks are not
enough.

## Required Before Commit

Run from the repo root:

```powershell
git diff --check -- CaptainPad
```

Then run from `CaptainPad`:

```powershell
npx tsc --noEmit
npm run lint
```

If a route, Metro config, asset import, YAML import, or web-visible UI changed,
also run:

```powershell
npm run web:build
```

Merge rule: `npx tsc --noEmit` and `npm run lint` must exit 0. Existing warnings
may be left only when the human explicitly accepts them; new warnings from the
branch should be fixed.

## Package Script Target

CaptainPad should expose these scripts in `CaptainPad/package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm run lint"
  }
}
```

Once those scripts exist, the required command becomes:

```powershell
cd CaptainPad
npm run check
```

## Local Pre-Commit Hook

Agents may install a local hook only when the human asks for local automation.
Do not commit `.git/hooks/*`.

`.git/hooks/pre-commit`:

```sh
#!/bin/sh
cd CaptainPad || exit 1
npm run check || exit 1
```

On Windows, Git Bash can run the hook above. If PowerShell is preferred, create
the hook as a tiny shell wrapper that calls `powershell -NoProfile -File`.

## Current Fix Targets

These issues were observed on `dev/mixer_impl` on 2026-05-07 and must be fixed
before CaptainPad is merge-ready:

1. TypeScript cannot resolve `@/config.yaml`.
   - Add a tracked declaration file such as `CaptainPad/types/yaml.d.ts`.
   - Minimum declaration:
     ```ts
     declare module '*.yaml' {
       const value: any;
       export default value;
     }
     ```
   - Re-run `npx tsc --noEmit`.

2. `C.border` is referenced but is not defined in `Colors.light`.
   - Prefer replacing it with `C.ghostBorder` where it is only a border color.
   - If a distinct token is needed, add `border` to both light and dark themes.

3. `CPCControls` has implicit `any` callback parameters.
   - Type the fader callbacks as `(v: number) => ...`.
   - Better long-term fix: type `HorizontalFader` props so `onChange` carries
     `(value: number) => void`.

4. Mixer lint errors must be fixed.
   - Set `ChannelStrip.displayName = 'ChannelStrip'` after the memoized component.
   - Escape JSX quotes in visible text or split quoted words into nested text.
   - Remove unused imports and unused state.

5. Existing config-screen quote lint errors must be resolved or explicitly
   waived in code with a narrow lint disable and a reason.

## What Counts As Done

A CaptainPad fix is done only when the final response includes:

- `npx tsc --noEmit`: pass
- `npm run lint`: pass
- `npm run web:build`: pass when web/routes/import plumbing changed
- A note listing any accepted residual warnings
