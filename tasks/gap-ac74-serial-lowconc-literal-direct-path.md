---
id: gap-ac74-serial-lowconc-literal-direct-path
title: AC74 suite lane 静态假设三处一次改齐——main 去 /slots + serial/lowconc 直调读宿主 + 删 per_suite_lane_budget 产出（人 06:4xZ 裁定 AC68 回退）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**AC74（suite lane 静态假设三处一次改齐 —— manager 2026-08-14 06:3xZ/06:4xZ 报 + 人 06:4xZ 裁定 AC68 /slots 回退；与 AC74 原案 + AC68 回退合并成一条，理由=同文件冲突面 + 同语义族）**。

**⚠️ 合并说明（manager ③）**：AC74 原案（serial/lowconc 直调字面量）与 AC68 回退（main 相 /slots）**改同一文件（scripts/test.sh）** ⇒ 两条不可并行派发、必然串行 ⇒ 合并省一轮 fan-in（~390s + 一个槽）；且两者语义同源——**都是「suite lane 被静态假设压低」**。**合并后一条任务把三处一次改齐**：① main 相去掉 `/slots` ② serial/lowconc 直调路径读宿主 ③ 删 `per_suite_lane_budget` 产出。**AC68 的 AC1 判据随之改写为「删除」那一半**（人裁掉「读它」，剩下处置=删掉它；否则回退后 AC68 卡在已被裁掉的判据上）。

**AC68 回退面（human 06:4xZ 逐字「AC68 的 /slots 应当回退」；manager 定位，不改供立案）**：
```
scripts/test.sh:760   local … slots              ← 变量声明
scripts/test.sh:782-785  slots 的取值与夹逼      ← 引入
scripts/test.sh:800-801  awk … -v s=… / a / s    ← 【核心：去掉 / s】
```
**回退理由（manager ①）**：`/slots` 与 `in_use` **重复保护同一件事**——`u` 是跨层实际在跑的 `node --test` 进程数，并发情形原本就由它动态压住；`/slots` 再加一层静态最坏假设 ⇒ **单跑纯损、并发欠用**：
```
单条 suite 独跑   b=16 u=0 s=2 ⇒ c = 8    ← AC68 之前是 16，无过订阅要防却被砍半（纯损失）
两条并发          A 跑 8 workers ⇒ B 算 (16−8)/1/2 = 4 ⇒ 合计 12 < 16（欠用）
```
**回退后** `plugin/scripts/resource-gate.sh:461-469` 的 `per_suite_lane_budget` 重新变成**零消费者** ⇒ AC68 的 AC1 处置落定=「删除它」（二选一另一半，manager ③）。

**serial/lowconc 直调路径（AC74 原案，manager 06:3xZ 报，历史链逐条核对）**：

**建议值历史链（全读正本）**：
```
最早    scripts/test.sh 硬编码 serial=1（"串行隔离是机制不变量、永不可配"）
实验    gap-load-sensitive-serial-phase-unbounded-growth-measure-first（2026-08-10，AC3 done）
        A/B-class serial 子集 6 文件：cc=1 WALL_MS=455613 vs cc=2 WALL_MS=289579 ⇒ c2 快 36% ⇒ serial 默认 1→2
AC44    gap-ac44-concurrent-phases-read-host-parallelism（done）「字面量 6 依赖机器规格」⇒ 改读宿主
        full-suite-runner.ts:1605-1606  DEFAULT_SERIAL/LOWCONC_CONCURRENCY = max(1, floor(hostParallelism()/concurrentSuiteSlots()))
        ⇒ 本机 16/2 = 【serial 8 / lowconc 8】
```
**⇒ 现行建议值 = serial 8 / lowconc 8**（与 main 相同 host÷slots），AC44 已 done，不是提案。

**缺陷（实质）**：AC44 只修了 **runner 一侧**；**直调一侧还是 AC44 之前的字面量**——
```
runner 路径   full-suite-runner.ts:2122-2123 传 env：QUAY_SERIAL_CONCURRENCY=8 / QUAY_LOWCONC_CONCURRENCY=8
              ⇒ test.sh 拿到 8/8（host÷slots）
subagent 路径  今天实测调用形态：cd <wt> && bash scripts/test.sh …  ← 直调，不经 runner ⇒ env 未设
              ⇒ 落到 scripts/test.sh:820-821 字面量
                SERIAL_CONCURRENCY="${QUAY_SERIAL_CONCURRENCY:-2}"
                LOWCONC_CONCURRENCY="${QUAY_LOWCONC_CONCURRENCY:-3}"
              ⇒ 实际跑 serial=2 / lowconc=3
且这两个值确在全量路径生效：scripts/test.sh:1370-1371 `node --test --test-concurrency="$SERIAL_CONCURRENCY"` 等
```
**⇒ 硬规则 4 推论二（依赖宿主的字面量）的原样复发——AC44 正是为治它而立的。** 与 AC73 姊妹形态：**同一个默认值在一条路径生效、另一条路径不生效**（AC73 是"一个量在一个方向有消费者、另一方向零"）。

