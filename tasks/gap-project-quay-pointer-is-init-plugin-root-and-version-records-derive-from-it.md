---
id: gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it
title: 项目内 quay 版本只留一个指引（.quay/plugin 指向 init 运行时的插件根），Core 不写只报漂移，其余版本记录消除或由它派生
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**人的裁定(2026-10-06,本会话逐字意图)**:在 Claude Code plugin(含 MCP)中,以**当前运行的插件版本**为准,`plugin-root.ts` 也应用这一规则;`/quay:init` 时仍更新 `.quay/plugin` 链接到**当前插件**,作为 Core 不在场时的指引;**消除其它关于版本的记录**。进一步裁定:链接目标取"init 运行时的插件根",**Core 不写它、只报漂移**;`quay-init-state.json` 的版本改为从链接派生。

**要解决的机制缺陷(均有读数)**:
1. 链接目标由 `init` 自己查注册表选(`packages/quay/src/init.ts:1526-1529` `pick = tierProject.length > 0 ? tierProject : tierUser`),而会话层实际不让 project 记录支配版本(2026-10-06 自然实验:claudecodeui 的 project 记录恒为 0.14.0、user 在 07:14:55 升到 0.15.0,其后启动的会话全为 0.15.0;规则是"取最高"还是"user 优先"无法由现有数据区分)。两个解析器必然分叉,`.quay/plugin` 可能指向与会话不同的版本。
2. `.quay/quay-init-state.json` 已无活的写入者(`write_state_file` 在 9ef94fe18 / 2026-09-18 随 copy 机器退役),claudecodeui 与 cantus 的 `.quay/` 里都没有这个文件;但 `plugin/scripts/goal-driver.ts` 约 4650-4651 行在文件缺失时把整个 target-health 判成 `not-evaluated`/`init-state-missing`——第三方项目的 target-health 读数因此恒为"未评估"(死读数)。读取者另有 `packages/quay/src/serve-render.ts:1209-1218`(`readInitStatePluginVersion`)。
3. `.quay/config.yml` 的 native provider `path`/`mcp_entry` 写入了一条指向 `.quay/plugin/vendor/quay-native` 的路径(`plugin/scripts/quay-init.sh:1549-1551`),让 config 依赖链接;而 Core 本可由 `plugin-root.ts`(定位插件树的唯一解析器)按自身安装位置解析 provider。

**修法**:
(A) **链接目标 = init 运行时的插件根**(`plugin/scripts/quay-init.sh:50` 已要求 `${CLAUDE_PLUGIN_ROOT}` 或 `--plugin-root`,缺失即拒绝),不再查注册表;删除 `selectProjectPluginInstallPath` 的 tier 选择。插件根无法确定、或插件根是开发树(quay 自己的仓库,`<repo>/plugin`)时,输出 `NOT-EVALUATED`/跳过并**保持现有链接不变**(硬规则 3b),不建链接。
(B) **Core 不写链接,只报漂移**:`driver status`(`plugin/scripts/driver-runtime.ts`)读数中增加 `pointer` 项:Core 自身所在插件根 vs `.quay/plugin` 链接目标的版本关系(current/behind/ahead/`not-evaluated`),版本取各目录 `.claude-plugin/plugin.json` 的 version 或 `VERSION` 文件(⛔ 不用 `--version` 输出)。⛔ 任何 Core 路径(含 driver start、serve、MCP)不得写 `.quay/plugin`;多个版本的会话可并存于同一项目(2026-10-06 实测 2 个 0.14.0 + 4 个 0.15.0),运行时自动刷新会互相覆盖。
(C) **`plugin-root.ts`**:规则确认为"以自身安装位置(运行中的插件)为准";`.quay/plugin` ⛔ 永远不作为它的输入(避免循环);环境变量 `QUAY_PLUGIN_ROOT` 与自身位置不一致时在读数中报警(它若被固化进服务单元会像 PATH 一样冻结版本)。
(D) **native provider 缺省解析**:`config.yml` 不再为 native provider 写 `path`/`mcp_entry`;Core 缺省按 `plugin-root.ts` 解析 `<插件根>/vendor/quay-native`;自定义 provider(github、开发检出)仍写显式 `path`。`/quay:init` 对已有 config 的迁移必须**逐行删除**这两项,⛔ 不得整份 YAML 重新序列化(已实测序列化会丢光所有注释,且 `.quay/` 被 gitignore 找不回)。
(E) **`quay-init-state.json` 的版本改为从链接派生**:`serve-render.ts` 与 `goal-driver.ts` 探针改读 `<root>/.quay/plugin/.claude-plugin/plugin.json` 的 version,龄改读链接本身的 `lstat().mtimeMs`(⛔ 不跟随链接);链接缺失或目标不可读 ⇒ 读数为 null/`not-evaluated`,`init-state-missing` 成因改名为 `plugin-link-missing`,仍是 not-evaluated,⛔ 不与"相等/合格"同形。`laidAt` 只有 goal-driver 的龄在消费,由 mtime 替代;sha256/laidFiles/laidCategories 无消费者,不派生。
(F) **文档**:在 `plugin/skills/init/SKILL.md` 或 README 中写明 `<project>/.quay/plugin/bin/quay` 是 Core 不在场的消费者(如 CloudCLI 服务端 `execFile`,cwd 为项目根)的按项目指引路径,且它是"上次 init 时的插件",升级后到下次 init 之间可能落后,落后由 (B) 的 `pointer` 读数发现。

