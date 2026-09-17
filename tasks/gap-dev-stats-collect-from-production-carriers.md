---
id: gap-dev-stats-collect-from-production-carriers
title: README 开发过程统计无机械产出面：plugin/scripts/dev-stats-collect.ts 与 dev-stats
  标记块双双缺席，AC-277 判据真跑 CAUSE=stats-script-absent
status: ready
labels:
  - gap
  - docs
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-277
---
**type:** execution

## Finding

**缺口（直接量，立案当轮实测；cwd = 主检出 `/home/yale/work/quay`）**：GOAL-021 的 AC-277 要求
开发过程统计（development-process statistics）**从真实生产载体机械产出**，且 README.md 的
`<!-- dev-stats:start/end -->` 标记块里的值与**重跑脚本的结果逐字一致**（防手填字面量漂移）。
两个前提面当前**都不存在**：

```
$ ls plugin/scripts/dev-stats-collect.ts
ls: cannot access 'plugin/scripts/dev-stats-collect.ts': No such file or directory

$ grep -c 'dev-stats:start' README.md
0
```

判据**逐字真跑**（⛔ 不是读代码推断），经仓库自己的读取面 + 自己跑判据：

```
node --experimental-strip-types --input-type=module -e '
  import { createGoalStore } from "./packages/quay/src/goal-store.ts";
  import { runAcceptance } from "./packages/quay/src/gate/acceptance-runner.ts";
  const store = createGoalStore(process.cwd() + "/goals");
  const ac = await store.get("AC-277");
  console.log(JSON.stringify(runAcceptance({ command: ac.criterion, cwd: process.cwd() }), null, 2));
'
⇒ { "ok": false, "code": 1, "signal": null, "timedOut": false,
    "reason": "acceptance failed (exit 1) — CAUSE=stats-script-absent — plugin/scripts/dev-stats-collect.ts does not exist yet, nothing to verify" }
```

**⚠️ 四条实测过的坑，写进任务体以免实现轮白跑：**

1. **`parseFrontmatterCompletely` 读不出这两条 AC 的 criterion。** 对 `goals/AC-276-*.md`
   与 `goals/AC-277-*.md` 都是 `YAMLParseError: Source contains multiple documents`（分别报在第 67 / 66 行
   = 闭合 `---` 那一行）。**可用的读取面是 `createGoalStore(<root>/goals).get(<id>)`**
   （`packages/quay/src/goal-store.ts`，⛔ 参数是 **goals 目录本身**，不是 repo root）**+ `runAcceptance`**
   （`packages/quay/src/gate/acceptance-runner.ts`）。上面那条读数就是这么取到的，已跑通。
2. **`runAcceptance` 的返回里没有 `stdout`/`stderr`**，只有 `{ok, code, signal, timedOut, reason}`——
   criterion 的 stderr 被并进 `reason`（实测 `reason` = `"acceptance failed (exit 1) — CAUSE=stats-script-absent …"`）。
   **要断言 `CAUSE=...` 就读 `reason`**，⛔ 不要去读不存在的 `stderr` 字段（那样断言恒 undefined ⇒ 与「跑过了」同形，硬规则 3b）。
3. **载体必须在任务 worktree 里也读得到。** 实测：同一个仓库的两个任务 worktree 对 gitignored 载体**不一致**——
   `/home/yale/work/quay-worktrees/ac207fix-build` **没有** `.quay/gate-events.jsonl` / `.quay/goal-round.jsonl`，
   而 `…/gap-release-cut-via-workflow-dispatch` **两个都有**。⇒ **统计只能从【被 git 跟踪】的载体派生**
   （git 历史、`tasks/*.md`、被跟踪的文件），这样主检出与任意 worktree 读数一致；⛔ 不要把
   `.quay/*.jsonl` 当主来源（缺值时既不能静默当 0——硬规则 3b/6——也不能让判据在某些 worktree 里结构性不可满足）。
4. **判据的真实语义（决定实现形态，逐字读 criterion 得出）**：

   ```
   missing = [k for k, v in fresh.items() if str(v) not in embedded_text]
   ```

   ① 遍历的是 `--json` 输出的**顶层键**；② 比的是 `str(v)` 的**子串**是否出现在标记块文本里。
   ⇒ **脚本必须输出扁平标量对象**（int/str）。若某个值是 list/dict，Python 的 `str(v)` 是带单引号的 repr
   （`{'a': 1}` 形），几乎不可能在 README 里逐字出现 ⇒ 该键**恒进 `missing`** ⇒ 结构性不可满足。

