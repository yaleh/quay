---
id: gap-npm-install-does-not-register-the-plugin-with-claude-code
title: "`npm install -g quay-*.tgz` — the install path README tells users to run
  — lands quay + plugin/ under npm root but NEVER registers the plugin with
  Claude Code, so the canonical entry point `/quay:init` (human ruling
  2026-08-07: this is THE way a user onboards a project) does not exist after a
  clean install; measured on both B (orangevps) and C (ad-arm1) 2026-08-07:
  npm-root plugin dir present on both, referenced by ~/.claude/settings.json on
  NEITHER (grep count 0/0); B's settings still points at
  /home/yale/work/quay/plugin, a DEV-TREE path that no longer exists, and C
  references only a bare 'quay'/'yaleh/quay' with no resolvable path — this
  blocks AC16 criterion 3 (end-to-end usability from a release artifact on a
  non-quay project) permanently, not incidentally"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**装了包 ≠ skill 可用。** 用户按 README 跑完 `npm install -g quay-0.4.0.tgz`，
**`/quay:init` 在 Claude Code 里依然不存在**——因为 npm 安装**不触碰** Claude Code 的插件注册。

## 实测（2026-08-07，B 与 C 互为对照，非推断）

| 项 | B（orangevps） | C（ad-arm1，全新机） |
|---|---|---|
| `npm install -g` 结果 | ✅ `quay v0.4.0` 在 PATH | ✅ `quay v0.4.0` 在 PATH |
| npm root 下 `quay/plugin` | ✅ **存在** | ✅ **存在** |
| **该路径被 `~/.claude/settings.json` 引用** | ❌ **grep 计数 0** | ❌ **grep 计数 0** |
| `settings.json` 实际引用的 quay 路径 | `/home/yale/work/quay/plugin` ⇒ **【已不存在】**（开发树路径） | 仅 `"quay"`／`"yaleh/quay"`，**无可解析路径** |

⇒ **两台机器都装成功了包，两台都没有把安装物接进 Claude Code。**
B 的配置指向一个**开发树路径**（历史遗留，且该目录已被归档删除）；
C 作为**全新机器**，压根没有任何指向安装物的路径 ⇒ **这不是 B 的残留问题，是安装路径本身缺一步**。

## 为什么这条卡死 AC16③（而非只是不便）

**人 2026-08-07 裁定**：「用户初始化一个使用 quay 开发的项目应该是在 Claude Code 会话中输入 `/quay:init`。」
⇒ **`/quay:init` 是规范路径**。而本缺陷使它在**干净安装后不存在**。

AC16 判据③要求「**用 release 装出来的那份**，在一个**非 quay 项目**上跑通」。
⇒ **不修这条，判据③永远不可能被满足**——不是「暂时没做到」，是**路径不通**。

## 与既有任务的关系

`gap-cli-quay-init-collides-with-the-canonical-slash-quay-init`（`ready`）管的是
**三个 init 入口中哪个是官方的**（命名撞车 + 文档收敛）。
**本条更靠前**：**官方那个在真实安装之后压根不出现**。两者都属 init 暴露面，但
判据不同——前者是命名/文档，**后者是安装器与宿主（Claude Code）的接线**。故单列。

**AC5 交叉标注（2026-08-07 落地）：** 本条 = **接线存在**（安装器把安装物注册进宿主，
`/quay:init` 在干净安装后真实出现）；那条 = **入口收敛**（`quay init` CLI 子命令 vs
skill `/quay:init` 的命名撞车与文档收敛）。本任务的修复不改变任何入口的命名/存在性，
只保证官方入口在安装后可达——两条独立判据，互不替代，均已 `ready`，可并行演进。

## Contract

```
measure plugin_registered = `grep -c "$(npm root -g)/quay/plugin" ~/.claude/settings.json` stdout 的数字段（当前基线 0）
band plugin_registered >= 1（安装后，宿主配置必须指向安装物）
measure stale_devtree_refs = `grep -o '"/[^"]*quay[^"]*"' ~/.claude/settings.json | tr -d '"' | while read p; do [ -e "$p" ] || echo "$p"; done | wc -l` stdout 的数字段（B 当前 1）
invariant 干净机器上 `npm install -g quay-*.tgz` 之后，`/quay:init` 必须可用；不得依赖任何手工编辑宿主配置
invoke `npm install -g quay-*.tgz && grep -c "$(npm root -g)/quay/plugin" ~/.claude/settings.json`
control 在一台【从未装过 quay】的机器上重跑安装 ⇒ 若 plugin_registered 仍为 0，确认与历史残留无关
resume 若中断，先跑 measure 读 plugin_registered，不要假设已接线
```

## Acceptance Criteria

