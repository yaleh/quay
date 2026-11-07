---
id: gap-touches-judgement-codes-author-surface
title: Touches 判据码进作者面：touches-overbroad 只活在
  task-schema-check、touches-multi-path-bullet 只在晋升被拒时出现；复用既有判据接到 --help grammar
  + ready-pool，不新增规则
status: ready
labels:
  - gap
  - touches-parser
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：DSI triage 的 B 切片（原子 `x3-1` overbroad glob + `sa5b-5` 一条目一路径），30 题负载集的 **Q2**（「Touches 写成 `src/*` 会怎样？」）目前无法从产物面回答。

**现状（已核）**：
- `touches-overbroad` 的 code 已存在：`plugin/scripts/task-schema.ts:634`（消息已解释「need >=2 concrete leading path segments before any wildcard, or an exact path」）。但 `checkTouches` 只被 `task-schema-check.ts:42` 与 `prepare-admission-check.ts:711` 调用——**不在 `quay task check`（provider ABI）面，也不在 `ready-pool-check`**。
- `touches-multi-path-bullet` 已存在：`plugin/scripts/touches-one-entry-one-path-check.ts:220`，且已在 `plugin/scripts/ready-pool-check.ts:4307` 作为拒绝原因暴露。
- A 落地的 Touches grammar 小节（`quay task create --help`）只列解析器码，**两个判据码都不在**。

**发生率（2026-11-07 实测，3179 个任务文件）**：
- `touches-overbroad`：**1 个** —— `tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md`。
- `touches-multi-path-bullet`：21 个命中，**全部在 shrink-only 基线** `docs/analysis/touches-one-entry-one-path-baseline.md`（`baseline-count: 23`）⇒ **有效新增 0**。

**结论**：本任务**不新增规则、不新增第二份实现**，只把已有判据接到作者可见面。⛔ 不改 provider ABI（`client.taskCheck` 是产品层，Touches 是方法论层规则；跨层会让其他 provider 无谓地背上它）。

⛔ 不以 |D| 下降 / 原子计数作为任何 AC 或 DoD 的证据。

## Plan

1. **复用判据**：`isOverbroadDeclaration`（`touches-orthogonality-check.ts:70`）与 `checkTaskOneEntryOnePath`（`touches-one-entry-one-path-check.ts:212`）。⛔ 不写第二份。
2. **help grammar**：在 A 已有的 Touches grammar 小节里增加**判据码**（`touches-overbroad`、`touches-multi-path-bullet`），从**单一注册表**渲染；若与 A 的 `TOUCHES_PROBLEM_CODES` 语义不同（解析器问题 vs 判据问题），新增独立纯数据表 `TOUCHES_JUDGEMENT_CODES`，⛔ 不混进 problem 表、⛔ 不在 help 手写第二份列表。
3. **ready-pool-check**：在既有 multi-path 检查（`:4303`）旁增加 overbroad 检查，输出稳定 code + detail；multi-path 继续尊重 shrink-only 基线。
4. **迁移那 1 个 overbroad 任务**：把它的 Touches 改成 ≥2 段具体路径（或精确路径）；⛔ 不得静默豁免；若确实无法改，写进显式祖父清单并说明理由。
5. **测试**：跨层（`spawnSync` 跑真实 `quay task create --help`，解析码，⛔ 不 import 表比表）；ready-pool fixture（`src/*` ⇒ 出 `touches-overbroad`；`packages/quay/**` 与精确路径 ⇒ 不出）；multi-path 负臂（散文分隔符不误报）。

## Acceptance Criteria

- [x] AC1 help 面：真实 `quay task create --help` 的 stdout 里能解析出 `touches-overbroad` 与 `touches-multi-path-bullet`，且与注册表逐项相等；负控制：抹掉 stdout 中一条后抽取器只读到 N−1（能取假）。
- [x] AC2 ready-pool 面：对 `src/*` 的 fixture 输出 `touches-overbroad`；对 `packages/quay/**` 与精确路径**不**输出；multi-path 基线仍压制既有的 21 条（给出压制计数）。
- [x] AC3 迁移：那 1 个 overbroad 任务改好或显式祖父；给出「3179 个任务里 overbroad = 1 → 0」的逐字读数。
- [x] AC4 无回归：`scripts/test.sh --for-task gap-touches-judgement-codes-author-surface` 绿；两个既有 checker 的测试仍绿。

