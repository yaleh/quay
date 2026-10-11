---
id: gap-ownership-active-slice-adapter-stays-declaration
title: "ownership-active slice adapter: emit ArchGuard's proposedCut.stays
  declaration to make the 2/11 real coverage-gap candidates computable on
  released archguard 0.1.39 (no tool change needed)"
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

<!-- dedup-ref -->
本任务承接「端到端架构自举实验」对生产 carrier（`.quay/ownership-shadow-proposals.jsonl`）11 条真实 ArchGuard `slice-delta` 拒绝记录的逐条分类（「Quay refactor architecture liaison」会话 2026-10-11 直接读 archguard 源码+核对文件系统后给出）：4/11 是 `MOVE_TO_NOT_AN_INTERNAL_DIR`（目标目录真实不存在，结构性不可表示，已由该会话在 archguard 侧立案 `gap-slice-delta-explicit-new-destination-dir`，与本任务零重叠，不碰）；7/11 是覆盖类拒绝,其中 **2 条**（`cli -> gate/config` 未覆盖 `resolveRunnerOptions`；`gate -> gate/config` 未覆盖 4 个符号）**今天就能用已发布的 archguard 0.1.39 修好,不需要任何工具侧改动**——`ownership-active-slice-adapter.mjs` 已经计算"完全覆盖"的边集合(`restore`),但从未计算过它的补集并声明为 `proposedCut.stays`,而这个声明字段在 archguard 侧已经存在且被忽略。去重已查:`tasks/*.md` 对 "slice-adapter" 搜索只命中已 done 的 `gap-ownership-active-investigation-loop-shadow`(建了本模块,未做本次改动);本任务与正在实现中的 `gap-ownership-active-proposal-repair-loop`(有界 judge 重试修复)Touches 零重叠(该任务不碰 `ownership-active-slice-adapter.mjs`),两者互补:本任务是"机械、确定性、无需 judge 重试"的那一类修复,不依赖本任务是否先落地。

## Proposal

修改 `docs/analysis/ownership-active-slice-adapter.mjs`:在构造 `simulateRefactorSlice` 请求时,对每条进入"被搬出目录"(moved-from dir)但**只有部分**导入名被移动集覆盖的边,计算未覆盖名的补集,按 archguard 的真实契约(「Quay refactor architecture liaison」2026-10-11 直接读 `types.ts`+`simulate.ts` 给出,逐字记录):

- `stays` 挂在 **`slice.proposedCut.stays`**(顶层数组,不是挂在每个 move 上,不是按边),形状 `{ dir: string; symbols: string[]; note?: string }[]`;`dir` = 该边的**目标**(即被搬出目录本身,例如 `gate/config`),`symbols` = 该目录上声明"不动"的符号字面量名。
- 补集计算必须按"进入该被搬出目录的边"聚合(逐边的 `importedNames` 减去 `moves[].symbols`),**不得凭空产生任何符号名**——每一个 `stays` 符号都必须真实出现在某条真实边的 `importedNames` 里(对应 AC6)。
- **这不是"让检查通过"的补丁,而是进入 archguard 自己文档化的"部分迁移"路径**:覆盖检查通过后(`simulate.ts:382`,`uncovered` 为空),**边不会被移除**——原边 `A -> B` 继续存在于结果里(不进 `removedEdges`),每个真正移动的符号各自新增一条 `addedEdges`(`source: "retarget-from-removed-edge"`),`affectedConsumers[].becomes === "survives"`,`accounting[]` 对该边记 `survives: true, staying: [...], strength: null`(`strength` 永远是 `null`——目录级图没有符号级定位,不做按符号数的拟合估算)。本任务的 AC 必须断言**这个确切形状**,不能假设"覆盖满足=边消失"(那是全覆盖/完全搬迁的另一条路径,不是本任务要触发的路径)。
- **`stays` 是受信任输入,archguard 只做结构校验**(同一符号在两个不同 `dir` 都声明 stay、或同一符号既在 `moves` 又在 `stays` ⇒ `not-evaluated`"目的地冲突";`dir` 必须是图内部节点;`symbols` 非空数组),**不校验 `stays` 的符号是否真的出现在任何边上**——与本机制已知的"未知符号不被检测"是同一类风险,本任务的补集计算因为是从真实边的 `importedNames` 反算出来的,结构上不会凭空产生符号,但仍需测试断言这一点(不能假设"我写的代码是对的,不用测")。
- **⚠️ 匹配是按符号名全局的,不是按边的**(`simulate.ts:382`/`:388` 的 `uncovered`/`staying` 判定只查 `destOfSymbol.has(n)`/`stayedSymbolDir.has(n)`,两者都不看边的 `to`)。意味着:给目录 A 声明的 `stays` 符号,如果同名符号也出现在进入**另一个**目录 B 的边上,会"顺带"覆盖 B 的那条边——这是 archguard 原语本身的行为(可能是故意支持 barrel/re-export 场景),**本任务不试图在 Quay 侧修正或绕过它**,只需要诚实应对:AC 断言必须钉在**具体那条边自己的 `accounting` 条目**上(不能只看整体 `status` 翻绿),避免"同名符号跨目录误覆盖"把一个不相关的断言结果误判为成功(对应 AC4)。
- **跨目录冲突的降级**:若同一符号名在同一个 slice 里,同时是进入两个**不同**被搬出目录的边上的未覆盖名,朴素地各自声明一条 `stays` 会触发 archguard 的"目的地冲突"校验(两个不同 dir 都声明同一符号 stay)⇒ `not-evaluated`。本模块检测到这种情况时**不得**硬塞两条冲突声明,必须诚实退回原始覆盖不足结果(保持 `not-evaluated`,不是伪造一个"修复成功")(对应 AC5)。

