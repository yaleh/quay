---
id: gap-touches-parser-early-subheading-latch-hides-declaration
title: touches-parser 的段提取被「更早的 `### Touches …` 子标题」劫持 ⇒ 声明解析成 0 条 ⇒ anti-drift
  报「每个改动文件都 out-of-declared」，任务永久不可落地（在飞阻塞器实测 9 violations）；且零 globs 与「没有声明」同形
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
---
id: gap-touches-parser-early-subheading-latch-hides-declaration
title: touches-parser 的段提取被「更早的 `### Touches …` 子标题」劫持 ⇒ 声明解析成 0 条 ⇒ anti-drift
  报「每个改动文件都 out-of-declared」，任务永久不可落地（在飞阻塞器实测 9 violations）；且零 globs 与「没有声明」同形
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**缺陷（实测 2026-09-18，本机 `/home/yale/work/quay`；⛔ 非推断）**：`plugin/scripts/touches-parser.ts:210-227`
的 `extractTouchesSection` 把**第一个**标题文本匹配 `/^touches\b/i` 的标题当作 `## Touches` 段的起点，
并在其后**遇到的第一个任意级标题**处 break。⇒ 一个位于真 `## Touches` **之前**的 `### Touches …` 子标题
会把段起点提前，段体随即被下一个 `###` 截断，**真 `## Touches` 段永远不会被读到**；函数返回 `globs = []`。

**为什么这是硬规则 3b 的教科书实例**：`globs=[]` 与「这个任务确实没有声明任何 Touches」**同形**。下游
`anti-drift-touches-check.ts` 把它与 `develop...HEAD` 的实际改动集求交 ⇒ 每一个改动文件都报
`out-of-declared: task wrote <file> (matches no declared Touches glob)` —— **报错文案指向声明本身**，
把读者（含下一个 worker）引向错误的对象。

**后果一：任务永久不可落地（实测，只读运行，未改任何东西）**

```
$ node --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts \
    --task gap-git-history-window-notes-ref-dominates \
    --worktree /home/yale/work/quay-worktrees/gap-git-history-window-notes-ref-dominates \
    --merge-target develop
ANTI-DRIFT HARD FAIL: task gap-git-history-window-notes-ref-dominates — 9 violation(s)
  out-of-declared: task wrote packages/quay/src/observation.ts (matches no declared Touches glob)
  …（9 条全部是它【已经逐条声明】的文件）
```

该任务自己的 fan-in 记录（`.quay/fan-in-gap-git-history-window-notes-ref-dominates-wk-prod-anchor.log`）：

```
{"ts":"2026-09-18T12:22:45.599Z","step":"anti-drift","exit":1,"ok":false,
 "reason":"ANTI-DRIFT HARD FAIL: task gap-git-history-window-notes-ref-dominates — 9 violation(s)"}
```

⇒ **它的 worker 无论如何修改 `## Touches` 都过不了这道闸**：它声明的清单根本没被读到。

**后果二：放大成全仓阻塞（代价所在）**：被卡的这条任务正是 code-delta fan-in 在 `step=suite` 恒红的
**解除者**（`refs/notes/quay-cmv-merge` 线性链占满 git-history 窗口，已单独立案
`gap-git-history-window-notes-ref-dominates`）⇒ 本缺陷把一个「单任务的解析 bug」变成
**全仓 code-delta 任务都无法落地**的链条。本任务自身的受害读数：`gap-webui-lang-switcher-control`
连续两轮 `step=suite` 红在一条与它 delta 无关的断言上，`judgeRetryExemption` 判 `unrelated-flaky-exempt`
⇒ 按 `worker-driver.ts:5398`（`else if (exemption.verdict !== "unrelated-flaky-exempt")`）**不计重试上限
⇒ 无限重派**，每轮烧一个完整会话（实测两轮 `wall_clock_ms` 各 ≈ 20 分钟）且成功率为 0。

**对照（硬规则 4 推论四：一个若前提为假则结果会不同的对照）** —— 同一函数、同一文件，只改**一行标题**：

```
as-is            parseTouches(body).globs.length = 0    []
heading renamed  (### Touches 最终清单 → ### 最终清单（Touches）)  = 10
heading deleted  = 10
```

