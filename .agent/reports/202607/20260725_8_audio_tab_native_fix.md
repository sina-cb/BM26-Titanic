# 2026-07-25_8 — AUDIO tab "AUDIO CONFIG UNAVAILABLE" on the iPad: investigation

**Role:** investigator → developer (debug+fix brief).
**Trigger:** operator, live on the iPad (Expo Go, native iOS), engine reached
through the Config-tab `api_base` override: *"in the audio tab, it says audio
config not available and shows an error only … deck and mixer views are fine,
the audio tab is fucked."*
**Outcome:** **no code change was made.** The operator re-tested mid-investigation
and reported the AUDIO tab **working**, which is exactly what the diagnosis below
predicts. A real latent defect was identified and is written up as a follow-up.

---

## 1. Prime suspect — EXONERATED

The brief's prime suspect was the uncommitted TEST-SIGNAL device-card change in
`CaptainPad/app/(tabs)/audio.tsx` (report `20260725_7_captainpad_mic_flows.md`;
`describeCaptureSource` / `captureSourceText` / the `isCurrent` guard), verified
on web only.

It cannot produce the observed screen. The operator's string is
`AUDIO CONFIG UNAVAILABLE` — `app/(tabs)/audio.tsx:1172` — which renders **only**
when `fetchAudioConfig()` returns `ok:false` (`:1160-1162`), i.e. before any of
the changed render code is reached. The diff is pure presentation inside
`AudioConfigBody`, which is mounted only once `cfg` is non-null.

Additional evidence:

- `npx tsc --noEmit` on `CaptainPad/` — **clean**.
- The diff introduces no web-only API: no `window`/`document`/DOM, no web-only
  library, no invalid-on-native style prop. Imports are `react-native` `Text` /
  `View` only.

## 2. Server side — HEALTHY

Read-only probes of the show engine the iPad talks to:

```
GET http://10.x.x.151:6968/audio/config   → 200  in 0.042 s
GET http://10.x.x.151:6968/audio/devices  → 200  in 5.41 s   (ffmpeg enumeration)
```

Body is a well-formed merged config (`capture.device = "audio=Microphone (Amazon
USB Streaming Mic)"`, `enabled:true`). The endpoint the tab needs answers, fast.

## 3. Web repro against the REMOTE engine — CLEAN (bug did NOT reproduce)

Fresh `npm run web:build` → `npx serve dist -p 7167 -s` (**never** :6967 — the
operator's Metro), puppeteer with console muted before boot (memory
`captainpad-screenshot-technique`), `localStorage.API_BASE` seeded to
`http://10.x.x.151:6968` — the operator's exact override.

```
API_BASE seen by app: http://10.x.x.151:6968
audio requests:       200 http://10.x.x.151:6968/audio/config
body text:            AUDIO · OSC LIVE · BPM SYNC ON · LIVE · 60 FPS
                      AUDIO SIGNALS … GENRE MELODIC HOUSE … INPUT GAIN 6.60×
                      BPM → SPEED SYNC 128 BPM → 0.72 … SETTINGS
```

Screenshot: `~/tmp/audio_probe/audio_tab.png`. The tab renders fully, including
the changed capture-source card. Only console noise is React minified #418
(hydration/dev warning), pre-existing and unrelated.

So: server fine, client code fine, override fine — the failure is **stateful**,
not structural.

## 4. Root cause (diagnosis, matches the symptom and the self-recovery)

`app/(tabs)/audio.tsx:1150-1194` — the AUDIO screen loads its config **once**:

```tsx
useEffect(() => { reload(); }, [reload]);   // :1165  — reload is useCallback([], stable)
if (loadError) { …AUDIO CONFIG UNAVAILABLE… }  // :1167-1181
```

`reload` is stable, so this fires exactly once per mount, and an expo-router tab
screen keeps its mount for the whole app session. **The first failure latches
forever**; the only escape is the RETRY button (`:1175`) or an app reload.

`CaptainPad/config.yaml:5` — `api_base: "http://127.0.0.1:6968"`. On the iPad
`127.0.0.1` is the iPad itself, so before the Config-tab override is applied any
engine fetch fails with `Network request failed`. Sequence that produces exactly
the operator's report:

1. App boots with the default (or a stale) base, or the engine is mid-restart
   from the `_7` companion deploy.
2. AUDIO tab is focused once → single `GET /audio/config` fails → `loadError`
   latched.
3. Operator sets / fixes the `api_base` override in the Config tab.
4. **Deck and mixer recover** — they re-fetch on focus / poll
   (`app/(tabs)/mixer.tsx`, `index.tsx`, `timeline.tsx` all use `useFocusEffect`)
   and reconnect over WS.
5. **AUDIO does not** — its `useFocusEffect` (`:633`) only drives the meter
   `active` flag; nothing re-runs `reload()`. The tab shows the stale error
   indefinitely: *"deck and mixer are fine, the audio tab is fucked."*

The operator's subsequent report that the tab now works (after a reload /
RETRY / Metro hot-reload remount) is consistent with this and inconsistent with
any structural native-only defect: a broken bundle or a bad render would not
heal by itself.

## 5. Not fixed here — recommended follow-up (small, CaptainPad-only)

The latch is a genuine defect and will bite again on the playa (engine restart
while the AUDIO tab is open ⇒ permanently dead tab until the operator finds
RETRY). Proposed minimal change, deliberately **not** applied because the
operator was live-testing on the iPad and Metro would have hot-reloaded an
unverified edit under his hands:

```tsx
// app/(tabs)/audio.tsx, next to :1165
useFocusEffect(useCallback(() => { if (!cfg) reload(); }, [cfg, reload]));
```

plus an in-flight ref inside `reload` so the mount effect and the first focus
don't double-fire. This is a retry, not a fallback — a failed retry re-renders
the same loud error; nothing is swallowed. `useFocusEffect` is already imported
(`:42`).

## 6. Honesty notes

- **No code was changed.** No commit, no deploy, no server-side edit.
- **Native (Expo Go iOS) was never executed by me.** All UI evidence is from the
  web build. The native path is covered by inspection + `tsc` only.
- The root cause in §4 is a **diagnosis** built from the code path, the default
  `api_base`, the server probes, and the clean web repro. It was **not**
  reproduced end-to-end: the flip-proxy experiment that would have proven the
  latch (fail → succeed while the tab stays mounted) was cancelled when the
  operator reported the tab working.
- Test server on :7167 was killed; :6967 (operator's Metro) was never touched.
  `npm test` was not run — no source file was modified.
