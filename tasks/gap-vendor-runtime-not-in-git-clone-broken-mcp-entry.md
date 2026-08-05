---
id: gap-vendor-runtime-not-in-git-clone-broken-mcp-entry
title: "vendor runtime (dist) not in git clone — fresh-clone quay-init produces
  MCP entry pointing at nonexistent file (B machine verified: vendor/quay/dist +
  vendor/quay-native/dist absent, git ls-files vendor/ = 0); .gitignore dist/
  excludes it, verify checks lay-down set not referenced-runtime; WARN not fail
  = install reports success anyway; MORE fundamental than welcome-screen (blocks
  whole Provider ABI/MCP, AC12b 2nd hard blocker)"
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
2. **形态取舍**（产品决策）：①negate .gitignore（`!plugin/vendor/**/dist/`）入库——clone 即可用但污染 diff；②安装时自动构建（quay-init 调 sync-vendor.sh）——clone 后需构建工具链。**外层倾向②**（dist 是生成产物，入库违反 ADR-004 单一来源；quay-init 已知需要 vendor 只差调用构建）

### 选定机制

1. quay-init 检测 vendor 运行时缺失 ⇒ **fail-closed**（报错退出，不报 complete）
2. 形态：安装时自动调 sync-vendor.sh 构建 vendor 运行时（方向②），或 negate .gitignore（方向①）——二选一由人裁定
3. 验证：fresh-clone + quay-init ⇒ MCP 入口指向的运行时存在（不 fail-closed），provider ABI 可用

## Acceptance Criteria

- [ ] AC1: quay-init 遇 vendor 运行时缺失 ⇒ fail-closed（报错退出非 0，不报 complete；负控制——当前 WARN 照报成功）
- [ ] AC2: 形态落地（②安装自动构建 或 ①negate 入库）后，fresh-clone + quay-init ⇒ MCP 入口指向的运行时存在
- [ ] AC3: verify 增加运行时存在性检查（不只检查铺设集，检查被引用文件确实存在）
- [ ] AC4: 与 AC12b（gap-quay-has-never-self-hosted）交叉标注（本缺陷是 AC12b 的第二硬阻塞）

## Touches

- plugin/scripts/quay-init.sh（fail-closed + 自动构建/negate）
- plugin/scripts/sync-vendor.sh（安装时调用）
- .gitignore（若选 negate）
- plugin/test/quay-init-loop.test.mjs（AC1-AC3 测试）
- tasks/gap-quay-has-never-self-hosted-its-own-cold-start.md（AC4 交叉标注）

## Contract

measure   vendor_runtime_present = `ls plugin/vendor/quay/dist/quay.js 2>/dev/null | wc -l` stdout 数字段（fresh-clone + quay-init 后）
band      vendor_runtime_present = 1（MCP 入口指向的运行时存在）
invoke    `grep -n 'vendor\|dist\|WARN\|fail' plugin/scripts/quay-init.sh`
control   当前形态（vendor 缺失）⇒ WARN 照报成功（AC1 负控制）；修后 ⇒ fail-closed 或运行时存在
resume    fail-closed 与形态落地分步提交，任一步完成即写盘