---
id: gap-ci-red-task-contract-violations-nonblocking
title: task-contract-check 的四份任务文件契约行 VIOLATION（--no-block 记账，未阻断 CI，跟进修）
status: done
labels:
  - gap
  - ci-red
  - task-store
  - follow-up
parent: null
children: []
extra: {}
---
## Proposal

`plugin/scripts/task-contract-check.ts`（run_static_checks 里以 `--no-block` 运行，见
`runner-static-gate.ts:227`）在 develop 静态相位打印多行真实 VIOLATION，均不阻断 CI（--no-block 只记账
到 `.quay/task-file-violation-ledger.jsonl`），但属于真实任务文件契约缺陷：
- `tasks/T-903-drill.md` — contract-line-unknown（## Contract 里一段散文）+ dispatch-review-missing。
- `tasks/gap-ci-runner-container-needs-user-systemd.md` — 多条 contract-line-unknown（散文/```/列表）
  + dispatch-review-missing。
- `tasks/gap-cli-lanes-json-verb-for-gantt-consumers.md` — contract-line-unknown + 两条
  contract-measure-no-name + invoke-evidence-missing。
- `tasks/gap-ac264-quay-fleet-project-scope-plugin-only-deployment.md` — invoke-evidence-missing。

## Plan

逐文件按 task-contract-check 的契约修：## Contract 每行必须以 measure|band|invariant|invoke|control|
resume 之一开头（散文移出 Contract 段或改写为契约行）；measure/band 行补 NAME；补 `## Dispatch review`
段；done 任务的 invoke 行补可执行入口路径。全部经 task_write（ABI）整份正文替换，写后逐段 diff。

## Finding（范围更正：立案时的「四份」是欠计）

⛔ **立案清单不是全量**。开工实测（2026-10-27，develop tip `2708b1acf`）`task-contract-check.ts --root .`
（默认模式，无 `--no-block`）的读数是 **exit 1 / 26 unique VIOLATION 跨 15 个任务文件**，而立案时只点名了
4 个。多出的 11 个全部是**先于本任务立案**就存在的存量（逐文件 `git log -1` 的最后提交日期均早于
2026-10-27），不是本轮新引入的。

⇒ 按 AC 的字面判据（「零 VIOLATION，exit 0」）与硬规则 5b（修好被报出来的那一个 ≠ 只有那一个），
本轮把 **15 个文件 / 26 条 unique VIOLATION 全部清掉**，而不是只修点名的 4 个——只修 4 个的话 AC 仍然
取不到 exit 0（实测中间态：清掉 4 个后剩 17 unique / 11 文件）。

## AC

- [x] `docs/analysis/contract-violations.md` 的 shrink-only 棘轮列表收缩到 **0 条**（`--write-ratchet` 写入，
      `baseline-count: 6` 的 ceiling 保留），使这轮修复被棘轮锁住、不会静默回涨。
- [x] `task-contract-check.ts --root <repo>` 无 --no-block 时 exit 0（零 VIOLATION）。

## DoD

四份任务文件的 VIOLATION 清空后，task-contract-check 的默认模式（无 --no-block）exit 0；
`git log` 里可见对应的 task_write 提交。

（范围更正见 `## Finding`：实际清空的是 15 个文件 / 26 条 unique VIOLATION。）

该轴仍暗,理由:纯任务文件正文修复，不改动 L_D/L_G 依赖结构，本次提交未记录读数

## Evidence

**AC1 — 棘轮收缩到 0**（在任务 worktree 里跑，root = 该 worktree）：

```
$ node --experimental-strip-types plugin/scripts/task-contract-check.ts --root "$WT" --write-ratchet
task-contract-check: no violations.
violations: 0 unique across 0 task(s); info findings (non-ratchet, pre-opt-in baseline): 5179
ratchet ceiling: 6; new since baseline: 0; resolved: 6
write: ratchet list written (0 entry/entries; ceiling 6)
exit=0
```

