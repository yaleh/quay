---
id: gap-quay-init-install-steps-invalid-and-spec-4b-dev-slot
title: quay-init 安装步骤两参数形式被 CLI 拒且指向缓存目录——改为 github 发布渠道配方；SPEC §4b 改写为
  quay(github) / quay-dev(dog food) 双槽
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-161
---
**type:** execution

## Proposal

**来源**：2026-09-23 人裁定「只保障 Claude Code plugin marketplace 这一条部署途径；其它项目使用 github 的 marketplace（`/plugin marketplace add yaleh/quay`），本项目使用自己的 dog food」，同日已落地 dog food 半边（`d55cb22c9`：`plugin/.claude-plugin/marketplace.json` 源码形态改名 `quay-dev`，本仓启用 `quay@quay-dev`；发布副本由 `scripts/stamp-marketplace-name.mjs` 在 `publish-dist-branch.sh` / `package.sh` 两个出口戳回 `quay`。先前 `fa031022b` 的 symlink 目录方案已撤：skills/agent 全部 path-traversal 加载失败）。本任务收尾剩下的两处：

**① `quay-init` 打印的安装步骤本身是坏的，且指向错误的渠道。** `plugin/scripts/quay-init.sh:1756` 与 `plugin/skills/init/SKILL.md:84` 打印：

```
claude plugin marketplace add quay "${CLAUDE_PLUGIN_ROOT}"
```

- 当前 CLI（2.1.280）只收一个 `<source>`，无 `--name`，两参数形式直接被拒：`✘ Invalid marketplace source format. Try: owner/repo, https://..., or ./path`。
- 即便改成单参数，`$PLUGIN_ROOT` 在消费方是插件缓存目录——把缓存目录注册为 marketplace 源，与裁定（其它项目走 github）相反；而且目录源会占据全机唯一的 `quay` 名槽并**原地加载、无需安装记录**（2026-09-23 隔离实测：目录源 + 仅 enabledPlugins、零安装记录 ⇒ `claude mcp list` 仍 Connected）。
- 正确的消费方配方（隔离 `CLAUDE_CONFIG_DIR` 实测，从 `cache/quay/quay/0.11.0` 加载）：
  ```
  claude plugin marketplace add yaleh/quay
  claude plugin install quay@quay --scope project
  ```
  ⛔ 不要 `marketplace add ... --scope project`：它把机器特定源写进消费方的**提交**文件（SPEC 第 176 行已禁），且项目级声明同样会改写全机名槽。
- 现有测试（`plugin/test/quay-init.test.mjs:193`、`test/cold-start-e2e.sh:260`）只断言输出**含有** `claude plugin marketplace add` 字样——坏配方同样通过，属「读不懂却与合格同形」（硬规则 3b）。需要一条真正喂给 CLI 的判据。
- `quay-init.sh` 写入消费方 `.claude/settings.json` 的启用键是 `${PLUGIN_NAME}@${PLUGIN_NAME}`（`:1742`）= `quay@quay`，与 github 渠道名一致，**不需要改**；但它把插件名当成了 marketplace 名，只在两者相等时成立——在 SPEC 中记一句即可（观察项，发生率 0）。

**② SPEC §4b 的「唯一允许项」已被新裁定取代。** `orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §4b（及第 12 行摘要）写的是：user scope `extraKnownMarketplaces.quay = directory → <本仓库>/plugin`、本仓项目级启用 `quay@quay`。新形态（已落地并逐项目实测）：

```
~/.claude/settings.json   extraKnownMarketplaces.quay     = github yaleh/quay                        ✅ 发布渠道
                          extraKnownMarketplaces.quay-dev = directory → <本仓库>/plugin              ✅ dog food（机器特定路径，不入库）
                          enabledPlugins 不含任何 quay 键                                         ✅ AC-161 不变
