---
id: gap-ac926-import-criterion-take-false-carrier
title: AC-926 的 import 判据缺可取假的验收载体：注释-only 模块在旧判据下 exit 0、缺席路径 exit 3 无人钉住（GOAL-911）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-semantic-admission-contract-module
goal_ac: AC-926
---
## Proposal

**事实一（立案当轮逐字实测，cwd=/data/home/yale/work/quay，2026-10-23）**：AC-926 的判据今天红在**声明式 not-evaluated**，不是断言不合格：

```
$ # criterion 从 goals/AC-926-*.md 的 frontmatter 取出后逐字执行
$ bash /tmp/ac926-crit.sh
NOT-EVALUATED: contract module absent: ./docs/analysis/semantic-admission-contract.mjs
EXIT=3
```

这是硬规则 3b 的正确形态（「没查成」不与「查过且不合格」同形），但 AC-926 的 evidence 因此停在 `not-evaluated (declared)`；而**「这条判据本身能被取假」这一面今天没有任何载体**。

**事实二（翻转 AC-926 的交付物属于另一条任务，本任务不重做）**：契约模块本体由 `gap-semantic-admission-contract-module` 交付（顶层 `goal_ac: AC-919`，status=ready；分支 `task/gap-semantic-admission-contract-module` 的 worktree 里模块已在）。在该 worktree 内逐字跑 AC-926 的 criterion：

```
$ cd /home/yale/work/quay-worktrees/gap-semantic-admission-contract-module && bash /tmp/ac926-crit.sh
OK: real import — clue/judge vocabularies frozen, complete, disjoint; the disjointness check names an isomorphic vocabulary
EXIT=0
```

⇒ 模块落地后 AC-926 自然读绿。本任务**不新建、不改写该模块**，只补它缺的验收载体（模块本体 + 其真实 import 测试归模块任务）。

**事实三（AC-926 要修的缺陷可复现，且今天没有一条测试钉住）**：同一个「注释-only」decoy 模块（521 字节：两套词表只出现在注释里，零相关导出），两条判据给出相反读数：

```
$ bash /tmp/ac919-crit.sh     # 旧判据（readFileSync + 源码文本扫描），criterion 运行时从 goals/AC-919-*.md 读取
OK: contract present; clue excludes confirmed; judge verdicts present
EXIT=0                        ← 假模块被判绿

$ bash /tmp/ac926-crit.sh     # 新判据（runtime import）
CAUSE=CLUE_STATES/JUDGE_VERDICTS are not arrays
EXIT=1                        ← 同一个假模块被判红
```

AC-926 的存在理由正是「只在注释里提到词表也能变绿」。但仓库里没有一条测试运行这条判据本身；同级模块任务新增的 `plugin/test/semantic-admission-contract.test.mjs` 是真实 import，结构上**够不到**缺席路径（模块不在则测试直接 import 失败），也够不到「判据文本是否仍是源码扫描」这一面。

**交付物：把 AC-926 的判据本身做成可取假的验收载体** —— 新建 `plugin/test/ac926-semantic-admission-criterion.test.mjs`（顶部 `// @test-group engine`）：

- **判据单一正源，不复制**：`goalCriterion()` 从 `goals/AC-926-*.md` 的 YAML frontmatter 取 `criterion`（与 `quay goal get AC-926 --json` 同一载体；仓库根由 `import.meta.url` 解析，⛔ 不依赖 `process.cwd()`），测试内**不出现第二份判据文本**。
- `runCriterion(root)`：`spawnSync(process.execPath, ["--input-type=module", "-e", criterion], { cwd: root, encoding: "utf8" })` —— 判据里的相对路径 `./docs/analysis/semantic-admission-contract.mjs` 因此解析到沙箱根。
- 四个臂，各用 `mkdtempSync` 沙箱、`finally` 清理：
  - **A 缺席臂**：空沙箱 ⇒ `exit 3`、stderr 含 `NOT-EVALUATED`；并显式断言 `code !== 1`（not-evaluated 不是 fail）。
  - **B 注释-only decoy 臂**：上述 521 字节 decoy ⇒ `exit 1`、stderr 含 `CLUE_STATES/JUDGE_VERDICTS are not arrays`。**这一臂就是「判据不许扫源码文本」的可取假载体**：判据若退回 `readFileSync`+`includes` 形态，它会变绿。
  - **C 真模块臂**：把仓库里**真实的** `docs/analysis/semantic-admission-contract.mjs` `copyFileSync` 进沙箱 ⇒ `exit 0`（⛔ 不造 fixture 冒充真实模块，硬规则 4 推论三）。
  - **D 变异臂**（只在**副本**上改）：① `Object.freeze([...])` → `([...])` ⇒ `vocabularies are not frozen`；② clue 词表 `["candidate","clear","not-evaluated"]` → `["candidate","candidate","not-evaluated"]` ⇒ `CAUSE=CLUE_STATES=`；③ `export function checkVocabulariesDisjoint` → `function checkVocabulariesDisjoint` ⇒ `checkVocabulariesDisjoint is not exported`。每份副本先断言替换**实际发生**（文本有变化），再做判据跑——⛔ 真模块零改动。
- 判据文本取证：断言 criterion 不含 `readFileSync(` / `.includes(` / `createRequire` ⇒ 「判据是 import 形态」本身也是被断言的对象，不只是靠读数。

