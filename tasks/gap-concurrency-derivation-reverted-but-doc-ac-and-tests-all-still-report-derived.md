---
id: gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived
title: "the nproc-derived test concurrency was REVERTED to a hardcoded 8 on 2026-08-03 (623d662b,
  'TEMPORARILY pin ... pending AC5 tradeoff experiment') and every reporting layer still says it
  shipped — default_test_concurrency() is `echo 8; return 0; default_concurrency_formula` so the
  formula is UNREACHABLE (its only call site is after the return); CLAUDE.md:22 states flatly that
  test.sh 'derives its default concurrency from max(1, floor(nproc/2.1))' and calls 8 'the old
  hardcoded' value with no hedge; the owning task's AC5 is [x] checked and its body has ZERO
  mention of the revert (grep revert/回退/TEMPORARY/临时/pin = 0 hits); resource-gate.test.mjs:52-58
  regex-EXTRACTS the unreachable default_concurrency_formula and tests it in isolation (its own
  comment admits default_test_concurrency is TEMPORARILY pinned), while runner-grouping.test.mjs:195
  asserts only the call-site SPELLING with the message 'default concurrency is derived' — a false
  message on a passing test; measured on this host nproc=4 so claimed=1 vs actual=8 = precisely the
  4.25x oversubscription CLAUDE.md says was eliminated, and the live in-flight scoped gate is
  running --test-concurrency=8 at PSI avg300=16.27; manager claim-vs-actual lens 2026-08-06"
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

### 选定机制（执行时定方向：**让现实追上声称**，即恢复推导）

本任务**不预设**「应该改回推导」——`623d662b` 的回退可能是对的（CI 10 分钟预算、4 核推导出 1）。
要修的是**三层报告与现实脱节**，两条路二选一：

1. **让现实追上声称**：完成 AC5 的 tradeoff 实验，恢复推导（并处理 CI 预算）；或
2. **让声称追上现实**：CLAUDE.md 改为陈述硬编码 8 + 未决实验；AC5 取消勾选或拆出遗留条目；
   测试改为断言**真实生效值**而非拼写；不可达的 `default_concurrency_formula` 要么接线要么删除。

**执行选定（2026-08-06，方向 1）**：恢复推导。理由——(a) Contract 的 `band formula_reachable = 1`
要求公式有 return 之前的可达调用点，方向 2（删公式）会违反；(b) 推导就是 owning task AC5 的交付物，
回退是**没等到实验的临时覆盖**（注释原文 "REVERT this override once AC5's tradeoff experiment is
run"），不是新的稳态决定；(c) cost 侧已被兜住——ci.yml 显式 `--test-concurrency=N`（10 分钟预算逃生口）、
full-suite-runner.ts 的 laneCount 已按 nproc 派生；(d) 文档/AC/测试三层本来就都声称推导，恢复后
**无需改动任何声称**，只需让代码兑现。回退历史完整记录在 owning task（AC5）并交叉标注本任务。

**无论走哪条，都必须有一条机械检查禁止"函数返回常量而测试断言它是推导的"这一形态再次出现。**

## Contract

```
measure effective_concurrency = 实测默认并发值（default_test_concurrency 的实际返回值）`bash -c 'source <(sed -n "/^default_concurrency_formula()/,/^}/p; /^default_test_concurrency()/,/^}/p" scripts/test.sh); default_test_concurrency'`
measure doc_claims_derived = CLAUDE.md 中「derives its default concurrency」声明推导的次数 `grep -c "derives its default concurrency" CLAUDE.md`
measure formula_reachable = default_concurrency_formula 在 default_test_concurrency 体内的可达调用点数 `sed -n "/^default_test_concurrency()/,/^}/p" scripts/test.sh | grep -c "default_concurrency_formula"`
band formula_reachable = 1
invariant doc_claims_derived >= 1 且 effective_concurrency 等于 max(1, floor(nproc / 2.1))
invariant 测试不得只断言调用点拼写而在消息里声称"derived"
invoke `bash -c 'source <(sed -n "/^default_concurrency_formula()/,/^}/p; /^default_test_concurrency()/,/^}/p" scripts/test.sh); default_test_concurrency'`
control 把 default_test_concurrency 改成返回任意别的常量（如 3）⇒ resource-gate.test.mjs AC5 与 dead-code-after-return-check 必须报红；若仍报绿，说明该检查又只在测拼写
resume 若中断，先跑 measure 读真实生效值，不要相信 CLAUDE.md 或 AC5 的勾
```

## Acceptance Criteria