<quay repo>/.claude/settings.json  enabledPlugins["quay@quay-dev"] = true                        ✅ 本仓 dog food
<其它项目>/.claude/settings.json   enabledPlugins["quay@quay"] = true  + install --scope project ✅ github 渠道
```

分层纪律（机器路径在 user scope、启用在项目级）不变，只换名字与源。§4b 需补写的机制事实（均 2026-09-23 实测）：
1. marketplace 名槽**全机唯一**；项目级/本地级声明会改写它（本仓 `settings.local.json` 曾把 `quay` 声明为目录源 ⇒ quay-fleet / meta-cc / lan / claudecodeui 全部从本仓开发树加载 MCP，claudecodeui 的 github 0.10.0 安装记录被顶替）。
2. 名字不可别名：注册名 = 源根 `.claude-plugin/marketplace.json` 的 `name`；插件命名空间不含 marketplace 名 ⇒ `mcp__plugin_quay_quay__*` 与 `quay:*` 不变。
3. `marketplace add` 对**已存在的同名槽静默不改**（无输出、无报错）；只有 `marketplace remove` 能改，而 `remove` 会删除该 marketplace 下**所有项目**的安装记录 ⇒ 迁移后须逐项目重装。
4. 同一项目同时启用 `quay@quay` 与 `quay@quay-dev` ⇒ 只剩一个 `plugin:quay:quay`，静默择一、不报冲突。
5. 目录源插件从源目录**原地**运行（`<本仓库>/plugin/vendor/quay/dist/quay.js`），不是从缓存副本。**目录源的插件根不能是 symlink**：commands/agents 路径按 realpath 核对，逃出 marketplace 目录即 `path-traversal`（MCP 不受此检查，所以 `claude mcp list` 正常不代表插件加载成功——判据须读 `claude plugin list --json` 的 `errors`）；`../` 源被拒、对象式 `directory` 源不支持、按 `.json` 文件路径注册则恒 `cache-miss` ⇒ 唯一可行布局是 `plugin/` 自身作 marketplace 根。
6. `plugin/.claude-plugin/marketplace.json` 源码形态名为 `quay-dev`，**发布形态为 `quay`**：`scripts/stamp-marketplace-name.mjs` 从仓库根 `.claude-plugin/marketplace.json` 读发布名，只改副本（`publish-dist-branch.sh` 串在组装树的 rsync 上，覆盖 `dist-plugin` 与 `release.yml` 的 `plugin-channel-verify`；`package.sh` 改暂存副本）。守卫：`marketplace-name-stamp.test.mjs`、`publish-dist-branch-closure-gate.test.mjs`、`npm-pack-e2e.test.mjs`（去掉任一出口的戳即红）。

**SPEC 内同载体兄弟实例（硬规则 5b）**：修完发现 §8 的 `AC6 用户级只承载源` 与新 §4b 直接冲突（它写「只有 `extraKnownMarketplaces.quay`」，而新形态有两个源键）⇒ 已同轮改写；第 12 行摘要亦改写。§7 退役清单第 9 行、§9-T3 的两处 `quay@quay` 是**历史记录**（记录当次迁移/差分实测的对象），非当前形态声明，保持原样。

<!-- dedup-ref -->
**相关（溯源，非前置）**：`gap-ac161-user-level-marketplace-only`（done，§4b 旧形态的落地任务）、`gap-verify-deliver-coldstart-marketplace-channel-unverified`（done）。AC-161 判据只读 user 级 `enabledPlugins`/`env`，**观测不到**「目录源名槽 + 他项目项目级启用 ⇒ 全机加载开发树」这种穿透——本任务 AC3 补一条能取假的读数，是否升格为常设判据由人另行裁定。

## AC

- [x] AC1（配方可被 CLI 接受）：`grep -n -E 'marketplace add quay ' plugin/scripts/quay-init.sh plugin/skills/init/SKILL.md` 零命中（先打印前 3 条命中再判），且二者打印的配方为 `claude plugin marketplace add yaleh/quay` + `claude plugin install quay@quay --scope project`
- [x] AC2（真喂给 CLI，不是字样匹配）：在 `mktemp -d` 的空 cwd + 隔离 `CLAUDE_CONFIG_DIR` 下，逐行执行 `quay-init` 实际打印出的两条安装命令，均 exit 0，且该 cwd 下 `claude mcp list` 的 `plugin:quay:quay` 行路径含 `/cache/quay/quay/`；对照：把第一条换回旧两参数形式 ⇒ exit ≠ 0（证明该判据能取假）。执行后 `git -C <本仓> status --short .claude/` 为空（隔离负控制）
- [x] AC3（生产读数，落地后当轮取）：在本机真实配置下，本仓 `claude plugin list --json` 的 `quay@quay-dev` 为 `enabled: true` 且**无 `errors` 键**、`claude mcp list` 的 quay 行路径含 `/work/quay/plugin/`，quay-fleet / meta-cc / lan / claudecodeui 各自含 `/cache/quay/quay/`，任一无关空目录下无 `plugin:quay` 行；六条读数原文贴进本任务 → 见下方 Evidence
- [x] AC4（SPEC 更新）：`grep -n 'quay-dev' orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` 在 §4b 内非零，且 §4b 不再把 `directory → <本仓库>/plugin` 写作 `quay` 的允许项；Proposal ② 的 6 条机制事实逐条在 §4b 有落点（贴映射）→ 见下方 Evidence
- [x] AC5：`plugin/test/quay-init.test.mjs` 与 `test/cold-start-e2e.sh` 的配方断言改为匹配完整的单参数 github 配方，并对旧两参数形式取假（改前对坏配方跑一次确认红）；`scripts/test.sh --for-task <本任务id>` 绿 → 见下方 Evidence
- [x] AC6：AC-161 判据仍 exit 0

## Evidence（AC 逐条读数，2026-09-23 worker 轮，本机）

夹具（**真实运行**，非构造字符串）：`quay-init.sh --loop --root <mktemp -d> --project proj
--test-command "node --test" --worktree-root <mktemp -d>`，`CLAUDE_PLUGIN_ROOT=<本仓>/plugin`，stdout 逐字捕获。
「旧输出」对照 = 用 `git show HEAD:plugin/scripts/quay-init.sh`（本次改动前的原文）在同一夹具下的真实 stdout。

### AC1
谓词先打印命中再判（硬规则 2 前半）：
```
$ grep -n -E 'marketplace add quay ' plugin/scripts/quay-init.sh plugin/skills/init/SKILL.md
（零输出，exit=1）
```
正向命中（改后，前 3 条即全部）：
```
$ grep -n 'claude plugin marketplace add yaleh/quay' plugin/scripts/quay-init.sh plugin/skills/init/SKILL.md
plugin/scripts/quay-init.sh:1762:  claude plugin marketplace add yaleh/quay
plugin/skills/init/SKILL.md:84:claude plugin marketplace add yaleh/quay
$ grep -n 'claude plugin install quay@quay --scope project' plugin/scripts/quay-init.sh plugin/skills/init/SKILL.md
plugin/scripts/quay-init.sh:1766:  claude plugin install quay@quay --scope project
plugin/skills/init/SKILL.md:85:claude plugin install quay@quay --scope project
```
`quay-init` 实际打印的配方（逐字）：
```
  claude plugin marketplace add yaleh/quay

  # 2. install the plugin for THIS project ...
  claude plugin install quay@quay --scope project
