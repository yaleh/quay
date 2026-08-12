---
id: cand-gate-loader-unified-config-no-gates-spurious-diagnostics
title: 统一 config.yml 无 `gates:` 节时 gate loader 把顶层 providers/loop 误报为未知 gate 节
status: ready
labels:
  - gap
  - gate
---

## Finding

**结论**：`packages/quay/src/gate/config/loader.ts:184-199` 的 `parseGatesConfig` 对「有
`.quay/config.yml` 但没有 `gates:` 节」的工作区走 `else { gatesMap = doc.contents }` 分支——
把统一配置的**整个顶层**当作 legacy gates map 处理，随后 190-199 行的 fail-loud 扫描把
`providers` / `loop` 等顶层键报为 `[error] unrecognized gate section ...; section ignored`。
这些错误经 `emitDiagnostic` 写进诊断 sink（默认 stderr；`QUAY_GATE_DIAGNOSTICS` 指向文件时写文件），
并被 `listGatesVerbose` 的 `diagnostics` 暴露给调用方。

**实测**：对一个只有 `providers:` / `loop:`、无 `gates:` 节的统一 config.yml，
`quay config validate` 输出（来自 gate loader，非 validator 自身）：

```
[error] unrecognized gate section 'providers' — expected one of it0, adr, fixed, testPass, coverageFloor, redGreen; section ignored
[error] unrecognized gate section 'loop' — expected one of it0, adr, fixed, testPass, coverageFloor, redGreen; section ignored
```

**为什么重要**：`gates:` 节在统一格式下是可选的——一个只用内置 gate 的工作区合法地没有它。
当前实现把「config.yml 无 gates:」与「legacy gates.yml 顶层即 gates map」两种完全不同的文件
形态混为一谈：后者顶层键确应是 gate 节，前者顶层是 providers/loop。结果是合法配置产生幻影
error 诊断（污染 stderr / 诊断文件 / gate-list-verbose 输出），掩盖真实问题。本仓库自身的
config.yml 有 `gates:` 节，故未触发；任何迁移后删掉 gates: 的工作区会持续看到这两行。

## Acceptance Criteria

- [x] 复现：`loadWorkspaceGateMetadata(root)` 对一个只有 `providers:`/`loop:`、无 `gates:` 节的
  config.yml 产生含「unrecognized gate section 'providers'」的 `diagnostics`。
- [x] 修复后：无 `gates:` 节的统一 config.yml 不产生任何「unrecognized gate section」诊断
  （legacy `.quay/gates.yml` 的顶层-as-gates-map 行为不变）。
- [x] 修复后 `gate-config-loader.test.mjs` / `gate-diagnostics.test.mjs` 保持绿。

## Touches

- packages/quay/src/gate/config/loader.ts（`parseGatesConfig` 的 else-branch：应仅对 legacy
  gates.yml 源启用「顶层即 gates map」，对 config.yml 源无 gates: 时应返回空 config）
- packages/quay/test/gate-config-loader.test.mjs
- tasks/cand-gate-loader-unified-config-no-gates-spurious-diagnostics.md（自身：勾 AC + 贴证据）

## Evidence

**修复**：`packages/quay/src/gate/config/loader.ts` `parseGatesConfig` 的 else-branch 现在仅对
legacy `.quay/gates.yml` 源（`srcFile` basename 为 `gates.yml`）启用「顶层即 gates map」；
对 config.yml 源无 `gates:` 节时返回空 config，不再把 `providers`/`loop` 误报为未知 gate 节。

**修复前复现**（`loadWorkspaceGateMetadata` 对无 gates 节 config.yml，stderr）：
```
[error] unrecognized gate section 'providers' — expected one of it0, adr, fixed, testPass, coverageFloor, redGreen; section ignored
[error] unrecognized gate section 'loop' — expected one of it0, adr, fixed, testPass, coverageFloor, redGreen; section ignored
```

**修复后**：同输入 stderr 为空、diagnostics 数组为空、gates 为空；legacy gates.yml 顶层-as-gates-map
与 config.yml `gates:` 节内 fail-loud 行为均不变（新增 4 条回归测试于 `gate-config-loader.test.mjs`）。

**Scoped 验证**（worktree 根，`scripts/test.sh --for-task cand-gate-loader-unified-config-no-gates-spurious-diagnostics --allow-thin`，
thin 因 `loader.ts` 无 basename 配对测试文件，见下）：
```
ℹ tests 89  ℹ pass 89  ℹ fail 0  (exit 0)
```

**AC3 点名的两个测试文件显式跑**：
```
gate-config-loader.test.mjs : tests 11, pass 11, fail 0
gate-diagnostics.test.mjs   : tests 33, pass 33, fail 0
gate-list-verbose.test.mjs  : tests 10, pass 10, fail 0
```

**thin 说明**：selector 按 basename 配对解析 Touches，`loader.ts`（basename `loader`）无
`loader.test.mjs`，任务 `.md` 不解析为测试 → 1/3（0.33）< 0.5 → `test-selection-thin`；
变化已由 Touches 直接列出的 `gate-config-loader.test.mjs` 覆盖，故以 `--allow-thin` 跑 scoped gate。