**保留不动**:`anchor.json` 的 `bundle` 与 `goal-round.jsonl` 的 `pluginVersion.delivered` 是对运行中进程的读数,不是配置绑定,保留。区分三类:绑定(决定行为,目标为零)、指引(只有 `.quay/plugin` 一个)、读数(观察运行中的进程,允许存在)。

**不在范围**:claudecodeui 侧 `quay-process.ts` 改用指引路径(属 claudecodeui 仓库,由其会话处理);会话层 Claude Code 选版本的真实规则取证(本设计不再依赖它);`loop.board`/`loop.gates` 缺默认值、`driver stop` 后 anchor 不重新武装(另案)。

<!-- dedup-ref -->相关(追溯,非前置):gap-config-provider-path-frozen-to-versioned-cache-dir(done,引入 `.quay/plugin` 与 `selectProjectPluginInstallPath`,本任务改写其选择规则并去掉 config 依赖);gap-driver-status-loaded-vs-installed-version-drift(done,loaded/installed 两个量);gap-path-resolved-quay-version-not-in-driver-status(done,PATH 命中读数)。

## Touches
- `packages/quay/src/init.ts`
- `packages/quay/src/plugin-root.ts`
- `packages/quay/src/serve-render.ts`
- `plugin/scripts/goal-driver.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/quay-init.sh`
- `plugin/skills/init/SKILL.md`
- `plugin/test/quay-init-stable-plugin-link.test.mjs`
- `plugin/test/goal-driver-s05.test.mjs`
- `plugin/test/goal-driver-s04.test.mjs`
- `plugin/test/helpers/goal-driver-harness.mjs`
- `plugin/test/helpers/quay-init-install-fixture.mjs`
- `plugin/test/driver-runtime-loaded-version-drift.test.mjs`
- `packages/quay/test/plugin-root.test.mjs`
- `packages/quay/test/install-config-driven-e2e.test.mjs`
- `plugin/sh-census-baseline.json`
- `tasks/gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it.md`