```

### AC2 —— 真喂给 CLI
夹具：`AC2_CWD=$(mktemp -d)`（空 cwd）、`CLAUDE_CONFIG_DIR=$(mktemp -d)`（隔离）。
从 `quay-init` 输出里 grep 出**恰好 2 行**（`grep -E '^[[:space:]]*claude plugin (marketplace add|install)'`，注释行因行首是 `#` 被排除），逐行执行：
```
--- [1] $ claude plugin marketplace add yaleh/quay
    Adding marketplace…SSH not configured, cloning via HTTPS: https://github.com/yaleh/quay.git
    Clone complete, validating marketplace…
    ✔ Successfully added marketplace: quay (declared in user settings)
    exit=0
--- [2] $ claude plugin install quay@quay --scope project
    Installing plugin "quay@quay"...✔ Successfully installed plugin: quay@quay (scope: project)
    exit=0
```
该 cwd 下 `claude mcp list`：
```
plugin:quay:quay: node /tmp/ac2-cfg-lCwv/plugins/cache/quay/quay/0.11.0/vendor/quay/dist/quay.js mcp - ✔ Connected
```
⇒ 路径含 `/cache/quay/quay/`（缓存副本，**不是** in-place 目录源）✓

对照（把第一条换回旧两参数形式，verbatim）：
```
$ claude plugin marketplace add quay "/data/home/yale/work/quay-worktrees/gap-quay-init-install-steps-invalid-and-spec-4b-dev-slot/plugin"
    ✘ Invalid marketplace source format. Try: owner/repo, https://..., or ./path
    exit=1
```
⇒ 判据能取假 ✓（并且该隔离 config 目录里 `settings.json` **根本没被创建**、`extraKnownMarketplaces` 为空
⇒ CLI 一个字节也没注册，这个"没有副作用"本身也取到了读数）
隔离负控制（执行后）：
```
$ git -C /data/home/yale/work/quay  status --short .claude/   →（空）
$ git -C <worktree>                 status --short .claude/   →（空）
```

