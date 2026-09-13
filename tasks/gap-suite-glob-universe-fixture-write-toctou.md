---
id: gap-suite-glob-universe-fixture-write-toctou
title: 已宣告的「测试不得写入已签入路径」不变式没有执行者：第二个实例活在 suite glob 宇宙里（judge 判红但未登记），并发枚举者被
  TOCTOU 判成 suite 红
status: done
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

- [x] AC1（位置取证，⛔ 非布尔）：贴 `runner-grouping.ts --classify` 对 fixture **新落点**的实际读数（能/不能分类、返回哪个 group），并给出该落点与 `SUITE_GLOBS` 三条 glob 的关系（`SUITE_GLOBS` 的实际匹配结果，⛔ 不是「我认为」）。两种结论都可接受，但必须由读码/实跑得出。
- [x] AC2（修施害者 + 位置判据·可取假）：修后该 fixture 不落在任何 `SUITE_GLOBS` 段内。判据 = `checked-in-write-check.ts --root . --files plugin/test/suite-bucket-load-sensitive-isolation.test.mjs` **退出码 0**（⛔ 不是 grep 关键词，硬规则 2），且该测试文件自身全绿（贴 tests/pass/fail 三行）；负控制 = 把 pre-fix 文件放回 ⇒ 同一命令 exit 1。
- [x] AC3（判别性对照·可取假，⚠️ 核心）：以「写入者 × 读取者并发」两臂各贴读数：**修前臂 ≥1 次 ENOENT**、**修后臂 0 次**。⚠️ 若轻载下修前臂复现不出（本 Proposal ⑤ 已实测 0/10），必须**加大密度/并发**直到取到 ≥1（同那个 done 任务 AC3 的加密对照手法：两臂拷贝/写入吞吐相同、只有「写哪里」一个自变量），⛔ 只给修后的 0 不构成证据。
- [x] AC4（不变式有执行者·可取假·三态）：`runner-static-gate.ts` 登记后，注入一个在 `plugin/test/` 下 `writeFileSync` 的夹具 ⇒ 静态门**红并点名该文件**（贴命令与输出尾部）；未注入 ⇒ 绿；judge 读不懂输入 ⇒ `exit 3` NOT-EVALUATED。**三态各贴一条真实输出**（⛔ 一个恒绿的检查比没有检查更贵，硬规则 3b）。
- [ ] AC5（生产载体验证·读产物，⚠️ 允许 not-evaluated）：落地后窗口内，`plugin/test/suite-bucket-reattr-ratchet-check.test.mjs` 的 perFile 失败中**带本条 ENOENT 签名**（`no such file or directory, open '.../__no-group-fixture__.test.mjs'`）的条数 = 0；给出窗口长度 / runs / fails，且**与僵尸成因分开计数**（见 Proposal ⑥）。runs < 20 ⇒ 记 not-evaluated 并写明 runs 数，⛔ 不得用注入数据记为通过（硬规则 4 推论三）。 ⇒ 落地时读数：落地后窗口内 runs=0（本条尚未落地）⇒ 记 not-evaluated，见 ## Evidence 的 AC5（待外部）

## Definition of Done

- 施害者修好，且**位置判据**（judge exit 0）与负控制（放回 ⇒ exit 1）都在案。⛔ 不得靠「让读取侧吞掉 ENOENT」「给 `cp` 加重试」或「把 fixture 从 git 里删掉」来消除红——那会把一次真实的树变更静默吞掉（硬规则 3b）。
- 不变式有执行者：judge 已登记进静态门，且 AC4 的**三态**读数（红 / 绿 / NOT-EVALUATED）在案。⛔ 只接上而拿不出红控制 ⇒ 与「没接」不可分。
- AC3 的两臂读数在案（修前 ≥1、修后 0），且说明该口径为何能取假。
- AC5 的窗口读数在案，或按明文记 not-evaluated 并写明窗口长度；⛔ 不得把 not-evaluated 写成通过。
- ⛔ 不承担 `gap-fixture-dir-write-races-whole-tree-copy` 已修的那个实例（`plugin/fixtures/`），也不重开它；本条只处理「不变式无执行者 + suite glob 宇宙内的第二实例」。

