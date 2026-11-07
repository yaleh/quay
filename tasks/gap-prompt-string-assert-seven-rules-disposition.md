---
id: gap-prompt-string-assert-seven-rules-disposition
title: 派发提示词 7 条 string-assert 规则逐条定处置（代码强制 / 删除 / 保留并说明），渲染长度 4376/6573 为前后基线
status: done
labels:
  - gap
  - prompt
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：两份只读清单（**在 quay 仓之外**，绝对路径）：`/data/home/yale/.claude/domain-semantic-induction/quay-dev/inventories/prompt-rules-2026-11-07.md` 与 `/data/home/yale/.claude/domain-semantic-induction/quay-dev/inventories/decision-surface-2026-11-07.md`（口径 commit `04d611e12`），已由对端独立抽验：12 处 `file:line` 全部命中，渲染长度 4376/6573 复现一致。⚠️ 这两份文件不在 quay 仓内，worker 若读不到，**以本任务体列出的 7 条清单与基线为准**，⛔ 不因缺源文件而阻塞。

现状：63 条 prompt 规则（下界）的 `enforcement` 分布为 code 37 / none 14 / **string-assert 7** / behavior-test 5。这 7 条是「prompt 说了、测试只断言文本、行为没有保证」——本仓硬规则 9（可见性 ≠ 执行）的直接实例：worker 读到规则后不照做，套件仍绿。

7 条清单（`file:line` 是构造函数起始行，规则文本在函数体内；行号以本任务分支的当前代码为准，⚠️ 若与 `04d611e12` 不同，以当前代码重新定位并在 Evidence 记录）：
- `driverFanInNote-1/2/3` @ `plugin/scripts/worker-driver.ts:2432`
- `preMergeNote-1` @ `plugin/scripts/worker-driver.ts:2477`
- `continueDarkAxisNote-1` @ `plugin/scripts/worker-driver.ts:2803`
- `formatRelatednessNote-1/2` @ `plugin/scripts/worker-driver.ts:3378`

基线（渲染长度，⛔ 不是源码字面量）：
- `buildWorkerPrompt('gap-touches-parser-a-self-describing', '/data/home/yale/work/quay').length` = **4376**
- `buildContinueWorkerPrompt(同 task/root, {worktreePath:'/data/home/yale/work/quay-worktrees/x',branchCommits:2,branchHeadSubject:'wip',acChecked:2,acTotal:5,failureReason:'suite red: plugin/test/x.test.mjs',attempts:[]}).length` = **6573**
- 复现方式：模块有 direct-entry guard，可安全 import；命令见 `## Evidence`。

⛔ 不以 |D| 下降 / 原子数减少作为任何 AC 或 DoD 的证据。

## Plan

1. **逐条复核并分类**（先读代码，⛔ 不按函数名判断）：对 7 条各判一次——
   - `machineDecidable=yes` ⇒ 写清由哪个函数/检查器强制，并设计负臂（注入违约必须红）；
   - 规则已过期或行为已由别处保证 ⇒ 从 prompt 删除，并给出「删了不会变坏」的证据；
   - 必须由 agent 判断 ⇒ 保留，写明为何不能机器判，并尽量补一条**行为级**守卫（不是 `assert.match`）。
2. **处置落地**：`enforce` 实现检查；`remove` 删除文本；`keep` 补说明。⛔ 只把一条 `assert.match` 换成更宽的另一条 `assert.match` 不算。
3. **测试改造**：把对应字符串断言换成行为断言，或在 `remove`/`keep` 情况下删除断言并记录理由。
4. **前后读数**：用同一 fixture 重测两个基座的渲染长度，逐条记录每条处置对长度的贡献。
5. **非独立规则的合并**：若复核发现某条不是可独立违反的规则（例如 `driverFanInNote-2` 只是 `-1` 的括号细节），合并并写明依据——⛔ 不得为凑 7 而保留。
6. **已知冲突（必读，否则会红一条无关测试）**：`plugin/test/worker-driver.test.mjs:1236` 有 `gap-worker-prompt-note-family-slimming` 的**活棘轮**——`buildWorkerPrompt` + `buildContinueWorkerPrompt` 的归一化合并长度必须 ≤ **9102**（baseline 12137 的 −25%）。实测当前值 = **9064**，余量仅 **38 字符**。⇒ 任何 `keep` / 扩写必须由等量或更多的删除补偿；⛔ 不得擅自抬高 `WORKER_PROMPT_SLIM_BASELINE`（那是 re-anchor 行为，需单独裁定）。若某条规则确实必须保留且无法补偿，在 `## Evidence` 写明并提出 re-anchor 请求，⛔ 不要静默改基线。
7. **度量区分（⛔ 不要把两个数混用）**：AC3 的 `4376 / 6573` 是 `gap-touches-parser-a-self-describing` fixture 的 **raw 渲染长度**；AC4 的 `9102 / 9064` 是 ratchet fixture（`gap-x` + 归一化 kernel 路径）的 **归一化合并长度**。两者不是同一个量——⛔ 不得用 `4376 + 6573` 与 `9102` 比较；AC3 报 raw，AC4 报归一化。

