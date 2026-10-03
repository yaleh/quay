---
id: gap-characterization-baseline-serve-routes-and-concurrent-writes
title: 特征化基线：web 路由响应快照 + 任务 store 写入字节金样 / 多进程写对拍——后续 store/handler 重构「行为等价」的证据前置
status: todo
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

- [ ] 路由快照测试通过：`scripts/test.sh packages/quay/test/characterization-serve-routes.test.mjs` exit 0
- [ ] 快照的路由集合 = serve 注册表的 GET 路由集合：测试内含一条断言，从 packages/quay/src/serve-handlers.ts 的注册表导出路由并与快照键集合逐项比较，缺一项即红（`scripts/test.sh packages/quay/test/characterization-serve-routes.test.mjs` 的断言名里可 grep 到 route-set）
- [ ] 路由快照能取假（负对照）：用 cp 备份后临时改动任一路由的响应渲染（如改一个 i18n 标签），重跑上条命令必须 exit 非 0，还原后再次 exit 0；把两次 exit 码贴进 Evidence（⛔ 不用 git checkout 还原，用 cp 备份）
- [ ] store 写入金样与并发测试通过：`scripts/test.sh packages/quay-native/test/characterization-store-write.test.mjs` exit 0
- [ ] store 金样能取假（负对照）：临时改动 packages/quay-native/src/store.ts 的序列化顺序后重跑上条命令必须 exit 非 0，还原后 exit 0；两次 exit 码进 Evidence
- [ ] 两个测试文件带 `// @test-group` 标注且不在 scripts/test.sh 的 serial/lowconc 泳道之外：`scripts/test.sh --for-task gap-characterization-baseline-serve-routes-and-concurrent-writes` 的 scoped 选择里能看到这两个文件（不是 --allow-thin 的空绿）

## DoD

真实落地 = 两个特征化测试进入 scripts/test.sh 的常规套件并在 develop 上绿；之后任何改 serve handler 或 createStore 的任务，其 scoped 门都会命中这两个测试。Evidence 必须贴出负对照的两次 exit 码（红、再绿），证明基线「能取假」而不是回声（硬规则 4 推论三）。不改生产源码，所以不要求新增运行时行为。

## Touches

- tasks/gap-characterization-baseline-serve-routes-and-concurrent-writes.md
- packages/quay/test/characterization-serve-routes.test.mjs (new)
- packages/quay/test/fixtures/characterization/serve-routes.snapshot.json (new)
- packages/quay-native/test/characterization-store-write.test.mjs (new)
- packages/quay-native/test/fixtures/characterization/store-write.golden.json (new)