## Evidence

### Plan 第 1 步 — 盘上同类实例的枚举（硬规则 5b 的产物）

预筛（**索引，⛔ 非判定**）分两级，逐级打印命中数与前 3 条：

```
① 提到 repo-root 类锚点（REPO_ROOT / __dirname,".." / process.cwd() / import.meta.dirname）
   的测试文件：408
② 其中同时含写动词（writeFileSync|appendFileSync|mkdirSync|rmSync|renameSync|copyFileSync|
   unlinkSync|createWriteStream|mkdir(|rm(|copyFile(|symlinkSync）：336
③ 再用「不使用进程私有临时目录」收窄（排除含 mkdtemp / tmpdir( / TMPDIR 者）：**32**
   前 3 条：experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs,
            experiments/quay-perpetual-stream/test/vmeta-lag-check.test.mjs,
            packages/quay-backlog/test/mcp-server.test.mjs
```

零计数侧的配套动作（硬规则 2 的另一半）：把 ③ 的谓词对一个**已知为真**的样本干跑——`checked-in-write-check.test.mjs` 与 `suite-bucket-load-sensitive-isolation.test.mjs` 都被正确排除（它们都用临时目录）。

**判定**（按位置，用 judge 对 ③ 的 32 个候选逐个精判；⛔ 非关键词）：`judgedCalls=2248`、`unread=0`（32 个输入全部完成求值——这不是一次「没跑到」的读），结果 **exit 1：52 处写落在已签入树内，分布在 6 个测试文件 / 27 个落点**：

```
  26  plugin/test/loop-shipping.test.mjs
      .loop-shipping-live-probe.md / .loop-shipping-main-repo-probe.md / .loop-shipping-enoent-probe.md
      .claude/worktrees/ls-control-407481/**  /  .claude/worktrees/residue-407481
      packages/quay/plugin-staging-407481-0  /  packages/quay/orphan-probe-407481-nc
   6  packages/quay-native/test/lock.test.mjs  （另 4 条同落点、stack 未归因）
      packages/quay-native/test/.tmp-lock-test{,/RACE-1.md,.lock,/STALE-1.md,.lock}
   4  plugin/test/runner-grouping-serial-anti-stomp.test.mjs
      plugin/test/zz-runner-grouping-undeclared.test.mjs        ← SUITE_GLOBS 之内
      plugin/test/zz-unknown-group-anti-stomp.test.mjs          ← SUITE_GLOBS 之内
   3  plugin/test/fast-mode-telemetry-gitignore.test.mjs
      milestones/fast-mode-telemetry{,/zz-gitignore-probe.json}
   2  experiments/quay-perpetual-stream/test/vmeta-lag-check.test.mjs
      experiments/quay-perpetual-stream/fixtures/vmeta/.tmp-empty-na.md
```

**其中落在 `SUITE_GLOBS` 宇宙内的只有 2 个落点**（用真枚举器逐个验，⛔ 非推断）：`plugin/test/__no-group-fixture__.test.mjs`（本条修掉的那个）与 `plugin/test/zz-runner-grouping-undeclared.test.mjs` / `zz-unknown-group-anti-stomp.test.mjs`（由 `runner-grouping-serial-anti-stomp.test.mjs` 建删）。其余 25 个落点都在三条 glob 之外 ⇒ 属 `plugin/fixtures/` 那一形态（与整树拷贝者抢 stat），⛔ 不是本条 Proposal ④ 定义的「改套件宇宙本身」形态——**两类分开计数**，不合成一个数字。

**那两个 zz- 落点本条未修，且⛔ 不能机械修**：该测试的契约**要求**夹具在真 glob 宇宙里——AC7 断言的是「真 `scripts/test.sh --group engine --list-files` 的枚举结果里**包含**这个未声明组的临时文件」（`runner-grouping-serial-anti-stomp.test.mjs:105-108`），把夹具移出 `plugin/test/` 会让枚举根本看不到它、契约无法成立。⇒ 它是**同一形态的残留成员**；修它要先决定「给 test.sh 的 metadata 模式一个 root override」或「改写该测试的契约」，属另一个任务。本条按硬规则 5b 只**枚举并记录**，⛔ 不假装盘上只有一个实例、也不把它悄悄算进「已修」。