### AC3 —— 六条生产读数（本机真实配置，逐字）
1. 本仓 `claude plugin list --json`（cwd = `/data/home/yale/work/quay`）中 `quay@quay-dev` 那一条：
```
{"id":"quay@quay-dev","version":"0.12.0-dev","scope":"project","enabled":true,
 "installPath":"/data/home/yale/.claude/plugins/cache/quay-dev/quay/0.12.0-dev",
 "installedAt":"2026-09-23T07:16:07.625Z","lastUpdated":"2026-09-23T07:16:07.625Z",
 "projectPath":"/data/home/yale/work/quay"}
```
⇒ `enabled: true` ✓ **且无 `errors` 键** ✓ —— 逐字检查该对象的键集恰好是
`id/version/scope/enabled/installPath/installedAt/lastUpdated/projectPath/mcpServers` 九个，
`errors` 缺席。（这一面 AC-161 观测不到，`claude mcp list` 也看不见——硬规则 4b：MCP 检查不覆盖插件加载。）
2. 本仓 `claude mcp list`：
```
plugin:quay:quay: node /data/home/yale/work/quay/plugin/vendor/quay/dist/quay.js mcp - ✔ Connected
```
⇒ 含 `/work/quay/plugin/` ✓（本仓从 `quay-dev` 开发树**原地**加载）
3–6. 四个其它项目各自 `claude mcp list`（cwd 分别为各自项目根）：
```
/data/home/yale/work/quay-fleet    → plugin:quay:quay: node /data/home/yale/.claude/plugins/cache/quay/quay/0.11.0/vendor/quay/dist/quay.js mcp - ✔ Connected
/data/home/yale/work/meta-cc       → plugin:quay:quay: node /data/home/yale/.claude/plugins/cache/quay/quay/0.11.0/vendor/quay/dist/quay.js mcp - ✔ Connected
/data/home/yale/work/lan           → plugin:quay:quay: node /data/home/yale/.claude/plugins/cache/quay/quay/0.11.0/vendor/quay/dist/quay.js mcp - ✔ Connected
/data/home/yale/work/claudecodeui  → plugin:quay:quay: node /data/home/yale/.claude/plugins/cache/quay/quay/0.11.0/vendor/quay/dist/quay.js mcp - ✔ Connected
```
⇒ 四条全部含 `/cache/quay/quay/` ✓（github 发布渠道，不再从本仓开发树加载）
7. 无关空目录（`$(mktemp -d)`，非 quay 项目）下 `claude mcp list | grep -c 'plugin:quay'` = **0** ✓
   同一份输出里 `plugin:archguard:archguard` 与 `plugin:meta-cc:meta-cc` 都在 ⇒ 这个 0 不是"命令没跑"（硬规则 4 推论二的自检形态：非零读数在同一份输出里）。

