---
id: gap-mkdtemp-rooted-in-the-shared-checkout-dirties-the-tree
title: "Two tests mkdtemp inside the shared checkout, so every run dirties the working tree — and neither R1 nor R7 sees it"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

外层 tick 时在共享工作树里看到一个未跟踪目录 `.quay-tmp-test-o30sII/`，追到源头：

```
packages/quay/test/ts-typecheck-gate.test.mjs:69
  const logFile = path.join(fs.mkdtempSync(path.join(REPO_ROOT, ".quay-tmp-test-")), "g.jsonl");
```

**`mkdtemp` 的根是仓库根，不是 `os.tmpdir()`。** 名字是每运行唯一的（R1 的一半满足了），
但**它落在共享检出里**——**R1 意图的另一半（不要弄脏共享树）没被满足**。

### 三个后果，两个今天已经发生过同形的事故

1. **弄脏工作树** ⇒ `restart-readiness-check.sh` 的「工作树干净」硬检查在套件运行期间会假失败。
   **这与 escalation #3 那次死锁同形**：`fast-mode-telemetry --report` 每 60 秒写一次文件，
   于是任何提交后 60 秒内树必脏，readiness 永远通不过。
2. **`git add -A` 会把它扫进提交** ⇒ 与今早 `M-FAKE-FRONTMATTER-SCOPE-M124.md` 被扫进 master
   是同一个机制（那次已 revert）。
3. **两条规则都看不见它**（实测 `test-isolation-check.sh` 对该文件零命中）：
   - **R1** 要求 `__dirname|import.meta|fileURLToPath` **且**字符串含 `.tmp`——
     这里是 `REPO_ROOT` + `".quay-tmp-test-"`，`\.tmp` 需要「点后紧跟 tmp」，而这里是 `.quay-tmp` ⇒ **不匹配**
   - **R7**（今天新增）只覆盖 LIVE 数据目录（`tasks/`/`.quay/`/`.workflow-events/`/`adr/`）⇒ **仓库根不在其中**

**⇒ 它正好落在 R1 与 R7 之间。** 这是今天第四次同一形态：**规则的名字覆盖一个类，实现覆盖一个标本**
（R1 看不见 `process.cwd()` 写入 → R6 文件级存在性 → R7 不含仓库根 → 本条）。

### 规模：2 个真实例（扫描命令与它会漏掉什么都写在这里）

```
grep -rnE "mkdtempSync\s*\(\s*path\.join\s*\(\s*(REPO_ROOT|repoRoot|__dirname|process\.cwd\(\))" \
  --include=*.test.mjs packages plugin experiments
  → 3 命中
```

| 命中 | 判定 |
|---|---|
| `packages/quay/test/ts-typecheck-gate.test.mjs:69` | **真实例**（本次现场目录的来源） |
| `experiments/quay-perpetual-stream/test/loadbearing-test-gate.test.mjs:175` | **真实例**（`__dirname` 根） |
| `plugin/test/test-isolation-check.test.mjs:57` | **扫描假阳性**——那是探测器自己的测试**字符串**，不是真写入 |

**这条扫描会漏掉什么（外层自己的 AC7 要求写明）**：它要求
`mkdtempSync(path.join(<根>` 出现在**同一行**；折行写法、或先把根存进变量再传入的写法**都会漏**。
**所以 2 是下界，不是确数**——这一点必须由探测器而不是由这条 grep 来兜底。

## Contract

```
measure shared_root_mkdtemp = `bash plugin/scripts/test-isolation-check.sh .` 输出中新规则命中的条目数字段
measure tree_dirty_after_suite = `git status --porcelain` 在一次完整套件后输出的行数字段
band tree_dirty_after_suite = 0
invariant 每运行唯一 ≠ 可以落在共享检出里；探测器覆盖「根在哪」这个类，不是某个字面前缀
invoke `bash plugin/scripts/test-isolation-check.sh .`
control 造一个 mkdtemp 根在仓库根的测试文件 ⇒ 必须报出；改成 os.tmpdir() ⇒ 必须不报
resume 先扩探测器并让它报出那 2 个活标本，再修它们
```

