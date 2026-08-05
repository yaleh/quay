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

**升级通道能同步源码但同步不了构建产物——dist 陈旧混合态 + 两种安装路径都无新鲜度判据（管理者 B 机 + user-scope 双实测 + 外层独立验证）**：

**实测 1（B 机，git clone 路径）**：AC12b #3 修复后，node vendor/quay/dist/quay.js task list 仍报
ENOENT vendor/quay/package.json。B 机 dist 13:34 构建，修复 15:10 合并——git pull 拉到新源码但没重建
dist（gitignore 产物）。verify 只查文件存在不查新鲜度。

**实测 2（user-scope 路径，管理者 15:36）**：~/.local/share/quay-plugin/ 自带 vendor dist（1.3MB/
1.1MB，node 直接跑返回 0.3.13）——**绕过 git clone 路径全部构建问题**（产品主推荐安装路径通，正面
发现）。但 dist mtime 06:01（陈旧，dist-runtime 15:11 修复不在里面，readFileSync 21 vs A机 20）——
**user-scope 安装物陈旧，无机制告诉用户「你装的这份落后了」**。

**两条路径同根**：git clone 路径陈旧（动态漂移，源码同步产物不跟随）+ user-scope 路径陈旧（安装物
无新鲜度判据）——**都指向「安装物没有新鲜度判据」**。

**为什么重要——「升级通道」缺失的第二种形态**：升级通道能同步源码，但同步不了需要构建才能产生的东西
（quay 核心运行时恰是构建产物）。采用者拿到「源码新、运行时旧」混合态，verify 只查存在不查新鲜度。

**修法方向（管理者 + 外层裁定）**：quay-init 在检测到源码比 dist 新时自动重建或 fail-closed。
ensure_vendor_runtime 已会跑 sync-vendor.sh，缺「什么时候该重跑」判据（现在只在缺失时跑，不在陈旧时
跑）。判据机械：比较 packages/*/src 最新 mtime 与 vendor/*/dist/*.js mtime。**user-scope 安装物同样
需要新鲜度判据**（安装/启动时检查，落后则提示重建）。

### 选定机制

1. ensure_vendor_runtime 增加**陈旧检测**：packages/*/src 最新 mtime > vendor/*/dist/*.js mtime ⇒ 自动重建（sync-vendor）或 fail-closed
2. verify 增加**新鲜度检查**：不只查文件存在，查与当前源码一致（mtime 或 hash 比较）
3. **user-scope 安装物新鲜度**：安装/启动时检查 dist 是否落后（mtime 或版本），落后则提示重建
4. 验证：src 更新 + git pull（不重建 dist）⇒ quay-init 检测陈旧并重建/fail-closed；user-scope dist 落后 ⇒ 提示

## Acceptance Criteria

- [ ] AC1: ensure_vendor_runtime 检测 dist 陈旧（src mtime > dist mtime）⇒ 自动重建或 fail-closed（负控制：当前只在缺失时跑，陈旧不跑）
- [ ] AC2: verify 增加新鲜度检查（文件存在 且 与当前源码一致）
- [ ] AC3: B 机场景复测：git pull 新源码（不重建 dist）⇒ quay-init 检测陈旧并处理
- [ ] AC4: **user-scope 安装物新鲜度**——安装/启动时检查 dist 落后（如 mtime/版本）⇒ 提示重建（负控制：当前无检查，06:01 陈旧物被当新鲜用）
- [ ] AC5: 与 gap-vendor-runtime-not-in-git-clone-broken-mcp-entry + gap-delivery-surface-grows 交叉标注（升级通道两种形态 + 两种安装路径）

## Touches

- plugin/scripts/quay-init.sh（ensure_vendor_runtime 陈旧检测 + verify 新鲜度）
- plugin/scripts/sync-vendor.sh（如涉及重建判据）
- plugin/（user-scope 安装/启动新鲜度检查，如 install 或 launch 时）
- plugin/test/quay-init-loop.test.mjs（AC1-AC4 测试）
- tasks/gap-vendor-runtime-not-in-git-clone-broken-mcp-entry.md（AC5 交叉标注）
- tasks/gap-delivery-surface-grows-but-target-freezes-no-upgrade.md（AC5 交叉标注）

## Contract

measure   dist_fresh = `[ plugin/vendor/quay/dist/quay.js -nt packages/quay/src/version.ts ] && echo 1 || echo 0` stdout 数字段
band      dist_fresh = 1（dist 不陈旧）
invariant install_artifacts_fresh = 1（安装物（git-clone 与 user-scope）都有新鲜度判据）
invoke    `grep -n 'ensure_vendor_runtime\|mtime\|stale' plugin/scripts/quay-init.sh`
control   src 更新后不重建 ⇒ dist 陈旧（AC1 负控制）；重建后 ⇒ 新鲜；user-scope 06:01 陈旧物 ⇒ 提示（AC4）
resume    陈旧检测与 verify 新鲜度分步提交，任一步完成即写盘