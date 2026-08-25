# SPEC：方法学层架构 —— 契约面的采纳，不是抽象的从头建立

> **立本 SPEC 的由来（人 2026-08-25 逐字）**：「本项目的 OOA/OOD 设计是不足的，大部分任务关注的
> 仅是实现功能和跑通，并未做更大颗粒的架构设计」；「基于现有实现和典型应用场景明确架构轮廓和演进
> 方向」「基于现有实现进行持续重构」「用现有的阶段目标+AC 的形式来驱动」「尽早把大的架构做对」
> 「可测试性和测试的性能也是优化的重点」。
>
> **体例照 `SPEC-unified-driver-architecture-2026-08-23.md`**：现状盘点直读代码、目标架构、非目标、
> 排期与验收方向（**非最终 AC，供立案时参考——AC 正本由 outer 写，本文件是输入**）。

## 0. 一句话

**抽象大多已经存在且已被广泛 import；缺的是【契约面】被消费、【第三态】被 harness 看见、
【输入形状】从"路径"改为"内容"。这是三个可验证的窄命题，不是"重建架构"。**

---

## 1. 现状盘点（直读代码 + 并发 subagent 核实，非印象）

### 1.1 已经做对的两个子系统 —— 这是样板，不是待修对象

| 子系统 | 证据 | 结论 |
|---|---|---|
| **driver 两级分层** | `driver-runtime.ts`(1106L) + `driver-shared`(472L) + `driver-filters`(159L) + `driver-result`(71L)；消费者 worker-driver / promotion-driver / ready-pool-check | Layer 0 共享 7 项能力（supervisor/loop/trigger/stopCondition/heartbeat/controlPlane/notify），Layer 1a task-processing。**`gap-ac151-two-level-driver-layer-landing` 已 done（08aa69a0, 2026-08-25 10:25）** |
| **gate 工厂** | `gate/registry.ts` 定义 `GateFn`，`config/loader.ts` 按 `gates.yml` 的 `type` 多态派发；8 个工厂中 6 个复用 `acceptance-runner.ts` 的 `runAcceptance()` | **真工厂模式**。昂贵逻辑（spawnSync/超时/env 优先级/成本账本）集中在一处。唯一重复是 `coverage-floor.ts` 的 `spawnSyncCapture`，作者注释已自认 |

⊢ **这两处证明本仓库有能力做对**。本 SPEC 的全部主张 = **把 driver 这次的做法套到其余角色**。

### 1.2 契约面被写下来过，零人采纳 —— 最尖锐的一条

```
gate-script-base.ts:102-110   export function emitPass/emitFail
  全仓生产调用者：0（唯一引用在 experiments/.../gate-script-base.test.mjs）
  而 77 个 *-check.ts 中，21 个自己 console.log 打 PASS/FAIL

同一文件的其它导出，采纳率天差地别：
  isDirectEntry   39/77   ← 入口样板，被采纳
  parseArgs        5/77
  readFrontmatter  4/77（而全仓有 8 处自建 frontmatter 解析）
  emitPass/emitFail 0/77  ← 契约面，零采纳
```

⊢ **基座被 100 个文件 import，但被 import 的是入口样板，不是契约。**
⊢ **这是新契约必须先胜过的先例**：写下来不等于被采纳。任何"定义一个 `Checker` 接口"的提案，
若不解决"为什么上一个契约无人用"，会复现同一结果。

### 1.3 NOT-EVALUATED：硬规则 3b 在 harness 层结构上无法兑现

```
checker-cost-lib.sh  run_checker  ⇒ 把【任何非零】一律当 fail-closed RED（|| _rc=$? → STATIC_CHECK_FAILED）
                                    无第三态概念

而 exit 2 当前同时承载三种互不相容的含义：
  spec-declaration-point-check.ts:33,179        exit 2 = NOT-EVALUATED
  另外 6 个 checker                              exit 2 = usage/env error
  fan-in-materialize / per-task-suite /
  inner-wakeup-heartbeat                        NOT-EVALUATED = exit 0 + 一个 JSON 字段
```

⊢ **spec-declaration-point 的"无法评估"会把套件判红；另三个的"无法评估"是绿色 + 一个 harness
根本看不见的字段。** 全population：17/77 有 marker、16/77 有字段，编码互不相容。
⊢ **无论单个 checker 多守纪律，硬规则 3b 在 harness 层都兑现不了——这是架构级缺口，不是 checker 缺陷。**
⊢ 已立案 `gap-not-evaluated-harness-third-state`（ready）。