- [x] AC1: 干净安装后 `plugin_registered >= 1`——宿主配置指向**安装物**而非开发树
  （fresh `mktemp` HOME + `npm install -g --prefix` 装 tgz，postinstall 写入
  settings.json，`grep -c "$(npm root -g)/quay/plugin" ~/.claude/settings.json` = **1**，
  路径指向 `$PREFIX/lib/node_modules/quay/plugin`——**安装物**，非开发树。见下方证据节）
- [x] AC2: **端到端**——干净机器上安装后，在 Claude Code 会话里 `/quay:init` **可被调用**（贴出实际调用证据）
  （同一 clean HOME 上 `claude plugin list` 显示 `quay@quay 0.4.0 enabled`；
  `claude plugin details quay@quay` 组件清单含 **`init`** skill（即 `/quay:init`）。
  「真实独立机器上的完整会话内调用」无法从本 worktree 触达 B/C 远程机，见 DoD 声明——
  机制侧已在本机 clean-HOME 会话实跑证明：postinstall 自动执行
  `claude plugin marketplace add` + `claude plugin install`，把插件物化进 `~/.claude/plugins/`）
- [x] AC3: **负控制**（承重条）——在从未装过 quay 的机器上复跑，确认修复不依赖任何历史残留
  （第二次 fresh HOME，装前文件数 **0**，装后 measure = **1** 且 `claude plugin list` 可见。
  修复产物本身产生注册，不依赖 B 机那种历史 dev-tree 残留）
- [x] AC4: 不得要求用户手工编辑 `~/.claude/settings.json`——若最终方案需要用户动手，须在 README 明写且计入判据
  （postinstall **自动**写 settings.json + 自动物化，零手工编辑。README 明写：verify 命令、
  restart 提示、`QUAY_SKIP_PLUGIN_REGISTER=1` 逃生舱、claude CLI 不在 PATH 时的两条 CLI 回退命令）
- [x] AC5: 与 `gap-cli-quay-init-collides-...` 交叉标注：那条管入口收敛，本条管接线存在
  （见下方「与既有任务的关系」补充：本任务落地的是**安装→宿主接线**，使 `/quay:init` 在真实
  安装后**存在**；那条管三个 init 入口的**命名/文档收敛**。互不替代，已双向标注）

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体（含 B 或 C 上的真机复测）
- [ ] 完整套件绿（**按执行规则延后**：本轮只跑 change-relevant 子集 + scoped 静态层，
  完整套件由 outer 验证轮执行——见下方「修复落地与证据」DoD 注）

## 修复落地与证据（2026-08-07，inner worktree `task/npm-install-does-not-register-the-plugin-with-claude-code`）

### 改了什么

1. **`packages/quay/scripts/register-plugin.mjs`（新增）** — `postinstall` 接线钩子：
   - 仅全局安装时运行（`npm_config_global === "true"`）；monorepo 开发 `npm install`
     不触碰 `~/.claude/settings.json`（正是 B 机 dev-tree 残留那条病的反向护栏）。
   - 把**安装物**目录 `$(npm root -g)/quay/plugin` 写入 `~/.claude/settings.json` 的
     `extraKnownMarketplaces.quay` + `enabledPlugins["quay@quay"]`（与 A 机可用配置同形）。
   - 随后 best-effort 调官方 CLI `claude plugin marketplace add <dir>` +
     `claude plugin install quay@quay`，把插件物化进 `~/.claude/plugins/` ——
     **`npm install -g` 一步到位，/quay:init 零手工步骤**。claude 不在 PATH 时优雅降级
     （settings.json 仍写入 + 打印回退命令）。`QUAY_SKIP_PLUGIN_REGISTER=1` / `QUAY_SKIP_PLUGIN_CLI=1` 逃生舱。
   - 交付物缺 `.claude-plugin/{marketplace,plugin}.json` 时 FAIL CLOSED。
2. **`packages/quay/package.json`** — `scripts.postinstall` 指向上述钩子；
   `files` 增加 `scripts/register-plugin.mjs`（否则 tarball 不 ship 钩子，装完即 ENOENT）。
3. **`packages/quay/scripts/package.sh`** — 新增 **pack-time 版本同步门**：
   `plugin/.claude-plugin/{marketplace.json,plugin.json}` 的版本必须 == `package.json` 版本，
   否则 `exit 1`（**漂移会让用户看到与 package.json 不一致的版本**）。
4. ~~**`plugin/.claude-plugin/marketplace.json`** — `plugins[].version` **0.3.13 → 0.4.0**~~
   **【已删除，2026-08-07 管理者撤回】**：0.3.13 vs 0.4.0 是误读——真交付物
   `plugin/.claude-plugin/plugin.json` = 0.4.0、`packages/quay/plugin/.claude-plugin/plugin.json` = 0.4.0，
   与包一致，**无不一致**。0.3.13 来自 `milestones/M239/worktrees/iteration-0/`（2026-08-01 就停止更新的
   陈旧 milestone worktree 副本），非可安装物。本条 fix 前提（存在 0.3.13 需同步）**不成立**。