## Chosen mechanism

**顺序与 r1 那次相同：先让探测器看得见，再修实例。**

1. **扩 R1（或新增一条并列规则，择一并写明理由）**：判据从「`__dirname` + `.tmp` 字面」
   扩到 **「`mkdtemp` 的根解析进共享检出」**——`REPO_ROOT`/`repoRoot`/`__dirname`/`process.cwd()`
   及引用它们的变量都算，**`os.tmpdir()` 派生的永远不报**。
2. **上线时必须报出那 2 个活标本**（`ts-typecheck-gate` 与 `loadbearing-test-gate`）——
   **否则无从判断它是否真的在看**。
3. **再修这 2 个**：改成 `os.tmpdir()` 根（或已有的 `makeTmpDir` 共享助手）。
4. **加一条套件后置断言**：完整套件跑完 `git status --porcelain` 为空——
   **这条比规则更硬**，它不依赖探测器认得出哪种写法。

**不做**：不把 `.quay-tmp-test-*` 加进 `.gitignore`——**那是把症状藏起来**，
弄脏工作树的问题还在（readiness 的「干净」判据看的是 `git status`，而 gitignore 会让它假绿）。

## Acceptance Criteria

- [ ] AC1: 探测器扩到「根解析进共享检出」，理由与判据写进文件头
- [ ] AC2: **活标本验证**——扩完之后、修实例之前，必须报出上表那 **2 个真实例**（实跑输出贴任务体）
- [ ] AC3: **不得报出**扫描假阳性那一类（探测器自己测试里的字符串），逐个确认
- [ ] AC4: **双向负控制**——造一个根在仓库根的 mkdtemp ⇒ 报出；改成 `os.tmpdir()` ⇒ 不报。两个方向都贴
- [ ] AC5: 修完 2 个实例后，**完整套件跑完 `git status --porcelain` 为空**（实跑输出贴任务体）
- [ ] AC6: **不使用 `.gitignore` 掩盖**（负控制：`git check-ignore .quay-tmp-test-x` 无输出）
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC2 与 AC5 的实跑输出贴进任务体——
      **一个从没在真实仓库报出过东西的规则，与「永远返回空集」不可区分**
- [ ] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）
- [ ] 任务体记录：这是同一形态的**第四次**（R1 看不见 `process.cwd()` → R6 文件级存在性 →
      R7 不含仓库根 → 本条），**规则名覆盖类、实现覆盖标本**

## Touches

- plugin/scripts/test-isolation-check.ts
- plugin/test/test-isolation-check.test.mjs
- packages/quay/test/ts-typecheck-gate.test.mjs
- experiments/quay-perpetual-stream/test/loadbearing-test-gate.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T16:05:00Z
changed: 外层 tick 时在共享工作树里看到 `.quay-tmp-test-o30sII/`，追到 `ts-typecheck-gate.test.mjs:69`
的 `mkdtempSync(path.join(REPO_ROOT, …))`。**规模用真扫描量过并标注了下界性质**：3 命中里
**2 个真实例、1 个是探测器自己测试里的字符串**；**并写明这条 grep 会漏掉折行与变量间接的写法，
所以 2 是下界不是确数**——这正是我今天在 r1 那次把「规模是 1」说错之后加进 AC7 的纪律。
**两条规则都看不见它已实测**（`test-isolation-check.sh` 对该文件零命中）：
R1 要求 `.tmp` 字面而这里是 `.quay-tmp`（点后不紧跟 tmp）、R7 只覆盖 LIVE 数据目录不含仓库根。
**顺序照搬 r1 那次的教训**：先扩探测器并用活标本验证，再修实例。
**并预先堵住最省事的错误修法**：**不许用 `.gitignore` 掩盖**——
readiness 的「工作树干净」判据看的是 `git status`，gitignore 会让它假绿，
那是把一个可见的脏换成一个静默的绿（AC6 是它的负控制）。
**AC5 比规则更硬**：套件跑完 `git status --porcelain` 必须为空，它不依赖探测器认得出哪种写法。
