---
id: gap-precommit-guard-running-round-rejects-assertion-surface-commits
title: pre-commit 守卫——state=running 且触及断言面文件 ⇒ 拒提交（覆盖全部写入者，三独立实证）
status: done
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（2026-08-12，三独立支撑，manager 判定）**：「round 期间零提交」约定守不住：
① **约定无产物（C17）**——round 60 约定后 26s 即破（外层 47023142）；
② **连事后都难区分**——要靠人拿 `startedAt` 逐笔比对 commit 时刻，今天只有 manager 在做；
③ **参与方不完整且名单无人维护（最硬）**——inner 从不在约定里，round 63 窗口内以 30-40s 一次提交 4 笔任务体更新，无人告诉它有一轮在跑。
**①② 可靠「更小心」缓解，③ 结构上不可能靠小心解决。** round 60/63 的窗口内提交验证「无害」是运气不是机制——验证轮的 verifiedCommit 判定与 clean-window 语义被污染，靠事后读原文才能排除。

## Plan

1. **pre-commit 钩子或 commit 包装脚本**：提交时读 `.quay/full-suite-state.json`。
   - `state == "running"` **且** 本次提交触及【断言面内文件】⇒ 拒提交（exit 非 0），打印
     `round <N> 正在跑（startedAt=…），本次提交会使该轮结论不可用；用 --allow-dirty-round 显式覆盖，或等终态`。
   - **fail-loud（manager 2026-08-12 四次同族谓词错误的正确失败模式）**：state 文件缺失 / 字段 null ⇒ 拒——
     **参照系缺失时谓词必须崩，不给看似合理的值**（`[ -nt 不存在文件 ]` 恒真 / 裸文件名判存在失败等）。
2. **断言面集合不手工维护**：从测试自声明的判定对象聚合（A0b③ 机制，
   `gap-check-set-after-change-diff-nameonly-intersect-judged-objects`）——守卫的白名单手工维护会与测试漂移，
   正是它要防的病的同一形态。**具体落点：`plugin/scripts/judged-object-registry.json`（A0b③ 生成）。
   守卫读它，缺失/空则回退到全 tracked 文件（`git ls-files`）——fail-closed，宁严勿松**
   （round 60/63 形态全挡；A0b③ 是精化不是前置，守卫 priority #1 不等它）。
3. **覆盖全部写入者**：outer / manager / inner 的提交都过守卫（shared hook 或各层 commit 命令改走包装脚本）——
   约定的参与方名单不可维护，守卫必须覆盖名单之外的写入者。
4. **守卫拒绝后给预检清单**：作者被拒时手里应已有一份预检清单（等待期可做、只读、可反复），
   不是被拒后才开始想约束——「强制等待让预检可做」的推广（manager 2026-08-12）。
5. **`--allow-dirty-round` 显式覆盖**（有记录可追责，不静默绕过）。

**与已立案任务的关系**：与 `gap-concurrent-write-mutable-tree-false-positive-red` 是同一件事两半——
那条记录「红可能是假的」，这条阻止「制造假红」（只有后者能真正消掉它，因为前者仍要求判读时想起来）。
与 `gap-suite-start-verifies-target-commit`（起跑验 verifiedCommit 含目标修复）互补——那条防「验了不该验的树」，
本条防「验证轮窗口内被写入」。

## AC

- [x] AC1: 守卫存在，state=running 且触及断言面文件 ⇒ 拒提交（exit 非 0）+ 明确消息
- [x] AC2: fail-loud——state 文件缺失/null ⇒ 拒（不给看似合理的值）
- [x] AC3: 覆盖全部写入者（outer/manager/inner 的提交都过守卫）
- [x] AC4: 断言面集合从测试自声明判定对象聚合（非手工维护）
- [x] AC5: 负控制——重现 round 63 形态（inner 在 running 轮提交任务体）被拦住；round 60 形态（约定后 26s 提交）被拦
- [x] AC6: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC6 全部勾上（AC1 现已含 early-red：isRunning = state==="running" || finishedAt==null，071c0fb1）
- [x] 负控制样例贴出（见 Evidence）
- [x] 全量套件绿（rounds 70/75/76：守卫实现 + early-red 修复全绿，verifiedCommit 含 071c0fb1）
- [x] 真实拒绝记录（③）——本仓真 running 轮（runId=bcf3790d）期间提交 tasks/tmp-3-probe.md 被守卫拒（exit 1）+ 完整预检清单（见 Evidence「真实运行记录」段）

**登记**：注册表 mode 断言 = `registryMode="fallback-narrowed"`（A0b③ 前；patterns 已清空，34e96380 实测）。窗口协议：「先清 diverge 再动手」（IDLE-GREEN diverge>0 时 2min 抢 / 清零不触发 ⇒ 窗口≈10min）。断言面精度上限 = @static-object 标注精度（目录级标注拉整目录进面）。

## Touches

- plugin/scripts/precommit-guard.ts (new)
- plugin/scripts/judged-object-registry.json (new)
- plugin/scripts/capability-catalog.sh
- docs/proposals/quay-product-outline.md
- plugin/test/precommit-guard.test.mjs (new)
- tasks/gap-precommit-guard-running-round-rejects-assertion-surface-commits.md

