---
id: gap-retire-registration-inner-agent-budget-not-registered
title: inner-agent-budget 退休未登记进 retired-clause-check.ts——机械只能报 SUSPECT，与 heavy-op-token（登记了=RETIRED）同族（外层 15:5xZ 报 + manager 15:4xZ 裁定）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（inner-agent-budget 退休未登记——外层 2026-08-14 15:5xZ 核实 audit Evidence 时发现；manager 15:4xZ 裁定：走 normal 派发，`.ts` 不在 manager 豁免面）**。

**现象**：`gap-prod-data-accounting-audit`（done）第一遍按载体聚合三态时，`inner-agent-budget.json` 被机械判为 ③ NOT_EVAL / disp=SUSPECT（「全仓零写入者（含测试）」，视为真命中）。但 `gap-retire-inner-agent-budget-report`（done，:12）记录该写入机件 `inner-agent-budget-report.ts` 已于 **2026-08-10 人裁定（A16）整体废弃并删除**——「零写入者」正是退休的预期态。

**根因（机械）**：审计判据5b 的两条命令出口是 `retired-clause-check.ts` / `loop-shipping-exclusion-data.mjs`（命中 ⇒ 已退役直接出局）。grep `inner-agent-budget` 在这两处 = **0 命中** ⇒ 退休从未登记进该机制。对照 `heavy-op-token`：登记在 `retired-clause-check.ts:62/:97` ⇒ 审计机械得 RETIRED。**两者都是人裁定的退休，差别只在有没有人记得去登记。**

**后果**：3 条 done 任务的 AC 引用一个结构性不可能再有写入者的载体（陈旧 AC）；未来每次审计都会恒复报 SUSPECT，直到退休被登记。

**⚠️ 真正的缺口（manager 15:4xZ 指出，建议写进本任务体）**：**退休时【必须】登记，而这一步没有任何东西强制**。
```
⊢ 缺的产物：一个机件/载体被删除或停用的提交，若其名字未同时出现在
  retired-clause-check.ts 或 loop-shipping-exclusion-data.mjs，⇒ 报未登记
⊢ 现成真样本：inner-agent-budget-report.ts（2026-08-10 人裁定 A16 整体废弃并删除，未登记）
```
**⛔ 本任务不造「登记强制检查」**——发生率目前 1（登记 1 / 未登记 1），按硬规则 12 只够记**观察项**。写进任务体是为了让下次再出现未登记退休时发生率是查得到的（见 AC4）。

**⚠️ 家族形态（manager 15:4xZ，同形第三次）**：`manager-tick-core.js` 的 READ_CMD 副本复制 A0 五项手跑简述、⑤ 已推翻而副本没跟着改（`ed3fa742` 已改指针）。**共同形态：一件事被写在两处，其中一处更新了另一处没有，而检查器只查各自的存在性、不查两处一致。** 本任务只修「inner-agent-budget 登记」这一个实例；「双副本一致性检查」若以后要造，按【这个族】立，不只按「退休登记」。

**判据1**：`retired-clause-check.ts` 登记 `inner-agent-budget` 退休（heavy-op-token 同款模式：退休的载体名 + 裁定日期 + 理由进入已退役清单）。
**判据2（能取假）**：**audit 重跑应自动得 RETIRED**——`prod-data-audit.ts --json`（或等价按载体聚合读数）对 `inner-agent-budget.json` 报 `disp=RETIRED`，不再是 SUSPECT；现真值 SUSPECT ⇒ 假。
**判据3**：登记后 audit 的判据5b 两命令（`grep inner-agent-budget retired-clause-check.ts loop-shipping-exclusion-data.mjs`）命中 ≥1。
**判据4（观察项，不设检查）**：任务体记录「退休登记强制检查」为观察项（发生率 1/1），不新建机制；下次未登记退休发生时，用本任务体作为发生率来源。
**判据5**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不改 retired-clause-check.ts 的判定逻辑（它按登记表判没问题）；不把 loop-shipping-exclusion-data.mjs 拉进改动范围（那里没有 inner-agent-budget 引用，登记进 retired-clause-check.ts 即够）；不造「退休登记强制检查」新机制（AC4 观察项）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 retired-clause-check.ts 的已退役清单结构（heavy-op-token 条目 :62/:97 形态）+ gap-retire-inner-agent-budget-report 的裁定日期/理由。
2. 判据1：登记 inner-agent-budget 退休（载体名 + 2026-08-10 A16 裁定 + gap-retire-inner-agent-budget-report）。
3. 判据2 能取假：prod-data-audit 重跑对 inner-agent-budget.json 得 RETIRED（现 SUSPECT）。
4. 判据3：grep 两命令命中 ≥1。
5. 判据4：任务体记录观察项（不建机制）。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：retired-clause-check.ts 登记 inner-agent-budget 退休（heavy-op-token 同款）。
- [x] AC2 判据2 能取假：audit 重跑 inner-agent-budget.json 得 disp=RETIRED（现 SUSPECT）。
- [x] AC3 判据3：判据5b 两命令 grep 命中 ≥1。
- [x] AC4 判据4：任务体记录「退休登记强制检查」观察项（发生率 1/1，不建机制）。
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] inner-agent-budget 退休登记进 retired-clause-check.ts（audit 重跑自动得 RETIRED）+ 观察项入档 + 测试绿。

