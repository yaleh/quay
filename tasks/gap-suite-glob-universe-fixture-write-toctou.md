---
id: gap-suite-glob-universe-fixture-write-toctou
title: 已宣告的「测试不得写入已签入路径」不变式没有执行者：第二个实例活在 suite glob 宇宙里（judge 判红但未登记），并发枚举者被
  TOCTOU 判成 suite 红
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：2026-09-13 worker 轮 `gap-watchdog-killed-round-writes-no-verification-round-record` 的 suite 红分诊（round 1637）。**这不是重复**——`gap-fixture-dir-write-races-whole-tree-copy`（done）修的是它发现的**那个实例**（`workflow-replay` 在 `plugin/fixtures/` 里建删 `_tmp-*`）并造了一个判定器；本条是硬规则 5b 的形态：**修了实例、也造了判定器，但判定器没接线、且同类实例不止一个仍在盘上。**

**① 施害者已被既有 judge 按位置判红**（`plugin/scripts/checked-in-write-check.ts`，该 done 任务的产物）：

```
$ node --experimental-strip-types plugin/scripts/checked-in-write-check.ts --root . \
    --files plugin/test/suite-bucket-load-sensitive-isolation.test.mjs \
            plugin/test/suite-bucket-reattr-ratchet-check.test.mjs
  writeFileSync(.../plugin/test/__no-group-fixture__.test.mjs) -> .../plugin/test/__no-group-fixture__.test.mjs
      at plugin/scripts/checked-in-write-guard.cjs:298:11
      at TestContext.<anonymous> (file://.../plugin/test/suite-bucket-load-sensitive-isolation.test.mjs:135:6)
  rmSync(.../plugin/test/__no-group-fixture__.test.mjs) -> .../plugin/test/__no-group-fixture__.test.mjs
      at TestContext.<anonymous> (file://.../plugin/test/suite-bucket-load-sensitive-isolation.test.mjs:139:8)
FAIL: 2 write(s) into the checked-in tree across 2 input(s): writeFileSync -> ...; rmSync -> ...
exit=1
```

即该测试把 `plugin/test/__no-group-fixture__.test.mjs` **建后即删**（`:134` 写、`:139` finally 删），正是那个 done 任务宣告的不变式「测试不得在已签入路径下创建或删除条目」所禁止的。

**② 受害者是【无关任务】，且这次判成的是 suite 红**（真实生产读数，round 1637，commit `dab664bc4`，2026-09-13T11:05:03Z，日志 `.quay/fan-in-suite-gap-watchdog-killed-round-writes-no-verification-round-record~wk-prod-1789139008~1789296951932-6c162d.log`）：

```
✖ ③-AC8 — the REAL reattribution file has NO zombie entries (every file is still a suite test) (253.233705ms)
  Error: ENOENT: no such file or directory, open '.../plugin/test/__no-group-fixture__.test.mjs'
      at Object.readFileSync (node:fs:484:20)
      at bucketSetOf (plugin/scripts/suite-bucket-attribution.ts:295:19)
      at checkReattrRatchet (plugin/scripts/suite-bucket-reattr-ratchet-check.ts:106:23)
```

**③ 机制（TOCTOU，位置可指）**：`listSuiteFiles`（`plugin/scripts/suite-bucket-select.ts:113-157`）在**收集时** `readdirSync` + `statSync(p).isFile()` 过滤；调用方 `checkReattrRatchet` **随后**才对每个路径 `readFileSync`（`:106` 的第 1 层循环，⛔ 不是第 3 层僵尸判定——那个已由上述 done 任务修掉）。两者之间文件被删 ⇒ ENOENT 抛出 ⇒ 整个 checker 崩 ⇒ 该文件被判 `passed=false` ⇒ 整轮 suite 红，账记在**正在落地的那个无关任务**头上。

**④ 为什么这个实例比 `plugin/fixtures/` 那个更宽**：fixture 落在 `plugin/test/`，而 `plugin/test/*.test.mjs` **正在** `SUITE_GLOBS` 里（`suite-bucket-select.ts:59-63`）。原实例在 `plugin/fixtures/`，不在 `SUITE_GLOBS` 段内 ⇒ 它只与「整树拷贝者」抢 stat；本实例**改的是套件宇宙本身**，即**枚举者的输入**，所以受害面从「拷贝者」扩到「任何枚举 suite 文件集并逐个读的判定器/工具」。

