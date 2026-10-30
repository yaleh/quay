---
id: gap-codex-stage1-ship-decision-reachability
title: codex-stage1 spawn-verify/selfcheck ship
  决策成文：shipped-shell-reachability.ts 记录 dev-tree-only 边界 + 产物一致性测试
status: done
labels:
  - gap
  - codex
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-933
---
## Proposal

AC-933 判据逐字（`goals/AC-933-*.md` 的 criterion）：

```sh
if ! grep -q "codex-stage1" plugin/scripts/shipped-shell-reachability.ts; then echo "FAIL: shipped-shell-reachability.ts has no codex-stage1 ship decision entry" >&2; exit 1; fi
```

现状（2026-10-30 实测）：`shipped-shell-reachability.ts` 全文无 `codex-stage1`，criterion exit 1。派生读数把 `scripts/codex-stage1-spawn-verify.sh` 与 `scripts/codex-stage1-selfcheck.sh` 判为 `unreachable`，理由只是默认的「no executing reference from any root (无引用)」——这是【偶然未引用】，不是【裁定 dev-tree-only】。差在：将来任何 skill fenced 块 / workflow / core 源一旦在命令位引用其中一条，派生就会把它翻成 `reachable` 并 ship，静默推翻决策（硬规则 4b：代理量会偏离实际，优先直接量——这里"未引用"恰好与"裁定不 ship"同形，必须分开）。

决策本身已单源存在：`plugin/scripts/capability-catalog-declarations.json` 的 `NOT_SHIPPED` 已把这两条声明为 `ships:false`（理由「exp5 legacy — DIR-121 Codex-adoption … motivated only by this repo's history」），GOAL-913 origin 亦写明「spawn-verify 被 prune」。本任务把同一决策成文进 reachability 文件的 declared-exception 面 `UNSHIPPED_BY_DECISION`——加两条 key（`scripts/codex-stage1-spawn-verify.sh`、`scripts/codex-stage1-selfcheck.sh`），每条 reason 引用 dev-tree-only + catalog `ships:false` + GOAL-913，使 reachability 派生把这两条当作【裁定 dev-tree-only】而非【恰好没引用】，并钉住未来被 root 引用也不 ship（`add()` 已按 `unshipped[rel]` 剔除）。

⛔ 诚实性约束（硬规则 4b / 3b）：`UNSHIPPED_BY_DECISION` 现有三条是被 root 真正引用后按决策剔除的（reason 前缀「REACHED by a root, but unshipped by decision」属实）；codex-stage1 这两条当前**无** root 引用，直接加进去会让 `unreachableReasons` 谎称「REACHED by a root」。实现者须把 `unreachableReasons` 的文案分两态：真正被 root 引用后剔除（`droppedByDecision.has(rel)`）才用「REACHED by a root …」；声明了但当前未引用则用不谎称被引用的 dev-tree-only 文案。

与 sibling AC 是不同机制、独立验收：`gap-codex-plugin-publish-surface-plugin-json-mcp-dist`（AC-931 建 `.codex-plugin/plugin.json` 发布面）、`gap-quay-init-codex-host-trio-laydown`（AC-932 quay init 落三件套）各有任务；本任务只闭合 AC-933 的「ship 决策成文 + shipped 产物一致」。

Merge-candidate：`task-granularity-advice.ts --touches plugin/scripts/shipped-shell-reachability.ts --touches plugin/test/shipped-shell-reachability.test.mjs` 返回 `peers: []`（无 open 任务共触这两文件），不合并。

## Acceptance Criteria

- [x] AC1 正向判据绿：在真实文件上逐字复跑 AC-933 criterion（grep codex-stage1）⇒ exit 0；贴 `echo $?` 与 stderr（应为空）。
- [x] AC2 决策按机制成文（按位置，非注释/字符串巧合）：`node --experimental-strip-types --input-type=module -e 'import { UNSHIPPED_BY_DECISION } from "./plugin/scripts/shipped-shell-reachability.ts"; const k = Object.keys(UNSHIPPED_BY_DECISION).filter(x => x.includes("codex-stage1")).sort(); console.log(JSON.stringify(k)); for (const key of k) console.log(key, "=>", UNSHIPPED_BY_DECISION[key]); if (k.length !== 2 || !k.includes("scripts/codex-stage1-selfcheck.sh") || !k.includes("scripts/codex-stage1-spawn-verify.sh")) process.exit(1);'` ⇒ exit 0 且输出恰为这两条 key + 非空 reason（reason 引用 dev-tree-only + catalog `ships:false`，贴原文）。
- [x] AC3 派生读数诚实：`node --experimental-strip-types plugin/scripts/shipped-shell-reachability.ts --json` ⇒ `evaluated:true`、`reachable` 不含这两条、`unreachable` 含这两条；`unreachableReasons` 里这两条的文案不以「REACHED by a root」开头（它们当前无 root 引用；贴两条 reason 原文与 `grep -c 'REACHED by a root'` 计数）。
- [x] AC4 反向—删决策条目（能取假）：在临时副本删掉这两条 codex-stage1 决策条目，逐字运行 criterion shell（criterion 取 `quay goal show AC-933 --json` 的 `.criterion` 字段，⛔ 不重写一份判据）⇒ exit 非 0 且 stderr 含 `no codex-stage1 ship decision entry`。
- [x] AC5 产物一致（build 后校验）：扩展 `plugin/test/shipped-shell-reachability.test.mjs` 的真实产物控制——用真实 `publish-dist-branch.sh` 组出的 artifact 不含 `scripts/codex-stage1-spawn-verify.sh` 与 `scripts/codex-stage1-selfcheck.sh`（断言在【读 artifact 的 walk】上，⛔ 不在布尔回显上）。
- [x] AC6 范围门绿：`bash scripts/test.sh --for-task gap-codex-stage1-ship-decision-reachability --allow-thin` 绿；全量 suite 留给 fan-in 机械阶段。

## Definition of Done

`shipped-shell-reachability.ts` 在 `UNSHIPPED_BY_DECISION` 成文记录 codex-stage1 spawn-verify/selfcheck 的 dev-tree-only ship 决策（两条 key + 各自 reason），AC-933 criterion 在真实文件上 exit 0；真实组装产物不含这两条 `.sh`；删掉决策条目后 criterion exit 非 0（能取假）；`--for-task` 范围门绿。

## ADR-007 dark-axis record

该轴仍暗,理由:gap 型小改动只向 UNSHIPPED_BY_DECISION 增两条 codex-stage1 决策条目并修 unreachableReasons 文案,无包/依赖结构变化,L_D/L_G 无可测结构量

## Touches

- plugin/scripts/shipped-shell-reachability.ts
- plugin/test/shipped-shell-reachability.test.mjs
- tasks/gap-codex-stage1-ship-decision-reachability.md