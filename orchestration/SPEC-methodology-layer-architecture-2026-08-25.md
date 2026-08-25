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
| **checker** | **109** | ⚠️ `gate-script-base` 入口面已采纳、**契约面零采纳**；`checker-lib` 4 原语 7/77 | **§2.3** |
| **state I/O** | 12 函数 | ❌ | **§2.4** |
| trigger | 2 | ❌ poll/diff/emit 骨架重复 | §2.5 |
| path/root | 18 处 | ❌ 三种策略并存 | §2.4 |
| record 校验 | 4 | ❌ | §2.4 |
| 测试集枚举 | 3 | ❌ 已立案 | §2.4 |

### 2.3 checker 契约：三层，且**分开立案**（因为三层的代价差一个量级）

```
层 1 · 机械脊柱  —— CODIFY-EXISTING（几乎免费）
    exit 0/1/2 语义      12/14 已符合
    --json 输出          13/14 已支持（56/77）
  ⇒ 写下来即可，不需要改文件

层 2 · 判定契约  —— REAL-MIGRATION（需改 50-70 文件）
    emitPass/emitFail    0/77 采纳 ← 必须先回答「为什么上一个契约无人用」
    --help 无副作用      4 种互不相容行为（已立案）
    selftest             15/77，但那 15 个高度一致（是良性少数派，不是分歧）

层 3 · 输入形状  —— 真正的可测试性杠杆，也是最大改动
    path → content：判定逻辑对【字符串】纯函数，I/O 留在薄 CLI 壳
    样板：audit-independence-check.ts（39 断言 0.49s 零 spawn）
  ⇒ ⚠️ 这一层【不应一次性推给 109 个 checker】，见 §5 棘轮
```

**⛔ 关于扩 `checker-lib` 还是新建 `checker-io`**：
`checker-lib.ts` 现有 4 个原语**全是判定侧**（源码掩码/位置匹配/枚举存在性），**不含任何 I/O**。
新增 I/O 原语前**必须先读 `checker-lib.test.mjs`**，确认是否存在"该库保持纯净/无 fs"的不变式——
若有，则应新建 `checker-io.ts` 兄弟模块而非扩它。**此项未查，留给实现方。**

### 2.4 共享 I/O 基座

- `repo-root`：**唯一需要 bash+TS 成对**的概念（TS 16 处 + bash 9 处，三种策略）。
  ⛔ 注意：`path.resolve(__dirname,'..','..')` 经实测在 task worktree 下**解析正确**
  （`plugin/` 是真实目录非符号链接）——**它不是正确性缺陷，只是可维护性问题**。
- `walk/enumerate`、`safeRead`、`recordValidate`：**TS-only**。bash checker 压倒性地读固定路径的具名
  文件（32 个里只有 3 个用 `find`），**无需并行 bash 实现**；且 ~11/32 已是 `gate_delegate_ts` /
  `exec node` 薄壳 —— **收敛到 TS 是自然路径**。
- ⛔ `SCAN_ROOTS` 类配置**作为参数传入，不被基座吸收**（§1.6）。

### 2.5 trigger：poll/diff/emit 骨架

`slot-free-trigger` 与 `suite-state-trigger` 共享"读 memo → 读当前态 → 冷启动特例 → 检测跃迁 →
推事件 → 写 memo"骨架（连注释都逐段对应）。`gate/driver.ts` 的 `runOnce` **是不同职责**（任务队列
步进），⛔ 不并入。

---

## 3. 非目标（明确排除，避免 scope 膨胀）

1. **⛔ 不重划 `packages/`**（场景 A 的架构是合理的）。
2. **⛔ 不做目录重组**（见 §4 落地顺序）——`driver-*.ts` 平铺也构成了清晰子系统，证明重组非必需。
3. **⛔ 不引入 class/继承层次**。问题从来不是"没有 class"，是**没有类型化的共享词汇**和**没有契约采纳**。
   `gate/factories` 用纯函数 + 接口做对了工厂模式，是本仓库风格可行的证明。
4. **⛔ 不以"缩短默认轮套件时间"为 checker 重构的论据**（§1.5②已自证否定）。
   若目标是套件时间，**93% 在 `packages/` 测试**，那是另一条线。
5. **⛔ 不追求"消除全部重复"**。`scanText`/`SCAN_ROOTS` 已判定为合理多样性。

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
| **B1** | 层 1 机械脊柱写成文档 + 检查器 | exit 码/`--json` 不符者 N→0 | 造一个用 exit 3 的 checker，检查须红 |
| **B2** | `repo-root` 合一（bash+TS 成对） | 18 处 → 1 | 删共享模块，18 处编译/运行须红 |
| **B3** | `readFileSafe`/`normalizeRel`/`canonicalTestFiles` 合一 | 各 →1 | 同上 |
| **B4** | 层 2 判定契约（`emitPass`/`--help`） | 0/77 → k/77（棘轮） | `--help` 前后 `.quay` mtime 集合零变化 |
| **B5** | 层 3 输入形状（path→content） | 纯函数导出的 checker 数 N→N+k | 该 checker 的测试可零 spawn 零 mkdtemp 运行 |

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
| **checker 重构能显著缩短套件** | **❌ 已被自己的测量否定，见 §1.5②** |
| **`../..` 在 worktree 下错误** | **❌ 已被实测推翻，见 §2.4** |
| 全仓重复总规模 | **⚠️ 未测**。已核实 15 簇（8 确证/1 反例/1 coincidental），全仓有 100 个精确同名簇 + 47 个家族簇。**"可缩减一半"目前不是实测数字，不应作为承诺** |
| checker-lib 能否加 I/O 原语 | **⚠️ 未查**（需先读 `checker-lib.test.mjs` 是否有纯净性不变式） |
| 非原子写是否真有并发读者 | **⚠️ 未验证**（结构上可能，未复现） |
