---
id: gap-meta-inachievedreverifyscope
title: AC-217 常设不变式被冻结在复验域外：GOAL-014 零 AC 激活而零信号——把 long-term 声明落到字段上
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
AC-217（任何 draft/active GOAL 至少一条 AC）自身声明「判据仍能取假：任何无 AC 的 GOAL 一旦进入 draft/active 即报红」，但其 long-term 字段从未落成、其 goal GOAL-010 已 achieved ⇒ 按 inAchievedReverifyScope（activeGoalIds.has(goal) || longTerm===true）它早已离开 I5 复验域，判据自 2026-09-09 起不再重跑；本轮读数 goals=[GOAL-014 active] 而 criteria=[]（GOAL-014 名下无任何 AC 记录）、divergences=[] —— 该不变式正被违反，而违反产生零信号（divergence 只对【已存在】的 AC 计算，零 AC 的目标结构上报不出任何东西）。修 = 把已由人 2026-09-09 裁定②（记在 AC-217 自己的 origin 里）称为「不变式」的裁定落到 long-term 字段（goal-store write --long-term true 是现成的机械写路径），不新建机制。

本轮读数（criteria）= `[]`，采于 2026-09-12T00:40:39Z，由 meta-driver 机械采集。
⚠️ 机制词 `inAchievedReverifyScope` 命中【已完成】任务：gap-closed-goal-acs-leave-reverify-scope-standing-invariants-undeclared.md[done]、gap-meta-computegoalgaps.md[done]、gap-meta-rungoalround.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [x] `node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts check --reverify-scope | python3 -c 'import json,sys;d=json.load(sys.stdin);e=[x for x in d.get("inScope",[]) if str(x.get("id"))=="AC-217"];sys.exit(0 if (e and e[0].get("longTerm") is True) else 1)'` ⇒ AC-217 回到 I5 复验域（inScope 含 AC-217 且 longTerm=true）⇒ goal-driver 每轮重跑其判据；因 GOAL-014 当前无 AC，它应转 FAIL——违反从「冻结在 achieved、无人看见」变成可见的 achieved-but-failing。

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Result

**落地（现成机械写路径，⛔ 不新建机制）**：`goal-store write AC-217 --long-term true` —— 人 2026-09-09 裁定②已称本条为「不变式」，但该身份此前只活在 `origin` 的散文里、从未落成字段；改动 = `goals/AC-217-*.md` frontmatter 增 `long-term: true` 一行。

**判据双向控制（同一命令，逐次实跑）**：改前 exit 1（`inScope` 不含 AC-217）→ 改后 exit 0（含且 `longTerm=true`）→ 删掉该行 ⇒ exit 1 → `git checkout` 还原 ⇒ exit 0。

**「可见」的实测**：`check --achieved-failing` 现 `inScope` 17 条、`achievedButFailing=['AC-217']`（其余 16 条常设不变式全绿）；`standingReverifyAcs`（`plugin/scripts/goal-driver.ts:814`，每轮 gate 集合的唯一枚举点）实测含 AC-217 ⇒ 此后每轮重跑并落账，`computeGoalGaps` 判 `standing-violated`（无在飞任务时立案）。违反从「冻结在 achieved、无人看见」变成可读的 achieved-but-failing。

**必须的伴随修（同一个 Touches 文件，⛔ 非新机制）**：AC-217 的判据输出被管道吞掉 ⇒ 失败时对 stderr/stdout **零输出** ⇒ acceptance-runner 写出空因模板。它此前从不失败（冻结）；入域后每轮失败会把 **AC-241**（台账侧「失败判据必须可归因」这条常设不变式）打红——即修好一条不变式会打红另一条。按 AC-237/AC-241 既有义务给失败路径补一句成因（`sys.stderr.write` 点名无 AC 的 GOAL 集合），**pass/fail 语义逐字不变**。实跑 runner：改前 reason = `acceptance failed (exit 1) — criterion wrote no output to stderr/stdout`；改后 reason = `acceptance failed (exit 1) — active GOAL(s) with zero ACs: GOAL-014`。5b 枚举（17 条在域 AC 逐条读判据正文，⛔ 非关键词扫）：**只有 AC-217** 的失败路径结构上零输出（AC-188/189/190/233/235/236 各写 stdout）；独立机件 `criterion-failure-attribution-check` 报 `fixed since baseline: AC-217`（31 ≤ baseline 32，shrink-only 棘轮）。

**为什么已 done 的机制任务没解决它（回答 Finding 的 ⚠️）**：`gap-closed-goal-acs-leave-reverify-scope-standing-invariants-undeclared` 的裁定表只枚举 GOAL-009/015 关闭当轮离开的 21 条；AC-217 属 GOAL-010、更早已出域 ⇒ 是**批次边界**，不是机制坏了。用现成交叉核对复核：`check --reverify-scope --adjudication <该任务体>` ⇒ `standingMissing=[]`、`oneTimeButInScope=[]`、`undeclaredInScope=[]`、`violations=[]`（12 条裁定全部已落成字段）。

**⛔ 不修 GOAL-014**：它 2026-09-12T00:33 刚由人激活，本身是待裁定的成本/范围选择（其 body 明列三选项）。给它补一条 AC 会把真违反糊掉——本任务的产出正是让它可见。

**已知残留（观察项，非阻塞）**：`task_check`（native store `sectionAfterHeading`，整行精确匹配 `## AC`）读不到 `## AC（draft）` ⇒ 报 `acTotal: 0`；而 fan-in 的实际读取者（`readAcCheckState` 的 `\b` 正则、`countCompletionCheckboxes` 的 shape-aware 识别）都认该后缀，故本任务的勾选可达 fan-in 的 ac-precheck。该分歧是既有形态（仓内 27 条 done 任务同用此标题），不在本任务 Touches 内。

## Touches
- `goals/AC-217-每个活跃-goal-至少有一条-ac-活跃目标无退出条件不可判定达成.md`
- `tasks/gap-meta-inachievedreverifyscope.md`