### AC4 —— SPEC 更新
```
$ grep -n 'quay-dev' orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
15, 119, 129, 134, 136, 152, 158, 167, 168, 347
```
§4b 现跨 **97–183 行** ⇒ §4b 内命中 **8 条**（119/129/134/136/152/158/167/168），非零 ✓
旧「允许项」逐字已不在（谓词对**已知为真**的移除目标取假）：
```
$ grep -n 'extraKnownMarketplaces.quay = directory → <本仓库>/plugin' <SPEC>
（零输出，exit=1）
```
Proposal ② 的 6 条机制事实 → §4b 落点映射：

| Proposal ② 事实 | §4b 落点 |
|---|---|
| 1 名槽全机唯一；项目级/本地级声明会改写它 | §4b-机制事实 **1**（行 149–152） |
| 2 名字不可别名（注册名 = 源根 marketplace.json 的 `name`；插件命名空间不含 marketplace 名） | §4b-机制事实 **2**（行 153–155） |
| 3 `add` 对同名槽静默不改；`remove` 删该 marketplace 下所有项目的安装记录 | §4b-机制事实 **3**（行 156–157） |
| 4 两插件同项目同时启用 ⇒ 静默择一 | §4b-机制事实 **4**（行 158–159） |
| 5 目录源原地运行 + 根不能是 symlink + 判据读 `plugin list --json` 的 `errors` | §4b-机制事实 **5**（行 160–166） |
| 6 源码名 `quay-dev` / 发布名 `quay` + stamp 两个出口 + 三条守卫 | §4b-机制事实 **6**（行 167–172） |

### AC5 —— 断言取假 + scoped 门
两处断言改为锚定**完整单参数 github 配方**，并对旧两参数形式取假：
- `plugin/test/quay-init.test.mjs`（AC4 用例）：`assert.match(out, /claude plugin marketplace add yaleh\/quay/)`
  + `assert.doesNotMatch(out, /marketplace add quay "/)` + 已知坏样本干跑（硬规则 2 后半：旧配方字符串必须仍命中**宽**谓词、必须不命中**锚定**谓词）。
- `test/cold-start-e2e.sh` LEG 3a：同上，两半负控制写进脚本本体。

**改前对坏配方跑一次确认红**（真实捕获的输出，不是构造字符串）：
```
旧输出（改动前脚本的真实 stdout）：
  LOOSE  /claude plugin marketplace add/                → MATCH     （旧断言只有这一条 ⇒ 坏配方照样放行）
  STRONG /claude plugin marketplace add yaleh\/quay/    → NO MATCH  （新断言取假 ⇒ 能红）
  BAD    /marketplace add quay "/                       → MATCH     （新增的"旧形态不得出现"断言取假 ⇒ 能红）
```
LEG 3a 断言块从 `test/cold-start-e2e.sh` 逐字抽出后，对两份输出各跑一次：
```
NEW 输出 → "the output names the marketplace-add + plugin-install steps explicitly（…）"  exit=0
OLD 输出 → FAIL: quay-init output does not name the FULL github recipe 'claude plugin marketplace add yaleh/quay'  exit=1
```
`scripts/test.sh --for-task gap-quay-init-install-steps-invalid-and-spec-4b-dev-slot --allow-thin`：
```
EXIT=0 · quay-init.test.mjs 14 tests / 14 pass / 0 fail · scoped 静态检查全绿
```
`--allow-thin` 的理由：本任务 6 条 Touches 只有 2 条能解析出测试（`test-selection-thin: resolved tests for 2/6`）。
其中 `test/cold-start-e2e.sh` 是 `workflow_dispatch` 门控的 CI e2e，**不在默认 glob 里**
（`scripts/test.sh --list-files | grep cold-start-e2e` 零命中）⇒ scoped 门结构上跑不到它；
它的取假证明由上面「抽块对两份输出各实跑一次」承担（`bash -n` 语法亦通过）。

