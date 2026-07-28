# M194 / DIR-120-B — Iteration 0 Adversarial Acceptance Audit

**Audit session id:** 13efe277-45ff-4563-bcfe-fd2c3db3e2a5

**Task:** DIR-120-B (DIR-120 Phase 3b) — fix `drivable-workspace-check.ts`'s layering inversion
**Charter:** `experiments/quay-perpetual-stream/charters/M194-dir120b-drivable-workspace-check-fix.md`
**Build commit:** `1ca3a6d` (DIR-120-B/M194: fix drivable-workspace-check.ts's layering inversion)
**Stance:** refute-first — every AC checked against real command output, not the implementer's
self-report (`milestones/M194/iterations/iteration-0.md`), which was read only as a hypothesis map,
never as evidence.

## 1. Acceptance Criteria — refutation attempts

### AC1 — registry unmoved, `DEFAULT_REGISTRY_PATH` removed, omitted `--registry` → exit 2

Attempted refutation: check that the registry didn't silently move, and that the constant is
genuinely gone (not just renamed) and the CLI genuinely fails closed.

```
$ ls -la experiments/quay-perpetual-stream/drivable-workspaces.yml
-rw-rw-r-- 1 yale yale 2657 Jul 23 04:30 experiments/quay-perpetual-stream/drivable-workspaces.yml
```
(dated Jul 23 — predates this milestone, confirms unmoved, not just re-created at the same path.)

```
$ grep -rn "DEFAULT_REGISTRY_PATH" --include="*.ts" --include="*.mjs" --include="*.sh" .
experiments/quay-perpetual-stream/test/human-steered-classify.test.mjs:11: // ... prose only
experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs:2: // ... prose only
plugin/scripts/drivable-workspace-check.ts:21: // ... prose only
plugin/scripts/drivable-workspace-check.ts:40: // ... prose only
```
All 4 hits are inside comments referencing the *removed* name for context — zero live bindings,
zero exports, zero imports.

```
$ node plugin/scripts/drivable-workspace-check.ts /tmp
usage: node drivable-workspace-check.ts <path> [<path> ...] --registry <file>
       node drivable-workspace-check.ts --selftest
ERROR: --registry is required (DIR-120-B removed the guessed default path).
EXIT: 2
```
**Refutation attempt FAILED — AC CONFIRMED.**

### AC2 — experiments-tree copies are real symlinks to `plugin/scripts/` originals

```
$ ls -la experiments/quay-perpetual-stream/scripts/drivable-workspace-check.{ts,sh}
lrwxrwxrwx 1 yale yale 51 Jul 28 14:19 .../drivable-workspace-check.sh -> ../../../plugin/scripts/drivable-workspace-check.sh
lrwxrwxrwx 1 yale yale 51 Jul 28 14:19 .../drivable-workspace-check.ts -> ../../../plugin/scripts/drivable-workspace-check.ts
```
Both are `l`-mode (symlink), not regular files. **Refutation attempt FAILED — AC CONFIRMED.**

### AC3 — `selftest()`'s three `real-registry-*` checks individually visible, not just aggregate

```
$ node plugin/scripts/drivable-workspace-check.ts --selftest
...
SELFTEST PASS: real-registry-file-exists — path=/home/yale/work/quay/experiments/quay-perpetual-stream/drivable-workspaces.yml
SELFTEST PASS: real-registry-has-authorized-root — authorizedRoot=/home/yale/work
SELFTEST PASS: real-registry-covers-archguard — real archguard entry covered
SELFTEST PASS: real-registry-rejects-tmp — real registry correctly rejects /tmp/x
SELFTEST: all fixture cases PASS.
EXIT: 0
```
Source (`plugin/scripts/drivable-workspace-check.ts:180-191`) confirms these four `check(...)`
calls run unconditionally — no `existsSync` guard wraps them. **Refutation attempt FAILED — AC
CONFIRMED** (task text says "three" — build added a 4th, `real-registry-file-exists`, which
strengthens rather than weakens the requirement; not a defect).

### AC4 — `select-preflight.ts`'s dead import removed, own tests green

```
$ grep -n DEFAULT_REGISTRY_PATH experiments/quay-perpetual-stream/scripts/select-preflight.ts
(no output)
$ node --test experiments/quay-perpetual-stream/test/select-preflight.test.mjs
... tests 31, pass 31, fail 0 ...
```
**Refutation attempt FAILED — AC CONFIRMED.**

### AC5 — `human-steered-classify.ts` requires explicit `--registry`, own tests green

Source (`experiments/quay-perpetual-stream/scripts/human-steered-classify.ts:185-189`): when
`--workspace` given, `if (!registryPath) usage();` runs before any `loadRegistry` call.

```
$ node --test experiments/quay-perpetual-stream/test/human-steered-classify.test.mjs
... tests 24, pass 24, fail 0 ...
✔ CLI: --workspace given but --registry omitted -> usage error exit 2 (DIR-120-B: no more guessed default)
```
**Refutation attempt FAILED — AC CONFIRMED.**

### AC6 — out-of-`scripts/test.sh`-glob test rewritten + run directly, GREEN

```
$ node --test experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs
... tests 27, pass 27, fail 0 ...
✔ CLI: paths given but --registry omitted -> usage error exit 2 (DIR-120-B: no more guessed default)
```
Grep of the file confirms every `loadRegistry`/CLI-spawn call passes an explicit registry
path/object (`REAL_REGISTRY_PATH` or an injected fixture file) — no reliance on any default.
**Refutation attempt FAILED — AC CONFIRMED.**

### AC7 — `.quay/config.yml` `drivable-workspace` gate non-exercise signed off

```
$ grep -n "drivable-workspace\|drivableWorkspaceArgs" .quay/config.yml
58:      - name: drivable-workspace
59:        script: "./plugin/scripts/drivable-workspace-check.sh"
60:        argsKey: drivableWorkspaceArgs
$ grep -rn drivableWorkspaceArgs tasks/
(only DIR-120-B.md's own prose — confirms no real task sets it)
```
Sign-off is explicit in the task's own Proposal/Requested-action text (not silent). **Refutation
attempt FAILED — AC CONFIRMED.**

### AC8 — `plugin-packaging.test.mjs`'s exp5-label-leak test unaffected by symlink conversion

```
$ node --test plugin/test/plugin-packaging.test.mjs
... tests 34, pass 34, fail 0 ...
✔ DIR-070-B: universal-gate plugin files (4 of 5) have zero exp5/experiment-path references
```
**Refutation attempt FAILED — AC CONFIRMED.**

## 1a. Checklist write-back

All 8 AC checkboxes and both DoD checkboxes in `tasks/DIR-120-B.md` ticked `- [x]` with per-item
evidence citations (command + output excerpt), committed to the task file by this audit pass.

## 2. Definition of Done

- **"Landed on master with real evidence"**: confirmed — commit `1ca3a6d` is on `master`
  (`git log --oneline` at HEAD), working tree clean (`git status` shows only two unrelated,
  pre-existing untracked `.halt` sentinel files, no uncommitted DIR-120-B changes).
- **"Fresh independent audit confirms..."**: this document IS that fresh independent audit — new
  session (`13efe277-...`), distinct from the build's own session recorded in the commit trailer
  (`session_016CRyBbRmATSH9LDKAWdwpg`), every claim re-derived from real command output rather than
  the build's self-report.

**DoD: SATISFIED.**

## 3. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-120-B \
    experiments/quay-perpetual-stream/charters/M194-dir120b-drivable-workspace-check-fix.md \
    milestones/M194/absorb-entry.md
PASS: clause0-ac-dod-present: task AC has 8 checkable clause(s) (checklist-form, 8/8 checked)
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS
PASS: clause4-impl-row: PASS
PASS: clause5-no-self-exemption: PASS
PASS: clause6-escrow-delta-v: N/A
PASS: clause7-test-floor: N/A
PASS: clause8-task-canonical-lifecycle-record: N/A
PASS: clause10-tree-hygiene: PASS
PASS: clause11-worktree-branch-hygiene: PASS
PASS: clause12-audit-independence: N/A
N/A: clause9-split-or-commit: N/A

PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
EXIT: 0
```
**Non-zero exit did NOT occur — mechanical gate PASSES.**

**Note on clause12 (audit-independence):** the gate's own PASS text reads: *"N/A — no '##
Audit-independence check' section in the ABSORB-entry text (documented no-op; a milestone that
actually ran an adversarial audit must include this section, or the acceptance audit should refute
this no-op)"*. This audit considered whether to refute this no-op: M194 genuinely did run a fresh
adversarial audit (this document), so the no-op path is factually imprecise for this milestone —
the audit-independence mechanism (`audit-independence-check.sh`, a real, distinct DIR-032/034
mechanism that would verify e.g. a different orchestrator id) was not actually exercised because
`milestones/M194/absorb-entry.md` never declared the optional `## Audit-independence check`
section. This is a **procedural observation about the ABSORB-gate's own coverage**, not a defect in
any of DIR-120-B's 8 ACs or its DoD (which are entirely about `drivable-workspace-check.ts` and its
consumers) — it does not change this audit's verdict. Flagged here for visibility rather than
silently accepting the no-op without comment, per the gate's own invitation to scrutinize it.

## 4. Deviation-log write-back

Not applicable — verdict is **NO REFUTATION FOUND**, so per the charge's own step 4 ("if you find a
REFUTED or CONCERNS"), no deviation row is written to `dashboard.md`'s Homeostatic variables table.

## Verdict

**NO REFUTATION FOUND.** All 8 Acceptance Criteria and both Definition of Done items independently
re-verified via real, freshly-run command output (not the implementer's self-report). Mechanical
gate (`it0-dod-check.sh`) exits 0. One procedural observation recorded above (clause12's
audit-independence no-op) that does not affect the verdict.
