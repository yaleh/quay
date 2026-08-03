---
id: gap-test-isolation-contract-is-unwritten
title: "Three isolation-green suite-red failures in one night, same class — no
  test isolation contract exists"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

2026-08-02/03 一晚出现**三个**「隔离下 100% 绿、全量套件里红」的失败，且是同一个类：

| # | 测试 | 机制 | 已修 |
|---|---|---|---|
| 1 | M136（`plugin-packaging`） | 别的测试在套件运行中**重建共享 `dist/quay.js`** | ✓（三轮） |
| 2 | `relation-sync` | 固定共享路径 `__dirname/.tmp-relation-sync-test`（8 并发副本实测 **7/8 崩**）+ harness 静默退出 | ✓ |
| 3 | `AC11`（`select-tests-for-touches`） | 测试在套件内 **spawn 一个完整的 `scripts/test.sh`**，嵌套运行要在争抢中完成 esbuild + 一轮测试，60s 预算 | 在飞 |

三次的共同点：**测试触碰了它不独占的东西**——共享构建产物、共享目录、或整个 runner 本身。

**代价**：M136 花了三轮（整晚）、`relation-sync` 花了一轮、AC11 推翻了 AC1 的「可重现」。
而三次的**诊断成本都被同一件事放大**：手写 harness 失败时说不出话
（见 `orchestration/test-shape-analysis.md`：34 个非 `node:test` 文件，其中 **8 个**在失败路径上用
危险的 `process.exit(1)`）。

**没有任何地方写着测试可以碰什么、不可以碰什么。** 三次都是撞上了才发现。

## Chosen mechanism

**写下契约，并做成可机械扫描的检查——扫描的是「结构特征」，不是等它红。**

### 契约（初稿，直接从三个实例归纳，不预先扩充）

| 规则 | 来自 |
|---|---|
| 测试写入的路径必须是**每运行唯一**的（`mkdtemp`），不得是固定路径 | relation-sync：固定路径 8 并发下 7/8 崩 |
| 测试不得重建/覆盖**共享构建产物**（`packages/*/dist/`、`plugin/vendor/`）——要验证构建就构建到临时目录 | M136 三轮 |
| 测试不得在套件内 **spawn 完整的 runner**（`scripts/test.sh`）——它把外层负载变成内层的成败条件 | AC11 |
| 手写 harness 的失败路径必须用 `process.exitCode`，不得用 `process.exit(1)` | relation-sync：`process.exit` 不等事件循环，POSIX 管道下 stderr 是异步写 ⇒ 断言输出被丢弃 |

### 检查

一个扫描脚本，对 `scripts/test.sh --list-files` 的每个文件做静态判定：

- 写操作的目标路径是否来自 `mkdtemp` / `os.tmpdir()`
- 是否引用 `packages/*/dist/` 或 `plugin/vendor/` 且带写操作
- 是否 spawn `scripts/test.sh`
- 是否在非 `node:test` 文件里用 `process.exit(1)`

**报出而不阻断**（初期）：现存违规已知有 8+ 个 `process.exit(1)`，一次性阻断会逼人敷衍。
与 [[gap-no-test-framework-policy-for-new-tests]] 同款棘轮：**名单只能变短**。

**扫描必须匹配代码位置而非文本**——今晚有 7 次「匹配到提到它的注释而非它本身」的教训，
其中一次正是数 `relation-sync` 的 `process.exit(1)` 数到 4 处**全是解释性注释**。

## Acceptance Criteria

- [ ] AC1: 契约四条写进 `docs/analysis/test-shape-analysis.md` 或独立文档，每条注明来源实例
- [ ] AC2: 扫描脚本实现四条判定，**按代码位置匹配**（剥离注释与字符串字面量）
- [ ] AC3: 在当前仓库实跑，输出违规清单；**必须包含已知的三个实例所属文件**（M136 相关、
      relation-sync 已修故应不再报、AC11 相关）——用已知答案验证扫描器本身
- [ ] AC4: 已知的 8 个 `process.exit(1)` 手写 harness 全部被报出（清单见
      `gap-relation-sync-suite-red-isolation-green` 的 AC7 记录）
- [ ] AC5: 违规名单是数据文件，**只能变短**；有文件被加入即失败
- [ ] AC6: 报出而不阻断；接进 `scripts/test.sh` 的 engine 组
- [ ] AC7: 用一个人为构造的违规文件演示扫描器确实会报（不能只在存量上验证）
- [ ] AC8: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] AC3 的违规清单与 AC7 的演示输出贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿
- [ ] 明确记录：**这三次的共同点是「测试触碰了它不独占的东西」**——契约的作用是让第四次在
      写下时就被拦住，而不是在套件红了之后花三轮去找

## Touches

- plugin/scripts/test-isolation-check.ts
- plugin/test/test-isolation-check.test.mjs
- docs/analysis/test-shape-analysis.md
- scripts/test.sh
