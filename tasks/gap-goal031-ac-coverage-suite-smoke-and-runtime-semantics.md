---
id: gap-goal031-ac-coverage-suite-smoke-and-runtime-semantics
title: GOAL-031 充分性跟进：提案新增候选 AC-346（测试与 smoke 全绿 + 迁移不改变运行时语义），覆盖退出条件中未被现有三条 AC 覆盖的两处
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**goal-sufficiency 跟进任务（提案，非执行）**：GOAL-031 的充分性判定持续为 `insufficient`——缓存键 `6495af2e346e7f351cdf42598cbddbf16a2f14929bf0e60524777aa3a186d0d4`，`2026-10-08T14:16:39.643Z` 记录；round log 记 `sufficiency=insufficient（在域 AC 3 条）`。判定已跨过一个完整 judge+look 周期无人处理，本任务把「退出条件 vs AC 集」的差集写成一份可直接采纳的提案，交人裁定。⛔ 本任务**不写 goal store**、**不勾任何 AC/GOAL**——产物是一份提案（一个 task），不是状态变更。

### 一、未覆盖的退出条件（逐字引用）

GOAL-031「退出条件」原文（本 AC 要补的两处已加粗标注）：

> `goal-driver.ts` 的 5 处 `needs-human` 裸字面量比较全部消费 `plugin/scripts/task-status.ts` 的既有正本，不新造第二套；**不改变状态机允许边/运行时语义**；`grep -c 'status === "needs-human"' plugin/scripts/goal-driver.ts` 从 6 精确降到 1；`get_literal_dispersion(value:"needs-human")` 从 5 降到 4，且 4 个残量逐一有记录在案的"非缺陷"理由（正本 1 + 豁免 1 + 假阳性 2）；`import-graph-check.ts` 四个棘轮量不回退；**suite/smoke 全绿**；分支自举身份可证明加载分支自己代码；goal branch 以恰好一个合并提交进入 develop，并入后生产读数核验通过；且全程不依赖、不干扰 `goal/GOAL-030` 分支及其未并入产物。

被引用、且当前 AC 集覆盖不到的原文子串，就这两处：

1. 「**不改变状态机允许边/运行时语义**」
2. 「**suite/smoke 全绿**」

### 二、为什么现有 AC 集不覆盖它（逐条实读 criterion，不是看标题）

- AC-343（结构与范围护栏，已 achieved）：criterion 全是计数/字面量判定——`grep -c` needs-human==1、823 行 `grep -qF` 逐字节、todo==2/ready==2/done==0、存在 `task-status` import、无 GOAL-030 引用、无第二个 kernel 源。**不执行任何测试**。
- AC-344（收敛读数+棘轮+身份，active）：criterion 读两份证据 JSON，加跑 `import-graph-check.ts --json`。**不执行任何测试**；`import-graph-check` 是单一静态检查，不等于 suite。
- AC-345（并入形态+并入后生产读数，active）：criterion 全是 git 形态判定 + `grep -c` 生产读数。**不执行任何测试**。

⇒ 「suite/smoke 全绿」在三条 AC 里**零执行**。

⇒ 「不改变状态机允许边/运行时语义」同样零执行，且**不能靠 AC-343 补齐**：AC-343 只钉「needs-human 裸字面量计数==1 ∧ 存在 task-status import」。一个**语义错误的**替换照样让它 exit 0——例如 5 处都改成 `TASK_STATUS.TODO`，或把 `isTaskStatus(x)` 当成 `x === "needs-human"` 用（`isTaskStatus` 是五值集合的成员判定，会让 `isTaskStuck` 对任意合法状态返回 true）。运行时语义只有**跑这些代码路径的测试**才能证伪。

### 三、同族先例：这是「漏了对位」，不是「有意不做」

上一个同族试点 **GOAL-030** 的退出条件含「测试、smoke、`import-graph-check` 与分层约束通过」，它有**一条专门的 AC-338「测试与 smoke：`scripts/test.sh` 跑 … 共 6 个文件全绿」**，其判据正是 `scripts/test.sh <files>` + 解析 `^ℹ tests/fail` 汇总；GOAL-030 的充分性判定为 `covered`（在域 AC 7 条）。GOAL-031 的 goal body 把退出条件映射为「对应 AC-343（结构与范围护栏）、AC-344（收敛读数+棘轮+分支身份）、AC-345（并入形态+并入后生产读数）」——**恰好漏掉 AC-338 的那条对位**。本提案补的就是它。

