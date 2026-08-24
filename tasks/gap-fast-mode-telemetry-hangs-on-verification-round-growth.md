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

## Acceptance Criteria

- [ ] AC1（能取假，bounded 完成）：verification-round.jsonl 515 轮时 `--report` 在 N 秒内完成（⛔ >60s 仍挂 ⇒ 假）。
- [ ] AC2（能取假，snapshot 恢复）：`--snapshot` 恢复秒级完成（⛔ >30s 仍挂 ⇒ 假）。
- [ ] AC3（能取假，B1 恢复）：`closure-lag-check.sh --close-terminal` 恢复秒级返回（⛔ 仍挂 ⇒ 假）。

## Definition of Done

聚合优化或 verification-round 轮换落地 develop；AC1-3 全勾；515 轮下 --report/--snapshot 秒级完成（AC1/AC2）、B1 恢复（AC3）。

## Touches

- plugin/scripts/fast-mode-telemetry.ts（--report/--snapshot 聚合优化，或 verification-round 轮换）
- plugin/test/fast-mode-telemetry-gitignore.test.mjs（或对应测试）
- tasks/gap-fast-mode-telemetry-hangs-on-verification-round-growth.md（自身）