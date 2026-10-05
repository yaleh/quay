---
id: gap-config-provider-path-frozen-to-versioned-cache-dir
title: .quay/config.yml 的 provider path/mcp_entry
  写死安装当时的版本缓存目录，升级后不跟随——需要不含版本号的项目内稳定入口
status: done
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
- `plugin/skills/init/SKILL.md`
- `plugin/skills/manager/SKILL.md`
- `plugin/test/quay-init-stable-plugin-link.test.mjs`
- `plugin/test/driver-runtime-loaded-version-drift.test.mjs`
- `plugin/test/quay-init.test.mjs`
- `plugin/test/quay-init-characterization.test.mjs`
- `plugin/test/quay-init-loop.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `packages/quay/test/install-config-driven-e2e.test.mjs`
- `plugin/test/release-cut.test.mjs`
- `tasks/gap-config-provider-path-frozen-to-versioned-cache-dir.md`

## AC
- [x] 新测试 `plugin/test/quay-init-stable-plugin-link.test.mjs` 用真 `.quay/config.yml` 临时 workspace 与伪造的 `installed_plugins.json` 夹具,断言:①init 后 `<ws>/.quay/plugin` 是指向该 scope installPath 的符号链接;②config 的 path 与 mcp_entry 不含任何 `/cache/quay/quay/<版本号>/` 段;③升级夹具(注册表改指新版本)后重跑 init,链接指向新版本、config 文本不变。`node --experimental-strip-types --test plugin/test/quay-init-stable-plugin-link.test.mjs` 退出 0。**实测:8/8 pass(AC1/AC1③/AC2①/AC2②/AC2③/AC2③b/AC3/AC6)。**
- [x] scope 选择用例:夹具含 local(projectPath=本项目,0.10.0)与 user(0.14.0)两条时,链接指向 0.10.0;无 local/project 条目时指向 user 条目;只有缺 projectPath 的条目时链接不变且输出含 `NOT-EVALUATED`(读不出 ⇒ 不与成功同形)。**实测:AC2①/②/③ 全绿;③ 输出 `project-plugin-link: NOT-EVALUATED — no projectPath-matching local/project entry and no user-scope entry …`,链接保持原目标。**
- [x] `-dev` 排除用例:夹具含 0.12.0-dev 与 0.11.0 两个 user 条目时选 0.11.0。**实测:AC3 绿,链接指向 0.11.0,`notEqual` 于 0.12.0-dev 目录。**
- [x] 取假:把 init 里刷新链接的步骤注释掉后,上面①或③用例红(附实跑输出)。**实测:把 `write_config` 首行的 `quay-init-step refresh-plugin-link` 注释掉后重跑该文件 ⇒ 8 测 7 红(AC1、AC1③、AC2①②③③b、AC3 全红,仅 AC6 非空自检绿);恢复后 8/8 绿。**
- [x] 读生产载体:在 claudecodeui(或同形的真实第三方工作区副本)实跑迁移后的 `/quay:init`,读出其 `.quay/config.yml` 不含版本段、`.quay/plugin` 链接目标为当前版本目录,且迁移后 `quay driver restart` 起的 anchor 其 `/proc/<pid>/cmdline` 中的 kernel 路径为 readlink -f 后的真实版本目录;读数原文贴进完成记录。**实测(同形真实第三方副本 `/var/tmp/claudecodeui-copy-Cz1E`,config 由 claudecodeui 的 0.14.0 版本段原文 sed 路径而来):迁移前 `grep -c '/cache/quay/quay/[0-9]'` = 2,迁移后 = 0;`linked: .quay/plugin -> /data/home/yale/.claude/plugins/cache/quay/quay/0.14.0 (user scope, v0.14.0 …)`;`migrated: path '…/0.14.0/vendor/quay-native' -> …/.quay/plugin/vendor/quay-native` + `migrated: mcp_entry versioned install-cache path … -> …/.quay/plugin/…/dist/quay-native.js`;`quay driver start --kind promotion` 起的 anchor pid=1393178,`/proc/1393178/cmdline` 内核实参 = `/data/home/yale/.claude/plugins/cache/quay/quay/0.14.0/scripts/dist/driver-anchor.js`,`readlink -f` 同值(真实版本目录);用本任务内核 `driver status --json` 读该迁移后 config ⇒ `config_provider_path="current"` `config_provider_path_version="0.14.0"`(同一 config 用未改的 0.14.0 CLI 读为 `not-evaluated`,即本任务 `readlink -f` 读数的前后对照)。副本 driver 已 stop,无残留进程。**
- [x] `bash scripts/test.sh --for-task gap-config-provider-path-frozen-to-versioned-cache-dir` 退出 0,且执行了 ≥1 个测试文件。**实测(2026-10-05 续做轮②,加两个新 touch 后重跑):tests 193 / pass 193 / fail 0,duration 13.7s;`--write-scoped-gate-cache` 已按 develop sha `824f75041`(HEAD 的祖先)写入。scoped 静态闸全 PASS(spec-declaration 48/48、quay-init-closure-ratchet 指纹新鲜、split-or-commit、capability-manifest、tmp-leak、test-isolation 等)。**

## DoD
真实落地:一个真实第三方项目(claudecodeui)升级插件版本后,不手改 config,只重跑 `/quay:init` 即可让 provider 拉起新版本 runtime;local scope 固定旧版本的项目不被其它项目的升级影响。仅有 fixture 绿不算完成。

**落地证据**:同形真实第三方工作区副本(由 claudecodeui 的真实 `.quay/config.yml` 原文改写路径而来)上,迁移后的 config provider 绑定不再带版本段、`.quay/plugin` 指向当前版本目录,driver anchor 从真实版本目录启动(见 AC5 读数)。"升级后只重跑 init 即跟随新版本、config 不变"由 `quay-init-stable-plugin-link.test.mjs` AC1③ 钉住(夹具注册表改指新版本 ⇒ 链接改指新版本、config 逐字节不变)。"local scope 固定旧版本不被覆盖"由 AC2① 钉住(projectPath 匹配的 0.10.0 胜过更新的 user 0.14.0),即⛔ 全局单一链接会破坏的那条约束。

## Evidence
**2026-10-05 续做轮:adopt peer 的 spec-declaration 修复(store-wide 静态红,非本任务 delta)。** 上一轮 `step=suite: # fail 72` 的真实原因是日志尾部的 `STATIC_CHECK_FAILED: spec-declaration-point-check exit=1`(静态闸 fail-closed 中止,`# tests 0` ⇒ 不是 72 个测试失败):develop 上 `7a596134b` 落了 `orchestration/SPEC-goal-author-branch-2026-10-05.md` 但两处声明点(`plugin/skills/init/SKILL.md` 的 `<!-- reference-doc -->` 块、`plugin/skills/manager/SKILL.md` 的 SPEC 索引)都没加,故整店红、每个任务的 fan-in 都在静态层中止。查证 develop 自身:两文件 `grep -c SPEC-goal-author-branch` 均 = 0 ⇒ develop-wide,非本分支 delta。owner 判定:无 `status: ready` 任务认领(无任务文件命中该 SPEC);peer 分支 `task/gap-release-bundle-embeds-dev-version-after-stamp` 已带修复 `644ab27ef`(`fix(spec-declaration): declare SPEC-goal-author-branch-2026-10-05 at both points`)但未落 develop。**处置:byte-exact adopt peer 的已提交字节**(`git checkout task/gap-release-bundle-embeds-dev-version-after-stamp -- <两文件>`,md5 逐文件比对一致:init `96f21899bc4e70b33b22988dc5aab8ac`、manager `f037b9e3d54376860132911865902a19`),本地提交 `f22b5956e`。两文件已加进 `## Touches`(anti-drift 硬门要求)。adopt 的同一字节在两种落序下都良性:谁先落谁修 develop,后落者该两路径 delta 归零。验证:adopt 后 `spec-declaration-point-check --root <worktree>` 退出 0(all 48 SPEC declared at each of 2 points)。
**2026-10-05 续做轮②:修两个 suite 红(① 本任务 delta 引入,② develop-wide 潜在红)。** 上一轮 `step=suite` 的 `ratio=0.77` 只是三个红中的一个,另两个必须先解决才能落地:本店 `.quay/config.yml` 未声明 `loop.rerun_command` ⇒ fan-in 的 in-round 重跑恒 `rerun-not-evaluated` ⇒ 任一确定性红都直接 `failSuite`(不靠重跑豁免)。**①`packages/quay/test/install-config-driven-e2e.test.mjs` A1 红 `EISDIR`**——本任务让 `/quay:init` 落 `<ws>/.quay/plugin` 符号链接(指向该 scope installPath;AC5 生产读数),该测试的 `listFiles` 用 `readdirSync({withFileTypes})` 把符号链接当普通条目(`Dirent.isDirectory()` 对符号链接为 false)⇒ `crossWorkspaceDiffs` 的 `readFileSync` 跟着链接读到目录。**实测确证**:按测试同形手工跑一次 init(HOME 注册表无 projectPath 匹配 ⇒ 落 user scope),`find <ws> -maxdepth 3 -type l` 唯一命中 `<ws>/.quay/plugin -> /data/home/yale/.claude/plugins/cache/quay/quay/0.14.0`。修法:`.quay/plugin` 是安装生成的**每项目配置**(与 `.quay/profiles.yml` 同类),加进该测试的 `CONFIG_CLASS`(注释同时写明它是符号链接这一层)。**②`plugin/test/release-cut.test.mjs` 完成切分的断言用 `worktreeDirs(c.parent)`**(glob `<parent>/*-worktrees`)⇒ 要求 **worktree 根目录**消失;但 `git worktree remove` 从不清除父目录(独立 `git init`/`worktree add`/`worktree remove` 实测:`*-worktrees` 空目录仍在),且生产默认根 `/home/yale/work/quay-worktrees` 是**共享**的(与全部 task worktree 同根,`release-cut.mjs` 步骤 8 的计划文本也只写 `git worktree remove <worktree>`)⇒ 删它才是错的;同文件 else 分支本就查叶子(`existsSync(join(c.parent,"repo-worktrees","release-v9.9.9"))`)。修法:该断言改为同形的叶子检查(能取假:叶子仍在 ⇒ 红)。**② 非本任务 delta 的证据**:在主检出上复现同一红,而主检出 `author` 与 `develop` **0 分叉提交**(`git rev-list --count develop..HEAD`/`HEAD..develop` 均 0)⇒ develop-wide 潜在红,只在宿主够快(bump 阶段跑得完)时触发:同一 develop 上 12:22(UTC)的 `gap-release-bundle-embeds-dev-version-after-stamp` fan-in suite 绿(走 else 分支),12:25 本任务 suite 红(走 if 分支)。两文件已入 `## Touches`(anti-drift 硬门)。**隔离验证**:`node --test packages/quay/test/install-config-driven-e2e.test.mjs` 3/3 绿;`node --test plugin/test/release-cut.test.mjs` 8/8 绿。
