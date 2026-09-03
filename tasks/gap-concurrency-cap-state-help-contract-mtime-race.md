---
id: gap-concurrency-cap-state-help-contract-mtime-race
title: 修缺：concurrency-cap-state.json 的 --help 副作用 mtime race
status: ready
role: primitive
labels:
  - help-contract
  - mtime-race
  - hardcoded-file
  - cross-suite-violation
created: 2026-09-03T02:50Z
---

## Finding

**严重度**：🔴 blocks fan-in  
**发现者**：driver development progress (cross-session)  
**发现时刻**：挡住 gap-unified-frontmatter-parser fan-in 收敛

### 现象
`help-contract-incompatible-behaviors.test.mjs` 报告：
```
checkers with a --help side effect (.quay mtime changed)
concurrency-cap-state.json: 1788004193808 -> 1788410556739
```

某个 -check.ts 脚本的 `--help` 调用触发了 `concurrency-cap-state.json` 的写入，导致 mtime 变化。

### 根本原因
- 同族缺陷已在 `gap-suite-help-contract-mtime-race`（done）修过：session-liveness.*.json 的 mtime 变化
- **本实例**：concurrency-cap-state.json 是另一个被检查器脚本作为硬编码路径写入的文件
- 是**全局模式的新实例**（硬规则 5b），不是 gap-unified-frontmatter-parser 的本地缺陷

### 影响
- ⛔ 挡住 gap-unified-frontmatter-parser 的 fan-in 收敛（该任务 blocked）
- ⚠️ 可能还有其它类似文件受同样问题影响（需全局 grep）

---

## Plan

### Step 1：定位所有受影响的文件
运行 help-contract 检查器，识别所有有 --help 副作用的硬编码文件。

```bash
# 查 help-contract test 对哪些文件有怨言
node --test plugin/test/help-contract-incompatible-behaviors.test.mjs 2>&1 | \
  grep -oE '\.(json|txt|lock|cache).*->' | sort -u
```

### Step 2：溯源 concurrency-cap-state.json 的写入来源
找出哪个 -check.ts 脚本在 --help 时会写这个文件。

```bash
grep -r "concurrency-cap-state.json" plugin/scripts/*.ts | grep -v test | grep -v "\.test\."
```

### Step 3：修复该脚本
- 确保 --help 路径不执行生产代码（特别是不写状态文件）
- 参考 `gap-suite-help-contract-mtime-race` 的修法

### Step 4：验证
- 运行 help-contract test，确认 concurrency-cap-state.json 不再变化
- 解除对 gap-unified-frontmatter-parser 的 fan-in 阻塞

---

## Definition of Done

- [ ] concurrency-cap-state.json 的 --help 副作用消除
- [ ] help-contract test 无新的 mtime 变化报告
- [ ] gap-unified-frontmatter-parser fan-in 可以继续推进
- [ ] 全局扫描确认无其它同族硬编码文件被遗漏（补充 AC）

---

## Touches

- `plugin/scripts/concurrency-cap-state.ts` 或 caller（待定位）
- `plugin/test/help-contract-incompatible-behaviors.test.mjs`（可能需要文档更新）

---

## References

- **Blocking**: gap-unified-frontmatter-parser (fan-in suite red)
- **Same family**: gap-suite-help-contract-mtime-race (done, same pattern, session-liveness files)
- **Hardcoded files anti-pattern**: hardcoded-file 标签的所有任务

