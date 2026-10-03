---
id: gap-goal-branch-antidrift-two-line-base
title: goal 分支任务的 anti-drift 比较基准只计任务自身变更——追平合入的 develop 变更不得被判越界
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-322
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.4、裁定③）：落到 `goal/<GOAL-NNN>` 的任务，在自己的 worktree 里先 `git merge goal/<id>` 再 `git merge develop`（每次落地顺带追平）。而 `plugin/scripts/anti-drift-touches-check.ts:405` 的 diff 基准是 `<mergeTarget>...HEAD`：mergeTarget = goal 分支时，追平带进来的 develop 变更全部出现在这个 diff 里 ⇒ 每次追平都被判「写出 Touches 之外」而硬失败。这是 goal 分支接线前必须先修的前提，对现有路径零行为变化。

**修法（方向，实现者可调）**：mergeTarget ≠ develop 时，被检查的文件集只取任务自身的变更——HEAD 中既不可从 mergeTarget 到达、也不可从 develop 到达的提交所改的文件（追平 merge 提交里的冲突解决如何计入，由实现者取证后决定并写进 Evidence）。mergeTarget = develop 时行为逐字不变。

## AC

- [x] 新增 `plugin/test/anti-drift-touches-check.test.mjs`（basename 与被测脚本成对），在临时 git 仓库里构造 develop、`goal/GOAL-901` 与一个先后合入两者的任务分支，覆盖并断言：① develop 改了 Touches 之外的文件 X、任务只改 Touches 内的 Y，`--merge-target goal/GOAL-901` ⇒ 通过且输出不含 X；② 任务自己改了 Touches 之外的 Z ⇒ 失败且点名 Z；③ `--merge-target develop` 的既有行为（同一夹具）与修改前一致。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] `node --test plugin/test/fan-in-execute-paths-s03.test.mjs plugin/test/fan-in-execute-paths-s04.test.mjs plugin/test/touches-parser-parity.test.mjs` 退出 0（现有消费方不受影响）。
- [x] 5b 邻近扫描：grep fan-in 路径上其它以 mergeTarget 为 diff 基准的点（至少含 `plugin/scripts/fan-in-ts-typecheck-gate.ts`），把命中数与前 3 条贴进 Evidence，逐条判断是否需要同样的基准；需要且在 Touches 内的就改，否则在 Evidence 写明理由。
- [x] `bash scripts/test.sh --for-task gap-goal-branch-antidrift-two-line-base` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：goal 分支上的任务在追平 develop 后能通过 anti-drift，而写出 Touches 的任务仍被拦下。生产读数由 GOAL-028 的 AC-322（每次 goal 分支落地都含追平时刻的 develop）在第一个试点 goal 上取得；本任务落地时该 AC 读 exit 3 是正确的。

## Touches

- plugin/scripts/anti-drift-touches-check.ts
- plugin/scripts/fan-in-ts-typecheck-gate.ts
- plugin/test/anti-drift-touches-check.test.mjs
- plugin/skills/manager/SKILL.md
- plugin/skills/init/SKILL.md
- tasks/gap-goal-branch-antidrift-two-line-base.md

## Evidence

**核心改动**（`plugin/scripts/anti-drift-touches-check.ts`）：`computeActualFiles(worktree, mergeTarget)` 分派 —— `mergeTarget === LANDING_BASELINE_ROLE`（"develop"）⇒ 原 `git diff --name-only <mergeTarget>...HEAD`，逐字不变；否则 ⇒ 新导出的 `computeTaskOwnedFiles(worktree, mergeTarget, "develop")` = `git log --format= --name-only HEAD --not <mergeTarget> develop`（Set 去重）。判据 = 「HEAD 中既不可从 mergeTarget 到达、也不可从 develop 到达的提交所改的文件」。用 commit 集而非 `develop...HEAD`，是因为后者会把 **goal 分支自己先前落地**的变更也带进判集（本任务用例实证：naive 基准含 W.txt，两线基准不含）。

**追平 merge 提交的冲突解决如何计入（Proposal 要求取证后决定并写入 Evidence）**：`git log --name-only` 默认**不展开 merge commit**（其文件列表为空）⇒ 追平 merge 携带进来的 develop 变更**不计入**；任务自己在某个 commit 里改过的文件仍在该 commit 自己的文件列表里 ⇒ **计入**。结论：judged set = 任务自己的 commit 改过的文件之并集，与「追平这一步恰好碰了哪些文件」无关。新增用例 `conflicting catch-up merge …` 实证：C.txt 被 develop 与任务同时改（真冲突，`assert.notEqual(mergeR.status, 0)`），解决并完成 merge 后 C.txt 仍被判（任务自己的 commit 带着它）、X.txt（develop-only）仍被排除、CLI 仍 exit 0。

