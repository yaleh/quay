# M173 (DIR-109) — Independent Adversarial Acceptance Audit

**Audit session id:** 80ae3423-65e2-42d1-bbd3-5894a6f0ad3b

**Auditor stance:** fresh context, refute-first. Charge: refute every AC/DoD item against concrete
artifacts (not implementer self-report), run the mechanical gate, write back checklist ticks and
dashboard deviation rows.

**Verdict: REFUTED**

---

## 1. Acceptance Criteria — item by item

Task file: `tasks/DIR-109.md`.

### AC1 — `scripts/test.sh` exists, executable, no-args run executes the full safe-by-default suite via `--test-concurrency=8`

**CONFIRMED.**
- `ls -la scripts/test.sh` → `-rwxrwxr-x`.
- Independently re-ran `bash scripts/test.sh` end-to-end (not trusting the commit message's own
  numbers). `ps aux` during the run showed the spawned process:
  `node --test --test-concurrency=8 packages/quay-backlog/test/*.test.mjs packages/quay-github/test/*.test.mjs
  packages/quay-native/test/*.test.mjs packages/quay/test/*.test.mjs plugin/test/*.test.mjs` (80 files).
- Final tally: `tests 517 / suites 4 / pass 514 / fail 0 / cancelled 0 / skipped 3 / todo 0 /
  duration_ms 307470`. Matches the commit message's claimed 514/0/3 — independently reproduced,
  not merely quoted.

### AC2 — each of the 3 live/conformance files declares an in-file skip; a credential-less run reports them `skipped`

**CONFIRMED.**
- `grep -n skip` on all 3 files (`packages/quay/test/serve-github.test.mjs`,
  `provider-abi-conformance.test.mjs`, `cli-edit-parity-conformance.test.mjs`) shows each wraps its
  existing `main()` in `test(name, {skip: !liveGithubEnabled && "..."}, main)` gated on
  `process.env.QUAY_TEST_LIVE_GITHUB === "1"`.
- The independent re-run above reported `skipped 3` — matching exactly the 3 files, confirming they
  register as `skipped` test-runner output, not silently absent from the glob (the AC's specific
  concern).

### AC3 — setting the documented opt-in env var causes the live tests to actually execute

**CONFIRMED — independently executed, not trusted from self-report.**
- Ran `QUAY_TEST_LIVE_GITHUB=1 GH_TOKEN=$(gh auth token) node --test
  packages/quay/test/provider-abi-conformance.test.mjs` live against the real `yaleh/quay` repo.
- Result: `25 scenario cells run (native: 8, github: 17)` — `native/primitive 4/4, github/primitive
  12/12, native/compound 4/4, github/compound 5/5` — all pass, `tests 1 / pass 1 / fail 0`.
- Did NOT independently re-execute `cli-edit-parity-conformance.test.mjs` or `serve-github.test.mjs`
  live (both perform real mutating writes against production `yaleh/quay` issues per their own file
  header comments) — re-running a 3rd live-mutation probe was judged unnecessary once the same
  skip-gate mechanism was proven live-executing on one of the three, with identical code shape
  confirmed by direct code inspection on the other two.

### AC4 — `.github/workflows/ci.yml`'s test job invokes `scripts/test.sh`

**CONFIRMED.** `git show dfd024d -- .github/workflows/ci.yml` diff: old
`run: node --test $(ls packages/*/test/*.test.mjs plugin/test/*.test.mjs | grep -vE
'serve-github|provider-abi-conformance|cli-edit-parity-conformance')` replaced with
`run: bash scripts/test.sh`. Current file confirmed via direct read.

### AC5 — `CLAUDE.md` documents `scripts/test.sh` as the canonical entrypoint

**CONFIRMED.** CLAUDE.md's Commands section: "**Canonical entrypoint: `scripts/test.sh`**
(ADR-019/DIR-109) — the single script both this file and `.github/workflows/ci.yml` invoke..."
The old hand-written glob/grep prose is gone from CLAUDE.md.

### AC6 — no remaining occurrence of the old `grep -vE '...'` pattern anywhere in the repo (`git grep` returns empty)