### AC6
`goals/AC-161-user-level-marketplace-only.md` 的 criterion（YAML 折叠的 heredoc，`bash` 跑，逐字）：
```
AC-161 exit=0
```
用户级 `~/.claude/settings.json` 只有两个 quay **源**键（`extraKnownMarketplaces.quay` = github `yaleh/quay`、
`extraKnownMarketplaces.quay-dev` = directory `/data/home/yale/work/quay/plugin`），`enabledPlugins` 零 quay 键。

### DoD
- 真实空目录（`mktemp -d`，非 fixture）按打印步骤原样操作 ⇒ quay MCP 从 `/cache/quay/quay/0.11.0` 加载（AC2 读数）；
  本仓继续从 `quay-dev` 开发树加载（AC3-2）✓
- SPEC §4b 改写已随本次实现提交；落到 `develop` 由 fan-in 的 ff 承担
  （`git show develop:<SPEC> | grep -c quay-dev` 是 fan-in 之后的读数）
- 守卫 ④：改 `quay-init.sh` 触发 `quay-init-closure-ratchet-stale`，按守卫提示 `--reanchor` **刷新基线而非绕过**：
  足迹 `files=3 / bytes=1022` **与改前逐字相同**（只有 sources 指纹变），shrink-only 方向未被破坏；
  `docs/analysis/quay-init-closure-ratchet.baseline.json` 已随实现提交，pre-commit 守卫 ④ 放行。

### 附带发现（**不在本任务 Touches 内，仅记录，未改**）
- **`packages/quay/scripts/build-dist.mjs` 在 symlink 形态的路径下静默不构建。** `invokedAsScript` 比较
  `path.resolve(process.argv[1])` 与 `fileURLToPath(import.meta.url)`，后者是 realpath。经 `/home/yale/...`
  （→ `/data/home/yale/...` 的 symlink）调用时二者不等 ⇒ 脚本 **exit 0、一个字节也不写**（实测：
  `node /home/yale/.../build-dist.mjs` ⇒ `dist/` 空；`node /data/home/yale/.../build-dist.mjs` ⇒ 正常产出）。
  下游后果：`scripts/test.sh` 在该形态下报 `vendored dist mirror FAILED — refusing to run tests against a
  possibly-stale plugin bundle` —— 报错点在 sync-vendor，真因在 build 的**假成功**（硬规则 3b 形状）。
  本轮的绕法：用**物理路径**调用 `scripts/test.sh`（`bash /data/home/yale/.../scripts/test.sh ...`），
  因为 test.sh 的 `repo_root` 由 `BASH_SOURCE` 的**逻辑**路径推出，symlink 形态会把 `repo_root` 也变成 symlink 形态。
- `README.md:245`、`packages/quay/scripts/register-plugin.mjs:244`、`plugin/scripts/verify-deliver-coldstart.sh`
  各有 `claude plugin marketplace add <单参数>` 配方——**不是同一缺陷**（单参数，主体是 npm 目录源/冷启动验证），
  未改动。`grep -rn 'marketplace add quay ' <repo>`（排除 node_modules / vendor）命中数 = **2**（即上面两个
  Touches 文件），前 3 条即全部 ⇒ 本次是成对修，不是只修被报出来的那一个。

### 本轮收尾（2026-09-23 worker 第 2 轮）：sh-census 基线再锚 + 全量 suite 红的环境成因（A/B 实测）

**① `plugin/sh-census-baseline.json` 再锚 7680 → 7678（本任务的直接后果，已随本轮提交）**