### 1.4 输入形状：`path` vs `content` —— 可测试性的真正杠杆

```
~70% 的 checker 吃【文件系统路径】作为输入
⇒ 85 个 checker 测试中 70 个要 mkdtemp 建 fixture 目录
⇒ 只统一【返回类型】不会改变这一点
```

**已存在的正确样板**（`experiments/quay-perpetual-stream/scripts/audit-independence-check.ts`）：

```ts
// 导出对【字符串】的纯函数，不是对路径的
checkArtifact(fullText, orchestratorId, options)
evaluateIndependence(...)
isCorroborated(...)
main(argv)   // 只是薄 CLI 壳
```
其测试：**39 个断言 0.49s，零 subprocess spawn**。对照 checker 测试中位数 **2.53s**。

⊢ **这才是"可测试性"的杠杆**：把纯判定逻辑从 I/O 里剥出来，测试就不需要 fixture 目录。
⊢ 次优样板：`touches-orthogonality-check.ts`（`parseTouches(text)` 纯字符串）；
`retired-clause-check.ts` 形状好（`runCheck(root) → {ok, issues}`）**但仍吃 root 路径，
所以它的测试仍要 mkdtemp** —— 正好演示了"只改返回类型不够"。

### 1.5 ⛔ 本 SPEC 起草过程中【被证伪】的两条假设 —— 原样保留以防复活

**① "checker 没有可 import 的契约" —— 假。**
实测：**91/97 个 `.ts` checker 已导出东西；54 个测试文件已 import checker**。
真实问题是**异构**：45 个导出叫 `main`、11 个 `selftest`、5 个 `runChecks`、3 个 `runCheck`…
⇒ 命题应为"缺共享契约"，**不是"不可 import"**。

**② "无共享抽象 → 每脚本一测试 → 慢套件 → 慢迭代"这条因果链 —— 第 3 环断裂。**
实测（`.quay/verification-round.jsonl`，116 轮含 perFile，参考轮 435 文件 / 705s / 并行度 6.76）：
```
checker 测试合计 411.9s = per-file 总时间的 7.0%（中位 2.53s，非 checker 中位 2.12s——几乎一样快）
现实可折叠量：162 个 spawn 点 × 0.63s = 102s，封顶 73s ⇒ 折成墙钟 73/6.76 ≈ 11s
             = 705s 轮次的 ~1.5%，【低于轮次间噪声】（套件墙钟 p10 246s / 中位 552s / p90 1162s）
即使把全部 checker 测试删光：61s = 墙钟 8.6%
⇒ packages/ 测试才是大头：5470s = per-file 总时间的 93%
```
⊢ **所以本 SPEC 不以"缩短默认轮套件时间"作为可测试性的论据。** 该论据已被自己的测量否定。
⊢ **真正成立的成本论据有两条**：
- **`checker-mutation-check.test.mjs` 单文件 227.6s**，迭代 57 个 mutation case、每 checker ~4.0s
  spawn 一次证明它能变红 —— **这是唯一随 checker 数量线性增长的成本**（governance 组，不在默认轮）；
- **32,881 行 checker 测试代码**的撰写与维护成本（85 个文件，86% 的 checker 有专属测试）。

⊢ **记此二条的方法论意义**：①来自我给 subagent 的先验被当作待确认结论放大；②来自我自己没测就写进
链条。**两条都在动笔前被实测拦下** —— 这正是"先测再写"的价值，也是本 SPEC 要求每条 AC 带负控制的理由。

### 1.6 其余角色的重复（已核实，规模适中）

