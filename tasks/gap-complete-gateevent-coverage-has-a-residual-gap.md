---
id: gap-complete-gateevent-coverage-has-a-residual-gap
title: complete GateEvent 修复后覆盖率仅 74–94%——仍有约两成落地不写该事件，且偏差与「那天完成得少」同形
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

`gap-mechanical-fan-in-writes-no-complete-gateevent`（09-02 实现落地、09-04 翻 done）确实修好了
主路径。按天核对 `.quay/gate-events.jsonl` 的 `complete` 事件数 ÷ 同日 git `翻 … done` 落地数：

| 窗口 | 覆盖率 |
|---|---|
| 08-20 ~ 09-03（14 天） | **0%**（complete 事件为 0） |
| 09-04 起 | **74% – 100%** |

**但修复后并非 100%**：09-07 = 53%（47/89）、09-06 = 74%（37/50）、09-09 = 76%（54/71）、
09-11 = 75%（33/44）、09-08 = 86%（63/73）。即仍有约 6%–26% 的落地不写 `complete` 事件，
原因未定（可能另有一条落地路径，也可能写入失败被吞）。

**为什么值得单独立**：`complete` 事件是「完成数」的一个权威载体，覆盖率 74–94% 意味着
任何据它统计完成数的判据/看板会系统性少算 6–26%，而这个偏差本身不会发出声音——
与「那天确实完成得少」同形。

⚠️ 本条是上一次修复的**残留**，不是重复立案：形状已从「完全不写」变成「写但漏一部分」。
证据与按天读数见 `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §5 错误二 / §6。

## Touches

- `packages/quay/src/gate/gate-event-store.ts`
- `plugin/scripts/worker-driver.ts`
- `tasks/gap-mechanical-fan-in-writes-no-complete-gateevent.md`
- `tasks/gap-complete-gateevent-coverage-has-a-residual-gap.md`

## Acceptance Criteria

- [ ] 枚举**所有**会把任务翻 done 的路径（grep 命中数 + 前 3 条实际内容 + 文件:行号），
      逐条说明是否写 `complete` GateEvent；写不出这个清单视为只修了被报出来的那一条。
- [ ] 取一个具体的未写事件的落地实例（从某个覆盖率低的日子里挑，如 09-07），
      追出它走的是哪条路径，把结论写进任务体——**不接受「原因未知但已修」**。
- [ ] 补上遗漏路径后，连续 ≥3 天真实生产记录的覆盖率 ≥95%，读数与命令行贴进任务体；
      若某些落地按设计就不该写该事件，明确列为**已知例外**并说明判据。
- [ ] 覆盖率偏离可见：新增一条判据，当日覆盖率低于阈值时能报出来（当前无人盯），
      且该判据在修复前的数据上必须报红（贴出红的输出）。

## Definition of Done

覆盖率读数取自**生产载体**（`.quay/gate-events.jsonl` + `git log develop`），不接受 fixture；
把注入 seam 关掉后 AC 仍应成立。修复后必须经过 ≥3 天真实落地窗口再判完成
（硬规则 4 推论三：只在实现当轮验证等于没验证生产）。
