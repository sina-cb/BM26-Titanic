---
name: captainpad-dev-server-traps
description: Two ways the CaptainPad Expo dev server wastes a session — aborting an in-flight request to it crashes the process and the launcher then tears down the WHOLE stack, and Metro serves stale bundles so UI edits stay invisible until a full launcher restart.
type: lesson
created: 2026-08-05
updated: 2026-08-05
---

**Trap 1 — aborting a request to the dev server kills the entire stack.**
An in-flight HTTP request to the CaptainPad web port that the client abandons
makes the Expo server throw `Error: Cannot pipe to a closed or destroyed
stream` (`expo-server/src/vendor/http.ts` `respond`). The process exits, and
because `launcher.js` supervises all children, it stops the sim, the engine and
the audio companion with it:

```
❌ captainpad exited unexpectedly (code=4294967295). Tearing down.
[launcher] sim stopped … engine stopped … audio stopped
```

This happened **three times in one session** — twice from `curl --max-time 3`
poll loops waiting for readiness, once from a puppeteer `Page.navigate` hitting
its default 180 s `protocolTimeout` while the route was still bundling.

**Trap 2 — Metro serves a stale bundle; edits do not appear.** Three separate
CaptainPad source changes were invisible in the running app until a full
`node launcher.js stop && node launcher.js dev`. The file watcher simply did
not pick them up. (Possibly related: `CaptainPad/scripts/start.mjs` deletes
`dist/` on startup with the comment that a stale `dist` crashes the Metro file
watcher on Windows — a `dist/` created and removed mid-session may break the
watcher for the rest of that session.)

**Checking the SSR html does NOT detect trap 2.** The server-rendered page
contains only the initial screen, so anything behind a closed sheet or a
generator button is absent whether the bundle is fresh or stale — a fresh
bundle and a stale one look identical that way.

**How to apply:**
- **Never poll the CaptainPad web port with a short timeout.** Wait on the
  launcher LOG instead (`until grep -q "Stack is up" "$LOG"; do sleep 4; done`)
  — reading a file cannot abort an HTTP request.
- Before driving the app with puppeteer, warm the route with ONE untimed
  `fetch`, and pass a large `protocolTimeout` (600000) to `puppeteer.launch`.
- After ANY CaptainPad source edit, assume the running app is stale. Verify
  against the **JS bundle**, not the page:
  `/node_modules/expo-router/entry.bundle?platform=web&dev=true&hot=false&lazy=true&transform.routerRoot=app`
  then grep it for a string you just added. If missing, restart via the
  launcher (never by killing the child — that is trap 1).
- Restart with `node launcher.js stop` then `node launcher.js dev`. Killing the
  expo PID directly triggers the teardown path.

Related: [[operator-uses-launcher]] (the launcher is the only sanctioned way to
start and stop the stack).
