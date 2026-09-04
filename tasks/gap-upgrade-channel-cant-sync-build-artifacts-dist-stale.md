---
id: gap-upgrade-channel-cant-sync-build-artifacts-dist-stale
title: "upgrade channel syncs source but not build artifacts — git pull gets new
  src + stale dist (B machine: dist 13:34 built, fix 15:10 merged, ENOENT
  persists; verify checks existence not freshness); 2nd upgrade-channel-gap form
  (dynamic drift); fix: ensure_vendor_runtime rebuilds/fails-closed when src
  mtime > dist mtime"
status: done
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

- [x] AC1: ensure_vendor_runtime 检测 dist 陈旧（src mtime > dist mtime）⇒ 自动重建或 fail-closed（负控制：当前只在缺失时跑，陈旧不跑）
      —— `plugin/scripts/quay-init.sh` 新增 `dist_stale`（find packages/quay/src + packages/quay-native/src 最新 mtime
      vs vendor/*/dist/*.js mtime，0=STALE/1=fresh/2=no-source-tree）+ `ensure_vendor_runtime` 陈旧分支：
      陈旧时先走 sync-vendor.sh 自动重建（`auto-rebuilt STALE vendor runtime via sync-vendor.sh (AC1)`），重建失败
      fail-closed（exit 2，无 `quay-init complete`）。**负控制**（实测输出，plugin 副本 dist mtime=1e9 < src mtime=2e9）：
      ```
      vendor runtime STALE (source mtime newer than dist mtime — a git pull synced source without rebuilding the gitignored bundle). Attempting auto-rebuild via sync-vendor.sh (AC1) ...
      auto-rebuilt STALE vendor runtime via sync-vendor.sh (AC1)
      ```
      反方向负控制（dist 比 src 新 ⇒ 不重建、sync-vendor 不跑）实测通过。
- [x] AC2: verify 增加新鲜度检查（文件存在 且 与当前源码一致）
      —— `verify_provider_runtime_existence` 增加 freshness 分支：mcp_entry 指向已知 quay 运行时
      （quay.js / quay-native.js）时，byte-compare 目标运行时与 plugin 当前 vendored bundle；
      不一致 ⇒ FAIL CLOSED（`stale-runtime`）。存在检查仍先行（旧 verify 只查存在，现查「存在且当前」）。
      实测（目标 bin/quay.js 陈旧 vs plugin 当前 bundle）：`FAIL (stale-runtime): ... differs from the plugin's current vendored bundle` + exit 非 0。
- [x] AC3: B 机场景复测：git pull 新源码（不重建 dist）⇒ quay-init 检测陈旧并处理
      —— B 机场景 = src mtime > dist mtime（git pull 同步源码、gitignored dist 不跟随）。AC1 自动重建测试
      即该场景的机械复测（stale core v1 → auto-rebuild → laid bundle = `// rebuilt core`）。fail-closed 变体
      （重建无法产出）实测 exit 非 0、无 complete。
- [x] AC4: **user-scope 安装物新鲜度**——安装/启动时检查 dist 落后（如 mtime/版本）⇒ 提示重建（负控制：当前无检查，06:01 陈旧物被当新鲜用）
      —— `vendor_runtime_user_scope_stale_check`：无 packages/ 源树（user-scope 安装缓存）时，version-consistency
      判据——embedded dist version（`node dist/quay.js --version`）vs `plugin/vendor/quay/package.json` version。
      不一致 ⇒ 打印 STALE 警告 + 提示更新/重装（prompt，不 fail-closed——缓存无源可重建）。**负控制实测**
      （embedded 0.3.12 vs declared 0.3.13）：
      ```
      STALE (user-scope vendor runtime): the built bundle embeds version 0.3.12 but plugin/vendor/quay/package.json declares 0.3.13.
             The 06:01 stale dist was previously treated as fresh (AC4 negative control). Update/reinstall the plugin so the runtime matches the plugin version.
      ```
      一致（0.3.13 vs 0.3.13）⇒ 不告警实测通过。
- [x] AC5: 与 gap-vendor-runtime-not-in-git-clone-broken-mcp-entry + gap-delivery-surface-grows 交叉标注（升级通道两种形态 + 两种安装路径）
      —— 已在本任务体 + 两个任务体各加交叉标注段（见下 `## Cross-annotation` 与各任务文件）。

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC1/AC3/AC4 实跑输出贴任务体
- [ ] fresh-clone / git-pull 升级路径 e2e：pull 新源码（不重建 dist）⇒ quay-init 检测陈旧并自动重建或 fail-closed（负控制实测）
- [ ] user-scope 安装物新鲜度检查生效（06:01 陈旧物不再被当新鲜用）
- [ ] 全量套件绿（fail 0 且 cancelled 0 且 FULL-SUITE-EXIT=0）

## Touches
- tasks/gap-upgrade-channel-cant-sync-build-artifacts-dist-stale.md（自身文件：勾 AC + 贴 invoke 证据授权）

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

## Cross-annotation（AC5）

升级通道的两种形态 + 两种安装路径，三任务互指：

- **gap-vendor-runtime-not-in-git-clone-broken-mcp-entry**：fresh-clone 缺 dist（missing）→ quay-init
  auto-build/fail-closed。**本任务 = 它的动态漂移后继**：clone 后有 dist，但 git pull 新源码后 dist 不跟随
  （stale）→ ensure_vendor_runtime 现在同一函数里同时处理 missing 与 stale。
- **gap-delivery-surface-grows-but-target-freezes-no-upgrade**：交付面（派生脚本）长大而目标项目冻结
  （静态漂移，L2 升级正确性）。**本任务 = 构建产物轴上的同族**：源码同步但构建产物不跟随，verify 只查
  存在不查新鲜度。两条升级通道缺陷同一根因：「安装物没有新鲜度判据」。
- **gap-no-active-node-version-check-users-cant-tell-upgrade（AC4 交叉标注）**：本任务管的是**dist 安装物**
  的新鲜度（存在 + 与源码一致）；node 版本 floor 是**另一条轴**——dist/quay.js 跑在 dist floor
  **Node 20**（本任务 + dist-verify-node-floor CI 证明），源码执行路径
  `node --experimental-strip-types bin/quay.ts` 需要 **Node ≥ 22.6**（那任务的探针判据）。两条 floor
  **分开判断**：探针只挂在源码执行路径的纯 JS 入口 `bin/quay.js` 上，不进 dist bundle——dist 在 Node 20
  照常跑，不被 22.6 探针挡住（AC4）。
- **gap-user-scope-install-reinstall-criterion-and-version（AC4 交叉标注，2026-08-08）**：本任务管的是
  **dist 安装物的新鲜度**（mtime 与源码一致 / 嵌入版本与 vendored package.json 一致——`dist_fresh`
  + `vendor_runtime_user_scope_stale_check`）；那任务管的是**user-scope 插件安装物本身的版本判据**
  （`plugin/VERSION` + `plugin/sync.sh --check-user-scope` 比对 + `--reinstall-criterion` 能力边界
  重装判据）。同一根因的两层落点：**「安装物没有新鲜度判据」**——本任务在**构建产物轴**（dist 跟随源码），
  那任务在**整包安装物轴**（user-scope 安装跟随插件版本）。dist-follow 判据（mtime/版本一致）是那任务
  的 VERSION 比对判据的**前置同族**：两者都是「落后则报出」的负控制补丁（修复前无任何机制报陈旧）。
  `plugin/VERSION` 与 vendored package.json 版本的一致性由 user-scope-reinstall 测试断言（单一来源防漂移）。

## Dispatch review

reviewer: inner
at: 2026-08-05T16:57:00Z
changed: 无 dispatch 改动——执行本任务：quay-init.sh 增加 dist_stale + vendor_runtime_user_scope_stale_check +
ensure_vendor_runtime 陈旧分支 + verify freshness；quay-init-loop.test.mjs 新增 7 条 AC1/AC2/AC4 测试；AC1–AC5
勾上并贴实测证据；DoD 留空（未达全量绿门）。
resume    陈旧检测与 verify 新鲜度分步提交，任一步完成即写盘