# M122 iteration-0 — adversarial audit

Audit session id: a513c593cc84e20d1

**Task under audit:** `tasks/exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY`
**Charter:** `experiments/quay-perpetual-stream/charters/M122-sea-verify-3platform.md`
**Claims under audit:** `experiments/quay-perpetual-stream/milestones/M122/iterations/iteration-0.md`
**Auditor stance:** fresh-context, refute-first — did not trust any pasted transcript without
independently re-deriving it from a primary source (`gh` CLI against the real GitHub Actions API,
local bash reproduction, local test/CLI re-runs, `git show`/`git diff` against the actual commits).

## Verdict: **NO REFUTATION FOUND**

All 4 task AC items and both cited GitHub Actions runs independently re-verified against primary
sources, not the pasted transcript. Two non-blocking CONCERNS noted below (neither blocks). DoD item 2
(it0 DoD meta-enforcer) is correctly left unticked per the audit brief's own two-pass precedent (M121)
— this is a structural limitation of using `iteration-0.md` as a stand-in ABSORB-entry, not a defect
found in the milestone's actual work.

---

## 1. AC-by-AC independent verification

### AC1 — macOS runtime-smoke against the SEA archive, real
Pulled run 29998600334 directly via `gh run view --json ... jobs`. Job
`sea-verify-node-free-cross-platform (macos-latest, macos-arm64, tar.gz)` (databaseId 89178460070):
all 6 steps `conclusion: success`, including "Strip Node.js from PATH and confirm it is genuinely
gone" and "Run quay serve and curl it (no Node on stripped PATH)". **Confirmed independently, not
from the pasted transcript.** — [x] ticked.

### AC2 — Windows runtime-smoke against the SEA archive, real
Same run, job `sea-verify-node-free-cross-platform (windows-latest, windows-x64, zip)` (databaseId
89178460044): all 6 steps `conclusion: success`. Pulled the raw step log
(`gh run view --job 89178460044 --log`) and confirmed the "Run quay serve and curl it" step actually
printed `quay-native mcp: serving tasks from D:\a\quay\quay\extracted\tasks...`, `quay serve: listening
on http://0.0.0.0:18081...`, and `http_code:200` — a genuine successful HTTP round-trip through the
extracted Windows archive, not a stubbed/short-circuited pass. **Confirmed independently.** — [x]
ticked.

### AC3 — a real release run (tag push) shows all 3 platform verify jobs green, URL + per-job status pasted
`gh run view 29998600334 --json status,conclusion,...jobs` (pulled fresh, not from the artifact):
`conclusion: "success"` overall; every job in the run — `release`, `sea-release` ×3, `sea-verify-
node-free-cross-platform` (macos + windows), `sea-verify-node-free` (linux), `dist-verify-node-floor`
— is `conclusion: "success"`. Matches iteration-0.md's pasted transcript verbatim (job names, order,
verdicts) and the URL cited (`https://github.com/yaleh/quay/actions/runs/29998600334`) resolves to
this exact run. **Confirmed independently.** — [x] ticked.

**Also independently verified the FIRST (partially-failing) run, per the audit brief's specific
instruction** — run 29997991782:
- `conclusion: "failure"` at the run level (confirmed via `gh run view --json`).
- Job `sea-verify-node-free-cross-platform (windows-latest, windows-x64, zip)` (databaseId
  89176442089): step "Run quay serve and curl it (no Node on stripped PATH)" has `conclusion:
  "failure"`; the other 4 steps in that job (including "Strip Node.js from PATH", "Run quay --help")
  are `success` — matches iteration-0.md's claimed step-level breakdown exactly, not just the
  job-level red/green.
- Pulled the raw log for that failing step (`gh run view --job 89176442089 --log`) and found, verbatim:
  `Error: no .quay/config.yml found (searched from D:\a\quay\quay\extracted upward). Run in a
  workspace with .quay/config.yml.` followed by a real stack trace into
  `quay-bundle.cjs:7386/30823/33765`, then `http_code:000` and `##[error]Process completed with exit
  code 7`. This is the exact claimed failure mode, not an inference or a paraphrase — I pulled the raw
  CI log text myself. The macOS leg of the same run (databaseId 89176442034) is genuinely
  `conclusion: "success"` all 6 steps, matching the "macOS passed cleanly on the first attempt" claim.

