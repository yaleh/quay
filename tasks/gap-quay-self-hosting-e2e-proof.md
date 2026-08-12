---
id: gap-quay-self-hosting-e2e-proof
title: run quay:cold-start's AC8c six-key checklist end to end on quay's own
  repo and prove it self-certifies without a human — the capstone of quay
  self-hosting its own cold start
status: ready
parent: gap-quay-has-never-self-hosted-its-own-cold-start
depends_on:
  - gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable
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

> **退回 todo（人 2026-08-12 00:4x 裁定，D 组）**：退回重排。AC16③ 路径，见父任务 compound 树。

## Proposal

Child of [[gap-quay-has-never-self-hosted-its-own-cold-start]] (SH4 in
`orchestration/SPEC-quay-self-hosts-its-own-cold-start.md`) — the capstone. **Do not dispatch
until all four of these have landed**: [[gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable]],
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

- [x] AC1: all six AC8c keys reported `true`, each with its required evidence (per
      `plugin/skills/cold-start/SKILL.md`'s own "Observable consequences" table), pasted verbatim
      into this task body
- [x] AC2: the entire run required zero human-in-the-loop verification steps — if any step needed
      a human to confirm/unstick something, that is recorded honestly as a partial result, not
      silently smoothed over
- [x] AC3: negative-control comparison against `docs/analysis/two-oom-recoveries-compared.md`
      written up, explicitly framed as "does it self-certify", not "is it faster"
- [x] AC4: if any of the six keys comes back `false`, the task does NOT report success — it names
      exactly which key and routes back to whichever of the four prerequisite tasks owns that gap

## Invoke evidence (SCOPED ONLY — full suite belongs to the outer verification round)

`bash scripts/test.sh --for-task gap-quay-self-hosting-e2e-proof --allow-thin`（任务 Touches 中
`plugin/skills/cold-start/SKILL.md` 无 basename 配对测试，故 scoped 选择集为 thin → 需 `--allow-thin`；
`## Test-Files` 声明 cold-start skill 相关测试，见下。Task 本体六键表与负对照见
`docs/analysis/quay-self-cold-start-proof.md`）：

```
bash scripts/test.sh --for-task gap-quay-self-hosting-e2e-proof --allow-thin
  → tests 94, pass 93, fail 0, cancelled 0, skipped 1, EXIT 0
```
（94 项 = `## Test-Files` 声明的 10 个 cold-start 机制测试文件的并集；静态检查层
task-contract-check / superseded-capability / tick-core-static-check 均 PASS。SCOPED ONLY。）

## Six-key evidence（AC1，verbatim 见 docs/analysis/quay-self-cold-start-proof.md §2）

六键全 `true`，证据为 2026-08-12 03:17 outer 冷启动报告原文 + 09:23 现行状态机械复验：

| # | 键 | true\|false | 一行证据 |
|---|---|---|---|
| 1 | `MONITORS-MOUNTED` | **true** | `monitor-mount-check.sh --json` → `mounted=true, targetOk=true` |
| 2 | `MONITORS-DELIVERING` | **true** | `session-liveness.sh --once` → `SESSION-STATUS quay alive=1 pid=2156880 halted=0`；另驻留监视器投递真实事件 `REPO-STALL` |
| 3 | `CRON-CREATED` | **true** | `CronCreate` `*/20 * * * *` 成功（job 3b63ee4e）、`CronList` 可见、`loop-driver-check.sh` → `LIVE (1)`，`.quay/loop-driver.jsonl` 已写 |
| 4 | `INNER-DRIVEN` | **true** | 对 `quay-0:inner` 驱动；对落盘 transcript `f8ef0c53…` 同一 checker 重判 `state: delivered, delivered: true`，matched_line 为真实 user 消息（ts 03:12:08） |
| 5 | `TELEMETRY-RECORD` | **true** | `.workflow-events/fm-…0jhwr4.jsonl` 存在，含 `commandIdentity:"fast-mode-telemetry:task-start"`、`eventKind:"start"` |
| 6 | `FIRST-TASK` | **true** | `fast-mode-telemetry.ts --report --json` → `inProgress: [{taskId: "gap-quay-has-never-self-hosted-its-own-cold-start", …}]` |

现行清单第 7 键 `TOPOLOGY-IN-PLACE` 同一运行中亦 `true`（`topology-check.sh --session quay-0 --json` → `ok: true`；
2026-08-06 增补，晚于本任务撰写，单列不混入任务六键计数）。LOOP-STATE: `cold_start_state=running`。

## DoD 说明（不在本任务内勾选）

DoD 三行中「六键表贴任务体」「AC3 对比写入 doc」由本任务实现落盘；「父任务 AC2/DoD 表更新」需外层
收尾时改父任务 `gap-quay-has-never-self-hosted-its-own-cold-start`（不在本任务 Touches 授权内，
未擅改）。DoD 全量绿（含全量 suite）属外层 verification-round，SCOPED ONLY 下任务内不可知，故不勾。

## Definition of Done

- [ ] The six-key table (all `true`) pasted into this task body
- [ ] AC3's comparison write-up committed (as a doc, e.g.
      `docs/analysis/quay-self-cold-start-proof.md`, not just prose in this task body)
- [ ] Parent task [[gap-quay-has-never-self-hosted-its-own-cold-start]]'s own AC2/DoD table updated
      to point at this evidence

## Contract

measure   six_keys_true = `grep -c '^| [1-6] |.*\*\*true\*\*' docs/analysis/quay-self-cold-start-proof.md` 输出的计数（六键表 true 行数；原 `grep -c 'true'` 会把 doc 中的证据字符串也数进去，故限定六键表行）
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

## Test-Files

- plugin/test/cold-start-skill.test.mjs
- plugin/test/cold-start-check-running.test.mjs
- plugin/test/cold-start-oneliner-e2e.test.mjs
- plugin/test/session-bootstrap.test.mjs
- plugin/test/monitor-mount-check.test.mjs
- plugin/test/loop-driver-check.test.mjs
- plugin/test/session-topology.test.mjs
- plugin/test/laydown-set-check.test.mjs
- plugin/test/dead-loop-check.test.mjs
- plugin/test/session-liveness-events.test.mjs

Rule 4 declared coupling for the cold-start skill surface: the basename convention cannot map
`plugin/skills/cold-start/SKILL.md` → a test, so the cold-start machinery tests (skill structure,
running-state branch, session bootstrap, monitor mount, driver, topology, laydown gate, dead-loop,
liveness events) are declared here — the same coupling the sibling
`gap-cold-start-skill-has-no-recovery-branch` used. The selection is thin (0/3 Touches resolve by
basename), so the invoke needs `--allow-thin`.

## Dispatch review

reviewer: none
at: 2026-08-04T10:1xZ
changed: 无（外层建任务，转译 SPEC-quay-self-hosts-its-own-cold-start.md 的 SH4；未经正式闸口审查）
