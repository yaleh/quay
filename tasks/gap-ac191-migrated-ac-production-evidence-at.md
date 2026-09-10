---
id: gap-ac191-migrated-ac-production-evidence-at
title: 验证三条迁移 goal AC（AC-192/193/194）在生产轮记录里有 evidence.at 且晚于各自落地提交——AC-191 判据 exit 0
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac188-three-long-term-guarantee-goal-acs
goal_ac: AC-191
---
## Proposal

正本：`goals/AC-191-goal-ac-evidence-at.md`（判据）+ `goals/GOAL-007-done-fixture.md`（三例原文）。

AC-191 判据当前取假（2026-09-07 干跑：迁移 AC `0/3`，exit 1）——因 AC-192/193/194 尚未被
`gap-ac188-three-long-term-guarantee-goal-acs`（ready）建出。人已裁定方向【丁：不修，上移 goal 层】
（AC-191 origin 逐字）：三条迁移 AC 写进 `goals/` 后，必须被 goal-driver 在生产上真正评估过。
AC-188 只查「存在」不查「跑过」，而「写进 goals/ 却从未被评估」（停在 draft / criterion 写错导致
恒 not-evaluated）正是丁 的同款失败（硬规则④推论三：只能被 fixture 满足的判据不是测量）。

范围边界（AC-191 origin 已划清）：本任务只交付【三条迁移 AC 各有一条真实生产 GateEvent，且
`evidence.at` 晚于其 `goals/` 文件首次提交、`evidence.verdict` 非空】。不建 AC-192/193/194
（那是 AC-188 已立任务 `gap-ac188-three-long-term-guarantee-goal-acs`）、不写 SPEC（AC-189）、
不建检测器（AC-190）、不处理 achieved-but-failing（已有 handler）。

## Plan

1. 依赖 `gap-ac188-three-long-term-guarantee-goal-acs` 落地（`depends_on`）：三条迁移 AC
   （AC-192/193/194）已存在于 `goal-store list`——kind=criterion、goal=GOAL-007、
   status ∈ {active, achieved}、criterion 非空 ≥20 字符、origin 点名对应来源 task id。
2. 读生产载体（主检出，⛔ 非任务 worktree——worktree 的 `.quay/gate-events.jsonl` 是陈旧快照，
   硬规则 4b）：`node packages/quay/src/goal-store.ts list --root <主检出>`，取 AC-192/193/194 的
   `evidence.at` / `evidence.verdict`（evidence 是账本派生，读 `.quay/gate-events.jsonl` 的
   `gate:"goal"` 末条事件，非 `goals/*.md` 存储字段）。
3. 逐条取 `born` = `git log --diff-filter=A --format=%ct -1 -- goals/<file>`，核
   `evidence.at > born` 且 `evidence.verdict` 非空。
4. 若某条缺 post-landing evidence（恒 not-evaluated / 无 GateEvent）：诊断并修——criterion 写错 ⇒
   修 `goals/AC-19X-*.md` 的 criterion；driver halt ⇒ resume；status=draft ⇒ 按裁定 3 升级人
   （激活归人，driver 不碰）。
5. 跑 AC-191 判据逐字 → exit 0，贴出输出与三条的 born / evidence.at / verdict 读数。

## AC

- [x] AC-191 判据 exit 0（逐字跑 `goals/AC-191-goal-ac-evidence-at.md` 的 criterion，贴输出，⛔ 非转述）
- [x] `mig` 集 3/3：`goal-store list` 里 AC-192/193/194 三条各 kind=criterion、goal=GOAL-007、status ∈ {active, achieved}、criterion ≥20 字符、origin 点名来源 task id
- [x] 三条各 `evidence.at > born` 且 `evidence.verdict` 非空——读主检出生产载体（`.quay/gate-events.jsonl` / `goal-store list`），⛔ 非断言、非 fixture
- [x] 可证伪性（硬规则④）：立案时 AC-191 判据实测 `0/3`、exit 1（origin 已干跑记录），完成后 exit 0——前后读数不同，排除恒真
- [x] 载体读的是主检出而非任务 worktree（worktree `.quay` 是陈旧快照，硬规则 4b）
- [x] `node packages/quay/bin/quay.ts task check gap-ac191-migrated-ac-production-evidence-at --json` 的 `missing` 为 `[]`

## DoD

`goals/AC-191-goal-ac-evidence-at.md` 判据在生产工作树上 exit 0——三条迁移 AC 各有一条真实
goal-driver GateEvent（verdict pass|fail），其时间戳严格晚于各自 `goals/` 文件首次提交，只计
落地之后时间窗。仅「文件存在」而无 post-landing evidence、或读数来自任务 worktree 的陈旧 `.quay`
快照、或靠 fixture 注入满足 ⇒ 不算完成。

## Touches

- tasks/gap-ac191-migrated-ac-production-evidence-at.md
- goals/AC-192-ff-retry-counter-per-cycle.md
- goals/AC-193-no-orphan-suite-process.md
- goals/AC-194-no-direct-to-develop-bypass.md

## Verification

2026-09-07 生产轮干跑（主检出 `/home/yale/work/quay`，⛔ 非任务 worktree 陈旧快照）：

AC-191 判据逐字输出（exit 0）：
  AC-192 born=1788800841 evidence.at=2026-09-07T18:21:59.224Z OK
  AC-193 born=1788800857 evidence.at=2026-09-07T18:21:59.948Z OK
  AC-194 born=1788800868 evidence.at=2026-09-07T18:22:01.148Z OK

三条 verdict（goal-store 账本派生，读主检出 `.quay/gate-events.jsonl`）：
  AC-192 status=active verdict=fail、AC-193 status=achieved verdict=pass、AC-194 status=active verdict=fail。
born 换算（git log --diff-filter=A 首次提交）：AC-192=2026-09-07T17:07:21Z、AC-193=2026-09-07T17:07:37Z、AC-194=2026-09-07T17:07:48Z——各 evidence.at 严格晚于 born（约 1h14m–1h15m）。
fail 是 GOAL-007 抓到的真缺陷（ff retry 跨任务累计 / direct-to-develop bypass），非本任务范围；AC-191 只要求 verdict 非空。