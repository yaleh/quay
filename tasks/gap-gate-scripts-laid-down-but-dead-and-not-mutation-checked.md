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
status: done
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

- [x] AC1: **死闸门确认**——14 个 gate-scripts 全量核调用方（registry/workflow/CLI/测试/smoke）：
      真无 live 调用 ⇒ 死。**实跑**：contract invoke grep + 逐文件调用方扫描（见 Execution record）——
      14/14 的 `plugin/gate-scripts/` 副本**零非安装器 live 调用**：registry（`registry.ts`）只
      dod/acceptance/doc 活；drain-scheduler/drain-dispose 的 workflow 引用指向
      `experiments/quay-perpetual-stream/scripts/` **canonical 源路径**（非本副本）；it0-*/audit-*/
      vmeta-lag 的其余引用全在测试/smoke/metrics 语境或注释（`it0-gates.test.mjs` 跑 canonical 源、
      `gate-dispatch-coverage.ts` 注释、`init.ts` 注释、wrapper-shape 注释）。
- [x] AC2: **死闸门处置**——`--gate-scripts` 类别整体从 quay-init 铺设集移除（分层退役，同
      send-keys-verified 先例：文件留树、不铺设、不 sync）。`dead_gates_remaining = grep -c
      'gate-scripts' plugin/scripts/quay-init.sh = 0`。同步更新 sync.sh（不再 sync）、
      init/SKILL.md、plugin/README.md、cold-start-e2e（负向断言 scripts/gates/ 不落地）、
      plugin-packaging.test.mjs（断言退役）。目标项目不再装死物。
- [x] AC3: **变异检查层扩展**——无闸门被接线（14/14 死闸门全部移除），该层自然清空。**实跑**：
      `checker-mutation-check.sh --list` 清单 12 检查器**不含任何 gate-scripts**（grep gate-scripts = 0
      的病灶消除）；fast-mode 真接线闸门（`it0-split-or-commit-check` 等）本就在变异清单内。新治理测试
      `gate-scripts-retirement.test.mjs` 端到端证明 `quay-init --all` 不再创建 scripts/gates/（负向控制）。
- [x] AC4: **与 checkers-have-never-been-shown-to-fail 归并标注**——同轴（判据自身有效性）层维度延伸；
      在该任务体顶部加 cross-mark（见 `tasks/gap-checkers-have-never-been-shown-to-fail.md` Proposal 上方）。
- [x] AC5: **AC10 诚实记账**——本条 pre-friction 计入 AC10（管理者 1→3）；axis-generator 任务的 AC10 段
      已含 "generator-run：dead-glob + gate-scripts-dead，照问句问出"；已加 cross-mark 指回本任务（见
      `tasks/gap-axis-generator-question-what-range-every-standing-criterion.md` Proposal AC10 段后）。
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`——新测试
      `plugin/test/gate-scripts-retirement.test.mjs`（首行 `// @test-group governance`，5 条全绿）。

## Execution record

**AC1 实跑（contract invoke + 逐文件调用方扫描，worktree `gate-scripts`）**：

```
$ grep -rn 'gate-scripts/\|it0-.*check\|audit-independence' packages/ plugin/scripts/ scripts/
  → 命中全部为 canonical 源路径（experiments/quay-perpetual-stream/scripts/*）、
    wrapper-shape 注释、或测试 fixture 身份字符串。零处引用 plugin/gate-scripts/ 或 scripts/gates/。

逐文件（排除安装器 / 存在性测试 / canonical 源 / 自身 mirror / 文档）：
  audit-independence-check.sh      0 live-refs     → 死
  drain-dispose-corruption-check.ts 0（workflow 用 canonical 源路径）→ 死
  drain-scheduler.ts                0（workflow 用 canonical 源路径）→ 死
  it0-backlog-projection-check.sh   0              → 死
  it0-ceiling-check.sh              0（metrics 指 canonical 源）→ 死
  it0-ceiling-line-budget-check.sh  0（gate-dispatch-coverage 注释）→ 死
  it0-dashboard-line-budget-check.sh 0（gate-dispatch-coverage 注释）→ 死
  it0-dod-check.sh                  0（init.ts 注释 / wrapper-shape 注释）→ 死
  it0-dogfood-evidence-gate.sh      0              → 死
  it0-gate-hash-check.sh            0              → 死
  it0-impl-row-check.sh             0（plugin/scripts mirror 为独立文件）→ 死
  tree-hygiene-check.sh             0（plugin/scripts mirror 为独立文件）→ 死
  vmeta-lag-check.sh                0（plugin/scripts mirror 为独立文件）→ 死
  worktree-branch-hygiene-check.sh  0（plugin/scripts mirror 为独立文件）→ 死
```

**AC2 实跑（measure）**：

```
$ grep -c 'gate-scripts' plugin/scripts/quay-init.sh
0          ← dead_gates_remaining = 0（band 0 满足）

$ bash plugin/scripts/quay-init.sh --all --root /tmp/... --plugin-root <plugin>
  → .claude/workflows/ + .claude/agents/ 落地，scripts/gates/ 不存在（新治理测试端到端断言）
```

**AC3 实跑（mutation manifest）**：

```
$ bash plugin/scripts/checker-mutation-check.sh --list | head -5
checkers_total: 12 (parsed from run_static_checks + CI, never hand-written)
  → 12 检查器无一为 gate-scripts（病灶 `grep -c gate-scripts = 0` 消除）；
    fast-mode 真接线闸门 it0-split-or-commit-check 在清单内、有变异用例。
```

## Definition of Done

- [ ] AC1–AC6 全部勾上；AC1/AC2 实跑输出贴任务体（见 Execution record）
- [ ] 死闸门处置完（移除或接线）；目标项目不再装死物；变异层覆盖活闸门（AC2/AC3，见上）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——未跑（本任务只跑 scoped）

## Touches
- tasks/gap-gate-scripts-laid-down-but-dead-and-not-mutation-checked.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/quay-init.sh（死闸门从铺设集移除——`--gate-scripts` 类别退役）
- plugin/scripts/checker-mutation-check.sh（闸门层纳入变异对象——无活闸门，该层自然清空，未改动）
- plugin/sync.sh（停止 sync 退役 gate-scripts）
- plugin/skills/init/SKILL.md（移除 --gate-scripts 参数 + 映射行 + 退役说明）
- plugin/README.md（gate-scripts 段改为 RETIRED）
- plugin/test/plugin-packaging.test.mjs（M143 gate-scripts 测试改为退役断言；sync.sh 测试去 gate-scripts 断言）
- plugin/test/gate-scripts-retirement.test.mjs（新治理测试，AC6）
- test/cold-start-e2e.sh（负向断言 scripts/gates/ 不落地）
- tasks/gap-checkers-have-never-been-shown-to-fail.md（AC4 归并标注）
- tasks/gap-axis-generator-question-what-range-every-standing-criterion.md（AC5 记账引用）

## Test-Files

- plugin/test/gate-scripts-retirement.test.mjs（新，AC6 governance；scoped 选择器基名规则看不到它，显式声明）

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