### AC4 — chart2-s1-artifacts.json flip
Read `chart2-s1-artifacts.json` directly (not the diff): `sea-macos-arm64` and `sea-windows-x64` rows
both now `"floorSmokePass": true`, evidence strings cite run 29998600334 and the exact job URLs
(89178460070 / 89178460044) I independently pulled above — the citations are accurate, not invented.
Re-ran the calculator myself:
```
$ node experiments/quay-perpetual-stream/scripts/chart2-s1-distribution-reliability.ts
S1 Distribution-reliability cov = 0.8 (4/5 artifacts pass floor-smoke)
```
matches iteration-0.md's claim exactly. Arithmetic: Δcov = 0.8 − 0.4 = 0.4; dashboard.md's own S1
weight row (`| S1 | Distribution reliability | 30 | ... |`) confirms weight = 30 (independently
cross-referenced, not assumed) ⇒ 0.4 × 30 = **12.0 chart-2 points**, matching the claimed "+12.0"
exactly. This is also the exact 0.20→0.80 flip DIR-064-B originally predicted at the chart-2
transition, and it fully reconciles (unlike M121's DEV-12 shortfall — M122's own charter AC #4 said
"S1 cov moves 0.4 → 0.8" and that is exactly what was delivered, no gap to reconcile this time).
**Confirmed independently.** — [x] ticked.

### Golden-test update claim
`iteration-0.md` claims "Updated the S1 calculator's own golden tests (2 CLI assertions + 1
integration assertion, previously pinned to 0.4) to the new real value 0.8 — re-ran, 59/59 pass (S1
20/20, S2+S3 39/39)."
- `git show 4fc10fa -- .../chart2-s1-distribution-reliability.test.mjs` shows EXACTLY 3 assertion
  sites changed 0.4/2/5 → 0.8/4/5: the integration test at line ~141 and the two CLI subprocess tests
  at lines ~173/179 — matches "2 CLI + 1 integration" precisely.
- Independently re-ran all three chart-2 suites myself:
  `node --test experiments/quay-perpetual-stream/test/chart2-{s1,s2,s3}-*.test.mjs` → **59 pass, 0
  fail**. `node --test .../chart2-s1-distribution-reliability.test.mjs` alone → **20 pass, 0 fail**.
  Both counts match exactly.
- Ran the S1 test file with `--experimental-test-coverage`: **97.54% line coverage** (independently
  measured, not trusted from dashboard.md's "97.4%" figure — close enough to be the same measurement
  modulo minor rounding/tooling-version drift, not a discrepancy worth flagging).

## 2. Root-cause mechanism independently reproduced (not merely asserted)

Iteration-0.md's local dotglob demo was reproduced from scratch in my own scratch directory (not
copy-pasted, a fresh `mkdir`/`touch`):
```
$ mkdir -p dist-sea-release/.quay && touch dist-sea-release/quay.exe dist-sea-release/.quay/config.yml
$ echo dist-sea-release/*
dist-sea-release/quay.exe
$ bash -c 'shopt -s dotglob; echo dist-sea-release/*'
dist-sea-release/.quay dist-sea-release/quay.exe
```
Confirms the claimed bash glob semantics are real, not asserted. Also read the actual fix in
`.github/workflows/release.yml` directly (not the diff): `shopt -s dotglob` sits immediately before
`7z a "${ARCHIVE_NAME}.zip" ./dist-sea-release/*`, inside the `windows-latest` branch only — the
non-Windows branch (`tar -czf ... -C dist-sea-release .`) is untouched, exactly as claimed.

## 3. Scope-expansion assessment (dotglob fix) — legitimate, not undisclosed creep

Checked out of specific concern for item (e) in the audit brief. Findings:
- `git show 97cb06a --stat` (the fix commit) touches ONLY `.github/workflows/release.yml`,
  `CHANGELOG.md`, `packages/quay/package.json` (version bump) — no unrelated files, no drive-by
  changes.
- The diff within `release.yml` is exactly one line (`shopt -s dotglob`) plus an explanatory comment,
  inside the `sea-release` job's `windows-latest` conditional branch of the existing "Archive release
  bundle" step — NOT inside the linux `sea-verify-node-free` job, which the charter explicitly
  excludes from scope ("Not in scope: any change to the existing Linux `sea-verify-node-free` job").
  The fix is compliant with the charter's own exclusion list.
- The bug was discovered BY the very mechanism this milestone was chartered to build (the new
  cross-platform verify job), on the FIRST real run of that job — this is not scope drift into
  unrelated territory, it is the charter's own stated purpose (close the "no runtime-smoke coverage"
  gap) paying off immediately. Fixing it was also strictly necessary to satisfy the charter's own
  literal AC #3 ("all 3 platform verify jobs green") — the windows job cannot go green without it, so
  this is arguably IN the charter's already-stated scope, not an expansion of it.