`git diff docs/analysis/contract-violations.md` = 删掉 6 行条目、保留 11 行头注释与 `# baseline-count: 6`
（shrink-only 未被绕过：`--reset-baseline` 未使用）。

**AC2 — 默认模式 exit 0 / 零 VIOLATION**：

```
$ node --experimental-strip-types plugin/scripts/task-contract-check.ts --root .    # 主检出，修复前
VIOLATION: ... ×84 行 ...
violations: 26 unique across 15 task(s); info findings: 5167
ratchet ceiling: 6; new since baseline: 26
exit=1

$ node --experimental-strip-types plugin/scripts/task-contract-check.ts --root "$WT"   # 修复后
task-contract-check: no violations.
violations: 0 unique across 0 task(s); info findings (non-ratchet, pre-opt-in baseline): 5179
ratchet ceiling: 6; new since baseline: 0; resolved: 6
exit=0
```

**逐文件处置（15 个文件，每条的 violation code 与修法）**：

| 任务文件 | 原 violation | 修法 |
|---|---|---|
| T-903-drill | contract-line-unknown, dispatch-review-missing | `## Contract` 散文段改名为 `## Purpose`（本任务无可机读契约） |
| gap-goal902-drill-catchup-landing | contract-line-unknown ×2, dispatch-review-missing | 同上，改名为 `## 演练目的与结果` |
| gap-goal-branch-catchup-blocked-by-antidrift-baseline-mismatch | contract-line-unknown ×18, dispatch-review-missing | 同上，改名为 `## 被阻塞的机制与实测读数` |
| gap-mirror-full-suite-state-retire-dead-cli-face | contract-line-unknown ×13, dispatch-review-missing | 同上，改名为 `## 判别式与处置` |
| gap-mirror-measure-history-retire-dead-writer | contract-line-unknown ×10, dispatch-review-missing | 同上，改名为 `## 退役范围与不在范围` |
| gap-mirror-mechanical-fanin-fail-open-posture-undocumented | contract-line-unknown ×7, dispatch-review-missing | 同上，改名为 `## 说明的内容要求` |
| gap-ci-runner-container-needs-user-systemd | contract-line-unknown ×4, dispatch-review-missing | 保留围栏内六键契约；围栏外散文移入 `## 约束（契约外说明）`；`measure serve_scope_envelope_exit:` → `= `；补 `## Dispatch review` |
| gap-cli-lanes-json-verb-for-gantt-consumers | contract-line-unknown, contract-measure-no-name ×2, invoke-evidence-missing, dispatch-review-missing | `measure`/`band` 的 `:` → `=`；「不变式」散文移入 `## 契约外说明`；该段补入口路径 `packages/quay/bin/quay.js`；补 `## Dispatch review` |
| gap-dist-plugin-invoker-rewrite-emits-unresolvable-plugin-paths | measure-no-command ×3, dispatch-review-missing | 三条 measure 补真正的生产者命令 `python3 .quay/ac260-scan.py dist-plugin`；补 `## Dispatch review` |
| gap-ac264-quay-fleet-project-scope-plugin-only-deployment | invoke-evidence-missing | Evidence 段补记入口路径 `plugin/scripts/goal-driver.ts` |
| gap-dashboard-live-swimlane-fixed-lane-gantt-timeline | wiring-claim-ac-no-probe | AC3 补真实输入探针（真实 `.quay/worker-outcome.jsonl` 经 `readWorkerOutcomeRecords` + 真实 `readLive()` 渲染后的计数） |
| gap-design-evolution-share-caliber-net-vs-additions | wiring-claim-ac-no-probe | AC5 补真实输入（实体 `.ts` 源文件；`grep … plugin/scripts/design-evolution-readings.ts`） |
| gap-driver-cli-help-hides-four-of-six-kinds | wiring-claim-ac-no-probe | AC2 补真实输入（`packages/quay/src/cli/driver.ts` / `help.ts` 实体文件） |
| gap-fan-in-suite-red-attribution-has-no-control-measure-first | wiring-claim-ac-no-probe | AC2 补真实输入（`.quay/verification-round.jsonl` / `.quay/fan-in-suite-*.log` 的生产载体序列） |
| gap-promotion-admission-reads-goal-layer-field | wiring-claim-ac-no-probe | AC1 补真实输入（`git show <pre-fix-sha>:plugin/scripts/ready-pool-check.ts` 的实读样本） |