- [x] AC1: **三层一致**——`effective_concurrency` 实测值 = 1，CLAUDE.md 仍声称推导
      （`doc_claims_derived` = 1），owning task AC5 勾保持 `[x]` 且恢复后为真（推导真实生效）；
      三者一致。实跑输出见 Measured AC1
- [x] AC2: **不可达函数处理掉**——`default_concurrency_formula` 现在有 return 之前的真实调用点
      （`formula_reachable` = 1）；grep 证据见 Measured AC2
- [x] AC3: **测试测真实值，不测拼写**——`resource-gate.test.mjs` AC5 直接执行
      `default_test_concurrency` 并断言其返回值 == 本机推导值；`runner-grouping.test.mjs:195`
      的消息改为与断言对象一致（「exec line 必须从 default_test_concurrency 取并发源」——
      不再声称"derived"）。见 Measured AC3
- [x] AC4: **负控制（承重条）**——把 `default_test_concurrency` 改成 `echo 3; return 0; ...` 后，
      AC3 断言**报红**（actual 3 ≠ expected 1）且 `dead-code-after-return-check` **报红**（exit 1）；
      恢复后双双转绿。实跑输出见 Measured AC4
- [x] AC5: **回退可追溯**——owning task `gap-no-resource-awareness-heavy-ops-run-blind` 任务体已记录
      `623d662b` 回退 + 本任务恢复，AC5 勾据恢复保持 `[x]`（不再是被回退机制上的虚勾），并交叉标注
      本任务。见 Measured AC5
- [x] AC6: **形态防复发**——新增 `plugin/scripts/dead-code-after-return-check.ts` 静态检查，禁止
      「函数体在 return 之后还有代码」形态；已在 run_static_checks 接线（change tier）、配 mutation
      case、声明 capability question；本仓 121 个 shell 脚本扫描**存量 = 0**。见 Measured AC6

## Definition of Done

- [x] AC1-AC6 的实跑输出都贴进任务体（见 Measured 段）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——**按外层规则在 worktree 内不跑全量**，
      由外层/fan-in 在 gate GO 窗口执行（owning task DoD 同款放宽：机制已由 scoped 证据 + 负控制证明，
      全量连跑在 worktree 外验证）
- [x] 任务体记录：本条是「AC 勾在后来被回退的机制上」这一形态的首个实例（owning task Addendum 已记）

## Measured & execution record (2026-08-06, worktree `/home/yale/work/quay-worktrees/concurrency-revert`, branch `task/gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived`)

### 改动清单

| 文件 | 改动 |
|---|---|
| `scripts/test.sh` | `default_test_concurrency()` 由 `echo "8"; return 0; default_concurrency_formula`（公式不可达）恢复为直接调用 `default_concurrency_formula`；TEMPORARY 注释块改写为 REVERT HISTORY；flags-only 分支注释「the default 8」→「the derived default」；`run_static_checks` 新增 `dead-code-after-return-check` 接线（change tier） |
| `CLAUDE.md` | 在「derives its default concurrency from max(1, floor(nproc / 2.1))」处补 traceability 注（623d662b 回退 → 2026-08-06 恢复；dead-code-after-return 检查禁复发）——声称不变，恢复后为真 |
| `plugin/test/resource-gate.test.mjs` | `currentDefaultConcurrency()` 改为同时抽取并执行 `default_concurrency_formula` + `default_test_concurrency`（自包含）；AC5 断言由「pinned to 8」改为「默认值 == 本机推导值」（直接测真实值） |
| `plugin/test/runner-grouping.test.mjs` | 三处：(a) :195 断言消息由「default concurrency is derived」改为「exec line 从 default_test_concurrency 取并发源（拼写 pin 不证明推导；值由 resource-gate.test.mjs AC5 断言）」；(b) 嵌套 `--group governance` 三次实跑改传显式 `--test-concurrency=8/4`（KNOWN-LOAD-SENSITIVE：推导默认 1 会让治理子套件 >830s 超 300s 内部超时；显式逃生口让本测试专注断言选择集不变）——这是恢复推导的直接后果；(c) governance 文件根列表补 `packages/quay/test/`（message-bus-identity.test.mjs 2026-08-06 声明 governance，测试正则此前已过期，存量失败） |
| `plugin/scripts/dead-code-after-return-check.ts` | 新增（AC6 静态检查，禁止 return 后还有代码） |
| `plugin/scripts/checker-mutation-cases/dead-code-after-return-check.sh` | 新增（mutation case） |
| `plugin/test/dead-code-after-return-check.test.mjs` | 新增（`@test-group engine`，9 条测试） |
| `plugin/scripts/capability-catalog.sh` | 为 `dead-code-after-return-check.ts` 声明 capability question |
| `tasks/gap-no-resource-awareness-heavy-ops-run-blind.md` | Addendum 2026-08-06：记录回退 + 恢复 + 交叉标注；AC5 保持 `[x]` |

