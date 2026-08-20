# _328 — Adversarial merge verdict: `feat/bm_readiness` → `main`

**Role:** adversarial third reviewer. Independent hunt over the angles the
standard lenses under-cover (git *history*, agent-lineage seams, merge
mechanics), plus adversarial verification of `_326` (security/privacy) and
`_327` (structure/code health). Findings only — no fixes, no git write ops,
no show port touched. Branch `feat/bm_readiness` @ `6b26c72c`
(= `origin/feat/bm_readiness`, i.e. the branch is already pushed and public).

---

## 1. MERGE VERDICT — **NOT READY**

Two independent classes of blocker, one process, one irreversible:

1. **The branch fails its own subsystem gates at HEAD.** I reproduced red
   suites myself (three deterministic runs each) — this is not reviewer
   opinion, it is the repo's own P0 rule ("run the touched subsystems'
   auto-check specs before claiming merge-ready") failing mechanically:
   - `simulation` `npm test` (per `.agent/ops/sim_auto_checks.md:40`) is red:
     2 deterministic failures in `simulation/tests/live_touch_ui_layout.test.js`
     (COLOR HUB overflow, native TAKE readiness timeout) plus the
     `bench_mirror_state` guard. These are exactly the suites the branch's own
     handoff (`_325`) flagged "do not assume merge-ready" — committed the next
     day anyway (`af128337`).
   - `marsin_engine` `npm test` is red — 19 failures, all in test files new on
     this branch (verified independently, see §2 / §3).
   - **CI cannot catch any of this**: `.github/workflows/` contains only
     `security_privacy_scan.yml`. There is no test workflow. The only thing
     standing between a red suite and `main` is this rule being honored.
2. **A 1.47 GB irreversible payload needs an explicit operator decision
   BEFORE the merge commit.** `docs/pattern_gallery/` (1236 files, 1465.3 MB
   at HEAD; 1658.1 MB across branch history — 192.8 MB of it is media already
   deleted mid-branch that would still ship in merged history forever). Once
   on `main`, undoing this costs a `filter-repo` + force-push of `main` — the
   exact operation `.agent/os/security_privacy.md` classifies as an
   operator-only emergency. Merging first and deciding later is the wrong
   order. Note: because the branch is pushed, the payload is *already* public
   on `origin/feat/bm_readiness`; if Sina decides against shipping it, the
   branch itself needs a rewrite before merge, not just a removal commit.

**Blocking list (all must clear):**

| # | Blocker | Owner action |
|---|---|---|
| B1 | 19 red engine tests (`_327` P0-1; independently reproduced) | reconcile content vs contract; the 3 wedding ones are a 2-file playlist copy |
| B2 | 2 red sim Live Touch tests (`_327` P0-3/P0-4; reproduced 3×) | fix COLOR HUB 4.9 px overflow + TAKE loader readiness |
| B3 | Tracked machine-written `simulation/scenes/test_bench/bench_mirror_state.yaml` fails its own guard test (`_327` P0-2; confirmed tracked, added by `9e8b23b8`) | `git rm --cached` + gitignore |
| B4 | 1.47 GB gallery → public `main` history, irreversible (`_326` P1-1 / `_327` P1-1; confirmed) | explicit operator go/no-go BEFORE merge; if "no", branch rewrite |
| B5 | Full green re-run of engine + sim + CaptainPad suites after B1-B3, recorded in a follow-up report superseding `_325`'s merge-hold | re-run and record |

No P0 *security* blocker exists — `_326`'s "no secrets/PII in tracked files"
verdict survived my adversarial re-scan, and I additionally cleared the axis
`_326` explicitly could not: the 42-commit **history** (see §2.1).

---

## 2. Independent findings (this review's own hunt)

### 2.1 Git history of the 42 commits — CLEAN (the gap `_326` declared)

`_326` states limit (b): it reviewed the tip only, so "a secret added and
removed within the branch would not surface". I ran that scan:

- `git log main..HEAD -p` over `*.yaml|yml|json|env*|md|js|ts|tsx|py`,
  grepped (never read raw) for `password|passwd|passphrase|psk|ssid|
  api[_-]?key|secret[_-]?key|token|BEGIN … PRIVATE|MAC-regex` → every hit is a
  placeholder, `.example`, env-contract doc, or test fixture
  (`FAKE_WAIVER_TOKEN`, `waiver-token-bravo`, …). **No live value.**
- Same pass for IPs restricted to `.agent/` paths in history → only loopback
  (`127.0.0.x`), `0.0.0.0`, sACN multicast (`239.255.0.x`), RFC5737 doc space,
  and `10.0.0.0/8` *range notation*. No home-LAN or Tailscale address ever
  entered history.
- Personal-email pass over the full history diff → zero after bot plumbing.
- Commit messages `main..HEAD` (`%s %b`) → no names, IPs, credentials, or
  future-deadline dates.
