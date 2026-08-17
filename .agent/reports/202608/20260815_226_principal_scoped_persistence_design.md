# _226 — Principal-scoped persistence: design (Fable)

**Role:** designer (docs only — zero product-code edits). **Deliverable:**
`docs/56_principal_scoped_persistence.md` (semantics + implementation
contract + test/screenshot plan). Implementation and validation belong to the
Opus wave that picks up the contract (operator: "use fable to optimize design
and plan this and opus to implement and validate").

## Operator order

Parameters must not be stored unless edit mode was unlocked with Sina's
passcode; CaptainPad lands in Performance mode on initial launch; going to
edit mode asks for a passcode; Misha/sailor codes get a live edit session
whose pattern-param and playlist changes are never persisted.

## What recon found (the design builds on shipped machinery)

- Performance mode already freezes ALL auto-persistence via
  `effectiveAutoSave()` (`marsin_engine/lib/api_server.js:1363-1365`), keeps a
  pre-show snapshot for restore, defers deck captures into `pendingDeckFlush`,
  and keeps live continuity in the in-memory `sessionParamCache`.
- The passcode ring (`captainpad_auth.js` — principals
  `owner`/`collaborator`/`bringup` from `$BM26_SECRETS`; `verifyPassphrase`
  issues no session; shared lockout) already services the takeover gate
  per-attempt (`api_server.js:4025-4085`).
- `engine.js` `shutdown()` (:2879-2955) writes **zero state** — no
  shutdown-save hole to plug.
- The perf-exit gate today accepts a privileged **session**
  (`api_server.js:12884-12890`) — the one auth surface the order obsoletes.

## Ruling decisions (details + anchors in docs/56)

1. **Boot mode (D1):** engine-side, not pad-side — an engine with privileged
   auth enabled (`BM26_CAPTAINPAD_AUTH_REQUIRED=1`) boots INTO performance
   mode, capturing the pre-show snapshot from boot state; capture failure is
   fatal. Auth-off benches boot unlocked, byte-identical. No new config key.
   Pads need no boot change: `usePerfLock` is locked until seeded, then the
   engine says `active:true` and the _217 overlay renders.
2. **Edit entry (D2):** perf exit now requires `X-CaptainPad-Passcode`
   verified per-attempt (`verifyPassphrase`) — session tokens no longer end
   performance mode. Entering perf stays ungated.
3. **Principal handshake (D3):** ONE engine-global in-memory
   `editSession.principal` set by the verified exit (null during perf/boot);
   new `POST /edit-session` re-asserts (escalation AND handover); broadcast as
   `editPrincipal` on the `performanceMode` frames + GET. No timeout — perf
   enter is the reset. Dies on restart.
4. **Multi-pad precedence (D4):** persistence follows the global session
   principal, never the pad that made the change (per-change attribution is
   either passcode-per-slider or spoofable tokens). Escalating to owner
   blesses the CURRENT live look — stated in the sheet copy.
5. **Gated surfaces (D5/D6):** engine-side only. `effectiveAutoSave()` gains a
   `principalMaySave()` term (auto-save family: deck/mixer/globals state +
   capture-on-switch). Sailor sessions additionally SKIP the
   `recordPendingDeckFlush` backlog (so a later owner keep-save can't flush
   sailor tuning). Explicit file-writing routes get 403
   `EDIT_PRINCIPAL_READONLY`: playlist create/delete, modulation +
   MIDI-mapping mutations, explicit deck/mixer captures, `POST /settings`,
   `POST /settings/save-now`. Live param writes and structural edit-mode
   routes stay OPEN (edit works live; their persistence is the gated family).
   Named-artifact authoring (snapshots/presets/GEM/timeline) deliberately
   ungated — flagged as a one-line follow-up if ruled otherwise.
6. **Exit matrix (D7):** `keep-save` owner-only (400 for sailors);
   sailor `keep`/`restore` skip `forcePersist` so disk stays "as Sina left
   it" (it was frozen all show).
7. **Restart safety (D9):** sailor edits live only in memory; restart →
   boots locked → disk is Sina's. Autosave chokes re-read the gate at write
   time (timer-in-flight safe); a test pins each.
8. **UX (D8):** loud, not spammy — one engine log line per session
   transition + per 403; persistent amber `SAILOR SESSION — LIVE, NOT SAVING`
   chip (tap = escalate); exit sheet reuses the takeover-passcode idiom (no
   remember, wiped field), NOT `PrivilegedAuthSheet`.

## Implementation contract

Eight ordered work items (W1-W8) with anchors + acceptance criteria in
docs/56 §3; suite baselines: CaptainPad failing list EMPTY, engine reds
limited to the known 5× `dev_test_bench` groupBits + `playlist_gallery` baby
+ `party_dancers`. Screenshot matrix S1-S10 in §4 (fresh dist :7167 only;
isolated engine on a scratch port with scratch state dirs; disk-state proof
via `states/` tree hash before/after sailor vs. owner sessions, including a
restart-mid-sailor-session hash check). Auth in tests from scratch fake-value
secrets YAML only.

## Security

Repo public: design carries principal enum names only; no credential
material, no client-side principal storage, no new session surface, no
future dates.

## Files

- `docs/56_principal_scoped_persistence.md` (new)
- `.agent/memory/bm_readiness_thread_tracker.md` — `## _226` block appended
- `.agent/projects/bm26_show_readiness.md` — "Timeline authority + passcode"
  row extended with the _226 design hand-off