## AC
- [ ] `plugin/test/quay-init-stable-plugin-link.test.mjs` 改为断言:链接目标 == 传入 init 的 `--plugin-root`(或 `CLAUDE_PLUGIN_ROOT`),与夹具注册表里 project/user 条目的版本高低、有无 projectPath 完全无关(夹具含 project 0.14.0 + user 0.15.0,传入 plugin-root=0.15.0 ⇒ 链接指向 0.15.0;传入 0.14.0 ⇒ 指向 0.14.0);插件根缺失或为开发树 ⇒ 输出含 `NOT-EVALUATED` 且已有链接不变。`node --experimental-strip-types --test plugin/test/quay-init-stable-plugin-link.test.mjs` 退出 0;取假:恢复注册表 tier 选择后上述用例红(附实跑输出)。
- [ ] `grep -rn "selectProjectPluginInstallPath" packages/quay/src plugin/scripts --include=*.ts --include=*.sh` 排除测试与 dist 后命中数为 0(先打印基线读数与前 3 条命中,证明谓词对改前代码能命中)。
- [ ] Core 不写链接:新增测试断言 `driver start`、`serve`、MCP 启动路径、`driver status` 运行前后 `.quay/plugin` 的 `readlink` 不变;并 `grep -rn "symlinkSync\|\.quay.*plugin" packages/quay/src plugin/scripts --include=*.ts` 中对 `.quay/plugin` 的写调用只出现在 `refreshProjectPluginLink` 一处(列出命中)。
- [ ] `driver status --json` 含 `pointer` 项:夹具中 Core 插件根版本 0.15.0 / 链接目标 0.14.0 ⇒ `behind`;相同 ⇒ `current`;链接不存在或目标无 `plugin.json` ⇒ `not-evaluated`(与 `current` 取值不同);`node --experimental-strip-types --test plugin/test/driver-runtime-loaded-version-drift.test.mjs` 退出 0。
- [ ] `plugin-root.ts`:新增用例断言 `.quay/plugin` 存在且指向另一版本时,解析结果仍是模块自身所在插件根;`QUAY_PLUGIN_ROOT` 与自身位置不一致时读数含告警;`node --experimental-strip-types --test packages/quay/test/plugin-root.test.mjs` 退出 0。
- [ ] native provider 缺省解析:用真 `.quay/config.yml` 临时 workspace(缺 native 的 `path`/`mcp_entry`)启动 Core,断言 provider 从 `<插件根>/vendor/quay-native` 拉起且 `task_list` 可用;带显式自定义 provider `path` 的 config 行为不变。
- [ ] init 迁移:对含 native `path`/`mcp_entry` 与多行注释的旧 config 跑迁移,断言这两项被逐行删除、其余行(含全部注释)逐字节不变(对迁移前后文件做 `diff`,仅差被删的行)。
- [ ] `quay-init-state.json` 派生:`goal-driver-s05.test.mjs`/`goal-driver-s04.test.mjs` 与 `serve-render` 相关测试改用链接夹具(`goal-driver-harness.mjs` 的 `mkTargetRoot` 建 `.quay/plugin` 链接而非 state 文件);链接缺失 ⇒ `cause: "plugin-link-missing"` 且 `verdict: "not-evaluated"`,`equal: null`;`grep -rn "quay-init-state" packages/quay/src plugin/scripts --include=*.ts` 排除测试、dist 与注释后命中数为 0。
- [ ] 读生产载体:在本机 cantus(已有 `.quay/plugin` 链接)与 claudecodeui(尚无链接,需先 `/quay:init`)各实跑 `driver status --json` 与 goal-driver 的 target-health 探针,读出 `pointer` 与 `pluginVersion` 读数,cantus 为 current/equal、claudecodeui 链接缺失时为 `not-evaluated` 而非通过;读数原文贴进完成记录。该 AC 在把读取方改回读 `quay-init-state.json` 后必须变红(负控制)。
- [ ] `quay-init.sh` 是 sh-census 棘轮收费文件:改动后代码行数不高于改前基线(行数中性或净减),`plugin/sh-census-baseline.json` 同步;`bash scripts/test.sh --for-task gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:一个真实第三方项目升级插件版本后,重跑 `/quay:init` 即让 `.quay/plugin` 指向该会话实际加载的插件、`config.yml` 不含任何版本或链接依赖、`driver status` 与 goal-driver target-health 对该项目给出基于链接的真实 `pointer`/`pluginVersion` 读数;链接落后时读数为 `behind` 而非通过,Core 任何路径都没有改写过该链接。仅 fixture 绿不算完成。
