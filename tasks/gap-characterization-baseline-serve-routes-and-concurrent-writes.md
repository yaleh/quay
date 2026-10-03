---
id: gap-characterization-baseline-serve-routes-and-concurrent-writes
title: 特征化基线：web 路由响应快照 + 任务 store 写入字节金样 / 多进程写对拍——后续 store/handler 重构「行为等价」的证据前置
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

背景（实测，来自 docs/rup 的 handler-context.md 与 store-factories.md 两份设计分析）：计划中的重构——serve 的 handler 上下文类型统一、createStore/createGoalStore 超大闭包拆分、Task 节解析加固——都缺「行为没变」的证据：没有 web 路由响应快照，也没有对任务文件写出字节的金样。没有基线，任何「行为等价」都无法证明。

<!-- dedup-ref -->
相关但机制不同：gap-status-flip-history-and-parser-diff-readings（只读取证读数，不建测试）。现成设施（先读再补缺，不要重造）：packages/quay-native/test/cas-write.test.mjs 与 concurrent-writer.mjs 已覆盖 CAS 竞争；packages/quay/test/serve*.test.mjs 已有对 handler 的直调用例。本任务只补它们**没有**的两件：

① **路由响应快照**：用真 `.quay/config.yml` 建临时 workspace（见测试里的 makeWorkspace()，裸 tasks 目录不是合法 workspace），固定夹具（若干任务/goal/ADR），对 serve 注册的**全部 GET 路由**各取一次响应，规范化易变字段（端口、时间戳、版本号、绝对路径、pid）后与入库快照文件逐路由比对；`UPDATE_SNAPSHOT=1` 重生成。路由集合必须由 packages/quay/src/serve-handlers.ts 的实际注册表导出，而不是在测试里手抄一份（手抄会漂移）。

② **store 写入字节金样 + 多进程写对拍**：对 quay-native 的 createStore，用固定输入集（覆盖：新建、改状态、改 body、改 extra/labels、加 children、带中文与代码围栏的 body）写任务，把写出的**文件字节**与入库金样比对；再起 ≥4 个子进程对同一 id 并发写（带 expectedStatus CAS）与对不同 id 并发写，断言：同 id 恰好 1 个赢家且其余得 ConflictError、最终文件可被 parseTask 读回、不同 id 全部落盘且无半写文件。先读 cas-write.test.mjs / concurrent-writer.mjs，已覆盖的断言不重复。

⛔ 只加测试与夹具，不改任何生产源码。快照/金样里不得含机器相关值（用规范化而非忽略整条路由）。

## AC

- [x] 路由快照测试通过：`scripts/test.sh packages/quay/test/characterization-serve-routes.test.mjs` exit 0
- [x] 快照的路由集合 = serve 注册表的 GET 路由集合：测试内含一条断言，从 packages/quay/src/serve-handlers.ts 的注册表导出路由并与快照键集合逐项比较，缺一项即红（`scripts/test.sh packages/quay/test/characterization-serve-routes.test.mjs` 的断言名里可 grep 到 route-set）
- [x] 路由快照能取假（负对照）：用 cp 备份后临时改动任一路由的响应渲染（如改一个 i18n 标签），重跑上条命令必须 exit 非 0，还原后再次 exit 0；把两次 exit 码贴进 Evidence（⛔ 不用 git checkout 还原，用 cp 备份）
- [x] store 写入金样与并发测试通过：`scripts/test.sh packages/quay-native/test/characterization-store-write.test.mjs` exit 0
- [x] store 金样能取假（负对照）：临时改动 packages/quay-native/src/store.ts 的序列化顺序后重跑上条命令必须 exit 非 0，还原后 exit 0；两次 exit 码进 Evidence
- [x] 两个测试文件带 `// @test-group` 标注且不在 scripts/test.sh 的 serial/lowconc 泳道之外：`scripts/test.sh --for-task gap-characterization-baseline-serve-routes-and-concurrent-writes` 的 scoped 选择里能看到这两个文件（不是 --allow-thin 的空绿）

## DoD

真实落地 = 两个特征化测试进入 scripts/test.sh 的常规套件并在 develop 上绿；之后任何改 serve handler 或 createStore 的任务，其 scoped 门都会命中这两个测试。Evidence 必须贴出负对照的两次 exit 码（红、再绿），证明基线「能取假」而不是回声（硬规则 4 推论三）。不改生产源码，所以不要求新增运行时行为。

## Touches

- tasks/gap-characterization-baseline-serve-routes-and-concurrent-writes.md
- packages/quay/test/characterization-serve-routes.test.mjs (new)
- packages/quay/test/fixtures/characterization/serve-routes.snapshot.json (new)
- packages/quay-native/test/characterization-store-write.test.mjs (new)
- packages/quay-native/test/fixtures/characterization/store-write.golden.json (new)

## Evidence

实现：**只新增 4 个文件**（2 个测试 + 2 个入库夹具），零生产源码改动 —— 负对照结束后 `git diff -- packages/quay/src packages/quay-native/src` 为空。

### ① 路由快照（AC1 / AC2 / AC3）