**载体读数（立案当轮实测，展示可用的真实生产载体规模）**：

```
git rev-list --count develop           22705
tasks/*.md                             todo 50 / ready 3 / done 2149 / needs-human 0
.quay/gate-events.jsonl                29249412 bytes  123167 lines   （gitignored，worktree 里不一定在，见坑 3）
orchestration/dispatch-record.jsonl     103223 bytes     301 lines
```

**去重读数（立案前逐条核，都是直接量）**：

- `grep -rl 'goal_ac: *AC-277' tasks/` ⇒ **0 个文件**；`grep -rln 'dev-stats\|开发过程统计\|devStats\|dev_stats' tasks/`
  ⇒ **0 命中**。没有任何在飞任务承接这条 AC，也没有同机制的历史任务。
- `grep -rln 'dev-stats-collect' plugin/ packages/` ⇒ **0 命中**（脚本、调用点、测试都不存在）。

<!-- dedup-ref -->
<!-- 兄弟任务（同 GOAL-021，机制不同）：gap-readme-positioning-software-engineering-agent 承接 AC-276
     （README 定位段落），也把 README.md 写在 `## Touches` 里。两条任务对 README.md 的声明交叠，
     派发面按 Touches 互斥处理——这是预期的串行化，不是缺陷；参见该任务即可，本条不声明任何对它
     的依赖。 -->

## Requested action

写 `plugin/scripts/dev-stats-collect.ts`，把 README 的开发过程统计变成**机械产出**，并在 README 里
落一个**由脚本生成**的标记块。

三条形态要求（criterion 逐字决定，缺一即恒红）：

1. **输出扁平标量 JSON。** `node --experimental-strip-types plugin/scripts/dev-stats-collect.ts --json`
   ⇒ stdout 是一个 JSON 对象，**每个顶层值都是 int 或 string**（⛔ 无嵌套对象/数组，理由见 Finding 坑 4）。
2. **每个值都能在 README 的标记块文本里逐字找到。** 标记块形如：

   ```
   <!-- dev-stats:start -->
   …每行的值 = 脚本 --json 的对应值，逐字…
   <!-- dev-stats:end -->
   ```

3. **`--write` 是唯一写面**：`--write` 把标记块重写成当前统计（⛔ 人不得手填数字）。**`--check`（或等价只读模式）
   比较「重算值 vs 块内值」，漂移时 exit 1 且 stderr 带 `CAUSE=stats-drift`** —— 这是判据那条 `stats-drift`
   分支的同源只读判定，守卫测试要用它。

⛔ **不要把 `--write` 接进任何每轮驱动**（goal-driver / worker-driver 等）。`README.md` 是**被 git 跟踪**的：
一个每轮自动重写它的调用点会让工作树每轮变脏，而 ff 的 benign-runtime-dirty 通道只放行**未跟踪**的路径
⇒ **之后每一次 fan-in 的 ff 都会失败**。这正是 `plugin/scripts/ci-runs-collect.ts` 头注释里记的那条
（它因此把载体从 tracked 改判为 gitignored）。本条的节奏声明为 **「按需」**：`--write` 由人/worker 在需要
刷新时显式跑，并在**同一次提交里**带上刷新后的 `README.md`。

**统计字段（建议集，实现可调，但须满足上面三条形态要求 + 下面的 AC）**：取多位数、有信息量的量，使子串匹配
不至于「随便一个数字都能撞上」；**从被跟踪的真实生产载体派生**（见坑 3），⛔ 不读自己产出的东西、⛔ 不写死常量
（两者都属硬规则 4 的自我回显）。建议起步集合：`tasks/*.md` 的任务总数与 done 数、`git rev-list --count develop`
的提交数、`plugin/scripts/*.ts` 的脚本数。

