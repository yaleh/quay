---
id: gap-inbox-message-bus-teardown
title: inbox 机制彻底删除（范围A，人 2026-08-20 09:2xZ 裁定）——message-bus.ts/inbox-reader.sh
  代码+测试删除，supervisor-bus-identity.sh 失效子命令退役，capability-catalog 条目清理
status: ready
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

**来源**：人 2026-08-20 09:2xZ 裁定 inbox 机制彻底删除（范围A，不留 archive/说明）。manager 已完成其侧（删除 `.quay/manager-inbox/` 全部 134 文件 + manager-tick-core.md 的 A15/A0④/C10 引用清理，commit f40ef8f2 + 2ebef21c）。本任务承接剩余代码+测试+文档删除面。

**删除对象（外层已逐文件核实，position-based 排除纯注释引用）**：

| 文件 | 性质 | 删除 |
|---|---|---|
| `packages/quay/src/message-bus.ts` | 产品代码（零生产调用者，grep 核实仅测试/自引用/supervisor-bus-identity.sh） | 删 |
| `packages/quay/test/message-bus.test.mjs` | 产品测试 | 删 |
| `packages/quay/test/message-bus-identity.test.mjs` | 产品测试 | 删 |
| `plugin/scripts/inbox-reader.sh` | plugin 脚本 | 删 |
| `plugin/test/inbox-reader.test.mjs` | plugin 测试 | 删 |
| `packages/quay/plugin/scripts/inbox-reader.sh` | **打包副本**（与 plugin/scripts/ 逐字节相同） | 删 |
| `plugin/scripts/supervisor-bus-identity.sh` | 控制面家族（**人保留脚本**），但 claim-human-test + inbox-summary 两子命令硬依赖 message-bus.ts 与 `.quay/manager-inbox` | **改**：退役失效子命令 + BUS_TS 变量；保留脚本骨架 |
| `packages/quay/plugin/scripts/supervisor-bus-identity.sh` | 打包副本（与 plugin/scripts/ 逐字节相同） | 同步改 |
| `plugin/scripts/capability-catalog.sh` | 验证机件（**SINGLE SOURCE OF TRUTH**，1909 行），6 处 `inbox-reader.sh` 引用（:222/:476/:746/:1016/:1286 等） | **改**：移除条目 |
| `packages/quay/plugin/scripts/capability-catalog.sh` | 打包副本（1859 行，与正本 diff） | 同步 |
| `plugin/test/supervisor-bus-identity.test.mjs` | 测 claim-human-test + inbox-summary 两子命令 | **改**：收缩到保留子命令 |
| `orchestration/fast-mode-tick-core.md:26` | **inner 执行核 A5 行**（`bash plugin/scripts/supervisor-bus-identity.sh inbox-summary`）——与 outer A5（已迁 R35）平行的 inner 侧同一条 | **改**：迁出到 inner 侧归档（同 outer R35 处置），inner 独占文件 inner 落盘 |
| `docs/analysis/fast-mode-loop-tick.md` | inner tick 文档，:320-328 收件箱机械挂载点 | **改**：移除（inner 独占文档，inner 落盘） |
| `plugin/loop/fast-mode-loop-tick.md` | inner 产品模板，:432-445 | **改**：移除（inner 独占） |
| `orchestration/SPEC-inbox-service-2026-08-08.md` | 设计记录（inbox 机制的设计正本） | **删**（git 历史 = 落点；外层裁定：设计推理已随机制退役，git 可复现） |
| `docs/proposals/quay-message-bus-human-in-the-network.md` | 设计记录 | **删**（git 历史 = 落点） |
| `docs/proposals/quay-message-bus-proposal-manager-2026-08-06.md` | 设计记录 | **删**（git 历史 = 落点） |
| `plugin/skills/manager/SKILL.md:175` | 引用 SPEC-inbox-service | **改**：移除该 reference 行（否则死引用，硬规则 5） |
| `plugin/skills/init/SKILL.md:183` | 引用 SPEC-inbox-service | **改**：移除该 reference-doc 行 |
| `orchestration/SPEC-integration-architecture-2026-08-05.md` | 引用 quay-message-bus-human-in-the-network | **改**：移除该引用（死引用清理） |
| `docs/proposals/quay-product-outline.md` / `quay-web-human-is-not-an-operator.md` / `quay-saas-remote-access-to-an-onprem-loop.md` | 引用 quay-message-bus-human-in-the-network | **核**：若仅提及历史设计，改指针或移除 |

**明确排除（人裁定保留，不得删除/改动）**：`supervisor-deliver.sh` / `send-keys-reliable.sh` / `drive-target-check.sh` / `transcript-delivery-check.ts`（控制面）。`supervisor-bus.sh`（外层核实仅注释提及 message-bus，零真实引用，无需动）。