## Acceptance Criteria

- [x] AC1 逐条处置：7 条每条都有 `{src, rule, disposition: enforce|remove|keep, reason}` 记入任务体 `## Evidence`，无一条未分类；若合并了非独立规则，写明依据。
      读数（E2，7 行，无未分类）：`enforce` 4（driverFanInNote-1 / driverFanInNote-3 / preMergeNote-1 / continueDarkAxisNote-1）、`remove` 2（driverFanInNote-2 并入 -1、formatRelatednessNote-1 并入 -2）、`keep` 1（formatRelatednessNote-2）。
- [x] AC2 `string-assert` 清零：这 7 条对应的 `assert.match` 全部消失或换成行为断言；负臂：每条 `enforce` 的规则，注入违约后检查必红（逐字读数）；每条 `remove` 的规则，给出「删除后既有行为测试仍绿」的读数。
      读数（E3/E4/E5）：删除 24 条措辞断言（3 个测试文件，逐条列于 E3）；新增 3 条行为断言（formatRelatednessNote 的输入→输出函数、信号行数、dark-axis 子句的触发/回显次数）。4 条注入负臂全部红：`null !== 'done'` / `actual 'ff' - expected 'merge-develop'` / `fan-in lock holder exited before acquiring (code 0)` / `2 !== 1`。remove 后既有行为测试仍绿：`fan-in-driver-mechanical-orchestration.test.mjs` 14/14、三文件 166/166。
- [x] AC3 渲染长度前后读数：用固定 fixture 重测两个基座，贴出 before（4376 / 6573）与 after 的逐字数字，**逐条说明**每条处置对长度的贡献。⛔ 不设「必须变短」的目标；变长也可接受，但必须解释。
      读数（E1）：`BEFORE create=4376 continue=6573` → `AFTER create=4314 continue=6511`（各 −62）。逐条贡献见 E1 表。
- [x] AC4 无回归：`node --test plugin/test/worker-driver.test.mjs plugin/test/worker-driver-resident-s05.test.mjs` 与 `scripts/test.sh --for-task gap-prompt-string-assert-seven-rules-disposition` 绿；其中 `gap-worker-prompt-note-family-slimming` 的**长度棘轮 ≤9102 必须保持绿**（当前 9064，余量 38 字符；若因本任务变红，按 Plan 第 6 条的补偿或 re-anchor 请求处理）。
      读数（E7/E8）：三文件（另加受影响的 resident-s06）`tests 166 / pass 166 / fail 0`；棘轮 `9064 → 8940`（阈值 9102，余量 162），`WORKER_PROMPT_SLIM_BASELINE` 未改；scoped 门 `SCOPED_EXIT=0`、`tests 166 / pass 166 / fail 0`。

## Definition of Done

- 四条 AC 勾选，每条附可复跑命令与逐字读数。
- 7 条的最终处置写进任务体 `## Evidence`，不是只留在会话里。
- 本任务口径下 `string-assert` 从 7 降为 0。
- ⛔ 完成证据中不得出现「|D| 下降」或原子计数。

## Evidence

### E0 口径（两个长度量不混用）
- AC3 的 `4376 / 6573`（及 after）是 `gap-touches-parser-a-self-describing` fixture 的 **raw 渲染长度**。
- 棘轮的 `9064 → 8940` 是 `gap-x` + kernel 路径归一化 fixture 的**归一化合并长度**。
- ⛔ 未把 `4376+6573` 与 `9102` 比较。

### E1 渲染长度 before / after（AC3 读数）
复现命令（唯一差别是导入哪一份 `worker-driver.ts`；`QUAY_PLUGIN_ROOT` 把 kernel 安装路径钉成同一串——不钉的话 worktree 路径更长会让两条读数整体 +236，前后不可比）：

