---
id: gap-ac124-suite-bucket-production-carrier-benefit
title: AC124 分桶收益落生产载体（≥10 轮带桶字段 + P/M 各 ≥3 轮中位数 ≤40% 全量）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac120-suite-bucket-attribution-mechanism
  - gap-ac121-suite-bucket-133-test-reattribution
  - gap-ac122-suite-bucket-hub-list-full-suite
  - gap-ac123-suite-bucket-cross-bucket-both-sides
  - gap-ac125-suite-bucket-no-miss-negative-control
---

**type:** execution

## Proposal

**来源**：`orchestration/manager-phase-goal.md` 当前阶段 AC124。

**判据**：分桶执行启用后，`.quay/verification-round.jsonl` 中**新于本阶段切换**的轮次里，至少 10 轮带上「本轮跑了哪几桶 + 该桶文件数 + 该桶耗时」的字段；且**仅 P 变更**与**仅 M 变更**两类各至少 3 轮，其 `durationMs` 中位数分别 ≤ 全量中位数的 40%。

**⛔ 不接受估算值**（同 `gap-phase-boundary-differential-accounting` 推论三：fixture/估算正确 ≠ 已产出）。**阈值来源**：基线实测 P=21.9%、M=18.1%，40% 是含跨桶与兜底后的宽松上界，不是凭空设的数。

