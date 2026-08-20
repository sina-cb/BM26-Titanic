# _246 — CaptainPad derives its engine address from the host it was served from

**Date:** 2026-08-15
**Branch:** `feat/bm_readiness` (the `feat/bm_audio_tuning` in the brief was a
stale snapshot — same correction `_240` and `_242` recorded)
**Scope:** `CaptainPad/utils/apiBase.ts`, `CaptainPad/config.yaml` (the one
`api_base` key's contract comment), the CONFIG tab's engine-address card
(`app/(tabs)/config.tsx`), and a new `utils/api_base_resolution.test.ts`.
**Engine restart:** **NOT required** — this is client-side address resolution
only. Nothing engine-side changed.

---

## The bug, as the operator hit it

`CaptainPad/config.yaml` shipped `api_base: "http://127.0.0.1:6968"`, and that
value was the DEFAULT for every device. On the show machine that is right. On
**an iPad — the primary operator surface — it is the iPad asking ITSELF**: the
UI loads (it came from the LAN over HTTP), and then every single data call dies
against the tablet's own loopback. The only cure was to hand-type the show
machine's address into the CONFIG tab, per device, per reinstall.

The information needed to get this right was already in the operator's hands and
being thrown away: **a device that loaded CaptainPad from `10.x.x.NNN:6967`
reached the show machine at `10.x.x.NNN`.** `touch_control.tsx` had already
worked this out for the touch panel (its comment names the exact failure —
"asking ITSELF, and gets nothing"); the engine address itself never learned it.

---

## The fix — RESOLUTION, not a fallback

This is deliberately *not* a fallback chain, and the code says so in a header
block. Each step reads a **different, explicitly named source of truth**, in a
fixed documented order, and the module **logs which one won**. Nothing guesses an
address or silently repairs a broken one: an unusable source yields `null` and we
move to the next NAMED source, loudly.

| # | Source | Where it comes from | When it wins |
|---|---|---|---|
| 1 | `async-storage` | AsyncStorage `API_BASE`, written by the CONFIG tab | The operator set it explicitly. **Always wins** — unchanged from before. |
| 2 | `served-host` | web: `window.location.hostname`, `http` + port **6968** pinned | Any browser-served pad: `:6967` Metro, the `:7175` dist mirror, any future serve |
| 2 | `metro-host` | native: `Constants.expoConfig?.hostUri`, else `Constants.expoGoConfig?.debuggerHost` | Expo Go / dev client — the Metro host the bundle came from |
| 3 | `config-yaml` | `CaptainPad/config.yaml` → `api_base` | LAST RESORT: running ON the engine host (bench/dev), an `expo export` prerender pass, or a bare test env with no serving host at all |

**Why `hostUri` is the SDK-54-correct source:** verified against the installed
`expo-constants@18.0.13` — `Constants.d.ts` → `NativeConstants.expoConfig` is
typed `(ExpoConfig & { hostUri?: string }) | null` with the doc comment "Only
present during development using @expo/cli". `expoGoConfig.debuggerHost`
(`expo-manifests` `Manifests.d.ts:32`) is the SAME fact under the key Expo Go
populates — reading both is one datum, two keys, not a second behaviour. A
standalone production build has neither, which correctly yields `null` and drops
to the YAML. There is no `manifest`/`manifest2` legacy path here: both are
deprecated in SDK 54 and reading them would be the fallback we are refusing.

### Details that had to be right

- **Only the HOSTNAME is taken; the port is pinned to 6968.** The serving port
  is *not* the engine's (`:6967`, `:7175`, Metro's `:8081` — all different), so
  carrying it over would derive an address nothing answers on.
- **The scheme is pinned to `http`.** The engine's API server is plain HTTP;
  mirroring an `https` page scheme would produce a dead address.
- **IPv6 is bracketed.** `window.location.hostname` yields `::1`, never `[::1]`,
  and a bare literal makes an illegal URL authority. `hostnameFromMetroHostUri`
  goes the other way and unwraps `[fe80::1]:8081`.
- **`typeof window === 'undefined'` is a real case, not paranoia.** expo-router
  prerenders every route in Node during `expo export`; that pass legitimately has
  no serving host. The CLIENT bundle re-evaluates the module in the browser,
  where it does — which is why module-load resolution is safe here even though
  `touch_control.tsx` had to read its host in an effect (that one runs during
  *render*, which the server also executes).
- **The YAML contract is still validated at import and still THROWS** on a
  missing / empty / non-object `api_base`, *before* resolution runs. A broken
  config can never be masked by a lucky page host — there is a test for exactly
  that ordering.
- **One log line at load**, naming the winner: `console.info` for a derived
  address, `console.warn` for the YAML last resort. Debuggable without spam.

### The leaf rule, kept