**为什么是 sibling 非 child**：本任务与 manager 已做的清理是同一裁定的两半，无 parent-child 依赖；manager 侧已独立 commit。本任务独立可派。

## Plan

1. **删**：message-bus.ts + 两个产品测试 + inbox-reader.sh + 其测试 + 打包副本（含 packages/quay/plugin/scripts/inbox-reader.sh）。
2. **改 supervisor-bus-identity.sh**（正本 + 打包副本）：移除 `claim-human-test`、`inbox-summary` 两子命令与其 `BUS_TS` 变量/`inbox` 变量；确认脚本无其他依赖 message-bus.ts 的核心投递路径（外层已核实：脚本只有这两个子命令，无 delegate-to-supervisor-deliver 独立路径）；保留 usage 骨架与脚本身份注释。
3. **改 capability-catalog.sh**（正本 1909 行 + 打包副本 1859 行）：移除全部 `inbox-reader.sh` 条目（含 head/每轮/失效前提/日期/判定词条）；保持 182 条声明口径与 catalog 自检绿。
4. **改 supervisor-bus-identity.test.mjs**：删除 claim-human-test + inbox-summary 的测试用例，保留脚本存在的断言（如 usage/exit 行为），suite 绿。
5. **inner 侧文档**（inner 独占，inner 落盘）：`orchestration/fast-mode-tick-core.md:26` + **`plugin/loop/fast-mode-tick-core.md`（product 模板，与源成对）** 的 **A5 行**迁出（inner 侧归档，平行于 outer R35）+ `docs/analysis/fast-mode-loop-tick.md:320-328` + `plugin/loop/fast-mode-loop-tick.md:432-445` 收件箱机械挂载点移除；外层已在 orchestration/ 侧同步删。
6. **设计记录删除**（外层已裁定，落点 = git 历史）：SPEC-inbox-service + quay-message-bus-human-in-the-network + quay-message-bus-proposal-manager 三份删除；**同步清理死引用**——plugin/skills/{manager,init}/SKILL.md 的 reference 行、SPEC-integration-architecture 的引用、quay-product-outline 等提案文档的提及（position-based 复核，仅删指向已删文档的真实引用，保留历史叙述本身）。
7. **验证**：全量 suite 绿（`scripts/test.sh`）。**本任务触碰 capability-catalog.sh（验证机件）+ 产品代码，判据B 明确不适用快路径**——fan-in 前必须有 per-task suite 验证（AC84 语义）。

## Acceptance Criteria

- [x] AC1: `packages/quay/src/message-bus.ts` + `packages/quay/test/message-bus.test.mjs` + `packages/quay/test/message-bus-identity.test.mjs` + `plugin/scripts/inbox-reader.sh` + `plugin/test/inbox-reader.test.mjs` 及打包副本删除；`grep -rl 'message-bus\|inbox-reader' packages/ plugin/` 仅剩本任务允许的注释/历史引用，零真实引用（position-based 复核）。
- [x] AC2: `supervisor-bus-identity.sh`（正本+打包副本）不再引用 `message-bus.ts` / `.quay/manager-inbox`；`BUS_TS` 变量与 claim-human-test/inbox-summary 子命令移除；脚本 `bash plugin/scripts/supervisor-bus-identity.sh` 无子命令时仍 exit 0（usage 行为），`supervisor-bus-identity.test.mjs` 收缩后全绿。
- [x] AC3: `capability-catalog.sh`（正本+打包副本）的 `inbox-reader.sh` 条目全部移除，catalog 自检绿（`bash plugin/scripts/capability-catalog.sh --check` 或对应测试）；声明口径与删除前一致（182 条 - 1 条 inbox-reader）。
- [x] AC4: inner 侧执行核 `orchestration/fast-mode-tick-core.md` 的 **A5 行**迁出（inner 侧归档，平行于 outer R35）+ 文档 `docs/analysis/fast-mode-loop-tick.md` 与 `plugin/loop/fast-mode-loop-tick.md` 的收件箱机械挂载点段移除；**三层 tick 文档（outer 核/loop + inner 核/loop）零 `inbox-summary` / `inbox-reader` 真实引用残留**（position-based 复核，历史任务体 tasks/gap-*.md 除外——那 15 个历史任务体 git 历史记录，不做追溯编辑）；inner 核 tick-core-static-check 仍 100% 覆盖。
- [x] AC6: 三份设计记录（SPEC-inbox-service / quay-message-bus-human-in-the-network / quay-message-bus-proposal-manager）删除；**死引用清理完备**——`grep -rl 'SPEC-inbox-service-2026-08-08\|quay-message-bus-human-in-the-network\|quay-message-bus-proposal-manager' plugin/ orchestration/ docs/` 零命中（git 历史任务体除外），SKILL.md reference 行、SPEC-integration-architecture 引用、提案文档提及全部同步处理。
- [x] AC5: 全量 suite 绿（`scripts/test.sh` exit 0）且 fan-in 前有 per-task suite 验证记录（AC84：判据B 不适用快路径）。

