---
id: gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived
title: the nproc-derived test concurrency was REVERTED to a hardcoded 8 on
  2026-08-03 (623d662b, 'TEMPORARILY pin ... pending AC5 tradeoff experiment')
  and every reporting layer still says it shipped — default_test_concurrency()
  is `echo 8; return 0; default_concurrency_formula` so the formula is
  UNREACHABLE (its only call site is after the return); CLAUDE.md:22 states
  flatly that test.sh 'derives its default concurrency from max(1,
  floor(nproc/2.1))' and calls 8 'the old hardcoded' value with no hedge; the
  owning task's AC5 is [x] checked and its body has ZERO mention of the revert
  (grep revert/回退/TEMPORARY/临时/pin = 0 hits); resource-gate.test.mjs:52-58
  regex-EXTRACTS the unreachable default_concurrency_formula and tests it in
  isolation (its own comment admits default_test_concurrency is TEMPORARILY
  pinned), while runner-grouping.test.mjs:195 asserts only the call-site
  SPELLING with the message 'default concurrency is derived' — a false message
  on a passing test; measured on this host nproc=4 so claimed=1 vs actual=8 =
  precisely the 4.25x oversubscription CLAUDE.md says was eliminated, and the
  live in-flight scoped gate is running --test-concurrency=8 at PSI
  avg300=16.27; manager claim-vs-actual lens 2026-08-06
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**推导被回退了，但文档、AC、测试三层全都还在报告「已推导」——三层同时报绿，实际行为是当初要消灭的那个缺陷。**

### 实测（全部可复算）

| 层 | 它说什么 | 实际 |
|---|---|---|
| **代码** `scripts/test.sh` | — | `default_test_concurrency() { echo "8"; return 0; default_concurrency_formula; }` —— **公式在 `return 0` 之后，不可达** |
| **文档** `CLAUDE.md:22` | 「derives its default concurrency from `max(1, floor(nproc / 2.1))`」，并称 8 是 **"the old hardcoded"** | 无任何 hedge；`echo "8"` 才是现实 |
| **AC** `gap-no-resource-awareness-heavy-ops-run-blind` | AC5 **`[x]` 已勾**；任务体 261 行仍写 `default_test_concurrency()`：4/2.1→1 | 任务体 grep `revert/回退/TEMPORARY/临时/pin` = **0 命中**，回退从未被记录 |
| **测试** `resource-gate.test.mjs:52-58` | 注释自称 "Extract the **REAL** default_concurrency_formula" | 用正则**抽取那个不可达函数**单独跑——证明了一个没人能到达的函数是对的 |
| **测试** `runner-grouping.test.mjs:195` | 断言消息：「default concurrency is **derived** (AC5)」 | 只断言**调用点的字面拼写** `$(default_test_concurrency)`；该函数返回硬编码 8 ⇒ **断言消息本身是假的，而测试是绿的** |

**回退提交**：`623d662b`（2026-08-03 07:29）"fix(test.sh): TEMPORARILY pin default concurrency back
to 8 (outer urgent correction)"。至今 **3 天**，无到期机制，无复查触发源。

**现场数值**：本机 `nproc=4` ⇒ 声称值 = `max(1, floor(4/2.1))` = **1**，实际 = **8**，
**正好是 CLAUDE.md 自己描述为「已消除」的 4.25× 超订**（8 workers + 派生子进程 = 17 进程 / 4 核）。
立案当时在飞的 scoped gate 实跑参数为 `--test-concurrency=8`，PSI avg300 = **16.27**。

### 性质

1. **「判据在没有依据时仍然给出答案」的最强实例**：三个报告层（doc / AC / test）各自都"通过"，
   但没有任何一层在测**真实生效的那个值**。测试测的是拼写和一个不可达函数。
2. **退化器官（生命体视角）**：`default_concurrency_formula` 被定义、被文档引用、被测试覆盖，
   **却没有任何可达调用点**——与「探针死 15 天、46 个测试测已删除的实现」同类。
