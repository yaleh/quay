---
id: gap-upgrade-channel-cant-sync-build-artifacts-dist-stale
title: "upgrade channel syncs source but not build artifacts — git pull gets new
  src + stale dist (B machine: dist 13:34 built, fix 15:10 merged, ENOENT
  persists; verify checks existence not freshness); 2nd upgrade-channel-gap form
  (dynamic drift); fix: ensure_vendor_runtime rebuilds/fails-closed when src
  mtime > dist mtime"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**升级通道能同步源码但同步不了构建产物——dist 陈旧混合态（管理者 B 机实测 + 外层独立验证）**：

**实测（B 机，走正当升级通道 git pull）**：AC12b #3 修复（mcp_entry 迁移 + verify OK）后，node
vendor/quay/dist/quay.js task list 仍报 ENOENT vendor/quay/package.json。查因：B 机 dist 产物是 13:34
构建的，dist-runtime 修复 15:10 才合并——git pull 拉到新源码，但**没有任何机制重新构建 dist**。dist 里
readFileSync 22 次（旧 bundle）。⇒ **源码能传下去，产物不能自动跟随**。

**为什么重要——「升级通道」缺失的第二种形态**：
- 第一种（已报）：目标项目装完冻结在安装那一刻（静态漂移）
- 第二种（本条）：**升级通道能同步源码，但同步不了需要构建才能产生的东西**（动态漂移）——quay 核心
  运行时恰是构建产物。采用者 git pull 得到「源码新、运行时旧」混合态，quay-init verify 只查文件存在
  不查与当前源码一致——**判据量化「存在」不量化「新鲜度」**。

**修法方向（管理者 + 外层裁定）**：quay-init 在检测到源码比 dist 新时**自动重建或 fail-closed**。
ensure_vendor_runtime 已会跑 sync-vendor.sh，缺的是「什么时候该重跑」判据——现在只在 dist 缺失时跑，
不在 dist 陈旧时跑。**判据机械**：比较 packages/*/src 最新 mtime 与 vendor/*/dist/*.js mtime。

**「生命体」视角**：遗传物质分两类——可直接复制的（源码）和需要发育才能表达的（构建产物）。当前繁殖
机制只传第一类，第二类靠子代自己发育，但没有任何机制告诉子代「你该重新发育了」。

### 选定机制

1. ensure_vendor_runtime 增加**陈旧检测**：packages/*/src 最新 mtime > vendor/*/dist/*.js mtime ⇒ 自动重建（sync-vendor）或 fail-closed
2. verify 增加**新鲜度检查**：不只查文件存在，查与当前源码一致（mtime 或 hash 比较）
3. 验证：src 更新 + git pull（不重建 dist）⇒ quay-init 检测陈旧并重建/fail-closed

## Acceptance Criteria

- [ ] AC1: ensure_vendor_runtime 检测 dist 陈旧（src mtime > dist mtime）⇒ 自动重建或 fail-closed（负控制：当前只在缺失时跑，陈旧不跑）
- [ ] AC2: verify 增加新鲜度检查（文件存在 且 与当前源码一致）
- [ ] AC3: B 机场景复测：git pull 新源码（不重建 dist）⇒ quay-init 检测陈旧并处理
- [ ] AC4: 与 gap-vendor-runtime-not-in-git-clone-broken-mcp-entry + gap-delivery-surface-grows 交叉标注（升级通道两种形态）

## Touches

- plugin/scripts/quay-init.sh（ensure_vendor_runtime 陈旧检测 + verify 新鲜度）
- plugin/scripts/sync-vendor.sh（如涉及重建判据）
- plugin/test/quay-init-loop.test.mjs（AC1-AC3 测试）
- tasks/gap-vendor-runtime-not-in-git-clone-broken-mcp-entry.md（AC4 交叉标注）
- tasks/gap-delivery-surface-grows-but-target-freezes-no-upgrade.md（AC4 交叉标注）

## Contract

measure   dist_fresh = `[ plugin/vendor/quay/dist/quay.js -nt packages/quay/src/version.ts ] && echo 1 || echo 0` stdout 数字段
band      dist_fresh = 1（dist 不陈旧）
invoke    `grep -n 'ensure_vendor_runtime\|mtime\|stale' plugin/scripts/quay-init.sh`
control   src 更新后不重建 ⇒ dist 陈旧（AC1 负控制）；重建后 ⇒ 新鲜
resume    陈旧检测与 verify 新鲜度分步提交，任一步完成即写盘