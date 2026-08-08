---
id: gap-vendor-runtime-not-in-git-clone-broken-mcp-entry
title: "vendor runtime (dist) not in git clone — fresh-clone quay-init produces
  MCP entry pointing at nonexistent file (B machine verified: vendor/quay/dist +
  vendor/quay-native/dist absent, git ls-files vendor/ = 0); .gitignore dist/
  excludes it, verify checks lay-down set not referenced-runtime; WARN not fail
  = install reports success anyway; MORE fundamental than welcome-screen (blocks
  whole Provider ABI/MCP, AC12b 2nd hard blocker)"
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

**vendor 运行时（dist 产物）不随 git clone 走——采用者 fresh-clone 装出 MCP 入口指向不存在文件的半成品（管理者 B 机实测 + 外层独立验证）**：

**证据链（完整核实）**：
① B 机（orangevps）干净 clone + quay-init --loop ⇒ copied=2 skipped=31 conflicted=0，两条 verify 都 OK（verify-installed-executables 98 个、verify-referenced-landed OK）——**表面全绿**。
② 但打了两条 WARN：plugin has no built Core runtime（vendor/quay/dist/quay.js）— skipping Core runtime lay-down（AC7b）；provider mcp_entry 将引用缺失运行时。
③ B 机 vendor/quay/dist 与 vendor/quay-native/dist 两个目录都不存在；git ls-files vendor/ 返回 0 文件。
④ 根因：.gitignore 第 4 行 `dist/` 把 plugin/vendor/quay/dist/quay.js ignore 掉（git check-ignore -v 实证）。A 机 git 只跟踪 vendor/ 下 2 个文件（provider.yml、package.json），运行时本体从未入版本控制。
⑤ 后果：B 机 .quay/config.yml 里 mcp_entry 指向的运行时不存在。

**为什么比 welcome-屏更根本**：welcome-屏挡 cold-start INNER-DRIVEN 一个键；本缺陷挡**整个 Provider ABI 和 MCP**——任务库读不了，两层循环连任务都拿不到。且**骗过两条 verify**（它们检查铺设集里的文件，vendor 运行时根本没进铺设集——quay-init 自己跳过只打 WARN 不失败）。**WARN 不是 fail，安装照样报成功**——「判据存在但绕过了真正重要的东西」族。

**设计意图（.gitignore M172 注释）**：dist 是生成产物，由 npm install postinstall（sync-vendor.sh）重建，或 dist-plugin orphan 分支提供。git clone 非设计安装途径（clone + npm install 才是）。但 AC12b 测「clone 直接可用」——冲突。

**处置方向（外层裁定 + 管理者建议）**：
1. **fail-closed**（明确缺陷，立即修）：quay-init 遇 vendor 运行时缺失应报错（fail-closed）而非 WARN——mcp_entry 指向不存在文件的安装不该报 complete
2. **形态取舍**（产品决策，管理者 B 机已验证路径二可行）：②安装时自动构建（quay-init 调 sync-vendor.sh）——B 机实测 102 包几十秒、WARN 消失、运行时铺进目标位置，node --version 返回 0.3.13；①negate .gitignore 入库——clone 即用但污染 diff。**外层裁定选②**（dist 是生成产物，入库违反 ADR-004 单一来源；B 机实测数据支持，非推测）

### 选定机制

1. quay-init 检测 vendor 运行时缺失 ⇒ **fail-closed**（报错退出，不报 complete）
2. 形态：**安装时自动调 sync-vendor.sh 构建**（路径二，B 机实测可行）
3. verify 增加「被引用文件确实存在」检查（不只检查铺设集）
4. 验证：fresh-clone + quay-init ⇒ MCP 入口指向的运行时存在，provider ABI 可用

**Cross-annotation (2026-08-08, `gap-scoped-selection-blind-to-packaging-state-diff` AC7):** 本任务是
「打包态/源码态跨切失明」族在 quay 的最贴近实例——fresh-clone 采用者的 MCP 入口坏在 verify 看不见，
因为被引用的运行时从不在铺设集里（「判据存在但绕过了真正重要的东西」）。`gap-scoped-selection-blind-
to-packaging-state-diff` 的 scoped 跨切标记（`select-tests-for-touches.ts` 的 CROSSCUT_CHECKS）让
打包态一致性成为触碰 `packages/*/src` 任务的 scoped 可测项；本任务 AC3 的「verify 被引用运行时存在」
是同一跨切判据的**安装时**腿。交叉标注：archguard TASK-62/64/65/66（同模式三项目三检查）+
CLAUDE.md packaging e2e（DIR-111，`dist-verify-node-floor` 是打包态的最终判据）+ 自适应并发
（`cap-from-gate.sh`，机制一次下游复用）。