```
QUAY_PLUGIN_ROOT=/data/home/yale/work/quay/plugin node --experimental-strip-types --input-type=module -e '
const ID="gap-touches-parser-a-self-describing", ROOT="/data/home/yale/work/quay";
const C={worktreePath:"/data/home/yale/work/quay-worktrees/x",branchCommits:2,branchHeadSubject:"wip",acChecked:2,acTotal:5,failureReason:"suite red: plugin/test/x.test.mjs",attempts:[]};
for (const [tag,p] of [["BEFORE","/data/home/yale/work/quay/plugin/scripts/worker-driver.ts"],["AFTER","/data/home/yale/work/quay-worktrees/gap-prompt-string-assert-seven-rules-disposition/plugin/scripts/worker-driver.ts"]]) {
  const m=await import(p);
  console.log(tag,"create="+m.buildWorkerPrompt(ID,ROOT).length,"continue="+m.buildContinueWorkerPrompt(ID,ROOT,C).length);
}'
```

逐字读数：
```
BEFORE create=4376 continue=6573
AFTER  create=4314 continue=6511
DELTA  create=-62 continue=-62
RATCHET before=9064 after=8940 threshold=9102
```
（before 与任务体基线 4376 / 6573 **逐个字符相同** ⇒ fixture 复现一致。）

逐条处置对长度的贡献（和 = 上面的 DELTA，⛔ 无残余）：

| ruleId | 处置 | 贡献（raw create / raw continue / 归一化合并） | 说明 |
|---|---|---|---|
| `driverFanInNote-2` | remove | −62 / −62 / −124 | 删掉的正是括号清单 ` (merge develop → delta 判定 → typecheck → scoped门 → suite → ff)` = **62** 字符；它在两个基座里各出现一次 ⇒ 合并长度 −124。 |
| `formatRelatednessNote-1` | remove（并入 -2） | 0 / 0 / 0 | 表头 `delta-relatedness check (mechanical, not a verdict — verify before acting):`（75）→ `delta-relatedness check (mechanical):`（37），每条相关提示 −38；但 AC3 的 continue fixture `attempts:[]` **不产** delta-relatedness 提示 ⇒ 对本 fixture 贡献 0（单独量见下）。 |
| `driverFanInNote-1` / `-3`、`preMergeNote-1`、`continueDarkAxisNote-1`、`formatRelatednessNote-2` | enforce / keep | 0 / 0 / 0 | 只把判据从措辞命中换成行为/代码判据，**提示词文本逐字未改** ⇒ 长度贡献为 0。 |

`formatRelatednessNote` 单独读数（存在 delta-relatedness 提示时的贡献）：`before=355 after=317 delta=-38`（表头 75 → 37）。

### E2 逐条处置（AC1）
行号：`04d611e12` → **本分支**（本任务给四个构造函数各加了一段定处置的 JSDoc，行号整体下移；函数体本身未移动）。
src 前缀均为 `plugin/scripts/worker-driver.ts`。