**REFUTED.**
```
$ git grep -n "grep -vE 'serve-github|provider-abi-conformance|cli-edit-parity-conformance'" | wc -l
9
```
Hits: `adr/ADR-019-...md:25`, `tasks/DIR-109.md:26,57` (this task's own Finding/AC text — an
inherent self-reference problem with this AC's phrasing), plus 6 historical records
(`milestones/M120/audits/iteration-0-final-acceptance-audit.md` x2,
`milestones/M173/iterations/iteration-0.md` x2 (the implementer's own report, which explicitly
documents doing this git grep sweep and narrowing it),
`experiments/quay-perpetual-stream/milestones/M121/iterations/iteration-0.md`,
`tasks/exp5-M-NODE-FLOOR-DISTRIBUTION-FIX.md`).

The AC is worded unconditionally: "anywhere in the repo ... `git grep` returns empty." It does not.
The implementer's own iteration-0.md report (lines 124-143) is candid about this — it runs the
narrower `git grep -n "..." -- '*.yml' '*.sh'` (empty) and argues the AC's *intent* is about live
invocation surfaces, not historical narrative. That is a defensible reading of ADR-019's
Consequences section, but it is the implementer re-scoping their own AC after the fact, not this
audit's to grant on the AC's literal text. What IS independently confirmed clean: `CLAUDE.md` and
`.github/workflows/ci.yml` themselves contain zero `grep -vE` occurrences (checked directly);
`.github/workflows/release.yml` line 48 mentions the pattern only inside a past-tense comment
("used to need"), not as a live invocation.

**Verdict on AC6: REFUTED as literally written.**

---

## 2. Definition of Done

### DoD1 — `scripts/test.sh` committed and run for real, output pasted showing the real pass count

**CONFIRMED.** Commit `dfd024d` (local HEAD, `git log --oneline -1`) includes `scripts/test.sh`; its
commit message pastes 514/0/3, independently reproduced by this audit's own re-run (§AC1).

### DoD2 — a real CI run (GitHub Actions, not local simulation) is green using the new script

**REFUTED.**
```
$ git log origin/master..HEAD --oneline
dfd024d M173/DIR-109: canonical test runner (scripts/test.sh) + in-file skip for live/conformance tests
4e92461 DIR-113: pre-screen task-level Touches orthogonality before charter-authoring
d9f5280 chore: reconcile directive status field with real dirStatus disposition
66647b4 fix: mirror gate-script-lib.sh into plugin/scripts/ — task-schema-check.sh was broken
6c655ba gap: file ABSORB charter/audit-file commit gap — root cause of the M144-M166 backlog
bfc5289 chore: sweep backlogged charter + audit files (M144-M166), dedupe M144 path
```
The commit that actually changes `.github/workflows/ci.yml` to invoke `scripts/test.sh` (`dfd024d`)
has **never been pushed to origin/master** — it and 5 others sit only in the local working copy.
```
$ gh run list --limit 5 --json databaseId,headSha,displayTitle,conclusion,createdAt
[{"conclusion":"success", "headSha":"54cdcabd...", "createdAt":"2026-07-26T11:55:37Z",
  "displayTitle":"ADR-019: test taxonomy is structural..."}, ...]
```
The most recent green CI run on GitHub Actions is against sha `54cdcab` — the earlier
documentation-only ADR-019 commit, which **predates and does not contain** the `ci.yml` change this
DoD item is about. No GitHub Actions run anywhere has ever exercised
`run: bash scripts/test.sh` from `ci.yml`. This is exactly the "real-landing, not asserted" bar
DIR-026 Reading A names (a script existing locally is necessary, not sufficient) — the mechanism
has not actually been operated through CI.

### DoD3 — `adr/ADR-019-...md`'s `enforcement` field updated to point at `scripts/test.sh`

**CONFIRMED.** Frontmatter: `enforcement: "bash scripts/test.sh"`.

### DoD4 — satisfies the standard DoD clauses in `inherited-core.md`'s DoD section (real-landing, not asserted)

**REFUTED as a real-landing whole**, for the two concrete reasons above (DoD2 unmet) plus the
mechanical-gate failure below. The task's own DoD section text does correctly carry the required
cross-reference sentence to `inherited-core.md` (avoiding the M160/M172-precedent clause-0
authoring-format gap), but that alone does not make the substance real-landed.

---

## 3. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-109 \
    experiments/quay-perpetual-stream/charters/M173-dir109-canonical-test-runner.md \
    /tmp/m173-absorb-entry.md
ERROR: absorb-entry-file has no "## Backlog row" section (required to run the impl-row clause
against a synthetic milestone)
EXIT_CODE=2
```

**Non-zero exit — REFUTED by construction (per this audit's charge).** Root cause: the
`/tmp/m173-absorb-entry.md` absorb-entry stub the outer loop drafted has no `## Backlog row`
section. This is the SAME recurring pre-existing absorb-entry-template infrastructure gap already
documented in dashboard.md deviation rows for M138 (line 454), M142 (461), M144 (466), M145 (470),
M148 (473), M151 (479), M165 (499), M168 (504) — not a DIR-109-specific implementation defect on its
own. However, combined with the genuine AC6 and DoD2 failures above, this task is not real-landed as
a whole.

---

## 4. Deviation-log write-back (DIR-017 Step 3)

3 new rows added to `dashboard.md`'s "Homeostatic variables" deviation table (all `caught-by:
machine`, this audit's own findings — no separate human-disclosed ABSORB-entry gap existed to
transcribe for this milestone, the absorb entry has no "Gate results" disclosure section):

1. REFUTED — mechanical gate exit 2 (absorb-entry `## Backlog row` gap, pre-existing infra pattern).
2. REFUTED — AC6 literal violation (`git grep` returns 9 hits, not empty).
3. REFUTED — DoD2 unmet (implementation commit unpushed; no real CI run exists against it).

## 5. Checklist write-back (DIR-020)

`tasks/DIR-109.md`: ticked `[x]` AC1-5 and DoD1/DoD3 with inline evidence citations; left AC6,
DoD2, DoD4 as `[ ]` (refuted/unconfirmable) with inline evidence citations explaining why.

---

## Summary

The implementation itself is substantively real and independently reproduced by this audit
(scripts/test.sh runs 514/0/3 with concurrency 8; all 3 files self-skip correctly; the opt-in path
was independently proven live against yaleh/quay; ci.yml and CLAUDE.md are genuinely updated). But
two concrete, non-cosmetic gaps stand between this and a real DoD pass: (a) the commit that
actually wires `ci.yml` to the new script has never been pushed, so DoD2's "real CI run is green
using the new script" is not just unproven but structurally impossible to have happened yet; and
(b) AC6's own literal text ("`git grep` returns empty") is false, 9 hits deep, including in the
task's own body. The mechanical gate independently exits non-zero (2), which this audit's charge
treats as REFUTED by construction. Net verdict: **REFUTED**.