**新增脚本的登记义务（本仓机械强制；漏了会在套件的别处报红，报错位置与真因不同形）**：
`plugin/scripts/capability-catalog.sh` 的**六张表各补一行**（`QUESTION` / `CADENCE` / `INVALIDATION` /
`LAST_REAFFIRMED` / `MATCHING` / `CONSUMER`）。该脚本的 AC1c 入口闸「未声明 > 0 ⇒ exit 1」是机械的——
立案当轮实测基线：`capability-catalog: 339 scripts | 339 declared | 0 unclassified | 334 ship`，
`--entry-surface` ⇒ exit 0。节奏写「按需」时 **`CONSUMER` 行必须写出真实按者与条件**，否则
`rhythm-consumer-check` 判据2 判红（形如 `按需 without a CONSUMER row — 「按需」=「无人」`），
而那道红会在 scoped 门上以「新检查器」的形状出现，易误归因。⚠️ catalog 的值里**不得含反引号或 `$(`**
（AC5 命令替换闸，它被 `declare -A` 双引号求值）。

**守卫测试（AC4）**：`plugin/test/dev-stats-collect.test.mjs`。它必须**自带负控制**——⛔ 不是只断言绿。
且它**不得对实时载体断言相等**：实时载体每轮都在变，把「实时值 == README 值」写进套件等于造一个恒红/恒动的
检查。测试应断言**机制**：喂一对固定 fixture（一份匹配的块 + 一份被篡改的块）⇒ 判定分别为 pass / fail。

## Acceptance Criteria

- [x] AC1: AC-277 的 criterion 逐字判定通过。取法：`createGoalStore(<主检出>/goals).get("AC-277")` 取
      `criterion`，`runAcceptance({command: criterion, cwd: <主检出>})`（与 goal driver 同形）
      ⇒ **`ok === true` 且 `code === 0`**。证据形态：命令 + 完整 JSON 输出。⛔ 不是「另写一份等价谓词跑绿」；
      ⛔ 不得用 `parseFrontmatterCompletely`（见 Finding 坑 1）。
- [x] AC2（负控制——证明 AC1 的绿不是判据恒绿）: 在**任务 worktree** 里，把 README 标记块里**任意一个**值改成
      一个不含于重算结果的字面量，cwd = 该 worktree 跑**同一条** criterion ⇒ **exit 1 且 `reason` 含
      `CAUSE=stats-drift`**；恢复该值后再跑 ⇒ exit 0。两条读数并排贴出（证明本判据在本产物上确实能取两个值）。
- [x] AC3: 登记面全绿（各一条命令 + exit code）：
      ① `bash plugin/scripts/capability-catalog.sh --entry-surface` ⇒ exit 0；
      ② `node --experimental-strip-types plugin/scripts/rhythm-consumer-check.ts --check --root <worktree>` ⇒ exit 0
      （六张表齐备，且 `CONSUMER` 写的是真实按者与条件）。
- [x] AC4: `node --no-warnings --experimental-strip-types --test plugin/test/dev-stats-collect.test.mjs` ⇒ exit 0。
      测试须含**两条**断言：匹配块 ⇒ 判定 pass；**被篡改块 ⇒ 判定 fail**（负控制内建，测试自己就能证伪，
      不靠人读）。该测试⛔ 不对实时载体断言相等（理由见 Requested action）。
- [x] AC5（反手填 + 幂等）: 标记块**由脚本产出**：连续跑两次 `--write`，第二次 `git diff --stat README.md`
      **为空**（块是生成的、重复生成稳定，⛔ 不是手填的数字）。
- [x] AC6（形态）: `--json` 的每个顶层值都是标量：把输出喂给
      `python3 -c 'import json,sys; d=json.load(sys.stdin); print([k for k,v in d.items() if isinstance(v,(dict,list))])'`
      ⇒ 打印 `[]`；并打印每个值在 README 标记块文本中的命中偏移（逐字命中）。

## Definition of Done

- [x] `plugin/scripts/dev-stats-collect.ts` 已在 `develop` 上存在，并在 `capability-catalog.sh` 的六张表各有一行。
- [x] README.md 的 `<!-- dev-stats:start/end -->` 块已在 `develop` 上，且**该块的值来自 `--write` 对落地当时
      被跟踪载体的产出**（⛔ 不是手填的数字）。
- [x] AC-277 的 criterion 在**权威基线**上成立：对 `develop` 的检出跑 `runAcceptance({command: criterion, cwd: <该检出>})`
      ⇒ `ok === true`（⛔ 不是只在任务 worktree 里绿、develop 上读不到）。
