# 每日复盘节奏（Review Cadence）——机制，不是角色记得

**来源裁定**：`FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md` 引出的人裁定（2026-08-04/05）。
**任务**：`gap-establish-daily-review-cadence-mechanism`。**性质**：**决定，不是建议**——任何未来会话
（outer / inner / manager / 冷启动）引用本文件执行复盘，不靠任何人「记得要复盘」。

> 一句话：**每天一次、按日历挂钩；管理者发起并汇总，外层参与作答，人接收结果并保留方向裁定权；
> 三项清单机械执行。**

---

## 1. 频率（日历挂钩，不按任务量）

**每 24 小时一次，按日历时间挂钩。** 架构决定（ADR 这类）不会与任务速度成比例发生——不能
「攒到 N 个 tick / N 个任务再复盘」。具体触发：**每个自然日**由管理者在当日的 tick 里发起一次，
或者当出现下列任一时，立即跑一次（不等日历）：

- 任何人问「外层/整体有没有在做分析、规划、设计」（当日 FINDING 的触发形态）；
- 一条新 `FINDING-*` / `RESEARCH-*` 落盘；
- 一次批量 gap 任务关闭（batch closure）完成。

## 2. 角色

| 角色 | 职责 |
|---|---|
| **管理者（manager）** | **发起并汇总**。每个日历日起头，管理者把三项清单的结果收拢成一份汇总，写进
  `orchestration/manager-phase-goal.md` 的复核记录（管理者自己扩，外层不代笔）。 |
| **外层（outer）** | **参与作答**。跑机械检查（清单 1a）、判 gap-* 可追溯性（清单 1b）、在
  `orchestration/outer-phase-goal.md` 的复核记录里加「方向漂移」两行（清单 1c）。 |
| **人（human）** | **接收结果，保留方向裁定权**。人不被要求自己逐条审查；但**任何方向性改变仍需人点头**。
  检查器是探测器不是否决权——方向判断归人。 |

## 3. 三项清单（每次复盘逐项跑）

### 3a. 机械检查战略文档是否过期 + 池晋级候选是否引用了已退休机制

**命令**（`plugin/scripts/strategic-doc-staleness-check.ts`，`gap-establish-daily-review-cadence-mechanism`
泛化出的通用脚本——路线图任务 AC4 grep 判据的 reusable 形式）：

```bash
# 战略文档：扫 docs/proposals/ + orchestration/*ROADMAP*，检出引用 ADR-022 已删脚本
# （prepare-milestone.js / execute-milestone.js / milestone-worktree.ts）且无 retired/superseded 标注的条目
node --experimental-strip-types plugin/scripts/strategic-doc-staleness-check.ts --root .

# 池晋级候选：对 ready-pool 本次推荐晋级的每个候选逐个判
# 「引用了已退休机制」→ 剔除（AC8 回归控制：gap-prepare-milestone-no-size-aware-routing 必须被标）
node --experimental-strip-types plugin/scripts/strategic-doc-staleness-check.ts --root . --pool-candidate <task-id>
```

- **判据**：按**路径存在性 + 已废除机制引用**判，不按关键词。已标注（retired / superseded / ADR-022 /
  Chinese 等价）的引用不算；KNOWN_STALE 基线里的 6 份文档是当前已知过期（报告不计数），**新**过期文档
  会让 `run_static_checks` 红（已在 `scripts/test.sh` 接线）。
- **输出写进汇总**：`stale_refs_found`（新）+ 已知过期文档清单；池候选被标者**不进 ready 池**。

### 3b. 近窗口 `gap-*` 任务可追溯性

对近窗口（本自然日 / 上次复盘以来）新建的每条 `gap-*` 任务，逐个判：

- **可追溯到书面战略问题**（`FINDING-*` / `RESEARCH-*` / 任务体内显式引用的方向性问题）→ 记「可追溯」；
- **纯反应式**（干活时顺手撞见，无书面战略追溯）→ 记「纯反应式（记录）」——**记录不等于合格**，
  若同族纯反应式反复出现，那本身是一个战略层信号。

判定结果写进外层复核记录的「gap-* 战略追溯」一行。

### 3c. 复核记录扩方向：方向本身有没有偏

`orchestration/outer-phase-goal.md` 的复核记录从「只覆盖角色纪律」扩到「覆盖方向本身」——每次复盘加两行：

1. **近窗口 gap-* 战略追溯**（3b 的结果）；
2. **路线图是否过期**（3a 的结果 + `FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md`）。

### 3d. 趋势判据——「比上次更贵了吗 / 离目标更近了吗」（点状之外的趋势检查）

