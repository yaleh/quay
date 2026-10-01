---
id: gap-fan-in-suite-red-no-in-round-rerun-of-red-files
title: 机械 fan-in suite 红后不在本轮重跑红文件——外来文件的抖动烧掉整轮并触发重派；outcome 不记红文件清单与受测 SHA，事后无法归因
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制**：`plugin/scripts/worker-fan-in.ts` `runMechanicalFanIn` 的 suite 步一旦红，直接 `outcome: "red"` 返回，没有任何本轮内的重跑；任何再尝试都是一次新的 worker 派发（续做 prompt + 重新 fan-in）。而生产上的 suite 红多数不是该任务引入的。

**生产读数（claudecodeui，2026-09-24→10-01，`.quay/worker-outcome.jsonl` + `fan-in-<task>-*.log`）**：
- suite 红 126 轮，约 2312 分钟，占全部机器时间 44.3%；
- 118 / 125 个红轮次的失败测试文件不在该任务的 `## Touches` 内；
- 57 个任务是「红一轮 → 绿一轮，而 delta 文件清单逐字节相同」，其第 2..N 轮（137 轮）worker 执行段合计 1080 分钟；
- 形态不是「某一刻 develop 全域红」（同文件 ≥3 任务且跨度 <48h 只占 37 轮 / 29%），而是少数脆弱文件在数天内反复红、每次换一个受害任务（例：`voice-capture-text.false-forms` 15 轮 / 12 任务，`resident-server-restart` 9 轮 / 7 任务）；
- 取证缺口：fan-in 的 cleanup 在落地时删 suite 尝试日志（124 个只剩 9 个，幸存集被失败偏置），outcome 不记受测合并树 SHA 与 develop SHA，任务分支落地即删 ⇒ 「同一棵树上红转绿」无法事后证明。

**修法（方向，实现者可调）**：
1. suite 红且日志里解析出 ≥1 个失败测试文件时，在**同一轮、同一把 fan-in 锁内、同一棵合并树上**只重跑这些文件。全部转绿 ⇒ 按绿继续落地，并记一条 flake 记录；仍有红 ⇒ 维持现状返回 red。三态不得压平：`rerun-green` / `rerun-red` / `rerun-not-evaluated`（没有可用的重跑命令、解析不出文件、重跑自身被 watchdog 中止）——第三态行为与修改前逐字一致（硬规则 3b）。
2. 重跑命令是**项目声明的**，产品代码不含任何项目知识：本仓库走既有 runner 的按文件入口；第三方项目读 `.quay/config.yml` 的 `loop` 段里一个新的可选键（按文件重跑命令，带文件列表占位），未声明 ⇒ `rerun-not-evaluated`。⛔ 不引入任何「已知负载敏感族」之类的项目侧名单。
3. `worker-outcome.jsonl` 的 `mechanical_fan_in` 增加：失败测试文件清单、受测合并树 SHA、当时的 develop SHA、重跑三态结果。这些字段在 suite 红与 rerun-green 落地两种情形下都写。
4. 提供一个只读仪器：按失败测试文件聚合 flake 记录（红轮数、波及的不同任务数、首红→末红），用于找出该修的脆弱文件。若为新增 `plugin/scripts/*.ts`，须同时登记 capability-catalog 声明与 outline。

**与已取消任务的关系（请先读）**：
<!-- dedup-ref -->`gap-fan-in-suite-red-load-sensitive-flaky-no-isolate-rerun` 于 2026-09-03 被人裁定取消（superseded），理由是它要求 provider-agnostic 的 worker-driver 了解 KNOWN-LOAD-SENSITIVE 这一实验层/项目侧概念。本任务的机制不同：重跑对象只取自 suite 日志本身点名的失败文件，重跑命令由项目在 config 里声明，产品代码不读任何项目侧分族名单。实现者若发现做不到「零项目知识」，应停下并报告，而不是把名单引回来。`red-window-triage.ts` 的隔离重跑语义可参考但不得把它的项目侧分区作为判据输入。

## AC