| ruleId | src | rule（逐字摘要） | disposition | reason / 强制面 / 负臂 |
|---|---|---|---|---|
| `driverFanInNote-1` | 2432 → 2439 | `exit — the worker-driver takes over your worktree and mechanically runs fan-in` | **enforce** | 「driver 接管并机械跑」的机器半边是 **`runMechanicalFanIn`**（`worker-fan-in.ts:3035`），由 driver 在 worker 退出后调用；行为面由 `plugin/test/fan-in-driver-mechanical-orchestration.test.mjs` 真 repo 跑出。剩余「worker 该退出」半边是 agent 动作，进程结束即自然成立（超时由 driver 兜底）⇒ 无可违反的机器面。负臂 = 注入 B。 |
| `driverFanInNote-2` | 2432 → 2439 | `(merge develop → delta 判定 → typecheck → scoped门 → suite → ff)` | **remove**（并入 -1） | 不是一条可独立违反的规则：它是 -1 同一句的机制细节复述，worker 读没读到都不改变行为；且它是**机制正本（`runMechanicalFanIn` 的 step 序列）的手抄副本**，fan-in 增删步时静默漂移，无任何判据盯这个同一性。已从提示词删除（Plan §5 点名的那一条）。 |
| `driverFanInNote-3` | 2432 → 2439 | `You do NOT run the suite and do NOT call the fan-in workflow yourself.` | **enforce** | 两半都有机器面：(a) suite —— fan-in 的 suite 步是**无条件**的（`runMechanicalFanIn` 自己跑，⛔ 不读 worker 是否跑过）；(b) 不调 workflow —— `acquireFanInLock`（`worker-fan-in.ts:2278`）用 flock 使并发 fan-in **串行**，第二个只能排队。负臂 = 注入 C。 |
| `preMergeNote-1` | 2477 → 2483 | `before exiting, do the pre-merge + scoped-gate step … (i) merge develop into your worktree … resolve any conflict … do NOT skip` | **enforce** | fan-in 在**自己的锁内重做**这次 merge（`step("merge-develop")`，`worker-fan-in.ts:3474`），冲突即 red 且不落地；提示词那句是**优化提示**（把冲突提前暴露在 worker 回合里），不是执行证据。负臂 = 注入 A。 |
| `continueDarkAxisNote-1` | 2803 → 2809 | `The previous round was refused BY THE dark-axis STEP (verbatim: …) — add the missing L_D/L_G reading or 该轴仍暗,理由:… declaration` | **enforce** | 义务由 **`classifyDarkAxisRecord`**（`packages/quay/src/gate/dark-axis-record.ts:179`）在 done 翻牌前强制，负臂在 `plugin/test/dark-axis-record-check.test.mjs`；提示词子句只是**该判词的投影**。判据改造：从「有某句话」改为「它是 `failureReason` 的函数」（触发 iff `/dark-axis/i`、命中时逐字回显）。负臂 = 注入 D。 |
| `formatRelatednessNote-1` | 3378 → 3393 | 表头 `delta-relatedness check (mechanical, not a verdict — verify before acting):` | **remove**（并入 -2） | 与表尾 `This is a hint, not a conclusion …` 是**同一条规则**（把这块标成非结论）在两处复述，不是两条可各自违反的规则；合并后只由表尾承载，表头留 `(mechanical)`。 |
| `formatRelatednessNote-2` | 3378 → 3393 | `This is a hint, not a conclusion … Re-run the suite once to verify …` | **keep** | 措辞约束的是 **agent 的解读**，机器判不了 agent 怎么读（正当的 `keep` 情形）。行为级守卫：它**不是自动放行依据**这一点由 `judgeRetryExemption` 保证——豁免只读 delta 相关性 + 断言签名跨任务复发（耐久载体），⛔ 不读这段文本；一条 UNRELATED 提示本身永不免除重试计数（读数 E6）。 |

### E3 `string-assert` 清零（AC2）
这 7 条对应的**措辞断言共删除 24 条**（`git diff -U0 -- plugin/test | grep '^-' | grep -E 'assert\\.(match|ok|doesNotMatch)'`）：
- `plugin/test/worker-driver.test.mjs`（19 条）：`/exit — the worker-driver takes over/`（3 处）、`/mechanically runs fan-in/`（2 处）、`/You do NOT run the suite/`、`/do NOT call the fan-in workflow/`、`/before exiting, do the pre-merge \\+ scoped-gate step/`、`/run the SAME scoped gate the driver's fan-in runs/`、`/merge --no-edit develop/`（2 处）、`/not a verdict|not a conclusion/`、`/[Rr]e-run the suite once to verify/`、`doesNotMatch /\\bskip\\b|无需检查|可以跳过/`、`/delta-relatedness check/`（2 处）、`/refused BY THE dark-axis STEP/`（2 处）、`/MISSING: the task body records no L_D\\/L_G reading/`。
- `plugin/test/worker-driver-resident-s05.test.mjs`（3 条）：`/exit — the worker-driver takes over/`、`/mechanically runs fan-in/`、`/do NOT call the fan-in workflow/`。
- `plugin/test/worker-driver-resident-s06.test.mjs`（2 条）：`/exit — the worker-driver takes over/`、`/do NOT call the fan-in workflow/`。

换成**行为断言**（不是更宽的 `assert.match`）：
1. `formatRelatednessNote` = **输入→输出函数**：输出行数 = 输入信号数、每行按输入顺序点名其 `failingTest`、判词 token 由输入 `verdict` 映射（`= UNRELATED (` / `= RELATED (`）、空输入 ⇒ 空串（⛔ 只剩表头的空壳）。
2. 续做 prompt 的接线判据改为**数据**：suite 日志里 1 个失败测试 ⇒ 该测试名的**信号行恰好 2 行**（delta-relatedness + load-sensitive）；无 suite 红 ⇒ **0 行**。
3. `continueDarkAxisNote` 改为**条件函数**：prior reason 在 prompt 中的**出现次数**是判别器 —— 触发（`/dark-axis/i`）⇒ 2 次（通用 `because:` 行 + 子句逐字回显），未触发 ⇒ 1 次（⛔ 不用措辞命中）。

