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
   「读到了段但段里没有路径」与「根本没读到段」在读数上**可区分**，后者才有可能被单独报红。

⛔ 本任务**不改任何任务体**：任务体的写权限属于执行该任务的 agent（`manager-tick-log.md:7303` 引
`touches-orthogonality-check.ts:440-444` 的 self-touch 授权模型：「the executing agent has **no authorization**」），
受害体的标题只作**诊断**给出，供其自己的 worker 或人处置。

<!-- dedup-ref -->
**同族（traceability，⛔ 非前置）**：`gap-git-history-window-notes-ref-dominates`（notes 占满窗口，是后果二链条的另一端）；
`gap-fan-in-suite-red-with-no-attributable-test-still-redispatches-worker`（driver 对「归因不出」的动作分叉）；
`gap-touches-parser-strip-annotation-nested-parens`（done；同一对文件的上一处解析缺陷，Touches 形状的先例）。

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

- [ ] AC1（夹具先红）加用例后 `node --test plugin/test/touches-parser-parity.test.mjs` **红**，
  失败信息为「期望 2、实得 0」（或等价的 globs 数组不等）；贴原始输出。
- [ ] AC2（生产受害体）修后对 `tasks/gap-git-history-window-notes-ref-dominates.md` 跑导出的 `parseTouches`
  ⇒ `globs.length === 10`（现状 **0**），并把 10 条逐条打印。
- [ ] AC3（闸面端到端）`anti-drift-touches-check.ts --task gap-git-history-window-notes-ref-dominates
  --worktree <其 worktree> --merge-target develop` ⇒ `ANTI-DRIFT OK`（现状 9 violations）。
  **若该 worktree 已不存在**，改用一个**带 `### Touches x` 子标题的 fixture 任务体 + 临时 worktree**
  做等价读数，并如实标注替换对象。
- [ ] AC4（全仓读数 + 零计数的配套动作）对 `tasks/*.md` 全部重跑同一函数：
  `有 touches 标题 ∧ globs.length === 0` 由 **3** 降到 **1**，贴前后两个数；余下 1 条必须是
  `gap-quay-has-never-self-hosted-its-own-cold-start`，并贴其 `## Touches` 段正文
  （`(compound task — see each child's own \`## Touches\`)` ⇒ **零是正确读数，⛔ 不是漏读**）；
  同时把该谓词对**一个已知为真的样本**干跑一次（硬规则 2 的零计数半边）。
- [ ] AC5（可区分，硬规则 3b）`extractTouchesSection` 的返回值含实际选中的标题/行号 ⇒
  贴两种体各自的返回值：「段读到了但没有路径」（上述 compound 体）与「段没读到」（一个无 touches 标题的体）
  在读数上不同形。
- [ ] AC6（不回归）`node --test plugin/test/touches-*.test.mjs` 全部 `exit 0`，贴 `# tests / # pass / # fail`。

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

## Touches

- plugin/scripts/touches-parser.ts
- plugin/test/touches-parser-parity.test.mjs
- tasks/gap-touches-parser-early-subheading-latch-hides-declaration.md