### 四、提案：新增候选 AC-346（一条）

**候选标题**：测试与 smoke 全绿 + 迁移不改变运行时语义：goal-driver 分片经 `scripts/test.sh` 全绿，且正本常量 `TASK_STATUS.NEEDS_HUMAN` 与原子面量取值恒等
**相位**：并入前（同 AC-343/344，在 goal 分支/worktree 上求值）
**expect**：exit 0 = 分片全绿且常量取值恒等；exit 1 = `CAUSE=` 指明哪一项；exit 3 = 测试未产出汇总（test.sh 未跑成）

**判据（可直接 `quay goal write` 写入，bash heredoc 形态）**：

```bash
set -u
root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
cd "$root"
files="plugin/test/goal-driver-s01.test.mjs plugin/test/goal-driver-s06.test.mjs plugin/test/goal-driver-s08.test.mjs plugin/test/goal-driver-s12.test.mjs"
for f in $files; do [ -f "$f" ] || { echo "CAUSE=test-file-absent — $f (the slice's tests must exist before this AC can be read)" >&2; exit 1; }; done
log=$(mktemp /tmp/goal031-tests.XXXXXX); trap 'rm -f "$log"' EXIT
scripts/test.sh $files >"$log" 2>&1; rc=$?
tests=$(grep -oE '^ℹ tests [0-9]+' "$log" | tail -1 | awk '{print $3}')
fail=$(grep -oE '^ℹ fail [0-9]+' "$log" | tail -1 | awk '{print $3}')
[ -n "${tests:-}" ] || { echo "NOT-EVALUATED: scripts/test.sh printed no test summary (exit $rc): $(tail -2 "$log" | tr '\n' ' ')" >&2; exit 3; }
[ "$rc" -eq 0 ] && [ "${fail:-1}" -eq 0 ] && [ "$tests" -ge 4 ] || { echo "CAUSE=tests-red — scripts/test.sh exit $rc, tests $tests, fail ${fail:-?}: $(grep -E '^not ok|✖' "$log" | head -3 | tr '\n' ' ')" >&2; exit 1; }
val=$(node --experimental-strip-types -e '(async()=>{const m=await import("./plugin/scripts/task-status.ts");process.stdout.write(String(m.TASK_STATUS.NEEDS_HUMAN))})().catch(()=>{})' 2>/dev/null)
[ "$val" = "needs-human" ] || { echo "CAUSE=canonical-value-drift — TASK_STATUS.NEEDS_HUMAN=\"${val:-<unreadable>}\", want \"needs-human\": the substitution would no longer be value-identical to the literal it replaced" >&2; exit 1; }
echo "PASS: scripts/test.sh on 4 goal-driver shards: $tests tests, 0 fail; TASK_STATUS.NEEDS_HUMAN === \"needs-human\" (runtime semantics unchanged)"
```

**为什么这一条覆盖上面两处**：

- 第 1 段（测试全绿）：这 4 个分片覆盖被迁移的路径——`goal-driver-s01` 直接覆盖 `isTaskStuck`/`isTractionStatus`（即 2088/2098 两处），s06/s08/s12 覆盖 in-flight/traction 判定（2319/2383/2443）。**跑绿即证伪「运行时语义被改」**，这正是 GOAL-030 AC-338 的同一形状（scoped 文件集 + `^ℹ tests/fail` 汇总解析）。
- 第 2 段（常量取值恒等）：无论每处写成 `TASK_STATUS.NEEDS_HUMAN` 还是别的惯用形式，只要替换目标与原子面量**取值恒等**，比较结果就不变——这是「不改变运行时语义」的机械前提，且与第 1 段互补（测试证明行为未变，恒等证明替换对象正确）。
- 两段都是**单态**检查、都可在**并入前**求值，与 AC-343/344 同相位。

**落笔当轮的实测读数（判据声称「应为 Y」当轮必须取一次真读数）**：

- `scripts/test.sh plugin/test/goal-driver-s01.test.mjs …s06 …s08 …s12` → `rc=0`、`ℹ tests 41`、`ℹ fail 0`（约 3.1s，在本仓主检出 author@ 实测）。
- `node --experimental-strip-types -e '… import("./plugin/scripts/task-status.ts") …'` → `{"NEEDS_HUMAN":"needs-human","isLiteral":true}`。

### 五、本任务**不**处理的其余未覆盖项（供人知悉，不算在本提案内）

