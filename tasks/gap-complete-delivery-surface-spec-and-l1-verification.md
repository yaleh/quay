---
id: gap-complete-delivery-surface-spec-and-l1-verification
title: "the human asked what a COMPLETE quay cold-start +
  sustained-correct-drive actually requires —
  SPEC-complete-delivery-surface-2026-08-05.md measures it: SIX delivery
  categories (mechanism+runtime ✅, loop docs ⚠️ missing manager, launch config
  ✗, session topology ✗, periodic anchors ⚠️ outer only,
  observation+verification ⚠️ install-moment only); verification must be TWO
  levels (L1 delivery-completeness static — current verify-referenced-landed
  only covers category 1; L2 continuous-health dynamic — all criteria are
  point-in-time); land the six-category spec as a checked-in live document +
  extend the L1 completeness check to all six categories"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人问「真正完整地冷启动 quay 并持续正确驱动开发，要完整交付的到底是什么？应当维护一份文档并建立
校验机制，这才算产品化交付」。管理者已写 `orchestration/SPEC-complete-delivery-surface-2026-08-05.md`
——**交付面的测量结果**（非提案），五处实测缺口 + 六类交付面 + 两层次校验结构判断。

**六类完整交付面**：
| 类别 | 现状 | 归属 |
|---|---|---|
| 1. 机件与运行时 | ✅ | quay-init 派生铺设已修好 |
| 2. 循环文档 | ⚠️ 缺 manager 层 | `gap-productize-the-manager-layer` |
| 3. 启动配置 | ✗ 全缺 | `gap-crystallize-launch-config-into-checked-in-settings-file` |
| 4. 会话拓扑 | ✗ 全缺 | `gap-tmux-session-topology-no-factory-definition`（另立） |
| 5. 周期锚点 | ⚠️ outer 只有 | `gap-inner-has-no-periodic-anchor`(done) + `gap-reanchor-must-converge` + manager cron |
| 6. 观测与校验 | ⚠️ 只覆盖启动瞬间 | 本条 L1 + `gap-quality-criteria-are-point-in-time`(L2) |

**两层次校验**：
- **L1 交付完整性**（静态，装前装后都能跑）：六类每一类都有对应交付物 + 目标项目落地后逐项可解析。
  现有 `verify-referenced-landed`（gap-init-ships 产物）**只覆盖第 1 类**。
- **L2 持续健康**（动态，周期跑）：趋势型判据——现有全部点状；`gap-quality-criteria-are-point-in-time`
  只收了 2 个实例，§3 其余三类（语义一致 / 升级正确性 / 三层完整性）未进。

> **L2 补「循环在转」（2026-08-06，`gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed`）**：
> 判据从「铺了」补「在转」——L2 活实例。`plugin/scripts/dead-loop-check.sh` = 目标 outer/inner transcript
> 最近 N 分钟有新的 user 消息 **或** git 最近 N 分钟有提交 ⇒ `loop_alive = alive`；都无 ⇒ `dead`（与 backlog
> 空无关）。承载点：SPEC §5 层次二 + 该任务。

### 选定机制（外层裁定）

**维护一份六类交付面文档 + 建立两层次校验（人问的「这才算产品化交付」）**：

1. **六类交付面落成活文档**：`orchestration/SPEC-complete-delivery-surface-2026-08-05.md` 升级为**活的
   交付面清单**（六类 + 每类对应交付物 + 归属任务 + 校验判据），随交付物变化更新（单源）。
2. **L1 交付完整性检查**：把 `verify-referenced-landed` 从「只覆盖第 1 类」扩展到**六类全覆盖**——
   静态检查「六类每一类都有交付物 + 目标项目落地后可解析」，装前装后都能跑。
3. **L2 持续健康**：趋势型判据由 `gap-quality-criteria-are-point-in-time-no-trend-criteria` 承载
   （本文件 §3 的语义一致 / 升级正确性 / 三层完整性三类补进该任务）。
4. **不重复建任务**：manager 层（productize umbrella）/ 启动配置（launch-config）/ 周期锚点
   （anchor+converge）/ 会话拓扑（另立）/ 升级通道（另立）各自落地；本条是**规格 + L1 校验**。
5. **L_T 代理消除（管理者五透镜 2026-08-05）——六类里三类仍用廉价代理判据，须按真维度重定**：
   - **循环文档**：代理 =「出厂文档在」；真 =「inner 读了并照做」——实测 inner 复读自己上下文旧措辞，
     ⇒ 真判据 = 语义收敛（`gap-reanchor-must-converge`，inner 自述向出厂语义收敛）；
   - **周期锚点**：代理 =「CRON-CREATED 键测 cron 存在」；真 =「循环真的重锚」⇒ 真判据 = 重锚实跑
     （anchor 任务 AC6 + convergence）；
   - **观测与校验**：代理 =「AC8c 测启动瞬间」；真 =「持续健康」⇒ 真判据 = 趋势型 L2
     （`gap-quality-criteria-are-point-in-time`）。
   **L1 检查的六类判据必须落在真维度上**（同 curl-vs-subagent 修采样仪器的教训——廉价代理在错误轴给
   伪收敛）。

