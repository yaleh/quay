---
id: gap-quay-self-hosting-e2e-proof
title: run quay:cold-start's AC8c six-key checklist end to end on quay's own
  repo and prove it self-certifies without a human — the capstone of quay
  self-hosting its own cold start
status: needs-human
parent: gap-quay-has-never-self-hosted-its-own-cold-start
depends_on:
  - gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted
  - gap-retire-inner-state-one-observer-targets-by-parameter
  - gap-cold-start-skill-has-no-recovery-branch
  - gap-no-formalized-bare-metal-session-bootstrap
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

Child of [[gap-quay-has-never-self-hosted-its-own-cold-start]] (SH4 in
`orchestration/SPEC-quay-self-hosts-its-own-cold-start.md`) — the capstone. **Do not dispatch
until all four of these have landed**: [[gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted]],
[[gap-retire-inner-state-one-observer-targets-by-parameter]],
[[gap-cold-start-skill-has-no-recovery-branch]],
[[gap-no-formalized-bare-metal-session-bootstrap]]. Running this before those four land would
just re-produce known-unreliable results on 2 of the 6 keys and leave 2 of the SPEC's 4 gaps
(recovery branch, session bootstrap) untested.

`CronList` returned empty at both of tonight's real recoveries — quay has never actually run its
own `quay:cold-start` skill on itself. Every other project this skill targets gets it as a
product; quay itself has always been bootstrapped by hand. This task is the proof that changes.

## Chosen mechanism

1. Tear down the current hand-built `quay-0` session state cleanly (document exactly what "clean"
   means — no silent partial teardown) so the run is genuinely from a comparable starting point,
   not "cold-start on top of an already-warm session"
2. Run `plugin/scripts/session-bootstrap.sh` (from the sibling child task) to build the tmux
   layout from bare metal
3. Run `quay:cold-start` for real against quay's own repo — no hand intervention, no "just this
   once let me fix it manually"
4. Report all six AC8c keys (`MONITORS-MOUNTED`, `MONITORS-DELIVERING`, `CRON-CREATED`,
   `INNER-DRIVEN`, `TELEMETRY-RECORD`, `FIRST-TASK`) as `true|false` with the required evidence
   for each, exactly as the skill's own step 8 specifies
5. Negative-control comparison against `docs/analysis/two-oom-recoveries-compared.md`'s real
   manual timeline from tonight — **the judgment criterion is NOT "this run was faster"**, it is
   **"did the six-key checklist self-certify without any human verification step"** (the SPEC is
   explicit on this point; do not substitute a speed claim for it)

**Not doing**: not running this proof for archguard or meta-cc in the same task — quay proving it
on itself is the SPEC's explicit first proof point, not a parallel rollout.

## Acceptance Criteria

- [ ] AC1: all six AC8c keys reported `true`, each with its required evidence (per
      `plugin/skills/cold-start/SKILL.md`'s own "Observable consequences" table), pasted verbatim
      into this task body
- [ ] AC2: the entire run required zero human-in-the-loop verification steps — if any step needed
      a human to confirm/unstick something, that is recorded honestly as a partial result, not
      silently smoothed over
- [ ] AC3: negative-control comparison against `docs/analysis/two-oom-recoveries-compared.md`
      written up, explicitly framed as "does it self-certify", not "is it faster"
- [ ] AC4: if any of the six keys comes back `false`, the task does NOT report success — it names
      exactly which key and routes back to whichever of the four prerequisite tasks owns that gap

## Definition of Done

- [ ] The six-key table (all `true`) pasted into this task body
- [ ] AC3's comparison write-up committed (as a doc, e.g.
      `docs/analysis/quay-self-cold-start-proof.md`, not just prose in this task body)
- [ ] Parent task [[gap-quay-has-never-self-hosted-its-own-cold-start]]'s own AC2/DoD table updated
      to point at this evidence

## Contract

measure   six_keys_true = `grep -c 'true' docs/analysis/quay-self-cold-start-proof.md` 输出的计数（六键表 true 行数）
band      six_keys_true = 6（六键全 true）
invariant self_certify = 1（无 human-in-the-loop 验证步——AC2）
invariant negative_control = 1（与 two-oom-recoveries-compared.md 手动时间线对照——AC3）
invoke    `bash scripts/test.sh --for-task gap-quay-self-hosting-e2e-proof`
control   六键表全 true 贴任务体；任一 false 路由回对应前置任务
resume    前置四任务全 done 后才 dispatch；证据 doc 落盘

## Touches

- plugin/skills/cold-start/SKILL.md
- docs/analysis/quay-self-cold-start-proof.md (new)
- tasks/gap-quay-self-hosting-e2e-proof.md（自身文件：self-touch，2026-08-10 outer 补——缺此条被 C8 拒派发，见 touches-orthogonality-check --self-touch-scan）

## Dispatch review

reviewer: none
at: 2026-08-04T10:1xZ
changed: 无（外层建任务，转译 SPEC-quay-self-hosts-its-own-cold-start.md 的 SH4；未经正式闸口审查）
