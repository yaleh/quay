---
id: gap-task-check-test-nativeproviderdir-undefined
title: "task-check.test.mjs ReferenceError — line 82 `cwd: nativeProviderDir` uses an undefined variable: 98e23f5b (A-layer spawn conversion, 08:42) DELETED the `const nativeProviderDir` definition (line 31) while its commit message claims 'Pin nativeProviderDir to the SOURCE bin dir'; the usage at line 82 was left dangling → full-suite fails with 'ReferenceError: nativeProviderDir is not defined'; sibling files (unparseable-frontmatter/build-dist-smoke/serve-github) still define it, so the pattern is established; fix = restore the definition (path.join(__dirname,'..','..','quay-native','bin')) or derive from QUAY_NATIVE_CLI's dirname; introduced in integration, first surfaced in develop at 14:08 FF — a merge-exposed (not merge-introduced) real defect"
status: ready
labels:
  - gap
  - defect
extra:
  schema: v1
---
**type:** execution

## Proposal

**task-check.test.mjs 引用了未定义变量 `nativeProviderDir`。**

**【根因（外层核实，98e23f5b）】**：A-layer spawn conversion commit 声称「Pin nativeProviderDir to
the SOURCE bin dir」但实际 **删除了定义**（`const nativeProviderDir = path.join(...)` 从 line 31 删除），
line 82 的 `cwd: nativeProviderDir` 使用保留 → ReferenceError。这是 98e23f5b 的一个不完整改动
（删定义留使用），被 merge 从 integration 带入 develop（14:08 FF）后首次被全量 suite 暴露。

**【证据】**：`git show 98e23f5b -- packages/quay/test/task-check.test.mjs` 显示 `-const nativeProviderDir`
（1 deletion）；兄弟文件 unparseable-frontmatter.test.mjs:40 / build-dist-smoke.test.mjs:47 /
serve-github.test.mjs:64 都有定义。

### 选定机制

恢复定义或改为从 QUAY_NATIVE_CLI 派生：
- `const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");`
- 或 `const nativeProviderDir = path.dirname(QUAY_NATIVE_CLI);`（若 QUAY_NATIVE_CLI 指向 source bin）

## Acceptance Criteria

- [ ] AC1: task-check.test.mjs 隔离跑绿（`node --test packages/quay/test/task-check.test.mjs`，无 ReferenceError）
- [ ] AC2: 与 A-layer spawn conversion 的意图一致（nativeProviderDir 指向 source bin dir）
- [ ] AC3: 全量 suite 中 task-check 不再失败

## Definition of Done

- [ ] AC1-AC3 全勾（task-check.test.mjs 隔离绿无 ReferenceError；与 A-layer spawn conversion 意图一致；全量 suite 中 task-check 不再失败）
- [ ] nativeProviderDir 定义补回（98e23f5b 删定义留使用的回归修复）
- [ ] scoped 门 `scripts/test.sh --for-task gap-task-check-test-nativeproviderdir-undefined` 绿

## Touches

- packages/quay/test/task-check.test.mjs

## Contract

measure   task_check_green = `node --test packages/quay/test/task-check.test.mjs 2>&1 | grep -c '# pass'` stdout 数字段
band      task_check_green >= 1（隔离跑绿）
invoke    `grep -n 'nativeProviderDir\|nativeBin' packages/quay/test/task-check.test.mjs`
control   修前 ReferenceError（已复现）；修后隔离跑绿（AC1）
resume    修完先隔离跑 task-check，再进全量

## Dispatch review

reviewer: outer
at: 2026-08-06T14:4xZ
changed: 全量 suite 分诊确认的真实缺陷（merge 暴露非引入）——分别: nativeProviderDir 未定义(98e23f5b 删定义留使用)、plugin.json 重复 manager/SKILL.md、manager SKILL 缺 2 个 SPEC 索引。