| 簇 | 判定 | 备注 |
|---|---|---|
| `findRepoRoot`(14)+`findWorkspaceRoot`(4) | TRUE_DUP | **同一函数体在两个名字下逐字节重复**；5 份 body hash 相同；另有 4 处已跨文件 import 对方版本 |
| `normalizeRel`(4) | TRUE_DUP | 两份注释**各自声称自己是规范版** |
| `canonicalTestFiles` 组(3) | TRUE_DUP | ~221 行中 ~146 行纯重复 + **glob-vs-realpath 潜伏分歧**（已立案） |
| `scanSurface`(2/3) | TRUE_DUP | 逐字节相同（连 `SCAN_ROOTS` 共 25 行连续复制）；第 3 个同名不同义 |
| `write*State`(6) | 真实重复 + **正确性缺口** | 原子写 2 / 非原子 4，仅 1 处有理由说明（已立案） |
| `readFileSafe`(4) | TRUE_DUP | 另有 50 处 inline try/catch 散在 37 文件 |
| `parseFrontmatter` | 4 份独立实现 | 基座已提供 `readFrontmatter` 但只有 4/77 用 |
| `runOnce`/`RunOnceResult` | PARTIAL_DUP | 2 真实近重复（poll/diff/emit/memo 骨架）+ 1 职责不同 |
| **`SCAN_ROOTS`** | **⛔ 不是重复** | 10 个数组只有 1 对真重复，其余是各 checker 的**配置**，不该被吸收 |
| **`scanText`(4)** | **⛔ COINCIDENTAL** | 四份匹配逻辑真不同，只共享"逐行扫描"这个不可避免的骨架 |

⊢ 输入侧重复量实测 **~557 行（区间 510–570）**，占 checker 总量 32,825 LOC 的 **~1.7%**。
⊢ **体积不是主要代价**，两个"同一概念多种不相容策略"才是（root 三策略、`scanSurface` 一名两义）。

### 1.7 规模与交付事实

```
packages/quay/src   （产品核心）      64 文件   15,347 行
plugin/scripts      （方法学层）     286 文件  112,202 行   ← 7.3x
  其中 checker                       109 个（77 .ts + 32 .sh）
所有 *.test.mjs                      411 文件  150,151 行   ← 1.34x 实现
plugin/scripts 结构                  288 文件平铺，子目录 1 个
```

**⚠️ 关键事实**：`packages/quay/package.json` 的 `files` 数组含 `plugin`
⇒ **`plugin/` 随 npm 交付给用户**。
⊢ **方法学层不是实验脚手架，是已发布产品的一部分。** 这一条支撑人的「应当尽早把大的架构做对」——
它不是"研究代码乱一点没关系"，是**一个已交付的 112K 行子系统从未获得架构**。

---

## 2. 目标架构

### 2.1 两个应用场景，两套要求

| 场景 | 需要什么 | 现状 |
|---|---|---|
| **A. 用 quay 开发其它软件** | Core 视图模型 + Provider ABI + gate 引擎 + CLI/MCP/Web | `packages/`，架构合理（三包 + ABI，`quay-github` 证明 ABI 可迁移） |
| **B. quay 自举开发（BAIME）** | driver / checker / trigger / suite 编排 / fan-in / telemetry | `plugin/scripts`，**8 个角色中 2 个已有抽象** |

⊢ **本 SPEC 只针对 B**，且**不重划 A**。

### 2.2 角色清单 —— 轮廓就是这张表

| 角色 | 规模 | 共享抽象 | 目标 |
|---|---|---|---|
| driver | 3 类 | ✅ Layer0/1a，4 模块 | 维持 |
| gate | 8 工厂 | ✅ 真工厂 + `runAcceptance` | 维持 |
| **checker** | **109** | ⚠️ `gate-script-base` 入口面已采纳、**契约面零采纳**；`checker-lib` 4 原语 7/77 | **§2.3 / §2.3a（复用 driver-result）/ §2.3b（调用面迁移）** |
| **state I/O** | 12 函数 | ❌ | **§2.4** |
| ~~trigger~~ | 2 | ✅ **已由 `gap-retire-outer-monitors-after-reconciler` 处置**：职责移交 driver 协调循环，脚本降级为共享库 | ⛔ **移出待办**，见 §2.5 |
| path/root | 18 处 | ❌ 三种策略并存 | §2.4 |
| record 校验 | 4 | ❌ | §2.4 |
| 测试集枚举 | 3 | ❌ 已立案 | §2.4 |

**⊢ 修订后的账**：8 个角色中 **3 个已做对**（driver / gate / trigger——最后一个是查证后才发现已处置），
**5 个待办**。且其中 checker 的层 2 已因 §2.3a 从"设计新契约"降为"复用已落地的 `driver-result`"。
**⇒ 实际待办量比初稿判断的小。**

### 2.3 checker 契约：三层，且**分开立案**（因为三层的代价差一个量级）

> **⭐ 2026-08-25 重大修订（人追问"checker 与 *-driver 架构是否已结合"后实测）**：
> **层 2 的契约不需要重新设计——`driver-result.ts` 已经把它写好了，只是 checker 不知道。** 见 §2.3a。

