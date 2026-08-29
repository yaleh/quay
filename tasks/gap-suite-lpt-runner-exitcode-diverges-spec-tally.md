---
id: gap-suite-lpt-runner-exitcode-diverges-spec-tally
title: suite-lpt-runner 退出码另开 test:fail 计数器、与 spec fail tally 不同源——假红 TAP
  幻影喂脏致分叉（人 2026-08-29 报）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**（suite-lpt-runner 退出码与 spec fail tally 不同源——人 2026-08-29 报）**。

**现状（实测）**：`plugin/scripts/suite-lpt-runner.mjs` 的退出码来自**另开的一个 `test:fail` 事件计数器**，不是 spec reporter 自己报告的 fail tally：

- `:84-87` `stream.on("test:fail", () => { failed += 1 })` —— 只数真实的 `test:fail` 事件；
- `:100-101` `process.exitCode = failed > 0 ? 1 : 0` —— 退出码读这个计数器；
- `:82` `stream.compose(spec).pipe(process.stdout)` —— spec reporter 把它自己的 fail tally（`# fail N` + `not ok` 行）打到 stdout，外层 `scripts/test.sh` grep 它判绿/红。

⇒ **两个读面，两套计数**：退出码计数器 vs spec tally。正常时同形，但**桶里出现「输出假红 TAP 的失败检测测试文件」时两者分叉**——`plugin/test/full-suite-runner.test.mjs` 这类测试（它验 runner 能否【检测到】红 TAP，负路径 fake suite 输出字面 `not ok 1 - boom` / `not ok 1 - a test failure`），幻影 `not ok` 泄漏进 stdout 把 spec tally 喂脏；`test:fail` 计数器不数它（真实测试 PASS）。⇒ 退出码说绿、stdout 说红。与硬规则 5「同一容器装着两类 population、只用覆盖一类的工具去判」同族——此处是「退出码计数器与 spec tally 是两个读面，一个被幻影喂脏」。

**两条修法取一即可**：
① **单一来源**：退出码改读 spec 报告的权威计数（`# fail N`），删掉 `test:fail` 计数器——退出码与 spec tally 同源，结构上不可能分叉。
② **堵泄漏源**：让 `full-suite-runner.test.mjs` 的负路径子进程收口（capture stdout/stderr，不 inherit），假红 TAP 不外泄。

**判据1**：退出码与 spec 报告的 fail tally 同源（或假红 TAP 不再外泄），桶含「输出假红 TAP 的失败检测测试文件」时退出码与 spec tally 不再分叉。
**判据2（能取假）**：构造一个「输出假红 TAP」的测试文件放进桶 ⇒ 修复前退出码 0 / spec 红（分叉），修复后两者一致。
**判据3**：退出码与 spec tally 之间只有一条数据通路（单一来源），无第二个可漂移的计数器。

**不覆盖**：不改 node:test 内部；不改 `scripts/test.sh` 判绿/红的 grep 语义（那是外层既有契约）。

**本任务不新建过程纪律型 AC**。

## Plan

1. 定位「假红 TAP 外泄」的精确路径：`full-suite-runner.test.mjs` 负路径子进程的 stdout/stderr 去向 + `suite-lpt-runner.mjs` 的 spec 组合输出到 stdout 的路径。
2. 取修法 ① 或 ② 之一落地：
   - ①：`runOrderedSuite` 返回 spec 报告的权威 fail 计数（单一来源），`main()` 用它设退出码，删 `test:fail` 计数器。
   - ②：`full-suite-runner.test.mjs` 负路径子进程 stdio 收口（capture，不 inherit），假红 TAP 不外泄。
3. 判据2 能取假：构造「输出假红 TAP」测试文件进桶，验证修复前分叉 / 修复后一致。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：退出码与 spec fail tally 同源（或假红 TAP 不外泄），不再分叉。**Evidence:** 假红 TAP 文件（子进程 `stdio: inherit` 泄漏字面 `not ok 1 - boom`）经修复后 runner 退出码 0 且 stdout 无 `not ok`（`dropRawDiagnostics` 在 spec 前滤掉 `test:stdout`/`test:stderr`；实测该幻影确以 `test:stdout` 事件携带）；真失败文件退出 1 且 stdout `ℹ fail 1`——两读面一致。
- [x] AC2 判据2 能取假：构造「输出假红 TAP」测试文件进桶 ⇒ 修复前分叉、修复后一致。**Evidence:** 负控制（无过滤的旧 runner 形）stdout 泄漏 `not ok 1 - boom` 而 `ℹ fail 0`（退出码 0 / stdout 红 = 分叉）；修复后同一文件退出 0 且 stdout 无 `not ok`（一致）。`suite-lpt-order.test.mjs` 新增「fake-red-TAP 退出 0 + stdout 无 not ok」能取假用例通过。
- [x] AC3 判据3：退出码与 spec tally 单一来源，无第二个可漂移计数器。**Evidence:** `stream.on("test:fail")` 计数器已删；退出码改读 ROOT `test:summary` 的 `counts.failed + counts.cancelled`（与 spec 渲染的 `ℹ fail N`/`ℹ cancelled N` 同源）。测试「无 `test:fail` 计数器 + `test:summary` 单一来源」结构断言通过。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。（待外部）

## Definition of Done

- [x] 退出码与 spec fail tally 同源（或假红 TAP 不外泄）+ 能取假 + 单一来源 + 既有测试/scoped 门绿。**Evidence:** `node --test plugin/test/suite-lpt-order.test.mjs` 19/19 绿（fail 0, cancelled 0）；全量套件绿 + `--for-task` scoped 门绿由 driver 机械 fan-in 验证（AC4 待外部）。

## Touches

- plugin/scripts/suite-lpt-runner.mjs（退出码来源）
- plugin/test/full-suite-runner.test.mjs（修法②的负路径子进程收口）
- plugin/test/suite-lpt-order.test.mjs（runner 自身单测，修法①的驱动面）
- tasks/gap-suite-lpt-runner-exitcode-diverges-spec-tally.md（自身）

## Test-Files

- plugin/test/suite-lpt-order.test.mjs