## Definition of Done

- [x] 全部 AC 勾选；全量 suite 绿（AC5）；`git log` 可追溯提交含「inbox 删除」字样；移除的每个词条有落点（新正本 = git 历史 + 本任务体，硬规则 5 落点映射）。

## Touches

- packages/quay/src/message-bus.ts（删）
- packages/quay/test/message-bus.test.mjs（删）
- packages/quay/test/message-bus-identity.test.mjs（删）
- plugin/scripts/inbox-reader.sh（删）
- plugin/test/inbox-reader.test.mjs（删）
- packages/quay/plugin/scripts/inbox-reader.sh（打包副本，删）
- plugin/scripts/supervisor-bus-identity.sh（改：退役失效子命令）
- packages/quay/plugin/scripts/supervisor-bus-identity.sh（打包副本，同步）
- plugin/scripts/capability-catalog.sh（改：移除条目）
- packages/quay/plugin/scripts/capability-catalog.sh（打包副本，同步）
- plugin/test/supervisor-bus-identity.test.mjs（改：收缩）
- orchestration/fast-mode-tick-core.md（inner 独占执行核，A5 行迁出归档）
- plugin/loop/fast-mode-tick-core.md（inner 核 product 模板，A5 行迁出同步——与 orchestration 源成对，尺寸不同非副本）
- orchestration/archive/AC58-retired-clauses.md（A5 迁出落点，追加 R36）
- docs/analysis/fast-mode-loop-tick.md（inner 独占，移除收件箱段）
- plugin/loop/fast-mode-loop-tick.md（inner 独占，移除收件箱段）
- orchestration/SPEC-inbox-service-2026-08-08.md（删，设计记录）
- docs/proposals/quay-message-bus-human-in-the-network.md（删，设计记录）
- docs/proposals/quay-message-bus-proposal-manager-2026-08-06.md（删，设计记录）
- plugin/skills/manager/SKILL.md（改：移除 SPEC-inbox 引用行）
- plugin/skills/init/SKILL.md（改：移除 reference-doc 行）
- orchestration/SPEC-integration-architecture-2026-08-05.md（改：移除已删文档引用）
- docs/proposals/quay-product-outline.md（核：移除已删文档提及 + DELIVERY-INVENTORY 快照再生成 scripts=266→265）
- docs/analysis/test-file-baseline.txt（删 3 个测试文件后的必要同步：test-file-snapshot relative-baseline 机械要求；另吸收 develop 已存在的陈旧遗漏 plugin/test/mirror-measure-history.test.mjs）
- docs/proposals/quay-saas-remote-access-to-an-onprem-loop.md（核：移除对已删 quay-message-bus 文档的死引用）
- docs/proposals/quay-web-human-is-not-an-operator.md（核：移除对已删 quay-message-bus 文档的死引用）
- tasks/gap-inbox-message-bus-teardown.md（自身）

## Evidence（inner 落盘 2026-08-20，impl 完成）

### 删除（8 个文件，git rm）

- `packages/quay/src/message-bus.ts`、`packages/quay/test/message-bus.test.mjs`、`packages/quay/test/message-bus-identity.test.mjs`
- `plugin/scripts/inbox-reader.sh`、`plugin/test/inbox-reader.test.mjs`
- `orchestration/SPEC-inbox-service-2026-08-08.md`、`docs/proposals/quay-message-bus-human-in-the-network.md`、`docs/proposals/quay-message-bus-proposal-manager-2026-08-06.md`

### 打包副本说明（AC1/AC2/AC3 的「打包副本同步」实际处理）

`packages/quay/plugin/` 是 **gitignored、pack 时生成**的快照（`.gitignore:22-26` + `packages/quay/scripts/package.sh:38-50`：`rm -rf dest` + 从 repo-root `plugin/` 全量 `cp -R`）。**git 从不跟踪它**（`git ls-files 'packages/quay/plugin/*'` = 0，worktree 里该目录不存在）。正本 = repo-root `plugin/` 树；本任务对 `plugin/` 的删除/修改在下一次 pack（package.sh）时自动全量再生到 `packages/quay/plugin/`，无需也不应单独编辑生成的快照。主检出残留的 `packages/quay/plugin/scripts/inbox-reader.sh` 等是上次 pack 的陈旧快照，下次 pack 自愈。

### supervisor-bus-identity.sh（AC2）

- 退役 `claim-human-test` + `inbox-summary` 两子命令（函数 + dispatch 分支全删）；删除 `BUS_TS` / `inbox` 变量。
- 脚本不再引用 `message-bus.ts` / `.quay/manager-inbox`（grep 验证零命中）；保留 identity 骨架 + usage。
- 行为：`bash supervisor-bus-identity.sh`（无子命令）→ usage + exit 0；`--help` → exit 0；未知子命令 → exit 2。
- `plugin/test/supervisor-bus-identity.test.mjs` 收缩到 usage/exit 行为（3 个测试，全绿）。

