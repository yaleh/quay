---
id: gap-ac160-runtime-usage-inventory-blind-spot
title: AC160 判据仍红：runtime-usage-inventory.ts 非注释位置枚举 subagents/workflows +
  新增命名回归测试（未修版本必红）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-160
---
## Proposal

**问题（立案当轮实测）**：`goals/AC-160-runtime-usage-inventory-blind-spot.md`（status=active、goal=GOAL-003）判据现为 fail——两条机械子检查全红：
① `grep -vE '^[[:space:]]*(//|\*)' plugin/scripts/runtime-usage-inventory.ts | grep -q 'subagents/workflows'` 无匹配（字面量 `subagents/workflows` 只出现在注释里，非注释位置 0 处）；
② `node --experimental-strip-types --test plugin/test/runtime-usage-inventory-workflows-enumeration.test.mjs` 失败（该命名测试文件不存在）。

**根因**：前序任务 `gap-runtime-usage-inventory-workflow-blind-spot`（done，commit 8fe700f7b）已用 `collectJsonlFiles` 递归把枚举**行为**修对（workflows 层实际被枚举到），但实现落在「盲递归」上——`subagents/workflows` 字面量从未出现在非注释代码里；且其 fixture 负控制加在了既有测试 `plugin/test/runtime-usage-inventory.test.mjs:288`，而非判据点名的 `runtime-usage-inventory-workflows-enumeration.test.mjs`。⇒ 行为对、判据形态不满足，goal-driver 仍判 fail。

**工作（只补判据一致性 + 命名回归测试，不重做枚举行为）**：① 让 `readTranscripts` 对 `<session>/subagents/workflows/<run>/agent-*.jsonl` 的枚举在非注释代码里显式点名（`subagents/workflows` 成为非注释字面量）；② 新增判据点名的命名回归测试，且该测试在未修版本上必红。

## Plan

1. **改源（判据①）**：在 `plugin/scripts/runtime-usage-inventory.ts` 引入非注释常量/显式枚举，使 `subagents/workflows` 作为连续字面量出现在非注释行（如 `const SUBAGENT_WORKFLOW_LAYER = "subagents/workflows"` 并在 `readTranscripts` 用它显式构造/遍历 workflows 层），同时保留直属 `<session>/subagents/agent-*.jsonl` 覆盖。改完先跑 `grep -vE '^[[:space:]]*(//|\*)' plugin/scripts/runtime-usage-inventory.ts | grep -q 'subagents/workflows'` 确认 exit 0。
2. **加命名回归测试（判据②）**：新建 `plugin/test/runtime-usage-inventory-workflows-enumeration.test.mjs`——hermetic fixture：构造合成 sessions 目录 `<sid>/subagents/workflows/<run>/agent-*.jsonl`，内含一条 `node plugin/scripts/<已知脚本>.ts` 的 Bash 命令，断言 `readTranscripts`（或 `buildInventory`）枚举到该层、对应脚本 `executed > 0`。
3. **验证**：逐字跑 AC-160 判据两条命令 → exit 0；单跑新测试 → pass；单跑既有 `plugin/test/runtime-usage-inventory.test.mjs` → 仍 pass（不回归）；跑 `scripts/test.sh` → 绿。

## AC

- [x] 判据① exit 0：`grep -vE '^[[:space:]]*(//|\*)' plugin/scripts/runtime-usage-inventory.ts | grep -q 'subagents/workflows'` —— 实测 exit 0；非注释命中行 `const SUBAGENT_WORKFLOW_LAYER = "subagents/workflows";`
- [x] 判据② exit 0：`node --experimental-strip-types --test plugin/test/runtime-usage-inventory-workflows-enumeration.test.mjs` —— 实测 exit 0（1 pass / 0 fail）
- [x] 未修版本必红（负控制）：把源里非注释的 `subagents/workflows` 枚举临时回退（仅读直属 `subagents/agent-*.jsonl`、不显式进 workflows 层）后，`node --experimental-strip-types --test plugin/test/runtime-usage-inventory-workflows-enumeration.test.mjs` 退出码非 0；恢复后同命令退出码 0，两次读数入任务体 —— 实测：回退后 exit 1（ERR_ASSERTION `actual: 0, expected: 1`），恢复后 exit 0
- [x] 不回归：`node --experimental-strip-types --test plugin/test/runtime-usage-inventory.test.mjs` exit 0 —— 实测 exit 0（22 pass / 1 skip）
- [x] 全量绿：`scripts/test.sh` exit 0 —— scoped 门 `scripts/test.sh --for-task gap-ac160-runtime-usage-inventory-blind-spot --allow-thin` 实测 exit 0（23 pass / 1 skip / 0 fail）；全量 suite 由 fan-in 步机械验证
- [x] `node plugin/scripts/task-schema-check.ts tasks/gap-ac160-runtime-usage-inventory-blind-spot.md` exit 0 —— 实测 exit 0

## DoD

AC-160 判据（逐字两条命令）整体 exit 0：`subagents/workflows` 在非注释位置可被 grep 命中 ∧ 命名回归测试 `runtime-usage-inventory-workflows-enumeration.test.mjs` 通过；且「未修版本必红」的负控制有落痕读数（回退后非 0、恢复后 0）。goal-driver 下一轮把 AC-160 的 verdict 由 fail 翻 pass（读 `.quay/goal-round.jsonl` 该 AC 的 verdict）。⛔ 只加测试不改源、或只在注释里点名、或测试在未修版本上不红 ⇒ 不算达成。

## Touches

- plugin/scripts/runtime-usage-inventory.ts
- plugin/test/runtime-usage-inventory-workflows-enumeration.test.mjs
- tasks/gap-ac160-runtime-usage-inventory-blind-spot.md