```
层 1 · 机械脊柱  —— CODIFY-EXISTING（几乎免费）
    exit 0/1/2 语义      12/14 已符合
    --json 输出          13/14 已支持（56/77）
  ⇒ 写下来即可，不需要改文件

层 2 · 判定契约  —— ⭐ 从「REAL-MIGRATION 设计新契约」降级为「复用 driver-result」
    见 §2.3a —— 代价小一个量级

层 3 · 输入形状  —— 真正的可测试性杠杆，也是最大改动
    path → content：判定逻辑对【字符串】纯函数，I/O 留在薄 CLI 壳
    样板：audit-independence-check.ts（39 断言 0.49s 零 spawn）
  ⇒ ⚠️ 这一层【不应一次性推给 109 个 checker】，见 §5 棘轮
```

### 2.3a ⭐ 跨角色发现：driver 已解决 checker 的第三态问题，而 checker 不知道

**实测（2026-08-25）**：

```
plugin/scripts/driver-result.ts（AC153，2026-08-25 刚落地）已定义：
    | { state: "not-evaluated"; reason: string }      ⛔ 与 verified 不同形，也与 failed 不同形
  注释逐字引硬规则 3b：「读不懂 ≠ 合格，也不伪造成合格」
  并提供构造器 + 「null/throw ⇒ not-evaluated（携带 notEvaluatedReason）」的收敛规则

采纳者：driver-runtime.ts · promotion-driver.ts · worker-driver.ts
其中是 checker 的：**0**
```

⊢ **§1.3 判为"checker 角色的架构级缺口"的那个第三态，driver 角色已经解决了。**
⊢ **同一仓库、同一周、同一条硬规则**：两个角色各自面对，一个产出了 `DriverResult<T>` 词表，
另一个还在用三义冲突的 `exit 2`。
⊢ **这是「缺乏整体架构设计」最精确的证据形态**——不是没人会做，是**做对了的方案不跨角色传播**。

**⇒ 对目标架构的影响（把改动降一个量级）**：
- 层 2 不再是"设计一个 `Checker` 接口并推广"，而是**让 checker 复用 `driver-result.ts` 的
  `DriverResult<T>`**（已落地、已被 3 个消费者验证、已有测试）。
- §1.3 的 harness 三态缺口随之有了**现成词表**可对接：`run_checker` 需要认的第三态，
  Layer 0 已经定义好了它的形状。
- ⚠️ **仍需实现方判断**：`DriverResult<T>` 的语义是否 1:1 适配 checker（driver 的 `verified` 对应
  checker 的 `pass`？`failed` 对应 `fail`？），还是需要一个共享的更上位词表。**本 SPEC 不代为判定。**

**⛔ 关于扩 `checker-lib` 还是新建 `checker-io`**：
`checker-lib.ts` 现有 4 个原语**全是判定侧**（源码掩码/位置匹配/枚举存在性），**不含任何 I/O**。
新增 I/O 原语前**必须先读 `checker-lib.test.mjs`**，确认是否存在"该库保持纯净/无 fs"的不变式——
若有，则应新建 `checker-io.ts` 兄弟模块而非扩它。**此项未查，留给实现方。**

### 2.3b ⚠️ 调用面迁移：退役的前置条件，不是退役后的清理

**背景（人 2026-08-25）**：outer 将随 inner 退役；outer/manager 的 cron/loop 将被
**外部更机械触发的短 Claude Code 会话**取代。**这会从下面抽走一部分 checker 的调用面。**

**实测归属（109 个 checker，按可执行载体判定，⛔ 已排除 .md 文档提及）**：

```
在 static-gate 注册表（随套件跑，退役不受影响）    45
outer 执行核直接引用                              12  ← 其中 5 个不在注册表
manager 侧                                          6
driver 家族                                         4
workflows                                           6
以上皆无、但仍有其它可执行载体引用                 54
只剩 .md 文档提及                                    6  ← 真正的死代码候选
全仓零引用                                           1
```

**outer 引用的 12 个，逐个核实其注册表重叠**：

```
[安全·同时在注册表 7]  inner-wakeup-heartbeat-check · judgment-consumer-check · ready-pool-check
                       task-contract-check · touches-orthogonality-check · closure-lag-check.sh
                       outer-tick-log-check.sh
[需处置·不在注册表 5]  drive-contract-check.ts · outer-anchor-check.ts · test-framework-policy-check.ts
                       drive-target-check.sh · monitor-mount-check.sh
```