- Deleted-file pass (`--diff-filter=D`): mid-branch deletions are the
  `docs/ui/touch_control_pixel_views.json` relocation and ~193 MB of gallery
  media churn (v1 baby_* / crisp renders re-rendered under new names). No
  deleted config/secret-class file anywhere in the branch.

**Conclusion: no history rewrite is required on the secrets axis.** The only
history-quality cost is P2-a below.

### 2.2 Merge mechanics — CLEAN

- `git merge-tree --write-tree main HEAD` → **0 conflicts** (tree
  `2906d4f4a0…`). The merge itself is mechanically trivial.
- Case-collision check over all tracked paths → **none** (macOS/Linux clones
  safe).
- `git ls-files -i -c` → 3 tracked-but-ignored files (`.vscode/settings.json`,
  `marsin_engine/models/dev_test_bench{,.effects}.js`) — **all pre-existing on
  `main`, untouched by this branch.** Not a branch finding.

### 2.3 The seams (Claude waves ↔ Codex lineage) — the `_325` hold was real

Independently of `_327` (which found the same thing), I diffed `af128337`
against the `_325` handoff list: every file the handoff called "do not assume
merge-ready" was committed the next day. Two of the three named blockers were
in fact fixed before commit (settle-event handling — `touch_control.html:4900`;
fake clock injection — `live_touch_take_bank.test.js:60-68` — both suites
green in my runs). The third ("stale Color Hub browser tests") was **not**:
`live_touch_ui_layout.test.js` fails deterministically (3/3 runs on this
machine):