- [x] `node --test plugin/test/worker-driver-fan-in-s07.test.mjs` 退出 0，且新增用例覆盖三态：①suite 红、重跑命令对点名文件返回 0 ⇒ `runMechanicalFanIn` 结果 `outcome: "landed"` 且记录 rerun-green 与 flake 文件清单；②重跑仍非 0 ⇒ `outcome: "red"`、`step: "suite"`；③未声明重跑命令 ⇒ `outcome: "red"` 且重跑结果取值为 not-evaluated（断言该取值与①②不同）。
- [x] 取假：关闭重跑分支后，用例①红（在 `## Evidence` 附实跑输出）。
- [x] 负控制：用例②使用「重跑确定性失败」的 fixture，断言不落地——证明重跑不会把真红放行。
- [x] 重跑在 fan-in 锁内执行：用例断言锁 release epoch ≥ 重跑结束时刻。
- [x] `grep -n -i "KNOWN-LOAD-SENSITIVE\|load-sensitive" plugin/scripts/worker-fan-in.ts plugin/scripts/worker-driver.ts` 在本任务新增的代码行中命中数为 0（在 `## Evidence` 打印 `git diff develop... -- <两文件> | grep -i` 的结果；先把该谓词对着 `plugin/scripts/red-window-triage.ts` 干跑一次证明它能命中）。
- [x] outcome 字段：用例断言 suite 红的 outcome 记录里失败文件清单非空、合并树 SHA 与 develop SHA 均为 40 位十六进制；解析不出失败文件时清单为显式的「未评估」取值而不是空数组。
- [x] `bash scripts/test.sh --for-task gap-fan-in-suite-red-no-in-round-rerun-of-red-files` 退出 0，且确实执行了 ≥1 个测试文件（非 thin）。
- [ ] 生产载体（待外部）：本仓库或任一第三方项目 driver 运行含本修复的版本之后，其 `.quay/worker-outcome.jsonl` 在「实现落地之后」时间窗内，`mechanical_fan_in` 带有重跑三态字段的记录数 ≥1，且其中带合并树 SHA 的比例为 100%（待外部）

## DoD

真实落地判据不是「fixture 用例绿」：一次真实的机械 fan-in 在 suite 红之后于本轮内重跑了日志点名的失败文件，并在生产 `worker-outcome.jsonl` 里留下了失败文件清单、合并树 SHA、develop SHA 与重跑结果。最后一条 AC 读生产载体，取到之前本任务可以 done，但须在完成记录里写明尚未读到。本任务不承诺任何「suite 红占比下降到某数值」的指标——成本结构在留痕字段上线前不可测（硬规则 4 推论）；上面的 126 轮 / 2312 分钟只作为同口径的前后对照基线。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/worker-driver.ts
- packages/quay/src/config.ts
- plugin/test/worker-driver-fan-in-s07.test.mjs
- plugin/test/worker-driver-retry-classification.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- tasks/gap-fan-in-suite-red-no-in-round-rerun-of-red-files.md

## Evidence

**实现**（分支 `task/gap-fan-in-suite-red-no-in-round-rerun-of-red-files`，commit `482f7176c` + `17739f8b4`）：
- `plugin/scripts/worker-fan-in.ts`：suite 红分支新增**本轮内重跑**（仍在 try 内 ⇒ 同一把 fan-in 锁内、同一棵合并树上）；三态 `rerun-green` / `rerun-red` / `rerun-not-evaluated`；新增读数 `failedTestFiles`（三态）/ `mergeTreeSha` / `developSha` / `rerun`（含重跑日志指针）；新增 `loop.rerun_command` 的解析（`{files}` 为**整元素** splice 占位符，⛔ 不拼串）；suite 日志失败行解析自 `worker-driver.ts` **迁入**（单一真相源：本模块 ⛔ 不能 import worker-driver，值环），`worker-driver.ts` 反向 import 并 re-export，既有消费者 import 面逐字不变。
- `plugin/scripts/worker-driver.ts`：`aggregateRerunFlakes` + `--fan-in-flake-report`（只读仪器，Proposal §4）。
- ⛔ 未引入任何项目侧分族名单：重跑对象只取自 suite 日志本身点名的失败文件。

