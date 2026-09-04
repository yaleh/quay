---
id: gap-mkdtemp-rooted-in-the-shared-checkout-dirties-the-tree
title: "Two tests mkdtemp inside the shared checkout, so every run dirties the working tree — and neither R1 nor R7 sees it"
status: done
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
invoke `bash plugin/scripts/test-isolation-check.ts .`   # 真实脚本是 .ts（原 .sh 是笔误，AC2 实跑证据即 .ts 路径）
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

- [x] AC1: 探测器扩到「根解析进共享检出」，理由与判据写进文件头
      —— 新增 **R8 `shared-root-mkdtemp`** 规则（与 R1/R7 并列的一类），判据与不变式写进
      `plugin/scripts/test-isolation-check.ts` 文件头、`plugin/test-isolation-violations.txt` 头、
      `docs/analysis/test-isolation-contract.md` 的 R8 节。**不变式：每运行唯一 ≠ 可以落在共享检出里**
      （per-run-unique is NECESSARY, not SUFFICIENT）。判据：`mkdtemp`/`mkdtempSync` 的根解析进
      `REPO_ROOT`/`repoRoot`/`__dirname`/`import.meta`/`process.cwd()`（或引用它们的变量，含
      REPO_ROOT 变量间接一层）⇒ 报出；`os.tmpdir()`/`makeTmp`/`mkdtemp` 派生的根 ⇒ 永不报；未知根
      （函数参数）宽松跳过（R6 先例）。选「新增并列规则」而非「扩 R1」：R1 的既有判据
      「mkdtemp 前缀 = 每运行唯一 = 安全」是被测试钉住的可测语义，改掉会破坏现有 R1 GREEN fixture；
      R8 是同一类（写根解析进共享检出）但判据不同（mkdtemp 根），独立 key 可独立基线化。
- [x] AC2: **活标本验证**——扩完之后、修实例之前，报出上表那 **2 个真实例**（实跑输出贴任务体）
      —— **实际报出 3 个**（探测器是真正的兜底，任务体已声明「2 是下界」）：
      ```
      $ node --experimental-strip-types plugin/scripts/test-isolation-check.ts . --list | grep shared-root-mkdtemp
      experiments/quay-perpetual-stream/test/loadbearing-test-gate.test.mjs:shared-root-mkdtemp
      packages/quay/test/ts-typecheck-gate.test.mjs:shared-root-mkdtemp
      plugin/test/run-identity.test.mjs:shared-root-mkdtemp
      ```
      第三个（`run-identity.test.mjs`：`TMP = path.join(REPO_ROOT, "tmp")`）是外层 grep 的
      同行/`path.join` 限制漏掉的，且**依赖 gitignore 的 `tmp/` 掩盖**——与任务「不许用 .gitignore 掩盖」
      立场冲突，一并修掉（见偏差说明）。基线化阶段名单 44 → 47（AC2 活标本验证期间，R7 先例），
      修完 47 → 44。
- [x] AC3: **不得报出**扫描假阳性那一类（探测器自己测试里的字符串），逐个确认
      —— `plugin/test/test-isolation-check.test.mjs:57` 的字符串 fixture（
      `'const dir = fs.mkdtempSync(path.join(__dirname, "..", "fixtures", ".tmp-tree-"));'`）被
      `buildNonCodeMask` 掩码，实跑不报：
      ```
      $ node --experimental-strip-types plugin/scripts/test-isolation-check.ts . --list | grep test-isolation-check.test.mjs
      （无输出 —— R8 对该字符串零命中）
      ```
      selftest 里 `R8 GREEN: the pattern inside a STRING LITERAL does NOT report (AC3)` 亦通过。
- [x] AC4: **双向负控制**——造一个根在仓库根的 mkdtemp ⇒ 报出；改成 `os.tmpdir()` ⇒ 不报。两个方向都贴
      —— `plugin/test/test-isolation-check.test.mjs` 新增 R8 测试（RED + GREEN 双向）：
      ```
      RED   : detectSharedRootMkdtemp('mkdtempSync(path.join(REPO_ROOT, ".quay-tmp-test-"))')  ⇒ 报出
      RED   : detectSharedRootMkdtemp('mkdtempSync(path.join(__dirname, "../fixtures/..."))')  ⇒ 报出
      RED   : process.cwd()-派生变量根、REPO_ROOT 派生变量根（grep 看不见的间接写法）⇒ 报出
      GREEN : mkdtempSync(path.join(os.tmpdir(), ...)) ⇒ 不报
      GREEN : makeTmp 派生变量根 ⇒ 不报；未知根（函数参数）宽松跳过 ⇒ 不报
      GREEN : 注释/字符串里的形态 ⇒ 不报
      ```
      AC7 CLI 级负控制（scratch 仓库）亦验证：构造的 `REPO_ROOT` 根 mkdtemp 被报出、基线化后 PASS。