## Touches

- plugin/scripts/retired-clause-check.ts（登记 inner-agent-budget 退休条目）
- plugin/test/retired-clause-check.test.mjs（补测：inner-agent-budget 命中已退役清单）
- tasks/gap-prod-data-accounting-audit.md（Evidence 已由外层 15:5xZ 订正 SUSPECT→RETIRED；本任务落地后 audit 重跑为验收判据2）
- tasks/gap-retire-registration-inner-agent-budget-not-registered.md（自身）
- orchestration/archive/AC58-retired-clauses.md（R31 归档条目——CHECK-B 机制强制，任务 authoring 侧漏列，外层 16:0xZ 落地后补）

## Evidence

（2026-08-14 落地回填——inner agent 本 worktree 实跑；外层 15:5xZ 已订正 audit Evidence :127/:141 SUSPECT→RETIRED）

**判据1 登记（AC1）**——retired-clause-check.ts REGISTRY 新增 R31（heavy-op-token R06/R24 同款：载体名 + 裁定日期 + 理由），archive 新增 `## R31` 段落（源任务引用落在 archive）：
```
{ id: "R31", source: "plugin/loop/fast-mode-loop-tick.md", markers: [
    "inner-agent-budget.json 已随 2026-08-10 人裁定 A16 退休",
] },
```
retired-clause-check 实跑 GREEN（30 条目 / 48 tokens 全迁出、全有家）：
```
$ node --experimental-strip-types plugin/scripts/retired-clause-check.ts --root .
retired-clause-check: OK — 30 entries migrated (48 unique tokens: all gone from source, all present in archive)
```

**判据2 能取假（AC2）**——用 audit 自己的判定谓词喂【本 worktree 已登记的 retired-clause-check.ts】（主检出无本改动故 resolveProductionRoot 读不到，直接喂文件内容）：
```
$ node -e "isRetiredCarrier('inner-agent-budget.json',[<worktree retired-clause-check.ts>])"
isRetiredCarrier: true
kind: retired
audit disposition => RETIRED   （现 SUSPECT ⇒ 假）
```
端到端复现（temp 非 git 根 + 本登记文件，buildAudit 全链路）：
```
$ node plugin/scripts/prod-data-audit.ts --root <tmp> --json
inner-agent-budget.json  kind=retired  disposition=RETIRED  threeState=NOT_EVALUATED
  reason: retired-carrier: 已退役（retired-clause-check.ts / loop-shipping-exclusion-data.mjs），不存在是预期，直接出局
```
对照（主检出 /home/yale/work/quay，未含本改动）→ disposition=NORMAL_ABSENT（零写入者被 prod-data-audit.ts 自引用改写）⇒ 登记即机械翻转。

**判据3（AC3）**——判据5b 两命令命中 ≥1：
```
$ grep -n inner-agent-budget plugin/scripts/retired-clause-check.ts plugin/scripts/loop-shipping-exclusion-data.mjs
plugin/scripts/retired-clause-check.ts:155:  // 自计数载体 inner-agent-budget.json 整体退休 (2026-08-10 人裁定 A16「彻底取消所有 subagent 计数机制」,
plugin/scripts/retired-clause-check.ts:158:      "inner-agent-budget.json 已随 2026-08-10 人裁定 A16 退休",
（2 命中；loop-shipping-exclusion-data.mjs 无引用，按任务「不覆盖」保持不动）
```

**判据4 观察项（AC4）**——「退休登记强制检查」观察项记录于本任务 Proposal（⚠️ 真正的缺口 段）：发生率 1/1（登记 1 / 未登记 1），按硬规则 12 不建机制；下次未登记退休发生时以本任务体为发生率来源。

**判据5（AC5）**——既有测试 + scoped 门全绿（本 worktree 实跑）：
```
$ bash scripts/test.sh --for-task gap-retire-registration-inner-agent-budget-not-registered --allow-thin
retired-clause-check: OK — 30 entries migrated
PASS: delivery-inventory drift gate
retired-clause-check.test.mjs  6/6 pass（含新增「GREEN: inner-agent-budget hits the retired list (R31)」）
ℹ tests 6 · pass 6 · fail 0 · cancelled 0
(EXIT=0)
```
另：`prod-data-audit.test.mjs` 真实载体断言由 SUSPECT 更新为 RETIRED（`kind=RETIRED` / `disposition=RETIRED`）——该测试走主检出，fan-in 后主检出含登记即绿。
