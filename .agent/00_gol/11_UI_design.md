# UI Design Reference — `design.md` Format

**Reference repo**: https://github.com/google-labs-code/design.md
**Maintainer**: Google Stitch / Labs (`stitch.withgoogle.com/docs/design-md/specification`).
**License of upstream repo**: Apache-2.0 (informational only — see below).

## Hard rule: read-only, do NOT fork or clone

We do **not** fork, clone, vendor, or copy code from this repo into BM26-Titanic.
We do **not** add it as a submodule, npm dependency, or git remote. We do **not**
install the `@google/design.md` CLI as part of our build, CI, or release pipeline.

Treat it the same way you'd treat the WCAG spec: a public specification you read,
internalize, and reference. We can re-read it whenever the design system here
needs to evolve. The agent reading these notes should be enough — go back to the
original repo only when the spec materially changes or we need a detail that is
not captured here.

If we ever decide to adopt their tooling, that is a separate, explicit decision
that requires legal / OSS review and an entry in our dependency manifest. Until
then, this file is the single touchpoint.

## What `design.md` actually is

It is a file-format spec for declaring a visual identity in a way a coding agent
can read and apply consistently across a codebase. A `DESIGN.md` file has two
layers:

1. **YAML front matter** between `---` fences — the normative, machine-readable
   design tokens (colors, typography, spacing, etc.).
2. **Markdown body** — human-readable rationale that tells the agent *why* a
   token exists and how to apply it.

Tokens win when there's a conflict; prose is for context.

### Canonical section order

When we author our own `DESIGN.md` for BM26-Titanic / CaptainPad, the sections
must appear in this order (any of them can be omitted):

| # | Section           | Aliases          |
|---|-------------------|------------------|
| 1 | Overview          | Brand & Style    |
| 2 | Colors            |                  |
| 3 | Typography        |                  |
| 4 | Layout            | Layout & Spacing |
| 5 | Elevation & Depth | Elevation        |
| 6 | Shapes            |                  |
| 7 | Components        |                  |
| 8 | Do's and Don'ts   |                  |

### Token schema (cheat sheet)

```
version: alpha             # optional
name: <string>             # required
description: <string>      # optional
colors:
  <token-name>: <Color>    # e.g. "#1A1C1E"
typography:
  <token-name>:
    fontFamily: <string>
    fontSize: <Dimension>
    fontWeight: <number>      # optional
    lineHeight: <Dimension>   # optional
    letterSpacing: <Dimension># optional
rounded:
  sm: 4px
  md: 8px
spacing:
  sm: 8px
  md: 16px
components:
  <name>:
    backgroundColor: "{colors.tertiary}"   # token reference
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.sm}"
    padding: 12px
```

Variants (hover, active, pressed) are separate component entries with a related
key name (e.g. `button-primary` + `button-primary-hover`).

Valid component properties: `backgroundColor`, `textColor`, `typography`,
`rounded`, `padding`, `size`, `height`, `width`.

## How we will use it in this repo

### Where it lives

When we write our own design system, the canonical file will be
`CaptainPad/DESIGN.md` (or `docs/DESIGN.md` if it ends up shared with the engine
status UI). One file, one source of truth.

### What it codifies for us

CaptainPad already has an effective design language scattered across
`CaptainPad/constants/theme.ts` (Colors), `CaptainPad/styles/globalStyles.ts`,
the `Space Grotesk` / `Inter` typography stack, and the existing Stitch
references in `CaptainPad/StitchDesigns/`. Authoring a `DESIGN.md`:

- Captures those values as **tokens** so the agent applies them consistently
  when adding new UI (currently it cargo-cults from neighboring files).
- Lets us run `npx @google/design.md lint` *on demand* (not in CI) to sanity
  check WCAG contrast on new component pairs.
- Makes design changes a token edit instead of a hunt across `.tsx` files.

### Rules we lift from the spec

These are the conventions we'll follow in our UI code regardless of whether the
`DESIGN.md` exists yet:

1. **Tokens, not literals.** Don't sprinkle hex codes / pixel values across
   components. Reference `Colors.light.primary`, `globalStyles.surfaceContainerHigh`,
   etc. If a new value is needed, add it to the central theme first.
2. **Contrast > flourish.** Foreground/background pairs target WCAG AA (≥ 4.5:1
   for body, ≥ 3:1 for large text). When in doubt, lean to higher contrast.
3. **Variants are derived.** A `*-hover` / `*-active` style should derive from
   its base (saturation/elevation delta), not be a bespoke color.
4. **Compact wins.** When a feature can be expressed with one list / one
   control instead of two parallel UIs, collapse them. This is doubly true on
   the deck and mixer where screen real estate is precious.

### Linting / export — only when useful

The upstream CLI can:
- `lint` a `DESIGN.md` for broken refs, contrast issues, ordering bugs.
- `diff` two versions to spot regressions.
- `export` to Tailwind v3/v4, DTCG (W3C Design Tokens).

We only run these ad hoc (`npx @google/design.md ...`) from a developer machine
when authoring or auditing the design file. Nothing in our build depends on it.

## When to come back here

- We add a substantial new surface (new tab, new component family) and need a
  reusable token catalog.
- A designer hands us a new visual identity and we want a machine-readable
  handover artifact.
- We notice color/spacing drift across `CaptainPad/**` and want a structured
  audit.

In any of those cases, re-read the upstream README + `docs/spec.md`, then
update `CaptainPad/DESIGN.md` (or create it) in line with the spec.