- Full disclosure: iteration-0.md gives the bug and fix their own prominent, clearly-labeled
  subsections ("Real evidence — first attempt", root-cause paragraph, local repro, "Fix" section,
  "Real evidence — second attempt") rather than folding it silently into the top-line narrative.
  `CHANGELOG.md`'s v0.3.11 entry independently corroborates the same story in the same terms.

**Judgment: legitimate, well-justified, fully disclosed same-pass fix — not undisclosed scope creep.**
I considered logging this as a deviation-log candidate per the audit brief's item 5, but concluded it
does NOT meet the schema's "included" bar (`inherited-core.md`'s Deviation-record schema): it is not a
mechanical DoD-clause gap that let something through, not a charter/ABSORB claim that overstated a
gate's applicability, and not a departure from what the charter claimed — the charter's own AC #3
required exactly this outcome (all 3 platforms green), and the milestone delivered it, including the
work needed to get there. Recommend the orchestrator NOT add a DEV-NN row for this; if the orchestrator
disagrees, the concrete facts to weigh are laid out above.

## 4. it0-dod-check.sh run (per audit brief §4)

Ran exactly as instructed, `iteration-0.md` as the absorb-entry stand-in:
```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY \
    experiments/quay-perpetual-stream/charters/M122-sea-verify-3platform.md \
    experiments/quay-perpetual-stream/milestones/M122/iterations/iteration-0.md
ERROR: absorb-entry-file has no "## Backlog row" section (required to run the impl-row clause against a synthetic milestone)
```
Exit 2. Expected, per the audit brief and the exact M121 precedent
(`milestones/M121/audits/iteration-0-adversarial-audit.md`, same error, same reason). Reading
`it0-dod-check.ts`: Clause 4 (impl-row) throws a fatal `DodCheckEnvError` BEFORE the script prints any
clause verdicts — clauses 0-3 run first and accumulate into `passes`/`failures` arrays, but that array
is never printed because `main()`'s catch block for `DodCheckEnvError` exits immediately on the raw
error message.

**Supplementary diagnostic (clearly NOT the official run):** to determine which clauses "genuinely
evaluate cleanly regardless" as the audit brief asked, I copied `iteration-0.md` to a scratch file and
appended a synthetic `## Backlog row` section (a stub row, explicitly not a real ABSORB entry) purely
so Clause 4 would not abort the whole run, then re-ran the check against that scratch copy only. This
diagnostic run is NOT evidence DoD item 2 is satisfied — it is only used to characterize which clauses
are structurally blocked by the *stand-in* input vs. genuinely still open:
- **PASS cleanly regardless:** clause3-line-budget, clause4-impl-row (N/A, correctly judged
  not-design-only), clause5-no-self-exemption, clause6-escrow-delta-v (N/A), clause8-task-canonical-
  lifecycle-record, clause10-tree-hygiene, clause11-worktree-branch-hygiene, clause12-audit-
  independence (correctly N/A on iteration-0.md, which lacks an "Audit-independence check" section —
  expected, since this audit's own line hasn't been folded into a real ABSORB entry yet).
- **FAIL only for structural/timing reasons, not substantive defects:**
  - clause0-ac-dod-present — failed only because it was run against the task's PRE-audit state (all 4
    AC boxes still `- [ ]`); after my write-back above (all 4 now `- [x]`) this would pass. I did not
    re-run the diagnostic after ticking to avoid any appearance of the audit tuning its own gate input.
  - clause1-adversarial-audit / clause2-vmeta-lag — fail only because `iteration-0.md` is a milestone
    report, not a real ABSORB entry, and does not itself carry the ABSORB-time disposition sentences
    ("adversarial-audit: NO REFUTATION FOUND", V_meta lag "clear", etc.) those clauses scan for. This
    is exactly the class of gap the real ABSORB entry (written by the orchestrator, folding in THIS
    audit's verdict) is expected to close.
  - clause7-test-floor — fails on iteration-0.md's exact phrasing (no literal "80%"/"test coverage"
    disposition sentence adjacent to a product-touching-surface statement), despite the REAL test
    coverage being independently confirmed excellent (97.54% on the touched calculator, 59/59 tests
    green) — again a phrasing/timing gap in the stand-in input, not evidence of an actual undertested
    surface.