## Acceptance Criteria

- [x] AC1: quay-init 遇 vendor 运行时缺失 ⇒ fail-closed（报错退出非 0，不报 complete；负控制——当前 WARN 照报成功）
      —— `plugin/scripts/quay-init.sh` 新增 `ensure_vendor_runtime`（auto-build via sync-vendor.sh 失败后 `exit 2`，
      no `quay-init complete`）。实测（AC1 负控制，plugin 副本删两 bundle + stub sync-vendor 失败）：
      `EXIT=2`，stdout 无 `quay-init complete`，stderr 点名 `vendor/quay/dist/quay.js` + `vendor/quay-native/dist/quay-native.js`
      与 `FAILS CLOSED`。测试 `quay-init-loop.test.mjs`「AC1 — …FAILS CLOSED…」绿。
- [x] AC2: 形态②（安装自动构建）落地——fresh-clone + quay-init（含 npm install + sync-vendor）⇒ MCP 入口指向的运行时存在
      —— `ensure_vendor_runtime` 在 bundle 缺失时调用插件自带 `sync-vendor.sh`（无参全构建），成功后继续 lay-down。
      实测（stub sync-vendor 写出 bundle）：`auto-built vendor runtime via sync-vendor.sh (AC2)` 打到 stderr，
      `ws/vendor/quay/dist/quay.js` + `ws/vendor/quay-native/dist/quay-native.js` 铺进目标，
      config `mcp_entry: ["node", "<ws>/vendor/quay-native/dist/quay-native.js", "mcp"]` 指向存在文件。
      测试「AC2 — …AUTO-BUILDS and lays the runtime…」绿。真实路径（fresh-clone + npm install → postinstall→sync-vendor）
      由 DoD 的 B 机验证场景覆盖（本机 worktree 无 esbuild，auto-build 如实 fail-closed——即 AC1 场景）。
- [x] AC3: verify 增加运行时存在性检查（不只检查铺设集，检查被引用文件确实存在）
      —— `plugin/scripts/quay-init.sh` 新增 `verify_provider_runtime_existence`，读 `.quay/config.yml` 的
      provider `mcp_entry[1]` 并断言该文件在目标中存在；与 `verify_referenced_landed` 一起在每次 `--loop` 末尾执行。
      测试正方向（lay-down 后 mcp_entry 目标存在 ⇒ `verify-provider-runtime-existence: OK`）与负方向
      （pre-existing config 的 mcp_entry 指向 `$ws/nonexistent/runtime.js` ⇒ `referenced-runtime-missing` + exit 非 0）均绿。
- [x] AC4: 与 AC12b（gap-quay-has-never-self-hosted）交叉标注（本缺陷是 AC12b 的第二硬阻塞）
      —— `tasks/gap-quay-has-never-self-hosted-its-own-cold-start.md` Proposal 顶部新增
      「**AC12b hard blockers (2026-08-05, manager-directed)**」两段，明确本任务是 blocker #2（+ welcome-screen 为 #1）。

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] B 机路径二验证：fresh-clone + npm install + sync-vendor + quay-init ⇒ 两条 WARN 消失、运行时铺进目标位置、node vendor/quay/dist/quay.js --version 正常（实跑输出贴任务体）
- [ ] fail-closed 负控制：vendor 缺失时 quay-init 报错退出非 0（实跑输出贴任务体）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches
- tasks/gap-vendor-runtime-not-in-git-clone-broken-mcp-entry.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/quay-init.sh（fail-closed + 自动构建）
- plugin/scripts/sync-vendor.sh（安装时调用）
- plugin/test/quay-init-loop.test.mjs（AC1-AC3 测试）
- tasks/gap-quay-has-never-self-hosted-its-own-cold-start.md（AC4 交叉标注）

## Contract