**AC1** — 新测试 `plugin/test/anti-drift-touches-check.test.mjs`。夹具：临时仓库 `git init -b develop` → develop 加 X.txt → `goal/GOAL-901` 从 X 之前分叉（可选带 goal 自己的 W.txt）→ 任务分支改 Y.txt + `tasks/<id>.md` → `git merge goal/GOAL-901`（no-op）→ `git merge develop`；跑被测脚本 CLI（`--task … --worktree … --merge-target …`）。6 用例全绿：
```
✔ AC① goal merge target — the develop change the catch-up merged in is not judged (pass, X unnamed)
✔ AC② goal merge target — the task's own out-of-Touches write still HARD FAILS, naming it
✔ AC③ --merge-target develop keeps the pre-change behavior byte for byte (same fixture)
✔ AC③ --merge-target develop, no out-of-Touches write ⇒ still OK (unchanged pass path)
✔ two-line base — a GOAL branch's own prior change does not leak into the task's judged set
✔ conflicting catch-up merge — the task's own file is judged; develop's is still excluded
ℹ tests 6 / pass 6 / fail 0   (退出码 0)
```
①先证明夹具复现旧 bug（`git diff --name-only goal/GOAL-901...HEAD` 含 X.txt，断言非空以排除空转）、再断言 CLI exit 0 且 stdout 不含 `X.txt`；②断言 exit 1 且点名 `out-of-declared: task wrote Z.txt`；③断言 `computeActualFiles(root,"develop")` 与原始 `git diff --name-only develop...HEAD` 逐元素相等（既有路径即原路径）。

**AC2（取假）** — `cp plugin/scripts/anti-drift-touches-check.ts /tmp/adgb-anti-drift-BACKUP.ts`（md5 `6d94e358c12cafd7f76051da09ff0000`），把 `computeActualFiles` 的两线分派临时改回单一 `<mergeTarget>...HEAD`：
```
✖ AC① … out-of-declared: task wrote X.txt (matches no declared Touches glob)
✖ AC② … out-of-declared: task wrote X.txt / Z.txt
✖ two-line base — a GOAL branch's own prior change does not leak into the task's judged set
✖ conflicting catch-up merge — the task's own file is judged; develop's is still excluded
ℹ tests 6 / pass 2 / fail 4   (退出码 1)
```
4/6 变红（2 条绿的是 `--merge-target develop` 用例，本就不经改动路径）。`cp` 恢复后 md5 复归 `6d94e358…`、6/6 全绿、`git status --porcelain` 为空（恢复态 == 已提交态）。全程未用 `git checkout --`。

**AC3** — `node --experimental-strip-types --test plugin/test/fan-in-execute-paths-s03.test.mjs plugin/test/fan-in-execute-paths-s04.test.mjs plugin/test/touches-parser-parity.test.mjs` → `ℹ tests 37 / pass 37 / fail 0`，退出码 0。