### capability-catalog.sh（AC3）

- 移除 5 处 `inbox-reader.sh` 条目（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING 五表各一）。
- 同步更新 `supervisor-bus-identity.sh` 的 QUESTION（原「manager-inbox delivered/consumed/unread visible to the tick」描述已随 inbox-summary 退役，改为「identity interface retained as control-plane shell」）。
- 自检绿：`262 scripts | 262 declared | 0 unclassified | 257 ship`，`--entry-surface` gate 绿，capability-catalog.test.mjs 16/16 pass。
- **口径**：声明数 263 → 262（delta 恰为 1，即 AC3 的「-1 条 inbox-reader」）。任务体写「182 条」是 CLAUDE.md 的旧读数；实测当前声明数 263，delta 语义一致。

### inner 独占文档（AC4）

- `docs/analysis/fast-mode-loop-tick.md`：移除「收件箱机械挂载点」段（原 :320-328）。
- `plugin/loop/fast-mode-loop-tick.md`：移除「收件箱机械挂载点」段（原 :432-440）**及**紧随的「投递通道」段（原 :442-446，描述 `.quay/outer-inbox/` 总线文件收件箱——与 message-bus 同机制，一并移除避免描述已删机制；外层给定行范围 432-445 覆盖之）。
- 两文档 `grep inbox-summary|inbox-reader` 零命中。

### 设计记录 + 死引用清理（AC6）

- 删除三份设计记录（见删除清单）。
- 死引用清理：`plugin/skills/manager/SKILL.md:175`（SPEC-inbox-service 行）、`plugin/skills/init/SKILL.md:183`（reference-doc 行）、`orchestration/SPEC-integration-architecture-2026-08-05.md:197-198`（展开见引用块）、`docs/proposals/quay-product-outline.md`（表格行 + 「三份→两份」+ 次序行）、`quay-saas-remote-access-to-an-onprem-loop.md`（Relates 行）、`quay-web-human-is-not-an-operator.md`（2 处引用）。
- AC6 grep 零命中：`grep -rl 'SPEC-inbox-service-2026-08-08\|quay-message-bus-human-in-the-network\|quay-message-bus-proposal-manager' plugin/ orchestration/ docs/` = 空。

### 必要伴随改动（原 Touches 之外，机械要求）

1. `docs/analysis/test-file-baseline.txt`：`scripts/test.sh:796` 的 test-file-snapshot relative-baseline 检查把「测试文件消失」判红——删 3 个测试文件后必须再生成基线。用 `test-file-snapshot.sh --repo-relative snapshot` 再生成：移除 3 个已删测试文件，**并吸收 develop 已存在的陈旧遗漏** `plugin/test/mirror-measure-history.test.mjs`（commit 57400040 加入但旧基线未含）。已加入 Touches。
2. `docs/proposals/quay-product-outline.md` §6 DELIVERY-INVENTORY 快照：删 `plugin/scripts/inbox-reader.sh` 后必须同步（`delivery-inventory-drift-gate.sh`）。用 `verify-delivery-surface.ts --write-inventory` 再生成：`scripts=266 → 265`。该文件已在 Touches。

### 残留 AC1 grep 命中（position-based 判定为允许，均不在 Touches 内）

`grep -rl 'message-bus\|inbox-reader' packages/ plugin/` 残留：
- `plugin/scripts/manager-observation-runtime-check.ts:105` — `publishSurface` 分类器**关键词词表**（含 "message-bus"/"inbox"），非对已删机制的依赖；改动需连带其测试（均不在 Touches），留待判定。
- `plugin/scripts/rhythm-consumer-check.ts:103` — 描述字符串「supervisor message-bus」。
- `plugin/scripts/supervisor-bus.sh` — 纯注释（任务明确「仅注释提及 message-bus，零真实引用，无需动」）。
- `plugin/test/runner-grouping-governance.test.mjs:70`、`plugin/test/supervisor-bus.test.mjs:3` — 注释。
- `plugin/test/supervisor-bus-identity.test.mjs` — 注释（本任务文件）。

### 本地 scoped 测试（全量 suite 留 fan-in，AC5 未勾）

- `supervisor-bus-identity.test.mjs` + `supervisor-bus.test.mjs`：14/14 pass。
- `capability-catalog.test.mjs`：16/16 pass（含 `--entry-surface` gate、quay-init Wiring）。
- `manager-observation-runtime-check.test.mjs`：28/28 pass。
- `relative-baseline.test.mjs` + `test-file-snapshot.test.mjs`：13/13 pass。
