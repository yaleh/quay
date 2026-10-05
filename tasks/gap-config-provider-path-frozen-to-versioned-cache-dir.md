---
id: gap-config-provider-path-frozen-to-versioned-cache-dir
title: .quay/config.yml 的 provider path/mcp_entry
  写死安装当时的版本缓存目录，升级后不跟随——需要不含版本号的项目内稳定入口
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**机制**:`/quay:init`(`plugin/scripts/quay-init.sh`,约 1531-1536 行写 provider 配置)把 provider 的 `path` 与 `mcp_entry` 写成 `<installPath>/vendor/quay-native[...]` 的绝对路径,其中 installPath 带版本号(如 `~/.claude/plugins/cache/quay/quay/0.14.0/`)。升级后 config 不变,Core MCP 仍按旧路径拉起 provider 子进程。`packages/quay/src/config.ts` 没有 `${...}`/环境变量展开,已有的 `migrate_stale_mcp_entry` 只迁移"指向不存在路径"的情形,不处理"路径存在但版本已落后"。`driver status` 已能单列 `config-provider-path-behind`(gap-driver-status-loaded-vs-installed-version-drift),但只报告,不修复。

**生产实测(2026-10-05)**:claudecodeui 的 `.quay/config.yml` 第 4 行 path 与 mcp_entry 第二元素都写死 `…/cache/quay/quay/0.14.0/vendor/quay-native[/dist/quay-native.js]`。

**已定设计(人 2026-10-05 在讨论中裁定的约束)**:⛔ 不用全局链接(如 `~/.local/share/quay/current`)——`installed_plugins.json` 的 `quay@quay` 有按 scope/projectPath 区分的 local/project/user 多条记录,local scope 固定版本的项目会被全局单一链接覆盖。采用**项目内链接** `<project>/.quay/plugin -> <该项目对应 scope 的 installPath>`(`.quay/plugin` 加入 `.gitignore`),由该项目的 `/quay:init` 创建;config 的 path/mcp_entry 指向 `<project>/.quay/plugin/...`;链接目标通过 `readlink -f` 后的真实路径启动 anchor/serve,保证 `/proc/<pid>/cmdline` 仍可读出版本(`driver-runtime.ts` 的 loaded-version 读数依赖它)。

**选版本规则**:先取 `projectPath` 等于本项目的条目(local 或 project scope),找不到再取 user scope 条目,都没有则报"未评估"并**不改动**现有链接;排除 `-dev`。已知待澄清:注册表里存在缺 `projectPath` 的 project scope 条目(2026-10-05 在 `installed_plugins.json` 实测),此类条目一律视为不可判定,不得归给任何项目。

**不在本任务范围**:shim 落后时是否自动 re-exec(未决,需人裁定);单元/PATH 污染治理(claudecodeui 侧已另行处理)。

<!-- dedup-ref -->相关(追溯,非前置):gap-driver-status-loaded-vs-installed-version-drift(done,只报告 config-provider-path-behind);gap-upgrade-leaves-legacy-project-runtime-stale-and-unmigrated(done,旧 runtime 迁移);gap-aged-third-party-project-quay-upgrade-verification(done)。

## Touches
- `plugin/scripts/quay-init.sh`
- `plugin/scripts/quay-init-steps.ts`
- `packages/quay/src/init.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/test/quay-init-stable-plugin-link.test.mjs`
- `plugin/test/driver-runtime-loaded-version-drift.test.mjs`
- `plugin/test/quay-init.test.mjs`
- `plugin/test/quay-init-characterization.test.mjs`
- `plugin/test/quay-init-loop.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-config-provider-path-frozen-to-versioned-cache-dir.md`

## AC
- [ ] 新测试 `plugin/test/quay-init-stable-plugin-link.test.mjs` 用真 `.quay/config.yml` 临时 workspace 与伪造的 `installed_plugins.json` 夹具,断言:①init 后 `<ws>/.quay/plugin` 是指向该 scope installPath 的符号链接;②config 的 path 与 mcp_entry 不含任何 `/cache/quay/quay/<版本号>/` 段;③升级夹具(注册表改指新版本)后重跑 init,链接指向新版本、config 文本不变。`node --experimental-strip-types --test plugin/test/quay-init-stable-plugin-link.test.mjs` 退出 0。
- [ ] scope 选择用例:夹具含 local(projectPath=本项目,0.10.0)与 user(0.14.0)两条时,链接指向 0.10.0;无 local/project 条目时指向 user 条目;只有缺 projectPath 的条目时链接不变且输出含 `NOT-EVALUATED`(读不出 ⇒ 不与成功同形)。
- [ ] `-dev` 排除用例:夹具含 0.12.0-dev 与 0.11.0 两个 user 条目时选 0.11.0。
- [ ] 取假:把 init 里刷新链接的步骤注释掉后,上面①或③用例红(附实跑输出)。
- [ ] 读生产载体:在 claudecodeui(或同形的真实第三方工作区副本)实跑迁移后的 `/quay:init`,读出其 `.quay/config.yml` 不含版本段、`.quay/plugin` 链接目标为当前版本目录,且迁移后 `quay driver restart` 起的 anchor 其 `/proc/<pid>/cmdline` 中的 kernel 路径为 readlink -f 后的真实版本目录;读数原文贴进完成记录。
- [ ] `bash scripts/test.sh --for-task gap-config-provider-path-frozen-to-versioned-cache-dir` 退出 0,且执行了 ≥1 个测试文件。

## DoD
真实落地:一个真实第三方项目(claudecodeui)升级插件版本后,不手改 config,只重跑 `/quay:init` 即可让 provider 拉起新版本 runtime;local scope 固定旧版本的项目不被其它项目的升级影响。仅有 fixture 绿不算完成。