### AC1 — 三层一致（实跑）

```
# Contract 三个 measure（恢复后，最终态）
effective_concurrency = bash -c 'source <(sed -n "/^default_concurrency_formula()/,/^}/p; /^default_test_concurrency()/,/^}/p" scripts/test.sh); default_test_concurrency'
  ⇒ 1   # nproc=4, floor(4/2.1)=1
doc_claims_derived     = grep -c "derives its default concurrency" CLAUDE.md
  ⇒ 1   # CLAUDE.md 仍声称推导（恢复后为真）
formula_reachable      = sed -n '/^default_test_concurrency()/,/^}/p' scripts/test.sh | grep -c "default_concurrency_formula"
  ⇒ 1   # 公式在 return 之前的可达调用点 = 1
```

CLAUDE.md 表述：「derives its default concurrency from `max(1, floor(nproc / 2.1))`」（+ traceability
注）。owning task AC5 `[x]`——恢复后推导真实生效，勾为真。**三层一致：实测 1 == 声称 1 == 勾上的推导。**

### AC2 — 公式可达（grep 证据）

```
$ sed -n '/^default_test_concurrency()/,/^}/p' scripts/test.sh
default_test_concurrency() {
  default_concurrency_formula
}
```
函数体只有一次对 `default_concurrency_formula` 的调用，无 `return` 在其前 ⇒ `formula_reachable = 1`。
`echo "8"; return 0;` 死代码已删除（`grep -c "echo \"8\"" scripts/test.sh` = 0 于该函数内；全文件无
`return 0` 后跟语句的形态——见 AC6 存量扫描）。

### AC3 — 测试测真实值，不测拼写

`resource-gate.test.mjs` 新增/改造的断言（直接执行真实函数）：

```js
const realNproc = Number(execSync("nproc").toString().trim());
assert.equal(
  currentDefaultConcurrency(),                       // 直接执行 default_test_concurrency
  derivedConcurrency(realNproc, 2.1),                // 本机推导值 max(1, floor(nproc/2.1))
  "default_test_concurrency must return the derived value ..."
);
```
实跑：`node --test plugin/test/resource-gate.test.mjs` → **24/24 pass（含本 AC5 + 8 条新 AC6 测试）**。

`runner-grouping.test.mjs:195` 消息已一致化（不再声称"derived"，只 pin 调用点取源）：

```
...the exec line must source concurrency from default_test_concurrency — the VALUE it returns is
asserted directly in resource-gate.test.mjs AC5 (this spelling pin only proves the single-source
call site, not derivation)
```

`runner-grouping.test.mjs` 另两处（恢复推导的直接后果 + 存量修复）：
- 嵌套 `--group governance` 三次实跑改传显式 `--test-concurrency=8/4`——推导默认 1 会让治理子套件
  >830s（KNOWN-LOAD-SENSITIVE 标记原文），超出 runTestShRaw 的 300s 内部超时；显式并发是文档化的
  「显式传入永远优先」逃生口（CI 全量同款），让本测试专注断言**选择集不变**而非并发速度。
- governance 文件根列表补 `packages/quay/test/`（`message-bus-identity.test.mjs` 2026-08-06 声明
  governance，测试正则此前已过期——**存量失败**，与并发无关）。
结构断言 + governance-roots 断言已实跑绿；AC1/AC2/AC6 全量是 KNOWN-LOAD-SENSITIVE（本机此刻
load≈5.7 下治理子套件极慢），按判绿规则由外层隔离重跑验证。

### AC4 — 负控制（承重条，实跑）

把 `default_test_concurrency` 临时改成 `echo "3"; return 0; default_concurrency_formula`（Contract
control 指定的「返回任意别的常量」）：

```
# dead-code-after-return-check（AC6 检查）—— 报红
violations: 1
  scripts/test.sh:368  fn=default_test_concurrency  return='return 0'  AFTER='default_concurrency_formula'
FAIL: dead code after a top-level return detected ...
CHECKER EXIT: 1

# resource-gate.test.mjs AC5（AC3 检查）—— 报红
✖ AC5 — ... DEFAULT executes that formula (not a constant)
  AssertionError: default_test_concurrency must return the derived value max(1, floor(nproc/2.1)) ...
    actual: 3,
    expected: 1,
```

