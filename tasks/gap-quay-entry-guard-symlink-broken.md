---
id: gap-quay-entry-guard-symlink-broken
title: quay 入口守卫符号链接拓扑恒假：npm install -g 后 quay 命令静默空输出（同族第 3 次，牵连 AC108）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：manager 2026-08-21 02:1xZ 实测（人指示在 orangevps/ad-arm1 user scope 安装验证）——**v0.6.0 npm 全局安装的 `quay` 命令完全不能用**，100% 可复现（本机临时 prefix 装同样复现）。

**缺陷**：`packages/quay/bin/quay.ts:244-250` 的 `isMain` 守卫在 ESM 分支比较 `import.meta.url === pathToFileURL(process.argv[1]).href`。npm 全局安装在 `bin/` 下建**符号链接**指向包内真实文件。Node 加载 ESM 时 `import.meta.url` 解析到符号链接**指向的真实文件路径**，而 `process.argv[1]` 保留用户实际执行的**符号链接路径本身**——两者字符串不等，守卫恒假，`run()` 从未调用（`quay --version` 空输出 EXIT=0）。

**实测**：
```
npm install -g quay-0.6.0.tgz   # 正常完成
quay --version                   # 空输出，EXIT=0（什么都没做）
node <安装路径>/dist/quay.js --version   # 正常输出 0.6.0
```

**⚠️ 同族缺陷第三次**（硬规则 5b）：SEA CJS 那次（gap-sea-verify-node-free-fails-050）补了 `require.main === module` 分支，但 **ESM 分支在符号链接拓扑下同样会假，当时没测到**。注释里明确记着 `import.meta` 在 CJS 束下被 esbuild 改写为空对象导致守卫恒假——只补了 CJS，ESM symlink 拓扑漏测。`quay-native` 不受影响（bin 入口无此守卫）。

**⛔ 牵连 AC108**：v0.6.0 已打 tag 发布，但其 npm 安装产物的标准使用方式（`npm install -g` + 跑 `quay`）对任何真实用户都是坏的。修复后需重新 build + 重装验证（manager 人裁定两台机安装验证由 manager 直接操作，不建任务）。

**为什么 inner 执行**：quay.ts 属产品代码 → inner 域。

## Plan

1. 修 `packages/quay/bin/quay.ts` 入口守卫 ESM 分支——比较 realpath 后路径（`fs.realpathSync(process.argv[1])` vs `fileURLToPath(import.meta.url)`），或改用 `import.meta.main`（版本底线支持则优先）。
2. **补通用负控制矩阵**（防再漏）：source ESM / npm-installed symlinked ESM / SEA CJS 三种调用拓扑至少各一条——不是每撞一次修一次。
3. 真实复现 repro 步骤作负控制（`npm install -g` 隔离 prefix → 符号链接调用 → 非空输出）。

## Acceptance Criteria

- [ ] AC1: `quay --version` 经 npm 全局安装（符号链接拓扑）非空输出 0.6.0（能取假：空输出 ⇒ 未修好）。
- [ ] AC2: 负控制矩阵——source ESM / npm-installed symlinked ESM / SEA CJS 三种调用拓扑各至少一条测试，入口守卫均成立（可机械验证）。
- [ ] AC3: 真实 repro 已复现为负控制（`npm install -g` 隔离 prefix → 符号链接调用 → 非空输出，读真实输出非 fixture）。
- [ ] AC4: 全量 suite 绿。

## Definition of Done

- [ ] 入口守卫符号链接拓扑修复；负控制矩阵覆盖三种拓扑（source ESM / symlinked ESM / SEA CJS）；真实 repro 验证通过（读真实输出）。

## Touches

- packages/quay/bin/quay.ts（入口守卫修复）
- packages/quay/test/（负控制矩阵测试）
- tasks/gap-quay-entry-guard-symlink-broken.md（自身）