- 测试：`packages/quay/test/characterization-serve-routes.test.mjs`（3 用例，`// @test-group product`）
- 快照：`packages/quay/test/fixtures/characterization/serve-routes.snapshot.json`
- **路由集合由注册表导出**：`deriveGetRoutes()` 读 `packages/quay/src/serve-handlers.ts` 源码，抓 `url.pathname === "…"` 字面量与 `/^\…$/` 正则匹配器（正则转成 `/task/:param` 形态），并用括号计数剔除 `if (req.method === "POST")` 块内与 `&& req.method === "POST"` 的 POST-only 臂；找不到 POST 块时抛错（fail-closed，不猜）。断言名：`route-set: the dispatcher-derived GET routes and the snapshot keys are the same set (missing either way is red)` —— 两侧差集都断言为空，缺一项即红。当前导出 29 条 GET 路由。
- **确定性来自「播种易变输入」，不是删路由**：`QUAY_PLUGIN_ROOT` 指向夹具 plugin 树（stub kernel 导出 `KNOWN_KINDS/aliveness/carrierStats` + `resource-gate.sh` / `process-budget.sh` 输出固定 JSON），PATH 前置一个返回 `[]` 的 stub `claude`（`/sessions` 调 `claude agents --json` 是机器级读数），`HOME` 指向空目录（无会话 transcript），git 提交用 `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` 固定。规范化再把 workspace / plugin root / HOME / PATH / tmp 父目录、绑定端口、hostname、ISO 时间、epoch(秒/毫秒)、UUID、git hash、版本号替换为稳定标记。
- **负对照（cp 备份，非 git checkout）**：备份 `packages/quay/src/serve-i18n.ts`，把 `NAV_LABELS.system.en` 由 `"System"` 改成 `"SYSTEM_LABEL_PERTURBED"`：
  - `bash scripts/test.sh packages/quay/test/characterization-serve-routes.test.mjs` ⇒ **exit 1**（body 比对红，报文逐路由点名改动位置，例如 `/system: body differs at char 32282`）
  - `cp` 还原后同命令 ⇒ **exit 0**（3/3 pass）
- 快照不含机器相关值：测试内一条断言对 `os.hostname()`、tmp 父目录、plugin root、HOME、端口逐个做泄漏检查。

### ② store 写入金样 + 多进程对拍（AC4 / AC5）

- 测试：`packages/quay-native/test/characterization-store-write.test.mjs`（4 用例，`// @test-group product`）
- 金样：`packages/quay-native/test/fixtures/characterization/store-write.golden.json`
- 固定输入序列逐步记录**文件字节**：新建（带中文正文 + ```js 围栏）/ 改状态 / 改 body / 改 extra+labels / 加 children；另有一条断言要求各步字节两两不同（某步若不改变字节，它就不能取假）。
- 并发对拍：本文件以 `--writer-child` 自派发为**真实子进程**（不新增辅助文件）。≥4 进程同时 CAS 写同一 id，`expectedStatus: "ready"` ⇒ **恰好 1 个赢家**、其余 exit 2 + `ConflictError`；最终文件恰好一个 frontmatter 块、`store.get()` 读回赢家状态、无 `.lock`/`.tmp` 残留。5 个不同 id 并发创建 ⇒ 全部落盘、逐个 parse 回各自的 title、无残留。
- **与既有覆盖不重复**：`cas-write.test.mjs` 是「interloper 先跑完、CAS writer 后跑」的**时序**证明（无并发争用）；`concurrent-writer.mjs` 是同一 id 的 labels 字段穿插（锁串行化）。本任务新增「同时启动的 CAS 争用」与「不同 id 并发创建」两臂。
- **负对照（cp 备份）**：备份 `packages/quay-native/src/store.ts`，把 `serialize()` 的 `YAML.stringify(frontmatter)` 改为按键序反转 `Object.fromEntries(Object.entries(frontmatter).reverse())` —— 纯序列化**顺序**变化，解析出的字段完全不变（正是「字段级断言会漏、字节金样不会」的那类改动）：
  - `bash scripts/test.sh packages/quay-native/test/characterization-store-write.test.mjs` ⇒ **exit 1**（`step 01-create (CHAR-1.md) wrote different bytes than the golden`）
  - `cp` 还原后同命令 ⇒ **exit 0**（4/4 pass）

两次还原都用 `cp` 备份（⛔ 未用 `git checkout`），还原后两个生产文件 `git diff` 均为空。

### ③ 分组与 scoped 选择（AC6）

- 两个文件头部均带 `// @test-group product`；并各自注明 `// @load-sensitive child-spawn`（真实子进程 + 端口绑定，与同族的 `serve.test.mjs` 一致的 triage 分类，不改变泳道）。
- `bash scripts/test.sh --for-task gap-characterization-baseline-serve-routes-and-concurrent-writes --allow-thin`（在 `merge --no-edit develop` 之后重跑）⇒ **exit 0**，scoped 选择**实际选中两个文件并跑 7 个用例全绿**（4 store + 3 routes），不是空绿。选择器报 `test-selection-thin: 2/5 Touches entries` 属预期（Touches 的 5 条 = 2 测试文件 + 2 夹具 JSON + 1 任务文件，只有测试文件能解析为测试）。
- `test-file-snapshot-check` 把这两个文件列为 additions（baseline 完好，只增不减）。

### 发现（不阻塞，交 manager/outer 判）

DoD 第二句「之后任何改 serve handler 或 createStore 的任务，其 **scoped 门**都会命中这两个测试」目前**不由机制保证**：`plugin/scripts/select-tests-for-touches.ts` 的规则 1（Direct）/规则 2（basename 配对）按名字选，`serve-handlers.ts → serve-handlers*.test.mjs`、`store.ts → store*.test.mjs`，本任务这两个文件名都不落在其中；`CROSSCUT_CHECKS` 注册表也没有对应条目。要让 scoped 门命中，需给注册表加一条（或让后续任务用规则 4 的 `## Test-Files` 声明）—— 而本任务「⛔ 只加测试与夹具，不改任何生产源码」禁止改选择器，且 Touches 未声明该文件。**基线本身对每次 fan-in 仍生效**：两文件都在默认 glob `packages/*/test/*.test.mjs` 内，fan-in 的全量 suite 每轮都会跑到；只是「只跑 scoped 门」的路径不会自动带上它们。
