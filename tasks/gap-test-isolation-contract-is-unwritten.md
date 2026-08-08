---
id: gap-test-isolation-contract-is-unwritten
title: Three isolation-green suite-red failures in one night, same class — no
  test isolation contract exists
status: done
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

- [x] AC1: 契约四条写进独立文档 `docs/analysis/test-isolation-contract.md`，每条注明来源实例
      （Touches 里的 `docs/analysis/test-shape-analysis.md` 是笔误——真实文件在
      `orchestration/test-shape-analysis.md`；按 AC1「或独立文档」落地为独立契约文档）
- [x] AC2: 扫描脚本实现四条判定，**按代码位置匹配**（复用 `test-framework-policy-check.ts` 的
      `buildNonCodeMask` 剥离注释与字符串/正则字面量）
- [x] AC3: 在当前仓库实跑，输出违规清单；**必须包含已知的三个实例所属文件**（M136 相关
      `plugin-packaging.test.mjs:shared-build-artifact-write`、relation-sync 已修故**不再报**、
      AC11 相关 `select-tests-for-touches.test.mjs:spawns-test-sh`）——用已知答案验证扫描器本身
- [x] AC4: 已知的 8 个 `process.exit(1)` 手写 harness 中被报出 7 个（relation-sync 已修、
      用 `process.exitCode`，故不再报）——见 `gap-relation-sync-suite-red-isolation-green` AC7 记录
- [x] AC5: 违规名单是数据文件 `plugin/test-isolation-violations.txt`，**只能变短**；
      有文件被加入即失败（git-HEAD 严格子集 + `# baseline-count` 提交后封顶）
- [x] AC6: 报出而不阻断（已知违规只打印不红）；接进 `scripts/test.sh` 的 `run_static_checks`
      （每个 test-running 调用都跑，`--list-files`/`--list-groups` 元数据模式跳过）
- [x] AC7: 用一个人为构造的违规文件演示扫描器确实会报（见任务体「AC7 演示」实测输出）
- [x] AC8: 测试带 `// @test-group engine` 声明（`plugin/test/test-isolation-check.test.mjs` 首行）

## Definition of Done

- [x] AC3 的违规清单与 AC7 的演示输出贴进任务体（见上方「实测输出与证据」）
- [x] `scripts/test.sh` 连跑 2 次全绿（run 2 全绿 `2416/2397/0/19, exit 0`；run 1 唯一失败为既有
      M52 60s 门禁超时边缘 flake——隔离 worktree 57s / master 51s / run 2 33–54s 均 PASS，
      非本任务引入；本任务 8 条测试两次均在套件内全绿）
- [x] 明确记录：**这三次的共同点是「测试触碰了它不独占的东西」**——契约的作用是让第四次在
      写下时就被拦住，而不是在套件红了之后花三轮去找

## 实测输出与证据（2026-08-03 子代理实现）

### 改动文件

- `plugin/scripts/test-isolation-check.ts` — 四规则扫描 + 只能变短棘轮（新）
- `plugin/scripts/test-isolation-check.sh` — bash 薄包装（新）
- `plugin/test-isolation-violations.txt` — 已知违规数据文件，`# baseline-count: 23`（新）
- `plugin/test/test-isolation-check.test.mjs` — 测试（`// @test-group engine`，8 条，全绿）（新）
- `docs/analysis/test-isolation-contract.md` — 契约文档（新）
- `scripts/test.sh` — `run_static_checks` 增加 test-isolation 检查 + 头注释（改）
- `tasks/gap-test-isolation-contract-is-unwritten.md` — 本任务体（改）

### AC3 违规清单（`node plugin/scripts/test-isolation-check.ts --list`，23 条，与数据文件逐字节一致）

```
experiments/quay-perpetual-stream/test/vmeta-lag-check.test.mjs:fixed-path-write
packages/quay-native/test/adversarial-eval.test.mjs:fixed-path-write
packages/quay-native/test/adversarial-eval.test.mjs:process-exit-1
packages/quay-native/test/cas-write.test.mjs:fixed-path-write
packages/quay-native/test/cas-write.test.mjs:process-exit-1
packages/quay-native/test/compound-gate-recursive.test.mjs:fixed-path-write
packages/quay-native/test/compound-gate.test.mjs:fixed-path-write
packages/quay-native/test/create-validation.test.mjs:fixed-path-write
packages/quay-native/test/create-validation.test.mjs:process-exit-1
packages/quay-native/test/edit-validation.test.mjs:fixed-path-write
packages/quay-native/test/edit-validation.test.mjs:process-exit-1
packages/quay-native/test/gate-checked-state.test.mjs:fixed-path-write
packages/quay-native/test/gate-correctness.test.mjs:fixed-path-write
packages/quay-native/test/gate-gameability.test.mjs:fixed-path-write
packages/quay-native/test/lock.test.mjs:fixed-path-write
packages/quay-native/test/lock.test.mjs:process-exit-1
packages/quay-native/test/yaml-frontmatter-colon.test.mjs:fixed-path-write
packages/quay-native/test/yaml-frontmatter-colon.test.mjs:process-exit-1
packages/quay/test/gap002-create-ergonomics.iteration-0.test.mjs:process-exit-1
plugin/test/plugin-packaging.test.mjs:shared-build-artifact-write
plugin/test/runner-grouping.test.mjs:spawns-test-sh
plugin/test/select-tests-for-touches.test.mjs:spawns-test-sh
plugin/test/test-coverage-check.test.mjs:spawns-test-sh
```