**但"不在注册表"≠"退役即孤儿"**——逐个查留存调用面后：

| checker | 留存调用面 | 处置 |
|---|---|---|
| `test-framework-policy-check.ts` | 被 `test-isolation-check` / `tmp-leak-pairing-check` **import**（事实库） | ✅ 安全，但见 §1.6"checker 当库用"的问题 |
| `drive-contract-check.ts` | `red-on-omission-audit.ts` + mutation-cases | ✅ 安全 |
| `monitor-mount-check.sh` | `quay-session.ts` · `manager-start.sh` · `quay-init.sh` | ✅ 安全 |
| `drive-target-check.sh` | `os-anchor-watchdog.sh` · `send-keys-reliable.sh` | ✅ 安全 |
| **`outer-anchor-check.ts`** | 仅 `outer-cron-registry.ts`（**同属退役层**） | ⚠️ **真正绑死在退役层上的唯一一个** |

⊢ **结论：checker 侧的退役风险面比预期小得多——只有 1 个真正需要在退役前处置。**
⊢ **但这条必须写成退役的【前置检查】而非事后清理**：判据形如「退役 outer 前，枚举其执行核引用的
全部 checker，逐个确认存在留存调用面或显式退役」。**没有这个前置，孤儿是静默产生的。**
⊢ ⚠️ **未查**：manager 侧那 6 个、以及 cron/loop 换成短会话后 `manager-tick-readings.ts` 的
调用面是否同样受影响。**manager 自身的退役形态尚未定，留待人裁定后再补测。**

### 2.4 共享 I/O 基座

- `repo-root`：**唯一需要 bash+TS 成对**的概念（TS 16 处 + bash 9 处，三种策略）。
  ⛔ 注意：`path.resolve(__dirname,'..','..')` 经实测在 task worktree 下**解析正确**
  （`plugin/` 是真实目录非符号链接）——**它不是正确性缺陷，只是可维护性问题**。
- `walk/enumerate`、`safeRead`、`recordValidate`：**TS-only**。bash checker 压倒性地读固定路径的具名
  文件（32 个里只有 3 个用 `find`），**无需并行 bash 实现**；且 ~11/32 已是 `gate_delegate_ts` /
  `exec node` 薄壳 —— **收敛到 TS 是自然路径**。
- ⛔ `SCAN_ROOTS` 类配置**作为参数传入，不被基座吸收**（§1.6）。

### 2.5 trigger：⛔ **本节原判断已过时，实测后撤回**

> **原写法（2026-08-25 初稿）**：「`slot-free-trigger` 与 `suite-state-trigger` 共享 poll/diff/emit
> 骨架，待抽取」。**这是过时的判断，现撤回。**

**实测（读两个脚本的头注释，权威来源是脚本自身）**：

```
两者头部均写着：
  ⛔ 退役（gap-retire-outer-monitors-after-reconciler）：外层 Monitor 挂载（冷启动 4b2/4b3）已移除
  ——「空槽出现」/「套件转红」由 driver 协调循环接管（定时器地板 + 每趟 pass 现读，SPEC §5.5），
  本脚本从【正确性依赖】降级为【优化】。脚本本体保留（判定逻辑与测试仍在）。
  suite-state-trigger 另注：保留为共享库——full-suite-runner.ts 仍 import runOnce / isRunnerInFlight
```

⊢ **这两个 trigger 既不是"待抽取的重复"，也不是"被 Layer 0 取代"**，而是**已被显式降级并保留为库**：
职责已移交 driver 协调循环，脚本本体作为判定逻辑 + 共享库继续存在。
⊢ **`driver-runtime` Layer 0 的 `trigger` 是另一回事**——实读为驱动自身的调度节律
（`--interval` / `--reconcile-interval` 透传给常驻循环），**不是"检测状态跃迁并发事件"**。
两者不构成取代关系。
⊢ **⇒ trigger 角色从本 SPEC 的待办中移除。** 若仍要合并那两份 poll/diff/emit 骨架，
那是纯代码整洁收益，**且必须先确认 `full-suite-runner.ts` 对 `runOnce`/`isRunnerInFlight` 的
import 不被破坏** —— 优先级低于 §5.3 的任何一批。