**DoD item 2 left UNTICKED**, per the audit brief's explicit instruction and the M121 precedent — the
real verdict requires running this script against the orchestrator's real ABSORB entry.

## 5. Deviation-log check (§5 of audit brief)

Considered two candidates:
1. **The dotglob mid-flight scope expansion** — assessed above as legitimate and in-scope; recommend
   NOT logging as a deviation.
2. **DoD item 2 remaining structurally unconfirmable this pass** — this mirrors M121's own precedent
   exactly (same script, same error, same resolution path: orchestrator writes real ABSORB entry,
   re-run, resume/follow-up audit). Since M121 did not log this as a DEV-NN row (it's an expected,
   recurring two-pass audit shape, not a departure from a claim or a gate that let something through
   silently), I recommend the same non-logging treatment here for consistency.

**No new DEV-NN row recommended this pass.**

## 6. Things specifically tried and could NOT break

- Tried to find narrative-only AC claims with no adjacent evidence: none found — all 4 AC items have
  either a direct `gh`-verifiable run/job citation or a locally-reproducible artifact (the JSON file,
  the calculator, the test suite).
- Tried to find evidence that doesn't support the specific claim made: none found. Each citation
  (run id, job id, log excerpt) resolved to exactly the claimed content when pulled fresh.
- Tried to recompute all arithmetic: cov 2/5→4/5, Δcov×30=12.0, S1/S2/S3 test counts (20+21+18=59) —
  all recompute cleanly, matching the claims exactly.
- Tried to verify GitHub Actions run status independently rather than trust the pasted transcript:
  done via `gh run view --json` and `gh run view --log` against the real API for BOTH cited runs,
  including pulling the raw failing-step log text for the first (partially-failing) run.
- Tried to find scope creep granted without disclosure: found a real mid-flight scope expansion (the
  dotglob fix) but judged it fully disclosed and in-scope per the charter's own AC — see §3.
- Tried to find a self-ticked checkbox (SELECT should never tick): confirmed via `task_get` before my
  own write-back — all AC/DoD boxes were `- [ ]` prior to this audit.
- Tried to break the "second attempt is genuinely green, not just re-asserted" claim: pulled the raw
  step log for the second-run Windows job and confirmed a real `http_code:200` from an actual
  `curl` round-trip against a `quay serve` process that had genuinely found `.quay/config.yml`
  ("quay-native mcp: serving tasks from D:\a\quay\quay\extracted\tasks..."), not a stubbed pass.

## 7. Checklist write-back performed

Via `mcp__quay__task_write` (CAS-guarded on `expectedStatus: "todo"`), ticked on
`tasks/exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY.md`:
- [x] AC1 (macOS runtime-smoke)
- [x] AC2 (Windows runtime-smoke)
- [x] AC3 (real release run, all 3 platforms green, URL + status pasted)
- [x] AC4 (chart2-s1-artifacts.json flip, citing the real run)
- [x] DoD item 1 (all 4 AC items verified true with pasted output/URLs)
- [ ] DoD item 2 (it0 DoD meta-enforcer passes all clauses) — LEFT UNTICKED, see §4.

Task status left at `todo` — lifecycle transition is the orchestrator's ABSORB-time job, not this
audit's.

## 8. Note for the orchestrator (not a defect, informational)

`dashboard.md`'s chart-2 S1 row (line 122) and the VT curve narrative below it still show the M121
state (cov 0.40, 12.00 pts, citing run 29995456654) — this is expected (dashboard.md is an ABSORB-time
artifact the orchestrator updates, not something iteration-0 touches), but flagging it explicitly so
the orchestrator's ABSORB pass doesn't miss updating: S1 row → cov 0.80/24.00 pts, chart-2 wired total
→ 26.50/85, global VT → 110.65 + 26.50 = 137.15, plus a new VT-curve append entry for
`m122/exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY, Δv=+12.0`.

---

## Summary

**Verdict: NO REFUTATION FOUND.** All 4 AC items independently re-verified against primary sources
(live GitHub Actions API pulls, raw CI logs, local test/CLI re-runs, local bash reproduction of the
root-cause mechanism) — not the pasted transcript. Arithmetic recomputes cleanly (0.4→0.8 cov, +12.0
chart-2 pts, weight 30 cross-checked against dashboard.md). The one mid-flight scope expansion (the
dotglob archiving fix) is judged legitimate and in-scope, not undisclosed creep. DoD item 2 correctly
left unticked pending the real ABSORB entry, mirroring M121's own two-pass precedent exactly.

