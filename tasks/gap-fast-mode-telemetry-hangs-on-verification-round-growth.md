---
id: gap-fast-mode-telemetry-hangs-on-verification-round-growth
title: fast-mode-telemetry --report/--snapshot 挂起（verification-round.jsonl
  2.7MB/515 轮）⇒ B1 close-terminal + B6 snapshot 断
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`fast-mode-telemetry.ts --report` 与 `--snapshot` 双双挂起（>60s / >30s timeout，exit 124/143），根因：`verification-round.jsonl` 增长到 2.7MB（515 轮）。这使 `closure-lag-check.sh --close-terminal`（B1，内部调 --report）挂起、`--snapshot`（B6）挂起、`--record`（B2）在其后断（同一条命令链 B1→B2→B6）。A10 读数（closure-lag 信号，读 `.quay/closure-pass-last-run.json` trace）仍秒级，故信号未完全断供，但收尾 pass 的三产出（B1/B2/B6）全断。**3 轮同形**（12:24/12:43/12:44 均挂）。

## Plan

优化 fast-mode-telemetry 的聚合（勿全量读 515 轮 perFile 做聚合，或缓存/增量），或给 verification-round.jsonl 加轮换/截断（bound 旧轮）。读宿主规模而非 O(轮数 × 文件数) 全量重算。

## Implementation

根因实测（非 verification-round.jsonl 文件本身，而是随轮数增长的**闭括号/已完成任务数**）：`loadAndAggregate` 里两处 O(已完成任务数) 的每任务昂贵探测——① `makeFirstKnownCommitMsByTask` 对每个 distinct taskId 起 1–2 个 git 子进程（`git log --all --merges --grep` 全仓库扫，~332 任务 ≈ 41s）；② `detectClosedButLive`→`makeDefaultExecutorPresent` 对每个闭括号各起一次 `git worktree list --porcelain` 子进程 + 全 `/proc` 扫（~380 闭括号 ≈ 10s）。合计 ~52s，把 `--report`/`--snapshot` 推出 60s/30s 超时。修法：两处都改为**一次宿主规模读数**——① `makeFirstKnownCommitMsByTask` 单次 `for-each-ref`（枚举活 task 分支，逐分支取首提交）+ 单次 `git log --all --merges`（按 `task/<id>` 建内存索引，取最新 merge）；② `makeDefaultExecutorPresent` 单次 `listWorktrees` 建分支集合 + 单次 `/proc` cmdline 快照。语义与逐任务 `firstKnownCommitMs`/`worktreeExists`/`processAlive` 逐字节等价（新测试钉死批处理工厂与逐任务参考值相等）。

## Acceptance Criteria

- [x] AC1（能取假，bounded 完成）：verification-round.jsonl 515 轮时 `--report` 在 10 秒内完成（实测 3.96s；⛔ >60s 仍挂 ⇒ 假）。
- [x] AC2（能取假，snapshot 恢复）：`--snapshot` 恢复秒级完成（实测 4.46s；⛔ >30s 仍挂 ⇒ 假）。
- [x] AC3（能取假，B1 恢复）：`closure-lag-check.sh --close-terminal` 恢复秒级返回（实测 11.97s，其中 ready-pool-check ~7s；⛔ 仍挂 ⇒ 假）。

## Definition of Done

聚合优化或 verification-round 轮换落地 develop；AC1-3 全勾；515 轮下 --report/--snapshot 秒级完成（AC1/AC2）、B1 恢复（AC3）。

## Touches

- plugin/scripts/fast-mode-telemetry.ts（--report/--snapshot 聚合优化，或 verification-round 轮换）
- plugin/test/fast-mode-telemetry.test.mjs（批处理工厂逐任务等价性测试）
- tasks/gap-fast-mode-telemetry-hangs-on-verification-round-growth.md（自身）