退出条件里的「且 **4 个残量逐一有记录在案的"非缺陷"理由（正本 1 + 豁免 1 + 假阳性 2）**」只被 AC-344 **部分**覆盖：AC-344 只读 `after.dispersion===4` 且 `after.files` 不含 `plugin/scripts/goal-driver.ts`，**不核验那 4 个残量逐一有归档理由**。本任务只提一条 AC（候选 AC-346），**不**一并提这条；若人认为必要，宜另立或在 AC-344 上修订。

### 六、dedup / 粒度决策

<!-- dedup-ref --> 关联但不重复：`gap-goal031-needs-human-literal-migration`(done)、`gap-goal031-selfhost-evidence-and-arch-layer-review`(ready)、`gap-goal031-preview-merge-and-postmerge-verify`(todo) 分别承接 AC-343/344/345 的**执行**工作，**没有任何一条提案增删 GOAL-031 的 AC 或退出条件**。前者的任务级 AC 里也写了「相关测试分片绿」，但那是该任务自身的验收，不是 goal 级 AC 的提案，故不构成重复（decision: separate，无 merge 候选）。

## Plan

1. 人读本提案（本任务已置 `needs-human`）。
2. 接受 ⇒ 由人经 `quay goal write` 把候选 AC-346（标题/判据/相位/expect 见上）写入 GOAL-031。
3. 接受后，在 goal 分支 tip 上按该判据取一次真实读数（并入前相位），把读数作为该 AC 的首次 evidence。
4. 拒绝，或改为修订退出条件 ⇒ 记录理由；本任务以该理由收尾，不产出 AC（本任务自身不写 goal store）。

## Acceptance Criteria

- [ ] 本任务体逐字包含 GOAL-031 退出条件中未被覆盖的两处原文子串：`grep -qF '不改变状态机允许边/运行时语义' tasks/gap-goal031-ac-coverage-suite-smoke-and-runtime-semantics.md && grep -qF 'suite/smoke 全绿' tasks/gap-goal031-ac-coverage-suite-smoke-and-runtime-semantics.md`
- [ ] 候选判据完整落笔（三态退出码 + 两个 `CAUSE=`）：`grep -qF 'CAUSE=canonical-value-drift' tasks/gap-goal031-ac-coverage-suite-smoke-and-runtime-semantics.md && grep -qF 'CAUSE=tests-red' tasks/gap-goal031-ac-coverage-suite-smoke-and-runtime-semantics.md`
- [ ] 判据的两段读数在评审时可在本仓复现：`scripts/test.sh plugin/test/goal-driver-s01.test.mjs plugin/test/goal-driver-s06.test.mjs plugin/test/goal-driver-s08.test.mjs plugin/test/goal-driver-s12.test.mjs` exit 0 且末行 `ℹ fail 0`；`node --experimental-strip-types -e '(async()=>{const m=await import("./plugin/scripts/task-status.ts");process.stdout.write(String(m.TASK_STATUS.NEEDS_HUMAN))})()'` 输出 `needs-human`
- [ ] 未改动 goal store：`[ "$(git diff --name-only develop...HEAD -- goals/ | wc -l)" -eq 0 ]`
- [ ] 任务处于 `needs-human` 交人复核：`node packages/quay/bin/quay.ts task get gap-goal031-ac-coverage-suite-smoke-and-runtime-semantics --json` 的 `status` == `needs-human`

## Definition of Done

一份可复核的提案落成并被交到人手上：本任务体逐字指名 GOAL-031 退出条件中未被现有任何 AC 覆盖的原文（「不改变状态机允许边/运行时语义」「suite/smoke 全绿」）、逐条说明现有 AC 为何覆盖不到（实读 criterion，非看标题）、给出可直接写入 GOAL-031 的候选 AC-346 判据（含三态退出码与两段**已实测**的读数），且任务置 `needs-human` 等人工裁定。本任务**不**修改 goal store、**不**判定任何 AC/GOAL 状态——通过或被拒都只改变「是否有这样一条 AC 提案」，goal 状态由人后续写入。

## Touches

- tasks/gap-goal031-ac-coverage-suite-smoke-and-runtime-semantics.md
- plugin/test/goal-driver-s01.test.mjs
- plugin/test/goal-driver-s06.test.mjs
- plugin/test/goal-driver-s08.test.mjs
- plugin/test/goal-driver-s12.test.mjs

该轴仍暗,理由:本任务只产出一份提案、不触碰任何源码（Touches 声明的 4 个测试文件与 develop 逐字节相同），L_D/L_G 均未被触及。