- `COLOR HUB card rows stay inside the panel client box …` —
  `chCardFollow > chRunFollow` bottom 601.0 vs panel bottom 596.1 at
  1194×834 landscape. The suite is hermetic (file:// + stubbed fetch), so this
  is a real committed layout defect: an operator-facing control clipped on the
  landscape iPad — the show orientation.
- `native TAKE records and replays acknowledged endpoint frames with atomic
  clear` — 30 s readiness-gate timeout (~33 s per run).

Engine-side suites touched at HEAD (`touch_control_wire_layers_contract`,
`live_touch_session_performance_authority`) are green — 51/51 — so the red is
confined to the sim-hosted browser contract layer.

### 2.4 Severity ledger (mine)

| Sev | Finding | Evidence |
|---|---|---|
| P0* | Red suites at HEAD violate the merge-readiness P0 rule; no CI test net exists to catch it | §2.3; `.agent/ops/sim_auto_checks.md:40`; `.github/workflows/` = scan only. (*process-P0: blocks the merge claim, not a leak) |
| P1 | 1.47 GB gallery is a one-way door; already public on the pushed branch; decision belongs before the merge | §1 B4; `git rev-list` blob accounting |
| P2-a | 192.8 MB of mid-branch-deleted gallery media (superseded v1 renders, e.g. `baby_*` gifs/mp4s deleted in `a34b8d46`) ships in merged history as pure orphan weight | history 1658.1 MB vs tree 1465.3 MB |
| P2-b | The gitleaks blind-spot for the gallery was added **by this same branch** (`.gitleaks.toml` +4 lines: `docs/pattern_gallery/.+\.(gif|mp4)` path allowlist) — the branch self-exempted the 1162 files it added. The rationale comment is sound; the pattern (add payload + add its scanner exemption in one branch) deserves operator awareness | `git diff main..HEAD -- .gitleaks.toml` |
| P2-c | No CI test workflow at all — every suite gate in this repo is honor-system. After this branch's 29-red-tests experience, a minimal `node --test` workflow would pay for itself | `.github/workflows/` |

---

## 3. Adversarial verification of `_326` and `_327`

Every P0 reproduced personally; P1s spot-checked; one detail refuted.

### `_326` (security/privacy)

| Claim | Verdict | Basis |
|---|---|---|
| "P0: none — no secret/PII in tracked files" | **CONFIRMED + EXTENDED** | My independent tip greps agree; and I closed their declared gap (b): the 42-commit history is also clean (§2.1) |
| Scanner run: 6 findings, all the same real MAC in untracked `.scene_backups` | **CONFIRMED** | `git ls-files simulation/.scene_backups` = 0; 6 backup copies present on disk with `mac:` |
| P1-1 gallery 1236 files / 1465.26 MB / path absent from main / gitleaks path-allowlisted | **CONFIRMED** | Independent counts match (1236 / 1465.3 MB); allowlist at `.gitleaks.toml:150` — and it was added by this branch (§2.4 P2-b) |
| P1-2 real controller MAC in six stale backup copies, contained by gitignore + deploy-exclude | **CONFIRMED** | Verified both containment layers; agree P1 not P0 |
| P2-2 Team ID: "12 occurrences … the branch improved it — main carries 23" | **REFUTED (detail only)** | `git grep -o '5JN' main|HEAD -- .agent/ops/build_ipad_release.md` → **23 = 23**; the branch diff touches zero `5JN` lines. The substance (partial ID present, ~nil risk, inconsistent with the `<TEAM_ID>` placeholder the tests enforce) stands |
| P2-3/P2-4 future-date rulings | **CONFIRMED (reasoning)** | BRC event dates in functional scheduler code are "what/why" config; past-dated plan deadline is history. Operator confirmation still sensible |
| P2-5 73 MB Unreal `CachedAssetRegistry_0.bin` pre-existing | **CONFIRMED** | `git ls-tree -l main` → 73068679 bytes on main |
| Advisory: `docs/76_…dedication.md` clean | UNVERIFIED (accepted) | Untracked, out of merge scope; their full read is plausible |

### `_327` (structure / code health)

| Claim | Verdict | Basis |
|---|---|---|
| P0-1 19 engine test failures, all in branch-new test files | **CONFIRMED** | Independently reproduced **all 19**: focused `node --test` over the 11 files `_327` named → 159 tests, 140 pass / **19 fail**, failure identities matching `_327`'s table one-for-one (wedding ENOENTs ×3, dev_test_bench model-lint ×5, uv_only ×2, white_only ×2, ambient contracts ×3, companion analyzer, revert_clears_spatial ×2, TE-sign surface, gallery index). A full-suite background run independently surfaced the same wedding failures in its tail |
| P0-1 fix claim: titanic scene missing `wedding_ceremony/gathering.yaml` present in test_bench | **CONFIRMED** | Direct `ls` of both playlist dirs |
| P0-2 tracked machine-written `bench_mirror_state.yaml` | **CONFIRMED** | `git ls-files` hit; added by `9e8b23b8`; header self-describes as machine-written; guard test reproduced red (`_176 §5.3 … the repo scene directory must be untouched by this suite`) |
| P0-3 COLOR HUB 4.9 px overflow, hermetic, real | **CONFIRMED** | Reproduced 3× deterministically; verified the suite stubs fetch and loads file:// |
| P0-4 native TAKE readiness timeout | **CONFIRMED** (failure) / their root-cause hypothesis (Date.now cache-busted dynamic script load) UNVERIFIED — plausible, not proven | Reproduced 3× (~33 s); did not debug further, findings-only |
| P0-5 `_325`-flagged work committed next day | **CONFIRMED** | `git show --stat af128337` = exactly the handoff's file list; 2 of 3 named blockers fixed pre-commit, 1 still red (§2.3) |
| P1-1 gallery + GitHub Pages 1 GB limit | **CONFIRMED** (size/absence from main verified; the Pages 1 GB published-site limit is standard GitHub policy — not re-verified offline) |
| P1-2 duplicate 300-series report numbers (310/311/312/316) | **CONFIRMED** | `ls` shows all four pairs |
| P1-3 six sim tests inconclusive without `:6969` | **CONFIRMED (mechanism)** | Consistent with my runs (those files not in my targeted set; failure mode is conn-refused by design). Agree: inconclusive, not red — but B5's green re-run must include them with the stack up |
| P1-4 tracked runtime state churn | **CONFIRMED** | `git log main..HEAD -- marsin_engine/states` shows 5 commits of churn; 2 files dirty right now |
| Relocations (docs/ui → CaptainPad/live_touch; control_podium → LookingGlass/) clean | **CONFIRMED (independent)** | My own greps: zero `docs/ui` references outside `.agent` narrative; sim tools/tests all point at the new path |
| CaptainPad suites green (2695 pass, typecheck, lint) | UNVERIFIED | Not re-run (their evidence detailed and internally consistent; engine+sim red already decides the verdict) |

**False-negative hunt on their stated coverage:** `_326` scanned the tip, not
history — closed by §2.1 (clean). `_327` ran suites but not merge mechanics —
closed by §2.2 (clean). Neither checked case collisions, ignored-tracked
files, commit messages, or the deleted-file history — all closed, §2.1-2.2.

---

## 4. Coverage gaps that remain (no lens has scanned these)

1. **The 1162 gallery binaries' pixel content.** Path-allowlisted from
   gitleaks, pattern-unscannable by nature. Risk is low (machine-rendered LED
   sims) but nonzero (a stray screen recording would look identical to git).
   If B4 resolves to "ship it", a one-time spot-visual of a random sample is
   cheap insurance.
2. **Physical/hardware validation:** `test:hil`, `perf:gate`, the full-stack
   smoke, and the four-iPad ownership matrix that `_325:149-150` explicitly
   says must not be claimed from unit tests. Nothing in any of the three
   reviews covers show-hardware behavior.
3. **The six `:6969`-dependent sim tests** — inconclusive in every review to
   date; must be part of B5's green run.
4. **Vendored trees** (`simulation/vendor/`, `simulation/unreal/`) — excluded
   by all scanners by policy; pre-existing; carry the known 73 MB artifact
   (`_326` P2-5, cleanup card material, not this merge).

---

*Read-only review. The only file written is this report. No git write
operation was performed; no port in 6966-6972 / 6981 / 5568 was touched.*