⚠️ **`wiring-claim-ac-no-probe` 这一族不是「补个词」**：五条的原文本来就只写「贴命中数/计数」而没说输入是什么；
补的是**它实际读的那个真实载体**（源文件 / 生产 jsonl / 生产日志），不是把 `真实` 二字插进句子。

**写入路径**：全部经 Provider ABI 整份正文替换（`task_write` MCP / `quay-native task edit --body`，同一
`store.write` + `commitTaskWrite` 分支感知提交），⛔ 未手编辑 `tasks/*.md`；每条都是 `changeKind=must-propagate`
（`body` 段改动）⇒ 逐条落 `author` 并 ff 进 `develop`，`git log develop` 可见 15 条 `task_write by cli:*` 提交。

## Dispatch review

reviewer: none
at: 2026-10-27T17:40:00+08:00
changed: 本轮（worker）把 26 条 unique VIOLATION 跨 15 个任务文件全部清零并把棘轮收缩到 0；同时把原本是占位文的 AC1（「本任务为跟进记录，尚未修」——该句在修复后已为假）替换为可验证的棘轮收缩判据。⛔ AC2（用户给定的「零 VIOLATION / exit 0」）原文未动。

## Touches

- tasks/gap-ci-red-task-contract-violations-nonblocking.md（自身：勾 AC + 贴证据）
- tasks/T-903-drill.md（清除 contract-line-unknown + dispatch-review-missing）
- tasks/gap-ci-runner-container-needs-user-systemd.md（同上 + measure NAME 修正）
- tasks/gap-cli-lanes-json-verb-for-gantt-consumers.md（同上 + measure/band NAME + invoke 证据）
- tasks/gap-ac264-quay-fleet-project-scope-plugin-only-deployment.md（invoke-evidence-missing）
- tasks/gap-dist-plugin-invoker-rewrite-emits-unresolvable-plugin-paths.md（measure-no-command ×3 + dispatch review）
- tasks/gap-goal-branch-catchup-blocked-by-antidrift-baseline-mismatch.md（contract-line-unknown ×18 + dispatch review）
- tasks/gap-goal902-drill-catchup-landing.md（contract-line-unknown ×2 + dispatch review）
- tasks/gap-mirror-full-suite-state-retire-dead-cli-face.md（contract-line-unknown ×13 + dispatch review）
- tasks/gap-mirror-measure-history-retire-dead-writer.md（contract-line-unknown ×10 + dispatch review）
- tasks/gap-mirror-mechanical-fanin-fail-open-posture-undocumented.md（contract-line-unknown ×7 + dispatch review）
- tasks/gap-dashboard-live-swimlane-fixed-lane-gantt-timeline.md（wiring-claim-ac-no-probe）
- tasks/gap-design-evolution-share-caliber-net-vs-additions.md（wiring-claim-ac-no-probe）
- tasks/gap-driver-cli-help-hides-four-of-six-kinds.md（wiring-claim-ac-no-probe）
- tasks/gap-fan-in-suite-red-attribution-has-no-control-measure-first.md（wiring-claim-ac-no-probe）
- tasks/gap-promotion-admission-reads-goal-layer-field.md（wiring-claim-ac-no-probe）
- docs/analysis/contract-violations.md（shrink-only 棘轮收缩到 0 条）