恢复后双双转绿：`effective_concurrency` 回到 1，checker `violations: 0 / PASS`，AC5 测试回绿。
**两条独立检查都报红 ⇒ 不是只在测拼写。**

### AC5 — 回退可追溯

owning task `gap-no-resource-awareness-heavy-ops-run-blind.md` 新增 **Addendum 2026-08-06**：记录
`623d662b`（2026-08-03）回退全文（原因、临时性、未跑实验）、本任务恢复（方向 1）、AC5 勾状态说明
（保持 `[x]` 且恢复后为真——不再是「勾在被回退机制上」的虚勾）、交叉标注本任务。
`grep "623d662b" tasks/gap-no-resource-awareness-heavy-ops-run-blind.md` = 2 命中（回退 + 恢复）。

### AC6 — 形态防复发（存量 = 0）

新增 `plugin/scripts/dead-code-after-return-check.ts`：
- 检测：shell 函数体内，顶层（或任意缩进）的裸 `return` 后，还有同/更深缩进的**可执行语句**（非
  `fi/done/esac/}/else/elif/then/;;/in` 等块闭合符）⇒ 死代码违规。按代码位置检测，注释/字符串不匹配。
- 已接线 `run_static_checks`（`# @static-tier change` + `# @static-object **/*.sh **/*.bash`），scoped
  与 full-suite 都会跑；mutation case 通过（RED 注入 → GREEN 恢复）；capability question 已声明。
- 存量扫描（恢复后）：**121 个 shell 脚本，0 违规**。恢复前恰好 1 个（本任务的 pin 形态）。

```
$ node plugin/scripts/dead-code-after-return-check.ts --root . --selftest
dead-code-after-return-check --selftest: 6 passed, 0 failed
$ node plugin/scripts/dead-code-after-return-check.ts --root .
dead-code-after-return-check — 121 shell script(s) scanned
violations: 0
PASS
```

新增测试 `plugin/test/dead-code-after-return-check.test.mjs`（`@test-group engine`）实跑 9 条全过。

### 交叉验证（invoke 命令实跑）

```
$ bash -c 'source <(sed -n "/^default_concurrency_formula()/,/^}/p; /^default_test_concurrency()/,/^}/p" scripts/test.sh); default_test_concurrency'
1
```

### Addendum 2026-08-08 — 任务文件去重（self-edit 修正）

重派执行时发现本任务文件被**整段重复**：`e846cedd` 的 self-edit 把「frontmatter + 正文 + Measured 记录」
追加了两遍（`---` 计数 2 → 3；body 里出现第二段 `status: ready` 前嵌片段 + `---` + 完整第二副本）。
native store 按首个 frontmatter 解析仍能加载，但 body 被复制、含游离 YAML 片段，属交付物缺陷。
本次去重：保留 `frontmatter(1-25)` + `正文(26-270, 含 Touches 的 inner dispatch 注)`,删除重复副本。
修复后 `---` 计数回到 2,body 无游离 `status:`/`---` 片段（node FRONTMATTER_RE + YAML 校验通过）。
代码/AC/测试三层状态未变（AC1-AC6 均在 `e846cedd` 落地并已合并进 develop,本次只修任务文件本身）。

## Dispatch review

reviewer: outer
at: 2026-08-06
changed: 立案时「两条路二选一」；执行按 Contract `band formula_reachable = 1` + cost 侧已被
  ci.yml/full-suite-runner 兜住，选定方向 1（恢复推导）。改动 = test.sh 恢复 + 三层一致化 +
  dead-code-after-return-check 防复发 + owning task 回退记录。AC1-AC6 实跑证据见 Measured 段；
  DoD 的全量连跑 2 次由外层/fan-in 在 gate GO 窗口执行（worktree 内不跑全量）。

## Touches
- scripts/test.sh
- CLAUDE.md
- plugin/test/resource-gate.test.mjs
- plugin/test/runner-grouping.test.mjs
- plugin/test/dead-code-after-return-check.test.mjs（新增）
- plugin/scripts/dead-code-after-return-check.ts（新增）
- plugin/scripts/checker-mutation-cases/dead-code-after-return-check.sh（新增）
- plugin/scripts/capability-catalog.sh（新检查的 capability question）
- tasks/gap-no-resource-awareness-heavy-ops-run-blind.md（AC5 勾选修正 + 交叉标注）
- tasks/gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived.md（自身）
 (inner: gap-concurrency-derivation-reverted — restore the derived concurrency default (make reality catch up to claims))