**与人警告直接相关**：人 06:3xZ 逐字「后续我们还要继续优化 suite 测试耗时。这也是为什么对于 suite 测试的 lane 设置不能随便降低。」**这里不是有人提议降低，是【一条已被 AC44 提高的设置，在 subagent 直调路径上从未生效】。AC67 之后全量 suite 全部走 subagent 直调 ⇒ 这条会成为默认，而不是边角。**

**判据（合并形态：一处改齐三件事）**：
- **判据1（main 相去掉 /slots，人 06:4xZ 裁定回退）**：`scripts/test.sh:800-801` 的 `awk … / a / s` 去掉 `/ s`（及 :760/:782-785 的 slots 声明/取值/夹逼）——main 相回到 `c = int((b - u) / a)`，单跑 16、并发由 `in_use` 动态压住（不欠用）。
- **判据2（serial/lowconc 直调读宿主，AC74 原案）**：`scripts/test.sh:820-821` 的 `SERIAL_CONCURRENCY`/`LOWCONC_CONCURRENCY` 默认值改为**读宿主**（与 full-suite-runner.ts:1605-1606 同源：`max(1, floor(hostParallelism() / concurrentSuiteSlots()))`），不再遗留 2/3 字面量。
- **判据3（删 per_suite_lane_budget 产出，AC68 AC1 落定另一半）**：回退后 `plugin/scripts/resource-gate.sh:461-469` 的 `per_suite_lane_budget` 重新零消费者 ⇒ **删除该产出**（含计算/夹逼/打印/消费者注释）——不留「正确但无人读」的数字。
- **判据4（能取假，合并判据）**：**同一台机器上，直调 `bash scripts/test.sh` 与经 runner 起，三个值读数必须相同且等于宿主推导**：
```
main   = hostParallelism()（回退后不除 slots）
serial = lowconc = hostParallelism()/concurrentSuiteSlots()（AC44 已定）
现在红：main 8（应 16）· serial 2（应 8）· lowconc 3（应 8）
```
D2 不构造。
- **判据5（不重定数值）**：不另设数值（人已警告 + AC44 已定值）；只统一推导源。
- **判据6**：`concurrency-literal-check` 为什么没拦 env-fallback（扫裸字面量 `DEFAULT_SERIAL_CONCURRENCY=6`，而 test.sh:820 是 `:-2` 形态）——覆盖缺口记录，不扩展它。

**止损（C21，manager ⑤ + ④）**：**不需要 —— 现在生效的是 8/8**（subagent 跑 scoped `--for-task`，全量仍由 inner 主线程经 runner 起）。**⚠️ 绑读数：AC67 落地那一刻止损失效**——全量 suite 改走 subagent 直调，serial/lowconc 立刻掉到 2/3。**但不要为此阻塞 AC67**（人点名关键路径）：**两条都推、谁先绿谁先合**（manager ⑤）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 scripts/test.sh:760/782-785/800-801（/slots 三处）+ :811-821（serial/lowconc 字面量）+ full-suite-runner.ts:1605-1606/:2122-2123（host 推导 + env 传递）+ resource-gate.sh:457-469（per_suite_lane_budget）。
2. 判据1：test.sh main 相去掉 `/ s`（及 slots 声明/取值）。
3. 判据2：test.sh serial/lowconc 默认值改读宿主（与 runner 同源），不遗留 2/3。
4. 判据3：resource-gate.sh 删 per_suite_lane_budget 产出（计算/夹逼/打印/消费者注释）。
5. 判据4：直调 vs runner 三值读数相同（现在红，D2）。
6. 判据5/6：不重定数值；concurrency-literal-check 未拦原因记录。
7. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：main 相去掉 `/slots`，单跑回到 16、并发由 in_use 动态压住（不欠用）。
- [x] AC2 判据2：serial/lowconc 默认值读宿主（与 runner 同源），2/3 字面量消失。
- [x] AC3 判据3：per_suite_lane_budget 产出删除（计算/夹逼/打印/消费者注释）——不留零消费者数字。
- [x] AC4 判据4 能取假：直调 vs runner 三值读数相同且等于宿主推导——现在红（main 8 应 16 / serial 2 应 8 / lowconc 3 应 8），修后绿（D2 真样本）。
- [x] AC5 判据5：不重定数值（人警告 + AC44 已定值），只统一推导源。
- [x] AC6 判据6：concurrency-literal-check 未拦 env-fallback 的覆盖缺口记录（不扩展它）。
- [x] AC7 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 三处一次改齐（main 去 /slots + serial/lowconc 读宿主 + 删 per_suite_lane_budget 产出）+ 三值读数直调与 runner 相同 + 不重定数值。

