---
id: gap-test-coverage-check-parses-stale-files-variable
status: todo
labels: []
parent: null
children: []
extra: {}
---
---
id: gap-test-coverage-check-parses-stale-files-variable
title: "test-coverage-check.ts parses files=(...) but test.sh renamed it to glob=(...) — CI check silently broken"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`scripts/test-coverage-check.ts`（M174/DIR-110 交付物，被 `.github/workflows/ci.yml:34-35` 接线：
`node --experimental-strip-types scripts/test-coverage-check.ts --selftest` 和 `... test-coverage-check.ts`；
`adr/ADR-019` 的 enforcement 也引用它）解析 `scripts/test.sh` 的 `files=(...)` 行来取得 canonical glob：

```ts
// scripts/test-coverage-check.ts:63-68
/** Parse the space-separated glob patterns out of `scripts/test.sh`'s `files=(...)` line. */
function parseCanonicalGlobs(repoRoot: string): string[] {
  ...
  const m = src.match(/files=\(([^)]*)\)/);
  if (!m) return [];
  ...
```

但 `scripts/test.sh` 早已把该变量改名为 `glob=`（layer-grouping，第 125 行）：

```bash
local glob=(packages/*/test/*.test.mjs plugin/test/*.test.mjs experiments/quay-perpetual-stream/test/*.test.mjs)
```

**正则 `files=\(([^)]*)\)` 匹配不到 `glob=(...)` → `parseCanonicalGlobs` 返回空数组。** 该检查的
「canonical glob 单一来源（ADR-004）」前提被静默破坏。

### 证据

1. **引用**：`.github/workflows/ci.yml:34-35`（`--selftest` + 常规模式）、`adr/ADR-019` enforcement、
   `scripts/test-coverage-check.ts` 头注释（第 9 行「PARSED from scripts/test.sh's own files=(...) line」）。
   **它不是孤儿脚本**——有 CI 接线，但解析器失效。
2. **解析 vs 现状不匹配**：正则 `/files=\(([^)]*)\)/` 对 `local glob=(...)` 无匹配。
3. **影响**：`--selftest` 或常规模式可能误判「无文件可达」（空 glob → 所有 product/plugin-tier 测试
   都「不可达」→ 误报红），或 selftest 红。外层/policy 子代理观察其 selftest 红，但最初误判为「孤儿脚本」。
   **真实缺陷是解析器与 test.sh 结构漂移**（ADR-004 单一来源原则的具体失效）。

## Chosen mechanism

1. **修解析器**：`parseCanonicalGlobs` 同时匹配 `files=(...)` 与 `glob=(...)`（或改为从 test.sh 的函数
   提取 glob 行，避免硬编码变量名）。
2. **自检**：`--selftest` 必须验证「解析出的 glob 非空」——空 glob 是解析失败信号，应 fail-loud
   而非静默返回空数组。
3. **接回 CI 验证**：修复后 CI 的 `test-coverage-check.ts` 步骤应绿。

## Acceptance Criteria

- [ ] AC1: `parseCanonicalGlobs` 能解析当前 test.sh 的 `glob=(...)` 行（且仍兼容旧 `files=`）
- [ ] AC2: 解析出非空 glob（空 = fail-loud，不是静默成功）
- [ ] AC3: `node --experimental-strip-types scripts/test-coverage-check.ts --selftest` 绿
- [ ] AC4: `node --experimental-strip-types scripts/test-coverage-check.ts` 常规模式绿（不再误报全文件不可达）
- [ ] AC5: 与 `scripts/test.sh` 默认 glob 的实际文件集一致（ADR-004 单一来源保持）
- [ ] AC6: 测试带 `// @test-group engine` 声明（若产出脚本/测试）

## Definition of Done

- [ ] AC3/AC4 的实测输出贴进任务体
- [ ] 明确记录：**解析器与它声称的单一来源漂移，会让检查静默失效**——ADR-004 的执行机制本身
      需要自检（空 glob fail-loud）
- [ ] 记录这次最初被误判为「孤儿脚本」的经过：实际有 CI 接线，是解析失效

## Touches

- scripts/test-coverage-check.ts
- .github/workflows/ci.yml（若需调整接线）