⇒ 吃掉声明的是**那个子标题**，不是任务体缺声明。

**发生率（硬规则 12 要求的读数；以下为实测，非估算）** —— 对 `tasks/*.md` 全部 **2281** 个体逐一跑同一函数：

- `有 touches 标题 ∧ globs.length === 0` = **3** 条：`gap-git-history-window-notes-ref-dominates`（当时在飞，已翻 done 的受害体）、
  `gap-capability-catalog-declarations-not-enforced-at-script-creation`（done）、
  `gap-quay-has-never-self-hosted-its-own-cold-start`（done，**零是正确读数**，见 AC4）；
- 体内出现 **>1 个** touches 标题（读到哪一个纯属位置偶然）= **9** 条，其中 `DIR-099-C.md`
  与上述阻塞器是「子标题在真段之前」的有害序。

⛔ 「今天只有一条在飞任务是受害者」不改变判断：**任何**未来任务体只要写一个 `### Touches 最终清单`
式的小标题，其声明就会**静默变成零**。

**修法（本任务范围）**：两处，都在 `extractTouchesSection` 内。

1. **段的选取**改为有优先级的规则——标题文本恰为 `Touches`（大小写不敏感、trim 后）者优先，同级取最靠前者；
   无精确匹配时取**级别最高（`#` 最少）**者，同级取最靠前者。段在**其后遇到的级别 ≤ 起点级别**的标题处结束
   （子标题不再截断它自己的段）。
2. **返回值可区分（硬规则 3b）**：暴露它实际选中的标题（如 `heading` / `startLine`）⇒
   「读到了段但段里没有路径」与「根本没读到段」在读数上可区分，后者才有可能被单独报红。

⛔ 本任务**不改任何任务体**：任务体的写权限属于执行该任务的 agent（`manager-tick-log.md:7303` 引
`touches-orthogonality-check.ts:440-444` 的 self-touch 授权模型：「the executing agent has **no authorization**」），
受害体的标题只作**诊断**给出，供其自己的 worker 或人处置。

<!-- dedup-ref -->
**同族（traceability，⛔ 非前置）**：`gap-git-history-window-notes-ref-dominates`（notes 占满窗口，是后果二链条的另一端）；
`gap-fan-in-suite-red-with-no-attributable-test-still-redispatches-worker`（driver 对「归因不出」的动作分叉）；
`gap-touches-parser-strip-annotation-nested-parens`（done；同一对文件的上一处解析缺陷，Touches 形状的先例）。

**实现时的一处实测偏离（Plan 步骤 2 第二条，已在落地前用全仓读数推翻并写明）**：Plan 要求把**段结束条件**
也改成「级别 ≤ 起点级别」。落地前对 `tasks/*.md` 全部 **2299** 个体 A/B 实测该改动的后果：
**本仓库的约定是在 `## Touches` 之后紧接 `### Finding：…` 备注段，而那些备注段带散文式 bullet 列表**，
放宽后会被当成声明路径读进来 —— `DIR-075` 3→15、`gap-closed-goal-acs-leave-reverify-scope-standing-invariants-undeclared`
17→20、`gap-mcp-server-test-deadlocks-at-high-test-concurrency` 5→18、
`gap-write-ownership-extend-beyond-tasks-to-outer-core-and-hot-files` 6→8（例：
`- **① 确定性规则**：冲突路径…`、`- ① 首次（昨日…）conc=16 —— 死锁` 变成 glob）。
**那正是本任务要消灭的同一缺陷类，且是危险方向**（多出来的 glob 会让真正 out-of-declared 的写入**通过** anti-drift）。
⇒ **只改选取规则，段结束条件保持不变（任意级标题）**：实测全仓仅 **1** 个体因此改变（即预期的 0→5）。
仅选取规则就修好了 latch。

## Plan

1. **夹具先红**（`plugin/test/touches-parser-parity.test.mjs`）：加一个体 = `### Touches 最终清单` 段 + 空行 +
   `## Touches` + 两条真实路径 ⇒ 断言 `parseTouches(body).globs` 等于 `## Touches` 的两条
   （现状实得 `[]` ⇒ 用例红）。