### E4 每条 `enforce` 规则的负臂（注入违约 ⇒ 检查必红，逐字读数）
四次注入都在本 worktree 的源码上做完即 `git checkout --` 还原（`git status --porcelain` 复核只剩本任务的 4 个文件改动）。

- **注入 B（`driverFanInNote-1`，driver 不接管 ⇒ `runMechanicalFanIn` 直接返回 landed 空结果）**
  `node --test --test-name-pattern="机械 fan-in 落地" plugin/test/fan-in-driver-mechanical-orchestration.test.mjs` ⇒ 红：
  `✖ AC1/AC2/AC4 — 机械 fan-in 落地…` / `AssertionError: suite must be done` / `null !== 'done'` / `actual: null, expected: 'done'`。
- **注入 A（`preMergeNote-1`，fan-in 锁内不再重做 merge ⇒ 该步 argv 换成 `git status`）**
  `--test-name-pattern="merge develop 冲突"` ⇒ 红：
  `✖ merge develop 冲突 ⇒ 机械 fan-in red（step=merge-develop），锁仍 release` / `+ actual - expected` / `+ 'ff'` / `- 'merge-develop'`。
- **注入 C（`driverFanInNote-3`，并发 fan-in 不再串行 ⇒ flock holder 换成 `exit 0`）**
  `--test-name-pattern="排队等锁"` ⇒ 红：
  `✖ AC2 机制 … 排在持有者之后的机械 fan-in 排队等锁…` / `Error: fan-in lock holder exited before acquiring (code 0)`（`worker-fan-in.ts:2322`）。
- **注入 D（`continueDarkAxisNote-1`，子句不再条件化 ⇒ 去掉 `/dark-axis/i` 判断）**
  `node --test --test-name-pattern="dark-axis obligation" plugin/test/worker-driver.test.mjs` ⇒ 红：
  `✖ AC4 …` / `untriggered: only the generic `because:` line …` / `2 !== 1` / `actual: 2, expected: 1`。

### E5 `remove` 规则：删了不会变坏的读数
- `driverFanInNote-2` 删除、`formatRelatednessNote-1` 合并后，机械 fan-in 的**行为**测试仍全绿：
  `node --test plugin/test/fan-in-driver-mechanical-orchestration.test.mjs` ⇒ `tests 14 / pass 14 / fail 0`（27474ms）。该文件跑的是**真 repo + 真 git**：落地、suite 红不落地、merge 冲突 red、锁排队、per-suite runId、delta 影子读数等。
- 三个受影响的 prompt 测试文件全绿：`node --test plugin/test/worker-driver.test.mjs plugin/test/worker-driver-resident-s05.test.mjs plugin/test/worker-driver-resident-s06.test.mjs` ⇒ `tests 166 / pass 166 / fail 0`（52635ms）。
- `driverFanInNote-2` 的删除另有一层「删了不会变坏」的结构证据：删的是**机制正本的手抄副本**；正本（`runMechanicalFanIn` 的 step 序列）本身由上面那个 14/14 的行为测试读真 trace 覆盖。

### E6 `keep` 的行为级守卫（`formatRelatednessNote-2`）
该规则的实质是「这段提示不是结论、不能当自动放行」。机器可判的那半边是：**豁免判定不读这段文本**。
- `node --test --test-name-pattern="AC3 \(反向控制\)|AC4 \(硬规则 3b\)" plugin/test/worker-driver-fan-in-s04.test.mjs` ⇒ `tests 2 / pass 2 / fail 0`：两个不同缺陷跨 2 任务仍 `own-defect-counted`（照常计数）；判不出（退化签名 / 无断言行 / suite log 读不到）⇒ `insufficient-data-fallback`，⛔ 不与豁免同形。
- `node --test --test-name-pattern="judgeRetryExemption" plugin/test/worker-driver-fan-in-s03.test.mjs plugin/test/worker-driver-fan-in-s04.test.mjs` ⇒ `pass 2 / fail 0`。
- 结论：一条 UNRELATED 提示本身永远换不来豁免——豁免要的是「断言签名在 48h 窗口里跨 ≥2 个不同任务复发」这一条耐久载体上的读数。提示措辞因此是**解读约束**，不是放行开关。