`quay-init.sh` 的安装配方重写把该文件的 effective lines 从 **1012 压到 1010**（旧的 `printf` + heredoc 收/开共 3 行 → 1 行命令）。该文件在 command position 上 exec `node`、不在例外清单 ⇒ **留在 ratchet 轴内**（是行数变了，不是成员变了）。
`plugin/test/sh-census-check.test.mjs` 的 AC6 要求 committed baseline **等于**（不是 ≤）实测读数 ⇒ 缩轴也必须落档，否则下一次 land 时整个静态层变红——这正是该 AC6 存在的意义。
两侧都用 checker 自己的原语实测：develop 1012 / `embedded: [node]` ⇒ HEAD 1010 / `embedded: [node]`；`totals.embeddedInterpreterLines` 7680 → 7678 与 `files[path=plugin/scripts/quay-init.sh].codeLines` 1012 → 1010 **差值同为 −2**，即没有第二个文件在动。
**Residual = 0 是构造性而非抽样**：本轮 diff 共 7 条路径，其中 `*.sh` 有两条——另一条 `test/cold-start-e2e.sh` 实测 178 → 187（+9）但 `embedded: []`（纯 shell，无 command-position 解释器）⇒ **在本轴之外、贡献 0**（显式点出而非并进去，读 diff 的人才能逐行对上）。
⇒ 故本任务 `## Touches` 增加 `plugin/sh-census-baseline.json`（被 `anti-drift-touches-check --task ... --merge-target develop` 以 `out-of-declared` 检出，已声明后复跑 0 违规）。

**② 本轮 `step=suite` 红的其余 6 个失败：环境/机器态成因，A/B 实测（均与任务 delta 无关）**

驱动自身的分类器已判 `failing tests unrelated to this task's delta`（见 `.quay/worker-round.jsonl` 的 `retry_exemptions[].reason`），只因「断言签名未在 ≥2 个任务上复现（fail-closed 计数）」而计入本任务。逐条实测成因：

| 失败文件 | 成因 | A/B 实测（同一份代码，只换环境） |
|---|---|---|
| `develop-deliver-tgz-evidence-transport.test.mjs` ⑥ | GNU `sort` 的 collation 随 locale 变（`develop-deliver-tgz.sh` 的 `transport_imports_of` 用 `sort -u`） | `en_US.UTF-8` ⇒ 19/20；`LC_ALL=C` ⇒ **20/20** |
| `laydown-set-check.test.mjs` AC2 | 同类：`derive_loop_scripts()` 走 shell `sort`，而测试侧 `deriveViaQuayInit()` 用 JS `.sort()`（code-unit 序） | `en_US.UTF-8` ⇒ 8/9；`LC_ALL=C` ⇒ **9/9** |
| `outer-tick-log-check.test.mjs` ×2 | 时间标签判据读宿主时区（fixture 用 UTC `Z` 标签 + `Date.UTC` mtime，本机 `TZ` 未设 ⇒ CST/UTC+8） | 默认 ⇒ 25/27；`TZ=UTC` ⇒ **27/27** |
| `arch-coverage-report.test.mjs:246` | `.archguard` manifest 的 sources 记的是 `/home/yale/...`（symlink 形态；该 symlink 2026-09-19 才出现），而 `MAIN_ROOT` 是 `/data/home/yale/...` ⇒ 测试的 `path.relative(MAIN_ROOT, r)` 期望值与实现的 realpath 归一秒不掉 | 机器态（`.archguard` 不入 git），非本任务可改 |
| `direct-to-develop-bypass-check.test.mjs` AC3 | reflog 含 `fetch -q . author:develop` 一类 fetch 条目 ⇒ 分类器给 `unsupported-reflog-action`，而 fixture 期望 `unclassifiable-commits-in-range` | 共享 `.git` 的 reflog 态，非本任务可改 |

