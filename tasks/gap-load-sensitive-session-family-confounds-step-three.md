---
id: gap-load-sensitive-session-family-confounds-step-three
title: the load-sensitive session-liveness family directly conflicts with step
  3's 2-concurrent-suite relaxation — judging relaxation vs amplified timing
  sensitivity becomes impossible
status: ready
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**第三步（把重活令牌从单飞放宽到两个并发套件，= 负载翻倍）与一族已知负载敏感的测试直接冲突。**

2026-08-04 全量套件 #6/#7 各挂了一条**不同但同族**的测试：
#6 挂 `cold-start-skill` 的 rehearsal 与 `session-liveness` 的 AC3/AC7；#7 挂 `session-liveness`
的 AC6/AC7（RESUMED，跑了 29.9 秒像是超时）与 M2/M4（挂载 NO-OP，进程计数 3）。这族测试
（session-liveness 挂载语义、cold-start 演练、laid-down script --once）全部依赖**真实进程与
tmux 时序**，负载一高就红。隔离下单独跑全部通过——**确认是并发敏感，不是逻辑错误**。

**负载敏感本身不新鲜。新的是它与第三步直接冲突**：第三步要把负载翻倍。放宽后这一族会
更频繁地红，而判读会失效——**分不清「并发放宽暴露了真问题」还是「只是把已知的时序敏感
放大了」**。这两种情况的处置完全不同：前者要修代码，后者只需要标注并单独跑。

**⇒ 第三步起跑之前，这一族要么被稳定化，要么被明确标注为已知负载敏感并单独跑。**

## Contract

```
measure family_failures = `grep -E '^✖' <full-suite-log> | grep -cE 'session-liveness|cold-start|laid-down|RESUMED|NO-OP'` 输出的行数字段
measure load_one_isolated = `node --test plugin/test/session-liveness.test.mjs plugin/test/cold-start-skill.test.mjs 2>&1 | grep -c '^not ok'` 输出的计数字段
band family_failures = 0
band load_one_isolated = 0
invariant 该族测试必须在低负载（单套件）下全绿；其负载敏感属性必须在第三步的跑批协议里可见
invoke `bash scripts/test.sh plugin/test/session-liveness.test.mjs plugin/test/cold-start-skill.test.mjs`
control 人为制造负载（并发多套件）⇒ 该族可红（证明敏感是真实的、标注不是伪装的）
resume 先量出低负载基线，再定「稳定化 or 标注」的方向
```

## Chosen mechanism

**先量基线，再决定方向**（决策前置数据，不做无据的方向选择）：

1. 低负载（单套件）下连续跑该族 N 次，确认全绿——「负载敏感」的成立条件是低负载绿、高负载红。
2. 方向 A（稳定化）：修该族测试使它们在高负载下也绿（加大超时窗口 / 隔离更彻底 / 去掉对
   真实进程时序的依赖）。**代价高**——这族测试的有价值之处正是用真实进程/tmux 时序验证。
3. 方向 B（标注 + 单独跑）：把该族标记为**已知负载敏感**，第三步的跑批协议里将其排除在
   「判读并发放宽效果的判据」之外，或给它单独的跑批/超时预算。**代价低，且让第三步的判据
   不被这族的噪声污染。**

**倾向方向 B 起步**（成本低、立即解除第三步的判读冲突），是否进一步做方向 A 待基线数据积累。

**不做**：不删/降级这族测试（它们抓的是真问题——挂载单飞、laid-down 实跑、--once 接缝）。

## Acceptance Criteria

- [ ] AC1: **低负载基线**——单套件下连跑该族 2 次全绿（`fail 0` / `cancelled 0`，实跑贴出）
- [ ] AC2: **敏感是真实的（负控制）**——人为制造高负载（如并发放量套件）下该族**确实变红**，
      证明「负载敏感」不是伪装的借口（实跑贴出）
- [ ] AC3: **标注落地**——该族被标记为已知负载敏感，标记写在**第三步的跑批协议会读的地方**
      （tick 文档或等价物），不是只写在任务体里（实跑贴出标记位置）
- [ ] AC4: **第三步判据不受污染**——第三步放宽实验的判据明确排除该族的 fail（或其单独跑批），
      判定不会把「已知时序敏感被放大」误读成「并发放宽暴露了真问题」（实跑贴出判据文本）
- [ ] AC5: 测试用 `node:test` 且带恰当的 `// @test-group`
- [ ] AC6: 任务体记录证据：套件 #6/#7 该族失败的输出、隔离下通过的结果（证明并发敏感非逻辑错误）

## Definition of Done

- [ ] AC1 与 AC2 的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——注意：若该族已标注，判据里
      「该族已知负载敏感」这一事实必须不影响这两次全绿的达成方式
- [ ] 任务体记录：第三步起跑前必须处理这族（稳定化或标注），否则放宽判读失效

## Touches

- plugin/test/session-liveness.test.mjs
- plugin/test/cold-start-skill.test.mjs
- plugin/loop/fast-mode-loop-tick.md（或等价跑批协议，标记已知负载敏感）

## Dispatch review

reviewer: inner
at: 2026-08-04
changed: **套件 #6/#7 的同族失败观察**。两轮各挂一条不同但同族的测试（session-liveness 挂载
语义 / cold-start 演练 / laid-down --once），隔离下全过 → **并发敏感**（外层曾怀疑是生产挂载
污染，实测不成立，已收回）。**新的是它与第三步直接冲突**：第三步放宽到 2 并发 = 负载翻倍，
这一族是负载一高就红的那批，放宽后判读会失效。**倾向方向 B（标注 + 单独跑）起步**，方向 A
（稳定化）待基线数据。**为什么现在立案**：第三步起跑前必须先处理这族，否则放宽实验的判据
会建立在这族的噪声上。