measure   vendor_runtime_present = `ls plugin/vendor/quay/dist/quay.js 2>/dev/null | wc -l` stdout 数字段（fresh-clone + quay-init 后）
band      vendor_runtime_present = 1（MCP 入口指向的运行时存在）
invariant fail_closed_on_missing_vendor = 1（vendor 缺失 ⇒ quay-init 报错退出非 0）
invoke    `grep -n 'vendor\|dist\|WARN\|fail' plugin/scripts/quay-init.sh`
control   当前形态（vendor 缺失）⇒ WARN 照报成功（AC1 负控制）；修后 ⇒ fail-closed 或运行时存在
resume    fail-closed 与自动构建分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T14:05:00Z
changed: 管理者（外层）2026-08-05 裁定 AC12b 四个硬阻塞中第 2 个，直接派发内层执行。
  选定机制=任务体 Chosen-mechanism ①②③：fail-closed + 安装自动构建（sync-vendor）+ verify 存在性检查。
  实现：`quay-init.sh` 新增 `ensure_vendor_runtime`（AC1/AC2）+ `verify_provider_runtime_existence`（AC3），
  AC4 交叉标注写进 `gap-quay-has-never-self-hosted-its-own-cold-start.md`；测试三增一改。
  未动 sync-vendor.sh 本身（dist-runtime 任务的 Touches）。

## 完成记录（2026-08-05，fast mode, worktree task/gap-vendor-runtime-not-in-git-clone-broken-mcp-entry）

**根因（任务体已证）**：`.gitignore` 第 4 行 `dist/`（M172 注释）把 `plugin/vendor/quay/dist/quay.js` ignore，
fresh clone 的 plugin 源没有 built bundle，而 quay-init 旧行为只打两条 WARN 照报 complete——mcp_entry 指向不存在的文件，
挡整个 Provider ABI/MCP（AC12b 硬阻塞 #2），且骗过两条 verify（它们只查铺设集，不查被引用文件存在性）。

**机制（AC1/AC2/AC3）**：
1. `ensure_vendor_runtime()`（quay-init.sh 新函数）——bundle 缺失 ⇒ 调插件自带 `sync-vendor.sh` 自动构建（路径二）；
   构建仍无法产出 ⇒ **fail-closed**（`exit 2`，无 `quay-init complete`，点名缺失 bundle + 修复法）。DRY_RUN 只打印 would-ensure。
2. lay-down 块改为 `ensure_vendor_runtime` 返回后无条件 `copy_one` 三件套（Core bundle + native bundle + provider.yml），
   删除旧 WARN 分支。
3. `verify_provider_runtime_existence()`（quay-init.sh 新函数）——读 `.quay/config.yml` provider `mcp_entry[1]`，
   断言该文件在目标中确实存在（referenced-not-landed 补集），随 `verify_referenced_landed` 在每次 `--loop` 末尾执行。

**scoped 测试**：`bash scripts/test.sh --for-task gap-vendor-runtime-not-in-git-clone-broken-mcp-entry --allow-thin`
→ 选中 `plugin/test/quay-init-loop.test.mjs`；AC1/AC2/AC3 新测试 + 既有 AC7b 测试全绿，scoped static 全过。

**AC1 fail-closed 负控制实跑**（plugin 副本删两 bundle + stub sync-vendor 失败，quay-init --loop）：
```
EXIT=2
stderr: ERROR: plugin source has no built vendor runtime and the auto-build did not produce one (gap-vendor-runtime-not-in-git-clone-broken-mcp-entry AC1).
        The provider mcp_entry would reference a nonexistent runtime — the install FAILS CLOSED instead of shipping a broken MCP entry.
        Missing bundles:
          - plugin/vendor/quay/dist/quay.js
          - plugin/vendor/quay-native/dist/quay-native.js
stdout: 无 `quay-init complete`
```
真实 sync-vendor 也验证（本 worktree 无 esbuild）——auto-build 如实失败 ⇒ 同样 fail-closed，报错末尾附 sync-vendor 输出。

**AC2 auto-build 实跑**（stub sync-vendor 写出 bundle）：
```
stderr: vendor runtime missing from plugin source (gitignored dist/ — a fresh clone has no built bundles). Attempting auto-build via sync-vendor.sh (AC2, path 2) ...
        auto-built vendor runtime via sync-vendor.sh (AC2)
ws/vendor/quay/dist/quay.js + ws/vendor/quay-native/dist/quay-native.js 铺进目标
config mcp_entry: ["node", "<ws>/vendor/quay-native/dist/quay-native.js", "mcp"] 指向存在文件
```

