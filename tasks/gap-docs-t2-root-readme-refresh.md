---
id: gap-docs-t2-root-readme-refresh
title: T2 根 README 刷新：版本字面量/usage 13 命令/配置两节/环境变量 10/端到端流程/断链
status: ready
labels:
  - gap
  - docs
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：manager 2026-08-21 01:0xZ 产品化交付文档审计（人明令检查 + 立案）。缺口 T2：根 README 刷新。外层已核实：README 有 3 处 `0.3.5` 字面量（:76 :128 :486），`:347` usage 行缺 13 个命令。

**六个子缺口（每条可机械取假）**：
1. 版本字面量 `0.3.5` × 3（:76 :128 :486）
2. usage 行少 13 个命令：`:347` 写 `usage: quay <task list|view|edit|check|action list|run|serve|mcp>`，真值见 `packages/quay/bin/quay.ts:206`（缺 init/task create/gate/gate-log/complete/adjudicate/promote/retreat/migrate/config validate/manager start|adopt）
3. **配置项两整节零文档**：README `:219` 自己承诺 `quay init` 生成 "all three sections (providers, gates, loop)" 但只写了 providers。`gates:` 6 类正本 `packages/quay/src/config-validate.ts:45`（`KNOWN_GATE_KEYS`）→ 文档 0/6；`loop:` 12+ 字段正本 `packages/quay/src/loop-params.ts:20-28,118-215` → 文档 0/12
4. **环境变量 15 个只文档化 5 个**，未覆盖 10 个，最要紧：`QUAY_NATIVE_ADR_DIR`（本仓库 .quay/config.yml 自己在用）、`QUAY_NATIVE_DOCS_DIR`、`QUAY_GITHUB_MAX_ISSUES`、`QUAY_GITHUB_MAX_BUFFER`
5. **无 todo→ready→done 端到端流程**：Usage 节（:335-460）4 个示例全只读零状态跃迁；`complete/adjudicate/promote/retreat` 在根 README 零出现
6. 断链 `:583` → `docs/proposals/quay-bootstrap-experiment.md` 不存在；`:513` 教 `node --test packages/*/test/*.test.mjs` 与 ADR-019（scripts/test.sh 唯一入口）矛盾

**为什么 inner 执行**：README 属产品文档（仓库交付面）→ inner 域。

## Plan

1. 版本字面量 0.3.5 → 0.6.0（:76 :128 :486）。
2. usage 行补全 13 个命令（对齐 quay.ts:206）。
3. 补 `gates:` 6 类 + `loop:` 12+ 字段两节文档（正本 config-validate.ts / loop-params.ts）。
4. 补 10 个未覆盖环境变量（含 QUAY_NATIVE_ADR_DIR 等 4 个最要紧）。
5. 加 todo→ready→done 端到端流程示例（含 complete/promote/retreat 状态跃迁）。
6. 修断链 :583 + :513 测试命令与 ADR-019 对齐。

## Acceptance Criteria

- [ ] AC1: `grep -c '0\.3\.5' README.md` = 0（版本字面量全清）。
- [ ] AC2: `:347` usage 行含全部命令（对齐 quay.ts:206 dispatch 表，diff 差 = 0）。
- [ ] AC3: `gates:` 6 类 + `loop:` 12+ 字段在 README 有文档（`grep 'gates:\|loop:' README.md` 命中 + 逐类核对）。
- [ ] AC4: 10 个未覆盖环境变量已补文档（`grep 'QUAY_NATIVE_ADR_DIR\|QUAY_GITHUB_MAX_ISSUES' README.md` 命中）。
- [ ] AC5: README 含 todo→ready→done 端到端流程（`grep -c 'promote\|retreat\|complete' README.md` 非零 + 流程示例存在）。
- [ ] AC6: 断链 :583 修复（链接目标存在）；:513 测试命令与 ADR-019 对齐（指向 scripts/test.sh）。
- [ ] AC7: 全量 suite 绿。

## Definition of Done

- [ ] 六子缺口全清（AC1-6 逐条可机械取假验证）；全量 suite 绿（AC7）。

## Touches

- README.md（刷新六子缺口）
- tasks/gap-docs-t2-root-readme-refresh.md（自身）