⚠️ **两条衍生后果（写明，⛔ 不藏）**：

① 那个 zz- 夹具的存活窗口是一次嵌套 `scripts/test.sh` 调用的时长（比本条那个的微秒级**长**），其文件是 `@test-group serial`；默认调度器路径下 serial 只是**水位线**——`scripts/test.sh:1116-1120` 明写「**没有**『serial 单独先跑』的排序，只有 legacy phased 路径才有」⇒ 它与 engine 泳道的枚举者**可以重叠**，残留暴露是真的。暴露比本条那个窄：存活时间长 ⇒ 被 `readdir` 看见的概率高，但「看见后、被读之前已删」的窗口窄。
② 本条接上的 judge 是**按 delta 判定**的：`runner-grouping-serial-anti-stomp.test.mjs`（或 `lock.test.mjs` / `loop-shipping.test.mjs` / …）出现在谁的 delta 里，谁的门就会**红并点名**那个落点。这是真实缺陷被报在**改动者自己的门**上（与该 checker 的 delta 伴随件设计同形），不是无归属的连带红；但它也意味着**下一个动这些文件的任务会先撞上它**，需在那里处置（修夹具或改契约）。

### AC1 — 位置取证：`--classify` 与新落点 vs `SUITE_GLOBS`

用两个真机件（⛔ 无重新实现）对三个候选落点各取一次读数：

| 落点 | `runner-grouping.ts --classify` | `listSuiteFiles()` 实际枚举到？ |
|---|---|---|
| `plugin/test/__no-group-fixture__.test.mjs`（修前） | `engine` | **是** —— 枚举 Δ = `[plugin/test/__no-group-fixture__.test.mjs]`（630 → 631） |
| `plugin/test/fixtures/__no-group-fixture__.test.mjs`（Plan 候选） | `engine` | 否（枚举 Δ = `[]`） |
| `<os.tmpdir()>/ac1-probe-*/__no-group-fixture__.test.mjs`（**实际采用**） | `engine` | 否（不在 root 之下，枚举 Δ = `[]`） |

三个落点的原始读数（同一份 forensics，`--classify` 的输出行是 `path<TAB>group`）：

```
── OLD landing (pre-fix; inside SUITE_GLOBS)
   --classify      : engine
   in SUITE_GLOBS  : true
   enumeration Δ   : [plugin/test/__no-group-fixture__.test.mjs]
── Plan's candidate landing (plugin/test/fixtures/)
   --classify      : engine
   in SUITE_GLOBS  : false
   enumeration Δ   : []
── CHOSEN landing (process-private temp dir)
   --classify      : engine
   in SUITE_GLOBS  : false
   enumeration Δ   : []
listSuiteFiles(root) after probe cleanup: 630 files — restored=true
```

⇒ 两条结论都由**实跑**得出：

① **`--classify` 与落点无关**：`classifyFile` 对交给它的路径 `readFileSync`（`runner-grouping.ts:70-81`），是**按路径读**、不是按 glob 枚举 ⇒ 三个落点都返回 `engine`。Plan 第 2 步预设的临时目录触发条件（*若它依赖文件名/浅 glob*）**没有发生**。
② **实际采用临时目录的理由不是 ①，而是 AC2 的判据**：judge 在**运行时按解析后的落点**判定，边界是「在 repo root 之内、且在 `os.tmpdir()` 之外」，而 guard 明文写着「`os.tmpdir()` 只用于诊断、**不是豁免**」（`checked-in-write-guard.cjs:254-260`）⇒ `plugin/test/fixtures/` 能解 TOCTOU、**解不了不变式**（它仍在已签入树内，仍会被判红）。所以走的是 Plan 第 2 步的**退路**，理由比 Plan 预设的更强，并由 AC2 的负控制实测。

基线：`listSuiteFiles(root)` = **630** 文件；三个探针清理后回到 630（`restored=true`）。`SUITE_GLOBS` 三条 glob 逐字为 `packages/*/test/*.test.mjs` / `plugin/test/*.test.mjs` / `experiments/quay-perpetual-stream/test/*.test.mjs`（`suite-bucket-select.ts:59-63`）；选定落点是 `os.tmpdir()` 下的 mkdtemp 目录，**不落在任何一条之内**（前两条的浅 `*` 不下降、且它根本不在 root 之下）。