2. **改 `extractTouchesSection`**：按上面的优先级选起点；段结束条件改为「级别 ≤ 起点级别」；返回值带上实际选中的标题/行号。
3. **边界夹具**：(a) 只有 `### Touches`（无 `## Touches`）⇒ 仍返回其子段内容（不回归）；
   (b) 两个同级 `## Touches` ⇒ 取第一个（固定语义，与现状一致）；
   (c) 正文式标题 `## Touches 声明 …` 在精确 `## Touches` **之前** ⇒ 取精确者。
4. **消费者回归**：`node --test plugin/test/touches-*.test.mjs`（15 个消费者共用这一份解析器）。

## AC

- [x] AC1（夹具先红）加用例后 `node --test plugin/test/touches-parser-parity.test.mjs` **红**，
  失败信息为「期望 2、实得 0」（或等价的 globs 数组不等）；贴原始输出。
  **✅ 满足** —— 修前同命令 `exit=1`，`ℹ tests 17 / ℹ pass 13 / ℹ fail 4`，本缺陷那条的原始断言输出：
  ```
  AssertionError [ERR_ASSERTION]: an earlier `### Touches …` subheading swallowed the real `## Touches` declaration
    actual: [],
    expected: [ 'plugin/scripts/alpha.ts', 'plugin/test/beta.test.mjs' ],
  ```
  —— **期望 2、实得 0**。另有 boundary 条 `actual: [] / expected: [ 'real.ts' ]`，以及 2 条 AC5
  （`actual: undefined / expected: 'Touches'`）。修后同命令 `exit=0`，`ℹ tests 18 / ℹ pass 18 / ℹ fail 0`。
  ⚠️ 红的是**本缺陷**那条（子标题吃掉声明），两条 no-regression 控制条（lone `### Touches`、两个同级 `## Touches`）
  修前修后都绿 —— 说明红不是别的形状造成的。

- [x] AC2（生产受害体）修后对 `tasks/gap-git-history-window-notes-ref-dominates.md` 跑导出的 `parseTouches`
  ⇒ `globs.length === 10`（现状 **0**），并把 10 条逐条打印。
  **✅ 满足（附一处必须如实标注的前提变化）** —— `globs.length === 10`，10 条如下。**但「现状 0」在本次执行时
  已不成立于【工作树里的那一份】**：受害任务自己的 worker 在它的 fan-in 里把子标题改名为
  `### 声明清单（⛔ 实现前定稿，与文末「Touches」段逐条一致，无追加）`（即提案里预判的绕法，⛔ 不是本任务的修法）。
  故「as-is = 0」这一读数取自 **git 历史里带原小标题的真受害体**（`7a6306a5d`），两份都贴：
  ```
  as-is 7a6306a5d（带 `### Touches 最终清单（…）` 子标题）: hasSection=true  globs.length=0  []
        extractTouchesSection → section = "| 文件 | 角色 | 改了什么 |\n|---|---|---|…"（一张 markdown 表格，非 bullet）
  修后 同一份 body                                         : globs.length=10
  修后 tasks/…md（worker 改名后的当前盘上版本）             : globs.length=10
  ```
  修后 10 条（两份一致，逐条打印）：
  ```
   1. packages/quay/src/observation.ts
   2. packages/quay/src/serve-git.ts
   3. packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs
   4. packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs
   5. packages/quay/test/gap-git-graph-reconstructed-lanes-all-named-mainline-ref.test.mjs
   6. packages/quay/test/gap-git-graph-ref-partition-collapses-all-topology-to-one-lane.test.mjs
   7. packages/quay/test/gap-git-graph-stride-chip-overlaps-commit-row-text.test.mjs
   8. packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs
   9. packages/quay/test/gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs
  10. tasks/gap-git-history-window-notes-ref-dominates.md
  ```

- [x] AC3（闸面端到端）`anti-drift-touches-check.ts --task gap-git-history-window-notes-ref-dominates
  --worktree <其 worktree> --merge-target develop` ⇒ `ANTI-DRIFT OK`（现状 9 violations）。
  **若该 worktree 已不存在**，改用一个**带 `### Touches x` 子标题的 fixture 任务体 + 临时 worktree**
  做等价读数，并如实标注替换对象。
  **✅ 满足（走了 AC 写明的 fallback，替换对象如实标注）** —— 受害体的 worktree
  （`/home/yale/work/quay-worktrees/gap-git-history-window-notes-ref-dominates`）**已不存在**：它已 fan-in 落地并被清理。
  等价读数用**真受害体的真 body**（`git show 7a6306a5d:…`，带原 `### Touches 最终清单` 子标题）+ **临时 worktree**
  `/tmp/ac3-fixture-wt`（fork develop，实际改动 = 它声明的 10 个文件，全部 `git diff develop...HEAD` 可见）。
  **同一 fixture、同一命令行，只把 parser 换回修前版本**做 A/B：
  ```
  BEFORE（parser = develop 版，即修前）:
    ANTI-DRIFT HARD FAIL: task gap-git-history-window-notes-ref-dominates — 10 violation(s)
      out-of-declared: task wrote packages/quay/src/observation.ts (matches no declared Touches glob)
      …（10 条，逐条都是它【已经声明】的文件）                     exit=1
  AFTER（parser = 本次修复版）:
    ANTI-DRIFT OK: task gap-git-history-window-notes-ref-dominates — 10 actual file(s),
                   all within declared Touches (10 glob(s))        exit=0
  ```
  **负控制（硬规则 4 推论四：若前提为假则结果会不同的对照）** —— 在同一 fixture 上**只加一个真正未声明的文件**
  （`plugin/scripts/unrelated/not-declared.ts`），修后仍然红，且只报那一条：
  ```
  ANTI-DRIFT HARD FAIL: task gap-git-history-window-notes-ref-dominates — 1 violation(s)
    out-of-declared: task wrote plugin/scripts/unrelated/not-declared.ts (matches no declared Touches glob)
  exit=1
  ```
  ⇒ 修复不是「一律放行」：阻塞语义原样保留，只把**被误读的声明**恢复成可读。

