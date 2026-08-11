---
id: gap-quay-has-never-self-hosted-its-own-cold-start
title: "quay should be able to start itself with its own shipped quay:cold-start skill, at the same formal-AC rigor as the skill promises other projects"
status: needs-human
role: compound
children:
  - gap-cold-start-skill-has-no-recovery-branch
  - gap-no-formalized-bare-metal-session-bootstrap
  - gap-quay-self-hosting-e2e-proof
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

Human direction (2026-08-04, relayed by the manager, written up as
`orchestration/SPEC-quay-self-hosts-its-own-cold-start.md` — read that file for the full
reasoning; this task operationalizes it as dispatchable board work, it does not duplicate its
prose): quay should be able to start *itself* using the same `quay:cold-start` skill it ships to
other projects, and that skill's determinism should be as formal as possible (AC clauses, not
prose).

**AC12b hard blockers (2026-08-05, manager-directed, cross-annotated from
[[gap-vendor-runtime-not-in-git-clone-broken-mcp-entry]] AC4 and
[[gap-send-keys-reliable-welcome-screen-ghost-drive-fails]] AC12b)**: this compound's cold-start
proof is blocked by two independent product hard-blockers, both dispatched ahead of it (status
`ready`, the ONLY blockers to the product metric):
1. `gap-send-keys-reliable-welcome-screen-ghost-drive-fails` — AC12b blocker #1 (blocks
   cold-start INNER-DRIVEN: fresh-session ghost text defeats the drive).
2. `gap-vendor-runtime-not-in-git-clone-broken-mcp-entry` — AC12b blocker #2 (blocks the WHOLE
   Provider ABI/MCP on a fresh clone: the gitignored vendored runtime is absent, so quay-init
   used to WARN-and-report-complete with an mcp_entry pointing at a nonexistent file — the task
   store is unreadable. This task's AC4 cross-annotates that blocker; the fix is fail-closed +
   auto-build-at-install in quay-init.sh).

**Reality check already done** (not assumed): `quay:cold-start`'s existing AC8c six-key checklist
(`MONITORS-MOUNTED` / `MONITORS-DELIVERING` / `CRON-CREATED` / `INNER-DRIVEN` /
`TELEMETRY-RECORD` / `FIRST-TASK`) is already solid — precise definitions, required evidence,
fail-closed preconditions. **This task does not rewrite that framework.** Four concrete gaps
surfaced by tonight's two real OOM-recovery cycles, all evidenced (not guessed):

1. `CronList` came back empty at both recoveries — quay has never actually run this skill on
   itself; both recoveries were 100% manual.
2. `monitor-mount-check.sh:31` still hardcodes a check against `inner-state.sh`, a mechanism
   this repo decided tonight to retire — the self-check instrument didn't keep up with its own
   target's retirement.