> 注（new-script 登记补全，gap-new-script-touches-missing-inventory-catalog-registration）：本任务
> 声明新建 `plugin/scripts/precommit-guard.ts`，依 AC3 必须同时在 Touches 授权登记文件
> `plugin/scripts/capability-catalog.sh`（AC1c 五行声明）与 `docs/proposals/quay-product-outline.md`
> （§6 DELIVERY-INVENTORY 快照再生成 scripts 216→218），否则 scoped 静态层以
> `touches-missing-registration` 拒派。测试文件随 basename 配对被选中。

## Evidence

**机制**：`plugin/scripts/precommit-guard.ts` 以共享 pre-commit 钩子落地（`--install-hook` 写
`<git-dir>/hooks/pre-commit` → 覆盖 outer/manager/inner 及名单之外的一切提交者，AC3），也可作为
commit 包装脚本直接运行。判定读 `.quay/full-suite-state.json`：`state=running` 且本次提交触及断言面
⇒ 拒（exit 1）+ 预检清单；state 文件缺失/state 字段 null ⇒ 拒（fail-loud，AC2）。断言面 =
`plugin/scripts/judged-object-registry.json` 的 patterns（A0b③ 聚合，守卫只读、非手工维护）；
缺失/空 ⇒ 回退**收窄面** `tasks/**` + `plugin/loop/**` + `scripts/test.sh` 的 `@static-object` 聚合
（外层裁定 B 修正：全 tracked 回退 4113/4316 实测不可用；聚合机械覆盖 orchestration/*-tick-core.md
——12a6b18b manager 亲手闯的类，fail-closed 保留，AC4）。`--allow-dirty-round` /
`QUAY_ALLOW_DIRTY_ROUND=1` 显式覆盖（有记录可追责，AC6）。

**scoped 验证**（worktree `gap-precommit-guard-running-round-rejects-assertion-surface-commits`，
`scripts/test.sh --for-task gap-precommit-guard-running-round-rejects-assertion-surface-commits`）：
scoped 静态层（capability-catalog / delivery-inventory / task-contract / adr016 / …）全过；
测试 **33/33 pass / 0 fail**（含 `precommit-guard.test.mjs` 18 项 + `capability-catalog.test.mjs`）。
守卫为单文件自包含（无 gate-script-base 依赖），已实测真实 `git commit` 过已安装钩子：running 轮 +
任务体 ⇒ 拒（exit 1）+ 预检清单；`QUAY_ALLOW_DIRTY_ROUND=1` ⇒ 放行（commit 落地）。

**负控制样例**（`plugin/test/precommit-guard.test.mjs`，temp git repo fixture）：
- round 63 形态（inner 在 running 轮提交任务体）⇒ `running-round-assertion-surface`，exit 1 ✓
- round 60 形态（start 后 26s 提交）⇒ 同拒（state=running 即信号，不依赖 elapsed）✓
- fail-loud：state 文件缺失 ⇒ `state-file-missing`；state=null ⇒ `state-null`，均 exit 1 ✓
- 回退收窄（ruling B）：registry 缺失/空 ⇒ tasks/** + plugin/loop/** 命中被拒；
  `README.md`（面外）放行；`scripts/test.sh` 的 @static-object（orchestration/manager-tick-core.md）
  经聚合进入回退面并被拒 ✓
- 覆盖：`--install-hook` 写共享钩子（含指纹）、拒覆写无关钩子、`--uninstall-hook` 移除 ✓
- 显式覆盖：`--allow-dirty-round` 与 `QUAY_ALLOW_DIRTY_ROUND=1` 均放行（reason 可追责）✓
- 终态：state=green ⇒ 触及断言面也放行 ✓

**Touches 补全说明**：原 Touches 只列两个新文件 + 自身，未列 new-script 登记文件
（`capability-catalog.sh` / `docs/proposals/quay-product-outline.md`），scoped 静态层据此以
`touches-missing-registration` 拒派。已按 gap-new-script-touches-missing-inventory-catalog-registration
AC3 补全（本文件 `## Touches` 段 + 两登记文件 + 测试文件），这是该 gap 类的既定修复（补 Touches）。

**真实运行记录（③，本仓真 running 轮，2026-08-12 22:19）**：round（runId=bcf3790d，startedAt=22:18:57.601Z，
state=running）期间 probe 提交 `tasks/tmp-3-probe.md`（有效任务文件）→ 守卫**拒（exit 1）**，原文：
```
pre-commit 守卫：一轮正在跑（state=running, finishedAt=null, runId=bcf3790d-7dd1-4bfd-bae5-6e902881c23a, startedAt=2026-08-12T22:18:57.601Z），本次提交触及断言面文件（1 个），会使该轮结论不可用。
用 --allow-dirty-round 显式覆盖，或等终态（green/red）后再提交。
拒绝文件：tasks/tmp-3-probe.md
预检清单（等待期可做，只读，可反复）：
  1. 等该轮终态：state 文件转 green/red 后再提交（最安全）。
  2. 看进度：tail -f .quay/full-suite.log（该轮 stdout 日志）。
  3. 只读复核：读任务/读 diff/审阅已落地的 commit（git log）。
  4. 若确需立即提交且确认无害：显式 QUAY_ALLOW_DIRTY_ROUND=1 git commit …（有记录可追责）。
```
probe 无残留（reset+rm，轮次不受影响）。**守卫 reject 路径在本仓证明（非 worktree）——early-red 修复（071c0fb1）
让 state=running 真拒（上次 round 71 probe 灾难正是 early-red 放行）。**
