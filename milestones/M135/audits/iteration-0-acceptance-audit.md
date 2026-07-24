# M135 iteration-0 ACCEPTANCE AUDIT

**Task:** exp5-DEFECT-DELIVERY-MANIFEST-INCOMPLETE-RELEASE
**Audit type:** adversarial (refute-first), dispatched top-level fresh context
**Date:** 2026-07-24
**Audit session id:** ab6de3eeaa2016fe
**Implementation locus:** worktree `wf_dfc34384-83e-6` (commit `057bcd5`) — NOT yet merged to `master`

## Verdict: CONCERNS

All 5 AC items are confirmed with hard evidence (live CI run, test results, coverage metrics).
One concern: the mechanical gate (`it0-dod-check.sh`) exits 2 because the ABSORB entry at
`/tmp/m135-absorb-entry.md` is a pre-ABSORB draft missing the required `## Backlog row` section.
This is a process artifact gap (absorb entry not finalized), not a code delivery defect.

---

## AC-1: `--ci` mode exists

**CONFIRMED.**

Evidence:
- `checkCi()` function: worktree `scripts/delivery-manifest-check.ts` lines 279-434
- `--ci` flag parsing: line 439 (`const ciMode = process.argv.includes('--ci')`)
- `GITHUB_TOKEN` requirement: lines 443-448, fail-closed when unset
- `CiCheckResult` interface extends `ManifestCheckResult` with `ciMode`, `releaseTag`, `publishedAssetCount` fields (lines 57-61)
- Non-CI mode unchanged: running without `--ci` on real repo exits 0 with identical output format:

```
$ node --experimental-strip-types scripts/delivery-manifest-check.ts
DELIVERY-MANIFEST-CHECK: OK
  manifest: delivery-manifest.json (v0.3.13)
  npm tarballs declared: 1
  SEA packages declared: 2
  release.yml: found
EXIT: 0
```

- Test `CLI --ci without GITHUB_TOKEN exits non-zero` (test suite line 325): PASS

---

## AC-2: RED fixture (missing manifest entry → non-zero exit)

**CONFIRMED.**

Evidence — 5 RED-path tests, all PASS:

| Test | Result | What it proves |
|---|---|---|
| `checkCi RED — published assets missing a declared npm tarball` | PASS | Manifest declares `quay` npm tarball; mock API returns only SEA assets — exits non-zero |
| `checkCi RED — bundled-with entry when bundled package has no published SEA assets` | PASS | `quay-native` bundled-with `quay`; mock has npm tarball but no SEA assets for `quay` — exits non-zero, reports both quay-native and quay SEA entries missing |
| `checkCi fail-closed — network error (fetch throws)` | PASS | Mock fetch throws `connect ECONNREFUSED` — exits non-zero, reports "Failed to fetch release assets" |
| `checkCi fail-closed — GitHub API returns 401` | PASS | Mock returns HTTP 401 — exits non-zero, reports "GitHub API returned 401" |
| `checkCi RED — missing GITHUB_REPOSITORY env var` | PASS | `GITHUB_REPOSITORY` unset — exits non-zero, reports "CI mode requires GITHUB_REPOSITORY" |

All mocked API responses, consistent with the proposal's explicit design (mock-based testing, no real network calls in tests).

---

## AC-3: GREEN on real tagged release

**CONFIRMED via live cross-check.**

Evidence — live `--ci` run against actual v0.3.13 release using `gh` auth token:

```
$ GITHUB_TOKEN="<live-token>" GITHUB_REPOSITORY="yaleh/quay" GITHUB_REF_NAME="v0.3.13" \
  node --experimental-strip-types scripts/delivery-manifest-check.ts --ci
DELIVERY-MANIFEST-CHECK (--ci): OK
  manifest: delivery-manifest.json (v0.3.13)
  release: v0.3.13
  published assets: 4
  npm tarballs declared: 1
  SEA packages declared: 2
EXIT: 0
```

Cross-checked against real v0.3.13 release assets via `gh release view v0.3.13 --repo yaleh/quay --json assets`:

| Published asset | Covers manifest entry |
|---|---|
| `quay-0.3.13.tgz` | npm-tarballs: `quay` + plugin (bundled in npm tarball per manifest note) |
| `quay-sea-0.3.13-linux-x64.tar.gz` | sea-binaries: `quay` platform linux-x64 + `quay-native` (bundled-with: quay) |
| `quay-sea-0.3.13-macos-arm64.tar.gz` | sea-binaries: `quay` platform macos-arm64 + `quay-native` (bundled) |
| `quay-sea-0.3.13-windows-x64.zip` | sea-binaries: `quay` platform windows-x64 + `quay-native` (bundled) |