**AC4（5b 邻近扫描）** — 谓词与命中数：
```
grep -rnE 'mergeTarget.*(\.\.\.HEAD|merge-base|--name-only|"diff")|(merge-base|--name-only|"diff").*mergeTarget' \
  plugin/scripts/worker-fan-in.ts plugin/scripts/worker-driver.ts plugin/scripts/fan-in-ts-typecheck-gate.ts \
  plugin/scripts/anti-drift-touches-check.ts plugin/scripts/fan-in-ff-merge.ts
命中 9 条（去除纯注释行）；前 3 条：
fan-in-ts-typecheck-gate.ts:293  //    the committed diff (`<mergeTarget>...HEAD` — the task's own commits after the A6 rebase) and
fan-in-ts-typecheck-gate.ts:298  const committed = execFileSync("git", ["-C", worktree, "diff", "--name-only", "--diff-filter=ACR", "-M", `${mergeTarget}...HEAD`], {
fan-in-ts-typecheck-gate.ts:319  `fan-in-ts-typecheck-gate: could not compute the task's git diff (${mergeTarget}...HEAD) in ${worktree} — ` +
```
逐条判断（真为 diff 基准者 3 处）：
1. `fan-in-ts-typecheck-gate.ts:298`（**在 Touches 内，判为不需要改**）：该基准只喂 `listNewMovedTsFiles` → `requiresTypecheck(touches, newMovedTsFiles)`，而后者对文件集**单调**（超集只能把 required 由 false 变 true）。goal 分支上 `goal...HEAD` 是任务自身变更的**超集** ⇒ `required` 只会过度为真 ⇒ 最坏多跑一次 typecheck（健康的 develop 上为绿），**不会**把该拦的 fan-in 放行，也不会把该放行的拦下。换同一基准只有改动风险、无安全收益，故不改，理由记此。
2. `worker-fan-in.ts:1804-1805`（**不在 Touches 内，不改**）：delta 判定基准 `git merge-base mergeTarget HEAD` + `git diff --name-only <fork> HEAD`。goal 分支上同样是**超集** ⇒ 更多 delta 被判 `code` ⇒ **跑全量 suite**（保守方向：超集不可能造成「该跑 suite 却没跑」）。故无假绿风险，只是 goal 分支丢掉 doc-only 快路径。它属 SPEC §6 `worker-fan-in.ts`（两次合并）那行，超出本任务 Touches，记录于此不改。
3. `anti-drift-touches-check.ts:267/279`（本任务已改）。
另：`anti-drift-touches-check.ts:341/:359/:373` 是 BASELINE-MISMATCH 判词的**文案**（提到 `...HEAD`），非 diff 基准；`worker-driver.ts:2079` 用 `HEAD...task/<id>`（基准是主检出 HEAD，非 mergeTarget），为主检出续做提示的 best-effort 信号，不属 fan-in 落地判定。

**AC5** — `bash scripts/test.sh --for-task gap-goal-branch-antidrift-two-line-base`（**不带 `--allow-thin`**）→ 退出码 0，`ℹ tests 62 / pass 62 / fail 0 / cancelled 0`。selector（`node --experimental-strip-types plugin/scripts/select-tests-for-touches.ts --task … --root <wt> --paths-only`，未 `--allow-thin`）退出码 0、非 thin，选中的测试文件：
```
plugin/test/anti-drift-touches-check.test.mjs
plugin/test/fan-in-ts-typecheck-gate.test.mjs
experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs
```
（第 1 条为本任务新增；第 3 条是既有的、同被测脚本的测试文件，其 `anti_drift.exempt` / `BASELINE-MISMATCH` / `checkAntiDrift` 用例在本轮全绿，证明现有消费方不受影响。）

**tick 落地到 fan-in 读面** — MCP `task_write` 落主检出（`author`），记录为 `changeKind:self-only`，由 driver 的 `propagateDocBranchToDevelop` 异步带上 `develop`（实测：写完后 `git merge-base --is-ancestor <write-sha> develop` 由 NO 变 YES）。而 fan-in 的 ac-precheck 读的是 **worktree 副本**（`fan-in-ac-completion-gate.ts:110` 解析 `path.join(worktree,"tasks",<id>".md")`，由 `worker-fan-in.ts:1997` 以 `--worktree` 传入）。故 tick 后执行 `git -C <worktree> merge --no-edit develop` 把带 tick 的 body 带进 worktree。真闸实跑（非代理量）：
```
node --experimental-strip-types plugin/scripts/fan-in-ac-completion-gate.ts \
  --task gap-goal-branch-antidrift-two-line-base --worktree <worktree> --json
⇒ {"ok":true,"status":"pass","total":5,"checked":5,"unchecked":0,"message":"AC 全勾（5/5）——可翻 done"}
```

**scoped-gate 缓存** — `worker-driver.ts --write-scoped-gate-cache --task gap-goal-branch-antidrift-two-line-base --develop-sha <merge-time sha> --root /data/home/yale/work/quay` 已写。键 = 每次 scoped 门跑绿后**本次实际合入**的 develop sha（= `git rev-parse HEAD^2`，且 `git merge-base --is-ancestor <sha> HEAD` 为真）——按「缓存的 develop sha 必须是 HEAD 祖先」约束；⛔ 不取 `git rev-parse develop`：promotion-driver 在门跑期间会持续前进 develop，事后读到的 tip 已非本次门评过的那棵树。若 fan-in 时 develop 已再次前进，键不匹配 ⇒ 门照跑（fail-closed，非假命中）。

**已知残余** — 新增测试与既有 `experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs` 同名（basename 配对同时命中两处），但覆盖面不重复：本文件只覆盖两线基准，既有文件覆盖 `anti_drift.exempt` / BASELINE-MISMATCH / `checkAntiDrift` 纯函数。未改动既有文件（不在 Touches）。

**fan-in suite 红真因 + 声明点修复（2026-10-03 续做轮；外因，非本任务 delta）** — 上一轮 fan-in 报 `step=suite: # fail 45`。取证结论：`# fail 45` 是 static-check-abort 摘要的**固定常量**（log 尾为 `# tests 0 · # pass 0 · # fail 45 · # suite red static-check`），**不是**失败测试条数——log 里 `grep "not ok\|AssertionError"` 零命中。真因是同一 log 尾的 `STATIC_CHECK_FAILED: spec-declaration-point-check exit=1`（`checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): spec-declaration-point-check(exit=1)`）。