**这一类不是新问题——本仓已诊断过一次，但只修了 CI 那一半（硬规则 5b 形态）。**
`.github/workflows/ci.yml:29–41`（2026-09-16 `gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red`）已写明：job **显式声明** locale 而不是继承 runner 宿主，并给出同机同 commit 的 A/B（`LC_ALL=C.UTF-8` ⇒ 27 pass / 0 fail；`en_US.UTF-8` ⇒ 25 pass / 2 fail）。
**同载体的兄弟实例至今未修**：本地入口 `scripts/test.sh` 与 driver 的 fan-in **仍继承宿主 locale/时区**，而本机 `LANG=en_US.UTF-8`、`TZ` 未设（CST）⇒ 正是那个 25/2 形态（本轮实测 6 个文件红，上表前 3 行属此类）。
⇒ 单点修法（**本轮未做，交 suite-fix / manager 裁定**）：在 `scripts/test.sh` 顶部钉住 `LC_ALL=C.UTF-8` / `LANG=C.UTF-8` / `TZ=UTC`，与 CI 已声明的配置一致。
**本轮不做的理由（不是遗漏）**：它不在本任务 Touches 内；且即使钉住也只修得好上表前 3 行（后 2 行是机器态）⇒ 本任务仍然落不了地，**不构成一次可验证的收益**，而会以「worker 单方面改全仓测试入口」的形式扩大 blast radius。

**③ 本任务自身的门禁（本轮实测）**：`scripts/test.sh --for-task gap-quay-init-install-steps-invalid-and-spec-4b-dev-slot --allow-thin` ⇒ **EXIT=0**（scoped 只选到 `quay-init.test.mjs`：14 tests / 14 pass / 0 fail，静态检查与 typecheck 全绿）；`anti-drift-touches-check --task ... --merge-target develop` ⇒ 0 违规。

## DoD

- 一个真实的新项目（空目录，非 fixture）按 `quay-init` 打印的步骤原样操作后，会话里的 quay MCP 从 github 发布渠道的缓存加载（AC2 读数 + 一次真实项目读数）；本仓继续从 `quay-dev` 加载开发树（AC3）。文件改了、测试绿了只是必要条件——判据是生产读数。
- SPEC §4b 改写已提交并同步到 develop（`git show develop:orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md | grep -c quay-dev` 非零）；如触及 `quay-init.sh` 触发 pre-commit 守卫 ④（closure-ratchet 指纹），按守卫提示刷新基线而非绕过。

## Touches

- `plugin/scripts/quay-init.sh`
- `plugin/skills/init/SKILL.md`
- `orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md`
- `plugin/test/quay-init.test.mjs`
- `test/cold-start-e2e.sh`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `plugin/sh-census-baseline.json`
- `tasks/gap-quay-init-install-steps-invalid-and-spec-4b-dev-slot.md`
## Needs-Human

**执行 2026-09-23T07:32:52.807Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 <60000ms 快速死亡（退避上限）；快速死亡分类：ordinary

**解除 2026-09-23 — 基础设施原因已修复并验证，非本任务内容缺陷**

- 根因排查确认：上述 needs-human 是 worker-driver 连续快速死亡触发的重试退避上限，根因是 `.quay/profiles.yml` 中 `worker-default.model` 及其三个 `ANTHROPIC_DEFAULT_*_MODEL` 环境覆写被设为一个网关上不存在的模型名 `deepseek-v4-pro-anthropic`（直连探测 `http://127.0.0.1:26510/v1/models` 确认：网关只有 `v4.1flash`/`v4.1flash-anthropic`/`v4pro`/`v4pro-anthropic` 等条目，无任何 `deepseek-*` 名）。该窗口内每次 worker/selector 派发请求都以 400 "Invalid model name" 秒死，与本任务自身的 Proposal/Plan/AC/DoD 内容毫无关系——纯属基础设施配置故障造成的连坐。
- 修复：已将 `.quay/profiles.yml` 的 `worker-default.model` 与三个 `ANTHROPIC_DEFAULT_*_MODEL` 覆写统一改为 `v4.1flash-anthropic`，并直接对网关发起 `POST /v1/messages`（`model: v4.1flash-anthropic`）验证返回干净的 200 响应，确认该模型名在当前网关上可用。
- 据此将本任务从 needs-human 退回 ready，交由下一轮 worker-driver 重新拾取执行；本次变更未修改本任务 Proposal/Plan/AC/DoD 的任何一条内容，也未改动 Touches 清单。