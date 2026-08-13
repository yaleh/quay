---
id: gap-loop-shipping-ac1b-main-excludes-quay-and-outer-doc-split
title: loop-shipping AC1b 在 main 确定性红 — walkCorpus 未排除 .quay/ +
  outer-doc-split.test.mjs 未入表
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Finding

`plugin/test/loop-shipping.test.mjs` **AC1b**（无旧路径活引用）在 **main checkout** 确定性红（手动实测 9 个命中文件），连续多轮被套件报红或 kill-on-red 截断。

## 实测（2026-08-12 08:05，main checkout 手动 `node --test --test-name-pattern=AC1b`）

9 个命中文件：
- `.quay/fan-in-preserve/`（5 个）：崩溃前残留的 fan-in 中间态文件
- `.quay/manager-inbox/`（3 个）：manager 运行时消息（含 outer-recovery-ack）
- `plugin/test/outer-doc-split.test.mjs`：AC38 引入（1145a4d6），引用旧路径 `orchestration/orchestrator-loop-tick.md`

根因（与 manager 074500 判断一致）：
1. **walkCorpus 不排除 `.quay/`**（`loop-shipping-exclusion-data.mjs`：fs 遍历不 respect gitignore，排除表无 `.quay/`）——运行时文件被当活引用
2. **`outer-doc-split.test.mjs` 未入排除表**——AC38 切分测试自身引用旧路径，是 target-layout 一致性检查类，应入表（同 `quay-init-loop-consumer-doc-refs.test.mjs` 一类）

**注意**：workflow 用 verify worktree 跑套件时 worktree 无 .quay 文件所以 AC1b 过——但 **main 上仍红**。此修复必须在 main 的排除表落地。

## 修复方向（outer 裁定 → inner 实现）

`plugin/scripts/loop-shipping-exclusion-data.mjs` 的 `exclusionEntries()` 加：
1. `.quay/`（运行时目录：manager-inbox / fan-in-preserve / full-suite-state 等，gitignored 但 fs 遍历不 respect）
2. `plugin/test/outer-doc-split.test.mjs`（target-layout 一致性检查，引用旧路径是检查对象非活引用）

**这是修改验证机件**（loop-shipping 测试数据），fan-in 前需一轮覆盖该改动的绿。

## AC

- [x] 复现固化——任务体记录 9 个命中文件两类（.quay 运行时 + outer-doc-split 未入表）
- [x] `.quay/` 加入 exclusionEntries（目录级，跳过整个子树）
- [x] `outer-doc-split.test.mjs` 加入 exclusionEntries（target-layout 类，同 quay-init-loop-consumer-doc-refs 先例）
- [x] 修后 main checkout `node --test --test-name-pattern=AC1b loop-shipping.test.mjs` 绿（✔ pass 1 / fail 0）
- [x] 既有 loop-shipping 测试不回归（15/15 绿 + necessity-check 3/3 绿）

## DoD

- [ ] 修后全量套件 AC1b 不再红（外层 verification-round 验证）
- [ ] 全量套件绿（fail 0 且 cancelled 0）（外层 verification-round 验证）

## Evidence（inner 2026-08-12）

**commit**：`loop-shipping-exclusion-data.mjs` exclusionEntries() 数组尾加两条：
- `{ rel: '.quay', target: path.join(repoRoot, '.quay'), reason: "runtime directory ... fs traversal does NOT respect gitignore ... (gap-loop-shipping-ac1b-main-excludes-quay-and-outer-doc-split)" }` — 目录级，同 tick-log/manager-pending 运行时账本条目一类
- `{ rel: 'plugin/test/outer-doc-split.test.mjs', target: path.join(pluginDir, 'test', 'outer-doc-split.test.mjs'), reason: "asserts the AC38 doc-split target layout ... the check exists to police the old paths, so the scan must not flag the check itself as the reference" }` — 同 quay-init-loop-consumer-doc-refs / install-config-driven-e2e 类

**验证读数**：
1. `node --test --test-name-pattern=AC1b plugin/test/loop-shipping.test.mjs`：**✔ pass 1 / fail 0**（修复前 ✖ 9 命中）
2. `loop-shipping.test.mjs` 全量：**15/15 绿**
3. `loop-shipping-necessity-check.test.mjs`：**3/3 绿**（新条目通过 inert-entry 检测——.quay/ 与 outer-doc-split 均有实际命中，非冗余）

## Touches

- orchestration/orchestrator-loop-tick.md
- plugin/scripts/loop-shipping-exclusion-data.mjs
- plugin/test/loop-shipping.test.mjs
- plugin/test/outer-doc-split.test.mjs
- plugin/test/loop-shipping-necessity-check.test.mjs
- tasks/gap-loop-shipping-ac1b-main-excludes-quay-and-outer-doc-split.md（自身）