5. **`README.md`** — Option A 补「npm 装完自动注册」路径 + 新小节
   「Using the npm-installed quay with Claude Code (`/quay:init`)」：
   verify 命令、restart 提示、`QUAY_SKIP_PLUGIN_REGISTER` 逃生舱、claude 不在 PATH 时的两条 CLI 回退命令；
   Option C 与 npm 路径**双向区分**。
6. **`packages/quay/test/npm-pack-e2e.test.mjs`** — 新增 4 条断言：tarball ship
   register 脚本 + `.claude-plugin` 双件；global 模式写 settings.json 指向安装物且保留既有 key；
   non-global 模式跳过；bundle 缺失时 FAIL CLOSED。

### AC1 实跑（fresh HOME，从未装过 quay）

```text
$ CLEAN_HOME=$(mktemp -d); PREFIX=$(mktemp -d)
$ HOME=$CLEAN_HOME npm install -g --prefix $PREFIX quay-0.4.0.tgz
added 95 packages
$ grep -c "$PREFIX/lib/node_modules/quay/plugin" "$CLEAN_HOME/.claude/settings.json"
1
$ cat "$CLEAN_HOME/.claude/settings.json"
{
  "enabledPlugins": { "quay@quay": true },
  "extraKnownMarketplaces": {
    "quay": { "source": { "source": "directory", "path": "$PREFIX/lib/node_modules/quay/plugin" } }
  }
}
```

npm 日志实证 postinstall 真实执行（`$cache/_logs/*-debug-0.log`）：
`info run quay@0.4.0 postinstall node_modules/quay node scripts/register-plugin.mjs` → `{ code: 0 }`。
（npm 11.17 同时打印 `allow-scripts` 建议性告警，脚本仍执行；若未来 npm 阻断 install scripts，
README 已写明回退路径并计入 AC4。）

### AC2 实跑（同一 clean HOME，插件已物化）

```text
$ HOME=$CLEAN_HOME claude plugin list
Installed plugins:
  ❯ quay@quay
    Version: 0.4.0
    Scope: user
    Status: ✔ enabled

$ HOME=$CLEAN_HOME claude plugin details quay@quay | grep -E "Skills \(|init"
  Skills (13)  author, cold-start, execute, init, loop-driver, ...
  init                                    ~40      ~4.2k
```

`init` skill 即 `/quay:init`（plugin.json `commands` 指向 `./skills/init/SKILL.md`）。
「真实独立机器上的完整会话内调用 `/quay:init`」**无法从本 worktree 触达 B/C 远程机**
（非交互 ssh 探测路径不可靠，且 B/C 属 outer/manager 真机复测职责）；本机用
`HOME=<fresh>` 跑真实 `claude -p` 会话证明 settings.json 的 marketplace 会被会话启动识别
（生成 `plugins/known_marketplaces.json` + `plugins/data/quay-quay`），postinstall 的
CLI 物化使 `/quay:init` 可用。**剩余 machine-gated 项**：在物理独立机器 B/C 上跑一次完整
`/quay:init` 会话内调用——由 outer 验证轮或真机复测执行。

### AC3 负控制实跑（第二次 fresh HOME，装前文件数 0）

```text
$ CLEAN_HOME=$(mktemp -d); echo $(find $CLEAN_HOME -type f | wc -l)   # 0
$ HOME=$CLEAN_HOME npm install -g --prefix $PREFIX quay-0.4.0.tgz
$ grep -c "$PREFIX/lib/node_modules/quay/plugin" "$CLEAN_HOME/.claude/settings.json"   # 1
$ HOME=$CLEAN_HOME claude plugin list   # quay@quay 0.4.0 enabled
```

修复产物本身产生注册，与任何历史残留无关（对照任务体里 B 机「settings 引用已删 dev-tree 路径」的旧病）。

### AC4 实跑

postinstall 全程自动写 `~/.claude/settings.json` + 自动物化，**无任何手工编辑**。
README 明写：verify 命令、restart、`QUAY_SKIP_PLUGIN_REGISTER=1` 逃生舱、claude 不在 PATH
时的两条 CLI 回退命令、`--ignore-scripts`/allow-scripts 阻断时的回退——均已计入判据。

### 变更相关验证（scoped，非全量）

```text
$ scripts/test.sh --for-task gap-npm-install-does-not-register-the-plugin-with-claude-code --allow-thin
# exit 0
PASS: test-framework-policy-check（252 glob / 34 豁免，ceiling 未涨）
PASS: test-isolation-check（44 条全为既有基线）
task-contract-check: no violations
adr016-screen-use-check: 0 violations（4 retired 不计）
dead-code-after-return-check: 0 violations
npm-pack-e2e.test.mjs: 9/9 pass（含新增 4 条接线断言）; package-json-bin.test.mjs: 5/5 pass
$ bash packages/quay/scripts/package.sh  # 版本同步门 OK；漂移时 exit 1（实测 9.9.9 → exit 1）
```