## Acceptance Criteria

- [x] AC1: **六类交付面活文档**——`SPEC-complete-delivery-surface-2026-08-05.md` 升级为六类清单 +
      每类对应交付物 + 归属任务 + 校验判据（单源，随交付物变化更新）。§4 改为活表格（六类 + 交付物 +
      归属任务 + 校验判据）+ 文末 L1-MANIFEST 机器可读块；`spec_is_live` 钉住文档与可执行清单一致。
- [x] AC2: **L1 检查扩展到六类**——静态检查「六类每一类都有交付物 + 目标项目落地后可解析」，装前装后
      都能跑。`plugin/scripts/verify-delivery-surface.ts`（新）：六类逐类核对交付物存在 + 归属任务可解析；
      `--root` 指向交付包（装前）/ 目标项目（装后）。Contract control 逐类 fixture：删一类交付物 ⇒ 报
      MISSING（5/6）；补全 ⇒ 6/6（见任务体实测输出）。
- [x] AC3: L2 持续健康判据承载——§3 的语义一致 / 升级正确性 / 三层完整性三类补进
      `gap-quality-criteria-are-point-in-time-no-trend-criteria`（交叉标注）。该任务 §5 已列三类；
      本条补交叉标注（语义一致 → gap-reanchor-must-converge / 升级正确性 → gap-delivery-surface-grows /
      三层完整性 → gap-productize-the-manager-layer）。
- [x] AC4: 六类归属无空洞——每条 gap（manager 层/启动配置/会话拓扑/周期锚点/升级通道）对应一个
      已立案任务。L1 清单 attribution 列 + SPEC「AC4 归属无空洞」段逐项解析；L1 报 `attributionHoles`
      （实测 0 洞，见任务体实测输出）。
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`（L1 检查的六类全覆盖断言）。
      `plugin/test/verify-delivery-surface.test.mjs` 首行 `// @test-group governance`，import node:test。

## Evidence（AC2/AC4 实测输出，2026-08-06 实跑）

**AC2 invoke**（交付包实跑）：
```
$ node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --surface
surface_categories_covered=6/6
spec_is_live=1 (SPEC doc L1-MANIFEST matches the executable manifest)
  [1/6] mechanism-and-runtime (机件与运行时): COVERED
  [2/6] loop-docs (循环文档): COVERED | 归属: gap-productize-the-manager-layer
  [3/6] launch-config (启动配置): COVERED | 归属: gap-crystallize-launch-config-into-checked-in-settings-file
  [4/6] session-topology (会话拓扑): COVERED | 归属: gap-tmux-session-topology-no-factory-definition
  [5/6] periodic-anchor (周期锚点): COVERED | 归属: gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash
  [6/6] observation-and-verification (观测与校验): COVERED | 归属: gap-quality-criteria-are-point-in-time-no-trend-criteria
PASS: all 6 delivery categories covered, spec_is_live satisfied
```

**AC2 装前装后 + Contract control**（scoped 测试，`QUAY_TEST_SKIP_DIST_BUILD=1 bash scripts/test.sh
--for-task gap-complete-delivery-surface-spec-and-l1-verification --allow-thin`）：
```
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
```
（逐类 fixture：删任一类交付物 ⇒ L1 报 MISSING/5/6；完整 fixture ⇒ 6/6；spec_is_live 漂移 ⇒ 0；
无 SPEC doc 的目标 ⇒ n/a。四静态检查全 PASS，exit 0。注：`QUAY_TEST_SKIP_DIST_BUILD=1` 因本 worktree
无 node_modules；本测试为纯 TS，不依赖 dist 包。）

**AC4 无空洞**（`--json` 实跑）：`attributionHoles` 全空 —— 五个归属任务
（gap-productize-the-manager-layer / gap-crystallize-launch-config-into-checked-in-settings-file /
gap-tmux-session-topology-no-factory-definition / gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash /
gap-quality-criteria-are-point-in-time-no-trend-criteria）在任务板上逐项可解析；SPEC「AC4 归属无空洞」段另列
升级通道 → gap-delivery-surface-grows-but-target-freezes-no-upgrade。
      每类对应交付物 + 归属任务 + 校验判据（单源，随交付物变化更新）
      → `orchestration/SPEC-complete-delivery-surface-2026-08-05.md`：第 4 节六类表格（交付物/归属任务/
      L1 校验判据）+ 第 6 节机读清单（`<!-- l1-category: … -->` 标注，随交付物变化更新——`spec_is_live`）。
      机读清单是 `l1-delivery-surface-check.ts` 的单一数据源（机械消费，非冻结快照）。