- [x] AC4（全仓读数 + 零计数的配套动作）对 `tasks/*.md` 全部重跑同一函数：
  `有 touches 标题 ∧ globs.length === 0` 由 **3** 降到 **1**，贴前后两个数；余下 1 条必须是
  `gap-quay-has-never-self-hosted-its-own-cold-start`，并贴其 `## Touches` 段正文
  （`(compound task — see each child's own \`## Touches\`)` ⇒ **零是正确读数，⛔ 不是漏读**）；
  同时把该谓词对**一个已知为真的样本**干跑一次（硬规则 2 的零计数半边）。
  **✅ 满足（起点数已随任务库演化漂移为 2，如实标注）** —— 扫 **2299** 个体（提案写 2281，任务库已增长）：
  ```
  OLD（修前 parser）: hasSection && globs.length===0 = 2
      ["gap-capability-catalog-declarations-not-enforced-at-script-creation.md",
       "gap-quay-has-never-self-hosted-its-own-cold-start.md"]
  NEW（修后 parser）: hasSection && globs.length===0 = 1
      ["gap-quay-has-never-self-hosted-its-own-cold-start.md"]
  ```
  ⚠️ **起点是 2 而不是提案写的 3**：受害体 `gap-git-history-window-notes-ref-dominates` 已由它自己的 worker
  改名子标题（绕法）而离开该集合，故它不在 OLD 读数里 —— 这不改变「修后收敛到 1」的结论，只是起点少了那一条。
  余下 1 条确为 `gap-quay-has-never-self-hosted-its-own-cold-start`，其 `## Touches` 段正文逐字：
  ```
  "\n(compound task — see each child's own `## Touches`)\n"
  ```
  ⇒ `parseTouchEntries(该段)` = `[]`，**零是正确读数**（compound 任务的分段声明在各自子任务体里），⛔ 不是漏读。
  **零计数配套动作（硬规则 2 的另一半）**：把谓词对一个**已知为真**的样本干跑一次 ——
  ```
  predicate(known-zero-glob body "## Touches\n\n(compound task — see each child's own `## Touches`)") = true
  predicate(known-nonzero body "## Touches\n\n- real/path.ts")                                         = false
  predicate(no-touches-heading body "## Plan\n\nnothing")                                              = false
  ```
  ⇒ 谓词能开火（非恒假），也非恒真。

- [x] AC5（可区分，硬规则 3b）`extractTouchesSection` 的返回值含实际选中的标题/行号 ⇒
  贴两种体各自的返回值：「段读到了但没有路径」（上述 compound 体）与「段没读到」（一个无 touches 标题的体）
  在读数上不同形。
  **✅ 满足** —— 两种体逐字返回：
  ```
  「段读到了但没有路径」: {"hasSection":true,"section":"\n(compound task — see each child's own `## Touches`)\n",
                          "heading":"Touches","startLine":1,"level":2}
  「段没读到」          : {"hasSection":false,"section":"","heading":null,"startLine":null,"level":null}
  ```
  ⇒ 修前两者只能靠 `hasSection` 分（且 `section` 都是 `""`），现在 `heading/startLine/level` 给出**非同一形态**的读数：
  前者是「选中的是第 1 行的 `## Touches`，段体为空」，后者是「一个标题都没选中」。
  兼容性：全部消费者都解构 `{ hasSection, section }`，新增字段是纯增量（已由 26 个消费者测试验证）。