**任务**：`gap-quality-criteria-are-point-in-time-no-trend-criteria`。**性质**：被动判据——读已有
指标历史，**不引入新调度**（AC5）。上述三项清单全是**点状判据**（这次绿了吗 / 这条契约合规吗 /
这篇战略文档过期吗）；**没有一条问「比上次更贵了吗」**——0.251→0.464→0.321（净 +28%）恶化了一整天
才被人肉问出来。趋势判据是新品类，每次复盘逐项跑：

```bash
# 读 verification-round.jsonl（套件 per-test 成本）+ checker-cost.jsonl（判据自身成本）+
# suite-state-events.jsonl（早期 RED 检测延迟），对窗口内最近 N 点算 (最后−最先)/最先 变化率，
# 恶化超阈值（默认 +10%，可配 --threshold）打标报出
node --experimental-strip-types plugin/scripts/trend-check.ts --root . --window 3
```

- **判据**：趋势打标数组 `trend_flags`（stdout，Contract measure）。**打标 = 数据，不是错误**——
  「比上次更贵了吗」有机械答案（窗口内净变化超阈值即打标），不再等人肉问出来。
- **输出写进汇总**：`trend_flags`（打标数组）+ 被标系列清单（如 `suite.perTestMs` /
  `checker:ready-pool-check.ms` / `suite.redDetectLatencyMs`）。
- **归属**：看趋势是 manager 层三职能之一（`gap-productize-the-manager-layer` 的职能内容，AC6 交叉
  标注）——复盘不只是「这次绿了吗」，还看「比上次更贵了吗 / 离目标更近了吗」。

`orchestration/manager-phase-goal.md` 的复核记录由管理者**自己扩**（外层不代笔），加同一方向维度。

### 3d. 趋势判据——点状之外：「比上次更贵了吗 / 离目标更近了吗」

所有 3a–3c 的判据都是**点状**的（这次绿了吗、这条契约合规吗）。**趋势判据是新品类**
（`gap-quality-criteria-are-point-in-time-no-trend-criteria`）——单次绿/红读不出「在改善还是在恶化」
（每测试成本 0.251→0.464→0.321、净 +28% 恶化了一整天才有人问出来）。每次复盘跑一次：

```bash
# 读已有记录（verification-round.jsonl + checker-cost.jsonl 历史），被动判据、不引入新调度；
# 窗口内恶化超阈值（默认 +10%/窗口，--threshold 可配）即打标，exit 1。
node --experimental-strip-types plugin/scripts/trend-check.ts --window 5
```

- **三轴**：①套件每测试成本（per_test_ms，随窗口斜率）；②早期 RED 检测延迟（首真失败 → state 转 red，
  爆炸半径缓解度的监控）；③单判据成本（checker-cost.jsonl，判据本身是否变贵——ready-pool-check
  35.8→91.2→157 斜率不需人手工掐表）。
- **输出写进汇总**：`trend_flags`（打标数组）+ 每条打标的轴/数值/净变化；exit 1 = 窗口内存在恶化，
  按恶化轴进当日复盘结论（不是一次性，是复盘常项）。

---

## 4. 第一次复盘（已执行，见 outer-phase-goal.md 复核记录 2026-08-05）

用当日三个实锤输入跑了一次：
1. **路线图过期**：`docs/proposals/quay-harness-crystallization-roadmap.md` 建于 07-31，整篇建立在
   ADR-022（08-03）已废除的经典 milestone 管线上（Phase 0–4 指向已删代码）——检查器检出（KNOWN_STALE，
   由 sibling 任务 `gap-roadmap-silently-stale-mark-superseded-or-rewrite-fast-mode` 修复）；
2. **临场推 meta-cc（无对照）**：当晚 meta-cc 冷启动在回答 Phase 3 的战略问题，但没对照任何写下来的
   路线图——**纯临场推**，无书面追溯（3b 记「纯反应式」）；
3. **池机制推荐已退休管线任务**：`ready-pool-check` 推荐 `gap-prepare-milestone-no-size-aware-routing`
   （ADR-022 已退休管线 parent，touches 假 resolve）——`--pool-candidate` 判它被标（AC8 回归控制），
   池晋级候选纳入过期检查。

---

## 5. 机制落地的三个部件

1. **本文件**（`orchestration/REVIEW-cadence.md`）——频率/角色/清单，未来会话可引用；
2. **通用过期检查器** `plugin/scripts/strategic-doc-staleness-check.ts`——已接 `scripts/test.sh`
   `run_static_checks`（防回归），有 mutation case + `node:test` 套件；
3. **复核记录扩方向**——`outer-phase-goal.md` / `manager-phase-goal.md` 的复核记录覆盖方向漂移。