## Definition of Done

- 四条 AC 勾选，每条附可复跑命令与逐字读数。
- **明确不动 provider ABI**（在 Evidence 写一句：为何选 help + ready-pool，而不是 `client.taskCheck`）。
- 判据码来自单一注册表；`grep` 证明没有第二份手写列表。
- ⛔ 完成证据中不得出现「|D| 下降」或原子计数。

## Evidence

### 落地形态（一句话）

`packages/quay/src/kernel/touches-annotation.ts` 新增**第三张纯数据表** `TOUCHES_JUDGEMENT_CODES`
（rule id `x3-1` / `sa5b-5`）+ 两个导出常量 `TOUCHES_JUDGEMENT_CODE_OVERBROAD` /
`TOUCHES_JUDGEMENT_CODE_MULTI_PATH`。`cli/help.ts` 的 `touchesGrammarLines()` 把三张表一起渲染
（`[problem]` / `[reading]` / 新增 `[judgement]`）。判据本体一行未改：overbroad 仍由
`isOverbroadDeclaration`、multi-path 仍由 `checkTaskOneEntryOnePath` 决定。

**为什么不混进 `TOUCHES_PROBLEM_CODES`**：problem/reading 码由 `diagnoseTouches` 产出并携带 parser
`atom` + `TOUCHES_RULE_IDS` 里的 rule id；judgement 码由另外两个判官产出、不是 parser 规则。混表会给
`diagnoseTouches` 一行它永远产不出的码、给 `TOUCHES_RULE_IDS` 一个没有反事实读数的 rule id。

### AC1 — help 面（可复跑）

```text
$ node packages/quay/bin/quay.js task create --help | grep -oE 'touches-[a-z-]+ +\[judgement\]'
touches-overbroad                     [judgement]
touches-multi-path-bullet             [judgement]
```

抽取器（`plugin/test/touches-parser-help-surface.test.mjs` 的 `parseJudgementCodesFromHelp`）**不认识
注册表**，只按 `/\b(touches-[a-z-]+)\s+\[judgement\]/g` 从**真实 CLI stdout** 里读；断言是**逐项相等**
（code 集合 = `TOUCHES_JUDGEMENT_CODES` 的 code 集合）+ 每行 `rule <id>` 与 `meaning` 逐字存在。
负控制（能取假）：把 stdout 里 `touches-overbroad [judgement]` 换成不含码的散文后，抽取器读到 N−1
（`assert.equal(after.length, n - 1)` 且 `!after.includes("touches-overbroad")`）。

```text
$ node --test plugin/test/touches-parser-help-surface.test.mjs
✔ AC1 (judgement): the real `task create --help` stdout carries EXACTLY the registry's judgement codes, item by item
✔ AC1 (judgement) negative control: erasing one judgement code from stdout leaves the extractor reading N−1
```

### AC2 — ready-pool 面（可复跑）

两条独立面，都被钉住：

1. **候选读数**：`analyzeTasks` 的 `candidates[]` 新增 `touchesJudgement: [{code, what}]`（bulk 与
   targeted 两条路径都有），行来自 `checkTouchesNotOverbroad(body)` —— 判据是
   `isOverbroadDeclaration`，条目来自 `parseTouchEntries(extractTouchesSection(body).section)`，
   与 `task-schema-check` **完全同一条管线**（⛔ 不用 `parseTouches` 的 `dir/`→`dir/**` 整形：
   那属于重叠展开器，借用会让晋升闸拒掉 schema 判为 well-formed 的声明，两面互相打架）。
   ⛔ 也**不**从既有的 `wideTouches` 派生：那张表还包含 `packages/quay/**` 与 `dir/` 形态
   （`checkTouchesNarrow` 自己更严的宽度规则），把它们报成 `touches-overbroad` 会与文档矛盾。
2. **晋升写入边界**：在既有 multi-path 守卫旁加同源守卫（`applyPromotions`），被拒候选落
   `{ok:false, reason:"touches-overbroad", committed:false, detail}` —— 与 `touches-multi-path-bullet`
   完全同形的可见拒绝（硬规则 3b）。