- [x] AC6（不回归）`node --test plugin/test/touches-*.test.mjs` 全部 `exit 0`，贴 `# tests / # pass / # fail`。
  **✅ 满足** ——
  ```
  plugin/test/touches-one-entry-one-path-check.test.mjs   exit=0  tests 25  pass 25  fail 0
  plugin/test/touches-orthogonality-check.test.mjs        exit=0  tests 62  pass 62  fail 0
  plugin/test/touches-parser-parity.test.mjs              exit=0  tests 18  pass 18  fail 0
  ```
  另跑共用这份解析器的**更宽消费者集**（26 个 `plugin/test/*.test.mjs`，按 import 谓词选取）**全部 exit 0**，
  含 `suite-bucket-hub-list` / `defect-shape-aggregate` / `fan-in-tts-typecheck-gate` / `fan-in-ff-merge`(46) /
  `bare-dir-touches-check`(15) / `fast-mode-telemetry`(98) 等。scoped 门
  `scripts/test.sh --for-task gap-touches-parser-early-subheading-latch-hides-declaration --allow-thin`
  **exit 0**（全部 scoped 静态检查 PASS）。

## Definition of Done

**REAL LANDING 判据（DIR-026 Reading A）**：不是「改了几行、单测绿了」，而是
**同一个被 15 个消费者共用的生产解析器，对任务库里的真实任务体给出可预期、可归属的声明读数，
并且闸面在一个真实的在飞受害体上由 `HARD FAIL` 转为 `OK`**：

1. **落地对象**：`plugin/scripts/touches-parser.ts` 的 `extractTouchesSection` 本体（⛔ 不是夹具、不是副本；
   `experiments/quay-perpetual-stream/scripts/touches-parser.ts` 是它的 symlink，无需二次改动）。
2. **可被打红**：AC1 的红是本缺陷的红（声明被更早的子标题吃掉），不是别的形状的红。
3. **生产读数**：AC2/AC3 在**真实的受害任务体与其 worktree** 上取（⛔ 非 fixture 注入）。
4. **全仓收敛且可区分**：AC4 的 3→1 与 AC5 的两种形态可分。
5. **不越权**：⛔ 不改任何受害者的任务体、⛔ 不动 `refs/notes/*`、⛔ 不重启进程、⛔ 不改在飞 worktree 的实现；
   本任务对「解除全仓阻塞」的贡献是**让那条任务的闸重新可读**，不是代它落地。
6. **可回滚**：一个函数 + 一个测试文件；回滚 = 还原该函数。

**DoD 自核**：①落地对象正是 `extractTouchesSection` 本体（`plugin/scripts/touches-parser.ts`，symlink 未动）；
②AC1 的红是「期望 2、实得 0」这条本缺陷的红，两条 no-regression 控制条修前即绿；
③AC2/AC3 取在**真受害体**上 —— AC3 的 worktree 已随其 fan-in 清理而消失，按 AC3 自己的 fallback 用
真 body（`7a6306a5d`）+ 临时 worktree 做等价读数并已如实标注；④AC4 收敛到 1 且 AC5 两形态可分；
⑤**未改任何受害任务体**（受害体的子标题是它自己的 worker 改的、早在本次执行之前；本任务只读地引用它）、
未动 `refs/notes/*`、未重启进程、未改在飞 worktree 实现；⑥改动 = 一个函数 + 一个测试文件，回滚即还原该函数。