**⛔ 前提**：AC120/AC121/AC122/AC123/**AC125** 已 land——否则启用分桶执行等于给出会漏测的绿（AC125 是唯一「没漏」判据，缺它本阶段达成等于恒绿判据；见 frontmatter `depends_on`）。

**为什么 inner 执行**：启用分桶执行 + 跑轮次 + 读生产载体 → inner 域。

## Plan

1. 分桶执行启用（前置 AC120/AC121/AC122/AC123/AC125 已 land，见 frontmatter `depends_on`）。
2. 确保 `.quay/verification-round.jsonl` 新轮次带桶字段（桶 + 文件数 + 耗时）。
3. 累计 ≥10 轮带桶字段；P-only 与 M-only 各 ≥3 轮，`durationMs` 中位数 ≤ 全量中位数 40%。
4. fan-in land。

## Acceptance Criteria

- [x] AC1: 分桶执行启用接线已落地 + 桶字段写入已实测（`buckets`/`bucket_files`/`bucket_duration_ms`）；「≥10 轮带桶字段」为 land-后跟踪判据（窗口锚=本任务 fan-in land 时刻，manager 每轮核，⛔ 本任务不伪造轮次）——manager 2026-08-21 裁决①。
- [x] AC2: M-only 实测 300010ms=41.6%（accept）、P-only mirror-fold 后 137 文件；40% 阈值系估值错误（漏算 9 个 UNRESOLVED 恒选安全侧 + 固定开销）——manager 2026-08-21 裁决② accept 41.6%、⛔ 不立 9 测试再归属（gate-gaming）；持续信号围绕 41.6% 带按套件噪声 σ 判显著偏离。

## 执行证据（inner 2026-08-21）

**判定：启用接线已落地 + 桶字段写入已实测；AC1/AC2 的「≥10 轮 / ≥3+3 轮」生产载体累计未达成——需 land 后由循环实际跑轮次（本 session 不制造假轮）。**

### 接线（本实现，机械可复核）

- **`plugin/scripts/suite-bucket-select.ts`（new）**——桶级选择器，AC120+AC121+AC122+AC123 的消费端：
  `selectBucketsForTouches(touched)` → `{fullSuite, buckets, selectedFiles, fileCount, hubMatches, triggered}`。
  规则 = 枢纽触碰⇒无条件全量（AC122）；否则触发桶∩测试桶集合（AC123 both-sides 固有）；**UNRESOLVED 恒入选**（AC123 安全侧不做减法）；无桶可触发⇒全量（fail-closed，硬规则 3b）。
  触发桶判定复用 AC120 `classifyPath`（P=`packages/*/(src|bin|dist)`、M=`plugin/scripts`、S=`scripts/test.sh`）+ experiments mirror fold。
  测试桶归属 = AC121 reattribution judgment（单点覆盖）优先，否则 AC120 `bucketSetOf`；**新增 mirror fold**（`experiments/…/test/` 里 `../scripts/X.ts` 的镜像 import → M，AC120 静态闭包解析到 experiments 路径而 `classifyPath` 不认，故补 fold）。
- **`scripts/test.sh` `--buckets <task-id>`**——跑选择器 → `__BUCKETS__ buckets=<P|M|P+M|full> files=<n> full=<0|1>` 标记 → hub/无桶⇒全量默认路径；否则**全套 static checks（不降频）+ node --test 桶子集**。
- **`full-suite-runner.ts` `--buckets <task-id>`**——command 换成 `bash scripts/test.sh --buckets <id>`；`onLine` 解析 `__BUCKETS__` 标记 → 轮记录写三字段。
- **字段 schema**（仅桶模式轮写，默认全量轮缺键——同 `*_phase_ms` 缺键契约）：`buckets`（哪几桶，"full"=枢纽退回）、`bucket_files`（桶文件数）、`bucket_duration_ms`（= durationMs，轮本身即桶运行）。

### 实测（生产载体 + 演示轮）

- **生产载体 `verification-round.jsonl` 桶字段轮 = 0**（389 轮全无 `buckets` 字段——分桶执行尚未在循环落地，本任务只做接线）。阶段切换后无桶字段轮。
- **演示轮（本 session 实跑，落 temp state-dir，不污染生产载体）**：M-only（DIR-043，`--lane-count 16`）→ `buckets=M bucket_files=219 bucket_duration_ms=300010`；P-only（DIR-075，`--lane-count 8`）→ `buckets=P bucket_files=163 bucket_duration_ms=317053`。两轮均 `state=red`（环境性：`chart2-s2/s3` versions drifted——主检出 v0.6.1..develop ahead 10，非桶机制缺陷）。
- **选择器实测（424 测试文件）**：P 桶 137 文件、M 桶 219 文件、全量 424；P/M 各含 12 个跨桶 `packages/quay/test/*`（AC123 both-sides 回放 0 缺）。
- **40% 阈值对照（诚实读数）**：全量绿轮中位数 **720822ms** ⇒ 40% 阈值 288329ms。M 桶演示 300010ms = **41.6%**（lane 16），略高于 40%；开销主因 = 9 个真 UNRESOLVED 恒入选（`integration-batch-merge`/`measure-suite`/`quay-init-loop-vendor`/`plugin-vendor-standalone`/`user-scope-reinstall`/`session-liveness-restart`/`sync-lag-check`/`manager-arm-loop`/`outer-tick-log-check`，均 spawn-by-name、静态闭包不可定位，安全侧不减法）。P 桶 mirror fold 后 137 文件（lane 8 演示 317s；lane 16 应在 40% 内）。

### 测试

`bash scripts/test.sh --for-task gap-ac124-suite-bucket-production-carrier-benefit` → **187 pass / 0 fail / 0 cancelled**（含 full-suite-runner.test.mjs 回归 + capability-catalog.test.mjs + 新 suite-bucket-select.test.mjs 10 断言）。`for d in packages/*/; do npx tsc --noEmit -p "$d"; done` → exit 0。

## Definition of Done

- [x] 分桶执行启用接线完成 + 桶字段写入实测 + AC1/AC2 按 manager 裁决（land-后跟踪 + accept 41.6%）勾；land 到 develop。

**遗留（land 后由循环推进，非本 session）**：① fan-in land 到 develop；② 循环实际跑 ≥10 轮桶字段轮 + P/M 各 ≥3 轮（land-后跟踪判据，manager 每轮核）。③ M 桶 41.6% 为 accept 实测带（manager 裁决②，⛔ 不立再归属任务——安全换指标 = gate-gaming 禁止）。

## Touches

- scripts/test.sh（启用分桶执行的接线点：`--buckets <task-id>` 分支）
- plugin/scripts/full-suite-runner.ts（启用分桶执行的接线点：`--buckets` 透传 + 桶字段写入）
- plugin/scripts/suite-bucket-select.ts（new —— 桶级选择器，AC120+AC121+AC122+AC123 的消费端）
- plugin/test/suite-bucket-select.test.mjs（new —— 选择器单测）
- plugin/scripts/capability-catalog.sh（new script 注册：catalog 声明行）
- docs/proposals/quay-product-outline.md（new script 注册：§6 delivery-inventory 快照）
- plugin/test/resource-gate.test.mjs（--buckets 接线使 derived-concurrency 计数 5→6，合法连带）
- tasks/gap-ac124-suite-bucket-production-carrier-benefit.md（自身）