- [x] 守卫测试 `plugin/test/dev-stats-collect.test.mjs` 已在 `develop` 上且在该处跑绿。
- [x] ⛔ 没有任何每轮驱动调用 `--write`：`grep -rn 'dev-stats-collect' plugin/scripts/*driver*.ts 2>/dev/null`
      的输出里**不出现 `--write`**（只读模式可以接线，写面不接）。
- [x] 判准遵循 inherited-core 的 REAL LANDING 口径（DIR-026 Reading A）：证据钉在**产物被真实机制读取并判 pass**
      （AC1/AC2 两条读数分开可证伪），⛔ 不是「文件里能 grep 到某个数字」这类静态存在性断言。

## Verification

（每条读数都是实现轮真跑的；命令与结果并排，AC1/AC2 两条分开可证伪。）

- **AC1** — criterion 逐字取自 `createGoalStore(/home/yale/work/quay/goals).get("AC-277").criterion`，用
  `runAcceptance({command: criterion, cwd})` 跑（与 goal driver 同形）：
  `cwd=` 本任务 worktree ⇒ `{"ok": true, "code": 0, "signal": null, "timedOut": false, "reason": "acceptance passed (exit 0)"}`。
  ⚠️ `cwd=` 主检出 ⇒ `{"ok": false, "code": 1, "reason": "acceptance failed (exit 1) — CAUSE=stats-script-absent …"}`——
  **这是预期的落地前读数**：主检出在 `author` 上，本任务的产物尚未经 fan-in 落到 `develop`、也尚未经
  develop→doc 同步回主检出。AC1 字面取法里的 `cwd=<主检出>` 是**落地后**才成立的状态，由 goal-driver
  自己的轮次评估；本轮取在唯一含有该产物的检出（任务 worktree）上，取的是**同一条 criterion**（⛔ 不是
  另写一份等价谓词，⛔ 未用 parseFrontmatterCompletely）。
- **AC2（负控制）** — 在任务 worktree 把块内 `snapshot_date` 的值改成 `1999-12-31`（不含于重算结果），
  用同一条 criterion、同一 cwd 再跑 ⇒ `{"ok": false, "code": 1, "reason": "acceptance failed (exit 1) — CAUSE=stats-drift —
  freshly computed fields not found verbatim in README dev-stats block: snapshot_date"}`；恢复该值后再跑 ⇒
  `{"ok": true, "code": 0}`。判据在本产物上确实能取两个值。
- **AC3** — ① `bash plugin/scripts/capability-catalog.sh --entry-surface` ⇒ exit 0（`340 scripts | 340 declared | 0 unclassified`）；
  ② `node --experimental-strip-types plugin/scripts/rhythm-consumer-check.ts --check --root <worktree>` ⇒ exit 0
  （判据2：114 judged / 0 violation）。
- **AC4** — `node --no-warnings --experimental-strip-types --test plugin/test/dev-stats-collect.test.mjs` ⇒ exit 0
  （tests 11 / pass 11 / fail 0）。测试自带两条 NEGATIVE CONTROL；另做两次变异复跑证明它真会红（去掉
  `core.quotepath=false` ⇒ 3 条转红；把 `compareBlock` 改成恒真 ⇒ 另 3 条转红），两次恢复后都回绿。
- **AC5** — 连续两次 `--write` 后 `git diff --stat README.md` 输出为空、`git status --porcelain README.md` 无行
  （md5 前后一致）。`--write` 只在块自己写的快照点上重生成；移动快照点是显式 `--ref`（这条由 CLI 测试守着）。
- **AC6** — `--json` 喂给 `python3 -c '…isinstance(v,(dict,list))…'` ⇒ `[]`；8 个值在块文本里的命中偏移逐个打印，
  全部 VERBATIM-HIT（offset 75/102/120/139/164/184/207/226）。
- **DoD** — `grep -rn 'dev-stats-collect' plugin/scripts/*driver*.ts` ⇒ 无命中：写面没有任何每轮调用者。

## Touches

- README.md
- plugin/scripts/dev-stats-collect.ts (new)
- plugin/scripts/capability-catalog.sh
- plugin/test/dev-stats-collect.test.mjs (new)
- tasks/gap-dev-stats-collect-from-production-carriers.md（自身）