### AC2 — 修施害者 + 位置判据（含负控制）

判据（按位置判定，⛔ 非 grep 关键词）：

```
（post-fix）
$ node --experimental-strip-types plugin/scripts/checked-in-write-check.ts --root . \
    --files plugin/test/suite-bucket-load-sensitive-isolation.test.mjs
PASS: no checked-in-tree writes: 7 write-verb call(s) across 1 executed input(s), 0 inside the tree
exit=0

（负控制：git show HEAD:… 把 pre-fix 文件放回原路径，同一条命令）
  writeFileSync(.../plugin/test/__no-group-fixture__.test.mjs) -> .../plugin/test/__no-group-fixture__.test.mjs
      at TestContext.<anonymous> (file://.../plugin/test/suite-bucket-load-sensitive-isolation.test.mjs:135:6)
  rmSync(.../plugin/test/__no-group-fixture__.test.mjs) -> .../plugin/test/__no-group-fixture__.test.mjs
      at TestContext.<anonymous> (file://.../plugin/test/suite-bucket-load-sensitive-isolation.test.mjs:139:8)
FAIL: 2 write(s) into the checked-in tree across 1 input(s): writeFileSync -> ...; rmSync -> ...
exit=1
（随后 diff 与 post-fix 副本 IDENTICAL；git status --porcelain 无 no-group-fixture 条目 = 无残留）
```

⇒ 判据**能取假**：pre-fix 文件下同一命令 exit 1 并点名落点与调用点，post-fix 下 exit 0。

该测试文件自身：`ℹ tests 4 / ℹ pass 4 / ℹ fail 0`（811ms）。且修后 fixture **不落在任何 `SUITE_GLOBS` 段内**——AC1 表第 3 行：枚举 Δ = `[]`。

### AC3 — 判别性对照（写入者 × 读取者并发；⚠️ 核心）

harness：`/tmp/ac3-run.sh`（写入者 = 修前 fixture 的 create+unlink 序列跑满密度；读取者 = **真受害者** `plugin/scripts/suite-bucket-reattr-ratchet-check.ts --gate`，即 Proposal ③ 的 `listSuiteFiles` → 逐路径 `readFileSync` 那条 TOCTOU）。被枚举的 root 是 worktree 的 **hardlink 副本**（`cp -al`，排除 `.git`），所以 harness 自己不写任何已签入路径——正是不变式要求的形态。**两臂只有「写哪里」一个自变量**：写入者序列、密度、读取者、读取者数、墙钟、被枚举 root 全部相同。

```
=== 修前臂（写入者写 plugin/test/__no-group-fixture__.test.mjs，即 SUITE_GLOBS 之内）===
arm=checked-in duration=30s readers=6
  writer: {"cycles":504132,"ms":30001}
  readers: passes=407  non-zero-checker-exits=64
  distinct failure signatures:
         64 Error: ENOENT: no such file or directory, open '/tmp/ac3-copy/plugin/test/__no-group-fixture__.test.mjs'
  first failing stack:
    Error: ENOENT: no such file or directory, open '.../plugin/test/__no-group-fixture__.test.mjs'
        at Object.readFileSync (node:fs:484:20)

=== 修后臂（同一序列，写入者写进程私有目录）===
arm=private duration=30s readers=6
  writer: {"cycles":517996,"ms":30002}
  readers: passes=313  non-zero-checker-exits=0
```

**修前臂 64 次 ENOENT，修后臂 0 次**；两臂写入者吞吐相同（504,132 vs 517,996 cycles），读取者通过次数同量级（407 vs 313）。修前臂的报错**逐字等于** Proposal ② 记录的生产签名（同一个 `readFileSync (node:fs:484:20)`，同一条 fixture 路径）。

**该口径为何能取假**：修前臂在**没有任何注入**的情况下、对**真受害者**取到了 ≥1（64）次真 ENOENT ⇒ 判据在 pre-fix 状态下确实会取假；且两臂之间只改了「写入者写哪里」这一个自变量，其余全同 ⇒ 差异只能归因于落点。⛔ 只给修后的 0 不构成证据，这里两臂都在案。