**⑤ 并发是自变量（判别性读数）**：两个文件同为 `@test-group engine`（全量套件的同一并发泳道）。
- 单跑臂：`node --test plugin/test/suite-bucket-reattr-ratchet-check.test.mjs` ⇒ **8/8 pass**。
- 并发臂（轻载，`--test-concurrency=2`，同一对文件 ×10 轮）⇒ **0/10 复现**。
⇒ 复现依赖**负载/时序**（全量套件是 28 泳道 + 高负载），不是在轻载下重跑一次就能取到的；验证修法需要那个 done 任务 AC3 的双臂 harness（写入者 × 读取者并发），⛔ 不是「重跑一次看还红不红」。

**⑥ 发生率（⛔ 非布尔）**：`.quay/verification-round.jsonl` 中有 `perFile[]` 的轮 **1073**，其中 `plugin/test/suite-bucket-reattr-ratchet-check.test.mjs` 失败 **11** 轮（2026-08-30 .. 2026-09-13，11 个不同任务）。**其中带本条 ENOENT 签名的只有 1 轮**（round 1637，同日新形态，6 天窗口内首次）；另 10 轮的成因是**已修的真僵尸条目**。
⚠️ **两条独立成因共用一个红点**这本身有代价：那个 done 任务的 **AC4 是「落地后该文件 perFile 失败率下降」，且它明文选了 not-evaluated 等外部读数** ⇒ 残余红若不按成因分开计数，会被读成「修法无效」（硬规则 3b 的同形：一个红点两种成因）。

**⑦ 不变式没有执行者（本条的第二个半边）**：`grep -n 'checked-in-write' plugin/scripts/runner-static-gate.ts` ⇒ **0 命中**。即 `checked-in-write-check.ts` **没有登记进静态门**，只在有人手跑时判 ⇒ 那个 done 任务宣告的不变式**在套件里没有任何执行点**。这就是第二个实例能活到今天的原因（⛔ 比「实例难修」更根本）。

## Plan

1. **取证先行（硬规则 5b 的产物）**：把「盘上还有哪些测试往已签入路径写」枚举出来——先用「文本里同时出现 `REPO_ROOT` 与写动词」预筛（预筛是索引，⛔ 不是判定），再用 **judge 对每个候选逐个精判**（按位置，硬规则 2）；产出清单 + 命中数。⛔ 只修被报出来的那一个 = 5b 的违规形态。
2. **修施害者（⛔ 不修受害者）**：把该 fixture 移出所有 `SUITE_GLOBS` 段（`plugin/test/` 的**浅** glob `plugin/test/*.test.mjs` 意味着**子目录不在宇宙内**）。候选落点 `plugin/test/fixtures/`。⚠️ 落笔前先读 `plugin/scripts/runner-grouping.ts` 的 `--classify` 路径解析，确认它对非 `plugin/test/*.test.mjs` 的路径仍读得到、仍返回 `engine`（AC1 是取证项，⛔ 不预设结论——若它依赖文件名/浅 glob，改用「把用例需要的文件复制进进程私有临时目录」那条退路并说明理由）。
3. **把 judge 接上（让不变式有执行者，三件套义务）**：`plugin/scripts/capability-catalog.sh` 声明（6 行）+ `plugin/scripts/runner-static-gate.ts` 登记（`@static-tier` / `@static-object` 须覆盖 `plugin/test/`）+ `plugin/scripts/checker-mutation-cases/checked-in-write-check.sh` 一条 mutation case。⚠️ judge 的**已知代价**（其文件头自己写明）：它只看见**跑到的**路径 ⇒ 「没跑到」不得读成「干净」；用它的 `exit 3` NOT-EVALUATED 态把这件事表达出来。
4. **（可选，⛔ 慎重）读取侧的健壮性**：给 `checkReattrRatchet`「枚举到、读不到」一个**独立取值**，⛔ 不得退化成空 bucket 集（硬规则 3b：读不到 ≠ 读到空）。若做，该取值必须与 layer-1 / layer-2 / zombie 三者都不同形，并说明它与「文件真的被删了」的关系。**⛔ 不得用「吞掉 ENOENT」来让红消失**（那会把一次真实的树变更静默吞掉）。