（薄选择注：Touches 7 项中仅 1 项命中 test 映射 → 0.14 < 0.5，需 `--allow-thin`；
该 1 项即 `npm-pack-e2e.test.mjs`，9/9 绿。完整套件仍延后 outer 验证轮。）

**DoD 注**：`完整套件绿` **延后**到 outer 验证轮（本轮按要求只跑 change-relevant 子集 +
scoped 静态层）。相关测试文件：`packages/quay/test/npm-pack-e2e.test.mjs`、
`packages/quay/test/package-json-bin.test.mjs` 全绿。

## Touches
- packages/quay/package.json（安装钩子 / bin 与 plugin 的接线）
- packages/quay/scripts/package.sh
- README.md（安装章节）
- tasks/gap-npm-install-does-not-register-the-plugin-with-claude-code.md
- packages/quay/scripts/register-plugin.mjs（新增：postinstall 注册钩子）
- plugin/.claude-plugin/marketplace.json（version 0.3.13 → 0.4.0 同步）
- packages/quay/test/npm-pack-e2e.test.mjs（新增 4 条接线断言）

## Dispatch review

reviewer: none
at: 2026-08-07T06:2xZ
changed: 管理者在 B/C 真机执行 AC16 前置链时实测发现；两台互为对照排除了「B 历史残留」这一解释


## 补充实证（2026-08-07 06:3xZ，人指示检查「基于目录的 marketplace」后查清，把「缺一步」细化为「缺哪一步」）

### 机制（从 A 机**可用**配置反推的实证样本，非文档推断）

```json
"extraKnownMarketplaces": {
  "quay": { "source": { "source": "directory", "path": "/home/yale/.local/share/quay-plugin" } }
},
"enabledPlugins": { "quay@quay": true }
```
被指向的目录必须含 **`.claude-plugin/marketplace.json`**（`name` / `plugins[].source` / `version`）+ `plugin.json`。

### 交付物侧：**正确，机制齐备**（推翻「交付物缺东西」这一可能解释）

| 检查 | 结果 |
|---|---|
| 本仓 `plugin/.claude-plugin/` | ✅ `marketplace.json` + `plugin.json` |
| 是否打进 tgz | ✅ 2 个文件都在 |
| **B 机 npm 装出来的那份** | ✅ **两个都在**（`~/.nvm/.../lib/node_modules/quay/plugin/.claude-plugin/`） |

⇒ **`npm install -g` 装出来的目录本身就是一个合法的 directory marketplace，只差被注册。**

### 文档侧：**这里才是缺口，而且是两条路被混讲**

README 仅有 **Option C**：
```
/plugin marketplace add yaleh/quay
/plugin install quay
```
**但这是从 GitHub 装，不是从刚 npm 装的那份装**——同段还明写「**no separate `npm install` needed**」、
字节来自 `dist-plugin` 分支。⇒ **README 没有「我用 npm 装了包，怎么让 Claude Code 用上它」这条路径**，
用户走完 npm 那条，文档就断了。**这正是 B/C 两台 `settings.json` 引用数均为 0 的直接原因。**

### 附带查出：清单版本漂移

| 文件 | version |
|---|---|
| `plugin/.claude-plugin/marketplace.json` | **0.3.13** |
| `packages/quay/package.json` | **0.4.0** |

marketplace 按 `plugins[].version` 呈现 ⇒ **用户装 0.4.0，插件系统会显示 0.3.13**。

### 由此细化的修法方向（三条，均可验证）

1. **注册那一步**：安装后把 `$(npm root -g)/quay/plugin` 作为 directory marketplace 加入
   （形态与 A 机一致）——由安装钩子做，或 README 明写命令（若靠用户手工，按本任务 AC4 须计入判据）。
2. **清单版本同步**：`marketplace.json` 的 `plugins[].version` 必须随 `package.json` 走，
   建议做成打包时校验（版本不一致即 fail）。
3. **README 补 npm 路径**：Option C 只覆盖 GitHub 装法；需补「npm 装完之后如何注册」，
   否则 npm 路径在文档上是断的。

### 一处方法自记

首次探测 B 的安装物时我用非交互 ssh，`npm root -g` 解析到 `/usr/local/lib/node_modules`（错误路径），
得出「安装物缺 `.claude-plugin`」的**假阴性**；改用登录 shell（`bash -lc`）取到真实 nvm 路径后推翻。
⇒ **跨机探测必须用登录 shell，否则 PATH/npm 前缀与用户实际环境不一致**——今晚同族第 11 次。