### AC4 — 不变式有执行者：静态门三态 + mutation case

登记（`runner-static-gate.ts`，`@static-tier change` / `@static-object plugin/test/ packages/*/test/ experiments/*/test/`）：

```
run_checker "checked-in-write-check" node --no-warnings --experimental-strip-types \
  "${repo_root}/plugin/scripts/checked-in-write-check.ts" --changed --root "${repo_root}"
```

**态 1 红（注入一个在 `plugin/test/` 下 writeFileSync 的夹具）**：`bash scripts/test.sh --static-checks` ⇒ **exit 1**，且点名该文件：

```
  writeFileSync(plugin/test/__ac4-probe-entry__.test.mjs) -> .../plugin/test/__ac4-probe-entry__.test.mjs
      at TestContext.<anonymous> (file://.../plugin/test/__ac4-injection-probe__.test.mjs:7:6)
  rmSync(plugin/test/__ac4-probe-entry__.test.mjs) -> .../plugin/test/__ac4-probe-entry__.test.mjs
      at TestContext.<anonymous> (file://.../plugin/test/__ac4-injection-probe__.test.mjs:8:6)
FAIL: 2 write(s) into the checked-in tree across 3 input(s): writeFileSync -> ...; rmSync -> ...
STATIC_CHECK_FAILED: checked-in-write-check exit=1
checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): checked-in-write-check(exit=1)
```

**态 2 绿（未注入）**：`bash scripts/test.sh --static-checks` ⇒ **exit 0**，同一条 checker 打印：

```
PASS: no checked-in-tree writes: 109 write-verb call(s) across 2 executed input(s), 0 inside the tree
      — delta against develop (2 of 6 delta path(s) judged; unchanged test files are NOT judged by --changed)
```

**态 3 NOT-EVALUATED**（两条真实输出，两种退出码，⛔ 都不与 PASS 同形）：

```
（3a）登记的 argv 逐字，跑在一个 delta 不含测试文件的 root 上 —— scoped-safe exit 0：
NOT-EVALUATED: --changed: the delta against master carries no existing *.test.mjs/*.test.ts file
               (1 delta path(s) considered) — nothing was judged
exit=0

（3b）全表面模式 --dir 指向不存在的目录 —— canonical exit 3：
NOT-EVALUATED: no input files matched under .../plugin/test-does-not-exist — nothing was judged
exit=3
```

**为什么必须有三态**：这是本条的核心——接线前 `grep -n 'checked-in-write' runner-static-gate.ts` = **0 命中**，不变式在套件里没有任何执行点；接线后若只有「绿」这一态，就无法区分「查过且合格」与「没查成」（硬规则 3b），所以 `--changed` 的**空 delta 报 NOT-EVALUATED 而非 PASS**，并把「未改动的测试文件不在判定面内」直接印在 PASS 行上。

**mutation case**（三件套义务第 3 件，`plugin/scripts/checker-mutation-cases/checked-in-write-check.sh`，7 臂）：门内读数

```
MUTATION checked-in-write-check: pass
uncovered (registered checker with no mutation case): 0
```

臂：`GREEN(tmpdir)` / `RED(在判定树内建删夹具，相对路径拼写)` / `GREEN(还原)` / `NOT-EVALUATED(模块求值未完成)` / `--changed RED(delta 含 in-tree writer)` / `--changed NOT-EVALUATED(delta 无测试文件 ⇒ 行 + exit 0)` / `--changed GREEN(干净 delta)`；末条断言 RED 臂没有在判定树里留下夹具。

**已知覆盖边界（说明，⛔ 不是豁免）**：`--changed` 只看 delta ⇒ **未改动的测试文件本轮不在判定面内**。这是成本换来的（该 judge **逐个运行**输入，单个文件 ~1s–60s，`plugin/test` 一个目录就有 336 个文件 ⇒ 全扫比它守护的套件还贵），且与仓库既定的 delta 伴随件约定同形（`it0-split-or-commit-check --changed` / `checker-mutation-check --check-changed`）。全表面仍可手动扫：`--dir plugin/test`。

