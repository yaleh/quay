---
id: gap-ff-merge-quotepath-breaks-inert-retry
title: ff-merge 的 inert 重试被 git C-quote 击穿：develop 推进含非 ASCII 文件名时 ff 恒失败（fan-in
  反活锁恢复从不触发）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

**直接量（2026-09-17 实测，cwd = `/home/yale/work/quay`）**：

`gap-readme-positioning-software-engineering-agent` 的机械 fan-in 在 ff 步失败：
`fan-in-ff-merge: FF FAILED — To .; not a fast-forward`（重试记录 attempt 1，`developHead=5fee678b35bbd2ba9d4f1373be810dd8acd1fd28`）。

它**不应该**失败——`packages/quay/src/fan-in/ff-merge.ts:643` 有一条 in-lock inert 重试：develop 在 suite 窗口内推进时，若 `suite_head...developTip` 的增量是**惰性**的（`classifyDelta` 返回 `""`），就把 develop merge 进任务 worktree 再重试 ff。实测该窗口内 develop 的唯一推进是一个 `goals/*.md` 提交。

**决定性对照（硬规则 4 推论四：附一个若假设为假则结果会不同的对照）**：

增量 `git diff --name-only 401dfaedf...5fee678b3`（`suite_head=401dfaedf594aaf71e46a40fac654f0baa562357`、`developTip=5fee678b35bbd2ba9d4f1373be810dd8acd1fd28`）恰好**一个文件**，且 git 默认 `quotePath` 把它 C-quote 了：

```
"goals/AC-278-\350\207\263\345\260\2214\345\274\240...md"
```

把三种输入分别喂给**同一个**分类器（`node --no-warnings --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts --classify-delta --root /home/yale/work/quay <path>`）：

| 输入 | stdout | 判定 |
|---|---|---|
| C-quoted 形态（**生产实际传的**） | 原样回显该串，exit 0 | **非惰性** ⇒ 不进重试 |
| 真实路径（`git -c core.quotePath=false diff --name-only`） | 空，exit 0 | 惰性 ⇒ 会进重试 |
| 对照：`tasks/gap-goal-born-draft-zero-ac-escapes-standing-invariant.md`（纯 ASCII） | 空，exit 0 | 惰性 |

**根因**：`packages/quay/src/fan-in/ff-merge.ts:650` 的
`git(root, "diff", "--name-only", \`${suiteHead}...${developTip}\`)` 未关 `core.quotepath`，非 ASCII 文件名到达分类器时是一个**不存在的文件名**；分类器对无法判定的路径 fail-closed 判非惰性 ⇒ `classifyDelta !== ""` ⇒ **in-lock 重试永不触发** ⇒ develop 只要在 suite 窗口内推进了**任何**含非 ASCII 文件名的提交（本仓 `goals/`、`tasks/` 下大量中文名，promotion-driver / goal 写入高频），ff 就必然以 `not a fast-forward` 失败。

**这是硬规则 5b（「在某处修好 X ≠ X 只在那一处」）的一个实例**：同一缺陷类已在**三处**修过，第四处漏了——

- `plugin/scripts/anti-drift-touches-check.ts:121`（已加 `-c core.quotepath=false`）
- `plugin/scripts/direct-to-develop-bypass-check.ts:651`（同款；任务 `gap-direct-bypass-check-quoted-path-false-positive` done）
- `plugin/scripts/dev-stats-collect.ts:119`（同款）
- **`packages/quay/src/fan-in/ff-merge.ts:650`（未修）** ← 本条

**代价**：ff 失败 ⇒ 任务 `exited-not-landed` ⇒ driver 以「分支滞后」重派（CONTINUE prompt 明确写「⛔ 不是代码缺陷，重派即可自愈」）⇒ **重试预算烧在错误假设上**；三次后 `attempt >= 3` 触发 anti-livelock 升级为 `needs-human`，任务静置需人救。即 `ff-merge.ts` 自己那条反活锁恢复在生产上**结构性地从未有机会生效**。

**去重读数**：`grep -rln 'ff-merge' tasks/ | xargs grep -ln 'quotepath'` ⇒ 0 个任务文件涉及本处；`gap-fan-in-ff-retry-reruns-suite-on-inert-increment`（done）是该重试的引入任务、`gap-fan-in-driver-mechanical-orchestration`（done）是机械 fan-in 的引入任务——两条均已 done，本条是**它们已落地机制里的缺陷**，不是重复立案。

## Requested action