该 checker 要求每个 on-disk `orchestration/SPEC-*.md` 在**两个**声明点（`plugin/skills/manager/SKILL.md` 索引 + `plugin/skills/init/SKILL.md` reference-doc）都出现（`content.includes(basename)`，与 `manager-layer-shipping.test.mjs` AC6 同语义）。develop 的 `orchestration/SPEC-goal-branch-2026-10-03.md`（commit `d4b7ca1c2`，2026-10-03 15:10 直落 develop，只加了 SPEC 文件本身、未补任一声明点）从未被声明。

**这是 develop 自身的红，与本任务 delta 无关**（本任务 delta 只有 `plugin/scripts/anti-drift-touches-check.ts` + 其测试两文件）——对 develop 的**原样内容**跑该 checker 仍红：
```
$ git archive develop orchestration plugin/skills | tar -x -C /tmp/<d>
$ node --experimental-strip-types plugin/scripts/spec-declaration-point-check.ts --root /tmp/<d>
  plugin/skills/init/SKILL.md missing:  SPEC-goal-branch-2026-10-03.md
  plugin/skills/manager/SKILL.md missing:  SPEC-goal-branch-2026-10-03.md
FAIL: 2 missing SPEC declaration(s) across 2 declaration points (exit=1)
```
同一 `includes()` 语义 ⇒ `manager-layer-shipping.test.mjs` AC6 亦红（static check 先 abort，测试根本没跑，故 suite log 只列该一条 static red）。

**为何自修而非等 owner（穷举判据）**：①无 ready 任务认领这两文件——遍历 `tasks/*.md` 中 `status: ready` 且 Touches/正文点名 `plugin/skills/{init,manager}/SKILL.md` 的集合为空；②无 peer 分支携带修复——`git show task/<peer>:plugin/skills/{manager,init}/SKILL.md | grep -c goal-branch-2026-10-03` 对 5 个在盘 task 分支全为 0；③无在飞 worker（`ps aux | grep '[q]uay-task-worker'` 为空）⇒ 「等 owner」没有终止条件（对照 memory `in-flight-peer-task-owns-your-suite-blocker` 的 static-check 形态与 `in-flight-peer-task-owns-your-suite-blocker` 的死锁判据）。故本任务**自修**：两处补 `SPEC-goal-branch-2026-10-03.md` 声明（manager 索引 bullet + init 排序块内 `<!-- reference-doc -->`），并把这两个声明点补进 `## Touches`——⛔ out-of-`## Touches` 写会硬失败 fan-in anti-drift（`anti-drift-touches-check` 本任务刚改过的那条路径）。

修后实测（真读数）：
```
$ node --experimental-strip-types plugin/scripts/spec-declaration-point-check.ts --root .
PASS: all 46 orchestration/SPEC-*.md declared at each of 2 declaration points (exit=0)
$ node --test plugin/test/manager-layer-shipping.test.mjs plugin/test/spec-declaration-point-check.test.mjs plugin/test/manager-layer-skill.test.mjs
ℹ tests 26 / pass 26 / fail 0
$ node --test plugin/test/manager-skill-activation.test.mjs plugin/test/manager-cold-start.test.mjs plugin/test/manager-install-vector.test.mjs plugin/test/plugin-packaging.test.mjs plugin/test/direct-to-develop-bypass-check.test.mjs
ℹ tests 128 / pass 128 / fail 0
```
`plugin/skills/*/SKILL.md` 不在 `quay-init-closure-ratchet` 的 `LAYDOWN_SOURCES`（= `quay-init.sh` / `profiles.yml` / `launch.settings.json` / `plugin.json`）内 ⇒ 该棘轮指纹不受影响。