### 接线副产物：判定子进程的嵌套标记（递归断路）

judge 在子进程里**运行**被判定的测试文件；一个会 spawn `scripts/test.sh` 的测试文件会把静态门再跑一遍 ⇒ `checker → test.sh → checker` 递归。修法：子进程 env 带上 `QUAY_TEST_NESTED=1` + `QUAY_TEST_NESTED_ROOT=<root>`（`scripts/test.sh:mark_nested()` 的同一对标记）——既断递归，又让子进程的语义与「真套件里的嵌套调用」逐字一致（`run_static_checks` / `build_dist_once` 都按这对标记跳过外层已做的工作）；`_ROOT` 保留 test.sh 自己的同根守卫，子树里的嵌套调用仍付自己的检查。

### AC5 — 生产载体验证（**not-evaluated**，⛔ 非通过）

载体：`.quay/verification-round.jsonl`（67,443,129 B / 1644 条记录，其中 **1080** 条带 `perFile[]`）。

先说清谓词判什么：`perFile[]` 的条目只有 `{file, durationMs, passed, startedAtMs, endedAtMs}`，**不带报错签名** ⇒ 「带本条 ENOENT 签名」只能从该轮的失败文本（`failures` 字段 / 原始日志行）里取，**不能**从 perFile 里取。

pre-landing 基线（本条落地前的全窗口）：

```
有 perFile[] 的记录                                                      1080
其中 plugin/test/suite-bucket-reattr-ratchet-check.test.mjs 跑过的轮      675
  该文件 FAILED 的轮                                                       11
    成因 A（僵尸条目 —— 已由 gap-fixture-dir-write-races-whole-tree-copy 修）  10
    成因 B（本条 ENOENT 签名）                                                 1
覆盖窗口                          2026-08-30T14:23:53.600Z .. 2026-09-13T12:07:55.721Z
```

**两条成因确实共用同一个红点**（11 = 10 + 1）——这正是 Proposal ⑥ 的警告，本条按成因分开计数（僵尸成因 10、本条签名 1），⛔ 不把 11 读成「修法无效」。

签名谓词的实读（硬规则 2「引用计数前先打印前 3 条实际命中」）：整条载体里含 `__no-group-fixture__` 的轮 **1** 条，命中内容是

```
round=1637 task=gap-watchdog-killed-round-writes-no-verification-round-record
startedAt=2026-09-13T11:05:03.740Z state=red
  | {"line": "✖ ③-AC8 — the REAL reattribution file has NO zombie entries (every file is still a suite test) (253.233705ms)", "file": "plugin/test/__no-group-fixture__.test.mjs"}
```

零计数侧的配套动作（硬规则 2 的另一半，⛔ 只在非零时打印命中挡不住假阴性）：把 perFile 谓词对一个**已知为真**的样本干跑 —— `e['file'] == 'plugin/test/suite-bucket-reattr-ratchet-check.test.mjs'` 对一条真实 perFile 记录返回 True：

```
{"file": "plugin/test/suite-bucket-reattr-ratchet-check.test.mjs", "durationMs": 224.129354, "passed": true, "startedAtMs": 1788100516513.8706, "endedAtMs": 1788100516738}
```

⇒ 谓词不是恒假，675 这个读数是真的读到了东西。

**本条 AC5 判定 = not-evaluated**：AC5 要的是**落地后**窗口内该签名条数 = 0。本条尚未落地 ⇒ 「落地后」窗口内该文件 runs = **0**（AC5 明文：runs < 20 ⇒ 记 not-evaluated 并写明 runs 数）。⛔ 不用注入数据记为通过（硬规则 4 推论三）；⛔ 也不把 pre-landing 的 675 runs 当成落地后读数——那是**修复前**的窗口，签名在那里本来就该有 1 条。

## Touches

- tasks/gap-suite-glob-universe-fixture-write-toctou.md
- plugin/test/suite-bucket-load-sensitive-isolation.test.mjs
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/checked-in-write-check.ts
- plugin/scripts/capability-catalog.sh
- plugin/scripts/checker-mutation-cases/checked-in-write-check.sh
- plugin/test/checked-in-write-check.test.mjs