3. **AC 失效的第三种形态**（今日前两种：AC 跨度小于问题跨度 ×2）：
   **AC 勾在一个后来被回退的机制上，且回退没有反向链接回 AC**。

### 选定机制（方向，接法留执行时）

本任务**不预设**「应该改回推导」——`623d662b` 的回退可能是对的（CI 10 分钟预算、4 核推导出 1）。
要修的是**三层报告与现实脱节**，两条路二选一：

1. **让现实追上声称**：完成 AC5 的 tradeoff 实验，恢复推导（并处理 CI 预算）；或
2. **让声称追上现实**：CLAUDE.md 改为陈述硬编码 8 + 未决实验；AC5 取消勾选或拆出遗留条目；
   测试改为断言**真实生效值**而非拼写；不可达的 `default_concurrency_formula` 要么接线要么删除。

**无论走哪条，都必须有一条机械检查禁止"函数返回常量而测试断言它是推导的"这一形态再次出现。**

## Contract

```
measure effective_concurrency = `bash -c 'source <(sed -n "/^default_test_concurrency()/,/^}/p" scripts/test.sh); default_test_concurrency'`
measure doc_claims_derived = CLAUDE.md 中「derives its default concurrency from max(1, floor(nproc / 2.1))」出现次数
measure formula_reachable = default_concurrency_formula 在 return 之前的可达调用点数
band formula_reachable = 1
invariant 文档/AC/测试所声称的并发默认值，必须等于 default_test_concurrency 的实际返回值；
  测试不得只断言调用点拼写而在消息里声称"derived"
invoke `bash -c 'source <(sed -n "/^default_test_concurrency()/,/^}/p" scripts/test.sh); default_test_concurrency'`
control 把 default_test_concurrency 改成返回任意别的常量（如 3）⇒ 新增的一致性检查必须报红；
  若仍报绿，说明该检查又只在测拼写
resume 若中断，先跑 measure 读真实生效值，不要相信 CLAUDE.md 或 AC5 的勾
```

## Acceptance Criteria

- [ ] AC1: **三层一致**——`effective_concurrency` 的实测值与 CLAUDE.md 的表述、与 AC5 的勾选状态
      三者一致；贴出实跑输出与改后的文档片段
- [ ] AC2: **不可达函数处理掉**——`default_concurrency_formula` 要么有 `return` 之前的真实调用点
      （`formula_reachable = 1`），要么被删除；贴出 grep 证据
- [ ] AC3: **测试测真实值，不测拼写**——存在一条测试直接执行 `default_test_concurrency` 并断言其
      返回值与文档一致；`runner-grouping.test.mjs:195` 那条断言消息中的 "derived" 措辞
      与其实际断言对象一致化
- [ ] AC4: **负控制（承重条）**——把 `default_test_concurrency` 改成返回 3，AC3 的检查**必须报红**；
      若报绿则本任务无效，不得以 AC1 通过为由结案
- [ ] AC5: **回退可追溯**——`gap-no-resource-awareness-heavy-ops-run-blind` 任务体记录
      `623d662b` 的回退，AC5 的勾选状态据此修正（撤勾或拆出遗留条目），并交叉标注本任务
- [ ] AC6: **形态防复发**——一条机械检查禁止「函数体在 `return` 之后还有代码」这一形态
      （或等价的：声称推导而实为常量），并在本仓其余脚本上跑一遍报出存量

## Definition of Done

- [ ] AC1-AC6 的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 任务体记录：本条是「AC 勾在后来被回退的机制上」这一形态的首个实例

## Touches
- scripts/test.sh
- CLAUDE.md
- plugin/test/resource-gate.test.mjs
- plugin/test/runner-grouping.test.mjs
- tasks/gap-no-resource-awareness-heavy-ops-run-blind.md（AC5 勾选修正 + 交叉标注）