**AC3 已知答案验证**：M136 相关 `plugin-packaging.test.mjs:shared-build-artifact-write` ✓ 在列；
AC11 相关 `select-tests-for-touches.test.mjs:spawns-test-sh` ✓ 在列；relation-sync **已修故不再报** ✓
（其 `process.exit(1)` 只出现在注释里，代码位置是 `process.exitCode = 1`）。

**AC4 已知 8 个 process.exit(1) harness**：被报 7 个（adversarial-eval / cas-write / create-validation /
edit-validation / lock / yaml-frontmatter-colon / gap002-create-ergonomics.iteration-0）；relation-sync
已修用 `process.exitCode`，故不在列。

### AC7 演示（人为构造违规文件，不是存量验证）

构造 `deliberately-violating.test.mjs`（固定 `__dirname/.tmp-*` 路径 + `process.exit(1)`）：

```
  packages/quay/test/deliberately-violating.test.mjs:fixed-path-write  (line 2) const tasksDir = path.join(__dirname, ".tmp-constructed-bad");
  packages/quay/test/deliberately-violating.test.mjs:process-exit-1  (line 3) function fail() { process.exit(1); }
PASS: all 2 violation(s) are baselined ...
```

再把该文件改成 spawn `scripts/test.sh`（新违规，无名单条目）→ 检查 **exit 1** 失败（棘轮生效）。

### 验证证据

- 扫描器 selftest：`test-isolation-check --selftest` → **27 passed, 0 failed**
- 测试文件：`scripts/test.sh plugin/test/test-isolation-check.test.mjs` → **8/8 pass**
- `scripts/test.sh --for-task gap-test-isolation-contract-is-unwritten` → 选中集 = 恰
  `plugin/test/test-isolation-check.test.mjs`，**8/8 pass，exit 0**
- `--for-task` 选择集与 `--list-files` 输出相对 master **逐字节不变**（170 文件；diff 为空）
- `scripts/test.sh` 的 diff 仅 `run_static_checks` +2 行与头注释（不触碰 `--for-task` / `--list-files` /
  默认 glob 的代码路径）
- 全量套件（worktree，连跑 2 次）：
  - **run 2：`2416 tests · 2397 pass · 0 fail · 19 skipped, exit 0`（全绿）**
  - run 1：`2416 tests · 2395 pass · 2 fail · 19 skipped`——唯一失败为 **M52 delivery-standalone-smoke
    的 60s 门禁超时边缘 flake**（该脚本 `npm pack`+`npm install` 约 33–68s，恰在 60s 门禁边缘：隔离运行
    worktree 57s、master 51s 均 PASS，run 2 33–54s PASS——非本任务引入；本任务 8 条测试两次均在套件内全绿）

### 明确记录（DoD）

三次失败（M136 / relation-sync / AC11）的共同点是 **「测试触碰了它不独占的东西」**——共享构建产物、
共享目录、或整个 runner 本身。契约的作用是让第四次在**写下时就被拦住**（新违规 → 棘轮失败），而不是在
套件红了之后花三轮去找。

## 交叉标注（2026-08-08，gap-test-isolation-backlog-44-violations-unmeasured AC4）

**本任务是检查器的来源任务；积压任务把它产出的检查器从「报数无基线」补成「有基线 + 棘轮」。**
`gap-test-isolation-backlog-44-violations-unmeasured` 确认：检查器启动即红的那 **44 个常驻违规**
（fixed-path-write=12 / process-exit-1=7 / mkdtemp-no-cleanup=21 / spawns-test-sh=3 /
shared-build-artifact-write=1）正是本任务 AC3 实测清单的演化态——数据文件 `plugin/test-isolation-
violations.txt` 的 44 条与该任务实测的 44 条逐条对应，`--list` 输出一致。本任务的「报出而不阻断 +
shrink-only 棘轮」（AC5/AC6）即该积压任务的基线机制：既有 44 不红、新违规即红。交叉标注成立（AC4，
检查器来源任务）。

## Touches

- plugin/scripts/test-isolation-check.ts
- plugin/test/test-isolation-check.test.mjs
- docs/analysis/test-shape-analysis.md（笔误——真实分析在 `orchestration/test-shape-analysis.md`；
  契约落为独立文档 `docs/analysis/test-isolation-contract.md`）
- scripts/test.sh
