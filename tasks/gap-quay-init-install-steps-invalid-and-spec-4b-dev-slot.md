---
id: gap-quay-init-install-steps-invalid-and-spec-4b-dev-slot
title: quay-init 安装步骤两参数形式被 CLI 拒且指向缓存目录——改为 github 发布渠道配方；SPEC §4b 改写为
  quay(github) / quay-dev(dog food) 双槽
status: todo
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

<!-- dedup-ref -->
**相关（溯源，非前置）**：`gap-ac161-user-level-marketplace-only`（done，§4b 旧形态的落地任务）、`gap-verify-deliver-coldstart-marketplace-channel-unverified`（done）。AC-161 判据只读 user 级 `enabledPlugins`/`env`，**观测不到**「目录源名槽 + 他项目项目级启用 ⇒ 全机加载开发树」这种穿透——本任务 AC3 补一条能取假的读数，是否升格为常设判据由人另行裁定。

## AC

- [ ] AC1（配方可被 CLI 接受）：`grep -n -E 'marketplace add quay ' plugin/scripts/quay-init.sh plugin/skills/init/SKILL.md` 零命中（先打印前 3 条命中再判），且二者打印的配方为 `claude plugin marketplace add yaleh/quay` + `claude plugin install quay@quay --scope project`
- [ ] AC2（真喂给 CLI，不是字样匹配）：在 `mktemp -d` 的空 cwd + 隔离 `CLAUDE_CONFIG_DIR` 下，逐行执行 `quay-init` 实际打印出的两条安装命令，均 exit 0，且该 cwd 下 `claude mcp list` 的 `plugin:quay:quay` 行路径含 `/cache/quay/quay/`；对照：把第一条换回旧两参数形式 ⇒ exit ≠ 0（证明该判据能取假）。执行后 `git -C <本仓> status --short .claude/` 为空（隔离负控制）
- [ ] AC3（生产读数，落地后当轮取）：在本机真实配置下，本仓 `claude plugin list --json` 的 `quay@quay-dev` 为 `enabled: true` 且**无 `errors` 键**、`claude mcp list` 的 quay 行路径含 `/work/quay/plugin/`，quay-fleet / meta-cc / lan / claudecodeui 各自含 `/cache/quay/quay/`，任一无关空目录下无 `plugin:quay` 行；六条读数原文贴进本任务
- [ ] AC4（SPEC 更新）：`grep -n 'quay-dev' orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` 在 §4b 内非零，且 §4b 不再把 `directory → <本仓库>/plugin` 写作 `quay` 的允许项；Proposal ② 的 6 条机制事实逐条在 §4b 有落点（贴映射）
- [ ] AC5：`plugin/test/quay-init.test.mjs` 与 `test/cold-start-e2e.sh` 的配方断言改为匹配完整的单参数 github 配方，并对旧两参数形式取假（改前对坏配方跑一次确认红）；`scripts/test.sh --for-task <本任务id>` 绿
- [ ] AC6：AC-161 判据仍 exit 0

## DoD

- 一个真实的新项目（空目录，非 fixture）按 `quay-init` 打印的步骤原样操作后，会话里的 quay MCP 从 github 发布渠道的缓存加载（AC2 读数 + 一次真实项目读数）；本仓继续从 `quay-dev` 加载开发树（AC3）。文件改了、测试绿了只是必要条件——判据是生产读数。
- SPEC §4b 改写已提交并同步到 develop（`git show develop:orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md | grep -c quay-dev` 非零）；如触及 `quay-init.sh` 触发 pre-commit 守卫 ④（closure-ratchet 指纹），按守卫提示刷新基线而非绕过。

## Touches

- `plugin/scripts/quay-init.sh`
- `plugin/skills/init/SKILL.md`
- `orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md`
- `plugin/test/quay-init.test.mjs`
- `test/cold-start-e2e.sh`
- `tasks/gap-quay-init-install-steps-invalid-and-spec-4b-dev-slot.md`
## Needs-Human

**执行 2026-09-23T07:32:52.807Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 <60000ms 快速死亡（退避上限）；快速死亡分类：ordinary

**解除 2026-09-23 — 基础设施原因已修复并验证，非本任务内容缺陷**

- 根因排查确认：上述 needs-human 是 worker-driver 连续快速死亡触发的重试退避上限，根因是 `.quay/profiles.yml` 中 `worker-default.model` 及其三个 `ANTHROPIC_DEFAULT_*_MODEL` 环境覆写被设为一个网关上不存在的模型名 `deepseek-v4-pro-anthropic`（直连探测 `http://127.0.0.1:26510/v1/models` 确认：网关只有 `v4.1flash`/`v4.1flash-anthropic`/`v4pro`/`v4pro-anthropic` 等条目，无任何 `deepseek-*` 名）。该窗口内每次 worker/selector 派发请求都以 400 "Invalid model name" 秒死，与本任务自身的 Proposal/Plan/AC/DoD 内容毫无关系——纯属基础设施配置故障造成的连坐。
- 修复：已将 `.quay/profiles.yml` 的 `worker-default.model` 与三个 `ANTHROPIC_DEFAULT_*_MODEL` 覆写统一改为 `v4.1flash-anthropic`，并直接对网关发起 `POST /v1/messages`（`model: v4.1flash-anthropic`）验证返回干净的 200 响应，确认该模型名在当前网关上可用。
- 据此将本任务从 needs-human 退回 ready，交由下一轮 worker-driver 重新拾取执行；本次变更未修改本任务 Proposal/Plan/AC/DoD 的任何一条内容，也未改动 Touches 清单。
