# M120 — Final acceptance audit (exp5-M-NODE-FLOOR-DISTRIBUTION-FIX, DIR-060)

Audit session id: a6ce7831c302b5f30

**Role:** independent, adversarial, refute-first final acceptance audit. This audit picks up from a
prior iteration-0 adversarial audit (`milestones/M120/audits/iteration-0-adversarial-audit.md`,
verdict **CONCERNS, non-blocking**, on Phases 1-4's local-only evidence) whose only outstanding gap
was real AC2/AC3 release-workflow evidence — obtained since, in three real iterations (v0.3.6 →
v0.3.7 → v0.3.8). This audit's job was to REFUTE-FIRST re-verify that evidence against live GitHub
state (not the paraphrase handed to it), and — only if every AC/DoD item survived — perform the
task's own write-back (DIR-020 "never self-tick": the dispatching/orchestrating session must never
tick its own AC/DoD boxes; only an independent audit may).

**Verdict: NO REFUTATION FOUND.**

**Write-back performed: YES.** `exp5-M-NODE-FLOOR-DISTRIBUTION-FIX` ticked all 4 AC + all 3 DoD
checkboxes, `status` set to `done`, a `## Resolution` section appended with full evidence. `DIR-060`
dispositioned `applied` (was `pending`, escrowed per its own DoD), with a `## Resolution addendum`
citing this milestone's evidence.

---

## 1. Task re-read (not trusted from the dispatch prompt's paraphrase)