## Plan

1. 在 `ownership-active-slice-adapter.mjs` 里,`restore`(完全覆盖边)旁新增一个补集计算:对每条进入被搬出目录但未被 `restore` 收录、且确实有部分覆盖(至少一个符号被移动)的边,算出该边 `importedNames` 中未被移动集覆盖的名字,按目标目录聚合成 `stays` 条目,写入请求的 `proposedCut.stays`。
2. **真实两个候选的回归(AC1/AC2)**:从生产 carrier(`.quay/ownership-shadow-proposals.jsonl`)里读出这两条真实记录(`cli -> gate/config` 未覆盖 `resolveRunnerOptions`;`gate -> gate/config` 未覆盖 4 个符号)各自记录的 `ref_commit`/`scope_root`(锁定复用,不改用当前 develop 尖端,避免图漂移),补上 `stays` 后重跑 `slice-delta`,断言:`status` 不再是 `not-evaluated`;`removedEdges` 不含该边;`accounting` 对该边的条目为 `survives: true, staying: [<未覆盖名>], unaccounted: []`。
3. **负对照①(AC3)**:故意漏掉一个真实未覆盖名不放进 `stays`,断言该边仍然 `unaccounted` 非空或仍是 `not-evaluated`——证明断言不是摆设。
4. **名字全局匹配的诚实断言(AC4)**:构造一个 fixture,让同一个符号名同时出现在两条进入不同"非本次被搬出"目录的边上,断言测试对**目标边自己的 `accounting`** 做断言,而不是只看整体 `status`;并在报告里如实记录"archguard 的覆盖匹配是按符号名全局,不是按边"这一原语特性(不是本任务的缺陷,也不是本任务要修的东西)。
5. **跨目录冲突降级(AC5)**:构造一个 fixture,让同一符号名在同一个 slice 里是两个不同被搬出目录各自的未覆盖名,断言模块检测到后不发出冲突的 `stays` 声明,结果保持原始 `not-evaluated`(诚实退化,不伪造成功)。
6. **不凭空造符号(AC6)**:测试断言模块产出的每一个 `stays` 符号都能在输入边的真实 `importedNames` 里找到来源,不存在凭空符号。
7. **moved/stayed 互斥(AC7)**:测试断言 `stays` 符号集合与 `moves[].symbols` 集合永远不相交。
8. **真实落地复跑(AC8)**:用步骤 2 的两个真实候选,实际重跑并把 before/after(拒绝原因 → 计算成功的具体 delta 形状)写入报告 `docs/analysis/ownership-active-slice-adapter-stays-replay.md`。
9. 全量回归绿。

## Touches

- docs/analysis/ownership-active-slice-adapter.mjs
- docs/analysis/ownership-active-slice-adapter-stays-replay.md
- plugin/test/ownership-active-slice-adapter.test.mjs
- tasks/gap-ownership-active-slice-adapter-stays-declaration.md

## AC

- [ ] AC1 真实候选①可计算:`cli -> gate/config`(未覆盖 `resolveRunnerOptions`)在锁定的原始 `ref_commit`/`scope_root` 下,补 `stays` 后 `status` 不再是 `not-evaluated`,`removedEdges` 不含该边,`accounting` 该边条目为 `survives:true, staying:["resolveRunnerOptions"], unaccounted:[]`。
- [ ] AC2 真实候选②可计算:`gate -> gate/config`(4 个未覆盖符号)同上模式验证,4 个符号全部出现在 `staying`,`unaccounted:[]`。
- [ ] AC3 负对照①:漏放一个真实未覆盖名,该边仍 `unaccounted` 非空或仍 `not-evaluated`,不是伪造通过。
- [ ] AC4 名字全局匹配的诚实断言:构造同名符号跨目录的 fixture,测试断言钉在目标边自己的 `accounting` 条目,不是整体 `status`;报告如实记录该原语特性。
- [ ] AC5 跨目录冲突降级:同一符号名同时是两个不同被搬出目录的未覆盖名时,模块不发出冲突 `stays` 声明,结果诚实保持 `not-evaluated`。
- [ ] AC6 不凭空造符号:每个产出的 `stays` 符号都能在输入边真实 `importedNames` 里找到来源。
- [ ] AC7 moved/stayed 互斥:`stays` 符号集合与 `moves[].symbols` 永不相交。
- [ ] AC8 真实落地复跑:两个真实候选的 before/after 读数写入 `docs/analysis/ownership-active-slice-adapter-stays-replay.md`。
- [ ] AC9 全量回归绿:`bash scripts/test.sh --for-task gap-ownership-active-slice-adapter-stays-declaration` exit 0。

## DoD

`docs/analysis/ownership-active-slice-adapter-stays-replay.md` 提交,记录两个真实候选从 `not-evaluated` 变为可计算的确切 delta 形状(边存活 + 新增边 + accounting survives 读数)、「Quay refactor architecture liaison」提供的精确契约引用(字段位置/校验规则/名字全局匹配特性)、跨目录冲突与名字全局匹配两个边界情形的处理方式。⛔ 本任务不改任何 ArchGuard/archguard 仓库代码,不碰 `gap-ownership-active-proposal-repair-loop` 的任何文件,不创建或激活任何 Goal/task,不改变现有安全闸门与 3 连续轮次准入门限——本任务只让 `slice_delta` 对这 2 个真实候选能计算出结果,不保证它们最终能通过受限提案的其它门限。全部新增测试绿。
