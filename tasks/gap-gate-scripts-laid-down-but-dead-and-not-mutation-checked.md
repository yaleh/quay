---
id: gap-gate-scripts-laid-down-but-dead-and-not-mutation-checked
title: the 14 plugin/gate-scripts/ gates are LAID DOWN BUT DEAD — quay-init
  ships them into target projects but NOTHING calls them (registry has only
  dod/acceptance/doc live gates; the it0-*/audit-*/drain-*/vmeta-lag
  classic-pipeline gates survive ADR-022 retirement as installed-but-unexecuted
  weight; only quay-init references them by path); and checker-mutation-check's
  objects are derived (run_static_checks + CI) with grep -c gate-scripts = 0, so
  gates have never been proven to fail — but that's SECONDARY (dead gates don't
  run); the real defect is delivery propagates dead weight; same axis
  (criterion's own validity) as gap-checkers-have-never-been-shown-to-fail,
  layer dimension extension
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者把生成器系统性跑在常驻判据上（2026-08-05）——**缺口二：变异检查覆盖不到闸门层（待外层确认调用
路径后定严重度）**。**不是被硌出来的**（所有检查当时都绿，照生成器问句逐条问出）。

**管理者实测**：`checker-mutation-check.sh` 的对象是派生的（parse `run_static_checks()` + CI workflow 的
`node scripts/*.ts`），这点是好的。但 `grep -c gate-scripts = 0` ⇒ **`plugin/gate-scripts/` 下那 14 个闸门
不在变异对象里**，即它们**从未被证明过会失败**。生成器问句：变异检查量化的是【哪一层】判据？答案是
静态层 + CI 层，**不含闸门层**。

**外层确认（调用路径核实）**：
- registry（`packages/quay/src/gate/registry.ts`）的活闸门是 `dod` / `acceptance` / `doc`（跑
  `task.extra.acceptance`）；
- `plugin/gate-scripts/*`（it0-*/audit-*/drain-*/vmeta-lag 等）**多数 0 非安装器引用**——只有 quay-init
  按路径引用它们（铺设）；audit/ceiling 的少数引用在测试/smoke/metrics 语境，**非 live gate 执行**；
- ⇒ **gate-scripts 是铺设但未执行的死重**（经典管线 era 的闸门，ADR-022 退役后残留，quay-init 仍铺、
  无调用方）。

**严重度判定（外层）**：变异检查不覆盖它们 = **次要**（死闸门不跑，未证明会失败无实际后果）；**真缺陷
是交付传播死重**——14 个闸门装进每个目标项目但不执行，是「交付物传播已知缺陷/死物」类。

### 选定机制（外层裁定：立案 + 归并）

1. **死闸门处置**：确认 14 个 gate-scripts 是否真无调用（registry/workflow/CLI 全查）——真死 ⇒ 从
   quay-init 铺设集移除（分层退役，同 send-keys-verified 先例）或接线进 fast mode（若某闸门机制仍需要）；
2. **变异检查层扩展**：闸门层纳入 mutation 对象（若有闸门被接线）；死闸门移除后此层自然清空；
3. **与 checkers-have-never-been-shown-to-fail 归并**——同一条轴（判据自身有效性）的层维度延伸，
   交叉标注（本任务落地时复用该任务的 mutation 机制扩展）。
4. **AC10 记账**：本条 pre-friction（照问句主动问出），计入 AC10（管理者 1 → 3）。

## Acceptance Criteria

- [ ] AC1: **死闸门确认**——14 个 gate-scripts 全量核调用方（registry/workflow/CLI/测试/smoke）：
      真无 live 调用 ⇒ 死
- [ ] AC2: **死闸门处置**——死闸门从 quay-init 铺设集移除（分层退役，同 send-keys-verified 先例），或
      接线进 fast mode（若机制仍需要）；目标项目不再装死物
- [ ] AC3: **变异检查层扩展**——闸门层纳入 mutation 对象（若有接线闸门）；死闸门移除后该层自然清空
- [ ] AC4: **与 checkers-have-never-been-shown-to-fail 归并标注**——同轴（判据自身有效性）层维度延伸
- [ ] AC5: **AC10 诚实记账**——本条 pre-friction，计入 AC10（管理者 1→3）
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC6 全部勾上；AC1/AC2 实跑输出贴任务体
- [ ] 死闸门处置完（移除或接线）；目标项目不再装死物；变异层覆盖活闸门
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches
- tasks/gap-gate-scripts-laid-down-but-dead-and-not-mutation-checked.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/quay-init.sh（死闸门从铺设集移除或接线）
- plugin/scripts/checker-mutation-check.sh（闸门层纳入变异对象，若有活闸门）
- packages/quay/src/gate/registry.ts（若接线闸门需注册）
- tasks/gap-checkers-have-never-been-shown-to-fail.md（AC4 归并标注）
- tasks/gap-axis-generator-question-what-range-every-standing-criterion.md（AC5 记账引用）

## Contract

measure   dead_gates_remaining = `grep -c 'gate-scripts' plugin/scripts/quay-init.sh` stdout 数字段
band      dead_gates_remaining = 0（死闸门不再铺设）或全部接线（registry 有对应 gateFn）
invariant no_laid_down_dead_weight = 1（铺设集每项都有调用方或显式退役）
invoke    `grep -rn 'gate-scripts/\|it0-.*check\|audit-independence' packages/ plugin/scripts/ scripts/`
control   构造一个 gate-scripts 无调用方 ⇒ 铺设集移除（AC2）；接线闸门 ⇒ mutation 对象含（AC3）
resume    死闸门确认与处置分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T07:3xZ
changed: 外层受管理者生成器跑测 + 调用路径确认裁定立案。四处收紧：
(1) **确认结果**——gate-scripts 多数死（registry 只 dod/acceptance/doc 活；it0-*/audit-* 等是经典管线
    era 残留，quay-init 铺、无调用方）；
(2) **严重度**——变异不覆盖 = 次要（死闸门不跑）；真缺陷 = 交付传播死重（14 闸门装进目标项目不执行）；
(3) **处置**——死闸门移除（分层退役）或接线；变异层扩展覆盖活闸门；
(4) **归并 + AC10**——与 checkers-have-never-been-shown-to-fail 同轴（层维度），pre-friction 计入 1→3。
status: todo——交付传播死物；排 ROUND 3 收尾后。