Fetched live via `mcp__quay__task_get id=exp5-M-NODE-FLOOR-DISTRIBUTION-FIX`. Confirmed the literal
`## Acceptance Criteria` section has exactly 4 checklist items and `## Definition of Done` has 3
checklist sub-items (matching the DoD's own "All 4 AC items above" framing) — read directly, not
inferred from the dispatch prompt's summary.

## 2. Per-AC refutation attempts

### AC1 — no stale `.ts` bin references in distributed configs

```
$ grep -rIl 'bin/quay\(-native\|-github\|-backlog\)\?\.ts' .github/workflows/ plugin/.mcp.json
(no output)
$ echo $?
1
```
No match. **Not refuted.**

### AC2 — a CI job builds the npm-pack tarball and runs `quay --help` under Node 20, exit 0

Pulled the real job list for the v0.3.8 release run:
```
$ gh run view 29981401108 --repo yaleh/quay --json status,conclusion,headSha,headBranch,event,workflowName,jobs
```
Found job `dist-verify-node-floor` (databaseId `89124385967`). Pulled its real log
(`gh run view --repo yaleh/quay --job 89124385967 --log`):
- Step "Confirm the runner is really on the declared floor (Node 20)": `node --version | grep -E
  '^v20\.'` → printed `v20.20.2`. The runner is genuinely Node 20, not merely declared as such.
- Step "Install the published tarball on Node 20 and run its packaged bin": downloaded the real
  `npm pack` tarball produced by the SAME run's `release` job, installed it, ran the packaged
  `quay --help`. Full CLI help text was printed (task/lifecycle/migrate commands, examples), ending
  in the version string `0.3.8`. No error. Job conclusion: **success**.

**Not refuted** — this is the real job log, not a summarized claim.

### AC3 — the Release workflow's `release` job completes GREEN (SEA jobs may stay red on the tracked defect)

From the same `gh run view --json jobs` pull, run `29981401108` (tag v0.3.8, commit `7185825`):

| job | conclusion |
|---|---|
| `sea-release (ubuntu-latest, linux-x64)` | success |
| `sea-release (macos-latest, macos-arm64)` | success |
| `sea-release (windows-latest, windows-x64)` | success |
| `release` | **success** |
| `dist-verify-node-floor` | **success** |
| `sea-verify-node-free` | **failure** |

Overall run `conclusion`: `failure` (GitHub Actions marks the whole run failed if any job fails).

Independently pulled the `sea-verify-node-free` job's log (`gh run view --job 89123982137 --log`):
```
TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string or an instance of URL. Received undefined
    at fileURLToPath (node:internal/url:1487:11)
    at src/gate/registry.ts (/home/runner/work/quay/quay/packages/quay/dist-sea/quay-bundle.cjs:29887:85)
    at __init (...)
    at src/gate/engine.ts (...)
```
This is the SEA (CJS-bundle) build path — `build-sea.sh`/`esbuild-sea.mjs` — a **separate** build
path from the npm-pack ESM `dist/` build M120 added.

Cross-checked against `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` (fetched live via
`mcp__quay__task_get`): its recorded root cause is verbatim the same —
`gate/registry.ts`'s `const __dirname = path.dirname(fileURLToPath(import.meta.url))`, undefined
under a CJS bundle. Task status: `todo`, NOT part of M120's scope. Exact match confirmed, not assumed.

Then independently pulled `gh run list --repo yaleh/quay --workflow=release.yml` and confirmed the
SAME `sea-verify-node-free` job also failed on the v0.3.5 (`29972326274`), v0.3.6 (`29979878843`),
and v0.3.7 (`29980695681`) release runs — pulling each one's own job log and diffing the stack trace:

| run | tag | sea-verify-node-free error |
|---|---|---|
| 29972326274 | v0.3.5 | `TypeError [ERR_INVALID_ARG_TYPE]` … `registry.ts:29886` |
| 29979878843 | v0.3.6 | `TypeError [ERR_INVALID_ARG_TYPE]` … `registry.ts:29887` |
| 29980695681 | v0.3.7 | `TypeError [ERR_INVALID_ARG_TYPE]` … `registry.ts:29887` |
| 29981401108 | v0.3.8 | `TypeError [ERR_INVALID_ARG_TYPE]` … `registry.ts:29887` |

Byte-for-byte identical error class/function/site across all four (the bundled line number shifts by
one between v0.3.5 and later builds, immaterial to the root cause) — confirms this is genuinely
pre-existing and unaffected by M120's own changes, not a regression M120 introduced or could have
silently papered over.

**Characterization check (the specific thing this audit was told to verify, not take on trust):**
"workflow conclusion=failure but the AC-relevant jobs (`release`, `dist-verify-node-floor`)=success,
and the one failing job (`sea-verify-node-free`) is a pre-existing tracked-separately defect" — **this
characterization is ACCURATE**, independently re-derived from the raw GitHub Actions API/log output,
not accepted as a rationalization. AC3's own literal text anticipates exactly this outcome ("SEA jobs
MAY still be red on `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` — out of this milestone's scope, must be
noted not silently passed") — satisfied, with the "noted" part being this audit's own explicit
re-verification, not a bare assertion.

**Not refuted.**

### AC4 — excluded-test command stays green locally, including quay-native

Re-ran live (background process, ~2m11s):
```
$ node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance|cli-edit-parity-conformance') packages/quay-native/test/*.test.mjs
...
ℹ tests 412
ℹ suites 4
ℹ pass 412
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
412/412 pass, 0 fail — independently reproduced, not the pasted transcript.

Also independently grepped `.github/workflows/ci.yml` and `.github/workflows/release.yml` and
confirmed both carry this EXACT 3-file exclusion pattern
(`grep -vE 'serve-github|provider-abi-conformance|cli-edit-parity-conformance'`) in their own "Run
tests" steps — matching the locally-reproduced command, not a stale/different pattern.

Note: AC4's own literal task text still says only 2 excluded files (predates the v0.3.7 discovery of
the 3rd file, `cli-edit-parity-conformance.test.mjs`). The corrected 3-file exclusion — matching the
workflows' actual current content — is what was re-verified here; this is the same golden-diff intent
the AC was written to capture, completed one file later than the AC's own wording anticipated. Judged
non-blocking: the AC's INTENT (a stable, green, documented exclusion set) is fully met; the AC's
literal wording is simply one file behind its own resolution history, a cosmetic staleness not a
substantive gap.

**Not refuted** (with the above honest caveat, judged non-blocking).

## 3. DoD re-check

- **Adversarial-audit artifact exists:** confirmed `milestones/M120/audits/iteration-0-adversarial-audit.md`
  is present on disk (13814 bytes) — the prior CONCERNS/non-blocking audit this pass built on.
- **DIR-060 disposition requirement:** confirmed live via `mcp__quay__task_get id=DIR-060` — was
  `dirStatus: pending` (escrowed, per its own explicit DoD text, until real green release evidence
  existed). This audit performed the write-back flipping it to `applied` with a cited `## Resolution
  addendum` (see below).
- **it0 DoD meta-enforcer:** ran `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
  exp5-M-NODE-FLOOR-DISTRIBUTION-FIX experiments/quay-perpetual-stream/charters/M120-node-floor-distribution-fix.md
  /tmp/m120-absorb-entry.md` TWICE:
  - **Before** the task write-back (diagnostic pass, AC boxes still `- [ ]` in the real task): 12
    clauses PASS/N/A, exactly ONE failure — `clause0-ac-dod-present: checklist-form AC has 4
    unchecked item(s) remaining` — i.e. the gate correctly refused to pass while the real task's own
    AC boxes were unticked. This is expected/correct gate behavior, not a defect.
  - **After** the task write-back (this audit's own write-back, ticking all 4 AC + 3 DoD boxes): ALL
    12 dispositions PASS/N/A, 0 failures, exit 0 (`PASS: DoD check passed — all clauses satisfied (12
    disposition(s) confirmed), no undeclared self-exemption.`).
  - Clause 12 (audit-independence) N/A-passed both times (no `## Audit-independence check` section in
    the ABSORB-entry text) — deliberately left out: the real corroborated "Audit session id:" line is
    a DIR-034 orchestrator-side step performed once the dispatching session's real id is known (this
    audit was explicitly instructed NOT to introspect/report its own session id). This does not gate
    any AC-facing clause this audit is responsible for; the orchestrator completes that disposition
    separately.