## Touches

- scripts/test.sh（default_concurrency_formula 去掉 `/ s` + 删 slots 声明/取值/夹逼 + serial/lowconc 改读宿主 `serial_lowconc_host_default`）
- plugin/scripts/resource-gate.sh（删 per_suite_lane_budget 产出 + 删零消费者 CONCURRENT_SUITE_SLOTS 声明）
- plugin/scripts/full-suite-runner.ts（`defaultLaneCount()` 去 `/ slots` —— AC68 回退同源；serial/lowconc 常量注释改为 H÷S 三相区分；未走「共享源导出」——test.sh 是 bash，复制宿主推导表达式为 shell helper）
- plugin/test/resource-gate.test.mjs（AC68 derivedConcurrency 测试改：无 slots 除数 + serial/lowconc 宿主推导 + 判据4 checker + 负控制）
- plugin/test/full-suite-runner.test.mjs（defaultLaneCount AC1 测试改：任意 slot 数 → nproc）
- plugin/test/runner-grouping-serial-anti-stomp.test.mjs（serial 默认断言改 host-derived 形态）
- （负控制 fixture + 两路径三值读数对比）
- tasks/gap-ac74-serial-lowconc-literal-direct-path.md（自身）

## Evidence

**落地（2026-08-14，worktree gap-ac74）**：
- 判据1（main 去 /slots）：`scripts/test.sh` `default_concurrency_formula` 的 `awk … / a / s` → `awk … / a`；`:local` 删 `slots`；删 slots 取值/夹逼。`full-suite-runner.ts:defaultLaneCount()` 同步去 `/ slots`（AC68 回退覆盖 runner 侧 —— AC68 任务体写明 fix 使「test.sh 与 full-suite-runner 都读它」，故回退同两处）。证据：`resource-gate.test.mjs` AC74/判据1 `derivedConcurrency(16,1.0,0,2) == 16`。
- 判据2（serial/lowconc 读宿主）：`scripts/test.sh` 新增 `serial_lowconc_host_default()`（`max(1, floor(nproc ÷ S))`，seams `RESOURCE_GATE_NPROC`/`RESOURCE_GATE_CONCURRENT_SUITES`→`QUAY_MAX_CONCURRENT_SUITES`→2）；`SERIAL/LOWCONC_CONCURRENCY` 的 `:-2`/`:-3` → `:-$(serial_lowconc_host_default)`。证据：`resource-gate.test.mjs` AC74/判据2 `phaseConcurrencyDefault(16,2)==8` + `doesNotMatch :-2/:-3`。
- 判据3（删 per_suite_lane_budget）：`plugin/scripts/resource-gate.sh` 删 457-469 整块（计算/夹逼/打印/消费者注释），及零消费者 `CONCURRENT_SUITE_SLOTS` 声明（95-108 改注释）。全仓 grep `per_suite_lane_budget` 仅剩删除说明注释。
- 判据4（能取假，D2）：`resource-gate.test.mjs` AC74/判据4 —— 同一台机（seams NPROC=16/S=2）：直调 main=16、serial=8、lowconc=8；runner `defaultLaneCount()=16`、`hostParallelism()/concurrentSuiteSlots()=8`。三值一一相等且等于宿主推导。负控制：pre-fix 态 (8/2/3) 三值全红。scoped 门实测绿（187 pass / 0 fail，`--for-task … --allow-thin`，exit 0）。
- 判据5（不重定数值）：未新设任何字面量；只把推导源统一为宿主（`nproc`/`QUAY_MAX_CONCURRENT_SUITES`）。concurrency-literal-check --gate 绿（0 violations，7 已声明例外全在既有点）。
- 判据6（覆盖缺口记录，不扩展）：`concurrency-literal-check.ts` 的四个 pattern（P1 const=num / P2 CLI flag / P3 CPUQuota / P4 object key）**不覆盖 shell env-fallback `${VAR:-N}` 形态** —— 旧的 `SERIAL_CONCURRENCY="${QUAY_SERIAL_CONCURRENCY:-2}"` 不是 P1-P4 任一形状，故该检查在 AC44 之后一直没拦直调侧遗留的 2/3 字面量。本次未扩展该检查（任务判据6 明文「不扩展它」），只记录此缺口；若未来再出现 env-fallback 字面量漂移，需新增 P5 或改写为「fallback 必须读宿主」。
- ts-typecheck：`for d in packages/*/; npx tsc --noEmit` exit 0（full-suite-runner.ts 在 plugin/scripts，不在 tsconfig include 内；其类型正确性由 full-suite-runner.test.mjs 的运行时 import 覆盖，141 pass）。
- 既有测试：`resource-gate.test.mjs` 46 pass、`full-suite-runner.test.mjs` 141 pass、`runner-grouping-serial-anti-stomp.test.mjs` 3 pass。