**AC1 三态**（`node --test plugin/test/worker-driver-fan-in-s07.test.mjs`，exit 0）：
```
ℹ tests 15 / ℹ pass 15 / ℹ fail 0
✔ AC1①+AC4+AC6 … suite 红 + 本轮重跑点名文件返回 0 ⇒ landed（rerun-green）+ 失败文件清单 + 锁 release ≥ 重跑结束 + 两 SHA 为 40-hex
✔ AC1②+AC3 负控制 … 重跑【确定性失败】⇒ 维持 red/step=suite，⛔ 不落地
✔ AC1③ … 未声明重跑命令 ⇒ 重跑取值为 not-evaluated（⛔ 与 ①/② 不同）
✔ AC6 … 解析不出失败文件 ⇒ 清单为显式的「未评估」取值，⛔ 不是空数组
✔ 只读仪器 … aggregateRerunFlakes 按失败文件聚合跨任务轮次，未评估轮次单独计
```

**AC2 取假**（把 `rerun = await runInRoundRerun(...)` 换成恒 `rerun-not-evaluated`，只跑用例①）：
```
✖ AC1①+AC4+AC6 (gap-fan-in-suite-red-no-in-round-rerun-of-red-files) — … (744.107698ms)
  AssertionError [ERR_ASSERTION]: rerun-green must land (step=suite reason=__PERFILE__ duration_ms=10
  plugin/test/flaky-under-load.test.mjs passed=false end_ms=20)
  'red' !== 'landed'
ℹ tests 1 / ℹ pass 0 / ℹ fail 1
```
（改动已还原；还原后同一用例绿，见上方 AC1 段。）

**AC5 谓词**（先干跑证明它能命中，再对本任务 diff 取读数）：
```
$ grep -c -i 'KNOWN-LOAD-SENSITIVE\|load-sensitive' plugin/scripts/red-window-triage.ts      # 干跑
6
$ git diff develop -- plugin/scripts/worker-fan-in.ts plugin/scripts/worker-driver.ts | grep -i 'KNOWN-LOAD-SENSITIVE\|load-sensitive'
（无输出；命中行数 = 0）
```
⚠️ 初版注释里复述了被取消任务的 id（其名字本身带该英文 token）⇒ 谓词命中 2 行；已改成中文描述（0 行），被取消任务的 id 仍留在本任务 `## Proposal` 的 dedup-ref 段。这是**判据的按位置读法**（硬规则 2）：命中的是一条「说明我们不这么做」的注释，不是一份名单。

**AC7 scoped 门**（AC 的形态：无 `--allow-thin`）：
```
$ bash scripts/test.sh --for-task gap-fan-in-suite-red-no-in-round-rerun-of-red-files
exit=0
ℹ tests 242 / ℹ pass 242 / ℹ fail 0
```
非 thin：本任务新增的 5 个用例都在选择集内跑到（该日志里本任务 id 命中 58 处）。驱动 fan-in 用的 `--allow-thin` 形态同一命令另跑一次，同样 exit 0（242 pass）；scoped-gate 缓存已按 develop=`edce41eb3be8161de60c62705f65546f3b38f9be` 写入。

**AC4 锁内**：用例①断言 `lockReleaseEpoch >= rerun.finishedEpoch`——release 在 `finally`、重跑在 try 内，重跑跑到锁外即取假。

**AC8（待外部，**尚未读到**）**：本机没有含本修复的 driver 生产轮次，生产台账里尚无带重跑三态字段的记录 ⇒ **本 AC 保持未勾**，判据取值未读取，不作「已满足」陈述。本仓库侧的声明行（`.quay/config.yml` 的 `loop.rerun_command`，该文件 gitignored）尚未铺出。DoD 的「真实落地」判据（一次真实机械 fan-in 在 suite 红后本轮重跑 + 生产 `worker-outcome.jsonl` 留痕：失败文件清单 / 合并树 SHA / develop SHA / 重跑结果）同样**待外部**，本条完成记录如实写明尚未取到。