`apiBase.ts`'s header rule is "import nothing from `utils/`" — the ring
`api → engineEvents → engineBus → api` is what that rule exists to prevent. The
three new imports (`expo-constants`, react-native's `Platform`, and the YAML) are
**platform leaves**: none of them imports anything from `utils/`, so no ring can
form through them. The header now says this explicitly. `utils/api.ts` was NOT
touched — the CONFIG tab imports the new `getApiBaseSource` straight from the
leaf, so no re-export churn landed in a file three other agents were editing.

**One shape change:** `require('@/config.yaml')` became a static
`import defaultConfigsRaw from '@/config.yaml'`. Reason: Node's `require` inside
a vitest module does not know the `@` alias and cannot be intercepted by
`vi.mock`, so the module was **untestable** as written. The static form is the
established repo idiom (`hooks/useMidiControl.ts` imports three MIDI profiles
that way), `types/yaml.d.ts` already declares `*.yaml` with a default export, and
the metro yaml-transformer emits exactly that. The defensive
`?.default || raw || {}` normalisation is kept verbatim, so the asset-URI
misconfig this file was hardened against still throws the same error. Proven by
a real `expo export --platform web -c` that built and prerendered clean.

### CONFIG tab copy

The card used to say only "Currently resolved: …" and offer **RESET TO YAML** —
both now lies, because the default is usually derived. It now reads:

> Currently resolved: http://10.x.x.NNN:6968 (derived from this page's host)
>
> With nothing saved here, CaptainPad points at the host it was loaded from, on
> port 6968 — so an iPad that opens CaptainPad from the show machine reaches that
> machine's engine with nothing typed in. CaptainPad/config.yaml's api_base is
> used only when there is no serving host to derive from (running on the engine
> box itself). Save an address to override this device; RESET returns to the
> derived default.

and the button is **RESET TO DEFAULT**. The parenthetical is driven by
`getApiBaseSource()` through a `Record<ApiBaseSource, string>` label map, so it
names the real winner (`saved on this device` / `derived from this page's host` /
`derived from the Metro host` / `CaptainPad/config.yaml`) rather than asserting
one.

`config.yaml`'s own comment block now states the precedence and that the key is
the LAST RESORT. **The value is unchanged** (`http://127.0.0.1:6968`) — it is
still exactly right for the case it now covers.

---

## Verification

**Unit — `utils/api_base_resolution.test.ts`, 29 tests, all new.** The suite
stubs `react-native`, `expo-constants`, AsyncStorage and the YAML per case and
re-imports the module behind `vi.resetModules()`, because resolution runs ONCE at
load — a reset per case is what makes each one a real cold start. Covered: the
two pure helpers (port pinning, IPv6 bracketing/unwrapping, scheme/path/port
stripping, `null` for every unusable input); web derivation beats the YAML
loopback; the serving port never leaks in; native derivation from `hostUri` and
from `debuggerHost`; web ignores expo-constants and native ignores the phantom
`window` RN defines; no-DOM / empty-hostname / standalone-build all reach the
YAML; the YAML last resort warns (not infos) and does NOT throw at import; the
AsyncStorage override beats both a derived host and the YAML; `setApiBase` to the
derived default clears the stored key and restores the derived source label; and
four fail-fast cases including "throws EVEN when a serving host could have been
derived".

**Suite:** `vitest run` → **85 files / 1706 passed / 0 failed** (6 pre-existing
skips). Failing list **EMPTY**. `tsc --noEmit` clean. `expo lint` → **0 errors**,
14 warnings, all pre-existing and none on a file this report touched.

**Live, over the LAN.** A fresh `expo export --platform web -c` was served from
`~/tmp/fix_246/dist` on **:7176** (a private static server — `npx serve` kept
ignoring the port flag and picking a random one) and loaded by headless Chrome at
the machine's **LAN address `10.x.x.NNN`**, with `console.info`/`warn` teed into
an array instead of muted (the console-mute technique is required for the capture
path, but those lines were the evidence). Result:

```
[apiBase] engine address derived from the served-host (platform=web): http://10.x.x.NNN:6968
engineRequestsTotal:      28
engineRequestsToLan:      28
engineRequestsToLoopback:  0
firstEngineRequest:       http://10.x.x.NNN:6968/status
```

Every engine call — starting with the very first, `/status` — went to the LAN
host. **Zero** went to loopback. Before this change that same page would have
issued all 28 against `127.0.0.1`.

**Screenshots, `~/tmp/fix_246/`:**
- `lan_home_live_data.png` — the Deck loaded over the LAN with **live** engine
  data: `● CONNECTED`, `MODEL titanic`, live audio-signal meters, the running
  playlist with `120_crossing_beacons` active, autopilot state, the live pixel
  strip. End-to-end proof, nothing typed into CONFIG.
- `lan_config_engine_address_card.png` — the new ENGINE API BASE URL card
  showing `http://10.x.x.NNN:6968 (derived from this page's host)` and
  **RESET TO DEFAULT**.
- `lan_config_resolution_copy.png`, `lan_verify.json` — the unscrolled CONFIG
  view and the raw request/log evidence.

**Operator stack untouched.** Ports 6966-6972, the `:7175` mirror and the
`:6981` Expo Metro were confirmed still listening before and after; nothing was
bound or killed there. `:7176` was released when the capture finished. The only
traffic sent to the live engine was the app's own normal boot GETs, which is the
proof itself. `CaptainPad/dist/` was NOT rebuilt — the export went to `~/tmp`.

**Known residue (not mine to clean):** `expo export --output-dir "$HOME/…"`
under Git Bash writes to a stray `C:\c\Users\…` tree, because Node reads the
POSIX-style `$HOME` as a drive-relative absolute path. `_246`'s copy was moved
out and deleted; **`C:\c\Users\Titanic's End\tmp\fix_243\dist` is still there**
from the concurrent `_243` run, and `C:\c` itself is refused by the harness as a
protected path. Pass an explicit `C:/…` output dir to avoid it.

---

## What this changes for the operator

An iPad that opens CaptainPad from the show machine now finds the engine **with
nothing typed in**, on first launch, after a reinstall, on a new pad. The CONFIG
tab override still exists and still wins for the cases that need it (a second
engine, a bench box, a deliberate cross-machine point).

**Picked up automatically:** the `:7175` dist mirror on its next rebuild and the
`:6981` Expo Go instance on its next reload. No engine restart, no state
migration, no AsyncStorage clear — a pad that already has an override keeps it,
because source 1 still wins.