1. 修 `packages/quay/src/fan-in/ff-merge.ts:650`：给该 `git diff --name-only` 加 `-c core.quotepath=false`（与上述三处同款），使非 ASCII 路径以原始字节到达 `classifyDelta`。
2. **同族扫描（硬规则 5b 要求的产物，写进提交）**：在 `packages/quay/src/**` 与 `plugin/scripts/*.ts` 里找出**其它**把 `git diff --name-only` / `git ls-files` / `git ls-tree` 的输出喂给**路径匹配谓词**（正则 / 白名单 / 分类器）的调用点，逐个判断是否需要同款 flag；**把命中数与前 3 条实际内容贴进提交**。⛔ 不是无差别给全部 80 处 `name-only` 加 flag——只修「其输出进入路径谓词」的那些（判定按位置，不按关键词，硬规则 2）。
3. **守卫测试**：在 `plugin/test/fan-in-ff-merge.test.mjs` 里加一条**负控制**用例——构造一个仅含非 ASCII 文件名的惰性增量 ⇒ 断言 in-lock 重试**确实触发**（该用例在修复前必须转红）。

## Acceptance Criteria

- [x] AC1: `packages/quay/src/fan-in/ff-merge.ts` 的增量读取命令带 `core.quotepath=false`（**按位置判定**——读该语句的 argv 数组，⛔ 不是注释/字符串里的命中）。
- [x] AC2（可证伪，负控制）: 新增的守卫测试在**修复前**至少一条转红、**修复后**全绿；两条读数并排贴出（证明该用例不是恒绿）。
- [x] AC3: 对 `5fee678b3`（本条实测样本）真实重放：关闭 quotepath 后 `classifyDelta` 对该增量判**惰性**（空输出），且 in-lock 重试分支可达。
- [x] AC4: 同族扫描产物落进提交：命中数 + 前 3 条实际内容（硬规则 5b）。

## Definition of Done

- [x] ff-merge 的 inert 重试在「增量只含非 ASCII 文件名」这一形态下**真实可达**，且有能在修复前转红的用例守着。
- [x] 同族扫描完成且留痕。
- [x] 判准遵循 REAL LANDING 口径（DIR-026 Reading A）：证据钉在重试分支**真的被走到**（⛔ 不是「flag 在文件里」这类静态存在性断言）。

## Evidence

**落地提交**：`c8359f300`（task 分支 `task/gap-ff-merge-quotepath-breaks-inert-retry`）。
argv 数组按位置核过，共 4 处（全部在 `packages/quay/src/fan-in/ff-merge.ts`，均在 ## Touches 内）：
`:446` suiteCertGate 增量读取、`:661` in-lock 重试增量读取（本条正主）、
`:199`/`:233` cleanTreeCheck 的 `status --porcelain`（porcelain 同样 C-quote，其解析路径喂 3 个谓词）。

**AC2 两条读数并排（同一用例、同一夹具，唯一变量 = 代码是否带 flag）**：

```
POST-FIX  ✔ AC2 非 ASCII-only 惰性增量 ⇒ 重试触发、ff 落地        pass 2 / fail 0
PRE-FIX   ✖ AC2 … exit 1 + `FF FAILED … not a fast-forward` + retry record
PRE-FIX   ✖ porcelain 用例 … exit 2 + `working tree not clean`
```

PRE-FIX 的 ff 报错与生产签名逐字相同（`Diverging branches can't be fast-forwarded` / attempt 1）。
负控制手法 = prefix-code swap（换回 pre-fix 文件跑新测试，再换回），换回后 argv flag 计数回 4。

**AC3 真实重放**（shared clone 复刻仓库，develop=5fee678b3 / task=401dfaedf，与生产几何一致）：

```
PRE-FIX  exit code = 1        （retry record 写出 attempt 1，与生产同形）
FIXED    exit code = 0        （develop 被重试折进 1 个 merge 提交后 ff 落地）
```

⇒ 判据钉在**重试分支真的被走到**（merge 提交数 = 1），不是静态存在性。

**AC4 同族扫描**（完整产物在提交信息里）：命中 **37 个调用点 / 19 个文件**；
非 A 类：7 处只做计数/空串判定、3 处已用 `-z`（结构性免疫）。
⛔ 未在本条一并修这 37 处——它们横跨 19 个文件，远超本条 ## Touches 的三文件写面
（scoped 门与 anti-drift 会因此报红），产物留给后续任务机械展开。

**扫描时自身踩到同一个坑（留痕）**：用 `git ls-files | grep -P '[^\x00-\x7F]'` 数非 ASCII 路径得 **0**，
真值 **91** —— ls-files 自己也 C-quote；零计数是假零，不是「没有」（硬规则 2 的「零查谓词对真样本干跑」）。

**scoped 门**：`scripts/test.sh --for-task gap-ff-merge-quotepath-breaks-inert-retry --allow-thin`
⇒ exit 0，130/130 绿，两条新用例在其中（log 行 425/426）。

## Touches

- packages/quay/src/fan-in/ff-merge.ts
- plugin/test/fan-in-ff-merge.test.mjs
- tasks/gap-ff-merge-quotepath-breaks-inert-retry.md（self-touch）