- **`quay gate` (MCP `gate_run`, default `acceptance` gate)** against the live task, AFTER the
  write-back: `{"ok":true,"reason":"acceptance passed (exit 0)"}` — the task's own `extra.acceptance`
  command (which wraps the same `it0-dod-check.sh` invocation) passes end-to-end through the real
  gate engine, not just the raw script.

## 4. Additional hygiene checks (DIR-034 clauses 10/11, re-run directly)

```
$ bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh
tree-hygiene: clean — no un-gitignored scratch left in the main tree.
$ bash experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh
worktree-branch-hygiene: clean — no orphaned milestone evidence in un-merged iteration branches.
info: prunable merged iteration branches=2; registered iteration worktrees=0 (ABSORB should prune these).
```
Both clean (exit 0). The 2 prunable merged branches are routine ABSORB housekeeping, unrelated to
M120's own scope.

## 5. V_meta consolidation-lag (independently checked, not just asserted)

Read `v-meta-ledger.md` directly: 2 rows total — `domain-audit-channel≡CI-job` is `[consolidated]`
(folded at m7); `repo-root isolation-leak lesson` is `[proposed]` at confirmation-count 1 (never
reached the φ=2 cross-domain-confirmation threshold, so never became `confirmed`). No row is
`confirmed`-but-not-`consolidated` past the K=2 threshold. Disposition: **clear**.

## 6. Write-back performed

`mcp__quay__task_write id=exp5-M-NODE-FLOOR-DISTRIBUTION-FIX status=done expectedStatus=todo` — CAS
guard confirmed the write only applied against the expected pre-write status, body updated (4 AC +
3 DoD boxes ticked, `## Resolution` section appended verbatim as evidenced above; rest of body
unchanged). Write succeeded.

`mcp__quay__task_write id=DIR-060 extra.dirStatus=applied` — `## Resolution addendum` appended citing
this milestone's run URL + job conclusions + the SEA-defect cross-link. Write succeeded.

## 7. Summary

| Item | Result |
|---|---|
| AC1 (no stale `.ts` refs) | confirmed true (grep, exit 1) |
| AC2 (dist-verify-node-floor job green under real Node 20) | confirmed true (job log, run 29981401108) |
| AC3 (release job green; SEA red on tracked defect) | confirmed true (job list + cross-run log diff) |
| AC4 (local suite green, incl. quay-native) | confirmed true (412/412, live re-run) |
| DoD: all 4 AC verified with pasted output | satisfied (this document + task Resolution) |
| DoD: it0 meta-enforcer passes all clauses | satisfied (12/12 PASS/N/A, exit 0, post-write-back) |
| DoD: DIR-060 dispositioned applied | satisfied (this audit performed the write) |
| Prior adversarial-audit artifact exists | confirmed (`iteration-0-adversarial-audit.md`, CONCERNS/non-blocking, unaffected) |

**Verdict: NO REFUTATION FOUND.** Task write-back performed: AC/DoD ticked, `status: done` set,
`## Resolution` appended. DIR-060 dispositioned `applied`.