All 7 manifest entries covered by 4 published assets via documented bundling. The `--ci` mode correctly resolves:
- `npmPatternMatchesAsset` converts `quay-{version}.tgz` to regex matching `quay-0.3.13.tgz`
- `bundled-with: quay` on `quay-native` entry satisfied because `quay`'s SEA assets exist for all platforms
- Plugin satisfied because npm tarball is published

---

## AC-4: Test extension, coverage >= 80%, loadbearing-test-gate PASS

**CONFIRMED.**

Evidence:

**Test count:** 18 total (11 pre-existing + 7 new CI-mode tests):
- 4 parser/structural tests (unchanged)
- 3 non-CI check tests (unchanged)
- 3 non-CI CLI tests (unchanged)
- 1 manifest validation test (unchanged)
- 7 new CI-mode tests: GREEN path, RED npm-missing, RED bundled-missing, network error, 401, missing GITHUB_REPOSITORY, CLI --ci without token

**Coverage:** 89.21% line (>80% threshold):
```
file                        | line % | branch % | funcs %
delivery-manifest-check.ts  |  89.21 |    69.77 |   92.86
```

**loadbearing-test-gate.sh:** PASS:
```
load-bearing test-gate — scripts=scripts
  [PASS] delivery-manifest-check.ts — load-bearing (imported) + sibling test present
  [PASS] version-consistency-check.ts — load-bearing (imported) + sibling test present
2 total, 2 pass, 0 N/A, 0 fail
PASS: every load-bearing script has a sibling *.test.mjs
```

---

## AC-5: Core quay tests stay green

**CONFIRMED.**

```
$ node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')
...
tests 371
pass 371
fail 0
```

Full suite: 371/371 pass, 0 fail. Excluded `serve-github` and `provider-abi-conformance` per standing convention (they hit live GitHub).

---

## DoD: inherited-core standard clauses

- **All AC items verified true with pasted evidence** — see above.
- **it0 DoD meta-enforcer**: EXIT 2 — the ABSORB entry `/tmp/m135-absorb-entry.md` is a pre-ABSORB draft missing the `## Backlog row` section required by Clause 4 (impl-row gate). This is a process artifact gap, not a code delivery defect. The draft absorb entry was authored for this milestone's pre-ABSORB state and will need the `## Backlog row` section added before final ABSORB.

---

## Mechanical gate (it0-dod-check.sh)

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh \
  exp5-DEFECT-DELIVERY-MANIFEST-INCOMPLETE-RELEASE \
  experiments/quay-perpetual-stream/charters/M135-delivery-manifest-check-tighten.md \
  /tmp/m135-absorb-entry.md
ERROR: absorb-entry-file has no "## Backlog row" section
  (required to run the impl-row clause against a synthetic milestone)
EXIT: 2
```

Exit 2 is the script's usage/environment error code — the absorb entry is a pre-ABSORB draft.
This is a real gap (absorb entry incomplete for the gate to run) but not a code delivery defect.
The gate's Clauses 1-2 and 6-7 (documentation-discipline checks) did not execute because the
script errors out at input validation before any clause-level evaluation.

---

## Concerns

1. **ABSORB entry incomplete** (caught-by: machine, this audit pass): `/tmp/m135-absorb-entry.md`
   missing `## Backlog row` section. The it0-dod-check mechanical gate cannot run clauses 1-2, 4, 6-7
   (documentation-discipline checks) without this section. This is a pre-ABSORB artifact — the
   absorb entry needs to be finalized with the backlog row before the gate can assess all 13 clauses.
   The remaining clauses (3 line-budget, 10 tree-hygiene, 11 worktree-branch-hygiene) also did not
   execute because the script errors out at input validation.

---

## Deviation record

One deviation found, written to `inherited-core.md` deviation table.

### DEV-15: M135 absorb entry draft missing `## Backlog row` section

| Field | Value |
|---|---|
| `id` | DEV-15 |
| `title` | M135 pre-ABSORB absorb entry at `/tmp/m135-absorb-entry.md` is missing the `## Backlog row` section required by it0-dod-check Clause 4 (impl-row gate) — mechanical gate exits 2 before any clause-level evaluation |
| `origin-milestone` | m135 (M135-delivery-manifest-check-tighten, the builder's pre-ABSORB absorb entry draft) |
| `found-at` | m135, same milestone (dispatched adversarial-audit subagent, this pass, before `milestone_counter++`) |
| `caught-by` | machine (the independent adversarial-audit dispatch's own re-run of `it0-dod-check.sh` — not a human manually noticing the missing section — is what surfaced the exit-2; classified `machine` per this schema's `caught-by` definition) |
| `status` | open |
| `age` | 0 (found same milestone as origin) |
