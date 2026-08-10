---
id: gap-suite-empty-wait-no-auto-retrigger
title: 套件空等无自动重触发——红窗总跨度 23.8h 里 suite 真跑 6.75h(51%)/空等 6.48h(49%)、~2h
  空洞(19:13→21:06)、develop 卡 9.3h(integration-only=162)、红窗停派纪律机制上不存在(slot-refill
  无 red 门,行为上红窗 fan-in 2.4×)；P3 比 P2(lane=8)大 4 倍；处方=轮终态后 N 分钟无新轮自动起跑+空洞检测
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**套件「空等」无自动重触发机制——红窗总跨度 23.8h 里 suite 真在跑 6.75h（51%）、空等 6.48h（49%），其中 19:13→21:06 有一个 2 小时完全没有轮在跑的空洞。红轮墙钟 92.8% 集中在整轮红（>400s），早红（<60s，19 轮）只占 1.4%。红的真实代价不是「停派」（该纪律机制上不存在），是 develop 被卡 + 空等时间白白流失。**

### 实证（manager 2026-08-10 逐行计数非抽样 + outer 复核）

- **红窗停派纪律机制上不存在**：ready-pool-check/slot-refill 读红窗只翻 blocking 改排序（busy-mask AC6 的 suite_blocking 机制），派发路径无 red 门；`slot-refill.ts` grep 无 suite-state 引用。行为上：红窗内 fan-in 4.08/h vs 绿窗 1.70/h——红窗里落地是绿窗的 **2.4 倍**。
- **红的真实代价不是停派，是 develop 被卡**：integration-only=162（integration 领先 develop 162 commits），develop 上次前进 15:47Z 已 **9.3 小时**。
- **空等量化**：红窗总跨度 13.23h/23.8h=56%，内部 suite 真在跑 6.75h（51%）、空等 6.48h（49%）；**19:13→21:06 有 ~2 小时完全没有轮在跑的空洞**（outer 复核：r196 结束 19:23 → r197 开始 21:06，gap 103.4min）。
- **红轮墙钟分布**：92.8% 集中在整轮红（>400s）；早红（<60s，19 轮）只占 1.4%。
- **lane 对照（勿当精确值）**：lane=8 同日（08-08）中位 783s（n=17）vs lane=4 1302s（n=2），全期 789 vs 1012，方向一致 −22%~−40%；但 tests 字段在 213/141/3092/3152 间跳、套件内容在变。
- **本任务范围**：空等无自动重触发——一轮红/绿结束且无下一轮启动时，没有任何机制自动起下一轮（依赖外层 tick 的 B3 手动判断）。空洞期（~2h）就是「红窗处置没跟上」时套件空转的代价。

**为什么重要**：P3 比 P2（lane=8）大 4 倍（6.48h vs ~1.6h 预期收益）——空等是纯浪费，自动重触发是零风险机械改进。今晚 6.48h 空等中哪怕一半能省下，红窗分诊的墙钟成本直接减半。

### 选定机制方向（实现归内层，接法留执行时）

1. **自动重触发**：suite 终态（red/green）后若 N 分钟（如 5-10min）无新轮启动，自动起下一轮——不依赖外层 tick 手动判断。机械判定：`verification-round.jsonl` 末轮 finishedAt + 无 `full-suite-state running`。
2. **空洞检测**：红轮结束后套件不再跑（state=red 且无 running）超过阈值 → 自动重触发（或至少触发外层信号）。
3. **不引入新竞态**：resource-gate 仍先行（C3）；与手动起跑互斥。

**验证锚**：修后 (a) 一轮终态后 N 分钟无新轮 → 自动起跑（实测）；(b) 空洞不再出现（连续多轮无 >30min 空洞）；(c) 手动起跑不受影响。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录量化（红窗 13.23h/56%、空等 6.48h/49%、~2h 空洞、develop 卡 9.3h、integration-only 162、红窗 fan-in 2.4×）（本任务 Proposal 已含）
- [ ] AC2: **自动重触发**——suite 终态后 N 分钟无新轮自动起下一轮（机械判定，不依赖外层 tick 手动）
- [ ] AC3: **空洞检测**——红轮结束无 running 超阈值 → 自动重触发或触发外层信号
- [ ] AC4: **竞态安全**——resource-gate 仍先行；与手动起跑互斥
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：一轮终态后自动起下一轮（贴任务体）；连续多轮无 >30min 空洞
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts 或套件调度（终态后 N 分钟无新轮自动起跑）
- plugin/scripts/verification-round.ts 或等价（终态时间戳读取）
- plugin/scripts/outer-tick-log-check.sh 或调度器（空洞检测信号）
- plugin/test/full-suite-runner.test.mjs（AC2-AC4 测试）
- tasks/gap-merge-green-snapshot-verified-commit-livelock.md（交叉标注——同族：套件轮调度）
- tasks/gap-phase-order-serial-lowconc-before-main.md（交叉标注——同族：套件轮时长/判红）
- tasks/gap-load-sensitive-serial-phase-unbounded-growth-measure-first.md（交叉标注——同族：轮时长）
- tasks/gap-suite-empty-wait-no-auto-retrigger.md（自身：勾 AC + 贴证据）

## Contract

measure   empty_wait_after_terminal = `python3 -c "import json;rs=[json.loads(l) for l in open('.quay/verification-round.jsonl') if l.strip()];print([ (r.get('round'), r.get('startedAt')) for r in rs[-6:] ])"` 的 stdout 中末轮终态后到下一轮启动的间隔分钟数
band      empty_wait_after_terminal = <= 10（自动重触发阈值内，无长空洞）
invariant no_race_with_manual_launch = 1（resource-gate 先行，与手动起跑互斥）
invariant no_new_race_conditions = 1（自动重触发不引入竞态）
invoke    `python3 -c "import json;[print(r['round'],r['state'],r['startedAt']) for r in json.loads(open('.quay/verification-round.jsonl').read().splitlines() and '['+','.join(open('.quay/verification-round.jsonl').read().splitlines())+']')]"`（终态-启动间隔分布贴回）
control   无 >30min 空洞；自动重触发在阈值内；竞态安全
resume    自动重触发 / 空洞检测分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager P3 裁定（空等 6.48h 比 P2 大 4 倍,我们两个都漏了）——红窗停派纪律机制上不存在（slot-refill 无 red 门）、空等 49%、~2h 空洞、develop 卡 9.3h。立案：套件终态后自动重触发 + 空洞检测。实现归内层