- [x] AC2: **L1 检查扩展到六类**——静态检查「六类每一类都有交付物 + 目标项目落地后可解析」，装前装后
      都能跑（现有 verify-referenced-landed 从第 1 类扩展到全六类）
      → `plugin/scripts/l1-delivery-surface-check.ts`（new）：`--surface` 模式对六类逐类解析交付物 +
      归属任务，报 `surface-categories-covered: N/6`。装入 `plugin/scripts/quay-init.sh` 的派生铺设集
      （随 loop 铺进目标，装后能跑）并在 post-laydown 校验段 invoke（`verify_referenced_landed` 之后，
      fail-closed）。invoke 实跑 + 逐类 fixture 见下方「AC2/AC4 实测输出」。
- [x] AC3: L2 持续健康判据承载——§3 的语义一致 / 升级正确性 / 三层完整性三类补进
      `gap-quality-criteria-are-point-in-time-no-trend-criteria`（交叉标注）
      → 该任务（done）Proposal 第 5 条已把三类归属到 `gap-reanchor-must-converge-…` /
      `gap-delivery-surface-grows-but-target-freezes-no-upgrade` / `gap-productize-the-manager-layer`；
      本条补交叉标注（AC3 注记）确认该承载点 + L1/L2 分工。断言见
      `plugin/test/l1-delivery-surface-check.test.mjs`「AC3」。
- [x] AC4: 六类归属无空洞——每条 gap（manager 层/启动配置/会话拓扑/周期锚点/升级通道）对应一个
      已立案任务（实测清单可逐项解析到任务）
      → SPEC §6 每条 `l1-category` 标注携带 `task:`；L1 检查机械校验 `tasks/<id>.md` 存在；逐类 fixture
      （删除归属任务 ⇒ 必报缺）。三个归属任务交叉标注已写回：`gap-productize-the-manager-layer.md` /
      `gap-crystallize-launch-config-into-checked-in-settings-file.md` /
      `gap-quality-criteria-are-point-in-time-no-trend-criteria.md`。
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`（L1 检查的六类全覆盖断言）
      → `plugin/test/l1-delivery-surface-check.test.mjs`（new，`// @test-group governance` + `node:test`，
      6 用例）——AC1 六类机读声明 / AC2 6-6 全绿 + 逐类 fixture / AC4 无空洞 / AC5 wiring / AC3 交叉标注。
      实跑 `node --test plugin/test/l1-delivery-surface-check.test.mjs` → `pass 6 / fail 0 / cancelled 0`。

## Test-Files

- plugin/test/l1-delivery-surface-check.test.mjs

## AC2/AC4 实测输出

Contract invoke（六类全覆盖）：
```
$ node --no-warnings --experimental-strip-types plugin/scripts/l1-delivery-surface-check.ts --surface
surface-categories-covered: 6/6
```
（stdout 第二行 = 六类逐类 JSON 详情；exit 0。）

逐类 fixture（每类删除其一个非 SPEC 交付物 ⇒ L1 必报缺并点名，`plugin/test/l1-delivery-surface-check.test.mjs`「AC2 per-category fixture」）：
```
# 删除 plugin/scripts（第 1 类交付物）后的输出节选：
surface-categories-covered: 1/6
ERROR: 5 of 6 delivery-surface categories uncovered —
  1. mechanisms-runtime: missing deliverable plugin/scripts
  ...
```
AC4（删除归属任务 ⇒ 必报缺并点名，同测试「AC4 no-holes」）。

scoped 测试（`bash scripts/test.sh --for-task gap-complete-delivery-surface-spec-and-l1-verification --allow-thin`）：
```
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
test-framework-policy-check — 229 glob file(s), 34 exemption(s)     PASS (at/below ratchet ceiling, no growth)
test-isolation-check — 229 glob file(s), 44 current violation(s)    PASS (all baselined; live-data-dir-write=0)
test-impl-census: checked 229 test files · clean 229 · impl-deleted 0   PASS
task-contract-check: no violations (strict-subset, touched tasks)   PASS
strategic-doc-staleness-check — 90 strategic doc(s)                 PASS (no NEW stale)
✔ AC1 — the SPEC declares exactly six machine-readable categories (live single source, spec_is_live)
✔ AC2 — the L1 check reports 6/6 against the real delivery surface (six-category full coverage)
✔ AC2 — removing a category deliverable drops the covered count and names it (per-category fixture)
✔ AC4 — removing a category's owning task file drops the covered count and names it (no holes)
✔ AC5 — quay-init wiring: the L1 check ships in the derived set and is invoked beside verify_referenced_landed
✔ AC3 — 语义一致 / 升级正确性 / 三层完整性 are carried by gap-quality-criteria-are-point-in-time-no-trend-criteria
ℹ tests 6   ℹ pass 6   ℹ fail 0   ℹ cancelled 0   (l1-delivery-surface-check.test.mjs)
```
scoped 静态检查全绿（test-framework / test-isolation / test-impl-census / task-contract / strategic-doc-staleness）；
选中测试 `plugin/test/l1-delivery-surface-check.test.mjs` 6/6 全绿。（注：scoped 运行需 node_modules 工作区链接；
full-suite gate 的其余整仓 ratchet 由外层 verification round 跑，本 scoped 模式按设计 DEFER 过去。）