## Touches

- plugin/scripts/touches-parser.ts
- plugin/test/touches-parser-parity.test.mjs
- tasks/gap-touches-parser-early-subheading-latch-hides-declaration.md
- plugin/scripts/quay-init.sh
- docs/analysis/quay-init-closure-ratchet.baseline.json

## Blocker fix (⛔ outside this task's ORIGINAL declared surface — declared above, justified here)

**What**: `plugin/scripts/quay-init.sh`'s `write_config` comment carried an unescaped backtick pair
inside an **unquoted** heredoc (`cat > "$cfg" <<EOF`) ⇒ command substitution at WRITE time ⇒ the
emitted `.quay/config.yml` got the command's multi-line output spliced in, its continuation line
carried no `#` ⇒ the file became invalid YAML. Origin `1cdec24fa`
(`gap-quay-init-native-reconcile`, already `done`).

**One-command contrast** (no fix ⇒ red / fix ⇒ green): 生成一个全新 workspace 跑
`quay-init.sh --loop`，再 `python3 -c 'import yaml;yaml.safe_load(open("<ws>/.quay/config.yml"))'`。
BEFORE: `ScannerError ... line 29, column 3 / could not find expected ':'`。
AFTER: parses; `loop` keys = fork_baseline/repo_root/test_command/tmux_session/worktree_root；
第二次 `--loop`（升级路径）exit 0。

**Why fixed here rather than waiting for develop**:
1. 三个红文件与本任务 delta 无关 —— 已用**主检出**（`touches-parser.ts` 为未改的基线版本）
   逐个复跑，失败逐字相同 ⇒ 不是本任务引入的。
2. worker-driver 的豁免要求断言签名在窗口内跨 ≥2 个任务复发；实测未复发
   （`.quay/worker-round.jsonl` @ 2026-09-18T16:27Z: `recurredTasks: []`,
   `own-defect-counted`）⇒ 每轮都计重试预算，而成功率 0。
3. 对 `tasks/*.md` 的谓词（已用两个已知为真的样本干跑过）找不到**任何**
   `ready/todo/needs-human` 任务声明 `plugin/scripts/quay-init.sh` ⇒ 「等 develop 自己修」
   **没有时间界**，而这个红阻断**每一个**任务的落地。
   先例：`gap-ac292-criterion-cold-miss-30s-ttl-always-expired`（owner 不在飞时登记 Touches）。

**Verification**: 三个文件 0/3 → **3/3** 绿
（`conformance-target-fixture` 9/9、`quay-init-loop` 5/5、`install-config-driven-e2e` 3/3）；
`quay-init-closure-ratchet` 机械重锚（`--gate` shrink-only `3 files / 1022 bytes ≤ 3/1022`；
`--check-stale` 两侧 exit 0 / exit 1→0；baseline diff 只有 `fingerprint` 与该 source 的 `sha`，
`files`/`bytes` 未动 ⇒ 未把棘轮放宽）。

**5b sweep（同一形状的其它落点）**: 扫 236 个 shell 文件的【未加引号 heredoc 正文】中含
反引号或 `$(` 的行，共 47 处；逐条判读后**只有本行**是「非转义且非生成产物」的实例，
其余是【加反斜杠转义】的形式（`checker-mutation-cases/*.sh`）或生成脚本里有意的替换形式
（`develop-deliver-tgz.sh` / `verify-deliver-coldstart.sh`）。
⚠️ 观察项（未立案，硬规则 12：发生率 1，不设前置）：同一陷阱在本注释**被撰写时又复现了一次**
（我写的解释文字里的反引号同样被求值），说明「评审时看不出来」；若要机制化防复发，
应是一个「未加引号的 heredoc 正文里出现未转义反引号 ⇒ 报红」的 checker。