### E7 无回归与棘轮（AC4 前半）
- 三文件：`tests 166 / pass 166 / fail 0`（含 `gap-worker-prompt-note-family-slimming` AC1/AC2）。
- 长度棘轮：`RATCHET before=9064 after=8940 threshold=9102` ⇒ 绿，余量 **162**（原 38）。`WORKER_PROMPT_SLIM_BASELINE` **未改**（仍 12137）——本任务只靠删除补偿，⛔ 未做 re-anchor。
- 最终树（提交 `86d476346`，仅测试名同步）复核：`node --test --test-name-pattern="gap-worker-verify-condenser" plugin/test/worker-driver.test.mjs` ⇒ `tests 1 / pass 1 / fail 0`。

### E8 scoped 门读数（AC4 后半）
命令（在本 worktree 内实跑）：
```
bash /data/home/yale/work/quay-worktrees/gap-prompt-string-assert-seven-rules-disposition/scripts/test.sh \
  --for-task gap-prompt-string-assert-seven-rules-disposition --allow-thin
```
逐字读数（尾部）：
```
ℹ tests 166
ℹ suites 0
ℹ pass 166
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 46746.067613
tmp-root-telemetry: root=/tmp/quay-suite-1507971-3Dhyc4 created=10 reaped=10 leaked=0 evaluated=true
SCOPED_EXIT=0
```
该次运行还覆盖了 scoped 静态检查层（`== scoped static checks (change-relevant tier …) ==`，含 `task-contract-check` / `malformed-task-check` / `touches-one-entry-one-path-check` / `test-isolation-check` / `test-impl-census-check` 等）+ `build dist` + `sync-vendor --sync-dist`，全部通过（`SCOPED_EXIT=0`）。
⚠️ 口径：该次门跑的是本任务在 develop 合并后的树；其后只有一次**测试名文案**同步（`86d476346`，不改断言与实现）与一次**任务体 Evidence** 写入 —— scoped 门的输入面（`plugin/scripts/**`、`plugin/test/**`）自该次运行起未再变化。

### ADR-007 dark-axis 记录
该轴仍暗,理由:本任务只改提示词构造函数的文本与测试断言的种类（措辞命中 → 行为/代码判据），未新增或删除任何模块、导出或依赖边，L_D/L_G 没有新的可测读数。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- plugin/test/worker-driver-resident-s05.test.mjs
- plugin/test/worker-driver-resident-s06.test.mjs
- tasks/gap-prompt-string-assert-seven-rules-disposition.md

## 追加记录（落地后核出，未处理）

**发现**：`plugin/scripts/conflict-resolution-rules.ts:220` 的 `resolveConflictMechanically` 能真跑 `git checkout develop --` / `git rm` / dual-copy 字节同步，且有行为测试（`plugin/test/worker-driver-resident-s07.test.mjs:145/245`）。但全仓调用点只有**该文件的 CLI 入口**（`:296`）与测试——**worker/driver 生产路径没有调用者**。

**影响**：`buildContinueWorkerPrompt` 的冲突消解块 = **1842 字符（continue prompt 的 34%）**，其中规则 (1) take-develop docs、(3) dual-copy 已是**机器可判**，prompt 却仍教 agent 手工执行同样的 git 命令。⇒ 生产路径绕过了可执行载体；这正是本任务「可见性 ≠ 执行」的同一形态，只是这次的载体**已经存在且已测试**。

**为何本任务未处理**：本任务的 7 条只覆盖 `enforcement=string-assert` 的规则；冲突消解块不在其中，故未纳入 AC。

**建议动作（未执行）**：把机械可判的两条改为让 worker 调用既有 CLI（`conflict-resolution-rules.ts --resolve <root> <rel> <status>`），prompt 只保留判断型规则 (2)(2b)(5)(6)+FF；预估 −~700 字符。

**PARKED**：本条**不重派**本任务。解除条件（任选其一）：
- 有人明确下令把机械消解接进 worker 路径；
- 或出现第二次「prompt 教 agent 做代码已会做的事」的实例（incidence ≥2）。

unpark 检查（为空 ⇒ 仍然未接线）：
```
grep -rn 'resolveConflictMechanically' plugin/scripts --include='*.ts' | grep -v conflict-resolution-rules.ts
```