**fresh-clone 路径二端到端实跑**（2026-08-05，本机模拟 B 机路径二：`git clone` 本分支到 /var/tmp → 无 dist → 安装步 →
`quay-init --loop` → MCP 入口指向存在运行时）：
```
$ git clone --branch task/gap-vendor-runtime-not-in-git-clone-broken-mcp-entry ... /var/tmp/fresh-clone-vr
$ ls plugin/vendor/quay/dist/  →  No such file or directory        # 复现缺陷：fresh clone 无运行时
$ git ls-files plugin/vendor/  →  plugin/vendor/quay-native/provider.yml
                                  plugin/vendor/quay/package.json   # 仅 2 个跟踪文件，运行时本体不入库
$ bash plugin/scripts/sync-vendor.sh   # 等价 npm install postinstall
[sync-vendor] done. The vendored dist/quay.js ...
$ ls plugin/vendor/quay/dist/quay.js plugin/vendor/quay-native/dist/quay-native.js   # 现在存在
$ bash plugin/scripts/quay-init.sh --loop --root <target> ...
EXIT=0；两处 WARN 均消失（grep -c WARN = 0）
verify-installed-executables: OK
verify-referenced-landed: OK
verify-provider-runtime-existence: OK (<target>/vendor/quay-native/dist/quay-native.js exists)
config mcp_entry: ["node", "<target>/vendor/quay-native/dist/quay-native.js", "mcp"]   # 指向存在文件
$ node <target>/vendor/quay-native/dist/quay-native.js mcp
quay-native mcp: serving tasks from <target>/tasks   # Provider ABI 可用
```
注：`node vendor/quay/dist/quay.js --version` 的 ENOENT（version.ts 读外部 package.json）属
**另一任务** `gap-dist-runtime-not-self-contained-reads-external-package-json`（AC12b 阻塞②延伸）的缺陷域，
本任务（运行时存在性 + fail-closed + auto-build）已闭环。
**交叉标注（AC12b 阻塞③，2026-08-05）**：该 ENOENT 缺陷域已由
`gap-dist-runtime-not-self-contained-reads-external-package-json` 闭环——version.ts 改为构建时内联版本号
（esbuild json loader），dist 运行时零外部 package.json 读，`node vendor/quay/dist/quay.js --version` 与
`task list` 在无 package.json 布局下均正常（AC12b 阻塞③ 与阻塞② 在此互补闭环）。

**invoke 证据**（`grep -n 'vendor\|dist\|WARN\|fail' plugin/scripts/quay-init.sh`）：
```
588:ensure_vendor_runtime() {
590:  [ -f "$PLUGIN_ROOT/vendor/quay/dist/quay.js" ] || missing=1
591:  [ -f "$PLUGIN_ROOT/vendor/quay-native/dist/quay-native.js" ] || missing=1
599:  echo "  vendor runtime missing from plugin source (gitignored dist/ — a fresh clone has no built bundles). Attempting auto-build via sync-vendor.sh (AC2, path 2) ..." >&2
602:  if [ -f "$PLUGIN_ROOT/scripts/sync-vendor.sh" ] && bash "$PLUGIN_ROOT/scripts/sync-vendor.sh" >"$vlog" 2>&1; then
605:      echo "  auto-built vendor runtime via sync-vendor.sh (AC2)" >&2
609:  echo "ERROR: plugin source has no built vendor runtime and the auto-build did not produce one (gap-vendor-runtime-not-in-git-clone-broken-mcp-entry AC1)." >&2
626:# verify_provider_runtime_existence <workspace-root> — gap-vendor-runtime-not-in-git-clone-broken-
867:  # AC7b (gap-cold-start-...-eight-steps) + gap-vendor-runtime-not-in-git-clone-broken-mcp-entry
```
## Cross-annotation（AC5，gap-upgrade-channel-cant-sync-build-artifacts-dist-stale）

本任务闭环 fresh-clone **missing**（dist 不存在 ⇒ auto-build/fail-closed）；`gap-upgrade-channel-...-dist-stale`
是它的**动态漂移后继**：clone 后有 dist，但 git pull 新源码后 dist 不跟随（stale）。两条缺陷现已由同一函数
`ensure_vendor_runtime` 处理——missing 与 stale 都走 auto-build/fail-closed（`dist_stale` 判 src mtime >
dist mtime）。两种安装路径（git-clone 与 user-scope）都已有新鲜度判据（mtime / 版本一致性）。
