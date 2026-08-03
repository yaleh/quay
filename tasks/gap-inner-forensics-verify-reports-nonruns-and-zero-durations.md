---
id: gap-inner-forensics-verify-reports-nonruns-and-zero-durations
title: "inner-forensics verify counted a ps command as a suite run and reported
  0s for a 400s one — the outer's cheap-verification instrument lies"
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

`orchestration/watch/inner-forensics.mjs verify 全量套件` 是外层**唯一的廉价核实手段**——
tick 文件步骤 1 明写「核实优先查 transcript，不要靠重跑」，理由是重跑一次全量套件是 8 分钟 + 满载，
还会把内层压成 flaky。2026-08-03 02:27Z 用它核实「内层是否真跑了两次全量套件」，**它给了三个错误信号**：

```
类别「全量套件」 的调用：2 次
  02:09:14     0s  cd /home/yale/work/quay; echo "=== no test procs:"; ps aux | grep -E 'node --test|scripts/test.sh' |
  02:17:17     0s  cd /home/yale/work/quay; date -u +%H:%M:%S; bash scripts/test.sh > /tmp/full-suite-batch4c.log 2>&1;
  合计 0.0 分钟，均 0s
```

| # | 错误 | 真相 |
|---|---|---|
| 1 | 把 `ps aux \| grep -E 'node --test\|scripts/test.sh'` 归类为「全量套件」 | 那是一条 **ps 命令**，`test.sh` 出现在**单引号内**——正是分类器声称会剥离的位置 |
| 2 | 真实那条报 **0s** | 该次套件实际跑了 **~474s**（日志 `duration_ms 473965`） |
| 3 | ⚠「1 个更早的会话未被包含（很可能是 /clear 造成的断裂）」，指向 `47eb704e` | `47eb704e` 是**人在外层开的 fork 会话**，不是内层的。工具把同一 project 目录下所有会话都当成内层的 |

**若外层信了它**，会得出「内层根本没跑全量套件、或只跑了 0 秒」——而实际是两次完整的 458s/474s 全绿运行。
**这个方向的错误最危险**：它会让外层去否定内层一个正确的成果。今晚已有一次同类未遂
（`local ` 前缀导致的漏匹配差点否掉内层一个正确发现）。

### 这次是怎么绕过去的

改为**读产物**：`/tmp/full-suite-batch4{a,b,c}.log` 的 `ℹ tests/pass/fail/cancelled` 与
`FULL-SUITE-EXIT` 行。**产物给出了 transcript 给不出的东西**——batch4a 的 `cancelled 2`
（见 [[gap-no-resource-awareness-heavy-ops-run-blind]]，`fail 0` 但两个文件被 cancelled）。

**这提示了正确的修法方向**：`verify` 不该只报「命令被调用过」，该报**命令的产物说了什么**。

## Contract

```
measure  call_class = `node orchestration/watch/inner-forensics.mjs verify 全量套件` 输出中每条调用行的**类别**字段
measure  call_dur   = `node orchestration/watch/inner-forensics.mjs verify 全量套件` 输出中每条调用行的**耗时**字段（秒）
invariant 已知答案集：02:17:17 那次真实耗时 ~474s、02:09:14 那次不是套件运行
invoke   `node orchestration/watch/inner-forensics.mjs verify 全量套件 --since <ISO>`
control  构造一条只在引号内含 `scripts/test.sh` 的命令 ⇒ 必须不被归类为全量套件
resume   n/a: 单次查询，无中途产物
```

## Chosen mechanism

**三条，都用已知答案验证，不新增能力。**

1. **分类按代码位置**：剥离单引号、双引号、反引号内的内容后再匹配 `test.sh`。
   本仓库已有同款正确实现（`plugin/scripts/test-framework-policy-check.ts` 的 import 检测
   明确排除注释/字符串/正则字面量），**照抄它的做法，不重新发明**。
2. **耗时取真实值**：查明 0s 的来源（很可能是重定向/后台命令的 transcript 字段缺失），
   缺失时**报「未知」而不是 0**——`0s` 与「没测到」不可区分，正是形态 B。
3. **会话归属**：`--session` 未指定时，只把**与目标 pane 同源**的会话计入；
   无法判定归属的会话**列出但不计入**，并说明「可能属于其它会话」。
   当前把人开的 fork 当成内层的 `/clear` 断裂，是纯误报。

**不做**：不让 `verify` 去重跑任何东西。它的价值就是零干扰。

## Acceptance Criteria

- [ ] AC1: 引号内含 `scripts/test.sh` 的命令**不再**被归类为全量套件；
      用 02:09:14 那条真实命令做 fixture
- [ ] AC2: 02:17:17 那条报出的耗时与 `/tmp/full-suite-batch4c.log` 的
      `duration_ms 473965` **同量级**（不要求逐毫秒相等，要求不是 0）
- [ ] AC3: 取不到耗时时输出「未知」而非 `0s`；有 fixture 断言
- [ ] AC4: 会话归属——外层 fork 会话不再被当作内层的更早会话；
      无法判定归属的会话列出但不计入，且输出里显式说明
- [ ] AC5: **负控制**——构造一条只在引号内提到 `test.sh` 的命令，断言不被归类；
      再构造一条真实调用，断言被归类。两个方向都要有
- [ ] AC6: 用 2026-08-03 02:00–02:30Z 这个**已知答案窗口**回归：应报出恰好 3 次真实全量套件
      （batch4a/b/c），不多不少
- [ ] AC7: 测试带 `// @test-group governance` 声明

## Definition of Done

- [ ] AC6 的已知答案窗口回归输出贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿
- [ ] 明确记录：**外层唯一的廉价核实手段说了谎，且方向是「否定内层的正确成果」**。
      这次靠改读产物绕过去了——所以 `verify` 的长期形态应当是**报产物说了什么**，
      而不只是报命令被调用过

## Touches

- orchestration/watch/inner-forensics.mjs
- plugin/test/inner-forensics.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T03:19:46Z
changed: 无——本任务由外层在核实 AC1 时直接建立，证据（三个错误信号的原始输出）已在 Proposal 中逐条引用