## Follow-up pass (same audit, after the orchestrator wrote the real ABSORB-entry)

The orchestrator subsequently wrote the real ABSORB-entry to `/tmp/m122-absorb-entry.md`, ran
`it0-dod-check.sh` (claimed: all 12 clauses PASS) and `quay gate` (claimed: PASS, real GateEvent
`10:31:10.251Z`), and asked me to independently re-run both rather than trust the paste.

**First independent re-run — genuinely FAILED, confirming this is a real gate, not a rubber stamp:**
```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY \
    experiments/quay-perpetual-stream/charters/M122-sea-verify-3platform.md /tmp/m122-absorb-entry.md
FAIL: clause0-ac-dod-present: checklist-form AC has 4 unchecked item(s) remaining ...
FAIL: clause12-audit-independence: FAIL — audit artifact's session id ("PLACEHOLDER-ORCHESTRATOR-FILLS-IN")
  is distinct ... but is NOT found in the supplied dispatch-record — treated as a FABRICATED distinct
  string, fail-closed per DIR-034's anti-forgery requirement
FAIL: DoD check failed — 2 clause violation(s) found (see above).
```
Root cause (diagnosed, not guessed): this audit's own isolated worktree (`agent-a513c593cc84e20d1`)
had a STALE copy of `tasks/exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY.md` (my earlier `task_write`
tick lands in the actual provider store, resolved via the shared checkout's `.quay/config.yml`, not
this git worktree's own `tasks/` copy) and a STALE copy of this very audit artifact (still carrying
`Audit session id: PLACEHOLDER-ORCHESTRATOR-FILLS-IN` — the orchestrator's real-id substitution had
only been applied to the shared checkout / merged copy, not synced into this isolated worktree). This
is the exact same class of split M121's own audit hit (`milestones/M121/audits/iteration-0-adversarial-
audit.md`, "both live only in the shared checkout, not in this isolated audit worktree").

**Synced the orchestrator-side state into this worktree** (`Read` from the shared-checkout paths +
local `Edit` only — no git operation against the shared checkout): (1) added the missing
`extra.acceptance` field and ticked all 4 AC + DoD-1 boxes on the local `tasks/...md` copy to match the
live provider state; (2) replaced this artifact's own placeholder line with
`a513c593cc84e20d1` — the real dispatch id, matching `/tmp/m122-dispatch-record.txt`'s content exactly
(independently read, not assumed).

**Second independent re-run, against the synced worktree — genuinely PASSED:**
```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY \
    experiments/quay-perpetual-stream/charters/M122-sea-verify-3platform.md /tmp/m122-absorb-entry.md
PASS: clause0-ac-dod-present ... PASS: clause1-adversarial-audit ... PASS: clause2-vmeta-lag ...
PASS: clause3-line-budget ... PASS: clause4-impl-row ... PASS: clause5-no-self-exemption ...
PASS: clause6-escrow-delta-v ... PASS: clause7-test-floor ... PASS: clause8-task-canonical-lifecycle-record ...
PASS: clause10-tree-hygiene ... PASS: clause11-worktree-branch-hygiene ...
PASS: clause12-audit-independence: PASS — session id ("a513c593cc84e20d1") ... corroborated by the
  independent dispatch-record — genuinely independent (DIR-034 anti-forgery check satisfied)
N/A: clause9-split-or-commit ...
PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
```
Exit 0, matching the orchestrator's claim.

**Gate re-run, independently:**
```
$ node packages/quay/bin/quay.ts gate exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY
PASS
```
Exit 0. Confirmed a NEW GateEvent was genuinely appended to this worktree's own
`.quay/gate-events.jsonl` (`verdict: "pass"`, `timestamp: "2026-07-23T10:32:41.103Z"`) — a
second, independently-generated pass record, distinct from but corroborating the orchestrator's own
cited GateEvent (`10:31:10.251Z`), not a copy of it.

**Final checklist write-back:** ticked the last remaining box via `task_write`,
`- [x] it0 DoD meta-enforcer passes all clauses.`, citing this independent re-run (including the
FAIL-then-sync-then-PASS sequence, not just the final PASS) as supporting evidence in the tick itself
per this follow-up's own instruction. Task `status` left unchanged (`todo`) — lifecycle transition
remains the orchestrator's job.

**Updated verdict: NO REFUTATION FOUND, DoD now fully confirmed (all AC + both DoD items independently
verified true).**