**⊢ 方法论记账**：本节是**第 3 处在起草/修订中被实测推翻的判断**（前两处见 §1.5）。
三次的共同点：**我按"代码形状"归类，而没读"这段代码自己声明的处境"**。
脚本头注释里写着"已退役/已降级"，比任何静态相似度分析都权威。
⇒ **纪律：判定一个组件"待重构"之前，先读它自己的头注释与最近一条相关任务的状态。**

---

## 3. 非目标（明确排除，避免 scope 膨胀）

1. **⛔ 不重划 `packages/`**（场景 A 的架构是合理的）。
2. **⛔ 不做目录重组**（见 §4 落地顺序）——`driver-*.ts` 平铺也构成了清晰子系统，证明重组非必需。
3. **⛔ 不引入 class/继承层次**。问题从来不是"没有 class"，是**没有类型化的共享词汇**和**没有契约采纳**。
   `gate/factories` 用纯函数 + 接口做对了工厂模式，是本仓库风格可行的证明。
4. **⛔ 不以"缩短默认轮套件时间"为 checker 重构的论据**（§1.5②已自证否定）。
   若目标是套件时间，**93% 在 `packages/` 测试**，那是另一条线。
5. **⛔ 不追求"消除全部重复"**。`scanText`/`SCAN_ROOTS` 已判定为合理多样性。
6. **⛔ 不把 trigger 合并列为本 SPEC 待办**（§2.5：已由既有任务处置并降级为库）。
7. **⛔ 不在 manager 退役形态未定前，替 manager 侧那 6 个 checker 规划迁移**（§2.3b 末）。

---

## 4. 落地顺序：一条来自本系统自身机制的硬约束

**⛔ 不要从"重组目录"或"大范围移动文件"开始。**

`## Touches` 是**目录级会自阻塞**的：一个大范围文件移动会让该任务与**所有**触碰
`plugin/scripts/**` 的任务互斥，`assembleBatch` 将它们序列化 ⇒ **并发派发降为 1**。
当前 cap=5，且已观察到"连续 3 轮无新落地"的排队现象。

**顺序**：
1. **抽共享库、文件留在原地**（Touches 面小，可与其它任务并行）
2. **棘轮把调用点逐批迁过去**（每批 Touches 可控）
3. **目录重组放到最后，或不做**

---

## 5. 排期与验收方向（⛔ 非最终 AC，供 outer 立案时参考）

### 5.1 形态：棘轮（ratchet），不用形容词

架构 AC 的困难在于"更好的架构"不可直接取假。**用可数的量 + 只减不增的闸**：

```
AC 形如：<某角色的重复实现数 / 未采纳契约数> 从 N 降到 N-k，且新增违例被检查器挡住
  ⊢ 能取假：数一下就知道
  ⊢ 增量：不要求一次清零
  ⊢ 可穿插：任何一轮迭代都可顺手降一格（符合人「很可能穿插其它迭代」的要求）
  ⊢ 防回潮：棘轮只能向下
```
本仓库**已在用棘轮**（`test-framework-policy-check` 对 34 个历史文件的 exemption list），非新机制。

### 5.2 ⚠️ 每条 AC 必须配负控制

**否则就是"接了线但恒绿"** —— 本会话已实证两次同形（`archguard` 零调用而文档要求它、
`detect_shape_smells` 因 enum 数=0 而报 0 smells）。
负控制形态：**注掉共享库的引用 / 关掉 seam，对应检查必须变红**。

### 5.3 建议的批次（按"代价/风险"升序，非按重要性）

| 批 | 内容 | 棘轮量 | 负控制 |
|---|---|---|---|
| **B0** ⭐ | **退役前置**：枚举 outer 执行核引用的全部 checker，逐个确认有留存调用面或显式退役（§2.3b） | 无留存调用面者 N→0（当前 N=1：`outer-anchor-check.ts`） | 造一个只被退役层引用的 checker，前置检查须红 |
| **B1** | 层 1 机械脊柱写成文档 + 检查器 | exit 码/`--json` 不符者 N→0 | 造一个用 exit 3 的 checker，检查须红 |
| **B2** | `repo-root` 合一（bash+TS 成对） | 18 处 → 1 | 删共享模块，18 处编译/运行须红 |
| **B3** | `readFileSafe`/`normalizeRel`/`canonicalTestFiles` 合一 | 各 →1 | 同上 |
| **B4** ⭐ | 层 2 判定契约——**复用 `driver-result.ts` 的 `DriverResult<T>`**（§2.3a），非设计新契约 | 采纳 `driver-result` 的 checker 数 0→k（棘轮） | 删该 import，checker 的第三态须塌回二值、对应断言须红 |
| **B5** | 层 3 输入形状（path→content） | 纯函数导出的 checker 数 N→N+k | 该 checker 的测试可零 spawn 零 mkdtemp 运行 |