**该守卫不是结构性死代码（硬规则 4）**：`checkTouchesNarrow` **跳过 `(new)` 标记条目**，所以
`- src/* (new)` 是 promotion-eligible 且**确实到达** apply 循环——这就是它的可达臂，也是它顺手
补上的一个真实缺口（宽度判据的 `(new)` 豁免口）。

```text
$ node --test plugin/test/touches-parser-help-surface.test.mjs
✔ AC2: `src/*` is overbroad, `packages/quay/**` and an exact path are NOT; no section = NOT-EVALUATED
✔ AC2 multi-path negative arm: prose separators are NOT overbroad and NOT multi-path
✔ AC2: the multi-path grandfather baseline still suppresses every file it lists (count reported)
ℹ multi-path baseline: baseline-count header=23, listed+present=23, suppressed multi-path hits=21
✔ AC2: `analyzeTasks` puts `touches-overbroad` on the candidate — and NOT on `packages/quay/**` or an exact path
✔ AC2: applyPromotions refuses a `(new)`-tagged overbroad glob — the width rule's carve-out is closed
```

**压制计数 = 21**（`baseline-count: 23`，列出的 23 个文件全部仍在盘上，其中 21 个若**去掉**祖父名单
就会被判 multi-path ⇒ 基线仍真实压制 21 条，且逐文件断言「带基线时判为干净」全部成立）。

负臂：正臂 `- src/*` ⇒ `code === "touches-overbroad"` 且 detail 点名 `src/*`；负臂
`packages/quay/**`、`packages/quay/src/gate/*.js`、`tasks/some-task.md`、
`packages/quay/src/gate/engine.js` 四条**均不**产出该码；无 `## Touches` 段 = NOT-EVALUATED（硬规则 3b，
不与「判干净」同形）；散文分隔符（`、` / `，` / 时间戳斜杠）既不触发 overbroad 也不触发 multi-path
（multi-path 判据要求 ≥2 个**路径样** token，散文 token 从不计数）。

### AC3 — 迁移（可复跑）

那 1 条的**根因不是 Touches 写得太宽**，是 AC 散文落进了 Touches 段：该任务体有**两个**
`## Touches` 标题，第一个（行 135）之后直接跟了一整块 AC 草稿而**没有任何后续标题**，于是整块被当成
Touches 条目解析；其中 `证据：slot-refill 用 \`fast-mode-telemetry.ts --slots\` 的 **reconcile 感知
realInFlight**（括号 ≠` 里的 `**reconcile…**` 让 `isOverbroadDeclaration` 判出通配符前只有 0 段具体
路径。修法 = 在真正的声明条目之后补一个 `## AC evidence` 标题，让 Touches 段在声明处结束
（**零豁免、零基线增项、零内容删除**——AC 草稿原样保留在新标题下）。

```text
# 迁移前（HEAD 版本的任务文件）
$ node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/*.md | grep -c 'touches-overbroad'
1
$ node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/*.md | grep 'touches-overbroad'
FAIL: tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md — touches-overbroad: ## Touches has overbroad glob(s): "证据：slot-refill 用 `fast-mode-telemetry.ts --slots` 的 **reconcile 感知 realInFlight**（括号 ≠" — need >=2 concrete leading path segments before any wildcard, or an exact path

# 迁移后
$ ls tasks/*.md | wc -l
3180
$ node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/*.md 2>/dev/null | grep -c 'touches-overbroad'
0
```

⚠️ 任务体写「3179 个任务文件」，实测今天为 **3180**（期间新立 1 个任务）。读数按实测口径给。
该任务文件 schema 的其余 4 条 FAIL（`gap-finding-missing` / `dod-missing` /
`gap-requested-action-missing` / `wiring-coverage-empty-source`）**迁移前后完全相同**，与本任务无关
（已用 `git show HEAD:<file>` 对照确认）。

### AC4 — 无回归（可复跑）

```text
$ bash scripts/test.sh --for-task gap-touches-judgement-codes-author-surface --allow-thin
EXIT=0
   scoped static checks: it0-split-or-commit / test-framework-policy / test-group-downgrade /
   test-isolation / tmp-leak-pairing / test-impl-census / checked-in-write / task-contract /
   malformed-task / touches-one-entry-one-path / superseded-capability / concurrency-literal /
   target-identity-literal / worktree-namespace-literal / serve-binding-literal /
   registry-path-literal / task-file-bypass / suite-slot-ssot / suite-bucket-reattr-ratchet /
   landing-target / judgment-consumer / mirror-pair-drift / test-file-snapshot /
   enum-surface-parity / import-graph / sh-census / repo-root-derivation   —— 全部 PASS
   ℹ tests 188 · pass 188 · fail 0 · duration_ms 39232
```

两个既有 checker 的测试（同一轮，共 59 条，全绿）：

```text
$ node --test plugin/test/touches-one-entry-one-path-check.test.mjs \
                plugin/test/touches-parser-rules-a.test.mjs \
                plugin/test/touches-parser-help-surface.test.mjs \
                plugin/test/ready-pool-check-s12.test.mjs
ℹ tests 59 · pass 59 · fail 0
```

（`plugin/test/precommit-guard.test.mjs` 亦复跑：`tests 25 · pass 25 · fail 0` —— 见下条 emitter 改动。）

### 为什么不走 `client.taskCheck`（provider ABI）

`client.taskCheck` 是**产品层**的契约：它回答「这个 provider 里的任务是否满足进入下一状态的门」，
对 native / GitHub / 任何未来 provider 都必须同义。Touches 是**方法论层**的规则（quay 自己的
dispatch/编排协议），只有研究层的工作区才有；把它塞进 provider ABI 会让 GitHub provider 无谓地背上
一条与它无关的规则，并把「方法论演进」耦合进「产品版本」。所以本任务只在两个**方法论层**面上接：
作者读的 `--help`（`cli/help.ts`）与编排读的 `ready-pool-check.ts`。

### 判据码来自单一注册表（可复跑 grep）

```text
$ grep -rn "touches-overbroad\|touches-multi-path-bullet" --include=*.ts --include=*.mjs --include=*.js \
       packages plugin | grep -v '\.test\.' | grep -vE '^\S+:[0-9]+: *(\*|//)'
packages/quay/src/kernel/touches-annotation.ts:271:export const TOUCHES_JUDGEMENT_CODE_OVERBROAD = "touches-overbroad";
packages/quay/src/kernel/touches-annotation.ts:273:export const TOUCHES_JUDGEMENT_CODE_MULTI_PATH = "touches-multi-path-bullet";
plugin/scripts/precommit-guard.ts:142:  /** … (present when reason === "touches-multi-path-bullet"). */   ← 注释
plugin/scripts/precommit-guard.ts:726:退出码: 0=放行 1=拒（doc-check-failed / touches-multi-path-bullet / …    ← 帮助字符串
packages/quay/dist/quay.js:654-655 …   ← 由上述注册表打包生成的 dist（gitignored 构建产物）
plugin/vendor/quay/dist/quay.js:654-655 …   ← 同上
```

**代码里的字面量只剩注册表两行**；注释/帮助文本里的提法不构成列表，dist 是构建产物。作为对照，
本任务顺带把两处**既有**独立 emitter 也改成引用常量（`plugin/scripts/task-schema.ts` 的
`touches-overbroad`、`plugin/scripts/precommit-guard.ts` 的 `touches-multi-path-bullet`），
使这条 grep 读数成立。

## Dark axis (ADR-007)

- L_G import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0（本次新增的
  `plugin/scripts/{task-schema,precommit-guard,ready-pool-check,touches-one-entry-one-path-check}.ts`
  → `packages/quay/src/kernel/touches-annotation.ts` 四条边未产生环；headBaseline 同值）
  复跑：`node --no-warnings --experimental-strip-types plugin/scripts/import-graph-check.ts --root <worktree>`

## Touches

- packages/quay/src/kernel/touches-annotation.ts
- packages/quay/src/cli/help.ts
- plugin/scripts/ready-pool-check.ts
- plugin/scripts/touches-orthogonality-check.ts
- plugin/scripts/touches-one-entry-one-path-check.ts
- plugin/scripts/task-schema.ts
- plugin/scripts/precommit-guard.ts
- plugin/test/touches-parser-help-surface.test.mjs
- tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md
- tasks/gap-touches-judgement-codes-author-surface.md