3. `send-keys-verified.sh` — the exact tool AC8c's `INNER-DRIVEN` key relies on to prove step 5
   — has a real, reproduced delivery-verification defect (already filed as
   [[gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted]]: it reported success
   while the target sat un-submitted for 20+ real seconds during tonight's actual inner-drive).
   `monitor-mount-check.sh:31`'s `MONITORS-MOUNTED` key also independently needs
   [[gap-retire-inner-state-one-observer-targets-by-parameter]] (already filed, status `todo`
   as of this writing — a real decision made tonight, not yet executed: `inner-state.sh`'s one
   irreplaceable signal, `.quay/inner-blocked.json`, never fired across all three projects
   including the night it was needed; observation consolidates onto `session-liveness.sh` alone,
   parameterized by target) to land before AC8c's six keys are checking a retired mechanism.
4. The skill only covers "brand new cold start" — it has no branch for "recovering after a
   crash" (mid-flight worktrees, ghost telemetry, task-status drift — exactly what both of
   tonight's recoveries had to hand-resolve) and no formalized step for "bootstrap the tmux
   session layout from bare metal" (tonight's manager/inner/outer windows were all hand-built).

## Chosen mechanism

Split into 3 new independently landable children (this repo's own split-decision routing policy:
`> 2` independently landable mechanisms → auto-record split, not a single task) plus two
already-independently-filed prerequisites (not children — they predate this parent and stand on
their own):

- **Prerequisites, must land first** (SPEC's own ordering: fixing the instruments before
  self-hosting proof is meaningful — 2 of AC8c's 6 keys currently verify against known-unreliable
  checks):
  - [[gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted]] (`INNER-DRIVEN` key)
  - [[gap-retire-inner-state-one-observer-targets-by-parameter]] (`MONITORS-MOUNTED` key —
    already a real, evidenced decision tonight, just not yet executed)
- **Then formalize the two missing preconditions** (can proceed in parallel with each other once
  the above land, per SPEC's "two branches share one AC8c" instruction):
  - `gap-cold-start-skill-has-no-recovery-branch` (SH1)
  - `gap-no-formalized-bare-metal-session-bootstrap` (SH2)
- **Capstone, depends on all four above**:
  - `gap-quay-self-hosting-e2e-proof` (SH4) — run the full six-key checklist end to end on
    quay's own repo, real evidence, negative-controlled against
    `docs/analysis/two-oom-recoveries-compared.md`'s manual timeline (judged on "does the
    checklist self-certify without human verification", not "is it faster")

**Not doing** (explicit SPEC exclusions): not generalizing this to archguard/meta-cc in the same
pass — quay proving it on itself is the first proof point, not a parallel rollout; not inventing
a second acceptance framework — AC8c is reused as-is by both the new recovery branch and the new
session-bootstrap step.

## Acceptance Criteria

- [ ] AC1: the 3 children + the 2 linked prerequisites all reach `done`, each with its own
      real-run evidence per its own task body — this parent does not restate their evidence
- [ ] AC2: `gap-quay-self-hosting-e2e-proof`'s six-key checklist, run for real on quay's own repo,
      is `true` on all six keys without any human-in-the-loop verification step
- [ ] AC3: dispatched in dependency order — the 2 prerequisites land before the SH4 capstone
      attempts to rely on them — verified by merge-commit ordering in `git log`, not asserted

## Definition of Done

- [ ] The 3 children + the 2 linked prerequisites are all `status: done`
- [ ] `gap-quay-self-hosting-e2e-proof`'s six-key table (all `true`) pasted into this task body

## Contract

measure   children_done = `grep -l '^status: done' tasks/gap-cold-start-skill-has-no-recovery-branch.md tasks/gap-no-formalized-bare-metal-session-bootstrap.md tasks/gap-quay-self-hosting-e2e-proof.md | wc -l` 输出的计数
band      children_done = 3（三个 child 全部 done）
invariant deps_landed = 1（两个 prerequisite：gap-send-keys-verified... 与 gap-retire-inner-state... 已 done）
invariant capstone_self_certify = 1（SH4 六键表全 true，无 human-in-the-loop）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root . --json`
control   ready-pool 该 parent 可晋（fourArtifacts complete + deps ready）；六键表贴任务体
resume    依赖顺序按 SPEC 落；capstone 最后

## Touches

(compound task — see each child's own `## Touches`)

## Dispatch review

reviewer: none
at: 2026-08-04T10:1xZ
changed: 无（外层建任务，转译人/管理者给出的规格；未经正式闸口审查——`reviewer: none` 是被记录的选择）
> **needs-human reason（B15 judge wf_59513f29-b3c, 2026-08-11）**: 非 as-is 可完成——2 个 children 仍 todo、capstone child 是 needs-human。先驱动 children（gap-cold-start-skill-has-no-recovery-branch / gap-no-formalized-bare-metal-session-bootstrap）到 done，本 umbrella 才可完成；现在派发浪费 agent 轮。