⊢ **B0 是唯一有【时限】的一批**——它必须在 outer 退役**之前**完成，否则孤儿静默产生。
其余各批无时限，可任意穿插。
⊢ **B4 因 §2.3a 而大幅降级**：从"设计契约 + 说服 50-70 个文件采纳"变成"复用一个已落地、
已有 3 个消费者、已有测试的词表"。**且它天然给 §1.3 的 harness 三态缺口提供了现成形状。**
⊢ **B5 是唯一真正改变可测试性的**，也最大；建议**先在 3-5 个 checker 上做示范**，
用 `audit-independence-check.ts` 作模板，**测出实际收益再决定是否推广**
（⛔ 不要凭 §1.5② 已被否定的那条链条推广）。

### 5.4 与既有已立案任务的关系（⛔ 不重复立案）

已 ready，属本 SPEC 范围但**已单独立案**，不要重复：
- `gap-not-evaluated-harness-third-state`（§1.3）
- `gap-canonical-test-files-glob-vs-realpath-divergence`（§1.6）
- `gap-writestate-atomicity-split`（§1.6）
- `gap-help-contract-incompatible-behaviors`（§2.3 层 2）
- `gap-archguard-zero-production-calls` / `gap-abi-status-lifecycle-vocab-scattered-no-named-type`

---

## 6. 本 SPEC 自身的证据等级（诚实标注）

| 主张 | 等级 |
|---|---|
| driver/gate 两处已做对 | **实读代码 + subagent 全量核实** |
| `emitPass` 零生产调用者 | **双向独立核实**（manager + subagent 各自测出） |
| NOT-EVALUATED 三义冲突 | **实读 harness + 14 抽样 + 全population grep** |
| 输入形状是可测试性杠杆 | **实测**（85 测试分类 + 真实 perFile 时长 + 样板对照） |
| 重复簇判定 | **7 个并发 subagent 逐簇实读**，含 1 反例 1 coincidental |
| 输入侧重复 ~557 行 | **按大括号配平实测**，非"平均长度×个数"估算 |
| ⭐ `driver-result` 已定义 not-evaluated 而 checker 零采纳 | **实读 `driver-result.ts` + grep 采纳面**（3 个 driver 消费者、0 个 checker） |
| ⭐ checker 调用面归属与退役风险 | **逐个 grep 可执行载体判定**（⛔ 已排除 .md 提及）；outer 引用的 12 个逐个核实注册表重叠与留存调用面 |
| **checker 重构能显著缩短套件** | **❌ 已被自己的测量否定，见 §1.5②** |
| **`../..` 在 worktree 下错误** | **❌ 已被实测推翻，见 §2.4** |
| **trigger 是"待抽取的重复"** | **❌ 已被实测推翻，见 §2.5**（脚本头注释自述已降级为库） |
| **"大量 checker 已死"** | **❌ 部分否定**：109 个中真死代码仅 6-7 个（只剩 .md 提及 6 + 零引用 1）。但 **64/109 不在统一注册表**，靠分散调用面存活——**"归属不明"成立，"已死"不成立** |
| 全仓重复总规模 | **⚠️ 未测**。已核实 15 簇（8 确证/1 反例/1 coincidental），全仓有 100 个精确同名簇 + 47 个家族簇。**"可缩减一半"目前不是实测数字，不应作为承诺** |
| checker-lib 能否加 I/O 原语 | **⚠️ 未查**（需先读 `checker-lib.test.mjs` 是否有纯净性不变式） |
| 非原子写是否真有并发读者 | **⚠️ 未验证**（结构上可能，未复现） |
| `DriverResult<T>` 语义是否 1:1 适配 checker | **⚠️ 未判定**（§2.3a 末，留给实现方） |
| manager 侧 6 个 checker 的迁移 | **⚠️ 未测**（manager 退役形态未定，§2.3b 末 / §3.7） |

**⊢ 本表自身的意义**：**14 条主张里有 4 条是"❌ 已被推翻"**，且全部由本 SPEC 的起草过程自己推翻。
**这个比例（4/14）本身是"先测再写"的收益证据**——若按初稿直接立案，会有 4 条错误前提进入任务池。
