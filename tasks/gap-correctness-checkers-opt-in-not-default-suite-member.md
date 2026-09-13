---
id: gap-correctness-checkers-opt-in-not-default-suite-member
title: 两个已修正逻辑但仍非默认套件成员的正确性相关 checker（dispatch-record 空指纹 /
  direct-to-develop-bypass-check）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

两处独立但同族的证据，均为一手核实（读码 + 现场核实注册位置），非转述：

1. **dispatch-record 空指纹漏洞唯一探测器默认不跑**：`plugin/scripts/dispatch-record.ts:157`
   对派发记录「理由缺失/过短」是 fail-closed（拒写，不落盘）；但对「指纹算不出」
   （`git hash-object` 失败等异常情形）只在 164-168 行打印 `WARNING`，并不拒写——即空指纹的
   派发记录能够正常写入磁盘，不会被写入路径本身挡住。唯一能事后抓出这类「已落盘但指纹为空」
   记录的检查器是 `plugin/scripts/dispatch-record-fingerprint-reason-check.ts`，但现场核实它
   注册在 `runner-static-gate.ts` 的 `run_operational_checks()`（opt-in 分组，需要显式传
   `--static-checks-operational` 才会执行），不在默认的 `run_static_checks()`（全量套件默认
   跑的那组），也未被任何 driver/fan-in 阻塞路径直接调用。也就是说，这个漏洞唯一的探测器
   默认情况下从不运行。

2. **direct-to-develop-bypass-check 逻辑已修好但同样非默认成员**：
   `plugin/scripts/direct-to-develop-bypass-check.ts`（检测直接提交 develop、绕过 fan-in 的行为）
   此前存在「读不懂样本时静默 `exit 0`」（伪装通过）的问题，现场重跑生产参数确认该问题已修复
   （返回值含 `evaluated:true`，能正确区分「查过且合格」与「没查成」）。但它同样只注册在
   `run_operational_checks()`（opt-in），不在默认套件，也不在任何阻塞路径——即便探测逻辑修好了，
   日常全量套件运行不会自动触发它，一个真实的直提交绕过行为在默认流程里不会被发现。

这两个 checker 的共同形态是：探测逻辑本身是正确的（或已被修好），但**它们的默认可达性为零**——
「存在一个正确的检查器」与「这个检查器实际会被运行」是两件事，本仓库目前只做到了第一件。
`run_operational_checks()` 分组本身可能是有意的性能/频率权衡（运维类检查更重/更慢，不适合每次
全量套件都跑），但现状是「opt-in 且从来没有任何机制显式触发它」——既不是「每轮跑」也不是
「按固定周期跑」，而是「从未被跑过」，与硬规则 3b「一个恒绿的检查」同样危险的镜像形态：
一个**从不执行**的检查器，在日常记录上和「一直通过」是同形的。

## Acceptance Criteria

- [x] AC1（现场量化现状，能取假）：跑一次 `plugin/scripts/runner-static-gate.ts` 的
  `run_operational_checks()` 完整调用清单（如列出该函数体内全部 `run_checker` 标签），确认
  `dispatch-record-fingerprint-reason-check.ts` 与 `direct-to-develop-bypass-check.ts` 确实都在
  其中、且贴出全库范围内对 `--static-checks-operational`（或该 flag 的实际名字）的调用点
  （grep/搜索结果，若为 0 处调用点即证实「从未被触发」）。
- [x] AC2（做出并落地明确结论，二选一，能取假）：对这两个 checker 各自给出并落地一个结论——
  要么（a）提升为默认套件成员：接入 `run_static_checks()` 或某个阻塞路径（如 fan-in/driver），
  落地后跑一次全量套件确认它们被执行到（日志/exit code 可核）；要么（b）保持 opt-in，但新增一个
  机制使其按固定周期被实际触发至少一次并把结果写入可查询的载体（如 gate-events 或专门的运行记录
  文件），落地后现场触发一次、贴出写入的记录内容为证。不允许「两头都不做」（即继续维持「存在但
  从未被跑过」的现状）。
- [x] AC3（负控制，能取假）：无论选 (a) 或 (b)，都要跑一次「故意制造一条应报红的样本」
  （如手工构造一条空指纹的派发记录，或一次直提交 develop 的样本）确认该 checker 在新的触发路径下
  确实能报红，不是接入了但从不真正评估到坏样本。
- [x] AC4（既有测试不回归）：`node --experimental-strip-types --test plugin/test/dispatch-record-fingerprint-reason-check.test.mjs plugin/test/direct-to-develop-bypass-check.test.mjs`（或覆盖这两个
  checker 的既有测试文件）exit 0。

## Definition of Done

`dispatch-record-fingerprint-reason-check.ts` 与 `direct-to-develop-bypass-check.ts` 各自的
默认可达性问题有一个明确落地的结论（提升为默认成员，或有周期性触发机制并写入可查询载体）；
负控制证明新触发路径下确实能报红；相关既有测试全绿。不是「讨论过应该怎么做」，要有真实命令输出
与落地代码为证。

## Touches

- plugin/scripts/dispatch-record.ts
- plugin/scripts/dispatch-record-fingerprint-reason-check.ts
- plugin/scripts/direct-to-develop-bypass-check.ts
- plugin/scripts/runner-static-gate.ts
- plugin/test/dispatch-record-fingerprint-reason-check.test.mjs
- plugin/test/direct-to-develop-bypass-check.test.mjs
- plugin/test/scoped-static-checks.test.mjs
- tasks/gap-correctness-checkers-opt-in-not-default-suite-member.md