## Acceptance Criteria

- [ ] AC1（位置取证，⛔ 非布尔）：贴 `runner-grouping.ts --classify` 对 fixture **新落点**的实际读数（能/不能分类、返回哪个 group），并给出该落点与 `SUITE_GLOBS` 三条 glob 的关系（`SUITE_GLOBS` 的实际匹配结果，⛔ 不是「我认为」）。两种结论都可接受，但必须由读码/实跑得出。
- [ ] AC2（修施害者 + 位置判据·可取假）：修后该 fixture 不落在任何 `SUITE_GLOBS` 段内。判据 = `checked-in-write-check.ts --root . --files plugin/test/suite-bucket-load-sensitive-isolation.test.mjs` **退出码 0**（⛔ 不是 grep 关键词，硬规则 2），且该测试文件自身全绿（贴 tests/pass/fail 三行）；负控制 = 把 pre-fix 文件放回 ⇒ 同一命令 exit 1。
- [ ] AC3（判别性对照·可取假，⚠️ 核心）：以「写入者 × 读取者并发」两臂各贴读数：**修前臂 ≥1 次 ENOENT**、**修后臂 0 次**。⚠️ 若轻载下修前臂复现不出（本 Proposal ⑤ 已实测 0/10），必须**加大密度/并发**直到取到 ≥1（同那个 done 任务 AC3 的加密对照手法：两臂拷贝/写入吞吐相同、只有「写哪里」一个自变量），⛔ 只给修后的 0 不构成证据。
- [ ] AC4（不变式有执行者·可取假·三态）：`runner-static-gate.ts` 登记后，注入一个在 `plugin/test/` 下 `writeFileSync` 的夹具 ⇒ 静态门**红并点名该文件**（贴命令与输出尾部）；未注入 ⇒ 绿；judge 读不懂输入 ⇒ `exit 3` NOT-EVALUATED。**三态各贴一条真实输出**（⛔ 一个恒绿的检查比没有检查更贵，硬规则 3b）。
- [ ] AC5（生产载体验证·读产物，⚠️ 允许 not-evaluated）：落地后窗口内，`plugin/test/suite-bucket-reattr-ratchet-check.test.mjs` 的 perFile 失败中**带本条 ENOENT 签名**（`no such file or directory, open '.../__no-group-fixture__.test.mjs'`）的条数 = 0；给出窗口长度 / runs / fails，且**与僵尸成因分开计数**（见 Proposal ⑥）。runs < 20 ⇒ 记 not-evaluated 并写明 runs 数，⛔ 不得用注入数据记为通过（硬规则 4 推论三）。

## Definition of Done

- 施害者修好，且**位置判据**（judge exit 0）与负控制（放回 ⇒ exit 1）都在案。⛔ 不得靠「让读取侧吞掉 ENOENT」「给 `cp` 加重试」或「把 fixture 从 git 里删掉」来消除红——那会把一次真实的树变更静默吞掉（硬规则 3b）。
- 不变式有执行者：judge 已登记进静态门，且 AC4 的**三态**读数（红 / 绿 / NOT-EVALUATED）在案。⛔ 只接上而拿不出红控制 ⇒ 与「没接」不可分。
- AC3 的两臂读数在案（修前 ≥1、修后 0），且说明该口径为何能取假。
- AC5 的窗口读数在案，或按明文记 not-evaluated 并写明窗口长度；⛔ 不得把 not-evaluated 写成通过。
- ⛔ 不承担 `gap-fixture-dir-write-races-whole-tree-copy` 已修的那个实例（`plugin/fixtures/`），也不重开它；本条只处理「不变式无执行者 + suite glob 宇宙内的第二实例」。

## Touches

- tasks/gap-suite-glob-universe-fixture-write-toctou.md
- plugin/test/suite-bucket-load-sensitive-isolation.test.mjs
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/checked-in-write-check.ts
- plugin/scripts/capability-catalog.sh
- plugin/scripts/checker-mutation-cases/checked-in-write-check.sh
- plugin/test/checked-in-write-check.test.mjs