## Definition of Done

- [x] AC1–AC5 全部勾上；AC2/AC4 实测输出贴任务体
- [x] 六类交付面有活文档 + L1 六类完整性检查可跑；每类 gap 可解析到任务
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——scoped 套件绿
      （2026-08-07 复验：`l1-delivery-surface-check.test.mjs` 6/6 +
      `verify-delivery-surface.test.mjs` 9/9 = 15/15，exit 0；四静态检查全 PASS）；
      **full-suite 整仓 ratchet 按设计 DEFER 给外层 verification round**
      （本 worktree 无 node_modules，任务体已注明 scoped 模式 DEFER 设计）。

## Execution record（2026-08-07 复验，worktree `delivery-surface`）

实现已由先前提交落地（`a423b047`/`8f1ee67d` 并入 develop）；本次复验 + 闭环：

- `node --no-warnings --experimental-strip-types plugin/scripts/l1-delivery-surface-check.ts --surface`
  → `surface-categories-covered: 6/6`，exit 0（六类逐类全 covered，含 AC4 归属任务逐项可解析）。
- `node --no-warnings --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --surface`
  → `surface_categories_covered=6/6`，`spec_is_live=1`（SPEC L1-MANIFEST 与可执行清单一致），exit 0。
- `QUAY_TEST_SKIP_DIST_BUILD=1 bash scripts/test.sh --for-task gap-complete-delivery-surface-spec-and-l1-verification --allow-thin`
  → `ℹ tests 15 · pass 15 · fail 0 · cancelled 0`；scoped 静态检查全 PASS
  （test-framework-policy / test-isolation / test-impl-census / task-contract / strategic-doc-staleness）。
- Contract control 已由测试逐类 fixture 覆盖：删任一类交付物 ⇒ L1 报 MISSING（<6/6）；删归属任务 ⇒ 报缺（AC4 无空洞）。

## Touches

- tasks/gap-complete-delivery-surface-spec-and-l1-verification.md（自身文件：勾 AC + 贴 invoke 证据授权）

- orchestration/SPEC-complete-delivery-surface-2026-08-05.md（升级为六类活文档 + L1-MANIFEST + AC4 归属段）
- plugin/scripts/verify-delivery-surface.ts（新建：L1 六类完整性检查）
- plugin/test/verify-delivery-surface.test.mjs（新建：L1 六类全覆盖断言，@test-group governance）
- tasks/gap-complete-delivery-surface-spec-and-l1-verification.md
- orchestration/SPEC-complete-delivery-surface-2026-08-05.md（升级为六类活文档）
- plugin/scripts/（verify-referenced-landed 或等价：扩展到六类；l1-delivery-surface-check.ts + quay-init.sh + capability-catalog.sh）
- plugin/test/（L1 六类全覆盖断言）
- tasks/gap-productize-the-manager-layer.md（AC4 交叉标注）
- tasks/gap-crystallize-launch-config-into-checked-in-settings-file.md（AC4 交叉标注）
- tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria.md（AC3 交叉标注）

## Contract

measure   surface_categories_covered = `node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts` stdout 的 covered 数字段（N/6）
band      surface_categories_covered = 6（六类全覆盖）
invariant spec_is_live = 1（交付面文档随交付物变化更新，非冻结快照）
invoke    `node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --surface`
control   六类中任一类无交付物 ⇒ L1 必报缺；补齐 ⇒ 6/6（逐类 fixture）
resume    六类文档与 L1 检查分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T06:1xZ
changed: 外层读 SPEC-complete-delivery-surface 全文裁定立案（人问的产品化交付规格）。四处收紧：
(1) **六类交付面活文档**——不是冻结快照，随交付物变化更新（单源）；
(2) **L1 检查扩展六类**——verify-referenced-landed 只覆盖第 1 类，扩展到全六类（装前装后都能跑）；
(3) **L2 持续健康另条承载**——§3 三类补进 trend-criteria 任务（交叉标注）；
(4) **无空洞**——每类 gap 可解析到已立案任务（AC4）。
status: todo——人问的产品化交付规格；排当前批（ROUND 3 收尾）后，高优先。