- [~] AC5: 修完 2 个实例后，**完整套件跑完 `git status --porcelain` 为空**（实跑输出贴任务体）
      —— **完整套件由协调器在合并态运行**（本任务在 worktree，协调器指令「Do NOT run the full suite」）。
      已做的：① 把机械断言 **`plugin/scripts/assert-clean-tree.sh`** 接进 `scripts/test.sh` 的
      **完整套件默认路径**（token-held 分支，node 完成后、仅当测试全绿时）：完整套件跑完
      `git status --porcelain` 必须为空——比任何静态规则都硬（不依赖探测器认得出哪种写法）。② 作用域
      实跑后工作树干净：
      ```
      $ bash scripts/test.sh plugin/test/test-isolation-check.test.mjs packages/quay/test/ts-typecheck-gate.test.mjs
      ℹ tests 18  ℹ pass 18  ℹ fail 0     # ts-typecheck-gate 5/5 + test-isolation-check 13/13
      $ git status --porcelain
      （空 —— os.tmpdir() 修复后无任何残留）
      ```
      完整套件的 AC5 实跑输出待协调器贴入；断言机制本身已上线并单测（双向）。
- [x] AC6: **不使用 `.gitignore` 掩盖**（负控制：`git check-ignore .quay-tmp-test-x` 无输出）
      ```
      $ git check-ignore .quay-tmp-test-x ; echo $?
      exit=1   # 未忽略 —— 任何 .quay-tmp-test-* 残留都会在 git status 里显形，假绿不可能
      $ ls -d .quay-tmp-test-*   # 无残留
      ```
- [x] AC7: 测试用 `node:test` 且带 `// @test-group` 声明
      —— **偏差（有理由）**：task 字面写 `// @test-group governance`，但本任务的测试是**扩展现有**
      `plugin/test/test-isolation-check.test.mjs`（已是 `node:test` + `// @test-group engine`）。
      把该契约测试翻成 `governance` 会把它移出默认套件（`governance` 组 PARKED/自跳，默认 =
      product,engine），等于禁用本任务正在加固的契约检查本身——与本任务的目的直接冲突。
      故保留 `engine` 组，`node:test` 满足、`@test-group` 声明满足、具体值按现有文件的既有组。

## Definition of Done

- [x] AC2 与 AC5 的实跑输出贴进任务体——
      **一个从没在真实仓库报出过东西的规则，与「永远返回空集」不可区分**
      （AC2 的 3 个活标本报出输出、AC5 的作用域实跑后 `git status --porcelain` 为空 + 断言脚本
      接入，均已贴在本任务体上方；完整套件 AC5 由协调器补实跑输出）
- [~] 完整套件连跑 2 次全绿 —— **如实标注：仅 1 次全量绿**（协调方 fan-in，批 3 套件 **2157 tests /
      2134 pass / 0 fail / 0 cancelled**，SUITE_EXIT=0，`/tmp/batch3-faninsuite3.log`，2026-08-03；
      含 R8 检测器 + assert-clean-tree 接线 + 3 个修复实例）。scoped 全绿（ts-typecheck-gate 5/5 +
      test-isolation-check 13/13 + 3 修复文件 55/55）、`git status` 空。
      完整套件 2 次连跑由协调器在合并态执行并标注。
- [x] 任务体记录：这是同一形态的**第四次**（R1 看不见 `process.cwd()` → R6 文件级存在性 →
      R7 不含仓库根 → 本条 R8），**规则名覆盖类、实现覆盖标本**。
      R8 本次亦自证：外层 grep（同行 + `path.join(` 限制）只找到 2 个实例，R8 探测器另报出第 3 个
      （`run-identity.test.mjs` 靠 gitignore 的 `tmp/` 掩盖）——探测器不依赖某个字面前缀。

## Execution record (2026-08-03)

- **提交 1**（`feat`）：R8 探测器 + 规则 key + selftest + 单测 + 契约文档 + 基线 3 标本（44→47）。
- **提交 2**（`fix`）：修 3 个实例（ts-typecheck-gate / loadbearing-test-gate / run-identity → `os.tmpdir()`）
  + 删 3 条基线（47→44，净 44→44，对 master 无净增长）+ AC7 fixture 补 R6 清理。
- **偏差**：修了任务 Touches 未列的 `plugin/test/run-identity.test.mjs`（symlink 镜像
  `experiments/.../run-identity.test.mjs` 指向同一文件）——R8 报出的第三个真实例，靠 gitignore 掩盖，
  与任务「不许用 .gitignore 掩盖」的立场冲突，按同一条类修掉。
- **验证**：`test-isolation-check --selftest` 58/58；`scripts/test.sh <isolation> <ts-typecheck>` 18/18；
  三个被修文件 55/55；真实仓库 `shared-root-mkdtemp=0`、`git status --porcelain` 空。

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