<!-- dedup-ref -->**与同 goal 其它验收面的关系（去重声明）**：`gap-semantic-admission-contract-module`（`goal_ac: AC-919`，ready）交付契约模块本体与真实 import 测试；`gap-unencapsulated-state-clue-judge-e2e`（`goal_ac: AC-924`，todo）依赖该模块交付端到端管线。全库 `grep -l "^goal_ac: AC-926$" tasks/*.md` 零命中；本任务与模块任务的 Touches 不重叠（模块任务只碰模块与其自身测试，本任务只新增另一个测试文件），`task-granularity-advice.ts` 对本案 Touches 返回 `peers: []` ⇒ 保持独立。**本任务依赖模块任务先落地**（顶层 `depends_on`），不重复造模块。

## Plan

1. 新建 `plugin/test/ac926-semantic-admission-criterion.test.mjs`，首行 `// @test-group engine`；只用 `node:test` / `node:assert/strict` / `node:fs` / `node:path` / `node:os` / `node:child_process` + `yaml`（仓库已有依赖，`plugin/test` 里已有 `import { parse as parseYaml } from "yaml"` 的先例）。
2. `goalCriterion()`：`readdirSync(join(REPO_ROOT,"goals"))` 找以 `AC-926-` 开头的文件（⛔ 不硬编码中文 slug），取首个 `---` 对的 frontmatter，`parseYaml(fm).criterion`；读不到 / 非字符串 ⇒ 直接 `assert.fail` 具名（⛔ 不 skip——跳过会把「载体没生效」伪装成通过）。
3. `withSandbox(fn)`：`mkdtempSync(join(tmpdir(),"ac926-crit-"))`，`fn(root)` 内按臂布置 `docs/analysis/semantic-admission-contract.mjs`，`finally` 里 `rmSync(root,{recursive:true,force:true})`。
4. 依次实现 A/B/C/D 四臂 + 判据文本取证；B 的 decoy 用字符串常量写死，注释里写明它**故意**能骗过 AC-919 旧判据（对照读数见 AC3）。
5. 跑 `node --test plugin/test/ac926-semantic-admission-criterion.test.mjs`；再逐字跑 AC-926 criterion；最后 `bash scripts/test.sh --for-task gap-ac926-import-criterion-take-false-carrier --allow-thin`。
6. 反向自检：临时把 `runCriterion` 的 `cwd` 指向仓库根（而非沙箱）⇒ A/B/D 臂必须变红（证明它们真在读沙箱，不是碰巧通过）；改回后全绿。

## AC

- [ ] AC1 载体逐字读绿：`node --test plugin/test/ac926-semantic-admission-criterion.test.mjs` ⇒ exit 0，`ℹ fail 0`；贴四个臂各自的 `(code, stderr 前缀)` 表。
- [ ] AC2 AC-926 criterion 原文读绿：从 `goals/AC-926-*.md` 取 `criterion` 写临时脚本，在**本任务 worktree 根**逐字跑 ⇒ exit 0，stdout 含 `OK: real import —`；贴命令、exit code 与 stdout 原文（立案基线 exit 3 见 Proposal 事实一）。
- [ ] AC3 B 臂能取假（旧判据对照）：同一 decoy 沙箱里跑 `goals/AC-919-*.md` 的 criterion（运行时读取，⛔ 不复制文本）⇒ exit 0；跑 AC-926 的 criterion ⇒ exit 1 且 stderr 含 `CAUSE=CLUE_STATES/JUDGE_VERDICTS are not arrays`。贴两条命令、exit code 与 stderr 原文。
- [ ] AC4 A 臂区分「缺席」与「不合格」：空沙箱 ⇒ exit **3** 且 stderr 含 `NOT-EVALUATED`；测试源码里同时含 `code !== 1` 与 `NOT-EVALUATED` 两个字面量。贴断言源码与运行输出。
- [ ] AC5 C/D 臂与真树零改动：C 臂复制真实模块 ⇒ exit 0；D 三个副本分别 ⇒ exit 1 且 stderr 依次含 `vocabularies are not frozen` / `CAUSE=CLUE_STATES=` / `checkVocabulariesDisjoint is not exported`；`git status --porcelain docs/analysis/semantic-admission-contract.mjs` 为空输出。贴读数与空 porcelain。
- [ ] AC6 判据单一正源：`node -e` 读 `goals/AC-926-*.md` 的 criterion 与测试文件全文，断言测试文件**不包含**该 criterion 原文（`verbatim_criterion_copies=0`）；`grep -n "AC-926-" plugin/test/ac926-semantic-admission-criterion.test.mjs` 命中 ≥1。贴命令与两条实际输出。
- [ ] AC7 scoped 门：`bash scripts/test.sh --for-task gap-ac926-import-criterion-take-false-carrier --allow-thin` exit 0，输出里包含新测试文件。贴尾部。

## DoD

- 判据载体在真实仓库上 exit 0，且每个臂**在被破坏时取假**：判据退回源码文本扫描 ⇒ B 臂红（注释-only 模块变绿）；模块缺席 ⇒ A 臂读到 3 而不是 1；真模块去 freeze / 改词表 / 取消导出 ⇒ D 臂红。贴三次实际读数，⛔「测试文件存在」不算完成。
- 本任务零重复交付：`git diff --stat` 不含 `docs/analysis/semantic-admission-contract.mjs`（模块落地归 `gap-semantic-admission-contract-module`）；C 臂读的是仓库真实模块，不是自造 fixture。
- 新测试进入全量 suite（`// @test-group engine`），scoped 门与 fan-in 全量跑中为绿；改动经 ff-merge 进入 develop。

## Dark Axis（ADR-007）

该轴仍暗，理由：本任务只新增一个测试文件 `plugin/test/ac926-semantic-admission-criterion.test.mjs`，零生产代码、零依赖边改动（goals/ 与契约模块都是只读消费），L_D/L_G 无本任务可归因的读数。

## Touches

- plugin/test/ac926-semantic-admission-criterion.test.mjs (new)
- tasks/gap-ac926-import-criterion-take-false-carrier.md
